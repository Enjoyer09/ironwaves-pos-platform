"""Finance v2 AP bills over HTTP: idempotent payments, maker-checker and overpayment (FEAT-001);
document lifecycle (void, payment reversal, approval gate), listing and suppliers (FEAT-002)."""
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
from app.gl.legacy_migration import migrate_tenant, reconcile_dual_tenant
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


def _approve_as(env, journal_id, username="cfo", role="finance_admin"):
    """Approve as a different approver, then restore the current user."""
    previous = env.state["user"]
    _as(env, username, role)
    try:
        return env.client.post(f"/api/v1/gl/journals/{journal_id}/approve")
    finally:
        env.state["user"] = previous


def _detail(env, doc_id):
    r = env.client.get(f"/api/v1/gl/documents/{doc_id}")
    assert r.status_code == 200, r.text
    return r.json()


def _sup_balance(env, supplier_id="sup-1"):
    rows = env.client.get("/api/v1/gl/subledger/ap").json()["partners"]
    row = next((r for r in rows if r["partner_id"] == supplier_id), None)
    return row["balance"] if row else "0.00"


def _reconciled(env):
    with env.Session() as s:
        report = reconcile_dual_tenant(s, env.tenant_id)
        assert report["ok"], [c for c in report["checks"] if not c["ok"]]


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
    # (the 800 bill itself is >= threshold, so it needs a second approver before it can be paid)
    assert _approve_as(env, big["journal_id"]).status_code == 200
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


# ─────────────────────── lifecycle and maker-checker (FEAT-002) ───────────────────────


def _reverse_journal(env, journal_id):
    return env.client.post(f"/api/v1/gl/journals/{journal_id}/reverse", json={"reason": "storno test"})


def test_bill_journal_reverse_is_document_managed(env):
    doc = _bill(env, number="B-REV")
    r = _reverse_journal(env, doc["journal_id"])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "document_managed"
    detail = _detail(env, doc["id"])
    assert detail["status"] == "open" and detail["open"] == "100.00"
    with env.Session() as s:
        assert s.query(GLJournal).filter(GLJournal.reversal_of_id == doc["journal_id"]).count() == 0


def test_payment_journal_reverse_is_document_managed(env):
    doc = _bill(env, number="B-REV-PAY")
    pay = _pay(env, doc["id"], "40.00", "rev-pay-0001").json()
    r = _reverse_journal(env, pay["journal_id"])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "document_managed"
    detail = _detail(env, doc["id"])
    assert detail["open"] == "60.00" and len(detail["allocations"]) == 1
    with env.Session() as s:
        assert s.query(GLJournal).filter(GLJournal.reversal_of_id == pay["journal_id"]).count() == 0


def test_manager_bill_pending_until_admin_approves(env):
    _as(env, "mgr", "manager")
    doc = _bill(env, number="B-MGR", total="50.00")
    assert doc["status"] == "pending_approval" and doc["open"] == "0.00" and doc["journal_status"] == "pending_approval"
    early = _pay(env, doc["id"], "10.00", "mgr-early-0001")
    assert early.status_code == 409 and early.json()["detail"]["code"] == "invalid_status"
    assert env.client.post(f"/api/v1/gl/journals/{doc['journal_id']}/approve").status_code == 403
    _as(env, "owner", "admin")
    assert env.client.post(f"/api/v1/gl/journals/{doc['journal_id']}/approve").status_code == 200
    detail = _detail(env, doc["id"])
    assert detail["status"] == "open" and detail["open"] == "50.00" and detail["journal_status"] == "posted"

    # An approver's huge bill (>= large-transfer threshold) is pending too, and the maker cannot approve it.
    big = _bill(env, number="B-HUGE", total="1000000.00")
    assert big["status"] == "pending_approval"
    self_approve = env.client.post(f"/api/v1/gl/journals/{big['journal_id']}/approve")
    assert self_approve.status_code == 403 and self_approve.json()["detail"]["code"] == "self_approval"
    _as(env, "cfo", "finance_admin")
    assert env.client.post(f"/api/v1/gl/journals/{big['journal_id']}/reject", json={"reason": "yanlış məbləğ"}).status_code == 200
    detail = _detail(env, big["id"])
    assert detail["status"] == "rejected" and detail["open"] == "0.00"
    assert _sup_balance(env) == "50.00"
    _reconciled(env)


