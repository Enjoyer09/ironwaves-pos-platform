"""Unit tests for GL documents (AP bills, AR invoices, allocations, unassigned AP reclass)."""
from __future__ import annotations

import uuid
from datetime import date, timedelta
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
from app.gl.models import GLAccount, GLDocument, GLDocumentAllocation, GLJournal, GLJournalLine
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
            LineIn(account="bank_main", debit=D("10000"), credit=D("0")),
            LineIn(account="safe", debit=D("1000"), credit=D("0")),
            LineIn(account="share_capital", debit=D("0"), credit=D("21000")),
        ],
    )
    return t


def _approve(db, tid, journal_id, approver="checker-1"):
    """What POST /journals/{id}/approve does: approve, then the document hook, same transaction."""
    journal = gl.approve_journal(db, tid, journal_id, approver=approver)
    documents.after_journal_approved(db, tid, journal)
    return journal


def _reject(db, tid, journal_id, actor="checker-1"):
    journal = gl.reject_journal(db, tid, journal_id, actor=actor, reason="yanlışdır")
    documents.after_journal_rejected(db, tid, journal)
    return journal


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
    res1 = pay_bill(db, tid, bill.id, amount="200.00", paid_from="bank_main", posting_date=date(2026, 9, 15))
    assert res1["status"] == "partially_paid"
    assert res1["remaining_open"] == "300.00"
    assert get_document_open_balance(db, tid, bill.id) == D("300.00")

    # 2. Try overpaying (e.g. 350 when 300 is open) -> rejected with 409 (owner decision F15)
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="350.00", paid_from="bank_main", posting_date=date(2026, 9, 16))
    assert exc.value.code == "overpayment_not_allowed"
    assert exc.value.status_code == 409

    # 3. Pay remaining 300 -> status becomes paid
    res2 = pay_bill(db, tid, bill.id, amount="300.00", paid_from="bank_main", posting_date=date(2026, 9, 20))
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

    # Step 1: the void request only creates a pending storno; the bill stays open (maker-checker).
    requested = void_document(db, tid, bill.id, actor="admin-1", reason="Wrong invoice")
    assert requested.status == "open"
    storno_id = get_document_detail(db, tid, bill.id)["pending_void_journal_id"]
    assert storno_id
    # Step 2: a second person approves the storno; only then is the bill void.
    _approve(db, tid, storno_id)
    assert bill.status == "void"
    assert get_document_open_balance(db, tid, bill.id) == D("0.00")
    original = db.query(GLJournal).filter(GLJournal.id == bill.journal_id).one()
    assert original.reversed_by_id == storno_id

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
    pay_bill(db, tid, bill.id, amount="100.00", paid_from="bank_main")

    # Voiding must be rejected because payment allocations exist (net, not row count)
    with pytest.raises(GLError) as exc:
        void_document(db, tid, bill.id)
    assert exc.value.code == "document_has_allocations"

    # A payment still waiting for approval blocks the void as well.
    other = _bill(db, tid, "INV-PENDING-PAY", total="50.00")
    pay_bill(db, tid, other.id, amount="20.00", paid_from="bank_main", posting_date=date(2026, 9, 15), actor="mgr",
             require_approval=True)
    with pytest.raises(GLError) as exc:
        void_document(db, tid, other.id)
    assert exc.value.code == "payment_pending" and exc.value.status_code == 409


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
    # Reclass is always owner-approved: nothing moves until a second person approves it.
    assert res["status"] == "pending_approval" and res["journal_id"]
    assert subledger(db, tid, "ap", as_of=date(2026, 8, 15))["unassigned_balance"] == "500.00"
    _approve(db, tid, res["journal_id"])

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
    first = pay_bill(db, tid, bill.id, amount="40.00", paid_from="bank_main", posting_date=date(2026, 9, 15), idempotency_key="key-0001")
    again = pay_bill(db, tid, bill.id, amount="40.00", paid_from="bank_main", posting_date=date(2026, 9, 15), idempotency_key="key-0001")
    assert first["replayed"] is False and again["replayed"] is True
    assert again["journal_no"] == first["journal_no"] and again["journal_id"] == first["journal_id"]
    assert len(_payment_journals(db, tid, bill.id)) == 1
    assert len(_allocs(db, tid, bill.id)) == 1
    assert get_document_open_balance(db, tid, bill.id) == D("60.00")
    assert again["remaining_open"] == "60.00" and again["status"] == "partially_paid"


def test_pay_bill_same_key_different_amount_conflicts(db, tid):
    bill = _bill(db, tid, "INV-CONFLICT")
    pay_bill(db, tid, bill.id, amount="40.00", paid_from="bank_main", posting_date=date(2026, 9, 15), idempotency_key="key-0002")
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="41.00", paid_from="bank_main", posting_date=date(2026, 9, 15), idempotency_key="key-0002")
    assert exc.value.code == "idempotency_conflict" and exc.value.status_code == 409
    assert len(_payment_journals(db, tid, bill.id)) == 1


