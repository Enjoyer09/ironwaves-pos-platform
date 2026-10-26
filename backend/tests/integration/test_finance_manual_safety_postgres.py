"""Manual finance races on PostgreSQL; use only a disposable integration DB."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from types import SimpleNamespace
import os
import threading
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
from app.gl import bridge, shadow
from app.gl.engine import ensure_chart
from app.gl.legacy_migration import migrate_tenant, reconcile_dual_tenant
from app.models import FinanceLedgerEntry, FinanceReconciliation, FinanceTransaction, Tenant
from app.routers import finance
from app.schemas import FinanceReconciliationIn, FinanceTransactionIn
from app.services import finance_service as fs

pytestmark = pytest.mark.integration
D = Decimal
MAKER = SimpleNamespace(username="maker", role="manager")
CHECKER = SimpleNamespace(username="checker", role="admin")


@pytest.fixture(scope="module")
def sessions():
    url = os.getenv("INTEGRATION_DATABASE_URL", "")
    if not url.startswith("postgresql"):
        pytest.skip("Disposable INTEGRATION_DATABASE_URL required")
    engine = create_engine(url, pool_size=6, connect_args={"options": "-c lock_timeout=5000 -c statement_timeout=10000"})
    yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    engine.dispose()


@pytest.fixture(params=["legacy", "dual"])
def tenant_id(sessions, request):
    tid = str(uuid.uuid4())
    with sessions() as db:
        db.add(Tenant(id=tid, name="Manual safety", slug=f"safety-{tid}", domain=f"{tid}.test", status="active"))
        db.flush()
        for code in ("cash", "safe"):
            fs.post_finance_transaction(db, tenant_id=tid, transaction_type="investor_injection", amount=D("2000"),
                                        source_code="investor", destination_code=code, created_by="setup")
        if request.param == "dual":
            ensure_chart(db, tid)
            migrate_tenant(db, tid)
            bridge.set_ledger_mode(db, tid, "dual", actor="setup", reason="isolated test")
        db.commit()
    return tid


def assert_balanced(sessions, tid, cash):
    with sessions() as db:
        assert fs.ledger_balances_snapshot(db, tid)["cash"] == D(cash)
        if bridge.get_ledger_mode(db, tid) == "dual":
            shadow.sync_tenant(db, tid)
            report = reconcile_dual_tenant(db, tid)
            assert report["ok"], [row for row in report["checks"] if not row["ok"]]
            db.commit()


def test_concurrent_manual_expenses_cannot_spend_same_money(sessions, tenant_id):
    barrier = threading.Barrier(2)

    def spend():
        with sessions() as db:
            tenant = db.get(Tenant, tenant_id)
            barrier.wait(timeout=10)
            try:
                finance.create_ledger_transaction(FinanceTransactionIn(transaction_type="expense", source_account_code="cash", amount="1500"), db, tenant, MAKER)
                return "posted"
            except HTTPException as error:
                db.rollback()
                assert error.status_code == 400 and "Insufficient balance" in error.detail
                return "insufficient"

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(spend) for _ in range(2)]
        assert sorted(f.result(timeout=20) for f in futures) == ["insufficient", "posted"]
    assert_balanced(sessions, tenant_id, "500")


def test_concurrent_approvals_recheck_current_balance(sessions, tenant_id):
    with sessions() as db:
        tenant = db.get(Tenant, tenant_id)
        ids = [finance.create_ledger_transaction(FinanceTransactionIn(transaction_type="internal_transfer", source_account_code="cash", destination_account_code="safe", amount="1500"), db, tenant, MAKER)["transaction_id"] for _ in range(2)]
    barrier = threading.Barrier(2)

    def approve(transaction_id):
        with sessions() as db:
            tenant = db.get(Tenant, tenant_id)
            barrier.wait(timeout=10)
            try:
                finance.approve_ledger_transaction(transaction_id, db, tenant, CHECKER)
                return "posted"
            except HTTPException as error:
                db.rollback()
                assert error.status_code == 400 and "Insufficient balance" in error.detail
                return "insufficient"

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(approve, transaction_id) for transaction_id in ids]
        assert sorted(f.result(timeout=20) for f in futures) == ["insufficient", "posted"]
    with sessions() as db:
        rows = db.query(FinanceTransaction).filter(FinanceTransaction.id.in_(ids)).all()
        assert sorted(row.status for row in rows) == ["pending_approval", "posted"]
        pending = next(row for row in rows if row.status == "pending_approval")
        assert pending.approved_by is None
        assert db.query(FinanceLedgerEntry).filter_by(transaction_id=pending.id).count() == 0
    assert_balanced(sessions, tenant_id, "500")


def test_reconciliation_waits_for_wallet_writer_and_rejects_stale_snapshot(sessions, tenant_id):
    attempt_started = threading.Event()

    def reconcile():
        with sessions() as db:
            tenant = db.get(Tenant, tenant_id)
            attempt_started.set()
            try:
                finance.create_reconciliation(FinanceReconciliationIn(account_code="cash", expected_balance="2000", counted_balance="2000"), db, tenant, MAKER)
                return "unexpected_reconciled"
            except HTTPException as error:
                db.rollback()
                assert error.status_code == 409
                return "stale"

    with sessions() as writer, ThreadPoolExecutor(max_workers=1) as executor:
        fs.post_finance_transaction(writer, tenant_id=tenant_id, transaction_type="expense", amount=D("100"),
                                    source_code="cash", destination_code="expense", created_by="other")
        future = executor.submit(reconcile)
        assert attempt_started.wait(timeout=10)
        writer.commit()
        assert future.result(timeout=20) == "stale"
    with sessions() as db:
        assert db.query(FinanceReconciliation).filter_by(tenant_id=tenant_id).count() == 0
    assert_balanced(sessions, tenant_id, "1900")


def test_opposing_wallet_transfers_use_consistent_lock_order(sessions, tenant_id):
    barrier = threading.Barrier(2)

    def move(source, destination):
        with sessions() as db:
            tenant = db.get(Tenant, tenant_id)
            barrier.wait(timeout=10)
            return finance.create_ledger_transaction(FinanceTransactionIn(transaction_type="internal_transfer", source_account_code=source,
                destination_account_code=destination, amount="100"), db, tenant, MAKER)["status"]

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(move, "cash", "safe"), executor.submit(move, "safe", "cash")]
        assert [f.result(timeout=20) for f in futures] == ["posted", "posted"]
    assert_balanced(sessions, tenant_id, "2000")
