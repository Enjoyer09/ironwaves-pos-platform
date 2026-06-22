import pytest
from decimal import Decimal
from fastapi import HTTPException
from app.routers import suppliers
from app.models import Supplier


class FakeTenant:
    id = "test-tenant"


class FakeUser:
    def __init__(self, role="staff", username="test-user"):
        self.role = role
        self.username = username


def test_suppliers_write_access():
    staff_user = FakeUser(role="staff")
    manager_user = FakeUser(role="manager")
    admin_user = FakeUser(role="admin")

    # Staff user should be forbidden
    with pytest.raises(HTTPException) as exc_info:
        suppliers._ensure_supplier_write_access(staff_user)
    assert exc_info.value.status_code == 403

    # Manager and Admin users should pass successfully
    suppliers._ensure_supplier_write_access(manager_user)
    suppliers._ensure_supplier_write_access(admin_user)


def test_pay_supplier_validations(monkeypatch):
    # Mock database query to return a fake supplier
    fake_supplier = Supplier(
        id="supplier-1",
        tenant_id="test-tenant",
        name="Test Supplier",
        balance=Decimal("100.00")
    )

    class FakeQuery:
        def __init__(self, *args, **kwargs):
            pass

        def filter(self, *args, **kwargs):
            return self

        def first(self):
            return fake_supplier

    class FakeDb:
        def query(self, *args, **kwargs):
            return FakeQuery()

        def commit(self):
            pass

        def refresh(self, *args):
            pass

    # Mock post_finance_transaction to record inputs
    post_txn_args = {}

    def fake_post_txn(*args, **kwargs):
        post_txn_args.clear()
        post_txn_args.update(kwargs)
        return None

    monkeypatch.setattr(suppliers, "post_finance_transaction", fake_post_txn)

    # 1. Successful payment
    payload = suppliers.SupplierPaymentIn(
        amount=Decimal("40.00"),
        payment_source="cash",
        note="partial repayment"
    )

    res = suppliers.pay_supplier(
        supplier_id="supplier-1",
        payload=payload,
        db=FakeDb(),
        tenant=FakeTenant(),
        user=FakeUser(role="admin")
    )

    assert res["id"] == "supplier-1"
    assert Decimal(res["balance"]) == Decimal("60.00")
    assert fake_supplier.balance == Decimal("60.00")
    assert post_txn_args["amount"] == Decimal("40.00")
    assert post_txn_args["source_code"] == "cash"
    assert post_txn_args["destination_code"] == "payable"
    assert post_txn_args["supplier_id"] == "supplier-1"

    # Reset supplier balance
    fake_supplier.balance = Decimal("100.00")

    # 2. Payment with invalid amount should raise HTTPException(400)
    payload_invalid_amt = suppliers.SupplierPaymentIn(
        amount=Decimal("-10.00"),
        payment_source="cash"
    )
    with pytest.raises(HTTPException) as exc_info:
        suppliers.pay_supplier(
            supplier_id="supplier-1",
            payload=payload_invalid_amt,
            db=FakeDb(),
            tenant=FakeTenant(),
            user=FakeUser(role="admin")
        )
    assert exc_info.value.status_code == 400

    # 3. Payment with invalid source should raise HTTPException(400)
    payload_invalid_src = suppliers.SupplierPaymentIn(
        amount=Decimal("10.00"),
        payment_source="invalid_source"
    )
    with pytest.raises(HTTPException) as exc_info:
        suppliers.pay_supplier(
            supplier_id="supplier-1",
            payload=payload_invalid_src,
            db=FakeDb(),
            tenant=FakeTenant(),
            user=FakeUser(role="admin")
        )
    assert exc_info.value.status_code == 400
