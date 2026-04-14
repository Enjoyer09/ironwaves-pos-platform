import json
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import AuditLog, FinanceEntry, InventoryItem, MenuItem, Recipe, Tenant, User
from app.schemas import InventoryItemCreateIn, InventoryRestockIn, InventoryLossIn, MenuItemCreateIn, MenuItemUpdateIn, RecipeIngredientCreateIn


router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])


def _ensure_catalog_write_access(user: User):
    if str(user.role or "").lower() not in {"admin", "super_admin", "manager"}:
        raise HTTPException(status_code=403, detail="Catalog write access required")


def _normalize_unit(raw: str) -> str:
    value = str(raw or "").strip().lower()
    aliases = {
        "kg": "kq",
        "kq": "kq",
        "qram": "qram",
        "gr": "qram",
        "g": "qram",
        "l": "litr",
        "lt": "litr",
        "litr": "litr",
        "liter": "litr",
        "ml": "ml",
        "m": "metr",
        "metr": "metr",
        "meter": "metr",
        "sm": "sm",
        "cm": "sm",
        "eded": "ədəd",
        "ədəd": "ədəd",
        "adet": "ədəd",
        "piece": "ədəd",
    }
    return aliases.get(value, value)


def _convert_recipe_qty_to_inventory_unit(quantity: Decimal, from_unit: str, inventory_unit: str) -> Decimal:
    from_normalized = _normalize_unit(from_unit)
    inventory_normalized = _normalize_unit(inventory_unit)
    if not from_normalized or from_normalized == inventory_normalized:
        return quantity

    conversions = {
        ("qram", "kq"): Decimal("0.001"),
        ("kq", "qram"): Decimal("1000"),
        ("ml", "litr"): Decimal("0.001"),
        ("litr", "ml"): Decimal("1000"),
        ("sm", "metr"): Decimal("0.01"),
        ("metr", "sm"): Decimal("100"),
    }
    factor = conversions.get((from_normalized, inventory_normalized))
    if factor is None:
        raise HTTPException(status_code=400, detail=f"{from_unit} vahidi {inventory_unit} ilə uyğun deyil")
    return quantity * factor


def _log_inventory_audit(db: Session, tenant_id: str, username: str, action: str, details: dict):
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            user=username,
            action=action,
            details=json.dumps(details, ensure_ascii=False),
        )
    )


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


class RecipeIngredientOut(BaseModel):
    id: str
    tenant_id: str
    menu_item_name: str
    ingredient_name: str
    quantity_required: str
    unit: str
    unit_cost: str
    line_cost: str


class RecipeIngredientReplaceIn(BaseModel):
    ingredient_name: str
    quantity_required: Decimal
    quantity_unit: str | None = None


class RecipeReplaceIn(BaseModel):
    menu_item_name: str
    ingredients: list[RecipeIngredientReplaceIn]


@router.get("/public-menu", response_model=list[MenuItemOut])
def list_public_menu_items(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
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
            "image_url": row.image_url or "",
            "description": row.description or "",
            "is_active": bool(row.is_active),
        }
        for row in rows
    ]


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
        image_url=str(payload.image_url or "").strip() or None,
        description=str(payload.description or "").strip() or None,
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
        "image_url": row.image_url or "",
        "description": row.description or "",
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


