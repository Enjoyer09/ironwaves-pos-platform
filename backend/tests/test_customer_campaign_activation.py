"""
P1-4 Campaign server validation — real SQLite tests.

Covers:
  - POST /customer-app/campaigns/{id}/activate: create -> success + expires_at
  - re-activation refreshes expires_at (existing ACTIVE row)
  - USED row -> 409 (single use)
  - inactive / missing campaign -> 404
  - invalid session -> 401
  - session exposes campaign_activations; expired rows are filtered out
  - POST /api/v1/pos/campaigns/validate: valid -> ACTIVE->USED + discount info
  - double redemption -> { valid: false }
  - happy hour time window (weekday) enforced at validate time
  - custom campaign_activation_minutes from customer_app_settings
"""
import importlib
import json
import os
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, CampaignActivation, Customer, HappyHour, Setting, Tenant


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


def _seed_customer(db, tenant: Tenant, *, card_id: str = "QR-CAMP0001") -> Customer:
    customer = Customer(
        id=f"cust-{card_id}",
        tenant_id=tenant.id,
        card_id=card_id,
        secret_token="tok-camp",
        stars=0,
        type="golden",
    )
    db.add(customer)
    db.commit()
    return customer


def _seed_campaign(
    db,
    tenant: Tenant,
    *,
    campaign_id: str = "hh-1",
    active: bool = True,
    days: list[int] | None = None,
    start: str = "00:00",
    end: str = "23:59",
    discount: int = 20,
) -> HappyHour:
    if days is None:
        weekday = datetime.utcnow().weekday() + 1
        days = [weekday]
    campaign = HappyHour(
        id=campaign_id,
        tenant_id=tenant.id,
        name="Happy Hour Test",
        start_time=start,
        end_time=end,
        discount_percent=discount,
        days_of_week_json=json.dumps(days),
        categories="ALL",
        is_active=active,
    )
    db.add(campaign)
    db.commit()
    return campaign


def _seed_settings(db, tenant: Tenant, *, activation_minutes: int | None = None) -> None:
    payload = {"enabled": True, "program_mode": "points"}
    if activation_minutes is not None:
        payload["campaign_activation_minutes"] = activation_minutes
    db.add(
        Setting(
            tenant_id=tenant.id,
            key="customer_app_settings",
            value=json.dumps(payload, ensure_ascii=False),
        )
    )
    db.commit()


def _activate(operations, customer: Customer, campaign_id: str, tenant: Tenant, db):
    return operations.activate_customer_campaign(
        campaign_id=campaign_id,
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )


def test_activate_creates_active_row():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)
    campaign = _seed_campaign(db, tenant)

    res = _activate(operations, customer, campaign.id, tenant, db)
    assert res["success"] is True
    assert res["expires_at"]

    row = db.query(CampaignActivation).filter(CampaignActivation.tenant_id == tenant.id).one()
    assert row.campaign_id == campaign.id
    assert row.card_id == customer.card_id
    assert row.status == "ACTIVE"
    assert row.expires_at > datetime.utcnow()

    db.close()
    engine.dispose()


def test_reactivate_refreshes_expires_at():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)
    campaign = _seed_campaign(db, tenant)

    first = _activate(operations, customer, campaign.id, tenant, db)
    # Force the existing row's expiry into the past, then re-activate.
    row = db.query(CampaignActivation).filter(CampaignActivation.tenant_id == tenant.id).one()
    row.expires_at = datetime.utcnow() - timedelta(minutes=5)
    db.commit()

    second = _activate(operations, customer, campaign.id, tenant, db)
    assert second["success"] is True
    assert second["expires_at"] != first["expires_at"]

    db.refresh(row)
    assert row.status == "ACTIVE"
    assert row.expires_at > datetime.utcnow()
    # Still exactly one row — re-activation refreshes, never duplicates.
    assert db.query(CampaignActivation).filter(CampaignActivation.tenant_id == tenant.id).count() == 1

    db.close()
    engine.dispose()


def test_activate_used_row_returns_409():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)
    campaign = _seed_campaign(db, tenant)

    _activate(operations, customer, campaign.id, tenant, db)
    row = db.query(CampaignActivation).filter(CampaignActivation.tenant_id == tenant.id).one()
    row.status = "USED"
    db.commit()

    with pytest.raises(HTTPException) as exc:
        _activate(operations, customer, campaign.id, tenant, db)
    assert exc.value.status_code == 409

    db.close()
    engine.dispose()


def test_activate_inactive_campaign_404():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)
    _seed_campaign(db, tenant, active=False)

    with pytest.raises(HTTPException) as exc:
        _activate(operations, customer, "hh-1", tenant, db)
    assert exc.value.status_code == 404

    # Missing campaign id as well.
    with pytest.raises(HTTPException) as exc:
        _activate(operations, customer, "no-such-campaign", tenant, db)
    assert exc.value.status_code == 404

    assert db.query(CampaignActivation).count() == 0

    db.close()
    engine.dispose()


