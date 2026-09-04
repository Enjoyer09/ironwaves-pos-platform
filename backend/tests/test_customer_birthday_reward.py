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
  - P0.2: birthday_bonus_points is the canonical key (stars = legacy mirror/fallback),
    bonus 0 grants nothing, notification text uses the tenant's points_label
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

    # P0.2 — mətn artıq hardcoded "★" deyil, tenant-ın `points_label`-ından gəlir
    # (seed-də points_label yoxdur → program_mode='points' üçün fallback "Ulduz").
    assert push_calls == [("fcm:test-token", "Doğum gününüz mübarək! 🎂", "+5 Ulduz hesabınıza əlavə edildi")]

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


def test_birthday_profile_endpoint_clear_flow():
    """Doğum tarixi redaktə axını (P1-2b): təyin → sil (boş) → yenidən təyin."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=None)

    def _set(birth_date: str):
        return operations.update_customer_birthday(
            payload=operations.CustomerBirthdayIn(birth_date=birth_date),
            id=customer.card_id,
            t=customer.secret_token,
            db=db,
            tenant=tenant,
        )

    # 1. Set a birth date first
    res = _set("1995-05-10")
    assert res["success"] is True
    assert res["birth_date"] == "1995-05-10"
    db.refresh(customer)
    assert customer.birth_date == date(1995, 5, 10)

    # 2. Clear with empty string -> None (P1-2b 'leave empty to remove')
    res = _set("")
    assert res["success"] is True
    assert res["birth_date"] is None
    db.refresh(customer)
    assert customer.birth_date is None

    # Session no longer exposes a birth date
    session = operations.get_customer_app_session(
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert session["customer"]["birth_date"] is None

    # 3. Whitespace-only also clears (backend normalizes -> None)
    res = _set("   ")
    assert res["success"] is True
    assert res["birth_date"] is None
    db.refresh(customer)
    assert customer.birth_date is None

    # 4. Re-set works after clearing — birthday scheduler still sees it
    res = _set("1988-03-15")
    assert res["success"] is True
    assert res["birth_date"] == "1988-03-15"
    db.refresh(customer)
    assert customer.birth_date == date(1988, 3, 15)

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
    # P0.2 — köhnə `birthday_bonus_stars` dəyəri kanonik açara köçürülür və hər iki
    # açar həmin rəqəmi güzgüləyir (deploy sırasından asılılıq qalmır).
    assert saved["birthday_bonus_points"] == 7

    db.close()
    engine.dispose()


def test_birthday_settings_patch_points_key_is_canonical():
    """P0.2 — panel `birthday_bonus_points` yazır; stars ona uyğunlaşdırılır."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    # Köhnə tenant: yalnız stars yazılıb (5).
    tenant = _seed_tenant(db, birthday_enabled=True, bonus=5)
    admin = type("U", (), {"username": "admin-1", "role": "admin"})()

    res = operations.update_customer_app_settings(
        payload={"birthday_bonus_points": 20},
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
    assert saved["birthday_bonus_points"] == 20
    assert saved["birthday_bonus_stars"] == 20  # güzgü
    assert saved["birthday_enabled"] is True  # göndərilməyən açar silinmir (P0.1)

    db.close()
    engine.dispose()


def test_birthday_bonus_resolution_prefers_points_key():
    """P0.2 — scheduler kanonik açarı oxuyur, köhnə açar fallback qalır, 0 legaldır."""
    assert bd._resolve_bonus({"birthday_bonus_points": 25, "birthday_bonus_stars": 5}) == 25
    assert bd._resolve_bonus({"birthday_bonus_stars": 7}) == 7  # köhnə tenant
    assert bd._resolve_bonus({}) == bd.DEFAULT_BIRTHDAY_BONUS
    assert bd._resolve_bonus({"birthday_bonus_points": 0}) == 0  # əvvəl max(1,..) 1-ə qaldırırdı
    assert bd._resolve_bonus({"birthday_bonus_points": None, "birthday_bonus_stars": 9}) == 9
    assert bd._resolve_bonus({"birthday_bonus_points": "abc"}) == bd.DEFAULT_BIRTHDAY_BONUS
    assert bd._resolve_bonus({"birthday_bonus_points": 99999}) == 1000  # üst hədd


def test_birthday_zero_bonus_grants_nothing(monkeypatch):
    """P0.2 — bonus 0 olanda proqram aktiv olsa da heç nə verilmir."""
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db, birthday_enabled=True, bonus=0)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 8, 16))

    monkeypatch.setattr("app.routers.pos.send_push_notification", lambda *a, **k: None)

    result = bd.run_birthday_scan(db, today=date(2026, 8, 16))

    assert result["granted"] == 0
    db.refresh(customer)
    assert customer.stars == 10  # toxunulmayıb
    assert (
        db.query(LoyaltyLedgerEntry)
        .filter(LoyaltyLedgerEntry.tenant_id == tenant.id, LoyaltyLedgerEntry.unit == "birthday")
        .count()
        == 0
    )

    db.close()
    engine.dispose()