def test_overpayment_rejected_409_with_clear_message(db, tid):
    bill = _bill(db, tid, "INV-OVER")
    pay_bill(db, tid, bill.id, amount="70.00", paid_from="bank_main", posting_date=date(2026, 9, 15))
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="30.01", paid_from="bank_main", posting_date=date(2026, 9, 16))
    assert exc.value.code == "overpayment_not_allowed" and exc.value.status_code == 409
    assert "30.00" in exc.value.message and "INV-OVER" in exc.value.message
    # A fully paid bill reports the same, explicit reason.
    pay_bill(db, tid, bill.id, amount="30.00", paid_from="bank_main", posting_date=date(2026, 9, 16))
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="1.00", paid_from="bank_main", posting_date=date(2026, 9, 17))
    assert exc.value.code == "overpayment_not_allowed" and "0.00" in exc.value.message


def test_payment_before_issue_rejected(db, tid):
    bill = _bill(db, tid, "INV-EARLY", issue=date(2026, 9, 10))
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="10.00", paid_from="bank_main", posting_date=date(2026, 9, 9))
    assert exc.value.code == "payment_before_issue" and exc.value.status_code == 400
    assert not _payment_journals(db, tid, bill.id)


def test_pay_bill_rejects_sub_cent(db, tid):
    bill = _bill(db, tid, "INV-CENT")
    for bad in ("10.005", "NaN"):
        with pytest.raises(GLError) as exc:
            pay_bill(db, tid, bill.id, amount=bad, paid_from="bank_main", posting_date=date(2026, 9, 15))
        assert exc.value.code == "invalid_amount"
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="10.00", bank_fee="0.001", paid_from="bank_main", posting_date=date(2026, 9, 15))
    assert exc.value.code == "invalid_amount"
    assert not _payment_journals(db, tid, bill.id)


def test_pay_bill_rejects_pos_drawer(db, tid):
    """R2 (owner decision): bills are paid from bank or safe only; the POS drawer is refused, nothing posts."""
    bill = _bill(db, tid, "INV-DRAWER")
    for wallet in ("cash_drawer", "cash", "card", ""):
        with pytest.raises(GLError) as exc:
            pay_bill(db, tid, bill.id, amount="10.00", paid_from=wallet, posting_date=date(2026, 9, 15), idempotency_key=f"drawer-{wallet}")
        assert exc.value.code == "wallet_not_allowed" and exc.value.status_code == 400
        assert "bank" in exc.value.message and "safe" in exc.value.message
    assert not _payment_journals(db, tid, bill.id) and bill.status == "open"
    for wallet in documents.BILL_PAY_WALLETS:
        assert pay_bill(db, tid, bill.id, amount="10.00", paid_from=wallet, posting_date=date(2026, 9, 15))["status"] == "partially_paid"


