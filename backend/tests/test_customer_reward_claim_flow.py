"""
End-to-end test for the reward claim flow (P0-2 companion):

    customer claims reward  ->  unique RW code generated (PENDING)
                              + in-app Notification (inbox)
                              + FCM push with the code (when push_token set)

Uses a real in-memory SQLite database so the actual SQL filtering and
`_setting_value` behaviour of `operations.py` are exercised.
"""
import importlib
import os
import re
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Customer, Notification, RewardClaim, Setting, Tenant


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


def _seed_tenant_customer(db, *, stars: int = 10, push_token: str | None = "fcm:test-token") -> tuple[Tenant, Customer]:
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
        type="golden",
        push_token=push_token,
    )
    db.add_all([tenant, customer])
    db.commit()
    return tenant, customer


def _seed_customer_app_settings(db, tenant_id: str, *, threshold: int) -> None:
    db.add(
        Setting(
            id="set-1",
            tenant_id=tenant_id,
            key="customer_app_settings",
            value=(
                f'{{"reward_threshold": {threshold}, "reward_name": "Pulsuz Latte", '
                f'"reward_description": "{threshold} ulduza 1 pulsuz içki"}}'
            ),
        )
    )
    db.commit()


def test_reward_claim_creates_code_notification_and_push(monkeypatch):
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=10)

    push_calls: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        "app.routers.pos.send_push_notification",
        lambda token, title, body: push_calls.append((token, title, body)),
    )

    res = operations.claim_customer_reward(
        payload=operations.RewardClaimIn(reward_id="default-reward"),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert res["success"] is True
    assert res["reward_name"] == "Reward"
    assert res["points_cost"] == 10
    assert res["available_rewards"] == 0

    # Code format: RW + 6 uppercase hex chars
    claim_code = res["claim_code"]
    assert re.fullmatch(r"RW[0-9A-F]{6}", claim_code), f"unexpected code: {claim_code}"

    # RewardClaim row persisted as PENDING
    claim_row = db.query(RewardClaim).filter(RewardClaim.claim_code == claim_code).first()
    assert claim_row is not None
    assert claim_row.tenant_id == tenant.id
    assert claim_row.card_id == customer.card_id
    assert claim_row.status == "PENDING"
    assert claim_row.points_cost == 10

    # In-app Notification seeded (customer inbox)
    notif = (
        db.query(Notification)
        .filter(Notification.tenant_id == tenant.id, Notification.card_id == customer.card_id)
        .first()
    )
    assert notif is not None
    assert claim_code in notif.message

    # FCM push fired with the code
    assert len(push_calls) == 1
    token, title, body = push_calls[0]
    assert token == "fcm:test-token"
    assert title == "Reward kodunuz hazırdır! 🎉"
    assert claim_code in body

    db.close()
    engine.dispose()


def test_reward_claim_no_available_rewards_400():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=5)

    with pytest.raises(HTTPException) as exc:
        operations.claim_customer_reward(
            payload=operations.RewardClaimIn(),
            id=customer.card_id,
            t=customer.secret_token,
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 400

    # nothing persisted
    assert db.query(RewardClaim).filter(RewardClaim.tenant_id == tenant.id).count() == 0

    db.close()
    engine.dispose()


def test_reward_claim_uses_custom_settings_threshold():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=5)
    _seed_customer_app_settings(db, tenant.id, threshold=5)

    res = operations.claim_customer_reward(
        payload=operations.RewardClaimIn(),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert res["success"] is True
    assert res["reward_name"] == "Pulsuz Latte"
    assert res["points_cost"] == 5
    assert res["claim_code"].startswith("RW")

    db.close()
    engine.dispose()


def test_reward_claim_pending_claims_reduce_available_rewards():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=25)

    # 25 stars / 10 = 2 available; pending claims reduce that
    res1 = operations.claim_customer_reward(
        payload=operations.RewardClaimIn(),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert res1["available_rewards"] == 1

    res2 = operations.claim_customer_reward(
        payload=operations.RewardClaimIn(),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert res2["available_rewards"] == 0

    # third claim must fail — all rewards already pending
    with pytest.raises(HTTPException) as exc:
        operations.claim_customer_reward(
            payload=operations.RewardClaimIn(),
            id=customer.card_id,
            t=customer.secret_token,
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 400

    # two PENDING claims exist with distinct codes
    claims = db.query(RewardClaim).filter(RewardClaim.tenant_id == tenant.id, RewardClaim.card_id == customer.card_id).all()
    assert len(claims) == 2
    assert claims[0].claim_code != claims[1].claim_code

    db.close()
    engine.dispose()


def test_reward_claim_requires_valid_session():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=20)

    with pytest.raises(HTTPException) as exc:
        operations.claim_customer_reward(
            payload=operations.RewardClaimIn(),
            id=customer.card_id,
            t="wrong-token",
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 401

    with pytest.raises(HTTPException) as exc:
        operations.claim_customer_reward(
            payload=operations.RewardClaimIn(),
            id="QR-NOTEXIST",
            t=customer.secret_token,
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 401

    db.close()
    engine.dispose()


def test_reward_claim_without_push_token_no_push(monkeypatch):
    """Customer without push permission: claim works, push silently skipped."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, stars=10, push_token=None)

    push_calls: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        "app.routers.pos.send_push_notification",
        lambda token, title, body: push_calls.append((token, title, body)),
    )

    res = operations.claim_customer_reward(
        payload=operations.RewardClaimIn(),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert res["success"] is True
    assert push_calls == []

    db.close()
    engine.dispose()
