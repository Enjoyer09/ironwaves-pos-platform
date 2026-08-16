"""
End-to-end test for the P0-2 order status tracking flow:

    customer pre-order (card_id)  ->  KitchenOrder (NEW)
        -> KDS accept              ->  PREPARING  + customer push
        -> KDS complete            ->  READY      + customer push
        -> customer GET orders     ->  live status screen data

Uses a real in-memory SQLite database (no mocks for the query layer) so the
actual SQL filtering of `operations.py` endpoints is exercised.
"""
import importlib
import os
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import (
    Base,
    Check,
    Customer,
    KitchenOrder,
    Notification,
    OrderItem,
    OrderRound,
    Table,
    TableSession,
    Tenant,
)


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


def _seed_tenant_customer(db, *, push_token: str | None = "fcm:test-token") -> tuple[Tenant, Customer]:
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
        stars=5,
        type="golden",
        push_token=push_token,
    )
    db.add_all([tenant, customer])
    db.commit()
    return tenant, customer


def _order_payload(operations):
    return operations.CustomerPreOrderIn(
        items=[
            operations.CustomerPreOrderItemIn(
                id="m1",
                name="Iced Latte",
                quantity=2,
                price=Decimal("4.50"),
                variant_name="Large",
                selected_modifiers=[{"name": "Almond milk", "price": 0.5}],
                notes="No ice",
            ),
            operations.CustomerPreOrderItemIn(
                id="m2",
                name="Cinnamon Roll",
                quantity=1,
                price=Decimal("3.20"),
            ),
        ],
        notes="Doora çatdırın",
    )


def test_pre_order_kitchen_flow_end_to_end(monkeypatch):
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db)
    user = SimpleNamespace(username="kds-1", role="admin")

    # ── 1. Customer places a pre-order ─────────────────────────────────────
    res = operations.create_customer_pre_order(
        payload=_order_payload(operations),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    assert res["success"] is True
    order_id = res["orderId"]
    assert order_id

    # Order row persisted with card_id + status NEW
    row = db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first()
    assert row is not None
    assert row.card_id == customer.card_id
    assert row.status == "NEW"
    assert row.order_type == "Online"

    # In-app Notification created (the "order accepted" toast source)
    notif_count = (
        db.query(Notification)
        .filter(Notification.tenant_id == tenant.id, Notification.card_id == customer.card_id)
        .count()
    )
    assert notif_count == 1

    # ── 2. Customer fetches live orders (status screen) ───────────────────
    orders = operations.get_customer_orders(
        id=customer.card_id,
        t=customer.secret_token,
        limit=10,
        db=db,
        tenant=tenant,
    )
    assert len(orders) == 1
    assert orders[0]["id"] == order_id
    assert orders[0]["status"] == "NEW"
    assert orders[0]["order_type"] == "Online"
    item_names = [it["item_name"] for it in orders[0]["items"]]
    assert item_names == ["Iced Latte", "Cinnamon Roll"]
    assert orders[0]["items"][0]["qty"] == 2
    assert orders[0]["completed_at"] is None

    # ── 3. KDS accepts -> PREPARING + customer push ────────────────────────
    push_calls: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        "app.routers.pos.send_push_notification",
        lambda token, title, body: push_calls.append((token, title, body)),
    )

    res = operations.accept_kitchen_order(
        order_id=order_id,
        db=db,
        tenant=tenant,
        user=user,
    )
    assert res["success"] is True
    assert db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first().status == "PREPARING"
    assert ("fcm:test-token", "Sifarişiniz hazırlanır ☕") in [
        (c[0], c[1]) for c in push_calls
    ]

    orders = operations.get_customer_orders(
        id=customer.card_id,
        t=customer.secret_token,
        limit=10,
        db=db,
        tenant=tenant,
    )
    assert orders[0]["status"] == "PREPARING"

    # ── 4. KDS completes -> READY + customer push ──────────────────────────
    res = operations.complete_kitchen_order(
        order_id=order_id,
        payload=operations.KitchenCompleteIn(ready_items=["Iced Latte"]),
        db=db,
        tenant=tenant,
        user=user,
    )
    assert res["success"] is True
    completed = db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first()
    assert completed.status == "READY"
    assert completed.completed_at is not None
    assert ("fcm:test-token", "Sifarişiniz hazırdır! 🎉") in [
        (c[0], c[1]) for c in push_calls
    ]

    orders = operations.get_customer_orders(
        id=customer.card_id,
        t=customer.secret_token,
        limit=10,
        db=db,
        tenant=tenant,
    )
    assert orders[0]["status"] == "READY"
    assert orders[0]["completed_at"] is not None

    db.close()
    engine.dispose()