def test_payment_note_persisted(db, tid):
    bill = _bill(db, tid, "INV-NOTE")
    res = pay_bill(db, tid, bill.id, amount="25.00", paid_from="bank_main", posting_date=date(2026, 9, 15), note="Qəbz 77")
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
    res = pay_bill(db, tid, bill.id, amount="10.00", paid_from="bank_main", posting_date=date(2026, 9, 15), idempotency_key="key-gl-only")
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
    res = pay_bill(db, tid, bill.id, amount="60.00", paid_from="bank_main", posting_date=date(2026, 9, 15),
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


def _record_locks_and_posts(monkeypatch):
    """Spy on document row locks and journal posts, in call order (R1 lock order)."""
    calls: list = []
    real_lock, real_post = documents._lock_payable_documents, documents.post_event

    def lock(db, tenant_id, partner_id, *, kind="ap_bill", document_ids=None):
        calls.append(("lock", None if document_ids is None else tuple(document_ids)))
        return real_lock(db, tenant_id, partner_id, kind=kind, document_ids=document_ids)

    def post(*args, **kwargs):
        calls.append(("post", None))
        return real_post(*args, **kwargs)

    monkeypatch.setattr(documents, "_lock_payable_documents", lock)
    monkeypatch.setattr(documents, "post_event", post)
    return calls


def test_bill_payment_locks_only_its_bill(db, tid, monkeypatch):
    """R1: a bill payment must not sweep-lock the supplier's other bills after posting (PG deadlock)."""
    bill = _bill(db, tid, "INV-LOCK-A", total="50.00", due=date(2026, 9, 15))
    other = _bill(db, tid, "INV-LOCK-B", total="50.00", due=date(2026, 9, 12))
    calls = _record_locks_and_posts(monkeypatch)
    pay_bill(db, tid, bill.id, amount="50.00", paid_from="bank_main", posting_date=date(2026, 9, 16), idempotency_key="lock-a")
    assert calls and all(c == ("lock", (bill.id,)) for c in calls if c[0] == "lock"), calls
    assert get_document_open_balance(db, tid, other.id) == D("50.00") and _allocs(db, tid, other.id) == []


def test_bill_payment_approval_locks_only_its_bill(db, tid, monkeypatch):
    """R1: the approval hook of a pending bill payment allocates to (and locks) that bill only."""
    bill = _bill(db, tid, "INV-LOCK-C", total="50.00")
    _bill(db, tid, "INV-LOCK-D", total="50.00")
    res = pay_bill(db, tid, bill.id, amount="20.00", paid_from="bank_main", posting_date=date(2026, 9, 15),
                   actor="mgr", require_approval=True)
    calls = _record_locks_and_posts(monkeypatch)
    _approve(db, tid, res["journal_id"])
    assert [c for c in calls if c[0] == "lock"] == [("lock", (bill.id,))], calls
    assert get_document_open_balance(db, tid, bill.id) == D("30.00")


def test_fifo_payment_locks_bills_before_posting(db, tid, monkeypatch):
    """R1: a FIFO (legacy supplier) payment locks the supplier's payable bills BEFORE it posts."""
    first = _bill(db, tid, "INV-FIFO-1", total="30.00", due=date(2026, 9, 12))
    second = _bill(db, tid, "INV-FIFO-2", total="30.00", due=date(2026, 9, 20))
    calls = _record_locks_and_posts(monkeypatch)
    documents.post_supplier_payment(db, tid, SupplierPaid("fifo-lock", date(2026, 9, 16), "sup-1", "40.00", "cash"),
                                    actor="admin-1", source_module="pos")
    assert calls[0] == ("lock", None) and calls[1] == ("post", None), calls
    assert get_document_open_balance(db, tid, first.id) == D("0.00")
    assert get_document_open_balance(db, tid, second.id) == D("20.00")


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
                LineIn(account="bank_main", debit=D("5000"), credit=D("0")),
                LineIn(account="share_capital", debit=D("0"), credit=D("10000")),
            ],
        )
        s.commit()

    # 2. POST /documents/bills (below the 500 large-transfer threshold, so an admin bill posts directly)
    bill_payload = {
        "partner_id": "sup-api-1",
        "number": "BILL-API-101",
        "issue_date": "2026-09-10",
        "due_date": "2026-09-25",
        "total": 450.0,
        "note": "Ingredients order",
    }
    r = client.post("/api/v1/gl/documents/bills", json=bill_payload)
    assert r.status_code == 200
    doc_data = r.json()
    doc_id = doc_data["id"]
    assert doc_data["number"] == "BILL-API-101"
    assert doc_data["status"] == "open"
    assert doc_data["open"] == "450.00"

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

    # 5. POST /documents/{id}/pay (partial payment 250). The POS drawer is not a bill-pay wallet (R2).
    pay_payload = {
        "amount": "250.00",
        "paid_from": "cash_drawer",
        "posting_date": "2026-09-15",
        "idempotency_key": "pay-api-101-1",
    }
    r = client.post(f"/api/v1/gl/documents/{doc_id}/pay", json=pay_payload)
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "wallet_not_allowed"
    pay_payload["paid_from"] = "bank_main"
    r = client.post(f"/api/v1/gl/documents/{doc_id}/pay", json=pay_payload)
    assert r.status_code == 200
    pay_res = r.json()
    assert pay_res["status"] == "partially_paid"
    assert pay_res["remaining_open"] == "200.00"

    # 6. Check detail again
    r = client.get(f"/api/v1/gl/documents/{doc_id}")
    assert r.status_code == 200
    assert r.json()["status"] == "partially_paid"
    assert r.json()["open"] == "200.00"
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
    assert r.json()["status"] == "pending_approval"


# ─────────────────────── lifecycle, validation, maker-checker (FEAT-002) ───────────────────────


def _unassigned_ap(db, tid, amount, posting_date=date(2026, 8, 1)):
    """Historic AP without a supplier (like legacy restocks on credit)."""
    return gl.create_journal(
        db, tenant_id=tid, journal_type="purchase", created_by="legacy-sync", posting_date=posting_date,
        description="Legacy restock without supplier",
        lines=[LineIn(account="inventory", debit=D(amount), credit=D("0")),
               LineIn(account="accounts_payable", debit=D("0"), credit=D(amount))],
    )


def _source_journal(db, doc):
    return db.query(GLJournal).filter(GLJournal.id == doc.journal_id).one()


def _lines(db, journal):
    return (
        db.query(GLAccount.code, GLAccount.system_role, GLJournalLine.debit, GLJournalLine.credit, GLJournalLine.partner_id)
        .join(GLAccount, GLAccount.id == GLJournalLine.account_id)
        .filter(GLJournalLine.journal_id == journal.id)
        .order_by(GLJournalLine.line_no)
        .all()
    )


def _sup_balance(db, tid, supplier_id):
    row = next((r for r in subledger(db, tid, "ap")["partners"] if r["partner_id"] == supplier_id), None)
    return D(row["balance"]) if row else D("0.00")


def _doc_count(db, tid):
    return db.query(GLDocument).filter(GLDocument.tenant_id == tid).count()


def test_bill_unknown_or_foreign_supplier_rejected(db, tid):
    other = str(uuid.uuid4())
    db.add(Tenant(id=other, name="O", slug=f"o-{other[:8]}", domain=f"{other[:8]}.other", status="active"))
    db.add(Supplier(id="sup-foreign", tenant_id=other, name="Başqa tenant"))
    db.flush()
    for ghost in ("sup-ghost", "sup-foreign"):
        with pytest.raises(GLError) as exc:
            _bill(db, tid, f"INV-{ghost}", partner=ghost)
        assert exc.value.code == "supplier_not_found" and exc.value.status_code == 404
    assert _doc_count(db, tid) == 0
    assert db.query(GLJournal).filter(GLJournal.tenant_id == tid, GLJournal.source_type == "document").count() == 0


