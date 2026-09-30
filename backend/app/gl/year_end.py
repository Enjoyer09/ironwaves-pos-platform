"""Fiscal year-end close.

Closing zeroes every revenue and expense account for the year and moves the net
result into 343 "Keçmiş illər üzrə bölüşdürülməmiş mənfəət" (retained earnings),
together with anything booked directly on 341 "Hesabat dövründə xalis mənfəət".
It is one ordinary, audited ``closing`` journal dated 31 December, so:

* the balance sheet after 31 Dec shows last year's result in 343 and only the
  current year's result as unclosed earnings;
* P&L-style reports ignore closing entries (``engine.not_year_close``), so the
  year's income statement is unchanged after closing;
* once closed, nothing else can be posted into that year (``year_closed``);
* reopening = storno of the closing journal (four-eyes approval), after which
  the year can be corrected and closed again.

Branches are closed separately so branch balance sheets keep adding up.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.gl import engine as gl
from app.gl.engine import YEAR_CLOSE_SOURCE, ZERO, GLError, LineIn
from app.gl.models import GLAccount, GLFiscalPeriod, GLJournal, GLJournalLine


def _year_bounds(year: int) -> tuple[date, date]:
    if not 2000 <= year <= 2100:
        raise GLError("Invalid fiscal year", "invalid_year")
    return date(year, 1, 1), date(year, 12, 31)


def _closing_journals(db: Session, tenant_id: str, year: int) -> list[GLJournal]:
    return (
        db.query(GLJournal)
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.source_type == YEAR_CLOSE_SOURCE, GLJournal.source_id == str(year),
                GLJournal.journal_type == "closing")
        .order_by(GLJournal.created_at.asc())
        .all()
    )


def _balances_to_close(db: Session, tenant_id: str, year: int) -> list[tuple[GLAccount, str | None, Decimal]]:
    """(account, branch, debit-positive net) for every P&L account and 341 with a balance in the year."""
    start, end = _year_bounds(year)
    roles = gl.accounts_by_role(db, tenant_id)
    current_earnings = roles.get("current_year_earnings")
    accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id).all()}
    target_ids = [a.id for a in accounts.values() if a.account_type in {"revenue", "expense"}]
    if current_earnings:
        target_ids.append(current_earnings.id)
    rows = (
        db.query(GLJournalLine.account_id, GLJournalLine.branch_id,
                 func.coalesce(func.sum(GLJournalLine.debit), 0), func.coalesce(func.sum(GLJournalLine.credit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(GLJournalLine.tenant_id == tenant_id, GLJournal.status == "posted", GLJournal.posting_date >= start,
                GLJournal.posting_date <= end, GLJournalLine.account_id.in_(target_ids))
        .group_by(GLJournalLine.account_id, GLJournalLine.branch_id)
        .all()
    )
    out = []
    for account_id, branch_id, d, c in rows:
        net = (Decimal(str(d)) - Decimal(str(c))).quantize(Decimal("0.01"))
        if net:
            out.append((accounts[account_id], branch_id, net))
    out.sort(key=lambda item: (item[1] or "", item[0].code))
    return out


def year_status(db: Session, tenant_id: str, year: int) -> dict:
    start, end = _year_bounds(year)
    active = gl.active_year_close(db, tenant_id, year)
    periods = (
        db.query(GLFiscalPeriod)
        .filter(GLFiscalPeriod.tenant_id == tenant_id, GLFiscalPeriod.year == year)
        .order_by(GLFiscalPeriod.month.asc())
        .all()
    )
    pending = (
        db.query(func.count(GLJournal.id))
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.status.in_(["draft", "pending_approval"]),
                GLJournal.posting_date >= start, GLJournal.posting_date <= end)
        .scalar()
    ) or 0
    to_close = [] if active else _balances_to_close(db, tenant_id, year)
    # Debit-positive sum of P&L balances: negative means profit.
    result = -sum((net for _, _, net in to_close), ZERO)
    blockers = []
    if year >= gl.business_today().year:
        blockers.append("year_not_ended")
    if pending:
        blockers.append("pending_journals")
    if any(p.status == "open" for p in periods):
        blockers.append("open_periods")
    if any(p.month == 12 and p.status == "closed" for p in periods):
        blockers.append("december_closed")
    return {
        "year": year,
        "closed": active is not None,
        "closing_journal": {"id": active.id, "journal_no": active.journal_no, "posted_at": active.posted_at.isoformat() if active.posted_at else None,
                            "posted_by": active.posted_by} if active else None,
        "pending_journals": int(pending),
        "periods": [{"month": p.month, "status": p.status} for p in periods],
        "net_result_to_close": str(result.quantize(Decimal("0.01"))),
        "accounts_to_close": len(to_close),
        "blockers": [] if active else blockers,
        "can_close": active is None and not blockers and bool(to_close),
    }


def close_fiscal_year(db: Session, tenant_id: str, year: int, *, actor: str) -> GLJournal:
    """Post the closing journal for ``year``. Controller action; runs in the caller's transaction."""
    start, end = _year_bounds(year)
    if gl.active_year_close(db, tenant_id, year):
        raise GLError(f"Fiscal year {year} is already closed", "year_already_closed", 409)
    status = year_status(db, tenant_id, year)
    messages = {
        "year_not_ended": "Only a finished fiscal year can be closed",
        "pending_journals": f"{status['pending_journals']} draft/pending journal(s) in {year} must be posted or rejected first",
        "open_periods": f"All periods of {year} must be soft-closed or closed first",
        "december_closed": f"December {year} is closed; set it to soft-closed so the closing entry can be posted",
    }
    if status["blockers"]:
        first = status["blockers"][0]
        raise GLError(messages[first], first, 409)
    items = _balances_to_close(db, tenant_id, year)
    if not items:
        raise GLError(f"Nothing to close for {year}", "nothing_to_close", 409)

    retained = gl.accounts_by_role(db, tenant_id)["retained_earnings"]
    lines: list[LineIn] = []
    per_branch: dict[str | None, Decimal] = defaultdict(lambda: ZERO)
    for account, branch_id, net in items:
        # Opposite side zeroes the account; the balancing amount goes to 343 in the same branch.
        lines.append(LineIn(account=account.id, debit=-net if net < 0 else ZERO, credit=net if net > 0 else ZERO,
                            branch_id=branch_id, memo=f"İlin bağlanması {year}"))
        per_branch[branch_id] += net
    for branch_id, net in sorted(per_branch.items(), key=lambda kv: kv[0] or ""):
        if net:
            lines.append(LineIn(account=retained.id, debit=net if net > 0 else ZERO, credit=-net if net < 0 else ZERO,
                                branch_id=branch_id, memo=f"{year} ilinin nəticəsi"))

    attempt = len(_closing_journals(db, tenant_id, year)) + 1
    journal = gl.create_journal(
        db,
        tenant_id=tenant_id,
        journal_type="closing",
        lines=lines,
        created_by=actor,
        posting_date=end,
        description=f"{year} maliyyə ilinin bağlanması: nəticə 343-ə köçürülür",
        source_module="gl",
        source_type=YEAR_CLOSE_SOURCE,
        source_id=str(year),
        idempotency_key=f"year_close:{year}:{attempt}",
        allow_soft_closed=True,
    )
    gl.append_audit(db, tenant_id, event_type="FISCAL_YEAR_CLOSED", entity_type="fiscal_year", entity_id=str(year), actor=actor,
                    payload={"journal_id": journal.id, "net_result": status["net_result_to_close"], "accounts": len(items)})
    return journal


def request_reopen_fiscal_year(db: Session, tenant_id: str, year: int, *, actor: str, reason: str) -> GLJournal:
    """Storno of the closing journal, dated 31 Dec, pending a second person's approval."""
    _, end = _year_bounds(year)
    active = gl.active_year_close(db, tenant_id, year)
    if not active:
        raise GLError(f"Fiscal year {year} is not closed", "year_not_closed", 409)
    december = (
        db.query(GLFiscalPeriod)
        .filter(GLFiscalPeriod.tenant_id == tenant_id, GLFiscalPeriod.year == year, GLFiscalPeriod.month == 12)
        .first()
    )
    if december and december.status == "closed":
        raise GLError(f"December {year} is closed; set it to soft-closed before reopening the year", "december_closed", 409)
    reversal = gl.reverse_journal(db, tenant_id, active.id, actor=actor, reason=reason, posting_date=end,
                                  require_approval=True, allow_soft_closed=True)
    gl.append_audit(db, tenant_id, event_type="FISCAL_YEAR_REOPEN_REQUESTED", entity_type="fiscal_year", entity_id=str(year), actor=actor,
                    payload={"closing_journal_id": active.id, "reversal_id": reversal.id, "reason": reason})
    return reversal
