"""Bridge between live POS flows and native GL posting (P2b).

Per-tenant ledger mode (Setting ``finance_v2_ledger_mode``):

* ``legacy`` (default) — nothing here does anything. The shadow job mirrors
  the legacy ledger into the GL as before.
* ``dual`` — hooked flows *also* post a native compound journal via the
  posting rules, inside the same DB transaction as the sale. The legacy
  postings made in that flow are linked to the native journal (and therefore
  skipped by the shadow job). Flows without a hook keep being mirrored by the
  shadow job, so the GL is always complete.

Safety contract: ``emit`` never raises. A native posting failure rolls back
only its own savepoint, is recorded in ``gl_shadow_runs`` (run_type
``native_error``) and leaves the legacy postings uncovered, so the shadow job
mirrors them instead. A sale can never fail because of the GL.

How coverage works: ``finance_service.post_existing_transaction`` appends every
posted legacy transaction id to ``db.info[PENDING_KEY]``. ``emit`` claims all
pending ids for the journal it posts. Hooks therefore call ``emit`` right after
the legacy postings of the same business event.
"""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Callable

from sqlalchemy import event as sa_event
from sqlalchemy.orm import Session

from app.gl import engine as gl
from app.gl.coa_az import LEGACY_CODE_TO_ROLE
from app.gl.models import GLAccount, GLJournal, GLJournalLine, GLLegacyLink, GLShadowRun
from app.gl.posting_rules import post_event
from app.models import FinanceAccount, FinanceLedgerEntry, Setting

logger = logging.getLogger("ironwaves.gl_bridge")

MODE_SETTING_KEY = "finance_v2_ledger_mode"
LEDGER_MODES = ("legacy", "dual")
PENDING_KEY = "gl_pending_legacy_txn_ids"
# Legacy wallet/balance-sheet codes whose balances must reconcile (with explained diffs).
WALLET_CODES = ("cash", "card", "safe", "deposit", "investor", "payable", "debt", "inventory_asset")
ROLE_TO_LEGACY_CODE = {role: code for code, role in LEGACY_CODE_TO_ROLE.items() if code in WALLET_CODES}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ─────────────────────────────── mode ───────────────────────────────────


def get_ledger_mode(db: Session, tenant_id: str) -> str:
    row = db.query(Setting.value).filter(Setting.tenant_id == tenant_id, Setting.key == MODE_SETTING_KEY).first()
    if not row or not row[0]:
        return "legacy"
    try:
        mode = str(json.loads(row[0]).get("mode") or "legacy")
    except Exception:
        return "legacy"
    return mode if mode in LEDGER_MODES else "legacy"


def set_ledger_mode(db: Session, tenant_id: str, mode: str, *, actor: str, reason: str) -> dict:
    """Switch a tenant between ``legacy`` and ``dual``. Audited in the GL chain."""
    if mode not in LEDGER_MODES:
        raise gl.GLError(f"Unknown ledger mode: {mode}", "invalid_mode")
    if not str(reason or "").strip():
        raise gl.GLError("A reason is required to change the ledger mode", "reason_required")
    gl.accounts_by_role(db, tenant_id)  # chart must exist (created by migration/shadow)
    previous = get_ledger_mode(db, tenant_id)
    value = json.dumps({"mode": mode, "since": _utcnow().isoformat(), "by": actor}, ensure_ascii=False)
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == MODE_SETTING_KEY).first()
    if row:
        row.value = value
    else:
        db.add(Setting(tenant_id=tenant_id, key=MODE_SETTING_KEY, value=value))
    gl.append_audit(db, tenant_id, event_type="LEDGER_MODE_CHANGED", entity_type="tenant", entity_id=tenant_id, actor=actor,
                    payload={"from": previous, "to": mode, "reason": reason})
    db.flush()
    return {"tenant_id": tenant_id, "from": previous, "to": mode}


# ─────────────────────────────── capture ────────────────────────────────


