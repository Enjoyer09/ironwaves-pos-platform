"""
P0-3 Onboarding — real SQLite tests.

Covers:
  - OTP verify creates a CustomerConsent row (phone path compliance gap fixed)
  - OTP verify stores optional name + birth_date for NEW and EXISTING customers
  - consent creation is idempotent (no duplicates on repeat verify)
  - invalid name / birth_date in verify -> 400
  - POST /customer-app/profile/name (valid + validation + session guard)
  - enroll accepts optional name + birth_date
  - session exposes customer.name
"""
import importlib
import os
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Customer, CustomerConsent, Tenant


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


def _fake_request():
    return SimpleNamespace(
        headers={},
        client=SimpleNamespace(host="127.0.0.1"),
    )


def _seed_tenant(db, *, tenant_id: str = "tenant-1") -> Tenant:
    tenant = Tenant(
        id=tenant_id,
        name="iRonWaves",
        slug=f"ironwaves-{tenant_id}",
        domain=f"{tenant_id}.ironwaves.store",
    )
    db.add(tenant)
    db.commit()
    return tenant


def _seed_customer(db, tenant: Tenant, *, phone: str = "+994501234567") -> Customer:
    customer = Customer(
        id="cust-otp",
        tenant_id=tenant.id,
        card_id="QR-OTP0001",
        secret_token="tok-abc",
        stars=0,
        type="golden",
        phone=phone,
    )
    db.add(customer)
    db.commit()
    return customer


def _otp_payload(operations, **overrides):
    base = {
        "phone": "+994501234567",
        "code": "1234",
        "join_customer_type": "golden",
        "join_discount_percent": 0,
    }
    base.update(overrides)
    return operations.VerifyOtpIn(**base)


# ──────────────────────────────────────────
# Compliance: consent row on OTP verify
# ──────────────────────────────────────────

def test_otp_verify_new_customer_creates_consent_and_profile():
    """New customer via phone OTP must get a CustomerConsent row (P0-3)."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)

    res = operations.verify_customer_otp(
        payload=_otp_payload(
            operations,
            phone="+994507778899",
            name="Aysel",
            birth_date="1995-05-10",
        ),
        request=_fake_request(),
        db=db,
        tenant=tenant,
    )
    assert res["success"] is True
    assert res["is_new"] is True

    cust = (
        db.query(Customer)
        .filter(Customer.tenant_id == tenant.id, Customer.card_id == res["card_id"])
        .first()
    )
    assert cust is not None
    assert cust.name == "Aysel"
    assert cust.birth_date == date(1995, 5, 10)
    assert cust.phone == "+994507778899"

    consent = (
        db.query(CustomerConsent)
        .filter(CustomerConsent.tenant_id == tenant.id, CustomerConsent.card_id == res["card_id"])
        .first()
    )
    assert consent is not None
    assert consent.consent_type == "customer_app"
    assert consent.accepted is True
    assert consent.source == "phone_otp"
    assert consent.ip_address == "127.0.0.1"

    db.close()
    engine.dispose()


def test_otp_verify_existing_customer_gets_consent_and_updates_profile():
    """Existing customer (no consent row yet) must get consent + name/birth_date."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)

    # No consent row exists for this customer yet
    assert (
        db.query(CustomerConsent)
        .filter(CustomerConsent.tenant_id == tenant.id, CustomerConsent.card_id == customer.card_id)
        .count()
    ) == 0

    res = operations.verify_customer_otp(
        payload=_otp_payload(operations, name="Rüfət", birth_date="1990-01-01"),
        request=_fake_request(),
        db=db,
        tenant=tenant,
    )
    assert res["is_new"] is False
    assert res["card_id"] == customer.card_id

    db.refresh(customer)
    assert customer.name == "Rüfət"
    assert customer.birth_date == date(1990, 1, 1)

    consent = (
        db.query(CustomerConsent)
        .filter(CustomerConsent.tenant_id == tenant.id, CustomerConsent.card_id == customer.card_id)
        .first()
    )
    assert consent is not None
    assert consent.source == "phone_otp"

    # Repeat verify -> consent still a single row (idempotent), name unchanged
    res2 = operations.verify_customer_otp(
        payload=_otp_payload(operations, name="Rüfət Yeni"),
        request=_fake_request(),
        db=db,
        tenant=tenant,
    )
    assert res2["success"] is True
    consent_count = (
        db.query(CustomerConsent)
        .filter(CustomerConsent.tenant_id == tenant.id, CustomerConsent.card_id == customer.card_id)
        .count()
    )
    assert consent_count == 1
    db.refresh(customer)
    assert customer.name == "Rüfət Yeni"

    db.close()
    engine.dispose()


