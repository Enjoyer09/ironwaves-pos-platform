"""F3/F6 — epoint.az ödəniş endpoint-ləri (test rejimi).

Qapılar:
  1. İmza sxemi: `base64(sha1(private_key + data + private_key))`, callback
     timing-safe yoxlanır (saxta imza 403).
  2. Açarlar yoxdursa hər endpoint 503 (fail-closed) — heç bir HTTP cəhdi yox.
  3. Yaratma: məbləğ serverdə `items_json`-dan hesablanır (client-dan
     götürülmür),order yalnız öz müştərisininkidirsə 404.
  4. Callback: düzgün imza ilə status lokal qeyddə yenilənir.
"""

import asyncio
import base64
import hashlib
import importlib
import json
import os
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Customer, EpointPayment, KitchenOrder, Tenant


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
    return engine, Session()


def _seed(db):
    tenant = Tenant(id="t-ep", name="Emalat", slug="emalat", domain="emalat.store")
    customer = Customer(
        id="c-ep",
        tenant_id=tenant.id,
        card_id="QR-EP001",
        secret_token="tok-ep",
        type="Normal",
        name="Kamran",
    )
    order = KitchenOrder(
        id="ord-ep-1",
        tenant_id=tenant.id,
        table_label="Nizami",
        store_id="branch-1",
        order_type="Online",
        status="NEW",
        card_id=customer.card_id,
        items_json=json.dumps(
            [{"id": "m1", "item_name": "Latte", "qty": 2, "price": "4.00"}]
        ),
    )
    foreign_order = KitchenOrder(
        id="ord-ep-2",
        tenant_id=tenant.id,
        table_label="Nizami",
        store_id="branch-1",
        order_type="Online",
        status="NEW",
        card_id="QR-BASKA",
        items_json=json.dumps([{"id": "m1", "item_name": "Latte", "qty": 1, "price": "4.00"}]),
    )
    db.add_all([tenant, customer, order, foreign_order])
    db.commit()
    return tenant, customer, order


def _configure(monkeypatch, *, public="i000000001", private="sekret-private-key"):
    from app.services import epoint_service

    monkeypatch.setattr(epoint_service.settings, "epoint_public_key", public)
    monkeypatch.setattr(epoint_service.settings, "epoint_private_key", private)
    return epoint_service


# ──────────────────────────────────────────────────────────────
# 1. İmza sxemi (epoint authentication)
# ──────────────────────────────────────────────────────────────


def test_signature_matches_epoint_scheme():
    _bootstrap_env()
    epoint_service = importlib.import_module("app.services.epoint_service")

    private = "d3hjsl38sd8kdfhbcea0be04eafde9e8e2bad2fb092d"
    data = base64.b64encode(b'{"order_id":"1"}').decode()
    expected = base64.b64encode(
        hashlib.sha1(f"{private}{data}{private}".encode()).digest()
    ).decode()
    assert epoint_service.sign_data(data, private) == expected
    assert epoint_service.verify_signature(data, expected, private) is True
    # Saxta/imzalanmamış və ya dəyişdirilmiş data rədd edilir.
    assert epoint_service.verify_signature(data, "tamam-basqa-imza==", private) is False
    assert epoint_service.verify_signature(data, expected, "yanlis-kacar") is False
    assert epoint_service.verify_signature("", expected, private) is False

    # Callback data deşifr: base64 JSON → obyekt.
    decoded = epoint_service.decode_data(data)
    assert decoded == {"order_id": "1"}
    with pytest.raises(epoint_service.EpointError):
        epoint_service.decode_data("!!! deyil base64")


# ──────────────────────────────────────────────────────────────
# 2. Fail-closed: açarlar yoxdursa 503
# ──────────────────────────────────────────────────────────────


