"""Finance v2 dual mode, P2b-2 flows: void / adjust / partial refund, manual finance, inventory, suppliers.

Every test drives the real endpoint (or legacy service) function with real legacy
postings, then asserts the native GL result and that the dual reconciliation holds.
"""
from __future__ import annotations

import json
import uuid
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import bridge
from app.gl import engine as gl
from app.gl import posting_rules as pr
from app.gl import shadow
from app.gl.legacy_migration import migrate_tenant, reconcile_dual_tenant
from app.gl.models import GLJournal, GLLegacyLink, GLShadowRun
from app.models import Sale, Setting, Supplier, Tenant
from app.services import finance_service as fs

D = Decimal
ADMIN = SimpleNamespace(username="owner", role="admin")


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
def tenant(db):
    t = Tenant(id=str(uuid.uuid4()), name="Demo", slug="demo", domain="demo.test", status="active")
    db.add(t)
    db.flush()
    gl.ensure_chart(db, t.id)
    for code, amount in (("cash", "500"), ("card", "500"), ("safe", "200")):
        fs.post_finance_transaction(db, tenant_id=t.id, transaction_type="investor_injection", amount=D(amount), source_code="investor",
                                    destination_code=code, created_by="owner", category="Təsisçi İnvestisiyası")
    db.commit()
    migrate_tenant(db, t.id)
    bridge.set_ledger_mode(db, t.id, "dual", actor="owner", reason="test")
    db.commit()
    return t


def native(db, tid, **filters):
    q = db.query(GLJournal).filter(GLJournal.tenant_id == tid, GLJournal.legacy_ref.is_(None), GLJournal.source_module == "pos")
    for key, value in filters.items():
        q = q.filter(getattr(GLJournal, key) == value)
    return q.order_by(GLJournal.created_at).all()


def bal(db, tid, role):
    return gl.account_balance(db, tid, gl.accounts_by_role(db, tid)[role])


def ok(db, tid):
    shadow.sync_tenant(db, tid)  # anything uncovered gets mirrored, as in production
    report = reconcile_dual_tenant(db, tid)
    assert report["ok"], [c for c in report["checks"] if not c["ok"]]
    assert db.query(GLShadowRun).filter(GLShadowRun.run_type == "native_error").count() == 0
    return report


def native_sale(db, t, *, method="card", amount="20.00", cogs="6.00", split=None):
    """A sale made in dual mode: legacy postings + native journal, like pos.create_sale."""
    sale = Sale(id=str(uuid.uuid4()), tenant_id=t.id, cashier="k", payment_method="Kart" if method == "card" else method,
                total=D(amount), discount_amount=D("0"), cogs=D(cogs), items_json="[]", status="COMPLETED")
    db.add(sale)
    db.flush()
    parts = split or [(method, D(amount))]
    for m, a in parts:
        fs.post_sale_payment(db, tenant_id=t.id, sale_id=sale.id, amount=D(a), payment_source="card" if m == "card" else "cash",
                             created_by="k", card_fee_percent=D("2") if m == "card" else D("0"))
    fs.post_sale_cogs(db, tenant_id=t.id, sale_id=sale.id, amount=D(cogs), created_by="k")
    bridge.emit_sale(db, t.id, sale=sale, payments=parts, actor="k", card_fee_percent=D("2"))
    db.commit()
    return sale


# ─────────────────────────── void / adjust / refund ───────────────────────────


@pytest.mark.parametrize("return_to_stock", [True, False])
def test_void_native_sale(db, tenant, return_to_stock):
    from app.routers import analytics_api

    sale = native_sale(db, tenant)
    analytics_api.void_sale(sale.id, analytics_api.SaleVoidIn(reason="səhv", return_to_stock=return_to_stock), db=db, tenant=tenant, user=ADMIN)
    assert pr.active_sale_journal(db, tenant.id, sale.id) is None
    assert bal(db, tenant.id, "sales_revenue") == D("0.00")
    assert bal(db, tenant.id, "inventory_writeoff") == (D("0.00") if return_to_stock else D("6.00"))
    report = ok(db, tenant.id)
    if not return_to_stock:  # legacy restores the inventory asset although goods are gone: explained
        assert report["explained_differences"]["SaleVoided"]["inventory_asset"] == "-6.00"