@router.patch("/menu/{item_id}", response_model=MenuItemOut)
def update_menu_item(
    item_id: str,
    payload: MenuItemUpdateIn,
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

    if payload.item_name is not None:
        next_name = str(payload.item_name or "").strip()
        if len(next_name) < 2:
            raise HTTPException(status_code=400, detail="Item name is required")
        duplicate = (
            db.query(MenuItem)
            .filter(
                MenuItem.tenant_id == tenant.id,
                MenuItem.id != row.id,
                func.lower(MenuItem.item_name) == next_name.lower(),
                MenuItem.is_active == True,
            )
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="Menu item already exists")
        row.item_name = next_name
    if payload.category is not None:
        next_category = str(payload.category or "").strip()
        if len(next_category) < 2:
            raise HTTPException(status_code=400, detail="Category is required")
        row.category = next_category
    if payload.price is not None:
        row.price = Decimal(str(payload.price))
    if payload.is_coffee is not None:
        row.is_coffee = bool(payload.is_coffee)
    if payload.image_url is not None:
        row.image_url = str(payload.image_url or "").strip() or None
    if payload.description is not None:
        row.description = str(payload.description or "").strip() or None

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="MENU_EDIT",
            details=json.dumps(
                {
                    "item_id": row.id,
                    "item_name": row.item_name,
                    "category": row.category,
                    "price": str(row.price),
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "item_name": row.item_name,
        "category": row.category,
        "price": str(row.price),
        "is_coffee": bool(row.is_coffee),
        "image_url": row.image_url or "",
        "description": row.description or "",
        "is_active": bool(row.is_active),
    }


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
        incoming_qty = Decimal(str(payload.stock_qty)).quantize(Decimal("0.001"))
        incoming_unit_cost = Decimal(str(payload.unit_cost)).quantize(Decimal("0.0001"))
        old_total_value = Decimal(str(existing.stock_qty)) * Decimal(str(existing.unit_cost))
        incoming_total_value = incoming_qty * incoming_unit_cost
        new_total_qty = (Decimal(str(existing.stock_qty)) + incoming_qty).quantize(Decimal("0.001"))
        existing.stock_qty = new_total_qty
        existing.unit_cost = (Decimal("0") if new_total_qty <= 0 else (old_total_value + incoming_total_value) / new_total_qty).quantize(Decimal("0.0001"))
        existing.min_limit = Decimal(str(payload.min_limit)).quantize(Decimal("0.001"))
        existing.unit = str(payload.unit or existing.unit).strip()
        existing.category = str(payload.category or existing.category or "").strip() or None
        _log_inventory_audit(
            db,
            tenant.id,
            user.username,
            "INVENTORY_ADD",
            {
                "item_name": existing.name,
                "qty": str(incoming_qty),
                "unit": existing.unit,
                "unit_cost": str(incoming_unit_cost),
                "mode": "merge",
            },
        )
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
        _log_inventory_audit(
            db,
            tenant.id,
            user.username,
            "INVENTORY_ADD",
            {
                "item_name": row.name,
                "qty": str(row.stock_qty),
                "unit": row.unit,
                "unit_cost": str(row.unit_cost),
                "mode": "create",
            },
        )
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
    _log_inventory_audit(
        db,
        tenant.id,
        user.username,
        "INVENTORY_RESTOCK",
        {
            "item_name": row.name,
            "qty_added": str(qty_added.quantize(Decimal("0.001"))),
            "unit": row.unit,
            "total_price": str(total_price.quantize(Decimal("0.01"))),
            "new_unit_cost": str(row.unit_cost),
        },
    )
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
    _log_inventory_audit(
        db,
        tenant.id,
        user.username,
        "INVENTORY_LOSS",
        {
            "item_name": row.name,
            "qty_removed": str(qty_removed.quantize(Decimal("0.001"))),
            "unit": row.unit,
            "reason": payload.reason,
            "loss_amount": str(loss_amount),
        },
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
    _log_inventory_audit(
        db,
        tenant.id,
        user.username,
        "INVENTORY_DELETE",
        {
            "item_name": row.name,
            "stock_qty": str(row.stock_qty),
            "unit": row.unit,
        },
    )
    db.delete(row)
    db.commit()
    return {"success": True}


@router.get("/recipes/{menu_item_name}", response_model=list[RecipeIngredientOut])
def list_recipe_ingredients(
    menu_item_name: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(Recipe, InventoryItem)
        .outerjoin(
            InventoryItem,
            (InventoryItem.tenant_id == tenant.id) & (func.lower(InventoryItem.name) == func.lower(Recipe.ingredient_name)),
        )
        .filter(Recipe.tenant_id == tenant.id, Recipe.menu_item_name == menu_item_name)
        .order_by(Recipe.ingredient_name.asc())
        .all()
    )
    return [
        {
            "id": recipe.id,
            "tenant_id": recipe.tenant_id,
            "menu_item_name": recipe.menu_item_name,
            "ingredient_name": recipe.ingredient_name,
            "quantity_required": str(recipe.quantity_required),
            "unit": inventory.unit if inventory else "",
            "unit_cost": str(inventory.unit_cost) if inventory else "0",
            "line_cost": str((Decimal(str(recipe.quantity_required)) * Decimal(str(inventory.unit_cost))).quantize(Decimal("0.0001"))) if inventory else "0",
        }
        for recipe, inventory in rows
    ]


@router.get("/recipes")
def list_recipe_menu_names(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(Recipe.menu_item_name)
        .filter(Recipe.tenant_id == tenant.id)
        .distinct()
        .all()
    )
    return {"menu_item_names": sorted([str(row[0]) for row in rows if row and row[0]])}


@router.post("/recipes", response_model=RecipeIngredientOut)
def create_recipe_ingredient(
    payload: RecipeIngredientCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    menu_item_name = str(payload.menu_item_name or "").strip()
    ingredient_name = str(payload.ingredient_name or "").strip()
    if len(menu_item_name) < 2:
        raise HTTPException(status_code=400, detail="Menu item is required")
    if len(ingredient_name) < 2:
        raise HTTPException(status_code=400, detail="Ingredient is required")

    inventory = (
        db.query(InventoryItem)
        .filter(InventoryItem.tenant_id == tenant.id, func.lower(InventoryItem.name) == ingredient_name.lower())
        .first()
    )
    if not inventory:
        raise HTTPException(status_code=404, detail="Inventory ingredient not found")

    row = Recipe(
        tenant_id=tenant.id,
        menu_item_name=menu_item_name,
        ingredient_name=inventory.name,
        quantity_required=_convert_recipe_qty_to_inventory_unit(
            Decimal(str(payload.quantity_required)),
            str(payload.quantity_unit or inventory.unit),
            str(inventory.unit),
        ).quantize(Decimal("0.0001")),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "menu_item_name": row.menu_item_name,
        "ingredient_name": row.ingredient_name,
        "quantity_required": str(row.quantity_required),
        "unit": inventory.unit,
        "unit_cost": str(inventory.unit_cost),
        "line_cost": str((Decimal(str(row.quantity_required)) * Decimal(str(inventory.unit_cost))).quantize(Decimal("0.0001"))),
    }


@router.delete("/recipes/{recipe_id}")
def delete_recipe_ingredient(
    recipe_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    row = db.query(Recipe).filter(Recipe.id == recipe_id, Recipe.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Recipe row not found")
    db.delete(row)
    db.commit()
    return {"success": True}


@router.put("/recipes")
def replace_recipe(
    payload: RecipeReplaceIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    menu_item_name = str(payload.menu_item_name or "").strip()
    if len(menu_item_name) < 2:
        raise HTTPException(status_code=400, detail="Menu item is required")

    db.query(Recipe).filter(Recipe.tenant_id == tenant.id, Recipe.menu_item_name == menu_item_name).delete()

    for item in payload.ingredients:
        ingredient_name = str(item.ingredient_name or "").strip()
        if len(ingredient_name) < 2:
            continue
        inventory = (
            db.query(InventoryItem)
            .filter(InventoryItem.tenant_id == tenant.id, func.lower(InventoryItem.name) == ingredient_name.lower())
            .first()
        )
        if not inventory:
            raise HTTPException(status_code=404, detail=f"Inventory ingredient not found: {ingredient_name}")
        db.add(
            Recipe(
                tenant_id=tenant.id,
                menu_item_name=menu_item_name,
                ingredient_name=inventory.name,
                quantity_required=_convert_recipe_qty_to_inventory_unit(
                    Decimal(str(item.quantity_required)),
                    str(item.quantity_unit or inventory.unit),
                    str(inventory.unit),
                ).quantize(Decimal("0.0001")),
            )
        )

    db.commit()
    return {"success": True, "count": len(payload.ingredients)}
