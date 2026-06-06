from datetime import datetime
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_super_admin, get_tenant
from app.core.config import settings
from app.models import (
    AuditLog,
    Check,
    Customer,
    CustomerConsent,
    DonerBatch,
    FinanceEntry,
    FinanceAccount,
    FinanceLedgerEntry,
    FinanceReconciliation,
    FinanceTransaction,
    FloorPlan,
    Guest,
    HappyHour,
    InventoryItem,
    ItemStatusLog,
    KitchenOrder,
    LoyaltyLedgerEntry,
    MenuItem,
    Notification,
    OrderItem,
    OrderRound,
    Payment,
    Recipe,
    Reservation,
    RewardClaim,
    RefreshToken,
    RevokedToken,
    Sale,
    Setting,
    ShiftHandover,
    StaffNotification,
    Shift,
    Table,
    TableSession,
    Tenant,
    User,
    WasteLog,
)
from app.schemas import TenantCloneIn, TenantCreateIn, TenantOut
from app.security import hash_password


router = APIRouter(prefix="/api/v1/admin/tenants", tags=["tenants"])
ALLOWED_RAW_TENANT_TABLES = {"tenant_domains", "business_profiles"}


def _normalize_domain(raw: str) -> str:
    value = str(raw or "").strip().lower()
    if value.startswith("http://"):
        value = value[7:]
    elif value.startswith("https://"):
        value = value[8:]
    value = value.split("/")[0].split("?")[0].split("#")[0]
    value = value.split(":")[0]
    return value.strip(".")


def _default_menu_rows(tenant_id: str) -> list[MenuItem]:
    return [
        MenuItem(
            tenant_id=tenant_id,
            item_name="Espresso",
            category="Qəhvə",
            price="3.00",
            is_coffee=True,
            is_active=True,
        ),
        MenuItem(
            tenant_id=tenant_id,
            item_name="Cappuccino",
            category="Qəhvə",
            price="4.50",
            is_coffee=True,
            is_active=True,
        ),
        MenuItem(
            tenant_id=tenant_id,
            item_name="Cheesecake",
            category="Şirniyyat",
            price="6.00",
            is_coffee=False,
            is_active=True,
        ),
    ]


def _default_table_rows(tenant_id: str) -> list[Table]:
    labels = ["Masa 1", "Masa 2", "Masa 3", "Masa 4"]
    return [
        Table(
            tenant_id=tenant_id,
            label=label,
            is_occupied=False,
            total="0",
            items_json="[]",
        )
        for label in labels
    ]


def _default_inventory_rows(tenant_id: str) -> list[InventoryItem]:
    rows = [
        ("Kofe Dənəsi", "kq", "Qəhvə", "3.000", "18.0000", "1.000"),
        ("Süd", "litr", "Süd Məhsulları", "20.000", "2.2000", "8.000"),
        ("Kağız Stəkan", "ədəd", "Qablaşdırma", "150.000", "0.1000", "60.000"),
        ("Qapaq", "ədəd", "Qablaşdırma", "150.000", "0.0600", "60.000"),
    ]
    return [
        InventoryItem(
            tenant_id=tenant_id,
            name=name,
            unit=unit,
            category=category,
            stock_qty=stock,
            unit_cost=cost,
            min_limit=min_limit,
        )
        for name, unit, category, stock, cost, min_limit in rows
    ]


def _default_recipe_rows(tenant_id: str) -> list[Recipe]:
    return [
        Recipe(
            tenant_id=tenant_id,
            menu_item_name="Espresso",
            ingredient_name="Kofe Dənəsi",
            quantity_required="0.0180",
        ),
        Recipe(
            tenant_id=tenant_id,
            menu_item_name="Cappuccino",
            ingredient_name="Kofe Dənəsi",
            quantity_required="0.0180",
        ),
        Recipe(
            tenant_id=tenant_id,
            menu_item_name="Cappuccino",
            ingredient_name="Süd",
            quantity_required="0.1800",
        ),
    ]


