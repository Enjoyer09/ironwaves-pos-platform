import json
import secrets
from datetime import datetime
from decimal import Decimal

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
    KitchenOrder,
    Notification,
    Sale,
    Setting,
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
    return {
        "tenant_id": tenant.id,
        "service_fee_percent": 0,
        "ui_visibility": {"staff_show_tables": True, "manager_show_tables": True, "staff_show_kitchen": True},
        "time_settings": {"shift_start_time": "08:00", "shift_end_time": "23:00", "utc_offset": 4, "timezone": "Asia/Baku"},
        "email_settings": email_settings,
        "bank_commission": {"min_amount": 0.10, "percent": 1.5},
        "inventory_settings": inventory_settings,
        "print_settings": print_settings,
        "qr_settings": qr_settings,
        "omnitech_settings": omnitech_settings,
        "role_modules": role_modules,
        "gemini_api_key": _setting_value(db, tenant.id, "gemini_api_key", ""),
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
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "label": row.label,
            "is_occupied": bool(row.is_occupied),
            "total": str(row.total),
            "items": _json_load(row.items_json, []),
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
    _ensure_admin(user)
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
        items_json=json.dumps(items, ensure_ascii=False),
        status="COMPLETED",
        created_at=datetime.utcnow(),
    )
    db.add(sale)
    db.flush()
    payment_method = str(payload.payment_method or "").lower()
    if payment_method == "split":
        split_cash = Decimal(str(payload.split_cash or 0)).quantize(Decimal("0.01"))
        split_card = Decimal(str(payload.split_card or 0)).quantize(Decimal("0.01"))
        if split_cash + split_card != total:
            raise HTTPException(status_code=400, detail="Split amounts must equal table total")
        if split_cash > 0:
            db.add(FinanceEntry(tenant_id=tenant.id, type="in", category="Satış (Nağd)", source="cash", amount=split_cash, description=f"Table payment {sale.id}", created_by=user.username))
        if split_card > 0:
            db.add(FinanceEntry(tenant_id=tenant.id, type="in", category="Satış (Kart)", source="card", amount=split_card, description=f"Table payment {sale.id}", created_by=user.username))
    else:
        source = "cash" if payment_method in {"nəğd", "cash"} else "card"
        category = "Satış (Nağd)" if source == "cash" else "Satış (Kart)"
        db.add(FinanceEntry(tenant_id=tenant.id, type="in", category=category, source=source, amount=total, description=f"Table payment {sale.id}", created_by=user.username))

    row.is_occupied = False
    row.items_json = "[]"
    row.total = Decimal("0.00")
    db.commit()
    return {"success": True, "sale_id": sale.id, "receipt_code": receipt_code, "receipt_token": receipt_token}


@router.get("/kitchen-orders")
def list_kitchen_orders(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(KitchenOrder)
        .filter(KitchenOrder.tenant_id == tenant.id, KitchenOrder.status.in_(["NEW", "PREPARING"]))
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
    row.status = "PREPARING"
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
    row.status = "DONE"
    row.completed_at = datetime.utcnow()
    db.commit()
    return {"success": True}


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
