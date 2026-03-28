from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import FinanceEntry, InventoryItem, MenuItem, Tenant, User
from app.schemas import InventoryItemCreateIn, InventoryRestockIn, InventoryLossIn, MenuItemCreateIn


router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])


def _ensure_catalog_write_access(user: User):
    if str(user.role or "").lower() not in {"admin", "super_admin", "manager"}:
        raise HTTPException(status_code=403, detail="Catalog write access required")


class InventoryItemOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    unit: str
    category: str | None = None
    type: str | None = None
    stock_qty: str
    unit_cost: str
    min_limit: str


class MenuItemOut(BaseModel):
    id: str
    tenant_id: str
    item_name: str
    category: str
    price: str
    is_coffee: bool
    is_active: bool


@router.get("/menu", response_model=list[MenuItemOut])
def list_menu_items(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(MenuItem)
        .filter(MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)
        .order_by(MenuItem.category.asc(), MenuItem.item_name.asc())
        .all()
    )
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "item_name": row.item_name,
            "category": row.category,
            "price": str(row.price),
            "is_coffee": bool(row.is_coffee),
            "is_active": bool(row.is_active),
        }
        for row in rows
    ]


@router.post("/menu", response_model=MenuItemOut)
def create_menu_item(
    payload: MenuItemCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    item_name = str(payload.item_name or "").strip()
    category = str(payload.category or "").strip()
    if len(item_name) < 2:
        raise HTTPException(status_code=400, detail="Item name is required")
    if len(category) < 2:
        raise HTTPException(status_code=400, detail="Category is required")

    existing = (
        db.query(MenuItem)
        .filter(
            MenuItem.tenant_id == tenant.id,
            func.lower(MenuItem.item_name) == item_name.lower(),
            MenuItem.is_active == True,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Menu item already exists")

    row = MenuItem(
        tenant_id=tenant.id,
        item_name=item_name,
        category=category,
        price=Decimal(str(payload.price)),
        is_coffee=bool(payload.is_coffee),
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "item_name": row.item_name,
        "category": row.category,
        "price": str(row.price),
        "is_coffee": bool(row.is_coffee),
        "is_active": bool(row.is_active),
    }


@router.delete("/menu/{item_id}")
def soft_delete_menu_item(
    item_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    row = (
        db.query(MenuItem)
        .filter(MenuItem.id == item_id, MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Menu item not found")
    row.is_active = False
    db.commit()
    return {"success": True}


@router.get("/inventory", response_model=list[InventoryItemOut])
def list_inventory_items(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(InventoryItem)
        .filter(InventoryItem.tenant_id == tenant.id)
        .order_by(InventoryItem.name.asc())
        .all()
    )
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "name": row.name,
            "unit": row.unit,
            "category": row.category,
            "type": row.category,
            "stock_qty": str(row.stock_qty),
            "unit_cost": str(row.unit_cost),
            "min_limit": str(row.min_limit),
        }
        for row in rows
    ]


@router.post("/inventory", response_model=InventoryItemOut)
def create_inventory_item(
    payload: InventoryItemCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    name = str(payload.name or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Inventory item name is required")

    existing = (
        db.query(InventoryItem)
        .filter(
            InventoryItem.tenant_id == tenant.id,
            func.lower(InventoryItem.name) == name.lower(),
        )
        .first()
    )
    if existing:
        existing.stock_qty = (Decimal(str(existing.stock_qty)) + Decimal(str(payload.stock_qty))).quantize(Decimal("0.001"))
        existing.unit_cost = Decimal(str(payload.unit_cost)).quantize(Decimal("0.0001"))
        existing.min_limit = Decimal(str(payload.min_limit)).quantize(Decimal("0.001"))
        existing.unit = str(payload.unit or existing.unit).strip()
        existing.category = str(payload.category or existing.category or "").strip() or None
        db.commit()
        db.refresh(existing)
        row = existing
    else:
        row = InventoryItem(
            tenant_id=tenant.id,
            name=name,
            unit=str(payload.unit or "").strip(),
            category=str(payload.category or payload.type or "").strip() or None,
            stock_qty=Decimal(str(payload.stock_qty)).quantize(Decimal("0.001")),
            unit_cost=Decimal(str(payload.unit_cost)).quantize(Decimal("0.0001")),
            min_limit=Decimal(str(payload.min_limit)).quantize(Decimal("0.001")),
        )
        db.add(row)
        db.commit()
        db.refresh(row)

    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "unit": row.unit,
        "category": row.category,
        "type": row.category,
        "stock_qty": str(row.stock_qty),
        "unit_cost": str(row.unit_cost),
        "min_limit": str(row.min_limit),
    }


@router.post("/inventory/{item_id}/restock", response_model=InventoryItemOut)
def restock_inventory_item(
    item_id: str,
    payload: InventoryRestockIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    row = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    qty_added = Decimal(str(payload.qty_added))
    total_price = Decimal(str(payload.total_price))
    if qty_added <= 0:
        raise HTTPException(status_code=400, detail="Restock quantity must be > 0")
    if total_price < 0:
        raise HTTPException(status_code=400, detail="Total price cannot be negative")

    old_total_value = Decimal(str(row.stock_qty)) * Decimal(str(row.unit_cost))
    new_total_qty = Decimal(str(row.stock_qty)) + qty_added
    new_unit_cost = Decimal("0") if new_total_qty <= 0 else (old_total_value + total_price) / new_total_qty

    row.stock_qty = new_total_qty.quantize(Decimal("0.001"))
    row.unit_cost = new_unit_cost.quantize(Decimal("0.0001"))
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "unit": row.unit,
        "category": row.category,
        "type": row.category,
        "stock_qty": str(row.stock_qty),
        "unit_cost": str(row.unit_cost),
        "min_limit": str(row.min_limit),
    }


@router.post("/inventory/{item_id}/loss")
def record_inventory_loss(
    item_id: str,
    payload: InventoryLossIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    row = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    qty_removed = Decimal(str(payload.qty_removed))
    if qty_removed <= 0:
        raise HTTPException(status_code=400, detail="Loss quantity must be > 0")
    if Decimal(str(row.stock_qty)) < qty_removed:
        raise HTTPException(status_code=400, detail="Insufficient inventory stock")

    row.stock_qty = (Decimal(str(row.stock_qty)) - qty_removed).quantize(Decimal("0.001"))
    loss_amount = (qty_removed * Decimal(str(row.unit_cost))).quantize(Decimal("0.01"))
    db.add(
        FinanceEntry(
            tenant_id=tenant.id,
            type="out",
            category="Anbar İtkisi",
            source="cash",
            amount=loss_amount,
            description=f"Məhsul: {row.name}, Səbəb: {payload.reason}",
            created_by=user.username,
        )
    )
    db.commit()
    return {"success": True, "loss_amount": str(loss_amount)}


@router.delete("/inventory/{item_id}")
def delete_inventory_item(
    item_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    row = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    db.delete(row)
    db.commit()
    return {"success": True}
