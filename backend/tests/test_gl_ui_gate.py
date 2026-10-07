"""Finance v2 WP-A1: the per-tenant UI gate on /api/v1/gl/*.

A dual tenant whose ``finance_v2_ui_visible`` setting is not ``visible: true`` answers 404 on every GL route for every
authenticated role except super_admin. Non-dual tenants keep the old 404 that happens BEFORE auth. The probes write the
settings as raw rows (the documented JSON shape), so they test behaviour and not helper names.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.core.config import settings
from app.db import Base, get_db
from app.deps import get_current_user, get_tenant
from app.gl import alerts, bridge, shadow
from app.gl import engine as gl_engine
from app.gl import router as gl_router
from app.gl.models import GLJournal
from app.models import Setting, Tenant
from app.services import finance_service as fs

NON_SUPER_ROLES = ["admin", "manager", "accountant", "finance_admin", "auditor", "staff"]


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
        gl_engine.ensure_chart(s, tenant_id, actor="test")
        s.commit()

    state = {"user": SimpleNamespace(username="owner", role="admin"), "auth_calls": 0}
    api = FastAPI()
    api.include_router(gl_router.router)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    def _user():
        state["auth_calls"] += 1
        return state["user"]

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: SimpleNamespace(id=tenant_id)
    api.dependency_overrides[get_current_user] = _user
    monkeypatch.setattr(settings, "finance_v2_enabled", False)  # production value: the per-tenant rules decide
    yield SimpleNamespace(client=TestClient(api, raise_server_exceptions=False), state=state, Session=Session, tenant_id=tenant_id)
    engine.dispose()


def _put(env, key: str, payload: dict | str) -> None:
    value = payload if isinstance(payload, str) else json.dumps(payload)
    with env.Session() as s:
        row = s.query(Setting).filter(Setting.tenant_id == env.tenant_id, Setting.key == key).first()
        if row:
            row.value = value
        else:
            s.add(Setting(tenant_id=env.tenant_id, key=key, value=value))
        s.commit()


def _dual(env) -> None:
    _put(env, "finance_v2_ledger_mode", {"mode": "dual", "since": "2026-10-01T00:00:00", "by": "test"})


def _visible(env, visible: bool) -> None:
    _put(env, "finance_v2_ui_visible", {"visible": visible, "since": "2026-10-01T00:00:00", "by": "test"})


def _as(env, role: str) -> None:
    env.state["user"] = SimpleNamespace(username=f"u-{role}", role=role)


def _call(env, route: APIRoute, method: str):
    path = re.sub(r"\{[^}]+\}", "dummy", route.path)
    return env.client.request(method, path, json={} if method in {"POST", "PUT", "PATCH", "DELETE"} else None)


def _is_gate(response) -> bool:
    """True only for the gate's own answer; business 404s carry a different body and some routes return non-JSON."""
    return response.status_code == 404 and response.content.replace(b" ", b"") == b'{"detail":"NotFound"}'


def _all_route_calls():
    calls = []
    for route in gl_router.router.routes:
        if isinstance(route, APIRoute):
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                calls.append((route, method))
    return calls


def test_route_enumeration_is_not_empty():
    # A newly added route is picked up automatically by the parametrised tests below; this guards the enumeration itself.
    assert len(_all_route_calls()) >= 37  # routes at the time WP-A1 was written; never shrink this number


def test_router_level_dependencies_are_enabled_then_ui_gate():
    """Order matters: the old gate answers before auth, the new one runs after get_current_user."""
    deps = [d.dependency for d in gl_router.router.dependencies]
    assert deps == [gl_router._enabled, gl_router._ui_gate]


@pytest.mark.parametrize("role", NON_SUPER_ROLES)
def test_hidden_dual_tenant_is_404_on_every_route_for_every_non_super_role(env, role):
    _dual(env)  # dual, ui_visible never recorded => hidden by default
    _as(env, role)
    leaked = []
    for route, method in _all_route_calls():
        response = _call(env, route, method)
        if not _is_gate(response):
            leaked.append((method, route.path, response.status_code))
    assert leaked == []


