"""GL posting engine — the single write path into the Finance v2 ledger.

Every function here runs inside the caller's DB transaction and never commits.
The caller (router / domain service) owns commit/rollback, so a sale and its
journal are persisted atomically or not at all.
"""
from __future__ import annotations

import calendar
import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.gl.coa_az import AMHP_ACCOUNTS, REQUIRED_ROLES, account_class, normal_side
from app.gl.models import (
    GLAccount,
    GLAccountBalance,
    GLAuditEvent,
    GLFiscalPeriod,
    GLJournal,
    GLJournalLine,
    GLSequence,
    JOURNAL_TYPES,
)

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
BUSINESS_TZ = ZoneInfo("Asia/Baku")
GENESIS_HASH = "0" * 64
# source_type of year-end closing journals (and, by inheritance, their reversals).
YEAR_CLOSE_SOURCE = "year_close"


def not_year_close():
    """SQL filter excluding year-end closing entries. P&L-style reports must use it,
    otherwise the closing journal would zero the year's revenue and expenses."""
    return or_(GLJournal.source_type.is_(None), GLJournal.source_type != YEAR_CLOSE_SOURCE)


def active_year_close(db: Session, tenant_id: str, year: int) -> GLJournal | None:
    """The posted, not reversed closing journal of ``year`` (None while the year is open)."""
    return (
        db.query(GLJournal)
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.source_type == YEAR_CLOSE_SOURCE, GLJournal.source_id == str(year),
                GLJournal.journal_type == "closing", GLJournal.status == "posted", GLJournal.reversed_by_id.is_(None))
        .first()
    )


