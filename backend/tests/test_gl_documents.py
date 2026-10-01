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
from app.gl.models import GLDocumentAllocation, GLJournal, GLJournalLine
from app.gl.posting_rules import SupplierPaid, post_event
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

    # 2. Try overpaying (e.g. 350 when 300 is open) -> rejected with 409 (owner decision F15)
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="350.00", paid_from="cash_drawer", posting_date=date(2026, 9, 16))
    assert exc.value.code == "overpayment_not_allowed"
    assert exc.value.status_code == 409

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


# ─────────────────────────── payment safety (FEAT-001) ───────────────────────────


def _bill(db, tid, number, total="100.00", *, partner="sup-1", issue=date(2026, 9, 10), due=date(2026, 9, 25)):
    return create_bill(db, tid, partner_id=partner, number=number, issue_date=issue, due_date=due, total=total, actor="admin-1")


def _payment_journals(db, tid, doc_id):
    return (
        db.query(GLJournal)
        .filter(GLJournal.tenant_id == tid, GLJournal.source_type == "document_payment", GLJournal.source_id == doc_id)
        .all()
    )


def _allocs(db, tid, doc_id):
    return db.query(GLDocumentAllocation).filter(GLDocumentAllocation.tenant_id == tid, GLDocumentAllocation.document_id == doc_id).all()


def test_pay_bill_same_key_replays_once(db, tid):
    bill = _bill(db, tid, "INV-REPLAY")
    first = pay_bill(db, tid, bill.id, amount="40.00", paid_from="cash_drawer", posting_date=date(2026, 9, 15), idempotency_key="key-0001")
    again = pay_bill(db, tid, bill.id, amount="40.00", paid_from="cash_drawer", posting_date=date(2026, 9, 15), idempotency_key="key-0001")
    assert first["replayed"] is False and again["replayed"] is True
    assert again["journal_no"] == first["journal_no"] and again["journal_id"] == first["journal_id"]
    assert len(_payment_journals(db, tid, bill.id)) == 1
    assert len(_allocs(db, tid, bill.id)) == 1
    assert get_document_open_balance(db, tid, bill.id) == D("60.00")
    assert again["remaining_open"] == "60.00" and again["status"] == "partially_paid"


def test_pay_bill_same_key_different_amount_conflicts(db, tid):
    bill = _bill(db, tid, "INV-CONFLICT")
    pay_bill(db, tid, bill.id, amount="40.00", paid_from="cash_drawer", posting_date=date(2026, 9, 15), idempotency_key="key-0002")
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="41.00", paid_from="cash_drawer", posting_date=date(2026, 9, 15), idempotency_key="key-0002")
    assert exc.value.code == "idempotency_conflict" and exc.value.status_code == 409
    assert len(_payment_journals(db, tid, bill.id)) == 1


def test_overpayment_rejected_409_with_clear_message(db, tid):
    bill = _bill(db, tid, "INV-OVER")
    pay_bill(db, tid, bill.id, amount="70.00", paid_from="cash_drawer", posting_date=date(2026, 9, 15))
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="30.01", paid_from="cash_drawer", posting_date=date(2026, 9, 16))
    assert exc.value.code == "overpayment_not_allowed" and exc.value.status_code == 409
    assert "30.00" in exc.value.message and "INV-OVER" in exc.value.message
    # A fully paid bill reports the same, explicit reason.
    pay_bill(db, tid, bill.id, amount="30.00", paid_from="cash_drawer", posting_date=date(2026, 9, 16))
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="1.00", paid_from="cash_drawer", posting_date=date(2026, 9, 17))
    assert exc.value.code == "overpayment_not_allowed" and "0.00" in exc.value.message


def test_payment_before_issue_rejected(db, tid):
    bill = _bill(db, tid, "INV-EARLY", issue=date(2026, 9, 10))
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="10.00", paid_from="cash_drawer", posting_date=date(2026, 9, 9))
    assert exc.value.code == "payment_before_issue" and exc.value.status_code == 400
    assert not _payment_journals(db, tid, bill.id)


def test_pay_bill_rejects_sub_cent(db, tid):
    bill = _bill(db, tid, "INV-CENT")
    for bad in ("10.005", "NaN"):
        with pytest.raises(GLError) as exc:
            pay_bill(db, tid, bill.id, amount=bad, paid_from="cash_drawer", posting_date=date(2026, 9, 15))
        assert exc.value.code == "invalid_amount"
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="10.00", bank_fee="0.001", paid_from="bank_main", posting_date=date(2026, 9, 15))
    assert exc.value.code == "invalid_amount"
    assert not _payment_journals(db, tid, bill.id)


