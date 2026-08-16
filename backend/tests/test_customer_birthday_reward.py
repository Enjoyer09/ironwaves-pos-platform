"""
P1-2 Birthday reward — real SQLite tests.

Covers:
  - full grant flow (stars + lifetime_stars + ledger + notification + push)
  - year-based ledger idempotency (no double grant)
  - disabled tenant (birthday_enabled default False) -> no grant
  - customers without birth_date are skipped
  - per-tenant "today" is honored by the scan
  - POST /customer-app/profile/birthday validation (format/past/age/session)
  - session exposes birth_date
  - settings PATCH accepts birthday_enabled / birthday_bonus_stars
  - daily guard marker roundtrip
"""
import importlib
import json
import os
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import (
    Base,
    Customer,
    LoyaltyLedgerEntry,
    Notification,
    Setting,
    Tenant,
)
from app.services import birthday_scheduler as bd


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


def _make_db():
    """Real in-memory SQLite with a shared connection (StaticPool)."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    return engine, db


def _seed_tenant(
    db,
    *,
    tenant_id: str = "tenant-1",
    birthday_enabled: bool = True,
    bonus: int = 5,
):
    tenant = Tenant(
        id=tenant_id,
        name="iRonWaves",
        slug=f"ironwaves-{tenant_id}",
        domain=f"{tenant_id}.ironwaves.store",
    )
    db.add(tenant)
    if birthday_enabled is not None:
        db.add(
            Setting(
                tenant_id=tenant.id,
                key="customer_app_settings",
                value=json.dumps(
                    {
                        "enabled": True,
                        "program_mode": "points",
                        "birthday_enabled": birthday_enabled,
                        "birthday_bonus_stars": bonus,
                    },
                    ensure_ascii=False,
                ),
            )
        )
    db.commit()
    return tenant


def _seed_customer(
    db,
    tenant: Tenant,
    *,
    card_id: str = "QR-BDAY1234",
    birth_date: date | None = date(1995, 8, 16),
    stars: int = 10,
    lifetime_stars: int = 10,
    push_token: str | None = "fcm:test-token",
) -> Customer:
    customer = Customer(
        id=f"cust-{card_id}",
        tenant_id=tenant.id,
        card_id=card_id,
        secret_token="tok-abc",
        stars=stars,
        lifetime_stars=lifetime_stars,
        type="golden",
        birth_date=birth_date,
        push_token=push_token,
    )
    db.add(customer)
    db.commit()
    return customer


# ──────────────────────────────────────────
# Grant flow
# ──────────────────────────────────────────

def test_birthday_grant_full_flow(monkeypatch):
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 8, 16))

    push_calls: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        "app.routers.pos.send_push_notification",
        lambda token, title, body: push_calls.append((token, title, body)),
    )

    result = bd.run_birthday_scan(db, today=date(2026, 8, 16))

    assert result["granted"] == 1
    assert result["notified"] == 1
    assert result["skipped"] == 0
    assert result["scanned_tenants"] == 1

    db.refresh(customer)
    assert customer.stars == 15
    assert customer.lifetime_stars == 15  # tier progression counts birthday stars

    ledger = (
        db.query(LoyaltyLedgerEntry)
        .filter(LoyaltyLedgerEntry.tenant_id == tenant.id, LoyaltyLedgerEntry.card_id == customer.card_id)
        .all()
    )
    assert len(ledger) == 1
    assert ledger[0].unit == "birthday"
    assert ledger[0].entry_type == "earn"
    assert ledger[0].amount == Decimal(5)
    assert ledger[0].description == "Birthday bonus 2026"

    notif = (
        db.query(Notification)
        .filter(Notification.tenant_id == tenant.id, Notification.card_id == customer.card_id)
        .first()
    )
    assert notif is not None
    assert "+5" in notif.message

    assert push_calls == [("fcm:test-token", "Doğum gününüz mübarək! 🎂", "+5 ★ hesabınıza əlavə edildi")]

    db.close()
    engine.dispose()


def test_birthday_grant_idempotent_same_year(monkeypatch):
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 8, 16))

    monkeypatch.setattr("app.routers.pos.send_push_notification", lambda *a, **k: None)

    first = bd.run_birthday_scan(db, today=date(2026, 8, 16))
    second = bd.run_birthday_scan(db, today=date(2026, 8, 16))

    assert first["granted"] == 1
    # Same year -> ledger idempotency blocks the second grant
    assert second["granted"] == 0
    assert second["skipped"] == 1

    db.refresh(customer)
    assert customer.stars == 15  # only +5, not +10
    assert customer.lifetime_stars == 15

    count = (
        db.query(LoyaltyLedgerEntry)
        .filter(
            LoyaltyLedgerEntry.tenant_id == tenant.id,
            LoyaltyLedgerEntry.card_id == customer.card_id,
            LoyaltyLedgerEntry.unit == "birthday",
        )
        .count()
    )
    assert count == 1

    db.close()
    engine.dispose()


def test_birthday_next_year_grants_again():
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 8, 16))

    bd.run_birthday_scan(db, today=date(2026, 8, 16))
    db.refresh(customer)
    assert customer.stars == 15

    # Next year -> a new ledger year, grant happens again
    bd.run_birthday_scan(db, today=date(2027, 8, 16))
    db.refresh(customer)
    assert customer.stars == 20

    descriptions = [
        r.description
        for r in db.query(LoyaltyLedgerEntry)
        .filter(LoyaltyLedgerEntry.card_id == customer.card_id)
        .all()
    ]
    assert "Birthday bonus 2026" in descriptions
    assert "Birthday bonus 2027" in descriptions

    db.close()
    engine.dispose()


# ──────────────────────────────────────────
# Skipped cases
# ──────────────────────────────────────────

def test_birthday_disabled_tenant_skipped():
    _bootstrap_env()
    engine, db = _make_db()
    # birthday_enabled explicitly False (default behaviour)
    tenant = _seed_tenant(db, birthday_enabled=False)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 8, 16))

    result = bd.run_birthday_scan(db, today=date(2026, 8, 16))

    assert result["granted"] == 0
    db.refresh(customer)
    assert customer.stars == 10  # untouched
    assert customer.lifetime_stars == 10
    assert (
        db.query(LoyaltyLedgerEntry)
        .filter(LoyaltyLedgerEntry.tenant_id == tenant.id, LoyaltyLedgerEntry.card_id == customer.card_id)
        .count()
    ) == 0
    assert (
        db.query(Notification)
        .filter(Notification.tenant_id == tenant.id, Notification.card_id == customer.card_id)
        .count()
    ) == 0

    db.close()
    engine.dispose()


def test_birthday_no_setting_defaults_disabled():
    """Tenant without customer_app_settings row -> default birthday_enabled=False."""
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db, birthday_enabled=None)  # no settings row
    customer = _seed_customer(db, tenant, birth_date=date(1995, 8, 16))

    result = bd.run_birthday_scan(db, today=date(2026, 8, 16))

    assert result["granted"] == 0
    db.refresh(customer)
    assert customer.stars == 10

    db.close()
    engine.dispose()


def test_birthday_no_birth_date_skipped():
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=None)

    result = bd.run_birthday_scan(db, today=date(2026, 8, 16))

    assert result["granted"] == 0
    db.refresh(customer)
    assert customer.stars == 10  # untouched

    db.close()
    engine.dispose()


def test_birthday_wrong_month_skipped():
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 1, 1))

    result = bd.run_birthday_scan(db, today=date(2026, 8, 16))

    assert result["granted"] == 0
    db.refresh(customer)
    assert customer.stars == 10

    db.close()
    engine.dispose()


def test_birthday_custom_bonus_and_scan_uses_tenant_today(monkeypatch):
    """
    (a) custom birthday_bonus_stars from settings is honored;
    (b) the scan uses the per-tenant 'today' (monkeypatched) instead of a
        hard-coded date — proving timezone-aware behaviour.
    """
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db, birthday_enabled=True, bonus=10)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 12, 31))

    monkeypatch.setattr(
        "app.services.birthday_scheduler._tenant_today",
        lambda db_, tenant_: date(2026, 12, 31),
    )
    monkeypatch.setattr("app.routers.pos.send_push_notification", lambda *a, **k: None)

    result = bd.run_birthday_scan(db, today=None)  # no override -> per-tenant today

    assert result["granted"] == 1
    db.refresh(customer)
    assert customer.stars == 20  # +10 custom bonus
    assert customer.lifetime_stars == 20

    db.close()
    engine.dispose()


# ──────────────────────────────────────────
# Profile endpoint
# ──────────────────────────────────────────

def test_birthday_profile_endpoint_valid_and_session():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=None)
    admin = type("U", (), {"username": "admin-1", "role": "admin"})()

    # Set a valid birth date (clearly past, adult)
    res = operations.update_customer_birthday(
        payload=operations.CustomerBirthdayIn(birth_date="1995-05-10"),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert res["success"] is True
    assert res["birth_date"] == "1995-05-10"

    db.refresh(customer)
    assert customer.birth_date == date(1995, 5, 10)

    # Session exposes birth_date (additive field)
    session = operations.get_customer_app_session(
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert session["customer"]["birth_date"] == "1995-05-10"

    # Overwrite works (edit path)
    res = operations.update_customer_birthday(
        payload=operations.CustomerBirthdayIn(birth_date="1990-01-01"),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert res["success"] is True
    db.refresh(customer)
    assert customer.birth_date == date(1990, 1, 1)

    db.close()
    engine.dispose()


def test_birthday_profile_endpoint_validation():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=None)

    def _call(birth_date: str):
        return operations.update_customer_birthday(
            payload=operations.CustomerBirthdayIn(birth_date=birth_date),
            id=customer.card_id,
            t=customer.secret_token,
            db=db,
            tenant=tenant,
        )

    # Bad format
    with pytest.raises(HTTPException) as exc:
        _call("10-05-1995")
    assert exc.value.status_code == 400

    # Not a real date
    with pytest.raises(HTTPException) as exc:
        _call("1995-13-45")
    assert exc.value.status_code == 400

    # Future date
    future = operations._restaurant_now().date() + timedelta(days=365)
    with pytest.raises(HTTPException) as exc:
        _call(future.isoformat())
    assert exc.value.status_code == 400

    # Today -> not in the past
    with pytest.raises(HTTPException) as exc:
        _call(operations._restaurant_now().date().isoformat())
    assert exc.value.status_code == 400

    # Too young (2 days ago)
    young = operations._restaurant_now().date() - timedelta(days=2)
    with pytest.raises(HTTPException) as exc:
        _call(young.isoformat())
    assert exc.value.status_code == 400

    # Nothing persisted after all rejections
    db.refresh(customer)
    assert customer.birth_date is None

    # Invalid session -> 401
    with pytest.raises(HTTPException) as exc:
        operations.update_customer_birthday(
            payload=operations.CustomerBirthdayIn(birth_date="1995-05-10"),
            id=customer.card_id,
            t="wrong-token",
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 401

    db.close()
    engine.dispose()


# ──────────────────────────────────────────
# Settings PATCH + guard marker
# ──────────────────────────────────────────

def test_birthday_settings_patch_accepts_keys():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db, birthday_enabled=None)
    admin = type("U", (), {"username": "admin-1", "role": "admin"})()

    res = operations.update_customer_app_settings(
        payload={
            "birthday_enabled": True,
            "birthday_bonus_stars": 7,
        },
        db=db,
        tenant=tenant,
        user=admin,
    )
    assert res["success"] is True

    row = (
        db.query(Setting)
        .filter(Setting.tenant_id == tenant.id, Setting.key == "customer_app_settings")
        .first()
    )
    saved = json.loads(row.value)
    assert saved["birthday_enabled"] is True
    assert saved["birthday_bonus_stars"] == 7

    db.close()
    engine.dispose()


def test_birthday_daily_guard_marker_roundtrip():
    _bootstrap_env()
    engine, db = _make_db()
    tenant = Tenant(
        id="tenant-super",
        name="Super",
        slug="super",
        domain="super.ironwaves.store",
    )
    db.add(tenant)
    db.commit()

    assert bd._get_guard_date(db, tenant.id) is None

    bd._set_guard_date(db, tenant.id, "2026-08-16")
    db.commit()
    assert bd._get_guard_date(db, tenant.id) == "2026-08-16"

    # Overwrite next day
    bd._set_guard_date(db, tenant.id, "2026-08-17")
    db.commit()
    assert bd._get_guard_date(db, tenant.id) == "2026-08-17"

    db.close()
    engine.dispose()
