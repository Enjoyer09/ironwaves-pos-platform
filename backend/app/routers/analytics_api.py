import json
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import FinanceEntry, InventoryItem, Recipe, Sale, Tenant, User


router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


class SaleAdjustIn(BaseModel):
    new_total: Decimal
    reason: str | None = None


class SaleVoidIn(BaseModel):
    reason: str
    return_to_stock: bool = True


class SalePartialRefundIn(BaseModel):
    refund_amount: Decimal
    reason: str


def _in_range(created_at: datetime | None, date_from: datetime | None, date_to: datetime | None) -> bool:
    if not created_at:
        return False
    if date_from and created_at < date_from:
        return False
    if date_to and created_at > date_to:
        return False
    return True


@router.get("/summary")
def get_sales_summary(
    date_from: str,
    date_to: str,
    cashier: str | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    start = datetime.fromisoformat(date_from.replace("Z", "+00:00")).replace(tzinfo=None)
    end = datetime.fromisoformat(date_to.replace("Z", "+00:00")).replace(tzinfo=None)
    rows = db.query(Sale).filter(Sale.tenant_id == tenant.id).all()
    total_revenue = Decimal("0")
    cash_sales = Decimal("0")
    card_sales = Decimal("0")
    void_count = 0
    total_cogs = Decimal("0")
    for row in rows:
        if not _in_range(row.created_at, start, end):
            continue
        if cashier and row.cashier != cashier:
            continue
        if row.status == "VOIDED":
            void_count += 1
            continue
        total_revenue += Decimal(str(row.total))
        total_cogs += Decimal(str(row.cogs or 0))
        pm = str(row.payment_method or "").lower()
        if pm in {"cash", "nəğd"}:
            cash_sales += Decimal(str(row.total))
        elif pm == "split":
            pass
        else:
            card_sales += Decimal(str(row.total))
    finance_rows = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant.id).all()
    split_cash = Decimal("0")
    split_card = Decimal("0")
    for row in finance_rows:
        if not _in_range(row.created_at, start, end):
            continue
        if row.type == "in" and row.category == "Satış (Nağd)":
            split_cash += Decimal(str(row.amount))
        if row.type == "in" and row.category == "Satış (Kart)":
            split_card += Decimal(str(row.amount))
    if split_cash > 0 or split_card > 0:
        cash_sales = split_cash
        card_sales = split_card
    return {
        "total_revenue": str(total_revenue.quantize(Decimal("0.01"))),
        "cash_sales": str(cash_sales.quantize(Decimal("0.01"))),
        "card_sales": str(card_sales.quantize(Decimal("0.01"))),
        "total_cogs": str(total_cogs.quantize(Decimal("0.01"))),
        "gross_profit": str((total_revenue - total_cogs).quantize(Decimal("0.01"))),
        "void_count": void_count,
    }


