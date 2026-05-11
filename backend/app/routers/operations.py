import json
import csv
import io
import random
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import case, func, text
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.json_utils import safe_json_list
from app.models import (
    AuditLog,
    BusinessProfile,
    Customer,
    CustomerConsent,
    DonerBatch,
    FeedbackCoupon,
    FeedbackEntry,
    FinanceAccount,
    FinanceEntry,
    FinanceLedgerEntry,
    FloorPlan,
    Guest,
    HappyHour,
    InventoryItem,
    KitchenOrder,
    LoyaltyLedgerEntry,
    MenuItem,
    Notification,
    Recipe,
    RewardClaim,
    Reservation,
    Sale,
    Setting,
    Shift,
    ShiftHandover,
    StaffNotification,
    Table,
    Tenant,
    User,
    WasteLog,
)
from app.services.finance_service import (
    create_finance_transaction_record as _create_finance_transaction_record,
    post_deposit_apply_to_bill as _post_deposit_apply_to_bill,
    post_deposit_hold as _post_deposit_hold,
    post_deposit_refund as _post_deposit_refund,
    post_finance_transaction_with_legacy_mirror as _post_finance_transaction,
    post_sale_cogs as _post_sale_cogs,
    post_sale_payment as _post_sale_payment,
    shift_cash_breakdown_from_ledger as _shift_cash_breakdown_from_ledger,
)
from app.services.input_sanitize_service import (
    clean_card_id as _clean_card_id,
    clean_customer_type as _clean_customer_type,
    clean_public_text as _clean_public_text,
    clean_secret_token as _clean_secret_token,
    clean_staff_pin_length as _clean_staff_pin_length,
    clean_theme_mode as _clean_theme_mode,
    clean_ui_mode as _clean_ui_mode,
    json_load as _json_load,
)
from app.services.legacy_import_service import (
    build_restore_handler_registry as _build_restore_handler_registry,
    restore_business_profile_rows as _restore_business_profile_rows,
    restore_generic_model_rows as _restore_generic_model_rows,
    restore_kitchen_order_rows as _restore_kitchen_order_rows,
    restore_legacy_finance_rows as _restore_legacy_finance_rows,
    restore_sales_rows as _restore_sales_rows,
    restore_settings_rows as _restore_settings_rows,
    restore_user_rows as _restore_user_rows,
    verify_restore_dependencies as _verify_restore_dependencies,
    verify_restored_tables as _verify_restored_tables,
)
from app.core.config import settings as app_settings
from app.security import hash_password, hash_token, verify_password


router = APIRouter(prefix="/api/v1/ops", tags=["operations"])

MAX_IMAGE_URL_LENGTH = 2048
MAX_EMBEDDED_IMAGE_CHARS = 350_000


def _normalize_image_url(value: str | None) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    if normalized.startswith("data:"):
        if not normalized.startswith("data:image/") or len(normalized) > MAX_EMBEDDED_IMAGE_CHARS:
            raise HTTPException(status_code=400, detail=f"Embedded image too large (max {MAX_EMBEDDED_IMAGE_CHARS} chars)")
        return normalized
    if len(normalized) > MAX_IMAGE_URL_LENGTH:
        raise HTTPException(status_code=400, detail=f"Image URL too long (max {MAX_IMAGE_URL_LENGTH} chars)")
    return normalized


def _normalize_screenshot_items(items) -> list[dict]:
    rows = []
    for item in list(items or []):
        row = dict(item or {})
        row["image_url"] = _normalize_image_url(row.get("image_url"))
        rows.append(row)
    return rows


def _utcnow() -> datetime:
    # Keep stored timestamps UTC-naive (existing DB model expectation) without deprecated utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


DEFAULT_FINANCE_POLICY = {
    "large_transfer_threshold_azn": 500,
    "investor_repayment_requires_approval": True,
    "cash_adjustment_requires_approval": True,
    "reversal_requires_approval": True,
    "reconciliation_adjustment_requires_approval": True,
    "reconciliation_variance_alert_azn": 0.01,
    "negative_balance_alert_azn": 0,
    "legacy_wallet_sync_enabled": False,
    "approver_roles": ["manager", "admin", "finance_admin", "super_admin"],
}

DEFAULT_BEVERAGE_SERVICE_SETTINGS = {
    "coffee_selection_mode": "size_and_service",
    "remove_paper_packaging_for_table": True,
    "discount_scope": "all_items",
}

DEFAULT_Z_REPORT_RECEIPT_SETTINGS = {
    "show_operator": True,
    "show_date_range": True,
    "show_sales_summary": True,
    "show_profit_summary": True,
    "show_wage": True,
    "show_shift_cash": True,
    "show_cash_movements": True,
    "show_other_income": True,
    "show_other_expense": True,
    "show_deposit_summary": True,
    "show_cashier_breakdown": True,
    "show_item_breakdown": True,
    "show_counts": True,
}

DEFAULT_FEEDBACK_SETTINGS = {
    "enabled": True,
    "promo_enabled": True,
    "coupon_percent": 5,
    "portal_url": "",
    "google_review_url": "",
    "receipt_button_text_az": "Rəy bildirin",
    "receipt_button_text_ru": "Оставить отзыв",
    "receipt_button_text_en": "Leave feedback",
    "receipt_qr_prompt_az": "Rəyiniz bizim üçün çox önəmlidir, lütfən QR skan edib rəyinizi bildirin.",
    "receipt_qr_prompt_ru": "Ваше мнение очень важно для нас. Пожалуйста, отсканируйте QR и оставьте отзыв.",
    "receipt_qr_prompt_en": "Your feedback matters to us. Please scan the QR code and share your review.",
    "thank_you_text_az": "Rəyiniz komanda tərəfindən nəzərdən keçiriləcək.",
    "thank_you_text_ru": "Ваш отзыв будет рассмотрен нашей командой.",
    "thank_you_text_en": "Your feedback will be reviewed by our team.",
}

DEFAULT_LANDING_SETTINGS = {
    "nav_product_az": "Məhsul",
    "nav_product_ru": "Продукт",
    "nav_product_en": "Product",
    "nav_how_az": "Necə işləyir",
    "nav_how_ru": "Как работает",
    "nav_how_en": "How it works",
    "nav_modules_az": "Modullar",
    "nav_modules_ru": "Модули",
    "nav_modules_en": "Modules",
    "nav_contact_az": "Əlaqə",
    "nav_contact_ru": "Контакт",
    "nav_contact_en": "Contact",
    "hero_title_az": "Restoranınızı bir platformadan idarə edin",
    "hero_title_ru": "Управляйте рестораном с одной платформы",
    "hero_title_en": "Run your restaurant from one platform",
    "hero_body_az": "POS, Masalar, Mətbəx, Maliyyə, Dashboard, Analitika, CRM, QR Menu və Audit bir sistemdə.",
    "hero_body_ru": "POS, Столы, Кухня, Финансы, Dashboard, Аналитика, CRM, QR Menu и Audit в одной системе.",
    "hero_body_en": "POS, Tables, Kitchen, Finance, Dashboard, Analytics, CRM, QR Menu and Audit in one system.",
    "primary_cta_az": "Demoya keç",
    "primary_cta_ru": "Перейти к демо",
    "primary_cta_en": "Go to demo",
    "secondary_cta_az": "Ətraflı bax",
    "secondary_cta_ru": "Подробнее",
    "secondary_cta_en": "Learn more",
    "contact_email": "abbas@laptopmarket.az",
    "contact_phone": "+99455 299-92-82",
    "contact_whatsapp": "+99455 299-92-82",
    "hero_image_url": "/landing/pos-screen.png",
    "modules_title_az": "Bütün əsas modullar eyni platformada",
    "modules_title_ru": "Все ключевые модули в одной платформе",
    "modules_title_en": "All core modules in one platform",
    "footer_text_az": "ironWaves POS bir Laptop Market məhsuludur. www.laptopmarket.az",
    "footer_text_ru": "ironWaves POS — продукт Laptop Market. www.laptopmarket.az",
    "footer_text_en": "ironWaves POS is a Laptop Market product. www.laptopmarket.az",
    "screenshot_items": [
        {
            "image_url": "/landing/pos-screen.png",
            "title_az": "POS Ekranı",
            "title_ru": "Экран POS",
            "title_en": "POS Screen",
            "desc_az": "Sürətli sifariş və ödəniş axını",
            "desc_ru": "Быстрый поток заказов и оплат",
            "desc_en": "Fast order and payment flow",
        },
        {
            "image_url": "/landing/finance-screen.png",
            "title_az": "Maliyyə Ekranı",
            "title_ru": "Экран финансов",
            "title_en": "Finance Screen",
            "desc_az": "Kassa, depozit və investor borcu nəzarəti",
            "desc_ru": "Контроль кассы, депозитов и долга инвестору",
            "desc_en": "Cash, deposits and investor liability control",
        },
        {
            "image_url": "/landing/golden-card.png",
            "title_az": "Golden Card",
            "title_ru": "Golden Card",
            "title_en": "Golden Card",
            "desc_az": "Loyallıq kartı və bonus ssenariləri",
            "desc_ru": "Сценарии лояльности и бонусных карт",
            "desc_en": "Loyalty card and bonus scenarios",
        },
        {
            "image_url": "/landing/elite-card.png",
            "title_az": "Elite Card",
            "title_ru": "Elite Card",
            "title_en": "Elite Card",
            "desc_az": "VIP müştəri segmenti və üstünlüklər",
            "desc_ru": "VIP-сегмент клиентов и привилегии",
            "desc_en": "VIP customer segment and privileges",
        },
    ],
}


def _normalize_landing_settings(value: dict | None) -> dict:
    raw = value if isinstance(value, dict) else {}
    screenshots = raw.get("screenshot_items")
    if not isinstance(screenshots, list):
        screenshots = DEFAULT_LANDING_SETTINGS["screenshot_items"]
    cleaned_screenshots = []
    for item in screenshots[:8]:
        if not isinstance(item, dict):
            continue
        image_url = _normalize_image_url(item.get("image_url"))
        if not image_url:
            continue
        cleaned_screenshots.append(
            {
                "image_url": image_url,
                "title_az": str(item.get("title_az") or "").strip(),
                "title_ru": str(item.get("title_ru") or "").strip(),
                "title_en": str(item.get("title_en") or "").strip(),
                "desc_az": str(item.get("desc_az") or "").strip(),
                "desc_ru": str(item.get("desc_ru") or "").strip(),
                "desc_en": str(item.get("desc_en") or "").strip(),
            }
        )
    if not cleaned_screenshots:
        cleaned_screenshots = DEFAULT_LANDING_SETTINGS["screenshot_items"]
    return {
        **DEFAULT_LANDING_SETTINGS,
        **raw,
        "hero_image_url": _normalize_image_url(raw.get("hero_image_url")),
        "screenshot_items": cleaned_screenshots,
    }

POS_RIGHT_WIDGET_KEYS = ["customer", "discount", "orderType", "table", "cartItems", "cartSummary", "payments"]
POS_LEFT_WIDGET_KEYS = ["menuHeader", "search", "categories", "productGrid"]
POS_REQUIRED_RIGHT_WIDGETS = ["cartItems", "cartSummary", "payments"]
POS_REQUIRED_LEFT_WIDGETS = ["productGrid"]


def _ensure_known_widget_order(raw, fallback, allowed):
    preferred = raw if isinstance(raw, list) else []
    merged = [str(v or "").strip() for v in [*preferred, *(fallback or []), *allowed] if str(v or "").strip()]
    seen = set()
    ordered = []
    for key in merged:
        if key not in allowed or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


class DatabaseRestorePreviewIn(BaseModel):
    json_data: str


class DatabaseRestoreIn(BaseModel):
    json_data: str
    selected_tables: list[str] | None = None


class DatabaseVerifyAdminPasswordIn(BaseModel):
    password: str


def _restaurant_now() -> datetime:
    if ZoneInfo:
        return datetime.now(ZoneInfo("Asia/Baku")).replace(tzinfo=None)
    return datetime.utcnow() + timedelta(hours=4)


DEFAULT_YIELD_SETTINGS = {
    "enabled": False,
    "variance_tolerance_percent": 5,
    "profiles": {
        "beef": {"raw_to_ready_ratio": 1.4, "loss_min_percent": 30, "loss_max_percent": 40},
        "chicken": {"raw_to_ready_ratio": 1.33, "loss_min_percent": 25, "loss_max_percent": 35},
    },
    "tracked_items": [],
}


def _ensure_manager(user: User):
    if str(user.role or "").lower() not in {"admin", "manager", "super_admin"}:
        raise HTTPException(status_code=403, detail="Manager access required")


def _ensure_admin(user: User):
    if str(user.role or "").lower() not in {"admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")


def _can_view_sensitive_settings(user: User) -> bool:
    return str(user.role or "").lower() in {"admin", "super_admin"}


def _validate_shift_handover_cash(db: Session, tenant_id: str, user: User, shift: Shift, declared_cash: Decimal) -> Decimal:
    declared = Decimal(str(declared_cash)).quantize(Decimal("0.01"))
    if declared < 0:
        raise HTTPException(status_code=400, detail="Declared cash cannot be negative")
    expected = _shift_cash_breakdown_from_ledger(db, tenant_id, shift, lock_for_update=True)["expected_cash"].quantize(Decimal("0.01"))
    variance = declared - expected
    if abs(variance) > Decimal("0.01"):
        db.add(
            AuditLog(
                tenant_id=tenant_id,
                user=user.username,
                action="SHIFT_HANDOVER_DECLARED_CASH_REJECTED",
                details=json.dumps({"declared_cash": str(declared), "expected_cash": str(expected), "variance": str(variance)}, ensure_ascii=False),
            )
        )
        raise HTTPException(status_code=400, detail=f"Declared cash does not match expected cash ({expected} ₼)")
    return declared


def _setting_value(db: Session, tenant_id: str, key: str, default):
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    if not row or row.value is None:
        return default
    if isinstance(default, (dict, list)):
        return _json_load(row.value, default)
    if isinstance(default, bool):
        return str(row.value).lower() in {"1", "true", "yes"}
    if isinstance(default, int):
        try:
            return int(row.value)
        except Exception:
            return default
    return row.value


def _cash_adjustment_requires_manual_approval(db: Session, tenant_id: str, amount: Decimal) -> bool:
    policy = _setting_value(db, tenant_id, "finance_policy", DEFAULT_FINANCE_POLICY)
    if not isinstance(policy, dict):
        policy = DEFAULT_FINANCE_POLICY
    if not bool(policy.get("cash_adjustment_requires_approval", True)):
        return False
    threshold = Decimal(str(policy.get("large_transfer_threshold_azn", 500) or 500))
    return abs(amount) >= threshold


def _settings_value_map(db: Session, tenant_id: str) -> dict[str, str | None]:
    rows = db.query(Setting.key, Setting.value).filter(Setting.tenant_id == tenant_id).all()
    return {str(key): value for key, value in rows}


def _setting_value_from_map(values: dict[str, str | None], key: str, default):
    raw = values.get(key)
    if raw is None:
        return default
    if isinstance(default, (dict, list)):
        return _json_load(raw, default)
    if isinstance(default, bool):
        return str(raw).lower() in {"1", "true", "yes"}
    if isinstance(default, int):
        try:
            return int(raw)
        except Exception:
            return default
    return raw


def _set_setting_value(db: Session, tenant_id: str, key: str, value):
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    serialized = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
    if row:
        row.value = serialized
    else:
        db.add(Setting(tenant_id=tenant_id, key=key, value=serialized))


def _normalize_payment_method(value: str | None) -> str:
    return str(value or "").strip().lower()


def _summarize_items(items: list[dict]) -> str:
    cleaned = [f"{int(item.get('qty') or 0)}x {str(item.get('item_name') or '').strip()}".strip() for item in items]
    return ", ".join([item for item in cleaned if item])[:180]


def _order_fingerprint(items: list[dict]) -> str:
    normalized = [
        {
            "n": str(item.get("item_name") or "").strip().lower(),
            "q": int(item.get("qty") or 0),
            "p": str(item.get("price") or "0"),
        }
        for item in items
    ]
    normalized.sort(key=lambda item: item["n"])
    return json.dumps(normalized, ensure_ascii=False, sort_keys=True)


DATABASE_TABLE_ALIASES = {
    "menu_items": ["menu"],
    "menu": ["menu_items"],
    "finance": ["expenses"],
    "inventory": ["ingredients"],
    "ingredients": ["inventory"],
    "recipes": ["recipe"],
    "logs": ["system_logs"],
}

DATABASE_CANONICAL_RESTORE_TABLES = {
    "menu": "menu_items",
    "ingredients": "inventory",
    "recipe": "recipes",
    "system_logs": "logs",
    "expenses": "finance",
}

DATABASE_SUPPORTED_TABLES = [
    "users",
    "menu_items",
    "menu",
    "sales",
    "finance",
    "tables",
    "kitchen_orders",
    "inventory",
    "ingredients",
    "customers",
    "customer_consents",
    "recipes",
    "happy_hours",
    "shift_handovers",
    "settings",
    "notifications",
    "business_profile",
    "logs",
]

DATABASE_RESTORE_TABLES = [
    table
    for table in DATABASE_SUPPORTED_TABLES
    if DATABASE_CANONICAL_RESTORE_TABLES.get(table, table) == table
]

_restore_guard_lock = threading.Lock()
_restore_active_tenants: set[str] = set()
_restore_status_lock = threading.Lock()
_restore_status_by_tenant: dict[str, dict] = {}


def _acquire_restore_slot(tenant_id: str) -> bool:
    tenant_key = str(tenant_id or "").strip()
    if not tenant_key:
        return False
    with _restore_guard_lock:
        if tenant_key in _restore_active_tenants:
            return False
        _restore_active_tenants.add(tenant_key)
        return True


def _release_restore_slot(tenant_id: str) -> None:
    tenant_key = str(tenant_id or "").strip()
    if not tenant_key:
        return
    with _restore_guard_lock:
        _restore_active_tenants.discard(tenant_key)


def _set_restore_status(tenant_id: str, payload: dict) -> None:
    tenant_key = str(tenant_id or "").strip()
    if not tenant_key:
        return
    state = {"tenant_id": tenant_key, "updated_at": datetime.utcnow().isoformat()}
    state.update(payload or {})
    with _restore_status_lock:
        _restore_status_by_tenant[tenant_key] = state


def _get_restore_status(tenant_id: str) -> dict | None:
    tenant_key = str(tenant_id or "").strip()
    if not tenant_key:
        return None
    with _restore_status_lock:
        row = _restore_status_by_tenant.get(tenant_key)
        return dict(row) if isinstance(row, dict) else None


def _append_restore_audit(
    db: Session,
    *,
    tenant_id: str,
    username: str,
    action: str,
    restore_run_id: str,
    details: dict,
) -> None:
    payload = {"restore_run_id": restore_run_id}
    payload.update(details or {})
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            user=username,
            action=action,
            details=json.dumps(payload, ensure_ascii=False),
            created_at=datetime.utcnow(),
        )
    )


def _sanitize_nonstandard_json(raw: str) -> str:
    return (
        str(raw or "")
        .replace("-Infinity", "null")
        .replace("Infinity", "null")
        .replace("NaN", "null")
    )