class GLError(Exception):
    """Business-rule violation. Routers translate it to HTTP 400/409."""

    def __init__(self, message: str, code: str = "gl_error", status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


# ─────────────────────────────── helpers ────────────────────────────────


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def business_today() -> date:
    return datetime.now(BUSINESS_TZ).date()


def money(value) -> Decimal:
    """Parse to Decimal with exactly 2 decimals. Rejects NaN/inf and sub-cent precision."""
    try:
        amount = Decimal(str(value if value is not None else "0").strip().replace(",", "."))
    except Exception as exc:  # decimal.InvalidOperation
        raise GLError(f"Invalid amount: {value!r}", "invalid_amount") from exc
    if not amount.is_finite():
        raise GLError(f"Invalid amount: {value!r}", "invalid_amount")
    if amount != amount.quantize(CENT):
        raise GLError(f"Amount has more than 2 decimals: {value!r}", "invalid_amount")
    return amount.quantize(CENT, rounding=ROUND_HALF_UP)


def round_money(value: Decimal) -> Decimal:
    """Round a computed amount (e.g. tax) half-up to cents."""
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def _canonical(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


# ─────────────────────────────── sequences ──────────────────────────────


def _locked_sequence(db: Session, tenant_id: str, name: str) -> GLSequence:
    """Return the sequence row locked FOR UPDATE, creating it race-safely."""
    row = db.query(GLSequence).filter(GLSequence.tenant_id == tenant_id, GLSequence.name == name).with_for_update().first()
    if row:
        return row
    try:
        with db.begin_nested():
            db.add(GLSequence(tenant_id=tenant_id, name=name, last_value=0, last_hash=None))
    except IntegrityError:
        pass  # a concurrent transaction created it; fall through and lock it
    return db.query(GLSequence).filter(GLSequence.tenant_id == tenant_id, GLSequence.name == name).with_for_update().one()


def _next_journal_no(db: Session, tenant_id: str, posting_date: date) -> str:
    seq = _locked_sequence(db, tenant_id, f"journal:{posting_date.year}")
    seq.last_value += 1
    return f"JV-{posting_date.year}-{seq.last_value:06d}"


# ─────────────────────────────── audit chain ────────────────────────────


def append_audit(db: Session, tenant_id: str, *, event_type: str, entity_type: str, entity_id: str | None, actor: str, payload: dict) -> GLAuditEvent:
    head = _locked_sequence(db, tenant_id, "audit")
    head.last_value += 1
    prev_hash = head.last_hash or GENESIS_HASH
    created_at = _now()
    body = {
        "seq": head.last_value,
        "event_type": event_type,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "actor": actor,
        "payload": payload,
        "created_at": created_at.isoformat(),
    }
    digest = hashlib.sha256((prev_hash + _canonical(body)).encode("utf-8")).hexdigest()
    event = GLAuditEvent(
        tenant_id=tenant_id,
        seq=head.last_value,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        actor=actor,
        payload=_canonical(payload),
        prev_hash=prev_hash,
        hash=digest,
        created_at=created_at,
    )
    head.last_hash = digest
    db.add(event)
    return event


def verify_audit_chain(db: Session, tenant_id: str) -> dict:
    """Recompute the hash chain. Returns the first broken sequence number, if any."""
    prev = GENESIS_HASH
    count = 0
    for row in db.query(GLAuditEvent).filter(GLAuditEvent.tenant_id == tenant_id).order_by(GLAuditEvent.seq.asc()).yield_per(500):
        count += 1
        body = {
            "seq": row.seq,
            "event_type": row.event_type,
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "actor": row.actor,
            "payload": json.loads(row.payload),
            "created_at": row.created_at.isoformat(),
        }
        expected = hashlib.sha256((prev + _canonical(body)).encode("utf-8")).hexdigest()
        if row.seq != count or row.prev_hash != prev or row.hash != expected:
            return {"valid": False, "events_checked": count, "broken_at_seq": row.seq}
        prev = row.hash
    return {"valid": True, "events_checked": count, "broken_at_seq": None}


# ─────────────────────────────── chart of accounts ──────────────────────


def ensure_chart(db: Session, tenant_id: str, actor: str = "system") -> dict[str, GLAccount]:
    """Idempotently seed the AMHP chart for a tenant. Returns accounts by code."""
    existing = {row.code: row for row in db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id).all()}
    parent_codes = {d.parent for d in AMHP_ACCOUNTS if d.parent}
    created: list[str] = []
    for defn in AMHP_ACCOUNTS:  # parents are listed before children
        if defn.code in existing:
            continue
        parent = existing.get(defn.parent) if defn.parent else None
        account = GLAccount(
            tenant_id=tenant_id,
            code=defn.code,
            name=defn.name,
            parent_id=parent.id if parent else None,
            account_class=account_class(defn.code),
            account_type=defn.account_type,
            normal_side=normal_side(defn),
            is_postable=defn.code not in parent_codes,
            system_role=defn.system_role,
            allow_negative=defn.allow_negative,
            requires_partner=defn.requires_partner,
            currency="AZN",
            is_system=True,
            is_active=True,
        )
        db.add(account)
        db.flush()
        existing[defn.code] = account
        created.append(defn.code)
    if created:
        append_audit(db, tenant_id, event_type="CHART_SEEDED", entity_type="chart", entity_id=None, actor=actor, payload={"created": created})
    return existing


def accounts_by_role(db: Session, tenant_id: str) -> dict[str, GLAccount]:
    rows = db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id, GLAccount.system_role.isnot(None)).all()
    by_role = {row.system_role: row for row in rows}
    missing = REQUIRED_ROLES - set(by_role)
    if missing:
        raise GLError(f"Chart of accounts is not initialised (missing roles: {', '.join(sorted(missing))})", "chart_missing")
    return by_role


