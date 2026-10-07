"""Finance v2 tenant cut-over readiness check (Deliverable 2).

Reports a tenant's migration posture and computes the two go/no-go verdicts a
human (or ``scripts/gl_readiness.py``) uses to decide a cut-over step:

* ``can_switch_to_dual`` — safe to turn the native GL on alongside legacy
  (``bridge.set_ledger_mode(..., "dual")``). Besides the data checks it needs the two per-tenant WP-A settings to be
  *explicitly recorded* (``finance_v2_ui_visible``, ``finance_v2_require_supplier``): an operator must have decided,
  "absent" is not a decision. It also needs the history-aware reconciler selection to be wired for the tenant.
* ``can_switch_reports_to_gl`` — safe to serve the finance screens from the GL
  (``read_model.set_reports_source(..., "gl")``). It also prints ``explained_diff_review``: every non-zero explained
  parity difference with its amount, for a human to review (informational, never blocks).

Strictly **read-only**: it never writes to the DB. Some readers it reuses
(``read_model.gl_wallet_balances`` / ``parity_report``, the reconcilers) perform
a shadow catch-up inside a nested savepoint; ``readiness`` runs the whole
collection inside its own savepoint and rolls it back, so nothing — not even a
catch-up mirror — is ever persisted. Callers may ``db.rollback()`` afterwards
for belt-and-braces.

It only *reads* through existing modules (``bridge``, ``read_model``,
``shadow``, ``subledger``, ``legacy_migration``, ``engine``); it owns no
business logic of its own beyond composing their results into the verdicts.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.gl import bridge, engine as gl, legacy_migration, read_model, shadow, subledger
from app.gl.models import GLAccount, GLJournal, GLShadowRun

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
# Reconcile runs needed in a row before a cut-over is allowed.
MIN_CLEAN_STREAK = 2
# Window for counting native-posting errors.
NATIVE_ERROR_WINDOW_DAYS = 7


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _chart_present(db: Session, tenant_id: str) -> bool:
    return bool(db.query(GLAccount.id).filter(GLAccount.tenant_id == tenant_id).first())


def _native_error_count(db: Session, tenant_id: str, *, since: datetime) -> int:
    return int(
        db.query(func.count(GLShadowRun.id))
        .filter(GLShadowRun.tenant_id == tenant_id, GLShadowRun.run_type == "native_error", GLShadowRun.started_at >= since)
        .scalar()
        or 0
    )


def _pending_journals(db: Session, tenant_id: str) -> int:
    return int(
        db.query(func.count(GLJournal.id))
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.status.in_(("draft", "pending_approval")))
        .scalar()
        or 0
    )


def _negative_wallets(db: Session, tenant_id: str) -> list[dict]:
    """Guarded (``allow_negative=False``, i.e. cash-like) accounts whose balance is negative.

    A negative drawer/safe/bank balance means legacy and GL disagree about reality
    or a posting is wrong; it must be understood before cut-over.
    """
    out: list[dict] = []
    guarded = (
        db.query(GLAccount)
        .filter(GLAccount.tenant_id == tenant_id, GLAccount.allow_negative.is_(False), GLAccount.is_postable.is_(True))
        .order_by(GLAccount.code.asc())
        .all()
    )
    for account in guarded:
        balance = gl.account_balance(db, tenant_id, account)
        if balance < ZERO:
            out.append({"code": account.code, "name": account.name, "system_role": account.system_role, "balance": str(balance)})
    return out


def _shadow_sync_lag_seconds(status: dict, *, now: datetime) -> float | None:
    """Seconds since the last successful shadow sync finished, or ``None`` if never synced."""
    last_sync = status.get("last_sync")
    if not last_sync or not last_sync.get("at"):
        return None
    try:
        finished = datetime.fromisoformat(last_sync["at"])
    except ValueError:
        return None
    if finished.tzinfo is not None:
        finished = finished.astimezone(timezone.utc).replace(tzinfo=None)
    return max(0.0, (now - finished).total_seconds())


def _collect(db: Session, tenant_id: str) -> dict:
    now = _utcnow()
    ledger_mode = bridge.get_ledger_mode(db, tenant_id)
    is_dual = ledger_mode == "dual"
    reports_src = read_model.reports_source(db, tenant_id)
    chart_present = _chart_present(db, tenant_id)
    ever_dual = bridge.had_dual_history(db, tenant_id)

    shadow_status = shadow.shadow_status(db, tenant_id)
    clean_streak = int(shadow_status.get("clean_reconciliation_streak", 0))
    native_errors_7d = _native_error_count(db, tenant_id, since=now - timedelta(days=NATIVE_ERROR_WINDOW_DAYS))

    # Current independent reconciliation (dual vs single picked by ledger mode). Read-only.
    current_reconcile = None
    rollback_reconciler_verified = None  # None = nothing to verify (no chart, no reconciliation)
    parity = None
    open_items = None
    unassigned_ap = "0.00"
    negative_wallets: list[dict] = []
    pending_journals = 0
    if chart_present:
        # History-aware: a tenant that is dual now or ever was is judged by the dual reconciler (see legacy_migration).
        current_reconcile = legacy_migration.reconcile_for_tenant(db, tenant_id)
        # STRUCTURAL check: the reconciler the selection used is the one the tenant's history requires. It proves the
        # selection is wired, not that a future flip-back will be clean (the PG flip test covers that).
        rollback_reconciler_verified = (current_reconcile.get("reconciler") == "dual") == ever_dual
        if is_dual:
            parity = read_model.parity_report(db, tenant_id)
        open_items = legacy_migration.open_items(db, tenant_id)
        unassigned_ap = subledger.subledger(db, tenant_id, "ap")["unassigned_balance"]
        negative_wallets = _negative_wallets(db, tenant_id)
        pending_journals = _pending_journals(db, tenant_id)

    return {
        "tenant_id": tenant_id,
        "generated_at": now.isoformat(),
        "ledger_mode": ledger_mode,
        "reports_source": reports_src,
        "chart_present": chart_present,
        "clean_reconciliation_streak": clean_streak,
        "native_error_count_7d": native_errors_7d,
        "current_reconcile": current_reconcile,
        "ui_visible_setting": bridge.get_ui_visible_record(db, tenant_id),
        "require_supplier_setting": bridge.get_require_supplier_record(db, tenant_id),
        "ever_dual": ever_dual,
        "reconciler": "dual" if ever_dual else "single",
        "rollback_reconciler_verified": rollback_reconciler_verified,
        "parity": parity,
        "open_items": open_items,
        "pending_journals": pending_journals,
        "unassigned_ap": unassigned_ap,
        "negative_wallets": negative_wallets,
        "shadow": shadow_status,
        "shadow_sync_lag_seconds": _shadow_sync_lag_seconds(shadow_status, now=now),
    }


def _verdict_can_switch_to_dual(facts: dict) -> dict:
    """chart + current reconcile ok + clean streak >= 2 + zero native errors (7d) + both WP-A settings recorded
    + the history-aware reconciler selection verified."""
    reasons: list[str] = []
    tenant = facts["tenant_id"]
    if not facts["chart_present"]:
        reasons.append(
            "Chart of accounts is not initialised for this tenant. Run scripts/gl_ledger_mode.py --tenant "
            f"{tenant} --set dual (creates the chart and the first mirror) or scripts/gl_migrate_legacy.py --tenant {tenant}"
        )
    recon = facts["current_reconcile"]
    if recon is None:
        reasons.append("No reconciliation could be run (chart missing)")
    elif not recon.get("ok"):
        failed = [c["check"] for c in recon.get("checks", []) if not c.get("ok")]
        reasons.append(f"Current reconciliation is failing: {', '.join(failed) or 'unknown checks'}")
    if facts["clean_reconciliation_streak"] < MIN_CLEAN_STREAK:
        reasons.append(
            f"Clean reconciliation streak is {facts['clean_reconciliation_streak']}, need >= {MIN_CLEAN_STREAK}"
        )
    if facts["native_error_count_7d"] != 0:
        reasons.append(f"{facts['native_error_count_7d']} native posting error(s) in the last {NATIVE_ERROR_WINDOW_DAYS} days")
    if facts["ui_visible_setting"] is None:
        reasons.append(
            "finance_v2_ui_visible is not recorded for this tenant (hidden or visible are both fine, absent is not). "
            f'Run: python scripts/gl_ledger_mode.py --tenant {tenant} --ui hidden --reason "..."'
        )
    if facts["require_supplier_setting"] is None:
        reasons.append(
            "finance_v2_require_supplier is not recorded for this tenant (off is fine, absent is not). "
            f'Run: python scripts/gl_ledger_mode.py --tenant {tenant} --require-supplier off --reason "..."'
        )
    if facts["rollback_reconciler_verified"] is False:
        reasons.append("Rollback reconciler not verified: tenant has dual history but the dual reconciler is not selected")
    return {"ok": not reasons, "reasons": reasons}


def _explained_diff_review(parity: dict | None) -> list[dict]:
    """Every parity balance row with a non-zero explained difference, amount included. Informational (R5)."""
    if not parity:
        return []
    return [
        {"code": row["code"], "explained_diff": row["explained_diff"], "legacy": row["legacy"], "gl": row["gl"]}
        for row in parity.get("balances", [])
        if Decimal(str(row.get("explained_diff", "0"))) != ZERO
    ]


def _verdict_can_switch_reports_to_gl(facts: dict) -> dict:
    """dual mode + clean streak >= 2 + parity ok + no unexplained parity differences + rollback reconciler verified.

    ``explained_diff_review`` lists each explained (non-zero) difference with its amount for a human; it never blocks."""
    reasons: list[str] = []
    if facts["ledger_mode"] != "dual":
        reasons.append(f"Ledger mode is '{facts['ledger_mode']}', must be 'dual' before reports can come from the GL")
    if facts["clean_reconciliation_streak"] < MIN_CLEAN_STREAK:
        reasons.append(
            f"Clean reconciliation streak is {facts['clean_reconciliation_streak']}, need >= {MIN_CLEAN_STREAK}"
        )
    parity = facts["parity"]
    if parity is None:
        if facts["ledger_mode"] == "dual":
            reasons.append("Parity report is unavailable")
    else:
        if not parity.get("ok"):
            reasons.append("Legacy vs GL parity report is failing")
        unexplained = parity.get("unexplained") or []
        if unexplained:
            reasons.append(f"Unexplained parity differences: {', '.join(unexplained)}")
    if facts["rollback_reconciler_verified"] is False:
        reasons.append("Rollback reconciler not verified: tenant has dual history but the dual reconciler is not selected")
    return {"ok": not reasons, "reasons": reasons, "explained_diff_review": _explained_diff_review(parity)}


def readiness(db: Session, tenant_id: str) -> dict:
    """Collect a tenant's cut-over posture and compute both verdicts. Zero DB writes.

    The entire collection runs inside a nested savepoint that is always rolled
    back, so any shadow catch-up a reused reader performs is discarded.
    """
    savepoint = db.begin_nested()
    try:
        facts = _collect(db, tenant_id)
    finally:
        if savepoint.is_active:
            savepoint.rollback()

    facts["can_switch_to_dual"] = _verdict_can_switch_to_dual(facts)
    facts["can_switch_reports_to_gl"] = _verdict_can_switch_reports_to_gl(facts)
    return facts