def test_otp_verify_validation_errors():
    """Invalid name / birth_date in verify must 400 and persist nothing."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)

    # HTML-ish name -> 400
    with pytest.raises(HTTPException) as exc:
        operations.verify_customer_otp(
            payload=_otp_payload(operations, name="<script>"),
            request=_fake_request(),
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 400

    # Too short name -> 400
    with pytest.raises(HTTPException) as exc:
        operations.verify_customer_otp(
            payload=_otp_payload(operations, name="A"),
            request=_fake_request(),
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 400

    # Future birth date -> 400
    future = (operations._restaurant_now().date() + timedelta(days=365)).isoformat()
    with pytest.raises(HTTPException) as exc:
        operations.verify_customer_otp(
            payload=_otp_payload(operations, birth_date=future),
            request=_fake_request(),
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 400

    # Nothing persisted
    assert db.query(Customer).filter(Customer.tenant_id == tenant.id).count() == 0
    assert db.query(CustomerConsent).filter(CustomerConsent.tenant_id == tenant.id).count() == 0

    db.close()
    engine.dispose()


# ──────────────────────────────────────────
# Name endpoint
# ──────────────────────────────────────────

def test_update_customer_name_endpoint():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)

    res = operations.update_customer_name(
        payload=operations.CustomerNameIn(name="  Leyla  "),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert res["success"] is True
    assert res["name"] == "Leyla"

    db.refresh(customer)
    assert customer.name == "Leyla"

    # Session exposes the name
    session = operations.get_customer_app_session(
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert session["customer"]["name"] == "Leyla"

    # Empty name -> 400
    with pytest.raises(HTTPException) as exc:
        operations.update_customer_name(
            payload=operations.CustomerNameIn(name="   "),
            id=customer.card_id,
            t=customer.secret_token,
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 400

    # HTML name -> 400
    with pytest.raises(HTTPException) as exc:
        operations.update_customer_name(
            payload=operations.CustomerNameIn(name="<b>Hack</b>"),
            id=customer.card_id,
            t=customer.secret_token,
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 400

    # Bad session -> 401
    with pytest.raises(HTTPException) as exc:
        operations.update_customer_name(
            payload=operations.CustomerNameIn(name="Leyla"),
            id=customer.card_id,
            t="wrong-token",
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 401

    # Rejected updates did not persist
    db.refresh(customer)
    assert customer.name == "Leyla"

    db.close()
    engine.dispose()


def test_update_customer_name_edit_flow():
    """Name redaktə axını (P1-2b): təyin → yenilə → sərhəd validasiyası (uzunluq/HTML)."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)

    def _set(name: str):
        return operations.update_customer_name(
            payload=operations.CustomerNameIn(name=name),
            id=customer.card_id,
            t=customer.secret_token,
            db=db,
            tenant=tenant,
        )

    # 1. Set -> trimmed + persisted
    res = _set("  Aysel  ")
    assert res["success"] is True
    assert res["name"] == "Aysel"
    db.refresh(customer)
    assert customer.name == "Aysel"

    # 2. Overwrite (edit path)
    res = _set("Aysel Məmmədova")
    assert res["success"] is True
    assert res["name"] == "Aysel Məmmədova"
    db.refresh(customer)
    assert customer.name == "Aysel Məmmədova"

    # 3. Length lower boundary: 1 char -> 400, 2 chars -> OK
    with pytest.raises(HTTPException) as exc:
        _set("A")
    assert exc.value.status_code == 400

    res = _set("Ay")
    assert res["name"] == "Ay"

    # 4. Upper boundary: 60 chars OK, 61 chars -> 400
    ok60 = "X" * 60
    res = _set(ok60)
    assert res["success"] is True
    assert res["name"] == ok60
    with pytest.raises(HTTPException) as exc:
        _set("Y" * 61)
    assert exc.value.status_code == 400

    # 5. HTML / script / angle brackets / ampersand -> 400
    for bad in ("<script>alert(1)</script>", "A&B", "A>B", "A<B"):
        with pytest.raises(HTTPException) as exc:
            _set(bad)
        assert exc.value.status_code == 400

    # 6. After all rejections the last valid value persists + session reflects it
    db.refresh(customer)
    assert customer.name == ok60
    session = operations.get_customer_app_session(
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert session["customer"]["name"] == ok60

    db.close()
    engine.dispose()


# ──────────────────────────────────────────
# Enroll path
# ──────────────────────────────────────────

def test_enroll_accepts_name_and_birth_date():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)

    res = operations.enroll_customer_app(
        payload={
            "consent_accepted": True,
            "join_customer_type": "golden",
            "name": "Nigar",
            "birth_date": "1988-03-15",
        },
        request=_fake_request(),
        db=db,
        tenant=tenant,
    )
    assert res["success"] is True

    cust = (
        db.query(Customer)
        .filter(Customer.tenant_id == tenant.id, Customer.card_id == res["card_id"])
        .first()
    )
    assert cust.name == "Nigar"
    assert cust.birth_date == date(1988, 3, 15)
    assert (
        db.query(CustomerConsent)
        .filter(CustomerConsent.tenant_id == tenant.id, CustomerConsent.card_id == res["card_id"])
        .count()
    ) == 1

    db.close()
    engine.dispose()
