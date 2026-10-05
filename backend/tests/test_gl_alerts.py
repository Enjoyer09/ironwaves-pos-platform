"""Finance v2 reconciliation alerting: dedup, auto-resolve, acknowledge + audit, ERROR log."""
from __future__ import annotations

import logging
import uuid

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import alerts, engine as gl
from app.gl.models import GLAlert, GLAuditEvent
from app.models import Tenant


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", future=True)

    @event.listens_for(engine, "connect")
    def _connect(dbapi_conn, _):
        dbapi_conn.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    yield session
    session.close()
    engine.dispose()


def _tenant(db, name="T") -> str:
    tid = str(uuid.uuid4())
    db.add(Tenant(id=tid, name=name, slug=f"s-{tid[:8]}", domain=f"{tid[:8]}.test", status="active"))
    db.flush()
    return tid


def _open(db, tid):
    return db.query(GLAlert).filter(GLAlert.tenant_id == tid, GLAlert.status == "open").all()


def test_raise_dedups_into_one_open_alert(db):
    tid = _tenant(db)
    alerts.raise_alert(db, tid, alert_type="reconcile_failed", detail="first", context={"n": 1})
    alerts.raise_alert(db, tid, alert_type="reconcile_failed", detail="second", context={"n": 2})
    db.commit()
    rows = _open(db, tid)
    assert len(rows) == 1
    assert rows[0].occurrences == 2
    assert rows[0].detail == "second"  # refreshed to latest


def test_different_types_are_separate_alerts(db):
    tid = _tenant(db)
    alerts.raise_alert(db, tid, alert_type="reconcile_failed", detail="x")
    alerts.raise_alert(db, tid, alert_type="native_error", detail="y")
    db.commit()
    assert len(_open(db, tid)) == 2


def test_resolve_open_alerts_marks_resolved(db):
    tid = _tenant(db)
    alerts.raise_alert(db, tid, alert_type="reconcile_failed", detail="x")
    db.commit()
    resolved = alerts.resolve_open_alerts(db, tid, "reconcile_failed")
    db.commit()
    assert resolved == 1
    assert _open(db, tid) == []
    row = db.query(GLAlert).filter(GLAlert.tenant_id == tid).one()
    assert row.status == "resolved" and row.resolved_at is not None
    # A new failure after resolution starts a fresh open alert.
    alerts.raise_alert(db, tid, alert_type="reconcile_failed", detail="again")
    db.commit()
    assert len(_open(db, tid)) == 1


def test_acknowledge_flips_status_and_writes_audit(db):
    tid = _tenant(db)
    gl.ensure_chart(db, tid)
    db.commit()
    a = alerts.raise_alert(db, tid, alert_type="native_error", detail="boom")
    db.commit()
    acked = alerts.acknowledge_alert(db, tid, a.id, actor="owner")
    db.commit()
    assert acked.status == "acknowledged"
    assert acked.acknowledged_by == "owner" and acked.acknowledged_at is not None
    events = db.query(GLAuditEvent).filter(GLAuditEvent.tenant_id == tid, GLAuditEvent.event_type == "GL_ALERT_ACKNOWLEDGED").all()
    assert len(events) == 1 and events[0].entity_id == a.id


def test_acknowledge_non_open_raises(db):
    tid = _tenant(db)
    gl.ensure_chart(db, tid)
    db.commit()
    a = alerts.raise_alert(db, tid, alert_type="native_error", detail="boom")
    db.commit()
    alerts.acknowledge_alert(db, tid, a.id, actor="owner")
    db.commit()
    with pytest.raises(gl.GLError):
        alerts.acknowledge_alert(db, tid, a.id, actor="owner")


def test_raise_emits_error_log_line(db, caplog):
    tid = _tenant(db)
    with caplog.at_level(logging.ERROR, logger="ironwaves.gl_alerts"):
        alerts.raise_alert(db, tid, alert_type="reconcile_failed", detail="failing")
    db.commit()
    assert any(r.getMessage().startswith("[gl-alert] tenant=") for r in caplog.records)


def test_list_alerts_filters_by_status(db):
    tid = _tenant(db)
    alerts.raise_alert(db, tid, alert_type="reconcile_failed", detail="x")
    db.commit()
    alerts.resolve_open_alerts(db, tid, "reconcile_failed")
    alerts.raise_alert(db, tid, alert_type="native_error", detail="y")
    db.commit()
    assert len(alerts.list_alerts(db, tid)) == 2
    assert len(alerts.list_alerts(db, tid, status="open")) == 1
    assert len(alerts.list_alerts(db, tid, status="resolved")) == 1


def test_list_alerts_all_crosses_tenants(db):
    t1, t2 = _tenant(db, "a"), _tenant(db, "b")
    alerts.raise_alert(db, t1, alert_type="reconcile_failed", detail="x")
    alerts.raise_alert(db, t2, alert_type="native_error", detail="y")
    db.commit()
    assert len(alerts.list_alerts_all(db, status="open")) == 2


def test_notify_external_noop_without_key(db, monkeypatch):
    from app.core.config import settings

    tid = _tenant(db)
    a = alerts.raise_alert(db, tid, alert_type="native_error", detail="boom")
    db.commit()
    monkeypatch.setattr(settings, "resend_api_key", None)
    # Must not raise whether the key is set or not.
    alerts.notify_external(a)
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    alerts.notify_external(a)
