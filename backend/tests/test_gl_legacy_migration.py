"""Legacy finance → GL v2 migration: built with the real legacy posting functions."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import engine as gl
from app.gl.legacy_migration import map_role, migrate_tenant, open_items, reconcile_tenant
from app.gl.models import GLJournal
from app.models import FinanceEntry, FinanceTransaction, Tenant
from app.services import finance_service as fs

D = Decimal


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", future=True)

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


def _post(db, tid, ttype, amount, src, dst, category=None, when=None, **kw):
    txn = fs.post_finance_transaction(db, tenant_id=tid, transaction_type=ttype, amount=D(amount), source_code=src,
                                      destination_code=dst, created_by="kassir", category=category, **kw)
    if when:
        txn.created_at = txn.posted_at = when
    return txn


def _legacy_reverse(db, tid, original, when):
    rev = fs.create_finance_transaction_record(
        db, tenant_id=tid, transaction_type="reversal", status="approved", amount=D(str(original.amount)),
        source_code=fs.finance_account_code(db, tid, original.destination_account_id),
        destination_code=fs.finance_account_code(db, tid, original.source_account_id),
        created_by="menecer", category=f"Reversal: {original.category}", reference=original.id,
    )
    fs.mark_original_transaction_reversed(db, rev, "menecer")
    fs.post_existing_transaction(db, rev, "menecer")
    rev.created_at = rev.posted_at = when
    return rev


@pytest.fixture()
def legacy(db):
    tid = str(uuid.uuid4())
    db.add(Tenant(id=tid, name="Gyros", slug="g", domain="g.test", status="active"))
    db.flush()
    t0 = datetime(2026, 4, 14, 8, 0)
    _post(db, tid, "investor_injection", "200.00", "investor", "cash", "Təsisçi İnvestisiyası", t0)
    sale = _post(db, tid, "income", "50.00", "revenue", "cash", "Satış (Nağd)", t0 + timedelta(hours=1), related_order_id="sale-1")
    _post(db, tid, "income", "30.00", "revenue", "card", "Satış (Kart)", t0 + timedelta(hours=2), related_order_id="sale-2")
    _post(db, tid, "expense", "0.60", "card", "expense", "Bank Komissiyası", t0 + timedelta(hours=2))
    _post(db, tid, "cogs_recognition", "12.00", "inventory_asset", "cogs", "COGS", t0 + timedelta(hours=2), related_order_id="sale-2")
    _post(db, tid, "expense", "100.00", "cash", "expense", "Maaş", t0 + timedelta(days=1))
    _post(db, tid, "expense", "20.00", "cash", "expense", "Xammal", t0 + timedelta(days=1))
    _post(db, tid, "expense", "5.00", "cash", "expense", "Digər Xərc", t0 + timedelta(days=1))
    _post(db, tid, "income", "40.00", "revenue", "cash", "Borc Alındı", t0 + timedelta(days=2))
    _post(db, tid, "inventory_restock", "80.00", "payable", "inventory_asset", "Anbar Mədaxili", t0 + timedelta(days=2))
    _post(db, tid, "internal_transfer", "60.00", "cash", "safe", "Daxili Transfer", t0 + timedelta(days=3))
    _post(db, tid, "cash_adjustment", "3.00", "cash", "adjustment", "Kəsir", t0 + timedelta(days=3))
    _post(db, tid, "inventory_loss", "4.00", "inventory_asset", "expense", "Anbar İtkisi", t0 + timedelta(days=3))
    # Late-evening UTC sale: 21:30 UTC is next day in Baku.
    _post(db, tid, "income", "10.00", "revenue", "cash", "Satış (Nağd)", datetime(2026, 4, 30, 21, 30), related_order_id="sale-3")
    _legacy_reverse(db, tid, sale, t0 + timedelta(days=4))
    # Pending (never posted) + a wallet row that bypassed the ledger.
    fs.create_finance_transaction_record(db, tenant_id=tid, transaction_type="cash_adjustment", status="pending_approval",
                                         amount=D("27039.35"), source_code="adjustment", destination_code="cash", created_by="x")
    db.add(FinanceEntry(tenant_id=tid, type="out", category="Refund / Ləğv", source="cash", amount=D("26.00"), description="VOID: TEST", created_by="admin"))
    db.commit()
    return tid


def test_mapping_rules():
    assert map_role("expense", "expense", "Maaş") == "payroll_expense"
    assert map_role("expense", "expense", "maas") == "payroll_expense"
    assert map_role("expense", "expense", "Bank Komissiyası") == "bank_fees"
    assert map_role("expense", "expense", "Xammal") == "cogs"
    assert map_role("expense", "inventory_loss", "Anbar İtkisi") == "inventory_writeoff"
    assert map_role("expense", "expense", "Naməlum") == "general_expense"
    assert map_role("revenue", "income", "Satış (Nağd)") == "sales_revenue"
    assert map_role("revenue", "income", "Borc Alındı") == "other_income"
    assert map_role("payable", "inventory_restock", None) == "accounts_payable"
    with pytest.raises(gl.GLError):
        map_role("mystery", "income", None)


def test_migration_reconciles_exactly(db, legacy):
    result = migrate_tenant(db, legacy)
    legacy_count = db.query(FinanceTransaction).filter(FinanceTransaction.tenant_id == legacy, FinanceTransaction.status.in_(["posted", "reversed"])).count()
    assert result.imported == legacy_count == 15
    assert result.reversal_links == 1
    recon = reconcile_tenant(db, legacy)
    assert recon["ok"], [c for c in recon["checks"] if not c["ok"]]
    roles = gl.accounts_by_role(db, legacy)
    bal = lambda role: gl.account_balance(db, legacy, roles[role])  # noqa: E731
    assert bal("cash_drawer") == D("200") - D("100") - D("20") - D("5") + D("40") - D("60") - D("3") + D("10")  # sale-1 reversed
    assert bal("payroll_expense") == D("100.00") and bal("bank_fees") == D("0.60") and bal("cogs") == D("32.00")
    assert bal("investor_loan") == D("200.00") and bal("accounts_payable") == D("80.00") and bal("suspense") == D("-3.00")
    assert result.flagged and result.flagged[0]["amount"] == "40.00"


def test_reversal_is_linked_and_nets_on_same_accounts(db, legacy):
    migrate_tenant(db, legacy)
    original = db.query(GLJournal).filter(GLJournal.tenant_id == legacy, GLJournal.source_id == "sale-1").order_by(GLJournal.posted_at).first()
    reversal = db.query(GLJournal).filter(GLJournal.id == original.reversed_by_id).one()
    assert reversal.journal_type == "reversal" and reversal.reversal_of_id == original.id


def test_historic_metadata_dates_and_numbering(db, legacy):
    migrate_tenant(db, legacy)
    journals = db.query(GLJournal).filter(GLJournal.tenant_id == legacy).order_by(GLJournal.journal_no).all()
    assert [j.journal_no for j in journals][:2] == ["JV-2026-000001", "JV-2026-000002"]
    assert journals[0].journal_type == "general" and journals[0].created_by == "kassir"
    late = db.query(GLJournal).filter(GLJournal.tenant_id == legacy, GLJournal.source_id == "sale-3").one()
    assert late.posting_date.isoformat() == "2026-05-01"  # Baku business date, not UTC date
    assert all(j.posted_at for j in journals)


def test_migration_is_idempotent_and_picks_up_new_legacy_rows(db, legacy):
    migrate_tenant(db, legacy)
    again = migrate_tenant(db, legacy)
    assert again.imported == 0 and again.skipped_existing == 15
    _post(db, legacy, "income", "7.00", "revenue", "cash", "Satış (Nağd)", datetime(2026, 5, 2, 9, 0), related_order_id="sale-4")
    db.commit()
    delta = migrate_tenant(db, legacy)
    assert delta.imported == 1
    assert reconcile_tenant(db, legacy)["ok"]


def test_open_items_report(db, legacy):
    items = open_items(db, legacy)
    assert [i["amount"] for i in items["unposted_legacy_transactions"]] == ["27039.35"]
    assert [i["amount"] for i in items["wallet_rows_without_ledger"]] == ["26.00"]


def test_reconciliation_detects_tampering(db, legacy):
    migrate_tenant(db, legacy)
    # Simulate a legacy row posted after migration that GL does not have yet.
    _post(db, legacy, "expense", "9.99", "cash", "expense", "Maaş", datetime(2026, 5, 3, 9, 0))
    db.flush()
    recon = reconcile_tenant(db, legacy)
    failed = {c["check"] for c in recon["checks"] if not c["ok"]}
    assert not recon["ok"] and "transaction_count" in failed and "balance:cash→221.1" in failed