def test_bill_rejects_cash_and_ap_accounts(db, tid):
    for bad in ("cash_drawer", "bank_main", "accounts_payable", "531", "sales_revenue", "share_capital", "721", "no-such"):
        with pytest.raises(GLError) as exc:
            create_bill(db, tid, partner_id="sup-1", number=f"INV-{bad}", issue_date=date(2026, 9, 10),
                        due_date=date(2026, 9, 20), total="10.00", expense_account=bad)
        assert (exc.value.code, exc.value.status_code) == ("invalid_expense_account", 400), bad
    assert _doc_count(db, tid) == 0


def test_inventory_bill_uses_stock_received(db, tid):
    bill = _bill(db, tid, "INV-STOCK", total="120.00")
    journal = _source_journal(db, bill)
    assert journal.idempotency_key == f"stock:bill:{bill.id}"
    assert (journal.source_module, journal.source_type, journal.source_id) == ("gl", "document", bill.id)
    assert journal.status == "posted"
    assert [(r.system_role, D(r.debit), D(r.credit), r.partner_id) for r in _lines(db, journal)] == [
        ("inventory", D("120.00"), D("0.00"), None),
        ("accounts_payable", D("0.00"), D("120.00"), "sup-1"),
    ]
    # Inventory chosen by code goes through the same rule.
    by_code = create_bill(db, tid, partner_id="sup-1", number="INV-STOCK-2", issue_date=date(2026, 9, 10),
                          due_date=date(2026, 9, 20), total="5.00", expense_account="201")
    assert _source_journal(db, by_code).idempotency_key == f"stock:bill:{by_code.id}"


def test_expense_bill_uses_expense_paid(db, tid):
    bill = create_bill(db, tid, partner_id="sup-1", number="INV-RENT", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20),
                       total="300.00", expense_account="721.9", note="Oktyabr", actor="admin-1")
    journal = _source_journal(db, bill)
    assert journal.idempotency_key == f"expense:bill:{bill.id}"
    assert (journal.source_module, journal.source_type, journal.source_id) == ("gl", "document", bill.id)
    assert "INV-RENT" in journal.description and "Oktyabr" in journal.description
    assert [(r.code, D(r.debit), D(r.credit), r.partner_id) for r in _lines(db, journal)] == [
        ("721.9", D("300.00"), D("0.00"), None),
        ("531", D("0.00"), D("300.00"), "sup-1"),
    ]
    rent = create_bill(db, tid, partner_id="sup-1", number="INV-RENT-2", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20),
                       total="50.00", expense_account="rent_expense")
    assert _source_journal(db, rent).idempotency_key == f"expense:bill:{rent.id}"
    assert [r.code for r in _lines(db, _source_journal(db, rent))] == ["721.2", "531"]


def test_bill_total_sub_cent_rejected(db, tid):
    for bad in ("10.005", "NaN", "-5.00"):
        with pytest.raises(GLError) as exc:
            _bill(db, tid, f"INV-CENT-{bad}", total=bad)
        assert exc.value.code == "invalid_amount", bad
    assert _doc_count(db, tid) == 0


def test_pending_bill_follows_journal_approval(db, tid):
    bill = create_bill(db, tid, partner_id="sup-1", number="INV-PEND", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20),
                       total="1000000.00", actor="admin-1", require_approval=True)
    assert bill.status == "pending_approval"
    assert _source_journal(db, bill).status == "pending_approval"
    assert get_document_open_balance(db, tid, bill.id) == D("0.00")
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="10.00", paid_from="bank_main", posting_date=date(2026, 9, 15))
    assert exc.value.code == "invalid_status"
    _approve(db, tid, bill.journal_id)
    assert bill.status == "open" and get_document_open_balance(db, tid, bill.id) == D("1000000.00")

    rejected = create_bill(db, tid, partner_id="sup-1", number="INV-REJ", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20),
                           total="70.00", actor="admin-1", require_approval=True)
    _reject(db, tid, rejected.journal_id)
    assert rejected.status == "rejected" and get_document_open_balance(db, tid, rejected.id) == D("0.00")
    assert _sup_balance(db, tid, "sup-1") == D("1000000.00")


def test_voided_number_not_reusable(db, tid):
    bill = _bill(db, tid, "INV-REUSE")
    void_document(db, tid, bill.id, actor="admin-1", reason="Səhv faktura")
    _approve(db, tid, get_document_detail(db, tid, bill.id)["pending_void_journal_id"])
    assert bill.status == "void"
    with pytest.raises(GLError) as exc:
        _bill(db, tid, "INV-REUSE")
    assert exc.value.code == "duplicate_bill" and exc.value.status_code == 409
    assert "voided" in exc.value.message and "INV-REUSE" in exc.value.message
    # Another supplier may use the same number.
    assert _bill(db, tid, "INV-REUSE", partner="sup-2").status == "open"