def create_subaccount(db: Session, tenant_id: str, *, parent_code: str, code: str, name: str, actor: str, allow_negative: bool = True) -> GLAccount:
    """Tenant-defined subaccount (e.g. 223.2 second bank). Parent becomes a header account."""
    parent = db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id, GLAccount.code == parent_code).with_for_update().first()
    if not parent:
        raise GLError(f"Parent account {parent_code} not found", "account_not_found", 404)
    code = str(code or "").strip()
    if not code.startswith(parent.code + ".") or len(code) > 20:
        raise GLError(f"Subaccount code must start with '{parent.code}.'", "invalid_account_code")
    if parent.is_postable:
        has_lines = db.query(GLJournalLine.id).filter(GLJournalLine.tenant_id == tenant_id, GLJournalLine.account_id == parent.id).first()
        if has_lines or parent.system_role:
            raise GLError("Account already has postings or a system role; subaccounts cannot be added under it", "parent_in_use", 409)
    if db.query(GLAccount.id).filter(GLAccount.tenant_id == tenant_id, GLAccount.code == code).first():
        raise GLError(f"Account {code} already exists", "duplicate_account", 409)
    account = GLAccount(
        tenant_id=tenant_id,
        code=code,
        name=str(name or "").strip()[:160] or code,
        parent_id=parent.id,
        account_class=parent.account_class,
        account_type=parent.account_type,
        normal_side=parent.normal_side,
        is_postable=True,
        system_role=None,
        allow_negative=allow_negative,
        requires_partner=parent.requires_partner,
        currency=parent.currency,
        is_system=False,
        is_active=True,
    )
    parent.is_postable = False
    db.add(account)
    db.flush()
    append_audit(db, tenant_id, event_type="ACCOUNT_CREATED", entity_type="account", entity_id=account.id, actor=actor, payload={"code": code, "name": account.name, "parent": parent.code})
    return account


# ─────────────────────────────── periods ────────────────────────────────


def get_or_create_period(db: Session, tenant_id: str, on_date: date) -> GLFiscalPeriod:
    query = db.query(GLFiscalPeriod).filter(
        GLFiscalPeriod.tenant_id == tenant_id, GLFiscalPeriod.year == on_date.year, GLFiscalPeriod.month == on_date.month
    )
    period = query.first()
    if period:
        return period
    last_day = calendar.monthrange(on_date.year, on_date.month)[1]
    try:
        with db.begin_nested():
            db.add(
                GLFiscalPeriod(
                    tenant_id=tenant_id,
                    year=on_date.year,
                    month=on_date.month,
                    start_date=date(on_date.year, on_date.month, 1),
                    end_date=date(on_date.year, on_date.month, last_day),
                    status="open",
                )
            )
    except IntegrityError:
        pass
    return query.one()


def _assert_period_postable(period: GLFiscalPeriod, *, allow_soft_closed: bool) -> None:
    if period.status == "closed":
        raise GLError(f"Period {period.year}-{period.month:02d} is closed", "period_closed", 409)
    if period.status == "soft_closed" and not allow_soft_closed:
        raise GLError(f"Period {period.year}-{period.month:02d} is soft-closed; controller approval required", "period_soft_closed", 409)


def set_period_status(db: Session, tenant_id: str, *, year: int, month: int, status: str, actor: str, reason: str | None = None) -> GLFiscalPeriod:
    if status not in {"open", "soft_closed", "closed"}:
        raise GLError("Invalid period status", "invalid_status")
    period = get_or_create_period(db, tenant_id, date(year, month, 1))
    period = db.query(GLFiscalPeriod).filter(GLFiscalPeriod.id == period.id).with_for_update().one()
    previous = period.status
    if previous == status:
        return period
    if status in {"soft_closed", "closed"}:
        pending = (
            db.query(func.count(GLJournal.id))
            .filter(GLJournal.tenant_id == tenant_id, GLJournal.period_id == period.id, GLJournal.status.in_(["draft", "pending_approval"]))
            .scalar()
        )
        if pending:
            raise GLError(f"{pending} draft/pending journal(s) must be posted or rejected before closing", "period_has_pending", 409)
        if status == "closed":
            earlier_open = (
                db.query(func.count(GLFiscalPeriod.id))
                .filter(
                    GLFiscalPeriod.tenant_id == tenant_id,
                    GLFiscalPeriod.status != "closed",
                    (GLFiscalPeriod.year * 100 + GLFiscalPeriod.month) < (year * 100 + month),
                )
                .scalar()
            )
            if earlier_open:
                raise GLError("Earlier periods must be closed first", "earlier_period_open", 409)
    else:  # reopening
        if not reason:
            raise GLError("A reason is required to reopen a period", "reason_required")
        later_closed = (
            db.query(func.count(GLFiscalPeriod.id))
            .filter(
                GLFiscalPeriod.tenant_id == tenant_id,
                GLFiscalPeriod.status == "closed",
                (GLFiscalPeriod.year * 100 + GLFiscalPeriod.month) > (year * 100 + month),
            )
            .scalar()
        )
        if later_closed:
            raise GLError("Later closed periods must be reopened first", "later_period_closed", 409)
    period.status = status
    if status == "open":
        period.closed_by = None
        period.closed_at = None
    else:
        period.closed_by = actor
        period.closed_at = _now()
    append_audit(
        db,
        tenant_id,
        event_type="PERIOD_STATUS_CHANGED",
        entity_type="period",
        entity_id=period.id,
        actor=actor,
        payload={"year": year, "month": month, "from": previous, "to": status, "reason": reason},
    )
    return period


