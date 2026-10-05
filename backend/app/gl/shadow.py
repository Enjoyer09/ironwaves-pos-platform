"""Finance v2 shadow mode.

While the legacy ledger is still the system of record, this job keeps the GL
an exact mirror of it and proves it every night:

* **sync** (every ``finance_v2_shadow_interval_seconds``): imports legacy
  transactions posted since the last cycle (``migrate_tenant(incremental=True)``).
* **reconcile** (once per Baku day, after ``finance_v2_reconcile_hour_baku``):
  runs the full independent reconciliation per tenant and records the result.

Design choices
--------------
* It runs *outside* request handling: a GL problem can never slow down or fail
  a sale. The price is a few minutes of lag, which is fine for a shadow.
* One worker at a time (PostgreSQL advisory lock), per-tenant transactions:
  one tenant's failure never blocks the others.
* Everything is recorded in ``gl_shadow_runs`` so the cut-over decision is
  based on evidence (N consecutive clean nights), not on feelings.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import SessionLocal
from app.gl.engine import BUSINESS_TZ
from app.gl.legacy_migration import migrate_tenant, reconcile_tenant
from app.gl.models import GLShadowRun
from app.models import FinanceTransaction

logger = logging.getLogger("ironwaves.gl_shadow")
SHADOW_LOCK_KEY = 7411  # unique across schedulers (birthday uses 7401)
_started = False
_start_lock = threading.Lock()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _tenants_with_legacy_finance(db: Session) -> list[str]:
    return [tid for (tid,) in db.query(FinanceTransaction.tenant_id).group_by(FinanceTransaction.tenant_id).all()]


def _record(db: Session, **fields) -> None:
    db.add(GLShadowRun(**fields))
    db.commit()


def sync_tenant(db: Session, tenant_id: str) -> int:
    """Import new legacy rows for one tenant atomically. Returns imported count."""
    started = _utcnow()
    try:
        result = migrate_tenant(db, tenant_id, commit=False, incremental=True)
        db.commit()
    except Exception as exc:  # never propagate: shadow must not affect anything else
        db.rollback()
        logger.error("gl_shadow sync failed tenant=%s: %s", tenant_id, exc, exc_info=True)
        _record(db, tenant_id=tenant_id, run_type="sync", started_at=started, finished_at=_utcnow(),
                imported=0, ok=False, error=str(exc)[:4000])
        return 0
    if result.imported:
        _record(db, tenant_id=tenant_id, run_type="sync", started_at=started, finished_at=_utcnow(),
                imported=result.imported, ok=True, details=json.dumps({"reversal_links": result.reversal_links}))
    return result.imported


def reconcile_tenant_shadow(db: Session, tenant_id: str, *, started: datetime | None = None) -> dict:
    """Sync then reconcile. A legacy posting that lands between the two steps can
    cause a transient mismatch, so a failure is retried once after a fresh sync.

    ``started`` is the cycle's clock (UTC, naive); the once-per-day guard relies on it."""
    started = started or _utcnow()
    from app.gl.bridge import get_ledger_mode
    from app.gl.legacy_migration import reconcile_dual_tenant

    def run():
        mode = get_ledger_mode(db, tenant_id)
        return reconcile_dual_tenant(db, tenant_id) if mode == "dual" else reconcile_tenant(db, tenant_id)

    # Was the previous reconcile clean? Used to tell a fresh failure (streak break)
    # from an ongoing one. Read before this run is recorded.
    prev_was_clean = _last_reconcile_ok(db, tenant_id)

    sync_tenant(db, tenant_id)
    report = run()
    db.rollback()  # reconciliation is read-only; end the snapshot
    if not report["ok"]:
        sync_tenant(db, tenant_id)
        report = run()
        db.rollback()
    failed = [c for c in report["checks"] if not c["ok"]]
    if failed:
        logger.error("gl_shadow reconciliation FAILED tenant=%s checks=%s", tenant_id, failed)
    _record(db, tenant_id=tenant_id, run_type="reconcile", started_at=started, finished_at=_utcnow(), imported=0,
            ok=report["ok"], details=json.dumps({"failed_checks": failed, "checks": len(report["checks"])}, ensure_ascii=False))
    # Alerting: a failure raises a de-duplicated open alert; a clean run resolves it.
    try:
        from app.gl import alerts

        if not report["ok"]:
            alerts.raise_alert(db, tenant_id, alert_type="reconcile_failed",
                               detail=f"Nightly reconciliation failed ({len(failed)} check(s))",
                               context={"failed_checks": failed})
            if prev_was_clean:
                alerts.raise_alert(db, tenant_id, alert_type="streak_broken",
                                   detail="Clean reconciliation streak broke",
                                   context={"failed_checks": failed})
        else:
            alerts.resolve_open_alerts(db, tenant_id, "reconcile_failed")
            alerts.resolve_open_alerts(db, tenant_id, "streak_broken")
        db.commit()
    except Exception:  # alerting must never break the shadow job
        db.rollback()
        logger.error("gl_shadow alerting failed tenant=%s", tenant_id, exc_info=True)
    return report


