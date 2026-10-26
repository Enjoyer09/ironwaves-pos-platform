"""Manual finance controls, isolated from production and the POS posting path."""
from decimal import Decimal
from types import SimpleNamespace
import json
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
from app.db import Base
from app.models import AuditLog, FinanceLedgerEntry, FinanceReconciliation, FinanceTransaction, Setting, Tenant
from app.routers import finance
from app.schemas import FinanceReconciliationIn, FinanceTransactionIn, TransferIn
from app.services import finance_service as fs

D = Decimal
MAKER = SimpleNamespace(username="maker", role="manager")
CHECKER = SimpleNamespace(username="checker", role="admin")


@pytest.fixture
def ctx():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)() as db:
        tenant = Tenant(id=str(uuid.uuid4()), name="Safety test", slug="safety", domain="safety.test", status="active")
        db.add(tenant)
        db.flush()
        for code in ("cash", "card", "safe"):
            fs.post_finance_transaction(db, tenant_id=tenant.id, transaction_type="investor_injection",
                                       amount=D("2000"), source_code="investor", destination_code=code,
                                       created_by="setup")
        db.commit()
        yield db, tenant
    engine.dispose()


def balance(db, tenant, code="cash"):
    return fs.ledger_balances_snapshot(db, tenant.id)[code]


@pytest.mark.parametrize("direction", ["cash_to_safe", "cash_to_card", "safe_to_cash", "card_to_cash", "cash_to_debt", "card_to_debt"])
@pytest.mark.parametrize("amount", ["500", "1000", "499.999"])
def test_direct_transfer_cannot_bypass_approval(ctx, direction, amount):
    db, tenant = ctx
    before = db.query(FinanceTransaction).count()
    with pytest.raises(HTTPException) as error:
        finance.transfer(TransferIn(direction=direction, amount=amount), db, tenant, MAKER)
    assert error.value.status_code == 409
    assert "approval" in error.value.detail.lower()
    assert db.query(FinanceTransaction).count() == before
    assert balance(db, tenant) == D("2000")


def test_direct_transfer_below_threshold_still_posts(ctx):
    db, tenant = ctx
    result = finance.transfer(TransferIn(direction="cash_to_safe", amount="100"), db, tenant, MAKER)
    assert result["success"]
    assert balance(db, tenant) == D("1900")
    assert balance(db, tenant, "safe") == D("2100")


def test_direct_transfer_uses_tenant_threshold(ctx):
    db, tenant = ctx
    db.add(Setting(tenant_id=tenant.id, key="finance_policy", value=json.dumps({"large_transfer_threshold_azn": 50})))
    db.commit()
    with pytest.raises(HTTPException) as error:
        finance.transfer(TransferIn(direction="cash_to_safe", amount="50"), db, tenant, MAKER)
    assert error.value.status_code == 409
    assert balance(db, tenant) == D("2000")


@pytest.mark.parametrize("source", ["cash", "card", "safe"])
@pytest.mark.parametrize("kind", ["expense", "internal_transfer", "cash_adjustment", "reconciliation_adjustment", "deposit_refund"])
def test_manual_outgoing_cannot_overdraw(ctx, source, kind):
    db, tenant = ctx
    count = db.query(FinanceTransaction).count()
    payload = FinanceTransactionIn(transaction_type=kind, source_account_code=source, amount="2500")
    if kind == "internal_transfer":
        payload.destination_account_code = "card" if source != "card" else "cash"
    with pytest.raises(HTTPException) as error:
        finance.create_ledger_transaction(payload, db, tenant, MAKER)
    assert error.value.status_code == 400
    assert "Insufficient balance" in error.value.detail
    assert db.query(FinanceTransaction).count() == count
    assert balance(db, tenant, source) == D("2000")


@pytest.mark.parametrize("kind", ["expense", "internal_transfer", "cash_adjustment", "reconciliation_adjustment", "deposit_refund"])
def test_approval_rechecks_balance_without_mutating_pending_request(ctx, kind):
    db, tenant = ctx
    payload = FinanceTransactionIn(transaction_type=kind, source_account_code="cash", amount="1500", requires_approval=True)
    if kind == "internal_transfer":
        payload.destination_account_code = "safe"
    pending = finance.create_ledger_transaction(payload, db, tenant, MAKER)
    assert pending["status"] == "pending_approval"
    # Another real posting spends the funds before the checker opens the request.
    fs.post_finance_transaction(db, tenant_id=tenant.id, transaction_type="expense", amount=D("1000"),
                                source_code="cash", destination_code="expense", created_by="other")
    db.commit()
    with pytest.raises(HTTPException) as error:
        finance.approve_ledger_transaction(pending["transaction_id"], db, tenant, CHECKER)
    assert error.value.status_code == 400
    row = db.get(FinanceTransaction, pending["transaction_id"])
    assert row.status == "pending_approval"
    assert row.approved_by is None and row.approved_at is None
    assert db.query(FinanceLedgerEntry).filter_by(transaction_id=row.id).count() == 0
    assert balance(db, tenant) == D("1000")


@pytest.mark.parametrize("kind", ["expense", "internal_transfer"])
def test_funded_manual_request_can_be_approved(ctx, kind):
    db, tenant = ctx
    payload = FinanceTransactionIn(transaction_type=kind, source_account_code="cash", amount="500", requires_approval=True)
    if kind == "internal_transfer":
        payload.destination_account_code = "safe"
    pending = finance.create_ledger_transaction(payload, db, tenant, MAKER)
    result = finance.approve_ledger_transaction(pending["transaction_id"], db, tenant, CHECKER)
    assert result["status"] == "posted"
    assert balance(db, tenant) == D("1500")


@pytest.mark.parametrize("code", ["cash", "card", "safe"])
def test_stale_reconciliation_is_rejected_without_record(ctx, code):
    db, tenant = ctx
    with pytest.raises(HTTPException) as error:
        finance.create_reconciliation(FinanceReconciliationIn(account_code=code, expected_balance="0", counted_balance="0"), db, tenant, MAKER)
    assert error.value.status_code == 409
    assert db.query(FinanceReconciliation).count() == 0
    assert db.query(AuditLog).filter_by(action="FINANCE_RECONCILIATION_RECORDED").count() == 0
    assert balance(db, tenant, code) == D("2000")


@pytest.mark.parametrize("counted,status,variance", [("2000", "reconciled", "0"), ("1990", "variance", "-10"), ("0", "variance", "-2000")])
def test_reconciliation_records_server_balance_and_does_not_move_money(ctx, counted, status, variance):
    db, tenant = ctx
    transactions = db.query(FinanceTransaction).count()
    result = finance.create_reconciliation(FinanceReconciliationIn(account_code="cash", expected_balance="2000", counted_balance=counted), db, tenant, MAKER)
    row = db.get(FinanceReconciliation, result["id"])
    assert row.expected_balance == D("2000")
    assert row.counted_balance == D(counted)
    assert row.variance == D(variance) and row.status == status
    assert balance(db, tenant) == D("2000")
    assert db.query(FinanceTransaction).count() == transactions