def test_void_completes_only_after_other_user_approves(env):
    doc = _bill(env, number="B-VOID")
    r = env.client.post(f"/api/v1/gl/documents/{doc['id']}/void", json={"reason": "Səhv faktura"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "open" and body["open"] == "100.00" and body["pending_void_journal_id"]
    storno_id = body["pending_void_journal_id"]
    self_approve = env.client.post(f"/api/v1/gl/journals/{storno_id}/approve")
    assert self_approve.status_code == 403 and self_approve.json()["detail"]["code"] == "self_approval"
    assert _detail(env, doc["id"])["status"] == "open"
    again = env.client.post(f"/api/v1/gl/documents/{doc['id']}/void", json={"reason": "Səhv faktura"})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "void_pending"
    assert _approve_as(env, storno_id).json()["status"] == "posted"
    detail = _detail(env, doc["id"])
    assert detail["status"] == "void" and detail["open"] == "0.00" and detail["pending_void_journal_id"] is None
    assert _sup_balance(env) == "0.00"
    done = env.client.post(f"/api/v1/gl/documents/{doc['id']}/void", json={"reason": "Səhv faktura"})
    assert done.status_code == 409 and done.json()["detail"]["code"] == "already_void"
    _reconciled(env)


def test_void_rejected_keeps_bill_open_http(env):
    doc = _bill(env, number="B-VOID-REJ")
    storno_id = env.client.post(f"/api/v1/gl/documents/{doc['id']}/void", json={"reason": "Səhv faktura"}).json()["pending_void_journal_id"]
    _as(env, "cfo", "finance_admin")
    assert env.client.post(f"/api/v1/gl/journals/{storno_id}/reject", json={"reason": "faktura düzgündür"}).status_code == 200
    detail = _detail(env, doc["id"])
    assert detail["status"] == "open" and detail["open"] == "100.00" and detail["pending_void_journal_id"] is None
    assert _pay(env, doc["id"], "10.00", "after-reject-01").json()["journal_status"] == "posted"


def test_paid_bill_can_be_unwound_and_voided(env):
    doc = _bill(env, number="B-UNWIND", total="100.00")
    pay = _pay(env, doc["id"], "100.00", "unwind-pay-0001").json()
    assert pay["status"] == "paid"
    blocked = env.client.post(f"/api/v1/gl/documents/{doc['id']}/void", json={"reason": "Səhv faktura"})
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "document_has_allocations"

    r = env.client.post(f"/api/v1/gl/documents/{doc['id']}/payments/{pay['journal_id']}/reverse", json={"reason": "Səhv ödəniş"})
    assert r.status_code == 200, r.text
    rev = r.json()
    assert rev["journal_status"] == "pending_approval" and rev["reversal_of_id"] == pay["journal_id"]
    assert rev["document_id"] == doc["id"]
    assert _detail(env, doc["id"])["status"] == "paid"
    assert _approve_as(env, rev["journal_id"]).status_code == 200
    detail = _detail(env, doc["id"])
    assert detail["status"] == "open" and detail["open"] == "100.00"
    assert sorted(a["amount"] for a in detail["allocations"]) == ["-100.00", "100.00"]
    assert _sup_balance(env) == "100.00"  # Σopen == subledger partner balance
    _reconciled(env)

    storno_id = env.client.post(f"/api/v1/gl/documents/{doc['id']}/void", json={"reason": "Səhv faktura"}).json()["pending_void_journal_id"]
    assert _approve_as(env, storno_id).status_code == 200
    detail = _detail(env, doc["id"])
    assert detail["status"] == "void" and detail["open"] == "0.00"
    assert _sup_balance(env) == "0.00"
    _reconciled(env)
    with env.Session() as s:
        assert gl.verify_audit_chain(s, env.tenant_id)["valid"]


def test_payment_reversal_needs_second_person(env):
    doc = _bill(env, number="B-REVPAY", total="100.00")
    pay = _pay(env, doc["id"], "60.00", "revpay-0001").json()
    url = f"/api/v1/gl/documents/{doc['id']}/payments/{pay['journal_id']}/reverse"
    rev = env.client.post(url, json={"reason": "Səhv ödəniş"}).json()
    assert rev["journal_status"] == "pending_approval"
    dup = env.client.post(url, json={"reason": "Səhv ödəniş"})
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "reversal_pending"
    self_approve = env.client.post(f"/api/v1/gl/journals/{rev['journal_id']}/approve")
    assert self_approve.status_code == 403 and self_approve.json()["detail"]["code"] == "self_approval"
    _as(env, "acc", "accountant")
    assert env.client.post(f"/api/v1/gl/journals/{rev['journal_id']}/approve").status_code == 403  # not an approver role
    assert env.client.post(url, json={"reason": "x"}).status_code == 422  # reason too short
    _as(env, "owner", "admin")
    assert _detail(env, doc["id"])["open"] == "40.00"
    assert _approve_as(env, rev["journal_id"]).status_code == 200
    assert _detail(env, doc["id"])["open"] == "100.00"
    other = _bill(env, number="B-REVPAY-2")
    wrong = env.client.post(f"/api/v1/gl/documents/{other['id']}/payments/{pay['journal_id']}/reverse", json={"reason": "Səhv ödəniş"})
    assert wrong.status_code == 404 and wrong.json()["detail"]["code"] == "payment_not_found"


def test_reclass_http_always_pending(env):
    with env.Session() as s:
        gl.create_journal(s, tenant_id=env.tenant_id, journal_type="purchase", created_by="legacy-sync",
                          posting_date=gl.business_today(), description="Legacy unassigned restock",
                          lines=[gl.LineIn(account="inventory", debit="40"), gl.LineIn(account="accounts_payable", credit="40")])
        s.commit()
    body = {"amount": "40.00", "to_supplier_id": "sup-1", "reason": "Faktura yoxlanıldı"}
    r = env.client.post("/api/v1/gl/documents/reclassify-unassigned", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending_approval"
    over = env.client.post("/api/v1/gl/documents/reclassify-unassigned", json={**body, "amount": "0.01"})
    assert over.status_code == 409 and over.json()["detail"]["code"] == "reclass_exceeds_unassigned"
    ghost = env.client.post("/api/v1/gl/documents/reclassify-unassigned", json={**body, "to_supplier_id": "sup-ghost"})
    assert ghost.status_code == 404 and ghost.json()["detail"]["code"] == "supplier_not_found"
    assert _approve_as(env, r.json()["journal_id"]).status_code == 200
    assert _sup_balance(env) == "40.00"


def test_ar_kind_rejected_422(env):
    _bill(env, number="B-AP")
    assert env.client.get("/api/v1/gl/documents", params={"kind": "ar_invoice"}).status_code == 422
    assert env.client.get("/api/v1/gl/documents", params={"kind": "ap_bill"}).json()["total"] == 1
    body = env.client.get("/api/v1/gl/documents").json()
    assert body["total"] == 1 and body["summary"]["total_billed"] == "100.00"


def test_list_filters_over_http(env):
    _bill(env, number="B-SEARCH-1")
    _bill(env, number="B-OTHER-2")
    r = env.client.get("/api/v1/gl/documents", params={"search": "search", "overdue_only": "false", "limit": 1})
    assert r.status_code == 200 and [d["number"] for d in r.json()["items"]] == ["B-SEARCH-1"]


def test_gl_suppliers_endpoint_tenant_scoped_and_readable_by_accountant(env):
    with env.Session() as s:
        other = str(uuid.uuid4())
        s.add(Tenant(id=other, name="O", slug="o", domain="o.test", status="active"))
        s.add(Supplier(id="sup-other", tenant_id=other, name="Başqa tenant"))
        s.add(Supplier(id="sup-2", tenant_id=env.tenant_id, name="Abşeron Un"))
        s.commit()
    for username, role in (("acc", "accountant"), ("aud", "auditor"), ("mgr", "manager")):
        _as(env, username, role)
        r = env.client.get("/api/v1/gl/suppliers")
        assert r.status_code == 200, (role, r.text)
        assert r.json() == [{"id": "sup-2", "name": "Abşeron Un"}, {"id": "sup-1", "name": "Bakı Qida MMC"}]
    _as(env, "waiter", "waiter")
    assert env.client.get("/api/v1/gl/suppliers").status_code == 403