def record_legacy_posting(db: Session, legacy_txn_id: str) -> None:
    """Called by the legacy posting engine for every posted transaction."""
    info = getattr(db, "info", None)
    if isinstance(info, dict):
        info.setdefault(PENDING_KEY, []).append(legacy_txn_id)


def _take_pending(db: Session) -> list[str]:
    info = getattr(db, "info", None)
    if not isinstance(info, dict):
        return []
    pending = list(info.get(PENDING_KEY) or [])
    info[PENDING_KEY] = []
    return pending


def discard_pending(db: Session) -> None:
    _take_pending(db)


@sa_event.listens_for(Session, "after_transaction_end")
def _clear_pending_on_transaction_end(session, transaction) -> None:
    """Pending ids only make sense inside the DB transaction that produced them.

    After commit they are durable but unclaimed (the shadow job mirrors them);
    after rollback they no longer exist. Either way they must not be claimed by a
    native journal posted later in the same session. Savepoints are ignored.
    """
    if transaction.parent is None and not transaction.nested:
        info = getattr(session, "info", None)
        if isinstance(info, dict) and info.get(PENDING_KEY):
            info[PENDING_KEY] = []


# ─────────────────────────────── wallet diff ────────────────────────────


def _native_wallet_delta(db: Session, journal_ids: list[str]) -> dict[str, Decimal]:
    rows = (
        db.query(GLAccount.system_role, GLJournalLine.debit, GLJournalLine.credit)
        .join(GLAccount, GLAccount.id == GLJournalLine.account_id)
        .filter(GLJournalLine.journal_id.in_(journal_ids))
        .all()
    )
    out: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for role, debit, credit in rows:
        code = ROLE_TO_LEGACY_CODE.get(role or "")
        if code:
            out[code] += Decimal(str(debit)) - Decimal(str(credit))
    return out


def _legacy_wallet_delta(db: Session, tenant_id: str, legacy_ids: list[str]) -> dict[str, Decimal]:
    out: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    if not legacy_ids:
        return out
    rows = (
        db.query(FinanceAccount.code, FinanceLedgerEntry.entry_side, FinanceLedgerEntry.amount)
        .join(FinanceAccount, FinanceAccount.id == FinanceLedgerEntry.account_id)
        .filter(FinanceLedgerEntry.tenant_id == tenant_id, FinanceLedgerEntry.transaction_id.in_(legacy_ids))
        .all()
    )
    for code, side, amount in rows:
        if code in WALLET_CODES:
            out[code] += Decimal(str(amount)) if side == "debit" else -Decimal(str(amount))
    return out


def _wallet_diff(db: Session, tenant_id: str, journal_ids: list[str], legacy_ids: list[str]) -> dict[str, str]:
    native = _native_wallet_delta(db, journal_ids)
    legacy = _legacy_wallet_delta(db, tenant_id, legacy_ids)
    diff = {}
    for code in set(native) | set(legacy):
        delta = (native.get(code, Decimal("0")) - legacy.get(code, Decimal("0"))).quantize(Decimal("0.01"))
        if delta:
            diff[code] = str(delta)
    return diff


# ─────────────────────────────── emit ───────────────────────────────────


