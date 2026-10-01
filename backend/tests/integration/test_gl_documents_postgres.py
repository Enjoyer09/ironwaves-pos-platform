"""AP bills on real PostgreSQL: payment races and dual-mode reconciliation (FEAT-001 / F13).

Requires INTEGRATION_DATABASE_URL pointing at a database migrated with
`alembic upgrade head`.
"""
from __future__ import annotations

import os
import threading
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.gl import bridge, documents
from app.gl import engine as gl
from app.gl.engine import GLError
from app.gl.legacy_migration import migrate_tenant, reconcile_dual_tenant
from app.gl.models import GLDocument, GLDocumentAllocation, GLJournal
from app.gl.subledger import subledger
from app.models import Supplier, Tenant
from app.services import finance_service as fs

pytestmark = pytest.mark.integration
D = Decimal


def _url() -> str:
    raw = str(os.getenv("INTEGRATION_DATABASE_URL") or "").strip()
    if not raw.startswith("postgresql"):
        pytest.skip("INTEGRATION_DATABASE_URL (PostgreSQL) is not set")
    return raw


@pytest.fixture(scope="module")
def Session():
    engine = create_engine(_url(), future=True, pool_size=10)
    with engine.connect() as conn:
        if not conn.execute(text("select 1 from pg_trigger where tgname = 'trg_gl_journal_guard'")).first():
            pytest.skip("GL migration (triggers) not applied to the integration database")
    yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    engine.dispose()


@pytest.fixture()
def env(Session):
    """A dual-mode tenant with legacy history (500 in the cash drawer) and one supplier."""
    tenant_id = str(uuid.uuid4())
    supplier_id = str(uuid.uuid4())
    with Session() as s:
        s.add(Tenant(id=tenant_id, name="IT", slug=f"it-{tenant_id[:10]}", domain=f"{tenant_id[:10]}.it.test", status="active"))
        s.flush()
        gl.ensure_chart(s, tenant_id)
        fs.post_finance_transaction(s, tenant_id=tenant_id, transaction_type="investor_injection", amount=D("500"), source_code="investor",
                                    destination_code="cash", created_by="owner", category="Təsisçi İnvestisiyası")
        s.commit()
        migrate_tenant(s, tenant_id)
        bridge.set_ledger_mode(s, tenant_id, "dual", actor="owner", reason="integration test")
        s.add(Supplier(id=supplier_id, tenant_id=tenant_id, name="PG Təchizatçı", balance=D("0")))
        s.commit()
    return tenant_id, supplier_id


def _bill(Session, tid, sid, total, number=None):
    with Session() as s:
        today = gl.business_today()
        doc = documents.create_bill(s, tid, partner_id=sid, number=number or f"PG-{uuid.uuid4().hex[:8]}", issue_date=today,
                                    due_date=today, total=total, actor="owner")
        s.commit()
        return doc.id


def _race(n: int, fn) -> list:
    barrier = threading.Barrier(n)
    results: list = []
    lock = threading.Lock()

    def worker(i: int):
        barrier.wait()
        outcome = fn(i)
        with lock:
            results.append(outcome)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def _pay(Session, tid, doc_id, amount, key, actor):
    with Session() as s:
        try:
            res = documents.pay_bill(s, tid, doc_id, amount=amount, paid_from="cash_drawer", actor=actor, idempotency_key=key)
            s.commit()
            return ("ok", res["journal_no"])
        except GLError as exc:
            s.rollback()
            return (exc.code, None)


def _payment_journals(s, tid, doc_id):
    return s.query(GLJournal).filter(GLJournal.tenant_id == tid, GLJournal.source_type == "document_payment",
                                     GLJournal.source_id == doc_id).all()


def _assert_reconciled(Session, tid, sid):
    with Session() as s:
        report = reconcile_dual_tenant(s, tid)
        assert len(report["checks"]) == 14
        assert report["ok"], [c for c in report["checks"] if not c["ok"]]
        open_total = sum((documents.get_document_open_balance(s, tid, d.id)
                          for d in s.query(GLDocument).filter(GLDocument.tenant_id == tid, GLDocument.partner_id == sid)), D("0.00"))
        row = next((r for r in subledger(s, tid, "ap")["partners"] if r["partner_id"] == sid), None)
        assert open_total == (D(row["balance"]) if row else D("0.00"))


def test_concurrent_pay_different_keys_pays_once(Session, env):
    tid, sid = env
    doc_id = _bill(Session, tid, sid, "1.00")
    results = _race(2, lambda i: _pay(Session, tid, doc_id, "1.00", f"race-key-{i}", f"cashier{i}"))
    assert sorted(code for code, _ in results) == ["ok", "overpayment_not_allowed"]
    with Session() as s:
        assert len(_payment_journals(s, tid, doc_id)) == 1
        assert s.query(GLDocumentAllocation).filter(GLDocumentAllocation.document_id == doc_id).count() == 1
        assert s.get(GLDocument, doc_id).status == "paid"
        cash = gl.accounts_by_role(s, tid)["cash_drawer"]
        assert gl.account_balance(s, tid, cash) == D("499.00")
    _assert_reconciled(Session, tid, sid)