@router.get("/sales")
def get_sales_list(
    date_from: str,
    date_to: str,
    cashier: str | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    start = datetime.fromisoformat(date_from.replace("Z", "+00:00")).replace(tzinfo=None)
    end = datetime.fromisoformat(date_to.replace("Z", "+00:00")).replace(tzinfo=None)
    rows = db.query(Sale).filter(Sale.tenant_id == tenant.id).order_by(Sale.created_at.desc()).all()
    result = []
    for row in rows:
        if not _in_range(row.created_at, start, end):
            continue
        if cashier and row.cashier != cashier:
            continue
        items = json.loads(row.items_json or "[]")
        original_total = Decimal(str(row.total)) + Decimal(str(row.discount_amount or 0))
        result.append(
            {
                "id": row.id,
                "tenant_id": row.tenant_id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "cashier": row.cashier,
                "customer_card_id": row.customer_card_id,
                "customer_type": None,
                "original_total": str(original_total.quantize(Decimal("0.01"))),
                "discount_amount": str(Decimal(str(row.discount_amount or 0)).quantize(Decimal("0.01"))),
                "total": str(Decimal(str(row.total)).quantize(Decimal("0.01"))),
                "cogs": str(Decimal(str(row.cogs or 0)).quantize(Decimal("0.01"))),
                "payment_method": row.payment_method,
                "order_type": row.order_type,
                "items": items,
                "items_display": ", ".join([f"{item.get('item_name')} x{item.get('qty')}" for item in items]),
                "status": row.status,
                "is_test": False,
            }
        )
    return result


@router.post("/sales/{sale_id}/void")
def void_sale(
    sale_id: str,
    payload: SaleVoidIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(Sale).filter(Sale.id == sale_id, Sale.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Sale not found")
    if row.status == "VOIDED":
        raise HTTPException(status_code=400, detail="Sale already voided")

    items = json.loads(row.items_json or "[]")
    if payload.return_to_stock:
        for item in items:
            recipes = (
                db.query(Recipe)
                .filter(Recipe.tenant_id == tenant.id, func.lower(Recipe.menu_item_name) == str(item.get("item_name") or "").lower())
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
                add_qty = (Decimal(str(recipe.quantity_required or 0)) * Decimal(str(item.get("qty") or 0))).quantize(Decimal("0.0001"))
                inventory.stock_qty = (Decimal(str(inventory.stock_qty or 0)) + add_qty).quantize(Decimal("0.001"))

    row.status = "VOIDED"
    amount = Decimal(str(row.total)).quantize(Decimal("0.01"))
    pm = str(row.payment_method or "").lower()
    if pm == "split":
        finance_rows = (
            db.query(FinanceEntry)
            .filter(FinanceEntry.tenant_id == tenant.id, FinanceEntry.type == "in", FinanceEntry.description.ilike(f"%{row.id}%"))
            .all()
        )
        for finance_row in finance_rows:
            db.add(
                FinanceEntry(
                    tenant_id=tenant.id,
                    type="out",
                    category="Refund / Ləğv",
                    source=finance_row.source,
                    amount=Decimal(str(finance_row.amount)).quantize(Decimal("0.01")),
                    description=f"VOID: {payload.reason} ({row.id})",
                    created_by=user.username,
                )
            )
    else:
        source = "cash" if pm in {"cash", "nəğd", "staff"} else "card"
        db.add(FinanceEntry(tenant_id=tenant.id, type="out", category="Refund / Ləğv", source=source, amount=amount, description=f"VOID: {payload.reason}", created_by=user.username))
    db.commit()
    return {"success": True}


@router.post("/sales/{sale_id}/adjust")
def adjust_sale(
    sale_id: str,
    payload: SaleAdjustIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(Sale).filter(Sale.id == sale_id, Sale.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Sale not found")
    if row.status == "VOIDED":
        raise HTTPException(status_code=400, detail="Voided sale cannot be adjusted")
    row.total = payload.new_total.quantize(Decimal("0.01"))
    db.commit()
    return {"success": True}


@router.post("/sales/{sale_id}/partial-refund")
def partial_refund_sale(
    sale_id: str,
    payload: SalePartialRefundIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(Sale).filter(Sale.id == sale_id, Sale.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Sale not found")
    if row.status == "VOIDED":
        raise HTTPException(status_code=400, detail="Voided sale cannot be refunded")

    current_total = Decimal(str(row.total or 0)).quantize(Decimal("0.01"))
    refund_amount = Decimal(str(payload.refund_amount or 0)).quantize(Decimal("0.01"))
    if refund_amount <= 0:
        raise HTTPException(status_code=400, detail="Refund amount must be greater than 0")
    if refund_amount >= current_total:
        raise HTTPException(status_code=400, detail="Use VOID for full refund")

    pm = str(row.payment_method or "").lower()
    if pm == "split":
        finance_rows = (
            db.query(FinanceEntry)
            .filter(FinanceEntry.tenant_id == tenant.id, FinanceEntry.type == "in", FinanceEntry.description.ilike(f"%{row.id}%"))
            .all()
        )
        total_in = sum((Decimal(str(finance_row.amount or 0)) for finance_row in finance_rows), Decimal("0.00"))
        remaining = refund_amount
        for idx, finance_row in enumerate(finance_rows):
            if total_in <= 0:
                break
            if idx == len(finance_rows) - 1:
                part = remaining
            else:
                ratio = Decimal(str(finance_row.amount or 0)) / total_in
                part = (refund_amount * ratio).quantize(Decimal("0.01"))
                remaining -= part
            if part <= 0:
                continue
            db.add(
                FinanceEntry(
                    tenant_id=tenant.id,
                    type="out",
                    category="Partial Refund",
                    source=finance_row.source,
                    amount=part,
                    description=f"PARTIAL REFUND: {payload.reason} ({row.id})",
                    created_by=user.username,
                )
            )
    else:
        source = "cash" if pm in {"cash", "nəğd", "staff"} else "card"
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="out",
                category="Partial Refund",
                source=source,
                amount=refund_amount,
                description=f"PARTIAL REFUND: {payload.reason} ({row.id})",
                created_by=user.username,
            )
        )

    row.total = (current_total - refund_amount).quantize(Decimal("0.01"))
    row.status = "PARTIAL_REFUND"
    db.commit()
    return {"success": True, "remaining_total": str(row.total)}
