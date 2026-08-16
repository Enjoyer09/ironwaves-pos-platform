"""
Tests for the tier system (P1-1a):

    lifetime_stars (migration backfilled from stars)
      -> _compute_tier derives Bronze/Silver/Gold + progress
      -> session exposes tier + lifetime_stars
      -> POS points-mode sales increment lifetime_stars (never reduced by redemption)

Uses a real in-memory SQLite database; finance posting is mocked so the sale
flow can reach the loyalty-earn section.
"""
import importlib
import os
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Customer, Setting, Tenant


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


def _make_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    return engine, db


def _seed_tenant_customer(db, *, stars: int = 10, lifetime_stars: int = 150) -> tuple[Tenant, Customer]:
    tenant = Tenant(
        id="tenant-1",
        name="iRonWaves",
        slug="ironwaves",
        domain="super.ironwaves.store",
    )
    customer = Customer(
        id="cust-1",
        tenant_id=tenant.id,
        card_id="QR-TEST1234",
        secret_token="tok-abc",
        stars=stars,
        lifetime_stars=lifetime_stars,
        type="golden",
        push_token=None,
    )
    db.add_all([tenant, customer])
    db.commit()
    return tenant, customer


# ── _compute_tier unit boundaries ─────────────────────────────────────────────

def test_compute_tier_boundaries():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    default_tiers = operations.DEFAULT_TIERS

    bronze = operations._compute_tier(0, default_tiers)
    assert bronze["key"] == "bronze"
    assert bronze["current_threshold"] == 0
    assert bronze["next_threshold"] == 100
    assert bronze["progress_pct"] == 0

    bronze_99 = operations._compute_tier(99, default_tiers)
    assert bronze_99["key"] == "bronze"
    assert bronze_99["progress_pct"] == 99

    silver = operations._compute_tier(100, default_tiers)
    assert silver["key"] == "silver"
    assert silver["current_threshold"] == 100
    assert silver["next_threshold"] == 300
    assert silver["progress_pct"] == 0

    silver_299 = operations._compute_tier(299, default_tiers)
    assert silver_299["key"] == "silver"
    assert silver_299["progress_pct"] == 99

    gold = operations._compute_tier(300, default_tiers)
    assert gold["key"] == "gold"
    assert gold["next_threshold"] is None
    assert gold["progress_pct"] == 100
    assert gold["multiplier"] == 1.5

    # legacy: negative/None lifetime still lands on the lowest tier
    legacy = operations._compute_tier(-5, default_tiers)
    assert legacy["key"] == "bronze"
    assert legacy["progress_pct"] == 0


def test_compute_tier_custom_config():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    custom = [
        {"key": "newbie", "label": {"az": "Yeni", "en": "New"}, "threshold": 0, "color": "#111111", "multiplier": 1},
        {"key": "vip", "label": {"az": "VIP", "en": "VIP"}, "threshold": 50, "color": "#ff00ff", "multiplier": 2},
    ]
    tier = operations._compute_tier(50, custom)
    assert tier["key"] == "vip"
    assert tier["current_threshold"] == 50
    assert tier["next_threshold"] is None
    assert tier["progress_pct"] == 100

    # empty/malformed config falls back to defaults
    assert operations._compute_tier(350, None)["key"] == "gold"
    assert operations._compute_tier(200, [{"nokey": True}])["key"] == "silver"


# ── session exposes tier + lifetime_stars ─────────────────────────────────────

