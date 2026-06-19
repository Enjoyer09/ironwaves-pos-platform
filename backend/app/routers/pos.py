import json
import logging
import secrets
from collections import defaultdict
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.json_utils import safe_json_list
from app.models import AuditLog, Customer, DonerBatch, FinanceAccount, FinanceEntry, FinanceTransaction, InventoryItem, LoyaltyLedgerEntry, MenuItem, Recipe, RewardClaim, Sale, Setting, Shift, Tenant
from app.schemas import SaleCreateIn, SaleCreateOut, SaleReceiptHtmlIn
from app.services.finance_service import mirror_posted_transaction_to_legacy_wallet, post_finance_transaction, post_sale_cogs, post_sale_payment


router = APIRouter(prefix="/api/v1/pos", tags=["pos"])
logger = logging.getLogger(__name__)
STAFF_SHIFT_SESSIONS_KEY = "staff_shift_sessions"
VOID_SALE_STATUSES = {
    "VOIDED",
    "VOID",
    "CANCELLED",
    "CANCELED",
    "CANCELLED SALE",
    "CANCELED SALE",
    "LƏĞV",
    "LƏĞV EDILDI",
    "LƏĞV EDİLDİ",
    "LAGV",
    "LAGV EDILDI",
}
SALE_PAYMENT_TRANSACTION_TYPES = ["income", "deposit_apply_to_bill"]
SALE_PAYMENT_LEDGER_TRANSACTION_TYPES = ["income", "deposit_apply_to_bill", "reversal"]


DEFAULT_YIELD_SETTINGS = {
    "enabled": False,
    "variance_tolerance_percent": 5,
    "profiles": {
        "beef": {"raw_to_ready_ratio": 1.4, "loss_min_percent": 30, "loss_max_percent": 40},
        "chicken": {"raw_to_ready_ratio": 1.33, "loss_min_percent": 25, "loss_max_percent": 35},
    },
    "tracked_items": [],
}

DEFAULT_BEVERAGE_SERVICE_SETTINGS = {
    "coffee_selection_mode": "size_and_service",
    "remove_paper_packaging_for_table": True,
    "discount_scope": "all_items",
    "summer_promo_enabled": False,
}


def _is_promo_eligible_category(category: str | None) -> bool:
    cat = str(category or "").strip().lower().replace("\u0307", "")
    direct_matches = {
        "cold drinks", "cold drink", "soyuq içkilər", "soyuq ickiler", "soyuq icmeler", "soyuq içki", "soyuq icki",
        "iced coffees", "iced coffee", "iced kofe", "iced qəhvə", "iced qehve",
        "frappes", "frappe", "frappelər", "frappeler",
        "smoothies", "smoothie", "smuzi", "smusi",
        "qəhvə", "qehve", "coffee", "coffees", "qəhvələr", "qehveler", "kofe"
    }
    if cat in direct_matches:
        return True
        
    # Substring fallback checks for custom categories
    if "cold drink" in cat or "soyuq ic" in cat or "soyuq iç" in cat:
        return True
    if "iced coffee" in cat or "iced kofe" in cat or "iced qəh" in cat or "iced qeh" in cat:
        return True
    if "frappe" in cat:
        return True
    if "smoothie" in cat or "smuzi" in cat or "smusi" in cat:
        return True
    if "qəh" in cat or "qeh" in cat or "coffee" in cat or "kofe" in cat:
        return True
        
    return False


def _is_promo_eligible_item(category: str | None, item_name: str | None) -> bool:
    if _is_promo_eligible_category(category):
        return True
    import re
    name = str(item_name or "").strip()
    pattern = re.compile(r"\b(iced|ice|soyuq|cold|frappe|smoothie|smuzi)\b", re.IGNORECASE)
    return bool(pattern.search(name))