# ─────────────────────────────── journals ───────────────────────────────


@dataclass
class LineIn:
    """A journal line. ``account`` may be a system role, an account code or an account id."""

    account: str
    debit: Decimal | str | int | float = ZERO
    credit: Decimal | str | int | float = ZERO
    memo: str | None = None
    partner_type: str | None = None
    partner_id: str | None = None
    tax_code: str | None = None
    branch_id: str | None = None


@dataclass
class _ResolvedLine:
    account: GLAccount
    debit: Decimal
    credit: Decimal
    source: LineIn = field(repr=False)


def _resolve_account(db: Session, tenant_id: str, ref: str, cache: dict[str, GLAccount]) -> GLAccount:
    ref = str(ref or "").strip()
    if ref in cache:
        return cache[ref]
    account = (
        db.query(GLAccount)
        .filter(GLAccount.tenant_id == tenant_id)
        .filter((GLAccount.system_role == ref) | (GLAccount.code == ref) | (GLAccount.id == ref))
        .first()
    )
    if not account:
        raise GLError(f"Unknown account: {ref}", "account_not_found", 404)
    if not account.is_active:
        raise GLError(f"Account {account.code} is inactive", "account_inactive")
    if not account.is_postable:
        raise GLError(f"Account {account.code} is a header account and cannot be posted to", "account_not_postable")
    cache[ref] = account
    return account


def _validate_lines(db: Session, tenant_id: str, lines: list[LineIn]) -> tuple[list[_ResolvedLine], Decimal]:
    if len(lines) < 2:
        raise GLError("A journal needs at least two lines", "too_few_lines")
    cache: dict[str, GLAccount] = {}
    resolved: list[_ResolvedLine] = []
    total_debit = ZERO
    total_credit = ZERO
    for idx, line in enumerate(lines, start=1):
        debit = money(line.debit)
        credit = money(line.credit)
        if debit < 0 or credit < 0:
            raise GLError(f"Line {idx}: amounts cannot be negative", "negative_amount")
        if (debit > 0) == (credit > 0):
            raise GLError(f"Line {idx}: exactly one of debit/credit must be > 0", "invalid_line")
        account = _resolve_account(db, tenant_id, line.account, cache)
        if account.requires_partner and not line.partner_id:
            raise GLError(f"Line {idx}: account {account.code} requires a partner", "partner_required")
        resolved.append(_ResolvedLine(account=account, debit=debit, credit=credit, source=line))
        total_debit += debit
        total_credit += credit
    if total_debit != total_credit:
        raise GLError(f"Journal is not balanced: debit {total_debit} ≠ credit {total_credit}", "unbalanced")
    return resolved, total_debit


@dataclass(frozen=True)
class MigrationMeta:
    """Historic metadata for journals imported from the legacy ledger.

    Only the migration job may pass this. It preserves who/when from the
    original record and skips the non-negative cash guard, because the legacy
    history is already a fact (it may contain moments where a drawer dipped
    below zero). All other invariants (balance, period, idempotency) still apply.
    """

    created_by: str
    created_at: datetime
    posted_by: str | None = None
    posted_at: datetime | None = None
    approved_by: str | None = None
    approved_at: datetime | None = None


