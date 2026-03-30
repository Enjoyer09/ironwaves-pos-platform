from datetime import datetime
import re

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import Base, engine, SessionLocal
from app.models import BusinessProfile, InventoryItem, MenuItem, Recipe, Setting, Table, Tenant, User
from app.routers import analytics_api, auth, catalog, finance, operations, pos, reports, settings as settings_router, tenants
from app.security import hash_password


app = FastAPI(title=settings.app_name)


def _sync_tenant_domain(db: Session, tenant_id: str, domain: str) -> None:
    safe_domain = str(domain or "").strip().lower()
    if not tenant_id or not safe_domain:
        return
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
            {"domain": safe_domain, "tenant_id": tenant_id},
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
                {"domain": safe_domain, "tenant_id": tenant_id},
            )
        except Exception:
            pass


def _parse_cors_origins(raw: str) -> list[str]:
    items = [v.strip() for v in str(raw or '').split(',') if v.strip()]
    return items or ["http://localhost:5173"]


def _build_cors_regex(origins: list[str]) -> str | None:
    wildcard_patterns: list[str] = []
    for origin in origins:
        if "*" not in origin or origin == "*":
            continue
        escaped = re.escape(origin)
        wildcard_patterns.append(escaped.replace(r"\*", r"[^.]+"))
    if not wildcard_patterns:
        return None
    return "^(" + "|".join(wildcard_patterns) + ")$"


