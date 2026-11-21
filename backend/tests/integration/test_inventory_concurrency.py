"""Use only a disposable PostgreSQL database."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal as D
from types import SimpleNamespace
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import app.gl.models
from app.db import Base
from app.models import InventoryItem, Tenant
from app.routers import catalog
from app.schemas import InventoryRestockIn, InventoryLossIn
from app.services.inventory_lock import lock_inventory

pytestmark = pytest.mark.integration

@pytest.mark.parametrize("replay", [False, True])
def test_concurrent_inventory_mutations(replay):
    url = os.environ.get("INTEGRATION_DATABASE_URL", "")
    if not url.startswith("postgresql"):
        pytest.skip("Disposable PostgreSQL required")
    engine = create_engine(url, connect_args={"options": "-c lock_timeout=10000"})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False, autoflush=False)
    tid = str(uuid.uuid4())
    admin = SimpleNamespace(username="tester", role="admin")
    with sessions() as db:
        tenant = Tenant(id=tid, name="Synthetic", slug=tid, domain=f"{tid}.test", status="active")
        db.add(tenant)
        db.flush()
        row = InventoryItem(tenant_id=tid, name="Milk", unit="litr", stock_qty=D("100"), unit_cost=D("0"), min_limit=D("0"))
        db.add(row)
        db.commit()
        iid = row.id
    def operation(index):
        with sessions() as db:
            tenant = db.get(Tenant, tid)
            row = db.get(InventoryItem, iid)
            if index % 3 == 0:
                catalog.restock_inventory_item(iid, InventoryRestockIn(qty_added=D("3"), total_price=D("0"), idempotency_key="parallel-restock" if replay else None), db=db, tenant=tenant, user=admin)
            elif index % 3 == 1:
                catalog.record_inventory_loss(iid, InventoryLossIn(qty_removed=D("1"), reason="test", idempotency_key="parallel-loss" if replay else None), db=db, tenant=tenant, user=admin)
            else:
                lock_inventory(db, tid)
                row.stock_qty = D(str(row.stock_qty)) - D("1")
                db.commit()
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(operation, range(30)))
    with sessions() as db:
        assert db.get(InventoryItem, iid).stock_qty == D("92" if replay else "110")
    engine.dispose()


def test_concurrent_supplier_payment_and_receipt():
    from app.models import Supplier
    from app.routers import suppliers
    from app.services import finance_service as fs
    url = os.environ.get("INTEGRATION_DATABASE_URL", "")
    if not url.startswith("postgresql"):
        pytest.skip("Disposable PostgreSQL required")
    engine = create_engine(url, connect_args={"options": "-c lock_timeout=10000"})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False, autoflush=False)
    tid = str(uuid.uuid4())
    admin = SimpleNamespace(username="tester", role="admin")
    with sessions() as db:
        tenant = Tenant(id=tid, name="Synthetic receipt-payment", slug=tid, domain=f"{tid}.test", status="active")
        db.add(tenant); db.flush()
        row = InventoryItem(tenant_id=tid, name="Flour", unit="kg", stock_qty=D("0"), unit_cost=D("0"), min_limit=D("0"))
        supplier = Supplier(tenant_id=tid, name="Synthetic supplier", balance=D("0"))
        db.add_all([row, supplier]); db.flush()
        iid, sid = row.id, supplier.id
        fs.post_finance_transaction(db, tenant_id=tid, transaction_type="investor_injection", amount=D("1000"), source_code="investor", destination_code="cash", created_by="tester")
        db.commit()
    def operation(index):
        with sessions() as db:
            tenant = db.get(Tenant, tid)
            db.get(Supplier, sid)
            if index % 2 == 0:
                catalog.restock_inventory_item(iid, InventoryRestockIn(qty_added=D("1"), total_price=D("10"), supplier_id=sid, payment_source="payable", idempotency_key=f"receipt-{index:08}"), db=db, tenant=tenant, user=admin)
            else:
                suppliers.pay_supplier(sid, suppliers.SupplierPaymentIn(amount=D("3"), payment_source="cash"), db=db, tenant=tenant, user=admin)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(operation, range(20)))
    with sessions() as db:
        assert db.get(InventoryItem, iid).stock_qty == D("10")
        assert db.get(Supplier, sid).balance == D("70")
        totals = fs.ledger_balances_snapshot(db, tid)
        assert totals["payable"] == D("70")
        assert totals["cash"] == D("970")
    engine.dispose()