def create_journal(
    db: Session,
    *,
    tenant_id: str,
    journal_type: str,
    lines: list[LineIn],
    created_by: str,
    posting_date: date | None = None,
    description: str | None = None,
    source_module: str | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
    idempotency_key: str | None = None,
    branch_id: str | None = None,
    legacy_ref: str | None = None,
    require_approval: bool = False,
    allow_soft_closed: bool = False,
    reversal_of_id: str | None = None,
    migration: MigrationMeta | None = None,
) -> GLJournal:
    """Validate and persist a journal. Posts immediately unless ``require_approval``.

    Idempotent: a repeated ``idempotency_key`` returns the original journal
    (and fails loudly if the new request would produce different amounts).
    """
    if journal_type not in JOURNAL_TYPES:
        raise GLError(f"Unknown journal type: {journal_type}", "invalid_journal_type")
    if migration is not None and require_approval:
        raise GLError("Migrated journals are imported as posted", "invalid_migration")
    posting_date = posting_date or business_today()
    resolved, total = _validate_lines(db, tenant_id, lines)

    if idempotency_key:
        existing = db.query(GLJournal).filter(GLJournal.tenant_id == tenant_id, GLJournal.idempotency_key == idempotency_key).first()
        if existing:
            if Decimal(str(existing.total_debit)) != total:
                raise GLError("Idempotency key reused with a different amount", "idempotency_conflict", 409)
            return existing

    period = get_or_create_period(db, tenant_id, posting_date)
    _assert_period_postable(period, allow_soft_closed=allow_soft_closed)
    # A closed fiscal year only accepts its own closing entries (and their reversal on reopen).
    if source_type != YEAR_CLOSE_SOURCE and posting_date.year < business_today().year and active_year_close(db, tenant_id, posting_date.year):
        raise GLError(f"Fiscal year {posting_date.year} is closed; reopen it or post in the current year", "year_closed", 409)

    journal = GLJournal(
        tenant_id=tenant_id,
        journal_type=journal_type,
        status="draft",
        posting_date=posting_date,
        period_id=period.id,
        branch_id=branch_id,
        currency="AZN",
        description=(description or "")[:2000] or None,
        source_module=source_module,
        source_type=source_type,
        source_id=str(source_id) if source_id is not None else None,
        idempotency_key=idempotency_key,
        legacy_ref=legacy_ref,
        reversal_of_id=reversal_of_id,
        total_debit=total,
        total_credit=total,
        created_by=migration.created_by if migration else created_by,
        created_at=migration.created_at if migration else _now(),
        approved_by=migration.approved_by if migration else None,
        approved_at=migration.approved_at if migration else None,
    )
    try:
        with db.begin_nested():
            db.add(journal)
            db.flush()
    except IntegrityError:
        # Concurrent request with the same idempotency key won the race.
        if idempotency_key:
            winner = db.query(GLJournal).filter(GLJournal.tenant_id == tenant_id, GLJournal.idempotency_key == idempotency_key).first()
            if winner:
                return winner
        raise

    if not require_approval and migration is None:
        # Take the guarded-account locks BEFORE inserting the lines: the lines' FK checks take
        # KEY SHARE on gl_accounts, and two postings that both hold it and then ask for FOR UPDATE
        # (in _post) deadlock on PostgreSQL. Locking first makes the second posting wait instead.
        _lock_guarded_account_ids(db, tenant_id, [line.account.id for line in resolved])

    for no, line in enumerate(resolved, start=1):
        db.add(
            GLJournalLine(
                tenant_id=tenant_id,
                journal_id=journal.id,
                line_no=no,
                account_id=line.account.id,
                debit=line.debit,
                credit=line.credit,
                currency="AZN",
                branch_id=line.source.branch_id or branch_id,
                partner_type=line.source.partner_type,
                partner_id=line.source.partner_id,
                tax_code=line.source.tax_code,
                memo=(line.source.memo or "")[:1000] or None,
            )
        )
    db.flush()

    if require_approval:
        journal.status = "pending_approval"
        append_audit(
            db, tenant_id, event_type="JOURNAL_SUBMITTED", entity_type="journal", entity_id=journal.id, actor=created_by,
            payload={"journal_type": journal_type, "amount": str(total), "posting_date": posting_date.isoformat()},
        )
        return journal
    return _post(db, journal, actor=created_by, allow_soft_closed=allow_soft_closed, migration=migration)