def test_customer_orders_requires_valid_session():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db)

    # Wrong token -> 401
    with pytest.raises(HTTPException) as exc:
        operations.get_customer_orders(
            id=customer.card_id,
            t="wrong-token",
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 401

    # Unknown card -> 401
    with pytest.raises(HTTPException) as exc:
        operations.get_customer_orders(
            id="QR-NOTEXIST",
            t=customer.secret_token,
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 401

    db.close()
    engine.dispose()


def test_legacy_orders_without_card_id_not_leaked(monkeypatch):
    """
    Migration impact: orders created before `card_id` was added have
    card_id = NULL. They must NOT appear in a customer's live order list
    (privacy) and must NOT trigger a push when processed by KDS.
    """
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db)
    user = SimpleNamespace(username="kds-1", role="admin")

    # Legacy order (pre-migration): card_id = None
    legacy = KitchenOrder(
        id="legacy-1",
        tenant_id=tenant.id,
        table_label="T3",
        order_type="Table",
        card_id=None,
        status="NEW",
        priority="NORMAL",
        items_json='[{"id":"m1","item_name":"Espresso","qty":1,"price":"2.00"}]',
    )
    db.add(legacy)
    db.commit()

    # Not visible to any customer
    orders = operations.get_customer_orders(
        id=customer.card_id,
        t=customer.secret_token,
        limit=10,
        db=db,
        tenant=tenant,
    )
    assert orders == []

    # Processing a legacy order must not crash and must not push
    push_calls: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        "app.routers.pos.send_push_notification",
        lambda token, title, body: push_calls.append((token, title, body)),
    )
    res = operations.accept_kitchen_order(
        order_id="legacy-1",
        db=db,
        tenant=tenant,
        user=user,
    )
    assert res["success"] is True
    res = operations.complete_kitchen_order(
        order_id="legacy-1",
        payload=None,
        db=db,
        tenant=tenant,
        user=user,
    )
    assert res["success"] is True
    assert push_calls == []

    db.close()
    engine.dispose()


