import json
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, case, exists, func, or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.json_utils import safe_json_list
from app.models import Customer, FinanceAccount, FinanceEntry, FinanceTransaction, InventoryItem, LoyaltyLedgerEntry, Recipe, RewardClaim, Sale, Setting, Tenant, User
from app.services.finance_service import (
    finance_account_code as _finance_account_code,
    mark_original_transaction_reversed as _mark_original_transaction_reversed,
    mirror_posted_transaction_to_legacy_wallet as _mirror_posted_transaction_to_legacy_wallet,
    post_existing_transaction as _post_existing_transaction,
    post_finance_transaction as _post_finance_transaction,
    post_sale_payment,
    sales_payment_totals as _sales_payment_totals,
)


router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])
VOID_SALE_STATUSES = [
    "VOIDED",
    "VOID",
    "CANCELLED",
    "CANCELED",
    "CANCELLED SALE",
    "CANCELED SALE",
    "LƏĞV",
    "LƏĞV EDILDI",
    "LƏĞV EDİLDİ",
    "LEĞV",
    "LEĞV EDILDI",
    "LEĞV EDİLDİ",
    "LAGV",
    "LAGV EDILDI",
]
SALE_PAYMENT_TRANSACTION_TYPES = ["income", "deposit_apply_to_bill"]
SALE_PAYMENT_LEDGER_TRANSACTION_TYPES = ["income", "deposit_apply_to_bill", "reversal"]


def _is_void_sale_status(value: str | None) -> bool:
    return str(value or "").strip().upper() in VOID_SALE_STATUSES


def _sale_is_void_expr(tenant_id: str):
    sale_status_is_void = func.upper(func.trim(func.coalesce(Sale.status, ""))).in_(VOID_SALE_STATUSES)
    sale_has_posted_payment = exists().where(
        and_(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == Sale.id,
            FinanceTransaction.status == "posted",
            FinanceTransaction.transaction_type.in_(SALE_PAYMENT_TRANSACTION_TYPES),
        )
    )
    sale_has_payment_ledger = exists().where(
        and_(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == Sale.id,
            FinanceTransaction.transaction_type.in_(SALE_PAYMENT_LEDGER_TRANSACTION_TYPES),
        )
    )
    return or_(sale_status_is_void, and_(sale_has_payment_ledger, ~sale_has_posted_payment))


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
    if date_to and created_at >= date_to:
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


def _sale_payment_split(db: Session, tenant_id: str, sale_id: str) -> tuple[Decimal, Decimal]:
    rows = (
        db.query(FinanceAccount.code, func.coalesce(func.sum(FinanceTransaction.amount), 0))
        .join(FinanceAccount, FinanceAccount.id == FinanceTransaction.destination_account_id)
        .filter(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == sale_id,
            FinanceTransaction.status == "posted",
            FinanceTransaction.transaction_type == "income",
            FinanceAccount.code.in_(["cash", "card"]),
        )
        .group_by(FinanceAccount.code)
        .all()
    )
    cash = Decimal("0.00")
    card = Decimal("0.00")
    for code, amount in rows:
        if code == "cash":
            cash = Decimal(str(amount or 0)).quantize(Decimal("0.01"))
        elif code == "card":
            card = Decimal(str(amount or 0)).quantize(Decimal("0.01"))
    return cash, card


def _sale_has_posted_ledger_payments(db: Session, tenant_id: str, sale_id: str) -> bool:
    return (
        db.query(FinanceTransaction.id)
        .filter(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == sale_id,
            FinanceTransaction.status == "posted",
            FinanceTransaction.transaction_type.in_(["income", "expense", "deposit_apply_to_bill", "cogs_recognition"]),
        )
        .first()
        is not None
    )


def _sale_has_deposit_application(db: Session, tenant_id: str, sale_id: str) -> bool:
    return (
        db.query(FinanceTransaction.id)
        .filter(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == sale_id,
            FinanceTransaction.status == "posted",
            FinanceTransaction.transaction_type == "deposit_apply_to_bill",
        )
        .first()
        is not None
    )