def _journal_lines(db: Session, journal: GLJournal) -> list[GLJournalLine]:
    return db.query(GLJournalLine).filter(GLJournalLine.journal_id == journal.id).order_by(GLJournalLine.line_no.asc()).all()


def _apply_balances(db: Session, journal: GLJournal, lines: list[GLJournalLine]) -> None:
    deltas: dict[tuple[str, str], list[Decimal]] = {}
    for line in lines:
        key = (line.account_id, line.branch_id or "")
        bucket = deltas.setdefault(key, [ZERO, ZERO])
        bucket[0] += Decimal(str(line.debit))
        bucket[1] += Decimal(str(line.credit))
    # Deterministic lock order avoids deadlocks between concurrent postings.
    for (account_id, branch_key) in sorted(deltas):
        debit, credit = deltas[(account_id, branch_key)]
        query = db.query(GLAccountBalance).filter(
            GLAccountBalance.tenant_id == journal.tenant_id,
            GLAccountBalance.account_id == account_id,
            GLAccountBalance.period_id == journal.period_id,
            GLAccountBalance.branch_key == branch_key,
        )
        row = query.with_for_update().first()
        if not row:
            try:
                with db.begin_nested():
                    db.add(
                        GLAccountBalance(
                            tenant_id=journal.tenant_id, account_id=account_id, period_id=journal.period_id,
                            branch_key=branch_key, debit_total=ZERO, credit_total=ZERO,
                        )
                    )
            except IntegrityError:
                pass
            row = query.with_for_update().one()
        row.debit_total = Decimal(str(row.debit_total)) + debit
        row.credit_total = Decimal(str(row.credit_total)) + credit
        row.updated_at = _now()


def account_balance(db: Session, tenant_id: str, account: GLAccount, *, as_of_period: GLFiscalPeriod | None = None) -> Decimal:
    """Signed balance in the account's normal direction, from materialized balances."""
    query = db.query(
        func.coalesce(func.sum(GLAccountBalance.debit_total), 0),
        func.coalesce(func.sum(GLAccountBalance.credit_total), 0),
    ).filter(GLAccountBalance.tenant_id == tenant_id, GLAccountBalance.account_id == account.id)
    if as_of_period is not None:
        query = query.join(GLFiscalPeriod, GLFiscalPeriod.id == GLAccountBalance.period_id).filter(
            (GLFiscalPeriod.year * 100 + GLFiscalPeriod.month) <= (as_of_period.year * 100 + as_of_period.month)
        )
    debit, credit = query.one()
    debit, credit = Decimal(str(debit or 0)), Decimal(str(credit or 0))
    return (debit - credit if account.normal_side == "debit" else credit - debit).quantize(CENT)


def _lock_guarded_account_ids(db: Session, tenant_id: str, account_ids) -> list[GLAccount]:
    """Row-lock (id order) the non-negative (cash-like) accounts among ``account_ids``."""
    return (
        db.query(GLAccount)
        .filter(GLAccount.tenant_id == tenant_id, GLAccount.id.in_(sorted(set(account_ids))), GLAccount.allow_negative.is_(False))
        .order_by(GLAccount.id.asc())
        .with_for_update()
        .all()
    )


def _lock_guarded_accounts(db: Session, journal: GLJournal, lines: list[GLJournalLine]) -> list[GLAccount]:
    """Lock non-negative (cash-like) accounts *before* touching balances so that
    concurrent postings on the same drawer are fully serialized."""
    return _lock_guarded_account_ids(db, journal.tenant_id, [line.account_id for line in lines])