def _last_reconcile_ok(db: Session, tenant_id: str) -> bool:
    """True when the most recent recorded reconcile run for this tenant was clean.

    No prior reconcile counts as clean (a first-ever failure is still a streak break)."""
    last = (
        db.query(GLShadowRun.ok)
        .filter(GLShadowRun.tenant_id == tenant_id, GLShadowRun.run_type == "reconcile")
        .order_by(GLShadowRun.started_at.desc())
        .first()
    )
    return True if last is None else bool(last[0])


def _reconciled_on(db: Session, tenant_id: str, day_start_utc: datetime, day_end_utc: datetime) -> bool:
    return bool(
        db.query(func.count(GLShadowRun.id))
        .filter(
            GLShadowRun.tenant_id == tenant_id,
            GLShadowRun.run_type == "reconcile",
            GLShadowRun.started_at >= day_start_utc,
            GLShadowRun.started_at < day_end_utc,
        )
        .scalar()
    )


def run_cycle(db: Session, *, now: datetime | None = None) -> dict:
    """One scheduler tick: sync every tenant; reconcile those not yet reconciled today (Baku day)."""
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    now_baku = now_utc.astimezone(BUSINESS_TZ)
    day_start = now_baku.replace(hour=0, minute=0, second=0, microsecond=0)
    day_start_utc = day_start.astimezone(timezone.utc).replace(tzinfo=None)
    day_end_utc = (day_start_utc + timedelta(days=1))
    due = now_baku.hour >= int(settings.finance_v2_reconcile_hour_baku)
    summary = {"synced": {}, "reconciled": {}}
    for tenant_id in _tenants_with_legacy_finance(db):
        summary["synced"][tenant_id] = sync_tenant(db, tenant_id)
        if due and not _reconciled_on(db, tenant_id, day_start_utc, day_end_utc):
            report = reconcile_tenant_shadow(db, tenant_id, started=now_utc.replace(tzinfo=None))
            summary["reconciled"][tenant_id] = report["ok"]
    return summary


def _try_lock(db: Session) -> bool:
    if db.bind.dialect.name != "postgresql":
        return True
    return bool(db.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": SHADOW_LOCK_KEY}).scalar())


def _unlock(db: Session) -> None:
    if db.bind.dialect.name == "postgresql":
        try:
            db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": SHADOW_LOCK_KEY})
        except Exception:
            logger.warning("gl_shadow advisory unlock failed", exc_info=True)


def _loop() -> None:
    interval = max(60, int(settings.finance_v2_shadow_interval_seconds or 300))
    logger.info("gl_shadow scheduler started (interval=%ss, reconcile_hour_baku=%s)", interval, settings.finance_v2_reconcile_hour_baku)
    time.sleep(30)  # let the app finish booting
    while True:
        try:
            with SessionLocal() as db:
                if _try_lock(db):
                    try:
                        run_cycle(db)
                    finally:
                        _unlock(db)
        except Exception:
            logger.error("gl_shadow cycle crashed", exc_info=True)
        time.sleep(interval)


def start_shadow_scheduler() -> bool:
    """Start the daemon thread once per process, only when explicitly enabled."""
    global _started
    if not settings.finance_v2_shadow_enabled:
        return False
    with _start_lock:
        if _started:
            return False
        threading.Thread(target=_loop, name="gl-shadow", daemon=True).start()
        _started = True
    return True


def shadow_status(db: Session, tenant_id: str, limit: int = 30) -> dict:
    rows = (
        db.query(GLShadowRun)
        .filter(GLShadowRun.tenant_id == tenant_id)
        .order_by(GLShadowRun.started_at.desc())
        .limit(limit)
        .all()
    )
    reconciles = [r for r in rows if r.run_type == "reconcile"]
    streak = 0
    for r in reconciles:  # newest first
        if not r.ok:
            break
        streak += 1
    return {
        "enabled": bool(settings.finance_v2_shadow_enabled),
        "clean_reconciliation_streak": streak,
        "last_sync": next(({"at": r.finished_at.isoformat(), "imported": r.imported, "ok": r.ok} for r in rows if r.run_type == "sync"), None),
        "runs": [
            {"type": r.run_type, "started_at": r.started_at.isoformat(), "ok": r.ok, "imported": r.imported,
             "error": r.error, "details": json.loads(r.details) if r.details else None}
            for r in rows
        ],
    }
