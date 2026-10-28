"""Manual finance controls, isolated from production and the POS posting path."""
from decimal import Decimal
from datetime import datetime
from types import SimpleNamespace
import json
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
from app.db import Base
from app.models import AuditLog, FinanceAccount, FinanceEntry, FinanceLedgerEntry, FinanceOperationRequest, FinanceReconciliation, FinanceTransaction, Setting, Tenant
from app.routers import finance
from app.schemas import FinanceEntryIn, FinanceReconciliationIn, FinanceTransactionIn, TransferIn
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


def test_entry_idempotency_replays_original_and_conflicts_on_changed_payload(ctx):
    db, tenant = ctx
    first = finance.create_entry(FinanceEntryIn(type="out", category="Xammal", source="cash", amount="10.0", idempotency_key="entry-key-0001"), db, tenant, MAKER)
    before = (db.query(FinanceTransaction).count(), balance(db, tenant))
    replay = finance.create_entry(FinanceEntryIn(type="out", category="Xammal", source="cash", amount="10.00", idempotency_key="entry-key-0001"), db, tenant, MAKER)
    assert replay["replayed"] is True
    assert replay["id"] == first["id"]
    assert (db.query(FinanceTransaction).count(), balance(db, tenant)) == before
    with pytest.raises(HTTPException) as error:
        finance.create_entry(FinanceEntryIn(type="out", category="Xammal", source="cash", amount="11", idempotency_key="entry-key-0001"), db, tenant, MAKER)
    assert error.value.status_code == 409


def test_idempotency_key_is_tenant_scoped(ctx):
    db, tenant = ctx
    first = finance.create_entry(FinanceEntryIn(type="out", category="Xammal", source="cash", amount="10", idempotency_key="same-key-0001"), db, tenant, MAKER)
    other = Tenant(id=str(uuid.uuid4()), name="Other", slug="other", domain="other.test", status="active")
    db.add(other)
    db.flush()
    for code in ("cash", "card", "safe"):
        fs.post_finance_transaction(db, tenant_id=other.id, transaction_type="investor_injection", amount=D("2000"),
                                    source_code="investor", destination_code=code, created_by="setup")
    db.commit()
    second = finance.create_entry(FinanceEntryIn(type="out", category="Xammal", source="cash", amount="10", idempotency_key="same-key-0001"), db, other, MAKER)
    assert first["id"] != second["id"]
    assert db.query(FinanceOperationRequest).filter_by(idempotency_key="same-key-0001").count() == 2


def test_failed_write_rolls_back_idempotency_reservation_and_can_be_retried(ctx):
    db, tenant = ctx
    payload = FinanceEntryIn(type="out", category="Xammal", source="cash", amount="2500", idempotency_key="retry-after-fail-01")
    with pytest.raises(HTTPException) as error:
        finance.create_entry(payload, db, tenant, MAKER)
    assert error.value.status_code == 400
    assert db.query(FinanceOperationRequest).filter_by(tenant_id=tenant.id, idempotency_key=payload.idempotency_key).count() == 0
    fs.post_finance_transaction(db, tenant_id=tenant.id, transaction_type="investor_injection", amount=D("1000"),
                                source_code="investor", destination_code="cash", created_by="setup")
    db.commit()
    result = finance.create_entry(payload, db, tenant, MAKER)
    assert result["success"]


def test_ledger_request_replay_prevents_double_post(ctx):
    db, tenant = ctx
    payload = FinanceTransactionIn(transaction_type="expense", source_account_code="cash", amount="12.50", category="Xammal", idempotency_key="ledger-key-0001")
    first = finance.create_ledger_transaction(payload, db, tenant, MAKER)
    before = (db.query(FinanceTransaction).count(), balance(db, tenant))
    replay = finance.create_ledger_transaction(payload, db, tenant, MAKER)
    assert replay["replayed"] is True and replay["transaction_id"] == first["transaction_id"]
    assert (db.query(FinanceTransaction).count(), balance(db, tenant)) == before


