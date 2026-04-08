from datetime import datetime
import re

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import Base, engine, SessionLocal
from app.models import BusinessProfile, InventoryItem, MenuItem, Recipe, Setting, Table, Tenant, User
from app.realtime import realtime_hub
from app.routers import analytics_api, auth, catalog, finance, operations, pos, reports, restaurant, settings as settings_router, tenants
from app.security import decode_token, hash_password


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

    active_platform_superadmin = (
        db.query(User)
        .filter(User.tenant_id == platform_tenant.id, User.role == "super_admin", User.is_active == True)  # noqa: E712
        .first()
    )
    super_exists = (
        db.query(User)
        .filter(User.tenant_id == platform_tenant.id, User.username == settings.superadmin_username)
        .first()
    )
    if not super_exists and not active_platform_superadmin:
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
                receipt_footer="Demo environment for iRonWaves POS",
            )
        )

    db.commit()


def _run_startup_migrations():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT"))
        conn.execute(text("ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS description TEXT"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(80)"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS floor_plan_id VARCHAR(36)"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS shape VARCHAR(32) DEFAULT 'rectangle'"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS pos_x INTEGER DEFAULT 0"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS pos_y INTEGER DEFAULT 0"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS width_units INTEGER DEFAULT 2"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS height_units INTEGER DEFAULT 2"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 4"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS status VARCHAR(24) DEFAULT 'AVAILABLE'"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS merged_group_id VARCHAR(36)"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS locked_by VARCHAR(80)"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS active_session_id VARCHAR(36)"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS guest_count INTEGER DEFAULT 0"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS deposit_guest_count INTEGER DEFAULT 0"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,2) DEFAULT 0"))
        conn.execute(text("ALTER TABLE tables ADD COLUMN IF NOT EXISTS deposit_seats_json TEXT"))
        conn.execute(text("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS opening_source VARCHAR(24)"))
        conn.execute(text("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS opening_target_cash NUMERIC(12,2) DEFAULT 0"))
        conn.execute(text("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS opening_topup_amount NUMERIC(12,2) DEFAULT 0"))
        conn.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS status_reason TEXT"))
        conn.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS action_by VARCHAR(80)"))
        conn.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS manager_approved_by VARCHAR(80)"))
        conn.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS parent_item_id VARCHAR(36)"))
        conn.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS served_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_consumed_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_consumption_reason VARCHAR(80)"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS item_status_logs (
                id VARCHAR(36) PRIMARY KEY,
                tenant_id VARCHAR(36) REFERENCES tenants(id),
                order_item_id VARCHAR(36) REFERENCES order_items(id),
                check_id VARCHAR(36),
                round_id VARCHAR(36),
                action_type VARCHAR(40),
                old_status VARCHAR(24),
                new_status VARCHAR(24) NOT NULL,
                quantity_before INTEGER,
                quantity_after INTEGER,
                changed_by VARCHAR(80),
                approved_by VARCHAR(80),
                reason_code VARCHAR(80),
                reason TEXT,
                billing_effect VARCHAR(80),
                kitchen_effect VARCHAR(80),
                meta_json TEXT,
                changed_at TIMESTAMP
            )
        """))
        conn.execute(text("ALTER TABLE item_status_logs ADD COLUMN IF NOT EXISTS check_id VARCHAR(36)"))
        conn.execute(text("ALTER TABLE item_status_logs ADD COLUMN IF NOT EXISTS round_id VARCHAR(36)"))
        conn.execute(text("ALTER TABLE item_status_logs ADD COLUMN IF NOT EXISTS action_type VARCHAR(40)"))
        conn.execute(text("ALTER TABLE item_status_logs ADD COLUMN IF NOT EXISTS quantity_before INTEGER"))
        conn.execute(text("ALTER TABLE item_status_logs ADD COLUMN IF NOT EXISTS quantity_after INTEGER"))
        conn.execute(text("ALTER TABLE item_status_logs ADD COLUMN IF NOT EXISTS approved_by VARCHAR(80)"))
        conn.execute(text("ALTER TABLE item_status_logs ADD COLUMN IF NOT EXISTS reason_code VARCHAR(80)"))
        conn.execute(text("ALTER TABLE item_status_logs ADD COLUMN IF NOT EXISTS billing_effect VARCHAR(80)"))
        conn.execute(text("ALTER TABLE item_status_logs ADD COLUMN IF NOT EXISTS kitchen_effect VARCHAR(80)"))
        conn.execute(text("ALTER TABLE item_status_logs ADD COLUMN IF NOT EXISTS meta_json TEXT"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_item_status_logs_tenant_id ON item_status_logs (tenant_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_item_status_logs_order_item_id ON item_status_logs (order_item_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_item_status_logs_check_id ON item_status_logs (check_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_item_status_logs_round_id ON item_status_logs (round_id)"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS finance_accounts (
                id VARCHAR(36) PRIMARY KEY,
                tenant_id VARCHAR(36) REFERENCES tenants(id),
                code VARCHAR(40) NOT NULL,
                name VARCHAR(120) NOT NULL,
                account_type VARCHAR(40) NOT NULL,
                currency VARCHAR(8) NOT NULL DEFAULT 'AZN',
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP,
                CONSTRAINT uq_finance_account_tenant_code UNIQUE (tenant_id, code)
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_accounts_tenant_id ON finance_accounts (tenant_id)"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS finance_transactions (
                id VARCHAR(36) PRIMARY KEY,
                tenant_id VARCHAR(36) REFERENCES tenants(id),
                transaction_type VARCHAR(40) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'posted',
                source_account_id VARCHAR(36) REFERENCES finance_accounts(id),
                destination_account_id VARCHAR(36) REFERENCES finance_accounts(id),
                amount NUMERIC(12,2) NOT NULL,
                currency VARCHAR(8) NOT NULL DEFAULT 'AZN',
                category VARCHAR(120),
                counterparty VARCHAR(120),
                reference VARCHAR(120),
                note TEXT,
                created_by VARCHAR(80) NOT NULL,
                approved_by VARCHAR(80),
                posted_by VARCHAR(80),
                reversed_by VARCHAR(80),
                created_at TIMESTAMP,
                approved_at TIMESTAMP,
                posted_at TIMESTAMP,
                reversed_at TIMESTAMP,
                related_shift_id VARCHAR(36),
                related_table_id VARCHAR(36),
                related_order_id VARCHAR(36),
                legacy_finance_entry_id VARCHAR(36)
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_transactions_tenant_id ON finance_transactions (tenant_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_transactions_transaction_type ON finance_transactions (transaction_type)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_transactions_status ON finance_transactions (status)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_transactions_source_account_id ON finance_transactions (source_account_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_transactions_destination_account_id ON finance_transactions (destination_account_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_transactions_legacy_finance_entry_id ON finance_transactions (legacy_finance_entry_id)"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS finance_ledger_entries (
                id VARCHAR(36) PRIMARY KEY,
                tenant_id VARCHAR(36) REFERENCES tenants(id),
                transaction_id VARCHAR(36) REFERENCES finance_transactions(id),
                account_id VARCHAR(36) REFERENCES finance_accounts(id),
                entry_side VARCHAR(12) NOT NULL,
                amount NUMERIC(12,2) NOT NULL,
                currency VARCHAR(8) NOT NULL DEFAULT 'AZN',
                description TEXT,
                created_at TIMESTAMP
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_ledger_entries_tenant_id ON finance_ledger_entries (tenant_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_ledger_entries_transaction_id ON finance_ledger_entries (transaction_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_ledger_entries_account_id ON finance_ledger_entries (account_id)"))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS finance_reconciliations (
                id VARCHAR(36) PRIMARY KEY,
                tenant_id VARCHAR(36) REFERENCES tenants(id),
                account_id VARCHAR(36) REFERENCES finance_accounts(id),
                status VARCHAR(32) NOT NULL DEFAULT 'reconciled',
                expected_balance NUMERIC(12,2) NOT NULL,
                counted_balance NUMERIC(12,2) NOT NULL,
                variance NUMERIC(12,2) NOT NULL,
                notes TEXT,
                reconciled_by VARCHAR(80),
                reconciled_at TIMESTAMP,
                created_by VARCHAR(80) NOT NULL,
                created_at TIMESTAMP
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_reconciliations_tenant_id ON finance_reconciliations (tenant_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_reconciliations_account_id ON finance_reconciliations (account_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_finance_reconciliations_status ON finance_reconciliations (status)"))
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS cogs NUMERIC(12,4) DEFAULT 0"))
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS offline_request_id VARCHAR(64)"))
        conn.execute(text("ALTER TABLE sales ADD COLUMN IF NOT EXISTS reward_claim_code VARCHAR(32)"))
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
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS reward_claims (
                    id VARCHAR(36) PRIMARY KEY,
                    tenant_id VARCHAR(36) NOT NULL,
                    card_id VARCHAR(80) NOT NULL,
                    claim_code VARCHAR(32) NOT NULL UNIQUE,
                    reward_name VARCHAR(120) NOT NULL,
                    reward_description TEXT,
                    points_cost INTEGER DEFAULT 10,
                    status VARCHAR(16) DEFAULT 'PENDING',
                    redeemed_sale_id VARCHAR(36),
                    created_at TIMESTAMP DEFAULT NOW(),
                    redeemed_at TIMESTAMP
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS loyalty_ledger (
                    id VARCHAR(36) PRIMARY KEY,
                    tenant_id VARCHAR(36) NOT NULL,
                    card_id VARCHAR(80) NOT NULL,
                    unit VARCHAR(16) NOT NULL DEFAULT 'points',
                    entry_type VARCHAR(16) NOT NULL DEFAULT 'earn',
                    amount NUMERIC(12,2) DEFAULT 0,
                    source_sale_id VARCHAR(36),
                    description TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_staff_notifications_tenant_id ON staff_notifications (tenant_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_staff_notifications_username ON staff_notifications (username)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_loyalty_ledger_tenant_card ON loyalty_ledger (tenant_id, card_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tables_floor_plan_id ON tables (floor_plan_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tables_merged_group_id ON tables (merged_group_id)"))


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


@app.websocket("/ws/restaurant")
async def restaurant_ws(websocket: WebSocket):
    tenant_id = str(websocket.query_params.get("tenant_id") or "").strip()
    token = str(websocket.query_params.get("token") or "").strip()
    if not tenant_id or not token:
        await websocket.close(code=4401)
        return
    try:
        payload = decode_token(token)
    except Exception:
        await websocket.close(code=4401)
        return
    if payload.get("type") != "access" or str(payload.get("tenant_id") or "") != tenant_id:
        await websocket.close(code=4403)
        return

    await realtime_hub.connect(tenant_id, websocket)
    try:
        await websocket.send_json({"event": "realtime.connected", "tenant_id": tenant_id, "payload": {}})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await realtime_hub.disconnect(tenant_id, websocket)


app.include_router(auth.router)
app.include_router(pos.router)
app.include_router(finance.router)
app.include_router(catalog.router)
app.include_router(operations.router)
app.include_router(analytics_api.router)
app.include_router(reports.router)
app.include_router(restaurant.router)
app.include_router(tenants.router)
app.include_router(settings_router.router)
