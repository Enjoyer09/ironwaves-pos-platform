"""Financial statements computed exclusively from posted GL journals.

All date filters use the journal ``posting_date`` and are inclusive on both
ends (``date_to`` = end of that day), so "1 May – 1 May" means the whole of 1 May.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.gl.engine import CENT, ZERO, GLError, not_year_close
from app.gl.models import GLAccount, GLAccountBalance, GLFiscalPeriod, GLJournal, GLJournalLine


def _s(value: Decimal) -> str:
    return str(Decimal(value).quantize(CENT))


def _turnover(db: Session, tenant_id: str, *, date_from: date | None = None, date_to: date | None = None, branch_id: str | None = None,
              exclude_year_close: bool = False) -> dict[str, tuple[Decimal, Decimal]]:
    query = (
        db.query(GLJournalLine.account_id, func.coalesce(func.sum(GLJournalLine.debit), 0), func.coalesce(func.sum(GLJournalLine.credit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(GLJournalLine.tenant_id == tenant_id, GLJournal.status == "posted")
    )
    if exclude_year_close:
        query = query.filter(not_year_close())
    if date_from:
        query = query.filter(GLJournal.posting_date >= date_from)
    if date_to:
        query = query.filter(GLJournal.posting_date <= date_to)
    if branch_id:
        query = query.filter(GLJournalLine.branch_id == branch_id)
    return {acc: (Decimal(str(d or 0)), Decimal(str(c or 0))) for acc, d, c in query.group_by(GLJournalLine.account_id).all()}


def _accounts(db: Session, tenant_id: str) -> list[GLAccount]:
    return db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id).order_by(GLAccount.code.asc()).all()


def _signed(account: GLAccount, debit: Decimal, credit: Decimal) -> Decimal:
    return debit - credit if account.normal_side == "debit" else credit - debit


def _check_range(date_from: date | None, date_to: date | None) -> None:
    if date_from and date_to and date_from > date_to:
        raise GLError("date_from must be on or before date_to", "invalid_range")


def trial_balance(db: Session, tenant_id: str, *, date_from: date | None = None, date_to: date | None = None, branch_id: str | None = None) -> dict:
    _check_range(date_from, date_to)
    opening = _turnover(db, tenant_id, date_to=date.fromordinal(date_from.toordinal() - 1), branch_id=branch_id) if date_from else {}
    movement = _turnover(db, tenant_id, date_from=date_from, date_to=date_to, branch_id=branch_id)
    rows = []
    totals = defaultdict(lambda: ZERO)
    for account in _accounts(db, tenant_id):
        od, oc = opening.get(account.id, (ZERO, ZERO))
        md, mc = movement.get(account.id, (ZERO, ZERO))
        if not any((od, oc, md, mc)):
            continue
        open_net, close_net = od - oc, od - oc + md - mc  # debit-positive
        row = {
            "account_id": account.id,
            "code": account.code,
            "name": account.name,
            "account_type": account.account_type,
            "opening_debit": _s(max(open_net, ZERO)),
            "opening_credit": _s(max(-open_net, ZERO)),
            "period_debit": _s(md),
            "period_credit": _s(mc),
            "closing_debit": _s(max(close_net, ZERO)),
            "closing_credit": _s(max(-close_net, ZERO)),
        }
        for key in ("opening_debit", "opening_credit", "period_debit", "period_credit", "closing_debit", "closing_credit"):
            totals[key] += Decimal(row[key])
        rows.append(row)
    total_out = {k: _s(v) for k, v in totals.items()} or {k: "0.00" for k in ("opening_debit", "opening_credit", "period_debit", "period_credit", "closing_debit", "closing_credit")}
    balanced = (
        totals["opening_debit"] == totals["opening_credit"]
        and totals["period_debit"] == totals["period_credit"]
        and totals["closing_debit"] == totals["closing_credit"]
    )
    return {"date_from": date_from.isoformat() if date_from else None, "date_to": date_to.isoformat() if date_to else None,
            "rows": rows, "totals": total_out, "balanced": balanced}


def balance_sheet(db: Session, tenant_id: str, *, as_of: date, branch_id: str | None = None) -> dict:
    turnover = _turnover(db, tenant_id, date_to=as_of, branch_id=branch_id)
    sections: dict[str, list[dict]] = {"asset": [], "liability": [], "equity": []}
    totals = {"asset": ZERO, "liability": ZERO, "equity": ZERO}
    earnings = ZERO  # revenue - expense not yet closed to equity
    for account in _accounts(db, tenant_id):
        d, c = turnover.get(account.id, (ZERO, ZERO))
        if account.account_type in {"revenue", "expense"}:
            earnings += c - d
            continue
        if not d and not c:
            continue
        # Presentation sign: assets debit-positive, liabilities/equity credit-positive
        # (contra accounts such as 112 amortization therefore show negative).
        amount = d - c if account.account_type == "asset" else c - d
        sections[account.account_type].append({"code": account.code, "name": account.name, "amount": _s(amount)})
        totals[account.account_type] += amount
    sections["equity"].append({"code": "341*", "name": "Hesabat dövrünün bağlanmamış mənfəəti (zərəri)", "amount": _s(earnings)})
    totals["equity"] += earnings
    difference = totals["asset"] - (totals["liability"] + totals["equity"])
    return {
        "as_of": as_of.isoformat(),
        "assets": {"lines": sections["asset"], "total": _s(totals["asset"])},
        "liabilities": {"lines": sections["liability"], "total": _s(totals["liability"])},
        "equity": {"lines": sections["equity"], "total": _s(totals["equity"])},
        "liabilities_and_equity_total": _s(totals["liability"] + totals["equity"]),
        "difference": _s(difference),
        "balanced": difference == 0,
    }


def _pl_group(account: GLAccount) -> str:
    code = account.code
    if code.startswith("60"):
        return "revenue"
    if code.startswith("61") or code.startswith("63"):
        return "other_income"
    if code.startswith("701"):
        return "cogs"
    if account.system_role == "simplified_tax_expense" or code.startswith("9"):
        return "taxes"
    if code.startswith("75"):
        return "finance_costs"
    return "operating_expenses"


def profit_and_loss(db: Session, tenant_id: str, *, date_from: date, date_to: date, branch_id: str | None = None) -> dict:
    _check_range(date_from, date_to)
    # Closing entries move the year's result to equity; they are not income or expense.
    turnover = _turnover(db, tenant_id, date_from=date_from, date_to=date_to, branch_id=branch_id, exclude_year_close=True)
    groups: dict[str, dict] = {g: {"lines": [], "total": ZERO} for g in ("revenue", "cogs", "operating_expenses", "other_income", "finance_costs", "taxes")}
    for account in _accounts(db, tenant_id):
        if account.account_type not in {"revenue", "expense"}:
            continue
        d, c = turnover.get(account.id, (ZERO, ZERO))
        if not d and not c:
            continue
        # Revenue shown credit-positive (602 discounts become negative); expenses debit-positive.
        amount = c - d if account.account_type == "revenue" else d - c
        group = _pl_group(account)
        groups[group]["lines"].append({"code": account.code, "name": account.name, "amount": _s(amount)})
        groups[group]["total"] += amount
    t = {g: v["total"] for g, v in groups.items()}
    gross_profit = t["revenue"] - t["cogs"]
    operating_profit = gross_profit - t["operating_expenses"] + t["other_income"]
    profit_before_tax = operating_profit - t["finance_costs"]
    net_profit = profit_before_tax - t["taxes"]
    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        **{g: {"lines": v["lines"], "total": _s(v["total"])} for g, v in groups.items()},
        "gross_profit": _s(gross_profit),
        "operating_profit": _s(operating_profit),
        "profit_before_tax": _s(profit_before_tax),
        "net_profit": _s(net_profit),
    }


def account_ledger(db: Session, tenant_id: str, account_id: str, *, date_from: date | None = None, date_to: date | None = None, limit: int = 200, offset: int = 0) -> dict:
    _check_range(date_from, date_to)
    account = db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id, GLAccount.id == account_id).first()
    if not account:
        raise GLError("Account not found", "account_not_found", 404)
    limit = min(max(int(limit), 1), 1000)
    offset = max(int(offset), 0)
    base = (
        db.query(GLJournalLine, GLJournal)
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(GLJournalLine.tenant_id == tenant_id, GLJournalLine.account_id == account.id, GLJournal.status == "posted")
    )
    opening = ZERO
    if date_from:
        od, oc = (
            db.query(func.coalesce(func.sum(GLJournalLine.debit), 0), func.coalesce(func.sum(GLJournalLine.credit), 0))
            .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
            .filter(GLJournalLine.account_id == account.id, GLJournal.status == "posted", GLJournal.posting_date < date_from)
            .one()
        )
        opening = _signed(account, Decimal(str(od or 0)), Decimal(str(oc or 0)))
        base = base.filter(GLJournal.posting_date >= date_from)
    if date_to:
        base = base.filter(GLJournal.posting_date <= date_to)
    ordered = base.order_by(GLJournal.posting_date.asc(), GLJournal.journal_no.asc(), GLJournalLine.line_no.asc())
    # Running balance must include rows skipped by pagination.
    if offset:
        skipped = ordered.limit(offset).all()
        for line, _journal in skipped:
            opening += _signed(account, Decimal(str(line.debit)), Decimal(str(line.credit)))
    running = opening
    entries = []
    for line, journal in ordered.offset(offset).limit(limit).all():
        running += _signed(account, Decimal(str(line.debit)), Decimal(str(line.credit)))
        entries.append({
            "journal_id": journal.id, "journal_no": journal.journal_no, "posting_date": journal.posting_date.isoformat(),
            "journal_type": journal.journal_type, "description": journal.description, "memo": line.memo,
            "debit": _s(line.debit), "credit": _s(line.credit), "balance": _s(running),
            "source_type": journal.source_type, "source_id": journal.source_id,
        })
    return {"account": {"id": account.id, "code": account.code, "name": account.name, "normal_side": account.normal_side},
            "opening_balance": _s(opening), "entries": entries, "closing_balance": _s(running), "limit": limit, "offset": offset}


def verify_materialized_balances(db: Session, tenant_id: str) -> dict:
    """Compare gl_account_balances with a full recomputation from lines."""
    actual = {
        (acc, per, br or ""): (Decimal(str(d)), Decimal(str(c)))
        for acc, per, br, d, c in db.query(
            GLJournalLine.account_id, GLJournal.period_id, GLJournalLine.branch_id,
            func.coalesce(func.sum(GLJournalLine.debit), 0), func.coalesce(func.sum(GLJournalLine.credit), 0),
        )
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(GLJournalLine.tenant_id == tenant_id, GLJournal.status == "posted")
        .group_by(GLJournalLine.account_id, GLJournal.period_id, GLJournalLine.branch_id)
        .all()
    }
    stored = {
        (row.account_id, row.period_id, row.branch_key): (Decimal(str(row.debit_total)), Decimal(str(row.credit_total)))
        for row in db.query(GLAccountBalance).filter(GLAccountBalance.tenant_id == tenant_id).all()
    }
    mismatches = []
    for key in set(actual) | set(stored):
        a = actual.get(key, (ZERO, ZERO))
        s = stored.get(key, (ZERO, ZERO))
        if a != s:
            mismatches.append({"account_id": key[0], "period_id": key[1], "branch": key[2], "lines": [_s(a[0]), _s(a[1])], "stored": [_s(s[0]), _s(s[1])]})
    return {"valid": not mismatches, "mismatches": mismatches}


def periods_overview(db: Session, tenant_id: str) -> list[dict]:
    rows = db.query(GLFiscalPeriod).filter(GLFiscalPeriod.tenant_id == tenant_id).order_by(GLFiscalPeriod.year.desc(), GLFiscalPeriod.month.desc()).all()
    return [
        {"id": p.id, "year": p.year, "month": p.month, "start_date": p.start_date.isoformat(), "end_date": p.end_date.isoformat(),
         "status": p.status, "closed_by": p.closed_by, "closed_at": p.closed_at.isoformat() if p.closed_at else None}
        for p in rows
    ]
