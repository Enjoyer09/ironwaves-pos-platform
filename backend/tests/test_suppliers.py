import json
import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import engine as gl
from app.gl.engine import LineIn
from app.routers import suppliers
from app.models import Setting, Supplier, Tenant


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


# ─────────────── balance source dispatch (legacy vs GL AP subledger) ───────────────

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


def _journal(db, tid, when, *lines):
    return gl.create_journal(
        db, tenant_id=tid, journal_type="general", created_by="t", posting_date=when, description="t",
        lines=[LineIn(account=a, debit=D(d), credit=D(c), partner_type=pt, partner_id=pid) for a, d, c, pt, pid in lines],
    )


@pytest.fixture()
def tid(db):
    """Tenant with two suppliers: legacy balances set on the ORM column, plus a seeded
    GL AP subledger balance that differs from the legacy numbers."""
    t = str(uuid.uuid4())
    db.add(Tenant(id=t, name="T", slug=f"t-{t[:8]}", domain=f"{t[:8]}.test", status="active"))
    db.add(Supplier(id="sup-a", tenant_id=t, name="Ət Tədarük MMC", balance=D("111.11")))
    db.add(Supplier(id="sup-b", tenant_id=t, name="Süd Evi", balance=D("222.22")))
    db.flush()
    gl.ensure_chart(db, t)
    # Fund the (guarded) drawer so the supplier payment can post.
    _journal(db, t, date(2026, 5, 1), ("cash_drawer", "5000", "0", None, None), ("share_capital", "0", "5000", None, None))
    # Supplier A: bill 300, paid 100 -> GL AP balance 200.00. Supplier B: no GL activity -> 0.00.
    _journal(db, t, date(2026, 6, 1), ("general_expense", "300", "0", None, None), ("accounts_payable", "0", "300", "supplier", "sup-a"))
    _journal(db, t, date(2026, 9, 1), ("accounts_payable", "100", "0", "supplier", "sup-a"), ("cash_drawer", "0", "100", None, None))
    db.commit()
    return t


class _T:
    def __init__(self, tid):
        self.id = tid


def _set_source(db, tid, source):
    db.add(Setting(tenant_id=tid, key="finance_v2_reports_source", value=json.dumps({"source": source})))
    db.commit()


def test_get_suppliers_legacy_source(db, tid):
    admin = FakeUser(role="admin")
    rows = suppliers.get_suppliers(db=db, tenant=_T(tid), user=admin)
    by_id = {r.id: r for r in rows}
    assert by_id["sup-a"].balance == D("111.11") and by_id["sup-a"].balance_source == "legacy"
    assert by_id["sup-b"].balance == D("222.22") and by_id["sup-b"].balance_source == "legacy"


def test_get_suppliers_gl_source_serves_ap_balance_under_same_field(db, tid, monkeypatch):
    _set_source(db, tid, "gl")
    admin = FakeUser(role="admin")

    # The list request must issue at most ONE subledger('ap') call.
    import app.gl.subledger as subledger_mod

    calls = {"n": 0}
    real = subledger_mod.subledger

    def counting(db_, tenant_id, ledger, **kw):
        if ledger == "ap":
            calls["n"] += 1
        return real(db_, tenant_id, ledger, **kw)

    monkeypatch.setattr(subledger_mod, "subledger", counting)

    rows = suppliers.get_suppliers(db=db, tenant=_T(tid), user=admin)
    by_id = {r.id: r for r in rows}
    # GL AP balance replaces the legacy column under the SAME `balance` field.
    assert by_id["sup-a"].balance == D("200.00") and by_id["sup-a"].balance_source == "gl"
    assert by_id["sup-b"].balance == D("0.00") and by_id["sup-b"].balance_source == "gl"
    assert calls["n"] == 1  # one AP subledger call for the whole list, not one per supplier


def test_get_supplier_detail_dispatch(db, tid):
    admin = FakeUser(role="admin")

    legacy = suppliers.get_supplier(supplier_id="sup-a", db=db, tenant=_T(tid), user=admin)
    assert legacy.balance == D("111.11") and legacy.balance_source == "legacy"

    _set_source(db, tid, "gl")
    gl_detail = suppliers.get_supplier(supplier_id="sup-a", db=db, tenant=_T(tid), user=admin)
    assert gl_detail.balance == D("200.00") and gl_detail.balance_source == "gl"
    # Field name unchanged across both sources.
    assert hasattr(legacy, "balance") and hasattr(gl_detail, "balance")
