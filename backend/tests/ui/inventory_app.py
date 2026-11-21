"""Synthetic local browser fixture. Never load tenant/production credentials."""
import os
assert os.environ.get("DATABASE_URL") == "sqlite:////tmp/iw-inventory-browser.sqlite3"
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db import Base, engine, SessionLocal, get_db
import app.gl.models
from app.models import Tenant, InventoryItem, MenuItem, Recipe, Supplier
from app.deps import get_tenant, get_current_user
from app.routers import catalog, operations, suppliers
from types import SimpleNamespace
from decimal import Decimal
Base.metadata.drop_all(engine)
Base.metadata.create_all(engine)
with SessionLocal() as db:
    if not db.get(Tenant, 'ui-tenant'):
        db.add(Tenant(id='ui-tenant', name='Synthetic UI', slug='ui-test', domain='localhost', status='active'))
        db.flush()
        db.add_all([InventoryItem(id='ui-milk', tenant_id='ui-tenant', name='UI Milk', unit='litr', stock_qty=Decimal('10'), unit_cost=Decimal('2'), min_limit=Decimal('1')),
            InventoryItem(id='ui-salt-a', tenant_id='ui-tenant', name='UI Salt', unit='kg', stock_qty=Decimal('0'), unit_cost=Decimal('0'), min_limit=Decimal('0')),
            InventoryItem(id='ui-salt-b', tenant_id='ui-tenant', name='UI Salt', unit='kg', stock_qty=Decimal('0'), unit_cost=Decimal('0'), min_limit=Decimal('0')),
            MenuItem(id='ui-menu',tenant_id='ui-tenant',item_name='UI Latte',category='Coffee',price=Decimal('5')),
            Supplier(id='ui-supplier',tenant_id='ui-tenant',name='UI Supplier',balance=Decimal('0'))])
        db.flush()
        db.add(Recipe(id='ui-recipe',tenant_id='ui-tenant',menu_item_name='UI Latte',ingredient_name='UI Salt',quantity_required=Decimal('0.1')))
        db.commit()
app=FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5178'], allow_methods=['*'], allow_headers=['*'], allow_credentials=True)
app.include_router(catalog.router)
app.include_router(operations.router)
app.include_router(suppliers.router)
def tenant(db=__import__('fastapi').Depends(get_db)):
    return db.get(Tenant,'ui-tenant')
app.dependency_overrides[get_tenant]=tenant
app.dependency_overrides[get_current_user]=lambda: SimpleNamespace(username='ui-admin',role='admin',tenant_id='ui-tenant',id='ui-admin')
