"""Rehearse the additive migrations in a transaction-local synthetic schema."""
import importlib.util
import os
from pathlib import Path
import uuid
import pytest
from sqlalchemy import create_engine, text, select
import app.gl.models
from app.db import Base
from app.models import InventoryItem, Tenant, MenuItem, Recipe
from alembic.migration import MigrationContext
from alembic.operations import Operations

pytestmark = pytest.mark.integration


def load_revision(name):
    path = Path(__file__).resolve().parents[2] / 'alembic' / 'versions' / name
    spec = importlib.util.spec_from_file_location('revision_' + name[:13], path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def test_migration_preserves_inventory_and_unresolved_names():
    url = os.environ.get('INTEGRATION_DATABASE_URL', '')
    if not url.startswith('postgresql'):
        pytest.skip('Disposable PostgreSQL required')
    engine = create_engine(url)
    schema = 'inventory_migration_' + uuid.uuid4().hex
    with engine.connect() as c:
        tx = c.begin()
        try:
            c.execute(text(f'CREATE SCHEMA {schema}'))
            c.execute(text(f'SET LOCAL search_path TO {schema}'))
            Base.metadata.create_all(c)
            c.execute(Tenant.__table__.insert(), dict(id='migration-tenant', name='Synthetic', slug='synthetic', domain='synthetic.test', status='active'))
            c.execute(InventoryItem.__table__.insert(), [dict(id='milk', tenant_id='migration-tenant', name='Milk', unit='litr', stock_qty='12.125', unit_cost='2.1250', min_limit='1'),
                dict(id='salt-a', tenant_id='migration-tenant', name='Salt', unit='kg', stock_qty='-3', unit_cost='5', min_limit='0'),
                dict(id='salt-b', tenant_id='migration-tenant', name='Salt', unit='kg', stock_qty='0', unit_cost='1', min_limit='0')])
            c.execute(MenuItem.__table__.insert(), dict(id='menu', tenant_id='migration-tenant', item_name='Latte', category='Coffee', price='5'))
            c.execute(Recipe.__table__.insert(), [dict(id='recipe-1', tenant_id='migration-tenant', menu_item_name='Latte', ingredient_name='Milk', quantity_required='0.2'),
                dict(id='recipe-2', tenant_id='migration-tenant', menu_item_name='Unknown menu', ingredient_name='Salt', quantity_required='0.1')])
            before = c.execute(text('SELECT id,tenant_id,name,unit,stock_qty,unit_cost,min_limit FROM inventory_items ORDER BY id')).all()
            for table in ('inventory_valuations','inventory_batch_movements','inventory_batches','inventory_movements'):
                c.execute(text(f'DROP TABLE {table}'))
            c.execute(text('ALTER TABLE inventory_items DROP COLUMN cost_basis_unit_cost, DROP COLUMN expiry_required, DROP COLUMN legacy_negative_allowed'))
            c.execute(text('ALTER TABLE recipes DROP COLUMN inventory_item_id, DROP COLUMN menu_item_id'))
            first = load_revision('20261120_0001_inventory_integrity.py')
            second = load_revision('20261120_0002_inventory_batches_valuation.py')
            third = load_revision('20261121_0001_legacy_stock_transition.py')
            with Operations.context(MigrationContext.configure(c)):
                first.upgrade(); second.upgrade(); third.upgrade()
            assert c.execute(text('SELECT id,tenant_id,name,unit,stock_qty,unit_cost,min_limit FROM inventory_items ORDER BY id')).all() == before
            assert c.execute(text('SELECT count(*) FROM inventory_items WHERE expiry_required OR cost_basis_unit_cost<>unit_cost')).scalar() == 0
            assert c.execute(text('SELECT count(*) FROM inventory_batches WHERE expires_on IS NOT NULL')).scalar() == 0
            assert c.execute(text('SELECT count(*) FROM inventory_items WHERE NOT legacy_negative_allowed')).scalar() == 0
            assert c.execute(text('SELECT quantity_remaining FROM inventory_batches WHERE item_id=\'milk\'')).scalar() == before[0][4]
            assert c.execute(text('SELECT quantity_remaining FROM inventory_batches WHERE item_id=\'salt-a\'')).scalar() == -3
            assert c.execute(text('SELECT inventory_item_id FROM recipes WHERE id=\'recipe-1\'')).scalar() == 'milk'
            assert c.execute(text('SELECT inventory_item_id FROM recipes WHERE id=\'recipe-2\'')).scalar() is None
            assert c.execute(text('SELECT count(*) FROM finance_transactions')).scalar() == 0
            with Operations.context(MigrationContext.configure(c)):
                third.downgrade(); second.downgrade()
            assert c.execute(text('SELECT id,tenant_id,name,unit,stock_qty,unit_cost,min_limit FROM inventory_items ORDER BY id')).all() == before
        finally:
            tx.rollback()
    engine.dispose()