def test_payment_note_persisted(db, tid):
    bill = _bill(db, tid, "INV-NOTE")
    res = pay_bill(db, tid, bill.id, amount="25.00", paid_from="cash_drawer", posting_date=date(2026, 9, 15), note="Qəbz 77")
    journal = db.query(GLJournal).filter(GLJournal.id == res["journal_id"]).one()
    assert "Qəbz 77" in journal.description
    ap = gl.accounts_by_role(db, tid)["accounts_payable"]
    ap_line = db.query(GLJournalLine).filter(GLJournalLine.journal_id == journal.id, GLJournalLine.account_id == ap.id).one()
    assert "Qəbz 77" in ap_line.memo


def test_allocate_named_then_fifo(db, tid):
    named = _bill(db, tid, "NAMED", total="50.00", due=date(2026, 9, 20))
    earliest = _bill(db, tid, "EARLY-DUE", total="100.00", due=date(2026, 9, 15))
    later = _bill(db, tid, "LATE-DUE", total="100.00", due=date(2026, 9, 25))
    journal = post_event(db, tid, SupplierPaid("pay-fifo", date(2026, 9, 16), "sup-1", "80.00", "cash"), actor="admin-1")
    ap = gl.accounts_by_role(db, tid)["accounts_payable"]
    ap_line_no = db.query(GLJournalLine.line_no).filter(GLJournalLine.journal_id == journal.id, GLJournalLine.account_id == ap.id).scalar()
    documents.allocate_payment(db, tid, payment_journal_id=journal.id, journal_line_no=ap_line_no, partner_id="sup-1",
                               amount="80.00", document_ids=[named.id])
    assert get_document_open_balance(db, tid, named.id) == D("0.00") and named.status == "paid"
    assert get_document_open_balance(db, tid, earliest.id) == D("70.00") and earliest.status == "partially_paid"
    assert get_document_open_balance(db, tid, later.id) == D("100.00") and later.status == "open"
    assert all(a.journal_line_no == ap_line_no for a in _allocs(db, tid, named.id) + _allocs(db, tid, earliest.id))


def test_bill_payment_journal_is_gl_only(db, tid):
    bill = _bill(db, tid, "INV-GLONLY")
    res = pay_bill(db, tid, bill.id, amount="10.00", paid_from="cash_drawer", posting_date=date(2026, 9, 15), idempotency_key="key-gl-only")
    journal = db.query(GLJournal).filter(GLJournal.id == res["journal_id"]).one()
    assert journal.source_module == "gl"
    assert journal.source_type == "document_payment" and journal.source_id == bill.id
    assert journal.idempotency_key == f"supplier_payment:bill:{bill.id}:key-gl-only"
    assert res["journal_status"] == "posted"
    ap = gl.accounts_by_role(db, tid)["accounts_payable"]
    ap_line_no = db.query(GLJournalLine.line_no).filter(GLJournalLine.journal_id == journal.id, GLJournalLine.account_id == ap.id).scalar()
    assert [a.journal_line_no for a in _allocs(db, tid, bill.id)] == [ap_line_no]


def test_approval_hook_rechecks_open_balance(db, tid):
    bill = _bill(db, tid, "INV-HOOK", total="100.00")
    res = pay_bill(db, tid, bill.id, amount="60.00", paid_from="cash_drawer", posting_date=date(2026, 9, 15),
                   actor="mgr", require_approval=True)
    assert res["journal_status"] == "pending_approval" and res["allocations_count"] == 0
    # Something settled the bill outside the pay path while the payment waited for approval.
    other = post_event(db, tid, SupplierPaid("outside", date(2026, 9, 15), "sup-1", "50.00", "cash"), actor="admin-1")
    db.add(GLDocumentAllocation(tenant_id=tid, document_id=bill.id, journal_id=other.id, journal_line_no=1, amount=D("50.00")))
    db.flush()
    journal = gl.approve_journal(db, tid, res["journal_id"], approver="admin-1")
    with pytest.raises(GLError) as exc:
        documents.after_journal_approved(db, tid, journal)
    assert exc.value.code == "overpayment_not_allowed" and exc.value.status_code == 409


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
        "amount": "250.00",
        "paid_from": "cash_drawer",
        "posting_date": "2026-09-15",
        "idempotency_key": "pay-api-101-1",
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

