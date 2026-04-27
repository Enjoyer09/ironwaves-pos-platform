import json
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.json_utils import safe_json_list
from app.models import Customer, FinanceEntry, FinanceTransaction, InventoryItem, LoyaltyLedgerEntry, Recipe, RewardClaim, Sale, Setting, Tenant, User
from app.services.finance_service import (
    finance_account_code as _finance_account_code,
    mark_original_transaction_reversed as _mark_original_transaction_reversed,
    mirror_posted_transaction_to_legacy_wallet as _mirror_posted_transaction_to_legacy_wallet,
    post_existing_transaction as _post_existing_transaction,
    post_finance_transaction as _post_finance_transaction,
    post_sale_payment,
)


router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


class SaleAdjustIn(BaseModel):
    new_total: Decimal
    reason: str | None = None
    payment_method: str | None = None
    split_cash: Decimal | None = None
    split_card: Decimal | None = None


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


def _setting_value(db: Session, tenant_id: str, key: str, default):
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    if not row or row.value is None:
        return default
    try:
        return json.loads(row.value)
    except Exception:
        return default


def _normalize_payment_method(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"cash", "nəğd", "nagd", "nağd"}:
        return "cash"
    if normalized in {"split", "bölünmüş", "bolunmus"}:
        return "split"
    if normalized == "staff":
        return "staff"
    return "card"


def _display_payment_method(value: str) -> str:
    if value == "cash":
        return "Nəğd"
    if value == "split":
        return "Split"
    if value == "staff":
        return "Staff"
    return "Kart"