def test_customer_without_push_token_gets_no_push(monkeypatch):
    """A customer who never granted push permission must be skipped silently."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, push_token=None)
    user = SimpleNamespace(username="kds-1", role="admin")

    res = operations.create_customer_pre_order(
        payload=_order_payload(operations),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    order_id = res["orderId"]

    push_calls: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        "app.routers.pos.send_push_notification",
        lambda token, title, body: push_calls.append((token, title, body)),
    )
    operations.accept_kitchen_order(order_id=order_id, db=db, tenant=tenant, user=user)
    operations.complete_kitchen_order(order_id=order_id, payload=None, db=db, tenant=tenant, user=user)

    assert push_calls == []
    # Status still flows for the live screen even without push
    orders = operations.get_customer_orders(
        id=customer.card_id,
        t=customer.secret_token,
        limit=10,
        db=db,
        tenant=tenant,
    )
    assert orders[0]["status"] == "READY"

    db.close()
    engine.dispose()


def test_kitchen_round_complete_empty_body_no_crash():
    """
    KDS live path (restaurant.py /kitchen-feed/{round_id}/complete) with an
    empty body must not crash — old devices that send no ready_items still
    complete the round (all non-terminal items become READY).
    """
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    restaurant = importlib.import_module("app.routers.restaurant")

    engine, db = _make_db()
    tenant, _ = _seed_tenant_customer(db, push_token=None)
    user = SimpleNamespace(username="kds-1", role="admin")

    table = Table(id="tbl-1", tenant_id=tenant.id, label="T1", status="OCCUPIED")
    tsession = TableSession(id="ts-1", tenant_id=tenant.id, table_id="tbl-1", status="SEATED")
    check = Check(id="chk-1", tenant_id=tenant.id, table_session_id="ts-1", check_number="CHK-1", status="OPEN")
    round_row = OrderRound(id="rnd-1", tenant_id=tenant.id, check_id="chk-1", round_no=1, status="SENT")
    item = OrderItem(
        id="it-1", tenant_id=tenant.id, check_id="chk-1", round_id="rnd-1",
        table_id="tbl-1", item_name="Espresso", qty=1, price=Decimal("2.00"), status="SENT",
    )
    db.add_all([table, tsession, check, round_row, item])
    db.commit()

    # Empty body {} — the 'old device' scenario (KDS sends {ready_items}, legacy may send nothing)
    res = restaurant.complete_kitchen_round(
        round_id="rnd-1",
        payload={},
        db=db,
        tenant=tenant,
        user=user,
    )
    assert res["success"] is True
    assert db.query(OrderRound).filter(OrderRound.id == "rnd-1").first().status == "READY"
    assert db.query(OrderItem).filter(OrderItem.id == "it-1").first().status == "READY"

    # ready_items targeting still works: only matching items turn READY
    round2 = OrderRound(id="rnd-2", tenant_id=tenant.id, check_id="chk-1", round_no=2, status="SENT")
    item_a = OrderItem(
        id="it-a", tenant_id=tenant.id, check_id="chk-1", round_id="rnd-2",
        table_id="tbl-1", item_name="Latte", qty=1, price=Decimal("4.00"), status="SENT",
    )
    item_b = OrderItem(
        id="it-b", tenant_id=tenant.id, check_id="chk-1", round_id="rnd-2",
        table_id="tbl-1", item_name="Cake", qty=1, price=Decimal("5.00"), status="PREPARING",
    )
    db.add_all([round2, item_a, item_b])
    db.commit()

    res = restaurant.complete_kitchen_round(
        round_id="rnd-2",
        payload={"ready_items": ["Latte"]},
        db=db,
        tenant=tenant,
        user=user,
    )
    assert res["success"] is True
    assert db.query(OrderItem).filter(OrderItem.id == "it-a").first().status == "READY"
    assert db.query(OrderItem).filter(OrderItem.id == "it-b").first().status == "PREPARING"

    db.close()
    engine.dispose()


def test_kitchen_state_guards():
    """accept/complete reject invalid transitions (double accept / re-complete)."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed_tenant_customer(db, push_token=None)
    user = SimpleNamespace(username="kds-1", role="admin")

    res = operations.create_customer_pre_order(
        payload=_order_payload(operations),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    order_id = res["orderId"]

    # accept twice -> second is a no-op guard (PREPARING allowed)
    operations.accept_kitchen_order(order_id=order_id, db=db, tenant=tenant, user=user)
    operations.accept_kitchen_order(order_id=order_id, db=db, tenant=tenant, user=user)
    assert db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first().status == "PREPARING"

    # complete without payload (legacy KDS device) must not crash
    operations.complete_kitchen_order(order_id=order_id, payload=None, db=db, tenant=tenant, user=user)
    assert db.query(KitchenOrder).filter(KitchenOrder.id == order_id).first().status == "READY"

    # complete on NEW -> 400 (must not be allowed before acceptance)
    res = operations.create_customer_pre_order(
        payload=_order_payload(operations),
        id=customer.card_id,
        t=customer.secret_token,
        db=db,
        tenant=tenant,
    )
    fresh_id = res["orderId"]
    with pytest.raises(HTTPException) as exc:
        operations.complete_kitchen_order(order_id=fresh_id, payload=None, db=db, tenant=tenant, user=user)
    assert exc.value.status_code == 400

    # accept on READY -> 400
    with pytest.raises(HTTPException) as exc:
        operations.accept_kitchen_order(order_id=order_id, db=db, tenant=tenant, user=user)
    assert exc.value.status_code == 400

    # unknown order -> 404
    with pytest.raises(HTTPException) as exc:
        operations.accept_kitchen_order(order_id="does-not-exist", db=db, tenant=tenant, user=user)
    assert exc.value.status_code == 404

    db.close()
    engine.dispose()