def test_void_creates_pending_storno_doc_stays_open(db, tid):
    bill = _bill(db, tid, "INV-VOID-PENDING", total="80.00")
    returned = void_document(db, tid, bill.id, actor="admin-1", reason="Səhv faktura")
    assert returned.status == "open"
    detail = get_document_detail(db, tid, bill.id)
    storno = db.query(GLJournal).filter(GLJournal.id == detail["pending_void_journal_id"]).one()
    assert storno.status == "pending_approval" and storno.reversal_of_id == bill.journal_id
    assert (storno.source_type, storno.source_id) == ("document", bill.id)
    assert detail["status"] == "open" and detail["open"] == "80.00"
    assert _sup_balance(db, tid, "sup-1") == D("80.00")  # nothing moved in the books yet
    with pytest.raises(GLError) as exc:
        void_document(db, tid, bill.id, actor="admin-1")
    assert (exc.value.code, exc.value.status_code) == ("void_pending", 409)
    with pytest.raises(GLError) as exc:
        pay_bill(db, tid, bill.id, amount="10.00", paid_from="bank_main", posting_date=date(2026, 9, 15))
    assert (exc.value.code, exc.value.status_code) == ("void_pending", 409)
    with pytest.raises(GLError) as exc:
        _approve(db, tid, storno.id, approver="admin-1")
    assert exc.value.code == "self_approval"


def test_void_rejected_keeps_bill_open(db, tid):
    bill = _bill(db, tid, "INV-VOID-REJ", total="40.00")
    void_document(db, tid, bill.id, actor="admin-1", reason="Səhv faktura")
    _reject(db, tid, get_document_detail(db, tid, bill.id)["pending_void_journal_id"])
    detail = get_document_detail(db, tid, bill.id)
    assert detail["status"] == "open" and detail["open"] == "40.00" and detail["pending_void_journal_id"] is None
    assert _source_journal(db, bill).reversed_by_id is None
    res = pay_bill(db, tid, bill.id, amount="10.00", paid_from="bank_main", posting_date=date(2026, 9, 15))
    assert res["status"] == "partially_paid"


def test_void_approval_rechecks_allocations(db, tid):
    bill = _bill(db, tid, "INV-VOID-RACE", total="60.00")
    void_document(db, tid, bill.id, actor="admin-1", reason="Səhv faktura")
    storno_id = get_document_detail(db, tid, bill.id)["pending_void_journal_id"]
    # Something settled the bill outside the pay path while the void waited for approval.
    other = post_event(db, tid, SupplierPaid("outside-void", date(2026, 9, 15), "sup-1", "10.00", "cash"), actor="admin-1")
    db.add(GLDocumentAllocation(tenant_id=tid, document_id=bill.id, journal_id=other.id, journal_line_no=1, amount=D("10.00")))
    db.flush()
    journal = gl.approve_journal(db, tid, storno_id, approver="checker-1")
    with pytest.raises(GLError) as exc:
        documents.after_journal_approved(db, tid, journal)
    assert exc.value.code == "document_has_allocations" and exc.value.status_code == 409


def test_reverse_bill_payment_guards(db, tid):
    bill = _bill(db, tid, "INV-RP", total="100.00")
    other = _bill(db, tid, "INV-RP-OTHER", total="100.00")
    pay = pay_bill(db, tid, bill.id, amount="40.00", paid_from="bank_main", posting_date=date(2026, 9, 15))
    # Not a payment of that bill / not a payment at all.
    for doc_id, journal_id in ((other.id, pay["journal_id"]), (bill.id, bill.journal_id)):
        with pytest.raises(GLError) as exc:
            documents.reverse_bill_payment(db, tid, doc_id, journal_id, actor="admin-1", reason="Səhv ödəniş")
        assert (exc.value.code, exc.value.status_code) == ("payment_not_found", 404)
    res = documents.reverse_bill_payment(db, tid, bill.id, pay["journal_id"], actor="admin-1", reason="Səhv ödəniş")
    assert res["journal_status"] == "pending_approval" and res["reversal_of_id"] == pay["journal_id"]
    assert get_document_open_balance(db, tid, bill.id) == D("60.00")  # unchanged until approved
    with pytest.raises(GLError) as exc:
        documents.reverse_bill_payment(db, tid, bill.id, pay["journal_id"], actor="admin-1", reason="Səhv ödəniş")
    assert exc.value.code == "reversal_pending"
    _approve(db, tid, res["journal_id"])
    allocs = sorted(D(a.amount) for a in _allocs(db, tid, bill.id))
    assert allocs == [D("-40.00"), D("40.00")]
    assert bill.status == "open" and get_document_open_balance(db, tid, bill.id) == D("100.00")
    assert _sup_balance(db, tid, "sup-1") == D("200.00")  # both bills fully open again


