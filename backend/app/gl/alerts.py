"""Finance v2 reconciliation alerting.

During the cut-over the GL mirrors the legacy ledger and proves it every night.
When that proof fails we must not lose the signal in the logs: this module
persists a de-duplicated, admin-visible alert in ``gl_alerts`` and emits a
structured ERROR log line.

Alert lifecycle (enforced here, not by DB triggers):

* ``raise_alert`` — one *open* alert per ``(tenant_id, alert_type)``. A repeated
  failure of the same type bumps ``occurrences`` + ``last_seen_at`` and refreshes
  ``detail``/``context`` instead of inserting a new row (no spam).
* ``resolve_open_alerts`` — a later clean run marks the open alerts of that type
  ``resolved``.
* ``acknowledge_alert`` — an operator acknowledges an open alert; written to the
  GL audit chain.

Commit convention: the write helpers follow the engine convention — the caller
owns the transaction (commit/rollback) — except that the shadow job commits the
session itself after raising/resolving.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.gl import engine
from app.gl.models import GLAlert

logger = logging.getLogger("ironwaves.gl_alerts")

ALERT_TYPES = ("reconcile_failed", "native_error", "streak_broken")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _serialise(alert: GLAlert) -> dict:
    return {
        "id": alert.id,
        "tenant_id": alert.tenant_id,
        "alert_type": alert.alert_type,
        "status": alert.status,
        "detail": alert.detail,
        "context": json.loads(alert.context) if alert.context else None,
        "first_seen_at": alert.first_seen_at.isoformat() if alert.first_seen_at else None,
        "last_seen_at": alert.last_seen_at.isoformat() if alert.last_seen_at else None,
        "occurrences": alert.occurrences,
        "acknowledged_by": alert.acknowledged_by,
        "acknowledged_at": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
        "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
    }


def _open_alert(db: Session, tenant_id: str, alert_type: str) -> GLAlert | None:
    return (
        db.query(GLAlert)
        .filter(GLAlert.tenant_id == tenant_id, GLAlert.alert_type == alert_type, GLAlert.status == "open")
        .order_by(GLAlert.first_seen_at.asc())
        .first()
    )


def raise_alert(db: Session, tenant_id: str, *, alert_type: str, detail: str, context: dict | None = None) -> GLAlert:
    """Log an ERROR and upsert the de-duplicated open alert for this tenant+type.

    Caller owns the commit (shadow job commits itself).
    """
    logger.error("[gl-alert] tenant=%s type=%s detail=%s", tenant_id, alert_type, detail)
    now = _utcnow()
    context_json = json.dumps(context, ensure_ascii=False) if context is not None else None
    existing = _open_alert(db, tenant_id, alert_type)
    if existing is not None:
        existing.occurrences = (existing.occurrences or 0) + 1
        existing.last_seen_at = now
        existing.detail = detail
        existing.context = context_json
        db.flush()
        return existing
    alert = GLAlert(
        tenant_id=tenant_id,
        alert_type=alert_type,
        status="open",
        detail=detail,
        context=context_json,
        first_seen_at=now,
        last_seen_at=now,
        occurrences=1,
    )
    db.add(alert)
    db.flush()
    return alert


def resolve_open_alerts(db: Session, tenant_id: str, alert_type: str) -> int:
    """Mark open alerts of this type resolved (a clean run arrived). Returns the count resolved."""
    now = _utcnow()
    rows = (
        db.query(GLAlert)
        .filter(GLAlert.tenant_id == tenant_id, GLAlert.alert_type == alert_type, GLAlert.status == "open")
        .all()
    )
    for row in rows:
        row.status = "resolved"
        row.resolved_at = now
    if rows:
        db.flush()
    return len(rows)


def acknowledge_alert(db: Session, tenant_id: str, alert_id: str, actor: str) -> GLAlert:
    """Acknowledge an open alert and write it to the GL audit chain. Caller owns the commit."""
    alert = db.query(GLAlert).filter(GLAlert.tenant_id == tenant_id, GLAlert.id == alert_id).first()
    if alert is None:
        raise engine.GLError("Alert not found", "alert_not_found", status_code=404)
    if alert.status != "open":
        raise engine.GLError("Alert is not open", "alert_not_open", status_code=409)
    alert.status = "acknowledged"
    alert.acknowledged_by = actor
    alert.acknowledged_at = _utcnow()
    engine.append_audit(
        db,
        tenant_id,
        event_type="GL_ALERT_ACKNOWLEDGED",
        entity_type="gl_alert",
        entity_id=alert_id,
        actor=actor,
        payload={"alert_type": alert.alert_type, "occurrences": alert.occurrences},
    )
    db.flush()
    return alert


def list_alerts(db: Session, tenant_id: str, status: str | None = None) -> list[dict]:
    query = db.query(GLAlert).filter(GLAlert.tenant_id == tenant_id)
    if status:
        query = query.filter(GLAlert.status == status)
    rows = query.order_by(GLAlert.last_seen_at.desc()).all()
    return [_serialise(r) for r in rows]


def list_alerts_all(db: Session, status: str | None = None) -> list[dict]:
    """Cross-tenant list for the super_admin platform view."""
    query = db.query(GLAlert)
    if status:
        query = query.filter(GLAlert.status == status)
    rows = query.order_by(GLAlert.last_seen_at.desc()).all()
    return [_serialise(r) for r in rows]


def notify_external(alert: GLAlert) -> None:
    """Best-effort external notification. No-op unless ``settings.resend_api_key`` is set.

    Introduces NO new secret and must never raise (an alert must still persist
    even if notification is impossible).
    """
    try:
        if not getattr(settings, "resend_api_key", None):
            return
        # External delivery (email via Resend) is intentionally not wired here yet:
        # the alert is already persisted and logged. This hook stays a safe no-op
        # until a delivery channel is added, and must never break the caller.
        logger.info("[gl-alert] external notify enabled for tenant=%s type=%s", alert.tenant_id, alert.alert_type)
    except Exception:  # pragma: no cover - defensive: notify must never raise
        logger.exception("[gl-alert] external notify failed")