def test_birthday_notification_uses_tenant_points_label(monkeypatch):
    """P0.2 — bildiriş mətni hardcoded '★' deyil, tenant-ın vahid adını işlədir."""
    _bootstrap_env()
    engine, db = _make_db()
    tenant = Tenant(id="tenant-lbl", name="iRonWaves", slug="ironwaves-lbl", domain="lbl.ironwaves.store")
    db.add(tenant)
    db.add(
        Setting(
            tenant_id=tenant.id,
            key="customer_app_settings",
            value=json.dumps(
                {
                    "enabled": True,
                    "program_mode": "points",
                    "points_label": "Xal",
                    "birthday_enabled": True,
                    "birthday_bonus_points": 3,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    customer = _seed_customer(db, tenant, card_id="QR-LBL0001", birth_date=date(1990, 8, 16))

    push_calls: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        "app.routers.pos.send_push_notification",
        lambda token, title, body: push_calls.append((token, title, body)),
    )

    result = bd.run_birthday_scan(db, today=date(2026, 8, 16))
    assert result["granted"] == 1

    notif = (
        db.query(Notification)
        .filter(Notification.tenant_id == tenant.id, Notification.card_id == customer.card_id)
        .first()
    )
    assert notif is not None
    assert "+3 Xal" in notif.message
    assert "★" not in notif.message
    assert push_calls == [("fcm:test-token", "Doğum gününüz mübarək! 🎂", "+3 Xal hesabınıza əlavə edildi")]

    db.close()
    engine.dispose()


# ──────────────────────────────────────────
# Multi-worker advisory lock (P1-2 hardening)
# ──────────────────────────────────────────

class _FakeDialect:
    name = "postgresql"


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar(self):
        return self._value


class _FakeDb:
    """Postgres dialect-i simulyasiya edən db — advisory SQL-i yoxlamaq üçün."""

    def __init__(self, scalar_value=True):
        self.bind = type("B", (), {"dialect": _FakeDialect()})()
        self.calls: list[tuple[str, dict | None]] = []
        self._scalar = scalar_value

    def execute(self, sql, params=None):
        self.calls.append((str(sql), params))
        return _FakeResult(self._scalar)


def test_scan_lock_sqlite_fallback_noop():
    """SQLite-də advisory lock yoxdur → həmişə True, unlock no-op (crash yoxdur)."""
    _bootstrap_env()
    engine, db = _make_db()
    assert bd._try_acquire_scan_lock(db) is True
    bd._release_scan_lock(db)  # must not raise
    db.close()
    engine.dispose()


def test_scan_lock_postgres_issues_advisory_sql():
    """Postgres dialect-də düzgün advisory lock SQL-i işlədilir."""
    _bootstrap_env()

    db = _FakeDb(scalar_value=True)
    assert bd._try_acquire_scan_lock(db) is True
    assert "pg_try_advisory_lock" in db.calls[0][0]
    assert db.calls[0][1] == {"k": bd.BIRTHDAY_SCAN_LOCK_KEY}

    bd._release_scan_lock(db)
    assert "pg_advisory_unlock" in db.calls[1][0]
    assert db.calls[1][1] == {"k": bd.BIRTHDAY_SCAN_LOCK_KEY}

    # lock başqa worker-dadırsa → False (non-blocking skip)
    busy = _FakeDb(scalar_value=False)
    assert bd._try_acquire_scan_lock(busy) is False


def test_run_scan_if_due_lock_busy_skips(monkeypatch):
    """Lock başqa worker-dadırsa skan ATLANIR: grant yox, marker yazılmır."""
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 8, 16))

    monkeypatch.setattr(bd, "_try_acquire_scan_lock", lambda db_: False)

    result = bd._run_scan_if_due(db, tenant.id, today=date(2026, 8, 16))
    assert result is None
    db.refresh(customer)
    assert customer.stars == 10  # untouched
    assert bd._get_guard_date(db, tenant.id) is None  # marker not written

    db.close()
    engine.dispose()


def test_run_scan_if_due_guard_fresh_skips():
    """Guard marker bu gün yazılıbsa → hətta lock sərbəst olsa belə skan atlanır."""
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 8, 16))
    bd._set_guard_date(db, tenant.id, "2026-08-16")
    db.commit()

    result = bd._run_scan_if_due(db, tenant.id, today=date(2026, 8, 16))
    assert result is None
    db.refresh(customer)
    assert customer.stars == 10

    db.close()
    engine.dispose()