def _calculate_discounted_items_total(items, discount_percent, beverage_settings):
    summer_promo_enabled = bool((beverage_settings or {}).get("summer_promo_enabled", False))
    discount_scope = str((beverage_settings or {}).get("discount_scope") or "all_items").strip().lower()
    discount_rate = Decimal(str(discount_percent or 0)) / Decimal("100")

    def get_val(item, key, default=None):
        if hasattr(item, key):
            return getattr(item, key)
        if isinstance(item, dict):
            return item.get(key, default)
        return default

    # First, calculate promo pairing
    eligible_units = []
    if summer_promo_enabled:
        for item_idx, item in enumerate(items):
            item_name = get_val(item, "item_name") or get_val(item, "name")
            if _is_promo_eligible_item(get_val(item, "category"), item_name):
                qty = int(get_val(item, "qty") or get_val(item, "quantity") or 0)
                price = Decimal(str(get_val(item, "price") or 0))
                for q in range(qty):
                    eligible_units.append({
                        "price": price,
                        "item_idx": item_idx,
                        "unit_idx": q
                    })

    promo_discounts = {}  # (item_idx, unit_idx) -> Decimal
    if summer_promo_enabled and len(eligible_units) >= 2:
        eligible_units.sort(key=lambda x: x["price"], reverse=True)
        for i in range(0, len(eligible_units) - 1, 2):
            item2 = eligible_units[i + 1]
            discount_val = (item2["price"] * Decimal("0.5")).quantize(Decimal("0.01"))
            promo_discounts[(item2["item_idx"], item2["unit_idx"])] = discount_val

    # Now calculate total discounted sum
    total_discounted = Decimal("0.00")
    item_promo_discounts = [Decimal("0.00") for _ in range(len(items))]
    coffee_unit_prices = []

    for item_idx, item in enumerate(items):
        price = Decimal(str(get_val(item, "price") or 0))
        qty = int(get_val(item, "qty") or get_val(item, "quantity") or 0)
        category = get_val(item, "category")
        item_name = get_val(item, "item_name") or get_val(item, "name")
        is_coffee = get_val(item, "is_coffee")

        is_coffee_item = (
            is_coffee or
            (isinstance(is_coffee, str) and is_coffee.lower() == "true") or
            _is_coffee_like(item_name, category, is_coffee)
        )
        apply_manual = discount_scope == "all_items" or is_coffee_item
        unit_discount_rate = discount_rate if apply_manual else Decimal("0")

        for q in range(qty):
            std_price = (price * (Decimal("1") - unit_discount_rate)).quantize(Decimal("0.01"))
            promo_discount_val = promo_discounts.get((item_idx, q), Decimal("0.00"))
            promo_price = price - promo_discount_val

            final_price = std_price
            if promo_price < std_price:
                final_price = promo_price
                item_promo_discounts[item_idx] += promo_discount_val

            total_discounted += final_price
            if is_coffee_item:
                coffee_unit_prices.append(final_price)

    return total_discounted, item_promo_discounts, coffee_unit_prices


def _is_void_sale_status(value: str | None) -> bool:
    return str(value or "").strip().upper() in VOID_SALE_STATUSES


def _sale_is_ledger_voided(db: Session, tenant_id: str, sale_id: str) -> bool:
    has_posted_payment = (
        db.query(FinanceTransaction.id)
        .filter(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == sale_id,
            FinanceTransaction.status == "posted",
            FinanceTransaction.transaction_type.in_(SALE_PAYMENT_TRANSACTION_TYPES),
        )
        .first()
        is not None
    )
    if has_posted_payment:
        return False
    return (
        db.query(FinanceTransaction.id)
        .filter(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == sale_id,
            FinanceTransaction.transaction_type.in_(SALE_PAYMENT_LEDGER_TRANSACTION_TYPES),
        )
        .first()
        is not None
    )


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


def _active_shift(db: Session, tenant_id: str) -> Shift | None:
    return db.query(Shift).filter(Shift.tenant_id == tenant_id, Shift.status == "open").first()


def _staff_shift_session_open(db: Session, tenant_id: str, username: str | None) -> bool:
    if not username:
        return False
    raw = _setting_value(db, tenant_id, STAFF_SHIFT_SESSIONS_KEY, {})
    if not isinstance(raw, dict):
        return False
    key = str(username).strip().lower()
    if not key:
        return False
    return key in {str(k or "").strip().lower() for k in raw.keys()}