def test_session_returns_tier_and_lifetime_stars():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=10, lifetime_stars=150)

    session = operations.get_customer_app_session(
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    cust = session["customer"]
    assert cust["lifetime_stars"] == 150
    assert cust["tier"]["key"] == "silver"
    assert cust["tier"]["label"]["az"] == "Gümüş"
    assert cust["tier"]["next_threshold"] == 300
    assert cust["tier"]["progress_pct"] == 25  # (150-100)/(300-100) = 25%

    db.close()
    engine.dispose()


def test_session_legacy_customer_default_tier():
    """Customers created before lifetime_stars existed must not crash and get Bronze."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=7, lifetime_stars=0)

    session = operations.get_customer_app_session(
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    cust = session["customer"]
    assert cust["lifetime_stars"] == 0
    assert cust["tier"]["key"] == "bronze"
    assert cust["tier"]["progress_pct"] == 0

    db.close()
    engine.dispose()


def test_session_tier_uses_tenant_tiers_config():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=10, lifetime_stars=25)
    db.add(
        Setting(
            id="set-1",
            tenant_id=tenant.id,
            key="customer_app_settings",
            value='{"tiers": [{"key": "a", "label": {"az": "A", "en": "A"}, "threshold": 0, "color": "#000000", "multiplier": 1}, {"key": "b", "label": {"az": "B", "en": "B"}, "threshold": 20, "color": "#ffffff", "multiplier": 1}]}',
        )
    )
    db.commit()

    session = operations.get_customer_app_session(
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert session["customer"]["tier"]["key"] == "b"
    assert session["customer"]["tier"]["next_threshold"] is None

    db.close()
    engine.dispose()


# ── POS points-mode earn increments lifetime_stars ────────────────────────────

def test_points_sale_earn_increments_lifetime_stars(monkeypatch):
    _bootstrap_env()
    pos = importlib.import_module("app.routers.pos")
    from app.schemas import SaleCreateIn, SaleItemIn

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=3, lifetime_stars=40)

    # Reach the loyalty-earn section: shift/commission guards + finance posting.
    monkeypatch.setattr(pos, "_active_shift", lambda *_: True)
    monkeypatch.setattr(pos, "_staff_shift_session_open", lambda *_: True)
    monkeypatch.setattr(pos, "_bank_commission_config", lambda *_: (Decimal("0"), Decimal("0")))
    monkeypatch.setattr(pos, "post_sale_payment", lambda *a, **k: None)
    monkeypatch.setattr(pos, "post_sale_cogs", lambda *a, **k: None)

    user = SimpleNamespace(username="cashier-1", role="admin")
    payload = SaleCreateIn(
        cart_items=[
            SaleItemIn(item_name="Espresso", price=Decimal("4.00"), qty=2, category="Qəhvə", is_coffee=True),
        ],
        payment_method="Cash",
        customer_card_id=customer.card_id,
    )
    res = pos.create_sale(payload=payload, db=db, tenant=tenant, user=user)
    assert res["sale_id"]

    db.refresh(customer)
    assert customer.lifetime_stars == 42  # 40 + 2 coffee qty
    assert customer.stars == 5  # 3 + 2

    db.close()
    engine.dispose()


def test_points_sale_without_coffee_leaves_lifetime_unchanged(monkeypatch):
    _bootstrap_env()
    pos = importlib.import_module("app.routers.pos")
    from app.schemas import SaleCreateIn, SaleItemIn

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=3, lifetime_stars=40)

    monkeypatch.setattr(pos, "_active_shift", lambda *_: True)
    monkeypatch.setattr(pos, "_staff_shift_session_open", lambda *_: True)
    monkeypatch.setattr(pos, "_bank_commission_config", lambda *_: (Decimal("0"), Decimal("0")))
    monkeypatch.setattr(pos, "post_sale_payment", lambda *a, **k: None)
    monkeypatch.setattr(pos, "post_sale_cogs", lambda *a, **k: None)

    user = SimpleNamespace(username="cashier-1", role="admin")
    payload = SaleCreateIn(
        cart_items=[
            SaleItemIn(item_name="Tiramisu", price=Decimal("6.00"), qty=1, category="Şirniyyat", is_coffee=False),
        ],
        payment_method="Cash",
        customer_card_id=customer.card_id,
    )
    pos.create_sale(payload=payload, db=db, tenant=tenant, user=user)

    db.refresh(customer)
    assert customer.lifetime_stars == 40  # non-coffee items do not earn stars
    assert customer.stars == 3

    db.close()
    engine.dispose()
