"""Finance v2 GL HTTP API: feature gate, permissions and an end-to-end flow."""
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
from app.gl import router as gl_router
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
        s.commit()

    state = {"user": SimpleNamespace(username="owner", role="admin")}
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
    monkeypatch.setattr(settings, "finance_v2_enabled", True)
    yield SimpleNamespace(client=TestClient(api), state=state, Session=Session, tenant_id=tenant_id)
    engine.dispose()


def _as(env, username, role):
    env.state["user"] = SimpleNamespace(username=username, role=role)


def test_api_is_hidden_when_flag_off(env, monkeypatch):
    monkeypatch.setattr(settings, "finance_v2_enabled", False)
    assert env.client.get("/api/v1/gl/accounts").status_code == 404
    assert env.client.post("/api/v1/gl/setup").status_code == 404
    assert env.client.get("/api/v1/gl/capabilities").status_code == 404


def test_api_is_enabled_per_tenant_in_dual_mode(env, monkeypatch):
    from app.gl import engine as gl_engine
    from app.gl.bridge import set_ledger_mode

    monkeypatch.setattr(settings, "finance_v2_enabled", False)
    with env.Session() as s:
        gl_engine.ensure_chart(s, env.tenant_id, actor="test")
        s.commit()
    assert env.client.get("/api/v1/gl/capabilities").status_code == 404
    with env.Session() as s:
        set_ledger_mode(s, env.tenant_id, "dual", actor="test", reason="pilot")
        s.commit()

    caps = env.client.get("/api/v1/gl/capabilities")
    assert caps.status_code == 200
    body = caps.json()
    assert body["enabled"] and body["ledger_mode"] == "dual" and body["reports_source"] == "legacy"
    assert body["chart_ready"] and body["can_control"] and body["can_approve"]
    assert env.client.get("/api/v1/gl/accounts").status_code == 200

    _as(env, "mgr", "manager")
    body = env.client.get("/api/v1/gl/capabilities").json()
    assert body["can_write"] and not body["can_approve"] and not body["can_control"] and not body["can_audit"]
    _as(env, "kassir", "staff")
    assert env.client.get("/api/v1/gl/capabilities").status_code == 403


def test_permissions(env):
    _as(env, "kassir", "staff")
    assert env.client.get("/api/v1/gl/accounts").status_code == 403
    assert env.client.post("/api/v1/gl/setup").status_code == 403
    _as(env, "mgr", "manager")
    assert env.client.post("/api/v1/gl/setup").status_code == 403
    assert env.client.get("/api/v1/gl/accounts").status_code == 200