_origins = _parse_cors_origins(settings.cors_origins)
_cors_regex = _build_cors_regex(_origins)
_exact_origins = [origin for origin in _origins if "*" not in origin or origin == "*"]
_allow_credentials = not (_origins == ["*"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_exact_origins,
    allow_origin_regex=_cors_regex,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _seed_initial_data(db: Session):
    default_tenant = None
    if settings.seed_default_tenant or settings.single_tenant_mode:
        default_tenant = db.query(Tenant).filter(Tenant.slug == settings.default_tenant_slug).first()
        if not default_tenant:
            default_tenant = Tenant(
                name=settings.default_tenant_name,
                slug=settings.default_tenant_slug,
                domain=settings.default_tenant_domain,
                status="active",
                created_at=datetime.utcnow(),
            )
            db.add(default_tenant)
            db.flush()
        _sync_tenant_domain(db, default_tenant.id, default_tenant.domain)

    platform_tenant = db.query(Tenant).filter(Tenant.slug == settings.platform_tenant_slug).first()
    if not platform_tenant:
        platform_tenant = Tenant(
            name=settings.platform_tenant_name,
            slug=settings.platform_tenant_slug,
            domain=settings.platform_tenant_domain,
            status="active",
            created_at=datetime.utcnow(),
        )
        db.add(platform_tenant)
        db.flush()
    _sync_tenant_domain(db, platform_tenant.id, platform_tenant.domain)

    (
        db.query(User)
        .filter(User.role == "super_admin", User.tenant_id != platform_tenant.id)
        .update({"role": "admin"}, synchronize_session=False)
    )

    super_exists = (
        db.query(User)
        .filter(User.tenant_id == platform_tenant.id, User.username == settings.superadmin_username)
        .first()
    )
    if not super_exists:
        db.add(
            User(
                tenant_id=platform_tenant.id,
                username=settings.superadmin_username,
                email=settings.superadmin_email,
                password_hash=hash_password(settings.superadmin_password),
                role="super_admin",
                is_active=True,
            )
        )
    elif settings.reset_superadmin_on_startup:
        # Opt-in only: keep platform owner recoverable without overwriting prod credentials by default.
        super_exists.password_hash = hash_password(settings.superadmin_password)
        super_exists.role = "super_admin"
        super_exists.is_active = True
        super_exists.failed_attempts = 0
        super_exists.locked_until = None

    # Demo PIN users are opt-in only so production deployments never get weak seeded accounts.
    if settings.seed_demo_users and default_tenant:
        staff_seed = [
            ("barista", "1234", "staff"),
            ("barista2", "5678", "staff"),
        ]
        for username, pin, role in staff_seed:
            row = (
                db.query(User)
                .filter(User.tenant_id == default_tenant.id, User.username == username)
                .first()
            )
            if not row:
                db.add(
                    User(
                        tenant_id=default_tenant.id,
                        username=username,
                        email=None,
                        password_hash=hash_password(pin),
                        pin_hash=hash_password(pin),
                        role=role,
                        is_active=True,
                    )
                )
            elif not row.pin_hash:
                row.pin_hash = hash_password(pin)
    db.commit()


def _ensure_demo_user(
    db: Session,
    tenant_id: str,
    username: str,
    password: str,
    role: str,
    pin: str | None = None,
):
    row = db.query(User).filter(User.tenant_id == tenant_id, User.username == username).first()
    if not row:
        row = User(
            tenant_id=tenant_id,
            username=username,
            email=None,
            password_hash=hash_password(password),
            pin_hash=hash_password(pin or password) if pin or role in {"staff", "kitchen"} else None,
            role=role,
            is_active=True,
        )
        db.add(row)
        return

    if settings.reset_demo_users_on_startup:
        row.password_hash = hash_password(password)
        row.pin_hash = hash_password(pin or password) if pin or role in {"staff", "kitchen"} else row.pin_hash
        row.role = role
        row.is_active = True
        row.failed_attempts = 0
        row.locked_until = None


def _seed_demo_tenant(db: Session):
    if not settings.demo_tenant_enabled:
        return

    tenant = db.query(Tenant).filter(Tenant.slug == settings.demo_tenant_slug).first()
    if not tenant:
        tenant = Tenant(
            name=settings.demo_tenant_name,
            slug=settings.demo_tenant_slug,
            domain=settings.demo_tenant_domain,
            status="active",
            created_at=datetime.utcnow(),
        )
        db.add(tenant)
        db.flush()
    _sync_tenant_domain(db, tenant.id, tenant.domain)

    _ensure_demo_user(db, tenant.id, settings.demo_admin_username, settings.demo_admin_password, "admin")
    _ensure_demo_user(db, tenant.id, settings.demo_manager_username, settings.demo_manager_password, "manager")
    _ensure_demo_user(db, tenant.id, settings.demo_staff_username, settings.demo_staff_pin, "staff", settings.demo_staff_pin)
    _ensure_demo_user(db, tenant.id, settings.demo_kitchen_username, settings.demo_kitchen_pin, "kitchen", settings.demo_kitchen_pin)

    if db.query(MenuItem).filter(MenuItem.tenant_id == tenant.id).count() == 0:
        db.add_all(
            [
                MenuItem(tenant_id=tenant.id, item_name="Espresso", category="Coffee", price="3.00", is_coffee=True, is_active=True),
                MenuItem(tenant_id=tenant.id, item_name="Americano", category="Coffee", price="4.00", is_coffee=True, is_active=True),
                MenuItem(tenant_id=tenant.id, item_name="Cappuccino", category="Coffee", price="4.80", is_coffee=True, is_active=True),
                MenuItem(tenant_id=tenant.id, item_name="Cheesecake", category="Dessert", price="6.50", is_coffee=False, is_active=True),
            ]
        )

    if db.query(Table).filter(Table.tenant_id == tenant.id).count() == 0:
        db.add_all(
            [
                Table(tenant_id=tenant.id, label="Table 1", is_occupied=False, total="0", items_json="[]"),
                Table(tenant_id=tenant.id, label="Table 2", is_occupied=False, total="0", items_json="[]"),
                Table(tenant_id=tenant.id, label="Table 3", is_occupied=False, total="0", items_json="[]"),
            ]
        )

    if db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant.id).count() == 0:
        db.add_all(
            [
                InventoryItem(tenant_id=tenant.id, name="Coffee Beans", unit="kq", category="Raw Material", stock_qty="3.000", unit_cost="18.0000", min_limit="1.000"),
                InventoryItem(tenant_id=tenant.id, name="Milk", unit="litr", category="Raw Material", stock_qty="20.000", unit_cost="2.2000", min_limit="8.000"),
                InventoryItem(tenant_id=tenant.id, name="Paper Cup", unit="ədəd", category="Packaging", stock_qty="150.000", unit_cost="0.1000", min_limit="60.000"),
            ]
        )

    if db.query(Recipe).filter(Recipe.tenant_id == tenant.id).count() == 0:
        db.add_all(
            [
                Recipe(tenant_id=tenant.id, menu_item_name="Espresso", ingredient_name="Coffee Beans", quantity_required="0.0180"),
                Recipe(tenant_id=tenant.id, menu_item_name="Americano", ingredient_name="Coffee Beans", quantity_required="0.0180"),
                Recipe(tenant_id=tenant.id, menu_item_name="Cappuccino", ingredient_name="Coffee Beans", quantity_required="0.0180"),
                Recipe(tenant_id=tenant.id, menu_item_name="Cappuccino", ingredient_name="Milk", quantity_required="0.1800"),
            ]
        )

    if db.query(Setting).filter(Setting.tenant_id == tenant.id, Setting.key == "qr_settings").count() == 0:
        db.add(Setting(tenant_id=tenant.id, key="qr_settings", value=f'{{"base_url":"https://{tenant.domain}"}}'))

    if not db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).first():
        db.add(
            BusinessProfile(
                tenant_id=tenant.id,
                company_name=settings.demo_tenant_name,
                website=f"https://{tenant.domain}",
                phone="+994 00 000 00 00",
                address="Demo Showroom",
                receipt_footer="Demo environment for iRonWaves POS RC",
            )
        )

    db.commit()


def _run_startup_migrations():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS cogs NUMERIC(12,4) DEFAULT 0"))
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS offline_request_id VARCHAR(64)"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64)"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE"))
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_tenant_offline_request_id "
                "ON sales (tenant_id, offline_request_id)"
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS staff_notifications (
                    id VARCHAR(36) PRIMARY KEY,
                    tenant_id VARCHAR(36) NOT NULL,
                    username VARCHAR(80) NOT NULL,
                    title VARCHAR(120) NOT NULL,
                    message TEXT NOT NULL,
                    meta_json TEXT NULL,
                    is_read BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_staff_notifications_tenant_id ON staff_notifications (tenant_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_staff_notifications_username ON staff_notifications (username)"))


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    _run_startup_migrations()
    with SessionLocal() as db:
        _seed_initial_data(db)
        _seed_demo_tenant(db)


@app.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name}


app.include_router(auth.router)
app.include_router(pos.router)
app.include_router(finance.router)
app.include_router(catalog.router)
app.include_router(operations.router)
app.include_router(analytics_api.router)
app.include_router(reports.router)
app.include_router(tenants.router)
app.include_router(settings_router.router)