def _reverse_sale_finance_transactions(db: Session, tenant_id: str, sale_id: str, username: str) -> None:
    rows = (
        db.query(FinanceTransaction)
        .filter(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == sale_id,
            FinanceTransaction.status == "posted",
            FinanceTransaction.transaction_type.in_(["income", "expense"]),
        )
        .all()
    )
    for original in rows:
        source_code = _finance_account_code(db, tenant_id, original.destination_account_id)
        destination_code = _finance_account_code(db, tenant_id, original.source_account_id)
        if not source_code or not destination_code:
            continue
        reversal = _post_finance_transaction(
            db,
            tenant_id=tenant_id,
            transaction_type="reversal",
            amount=Decimal(str(original.amount)).quantize(Decimal("0.01")),
            source_code=source_code,
            destination_code=destination_code,
            created_by=username,
            category=f"Sale Correction: {original.category or original.transaction_type}",
            reference=original.id,
            note=f"Sale correction reversal for {sale_id}",
            related_order_id=sale_id,
        )
        _mark_original_transaction_reversed(db, reversal, username)
        _mirror_posted_transaction_to_legacy_wallet(db, reversal, username)


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
    sales_query = db.query(Sale).filter(
        Sale.tenant_id == tenant.id,
        Sale.created_at >= start,
        Sale.created_at <= end,
    )
    if cashier:
        sales_query = sales_query.filter(Sale.cashier == cashier)
    rows = sales_query.all()
    total_revenue = Decimal("0")
    cash_sales = Decimal("0")
    card_sales = Decimal("0")
    void_count = 0
    total_cogs = Decimal("0")
    for row in rows:
        if row.status == "VOIDED":
            void_count += 1
            continue
        total_revenue += Decimal(str(row.total))
        total_cogs += Decimal(str(row.cogs or 0))
    finance_query = db.query(FinanceEntry).filter(
        FinanceEntry.tenant_id == tenant.id,
        FinanceEntry.created_at >= start,
        FinanceEntry.created_at <= end,
    )
    if cashier:
        finance_query = finance_query.filter(FinanceEntry.created_by == cashier)
    finance_rows = finance_query.all()
    cash_total = Decimal("0")
    card_total = Decimal("0")
    for row in finance_rows:
        if row.type != "in":
            continue
        category = str(row.category or "")
        if category in {"Satış (Nağd)", "Staff Ödənişi"}:
            cash_total += Decimal(str(row.amount))
        elif category == "Satış (Kart)":
            card_total += Decimal(str(row.amount))
    cash_sales = cash_total
    card_sales = card_total
    ledger_total = cash_sales + card_sales
    reconciliation_gap = (total_revenue - ledger_total).quantize(Decimal("0.01"))
    return {
        "total_revenue": str(total_revenue.quantize(Decimal("0.01"))),
        "cash_sales": str(cash_sales.quantize(Decimal("0.01"))),
        "card_sales": str(card_sales.quantize(Decimal("0.01"))),
        "ledger_sales_total": str(ledger_total.quantize(Decimal("0.01"))),
        "reconciliation_gap": str(reconciliation_gap),
        "has_reconciliation_issue": abs(reconciliation_gap) > Decimal("0.01"),
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
    sales_query = db.query(Sale).filter(
        Sale.tenant_id == tenant.id,
        Sale.created_at >= start,
        Sale.created_at <= end,
    )
    if cashier:
        sales_query = sales_query.filter(Sale.cashier == cashier)
    rows = sales_query.order_by(Sale.created_at.desc()).all()
    result = []
    for row in rows:
        items = safe_json_list(row.items_json)
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
                "receipt_code": row.receipt_code,
                "receipt_token": row.receipt_token,
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

    items = safe_json_list(row.items_json)
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
    loyalty_cfg = _setting_value(db, tenant.id, "customer_app_settings", {"program_mode": "points", "cashback_percent": 5})
    program_mode = str(loyalty_cfg.get("program_mode") or "points").lower()
    cashback_percent = Decimal(str(loyalty_cfg.get("cashback_percent") or 0))
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
        if pm == "staff":
            benefit_rows = (
                db.query(FinanceEntry)
                .filter(
                    FinanceEntry.tenant_id == tenant.id,
                    FinanceEntry.type == "out",
                    FinanceEntry.category == "Staff Benefit",
                    FinanceEntry.description.ilike(f"%{row.id}%"),
                )
                .all()
            )
            for benefit_row in benefit_rows:
                db.add(
                    FinanceEntry(
                        tenant_id=tenant.id,
                        type="in",
                        category="Staff Benefit Reversal",
                        source="cash",
                        amount=Decimal(str(benefit_row.amount)).quantize(Decimal("0.01")),
                        description=f"VOID reverse benefit: {payload.reason} ({row.id})",
                        created_by=user.username,
                )
            )
    if row.customer_card_id and program_mode == "cashback":
        cashback_amount = (amount * (cashback_percent / Decimal("100"))).quantize(Decimal("0.01"))
        if cashback_amount > 0:
            db.add(
                LoyaltyLedgerEntry(
                    tenant_id=tenant.id,
                    card_id=row.customer_card_id,
                    unit="cashback",
                    entry_type="reversal",
                    amount=Decimal("0.00") - cashback_amount,
                    source_sale_id=row.id,
                    description=f"VOID cashback reverse ({row.id})",
                )
            )
        if getattr(row, "reward_claim_code", None):
            claim = db.query(RewardClaim).filter(RewardClaim.tenant_id == tenant.id, RewardClaim.claim_code == row.reward_claim_code).first()
            if claim and claim.status == "REDEEMED":
                claim.status = "PENDING"
                claim.redeemed_sale_id = None
                claim.redeemed_at = None
                db.add(
                    LoyaltyLedgerEntry(
                        tenant_id=tenant.id,
                        card_id=row.customer_card_id,
                        unit="cashback",
                        entry_type="reversal",
                        amount=Decimal(str(claim.points_cost or 0)).quantize(Decimal("0.01")),
                        source_sale_id=row.id,
                        description=f"VOID reward restore ({claim.claim_code})",
                    )
                )
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

    next_total = Decimal(str(payload.new_total or 0)).quantize(Decimal("0.01"))
    if next_total <= 0:
        raise HTTPException(status_code=400, detail="New total must be greater than 0")

    next_method = _normalize_payment_method(payload.payment_method or row.payment_method)
    split_cash = Decimal(str(payload.split_cash or 0)).quantize(Decimal("0.01"))
    split_card = Decimal(str(payload.split_card or 0)).quantize(Decimal("0.01"))
    if next_method == "split":
        if split_cash < 0 or split_card < 0:
            raise HTTPException(status_code=400, detail="Split amounts cannot be negative")
        if (split_cash + split_card - next_total).copy_abs() > Decimal("0.01"):
            raise HTTPException(status_code=400, detail="Split amounts must equal total")

    _reverse_sale_finance_transactions(db, tenant.id, row.id, user.username)
    row.total = next_total
    row.payment_method = _display_payment_method(next_method)

    card_sale_percent = Decimal(str(_setting_value(db, tenant.id, "bank_commission", {"card_sale_percent": 2}).get("card_sale_percent", 2) or 2))
    if next_method == "split":
        if split_cash > 0:
            post_sale_payment(
                db,
                tenant_id=tenant.id,
                sale_id=row.id,
                amount=split_cash,
                payment_source="cash",
                created_by=user.username,
                category="Satış (Nağd)",
                note=f"Sale correction {row.id} split cash",
            )
        if split_card > 0:
            post_sale_payment(
                db,
                tenant_id=tenant.id,
                sale_id=row.id,
                amount=split_card,
                payment_source="card",
                created_by=user.username,
                category="Satış (Kart)",
                note=f"Sale correction {row.id} split card",
                card_fee_percent=card_sale_percent,
            )
    elif next_method == "staff":
        post_sale_payment(
            db,
            tenant_id=tenant.id,
            sale_id=row.id,
            amount=next_total,
            payment_source="cash",
            created_by=user.username,
            category="Staff Ödənişi",
            note=f"Sale correction {row.id} staff payment",
        )
    else:
        payment_source = "cash" if next_method == "cash" else "card"
        post_sale_payment(
            db,
            tenant_id=tenant.id,
            sale_id=row.id,
            amount=next_total,
            payment_source=payment_source,
            created_by=user.username,
            category="Satış (Nağd)" if payment_source == "cash" else "Satış (Kart)",
            note=f"Sale correction {row.id}",
            card_fee_percent=card_sale_percent if payment_source == "card" else Decimal("0"),
        )
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
    loyalty_cfg = _setting_value(db, tenant.id, "customer_app_settings", {"program_mode": "points", "cashback_percent": 5})
    program_mode = str(loyalty_cfg.get("program_mode") or "points").lower()
    cashback_percent = Decimal(str(loyalty_cfg.get("cashback_percent") or 0))
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
    if row.customer_card_id and program_mode == "cashback":
        cashback_amount = (refund_amount * (cashback_percent / Decimal("100"))).quantize(Decimal("0.01"))
        if cashback_amount > 0:
            db.add(
                LoyaltyLedgerEntry(
                    tenant_id=tenant.id,
                    card_id=row.customer_card_id,
                    unit="cashback",
                    entry_type="reversal",
                    amount=Decimal("0.00") - cashback_amount,
                    source_sale_id=row.id,
                    description=f"Partial refund cashback reverse ({row.id})",
                )
            )
    db.commit()
    return {"success": True, "remaining_total": str(row.total)}