def test_void_of_pre_dual_sale_is_left_to_the_mirror(db, tenant):
    from app.routers import analytics_api

    bridge.set_ledger_mode(db, tenant.id, "legacy", actor="owner", reason="x")
    db.commit()
    sale = native_sale(db, tenant)  # legacy mode: no native journal
    shadow.sync_tenant(db, tenant.id)
    bridge.set_ledger_mode(db, tenant.id, "dual", actor="owner", reason="x")
    db.commit()
    analytics_api.void_sale(sale.id, analytics_api.SaleVoidIn(reason="köhnə satış"), db=db, tenant=tenant, user=ADMIN)
    assert not native(db, tenant.id, journal_type="reversal")
    ok(db, tenant.id)


def test_adjust_payment_method_creates_next_version(db, tenant):
    from app.routers import analytics_api

    sale = native_sale(db, tenant, method="card", amount="20.00")
    analytics_api.adjust_sale(sale.id, analytics_api.SaleAdjustIn(new_total=D("18.00"), payment_method="Nəğd", reason="nağd ödənib"),
                              db=db, tenant=tenant, user=ADMIN)
    active = pr.active_sale_journal(db, tenant.id, sale.id)
    assert active.idempotency_key == f"sale:{sale.id}:v2"
    assert bal(db, tenant.id, "sales_revenue") == D("18.00")
    ok(db, tenant.id)


def test_partial_refund_of_split_sale_posts_only_refund(db, tenant):
    from app.routers import analytics_api

    sale = native_sale(db, tenant, amount="30.00", split=[("cash", D("20.00")), ("card", D("10.00"))])
    analytics_api.partial_refund_sale(sale.id, analytics_api.SalePartialRefundIn(refund_amount=D("6.00"), reason="qismən"),
                                      db=db, tenant=tenant, user=ADMIN)
    refunds = native(db, tenant.id, source_type="sale_refund")
    assert sorted(str(j.total_debit) for j in refunds) == ["2.00", "4.00"]  # proportional cash 4 / card 2
    assert pr.active_sale_journal(db, tenant.id, sale.id) is not None  # original stays; only the refund is added
    assert bal(db, tenant.id, "sales_revenue") + bal(db, tenant.id, "sales_discounts") * -1 == D("24.00")
    report = ok(db, tenant.id)
    # Legacy re-computes the card fee on the remaining card part (refunds 0.04 of fee); native keeps it.
    assert report["explained_differences"]["SaleRefunded"] == {"card": "-0.04"}


# ─────────────────────────── manual finance ───────────────────────────


def test_entry_expense_with_bank_commission(db, tenant):
    from app.routers import finance
    from app.schemas import FinanceEntryIn

    finance.create_entry(FinanceEntryIn(type="out", category="Kommunal", source="card", amount=D("100"), include_bank_commission=True),
                         db=db, tenant=tenant, user=ADMIN)
    journal = native(db, tenant.id, source_type="expense")[0]
    assert db.query(GLLegacyLink).filter(GLLegacyLink.journal_id == journal.id).count() == 2  # expense + commission
    assert bal(db, tenant.id, "utilities_expense") == D("100.00") and bal(db, tenant.id, "bank_fees") == D("0.50")
    ok(db, tenant.id)


@pytest.mark.parametrize("category,role,expected", [
    ("Təsisçi İnvestisiyası", "investor_loan", D("1250.00")),  # 1200 seeded + 50
    ("Borc Alındı", "other_borrowings", D("50.00")),  # legacy booked this as revenue
    ("Digər Giriş", "other_income", D("50.00")),
])
def test_entry_income_is_classified(db, tenant, category, role, expected):
    from app.routers import finance
    from app.schemas import FinanceEntryIn

    finance.create_entry(FinanceEntryIn(type="in", category=category, source="cash", amount=D("50")), db=db, tenant=tenant, user=ADMIN)
    assert bal(db, tenant.id, role) == expected
    ok(db, tenant.id)


@pytest.mark.parametrize("direction", ["card_to_cash", "cash_to_safe", "cash_to_debt", "card_to_debt"])
def test_transfers(db, tenant, direction):
    from app.routers import finance
    from app.schemas import TransferIn

    finance.transfer(TransferIn(direction=direction, amount=D("100")), db=db, tenant=tenant, user=ADMIN)
    assert native(db, tenant.id)
    ok(db, tenant.id)