def test_end_to_end_flow(env):
    c = env.client
    assert c.post("/api/v1/gl/setup").json()["success"] is True
    assert c.post("/api/v1/gl/tax-profile", json={"regime": "simplified", "simplified_rate": "2", "effective_from": "2026-05-01"}).status_code == 200

    # Small journal by an approver posts directly.
    r = c.post("/api/v1/gl/journals", json={
        "posting_date": "2026-05-05", "description": "Nizamnamə kapitalı",
        "lines": [{"account": "cash_drawer", "debit": "300"}, {"account": "301", "credit": "300"}],
        "idempotency_key": "cap-1",
    })
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "posted" and len(r.json()["lines"]) == 2
    # Retrying the same request is safe.
    assert c.post("/api/v1/gl/journals", json={
        "posting_date": "2026-05-05", "description": "Nizamnamə kapitalı",
        "lines": [{"account": "cash_drawer", "debit": "300"}, {"account": "301", "credit": "300"}],
        "idempotency_key": "cap-1",
    }).json()["id"] == r.json()["id"]

    # A manager's journal always needs approval; manager cannot approve.
    _as(env, "mgr", "manager")
    pending = c.post("/api/v1/gl/journals", json={
        "posting_date": "2026-05-06", "description": "İcarə",
        "lines": [{"account": "rent_expense", "debit": "100"}, {"account": "cash_drawer", "credit": "100"}],
    }).json()
    assert pending["status"] == "pending_approval"
    assert c.post(f"/api/v1/gl/journals/{pending['id']}/approve").status_code == 403
    _as(env, "owner", "admin")
    assert c.post(f"/api/v1/gl/journals/{pending['id']}/approve").json()["status"] == "posted"

    # Business errors come back as structured 4xx, not 500.
    bad = c.post("/api/v1/gl/journals", json={
        "posting_date": "2026-05-06", "description": "x",
        "lines": [{"account": "cash_drawer", "debit": "10"}, {"account": "301", "credit": "9"}],
    })
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "unbalanced"
    overdraw = c.post("/api/v1/gl/journals", json={
        "posting_date": "2026-05-06", "description": "x",
        "lines": [{"account": "general_expense", "debit": "250"}, {"account": "cash_drawer", "credit": "250"}],
    })
    assert overdraw.status_code == 409 and overdraw.json()["detail"]["code"] == "insufficient_balance"

    bs = c.get("/api/v1/gl/reports/balance-sheet", params={"as_of": "2026-05-31"}).json()
    assert bs["balanced"] and bs["assets"]["total"] == "200.00"
    pl = c.get("/api/v1/gl/reports/profit-loss", params={"date_from": "2026-05-01", "date_to": "2026-05-31"}).json()
    assert pl["net_profit"] == "-100.00"
    tb = c.get("/api/v1/gl/reports/trial-balance", params={"date_from": "2026-05-01", "date_to": "2026-05-31"}).json()
    assert tb["balanced"]

    # Reversal always requires a second person.
    rev = c.post(f"/api/v1/gl/journals/{pending['id']}/reverse", json={"reason": "yanlış yazılıb"}).json()
    assert rev["status"] == "pending_approval"
    assert c.post(f"/api/v1/gl/journals/{rev['id']}/approve").status_code == 403  # owner created it
    _as(env, "cfo", "finance_admin")
    assert c.post(f"/api/v1/gl/journals/{rev['id']}/approve").json()["status"] == "posted"

    close = c.post("/api/v1/gl/periods/2026/5/status", json={"status": "closed"})
    assert close.status_code == 200 and close.json()["status"] == "closed"
    late = c.post("/api/v1/gl/journals", json={
        "posting_date": "2026-05-20", "description": "late",
        "lines": [{"account": "cash_drawer", "debit": "1"}, {"account": "301", "credit": "1"}],
    })
    assert late.status_code == 409 and late.json()["detail"]["code"] == "period_closed"

    integrity = c.get("/api/v1/gl/integrity").json()
    assert integrity["audit_chain"]["valid"] and integrity["balances"]["valid"] and integrity["trial_balance_balanced"]


def test_fiscal_year_endpoints(env):
    c = env.client
    assert c.post("/api/v1/gl/setup").status_code == 200
    assert c.post("/api/v1/gl/journals", json={
        "journal_type": "general", "posting_date": "2025-04-02", "description": "sale",
        "lines": [{"account": "cash_drawer", "debit": "50"}, {"account": "sales_revenue", "credit": "50"}],
    }).json()["status"] == "posted"
    status = c.get("/api/v1/gl/years/2025").json()
    assert status["closed"] is False and "open_periods" in status["blockers"]
    blocked = c.post("/api/v1/gl/years/2025/close")
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "open_periods"

    _as(env, "mgr", "manager")
    assert c.post("/api/v1/gl/years/2025/close").status_code == 403
    assert c.get("/api/v1/gl/years/2025").status_code == 200
    _as(env, "owner", "admin")
    assert c.post("/api/v1/gl/periods/2025/4/status", json={"status": "soft_closed"}).status_code == 200
    closed = c.post("/api/v1/gl/years/2025/close")
    assert closed.status_code == 200 and closed.json()["journal_type"] == "closing"
    assert c.get("/api/v1/gl/years/2025").json()["closed"] is True
    reopen = c.post("/api/v1/gl/years/2025/reopen", json={"reason": "correction"})
    assert reopen.status_code == 200 and reopen.json()["status"] == "pending_approval"
