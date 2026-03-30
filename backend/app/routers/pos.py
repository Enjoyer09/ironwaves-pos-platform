import json
import secrets
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import Customer, FinanceEntry, InventoryItem, MenuItem, Recipe, RewardClaim, Sale, Setting, Tenant
from app.schemas import SaleCreateIn, SaleCreateOut


router = APIRouter(prefix="/api/v1/pos", tags=["pos"])


def _is_coffee_like(item_name: str | None, category: str | None, is_coffee: bool | None) -> bool:
    if is_coffee:
        return True
    haystack = f"{item_name or ''} {category or ''}".lower()
    return any(token in haystack for token in ["kofe", "qəhvə", "qehve", "coffee"])


def _setting_value(db: Session, tenant_id: str, key: str, default):
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    if not row or row.value is None:
        return default
    try:
        return json.loads(row.value)
    except Exception:
        return default


def _calculate_staff_due(items: list, used_today: Decimal, config: dict) -> tuple[Decimal, Decimal, Decimal]:
    daily_limit = Decimal(str(config.get("daily_limit_azn", 6)))
    item_cap = Decimal(str(config.get("item_unit_cap_azn", 6)))
    allowed_scope = str(config.get("allowed_scope", "all") or "all").lower()
    allowed_categories = {str(v or "").strip().lower() for v in (config.get("included_categories") or []) if str(v or "").strip()}
    allowed_items = {str(v or "").strip().lower() for v in (config.get("included_items") or []) if str(v or "").strip()}

    benefit_used = Decimal("0")
    excess_due = Decimal("0")
    for item in items:
        unit_price = Decimal(str(item.price or 0))
        item_name = str(item.item_name or "").strip().lower()
        category_name = str(item.category or "").strip().lower()
        eligible = (
            allowed_scope == "all"
            or (allowed_scope == "categories" and category_name in allowed_categories)
            or (allowed_scope == "items" and item_name in allowed_items)
        )
        for _ in range(int(item.qty or 0)):
            if not eligible:
                excess_due += unit_price
            else:
                covered = min(unit_price, item_cap)
                benefit_used += covered
                if unit_price > item_cap:
                    excess_due += unit_price - item_cap
    remaining = max(Decimal("0"), daily_limit - used_today)
    overflow = max(Decimal("0"), benefit_used - remaining)
    final_due = (overflow + excess_due).quantize(Decimal("0.01"))
    return final_due, benefit_used.quantize(Decimal("0.01")), max(Decimal("0"), remaining - min(benefit_used, remaining)).quantize(Decimal("0.01"))


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

    if payload.offline_request_id:
        existing = (
            db.query(Sale)
            .filter(
                Sale.tenant_id == tenant.id,
                Sale.offline_request_id == payload.offline_request_id,
            )
            .first()
        )
        if existing:
            return {
                "sale_id": existing.id,
                "receipt_code": existing.receipt_code,
                "receipt_token": existing.receipt_token,
                "total": existing.total,
                "created_at": existing.created_at,
            }

    customer = None
    current_stars: int | None = None
    customer_type = "Normal"
    customer_discount = Decimal("0")
    if payload.customer_card_id:
        customer = (
            db.query(Customer)
            .filter(Customer.tenant_id == tenant.id, Customer.card_id == str(payload.customer_card_id).strip())
            .first()
        )
        if customer:
            current_stars = int(customer.stars or 0)
            customer_type = str(customer.type or "Normal")
            customer_discount = Decimal(str(customer.discount_percent or 0))

    manual_discount = Decimal(str(payload.discount_percent or 0))
    effective_discount = max(manual_discount, customer_discount)
    subtotal = sum((Decimal(str(i.price)) * i.qty for i in payload.cart_items), Decimal("0"))
    discount = (subtotal * (effective_discount / Decimal("100"))).quantize(Decimal("0.01"))
    total = (subtotal - discount).quantize(Decimal("0.01"))
    reward_claim = None
    reward_discount = Decimal("0.00")

    coffee_unit_prices: list[Decimal] = []
    coffee_qty = 0
    for item in payload.cart_items:
        if _is_coffee_like(item.item_name, item.category, item.is_coffee):
            coffee_qty += int(item.qty or 0)
            discounted_unit = (Decimal(str(item.price)) * (Decimal("1") - (effective_discount / Decimal("100")))).quantize(Decimal("0.01"))
            for _ in range(int(item.qty or 0)):
                coffee_unit_prices.append(discounted_unit)
    free_coffees = 0
    customer_stars_after = 0
    if current_stars is not None:
        free_coffees = int((current_stars + coffee_qty) // 10)
        customer_stars_after = (current_stars + coffee_qty) % 10 if coffee_qty > 0 else current_stars
        if free_coffees > 0 and coffee_unit_prices:
            coffee_unit_prices.sort()
            free_discount = sum(coffee_unit_prices[:free_coffees], Decimal("0"))
            discount += free_discount
            total = max(Decimal("0"), subtotal - discount).quantize(Decimal("0.01"))

    if payload.reward_claim_code:
        if not customer:
            raise HTTPException(status_code=400, detail="Reward istifadə etmək üçün müştəri kartı seçilməlidir")
        reward_claim = (
            db.query(RewardClaim)
            .filter(
                RewardClaim.tenant_id == tenant.id,
                RewardClaim.card_id == customer.card_id,
                RewardClaim.claim_code == str(payload.reward_claim_code).strip().upper(),
                RewardClaim.status == "PENDING",
            )
            .first()
        )
        if not reward_claim:
            raise HTTPException(status_code=400, detail="Reward code etibarlı deyil")
        reward_candidates = []
        for item in payload.cart_items:
            unit_price = (Decimal(str(item.price)) * (Decimal("1") - (effective_discount / Decimal("100")))).quantize(Decimal("0.01"))
            for _ in range(int(item.qty or 0)):
                reward_candidates.append(unit_price)
        if reward_candidates:
            reward_candidates.sort()
            reward_discount = reward_candidates[0]
            discount += reward_discount
            total = max(Decimal("0"), subtotal - discount).quantize(Decimal("0.01"))

    stock_ops: list[tuple[InventoryItem, Decimal]] = []
    cogs_total = Decimal("0.0000")
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
            cogs_total += (qty_required * Decimal(str(inventory.unit_cost or 0))).quantize(Decimal("0.0001"))

    receipt_code = secrets.token_hex(5).upper()
    receipt_token = secrets.token_hex(10)

    payment_method = str(payload.payment_method or "").strip().lower()
    staff_benefit_used = Decimal("0.00")
    if payment_method == "staff":
        staff_cfg = _setting_value(
            db,
            tenant.id,
            "staff_benefits",
            {"daily_limit_azn": 6, "allowed_scope": "all", "included_categories": [], "included_items": [], "item_unit_cap_azn": 6},
        )
        day_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = datetime.utcnow().replace(hour=23, minute=59, second=59, microsecond=999999)
        used_today = (
            db.query(FinanceEntry)
            .filter(
                FinanceEntry.tenant_id == tenant.id,
                FinanceEntry.created_by == user.username,
                FinanceEntry.category == "Staff Benefit",
                FinanceEntry.type == "out",
                FinanceEntry.created_at >= day_start,
                FinanceEntry.created_at <= day_end,
            )
            .all()
        )
        used_total = sum((Decimal(str(row.amount or 0)) for row in used_today), Decimal("0.00"))
        total, staff_benefit_used, _ = _calculate_staff_due(payload.cart_items, used_total, staff_cfg)

    sale = Sale(
        tenant_id=tenant.id,
        cashier=user.username,
        customer_card_id=payload.customer_card_id,
        payment_method=payload.payment_method,
        order_type=payload.order_type,
        offline_request_id=payload.offline_request_id,
        receipt_code=receipt_code,
        receipt_token=receipt_token,
        total=total,
        discount_amount=discount,
        reward_claim_code=str(payload.reward_claim_code or "").strip().upper() or None,
        cogs=cogs_total.quantize(Decimal("0.0001")),
        items_json=json.dumps([i.model_dump(mode="json") for i in payload.cart_items], ensure_ascii=False),
        status="COMPLETED",
        created_at=datetime.utcnow(),
    )
    db.add(sale)
    db.flush()

    for inventory, qty_required in stock_ops:
        inventory.stock_qty = (Decimal(str(inventory.stock_qty)) - qty_required).quantize(Decimal("0.001"))

    if payment_method == "split":
        split_cash = Decimal(str(payload.split_cash or "0")).quantize(Decimal("0.01"))
        split_card = Decimal(str(payload.split_card or "0")).quantize(Decimal("0.01"))
        if split_cash < 0 or split_card < 0:
            raise HTTPException(status_code=400, detail="Split amounts cannot be negative")
        if (split_cash + split_card - total).copy_abs() > Decimal("0.01"):
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
        if payment_method == "staff":
            if staff_benefit_used > 0:
                db.add(
                    FinanceEntry(
                        tenant_id=tenant.id,
                        type="out",
                        category="Staff Benefit",
                        source="cash",
                        amount=staff_benefit_used,
                        description=f"Staff benefit usage {sale.id}",
                        created_by=user.username,
                    )
                )
            if total > 0:
                db.add(
                    FinanceEntry(
                        tenant_id=tenant.id,
                        type="in",
                        category="Staff Ödənişi",
                        source="cash",
                        amount=total,
                        description=f"Staff payment {sale.id}",
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

    if customer is not None:
        customer.stars = customer_stars_after
        if reward_claim:
            customer.stars = max(0, int(customer.stars or 0) - int(reward_claim.points_cost or 0))
            reward_claim.status = "REDEEMED"
            reward_claim.redeemed_sale_id = sale.id
            reward_claim.redeemed_at = datetime.utcnow()

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
    tenant: Tenant = Depends(get_tenant),
):
    ref = str(sale_ref or "").strip()
    row = (
        db.query(Sale)
        .filter(Sale.tenant_id == tenant.id)
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
