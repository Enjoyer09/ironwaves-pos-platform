"""Unit tests for GL documents (AP bills, AR invoices, allocations, unassigned AP reclass)."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import documents, engine as gl
from app.gl.documents import (
    create_bill,
    get_document_detail,
    get_document_open_balance,
    list_documents,
    pay_bill,
    reclassify_unassigned_ap,
    void_document,
)
from app.gl.engine import GLError, LineIn
from app.gl.subledger import subledger
from app.models import Supplier, Tenant

D = Decimal


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", future=True, connect_args={"check_same_thread": False}, poolclass=StaticPool)

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


@pytest.fixture()
def tid(db):
    t = str(uuid.uuid4())
    db.add(Tenant(id=t, name="T", slug=f"t-{t[:8]}", domain=f"{t[:8]}.test", status="active"))
    db.add(Supplier(id="sup-1", tenant_id=t, name="Bakı Qida MMC"))
    db.add(Supplier(id="sup-2", tenant_id=t, name="Xəzər Süd"))
    db.flush()
    gl.ensure_chart(db, t)
    # Seed cash drawer so payments can be made
    gl.create_journal(
        db,
        tenant_id=t,
        journal_type="general",
        created_by="init",
        posting_date=date(2026, 9, 1),
        description="Capital injection",
        lines=[
            LineIn(account="cash_drawer", debit=D("10000"), credit=D("0")),
            LineIn(account="share_capital", debit=D("0"), credit=D("10000")),
        ],
    )
    return t


def test_create_bill_success(db, tid):
    bill = create_bill(
        db,
        tid,
        partner_id="sup-1",
        number="INV-2026-001",
        issue_date=date(2026, 9, 10),
        due_date=date(2026, 9, 25),
        total="450.00",
        note="Fresh ingredients",
        actor="accountant-1",
    )
    assert bill.id is not None
    assert bill.status == "open"
    assert bill.total == D("450.00")
    assert bill.journal_id is not None

    # Check open balance
    open_bal = get_document_open_balance(db, tid, bill.id)
    assert open_bal == D("450.00")

    # Check detail
    detail = get_document_detail(db, tid, bill.id)
    assert detail["partner_name"] == "Bakı Qida MMC"
    assert detail["open"] == "450.00"
    assert detail["status"] == "open"


def test_create_bill_validations(db, tid):
    # Missing supplier
    with pytest.raises(GLError) as exc:
        create_bill(db, tid, partner_id="", number="INV-1", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20), total="100")
    assert exc.value.code == "partner_required"

    # Missing number
    with pytest.raises(GLError) as exc:
        create_bill(db, tid, partner_id="sup-1", number="", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20), total="100")
    assert exc.value.code == "number_required"

    # Invalid due date
    with pytest.raises(GLError) as exc:
        create_bill(db, tid, partner_id="sup-1", number="INV-1", issue_date=date(2026, 9, 20), due_date=date(2026, 9, 10), total="100")
    assert exc.value.code == "invalid_due_date"

    # Invalid total <= 0
    with pytest.raises(GLError) as exc:
        create_bill(db, tid, partner_id="sup-1", number="INV-1", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20), total="0")
    assert exc.value.code == "invalid_amount"

    # Duplicate bill number for same supplier
    create_bill(db, tid, partner_id="sup-1", number="INV-DUP", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20), total="100")
    with pytest.raises(GLError) as exc:
        create_bill(db, tid, partner_id="sup-1", number="INV-DUP", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20), total="100")
    assert exc.value.code == "duplicate_bill"


def test_pay_bill_partial_and_full(db, tid):
    bill = create_bill(
        db,
        tid,
        partner_id="sup-1",
        number="INV-PARTIAL",
        issue_date=date(2026, 9, 10),
        due_date=date(2026, 9, 25),
        total="500.00",
    )

    # 1. Partial payment of 200
    res1 = pay_bill(db, tid, bill.id, amount="200.00", paid_from="cash_drawer", posting_date=date(2026, 9, 15))
    assert res1["status"] == "partially_paid"
    assert res1["remaining_open"] == "300.00"
    assert get_document_open_balance(db, tid, bill.id) == D("300.00")

    # 2. Try overpaying (e.g. 350 when 300 is open) -> raises error
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="350.00", paid_from="cash_drawer", posting_date=date(2026, 9, 16))
    assert exc.value.code == "overpayment_not_allowed"

    # 3. Pay remaining 300 -> status becomes paid
    res2 = pay_bill(db, tid, bill.id, amount="300.00", paid_from="cash_drawer", posting_date=date(2026, 9, 20))
    assert res2["status"] == "paid"
    assert res2["remaining_open"] == "0.00"
    assert get_document_open_balance(db, tid, bill.id) == D("0.00")

    detail = get_document_detail(db, tid, bill.id)
    assert detail["status"] == "paid"
    assert len(detail["allocations"]) == 2
    assert detail["allocations"][0]["amount"] == "200.00"
    assert detail["allocations"][1]["amount"] == "300.00"


def test_void_bill_reverses_journal(db, tid):
    bill = create_bill(
        db,
        tid,
        partner_id="sup-1",
        number="INV-VOID",
        issue_date=date(2026, 9, 10),
        due_date=date(2026, 9, 25),
        total="250.00",
    )
    assert bill.status == "open"

    # Voiding succeeds when no allocations exist
    voided = void_document(db, tid, bill.id, actor="admin-1", reason="Wrong invoice")
    assert voided.status == "void"
    assert get_document_open_balance(db, tid, bill.id) == D("0.00")

    # Trying to void already void document raises error
    with pytest.raises(GLError) as exc:
        void_document(db, tid, bill.id)
    assert exc.value.code == "already_void"


def test_void_bill_with_allocations_blocked(db, tid):
    bill = create_bill(
        db,
        tid,
        partner_id="sup-1",
        number="INV-BLOCKED",
        issue_date=date(2026, 9, 10),
        due_date=date(2026, 9, 25),
        total="300.00",
    )
    pay_bill(db, tid, bill.id, amount="100.00", paid_from="cash_drawer")

    # Voiding must be rejected because payment allocations exist
    with pytest.raises(GLError) as exc:
        void_document(db, tid, bill.id)
    assert exc.value.code == "document_has_allocations"


def test_reclassify_unassigned_ap(db, tid):
    # Create an unassigned AP entry (like historical legacy restocks without supplier)
    gl.create_journal(
        db,
        tenant_id=tid,
        journal_type="purchase",
        created_by="legacy-sync",
        posting_date=date(2026, 8, 1),
        description="Legacy restock without supplier",
        lines=[
            LineIn(account="inventory", debit=D("500"), credit=D("0")),
            LineIn(account="accounts_payable", debit=D("0"), credit=D("500"), partner_type=None, partner_id=None),
        ],
    )

    # Check initial subledger: unassigned_balance is 500
    sub_before = subledger(db, tid, "ap", as_of=date(2026, 8, 15))
    assert sub_before["unassigned_balance"] == "500.00"
    assert sub_before["reconciled"] is True

    # Reclassify 500 to sup-2 (Xəzər Süd)
    res = reclassify_unassigned_ap(
        db,
        tid,
        amount="500.00",
        to_supplier_id="sup-2",
        actor="controller-1",
        reason="Assigned after supplier invoice review",
        posting_date=date(2026, 8, 10),
    )
    assert res["amount"] == "500.00"
    assert res["to_supplier_id"] == "sup-2"

    # Check subledger after reclassification:
    # Unassigned balance is now 0.00, and sup-2 has balance 500.00!
    sub_after = subledger(db, tid, "ap", as_of=date(2026, 8, 15))
    assert sub_after["unassigned_balance"] == "0.00"
    sup2_row = next(r for r in sub_after["partners"] if r["partner_id"] == "sup-2")
    assert sup2_row["balance"] == "500.00"
    assert sub_after["reconciled"] is True


def test_list_documents_filtering(db, tid):
    create_bill(db, tid, partner_id="sup-1", number="B-1", issue_date=date(2026, 9, 1), due_date=date(2026, 9, 10), total="100")
    create_bill(db, tid, partner_id="sup-2", number="B-2", issue_date=date(2026, 9, 5), due_date=date(2026, 9, 20), total="200")

    all_docs = list_documents(db, tid)
    assert all_docs["total"] == 2

    sup1_docs = list_documents(db, tid, partner_id="sup-1")
    assert sup1_docs["total"] == 1
    assert sup1_docs["items"][0]["number"] == "B-1"


def test_documents_api_full_flow(monkeypatch):
    """End-to-end HTTP API tests for /api/v1/gl/documents endpoints."""
    from types import SimpleNamespace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.core.config import settings
    from app.db import get_db
    from app.deps import get_current_user, get_tenant
    from app.gl import router as gl_router

    engine = create_engine("sqlite://", future=True, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    tenant_id = str(uuid.uuid4())
    with Session() as s:
        s.add(Tenant(id=tenant_id, name="Test Tenant", slug="tt", domain="tt.test", status="active"))
        s.add(Supplier(id="sup-api-1", tenant_id=tenant_id, name="Test Supplier API"))
        s.commit()

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
    api.dependency_overrides[get_current_user] = lambda: SimpleNamespace(username="admin", role="admin")
    monkeypatch.setattr(settings, "finance_v2_enabled", True)

    client = TestClient(api)

    # 1. Setup chart
    r = client.post("/api/v1/gl/setup")
    assert r.status_code == 200

    # Fund cash drawer
    with Session() as s:
        gl.create_journal(
            s,
            tenant_id=tenant_id,
            journal_type="general",
            created_by="init",
            posting_date=date(2026, 9, 1),
            description="Initial funding",
            lines=[
                LineIn(account="cash_drawer", debit=D("5000"), credit=D("0")),
                LineIn(account="share_capital", debit=D("0"), credit=D("5000")),
            ],
        )
        s.commit()

    # 2. POST /documents/bills
    bill_payload = {
        "partner_id": "sup-api-1",
        "number": "BILL-API-101",
        "issue_date": "2026-09-10",
        "due_date": "2026-09-25",
        "total": 600.0,
        "note": "Ingredients order",
    }
    r = client.post("/api/v1/gl/documents/bills", json=bill_payload)
    assert r.status_code == 200
    doc_data = r.json()
    doc_id = doc_data["id"]
    assert doc_data["number"] == "BILL-API-101"
    assert doc_data["status"] == "open"
    assert doc_data["open"] == "600.00"

    # 3. GET /documents
    r = client.get("/api/v1/gl/documents")
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["id"] == doc_id

    # 4. GET /documents/{id}
    r = client.get(f"/api/v1/gl/documents/{doc_id}")
    assert r.status_code == 200
    assert r.json()["id"] == doc_id
    assert r.json()["partner_name"] == "Test Supplier API"

    # 5. POST /documents/{id}/pay (partial payment 250)
    pay_payload = {
        "amount": 250.0,
        "paid_from": "cash_drawer",
        "posting_date": "2026-09-15",
    }
    r = client.post(f"/api/v1/gl/documents/{doc_id}/pay", json=pay_payload)
    assert r.status_code == 200
    pay_res = r.json()
    assert pay_res["status"] == "partially_paid"
    assert pay_res["remaining_open"] == "350.00"

    # 6. Check detail again
    r = client.get(f"/api/v1/gl/documents/{doc_id}")
    assert r.status_code == 200
    assert r.json()["status"] == "partially_paid"
    assert r.json()["open"] == "350.00"
    assert len(r.json()["allocations"]) == 1

    # 7. Try voiding bill with payment allocations -> 409
    r = client.post(f"/api/v1/gl/documents/{doc_id}/void", json={"reason": "Cannot void"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "document_has_allocations"

    # 8. POST /documents/reclassify-unassigned
    with Session() as s:
        gl.create_journal(
            s,
            tenant_id=tenant_id,
            journal_type="purchase",
            created_by="legacy-sync",
            posting_date=date(2026, 8, 1),
            description="Legacy unassigned restock",
            lines=[
                LineIn(account="inventory", debit=D("300"), credit=D("0")),
                LineIn(account="accounts_payable", debit=D("0"), credit=D("300"), partner_type=None, partner_id=None),
            ],
        )
        s.commit()

    reclass_payload = {
        "amount": 300.0,
        "to_supplier_id": "sup-api-1",
        "reason": "Assigning historical restock",
        "posting_date": "2026-09-10",
    }
    r = client.post("/api/v1/gl/documents/reclassify-unassigned", json=reclass_payload)
    assert r.status_code == 200
    assert r.json()["amount"] == "300.00"
    assert r.json()["to_supplier_id"] == "sup-api-1"

