"""P1.6 / P2.3 — pillə (tier) endirimi kassanın `max()` yarışına girir.

Real SQLite (yuxarıdakı P1-4b həsbi ilə): `find_tier_discount` eyni pilləni
`find_tier_multiplier` ilə seçir, satış total-ı pillə faizinə enir, daha güclü
manual endirim qazandığında pillə səssizcə geri çəkilir (max-wins). Default
nərdivan (endirimlərsiz) mövcud total-ı heç vaxt dəyişmir.
"""
import importlib
import json
from decimal import Decimal

from app.models import Setting
from test_customer_campaign_activation import (
    _bootstrap_env,
    _create_sale,
    _make_db,
    _seed_customer,
    _seed_tenant,
)

#: DEFAULT_TIERS formatı + Gold-a 5% (panelin `CustomerAppPanel` sahəsi ilə eyni sahə).
TIERS_WITH_GOLD_DISCOUNT = {
    "program_mode": "points",
    "tiers": [
        {"key": "bronze", "threshold": 0, "discount_percent": 0},
        {"key": "gold", "threshold": 300, "discount_percent": 5},
    ],
}


def _seed_tiers(db, tenant) -> None:
    db.add(
        Setting(
            tenant_id=tenant.id,
            key="customer_app_settings",
            value=json.dumps(TIERS_WITH_GOLD_DISCOUNT, ensure_ascii=False),
        )
    )
    db.commit()


def _make_customer(db, tenant, *, lifetime_stars: int):
    customer = _seed_customer(db, tenant)
    customer.lifetime_stars = lifetime_stars
    db.commit()
    return customer


def test_tier_discount_applies_when_it_is_the_highest(monkeypatch):
    """300 ulduz → Gold 5%: 8.00 AZN satış 7.60 olur."""
    _bootstrap_env()
    pos = importlib.import_module("app.routers.pos")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _make_customer(db, tenant, lifetime_stars=300)
    _seed_tiers(db, tenant)

    res = _create_sale(pos, db, tenant, customer_card_id=customer.card_id, monkeypatch=monkeypatch)

    assert res["total"] == Decimal("7.60")

    db.close()
    engine.dispose()


def test_tier_loses_to_a_higher_manual_discount(monkeypatch):
    """Max-wins: 10% manual endirim > Gold 5% → 8.00 - 0.80 = 7.20."""
    _bootstrap_env()
    pos = importlib.import_module("app.routers.pos")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _make_customer(db, tenant, lifetime_stars=300)
    _seed_tiers(db, tenant)

    res = _create_sale(
        pos,
        db,
        tenant,
        customer_card_id=customer.card_id,
        discount_percent=10,
        discount_reason="Menecer",
        monkeypatch=monkeypatch,
    )

    assert res["total"] == Decimal("7.20")

    db.close()
    engine.dispose()


def test_low_tier_and_default_settings_change_nothing(monkeypatch):
    """Bürünc (0%) + nərdivansız default: total 8.00 qalır — geriyə uyğunluq."""
    _bootstrap_env()
    pos = importlib.import_module("app.routers.pos")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _make_customer(db, tenant, lifetime_stars=300)
    _seed_tiers(db, tenant)  # Gold 5% var, amma sətir 100 ulduz → bürünc 0%

    customer.lifetime_stars = 100
    db.commit()
    res = _create_sale(pos, db, tenant, customer_card_id=customer.card_id, monkeypatch=monkeypatch)
    assert res["total"] == Decimal("8.00")

    db.close()
    engine.dispose()