def test_reclass_capped_at_unassigned(db, tid):
    with pytest.raises(GLError) as exc:
        reclassify_unassigned_ap(db, tid, amount="10.00", to_supplier_id="sup-2", actor="owner", posting_date=date(2026, 9, 10))
    assert (exc.value.code, exc.value.status_code) == ("reclass_exceeds_unassigned", 409)
    _unassigned_ap(db, tid, "100")
    with pytest.raises(GLError) as exc:
        reclassify_unassigned_ap(db, tid, amount="100.01", to_supplier_id="sup-2", actor="owner", posting_date=date(2026, 9, 10))
    assert exc.value.code == "reclass_exceeds_unassigned" and "100.00" in exc.value.message
    # Dated before the unassigned AP existed: nothing to reclassify yet.
    with pytest.raises(GLError) as exc:
        reclassify_unassigned_ap(db, tid, amount="50.00", to_supplier_id="sup-2", actor="owner", posting_date=date(2026, 7, 31))
    assert exc.value.code == "reclass_exceeds_unassigned"
    with pytest.raises(GLError) as exc:
        reclassify_unassigned_ap(db, tid, amount="10.005", to_supplier_id="sup-2", actor="owner", posting_date=date(2026, 9, 10))
    assert exc.value.code == "invalid_amount"
    res = reclassify_unassigned_ap(db, tid, amount="100.00", to_supplier_id="sup-2", actor="owner", posting_date=date(2026, 9, 10))
    assert res["status"] == "pending_approval"


def test_reclass_ghost_supplier_rejected(db, tid):
    _unassigned_ap(db, tid, "100")
    other = str(uuid.uuid4())
    db.add(Tenant(id=other, name="O", slug=f"o-{other[:8]}", domain=f"{other[:8]}.other", status="active"))
    db.add(Supplier(id="sup-foreign", tenant_id=other, name="Başqa tenant"))
    db.flush()
    for ghost in ("sup-ghost", "sup-foreign"):
        with pytest.raises(GLError) as exc:
            reclassify_unassigned_ap(db, tid, amount="10.00", to_supplier_id=ghost, actor="owner", posting_date=date(2026, 9, 10))
        assert (exc.value.code, exc.value.status_code) == ("supplier_not_found", 404)
    assert db.query(GLJournal).filter(GLJournal.tenant_id == tid, GLJournal.source_type == "reclass").count() == 0


def test_reclass_pending_until_approved(db, tid):
    _unassigned_ap(db, tid, "200")
    res = reclassify_unassigned_ap(db, tid, amount="80.00", to_supplier_id="sup-2", actor="owner", posting_date=date(2026, 9, 10))
    assert res["status"] == "pending_approval" and res["journal_no"] is None
    assert subledger(db, tid, "ap")["unassigned_balance"] == "200.00"
    with pytest.raises(GLError) as exc:
        _approve(db, tid, res["journal_id"], approver="owner")
    assert exc.value.code == "self_approval"
    _approve(db, tid, res["journal_id"])
    assert subledger(db, tid, "ap")["unassigned_balance"] == "120.00"
    assert _sup_balance(db, tid, "sup-2") == D("80.00")


def test_two_pending_reclasses_cannot_exceed(db, tid):
    _unassigned_ap(db, tid, "100")
    first = reclassify_unassigned_ap(db, tid, amount="60.00", to_supplier_id="sup-2", actor="owner", posting_date=date(2026, 9, 10))
    with pytest.raises(GLError) as exc:
        reclassify_unassigned_ap(db, tid, amount="50.00", to_supplier_id="sup-1", actor="owner", posting_date=date(2026, 9, 10))
    assert exc.value.code == "reclass_exceeds_unassigned" and "40.00" in exc.value.message
    reclassify_unassigned_ap(db, tid, amount="40.00", to_supplier_id="sup-1", actor="owner", posting_date=date(2026, 9, 10))
    # Rejecting a pending reclass releases its reservation.
    _reject(db, tid, first["journal_id"])
    again = reclassify_unassigned_ap(db, tid, amount="60.00", to_supplier_id="sup-2", actor="owner", posting_date=date(2026, 9, 10))
    assert again["status"] == "pending_approval"


def test_reclass_approval_rechecks_unassigned(db, tid):
    _unassigned_ap(db, tid, "100")
    res = reclassify_unassigned_ap(db, tid, amount="100.00", to_supplier_id="sup-2", actor="owner", posting_date=date(2026, 9, 10))
    # Meanwhile part of the unassigned AP was settled by an adjusting journal.
    gl.create_journal(db, tenant_id=tid, journal_type="general", created_by="admin-1", posting_date=date(2026, 9, 5),
                      description="Unassigned AP paid", lines=[LineIn(account="accounts_payable", debit=D("30")),
                                                              LineIn(account="cash_drawer", credit=D("30"))])
    journal = gl.approve_journal(db, tid, res["journal_id"], approver="checker-1")
    with pytest.raises(GLError) as exc:
        documents.after_journal_approved(db, tid, journal)
    assert (exc.value.code, exc.value.status_code) == ("reclass_exceeds_unassigned", 409)