def _post_sale_payment_parts(
    db: Session,
    *,
    tenant_id: str,
    sale_id: str,
    total: Decimal,
    payment_method: str,
    split_cash: Decimal = Decimal("0.00"),
    split_card: Decimal = Decimal("0.00"),
    username: str,
    card_fee_percent: Decimal,
    note_prefix: str,
) -> None:
    method = _normalize_payment_method(payment_method)
    total = Decimal(str(total)).quantize(Decimal("0.01"))
    split_cash = Decimal(str(split_cash or 0)).quantize(Decimal("0.01"))
    split_card = Decimal(str(split_card or 0)).quantize(Decimal("0.01"))
    if method == "split":
        if split_cash > 0:
            post_sale_payment(
                db,
                tenant_id=tenant_id,
                sale_id=sale_id,
                amount=split_cash,
                payment_source="cash",
                created_by=username,
                category="Satış (Nağd)",
                note=f"{note_prefix} split cash",
            )
        if split_card > 0:
            post_sale_payment(
                db,
                tenant_id=tenant_id,
                sale_id=sale_id,
                amount=split_card,
                payment_source="card",
                created_by=username,
                category="Satış (Kart)",
                note=f"{note_prefix} split card",
                card_fee_percent=card_fee_percent,
            )
        return
    if method == "staff":
        post_sale_payment(
            db,
            tenant_id=tenant_id,
            sale_id=sale_id,
            amount=total,
            payment_source="cash",
            created_by=username,
            category="Staff Ödənişi",
            note=f"{note_prefix} staff payment",
        )
        return
    payment_source = "cash" if method == "cash" else "card"
    post_sale_payment(
        db,
        tenant_id=tenant_id,
        sale_id=sale_id,
        amount=total,
        payment_source=payment_source,
        created_by=username,
        category="Satış (Nağd)" if payment_source == "cash" else "Satış (Kart)",
        note=note_prefix,
        card_fee_percent=card_fee_percent if payment_source == "card" else Decimal("0"),
    )