def test_repay_investor_direct(db, tenant):
    from app.routers import finance
    from app.schemas import InvestorRepayIn

    db.add(Setting(tenant_id=tenant.id, key="finance_policy", value=json.dumps({"investor_repayment_requires_approval": False})))
    db.commit()
    finance.repay_investor(InvestorRepayIn(amount=D("100"), pay_from="cash"), db=db, tenant=tenant, user=ADMIN)
    assert bal(db, tenant.id, "investor_loan") == D("1100.00")
    assert native(db, tenant.id, source_type="financing")
    ok(db, tenant.id)


# ─────────────────────────── inventory / suppliers ───────────────────────────


def test_restock_on_credit_without_supplier_and_loss(db, tenant):
    fs.post_inventory_restock(db, tenant_id=tenant.id, amount=D("80"), created_by="k", payment_source="payable", reference="INV-1")
    fs.post_inventory_restock(db, tenant_id=tenant.id, amount=D("30"), created_by="k", payment_source="cash")
    fs.post_inventory_loss(db, tenant_id=tenant.id, amount=D("5"), created_by="k", note="xarab oldu")
    db.commit()
    assert bal(db, tenant.id, "inventory") == D("105.00")
    assert bal(db, tenant.id, "accounts_payable") == D("80.00")
    assert bal(db, tenant.id, "inventory_writeoff") == D("5.00")
    assert len(native(db, tenant.id)) == 3
    ok(db, tenant.id)


def test_supplier_payment_tracks_partner(db, tenant):
    from app.routers import suppliers

    sup = Supplier(tenant_id=tenant.id, name="Kənd Süd", balance=D("80"))
    db.add(sup)
    db.flush()
    fs.post_inventory_restock(db, tenant_id=tenant.id, amount=D("80"), created_by="k", payment_source="payable", supplier_id=sup.id)
    db.commit()
    suppliers.pay_supplier(sup.id, suppliers.SupplierPaymentIn(amount=D("50"), payment_source="card"), db=db, tenant=tenant, user=ADMIN)
    assert bal(db, tenant.id, "accounts_payable") == D("30.00")
    ok(db, tenant.id)


# ─────────────────────────── AP bills (WP3) ───────────────────────────


def _open_docs_total(db, tid, supplier_id):
    from app.gl import documents
    from app.gl.models import GLDocument

    docs = db.query(GLDocument).filter(GLDocument.tenant_id == tid, GLDocument.partner_id == supplier_id).all()
    return sum((documents.get_document_open_balance(db, tid, d.id) for d in docs), D("0.00"))


def _partner_balance(db, tid, supplier_id):
    from app.gl.subledger import subledger

    row = next((r for r in subledger(db, tid, "ap")["partners"] if r["partner_id"] == supplier_id), None)
    return D(row["balance"]) if row else D("0.00")


def _supplier(db, tid, name="Təchizatçı"):
    sup = Supplier(tenant_id=tid, name=name, balance=D("0"))
    db.add(sup)
    db.flush()
    return sup


def test_bill_create_pay_keeps_dual_reconcile(db, tenant):
    from app.gl import documents

    sup = _supplier(db, tenant.id)
    today = gl.business_today()
    bill = documents.create_bill(db, tenant.id, partner_id=sup.id, number="DUAL-1", issue_date=today, due_date=today,
                                 total="100.00", actor="owner")
    db.commit()
    ok(db, tenant.id)
    documents.pay_bill(db, tenant.id, bill.id, amount="40.00", paid_from="cash_drawer", actor="owner", idempotency_key="dual-pay-1")
    db.commit()
    ok(db, tenant.id)
    assert bill.status == "partially_paid"
    documents.pay_bill(db, tenant.id, bill.id, amount="60.00", paid_from="bank_main", actor="owner", idempotency_key="dual-pay-2")
    db.commit()
    report = ok(db, tenant.id)
    assert bill.status == "paid"
    assert bal(db, tenant.id, "cash_drawer") == D("460.00") and bal(db, tenant.id, "bank_main") == D("440.00")
    assert report["explained_differences"]["GLOnlyJournal"]["cash"] == "-40.00"
    assert _open_docs_total(db, tenant.id, sup.id) == _partner_balance(db, tenant.id, sup.id) == D("0.00")