def emit(db: Session, tenant_id: str, event_or_factory, *, actor: str, event_type: str | None = None) -> GLJournal | None:
    """Post a native journal for a business event in dual mode. Never raises.

    ``event_or_factory`` is either a posting-rule event or — preferred at call
    sites — a zero-arg callable that *builds* the event (or posts and returns
    journal(s), e.g. for voids). With a callable, nothing is evaluated in legacy
    mode, and any error while building the event is contained here too.
    """
    covered = _take_pending(db)
    try:
        if get_ledger_mode(db, tenant_id) != "dual":
            return None
    except Exception:  # never let the mode lookup break a sale
        logger.exception("gl_bridge: ledger mode lookup failed tenant=%s", tenant_id)
        return None
    name = event_type or (type(event_or_factory).__name__ if hasattr(event_or_factory, "spec") else "action")
    try:
        with db.begin_nested():
            obj = event_or_factory
            if not hasattr(obj, "spec") and callable(obj):
                obj = obj()
            if hasattr(obj, "spec"):
                name = event_type or type(obj).__name__
                result = post_event(db, tenant_id, obj, actor=actor)
            else:
                result = obj
            journals = [j for j in (result if isinstance(result, (list, tuple)) else [result]) if j is not None]
            if not journals:
                return None
            primary = journals[0]
            already: set[str] = set()
            if covered:  # never claim what is already covered or already mirrored
                already |= {row[0] for row in db.query(GLLegacyLink.legacy_txn_id).filter(
                    GLLegacyLink.tenant_id == tenant_id, GLLegacyLink.legacy_txn_id.in_(covered)).all()}
                already |= {row[0] for row in db.query(GLJournal.legacy_ref).filter(
                    GLJournal.tenant_id == tenant_id, GLJournal.legacy_ref.in_(covered)).all()}
            fresh = [lid for lid in covered if lid not in already]
            diff = _wallet_diff(db, tenant_id, [j.id for j in journals], fresh) if fresh else {}
            for lid in fresh:
                db.add(GLLegacyLink(tenant_id=tenant_id, legacy_txn_id=lid, journal_id=primary.id, event_type=name,
                                    wallet_diff=json.dumps(diff) if diff and lid == fresh[0] else None))
            db.flush()
        return primary
    except Exception as exc:
        logger.error("gl_bridge: native posting failed tenant=%s event=%s: %s", tenant_id, name, exc)
        try:
            db.add(GLShadowRun(tenant_id=tenant_id, run_type="native_error", started_at=_utcnow(), finished_at=_utcnow(),
                               imported=0, ok=False, error=f"{name}: {exc}"[:4000],
                               details=json.dumps({"legacy_txn_ids": covered})))
            db.flush()
        except Exception:  # pragma: no cover
            logger.exception("gl_bridge: could not record native_error")
        try:  # best-effort admin alert; must never raise and never break the sale
            from app.gl import alerts

            alerts.raise_alert(db, tenant_id, alert_type="native_error", detail=f"{name}: {exc}"[:4000],
                               context={"legacy_txn_ids": covered})
            db.flush()
        except Exception:  # pragma: no cover
            logger.exception("gl_bridge: could not raise native_error alert")
        return None


# ─────────────────────────────── hook helpers ───────────────────────────


def _business_date_of(ts: datetime | None):
    from app.gl.legacy_migration import _business_date

    return _business_date(ts)


def emit_sale(
    db: Session,
    tenant_id: str,
    *,
    sale,
    payments: list[tuple[str, Decimal]],
    actor: str,
    card_fee_percent=Decimal("0"),
    deposit_applied=Decimal("0"),
    staff_benefit=Decimal("0"),
    branch_id: str | None = None,
) -> GLJournal | None:
    """Hook for every place that completes a Sale. Call after the legacy postings."""
    from app.gl.posting_rules import SaleCompleted, SalePayment

    def quant(value) -> Decimal:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"))

    def value(x):  # arguments may be zero-arg callables so call sites stay lazy
        return x() if callable(x) else x

    def build():
        return SaleCompleted(
            sale_id=sale.id,
            posting_date=_business_date_of(getattr(sale, "created_at", None)),
            payments=tuple(SalePayment(method, quant(amount)) for method, amount in value(payments) if quant(amount) > 0),
            deposit_applied=quant(value(deposit_applied)),
            staff_benefit=quant(value(staff_benefit)),
            discount=quant(getattr(sale, "discount_amount", 0)),
            card_fee_percent=Decimal(str(value(card_fee_percent) or 0)),
            cogs=Decimal(str(getattr(sale, "cogs", 0) or 0)).quantize(Decimal("0.01")),
            receipt_code=getattr(sale, "receipt_code", None),
            branch_id=branch_id,
        )

    return emit(db, tenant_id, build, actor=actor, event_type="SaleCompleted")