def test_compound_transfer_approval_posts_main_and_fee_once_and_exposes_fee(ctx):
    db, tenant = ctx
    db.add(Setting(tenant_id=tenant.id, key="bank_commission", value=json.dumps({"card_transfer_percent": 1})))
    db.commit()
    payload = TransferIn(direction="card_to_cash", amount="500", allow_pending_approval=True, idempotency_key="transfer-key-0001")
    pending = finance.transfer(payload, db, tenant, MAKER)
    assert pending["status"] == "pending_approval"
    assert pending["commission"] == "5.00" and pending["total_debit"] == "505.00"
    assert balance(db, tenant, "card") == D("2000")
    assert db.query(FinanceTransaction).filter_by(tenant_id=tenant.id, transaction_type="expense").count() == 0
    shown = finance.list_pending_approvals(db, tenant, CHECKER)
    assert shown[0]["bank_commission"] == "5.00" and shown[0]["total_debit"] == "505.00"
    # Policy changes after submission cannot change the fee snapshot.
    db.query(Setting).filter_by(tenant_id=tenant.id, key="bank_commission").update({"value": json.dumps({"card_transfer_percent": 9})})
    db.commit()
    finance.approve_ledger_transaction(pending["transaction_id"], db, tenant, CHECKER)
    operation = db.query(FinanceOperationRequest).filter_by(transaction_id=pending["transaction_id"]).one()
    assert operation.fee_transaction_id
    assert balance(db, tenant, "card") == D("1495")
    assert db.query(FinanceLedgerEntry).filter_by(transaction_id=pending["transaction_id"]).count() == 2
    assert db.query(FinanceLedgerEntry).filter_by(transaction_id=operation.fee_transaction_id).count() == 2
    with pytest.raises(HTTPException):
        finance.approve_ledger_transaction(pending["transaction_id"], db, tenant, CHECKER)


def test_transfer_idempotency_replay_does_not_duplicate_main_or_fee(ctx):
    db, tenant = ctx
    db.add(Setting(tenant_id=tenant.id, key="bank_commission", value=json.dumps({"card_transfer_percent": 1})))
    db.commit()
    payload = TransferIn(direction="card_to_cash", amount="100", allow_pending_approval=True, idempotency_key="transfer-replay-0001")
    first = finance.transfer(payload, db, tenant, MAKER)
    before = db.query(FinanceTransaction).count()
    replay = finance.transfer(payload, db, tenant, MAKER)
    assert replay["replayed"] is True and replay["transaction_id"] == first["transaction_id"]
    assert db.query(FinanceTransaction).count() == before
    assert db.query(FinanceTransaction).filter_by(tenant_id=tenant.id, category="Bank Komissiyası").count() == 1


def test_compound_approval_rolls_back_main_and_fee_together(ctx, monkeypatch):
    db, tenant = ctx
    db.add(Setting(tenant_id=tenant.id, key="bank_commission", value=json.dumps({"card_transfer_percent": 1})))
    db.commit()
    pending = finance.transfer(TransferIn(direction="card_to_cash", amount="500", allow_pending_approval=True, idempotency_key="transfer-rollback-001"), db, tenant, MAKER)
    original = finance.finance_transfers.finance.post_existing_transaction
    calls = {"count": 0}

    def fail_fee(session, txn, actor):
        calls["count"] += 1
        if calls["count"] == 2:
            raise RuntimeError("simulated fee posting failure")
        return original(session, txn, actor)

    monkeypatch.setattr(finance.finance_transfers.finance, "post_existing_transaction", fail_fee)
    with pytest.raises(RuntimeError):
        finance.approve_ledger_transaction(pending["transaction_id"], db, tenant, CHECKER)
    db.rollback()
    row = db.get(FinanceTransaction, pending["transaction_id"])
    assert row.status == "pending_approval" and row.approved_by is None
    assert db.query(FinanceLedgerEntry).filter_by(transaction_id=row.id).count() == 0
    assert db.query(FinanceTransaction).filter_by(tenant_id=tenant.id, category="Bank Komissiyası").count() == 0
    assert balance(db, tenant, "card") == D("2000")


def test_compound_transfer_requires_balance_for_fee_as_well_as_principal(ctx):
    db, tenant = ctx
    db.add(Setting(tenant_id=tenant.id, key="bank_commission", value=json.dumps({"card_transfer_percent": 1})))
    db.commit()
    fs.post_finance_transaction(db, tenant_id=tenant.id, transaction_type="expense", amount=D("1497"), source_code="card", destination_code="expense", created_by="other")
    db.commit()
    with pytest.raises(HTTPException) as error:
        finance.transfer(TransferIn(direction="card_to_cash", amount="500", allow_pending_approval=True, idempotency_key="transfer-insufficient-001"), db, tenant, MAKER)
    assert error.value.status_code == 400
    assert balance(db, tenant, "card") == D("503")