def test_summary_covers_all_pages(db, tid):
    today = gl.business_today()
    overdue = _bill(db, tid, "S-1", total="100.00", issue=today - timedelta(days=40), due=today - timedelta(days=10))
    _bill(db, tid, "S-2", total="200.00", issue=today - timedelta(days=5), due=today + timedelta(days=10))
    _bill(db, tid, "S-3", total="300.00", partner="sup-2", issue=today - timedelta(days=3), due=today + timedelta(days=20))
    pay_bill(db, tid, overdue.id, amount="30.00", paid_from="bank_main", posting_date=today)
    voided = _bill(db, tid, "S-4", total="999.00", issue=today - timedelta(days=9), due=today - timedelta(days=1))
    void_document(db, tid, voided.id, actor="admin-1", reason="Səhv faktura")
    _approve(db, tid, get_document_detail(db, tid, voided.id)["pending_void_journal_id"])

    page = list_documents(db, tid, kind="ap_bill", limit=1)
    assert page["total"] == 4 and len(page["items"]) == 1
    assert page["summary"] == {"total_billed": "600.00", "total_open": "570.00", "overdue_open": "70.00", "overdue_count": 1}
    assert list_documents(db, tid, partner_id="sup-2", limit=1)["summary"]["total_open"] == "300.00"


def test_overdue_only_and_search_filters(db, tid):
    today = gl.business_today()
    _bill(db, tid, "OD-1", total="10.00", issue=today - timedelta(days=40), due=today - timedelta(days=10))
    _bill(db, tid, "FUT-1", total="20.00", issue=today - timedelta(days=1), due=today + timedelta(days=10))
    _bill(db, tid, "XZ-77", total="30.00", partner="sup-2", issue=today - timedelta(days=1), due=today + timedelta(days=5))
    paid_late = _bill(db, tid, "PAID-OLD", total="5.00", issue=today - timedelta(days=40), due=today - timedelta(days=20))
    pay_bill(db, tid, paid_late.id, amount="5.00", paid_from="bank_main", posting_date=today)

    overdue = list_documents(db, tid, overdue_only=True)
    assert [d["number"] for d in overdue["items"]] == ["OD-1"] and overdue["total"] == 1
    assert overdue["summary"]["overdue_count"] == 1 and overdue["summary"]["overdue_open"] == "10.00"
    assert [d["number"] for d in list_documents(db, tid, search="xz-7")["items"]] == ["XZ-77"]  # number, any case
    assert [d["number"] for d in list_documents(db, tid, search="xəzər")["items"]] == ["XZ-77"]  # supplier name


def test_detail_includes_journal_lines(db, tid):
    bill = create_bill(db, tid, partner_id="sup-1", number="INV-LINES", issue_date=date(2026, 9, 10), due_date=date(2026, 9, 20),
                       total="75.00", expense_account="721.9", note="Kağız", actor="admin-1")
    detail = get_document_detail(db, tid, bill.id)
    assert detail["journal_status"] == "posted"
    assert detail["pending_void_journal_id"] is None and detail["pending_payments"] == []
    assert [(l["line_no"], l["account_code"], l["debit"], l["credit"]) for l in detail["lines"]] == [
        (1, "721.9", "75.00", "0.00"), (2, "531", "0.00", "75.00")]
    assert all(l["account_name"] and "memo" in l for l in detail["lines"])
    pay_bill(db, tid, bill.id, amount="25.00", paid_from="bank_main", posting_date=date(2026, 9, 15), actor="mgr",
             require_approval=True)
    pending = get_document_detail(db, tid, bill.id)["pending_payments"]
    assert [(p["amount"], p["created_by"], p["posting_date"]) for p in pending] == [("25.00", "mgr", "2026-09-15")]
    assert pending[0]["journal_id"]



# ─────────────────────── Borclar: AP aging by due date (FEAT-003, F9) ───────────────────────

EMPTY_BUCKETS = {"current": "0.00", "0_30": "0.00", "31_60": "0.00", "61_90": "0.00", "90_plus": "0.00"}


def _ap_row(db, tid, supplier_id, as_of):
    ap = subledger(db, tid, "ap", as_of=as_of)
    assert ap["reconciled"] and D(ap["totals"]["balance"]) == D(ap["control_balance"])
    return next((r for r in ap["partners"] if r["partner_id"] == supplier_id), None), ap


def _open_docs(db, tid, supplier_id):
    docs = db.query(GLDocument).filter(GLDocument.tenant_id == tid, GLDocument.partner_id == supplier_id).all()
    return sum((documents.get_document_open_balance(db, tid, d.id) for d in docs), D("0.00"))


def test_documented_partner_aged_by_due_date(db, tid):
    as_of = date(2026, 9, 30)
    # Issued 90 days ago but due in 10 days: not yet due, so 'current' (posting-date aging said 61_90).
    _bill(db, tid, "INV-AGE-1", total="100.00", issue=as_of - timedelta(days=90), due=as_of + timedelta(days=10))
    # Issued 50 days ago, 40 days past due: 31_60 (posting-date aging said 31_60 too, by issue date).
    _bill(db, tid, "INV-AGE-2", total="40.00", issue=as_of - timedelta(days=50), due=as_of - timedelta(days=40))
    row, ap = _ap_row(db, tid, "sup-1", as_of)
    assert row["aging_basis"] == "due_date"
    assert row["buckets"] == {**EMPTY_BUCKETS, "current": "100.00", "31_60": "40.00"}
    assert row["balance"] == row["open"] == "140.00" and row["advance"] == "0.00"
    assert ap["totals"]["current"] == "100.00" and ap["totals"]["90_plus"] == "0.00"
    # A bill issued after as_of does not exist yet; as_of before the due date of bill 2 -> current.
    earlier, _ = _ap_row(db, tid, "sup-1", as_of - timedelta(days=45))
    assert earlier["buckets"] == {**EMPTY_BUCKETS, "current": "140.00"}


