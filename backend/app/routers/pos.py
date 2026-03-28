import json
import secrets
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import FinanceEntry, InventoryItem, MenuItem, Recipe, Sale, Tenant
from app.schemas import SaleCreateIn, SaleCreateOut


router = APIRouter(prefix="/api/v1/pos", tags=["pos"])


@router.get("/menu")
def get_menu(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    rows = (
        db.query(MenuItem)
        .filter(MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)
        .order_by(MenuItem.category.asc(), MenuItem.item_name.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "item_name": r.item_name,
            "category": r.category,
            "price": str(r.price),
            "is_coffee": r.is_coffee,
            "is_active": r.is_active,
        }
        for r in rows
    ]


@router.post("/sale", response_model=SaleCreateOut)
def create_sale(payload: SaleCreateIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    if not payload.cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    subtotal = sum((Decimal(str(i.price)) * i.qty for i in payload.cart_items), Decimal("0"))
    discount = (subtotal * (Decimal(str(payload.discount_percent)) / Decimal("100"))).quantize(Decimal("0.01"))
    total = (subtotal - discount).quantize(Decimal("0.01"))

    stock_ops: list[tuple[InventoryItem, Decimal]] = []
    for item in payload.cart_items:
        recipes = (
            db.query(Recipe)
            .filter(Recipe.tenant_id == tenant.id, func.lower(Recipe.menu_item_name) == str(item.item_name).lower())
            .all()
        )
        for recipe in recipes:
            inventory = (
                db.query(InventoryItem)
                .filter(InventoryItem.tenant_id == tenant.id, func.lower(InventoryItem.name) == str(recipe.ingredient_name).lower())
                .first()
            )
            if not inventory:
                continue
            qty_required = (Decimal(str(recipe.quantity_required)) * Decimal(str(item.qty or 0))).quantize(Decimal("0.0001"))
            if Decimal(str(inventory.stock_qty)) < qty_required:
                raise HTTPException(status_code=400, detail=f"{inventory.name} üçün anbarda kifayət qədər qalıq yoxdur")
            stock_ops.append((inventory, qty_required))

    receipt_code = secrets.token_hex(5).upper()
    receipt_token = secrets.token_hex(10)

    sale = Sale(
        tenant_id=tenant.id,
        cashier=user.username,
        customer_card_id=payload.customer_card_id,
        payment_method=payload.payment_method,
        order_type=payload.order_type,
        receipt_code=receipt_code,
        receipt_token=receipt_token,
        total=total,
        discount_amount=discount,
        items_json=json.dumps([i.model_dump(mode="json") for i in payload.cart_items], ensure_ascii=False),
        status="COMPLETED",
        created_at=datetime.utcnow(),
    )
    db.add(sale)
    db.flush()

    for inventory, qty_required in stock_ops:
        inventory.stock_qty = (Decimal(str(inventory.stock_qty)) - qty_required).quantize(Decimal("0.001"))

    payment_method = str(payload.payment_method or "").strip().lower()
    if payment_method == "split":
        split_cash = Decimal(str(payload.split_cash or "0")).quantize(Decimal("0.01"))
        split_card = Decimal(str(payload.split_card or "0")).quantize(Decimal("0.01"))
        if split_cash < 0 or split_card < 0:
            raise HTTPException(status_code=400, detail="Split amounts cannot be negative")
        if split_cash + split_card != total:
            raise HTTPException(status_code=400, detail="Split amounts must equal total")

        if split_cash > 0:
            db.add(
                FinanceEntry(
                    tenant_id=tenant.id,
                    type="in",
                    category="Satış (Nağd)",
                    source="cash",
                    amount=split_cash,
                    description=f"POS Sale {sale.id} split cash",
                    created_by=user.username,
                )
            )
        if split_card > 0:
            db.add(
                FinanceEntry(
                    tenant_id=tenant.id,
                    type="in",
                    category="Satış (Kart)",
                    source="card",
                    amount=split_card,
                    description=f"POS Sale {sale.id} split card",
                    created_by=user.username,
                )
            )
    else:
        source = "cash" if payment_method in ["cash", "nəğd"] else "card"
        category = "Satış (Nağd)" if source == "cash" else "Satış (Kart)"
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="in",
                category=category,
                source=source,
                amount=total,
                description=f"POS Sale {sale.id}",
                created_by=user.username,
            )
        )

    db.commit()

    return {
        "sale_id": sale.id,
        "receipt_code": receipt_code,
        "receipt_token": receipt_token,
        "total": total,
        "created_at": sale.created_at,
    }


@router.post("/sync")
def sync_offline_sales(payload: list[SaleCreateIn], db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    synced = 0
    failed = 0
    for row in payload:
        try:
            create_sale(row, db=db, tenant=tenant, user=user)
            synced += 1
        except Exception:
            failed += 1
            db.rollback()
    return {"synced": synced, "failed": failed}


@router.get("/receipt/{sale_ref}")
def public_receipt(
    sale_ref: str,
    token: str,
    db: Session = Depends(get_db),
):
    ref = str(sale_ref or "").strip()
    row = (
        db.query(Sale)
        .filter((Sale.id == ref) | (func.lower(Sale.receipt_code) == ref.lower()))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Receipt not found")
    if not token or row.receipt_token != token:
        raise HTTPException(status_code=403, detail="Invalid receipt token")

    items = json.loads(row.items_json or "[]")
    original_total = Decimal(str(row.total)) + Decimal(str(row.discount_amount or 0))
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "cashier": row.cashier,
        "customer_card_id": row.customer_card_id,
        "customer_stars_after": 0,
        "free_coffees_applied": 0,
        "payment_method": row.payment_method,
        "order_type": row.order_type,
        "total": str(row.total),
        "original_total": str(original_total),
        "discount_amount": str(row.discount_amount or 0),
        "items": items,
        "status": row.status,
    }