def _default_setting_rows(tenant_id: str) -> list[Setting]:
    pairs = {
        "service_fee_percent": "0",
        "bank_commission_percent": "2",
        "default_language": "az",
        "critical_stock_default": "5",
        "receipt_width_mm": "80",
    }
    return [Setting(tenant_id=tenant_id, key=k, value=v) for k, v in pairs.items()]


def _delete_model_rows(db: Session, model, tenant_id: str) -> None:
    try:
        with db.begin_nested():
            db.query(model).filter(model.tenant_id == tenant_id).delete(synchronize_session=False)
    except Exception:
        # Some production schemas can lag behind the code models during migrations.
        # Keep tenant cleanup best-effort instead of leaving the whole delete stuck.
        pass


def _delete_raw_tenant_table(db: Session, table_name: str, tenant_id: str) -> None:
    if table_name not in ALLOWED_RAW_TENANT_TABLES:
        raise HTTPException(status_code=400, detail=f"Unsupported raw tenant table cleanup: {table_name}")
    try:
        with db.begin_nested():
            db.execute(text(f"DELETE FROM {table_name} WHERE tenant_id=:tenant_id"), {"tenant_id": tenant_id})
    except Exception:
        pass


@router.get("", response_model=list[TenantOut])
def list_tenants(
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    rows = db.query(Tenant).order_by(Tenant.created_at.desc()).all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "slug": t.slug,
            "domain": t.domain,
            "status": t.status,
        }
        for t in rows
    ]


@router.post("", response_model=TenantOut)
def create_tenant(
    payload: TenantCreateIn,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    slug = payload.slug.strip().lower()
    domain = _normalize_domain(payload.domain)
    if not domain:
        raise HTTPException(status_code=400, detail="Domain is required")

    exists = db.query(Tenant).filter((Tenant.slug == slug) | (Tenant.domain == domain)).first()
    if exists:
        raise HTTPException(status_code=400, detail="Tenant slug/domain already exists")

    tenant = Tenant(
        name=payload.name.strip(),
        slug=slug,
        domain=domain,
        status="active",
        created_at=datetime.utcnow(),
    )
    db.add(tenant)
    db.flush()

    # Keep domain->tenant mapping table in sync for host based tenant resolution.
    try:
        db.execute(
            text(
                """
                INSERT INTO tenant_domains (domain, tenant_id, is_active)
                VALUES (:domain, :tenant_id, TRUE)
                ON CONFLICT (domain)
                DO UPDATE SET tenant_id = EXCLUDED.tenant_id, is_active = TRUE
                """
            ),
            {"domain": domain, "tenant_id": tenant.id},
        )
    except Exception:
        # Backward compatibility for schemas without is_active.
        try:
            db.execute(
                text(
                    """
                    INSERT INTO tenant_domains (domain, tenant_id)
                    VALUES (:domain, :tenant_id)
                    ON CONFLICT (domain)
                    DO UPDATE SET tenant_id = EXCLUDED.tenant_id
                    """
                ),
                {"domain": domain, "tenant_id": tenant.id},
            )
        except Exception:
            # If tenant_domains table does not exist, Tenant.domain fallback still works.
            pass

    db.add(
        User(
            tenant_id=tenant.id,
            username=payload.admin_username.strip(),
            email=None,
            password_hash=hash_password(payload.admin_password),
            role="admin",
            is_active=True,
        )
    )

    for row in _default_menu_rows(tenant.id):
        db.add(row)

    for row in _default_table_rows(tenant.id):
        db.add(row)

    for row in _default_inventory_rows(tenant.id):
        db.add(row)

    for row in _default_recipe_rows(tenant.id):
        db.add(row)

    for row in _default_setting_rows(tenant.id):
        db.add(row)

    # business_profiles may differ between deployments; keep provisioning resilient.
    try:
        db.execute(
            text(
                """
                INSERT INTO business_profiles (id, tenant_id, company_name, website, receipt_footer)
                VALUES (:id, :tenant_id, :company_name, :website, :receipt_footer)
                """
            ),
            {
                "id": __import__("uuid").uuid4().hex,
                "tenant_id": tenant.id,
                "company_name": tenant.name,
                "website": f"https://{tenant.domain}",
                "receipt_footer": "Bizi seçdiyiniz üçün təşəkkür edirik!",
            },
        )
    except Exception:
        pass

    db.commit()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "domain": tenant.domain,
        "status": tenant.status,
    }