def test_mixed_partner_remainder_uses_posting_date(db, tid):
    as_of = date(2026, 9, 30)
    # Undocumented legacy receipt on credit tagged with the supplier, 100 days old.
    gl.create_journal(db, tenant_id=tid, journal_type="purchase", created_by="legacy-sync", posting_date=as_of - timedelta(days=100),
                      description="Legacy restock", lines=[
                          LineIn(account="inventory", debit=D("70"), credit=D("0")),
                          LineIn(account="accounts_payable", debit=D("0"), credit=D("70"), partner_type="supplier", partner_id="sup-1")])
    _bill(db, tid, "INV-MIX", total="100.00", issue=as_of - timedelta(days=5), due=as_of + timedelta(days=25))
    row, _ = _ap_row(db, tid, "sup-1", as_of)
    assert row["aging_basis"] == "mixed"
    assert row["buckets"] == {**EMPTY_BUCKETS, "current": "100.00", "90_plus": "70.00"}
    assert row["balance"] == row["open"] == "170.00"
    # Settled beyond the documents (unallocated payment): the excess shows as advance, aged by due date.
    _bill(db, tid, "INV-ADV", total="100.00", partner="sup-2", issue=as_of - timedelta(days=5), due=as_of - timedelta(days=1))
    gl.create_journal(db, tenant_id=tid, journal_type="general", created_by="t", posting_date=as_of - timedelta(days=2),
                      description="Unallocated payment", lines=[
                          LineIn(account="accounts_payable", debit=D("30"), credit=D("0"), partner_type="supplier", partner_id="sup-2"),
                          LineIn(account="cash_drawer", debit=D("0"), credit=D("30"))])
    row2, ap = _ap_row(db, tid, "sup-2", as_of)
    assert row2["aging_basis"] == "due_date"
    assert row2["buckets"] == {**EMPTY_BUCKETS, "0_30": "100.00"}
    assert (row2["open"], row2["advance"], row2["balance"]) == ("100.00", "30.00", "70.00")
    assert ap["totals"]["advance"] == "30.00"
    # Partners without documents keep posting-date aging.
    _unassigned_ap(db, tid, "20", posting_date=as_of - timedelta(days=10))
    unassigned, _ = _ap_row(db, tid, None, as_of)
    assert unassigned["aging_basis"] == "posting_date" and unassigned["buckets"] == {**EMPTY_BUCKETS, "0_30": "20.00"}


def test_invariant_sum_open_equals_subledger_balance(db, tid):
    as_of = date(2026, 9, 30)

    def check(expected_open, buckets):
        row, _ = _ap_row(db, tid, "sup-1", as_of)
        open_docs = _open_docs(db, tid, "sup-1")
        assert open_docs == D(expected_open)
        if row is None:
            assert open_docs == D("0.00")
            return
        assert row["aging_basis"] == "due_date"
        assert D(row["balance"]) == D(row["open"]) == open_docs
        assert sum((D(v) for v in row["buckets"].values()), D("0")) == open_docs
        assert row["buckets"] == {**EMPTY_BUCKETS, **buckets}

    late = _bill(db, tid, "INV-INV-1", total="100.00", issue=date(2026, 9, 10), due=date(2026, 9, 25))
    future = _bill(db, tid, "INV-INV-2", total="50.00", issue=date(2026, 9, 10), due=date(2026, 10, 20))
    check("150.00", {"0_30": "100.00", "current": "50.00"})
    pay_bill(db, tid, late.id, amount="40.00", paid_from="bank_main", posting_date=date(2026, 9, 15))
    check("110.00", {"0_30": "60.00", "current": "50.00"})
    pay_bill(db, tid, late.id, amount="60.00", paid_from="bank_main", posting_date=date(2026, 9, 16))
    check("50.00", {"current": "50.00"})
    void_document(db, tid, future.id, actor="admin-1", reason="Səhv faktura")
    check("50.00", {"current": "50.00"})  # void pending: still owed
    _approve(db, tid, documents._pending_void(db, tid, future).id)
    check("0.00", {})
    # A payment dated after as_of does not reduce the as-of open balance.
    third = _bill(db, tid, "INV-INV-3", total="30.00", issue=date(2026, 9, 20), due=date(2026, 9, 28))
    pay_bill(db, tid, third.id, amount="30.00", paid_from="bank_main", posting_date=date(2026, 10, 1))
    row, _ = _ap_row(db, tid, "sup-1", as_of)
    assert row["buckets"] == {**EMPTY_BUCKETS, "0_30": "30.00"} and row["open"] == "30.00"