def test_payment_endpoints_fail_closed_without_keys(monkeypatch):
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    from app.services import epoint_service

    monkeypatch.setattr(epoint_service.settings, "epoint_public_key", None)
    monkeypatch.setattr(epoint_service.settings, "epoint_private_key", None)

    engine, db = _make_db()
    tenant, customer, order = _seed(db)

    calls = {"n": 0}

    def no_network(*args, **kwargs):
        calls["n"] += 1
        raise AssertionError("şəbəkəyə çıxmamalıdır")

    monkeypatch.setattr(epoint_service, "create_payment", no_network)
    monkeypatch.setattr(epoint_service, "get_status", no_network)

    with pytest.raises(HTTPException) as exc:
        operations.create_customer_payment(
            payload=operations.PaymentCreateIn(
                card_id=customer.card_id, token=customer.secret_token, order_id=order.id
            ),
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 503

    with pytest.raises(HTTPException) as exc:
        operations.customer_payment_status(
            payload=operations.PaymentStatusIn(
                card_id=customer.card_id, token=customer.secret_token, transaction="te_1"
            ),
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 503

    assert calls["n"] == 0
    db.close()
    engine.dispose()


# ──────────────────────────────────────────────────────────────
# 3. Yaratmaq: server məbləği + məxsus sifariş + qeyd
# ──────────────────────────────────────────────────────────────


def test_create_payment_uses_server_amount_and_records_row(monkeypatch):
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    epoint_service = _configure(monkeypatch)

    captured: dict = {}

    def fake_create(**kwargs):
        captured.update(kwargs)
        return {"status": "success", "redirect_url": "https://bank.example/pay", "transaction": "te_99"}

    monkeypatch.setattr(epoint_service, "create_payment", fake_create)

    engine, db = _make_db()
    tenant, customer, order = _seed(db)

    res = operations.create_customer_payment(
        payload=operations.PaymentCreateIn(
            card_id=customer.card_id, token=customer.secret_token, order_id=order.id
        ),
        db=db,
        tenant=tenant,
    )
    assert res["redirect_url"] == "https://bank.example/pay"
    assert res["transaction"] == "te_99"
    # Məbləğ serverdə: 2 × 4.00 = 8.00 — payload-da məbləğ sahəsi yoxdur.
    assert captured["amount"] == "8.00"
    assert captured["order_id"] == order.id

    row = db.query(EpointPayment).filter(EpointPayment.order_id == order.id).first()
    assert row is not None
    assert row.amount == Decimal("8.00")
    assert row.transaction == "te_99"
    assert row.status == "new"
    assert row.card_id == customer.card_id

    # Başqasının sifarişi 404 (sessiya card_id ilə məhdudlaşır).
    with pytest.raises(HTTPException) as exc:
        operations.create_customer_payment(
            payload=operations.PaymentCreateIn(
                card_id=customer.card_id, token=customer.secret_token, order_id="ord-ep-2"
            ),
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 404

    db.close()
    engine.dispose()


def test_status_endpoint_updates_local_record(monkeypatch):
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    epoint_service = _configure(monkeypatch)

    def fake_status(transaction, **kwargs):
        assert transaction == "te_77"
        return {"status": "success", "code": "000", "message": "Approved", "rrn": "12345"}

    monkeypatch.setattr(epoint_service, "get_status", fake_status)

    engine, db = _make_db()
    tenant, customer, order = _seed(db)
    db.add(
        EpointPayment(
            tenant_id=tenant.id,
            card_id=customer.card_id,
            order_id=order.id,
            amount=Decimal("8.00"),
            transaction="te_77",
            status="new",
        )
    )
    db.commit()

    res = operations.customer_payment_status(
        payload=operations.PaymentStatusIn(
            card_id=customer.card_id, token=customer.secret_token, transaction="te_77"
        ),
        db=db,
        tenant=tenant,
    )
    assert res["status"] == "success"
    assert res["code"] == "000"
    row = db.query(EpointPayment).filter(EpointPayment.transaction == "te_77").first()
    assert row.status == "success"
    assert row.rrn == "12345"

    # Yad token (öz qeydi deyil) 404.
    with pytest.raises(HTTPException) as exc:
        operations.customer_payment_status(
            payload=operations.PaymentStatusIn(
                card_id=customer.card_id, token=customer.secret_token, transaction="te_basqa"
            ),
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 404

    db.close()
    engine.dispose()


# ──────────────────────────────────────────────────────────────
# 4. Callback: imza yoxlaması + status yeniləmə
# ──────────────────────────────────────────────────────────────


def _callback_args(order_id: str, status: str = "success", code: str = "000", transaction: str = "te_99") -> dict:
    from app.services import epoint_service

    private = str(epoint_service.settings.epoint_private_key or "")
    payload = {
        "order_id": order_id,
        "status": status,
        "code": code,
        "message": "Approved",
        "transaction": transaction,
        "amount": "8.00",
    }
    data = base64.b64encode(json.dumps(payload).encode()).decode()
    return {"data": data, "signature": epoint_service.sign_data(data, private)}


def test_callback_verifies_signature_and_updates_status(monkeypatch):
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    _configure(monkeypatch)

    engine, db = _make_db()
    tenant, customer, order = _seed(db)
    db.add(
        EpointPayment(
            tenant_id=tenant.id,
            card_id=customer.card_id,
            order_id=order.id,
            amount=Decimal("8.00"),
            transaction="te_99",
            status="new",
        )
    )
    db.commit()

    # Saxta imza → 403, status dəyişmir.
    args = _callback_args(order.id)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            operations.epoint_payment_callback(
                data=args["data"], signature="bax-bu-saxtadir==", db=db
            )
        )
    assert exc.value.status_code == 403
    assert (
        db.query(EpointPayment).filter(EpointPayment.order_id == order.id).first().status == "new"
    )

    # Düzgün imza → status success, code saxlanır.
    res = asyncio.run(operations.epoint_payment_callback(**args, db=db))
    assert res["status"] == "success"
    row = db.query(EpointPayment).filter(EpointPayment.order_id == order.id).first()
    assert row.status == "success"
    assert row.code == "000"

    # Tanınmamış order_id və transaction (imza düzgün) → 200 "received".
    unknown = _callback_args("ord-yoxdur", transaction="te_yoxdur")
    res = asyncio.run(operations.epoint_payment_callback(**unknown, db=db))
    assert res["status"] == "received"
    assert db.query(EpointPayment).filter(EpointPayment.order_id == "ord-yoxdur").count() == 0

    db.close()
    engine.dispose()


def test_callback_fails_closed_without_keys(monkeypatch):
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    from app.services import epoint_service

    monkeypatch.setattr(epoint_service.settings, "epoint_public_key", None)
    monkeypatch.setattr(epoint_service.settings, "epoint_private_key", None)

    engine, db = _make_db()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            operations.epoint_payment_callback(data="ZGF0YQ==", signature="c2ln", db=db)
        )
    assert exc.value.status_code == 503
    db.close()
    engine.dispose()
