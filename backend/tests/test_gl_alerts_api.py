"""Finance v2 alerts over HTTP: role gates, acknowledge + audit, legacy-tenant 404."""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.core.config import settings
from app.db import Base, get_db
from app.deps import get_current_user, get_tenant
from app.gl import alerts, engine as gl
from app.gl.models import GLAlert, GLAuditEvent
from app.models import Tenant


@pytest.fixture()
def env(monkeypatch):
    engine = create_engine("sqlite://", future=True, connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _connect(dbapi_conn, _):
        dbapi_conn.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    tenant_id = str(uuid.uuid4())
    with Session() as s:
        s.add(Tenant(id=tenant_id, name="T", slug="t", domain="t.test", status="active"))
        s.flush()
        gl.ensure_chart(s, tenant_id)
        alerts.raise_alert(s, tenant_id, alert_type="reconcile_failed", detail="failing", context={"failed_checks": []})
        s.commit()

    from app.gl import router as gl_router

    state = {"user": SimpleNamespace(username="owner", role="admin"), "enabled": True}
    api = FastAPI()
    api.include_router(gl_router.router)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: SimpleNamespace(id=tenant_id)
    api.dependency_overrides[get_current_user] = lambda: state["user"]

    # finance_v2_enabled gates the whole router; toggling it simulates a legacy tenant (404).
    def _enabled():
        return state["enabled"]

    monkeypatch.setattr(settings, "finance_v2_enabled", True)
    yield SimpleNamespace(client=TestClient(api), state=state, Session=Session, tenant_id=tenant_id, settings_mp=monkeypatch)
    engine.dispose()


def _as(env, username, role):
    env.state["user"] = SimpleNamespace(username=username, role=role)


def _open_alert_id(env):
    with env.Session() as s:
        row = s.query(GLAlert).filter(GLAlert.tenant_id == env.tenant_id, GLAlert.status == "open").first()
        return row.id


def test_auditor_can_read_alerts(env):
    _as(env, "auditor1", "auditor")
    r = env.client.get("/api/v1/gl/alerts")
    assert r.status_code == 200, r.text
    items = r.json()
    assert len(items) == 1 and items[0]["alert_type"] == "reconcile_failed" and items[0]["status"] == "open"


def test_default_status_is_open(env):
    r = env.client.get("/api/v1/gl/alerts")
    assert r.status_code == 200
    assert all(a["status"] == "open" for a in r.json())


def test_non_controller_cannot_acknowledge(env):
    alert_id = _open_alert_id(env)
    _as(env, "auditor1", "auditor")  # auditor can read but not control
    r = env.client.post(f"/api/v1/gl/alerts/{alert_id}/acknowledge")
    assert r.status_code == 403, r.text


def test_controller_acknowledge_flips_status_and_audits(env):
    alert_id = _open_alert_id(env)
    _as(env, "cfo", "finance_admin")
    r = env.client.post(f"/api/v1/gl/alerts/{alert_id}/acknowledge")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "acknowledged" and r.json()["acknowledged_by"] == "cfo"
    with env.Session() as s:
        events = s.query(GLAuditEvent).filter(GLAuditEvent.tenant_id == env.tenant_id,
                                              GLAuditEvent.event_type == "GL_ALERT_ACKNOWLEDGED").all()
        assert len(events) == 1
    # It no longer shows in the default (open) list.
    assert env.client.get("/api/v1/gl/alerts").json() == []


def test_legacy_tenant_gets_404(env):
    # A legacy tenant has finance_v2 off and no dual mode → the whole GL API 404s.
    env.settings_mp.setattr(settings, "finance_v2_enabled", False)
    r = env.client.get("/api/v1/gl/alerts")
    assert r.status_code == 404, r.text