def test_concurrent_pay_same_key_one_journal(Session, env):
    tid, sid = env
    doc_id = _bill(Session, tid, sid, "10.00")
    results = _race(4, lambda i: _pay(Session, tid, doc_id, "4.00", "same-key-0001", f"cashier{i}"))
    assert all(code == "ok" for code, _ in results), results
    assert len({no for _, no in results}) == 1
    with Session() as s:
        assert len(_payment_journals(s, tid, doc_id)) == 1
        assert s.query(GLDocumentAllocation).filter(GLDocumentAllocation.document_id == doc_id).count() == 1
        assert documents.get_document_open_balance(s, tid, doc_id) == D("6.00")
    _assert_reconciled(Session, tid, sid)


def test_bill_lifecycle_keeps_dual_reconcile_pg(Session, env):
    tid, sid = env
    doc_id = _bill(Session, tid, sid, "100.00")
    _assert_reconciled(Session, tid, sid)
    assert _pay(Session, tid, doc_id, "40.00", "life-pay-0001", "owner")[0] == "ok"
    _assert_reconciled(Session, tid, sid)
    assert _pay(Session, tid, doc_id, "60.00", "life-pay-0002", "owner")[0] == "ok"
    _assert_reconciled(Session, tid, sid)
    with Session() as s:
        assert s.get(GLDocument, doc_id).status == "paid"
        assert gl.verify_audit_chain(s, tid)["valid"]


# ─────────────────────── lifecycle with maker-checker (FEAT-002) ───────────────────────


def _approve(Session, tid, journal_id, approver):
    """What POST /journals/{id}/approve does, in its own transaction."""
    with Session() as s:
        try:
            documents.lock_documents_for_journal(s, tid, journal_id)
            journal = gl.approve_journal(s, tid, journal_id, approver=approver, allow_soft_closed=True)
            documents.after_journal_approved(s, tid, journal)
            s.commit()
            return ("ok", journal.status)
        except GLError as exc:
            s.rollback()
            return (exc.code, None)


def _audit_valid(Session, tid):
    with Session() as s:
        assert gl.verify_audit_chain(s, tid)["valid"]


def test_full_lifecycle_dual_reconcile_pg(Session, env):
    tid, sid = env
    doc_id = _bill(Session, tid, sid, "100.00")
    _assert_reconciled(Session, tid, sid)
    _audit_valid(Session, tid)

    pay = None
    with Session() as s:
        pay = documents.pay_bill(s, tid, doc_id, amount="100.00", paid_from="cash_drawer", actor="owner", idempotency_key="life-full-0001")
        s.commit()
    assert pay["status"] == "paid" and pay["journal_status"] == "posted"
    _assert_reconciled(Session, tid, sid)
    _audit_valid(Session, tid)

    with Session() as s:
        rev = documents.reverse_bill_payment(s, tid, doc_id, pay["journal_id"], actor="owner", reason="Səhv ödəniş")
        s.commit()
    assert rev["journal_status"] == "pending_approval"
    assert _approve(Session, tid, rev["journal_id"], "owner")[0] == "self_approval"
    assert _approve(Session, tid, rev["journal_id"], "cfo") == ("ok", "posted")
    with Session() as s:
        doc = s.get(GLDocument, doc_id)
        assert doc.status == "open" and documents.get_document_open_balance(s, tid, doc_id) == D("100.00")
        assert sorted(D(a.amount) for a in s.query(GLDocumentAllocation).filter(GLDocumentAllocation.document_id == doc_id)) == [
            D("-100.00"), D("100.00")]
        assert gl.account_balance(s, tid, gl.accounts_by_role(s, tid)["cash_drawer"]) == D("500.00")
    _assert_reconciled(Session, tid, sid)
    _audit_valid(Session, tid)

    with Session() as s:
        documents.void_document(s, tid, doc_id, actor="owner", reason="Səhv faktura")
        s.commit()
        storno_id = documents.get_document_detail(s, tid, doc_id)["pending_void_journal_id"]
    assert storno_id
    _assert_reconciled(Session, tid, sid)
    assert _approve(Session, tid, storno_id, "cfo") == ("ok", "posted")
    with Session() as s:
        assert s.get(GLDocument, doc_id).status == "void"
        assert documents.get_document_open_balance(s, tid, doc_id) == D("0.00")
    _assert_reconciled(Session, tid, sid)
    _audit_valid(Session, tid)


def test_concurrent_void_approval_and_payment(Session, env):
    """A payment racing the approval of a void on an open bill: never both succeed."""
    tid, sid = env
    for attempt in range(3):
        doc_id = _bill(Session, tid, sid, "10.00")
        with Session() as s:
            documents.void_document(s, tid, doc_id, actor="owner", reason="Səhv faktura")
            s.commit()
            storno_id = documents.get_document_detail(s, tid, doc_id)["pending_void_journal_id"]

        def run(i):
            if i == 0:
                return ("void",) + _approve(Session, tid, storno_id, "cfo")
            return ("pay",) + _pay(Session, tid, doc_id, "10.00", f"race-void-{attempt}", "cashier")

        outcomes = {kind: code for kind, code, _ in _race(2, run)}
        assert outcomes["void"] == "ok", outcomes
        assert outcomes["pay"] in ("void_pending", "invalid_status"), outcomes
        with Session() as s:
            doc = s.get(GLDocument, doc_id)
            assert doc.status == "void"
            assert not _payment_journals(s, tid, doc_id)
            assert s.query(GLDocumentAllocation).filter(GLDocumentAllocation.document_id == doc_id).count() == 0
        _assert_reconciled(Session, tid, sid)
    _audit_valid(Session, tid)
