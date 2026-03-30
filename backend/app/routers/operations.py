import json
import secrets
from datetime import datetime
from decimal import Decimal
from urllib import request as urllib_request
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import (
    AuditLog,
    BusinessProfile,
    Customer,
    FinanceEntry,
    HappyHour,
    InventoryItem,
    KitchenOrder,
    Notification,
    Recipe,
    Sale,
    Setting,
    StaffNotification,
    Table,
    Tenant,
    User,
)


router = APIRouter(prefix="/api/v1/ops", tags=["operations"])


def _ensure_manager(user: User):
    if str(user.role or "").lower() not in {"admin", "manager", "super_admin"}:
        raise HTTPException(status_code=403, detail="Manager access required")


def _ensure_admin(user: User):
    if str(user.role or "").lower() not in {"admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")


def _can_view_sensitive_settings(user: User) -> bool:
    return str(user.role or "").lower() in {"admin", "super_admin"}


def _json_load(value: str | None, default):
    try:
        return json.loads(value or "")
    except Exception:
        return default


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


def _notify_front_of_house(
    db: Session,
    tenant_id: str,
    title: str,
    message: str,
    meta: dict | None = None,
):
    usernames = [
        row.username
        for row in db.query(User)
        .filter(User.tenant_id == tenant_id, User.is_active == True)
        .all()
        if str(row.role or "").lower() in {"staff", "manager", "admin", "super_admin"}
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


def _collect_stock_ops(db: Session, tenant_id: str, items: list[dict]) -> tuple[list[tuple[InventoryItem, Decimal]], Decimal]:
    stock_ops: list[tuple[InventoryItem, Decimal]] = []
    cogs_total = Decimal("0.0000")
    for item in items:
        recipes = (
            db.query(Recipe)
            .filter(Recipe.tenant_id == tenant_id, func.lower(Recipe.menu_item_name) == str(item.get("item_name") or "").lower())
            .all()
        )
        for recipe in recipes:
            inventory = (
                db.query(InventoryItem)
                .filter(InventoryItem.tenant_id == tenant_id, func.lower(InventoryItem.name) == str(recipe.ingredient_name).lower())
                .first()
            )
            if not inventory:
                continue
            qty_required = (Decimal(str(recipe.quantity_required or 0)) * Decimal(str(item.get("qty") or 0))).quantize(Decimal("0.0001"))
            if Decimal(str(inventory.stock_qty or 0)) < qty_required:
                raise HTTPException(status_code=400, detail=f"{inventory.name} üçün anbarda kifayət qədər qalıq yoxdur")
            stock_ops.append((inventory, qty_required))
            cogs_total += (qty_required * Decimal(str(inventory.unit_cost or 0))).quantize(Decimal("0.0001"))
    return stock_ops, cogs_total.quantize(Decimal("0.0001"))


def _merge_table_items(existing: list[dict], incoming: list[dict]) -> list[dict]:
    merged = list(existing)
    for item in incoming:
        idx = next((i for i, row in enumerate(merged) if row.get("id") == item.get("id") or row.get("item_name") == item.get("item_name")), -1)
        if idx >= 0:
            merged[idx]["qty"] = int(merged[idx].get("qty", 0)) + int(item.get("qty", 0))
        else:
            merged.append(item)
    return merged


class BusinessProfileIn(BaseModel):
    company_name: str
    phone: str | None = None
    address: str | None = None
    website: str | None = None
    logo_url: str | None = None
    receipt_footer: str | None = None
    voen: str | None = None


class TableCreateIn(BaseModel):
    label: str


class TableItemsIn(BaseModel):
    cart_items: list[dict]
    cup_mode: str | None = "paper"


class TablePayIn(BaseModel):
    payment_method: str
    split_cash: Decimal | None = None
    split_card: Decimal | None = None
    cup_mode: str | None = "paper"


class TableTargetIn(BaseModel):
    target_table_id: str


class HappyHourCreateIn(BaseModel):
    name: str
    start_time: str
    end_time: str
    discount_percent: int
    days_of_week: list[int]
    categories: str = "ALL"
    is_active: bool = True


class QrBatchIn(BaseModel):
    count: int
    customer_type: str
    discount_percent: Decimal = Decimal("0")


class CustomerImportRowIn(BaseModel):
    card_id: str
    secret_token: str | None = None
    type: str = "Golden"
    stars: int = 0
    discount_percent: Decimal = Decimal("0")


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
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    inventory_settings = _setting_value(
        db,
        tenant.id,
        "inventory_settings",
        {"default_critical_threshold": 5, "unit_options": ["kq", "qram", "litr", "ml", "ədəd", "metr"]},
    )
    staff_benefits = _setting_value(
        db,
        tenant.id,
        "staff_benefits",
        {"daily_limit_azn": 6, "allowed_scope": "all", "included_categories": [], "included_items": [], "item_unit_cap_azn": 6},
    )
    role_modules = _setting_value(
        db,
        tenant.id,
        "role_modules",
        {
            "staff": ["pos", "tables", "kds", "zreport"],
            "manager": ["pos", "tables", "kds", "zreport", "finance", "inventory", "combos", "analytics", "logs", "crm", "ai", "menu", "recipes"],
            "kitchen": ["kds"],
        },
    )
    print_settings = _setting_value(db, tenant.id, "print_settings", {"use_qz": False, "printer_name": ""})
    qr_settings = _setting_value(db, tenant.id, "qr_settings", {"base_url": f"https://{tenant.domain}"})
    email_settings = _setting_value(
        db,
        tenant.id,
        "email_settings",
        {"enabled": False, "provider": "none", "resend_api_key": "", "sender_email": "", "recipient_emails": [], "webhook_url": "", "timeout_sec": 15},
    )
    omnitech_settings = _setting_value(
        db,
        tenant.id,
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
        gemini_api_key = _setting_value(db, tenant.id, "gemini_api_key", "")
    return {
        "tenant_id": tenant.id,
        "service_fee_percent": 0,
        "ui_visibility": {"staff_show_tables": True, "manager_show_tables": True, "staff_show_kitchen": True},
        "time_settings": {"shift_start_time": "08:00", "shift_end_time": "23:00", "utc_offset": 4, "timezone": "Asia/Baku"},
        "email_settings": email_settings,
        "bank_commission": {"min_amount": 0.10, "percent": 1.5},
        "inventory_settings": inventory_settings,
        "staff_benefits": staff_benefits,
        "print_settings": print_settings,
        "qr_settings": qr_settings,
        "omnitech_settings": omnitech_settings,
        "role_modules": role_modules,
        "gemini_api_key": gemini_api_key,
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


@router.patch("/settings/gemini-key")
def update_gemini_key(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    _set_setting_value(db, tenant.id, "gemini_api_key", str(payload.get("api_key") or ""))
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
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).first()
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
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    row = db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).first()
    if not row:
      return {
          "tenant_id": tenant.id,
          "company_name": tenant.name,
          "website": f"https://{tenant.domain}",
          "logo_url": "",
          "receipt_footer": "Bizi secdiyiniz ucun tesekkur edirik!",
      }
    return {
        "tenant_id": tenant.id,
        "company_name": row.company_name,
        "website": row.website or f"https://{tenant.domain}",
        "logo_url": row.logo_url or "",
        "receipt_footer": row.receipt_footer or "",
    }


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

    stars = int(customer.stars or 0)
    next_reward_at = 10
    progress_current = stars % next_reward_at
    progress_remaining = 0 if progress_current == 0 and stars > 0 else next_reward_at - progress_current
    available_rewards = stars // next_reward_at

    return {
        "tenant_id": tenant.id,
        "branding": {
            "company_name": branding.company_name if branding else tenant.name,
            "website": (branding.website if branding else f"https://{tenant.domain}") or f"https://{tenant.domain}",
            "logo_url": (branding.logo_url if branding else "") or "",
            "receipt_footer": (branding.receipt_footer if branding else "") or "",
        },
        "customer": {
            "card_id": customer.card_id,
            "type": customer.type,
            "stars": stars,
            "discount_percent": str(customer.discount_percent or 0),
            "created_at": customer.created_at.isoformat() if customer.created_at else None,
        },
        "wallet": {
            "points_label": "Ulduz",
            "stars_balance": stars,
            "available_rewards": available_rewards,
            "next_reward_at": next_reward_at,
            "progress_current": progress_current,
            "progress_remaining": progress_remaining,
            "reward_label": "10 ulduza 1 pulsuz içki",
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
        ],
        "notifications": [
            {
                "id": row.id,
                "message": row.message,
                "is_read": bool(row.is_read),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in notifications
        ],
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
        ],
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
            logo_url=payload.logo_url or None,
            receipt_footer=payload.receipt_footer or None,
        )
        db.add(row)
    else:
        row.company_name = payload.company_name.strip()
        row.phone = payload.phone or None
        row.address = payload.address or None
        row.website = payload.website or None
        row.logo_url = payload.logo_url or None
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
            "is_occupied": bool(row.is_occupied),
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
    row = Table(tenant_id=tenant.id, label=label, is_occupied=False, total=Decimal("0.00"), items_json="[]")
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "tenant_id": row.tenant_id, "label": row.label, "is_occupied": False, "total": "0", "items": []}


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
    merged = list(existing)
    for incoming in payload.cart_items:
        idx = next((i for i, item in enumerate(merged) if item.get("id") == incoming.get("id") or item.get("item_name") == incoming.get("item_name")), -1)
        if idx >= 0:
            merged[idx]["qty"] = int(merged[idx].get("qty", 0)) + int(incoming.get("qty", 0))
        else:
            merged.append(incoming)

    total = Decimal(str(row.total or 0))
    for incoming in payload.cart_items:
        total += Decimal(str(incoming.get("price") or 0)) * int(incoming.get("qty") or 0)

    row.is_occupied = True
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
    items = _json_load(row.items_json, [])
    if not items:
        raise HTTPException(status_code=400, detail="Table is empty")

    total = Decimal(str(row.total or 0)).quantize(Decimal("0.01"))
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

    payment_method = _normalize_payment_method(payload.payment_method)
    if payment_method == "split":
        split_cash = Decimal(str(payload.split_cash or 0)).quantize(Decimal("0.01"))
        split_card = Decimal(str(payload.split_card or 0)).quantize(Decimal("0.01"))
        if split_cash < 0 or split_card < 0:
            raise HTTPException(status_code=400, detail="Split amounts cannot be negative")
        if (split_cash + split_card - total).copy_abs() > Decimal("0.01"):
            raise HTTPException(status_code=400, detail="Split amounts must equal table total")
        if split_cash > 0:
            db.add(FinanceEntry(tenant_id=tenant.id, type="in", category="Satış (Nağd)", source="cash", amount=split_cash, description=f"Table payment {sale.id}", created_by=user.username))
        if split_card > 0:
            db.add(FinanceEntry(tenant_id=tenant.id, type="in", category="Satış (Kart)", source="card", amount=split_card, description=f"Table payment {sale.id}", created_by=user.username))
    else:
        source = "cash" if payment_method in {"nəğd", "cash", "staff"} else "card"
        category = "Satış (Nağd)" if source == "cash" else "Satış (Kart)"
        db.add(FinanceEntry(tenant_id=tenant.id, type="in", category=category, source=source, amount=total, description=f"Table payment {sale.id}", created_by=user.username))

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
    row.items_json = "[]"
    row.total = Decimal("0.00")
    db.commit()
    return {"success": True, "sale_id": sale.id, "receipt_code": receipt_code, "receipt_token": receipt_token}


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

    source.items_json = "[]"
    source.total = Decimal("0.00")
    source.is_occupied = False

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

    source.items_json = "[]"
    source.total = Decimal("0.00")
    source.is_occupied = False

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
    _notify_front_of_house(
        db,
        tenant.id,
        "Sifariş Hazırdır",
        f"{row.table_label or row.order_type or 'Sifariş'} hazırdır. Ofisant təqdim edə bilər.",
        {
            "kitchen_order_id": row.id,
            "table_label": row.table_label or "",
            "status": "READY",
            "items": _summarize_items(_json_load(row.items_json, [])),
        },
    )
    db.commit()
    return {"success": True}


@router.get("/staff-notifications/unread")
def get_unread_staff_notifications(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(StaffNotification)
        .filter(StaffNotification.tenant_id == tenant.id, StaffNotification.username == user.username, StaffNotification.is_read == False)
        .order_by(StaffNotification.created_at.desc())
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


@router.get("/customers")
def list_customers(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = db.query(Customer).filter(Customer.tenant_id == tenant.id).order_by(Customer.created_at.desc()).all()
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "card_id": row.card_id,
            "type": row.type,
            "stars": row.stars,
            "discount_percent": str(row.discount_percent),
            "secret_token": row.secret_token,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.post("/customers/qr-batch")
def create_qr_batch(
    payload: QrBatchIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    count = max(1, min(int(payload.count), 200))
    created = []
    for _ in range(count):
        card_id = f"QR-{secrets.randbelow(1000000):06d}"
        customer = Customer(
            tenant_id=tenant.id,
            card_id=card_id,
            secret_token=secrets.token_hex(16),
            type=payload.customer_type,
            stars=0,
            discount_percent=Decimal(str(payload.discount_percent or 0)).quantize(Decimal("0.01")),
        )
        db.add(customer)
        db.flush()
        created.append(
            {
                "id": customer.id,
                "tenant_id": customer.tenant_id,
                "card_id": customer.card_id,
                "secret_token": customer.secret_token,
                "type": customer.type,
                "stars": customer.stars,
                "discount_percent": str(customer.discount_percent),
                "created_at": customer.created_at.isoformat() if customer.created_at else None,
            }
        )
    db.commit()
    return created


@router.post("/customers/import")
def import_customers(
    payload: list[CustomerImportRowIn],
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    imported = 0
    updated = 0
    for row in payload:
        card_id = str(row.card_id or "").strip()
        if len(card_id) < 2:
            continue
        customer = (
            db.query(Customer)
            .filter(Customer.tenant_id == tenant.id, func.lower(Customer.card_id) == card_id.lower())
            .first()
        )
        if customer:
            customer.type = str(row.type or customer.type or "Golden").strip() or "Golden"
            customer.stars = max(0, int(row.stars or 0))
            customer.discount_percent = Decimal(str(row.discount_percent or 0)).quantize(Decimal("0.01"))
            if str(row.secret_token or "").strip():
                customer.secret_token = str(row.secret_token).strip()
            updated += 1
            continue

        db.add(
            Customer(
                tenant_id=tenant.id,
                card_id=card_id,
                secret_token=str(row.secret_token or secrets.token_hex(16)).strip(),
                type=str(row.type or "Golden").strip() or "Golden",
                stars=max(0, int(row.stars or 0)),
                discount_percent=Decimal(str(row.discount_percent or 0)).quantize(Decimal("0.01")),
            )
        )
        imported += 1

    db.commit()
    return {"success": True, "imported": imported, "updated": updated}


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