def _check_non_negative(db: Session, journal: GLJournal, lines: list[GLJournalLine], guarded: list[GLAccount]) -> None:
    for account in guarded:
        # Only block journals that *decrease* the account; a deposit into an
        # already-negative drawer (e.g. migrated legacy data) must still post.
        effect = ZERO
        for line in lines:
            if line.account_id == account.id:
                delta = Decimal(str(line.debit)) - Decimal(str(line.credit))
                effect += delta if account.normal_side == "debit" else -delta
        if effect >= 0:
            continue
        balance = account_balance(db, journal.tenant_id, account)
        if balance < 0:
            raise GLError(
                f"Insufficient balance on {account.code} {account.name} (would be {balance} AZN)",
                "insufficient_balance",
                409,
            )


def _post(db: Session, journal: GLJournal, *, actor: str, allow_soft_closed: bool, migration: MigrationMeta | None = None) -> GLJournal:
    period = db.query(GLFiscalPeriod).filter(GLFiscalPeriod.id == journal.period_id).with_for_update(read=True).one()
    _assert_period_postable(period, allow_soft_closed=allow_soft_closed)
    lines = _journal_lines(db, journal)
    total_debit = sum((Decimal(str(line.debit)) for line in lines), ZERO)
    total_credit = sum((Decimal(str(line.credit)) for line in lines), ZERO)
    if len(lines) < 2 or total_debit != total_credit or total_debit != Decimal(str(journal.total_debit)):
        raise GLError("Journal lines are inconsistent with header totals", "unbalanced")
    guarded = _lock_guarded_accounts(db, journal, lines) if migration is None else []
    _apply_balances(db, journal, lines)
    db.flush()
    if migration is None:
        _check_non_negative(db, journal, lines, guarded)
    journal.journal_no = _next_journal_no(db, journal.tenant_id, journal.posting_date)
    journal.status = "posted"
    journal.posted_by = (migration.posted_by or migration.created_by) if migration else actor
    journal.posted_at = (migration.posted_at or migration.created_at) if migration else _now()
    db.flush()
    payload = {
        "journal_no": journal.journal_no,
        "journal_type": journal.journal_type,
        "posting_date": journal.posting_date.isoformat(),
        "amount": str(total_debit),
        "source": [journal.source_type, journal.source_id],
        "lines": [[line.account_id, str(line.debit), str(line.credit)] for line in lines],
    }
    if migration is not None:
        payload["migrated_from"] = journal.legacy_ref
        payload["original_posted_by"] = journal.posted_by
    append_audit(db, journal.tenant_id, event_type="JOURNAL_MIGRATED" if migration else "JOURNAL_POSTED",
                 entity_type="journal", entity_id=journal.id, actor=actor, payload=payload)
    return journal


def _locked_journal(db: Session, tenant_id: str, journal_id: str) -> GLJournal:
    journal = db.query(GLJournal).filter(GLJournal.tenant_id == tenant_id, GLJournal.id == journal_id).with_for_update().first()
    if not journal:
        raise GLError("Journal not found", "journal_not_found", 404)
    return journal


def approve_journal(db: Session, tenant_id: str, journal_id: str, *, approver: str, allow_soft_closed: bool = False) -> GLJournal:
    journal = _locked_journal(db, tenant_id, journal_id)
    if journal.status != "pending_approval":
        raise GLError(f"Journal is not pending approval (status: {journal.status})", "invalid_status", 409)
    if str(journal.created_by or "").strip().lower() == str(approver or "").strip().lower():
        # Maker-checker is absolute: no role can approve its own journal.
        append_audit(db, tenant_id, event_type="SELF_APPROVAL_BLOCKED", entity_type="journal", entity_id=journal.id, actor=approver, payload={})
        raise GLError("You cannot approve a journal you created", "self_approval", 403)
    journal.approved_by = approver
    journal.approved_at = _now()
    append_audit(db, tenant_id, event_type="JOURNAL_APPROVED", entity_type="journal", entity_id=journal.id, actor=approver, payload={})
    _post(db, journal, actor=approver, allow_soft_closed=allow_soft_closed)
    link_reversal_on_approval(db, journal)
    return journal