def test_legacy_supplier_payment_allocates_to_bills(db, tenant):
    from app.gl import documents
    from app.routers import suppliers

    sup = _supplier(db, tenant.id, "Kənd Süd")
    today = gl.business_today()
    bill = documents.create_bill(db, tenant.id, partner_id=sup.id, number="LEG-1", issue_date=today, due_date=today,
                                 total="80.00", actor="owner")
    db.commit()
    suppliers.pay_supplier(sup.id, suppliers.SupplierPaymentIn(amount=D("50"), payment_source="cash", note="Qəbz 5"),
                           db=db, tenant=tenant, user=ADMIN)
    assert documents.get_document_open_balance(db, tenant.id, bill.id) == D("30.00")
    assert db.get(type(bill), bill.id).status == "partially_paid"
    assert _open_docs_total(db, tenant.id, sup.id) == _partner_balance(db, tenant.id, sup.id) == D("30.00")
    journal = native(db, tenant.id, source_type="supplier_payment")[-1]
    assert "Qəbz 5" in journal.description
    assert db.query(GLLegacyLink).filter(GLLegacyLink.journal_id == journal.id, GLLegacyLink.event_type == "SupplierPaid").count() == 1
    ok(db, tenant.id)


def test_legacy_supplier_payment_named_bill_first(db, tenant):
    from app.gl import documents
    from app.routers import suppliers

    sup = _supplier(db, tenant.id, "Named")
    today = gl.business_today()
    first_due = documents.create_bill(db, tenant.id, partner_id=sup.id, number="N-1", issue_date=today, due_date=today,
                                      total="40.00", actor="owner")
    named = documents.create_bill(db, tenant.id, partner_id=sup.id, number="N-2", issue_date=today, due_date=today + timedelta(days=10),
                                  total="40.00", actor="owner")
    db.commit()
    suppliers.pay_supplier(sup.id, suppliers.SupplierPaymentIn(amount=D("50"), payment_source="cash", document_ids=[named.id]),
                           db=db, tenant=tenant, user=ADMIN)
    assert documents.get_document_open_balance(db, tenant.id, named.id) == D("0.00")
    assert documents.get_document_open_balance(db, tenant.id, first_due.id) == D("30.00")
    ok(db, tenant.id)


def test_legacy_supplier_overpay_becomes_advance(db, tenant):
    from app.gl import documents
    from app.routers import suppliers

    sup = _supplier(db, tenant.id, "Avans")
    today = gl.business_today()
    bill = documents.create_bill(db, tenant.id, partner_id=sup.id, number="ADV-1", issue_date=today, due_date=today,
                                 total="30.00", actor="owner")
    db.commit()
    suppliers.pay_supplier(sup.id, suppliers.SupplierPaymentIn(amount=D("50"), payment_source="cash"), db=db, tenant=tenant, user=ADMIN)
    assert db.get(type(bill), bill.id).status == "paid"
    assert documents.get_document_open_balance(db, tenant.id, bill.id) == D("0.00")
    assert _partner_balance(db, tenant.id, sup.id) == D("-20.00")  # 20 advance stays on the partner
    ok(db, tenant.id)


def test_all_hooks_are_noops_in_legacy_mode(db, tenant):
    from app.routers import finance
    from app.schemas import FinanceEntryIn, TransferIn

    bridge.set_ledger_mode(db, tenant.id, "legacy", actor="owner", reason="x")
    db.commit()
    before = db.query(GLJournal).count()
    finance.create_entry(FinanceEntryIn(type="out", category="Kommunal", source="cash", amount=D("10")), db=db, tenant=tenant, user=ADMIN)
    finance.transfer(TransferIn(direction="cash_to_safe", amount=D("10")), db=db, tenant=tenant, user=ADMIN)
    fs.post_inventory_restock(db, tenant_id=tenant.id, amount=D("10"), created_by="k")
    db.commit()
    assert db.query(GLJournal).count() == before and db.query(GLLegacyLink).count() == 0