def test_run_scan_if_due_full_flow_sets_marker():
    """Tam axın: lock + stale guard → skan işləyir, grant olur, marker yazılır."""
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 8, 16))

    result = bd._run_scan_if_due(db, tenant.id, today=date(2026, 8, 16))
    assert result is not None
    assert result["granted"] == 1
    db.refresh(customer)
    assert customer.stars == 15
    assert bd._get_guard_date(db, tenant.id) == "2026-08-16"

    db.close()
    engine.dispose()


def test_run_scan_if_due_multi_worker_sequence():
    """İki worker ardıcıllığı: A skan edir + marker yazır; B (sonra) atlanır.

    Bu, lock-un əldə edilməsindən sonra guard yoxlamasının dedup etdiyini
    sübut edir — ikiqat grant mümkün deyil.
    """
    _bootstrap_env()
    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant, birth_date=date(1995, 8, 16))

    # Worker A
    res_a = bd._run_scan_if_due(db, tenant.id, today=date(2026, 8, 16))
    assert res_a["granted"] == 1
    db.refresh(customer)
    assert customer.stars == 15

    # Worker B — lock sərbəst, amma guard artıq bugünkü → atlanır
    res_b = bd._run_scan_if_due(db, tenant.id, today=date(2026, 8, 16))
    assert res_b is None
    db.refresh(customer)
    assert customer.stars == 15  # ikiqat grant yoxdur

    db.close()
    engine.dispose()


def test_scan_lock_real_postgres_mutual_exclusion():
    """Real Postgres varsa: iki session eyni anda lock ala BİLMƏZ (race).

    `TEST_POSTGRES_URL` və ya `DATABASE_URL` postgresql:// olduqda işləyir;
    əks halda skip (CI-da Postgres ilə işə salmaq üçün nəzərdə tutulub).
    """
    pg_url = os.environ.get("TEST_POSTGRES_URL", "") or os.environ.get("DATABASE_URL", "")
    if not str(pg_url).startswith("postgresql"):
        pytest.skip("Postgres required for the real advisory lock race test")

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker as _sessionmaker

    pg_engine = create_engine(pg_url, pool_size=3, max_overflow=0)
    Session = _sessionmaker(bind=pg_engine)
    db1 = Session()
    db2 = Session()
    try:
        assert bd._try_acquire_scan_lock(db1) is True
        # db1 lock-u saxlayır → db2 eyni anda ala bilmir
        assert bd._try_acquire_scan_lock(db2) is False
        # db1 buraxandan sonra db2 ala bilir
        bd._release_scan_lock(db1)
        assert bd._try_acquire_scan_lock(db2) is True
        bd._release_scan_lock(db2)
    finally:
        db1.close()
        db2.close()
        pg_engine.dispose()


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