def _normalize_inventory_key(value: str | None) -> str:
    return str(value or "").strip().lower()


def _yield_settings(db: Session, tenant_id: str) -> dict:
    raw = _setting_value(db, tenant_id, "yield_management_settings", DEFAULT_YIELD_SETTINGS)
    if not isinstance(raw, dict):
        return DEFAULT_YIELD_SETTINGS
    merged = {
        **DEFAULT_YIELD_SETTINGS,
        **raw,
        "profiles": {**DEFAULT_YIELD_SETTINGS["profiles"], **dict(raw.get("profiles") or {})},
    }
    merged["tracked_items"] = list(raw.get("tracked_items") or [])
    return merged


def _find_yield_rule(db: Session, tenant_id: str, inventory: InventoryItem) -> dict | None:
    settings = _yield_settings(db, tenant_id)
    return _find_yield_rule_from_settings(settings, inventory)


def _find_yield_rule_from_settings(settings: dict, inventory: InventoryItem) -> dict | None:
    if not settings.get("enabled"):
        return None
    inventory_name = _normalize_inventory_key(inventory.name)
    for row in settings.get("tracked_items") or []:
        if not isinstance(row, dict):
            continue
        if not bool(row.get("enabled", True)):
            continue
        if _normalize_inventory_key(row.get("inventory_name")) != inventory_name:
            continue
        meat_type = str(row.get("meat_type") or "beef").strip().lower()
        profile = dict((settings.get("profiles") or {}).get(meat_type) or {})
        ratio = Decimal(str(row.get("raw_to_ready_ratio") or profile.get("raw_to_ready_ratio") or "1"))
        return {"inventory_name": inventory.name, "meat_type": meat_type, "raw_to_ready_ratio": ratio}
    return None


def _record_doner_batch_consumption(
    db: Session,
    tenant_id: str,
    inventory_name: str,
    sold_ready_qty: Decimal,
    deducted_raw_qty: Decimal,
):
    batch = (
        db.query(DonerBatch)
        .filter(
            DonerBatch.tenant_id == tenant_id,
            func.lower(DonerBatch.inventory_name) == inventory_name.lower(),
            DonerBatch.status == "OPEN",
        )
        .order_by(DonerBatch.opened_at.desc())
        .first()
    )
    if not batch:
        return
    batch.sold_ready_weight_kg = (Decimal(str(batch.sold_ready_weight_kg or 0)) + sold_ready_qty).quantize(Decimal("0.001"))
    batch.deducted_raw_weight_kg = (Decimal(str(batch.deducted_raw_weight_kg or 0)) + deducted_raw_qty).quantize(Decimal("0.001"))


def _bank_commission_config(db: Session, tenant_id: str) -> tuple[Decimal, Decimal]:
    config = _setting_value(db, tenant_id, "bank_commission", {"card_sale_percent": 2, "card_transfer_percent": 0.5})
    card_sale_percent = Decimal(str(config.get("card_sale_percent", config.get("percent", 2)) or 2))
    card_transfer_percent = Decimal(str(config.get("card_transfer_percent", 0.5) or 0.5))
    return card_sale_percent, card_transfer_percent