@pytest.mark.parametrize("role", NON_SUPER_ROLES)
def test_explicitly_hidden_dual_tenant_is_404_too(env, role):
    _dual(env)
    _visible(env, False)
    _as(env, role)
    assert _is_gate(env.client.get("/api/v1/gl/capabilities"))


def test_super_admin_passes_the_gate_on_every_route_of_a_hidden_dual_tenant(env):
    _dual(env)
    _as(env, "super_admin")
    gated = [(method, route.path) for route, method in _all_route_calls()
             if _is_gate(_call(env, route, method))]
    assert gated == []
    caps = env.client.get("/api/v1/gl/capabilities")
    assert caps.status_code == 200
    assert caps.json()["ui_visible"] is False and caps.json()["enabled"] is True


def test_visible_dual_tenant_serves_admin_and_reports_ui_visible(env):
    _dual(env)
    _visible(env, True)
    _as(env, "admin")
    caps = env.client.get("/api/v1/gl/capabilities")
    assert caps.status_code == 200
    assert caps.json()["ui_visible"] is True and caps.json()["ledger_mode"] == "dual"
    assert env.client.get("/api/v1/gl/accounts").status_code == 200
    # Hidden again -> 404 for the admin at once, super_admin still gets in and sees ui_visible false.
    _visible(env, False)
    assert env.client.get("/api/v1/gl/capabilities").status_code == 404
    _as(env, "super_admin")
    body = env.client.get("/api/v1/gl/capabilities").json()
    assert body["ui_visible"] is False


@pytest.mark.parametrize("raw", ["", "not json", "[]", "null", json.dumps({"visible": "true"}), json.dumps({"visible": 1}),
                                 json.dumps({"visible": None}), json.dumps({})])
def test_malformed_or_non_boolean_values_mean_hidden(env, raw):
    _dual(env)
    _put(env, "finance_v2_ui_visible", raw)
    _as(env, "admin")
    assert env.client.get("/api/v1/gl/capabilities").status_code == 404


def test_non_dual_tenant_stays_404_for_everybody_and_before_auth(env):
    # legacy tenant, even with the visible flag set: the old gate answers first, auth is never consulted.
    _visible(env, True)
    for role in NON_SUPER_ROLES + ["super_admin"]:
        _as(env, role)
        response = env.client.get("/api/v1/gl/capabilities")
        assert _is_gate(response)
    assert env.state["auth_calls"] == 0


def test_global_flag_bypasses_the_ui_gate(env, monkeypatch):
    """settings.finance_v2_enabled is the dev/test switch (false in production); it keeps serving everything."""
    monkeypatch.setattr(settings, "finance_v2_enabled", True)
    _as(env, "admin")
    caps = env.client.get("/api/v1/gl/capabilities")
    assert caps.status_code == 200 and caps.json()["ui_visible"] is True


def test_in_process_jobs_are_unaffected_by_a_hidden_ui(env):
    """Shadow sync/reconcile, alerts and the native bridge never go through the router, so hiding the UI changes nothing."""
    _dual(env)
    tid = env.tenant_id
    with env.Session() as db:
        fs.post_finance_transaction(db, tenant_id=tid, transaction_type="investor_injection", amount=Decimal("100"), source_code="investor",
                                    destination_code="cash", created_by="owner", category="Təsisçi İnvestisiyası")
        db.commit()
        assert bridge.get_ledger_mode(db, tid) == "dual"
        summary = shadow.run_cycle(db, now=datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc))
        assert summary["synced"][tid] == 1 and summary["reconciled"][tid] is True
        alert = alerts.raise_alert(db, tid, alert_type="reconcile_failed", detail="probe", context={})
        db.commit()
        assert alert is not None
        assert db.query(GLJournal).filter(GLJournal.tenant_id == tid).count() >= 1
