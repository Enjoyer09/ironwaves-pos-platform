"""Finance v2 AP bills over HTTP: idempotent payments, maker-checker and overpayment (FEAT-001)."""
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
from app.gl import bridge
from app.gl import engine as gl
from app.gl import router as gl_router
from app.gl.legacy_migration import migrate_tenant
from app.gl.models import GLDocumentAllocation, GLJournal
from app.models import Supplier, Tenant
from app.services import finance_service as fs

BILL_DATE = "2026-09-10"


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
        s.add(Supplier(id="sup-1", tenant_id=tenant_id, name="Bakı Qida MMC"))
        s.flush()
        gl.ensure_chart(s, tenant_id)
        fs.post_finance_transaction(s, tenant_id=tenant_id, transaction_type="investor_injection", amount="5000", source_code="investor",
                                    destination_code="cash", created_by="owner", category="Təsisçi İnvestisiyası")
        s.commit()
        migrate_tenant(s, tenant_id)
        bridge.set_ledger_mode(s, tenant_id, "dual", actor="owner", reason="test")
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


def _bill(env, number="B-1", total="100.00"):
    r = env.client.post("/api/v1/gl/documents/bills", json={
        "partner_id": "sup-1", "number": number, "issue_date": BILL_DATE, "due_date": "2026-09-30", "total": total,
    })
    assert r.status_code == 200, r.text
    return r.json()


def _pay(env, doc_id, amount, key, **extra):
    body = {"amount": amount, "paid_from": "cash_drawer", "posting_date": "2026-09-15", **extra}
    if key is not None:
        body["idempotency_key"] = key
    return env.client.post(f"/api/v1/gl/documents/{doc_id}/pay", json=body)


def _payment_journals(env, doc_id):
    with env.Session() as s:
        return s.query(GLJournal).filter(GLJournal.tenant_id == env.tenant_id, GLJournal.source_type == "document_payment",
                                         GLJournal.source_id == doc_id).all()


def _alloc_count(env, doc_id):
    with env.Session() as s:
        return s.query(GLDocumentAllocation).filter(GLDocumentAllocation.document_id == doc_id).count()


def test_pay_requires_idempotency_key(env):
    doc = _bill(env)
    assert _pay(env, doc["id"], "10.00", None).status_code == 422
    assert _pay(env, doc["id"], "10.00", "short").status_code == 422  # < 8 chars
    assert _pay(env, doc["id"], "10.00", "bad key with spaces").status_code == 422
    assert not _payment_journals(env, doc["id"])


def test_http_replay_same_key(env):
    doc = _bill(env)
    first = _pay(env, doc["id"], "30.00", "replay-key-1")
    second = _pay(env, doc["id"], "30.00", "replay-key-1")
    assert first.status_code == 200 and second.status_code == 200, second.text
    a, b = first.json(), second.json()
    assert a.pop("replayed") is False and b.pop("replayed") is True
    assert a == b
    assert len(_payment_journals(env, doc["id"])) == 1 and _alloc_count(env, doc["id"]) == 1
    conflict = _pay(env, doc["id"], "31.00", "replay-key-1")
    assert conflict.status_code == 409 and conflict.json()["detail"]["code"] == "idempotency_conflict"


def test_manager_payment_pending_until_approved(env):
    doc = _bill(env, total="100.00")
    _as(env, "mgr", "manager")
    r = _pay(env, doc["id"], "40.00", "mgr-pay-0001")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["journal_status"] == "pending_approval" and body["allocations_count"] == 0
    detail = env.client.get(f"/api/v1/gl/documents/{doc['id']}").json()
    assert detail["open"] == "100.00" and detail["status"] == "open" and detail["allocations"] == []
    # The pending 40 is reserved: nobody can pay more than the remaining 60 meanwhile.
    _as(env, "owner", "admin")
    over = _pay(env, doc["id"], "70.00", "owner-pay-0001")
    assert over.status_code == 409 and over.json()["detail"]["code"] == "overpayment_not_allowed"
    # Manager cannot approve at all; a different approver posts it and the allocation appears.
    _as(env, "mgr", "manager")
    assert env.client.post(f"/api/v1/gl/journals/{body['journal_id']}/approve").status_code == 403
    _as(env, "owner", "admin")
    approved = env.client.post(f"/api/v1/gl/journals/{body['journal_id']}/approve")
    assert approved.status_code == 200 and approved.json()["status"] == "posted"
    detail = env.client.get(f"/api/v1/gl/documents/{doc['id']}").json()
    assert detail["open"] == "60.00" and detail["status"] == "partially_paid" and len(detail["allocations"]) == 1

    # An approver's large payment (>= threshold 500) is pending too, and the maker cannot approve it.
    big = _bill(env, number="B-BIG", total="800.00")
    r = _pay(env, big["id"], "600.00", "owner-big-0001")
    assert r.json()["journal_status"] == "pending_approval"
    self_approve = env.client.post(f"/api/v1/gl/journals/{r.json()['journal_id']}/approve")
    assert self_approve.status_code == 403 and self_approve.json()["detail"]["code"] == "self_approval"
    assert _alloc_count(env, big["id"]) == 0
    # A rejected payment releases the reservation.
    _as(env, "cfo", "finance_admin")
    assert env.client.post(f"/api/v1/gl/journals/{r.json()['journal_id']}/reject", json={"reason": "yanlış"}).status_code == 200
    assert env.client.get(f"/api/v1/gl/documents/{big['id']}").json()["open"] == "800.00"
    assert _pay(env, big["id"], "300.00", "cfo-pay-00001").json()["journal_status"] == "posted"


def test_pending_payment_and_remaining_open_can_both_settle(env):
    doc = _bill(env, total="100.00")
    _as(env, "mgr", "manager")
    pending = _pay(env, doc["id"], "60.00", "mgr-pay-0002").json()
    _as(env, "owner", "admin")
    assert _pay(env, doc["id"], "40.00", "owner-pay-0002").json()["journal_status"] == "posted"
    _as(env, "cfo", "finance_admin")
    assert env.client.post(f"/api/v1/gl/journals/{pending['journal_id']}/approve").status_code == 200
    detail = env.client.get(f"/api/v1/gl/documents/{doc['id']}").json()
    assert detail["status"] == "paid" and detail["open"] == "0.00" and len(detail["allocations"]) == 2


def test_overpay_http_409(env):
    doc = _bill(env, number="B-OVER", total="100.00")
    r = _pay(env, doc["id"], "100.01", "over-pay-0001")
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "overpayment_not_allowed"
    assert "100.00" in detail["message"] and "B-OVER" in detail["message"]
    sub_cent = _pay(env, doc["id"], "10.005", "subcent-0001")
    assert sub_cent.status_code == 400 and sub_cent.json()["detail"]["code"] == "invalid_amount"
    assert not _payment_journals(env, doc["id"])