def reject_journal(db: Session, tenant_id: str, journal_id: str, *, actor: str, reason: str) -> GLJournal:
    journal = _locked_journal(db, tenant_id, journal_id)
    if journal.status != "pending_approval":
        raise GLError(f"Journal is not pending approval (status: {journal.status})", "invalid_status", 409)
    if not str(reason or "").strip():
        raise GLError("A rejection reason is required", "reason_required")
    journal.status = "rejected"
    journal.rejected_by = actor
    journal.rejected_at = _now()
    journal.reject_reason = reason.strip()[:2000]
    append_audit(db, tenant_id, event_type="JOURNAL_REJECTED", entity_type="journal", entity_id=journal.id, actor=actor, payload={"reason": journal.reject_reason})
    return journal


def reverse_journal(
    db: Session,
    tenant_id: str,
    journal_id: str,
    *,
    actor: str,
    reason: str,
    posting_date: date | None = None,
    require_approval: bool = False,
    allow_soft_closed: bool = False,
) -> GLJournal:
    """Storno: a new journal with debit/credit swapped. The original stays untouched
    except for the ``reversed_by_id`` link. If the original's period is closed the
    reversal is dated today (in the current open period), as auditors expect."""
    original = _locked_journal(db, tenant_id, journal_id)
    if original.status != "posted":
        raise GLError("Only posted journals can be reversed", "invalid_status", 409)
    if original.reversal_of_id:
        raise GLError("A reversal journal cannot itself be reversed; post a new journal instead", "reverse_of_reversal", 409)
    if original.reversed_by_id:
        raise GLError("Journal is already reversed", "already_reversed", 409)
    if not str(reason or "").strip():
        raise GLError("A reversal reason is required", "reason_required")
    prior = db.query(GLJournal).filter(GLJournal.tenant_id == tenant_id, GLJournal.reversal_of_id == original.id).all()
    if any(row.status in {"draft", "pending_approval", "posted"} for row in prior):
        raise GLError("A reversal for this journal is already pending or posted", "reversal_pending", 409)
    original_period = db.query(GLFiscalPeriod).filter(GLFiscalPeriod.id == original.period_id).one()
    if posting_date is None:
        posting_date = original.posting_date if original_period.status == "open" else business_today()
    lines = [
        LineIn(
            account=line.account_id,
            debit=Decimal(str(line.credit)),
            credit=Decimal(str(line.debit)),
            memo=line.memo,
            partner_type=line.partner_type,
            partner_id=line.partner_id,
            tax_code=line.tax_code,
            branch_id=line.branch_id,
        )
        for line in _journal_lines(db, original)
    ]
    reversal = create_journal(
        db,
        tenant_id=tenant_id,
        journal_type="reversal",
        lines=lines,
        created_by=actor,
        posting_date=posting_date,
        description=f"Storno {original.journal_no}: {reason.strip()[:500]}",
        source_module=original.source_module,
        source_type=original.source_type,
        source_id=original.source_id,
        # Suffix allows a new request after an earlier reversal was rejected.
        idempotency_key=f"reversal:{original.id}:{len(prior) + 1}",
        branch_id=original.branch_id,
        require_approval=require_approval,
        allow_soft_closed=allow_soft_closed,
        reversal_of_id=original.id,
    )
    if reversal.status == "posted":
        original.reversed_by_id = reversal.id
    db.flush()
    return reversal


def link_reversal_on_approval(db: Session, journal: GLJournal) -> None:
    """After a pending reversal is approved/posted, link the original to it."""
    if journal.status == "posted" and journal.reversal_of_id:
        original = db.query(GLJournal).filter(GLJournal.id == journal.reversal_of_id).with_for_update().one()
        if original.reversed_by_id and original.reversed_by_id != journal.id:
            raise GLError("Original journal is already reversed", "already_reversed", 409)
        original.reversed_by_id = journal.id
        db.flush()