@router.post("/{tenant_id}/suspend", response_model=TenantOut)
def suspend_tenant(
    tenant_id: str,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    tenant.status = "suspended"
    db.commit()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "domain": tenant.domain,
        "status": tenant.status,
    }


@router.post("/{tenant_id}/activate", response_model=TenantOut)
def activate_tenant(
    tenant_id: str,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    tenant.status = "active"
    db.commit()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "domain": tenant.domain,
        "status": tenant.status,
    }


@router.post("/{tenant_id}/clone", response_model=TenantOut)
def clone_tenant(
    tenant_id: str,
    payload: TenantCloneIn,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    source = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source tenant not found")

    new_slug = payload.slug.strip().lower()
    new_domain = _normalize_domain(payload.domain)
    if not new_domain:
        raise HTTPException(status_code=400, detail="Domain is required")
    exists = db.query(Tenant).filter((Tenant.slug == new_slug) | (Tenant.domain == new_domain)).first()
    if exists:
        raise HTTPException(status_code=400, detail="Target slug/domain already exists")

    tenant = Tenant(
        name=payload.name.strip(),
        slug=new_slug,
        domain=new_domain,
        status="active",
        created_at=datetime.utcnow(),
    )
    db.add(tenant)
    db.flush()

    # Keep domain mapping in sync for cloned tenant as well.
    try:
        db.execute(
            text(
                """
                INSERT INTO tenant_domains (domain, tenant_id, is_active)
                VALUES (:domain, :tenant_id, TRUE)
                ON CONFLICT (domain)
                DO UPDATE SET tenant_id = EXCLUDED.tenant_id, is_active = TRUE
                """
            ),
            {"domain": new_domain, "tenant_id": tenant.id},
        )
    except Exception:
        try:
            db.execute(
                text(
                    """
                    INSERT INTO tenant_domains (domain, tenant_id)
                    VALUES (:domain, :tenant_id)
                    ON CONFLICT (domain)
                    DO UPDATE SET tenant_id = EXCLUDED.tenant_id
                    """
                ),
                {"domain": new_domain, "tenant_id": tenant.id},
            )
        except Exception:
            pass

    db.add(
        User(
            tenant_id=tenant.id,
            username=payload.admin_username.strip(),
            email=None,
            password_hash=hash_password(payload.admin_password),
            role="admin",
            is_active=True,
        )
    )

    source_menu = db.query(MenuItem).filter(MenuItem.tenant_id == source.id).all()
    if source_menu:
        for m in source_menu:
            db.add(
                MenuItem(
                    tenant_id=tenant.id,
                    item_name=m.item_name,
                    category=m.category,
                    price=m.price,
                    is_coffee=m.is_coffee,
                    is_active=m.is_active,
                )
            )
    else:
        for row in _default_menu_rows(tenant.id):
            db.add(row)

    source_tables = db.query(Table).filter(Table.tenant_id == source.id).all()
    if source_tables:
        for t in source_tables:
            db.add(
                Table(
                    tenant_id=tenant.id,
                    label=t.label,
                    is_occupied=False,
                    total="0",
                    items_json="[]",
                )
            )
    else:
        for row in _default_table_rows(tenant.id):
            db.add(row)

    source_inventory = db.query(InventoryItem).filter(InventoryItem.tenant_id == source.id).all()
    if source_inventory:
        for inv in source_inventory:
            db.add(
                InventoryItem(
                    tenant_id=tenant.id,
                    name=inv.name,
                    unit=inv.unit,
                    category=inv.category,
                    stock_qty=inv.stock_qty,
                    unit_cost=inv.unit_cost,
                    min_limit=inv.min_limit,
                )
            )
    else:
        for row in _default_inventory_rows(tenant.id):
            db.add(row)

    source_recipes = db.query(Recipe).filter(Recipe.tenant_id == source.id).all()
    if source_recipes:
        for r in source_recipes:
            db.add(
                Recipe(
                    tenant_id=tenant.id,
                    menu_item_name=r.menu_item_name,
                    ingredient_name=r.ingredient_name,
                    quantity_required=r.quantity_required,
                )
            )
    else:
        for row in _default_recipe_rows(tenant.id):
            db.add(row)

    source_settings = db.query(Setting).filter(Setting.tenant_id == source.id).all()
    if source_settings:
        for s in source_settings:
            db.add(Setting(tenant_id=tenant.id, key=s.key, value=s.value))
    else:
        for row in _default_setting_rows(tenant.id):
            db.add(row)

    try:
        source_profile = db.execute(
            text(
                """
                SELECT company_name, phone, address, website, logo_url, receipt_footer
                FROM business_profiles
                WHERE tenant_id=:tenant_id
                LIMIT 1
                """
            ),
            {"tenant_id": source.id},
        ).fetchone()
        if source_profile:
            db.execute(
                text(
                    """
                    INSERT INTO business_profiles
                    (id, tenant_id, company_name, phone, address, website, logo_url, receipt_footer)
                    VALUES
                    (:id, :tenant_id, :company_name, :phone, :address, :website, :logo_url, :receipt_footer)
                    """
                ),
                {
                    "id": __import__("uuid").uuid4().hex,
                    "tenant_id": tenant.id,
                    "company_name": source_profile[0],
                    "phone": source_profile[1],
                    "address": source_profile[2],
                    "website": source_profile[3],
                    "logo_url": source_profile[4],
                    "receipt_footer": source_profile[5],
                },
            )
        else:
            db.execute(
                text(
                    """
                    INSERT INTO business_profiles (id, tenant_id, company_name, website, receipt_footer)
                    VALUES (:id, :tenant_id, :company_name, :website, :receipt_footer)
                    """
                ),
                {
                    "id": __import__("uuid").uuid4().hex,
                    "tenant_id": tenant.id,
                    "company_name": tenant.name,
                    "website": f"https://{tenant.domain}",
                    "receipt_footer": "Bizi seçdiyiniz üçün təşəkkür edirik!",
                },
            )
    except Exception:
        pass

    db.commit()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "domain": tenant.domain,
        "status": tenant.status,
    }


