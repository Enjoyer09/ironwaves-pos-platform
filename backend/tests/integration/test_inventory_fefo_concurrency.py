"""Concurrent FEFO consumes each lot once; valuation replay posts once."""
import os
import uuid
from datetime import timedelta
from decimal import Decimal as D
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import app.gl.models
from app.db import Base
from app.models import Tenant, InventoryItem, InventoryBatch, InventoryBatchMovement, InventoryValuation, AuditLog, FinanceTransaction
from app.routers import catalog
from app.schemas import InventoryRestockIn
from app.services.inventory_lock import lock_inventory
from app.gl.engine import business_today
from app.services import finance_service as fs

pytestmark = pytest.mark.integration


@pytest.fixture()
def setup():
    url = os.environ.get('INTEGRATION_DATABASE_URL', '')
    if not url.startswith('postgresql'):
        pytest.skip('Disposable PostgreSQL required')
    engine = create_engine(url, pool_size=8, connect_args={'options':'-c lock_timeout=10000 -c statement_timeout=15000'})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False, autoflush=False)
    tid = str(uuid.uuid4())
    actor = SimpleNamespace(username='tester', role='admin')
    with sessions() as db:
        db.add(Tenant(id=tid, name='Synthetic FEFO', slug=tid, domain=f'{tid}.test', status='active')); db.flush()
        row = InventoryItem(tenant_id=tid, name='Synthetic product', unit='kg', stock_qty=D('0'), unit_cost=D('0'), min_limit=D('0'))
        db.add(row); db.flush(); iid=row.id
        fs.post_finance_transaction(db, tenant_id=tid, transaction_type='investor_injection', amount=D('100'), source_code='investor', destination_code='cash', created_by='tester'); db.commit()
        tenant = db.get(Tenant, tid)
        for days,code in [(20,'LATE'),(2,'EARLY')]:
            catalog.restock_inventory_item(iid, InventoryRestockIn(qty_added=D('5'), total_price=D('10'), payment_source='cash', lot_code=code, expires_on=business_today()+timedelta(days=days)), db=db, tenant=tenant, user=actor)
    yield sessions,tid,iid,actor
    engine.dispose()


def test_parallel_fefo_never_overdraws_or_consumes_later_lot_first(setup):
    sessions,tid,iid,actor=setup
    def sell(_):
        with sessions() as db:
            row=db.get(InventoryItem,iid)
            lock_inventory(db,tid)
            row.stock_qty -= D('1')
            db.add(AuditLog(tenant_id=tid,user='tester',action='INVENTORY_CONSUMED',details=__import__('json').dumps({'item_name':row.name})))
            try:
                db.commit(); return True
            except HTTPException as exc:
                db.rollback(); assert exc.status_code==409; return False
    with ThreadPoolExecutor(max_workers=6) as pool:
        results=list(pool.map(sell,range(12)))
    assert results.count(True)==10 and results.count(False)==2
    with sessions() as db:
        assert db.get(InventoryItem,iid).stock_qty==0
        lots=db.query(InventoryBatch).filter_by(tenant_id=tid,item_id=iid).all()
        assert all(b.quantity_remaining==0 for b in lots)
        names={b.id:b.lot_code for b in lots}
        allocations=db.query(InventoryBatchMovement).filter(InventoryBatchMovement.tenant_id==tid,InventoryBatchMovement.quantity_delta<0).order_by(InventoryBatchMovement.created_at,InventoryBatchMovement.id).all()
        assert [names[a.batch_id] for a in allocations]==['EARLY']*5+['LATE']*5


def test_parallel_valuation_replay_posts_one_expense(setup):
    sessions,tid,iid,actor=setup
    payload=catalog.InventoryValuationIn(nrv_unit_cost=D('1'),expected_qty=D('10'),expected_unit_cost=D('2'),reason='Synthetic NRV',idempotency_key='parallel-nrv-0001')
    def value(_):
        with sessions() as db:
            tenant=db.get(Tenant,tid)
            return catalog.value_inventory(iid,payload,db=db,tenant=tenant,user=actor)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results=list(pool.map(value,range(12)))
    assert len({r['valuation_id'] for r in results})==1
    with sessions() as db:
        assert db.get(InventoryItem,iid).unit_cost==D('1')
        assert db.query(InventoryValuation).filter_by(tenant_id=tid).count()==1
        assert db.query(FinanceTransaction).filter_by(tenant_id=tid,transaction_type='inventory_nrv_write_down').count()==1


def test_parallel_legacy_transition_retains_negative_stock_without_lost_updates(setup):
    sessions,tid,iid,actor=setup
    with sessions() as db:
        row=db.get(InventoryItem,iid); row.legacy_negative_allowed=True
        for batch in db.query(InventoryBatch).filter_by(tenant_id=tid,item_id=iid):
            batch.expires_on=None
        db.commit()
    def sell(_):
        with sessions() as db:
            row=db.get(InventoryItem,iid)
            lock_inventory(db,tid)
            row.stock_qty-=D('1')
            db.add(AuditLog(tenant_id=tid,user='tester',action='INVENTORY_CONSUMED',details=__import__('json').dumps({'item_name':row.name})))
            db.commit()
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(sell,range(12)))
    with sessions() as db:
        assert db.get(InventoryItem,iid).stock_qty==D('-2')
        assert sum((b.quantity_remaining for b in db.query(InventoryBatch).filter_by(tenant_id=tid,item_id=iid)),D('0'))==D('-2')