def test_activate_invalid_session_401():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)
    campaign = _seed_campaign(db, tenant)

    with pytest.raises(HTTPException) as exc:
        operations.activate_customer_campaign(
            campaign_id=campaign.id,
            id=customer.card_id,
            t="wrong-token",
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 401

    db.close()
    engine.dispose()


def test_session_exposes_activation_and_filters_expired():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)
    campaign = _seed_campaign(db, tenant)

    res = _activate(operations, customer, campaign.id, tenant, db)

    session = operations.get_customer_app_session(
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    acts = session["campaign_activations"]
    assert len(acts) == 1
    assert acts[0]["campaign_id"] == campaign.id
    assert acts[0]["name"] == campaign.name
    assert acts[0]["discount_percent"] == campaign.discount_percent
    assert acts[0]["expires_at"] == res["expires_at"]

    # Expired rows disappear from the session.
    row = db.query(CampaignActivation).filter(CampaignActivation.tenant_id == tenant.id).one()
    row.expires_at = datetime.utcnow() - timedelta(minutes=1)
    db.commit()

    session2 = operations.get_customer_app_session(
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert session2["campaign_activations"] == []

    db.close()
    engine.dispose()


def test_pos_validate_valid_marks_used():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    pos = importlib.import_module("app.routers.pos")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)
    campaign = _seed_campaign(db, tenant)

    _activate(operations, customer, campaign.id, tenant, db)

    res = pos.validate_pos_campaign(
        payload=pos.CampaignValidateIn(campaign_id=campaign.id, card_id=customer.card_id),
        db=db,
        tenant=tenant,
        user=None,
    )
    assert res.valid is True
    assert res.discount_percent == campaign.discount_percent
    assert res.name == campaign.name

    row = db.query(CampaignActivation).filter(CampaignActivation.tenant_id == tenant.id).one()
    assert row.status == "USED"

    db.close()
    engine.dispose()


def test_pos_validate_double_redemption_rejected():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    pos = importlib.import_module("app.routers.pos")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)
    campaign = _seed_campaign(db, tenant)

    _activate(operations, customer, campaign.id, tenant, db)

    first = pos.validate_pos_campaign(
        payload=pos.CampaignValidateIn(campaign_id=campaign.id, card_id=customer.card_id),
        db=db,
        tenant=tenant,
        user=None,
    )
    assert first.valid is True

    # Same QR scanned again -> USED already.
    second = pos.validate_pos_campaign(
        payload=pos.CampaignValidateIn(campaign_id=campaign.id, card_id=customer.card_id),
        db=db,
        tenant=tenant,
        user=None,
    )
    assert second.valid is False

    db.close()
    engine.dispose()


def test_pos_validate_time_window_enforced():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    pos = importlib.import_module("app.routers.pos")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)
    # Campaign runs on a different weekday than today -> invalid at validate time.
    today = datetime.utcnow().weekday() + 1
    other_day = 1 if today != 1 else 2
    campaign = _seed_campaign(db, tenant, days=[other_day])

    _activate(operations, customer, campaign.id, tenant, db)

    res = pos.validate_pos_campaign(
        payload=pos.CampaignValidateIn(campaign_id=campaign.id, card_id=customer.card_id),
        db=db,
        tenant=tenant,
        user=None,
    )
    assert res.valid is False
    # Not marked used — the window simply isn't open yet.
    row = db.query(CampaignActivation).filter(CampaignActivation.tenant_id == tenant.id).one()
    assert row.status == "ACTIVE"

    db.close()
    engine.dispose()


def test_pos_validate_missing_activation_or_campaign_invalid():
    _bootstrap_env()
    pos = importlib.import_module("app.routers.pos")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    customer = _seed_customer(db, tenant)
    campaign = _seed_campaign(db, tenant)

    # No activation yet -> invalid.
    res = pos.validate_pos_campaign(
        payload=pos.CampaignValidateIn(campaign_id=campaign.id, card_id=customer.card_id),
        db=db,
        tenant=tenant,
        user=None,
    )
    assert res.valid is False

    # Unknown campaign -> invalid.
    res2 = pos.validate_pos_campaign(
        payload=pos.CampaignValidateIn(campaign_id="nope", card_id=customer.card_id),
        db=db,
        tenant=tenant,
        user=None,
    )
    assert res2.valid is False

    # Empty payload -> invalid (not a crash).
    res3 = pos.validate_pos_campaign(
        payload=pos.CampaignValidateIn(campaign_id="", card_id=""),
        db=db,
        tenant=tenant,
        user=None,
    )
    assert res3.valid is False

    db.close()
    engine.dispose()


def test_activate_custom_activation_minutes():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = _seed_tenant(db)
    _seed_settings(db, tenant, activation_minutes=45)
    customer = _seed_customer(db, tenant)
    campaign = _seed_campaign(db, tenant)

    res = _activate(operations, customer, campaign.id, tenant, db)
    expires_at = datetime.fromisoformat(res["expires_at"])
    expected = datetime.utcnow() + timedelta(minutes=45)
    # Allow small clock skew between the two utcnow() calls.
    assert abs((expires_at - expected).total_seconds()) < 120

    db.close()
    engine.dispose()