def _serialize_value(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _serialize_model_row(row, fields: list[str] | None = None) -> dict:
    keys = fields or [column.name for column in row.__table__.columns]
    return {key: _serialize_value(getattr(row, key, None)) for key in keys}


def _parse_dt(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _parse_decimal(value, default: str = "0.00") -> Decimal:
    try:
        return Decimal(str(value if value is not None else default))
    except Exception:
        return Decimal(default)


def _resolve_restore_rows(payload: dict, table: str) -> tuple[list, str] | tuple[None, None]:
    rows = payload.get(table)
    if isinstance(rows, list):
        return rows, table
    for alias in DATABASE_TABLE_ALIASES.get(table, []):
        alias_rows = payload.get(alias)
        if isinstance(alias_rows, list):
            return alias_rows, alias
    return None, None


def _canonical_restore_table(table: str) -> str:
    return DATABASE_CANONICAL_RESTORE_TABLES.get(str(table or "").strip(), str(table or "").strip())


def _normalize_restore_tables(selected_tables: list[str] | None) -> tuple[set[str], list[str]]:
    raw_tables = selected_tables or DATABASE_SUPPORTED_TABLES
    selected: set[str] = set()
    unsupported: list[str] = []
    for raw_table in raw_tables:
        table = str(raw_table or "").strip()
        if not table:
            continue
        canonical = _canonical_restore_table(table)
        if table not in DATABASE_SUPPORTED_TABLES and canonical not in DATABASE_SUPPORTED_TABLES:
            unsupported.append(table)
            continue
        selected.add(canonical)
    return selected, sorted(set(unsupported))


def _extract_settings_rows(payload: dict, tenant_id: str) -> list[dict]:
    rows = payload.get("settings")
    if not isinstance(rows, list) or not rows:
        return []
    extracted: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if "key" in row and "value" in row:
            extracted.append(
                {
                    "tenant_id": tenant_id,
                    "key": str(row.get("key") or "").strip(),
                    "value": json.dumps(row.get("value"), ensure_ascii=False)
                    if isinstance(row.get("value"), (dict, list))
                    else str(row.get("value") or ""),
                }
            )
            continue

        reserved = {"id", "tenant_id", "created_at", "updated_at"}
        for key, value in row.items():
            if key in reserved:
                continue
            extracted.append(
                {
                    "tenant_id": tenant_id,
                    "key": str(key).strip(),
                    "value": json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value if value is not None else ""),
                }
            )
    deduped: dict[str, dict] = {}
    for row in extracted:
        if row["key"]:
            deduped[row["key"]] = row
    return list(deduped.values())


def _export_settings_bundle(db: Session, tenant_id: str) -> list[dict]:
    rows = db.query(Setting).filter(Setting.tenant_id == tenant_id).all()
    bundle: dict[str, object] = {"tenant_id": tenant_id}
    for row in rows:
        key = str(row.key or "").strip()
        if not key:
            continue
        try:
            bundle[key] = json.loads(row.value or "")
        except Exception:
            bundle[key] = row.value
    return [bundle]


def _notify_front_of_house(
    db: Session,
    tenant_id: str,
    title: str,
    message: str,
    meta: dict | None = None,
    preferred_username: str | None = None,
    fallback_roles: set[str] | None = None,
):
    allowed_roles = fallback_roles or {"staff", "manager", "admin", "super_admin"}
    active_users = db.query(User).filter(User.tenant_id == tenant_id, User.is_active == True).all()
    usernames: list[str] = []
    if preferred_username:
        preferred = next((row.username for row in active_users if row.username == preferred_username), None)
        if preferred:
            usernames = [preferred]
    if not usernames:
        usernames = [
            row.username
            for row in active_users
            if str(row.role or "").lower() in allowed_roles
        ]
    for username in usernames:
        db.add(
            StaffNotification(
                tenant_id=tenant_id,
                username=username,
                title=title,
                message=message,
                meta_json=json.dumps(meta or {}, ensure_ascii=False) if meta else None,
                is_read=False,
            )
        )


def _normalize_inventory_key(value: str | None) -> str:
    return str(value or "").strip().lower()


def _yield_settings(
    db: Session,
    tenant_id: str,
    settings_map: dict[str, str | None] | None = None,
) -> dict:
    if settings_map is None:
        raw = _setting_value(db, tenant_id, "yield_management_settings", DEFAULT_YIELD_SETTINGS)
    else:
        raw = _setting_value_from_map(settings_map, "yield_management_settings", DEFAULT_YIELD_SETTINGS)
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
        return {
            "inventory_name": inventory.name,
            "meat_type": meat_type,
            "raw_to_ready_ratio": ratio,
            "loss_min_percent": Decimal(str(profile.get("loss_min_percent") or 0)),
            "loss_max_percent": Decimal(str(profile.get("loss_max_percent") or 0)),
        }
    return None


def _apply_yield_to_qty(base_qty: Decimal, yield_rule: dict | None) -> tuple[Decimal, Decimal]:
    if not yield_rule:
        return base_qty.quantize(Decimal("0.0001")), base_qty.quantize(Decimal("0.0001"))
    ratio = Decimal(str(yield_rule.get("raw_to_ready_ratio") or 1))
    return base_qty.quantize(Decimal("0.0001")), (base_qty * ratio).quantize(Decimal("0.0001"))


def _record_doner_batch_consumption(
    db: Session,
    tenant_id: str,
    inventory_name: str,
    meat_type: str,
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


def _collect_stock_ops(db: Session, tenant_id: str, items: list[dict]) -> tuple[list[tuple[InventoryItem, Decimal]], Decimal]:
    stock_ops: list[tuple[InventoryItem, Decimal]] = []
    cogs_total = Decimal("0.0000")
    line_cogs_totals: dict[int, Decimal] = {}
    line_cogs_unresolved: dict[int, bool] = {}
    beverage_settings = _setting_value(db, tenant_id, "beverage_service_settings", DEFAULT_BEVERAGE_SERVICE_SETTINGS)
    remove_packaging_for_table = bool(beverage_settings.get("remove_paper_packaging_for_table", True))
    for index, item in enumerate(items):
        line_cogs_totals[index] = Decimal("0.0000")
        line_cogs_unresolved[index] = False
        item_cup_mode = str(item.get("cup_mode") or "paper").strip().lower()
        skip_packaging = remove_packaging_for_table and item_cup_mode == "glass"
        recipes = (
            db.query(Recipe)
            .filter(Recipe.tenant_id == tenant_id, func.lower(Recipe.menu_item_name) == str(item.get("item_name") or "").lower())
            .all()
        )
        if not recipes:
            line_cogs_unresolved[index] = True
        for recipe in recipes:
            if skip_packaging and any(token in str(recipe.ingredient_name or "").lower() for token in ["stəkan", "stakan", "qapaq", "kapak", "cup", "lid"]):
                continue
            inventory = (
                db.query(InventoryItem)
                .filter(InventoryItem.tenant_id == tenant_id, func.lower(InventoryItem.name) == str(recipe.ingredient_name).lower())
                .first()
            )
            if not inventory:
                line_cogs_unresolved[index] = True
                continue
            base_qty_required = (Decimal(str(recipe.quantity_required or 0)) * Decimal(str(item.get("qty") or 0))).quantize(Decimal("0.0001"))
            yield_rule = _find_yield_rule(db, tenant_id, inventory)
            sold_ready_qty, qty_required = _apply_yield_to_qty(base_qty_required, yield_rule)
            if Decimal(str(inventory.stock_qty or 0)) < qty_required:
                raise HTTPException(status_code=400, detail=f"{inventory.name} üçün anbarda kifayət qədər qalıq yoxdur")
            stock_ops.append((inventory, qty_required))
            line_cogs = (qty_required * Decimal(str(inventory.unit_cost or 0))).quantize(Decimal("0.0001"))
            cogs_total += line_cogs
            line_cogs_totals[index] += line_cogs
            if yield_rule:
                _record_doner_batch_consumption(
                    db,
                    tenant_id,
                    inventory.name,
                    str(yield_rule.get("meat_type") or "beef"),
                    sold_ready_qty.quantize(Decimal("0.001")),
                    qty_required.quantize(Decimal("0.001")),
                )
    for index, item in enumerate(items):
        item["_cogs_snapshot"] = str(line_cogs_totals.get(index, Decimal("0.0000")).quantize(Decimal("0.0001")))
        item["_cogs_estimation_unresolved"] = bool(line_cogs_unresolved.get(index, False))
    return stock_ops, cogs_total.quantize(Decimal("0.0001"))


def _merge_table_items(existing: list[dict], incoming: list[dict]) -> list[dict]:
    merged = list(existing)
    for item in incoming:
        idx = next(
            (
                i
                for i, row in enumerate(merged)
                if (
                    row.get("id") == item.get("id")
                    or (
                        row.get("item_name") == item.get("item_name")
                        and str(row.get("seat_label") or "") == str(item.get("seat_label") or "")
                    )
                )
            ),
            -1,
        )
        if idx >= 0:
            merged[idx]["qty"] = int(merged[idx].get("qty", 0)) + int(item.get("qty", 0))
        else:
            merged.append(item)
    return merged


def _merge_same_seat_duplicates(items: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for item in items:
        item_name = str(item.get("item_name") or "").strip()
        seat_label = str(item.get("seat_label") or "").strip()
        idx = next(
            (
                i
                for i, row in enumerate(merged)
                if str(row.get("item_name") or "").strip() == item_name
                and str(row.get("seat_label") or "").strip() == seat_label
            ),
            -1,
        )
        if idx >= 0:
            merged[idx]["qty"] = int(merged[idx].get("qty") or 0) + int(item.get("qty") or 0)
        else:
            merged.append(dict(item))
    return merged


class BusinessProfileIn(BaseModel):
    company_name: str
    phone: str | None = None
    address: str | None = None
    website: str | None = None
    logo_url: str | None = None
    receipt_footer: str | None = None


class DonerBatchOpenIn(BaseModel):
    inventory_name: str
    meat_type: str
    raw_weight_kg: Decimal
    raw_to_ready_ratio: Decimal | None = None
    notes: str | None = None


class DonerBatchCloseIn(BaseModel):
    actual_remaining_raw_weight_kg: Decimal
    notes: str | None = None
    voen: str | None = None


class TableCreateIn(BaseModel):
    label: str


class TableOpenIn(BaseModel):
    guest_count: int
    deposit_guest_count: int = 0
    deposit_seat_labels: list[str] | None = None


class TableItemsIn(BaseModel):
    cart_items: list[dict]
    cup_mode: str | None = "paper"


class TablePayIn(BaseModel):
    payment_method: str
    split_cash: Decimal | None = None
    split_card: Decimal | None = None
    cup_mode: str | None = "paper"
    pay_scope: str | None = "full"
    seat_label: str | None = None


class TableSeatReassignIn(BaseModel):
    from_seat: str
    to_seat: str
    item_name: str | None = None
    mode: str | None = "item"


class TableTargetIn(BaseModel):
    target_table_id: str


class TableRevisionIn(BaseModel):
    items: list[dict]
    reason: str | None = None
    override_password: str | None = None


class KitchenCompleteIn(BaseModel):
    ready_items: list[str] | None = None


class HappyHourCreateIn(BaseModel):
    name: str
    start_time: str
    end_time: str
    discount_percent: int
    days_of_week: list[int]
    categories: str = "ALL"
    is_active: bool = True


DEFAULT_SESSION_SETTINGS = {
    "idle_logout_minutes": 0,
    "virtual_keyboard_enabled": True,
    "staff_pin_length": 4,
    "theme_mode": "dark",
    "ui_mode": "old",
}


def _request_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    client_host = request.client.host if request.client else ""
    return forwarded or client_host or "ip_unknown"


class LogEventIn(BaseModel):
    user: str
    action: str
    details: dict | str | None = None


class EmailSettingsIn(BaseModel):
    enabled: bool = False
    provider: str = "none"
    resend_api_key: str = ""
    sender_email: str = ""
    recipient_emails: list[str] = []
    webhook_url: str = ""
    timeout_sec: int = 15


class SendEmailIn(BaseModel):
    subject: str
    html: str
    recipients: list[str] | None = None


class RewardClaimIn(BaseModel):
    reward_id: str | None = None


class ShiftHandoverCreateIn(BaseModel):
    received_by: str
    declared_cash: Decimal


class ShiftHandoverAcceptPayload(BaseModel):
    actual_cash: Decimal


def _resolve_customer_session(db: Session, tenant_id: str, card_id: str, token: str) -> Customer:
    safe_card = str(card_id or "").strip()
    safe_token = str(token or "").strip()
    if not safe_card or not safe_token:
        raise HTTPException(status_code=401, detail="Customer session is invalid")
    row = (
        db.query(Customer)
        .filter(Customer.tenant_id == tenant_id, func.lower(Customer.card_id) == safe_card.lower())
        .first()
    )
    if not row or row.secret_token != safe_token:
        raise HTTPException(status_code=401, detail="Customer session is invalid")
    return row


@router.get("/settings")
def get_app_settings(
    response: Response,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    settings_map = _settings_value_map(db, tenant.id)
    getv = lambda key, default: _setting_value_from_map(settings_map, key, default)

    inventory_settings = getv("inventory_settings", {"default_critical_threshold": 5, "unit_options": ["kq", "qram", "litr", "ml", "ədəd", "metr"]})
    staff_benefits = getv(
        "staff_benefits",
        {"daily_limit_azn": 6, "allowed_scope": "all", "included_categories": [], "included_items": [], "item_unit_cap_azn": 6},
    )
    role_modules = getv(
        "role_modules",
        {
            "staff": ["pos", "tables", "kds", "zreport"],
            "manager": ["pos", "tables", "kds", "zreport", "finance", "inventory", "combos", "analytics", "logs", "crm", "customerapp", "ai", "menu", "recipes"],
            "kitchen": ["kds"],
        },
    )
    print_settings = getv("print_settings", {"use_qz": False, "printer_name": ""})
    session_settings = {**DEFAULT_SESSION_SETTINGS, **getv("session_settings", DEFAULT_SESSION_SETTINGS)}
    session_settings["staff_pin_length"] = _clean_staff_pin_length(session_settings.get("staff_pin_length"))
    session_settings["theme_mode"] = _clean_theme_mode(session_settings.get("theme_mode"))
    session_settings["ui_mode"] = _clean_ui_mode(session_settings.get("ui_mode"))
    qr_settings = getv("qr_settings", {"base_url": f"https://{tenant.domain}"})
    qr_menu_settings = getv(
        "qr_menu_settings",
        {
            "enabled": True,
            "hero_title": "QR Menu",
            "hero_subtitle": "Telefonunuzdan menyuya baxın",
            "show_prices": True,
            "show_images": True,
            "show_descriptions": True,
            "poster_title": "Menyuya baxmaq üçün skan et",
            "poster_subtitle": "Telefon kameranızı QR üzərinə yönəldin",
            "background_color": "#efe2c1",
            "surface_color": "#fff7e8",
            "text_color": "#2b1708",
            "hero_image_url": "",
            "poster_image_url": "",
            "poster_background_color": "#d59b2d",
            "logo_shape": "rounded",
        },
    )
    customer_app_settings = getv(
        "customer_app_settings",
        {
            "enabled": True,
            "program_mode": "points",
            "layout_preset": "rewards",
            "consent_text": "Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.",
            "join_customer_type": "golden",
            "join_discount_percent": 5,
            "app_name": "Loyalty Club",
            "hero_title": "Xoş gəldiniz",
            "hero_subtitle": "Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.",
            "hero_image_url": "",
            "background_image_url": "",
            "background_color": "#0b1220",
            "points_label": "Ulduz",
            "reward_name": "Reward",
            "reward_threshold": 10,
            "reward_description": "10 ulduza 1 pulsuz içki",
            "reward_card_style": "rounded",
            "cashback_percent": 5,
            "primary_color": "#facc15",
            "accent_color": "#22d3ee",
            "show_qr_card": True,
            "show_wallet": True,
            "ai_barista_enabled": False,
            "ai_falci_enabled": False,
            "show_campaigns": True,
            "show_history": True,
            "show_notifications": True,
        },
    )
    pos_layout = getv(
        "pos_layout",
        {
            "preset": "classic",
            "density": "comfortable",
            "product_columns": 3,
            "show_cart_tabs": True,
            "accent_color": "#facc15",
            "hidden_widgets": [],
            "widget_order": ["customer", "discount", "orderType", "table", "cartItems", "cartSummary", "payments"],
            "left_hidden_widgets": [],
            "left_widget_order": ["menuHeader", "search", "categories", "productGrid"],
            "widget_sizes": {},
            "left_widget_sizes": {},
            "panel_ratio": "50:50",
            "widget_options": {},
            "device_layouts": {
                "desktop": {},
                "tablet": {
                    "preset": "touch",
                    "density": "large",
                    "product_columns": 2,
                    "left_hidden_widgets": [],
                    "left_widget_order": ["search", "categories", "productGrid"],
                    "widget_sizes": {},
                    "left_widget_sizes": {},
                },
            },
            "role_overrides": {
                "staff": {},
                "manager": {},
            },
        },
    )
    email_settings = getv(
        "email_settings",
        {"enabled": False, "provider": "none", "resend_api_key": "", "sender_email": "", "recipient_emails": [], "webhook_url": "", "timeout_sec": 15},
    )
    omnitech_settings = getv(
        "omnitech_settings",
        {"enabled": False, "api_base_url": "", "api_key": "", "merchant_id": "", "terminal_id": "", "fiscal_device_id": ""},
    )
    if not _can_view_sensitive_settings(user):
        email_settings = {
            "enabled": bool(email_settings.get("enabled")),
            "provider": str(email_settings.get("provider") or "none"),
            "resend_api_key": "",
            "sender_email": "",
            "recipient_emails": [],
            "webhook_url": "",
            "timeout_sec": int(email_settings.get("timeout_sec") or 15),
        }
        omnitech_settings = {
            "enabled": bool(omnitech_settings.get("enabled")),
            "api_base_url": str(omnitech_settings.get("api_base_url") or ""),
            "api_key": "",
            "merchant_id": str(omnitech_settings.get("merchant_id") or ""),
            "terminal_id": str(omnitech_settings.get("terminal_id") or ""),
            "fiscal_device_id": str(omnitech_settings.get("fiscal_device_id") or ""),
        }
        gemini_api_key = ""
    else:
        gemini_api_key = getv("gemini_api_key", "")
    ai_config = getv(
        "ai_config",
        {"provider": "unknown", "model": "auto", "autodetected": True, "ollama_freeapi_enabled": False, "updated_at": ""},
    )
    response.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=300"
    return {
        "tenant_id": tenant.id,
        "service_fee_percent": getv("service_fee_percent", 0),
        "table_service_settings": getv("table_service_settings", {"deposit_per_guest_azn": 0, "reservation_lock_hours": 2}),
        "beverage_service_settings": getv("beverage_service_settings", DEFAULT_BEVERAGE_SERVICE_SETTINGS),
        "z_report_receipt_settings": getv("z_report_receipt_settings", DEFAULT_Z_REPORT_RECEIPT_SETTINGS),
        "yield_management_settings": _yield_settings(db, tenant.id, settings_map=settings_map),
        "ui_visibility": {"staff_show_tables": True, "manager_show_tables": True, "staff_show_kitchen": True},
        "time_settings": {"shift_start_time": "08:00", "shift_end_time": "23:00", "utc_offset": 4, "timezone": "Asia/Baku"},
        "session_settings": session_settings,
        "email_settings": email_settings,
        "bank_commission": getv("bank_commission", {"min_amount": 0.10, "percent": 1.5, "card_sale_percent": 2, "card_transfer_percent": 0.5}),
        "finance_policy": getv("finance_policy", DEFAULT_FINANCE_POLICY),
        "inventory_settings": inventory_settings,
        "staff_benefits": staff_benefits,
        "print_settings": print_settings,
        "feedback_settings": getv("feedback_settings", DEFAULT_FEEDBACK_SETTINGS),
        "qr_settings": qr_settings,
        "qr_menu_settings": qr_menu_settings,
        "customer_app_settings": customer_app_settings,
        "pos_layout": pos_layout,
        "landing_settings": getv(
            "landing_settings",
            {
                "hero_title_az": "Azərbaycan bazarı üçün müasir POS və idarəetmə sistemi",
                "hero_title_ru": "Премиальная POS-платформа для ресторанов, coffee shop и retail",
                "hero_title_en": "A premium POS platform for restaurants, coffee shops, and retail concepts",
                "hero_body_az": "Kassa, masa, mətbəx, anbar, maliyyə, CRM və loyallıq axınlarını bir mərkəzdə birləşdirən yerli və çevik idarəetmə platforması.",
                "hero_body_ru": "Современная система управления, объединяющая продажи, столы, кухню, финансы, CRM и loyalty в одном продукте.",
                "hero_body_en": "A modern operations system that connects sales, tables, kitchen, finance, CRM, and loyalty inside one product.",
                "primary_cta_az": "Canlı Demoya Bax",
                "primary_cta_ru": "Открыть Live Demo",
                "primary_cta_en": "Open Live Demo",
                "secondary_cta_az": "Platformanı Aç",
                "secondary_cta_ru": "Открыть Платформу",
                "secondary_cta_en": "Open Platform",
                "contact_email": "hello@ironwaves.store",
                "contact_phone": "",
                "contact_whatsapp": "",
            },
        ),
        "omnitech_settings": omnitech_settings,
        "role_modules": role_modules,
        "gemini_api_key": gemini_api_key,
        "ai_config": ai_config,
    }


@router.patch("/settings/role-modules")
def update_role_modules(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    _set_setting_value(db, tenant.id, "role_modules", payload)
    db.commit()
    return {"success": True}


@router.patch("/settings/yield-management")
def update_yield_management_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    current = _yield_settings(db, tenant.id)
    profiles = dict(current.get("profiles") or {})
    payload_profiles = dict(payload.get("profiles") or {})
    for key, value in payload_profiles.items():
        if not isinstance(value, dict):
            continue
        safe_key = str(key or "").strip().lower()
        if not safe_key:
            continue
        profiles[safe_key] = {
            "raw_to_ready_ratio": max(1, float(value.get("raw_to_ready_ratio") or profiles.get(safe_key, {}).get("raw_to_ready_ratio") or 1)),
            "loss_min_percent": max(0, float(value.get("loss_min_percent") or profiles.get(safe_key, {}).get("loss_min_percent") or 0)),
            "loss_max_percent": max(0, float(value.get("loss_max_percent") or profiles.get(safe_key, {}).get("loss_max_percent") or 0)),
        }
    tracked_items = []
    for row in payload.get("tracked_items") or current.get("tracked_items") or []:
        if not isinstance(row, dict):
            continue
        inventory_name = str(row.get("inventory_name") or "").strip()
        if not inventory_name:
            continue
        tracked_items.append(
            {
                "inventory_name": inventory_name,
                "meat_type": str(row.get("meat_type") or "beef").strip().lower() or "beef",
                "raw_to_ready_ratio": max(1, float(row.get("raw_to_ready_ratio") or 1)),
                "enabled": bool(row.get("enabled", True)),
            }
        )
    cleaned = {
        "enabled": bool(payload.get("enabled", current.get("enabled", False))),
        "variance_tolerance_percent": max(0, float(payload.get("variance_tolerance_percent") or current.get("variance_tolerance_percent") or 5)),
        "profiles": profiles,
        "tracked_items": tracked_items,
    }
    _set_setting_value(db, tenant.id, "yield_management_settings", cleaned)
    db.commit()
    return {"success": True, "yield_management_settings": cleaned}


@router.patch("/settings/pos-layout-draft")
def update_pos_layout_draft_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    def _clean_layout(source: dict, fallback: dict | None = None):
        base = fallback or {}
        preset_value = str(source.get("preset", base.get("preset", "classic")) or "classic").strip().lower()
        density_value = str(source.get("density", base.get("density", "comfortable")) or "comfortable").strip().lower()
        try:
            product_columns_value = int(source.get("product_columns", base.get("product_columns", 3)) or 3)
        except Exception:
            product_columns_value = 3
        widget_order = _ensure_known_widget_order(
            source.get("widget_order"),
            base.get("widget_order") or POS_RIGHT_WIDGET_KEYS,
            POS_RIGHT_WIDGET_KEYS,
        )
        left_widget_order = _ensure_known_widget_order(
            source.get("left_widget_order"),
            base.get("left_widget_order") or POS_LEFT_WIDGET_KEYS,
            POS_LEFT_WIDGET_KEYS,
        )
        cleaned = {
            "preset": preset_value if preset_value in {"classic", "fast", "touch", "tables"} else "classic",
            "density": density_value if density_value in {"compact", "comfortable", "large"} else "comfortable",
            "product_columns": product_columns_value if product_columns_value in {2, 3, 4} else 3,
            "show_cart_tabs": bool(source.get("show_cart_tabs", base.get("show_cart_tabs", True))),
            "accent_color": str(source.get("accent_color") or base.get("accent_color") or "").strip() or "#facc15",
            "hidden_widgets": [
                key
                for key in [str(v or "").strip() for v in (source.get("hidden_widgets") or base.get("hidden_widgets") or []) if str(v or "").strip()]
                if key in POS_RIGHT_WIDGET_KEYS and key not in POS_REQUIRED_RIGHT_WIDGETS
            ],
            "widget_order": widget_order,
            "left_hidden_widgets": [
                key
                for key in [str(v or "").strip() for v in (source.get("left_hidden_widgets") or base.get("left_hidden_widgets") or []) if str(v or "").strip()]
                if key in POS_LEFT_WIDGET_KEYS and key not in POS_REQUIRED_LEFT_WIDGETS
            ],
            "left_widget_order": left_widget_order,
            "widget_sizes": {
                str(k): (str(v).strip().lower() if str(v).strip().lower() in {"compact", "comfortable", "expanded"} else "comfortable")
                for k, v in dict(source.get("widget_sizes") or base.get("widget_sizes") or {}).items()
                if str(k or "").strip()
            },
            "left_widget_sizes": {
                str(k): (str(v).strip().lower() if str(v).strip().lower() in {"compact", "comfortable", "expanded"} else "comfortable")
                for k, v in dict(source.get("left_widget_sizes") or base.get("left_widget_sizes") or {}).items()
                if str(k or "").strip()
            },
            "panel_ratio": source.get("panel_ratio", base.get("panel_ratio", "50:50")) if source.get("panel_ratio", base.get("panel_ratio", "50:50")) in {"50:50", "55:45", "60:40", "65:35", "70:30"} else "50:50",
            "widget_options": dict(source.get("widget_options") or base.get("widget_options") or {}),
        }
        role_overrides = source.get("role_overrides") or {}
        cleaned["role_overrides"] = {
            "staff": _clean_layout(role_overrides.get("staff") or {}, cleaned) if role_overrides.get("staff") else {},
            "manager": _clean_layout(role_overrides.get("manager") or {}, cleaned) if role_overrides.get("manager") else {},
        }
        device_layouts = source.get("device_layouts") or {}
        cleaned["device_layouts"] = {
            "desktop": _clean_layout(device_layouts.get("desktop") or {}, cleaned) if device_layouts.get("desktop") else {},
            "tablet": _clean_layout(device_layouts.get("tablet") or {}, cleaned) if device_layouts.get("tablet") else {},
        }
        return cleaned
    cleaned = _clean_layout(payload)
    _set_setting_value(db, tenant.id, "pos_layout_draft", cleaned)
    db.commit()
    return {"success": True}


@router.post("/settings/pos-layout/publish")
def publish_pos_layout(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    draft = _setting_value(db, tenant.id, "pos_layout_draft", None)
    if draft:
      _set_setting_value(db, tenant.id, "pos_layout", draft)
      db.commit()
    return {"success": True}


@router.post("/settings/pos-layout-draft/reset")
def reset_pos_layout_draft(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    live = _setting_value(db, tenant.id, "pos_layout", None)
    if live:
      _set_setting_value(db, tenant.id, "pos_layout_draft", live)
      db.commit()
    return {"success": True}


@router.get("/database/backup")
def export_database_backup(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    payload = {
        "_backup_timestamp": datetime.utcnow().isoformat(),
        "_tenant_id": tenant.id,
        "users": [
            _serialize_model_row(row, ["id", "tenant_id", "username", "email", "role", "is_active", "created_at"])
            for row in db.query(User).filter(User.tenant_id == tenant.id).all()
        ],
        "menu_items": [
            _serialize_model_row(row, ["id", "tenant_id", "item_name", "category", "price", "is_coffee", "image_url", "description", "is_active"])
            for row in db.query(MenuItem).filter(MenuItem.tenant_id == tenant.id).all()
        ],
        "sales": [
            {
                **_serialize_model_row(row, ["id", "tenant_id", "cashier", "customer_card_id", "payment_method", "order_type", "offline_request_id", "receipt_code", "receipt_token", "reward_claim_code", "total", "discount_amount", "cogs", "status", "created_at"]),
                "items": safe_json_list(row.items_json),
            }
            for row in db.query(Sale).filter(Sale.tenant_id == tenant.id).all()
        ],
        "finance": [
            _serialize_model_row(row, ["id", "tenant_id", "type", "category", "source", "amount", "description", "created_by", "created_at"])
            for row in db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant.id).all()
        ],
        "tables": [
            _serialize_model_row(row, [column.name for column in Table.__table__.columns])
            for row in db.query(Table).filter(Table.tenant_id == tenant.id).all()
        ],
        "kitchen_orders": [
            {
                **_serialize_model_row(row, ["id", "tenant_id", "sale_id", "table_label", "order_type", "status", "priority", "created_at", "completed_at"]),
                "items": safe_json_list(row.items_json),
            }
            for row in db.query(KitchenOrder).filter(KitchenOrder.tenant_id == tenant.id).all()
        ],
        "inventory": [
            _serialize_model_row(row, ["id", "tenant_id", "name", "unit", "category", "stock_qty", "unit_cost", "min_limit"])
            for row in db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant.id).all()
        ],
        "customers": [
            _serialize_model_row(row, ["id", "tenant_id", "card_id", "type", "stars", "secret_token", "discount_percent", "created_at"])
            for row in db.query(Customer).filter(Customer.tenant_id == tenant.id).all()
        ],
        "customer_consents": [
            _serialize_model_row(row, ["id", "tenant_id", "card_id", "consent_type", "accepted", "source", "accepted_at", "revoked_at"])
            for row in db.query(CustomerConsent).filter(CustomerConsent.tenant_id == tenant.id).all()
        ],
        "recipes": [
            _serialize_model_row(row, ["id", "tenant_id", "menu_item_name", "ingredient_name", "quantity_required"])
            for row in db.query(Recipe).filter(Recipe.tenant_id == tenant.id).all()
        ],
        "happy_hours": [
            _serialize_model_row(row, ["id", "tenant_id", "name", "start_time", "end_time", "discount_percent", "days_of_week_json", "categories", "is_active", "created_at"])
            for row in db.query(HappyHour).filter(HappyHour.tenant_id == tenant.id).all()
        ],
        "shift_handovers": [
            _serialize_model_row(row, ["id", "tenant_id", "handed_by", "received_by", "declared_cash", "actual_cash", "difference", "status", "created_at", "accepted_at"])
            for row in db.query(ShiftHandover).filter(ShiftHandover.tenant_id == tenant.id).all()
        ],
        "settings": _export_settings_bundle(db, tenant.id),
        "notifications": [
            _serialize_model_row(row, ["id", "tenant_id", "card_id", "message", "is_read", "created_at"])
            for row in db.query(Notification).filter(Notification.tenant_id == tenant.id).all()
        ],
        "business_profile": [
            _serialize_model_row(row, ["id", "tenant_id", "company_name", "phone", "address", "website", "logo_url", "receipt_footer"])
            for row in db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).all()
        ],
        "logs": [
            _serialize_model_row(row, ["id", "tenant_id", "user", "action", "details", "created_at"])
            for row in db.query(AuditLog).filter(AuditLog.tenant_id == tenant.id).all()
        ],
    }
    return payload


@router.post("/database/verify-admin-password")
def database_verify_admin_password(
    payload: DatabaseVerifyAdminPasswordIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    raw = str(payload.password or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Password required")

    if not user.password_hash:
        return {"success": False}
    return {"success": bool(verify_password(raw, user.password_hash))}


@router.post("/database/restore-preview")
def database_restore_preview(
    payload: DatabaseRestorePreviewIn,
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    try:
        data = json.loads(_sanitize_nonstandard_json(payload.json_data))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Backup JSON düzgün oxunmadı: {exc}")
    available_tables: list[str] = []
    row_counts: dict[str, int] = {}
    warnings: list[str] = []
    if data.get("_tenant_id") and str(data.get("_tenant_id")) != str(tenant.id):
        warnings.append("Backup fərqli tenant üçün yaradılıb.")
    for table in DATABASE_RESTORE_TABLES:
        rows, source = _resolve_restore_rows(data, table)
        if rows is None:
            continue
        available_tables.append(table)
        row_counts[table] = len(rows)
        if source != table:
            warnings.append(f"'{table}' bölməsi '{source}' aliasından bərpa olunacaq.")
    known_aliases = {alias for aliases in DATABASE_TABLE_ALIASES.values() for alias in aliases}
    known_aliases.update(DATABASE_CANONICAL_RESTORE_TABLES.keys())
    unsupported = [
        key
        for key, value in data.items()
        if isinstance(value, list) and key not in DATABASE_SUPPORTED_TABLES and key not in known_aliases and not key.startswith("_")
    ]
    for key in unsupported:
        warnings.append(f"'{key}' hazırda server bərpasında dəstəklənmir və ötürüləcək.")
    return {
        "available_tables": available_tables,
        "row_counts": row_counts,
        "warnings": warnings,
    }


@router.get("/database/restore-status")
def database_restore_status(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    status = _get_restore_status(tenant.id)
    if status:
        return status
    latest = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == tenant.id,
            AuditLog.action.in_(["DATABASE_RESTORE_COMPLETED", "DATABASE_RESTORE_FAILED"]),
        )
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    if not latest:
        return {"active": False}
    details = {}
    try:
        details = json.loads(str(latest.details or "{}"))
    except Exception:
        details = {}
    is_success = latest.action == "DATABASE_RESTORE_COMPLETED"
    return {
        "active": False,
        "success": is_success,
        "restore_run_id": details.get("restore_run_id"),
        "phase": "completed" if is_success else "failed",
        "message": "Son bərpa tamamlandı" if is_success else "Son bərpa xətası var",
        "duration_ms": int(details.get("duration_ms") or 0),
        "restored_rows": int(details.get("restored_rows") or 0),
        "rejected_rows": int(details.get("rejected_rows") or 0),
        "warnings_count": int(details.get("warnings_count") or 0),
        "updated_at": latest.created_at.isoformat() if latest.created_at else None,
    }


@router.post("/database/restore")
def database_restore(
    payload: DatabaseRestoreIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    try:
        data = json.loads(_sanitize_nonstandard_json(payload.json_data))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Backup JSON düzgün oxunmadı: {exc}")
    if not _acquire_restore_slot(tenant.id):
        raise HTTPException(status_code=409, detail="Bu tenant üçün hazırda bərpa prosesi artıq gedir. Zəhmət olmasa tamamlanmasını gözləyin.")
    restore_run_id = secrets.token_hex(8)
    started_at = time.perf_counter()
    selected, unsupported_selected = _normalize_restore_tables(payload.selected_tables)
    total_tables = len([table for table in DATABASE_RESTORE_TABLES if table in selected])
    _set_restore_status(
        tenant.id,
        {
            "active": True,
            "success": None,
            "restore_run_id": restore_run_id,
            "phase": "started",
            "message": "Bərpa prosesi başladı",
            "processed_tables": 0,
            "total_tables": total_tables,
            "current_table": None,
            "warnings_count": 0,
            "started_at": datetime.utcnow().isoformat(),
        },
    )
    try:
        expected_counts: dict[str, int] = {}
        processed_tables = 0
        report = {
            "success": True,
            "restore_run_id": restore_run_id,
            "restored_tables": [],
            "restored_rows": 0,
            "skipped_tables": [],
            "rejected_rows": 0,
            "rejected_samples": [],
            "warnings": [],
            "verification": {},
            "dependency_verification": {},
            "duration_ms": 0,
        }
        if data.get("_tenant_id") and str(data.get("_tenant_id")) != str(tenant.id):
            report["warnings"].append("Backup fərqli tenant üçün yaradılıb; məlumatlar cari tenant-a bərpa olundu.")
        for table in unsupported_selected:
            report["warnings"].append(f"'{table}' hazırda server bərpasında dəstəklənmir və ötürüldü.")

        def reject(table: str, reason: str, row_index: int, row: dict):
            report["rejected_rows"] += 1
            if len(report["rejected_samples"]) < 30:
                report["rejected_samples"].append({"table": table, "reason": reason, "row_index": row_index, "row": row})

        def normalize_user_role(raw_role: str | None) -> str:
            role = str(raw_role or "staff").strip().lower()
            role_map = {
                "cashier": "staff",
                "waiter": "staff",
                "server": "staff",
                "owner": "admin",
            }
            normalized = role_map.get(role, role or "staff")
            is_platform_tenant = str(tenant.slug or "").strip().lower() == str(app_settings.platform_tenant_slug or "").strip().lower()
            caller_is_super_admin = str(user.role or "").strip().lower() == "super_admin"
            allowed_roles = {"staff", "manager", "admin", "kitchen", "finance_admin"}
            if is_platform_tenant and caller_is_super_admin:
                allowed_roles.add("super_admin")
            if normalized == "super_admin" and "super_admin" not in allowed_roles:
                return "admin"
            return normalized if normalized in allowed_roles else "staff"

        def normalize_restored_password(value) -> str:
            raw = str(value or "").strip()
            if not raw:
                return ""
            if raw.startswith("$2a$") or raw.startswith("$2b$") or raw.startswith("$2y$"):
                return raw
            return hash_password(raw)

        table_map = {
            "menu_items": MenuItem,
            "menu": MenuItem,
            "tables": Table,
            "inventory": InventoryItem,
            "ingredients": InventoryItem,
            "customers": Customer,
            "customer_consents": CustomerConsent,
            "recipes": Recipe,
            "happy_hours": HappyHour,
            "shift_handovers": ShiftHandover,
            "notifications": Notification,
            "logs": AuditLog,
        }
        restore_handlers = _build_restore_handler_registry(
            generic_table_map=table_map,
            restore_users="users",
            restore_settings="settings",
            restore_business_profile="business_profile",
            restore_sales="sales",
            restore_finance="finance",
            restore_kitchen_orders="kitchen_orders",
        )

        for table in DATABASE_RESTORE_TABLES:
            if table not in selected:
                continue
            rows, source = _resolve_restore_rows(data, table)
            _set_restore_status(
                tenant.id,
                {
                    "active": True,
                    "success": None,
                    "restore_run_id": restore_run_id,
                    "phase": "restoring",
                    "message": f"'{table}' cədvəli bərpa olunur",
                    "processed_tables": processed_tables,
                    "total_tables": total_tables,
                    "current_table": table,
                    "warnings_count": len(report["warnings"]),
                },
            )
            handler = restore_handlers.get(table)
            if rows is None and handler not in {"settings", "business_profile", "sales", "finance", "kitchen_orders"}:
                report["skipped_tables"].append(table)
                processed_tables += 1
                continue
            if source and source != table:
                report["warnings"].append(f"'{table}' cədvəli '{source}' bölməsindən bərpa olundu.")

            if handler == "users" and rows is not None:
                restored_count, missing_password_warning = _restore_user_rows(
                    db,
                    tenant_id=tenant.id,
                    rows=rows,
                    default_username=user.username,
                    normalize_role=normalize_user_role,
                    normalize_password_hash=normalize_restored_password,
                    hash_password=hash_password,
                    parse_dt=_parse_dt,
                    reject_row=lambda message, idx, raw: reject("users", message, idx, raw),
                )
                if missing_password_warning and not any("İstifadəçi şifrələri backup-a daxil edilmir" in warning for warning in report["warnings"]):
                    report["warnings"].append("İstifadəçi şifrələri backup-a daxil edilmir; bərpa olunan istifadəçilər üçün şifrə yenilənməlidir.")
                report["restored_tables"].append("users")
                report["restored_rows"] += restored_count
                expected_counts["users"] = restored_count
                processed_tables += 1
                continue

            if isinstance(handler, tuple) and handler[0] == "generic" and rows is not None:
                restored_count = _restore_generic_model_rows(
                    db,
                    model=handler[1],
                    tenant_id=tenant.id,
                    rows=rows,
                    parse_dt=_parse_dt,
                    parse_decimal=_parse_decimal,
                    reject_row=lambda message, idx, raw: reject(table, message, idx, raw),
                )
                report["restored_tables"].append(table)
                report["restored_rows"] += restored_count
                expected_counts[table] = restored_count
                processed_tables += 1
                continue

            if handler == "settings":
                settings_rows = _extract_settings_rows(data, tenant.id)
                restored_count = _restore_settings_rows(db, tenant_id=tenant.id, rows=settings_rows)
                report["restored_tables"].append(table)
                report["restored_rows"] += restored_count
                expected_counts[table] = restored_count
                processed_tables += 1
                continue

            if handler == "business_profile":
                profile_rows = data.get("business_profile")
                if not isinstance(profile_rows, list) or not profile_rows:
                    report["skipped_tables"].append(table)
                    processed_tables += 1
                    continue
                restored_count = _restore_business_profile_rows(
                    db,
                    tenant_id=tenant.id,
                    rows=profile_rows,
                    reject_row=lambda message, idx, raw: reject(table, message, idx, raw),
                )
                report["restored_tables"].append(table)
                report["restored_rows"] += restored_count
                expected_counts[table] = restored_count
                processed_tables += 1
                continue

            if handler == "sales":
                sale_rows = rows
                if not isinstance(sale_rows, list):
                    report["skipped_tables"].append(table)
                    processed_tables += 1
                    continue
                restored_count = _restore_sales_rows(
                    db,
                    tenant_id=tenant.id,
                    rows=sale_rows,
                    default_cashier=user.username,
                    parse_dt=_parse_dt,
                    parse_decimal=_parse_decimal,
                    reject_row=lambda message, idx, raw: reject(table, message, idx, raw),
                )
                report["restored_tables"].append(table)
                report["restored_rows"] += restored_count
                expected_counts[table] = restored_count
                processed_tables += 1
                continue

            if handler == "finance":
                finance_rows = rows
                if not isinstance(finance_rows, list):
                    report["skipped_tables"].append(table)
                    processed_tables += 1
                    continue
                db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant.id).delete(synchronize_session=False)
                restored_count = _restore_legacy_finance_rows(
                    db,
                    tenant_id=tenant.id,
                    rows=finance_rows,
                    default_username=user.username,
                    parse_dt=_parse_dt,
                    parse_decimal=_parse_decimal,
                    reject_row=lambda message, idx, raw: reject(table, message, idx, raw),
                )
                report["restored_tables"].append(table)
                report["restored_rows"] += restored_count
                expected_counts[table] = restored_count
                processed_tables += 1
                continue

            if handler == "kitchen_orders":
                kitchen_rows = rows
                if not isinstance(kitchen_rows, list):
                    report["skipped_tables"].append(table)
                    processed_tables += 1
                    continue
                restored_count = _restore_kitchen_order_rows(
                    db,
                    tenant_id=tenant.id,
                    rows=kitchen_rows,
                    parse_dt=_parse_dt,
                    reject_row=lambda message, idx, raw: reject(table, message, idx, raw),
                )
                report["restored_tables"].append(table)
                report["restored_rows"] += restored_count
                expected_counts[table] = restored_count
                processed_tables += 1
                continue

        verification_models = {
            "users": User,
            "menu_items": MenuItem,
            "menu": MenuItem,
            "tables": Table,
            "inventory": InventoryItem,
            "ingredients": InventoryItem,
            "customers": Customer,
            "customer_consents": CustomerConsent,
            "recipes": Recipe,
            "happy_hours": HappyHour,
            "shift_handovers": ShiftHandover,
            "notifications": Notification,
            "logs": AuditLog,
            "settings": Setting,
            "business_profile": BusinessProfile,
            "sales": Sale,
            "finance": FinanceEntry,
            "kitchen_orders": KitchenOrder,
        }
        validation_specs = {
            "users": {
                "required_fields": ["username", "password_hash", "role"],
            },
            "menu_items": {
                "required_fields": ["item_name", "category"],
                "nonnegative_fields": ["price"],
            },
            "menu": {
                "required_fields": ["item_name", "category"],
                "nonnegative_fields": ["price"],
            },
            "tables": {
                "required_fields": ["label", "status"],
                "nonnegative_fields": ["capacity", "guest_count", "deposit_amount", "total"],
                "json_fields": {"items_json": "list"},
            },
            "inventory": {
                "required_fields": ["name", "unit"],
                "nonnegative_fields": ["unit_cost", "min_limit"],
            },
            "customers": {
                "required_fields": ["card_id", "secret_token", "type"],
                "nonnegative_fields": ["stars", "discount_percent"],
            },
            "recipes": {
                "required_fields": ["menu_item_name", "ingredient_name"],
                "nonnegative_fields": ["quantity_required"],
            },
            "settings": {
                "required_fields": ["key"],
            },
            "business_profile": {
                "required_fields": ["company_name"],
            },
            "sales": {
                "required_fields": ["cashier", "payment_method", "status"],
                "nonnegative_fields": ["total", "discount_amount", "cogs"],
                "json_fields": {"items_json": "list"},
            },
            "finance": {
                "required_fields": ["type", "category", "source", "created_by"],
                "nonnegative_fields": ["amount"],
                "allowed_values": {
                    "type": {"in", "out"},
                    "source": {"cash", "card", "safe", "debt", "deposit", "investor", "legacy_investor_expense"},
                },
            },
            "kitchen_orders": {
                "required_fields": ["status", "priority"],
                "json_fields": {"items_json": "list"},
                "allowed_values": {
                    "status": {"NEW", "SENT", "PREPARING", "READY", "DONE", "COMPLETED", "CANCELLED", "VOID_REQUESTED"},
                    "priority": {"LOW", "NORMAL", "HIGH", "URGENT"},
                },
            },
        }
        verification, verification_warnings, verification_success = _verify_restored_tables(
            db,
            tenant_id=tenant.id,
            expected_counts=expected_counts,
            verification_models=verification_models,
            validation_specs=validation_specs,
        )
        report["verification"] = verification
        if not verification_success:
            report["success"] = False
        report["warnings"].extend(verification_warnings)
        dependency_verification, dependency_warnings, dependency_success = _verify_restore_dependencies(
            db,
            tenant_id=tenant.id,
            verification_models=verification_models,
            restored_tables=set(report["restored_tables"]),
        )
        report["dependency_verification"] = dependency_verification
        if not dependency_success:
            report["success"] = False
        report["warnings"].extend(dependency_warnings)

        report["duration_ms"] = int((time.perf_counter() - started_at) * 1000)
        _append_restore_audit(
            db,
            tenant_id=tenant.id,
            username=user.username,
            action="DATABASE_RESTORE_COMPLETED",
            restore_run_id=restore_run_id,
            details={
                "duration_ms": report["duration_ms"],
                "restored_tables": report["restored_tables"],
                "restored_rows": report["restored_rows"],
                "rejected_rows": report["rejected_rows"],
                "warnings_count": len(report["warnings"]),
            },
        )
        _set_restore_status(
            tenant.id,
            {
                "active": False,
                "success": bool(report["success"]),
                "restore_run_id": restore_run_id,
                "phase": "completed" if report["success"] else "completed_with_warnings",
                "message": "Bərpa tamamlandı",
                "processed_tables": processed_tables,
                "total_tables": total_tables,
                "current_table": None,
                "warnings_count": len(report["warnings"]),
                "duration_ms": report["duration_ms"],
                "restored_rows": report["restored_rows"],
                "rejected_rows": report["rejected_rows"],
            },
        )
        db.commit()
        return report
    except HTTPException:
        db.rollback()
        try:
            _append_restore_audit(
                db,
                tenant_id=tenant.id,
                username=user.username,
                action="DATABASE_RESTORE_FAILED",
                restore_run_id=restore_run_id,
                details={
                    "duration_ms": int((time.perf_counter() - started_at) * 1000),
                    "reason": "HTTPException",
                },
            )
            db.commit()
        except Exception:
            db.rollback()
        _set_restore_status(
            tenant.id,
            {
                "active": False,
                "success": False,
                "restore_run_id": restore_run_id,
                "phase": "failed",
                "message": "Bərpa dayandırıldı",
            },
        )
        raise
    except Exception as exc:
        db.rollback()
        try:
            _append_restore_audit(
                db,
                tenant_id=tenant.id,
                username=user.username,
                action="DATABASE_RESTORE_FAILED",
                restore_run_id=restore_run_id,
                details={
                    "duration_ms": int((time.perf_counter() - started_at) * 1000),
                    "reason": str(exc),
                },
            )
            db.commit()
        except Exception:
            db.rollback()
        _set_restore_status(
            tenant.id,
            {
                "active": False,
                "success": False,
                "restore_run_id": restore_run_id,
                "phase": "failed",
                "message": f"Bərpa xətası: {exc}",
            },
        )
        raise HTTPException(status_code=500, detail=f"Database restore failed: {exc}")
    finally:
        _release_restore_slot(tenant.id)


@router.patch("/settings/gemini-key")
def update_gemini_key(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    _set_setting_value(db, tenant.id, "gemini_api_key", str(payload.get("api_key") or ""))
    ai_cfg_raw = payload.get("ai_config") if isinstance(payload, dict) else None
    ai_cfg = ai_cfg_raw if isinstance(ai_cfg_raw, dict) else {}
    _set_setting_value(
        db,
        tenant.id,
        "ai_config",
        {
            "provider": str(ai_cfg.get("provider") or "unknown"),
            "model": str(ai_cfg.get("model") or "auto"),
            "autodetected": bool(ai_cfg.get("autodetected", True)),
            "ollama_freeapi_enabled": bool(ai_cfg.get("ollama_freeapi_enabled", False)),
            "updated_at": _utcnow().isoformat(),
        },
    )
    db.commit()
    return {"success": True}


@router.patch("/settings/qr-settings")
def update_qr_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    base_url = str(payload.get("base_url") or "").strip()
    _set_setting_value(db, tenant.id, "qr_settings", {"base_url": base_url})
    db.commit()
    return {"success": True}


@router.patch("/settings/qr-menu")
def update_qr_menu_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    current = _setting_value(
        db,
        tenant.id,
        "qr_menu_settings",
        {
            "enabled": True,
            "hero_title": "QR Menu",
            "hero_subtitle": "Telefonunuzdan menyuya baxın",
            "show_prices": True,
            "show_images": True,
            "show_descriptions": True,
            "poster_title": "Menyuya baxmaq üçün skan et",
            "poster_subtitle": "Telefon kameranızı QR üzərinə yönəldin",
            "background_color": "#efe2c1",
            "surface_color": "#fff7e8",
            "text_color": "#2b1708",
            "hero_image_url": "",
            "poster_image_url": "",
            "poster_background_color": "#d59b2d",
            "logo_shape": "rounded",
        },
    )
    cleaned = {
        "enabled": bool(payload.get("enabled", current.get("enabled", True))),
        "hero_title": str(payload.get("hero_title") or current.get("hero_title") or "QR Menu").strip() or "QR Menu",
        "hero_subtitle": str(payload.get("hero_subtitle") or current.get("hero_subtitle") or "Telefonunuzdan menyuya baxın").strip() or "Telefonunuzdan menyuya baxın",
        "show_prices": bool(payload.get("show_prices", current.get("show_prices", True))),
        "show_images": bool(payload.get("show_images", current.get("show_images", True))),
        "show_descriptions": bool(payload.get("show_descriptions", current.get("show_descriptions", True))),
        "poster_title": str(payload.get("poster_title") or current.get("poster_title") or "Menyuya baxmaq üçün skan et").strip() or "Menyuya baxmaq üçün skan et",
        "poster_subtitle": str(payload.get("poster_subtitle") or current.get("poster_subtitle") or "Telefon kameranızı QR üzərinə yönəldin").strip() or "Telefon kameranızı QR üzərinə yönəldin",
        "background_color": str(payload.get("background_color") or current.get("background_color") or "#efe2c1").strip() or "#efe2c1",
        "surface_color": str(payload.get("surface_color") or current.get("surface_color") or "#fff7e8").strip() or "#fff7e8",
        "text_color": str(payload.get("text_color") or current.get("text_color") or "#2b1708").strip() or "#2b1708",
        "hero_image_url": _normalize_image_url(payload.get("hero_image_url") if "hero_image_url" in payload else current.get("hero_image_url") or ""),
        "poster_image_url": _normalize_image_url(payload.get("poster_image_url") if "poster_image_url" in payload else current.get("poster_image_url") or ""),
        "poster_background_color": str(payload.get("poster_background_color") or current.get("poster_background_color") or "#d59b2d").strip() or "#d59b2d",
        "logo_shape": str(payload.get("logo_shape") or current.get("logo_shape") or "rounded").strip() or "rounded",
    }
    _set_setting_value(db, tenant.id, "qr_menu_settings", cleaned)
    db.commit()
    return {"success": True}


@router.patch("/settings/feedback")
def update_feedback_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    current = _setting_value(db, tenant.id, "feedback_settings", DEFAULT_FEEDBACK_SETTINGS)
    if not isinstance(current, dict):
        current = {}
    merged = {**DEFAULT_FEEDBACK_SETTINGS, **current, **(payload or {})}

    cleaned = {
        "enabled": bool(merged.get("enabled", True)),
        "promo_enabled": bool(merged.get("promo_enabled", True)),
        "coupon_percent": max(1, min(100, int(merged.get("coupon_percent", 5) or 5))),
        "portal_url": str(merged.get("portal_url") or "").strip(),
        "google_review_url": str(merged.get("google_review_url") or "").strip(),
        "receipt_button_text_az": str(merged.get("receipt_button_text_az") or "Rəy bildirin").strip() or "Rəy bildirin",
        "receipt_button_text_ru": str(merged.get("receipt_button_text_ru") or "Оставить отзыв").strip() or "Оставить отзыв",
        "receipt_button_text_en": str(merged.get("receipt_button_text_en") or "Leave feedback").strip() or "Leave feedback",
        "receipt_qr_prompt_az": str(merged.get("receipt_qr_prompt_az") or DEFAULT_FEEDBACK_SETTINGS["receipt_qr_prompt_az"]).strip() or DEFAULT_FEEDBACK_SETTINGS["receipt_qr_prompt_az"],
        "receipt_qr_prompt_ru": str(merged.get("receipt_qr_prompt_ru") or DEFAULT_FEEDBACK_SETTINGS["receipt_qr_prompt_ru"]).strip() or DEFAULT_FEEDBACK_SETTINGS["receipt_qr_prompt_ru"],
        "receipt_qr_prompt_en": str(merged.get("receipt_qr_prompt_en") or DEFAULT_FEEDBACK_SETTINGS["receipt_qr_prompt_en"]).strip() or DEFAULT_FEEDBACK_SETTINGS["receipt_qr_prompt_en"],
        "thank_you_text_az": str(merged.get("thank_you_text_az") or DEFAULT_FEEDBACK_SETTINGS["thank_you_text_az"]).strip() or DEFAULT_FEEDBACK_SETTINGS["thank_you_text_az"],
        "thank_you_text_ru": str(merged.get("thank_you_text_ru") or DEFAULT_FEEDBACK_SETTINGS["thank_you_text_ru"]).strip() or DEFAULT_FEEDBACK_SETTINGS["thank_you_text_ru"],
        "thank_you_text_en": str(merged.get("thank_you_text_en") or DEFAULT_FEEDBACK_SETTINGS["thank_you_text_en"]).strip() or DEFAULT_FEEDBACK_SETTINGS["thank_you_text_en"],
    }
    _set_setting_value(db, tenant.id, "feedback_settings", cleaned)
    db.commit()
    return {"success": True, "feedback_settings": cleaned}


@router.patch("/settings/bank-commission")
def update_bank_commission(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    current = _setting_value(db, tenant.id, "bank_commission", {"min_amount": 0.10, "percent": 1.5, "card_sale_percent": 2, "card_transfer_percent": 0.5})
    merged = {
        **current,
        **payload,
    }
    _set_setting_value(db, tenant.id, "bank_commission", merged)
    db.commit()
    return {"success": True}


@router.patch("/settings/finance-policy")
def update_finance_policy(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    current = _setting_value(db, tenant.id, "finance_policy", DEFAULT_FINANCE_POLICY)
    if not isinstance(current, dict):
        current = {}
    roles = payload.get("approver_roles", current.get("approver_roles", DEFAULT_FINANCE_POLICY["approver_roles"]))
    if isinstance(roles, str):
        roles = [part.strip() for part in roles.split(",") if part.strip()]
    if not isinstance(roles, list) or not roles:
        roles = DEFAULT_FINANCE_POLICY["approver_roles"]
    cleaned = {
        **DEFAULT_FINANCE_POLICY,
        **current,
        "large_transfer_threshold_azn": max(0, float(payload.get("large_transfer_threshold_azn", current.get("large_transfer_threshold_azn", 500)) or 0)),
        "investor_repayment_requires_approval": bool(payload.get("investor_repayment_requires_approval", current.get("investor_repayment_requires_approval", True))),
        "cash_adjustment_requires_approval": bool(payload.get("cash_adjustment_requires_approval", current.get("cash_adjustment_requires_approval", True))),
        "reversal_requires_approval": bool(payload.get("reversal_requires_approval", current.get("reversal_requires_approval", True))),
        "reconciliation_adjustment_requires_approval": bool(payload.get("reconciliation_adjustment_requires_approval", current.get("reconciliation_adjustment_requires_approval", True))),
        "legacy_wallet_sync_enabled": bool(payload.get("legacy_wallet_sync_enabled", current.get("legacy_wallet_sync_enabled", False))),
        "reconciliation_variance_alert_azn": max(0, float(payload.get("reconciliation_variance_alert_azn", current.get("reconciliation_variance_alert_azn", 0.01)) or 0)),
        "negative_balance_alert_azn": max(0, float(payload.get("negative_balance_alert_azn", current.get("negative_balance_alert_azn", 0)) or 0)),
        "approver_roles": [str(role).strip().lower() for role in roles if str(role).strip()],
    }
    _set_setting_value(db, tenant.id, "finance_policy", cleaned)
    db.commit()
    return {"success": True, "finance_policy": cleaned}


@router.get("/settings/landing/studio")
def get_landing_studio_settings(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    published = _normalize_landing_settings(_setting_value(db, tenant.id, "landing_settings", DEFAULT_LANDING_SETTINGS))
    draft = _normalize_landing_settings(_setting_value(db, tenant.id, "landing_settings_draft", published))
    return {
        "published": published,
        "draft": draft,
    }


@router.patch("/settings/landing")
def update_landing_settings(
    payload: dict,
    mode: str = Query("published"),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    key = "landing_settings_draft" if str(mode).lower() == "draft" else "landing_settings"
    current = _setting_value(db, tenant.id, key, DEFAULT_LANDING_SETTINGS)
    merged = _normalize_landing_settings({**current, **payload})
    _set_setting_value(db, tenant.id, key, merged)
    db.commit()
    return {"success": True}


@router.post("/settings/landing/publish")
def publish_landing_settings(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    draft = _normalize_landing_settings(_setting_value(db, tenant.id, "landing_settings_draft", DEFAULT_LANDING_SETTINGS))
    _set_setting_value(db, tenant.id, "landing_settings", draft)
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="LANDING_SETTINGS_PUBLISHED",
            details=json.dumps({"published_at": datetime.utcnow().isoformat()}, ensure_ascii=False),
        )
    )
    db.commit()
    return {"success": True}


@router.get("/public/landing-settings")
def get_public_landing_settings(db: Session = Depends(get_db)):
    platform_tenant = (
        db.query(Tenant)
        .filter(Tenant.slug == app_settings.platform_tenant_slug)
        .first()
    )
    if not platform_tenant:
        return DEFAULT_LANDING_SETTINGS
    value = _setting_value(db, platform_tenant.id, "landing_settings", DEFAULT_LANDING_SETTINGS)
    return _normalize_landing_settings(value)


@router.patch("/settings/customer-app")
def update_customer_app_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    cleaned = {
        "enabled": bool(payload.get("enabled", True)),
        "program_mode": "cashback" if str(payload.get("program_mode") or "").strip().lower() == "cashback" else "points",
        "layout_preset": str(payload.get("layout_preset") or "rewards").strip().lower() if str(payload.get("layout_preset") or "rewards").strip().lower() in {"rewards", "cashback", "playful"} else "rewards",
        "consent_text": str(payload.get("consent_text") or "").strip() or "Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.",
        "join_customer_type": str(payload.get("join_customer_type") or "golden").strip() or "golden",
        "join_discount_percent": max(0, float(payload.get("join_discount_percent") or 5)),
        "app_name": str(payload.get("app_name") or "").strip() or "Loyalty Club",
        "hero_title": str(payload.get("hero_title") or "").strip() or "Xoş gəldiniz",
        "hero_subtitle": str(payload.get("hero_subtitle") or "").strip() or "Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.",
        "hero_image_url": _normalize_image_url(payload.get("hero_image_url") or ""),
        "background_image_url": _normalize_image_url(payload.get("background_image_url") or ""),
        "background_color": str(payload.get("background_color") or "").strip() or "#0b1220",
        "points_label": str(payload.get("points_label") or "").strip() or "Ulduz",
        "reward_name": str(payload.get("reward_name") or "").strip() or "Reward",
        "reward_threshold": max(1, int(payload.get("reward_threshold") or 10)),
        "reward_description": str(payload.get("reward_description") or "").strip() or "10 ulduza 1 pulsuz içki",
        "reward_card_style": str(payload.get("reward_card_style") or "rounded").strip().lower() if str(payload.get("reward_card_style") or "rounded").strip().lower() in {"rounded", "soft-square", "glass"} else "rounded",
        "cashback_percent": max(0, float(payload.get("cashback_percent") or 5)),
        "primary_color": str(payload.get("primary_color") or "").strip() or "#facc15",
        "accent_color": str(payload.get("accent_color") or "").strip() or "#22d3ee",
        "show_qr_card": bool(payload.get("show_qr_card", True)),
        "show_wallet": bool(payload.get("show_wallet", True)),
        "ai_barista_enabled": bool(payload.get("ai_barista_enabled", False)),
        "ai_falci_enabled": bool(payload.get("ai_falci_enabled", False)),
        "show_campaigns": bool(payload.get("show_campaigns", True)),
        "show_history": bool(payload.get("show_history", True)),
        "show_notifications": bool(payload.get("show_notifications", True)),
    }
    _set_setting_value(db, tenant.id, "customer_app_settings", cleaned)
    db.commit()
    return {"success": True}


@router.patch("/settings/pos-layout")
def update_pos_layout_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    def _clean_layout(source: dict, fallback: dict | None = None):
        base = fallback or {}
        preset_value = str(source.get("preset", base.get("preset", "classic")) or "classic").strip().lower()
        density_value = str(source.get("density", base.get("density", "comfortable")) or "comfortable").strip().lower()
        try:
            product_columns_value = int(source.get("product_columns", base.get("product_columns", 3)) or 3)
        except Exception:
            product_columns_value = 3
        widget_order = _ensure_known_widget_order(
            source.get("widget_order"),
            base.get("widget_order") or POS_RIGHT_WIDGET_KEYS,
            POS_RIGHT_WIDGET_KEYS,
        )
        left_widget_order = _ensure_known_widget_order(
            source.get("left_widget_order"),
            base.get("left_widget_order") or POS_LEFT_WIDGET_KEYS,
            POS_LEFT_WIDGET_KEYS,
        )
        cleaned = {
            "preset": preset_value if preset_value in {"classic", "fast", "touch", "tables"} else "classic",
            "density": density_value if density_value in {"compact", "comfortable", "large"} else "comfortable",
            "product_columns": product_columns_value if product_columns_value in {2, 3, 4} else 3,
            "show_cart_tabs": bool(source.get("show_cart_tabs", base.get("show_cart_tabs", True))),
            "accent_color": str(source.get("accent_color") or base.get("accent_color") or "").strip() or "#facc15",
            "hidden_widgets": [
                key
                for key in [str(v or "").strip() for v in (source.get("hidden_widgets") or base.get("hidden_widgets") or []) if str(v or "").strip()]
                if key in POS_RIGHT_WIDGET_KEYS and key not in POS_REQUIRED_RIGHT_WIDGETS
            ],
            "widget_order": widget_order,
            "left_hidden_widgets": [
                key
                for key in [str(v or "").strip() for v in (source.get("left_hidden_widgets") or base.get("left_hidden_widgets") or []) if str(v or "").strip()]
                if key in POS_LEFT_WIDGET_KEYS and key not in POS_REQUIRED_LEFT_WIDGETS
            ],
            "left_widget_order": left_widget_order,
            "widget_sizes": {
                str(k): (str(v).strip().lower() if str(v).strip().lower() in {"compact", "comfortable", "expanded"} else "comfortable")
                for k, v in dict(source.get("widget_sizes") or base.get("widget_sizes") or {}).items()
                if str(k or "").strip()
            },
            "left_widget_sizes": {
                str(k): (str(v).strip().lower() if str(v).strip().lower() in {"compact", "comfortable", "expanded"} else "comfortable")
                for k, v in dict(source.get("left_widget_sizes") or base.get("left_widget_sizes") or {}).items()
                if str(k or "").strip()
            },
            "role_overrides": {},
            "device_layouts": {},
        }
        role_overrides = source.get("role_overrides") or {}
        cleaned["role_overrides"] = {
            "staff": _clean_layout(role_overrides.get("staff") or {}, cleaned) if role_overrides.get("staff") else {},
            "manager": _clean_layout(role_overrides.get("manager") or {}, cleaned) if role_overrides.get("manager") else {},
        }
        device_layouts = source.get("device_layouts") or {}
        cleaned["device_layouts"] = {
            "desktop": _clean_layout(device_layouts.get("desktop") or {}, cleaned) if device_layouts.get("desktop") else {},
            "tablet": _clean_layout(device_layouts.get("tablet") or {}, cleaned) if device_layouts.get("tablet") else {},
        }
        return cleaned

    cleaned = _clean_layout(payload)
    _set_setting_value(db, tenant.id, "pos_layout", cleaned)
    db.commit()
    return {"success": True}


@router.patch("/settings/email-settings")
def update_email_settings(
    payload: EmailSettingsIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    cleaned = {
        "enabled": bool(payload.enabled),
        "provider": str(payload.provider or "none").strip().lower(),
        "resend_api_key": str(payload.resend_api_key or "").strip(),
        "sender_email": str(payload.sender_email or "").strip(),
        "recipient_emails": [str(v or "").strip() for v in (payload.recipient_emails or []) if str(v or "").strip()],
        "webhook_url": str(payload.webhook_url or "").strip(),
        "timeout_sec": max(5, int(payload.timeout_sec or 15)),
    }
    _set_setting_value(db, tenant.id, "email_settings", cleaned)
    db.commit()
    return {"success": True}


@router.patch("/settings/service-fee")
def update_service_fee_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    _set_setting_value(db, tenant.id, "service_fee_percent", max(0, float(payload.get("service_fee_percent") or 0)))
    db.commit()
    return {"success": True}


@router.patch("/settings/table-service")
def update_table_service_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    current = _setting_value(db, tenant.id, "table_service_settings", {"deposit_per_guest_azn": 0, "reservation_lock_hours": 2})
    merged = {
        **current,
        "deposit_per_guest_azn": max(0, float(payload.get("deposit_per_guest_azn") or current.get("deposit_per_guest_azn") or 0)),
        "reservation_lock_hours": max(0, float(payload.get("reservation_lock_hours") if payload.get("reservation_lock_hours") is not None else current.get("reservation_lock_hours") or 2)),
    }
    _set_setting_value(db, tenant.id, "table_service_settings", merged)
    db.commit()
    return {"success": True}


@router.patch("/settings/beverage-service")
def update_beverage_service_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    cleaned = {
        "coffee_selection_mode": "size_only" if str(payload.get("coffee_selection_mode") or "").strip().lower() == "size_only" else "size_and_service",
        "remove_paper_packaging_for_table": bool(payload.get("remove_paper_packaging_for_table", True)),
        "discount_scope": "coffee_only" if str(payload.get("discount_scope") or "").strip().lower() == "coffee_only" else "all_items",
    }
    _set_setting_value(db, tenant.id, "beverage_service_settings", cleaned)
    db.commit()
    return {"success": True, "beverage_service_settings": cleaned}


@router.patch("/settings/z-report-receipt")
def update_z_report_receipt_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    cleaned = {
        **DEFAULT_Z_REPORT_RECEIPT_SETTINGS,
        **{key: bool(payload.get(key, DEFAULT_Z_REPORT_RECEIPT_SETTINGS[key])) for key in DEFAULT_Z_REPORT_RECEIPT_SETTINGS.keys()},
    }
    _set_setting_value(db, tenant.id, "z_report_receipt_settings", cleaned)
    db.commit()
    return {"success": True, "z_report_receipt_settings": cleaned}


@router.patch("/settings/session")
def update_session_settings(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    current = _setting_value(db, tenant.id, "session_settings", DEFAULT_SESSION_SETTINGS) or {}
    cleaned = {
        "idle_logout_minutes": max(0, int(payload.get("idle_logout_minutes") or 0)),
        "virtual_keyboard_enabled": bool(payload.get("virtual_keyboard_enabled", True)),
        "staff_pin_length": _clean_staff_pin_length(payload.get("staff_pin_length")),
        "theme_mode": _clean_theme_mode(payload.get("theme_mode", current.get("theme_mode"))),
        "ui_mode": _clean_ui_mode(payload.get("ui_mode", current.get("ui_mode"))),
    }
    _set_setting_value(db, tenant.id, "session_settings", cleaned)
    db.commit()
    return {"success": True, "session_settings": cleaned}


@router.patch("/settings/staff-benefits")
def update_staff_benefits(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    cleaned = {
        "daily_limit_azn": max(0, float(payload.get("daily_limit_azn") or 0)),
        "allowed_scope": str(payload.get("allowed_scope") or "all"),
        "included_categories": [str(v or "").strip() for v in (payload.get("included_categories") or []) if str(v or "").strip()],
        "included_items": [str(v or "").strip() for v in (payload.get("included_items") or []) if str(v or "").strip()],
        "item_unit_cap_azn": max(0, float(payload.get("item_unit_cap_azn") or 0)),
    }
    _set_setting_value(db, tenant.id, "staff_benefits", cleaned)
    db.commit()
    return {"success": True}


@router.get("/yield/batches/active")
def list_active_doner_batches(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(DonerBatch)
        .filter(DonerBatch.tenant_id == tenant.id, DonerBatch.status == "OPEN")
        .order_by(DonerBatch.opened_at.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "inventory_name": row.inventory_name,
            "meat_type": row.meat_type,
            "opened_by": row.opened_by,
            "opened_at": row.opened_at.isoformat() if row.opened_at else None,
            "raw_weight_kg": str(row.raw_weight_kg or 0),
            "raw_to_ready_ratio": str(row.raw_to_ready_ratio or 1),
            "expected_ready_weight_kg": str(row.expected_ready_weight_kg or 0),
            "sold_ready_weight_kg": str(row.sold_ready_weight_kg or 0),
            "deducted_raw_weight_kg": str(row.deducted_raw_weight_kg or 0),
            "notes": row.notes,
        }
        for row in rows
    ]


@router.post("/yield/batches/open")
def open_doner_batch(
    payload: DonerBatchOpenIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    inventory_name = str(payload.inventory_name or "").strip()
    if not inventory_name:
        raise HTTPException(status_code=400, detail="Inventory name is required")
    if Decimal(str(payload.raw_weight_kg or 0)) <= 0:
        raise HTTPException(status_code=400, detail="Raw weight must be > 0")
    settings = _yield_settings(db, tenant.id)
    profile = dict((settings.get("profiles") or {}).get(str(payload.meat_type or "beef").strip().lower()) or {})
    ratio = Decimal(str(payload.raw_to_ready_ratio or profile.get("raw_to_ready_ratio") or 1)).quantize(Decimal("0.0001"))
    raw_weight = Decimal(str(payload.raw_weight_kg)).quantize(Decimal("0.001"))
    expected_ready_weight = (raw_weight / ratio).quantize(Decimal("0.001")) if ratio > 0 else Decimal("0.000")
    row = DonerBatch(
        tenant_id=tenant.id,
        inventory_name=inventory_name,
        meat_type=str(payload.meat_type or "beef").strip().lower() or "beef",
        opened_by=user.username,
        raw_weight_kg=raw_weight,
        raw_to_ready_ratio=ratio,
        expected_ready_weight_kg=expected_ready_weight,
        sold_ready_weight_kg=Decimal("0.000"),
        deducted_raw_weight_kg=Decimal("0.000"),
        notes=str(payload.notes or "").strip() or None,
        status="OPEN",
    )
    db.add(row)
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="DONER_BATCH_OPENED",
            details=json.dumps(
                {
                    "inventory_name": inventory_name,
                    "meat_type": row.meat_type,
                    "raw_weight_kg": str(raw_weight),
                    "raw_to_ready_ratio": str(ratio),
                    "expected_ready_weight_kg": str(expected_ready_weight),
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    db.refresh(row)
    return {
        "success": True,
        "id": row.id,
        "expected_ready_weight_kg": str(expected_ready_weight),
    }


@router.post("/yield/batches/{batch_id}/close")
def close_doner_batch(
    batch_id: str,
    payload: DonerBatchCloseIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    row = db.query(DonerBatch).filter(DonerBatch.id == batch_id, DonerBatch.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Batch not found")
    if str(row.status or "").upper() == "CLOSED":
        raise HTTPException(status_code=400, detail="Batch already closed")
    actual_remaining = Decimal(str(payload.actual_remaining_raw_weight_kg or 0)).quantize(Decimal("0.001"))
    if actual_remaining < 0:
        raise HTTPException(status_code=400, detail="Remaining raw weight cannot be negative")

    expected_raw_consumption = Decimal(str(row.deducted_raw_weight_kg or 0)).quantize(Decimal("0.001"))
    actual_raw_consumption = max(Decimal("0.000"), Decimal(str(row.raw_weight_kg or 0)) - actual_remaining).quantize(Decimal("0.001"))
    variance_percent = (
        Decimal("0.00")
        if expected_raw_consumption <= 0
        else ((actual_raw_consumption - expected_raw_consumption) / expected_raw_consumption * Decimal("100")).quantize(Decimal("0.01"))
    )
    tolerance = Decimal(str(_yield_settings(db, tenant.id).get("variance_tolerance_percent") or 5)).quantize(Decimal("0.01"))
    flagged = variance_percent.copy_abs() > tolerance
    reason = "israf/oğurluq" if flagged else "normal"

    row.actual_remaining_raw_weight_kg = actual_remaining
    row.variance_percent = variance_percent
    row.status = "CLOSED"
    row.closed_at = datetime.utcnow()
    row.notes = str(payload.notes or row.notes or "").strip() or None

    db.add(
        WasteLog(
            tenant_id=tenant.id,
            batch_id=row.id,
            inventory_name=row.inventory_name,
            meat_type=row.meat_type,
            expected_raw_consumption_kg=expected_raw_consumption,
            actual_raw_consumption_kg=actual_raw_consumption,
            variance_percent=variance_percent,
            tolerance_percent=tolerance,
            flagged=flagged,
            reason=reason,
            notes=row.notes,
            created_by=user.username,
        )
    )
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="DONER_BATCH_CLOSED",
            details=json.dumps(
                {
                    "batch_id": row.id,
                    "inventory_name": row.inventory_name,
                    "expected_raw_consumption_kg": str(expected_raw_consumption),
                    "actual_raw_consumption_kg": str(actual_raw_consumption),
                    "variance_percent": str(variance_percent),
                    "tolerance_percent": str(tolerance),
                    "flagged": flagged,
                    "reason": reason,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {
        "success": True,
        "flagged": flagged,
        "reason": reason,
        "variance_percent": str(variance_percent),
        "expected_raw_consumption_kg": str(expected_raw_consumption),
        "actual_raw_consumption_kg": str(actual_raw_consumption),
    }


@router.get("/yield/waste-logs")
def list_yield_waste_logs(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(WasteLog)
        .filter(WasteLog.tenant_id == tenant.id)
        .order_by(WasteLog.created_at.desc())
        .limit(100)
        .all()
    )
    return [
        {
            "id": row.id,
            "batch_id": row.batch_id,
            "inventory_name": row.inventory_name,
            "meat_type": row.meat_type,
            "expected_raw_consumption_kg": str(row.expected_raw_consumption_kg or 0),
            "actual_raw_consumption_kg": str(row.actual_raw_consumption_kg or 0),
            "variance_percent": str(row.variance_percent or 0),
            "tolerance_percent": str(row.tolerance_percent or 0),
            "flagged": bool(row.flagged),
            "reason": row.reason,
            "notes": row.notes,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.post("/emails/send")
def send_email(
    payload: SendEmailIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    cfg = _setting_value(
        db,
        tenant.id,
        "email_settings",
        {"enabled": False, "provider": "none", "resend_api_key": "", "sender_email": "", "recipient_emails": [], "webhook_url": "", "timeout_sec": 15},
    )
    if not cfg.get("enabled") or cfg.get("provider") == "none":
        raise HTTPException(status_code=400, detail="Email provider disabled")

    recipients = payload.recipients or cfg.get("recipient_emails") or []
    recipients = [str(v or "").strip() for v in recipients if str(v or "").strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="Recipient email list is empty")

    timeout_sec = max(5, int(cfg.get("timeout_sec") or 15))
    provider = str(cfg.get("provider") or "none").strip().lower()

    try:
        if provider == "webhook":
            webhook_url = str(cfg.get("webhook_url") or "").strip()
            if not webhook_url:
                raise HTTPException(status_code=400, detail="Webhook URL is empty")
            req = urllib_request.Request(
                webhook_url,
                data=json.dumps(
                    {
                        "to": recipients,
                        "from": cfg.get("sender_email") or "",
                        "subject": payload.subject,
                        "html": payload.html,
                    }
                ).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib_request.urlopen(req, timeout=timeout_sec) as response:
                status_code = int(getattr(response, "status", 200))
                if status_code >= 400:
                    raise HTTPException(status_code=500, detail=f"Webhook failed: {status_code}")
            return {"success": True, "message": "Webhook sent"}

        resend_api_key = str(cfg.get("resend_api_key") or "").strip()
        sender_email = str(cfg.get("sender_email") or "").strip()
        if not resend_api_key or not sender_email:
            raise HTTPException(status_code=400, detail="Resend config incomplete")
        req = urllib_request.Request(
            "https://api.resend.com/emails",
            data=json.dumps(
                {
                    "from": sender_email,
                    "to": recipients,
                    "subject": payload.subject,
                    "html": payload.html,
                }
            ).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {resend_api_key}",
            },
            method="POST",
        )
        with urllib_request.urlopen(req, timeout=timeout_sec) as response:
            status_code = int(getattr(response, "status", 200))
            body = response.read().decode("utf-8") if hasattr(response, "read") else ""
            if status_code >= 400:
                raise HTTPException(status_code=500, detail=f"Resend failed: {status_code} {body}")
        return {"success": True, "message": "Resend sent"}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8") if hasattr(exc, "read") else str(exc)
        raise HTTPException(status_code=500, detail=f"Email send failed: {detail}")
    except URLError as exc:
        raise HTTPException(status_code=500, detail=f"Email send failed: {exc.reason}")


@router.get("/business-profile")
def get_business_profile(
    response: Response,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).first()
    response.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=300"
    if not row:
        return {
            "tenant_id": tenant.id,
            "company_name": tenant.name,
            "voen": "",
            "phone": "",
            "address": "",
            "website": f"https://{tenant.domain}",
            "logo_url": "",
            "receipt_footer": "Bizi secdiyiniz ucun tesekkur edirik!",
        }
    return {
        "tenant_id": tenant.id,
        "company_name": row.company_name,
        "voen": "",
        "phone": row.phone or "",
        "address": row.address or "",
        "website": row.website or "",
        "logo_url": row.logo_url or "",
        "receipt_footer": row.receipt_footer or "",
    }


@router.get("/public-branding")
def get_public_branding(
    response: Response,
    tenant_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    resolved_tenant = tenant
    requested_tenant_id = str(tenant_id or "").strip()
    if requested_tenant_id:
        requested_tenant = (
            db.query(Tenant)
            .filter(Tenant.id == requested_tenant_id, Tenant.status == "active")
            .first()
        )
        if requested_tenant:
            resolved_tenant = requested_tenant

    row = db.query(BusinessProfile).filter(BusinessProfile.tenant_id == resolved_tenant.id).first()
    feedback_settings = _setting_value(db, resolved_tenant.id, "feedback_settings", DEFAULT_FEEDBACK_SETTINGS)
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    if not isinstance(feedback_settings, dict):
        feedback_settings = DEFAULT_FEEDBACK_SETTINGS
    google_review_url = str(feedback_settings.get("google_review_url") or "").strip()
    if not row:
      return {
          "tenant_id": resolved_tenant.id,
          "company_name": resolved_tenant.name,
          "website": f"https://{resolved_tenant.domain}",
          "logo_url": "",
          "receipt_footer": "Bizi secdiyiniz ucun tesekkur edirik!",
          "google_review_url": google_review_url,
      }
    return {
        "tenant_id": resolved_tenant.id,
        "company_name": row.company_name,
        "website": row.website or f"https://{resolved_tenant.domain}",
        "logo_url": row.logo_url or "",
        "receipt_footer": row.receipt_footer or "",
        "google_review_url": google_review_url,
    }


@router.get("/customer-app/bootstrap")
def get_customer_app_bootstrap(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    branding = db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).first()
    app_settings = _setting_value(
        db,
        tenant.id,
        "customer_app_settings",
        {
            "enabled": True,
            "app_name": "Loyalty Club",
            "consent_text": "Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.",
            "join_customer_type": "golden",
            "join_discount_percent": 5,
            "background_color": "#0b1220",
            "primary_color": "#facc15",
            "accent_color": "#22d3ee",
            "hero_title": "Xoş gəldiniz",
            "hero_subtitle": "QR-ni skan et və reward dünyasına qoşul.",
        },
    )
    return {
        "tenant_id": tenant.id,
        "enabled": bool(app_settings.get("enabled", True)),
        "branding": {
            "company_name": branding.company_name if branding else tenant.name,
            "website": (branding.website if branding else f"https://{tenant.domain}") or f"https://{tenant.domain}",
            "logo_url": (branding.logo_url if branding else "") or "",
            "app_name": str(app_settings.get("app_name") or "Loyalty Club"),
            "hero_title": str(app_settings.get("hero_title") or "Xoş gəldiniz"),
            "hero_subtitle": str(app_settings.get("hero_subtitle") or "QR-ni skan et və reward dünyasına qoşul."),
            "background_color": str(app_settings.get("background_color") or "#0b1220"),
            "primary_color": str(app_settings.get("primary_color") or "#facc15"),
            "accent_color": str(app_settings.get("accent_color") or "#22d3ee"),
        },
        "consent_text": str(app_settings.get("consent_text") or "Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam."),
        "join_customer_type": str(app_settings.get("join_customer_type") or "golden"),
        "join_discount_percent": float(app_settings.get("join_discount_percent") or 5),
    }


@router.get("/public-menu-bootstrap")
def get_public_menu_bootstrap(
    response: Response,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    branding = db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).first()
    qr_menu_settings = _setting_value(
        db,
        tenant.id,
        "qr_menu_settings",
        {
            "enabled": True,
            "hero_title": "QR Menu",
            "hero_subtitle": "Telefonunuzdan menyuya baxın",
            "show_prices": True,
            "show_images": True,
            "show_descriptions": True,
            "poster_title": "Menyuya baxmaq üçün skan et",
            "poster_subtitle": "Telefon kameranızı QR üzərinə yönəldin",
            "background_color": "#efe2c1",
            "surface_color": "#fff7e8",
            "text_color": "#2b1708",
            "hero_image_url": "",
            "poster_image_url": "",
            "poster_background_color": "#d59b2d",
            "logo_shape": "rounded",
        },
    )
    app_settings = _setting_value(
        db,
        tenant.id,
        "customer_app_settings",
        {
            "background_color": "#0b1220",
            "primary_color": "#facc15",
            "accent_color": "#22d3ee",
        },
    )
    return {
        "tenant_id": tenant.id,
        "enabled": bool(qr_menu_settings.get("enabled", True)),
        "branding": {
            "company_name": branding.company_name if branding else tenant.name,
            "logo_url": (branding.logo_url if branding else "") or "",
            "hero_title": str(qr_menu_settings.get("hero_title") or "QR Menu"),
            "hero_subtitle": str(qr_menu_settings.get("hero_subtitle") or "Telefonunuzdan menyuya baxın"),
            "poster_title": str(qr_menu_settings.get("poster_title") or "Menyuya baxmaq üçün skan et"),
            "poster_subtitle": str(qr_menu_settings.get("poster_subtitle") or "Telefon kameranızı QR üzərinə yönəldin"),
            "background_color": str(qr_menu_settings.get("background_color") or "#efe2c1"),
            "surface_color": str(qr_menu_settings.get("surface_color") or "#fff7e8"),
            "text_color": str(qr_menu_settings.get("text_color") or "#2b1708"),
            "hero_image_url": str(qr_menu_settings.get("hero_image_url") or ""),
            "poster_image_url": str(qr_menu_settings.get("poster_image_url") or ""),
            "poster_background_color": str(qr_menu_settings.get("poster_background_color") or "#d59b2d"),
            "logo_shape": str(qr_menu_settings.get("logo_shape") or "rounded"),
            "primary_color": str(app_settings.get("primary_color") or "#facc15"),
            "accent_color": str(app_settings.get("accent_color") or "#22d3ee"),
        },
        "show_prices": bool(qr_menu_settings.get("show_prices", True)),
        "show_images": bool(qr_menu_settings.get("show_images", True)),
        "show_descriptions": bool(qr_menu_settings.get("show_descriptions", True)),
    }


@router.post("/customer-app/enroll")
def enroll_customer_app(
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    if app_settings.customer_consent_required and not bool(payload.get("consent_accepted", False)):
        raise HTTPException(status_code=400, detail="Consent must be accepted")

    app_settings = _setting_value(db, tenant.id, "customer_app_settings", {"enabled": True})
    if not bool(app_settings.get("enabled", True)):
        raise HTTPException(status_code=403, detail="Customer app is disabled for this tenant")

    card_id = f"QR-{secrets.token_hex(4).upper()}"
    while db.query(Customer).filter(Customer.tenant_id == tenant.id, Customer.card_id == card_id).first():
        card_id = f"QR-{secrets.token_hex(4).upper()}"
    secret_token = secrets.token_urlsafe(18)
    join_type = _clean_customer_type(payload.get("join_customer_type") or app_settings.get("join_customer_type") or "golden")
    customer = Customer(
        tenant_id=tenant.id,
        card_id=card_id,
        type=join_type,
        stars=0,
        discount_percent=Decimal(str(payload.get("join_discount_percent") or app_settings.get("join_discount_percent") or 0)),
        secret_token=secret_token,
    )
    db.add(customer)
    db.add(
        CustomerConsent(
            tenant_id=tenant.id,
            card_id=card_id,
            consent_type="customer_app",
            accepted=True,
            source="qr_customer_app",
            ip_address=_request_ip(request),
            user_agent=str(request.headers.get("user-agent") or "")[:255],
            accepted_at=datetime.utcnow(),
        )
    )
    db.add(
        Notification(
            tenant_id=tenant.id,
            card_id=card_id,
            message="Loyalty club hesabınız yaradıldı. QR kartınızı kassada göstərə bilərsiniz.",
            is_read=False,
        )
    )
    db.commit()
    return {"success": True, "card_id": card_id, "token": secret_token}


@router.get("/customer-app/session")
def get_customer_app_session(
    id: str = Query(...),
    t: str = Query(...),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    customer = _resolve_customer_session(db, tenant.id, id, t)
    branding = db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).first()
    sales = (
        db.query(Sale)
        .filter(Sale.tenant_id == tenant.id, Sale.customer_card_id == customer.card_id)
        .order_by(Sale.created_at.desc())
        .limit(20)
        .all()
    )
    notifications = (
        db.query(Notification)
        .filter(Notification.tenant_id == tenant.id, Notification.card_id == customer.card_id)
        .order_by(Notification.created_at.desc())
        .limit(20)
        .all()
    )
    active_campaigns = (
        db.query(HappyHour)
        .filter(HappyHour.tenant_id == tenant.id, HappyHour.is_active == True)
        .order_by(HappyHour.created_at.desc())
        .limit(12)
        .all()
    )
    app_settings = _setting_value(
        db,
        tenant.id,
        "customer_app_settings",
        {
            "enabled": True,
            "program_mode": "points",
            "layout_preset": "rewards",
            "consent_text": "Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.",
            "app_name": "Loyalty Club",
            "hero_title": "Xoş gəldiniz",
            "hero_subtitle": "Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.",
            "hero_image_url": "",
            "background_image_url": "",
            "background_color": "#0b1220",
            "points_label": "Ulduz",
            "reward_name": "Reward",
            "reward_threshold": 10,
            "reward_description": "10 ulduza 1 pulsuz içki",
            "reward_card_style": "rounded",
            "cashback_percent": 5,
            "primary_color": "#facc15",
            "accent_color": "#22d3ee",
            "show_qr_card": True,
            "show_wallet": True,
            "ai_barista_enabled": False,
            "ai_falci_enabled": False,
            "show_campaigns": True,
            "show_history": True,
            "show_notifications": True,
        },
    )
    if not bool(app_settings.get("enabled", True)):
        raise HTTPException(status_code=403, detail="Customer app is disabled for this tenant")
    pending_claims = (
        db.query(RewardClaim)
        .filter(RewardClaim.tenant_id == tenant.id, RewardClaim.card_id == customer.card_id, RewardClaim.status == "PENDING")
        .order_by(RewardClaim.created_at.desc())
        .all()
    )

    stars = int(customer.stars or 0)
    next_reward_at = max(1, int(app_settings.get("reward_threshold") or 10))
    program_mode = str(app_settings.get("program_mode") or "points").strip().lower()
    cashback_percent = Decimal(str(app_settings.get("cashback_percent") or 0))
    cashback_earned = Decimal("0.00")
    if program_mode == "cashback":
        ledger_rows = (
            db.query(LoyaltyLedgerEntry)
            .filter(LoyaltyLedgerEntry.tenant_id == tenant.id, LoyaltyLedgerEntry.card_id == customer.card_id, LoyaltyLedgerEntry.unit == "cashback")
            .all()
        )
        cashback_earned = sum((Decimal(str(row.amount or 0)) for row in ledger_rows), Decimal("0.00"))
        if cashback_earned == Decimal("0.00"):
            for row in sales:
                cashback_earned += (Decimal(str(row.total or 0)) * (cashback_percent / Decimal("100"))).quantize(Decimal("0.01"))
    redeemed_reserved = Decimal(str(len(pending_claims) * next_reward_at))
    balance_value = Decimal(str(stars))
    if program_mode == "cashback":
        balance_value = max(Decimal("0.00"), cashback_earned - redeemed_reserved)
    progress_current = int(balance_value % Decimal(str(next_reward_at))) if program_mode == "cashback" else stars % next_reward_at
    progress_remaining = 0 if progress_current == 0 and balance_value > 0 else next_reward_at - progress_current
    available_rewards = max(0, int(balance_value // Decimal(str(next_reward_at))) if program_mode == "cashback" else (stars // next_reward_at) - len(pending_claims))

    return {
        "tenant_id": tenant.id,
        "branding": {
            "company_name": branding.company_name if branding else tenant.name,
            "website": (branding.website if branding else f"https://{tenant.domain}") or f"https://{tenant.domain}",
            "logo_url": (branding.logo_url if branding else "") or "",
            "receipt_footer": (branding.receipt_footer if branding else "") or "",
            "app_name": str(app_settings.get("app_name") or "Loyalty Club"),
            "hero_title": str(app_settings.get("hero_title") or "Xoş gəldiniz"),
            "hero_subtitle": str(app_settings.get("hero_subtitle") or ""),
            "hero_image_url": str(app_settings.get("hero_image_url") or ""),
            "background_image_url": str(app_settings.get("background_image_url") or ""),
            "background_color": str(app_settings.get("background_color") or "#0b1220"),
            "primary_color": str(app_settings.get("primary_color") or "#facc15"),
            "accent_color": str(app_settings.get("accent_color") or "#22d3ee"),
            "reward_card_style": str(app_settings.get("reward_card_style") or "rounded"),
            "show_qr_card": bool(app_settings.get("show_qr_card", True)),
            "show_wallet": bool(app_settings.get("show_wallet", True)),
            "ai_barista_enabled": bool(app_settings.get("ai_barista_enabled", False)),
            "ai_falci_enabled": bool(app_settings.get("ai_falci_enabled", False)),
        },
        "customer": {
            "card_id": customer.card_id,
            "type": customer.type,
            "stars": stars,
            "discount_percent": str(customer.discount_percent or 0),
            "created_at": customer.created_at.isoformat() if customer.created_at else None,
        },
        "wallet": {
            "points_label": str(app_settings.get("points_label") or ("Cashback" if program_mode == "cashback" else "Ulduz")),
            "stars_balance": float(balance_value) if program_mode == "cashback" else stars,
            "available_rewards": available_rewards,
            "next_reward_at": next_reward_at,
            "progress_current": progress_current,
            "progress_remaining": progress_remaining,
            "reward_label": str(app_settings.get("reward_description") or "10 ulduza 1 pulsuz içki"),
            "reward_name": str(app_settings.get("reward_name") or "Reward"),
            "program_mode": program_mode,
            "cashback_percent": float(cashback_percent),
            "rewards": [
                {
                    "id": "default-reward",
                    "title": str(app_settings.get("reward_name") or "Reward"),
                    "description": str(app_settings.get("reward_description") or "10 ulduza 1 pulsuz içki"),
                    "threshold": next_reward_at,
                    "available_count": available_rewards,
                }
            ],
        },
        "campaigns": [
            {
                "id": row.id,
                "name": row.name,
                "discount_percent": row.discount_percent,
                "start_time": row.start_time,
                "end_time": row.end_time,
                "categories": row.categories,
            }
            for row in active_campaigns
        ] if bool(app_settings.get("show_campaigns", True)) else [],
        "notifications": [
            {
                "id": row.id,
                "message": row.message,
                "is_read": bool(row.is_read),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in notifications
        ] if bool(app_settings.get("show_notifications", True)) else [],
        "history": [
            {
                "id": row.id,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "total": str(row.total),
                "payment_method": row.payment_method,
                "order_type": row.order_type,
                "discount_amount": str(row.discount_amount or 0),
                "status": row.status,
                "items": _json_load(row.items_json, []),
            }
            for row in sales
        ] if bool(app_settings.get("show_history", True)) else [],
        "pending_claims": [
            {
                "id": row.id,
                "claim_code": row.claim_code,
                "reward_name": row.reward_name,
                "reward_description": row.reward_description or "",
                "points_cost": row.points_cost,
                "status": row.status,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in pending_claims
        ],
        "customer_app_settings": app_settings,
    }


@router.post("/customer-app/rewards/claim")
def claim_customer_reward(
    payload: RewardClaimIn,
    id: str = Query(...),
    t: str = Query(...),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    customer = _resolve_customer_session(db, tenant.id, id, t)
    app_settings = _setting_value(
        db,
        tenant.id,
        "customer_app_settings",
        {"reward_threshold": 10, "reward_name": "Reward", "reward_description": "10 ulduza 1 pulsuz içki"},
    )
    threshold = max(1, int(app_settings.get("reward_threshold") or 10))
    pending_count = (
        db.query(RewardClaim)
        .filter(RewardClaim.tenant_id == tenant.id, RewardClaim.card_id == customer.card_id, RewardClaim.status == "PENDING")
        .count()
    )
    available_rewards = max(0, (int(customer.stars or 0) // threshold) - int(pending_count or 0))
    if available_rewards <= 0:
        raise HTTPException(status_code=400, detail="No reward available to claim")

    claim_code = f"RW{secrets.token_hex(3).upper()}"
    while db.query(RewardClaim).filter(RewardClaim.claim_code == claim_code).first():
        claim_code = f"RW{secrets.token_hex(3).upper()}"

    claim = RewardClaim(
        tenant_id=tenant.id,
        card_id=customer.card_id,
        claim_code=claim_code,
        reward_name=str(app_settings.get("reward_name") or "Reward"),
        reward_description=str(app_settings.get("reward_description") or "10 ulduza 1 pulsuz içki"),
        points_cost=threshold,
        status="PENDING",
    )
    db.add(claim)
    db.add(
        Notification(
            tenant_id=tenant.id,
            card_id=customer.card_id,
            message=f"Reward claim code hazırdır: {claim_code}",
            is_read=False,
        )
    )
    db.commit()
    return {
        "success": True,
        "claim_code": claim_code,
        "reward_name": claim.reward_name,
        "points_cost": claim.points_cost,
        "available_rewards": max(0, available_rewards - 1),
    }


@router.post("/customer-app/notifications/{notification_id}/read")
def mark_customer_notification_read(
    notification_id: str,
    id: str = Query(...),
    t: str = Query(...),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    customer = _resolve_customer_session(db, tenant.id, id, t)
    row = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.tenant_id == tenant.id, Notification.card_id == customer.card_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    row.is_read = True
    db.commit()
    return {"success": True}


@router.put("/business-profile")
def put_business_profile(
    payload: BusinessProfileIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    row = db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).first()
    if not row:
        row = BusinessProfile(
            tenant_id=tenant.id,
            company_name=payload.company_name.strip(),
            phone=payload.phone or None,
            address=payload.address or None,
            website=payload.website or None,
            logo_url=_normalize_image_url(payload.logo_url) or None,
            receipt_footer=payload.receipt_footer or None,
        )
        db.add(row)
    else:
        row.company_name = payload.company_name.strip()
        row.phone = payload.phone or None
        row.address = payload.address or None
        row.website = payload.website or None
        row.logo_url = _normalize_image_url(payload.logo_url) or None
        row.receipt_footer = payload.receipt_footer or None
    db.commit()
    return {"success": True}


@router.get("/tables")
def list_tables(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = db.query(Table).filter(Table.tenant_id == tenant.id).order_by(Table.label.asc()).all()
    kitchen_rows = (
        db.query(KitchenOrder)
        .filter(KitchenOrder.tenant_id == tenant.id, KitchenOrder.status.in_(["NEW", "PREPARING", "READY"]))
        .order_by(KitchenOrder.created_at.desc())
        .all()
    )
    status_by_table: dict[str, str] = {}
    for kitchen_row in kitchen_rows:
        label = str(kitchen_row.table_label or "").strip()
        if not label or label in status_by_table:
            continue
        status_by_table[label] = str(kitchen_row.status or "NEW")
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "label": row.label,
            "floor_plan_id": row.floor_plan_id,
            "pos_x": row.pos_x,
            "pos_y": row.pos_y,
            "is_occupied": bool(row.is_occupied),
            "assigned_to": row.assigned_to,
            "guest_count": int(row.guest_count or 0),
            "deposit_guest_count": int(row.deposit_guest_count or 0),
            "deposit_amount": str(row.deposit_amount or 0),
            "deposit_seat_labels": _json_load(row.deposit_seats_json, []),
            "total": str(row.total),
            "items": _json_load(row.items_json, []),
            "kitchen_status": status_by_table.get(row.label),
        }
        for row in rows
    ]


@router.post("/tables")
def create_table(
    payload: TableCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    label = str(payload.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Table label is required")
    exists = db.query(Table).filter(Table.tenant_id == tenant.id, func.lower(Table.label) == label.lower()).first()
    if exists:
        raise HTTPException(status_code=409, detail="Table already exists")
    floor = (
        db.query(FloorPlan)
        .filter(FloorPlan.tenant_id == tenant.id)
        .order_by(FloorPlan.is_active.desc(), FloorPlan.created_at.asc())
        .first()
    )
    if not floor:
        floor = FloorPlan(
            tenant_id=tenant.id,
            name="Main Floor",
            width_units=12,
            height_units=8,
            is_active=True,
        )
        db.add(floor)
        db.flush()

    max_cols = max(6, int(floor.width_units or 12))
    slot_width = 3
    slot_height = 3
    existing_count = (
        db.query(Table)
        .filter(Table.tenant_id == tenant.id, Table.floor_plan_id == floor.id)
        .count()
    )
    per_row = max(1, max_cols // slot_width)
    pos_x = (existing_count % per_row) * slot_width
    pos_y = (existing_count // per_row) * slot_height
    row = Table(
        tenant_id=tenant.id,
        floor_plan_id=floor.id,
        label=label,
        shape="rectangle",
        pos_x=pos_x,
        pos_y=pos_y,
        width_units=2,
        height_units=2,
        capacity=4,
        status="AVAILABLE",
        is_occupied=False,
        assigned_to=None,
        guest_count=0,
        deposit_guest_count=0,
        deposit_amount=Decimal("0.00"),
        deposit_seats_json="[]",
        total=Decimal("0.00"),
        items_json="[]",
    )
    db.add(row)
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="TABLE_CREATED",
            details=json.dumps(
                {
                    "table_id": row.id,
                    "label": label,
                    "floor_plan_id": floor.id,
                    "x": pos_x,
                    "y": pos_y,
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
        "label": row.label,
        "floor_plan_id": row.floor_plan_id,
        "pos_x": row.pos_x,
        "pos_y": row.pos_y,
        "is_occupied": False,
        "assigned_to": None,
        "guest_count": 0,
        "deposit_guest_count": 0,
        "deposit_amount": "0",
        "deposit_seat_labels": [],
        "total": "0",
        "items": [],
    }


@router.post("/tables/{table_id}/open")
def open_table(
    table_id: str,
    payload: TableOpenIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Table not found")
    if row.is_occupied and row.assigned_to and row.assigned_to != user.username:
        raise HTTPException(status_code=403, detail=f"Bu masa {row.assigned_to} üçün aktivdir")
    if row.is_occupied and (len(_json_load(row.items_json, [])) > 0 or Decimal(str(row.deposit_amount or 0)) > 0):
        raise HTTPException(status_code=400, detail="Table is already open")
    table_service = _setting_value(db, tenant.id, "table_service_settings", {"deposit_per_guest_azn": 0, "reservation_lock_hours": 2})
    reservation_lock_hours = max(0, float(table_service.get("reservation_lock_hours") or 2))
    now = _restaurant_now()
    lock_until = now + timedelta(hours=reservation_lock_hours)
    locked_reservation = (
        db.query(Reservation)
        .filter(
            Reservation.tenant_id == tenant.id,
            Reservation.assigned_table_id == row.id,
            Reservation.status == "BOOKED",
            Reservation.reservation_at >= now,
            Reservation.reservation_at <= lock_until,
        )
        .order_by(Reservation.reservation_at.asc())
        .first()
    )
    if locked_reservation:
        raise HTTPException(status_code=403, detail=f"Bu masa rezervdədir və {locked_reservation.reservation_at.strftime('%H:%M')} üçün bağlıdır")

    guest_count = max(1, int(payload.guest_count or 0))
    deposit_labels_raw = [str(label or "").strip() for label in (payload.deposit_seat_labels or []) if str(label or "").strip()]
    deposit_labels = [label for label in deposit_labels_raw if label.startswith("Adam-")]
    if not deposit_labels:
        deposit_guest_count = max(0, min(guest_count, int(payload.deposit_guest_count or 0)))
        deposit_labels = [f"Adam-{idx + 1}" for idx in range(deposit_guest_count)]
    else:
        deposit_labels = deposit_labels[:guest_count]
        deposit_guest_count = len(deposit_labels)
    deposit_per_guest = Decimal(str(table_service.get("deposit_per_guest_azn") or 0)).quantize(Decimal("0.01"))
    deposit_amount = (deposit_per_guest * Decimal(deposit_guest_count)).quantize(Decimal("0.01"))

    row.is_occupied = True
    row.assigned_to = user.username
    row.locked_by = user.username
    row.locked_at = datetime.utcnow()
    row.guest_count = guest_count
    row.deposit_guest_count = deposit_guest_count
    row.deposit_amount = deposit_amount
    row.deposit_seats_json = json.dumps(deposit_labels, ensure_ascii=False)
    row.items_json = row.items_json or "[]"
    row.total = Decimal(str(row.total or 0)).quantize(Decimal("0.01"))

    if deposit_amount > 0:
        _post_deposit_hold(
            db,
            tenant_id=tenant.id,
            amount=deposit_amount,
            destination_code="cash",
            created_by=user.username,
            note=f"{row.label} üçün depozit ({deposit_guest_count} nəfər)",
            related_table_id=row.id,
        )
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="TABLE_OPENED",
            details=json.dumps(
                {
                    "table_id": row.id,
                    "table_label": row.label,
                    "guest_count": guest_count,
                    "deposit_guest_count": deposit_guest_count,
                    "deposit_amount": str(deposit_amount),
                    "deposit_seat_labels": deposit_labels,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {
        "success": True,
        "guest_count": guest_count,
        "deposit_guest_count": deposit_guest_count,
        "deposit_amount": str(deposit_amount),
        "deposit_seat_labels": deposit_labels,
    }


@router.delete("/tables/{table_id}")
def delete_table(
    table_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    row = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Table not found")
    if row.is_occupied:
        raise HTTPException(status_code=400, detail="Occupied table cannot be deleted")
    db.delete(row)
    db.commit()
    return {"success": True}


@router.post("/tables/{table_id}/send-to-kitchen")
def send_to_kitchen(
    table_id: str,
    payload: TableItemsIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Table not found")
    if not payload.cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")
    if row.is_occupied and row.assigned_to and row.assigned_to != user.username:
        raise HTTPException(status_code=403, detail=f"Bu masa {row.assigned_to} üçün aktivdir")

    active_orders = (
        db.query(KitchenOrder)
        .filter(KitchenOrder.tenant_id == tenant.id, KitchenOrder.table_label == row.label, KitchenOrder.status.in_(["NEW", "PREPARING", "READY"]))
        .all()
    )
    now = datetime.utcnow()
    fingerprint = _order_fingerprint(payload.cart_items)
    for active_order in active_orders:
        created_at = active_order.created_at or now
        if (now - created_at).total_seconds() > 45:
            continue
        if _order_fingerprint(_json_load(active_order.items_json, [])) == fingerprint:
            raise HTTPException(status_code=409, detail="Bu sifariş artıq mətbəxə göndərilib")

    existing = _json_load(row.items_json, [])
    # Mark all already-stored items as kitchen_sent so we can later distinguish them
    existing_marked = [dict(item, kitchen_sent=True) for item in existing]
    merged = list(existing_marked)
    # Incoming items are fresh (not yet sent) — they get kitchen_sent=True after this round
    incoming_with_flag = [dict(item, kitchen_sent=True) for item in payload.cart_items]
    for incoming in incoming_with_flag:
        idx = next(
            (
                i
                for i, item in enumerate(merged)
                if (
                    item.get("id") == incoming.get("id")
                    or (
                        item.get("item_name") == incoming.get("item_name")
                        and str(item.get("seat_label") or "") == str(incoming.get("seat_label") or "")
                    )
                )
            ),
            -1,
        )
        if idx >= 0:
            merged[idx]["qty"] = int(merged[idx].get("qty", 0)) + int(incoming.get("qty", 0))
        else:
            merged.append(incoming)

    total = Decimal(str(row.total or 0))
    for incoming in payload.cart_items:
        total += Decimal(str(incoming.get("price") or 0)) * int(incoming.get("qty") or 0)

    row.is_occupied = True
    if not row.assigned_to:
        row.assigned_to = user.username
    row.items_json = json.dumps(merged, ensure_ascii=False)
    row.total = total.quantize(Decimal("0.01"))
    order = KitchenOrder(
        tenant_id=tenant.id,
        sale_id=None,
        table_label=row.label,
        order_type="Dine In",
        status="NEW",
        priority="NORMAL",
        items_json=json.dumps(payload.cart_items, ensure_ascii=False),
    )
    db.add(order)
    _notify_front_of_house(
        db,
        tenant.id,
        "Yeni Masa Sifarişi",
        f"{row.label} üçün sifariş mətbəxə göndərildi: {_summarize_items(payload.cart_items)}",
        {"table_label": row.label, "status": "NEW", "kitchen_order_id": order.id},
    )
    db.commit()
    return {"success": True, "kitchen_order_id": order.id}


@router.patch("/tables/{table_id}/items")
def revise_table_items(
    table_id: str,
    payload: TableRevisionIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Table not found")

    old_items = _json_load(row.items_json, [])
    next_items_raw = []
    for item in payload.items:
        qty = int(item.get("qty") or 0)
        if qty <= 0:
            continue
        next_items_raw.append(item)

    # Classify which removed items were already sent to the kitchen
    # kitchen_sent flag is set when send_to_kitchen is called
    removed_draft: list[dict] = []     # Not sent to kitchen — free to remove
    removed_sent: list[dict] = []      # Already sent — requires manager override

    for old in old_items:
        old_name = str(old.get("item_name") or "").strip()
        old_seat = str(old.get("seat_label") or "").strip()
        old_qty = int(old.get("qty") or 0)
        was_sent = bool(old.get("kitchen_sent", False))
        matching = next(
            (
                item
                for item in next_items_raw
                if str(item.get("item_name") or "").strip() == old_name
                and str(item.get("seat_label") or "").strip() == old_seat
            ),
            None,
        )
        next_qty = int(matching.get("qty") or 0) if matching else 0
        removed_qty = old_qty - next_qty
        if removed_qty > 0:
            entry = {
                "id": old.get("id"),
                "item_name": old_name,
                "price": str(old.get("price") or "0"),
                "qty": removed_qty,
                "is_coffee": bool(old.get("is_coffee")),
                "category": str(old.get("category") or ""),
                "seat_label": old_seat,
            }
            if was_sent:
                removed_sent.append(entry)
            else:
                removed_draft.append(entry)

    all_removed = removed_draft + removed_sent
    if not all_removed:
        raise HTTPException(status_code=400, detail="No removable item changes detected")

    # If any kitchen-sent item needs to be removed, manager override is mandatory
    override_user = None
    reason = str(payload.reason or "").strip()
    if removed_sent:
        override_password = str(payload.override_password or "").strip()
        if not override_password:
            raise HTTPException(
                status_code=400,
                detail="Manager/Admin password required to remove kitchen-sent items",
            )
        if len(reason) < 3:
            raise HTTPException(status_code=400, detail="Reason is required for kitchen-sent item removal")
        candidates = (
            db.query(User)
            .filter(User.tenant_id == tenant.id, User.is_active == True)
            .all()
        )
        for candidate in candidates:
            if str(candidate.role or "").lower() not in {"admin", "manager", "super_admin"}:
                continue
            if candidate.password_hash and verify_password(override_password, candidate.password_hash):
                override_user = candidate
                break
        if not override_user:
            raise HTTPException(status_code=403, detail="Manager/Admin override failed")

    now_iso = datetime.utcnow().isoformat()
    override_username = override_user.username if override_user else user.username

    # Build annotated removed list for kitchen notification
    removed_annotated = [
        {
            **item,
            "action": "CANCEL",
            "reason": reason or "Draft silindi",
            "updated_by": override_username,
            "updated_at": now_iso,
        }
        for item in all_removed
    ]

    # Build next_items preserving kitchen_sent flag and seat_label from old_items
    old_map = {}
    for old in old_items:
        key = (str(old.get("item_name") or "").strip(), str(old.get("seat_label") or "").strip())
        old_map[key] = old

    next_items = []
    for item in next_items_raw:
        qty = int(item.get("qty") or 0)
        if qty <= 0:
            continue
        key = (str(item.get("item_name") or "").strip(), str(item.get("seat_label") or "").strip())
        old_ref = old_map.get(key, {})
        next_items.append({
            "id": item.get("id") or old_ref.get("id"),
            "item_name": str(item.get("item_name") or "").strip(),
            "price": str(item.get("price") or old_ref.get("price") or "0"),
            "qty": qty,
            "seat_label": str(item.get("seat_label") or old_ref.get("seat_label") or ""),
            "is_coffee": bool(item.get("is_coffee") or old_ref.get("is_coffee")),
            "category": str(item.get("category") or old_ref.get("category") or ""),
            "kitchen_sent": bool(old_ref.get("kitchen_sent", False)),
        })

    next_total = sum(
        Decimal(str(item.get("price") or 0)) * Decimal(str(item.get("qty") or 0))
        for item in next_items
    )

    row.items_json = json.dumps(next_items, ensure_ascii=False)
    row.total = next_total.quantize(Decimal("0.01"))
    still_open = len(next_items) > 0 or Decimal(str(row.deposit_amount or 0)) > 0 or int(row.guest_count or 0) > 0
    row.is_occupied = still_open
    row.assigned_to = row.assigned_to if still_open else None

    # Notify kitchen only if sent items were removed
    if removed_sent:
        active_order = (
            db.query(KitchenOrder)
            .filter(
                KitchenOrder.tenant_id == tenant.id,
                KitchenOrder.table_label == row.label,
                KitchenOrder.status.in_(["NEW", "PREPARING", "READY"]),
            )
            .order_by(KitchenOrder.created_at.desc())
            .first()
        )
        if active_order:
            active_items = _json_load(active_order.items_json, [])
            cancel_entries = [
                {
                    **item,
                    "action": "CANCEL",
                    "reason": reason,
                    "updated_by": override_username,
                    "updated_at": now_iso,
                }
                for item in removed_sent
            ]
            active_order.items_json = json.dumps([*active_items, *cancel_entries], ensure_ascii=False)
            active_order.priority = "URGENT"

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="TABLE_ITEM_REVISED",
            details=json.dumps(
                {
                    "table_id": row.id,
                    "table_label": row.label,
                    "reason": reason or "Draft silindi",
                    "removed_draft": removed_draft,
                    "removed_sent": removed_sent,
                    "override_by": override_username,
                },
                ensure_ascii=False,
            ),
        )
    )

    if removed_sent:
        _notify_front_of_house(
            db,
            tenant.id,
            "Masa Sifarişi Dəyişdirildi",
            f"{row.label} üçün sifariş düzəlişi edildi: {reason}",
            {
                "table_label": row.label,
                "status": "REVISION",
                "removed_items": _summarize_items(removed_sent),
                "override_by": override_username,
            },
        )

    db.commit()
    return {
        "success": True,
        "table_total": str(row.total),
        "override_by": override_username,
        "removed_draft_count": len(removed_draft),
        "removed_sent_count": len(removed_sent),
    }


@router.post("/tables/{table_id}/abort")
def abort_table(
    table_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    """Close a table that was opened by mistake. Only allowed if no items have been sent to the kitchen."""
    row = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Table not found")
    if not row.is_occupied:
        raise HTTPException(status_code=400, detail="Masa artıq bağlıdır")

    role = str(user.role or "").lower()
    if row.assigned_to and row.assigned_to != user.username and role not in {"admin", "manager", "super_admin"}:
        raise HTTPException(status_code=403, detail=f"Bu masa {row.assigned_to} üçün aktivdir")

    # Check for kitchen-sent items — cannot abort if kitchen already received order
    items = _json_load(row.items_json, [])
    has_sent_items = any(bool(item.get("kitchen_sent", False)) for item in items)
    if has_sent_items:
        raise HTTPException(
            status_code=400,
            detail="Mətbəxə göndərilmiş sifariş var. Masanı ləğv etmək üçün menecer şifrəsi ilə items revision istifadə edin.",
        )

    # No items sent to kitchen: safe to abort
    # Reverse any deposit hold if present
    deposit_amount = Decimal(str(row.deposit_amount or 0))
    if deposit_amount > 0:
        _post_deposit_refund(
            db,
            tenant_id=tenant.id,
            amount=deposit_amount,
            source_code="cash",
            created_by=user.username,
            note=f"{row.label} - masa ləğv edildi (depozit geri qaytarıldı)",
            related_table_id=row.id,
        )

    row.is_occupied = False
    row.assigned_to = None
    row.locked_by = None
    row.locked_at = None
    row.guest_count = 0
    row.deposit_guest_count = 0
    row.deposit_amount = Decimal("0.00")
    row.deposit_seats_json = "[]"
    row.items_json = "[]"
    row.total = Decimal("0.00")

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="TABLE_ABORTED",
            details=json.dumps(
                {"table_id": row.id, "table_label": row.label},
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {"success": True, "table_id": table_id}


@router.post("/tables/{table_id}/seats/reassign")
def reassign_table_seat(
    table_id: str,
    payload: TableSeatReassignIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Table not found")

    role = str(user.role or "").lower()
    if row.assigned_to and row.assigned_to != user.username and role not in {"admin", "manager", "super_admin"}:
        raise HTTPException(status_code=403, detail="This table belongs to another waiter")

    from_seat = str(payload.from_seat or "").strip()
    to_seat = str(payload.to_seat or "").strip()
    mode = str(payload.mode or "item").strip().lower()
    item_name = str(payload.item_name or "").strip()
    if not from_seat or not to_seat or from_seat == to_seat:
        raise HTTPException(status_code=400, detail="Valid source and target seats are required")
    if mode not in {"item", "seat"}:
        raise HTTPException(status_code=400, detail="Unsupported seat reassignment mode")
    if mode == "item" and not item_name:
        raise HTTPException(status_code=400, detail="Item name is required")

    items = _json_load(row.items_json, [])
    changed = False
    reassigned_count = 0
    next_items: list[dict] = []
    for item in items:
        current_seat = str(item.get("seat_label") or "").strip()
        current_name = str(item.get("item_name") or "").strip()
        should_move = current_seat == from_seat and (mode == "seat" or current_name == item_name)
        if should_move:
            updated = dict(item)
            updated["seat_label"] = to_seat
            next_items.append(updated)
            changed = True
            reassigned_count += int(item.get("qty") or 0)
        else:
            next_items.append(dict(item))

    if not changed:
        raise HTTPException(status_code=400, detail="No matching seat items found")

    next_items = _merge_same_seat_duplicates(next_items)
    row.items_json = json.dumps(next_items, ensure_ascii=False)

    deposit_seats = [str(label or "").strip() for label in _json_load(row.deposit_seats_json, []) if str(label or "").strip()]
    if from_seat in deposit_seats:
        remaining = [label for label in deposit_seats if label != from_seat]
        if to_seat not in remaining:
            remaining.append(to_seat)
        row.deposit_seats_json = json.dumps(sorted(remaining, key=lambda x: int(str(x).split("-")[1] or 0)), ensure_ascii=False)
        row.deposit_guest_count = len(remaining)

    kitchen_rows = (
        db.query(KitchenOrder)
        .filter(
            KitchenOrder.tenant_id == tenant.id,
            KitchenOrder.table_label == row.label,
            KitchenOrder.status.in_(["NEW", "PREPARING", "READY"]),
        )
        .all()
    )
    for kitchen_row in kitchen_rows:
        kitchen_items = _json_load(kitchen_row.items_json, [])
        updated_kitchen_items: list[dict] = []
        for item in kitchen_items:
            current_seat = str(item.get("seat_label") or "").strip()
            current_name = str(item.get("item_name") or "").strip()
            should_move = current_seat == from_seat and (mode == "seat" or current_name == item_name)
            if should_move:
                revised = dict(item)
                revised["seat_label"] = to_seat
                updated_kitchen_items.append(revised)
            else:
                updated_kitchen_items.append(dict(item))
        kitchen_row.items_json = json.dumps(_merge_same_seat_duplicates(updated_kitchen_items), ensure_ascii=False)

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="TABLE_SEAT_REASSIGNED",
            details=json.dumps(
                {
                    "table_id": row.id,
                    "table_label": row.label,
                    "from_seat": from_seat,
                    "to_seat": to_seat,
                    "mode": mode,
                    "item_name": item_name if mode == "item" else None,
                    "reassigned_count": reassigned_count,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {"success": True, "reassigned_count": reassigned_count}


@router.post("/tables/{table_id}/pay")
def pay_table(
    table_id: str,
    payload: TablePayIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Table not found")
    if not row.is_occupied:
        raise HTTPException(status_code=400, detail="Table is not occupied")
    all_items = _json_load(row.items_json, [])
    deposit_amount = Decimal(str(row.deposit_amount or 0)).quantize(Decimal("0.01"))
    deposit_seat_labels = [str(label or "").strip() for label in _json_load(row.deposit_seats_json, []) if str(label or "").strip()]
    service_fee_percent = Decimal(str(_setting_value(db, tenant.id, "service_fee_percent", 0) or 0))
    pay_scope = str(payload.pay_scope or "full").lower()
    seat_label = str(payload.seat_label or "").strip()

    if pay_scope == "seat":
        if not seat_label:
            raise HTTPException(status_code=400, detail="Seat label is required")
        items = [item for item in all_items if str(item.get("seat_label") or "").strip() == seat_label]
        remaining_items = [item for item in all_items if str(item.get("seat_label") or "").strip() != seat_label]
        seat_deposit_amount = (
            Decimal(str(_setting_value(db, tenant.id, "table_service_settings", {"deposit_per_guest_azn": 0}).get("deposit_per_guest_azn") or 0)).quantize(Decimal("0.01"))
            if seat_label in deposit_seat_labels
            else Decimal("0.00")
        )
    else:
        items = all_items
        remaining_items = []
        seat_deposit_amount = deposit_amount

    items_total = sum((Decimal(str(item.get("price") or 0)) * Decimal(str(item.get("qty") or 0)) for item in items), Decimal("0.00")).quantize(Decimal("0.01"))
    if not items and seat_deposit_amount <= 0:
        raise HTTPException(status_code=400, detail="Table is empty")

    service_fee_amount = (items_total * service_fee_percent / Decimal("100")).quantize(Decimal("0.01"))
    total = max(items_total + service_fee_amount, seat_deposit_amount).quantize(Decimal("0.01"))
    extra_due = max(total - seat_deposit_amount, Decimal("0.00")).quantize(Decimal("0.01"))
    stock_ops, cogs_total = _collect_stock_ops(db, tenant.id, items)
    receipt_code = secrets.token_hex(5).upper()
    receipt_token = secrets.token_hex(10)
    sale = Sale(
        tenant_id=tenant.id,
        cashier=user.username,
        customer_card_id=None,
        payment_method=payload.payment_method,
        order_type="Dine In",
        receipt_code=receipt_code,
        receipt_token=receipt_token,
        total=total,
        discount_amount=Decimal("0.00"),
        cogs=cogs_total,
        items_json=json.dumps(items, ensure_ascii=False),
        status="COMPLETED",
        created_at=datetime.utcnow(),
    )
    db.add(sale)
    db.flush()

    for inventory, qty_required in stock_ops:
        inventory.stock_qty = (Decimal(str(inventory.stock_qty or 0)) - qty_required).quantize(Decimal("0.001"))
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
                        "source": "table_payment",
                        "table_id": row.id,
                        "table_label": row.label,
                    },
                    ensure_ascii=False,
                ),
            )
        )

    _post_sale_cogs(
        db,
        tenant_id=tenant.id,
        sale_id=sale.id,
        amount=Decimal(str(cogs_total or 0)).quantize(Decimal("0.01")),
        created_by=user.username,
        note=f"Table sale COGS {sale.id}",
        related_table_id=row.id,
    )

    payment_method = _normalize_payment_method(payload.payment_method)
    if payment_method == "split":
        split_cash = Decimal(str(payload.split_cash or 0)).quantize(Decimal("0.01"))
        split_card = Decimal(str(payload.split_card or 0)).quantize(Decimal("0.01"))
        if split_cash < 0 or split_card < 0:
            raise HTTPException(status_code=400, detail="Split amounts cannot be negative")
        if (split_cash + split_card - extra_due).copy_abs() > Decimal("0.01"):
            raise HTTPException(status_code=400, detail="Split amounts must equal additional due")
        if split_cash > 0:
            _post_sale_payment(
                db,
                tenant_id=tenant.id,
                sale_id=sale.id,
                amount=split_cash,
                payment_source="cash",
                created_by=user.username,
                category="Satış (Nağd)",
                note=f"Table payment {sale.id}",
                related_table_id=row.id,
            )
        if split_card > 0:
            _post_sale_payment(
                db,
                tenant_id=tenant.id,
                sale_id=sale.id,
                amount=split_card,
                payment_source="card",
                created_by=user.username,
                category="Satış (Kart)",
                note=f"Table payment {sale.id}",
                related_table_id=row.id,
            )
    else:
        source = "cash" if payment_method in {"nəğd", "cash", "staff"} else "card"
        category = "Satış (Nağd)" if source == "cash" else "Satış (Kart)"
        if extra_due > 0:
            _post_sale_payment(
                db,
                tenant_id=tenant.id,
                sale_id=sale.id,
                amount=extra_due,
                payment_source=source,
                created_by=user.username,
                category=category,
                note=f"Table payment {sale.id}",
                related_table_id=row.id,
            )

    if seat_deposit_amount > 0:
        _post_deposit_apply_to_bill(
            db,
            tenant_id=tenant.id,
            amount=seat_deposit_amount,
            created_by=user.username,
            note=f"Table payment {sale.id}",
            related_table_id=row.id,
            related_order_id=sale.id,
        )

    if pay_scope == "seat":
        remaining_guest_count = max(0, int(row.guest_count or 0) - 1)
        remaining_deposit_labels = [label for label in deposit_seat_labels if label != seat_label]
        remaining_deposit_amount = (deposit_amount - seat_deposit_amount).quantize(Decimal("0.01"))
        remaining_total = sum((Decimal(str(item.get("price") or 0)) * Decimal(str(item.get("qty") or 0)) for item in remaining_items), Decimal("0.00")).quantize(Decimal("0.01"))
        row.guest_count = remaining_guest_count
        row.deposit_guest_count = len(remaining_deposit_labels)
        row.deposit_amount = max(remaining_deposit_amount, Decimal("0.00")).quantize(Decimal("0.01"))
        row.deposit_seats_json = json.dumps(remaining_deposit_labels, ensure_ascii=False)
        row.items_json = json.dumps(remaining_items, ensure_ascii=False)
        row.total = remaining_total
        row.is_occupied = remaining_guest_count > 0 or len(remaining_items) > 0 or row.deposit_amount > 0
        if not row.is_occupied:
            row.assigned_to = None
    else:
        done_time = datetime.utcnow()
        kitchen_rows = (
            db.query(KitchenOrder)
            .filter(KitchenOrder.tenant_id == tenant.id, KitchenOrder.table_label == row.label, KitchenOrder.status.in_(["NEW", "PREPARING", "READY"]))
            .all()
        )
        for kitchen_row in kitchen_rows:
            kitchen_row.status = "DONE"
            kitchen_row.completed_at = done_time

        row.is_occupied = False
        row.assigned_to = None
        row.guest_count = 0
        row.deposit_guest_count = 0
        row.deposit_amount = Decimal("0.00")
        row.deposit_seats_json = "[]"
        row.items_json = "[]"
        row.total = Decimal("0.00")
    db.commit()
    return {
        "success": True,
        "sale_id": sale.id,
        "receipt_code": receipt_code,
        "receipt_token": receipt_token,
        "items_total": str(items_total),
        "service_fee_amount": str(service_fee_amount),
        "deposit_amount": str(seat_deposit_amount),
        "extra_due": str(extra_due),
        "final_total": str(total),
    }


@router.post("/tables/{table_id}/transfer")
def transfer_table(
    table_id: str,
    payload: TableTargetIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    if str(user.role or "").lower() == "kitchen":
        raise HTTPException(status_code=403, detail="Floor access required")
    source = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    target = db.query(Table).filter(Table.id == payload.target_table_id, Table.tenant_id == tenant.id).first()
    if not source or not target:
        raise HTTPException(status_code=404, detail="Table not found")
    if source.id == target.id:
        raise HTTPException(status_code=400, detail="Choose a different table")
    if not source.is_occupied:
        raise HTTPException(status_code=400, detail="Source table is empty")
    if target.is_occupied:
        raise HTTPException(status_code=400, detail="Target table must be empty for transfer")

    source_items = _json_load(source.items_json, [])
    target.items_json = json.dumps(source_items, ensure_ascii=False)
    target.total = Decimal(str(source.total or 0)).quantize(Decimal("0.01"))
    target.is_occupied = True
    target.assigned_to = source.assigned_to or target.assigned_to
    target.locked_by = source.locked_by or source.assigned_to or target.locked_by
    target.locked_at = datetime.utcnow() if target.locked_by else target.locked_at
    target.active_session_id = source.active_session_id or target.active_session_id
    target.guest_count = int(source.guest_count or 0)
    target.deposit_guest_count = int(source.deposit_guest_count or 0)
    target.deposit_amount = Decimal(str(source.deposit_amount or 0)).quantize(Decimal("0.01"))
    target.deposit_seats_json = source.deposit_seats_json or "[]"

    source.items_json = "[]"
    source.total = Decimal("0.00")
    source.is_occupied = False
    source.assigned_to = None
    source.locked_by = None
    source.locked_at = None
    source.active_session_id = None
    source.guest_count = 0
    source.deposit_guest_count = 0
    source.deposit_amount = Decimal("0.00")
    source.deposit_seats_json = "[]"

    kitchen_rows = (
        db.query(KitchenOrder)
        .filter(KitchenOrder.tenant_id == tenant.id, KitchenOrder.table_label == source.label, KitchenOrder.status.in_(["NEW", "PREPARING", "READY"]))
        .all()
    )
    for kitchen_row in kitchen_rows:
        kitchen_row.table_label = target.label

    _notify_front_of_house(
        db,
        tenant.id,
        "Masa Köçürüldü",
        f"{source.label} sifarişi {target.label} masasına köçürüldü.",
        {"from_table": source.label, "to_table": target.label, "status": "TRANSFERRED"},
    )
    db.commit()
    return {"success": True}


@router.post("/tables/{table_id}/merge")
def merge_tables(
    table_id: str,
    payload: TableTargetIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    if str(user.role or "").lower() == "kitchen":
        raise HTTPException(status_code=403, detail="Floor access required")
    source = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    target = db.query(Table).filter(Table.id == payload.target_table_id, Table.tenant_id == tenant.id).first()
    if not source or not target:
        raise HTTPException(status_code=404, detail="Table not found")
    if source.id == target.id:
        raise HTTPException(status_code=400, detail="Choose a different table")
    if not source.is_occupied:
        raise HTTPException(status_code=400, detail="Source table is empty")

    source_items = _json_load(source.items_json, [])
    target_items = _json_load(target.items_json, [])
    target.items_json = json.dumps(_merge_table_items(target_items, source_items), ensure_ascii=False)
    target.total = (Decimal(str(target.total or 0)) + Decimal(str(source.total or 0))).quantize(Decimal("0.01"))
    target.is_occupied = True
    target.assigned_to = target.assigned_to or source.assigned_to
    target.locked_by = target.locked_by or source.locked_by or source.assigned_to
    target.locked_at = datetime.utcnow() if target.locked_by else target.locked_at
    target.active_session_id = target.active_session_id or source.active_session_id
    target.guest_count = int(target.guest_count or 0) + int(source.guest_count or 0)
    target.deposit_guest_count = int(target.deposit_guest_count or 0) + int(source.deposit_guest_count or 0)
    target.deposit_amount = (Decimal(str(target.deposit_amount or 0)) + Decimal(str(source.deposit_amount or 0))).quantize(Decimal("0.01"))
    target_deposit_labels = [str(label or "").strip() for label in _json_load(target.deposit_seats_json, []) if str(label or "").strip()]
    source_deposit_labels = [str(label or "").strip() for label in _json_load(source.deposit_seats_json, []) if str(label or "").strip()]
    target.deposit_seats_json = json.dumps([*target_deposit_labels, *source_deposit_labels], ensure_ascii=False)

    source.items_json = "[]"
    source.total = Decimal("0.00")
    source.is_occupied = False
    source.assigned_to = None
    source.locked_by = None
    source.locked_at = None
    source.active_session_id = None
    source.guest_count = 0
    source.deposit_guest_count = 0
    source.deposit_amount = Decimal("0.00")
    source.deposit_seats_json = "[]"

    kitchen_rows = (
        db.query(KitchenOrder)
        .filter(KitchenOrder.tenant_id == tenant.id, KitchenOrder.table_label == source.label, KitchenOrder.status.in_(["NEW", "PREPARING", "READY"]))
        .all()
    )
    for kitchen_row in kitchen_rows:
        kitchen_row.table_label = target.label

    _notify_front_of_house(
        db,
        tenant.id,
        "Masalar Birləşdirildi",
        f"{source.label} sifarişi {target.label} ilə birləşdirildi.",
        {"from_table": source.label, "to_table": target.label, "status": "MERGED"},
    )
    db.commit()
    return {"success": True}


@router.get("/kitchen-orders")
def list_kitchen_orders(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(KitchenOrder)
        .filter(KitchenOrder.tenant_id == tenant.id, KitchenOrder.status.in_(["NEW", "PREPARING", "READY"]))
        .order_by(KitchenOrder.created_at.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "sale_id": row.sale_id,
            "table_label": row.table_label,
            "order_type": row.order_type,
            "status": row.status,
            "priority": row.priority,
            "items": _json_load(row.items_json, []),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        }
        for row in rows
    ]


@router.post("/kitchen-orders/{order_id}/accept")
def accept_kitchen_order(
    order_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(KitchenOrder).filter(KitchenOrder.id == order_id, KitchenOrder.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Kitchen order not found")
    if row.status not in {"NEW", "PREPARING"}:
        raise HTTPException(status_code=400, detail="Kitchen order cannot be accepted in current state")
    row.status = "PREPARING"
    _notify_front_of_house(
        db,
        tenant.id,
        "Mətbəx Qəbul Etdi",
        f"{row.table_label or row.order_type or 'Sifariş'} hazırlanmağa başladı.",
        {
            "kitchen_order_id": row.id,
            "table_label": row.table_label or "",
            "status": "PREPARING",
            "items": _summarize_items(_json_load(row.items_json, [])),
        },
    )
    db.commit()
    return {"success": True}


@router.post("/kitchen-orders/{order_id}/complete")
def complete_kitchen_order(
    order_id: str,
    payload: KitchenCompleteIn | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(KitchenOrder).filter(KitchenOrder.id == order_id, KitchenOrder.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Kitchen order not found")
    if row.status not in {"PREPARING", "READY"}:
        raise HTTPException(status_code=400, detail="Kitchen order cannot be completed in current state")
    row.status = "READY"
    row.completed_at = datetime.utcnow()
    ready_items = [str(item).strip() for item in (payload.ready_items or []) if str(item).strip()]
    ready_items = ready_items[:12]
    ready_summary = ", ".join(ready_items) if ready_items else _summarize_items(_json_load(row.items_json, []))
    table_owner = None
    if row.table_label:
        table_row = (
            db.query(Table)
            .filter(Table.tenant_id == tenant.id, Table.label == row.table_label)
            .first()
        )
        table_owner = table_row.assigned_to if table_row else None
    _notify_front_of_house(
        db,
        tenant.id,
        "Sifariş Hazırdır",
        f"{row.table_label or row.order_type or 'Sifariş'} hazırdır: {ready_summary}",
        {
            "kitchen_order_id": row.id,
            "table_label": row.table_label or "",
            "status": "READY",
            "items": _summarize_items(_json_load(row.items_json, [])),
            "ready_items": ready_items,
        },
        preferred_username=table_owner,
        fallback_roles={"manager", "admin", "super_admin"},
    )
    db.commit()
    return {"success": True}


@router.get("/staff-notifications/unread")
def get_unread_staff_notifications(
    limit: int = 100,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    bounded_limit = max(1, min(int(limit or 100), 300))
    rows = (
        db.query(StaffNotification)
        .filter(StaffNotification.tenant_id == tenant.id, StaffNotification.username == user.username, StaffNotification.is_read == False)
        .order_by(StaffNotification.created_at.desc())
        .limit(bounded_limit)
        .all()
    )
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "username": row.username,
            "title": row.title,
            "message": row.message,
            "meta": _json_load(row.meta_json, {}),
            "read": bool(row.is_read),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.post("/staff-notifications/read")
def mark_staff_notifications_read(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(StaffNotification)
        .filter(StaffNotification.tenant_id == tenant.id, StaffNotification.username == user.username, StaffNotification.is_read == False)
        .all()
    )
    for row in rows:
        row.is_read = True
    db.commit()
    return {"success": True, "count": len(rows)}


@router.post("/staff-notifications/{notification_id}/read")
def mark_single_staff_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = (
        db.query(StaffNotification)
        .filter(
            StaffNotification.id == notification_id,
            StaffNotification.tenant_id == tenant.id,
            StaffNotification.username == user.username,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    row.is_read = True
    db.commit()
    return {"success": True}


@router.post("/shift-handover")
def create_shift_handover(
    payload: ShiftHandoverCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    active = db.query(Shift).filter(Shift.tenant_id == tenant.id, Shift.status == "open").first()
    if not active:
        raise HTTPException(status_code=400, detail="Shift is closed")

    received_by = str(payload.received_by or "").strip()
    if not received_by:
        raise HTTPException(status_code=400, detail="Receiver is required")
    if received_by == user.username:
        raise HTTPException(status_code=400, detail="Cannot hand over shift to yourself")

    receiver = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, func.lower(User.username) == received_by.lower(), User.is_active == True)
        .first()
    )
    if not receiver:
        raise HTTPException(status_code=404, detail="Receiver user not found")
    if str(receiver.role or "").lower() not in {"admin", "manager", "staff"}:
        raise HTTPException(status_code=400, detail="Receiver role is not eligible for shift handover")
    declared_cash = _validate_shift_handover_cash(db, tenant.id, user, active, payload.declared_cash)

    row = ShiftHandover(
        tenant_id=tenant.id,
        handed_by=user.username,
        received_by=receiver.username,
        declared_cash=declared_cash,
        status="PENDING",
    )
    db.add(row)
    db.add(
        StaffNotification(
            tenant_id=tenant.id,
            username=receiver.username,
            title="Smena Təhvil Alındı",
            message=f"{user.username} sizə {Decimal(str(payload.declared_cash)).quantize(Decimal('0.01'))} ₼ ilə smena təhvil verdi. Təsdiq edin.",
            meta_json=json.dumps(
                {
                    "handed_by": user.username,
                    "declared_cash": str(payload.declared_cash),
                },
                ensure_ascii=False,
            ),
            is_read=False,
        )
    )
    db.commit()
    db.refresh(row)
    return {"success": True, "id": row.id, "status": row.status}


@router.post("/shift-handover/{handover_id}/accept")
def accept_shift_handover_op(
    handover_id: str,
    payload: ShiftHandoverAcceptPayload,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    active = db.query(Shift).filter(Shift.tenant_id == tenant.id, Shift.status == "open").first()
    if not active:
        raise HTTPException(status_code=400, detail="Shift is closed")

    row = db.query(ShiftHandover).filter(ShiftHandover.id == handover_id, ShiftHandover.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Handover not found")
    if row.status != "PENDING":
        raise HTTPException(status_code=400, detail="Handover already accepted")
    if row.received_by != user.username:
        raise HTTPException(status_code=403, detail="This handover is not assigned to you")

    actual = Decimal(str(payload.actual_cash)).quantize(Decimal("0.01"))
    if actual < 0:
        raise HTTPException(status_code=400, detail="Actual cash cannot be negative")
    declared = Decimal(str(row.declared_cash))
    difference = actual - declared
    pending_txn_id: str | None = None
    pending_status: str | None = None
    approval_required = False
    if difference != 0:
        if _cash_adjustment_requires_manual_approval(db, tenant.id, difference):
            pending_txn = _create_finance_transaction_record(
                db,
                tenant_id=tenant.id,
                transaction_type="cash_adjustment",
                status="pending_approval",
                amount=abs(difference),
                source_code="adjustment" if difference > 0 else "cash",
                destination_code="cash" if difference > 0 else "adjustment",
                created_by=user.username,
                category="Kassa Artığı" if difference > 0 else "Kassa Kəsiri",
                note=f"Smeni qəbul fərqi ({row.handed_by} -> {user.username}) — approval tələb olunur",
                related_shift_id=active.id,
            )
            approval_required = True
            pending_txn_id = pending_txn.id
            pending_status = pending_txn.status
            db.add(
                AuditLog(
                    tenant_id=tenant.id,
                    user=user.username,
                    action="FINANCE_HANDOVER_ADJUSTMENT_APPROVAL_REQUESTED",
                    details=json.dumps(
                        {
                            "handover_id": row.id,
                            "transaction_id": pending_txn.id,
                            "difference": str(difference.quantize(Decimal("0.01"))),
                            "status": pending_txn.status,
                        },
                        ensure_ascii=False,
                    ),
                )
            )
        else:
            _post_finance_transaction(
                db,
                tenant_id=tenant.id,
                transaction_type="cash_adjustment",
                amount=abs(difference),
                source_code="adjustment" if difference > 0 else "cash",
                destination_code="cash" if difference > 0 else "adjustment",
                created_by=user.username,
                category="Kassa Artığı" if difference > 0 else "Kassa Kəsiri",
                note=f"Smeni qəbul fərqi ({row.handed_by} -> {user.username})",
            )

    active.opened_by = user.username
    row.status = "ACCEPTED"
    row.actual_cash = actual
    row.difference = difference
    row.accepted_at = _utcnow()
    db.commit()
    return {
        "success": True,
        "handover_id": row.id,
        "declared_cash": str(row.declared_cash),
        "actual_cash": str(actual),
        "difference": str(difference),
        "approval_required": approval_required,
        "pending_transaction_id": pending_txn_id,
        "pending_status": pending_status,
    }


@router.get("/happy-hours/active")
def active_happy_hour(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    weekday = now.weekday() + 1
    current_time = now.strftime("%H:%M")
    rows = db.query(HappyHour).filter(HappyHour.tenant_id == tenant.id, HappyHour.is_active == True).all()
    for row in rows:
        days = _json_load(row.days_of_week_json, [])
        if weekday in days and row.start_time <= current_time <= row.end_time:
            return {"id": row.id, "name": row.name, "discount_percent": row.discount_percent, "categories": row.categories, "end_time": row.end_time}
    return None


@router.post("/happy-hours")
def create_happy_hour(
    payload: HappyHourCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    row = HappyHour(
        tenant_id=tenant.id,
        name=payload.name,
        start_time=payload.start_time,
        end_time=payload.end_time,
        discount_percent=payload.discount_percent,
        days_of_week_json=json.dumps(payload.days_of_week),
        categories=payload.categories,
        is_active=payload.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}


@router.patch("/happy-hours/{happy_hour_id}")
def update_happy_hour_status(
    happy_hour_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    row = db.query(HappyHour).filter(HappyHour.id == happy_hour_id, HappyHour.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Happy hour not found")
    row.is_active = bool(payload.get("is_active"))
    db.commit()
    return {"success": True}


@router.delete("/happy-hours/{happy_hour_id}")
def delete_happy_hour(
    happy_hour_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    row = db.query(HappyHour).filter(HappyHour.id == happy_hour_id, HappyHour.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Happy hour not found")
    db.delete(row)
    db.commit()
    return {"success": True}


@router.get("/logs")
def list_logs(
    limit: int = Query(default=100, ge=1, le=1000),
    from_date: str | None = None,
    to_date: str | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    query = db.query(AuditLog).filter(AuditLog.tenant_id == tenant.id)
    if from_date:
        query = query.filter(AuditLog.created_at >= datetime.fromisoformat(f"{from_date}T00:00:00"))
    if to_date:
        query = query.filter(AuditLog.created_at <= datetime.fromisoformat(f"{to_date}T23:59:59"))
    rows = query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    return [
        {
            "id": row.id,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "tenant_id": row.tenant_id,
            "user": row.user,
            "action": row.action,
            "details": _json_load(row.details, {"message": row.details} if row.details else {}),
        }
        for row in rows
    ]


@router.get("/logs/super-errors")
def list_super_error_logs(
    limit: int = Query(default=300, ge=1, le=2000),
    from_date: str | None = None,
    to_date: str | None = None,
    tenant_id: str | None = None,
    q: str | None = None,
    include_all: bool = Query(default=False),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    if str(user.role or "").lower() != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access required")

    del tenant  # platform-wide query for super admins

    query = db.query(AuditLog)
    if tenant_id:
        query = query.filter(AuditLog.tenant_id == str(tenant_id).strip())
    if from_date:
        query = query.filter(AuditLog.created_at >= datetime.fromisoformat(f"{from_date}T00:00:00"))
    if to_date:
        query = query.filter(AuditLog.created_at <= datetime.fromisoformat(f"{to_date}T23:59:59"))

    action_upper = func.upper(AuditLog.action)
    details_lower = func.lower(func.coalesce(AuditLog.details, ""))
    if not include_all:
        query = query.filter(
            (action_upper.like("%ERROR%"))
            | (action_upper.like("%FAIL%"))
            | (action_upper.like("%REJECT%"))
            | action_upper.in_(
                [
                    "UI_ERROR",
                    "RESTORE_FAILED",
                    "DATABASE_RESTORE_FAILED",
                    "TENANT_DELETE_FAILED",
                    "AUTH_LOGIN_FAILED",
                    "FINANCE_POST_FAILED",
                    "KITCHEN_ORDER_FAILED",
                ]
            )
            | details_lower.like("%error%")
            | details_lower.like("%exception%")
            | details_lower.like("%traceback%")
            | details_lower.like("%failed%")
        )

    search = str(q or "").strip().lower()
    if search:
        query = query.filter(
            func.lower(func.coalesce(AuditLog.user, "")).like(f"%{search}%")
            | func.lower(func.coalesce(AuditLog.action, "")).like(f"%{search}%")
            | details_lower.like(f"%{search}%")
            | func.lower(func.coalesce(AuditLog.tenant_id, "")).like(f"%{search}%")
        )

    rows = query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    return [
        {
            "id": row.id,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "tenant_id": row.tenant_id,
            "user": row.user,
            "action": row.action,
            "details": _json_load(row.details, {"message": row.details} if row.details else {}),
        }
        for row in rows
    ]


@router.get("/logs/diagnostics-overview")
def diagnostics_overview(
    minutes: int = Query(default=120, ge=5, le=1440),
    tenant_id: str | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    if str(user.role or "").lower() != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access required")
    del tenant

    cutoff = datetime.utcnow() - timedelta(minutes=int(minutes))
    query = db.query(AuditLog).filter(AuditLog.created_at >= cutoff)
    if tenant_id:
        query = query.filter(AuditLog.tenant_id == str(tenant_id).strip())
    rows = query.order_by(AuditLog.created_at.desc()).limit(500).all()

    action_counts: dict[str, int] = {}
    critical_actions = {
        "BACKEND_UNHANDLED_EXCEPTION",
        "UI_ERROR",
        "API_NETWORK_ERROR",
        "API_SERVER_ERROR",
        "RESTORE_FAILED",
        "DATABASE_RESTORE_FAILED",
    }
    latest_critical: list[dict] = []
    for row in rows:
        action = str(row.action or "").upper()
        action_counts[action] = int(action_counts.get(action, 0)) + 1
        if action in critical_actions and len(latest_critical) < 100:
            latest_critical.append(
                {
                    "id": row.id,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "tenant_id": row.tenant_id,
                    "user": row.user,
                    "action": row.action,
                    "details": _json_load(row.details, {"message": row.details} if row.details else {}),
                }
            )

    db_health = {"ok": True, "total_conn": None, "active_conn": None, "max_active_query_ms": None, "error": None}
    try:
        stat_row = db.execute(
            text(
                """
                SELECT
                  COUNT(*)::int AS total_conn,
                  COUNT(*) FILTER (WHERE state='active')::int AS active_conn,
                  MAX(EXTRACT(EPOCH FROM (NOW() - query_start)) * 1000)::float AS max_active_query_ms
                FROM pg_stat_activity
                WHERE datname = current_database()
                """
            )
        ).first()
        if stat_row:
            db_health.update(
                {
                    "total_conn": int(stat_row[0] or 0),
                    "active_conn": int(stat_row[1] or 0),
                    "max_active_query_ms": float(stat_row[2] or 0.0),
                }
            )
    except Exception as e:
        db_health.update({"ok": False, "error": str(e)})

    return {
        "window_minutes": int(minutes),
        "tenant_filter": tenant_id or None,
        "generated_at": datetime.utcnow().isoformat(),
        "action_counts": action_counts,
        "latest_critical": latest_critical,
        "db_health": db_health,
    }


@router.post("/logs/event")
def create_log_event(
    payload: LogEventIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    details = payload.details if isinstance(payload.details, str) else (payload.details or {})
    db.add(AuditLog(tenant_id=tenant.id, user=payload.user, action=payload.action, details=json.dumps(details, ensure_ascii=False) if not isinstance(details, str) else details))
    db.commit()
    return {"success": True}