@router.delete("/{tenant_id}")
def delete_tenant(
    tenant_id: str,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    protected_slugs = {str(settings.platform_tenant_slug or "").strip().lower()}
    if settings.demo_tenant_enabled and settings.demo_tenant_slug:
        protected_slugs.add(str(settings.demo_tenant_slug).strip().lower())
    protected_domains = {str(settings.platform_tenant_domain or "").strip().lower()}
    if settings.demo_tenant_enabled and settings.demo_tenant_domain:
        protected_domains.add(str(settings.demo_tenant_domain).strip().lower())

    if tenant.slug.strip().lower() in protected_slugs or tenant.domain.strip().lower() in protected_domains:
        raise HTTPException(status_code=400, detail="Protected tenant cannot be deleted")

    tenant_domain = _normalize_domain(tenant.domain)

    # Remove dependent rows first (no ON DELETE CASCADE configured in this MVP schema).
    # Order matters: child rows are deleted before checks/tables/menu/users.
    _delete_raw_tenant_table(db, "tenant_domains", tenant.id)
    if tenant_domain:
        try:
            with db.begin_nested():
                db.execute(text("DELETE FROM tenant_domains WHERE domain=:domain"), {"domain": tenant_domain})
        except Exception:
            pass

    ordered_models = [
        RefreshToken,
        RevokedToken,
        AuditLog,
        FinanceLedgerEntry,
        FinanceReconciliation,
        FinanceTransaction,
        FinanceAccount,
        FinanceEntry,
        Sale,
        KitchenOrder,
        ItemStatusLog,
        OrderItem,
        OrderRound,
        Payment,
        Check,
        TableSession,
        Reservation,
        Guest,
        FloorPlan,
        RewardClaim,
        LoyaltyLedgerEntry,
        StaffNotification,
        Notification,
        CustomerConsent,
        Customer,
        HappyHour,
        DonerBatch,
        WasteLog,
        ShiftHandover,
        Shift,
        Recipe,
        InventoryItem,
        Setting,
        MenuItem,
        Table,
    ]
    for model in ordered_models:
        _delete_model_rows(db, model, tenant.id)

    _delete_raw_tenant_table(db, "business_profiles", tenant.id)
    _delete_model_rows(db, User, tenant.id)
    db.delete(tenant)
    db.commit()

    return {"success": True}


@router.get("/landing-analytics")
def get_landing_analytics(
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    platform_tenant = db.query(Tenant).filter(Tenant.slug == settings.platform_tenant_slug).first()
    if not platform_tenant:
        raise HTTPException(status_code=404, detail="Platform tenant not found")

    total_pageviews = db.query(AuditLog).filter(
        AuditLog.tenant_id == platform_tenant.id,
        AuditLog.action == "LANDING_PAGEVIEW"
    ).count()

    unique_visitors = 0
    try:
        dialect_name = db.bind.dialect.name
        if dialect_name == "postgresql":
            res = db.execute(
                text("SELECT COUNT(DISTINCT details::jsonb->>'ip') FROM audit_logs WHERE tenant_id = :t_id AND action = 'LANDING_PAGEVIEW'"),
                {"t_id": platform_tenant.id}
            ).scalar()
            unique_visitors = res or 0
        else:
            res = db.execute(
                text("SELECT COUNT(DISTINCT json_extract(details, '$.ip')) FROM audit_logs WHERE tenant_id = :t_id AND action = 'LANDING_PAGEVIEW'"),
                {"t_id": platform_tenant.id}
            ).scalar()
            unique_visitors = res or 0
    except Exception:
        try:
            res = db.execute(
                text("SELECT details FROM audit_logs WHERE tenant_id = :t_id AND action = 'LANDING_PAGEVIEW'"),
                {"t_id": platform_tenant.id}
            ).fetchall()
            ips = set()
            for r in res:
                try:
                    d = json.loads(r[0] or "{}")
                    if "ip" in d:
                        ips.add(d["ip"])
                except Exception:
                    pass
            unique_visitors = len(ips)
        except Exception:
            unique_visitors = 0

    recent_logs = db.query(AuditLog).filter(
        AuditLog.tenant_id == platform_tenant.id,
        AuditLog.action == "LANDING_PAGEVIEW"
    ).order_by(AuditLog.created_at.desc()).limit(100).all()

    recent_views = []
    for log in recent_logs:
        details_data = {}
        try:
            details_data = json.loads(log.details or "{}")
        except Exception:
            pass
        recent_views.append({
            "ip": details_data.get("ip", "unknown"),
            "user_agent": details_data.get("user_agent", "unknown"),
            "referrer": details_data.get("referrer", ""),
            "path": details_data.get("path", "/"),
            "created_at": log.created_at.isoformat()
        })

    return {
        "total_pageviews": total_pageviews,
        "unique_visitors": unique_visitors,
        "recent_views": recent_views
    }


@router.post("/simulate-webhook")
async def simulate_webhook(
    payload: dict,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    target_tenant_id = str(payload.get("tenant_id") or "").strip()
    provider = str(payload.get("provider") or "").strip().lower()
    order_id = str(payload.get("order_id") or "").strip()
    raw_items = payload.get("items") or []

    if not target_tenant_id:
        raise HTTPException(status_code=400, detail="Missing tenant_id")
    if provider not in {"bolt", "wolt"}:
        raise HTTPException(status_code=400, detail="Provider must be 'bolt' or 'wolt'")
    if not order_id:
        raise HTTPException(status_code=400, detail="Missing order_id")

    tenant = db.query(Tenant).filter(Tenant.id == target_tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    from app.routers.integrations import process_delivery_order_logic
    
    try:
        result = await process_delivery_order_logic(
            db=db,
            tenant=tenant,
            provider=provider,
            order_id=order_id,
            raw_items=raw_items,
        )
        return result
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