def _reverse_sale_finance_transactions(
    db: Session,
    tenant_id: str,
    sale_id: str,
    username: str,
    *,
    include_cogs: bool = False,
) -> None:
    transaction_types = ["income", "expense", "deposit_apply_to_bill"]
    if include_cogs:
        transaction_types.append("cogs_recognition")
    rows = (
        db.query(FinanceTransaction)
        .filter(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == sale_id,
            FinanceTransaction.status == "posted",
            FinanceTransaction.transaction_type.in_(transaction_types),
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
    # Staff can only see their own sales
    effective_cashier = cashier
    if str(user.role or "").lower() == "staff":
        effective_cashier = user.username

    start = datetime.fromisoformat(date_from.replace("Z", "+00:00")).replace(tzinfo=None)
    end = datetime.fromisoformat(date_to.replace("Z", "+00:00")).replace(tzinfo=None)
    sales_filters = [
        Sale.tenant_id == tenant.id,
        Sale.created_at >= start,
        Sale.created_at < end,
    ]
    if effective_cashier:
        sales_filters.append(Sale.cashier == effective_cashier)
    sale_is_net = ~_sale_is_void_expr(tenant.id)
    total_cogs_raw, gross_sales_raw = (
        db.query(
            func.coalesce(
                func.sum(
                    case(
                        (sale_is_net, Sale.cogs),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (sale_is_net, Sale.total),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .filter(*sales_filters)
        .one()
    )
    total_cogs = Decimal(str(total_cogs_raw or 0))
    gross_sales = Decimal(str(gross_sales_raw or 0))
    totals = _sales_payment_totals(db, tenant.id, start, end, cashier=cashier)
    total_revenue = totals["sales_total"]
    cash_sales = totals["cash_sales"]
    card_sales = totals["card_sales"]
    deposit_applied = totals["deposit_applied"]
    ledger_total = totals["ledger_sales_total"]
    reconciliation_gap = totals["reconciliation_gap"]
    void_count = int(totals["void_count"])
    void_sales = totals["void_sales"]

    # Fetch active, non-voided sales for hourly, payment and delivery breakdown
    raw_sales = (
        db.query(Sale.created_at, Sale.total, Sale.payment_method, Sale.order_type, Sale.cashier)
        .filter(*sales_filters, sale_is_net)
        .all()
    )

    # Initialize Hourly Sales (24 hours: "00:00" to "23:00")
    hourly_sums = [Decimal("0.00")] * 24

    # Initialize Payment Methods
    payment_sums = {
        "cash": Decimal("0.00"),
        "card": Decimal("0.00"),
        "split": Decimal("0.00"),
        "staff": Decimal("0.00"),
    }

    # Initialize Delivery Channels
    bolt_count = 0
    bolt_revenue = Decimal("0.00")
    wolt_count = 0
    wolt_revenue = Decimal("0.00")
    dine_in_count = 0
    dine_in_revenue = Decimal("0.00")
    takeaway_count = 0
    takeaway_revenue = Decimal("0.00")

    for s_created_at, s_total, s_pm, s_ot, s_cashier in raw_sales:
        total_val = Decimal(str(s_total or 0))
        
        # 1. Hourly aggregation
        if s_created_at:
            hr = s_created_at.hour
            if 0 <= hr < 24:
                hourly_sums[hr] += total_val
        
        # 2. Payment method aggregation
        pm_norm = _normalize_payment_method(s_pm)
        if pm_norm in payment_sums:
            payment_sums[pm_norm] += total_val
        else:
            payment_sums["card"] += total_val  # Default fallback
            
        # 3. Delivery Channels aggregation
        ot_upper = str(s_ot or "").strip().upper()
        cashier_lower = str(s_cashier or "").strip().lower()
        
        if ot_upper == "DELIVERY" and "bolt" in cashier_lower:
            bolt_count += 1
            bolt_revenue += total_val
        elif ot_upper == "DELIVERY" and "wolt" in cashier_lower:
            wolt_count += 1
            wolt_revenue += total_val
        elif ot_upper in ("DINE_IN", "DINEIN") or "dine" in ot_upper:
            dine_in_count += 1
            dine_in_revenue += total_val
        elif ot_upper in ("TAKEAWAY", "TAKE_AWAY") or "take" in ot_upper:
            takeaway_count += 1
            takeaway_revenue += total_val
        else:
            if "bolt" in cashier_lower:
                bolt_count += 1
                bolt_revenue += total_val
            elif "wolt" in cashier_lower:
                wolt_count += 1
                wolt_revenue += total_val
            elif ot_upper == "DELIVERY":
                takeaway_count += 1
                takeaway_revenue += total_val
            else:
                dine_in_count += 1
                dine_in_revenue += total_val

    hourly_trend = []
    for h in range(24):
        hourly_trend.append({
            "hour": f"{h:02d}:00",
            "sales": float(hourly_sums[h].quantize(Decimal("0.01"))),
        })

    payment_breakdown = [
        {"name": "cash", "value": float(payment_sums["cash"].quantize(Decimal("0.01")))},
        {"name": "card", "value": float(payment_sums["card"].quantize(Decimal("0.01")))},
        {"name": "split", "value": float(payment_sums["split"].quantize(Decimal("0.01")))},
        {"name": "staff", "value": float(payment_sums["staff"].quantize(Decimal("0.01")))},
    ]

    # Fetch delivery integrations settings
    setting_row = db.query(Setting).filter(Setting.tenant_id == tenant.id, Setting.key == "delivery_integrations").first()
    settings_dict = {}
    if setting_row and setting_row.value:
        try:
            settings_dict = json.loads(setting_row.value)
        except Exception:
            pass
    bolt_enabled = bool(settings_dict.get("bolt_food_enabled", False))
    wolt_enabled = bool(settings_dict.get("wolt_enabled", False))

    return {
        "total_revenue": str(total_revenue.quantize(Decimal("0.01"))),
        "cash_sales": str(cash_sales.quantize(Decimal("0.01"))),
        "card_sales": str(card_sales.quantize(Decimal("0.01"))),
        "deposit_applied_sales": str(deposit_applied.quantize(Decimal("0.01"))),
        "ledger_sales_total": str(ledger_total.quantize(Decimal("0.01"))),
        "gross_sales": str(gross_sales.quantize(Decimal("0.01"))),
        "void_sales": str(void_sales.quantize(Decimal("0.01"))),
        "reconciliation_gap": str(reconciliation_gap),
        "has_reconciliation_issue": abs(reconciliation_gap) > Decimal("0.01"),
        "total_cogs": str(total_cogs.quantize(Decimal("0.01"))),
        "gross_profit": str((total_revenue - total_cogs).quantize(Decimal("0.01"))),
        "void_count": void_count,
        "hourly_trend": hourly_trend,
        "payment_breakdown": payment_breakdown,
        "channels": {
            "bolt": {
                "count": bolt_count,
                "revenue": str(bolt_revenue.quantize(Decimal("0.01"))),
                "enabled": bolt_enabled
            },
            "wolt": {
                "count": wolt_count,
                "revenue": str(wolt_revenue.quantize(Decimal("0.01"))),
                "enabled": wolt_enabled
            },
            "dine_in": {
                "count": dine_in_count,
                "revenue": str(dine_in_revenue.quantize(Decimal("0.01")))
            },
            "takeaway": {
                "count": takeaway_count,
                "revenue": str(takeaway_revenue.quantize(Decimal("0.01")))
            }
        }
    }


@router.get("/sales")
def get_sales_list(
    date_from: str,
    date_to: str,
    cashier: str | None = None,
    limit: int | None = Query(default=None, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    include_receipt_html: bool = False,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    # Staff can only see their own sales
    effective_cashier = cashier
    if str(user.role or "").lower() == "staff":
        effective_cashier = user.username

    start = datetime.fromisoformat(date_from.replace("Z", "+00:00")).replace(tzinfo=None)
    end = datetime.fromisoformat(date_to.replace("Z", "+00:00")).replace(tzinfo=None)
    sales_query = db.query(Sale).filter(
        Sale.tenant_id == tenant.id,
        Sale.created_at >= start,
        Sale.created_at < end,
    )
    if effective_cashier:
        sales_query = sales_query.filter(Sale.cashier == effective_cashier)
    sales_query = sales_query.order_by(Sale.created_at.desc())
    if offset:
        sales_query = sales_query.offset(offset)
    if limit:
        sales_query = sales_query.limit(limit)
    rows = sales_query.all()
    sale_ids = [str(row.id) for row in rows]
    ledger_void_sale_ids: set[str] = set()
    if sale_ids:
        posted_payment_sale_ids = {
            str(row[0])
            for row in db.query(FinanceTransaction.related_order_id)
            .filter(
                FinanceTransaction.tenant_id == tenant.id,
                FinanceTransaction.related_order_id.in_(sale_ids),
                FinanceTransaction.status == "posted",
                FinanceTransaction.transaction_type.in_(SALE_PAYMENT_TRANSACTION_TYPES),
            )
            .distinct()
            .all()
            if row[0]
        }
        payment_ledger_sale_ids = {
            str(row[0])
            for row in db.query(FinanceTransaction.related_order_id)
            .filter(
                FinanceTransaction.tenant_id == tenant.id,
                FinanceTransaction.related_order_id.in_(sale_ids),
                FinanceTransaction.transaction_type.in_(SALE_PAYMENT_LEDGER_TRANSACTION_TYPES),
            )
            .distinct()
            .all()
            if row[0]
        }
        ledger_void_sale_ids = payment_ledger_sale_ids - posted_payment_sale_ids

    bank_fees_dict: dict[str, Decimal] = {}
    if sale_ids:
        fee_rows = (
            db.query(FinanceTransaction.related_order_id, func.sum(FinanceTransaction.amount))
            .filter(
                FinanceTransaction.tenant_id == tenant.id,
                FinanceTransaction.related_order_id.in_(sale_ids),
                FinanceTransaction.status == "posted",
                FinanceTransaction.category == "Bank Komissiyası",
            )
            .group_by(FinanceTransaction.related_order_id)
            .all()
        )
        bank_fees_dict = {str(order_id): Decimal(str(amount or 0)) for order_id, amount in fee_rows if order_id}

    result = []
    for row in rows:
        items = safe_json_list(row.items_json)
        original_total = Decimal(str(row.total)) + Decimal(str(row.discount_amount or 0))
        split_cash, split_card = _sale_payment_split(db, tenant.id, row.id)
        is_void = _is_void_sale_status(row.status) or str(row.id) in ledger_void_sale_ids
        result.append(
            {
                "id": row.id,
                "tenant_id": row.tenant_id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "cashier": row.cashier,
                "customer_card_id": row.customer_card_id,
                "customer_stars_after": getattr(row, "customer_stars_after", 0) or 0,
                "free_coffees_applied": getattr(row, "free_coffees_applied", 0) or 0,
                "customer_type": None,
                "original_total": str(original_total.quantize(Decimal("0.01"))),
                "discount_amount": str(Decimal(str(row.discount_amount or 0)).quantize(Decimal("0.01"))),
                "total": str(Decimal(str(row.total)).quantize(Decimal("0.01"))),
                "cogs": str(Decimal(str(row.cogs or 0)).quantize(Decimal("0.01"))),
                "payment_method": row.payment_method,
                "bank_fee": str(bank_fees_dict.get(str(row.id), Decimal("0.00")).quantize(Decimal("0.01"))),
                "split_cash": str(split_cash) if split_cash > 0 else None,
                "split_card": str(split_card) if split_card > 0 else None,
                "order_type": row.order_type,
                "receipt_code": row.receipt_code,
                "receipt_token": row.receipt_token,
                "receipt_html": "" if is_void else ((row.receipt_html or "") if include_receipt_html else ""),
                "items": items,
                "items_display": ", ".join([f"{item.get('item_name')} x{item.get('qty')}" for item in items]),
                "status": "VOIDED" if is_void else row.status,
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
    if _is_void_sale_status(row.status):
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
    row.receipt_html = None
    amount = Decimal(str(row.total)).quantize(Decimal("0.01"))
    pm = str(row.payment_method or "").lower()
    loyalty_cfg = _setting_value(db, tenant.id, "customer_app_settings", {"program_mode": "points", "cashback_percent": 5})
    program_mode = str(loyalty_cfg.get("program_mode") or "points").lower()
    cashback_percent = Decimal(str(loyalty_cfg.get("cashback_percent") or 0))
    ledger_backed = _sale_has_posted_ledger_payments(db, tenant.id, row.id)
    if ledger_backed:
        _reverse_sale_finance_transactions(db, tenant.id, row.id, user.username, include_cogs=True)
    else:
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
    if _is_void_sale_status(row.status):
        raise HTTPException(status_code=400, detail="Voided sale cannot be adjusted")
    if _sale_has_deposit_application(db, tenant.id, row.id):
        raise HTTPException(
            status_code=400,
            detail="Depozitlə ödənmiş masa satışını Analitikadan düzəltmək olmaz. Depozit balansı qarışmaması üçün VOID edib yenidən hesab alın.",
        )

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
    row.receipt_html = None

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
    if _is_void_sale_status(row.status):
        raise HTTPException(status_code=400, detail="Voided sale cannot be refunded")
    if _sale_has_deposit_application(db, tenant.id, row.id):
        raise HTTPException(
            status_code=400,
            detail="Depozitlə ödənmiş masa satışına partial refund Analitikadan tətbiq olunmur. Depozit balansı qarışmaması üçün VOID edin.",
        )

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
    next_total = (current_total - refund_amount).quantize(Decimal("0.01"))
    ledger_backed = _sale_has_posted_ledger_payments(db, tenant.id, row.id)
    if ledger_backed:
        current_cash, current_card = _sale_payment_split(db, tenant.id, row.id)
        current_paid = (current_cash + current_card).quantize(Decimal("0.01"))
        _reverse_sale_finance_transactions(db, tenant.id, row.id, user.username)
        row.receipt_html = None
        card_sale_percent = Decimal(str(_setting_value(db, tenant.id, "bank_commission", {"card_sale_percent": 2}).get("card_sale_percent", 2) or 2))
        if current_paid > 0 and current_cash > 0 and current_card > 0:
            next_cash = (next_total * (current_cash / current_paid)).quantize(Decimal("0.01"))
            next_card = (next_total - next_cash).quantize(Decimal("0.01"))
            row.payment_method = "Split"
            _post_sale_payment_parts(
                db,
                tenant_id=tenant.id,
                sale_id=row.id,
                total=next_total,
                payment_method="split",
                split_cash=next_cash,
                split_card=next_card,
                username=user.username,
                card_fee_percent=card_sale_percent,
                note_prefix=f"Partial refund remaining {row.id}",
            )
        elif current_cash > 0 or pm in {"cash", "nəğd", "staff"}:
            row.payment_method = "Staff" if pm == "staff" else "Nəğd"
            _post_sale_payment_parts(
                db,
                tenant_id=tenant.id,
                sale_id=row.id,
                total=next_total,
                payment_method="staff" if pm == "staff" else "cash",
                username=user.username,
                card_fee_percent=card_sale_percent,
                note_prefix=f"Partial refund remaining {row.id}",
            )
        else:
            row.payment_method = "Kart"
            _post_sale_payment_parts(
                db,
                tenant_id=tenant.id,
                sale_id=row.id,
                total=next_total,
                payment_method="card",
                username=user.username,
                card_fee_percent=card_sale_percent,
                note_prefix=f"Partial refund remaining {row.id}",
            )
    else:
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

    row.total = next_total
    row.status = "PARTIAL_REFUND"
    row.receipt_html = None
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