def _calculate_staff_due(items: list, used_today: Decimal, config: dict) -> tuple[Decimal, Decimal, Decimal]:
    daily_limit = Decimal(str(config.get("daily_limit_azn", 6)))
    coffee_cap = Decimal(str(config.get("coffee_unit_cap_azn", config.get("item_unit_cap_azn", 6))))
    other_cap = Decimal(str(config.get("other_unit_cap_azn", 2)))
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
        is_coffee = _is_coffee_like(item.item_name, item.category, getattr(item, 'is_coffee', False))
        item_cap = coffee_cap if is_coffee else other_cap
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
def get_menu(
    response: Response,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    response.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=300"
    rows = (
        db.query(
            MenuItem.id,
            MenuItem.sort_order,
            MenuItem.item_name,
            MenuItem.category,
            MenuItem.price,
            MenuItem.is_coffee,
            MenuItem.is_active,
        )
        .filter(MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)
        .order_by(MenuItem.sort_order.asc(), MenuItem.category.asc(), MenuItem.item_name.asc())
        .all()
    )
    return [
        {
            "id": row.id,
            "sort_order": int(row.sort_order or 0),
            "item_name": row.item_name,
            "category": row.category,
            "price": str(row.price),
            "is_coffee": row.is_coffee,
            "image_url": "",
            "description": "",
            "is_active": row.is_active,
        }
        for row in rows
    ]


@router.get("/menu/images")
def get_menu_images(
    response: Response,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    response.headers["Cache-Control"] = "private, max-age=300, stale-while-revalidate=3600"
    rows = (
        db.query(MenuItem.id, MenuItem.image_url, MenuItem.description)
        .filter(MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)
        .all()
    )
    return [
        {
            "id": row.id,
            "image_url": row.image_url or "",
            "description": row.description or "",
        }
        for row in rows
    ]


@router.post("/sale", response_model=SaleCreateOut)
def create_sale(payload: SaleCreateIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    if not payload.cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    active_shift = _active_shift(db, tenant.id)
    if not active_shift:
        raise HTTPException(status_code=400, detail="Satış üçün əvvəlcə günü açın (Z-Hesabat > Günü Aç)")

    role = str(getattr(user, "role", "") or "").strip().lower()
    if role in {"staff", "manager", "admin"} and not _staff_shift_session_open(db, tenant.id, getattr(user, "username", None)):
        raise HTTPException(status_code=403, detail="Satış üçün əvvəlcə öz növbənizi açın (Z-Hesabat > Günü Aç)")

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
    card_sale_percent, _card_transfer_percent = _bank_commission_config(db, tenant.id)
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
    customer_program = _setting_value(
        db,
        tenant.id,
        "customer_app_settings",
        {"program_mode": "points", "cashback_percent": 5},
    )
    program_mode = str(customer_program.get("program_mode") or "points").strip().lower()
    cashback_percent = Decimal(str(customer_program.get("cashback_percent") or 0))
    beverage_settings = _setting_value(db, tenant.id, "beverage_service_settings", DEFAULT_BEVERAGE_SERVICE_SETTINGS)
    subtotal = sum((Decimal(str(i.price)) * i.qty for i in payload.cart_items), Decimal("0"))

    # Calculate promo and standard discounts per unit
    discounted_items_total, item_promo_discounts, coffee_unit_prices = _calculate_discounted_items_total(
        payload.cart_items,
        effective_discount,
        beverage_settings
    )
    discount = (subtotal - discounted_items_total).quantize(Decimal("0.01"))
    total = discounted_items_total.quantize(Decimal("0.01"))
    reward_claim = None
    reward_discount = Decimal("0.00")

    coffee_qty = 0
    for item in payload.cart_items:
        is_coffee_item = _is_coffee_like(item.item_name, item.category, item.is_coffee)
        if is_coffee_item:
            coffee_qty += int(item.qty or 0)

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

    if payload.reward_claim_code and free_coffees > 0:
        raise HTTPException(
            status_code=400,
            detail="Eyni əməliyyatda həm reward claim, həm də pulsuz qəhvə tətbiq edilə bilməz",
        )

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
            apply_manual = discount_scope == "all_items" or _is_coffee_like(item.item_name, item.category, item.is_coffee)
            unit_discount_rate = discount_rate if apply_manual else Decimal("0")
            unit_price = (Decimal(str(item.price)) * (Decimal("1") - unit_discount_rate)).quantize(Decimal("0.01"))
            for _ in range(int(item.qty or 0)):
                reward_candidates.append(unit_price)
        if reward_candidates:
            reward_candidates.sort()
            reward_discount = reward_candidates[0]
            discount += reward_discount
            total = max(Decimal("0"), subtotal - discount).quantize(Decimal("0.01"))

    stock_ops: list[tuple[InventoryItem, Decimal]] = []
    cogs_total = Decimal("0.0000")
    line_cogs_totals: dict[int, Decimal] = {}
    line_cogs_unresolved: dict[int, bool] = {}
    yield_settings = _yield_settings(db, tenant.id)
    remove_packaging_for_table = bool((beverage_settings or {}).get("remove_paper_packaging_for_table", True))
    menu_item_names = {
        str(item.item_name or "").strip().lower()
        for item in payload.cart_items
        if str(item.item_name or "").strip()
    }
    recipe_rows = (
        db.query(Recipe)
        .filter(Recipe.tenant_id == tenant.id, func.lower(Recipe.menu_item_name).in_(menu_item_names))
        .all()
        if menu_item_names
        else []
    )
    recipes_by_item: dict[str, list[Recipe]] = defaultdict(list)
    ingredient_names: set[str] = set()
    for recipe in recipe_rows:
        key = str(recipe.menu_item_name or "").strip().lower()
        recipes_by_item[key].append(recipe)
        ingredient_name = str(recipe.ingredient_name or "").strip().lower()
        if ingredient_name:
            ingredient_names.add(ingredient_name)
    inventory_rows = (
        db.query(InventoryItem)
        .filter(InventoryItem.tenant_id == tenant.id, func.lower(InventoryItem.name).in_(ingredient_names))
        .all()
        if ingredient_names
        else []
    )
    inventory_by_name = {
        str(row.name or "").strip().lower(): row
        for row in inventory_rows
    }
    for index, item in enumerate(payload.cart_items):
        line_cogs_totals[index] = Decimal("0.0000")
        line_cogs_unresolved[index] = False
        item_cup_mode = str(getattr(item, "cup_mode", None) or "paper").strip().lower()
        skip_packaging = remove_packaging_for_table and item_cup_mode == "glass"
        item_name_key = str(item.item_name or "").strip().lower()
        recipes = recipes_by_item.get(item_name_key, [])
        if not recipes:
            line_cogs_unresolved[index] = True
        for recipe in recipes:
            if skip_packaging and any(token in str(recipe.ingredient_name or "").lower() for token in ["stəkan", "stakan", "qapaq", "kapak", "cup", "lid"]):
                continue
            inventory = inventory_by_name.get(str(recipe.ingredient_name or "").strip().lower())
            if not inventory:
                line_cogs_unresolved[index] = True
                continue
            base_qty_required = (Decimal(str(recipe.quantity_required)) * Decimal(str(item.qty or 0))).quantize(Decimal("0.0001"))
            yield_rule = _find_yield_rule_from_settings(yield_settings, inventory)
            sold_ready_qty = base_qty_required.quantize(Decimal("0.0001"))
            qty_required = (
                (base_qty_required * Decimal(str(yield_rule.get("raw_to_ready_ratio") or 1))).quantize(Decimal("0.0001"))
                if yield_rule
                else base_qty_required
            )
            # if Decimal(str(inventory.stock_qty)) < qty_required:
            #     raise HTTPException(status_code=400, detail=f"{inventory.name} üçün anbarda kifayət qədər qalıq yoxdur")
            stock_ops.append((inventory, qty_required))
            line_cogs = (qty_required * Decimal(str(inventory.unit_cost or 0))).quantize(Decimal("0.0001"))
            cogs_total += line_cogs
            line_cogs_totals[index] += line_cogs
            if yield_rule:
                _record_doner_batch_consumption(
                    db,
                    tenant.id,
                    inventory.name,
                    sold_ready_qty.quantize(Decimal("0.001")),
                    qty_required.quantize(Decimal("0.001")),
                )

    sale_items_payload: list[dict] = []
    for index, item in enumerate(payload.cart_items):
        row = item.model_dump(mode="json")
        row["_cogs_snapshot"] = str(line_cogs_totals.get(index, Decimal("0.0000")).quantize(Decimal("0.0001")))
        row["_cogs_estimation_unresolved"] = bool(line_cogs_unresolved.get(index, False))
        promo_d = item_promo_discounts[index]
        if promo_d > 0:
            row["promo_discount"] = str(promo_d.quantize(Decimal("0.01")))
        sale_items_payload.append(row)

    receipt_code = secrets.token_hex(5).upper()
    receipt_token = secrets.token_hex(10)

    payment_method = str(payload.payment_method or "").strip().lower()
    staff_benefit_used = Decimal("0.00")
    if payment_method == "staff":
        staff_cfg = _setting_value(
            db,
            tenant.id,
            "staff_benefits",
            {"daily_limit_azn": 6, "allowed_scope": "all", "included_categories": [], "included_items": [], "item_unit_cap_azn": 6, "coffee_unit_cap_azn": 6, "other_unit_cap_azn": 2},
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
        items_json=json.dumps(sale_items_payload, ensure_ascii=False),
        customer_stars_after=customer_stars_after if customer else 0,
        free_coffees_applied=free_coffees if customer else 0,
        status="COMPLETED",
        created_at=datetime.utcnow(),
    )
    db.add(sale)
    db.flush()

    for inventory, qty_required in stock_ops:
        inventory.stock_qty = (Decimal(str(inventory.stock_qty)) - qty_required).quantize(Decimal("0.001"))
        db.add(
            AuditLog(
                tenant_id=tenant.id,
                user=user.username,
                action="INVENTORY_CONSUMED",
                details=json.dumps(
                    {
                        "item_name": inventory.name,
                        "qty_removed": str(qty_required),
                        "unit": inventory.unit,
                        "remaining_qty": str(inventory.stock_qty),
                        "sale_id": sale.id,
                        "source": "pos_sale",
                    },
                    ensure_ascii=False,
                ),
            )
        )

    if payment_method == "split":
        split_cash = Decimal(str(payload.split_cash or "0")).quantize(Decimal("0.01"))
        split_card = Decimal(str(payload.split_card or "0")).quantize(Decimal("0.01"))
        if split_cash < 0 or split_card < 0:
            raise HTTPException(status_code=400, detail="Split amounts cannot be negative")
        if (split_cash + split_card - total).copy_abs() > Decimal("0.01"):
            raise HTTPException(status_code=400, detail="Split amounts must equal total")

        if split_cash > 0:
            post_sale_payment(
                db,
                tenant_id=tenant.id,
                sale_id=sale.id,
                amount=split_cash,
                payment_source="cash",
                created_by=user.username,
                category="Satış (Nağd)",
                note=f"POS Sale {sale.id} split cash",
            )
        if split_card > 0:
            post_sale_payment(
                db,
                tenant_id=tenant.id,
                sale_id=sale.id,
                amount=split_card,
                payment_source="card",
                created_by=user.username,
                category="Satış (Kart)",
                note=f"POS Sale {sale.id} split card",
                card_fee_percent=card_sale_percent,
            )
    else:
        if payment_method == "staff":
            if staff_benefit_used > 0:
                benefit_txn = post_finance_transaction(
                    db,
                    tenant_id=tenant.id,
                    transaction_type="expense",
                    amount=staff_benefit_used,
                    source_code="cash",
                    destination_code="expense",
                    created_by=user.username,
                    category="Staff Benefit",
                    note=f"Staff benefit usage {sale.id}",
                    related_order_id=sale.id,
                )
                mirror_posted_transaction_to_legacy_wallet(db, benefit_txn, user.username)
            if total > 0:
                post_sale_payment(
                    db,
                    tenant_id=tenant.id,
                    sale_id=sale.id,
                    amount=total,
                    payment_source="cash",
                    created_by=user.username,
                    category="Staff Ödənişi",
                    note=f"Staff payment {sale.id}",
                )
        else:
            source = "cash" if payment_method in ["cash", "nəğd"] else "card"
            category = "Satış (Nağd)" if source == "cash" else "Satış (Kart)"
            post_sale_payment(
                db,
                tenant_id=tenant.id,
                sale_id=sale.id,
                amount=total,
                payment_source=source,
                created_by=user.username,
                category=category,
                note=f"POS Sale {sale.receipt_code or sale.id[:8]}",
                card_fee_percent=card_sale_percent if source == "card" else Decimal("0"),
            )

    post_sale_cogs(
        db,
        tenant_id=tenant.id,
        sale_id=sale.id,
        amount=Decimal(str(cogs_total or 0)).quantize(Decimal("0.01")),
        created_by=user.username,
        note=f"POS sale COGS {sale.receipt_code or sale.id[:8]}",
    )

    if customer is not None:
        if program_mode != "cashback":
            customer.stars = customer_stars_after
        if reward_claim:
            if program_mode != "cashback":
                customer.stars = max(0, int(customer.stars or 0) - int(reward_claim.points_cost or 0))
            reward_claim.status = "REDEEMED"
            reward_claim.redeemed_sale_id = sale.id
            reward_claim.redeemed_at = datetime.utcnow()
            if program_mode == "cashback":
                db.add(
                    LoyaltyLedgerEntry(
                        tenant_id=tenant.id,
                        card_id=customer.card_id,
                        unit="cashback",
                        entry_type="redeem",
                        amount=Decimal("0.00") - Decimal(str(reward_claim.points_cost or 0)).quantize(Decimal("0.01")),
                        source_sale_id=sale.id,
                        description=f"Reward redeem {reward_claim.claim_code}",
                    )
                )
        if program_mode == "cashback":
            cashback_amount = (total * (cashback_percent / Decimal("100"))).quantize(Decimal("0.01"))
            if cashback_amount > 0:
                db.add(
                    LoyaltyLedgerEntry(
                        tenant_id=tenant.id,
                        card_id=customer.card_id,
                        unit="cashback",
                        entry_type="earn",
                        amount=cashback_amount,
                        source_sale_id=sale.id,
                        description=f"Cashback earn {cashback_percent}%",
                    )
                )
        if program_mode != "cashback":
            sale.customer_stars_after = customer.stars

    db.commit()

    return {
        "sale_id": sale.id,
        "receipt_code": receipt_code,
        "receipt_token": receipt_token,
        "total": total,
        "created_at": sale.created_at,
        "customer_stars_after": sale.customer_stars_after,
        "free_coffees_applied": sale.free_coffees_applied,
    }


@router.put("/sale/{sale_id}/receipt-html")
def save_sale_receipt_html(
    sale_id: str,
    payload: SaleReceiptHtmlIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = (
        db.query(Sale)
        .filter(Sale.tenant_id == tenant.id, Sale.id == str(sale_id or "").strip())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Sale not found")
    if _is_void_sale_status(row.status) or _sale_is_ledger_voided(db, tenant.id, row.id):
        row.receipt_html = None
        db.add(row)
        db.commit()
        return {"success": True, "ignored": True, "reason": "sale_voided"}
    row.receipt_html = str(payload.receipt_html or "").strip()
    db.add(row)
    db.commit()
    return {"success": True}


@router.post("/sync")
def sync_offline_sales(payload: list[SaleCreateIn], db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    synced = 0
    failed = 0
    SessionLocal = sessionmaker(bind=db.get_bind(), autoflush=False, autocommit=False)
    for row in payload:
        row_db = SessionLocal()
        try:
            create_sale(row, db=row_db, tenant=tenant, user=user)
            synced += 1
        except Exception as exc:
            failed += 1
            row_db.rollback()
            logger.warning(
                "Offline sale sync failed tenant=%s offline_request_id=%s error=%s",
                tenant.id,
                row.offline_request_id,
                str(exc),
            )
        finally:
            row_db.close()
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

    items = safe_json_list(row.items_json)
    original_total = Decimal(str(row.total)) + Decimal(str(row.discount_amount or 0))
    split_cash, split_card = _sale_payment_split(db, tenant.id, row.id)
    is_void = _is_void_sale_status(row.status) or _sale_is_ledger_voided(db, tenant.id, row.id)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "cashier": row.cashier,
        "customer_card_id": row.customer_card_id,
        "customer_stars_after": 0,
        "free_coffees_applied": 0,
        "payment_method": row.payment_method,
        "split_cash": str(split_cash) if split_cash > 0 else None,
        "split_card": str(split_card) if split_card > 0 else None,
        "order_type": row.order_type,
        "total": str(row.total),
        "original_total": str(original_total),
        "discount_amount": str(row.discount_amount or 0),
        "receipt_html": "" if is_void else (row.receipt_html or ""),
        "items": items,
        "status": "VOIDED" if is_void else row.status,
    }