@pytest.mark.parametrize("source", ["cash", "card", "safe"])
def test_founder_investment_uses_investor_liability_for_every_wallet(ctx, source):
    db, tenant = ctx
    before = fs.ledger_balances_snapshot(db, tenant.id)["investor"]
    finance.create_entry(FinanceEntryIn(type="in", category="Təsisçi İnvestisiyası", source=source, amount="25.00"), db, tenant, MAKER)
    posted = db.query(FinanceTransaction).filter_by(tenant_id=tenant.id, transaction_type="investor_injection", destination_account_id=
        db.query(FinanceAccount.id).filter_by(tenant_id=tenant.id, code=source).scalar()).order_by(FinanceTransaction.created_at.desc()).first()
    assert posted is not None
    balances = fs.ledger_balances_snapshot(db, tenant.id)
    assert balances["investor"] == before + D("25.00")
    assert balances[source] == D("2025.00")


def test_balance_sheet_includes_supplier_payable(ctx):
    db, tenant = ctx
    payable = fs.finance_account(db, tenant.id, "payable")
    db.add(FinanceLedgerEntry(tenant_id=tenant.id, transaction_id="synthetic-payable", account_id=payable.id,
                              entry_side="credit", amount=D("75.00"), currency="AZN", description="test payable"))
    db.flush()
    report = finance._balance_sheet_report(db, tenant.id)
    assert report["liabilities"]["suppliers_payable"] == "75.00"
    assert report["liabilities"]["total"] == "6075.00"


def test_supplier_payment_projection_is_visible_once_and_not_as_a_profit_expense(ctx):
    db, tenant = ctx
    txn = fs.create_finance_transaction_record(db, tenant_id=tenant.id, transaction_type="supplier_payment", status="posted",
        amount=D("80"), source_code="cash", destination_code="payable", created_by="maker", category="Təchizatçı Ödənişi",
        counterparty="Test supplier", note="Invoice payment")
    rows = finance.list_entries(db, tenant, CHECKER)
    projected = [row for row in rows if row["id"] == txn.id]
    assert len(projected) == 1 and projected[0]["type"] == "out"
    assert projected[0]["source"] == "cash" and projected[0]["amount"] == "80.00" and projected[0]["source_kind"] == "supplier_payment"
    # Once the legacy wallet has the canonical mirror, the projection must not duplicate it.
    db.add(FinanceEntry(tenant_id=tenant.id, type="out", category="Təchizatçı Ödənişi", source="cash", amount=D("80"),
                        description=f"Invoice payment | Ledger mirror: {txn.id}", created_by="maker"))
    db.flush()
    rows = finance.list_entries(db, tenant, CHECKER)
    supplier_rows = [row for row in rows if row["category"] == "Təchizatçı Ödənişi"]
    assert len(supplier_rows) == 1 and supplier_rows[0]["id"] != txn.id
    assert supplier_rows[0]["source_kind"] == "supplier_payment"


def test_report_period_uses_baku_business_day_boundaries():
    start, end = finance._period_bounds("2026-10-25", "2026-10-25")
    assert start.isoformat() == "2026-10-24T20:00:00"
    assert end.isoformat() == "2026-10-25T20:00:00"
    naive_start, naive_end = finance._period_bounds("2026-10-25T12:00:00", "2026-10-25T13:00:00")
    assert naive_start.isoformat() == "2026-10-25T08:00:00"
    assert naive_end.isoformat() == "2026-10-25T09:00:00"
    assert finance._iso_utc(datetime(2026, 10, 25, 20, 0)) == "2026-10-25T20:00:00Z"


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


def test_manual_entry_saves_counterparty_for_journal_filter(ctx):
    db, tenant = ctx
    finance.create_entry(FinanceEntryIn(type="out", category="Xammal", source="cash", amount="10", counterparty="  Təchizatçı A  "), db, tenant, MAKER)
    transaction = db.query(FinanceTransaction).filter_by(tenant_id=tenant.id, transaction_type="expense").one()
    assert transaction.counterparty == "Təchizatçı A"


def test_old_entry_request_hash_remains_compatible_with_new_optional_counterparty(ctx):
    import hashlib
    from app.services.finance_requests import _canonical
    db, tenant = ctx
    payload = FinanceEntryIn(type="out", category="Xammal", source="cash", amount="10", idempotency_key="old-entry-key-0001")
    finance.create_entry(payload, db, tenant, MAKER)
    record = db.query(FinanceOperationRequest).filter_by(idempotency_key=payload.idempotency_key).one()
    old_payload = payload.model_dump(exclude={"idempotency_key", "counterparty"})
    old_data = {"actor": MAKER.username, "kind": "entry", "payload": _canonical(old_payload)}
    assert record.request_hash == hashlib.sha256(json.dumps(old_data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    assert finance.create_entry(payload, db, tenant, MAKER)["replayed"] is True
