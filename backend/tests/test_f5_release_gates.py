"""F5 — buraxılış qapıları (release gates).

Hər test bir qapını kilidləyir, çünki bunlar store review-dan əvvəl
bağlanmalı audit maddələridir:

  1. **F5.1** — e-poçt uyğunluğunda köhnə hesabın `secret_token`-i artıq
     qaytarılmır (account takeover bağlandı); giriş yalnız telefon OTP ilə.
  2. **F5.2** — pre-order: filial məcburi + qiymət serverdə menyudan
     hesablanır (client qiyməti etibarsız) + `store_id` sətirdə saxlanır.
  3. **F5.3** — Pass Type ID sertifikatı yoxdursa wallet-pass 503 qaytarır
     (saxta TEAMID123/unsigned-dev-pass kartı heç vaxt göndərilmir) və
     bootstrap/session `wallet_pass_enabled=false` göndərir → düymə gizlənir.
  4. **F5.4** — native APNs/FCM tokeni OneSignal abunəliyinə çevrilir, ona
     görə seqment süzgəci tətbiq istifadəçilərini artıq atmır.
  5. **F5.5** — App Store 5.1.1: tətbiq daxilində hesab silmə şəxsi
     məlumatları silir, sessiya etibarsız olur.
"""

import importlib
import json
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
    Customer,
    CustomerConsent,
    KitchenOrder,
    MenuItem,
    Notification,
    Tenant,
)


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


def _fake_request():
    return SimpleNamespace(
        headers={},
        client=SimpleNamespace(host="127.0.0.1"),
    )


def _seed(db):
    tenant = Tenant(id="tenant-1", name="iRonWaves", slug="ironwaves", domain="super.ironwaves.store")
    customer = Customer(
        id="cust-1",
        tenant_id=tenant.id,
        card_id="QR-F5AAAA11",
        secret_token="tok-f5",
        stars=3,
        type="golden",
        name="Aysel",
        email="aysel@emalat.az",
        phone="+994501112233",
    )
    menu = [
        MenuItem(id="m1", tenant_id=tenant.id, item_name="Latte", category="Coffee", price=Decimal("4.00")),
    ]
    db.add_all([tenant, customer, *menu])
    db.commit()
    return tenant, customer


# ──────────────────────────────────────────────────────────────
# F5.1 — email-match token return bağlandı
# ──────────────────────────────────────────────────────────────


def test_enroll_duplicate_email_does_not_return_token():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = Tenant(id="t-e1", name="X", slug="x-e1", domain="e1.store")
    db.add(tenant)
    db.commit()

    first = operations.enroll_customer_app(
        payload={"consent_accepted": True, "registration_mode": "full", "email": "user@emalat.az", "name": "Bir"},
        request=_fake_request(),
        db=db,
        tenant=tenant,
    )
    assert first["success"] is True
    assert first["token"]

    with pytest.raises(HTTPException) as exc:
        operations.enroll_customer_app(
            payload={"consent_accepted": True, "registration_mode": "full", "email": "USER@emalat.az", "name": "İki"},
            request=_fake_request(),
            db=db,
            tenant=tenant,
        )
    # Kod yox, mesaj qaytarılır; əsas tələb: token/kaçar cavaba sızmamalıdır.
    assert exc.value.status_code == 409
    assert "artıq qeydiyyatdan keçib" in str(exc.value.detail)
    assert "tok" not in str(exc.value.detail).lower()

    assert db.query(Customer).filter(Customer.tenant_id == tenant.id).count() == 1

    db.close()
    engine.dispose()


def test_enroll_duplicate_email_rejected_in_simple_mode_too():
    """F5.1 boşluğu: `simple` rejimdə təkrar e-poçt əvvəl YENİ kart verirdi.
    Account-takeover qorunması rejimdən asılı olmamalıdır."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = Tenant(id="t-e2", name="X", slug="x-e2", domain="e2.store")
    db.add(tenant)
    db.commit()

    first = operations.enroll_customer_app(
        payload={"consent_accepted": True, "registration_mode": "simple", "email": "sade@emalat.az"},
        request=_fake_request(),
        db=db,
        tenant=tenant,
    )
    assert first["success"] is True

    with pytest.raises(HTTPException) as exc:
        operations.enroll_customer_app(
            payload={"consent_accepted": True, "registration_mode": "simple", "email": "sade@emalat.az"},
            request=_fake_request(),
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 409
    assert db.query(Customer).filter(Customer.tenant_id == tenant.id).count() == 1

    db.close()
    engine.dispose()


def test_enroll_rate_limit_blocks_ip_after_five_attempts():
    """İctimai join QR spam vektoru: eyni IP-dən 10 dəq-də 5+ qeydiyyat → 429."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant = Tenant(id="t-e3", name="X", slug="x-e3", domain="e3.store")
    db.add(tenant)
    db.commit()

    for i in range(5):
        res = operations.enroll_customer_app(
            payload={"consent_accepted": True, "registration_mode": "simple", "email": f"u{i}@emalat.az"},
            request=_fake_request(),
            db=db,
            tenant=tenant,
        )
        assert res["success"] is True

    with pytest.raises(HTTPException) as exc:
        operations.enroll_customer_app(
            payload={"consent_accepted": True, "registration_mode": "simple", "email": "spam@emalat.az"},
            request=_fake_request(),
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 429
    assert db.query(Customer).filter(Customer.tenant_id == tenant.id).count() == 5

    db.close()
    engine.dispose()


def _pre_order(operations, **item_overrides):
    item = {"id": "m1", "name": "Latte", "quantity": 1, "price": Decimal("0.01")}
    item.update(item_overrides)
    return operations.CustomerPreOrderIn(
        items=[operations.CustomerPreOrderItemIn(**item)],
        notes="",
        store_id="branch-1",
        store_name="Nizami",
    )


def test_pre_order_requires_store_and_uses_server_price():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed(db)

    # Filial olmadan sifariş qəbul olunmur.
    payload = _pre_order(operations)
    payload.store_id = None
    with pytest.raises(HTTPException) as exc:
        operations.create_customer_pre_order(
            payload=payload, id=customer.card_id, t=customer.secret_token, db=db, tenant=tenant
        )
    assert exc.value.status_code == 400
    assert "Filial" in str(exc.value.detail)

    # Menyuda olmayan id sifarişə düşmür.
    with pytest.raises(HTTPException) as exc:
        operations.create_customer_pre_order(
            payload=_pre_order(operations, id="yoxdur", name="Hack"),
            id=customer.card_id,
            t=customer.secret_token,
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 400

    # Client 0.01 göndərir — server menyudakı qiyməti işlədir (4.00 + əlavə yoxdur).
    res = operations.create_customer_pre_order(
        payload=_pre_order(operations), id=customer.card_id, t=customer.secret_token, db=db, tenant=tenant
    )
    assert res["success"] is True
    row = db.query(KitchenOrder).filter(KitchenOrder.id == res["orderId"]).first()
    stored = json.loads(row.items_json)
    assert stored[0]["price"] == "4.00"
    assert stored[0]["item_name"] == "Latte"
    # Filial id-si saxlanılır (əvvəl yalnız echo edilirdi).
    assert row.store_id == "branch-1"
    assert row.table_label == "Nizami"

    db.close()
    engine.dispose()


def test_pre_order_modifier_extras_capped_by_base_price():
    """Hər əlavə mənfi deyil, baza qiymətindən böyük ola bilməz."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed(db)

    payload = _pre_order(
        operations,
        selected_modifiers=[{"name": "x", "price": 9999}, {"name": "y", "price": -5}],
    )
    res = operations.create_customer_pre_order(
        payload=payload, id=customer.card_id, t=customer.secret_token, db=db, tenant=tenant
    )
    stored = json.loads(db.query(KitchenOrder).filter(KitchenOrder.id == res["orderId"]).first().items_json)
    assert stored[0]["price"] == "8.00"  # 4.00 + min(9999, 4.00) + 0

    db.close()
    engine.dispose()


# ──────────────────────────────────────────────────────────────
# F5.3 — wallet: sertifikat yoxdursa 503, düymə siqnalı false
# ──────────────────────────────────────────────────────────────


def test_wallet_pass_disabled_without_certificate():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed(db)

    # Sertifikat yoxdursa saxta imzalı pkpass heç vaxt qaytarılmır.
    with pytest.raises(HTTPException) as exc:
        operations.get_customer_wallet_pass(
            id=customer.card_id, t=customer.secret_token, db=db, tenant=tenant
        )
    assert exc.value.status_code == 503

    # Bootstrap + session düymə üçün `wallet_pass_enabled=false` göndərir.
    boot = operations.get_customer_app_bootstrap(db=db, tenant=tenant)
    assert boot["wallet_pass_enabled"] is False
    session = operations.get_customer_app_session(
        id=customer.card_id, t=customer.secret_token, db=db, tenant=tenant
    )
    assert session["wallet_pass_enabled"] is False

    db.close()
    engine.dispose()


# ──────────────────────────────────────────────────────────────
# F5.4 — native token → OneSignal abunəliyi (bərabər çatdırılma)
# ──────────────────────────────────────────────────────────────


SUB_ID = "11111111-2222-4333-8444-555555555555"


def test_native_apns_token_registered_as_subscription():
    from app.services import push_service
    from app.services.push_service import PushConfig, register_native_token

    push_service._NATIVE_SUBSCRIPTION_CACHE.clear()
    calls: list[dict] = []

    def fake_transport(url, body, headers, timeout):
        calls.append({"url": url, "body": json.loads(body.decode("utf-8"))})
        return 200, {"id": SUB_ID}

    config = PushConfig(app_id="00000000-0000-0000-0000-000000000000", rest_api_key="rest-key", source="tenant")
    assert config.ok

    native = "a" * 64
    assert register_native_token(config, native, transport=fake_transport) == SUB_ID
    assert len(calls) == 1
    assert calls[0]["body"]["identifier"] == native
    assert calls[0]["body"]["device_type"] == 0  # iOS

    # İkinci dəfə yaddaşdan oxunur — yenidən POST yox.
    assert register_native_token(config, native, transport=fake_transport) == SUB_ID
    assert len(calls) == 1

    # Brauzer abunəliyi (artıq UUID) olduğu kimi qalır, HTTP yoxdur.
    assert register_native_token(config, SUB_ID, transport=fake_transport) == SUB_ID
    assert len(calls) == 1

    push_service._NATIVE_SUBSCRIPTION_CACHE.clear()


def test_native_fcm_token_gets_android_device_type():
    from app.services.push_service import PushConfig, register_native_token

    seen: list[dict] = []

    def fake_transport(url, body, headers, timeout):
        seen.append(json.loads(body.decode("utf-8")))
        return 200, {"id": SUB_ID}

    config = PushConfig(app_id="app", rest_api_key="key", source="tenant")
    assert register_native_token(config, "fcm:token:with-colon", transport=fake_transport) == SUB_ID
    assert seen[0]["device_type"] == 1  # Android


def test_native_registration_failure_keeps_token():
    """Şəbəkə/provayder xətası tokeni itirməməlidir — olduğu kimi qalır."""
    from app.services import push_service
    from app.services.push_service import PushConfig, register_native_token

    push_service._NATIVE_SUBSCRIPTION_CACHE.clear()

    def failing_transport(url, body, headers, timeout):
        raise OSError("şəbəkə yoxdur")

    config = PushConfig(app_id="app", rest_api_key="key", source="tenant")
    native = "b" * 64
    assert register_native_token(config, native, transport=failing_transport) == native

    # Konfiqurasiya tam deyilsə heç bir HTTP cəhdi yoxdur.
    bad = PushConfig(app_id="app", rest_api_key="", source="tenant")
    assert not bad.ok
    assert register_native_token(bad, native, transport=failing_transport) == native


# ──────────────────────────────────────────────────────────────
# F5.5 — hesab silmə (Apple 5.1.1)
# ──────────────────────────────────────────────────────────────


def test_delete_account_removes_pii_and_session():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    engine, db = _make_db()
    tenant, customer = _seed(db)
    db.add(
        CustomerConsent(
            tenant_id=tenant.id,
            card_id=customer.card_id,
            consent_type="customer_app",
            accepted=True,
            source="qr_customer_app",
            ip_address="127.0.0.1",
        )
    )
    db.add(
        Notification(
            tenant_id=tenant.id,
            card_id=customer.card_id,
            message="Xoş gəldiniz",
            is_read=False,
        )
    )
    db.commit()

    res = operations.delete_customer_account(
        payload=operations.DeleteAccountIn(card_id=customer.card_id, token=customer.secret_token),
        db=db,
        tenant=tenant,
    )
    assert res["success"] is True

    assert db.query(Customer).filter(Customer.id == customer.id).first() is None
    assert db.query(CustomerConsent).filter(CustomerConsent.card_id == customer.card_id).count() == 0
    assert db.query(Notification).filter(Notification.card_id == customer.card_id).count() == 0

    # Silinmiş hesabla sessiyanın işləməməsi lazımdır (köhnə token işləmir).
    with pytest.raises(HTTPException):
        operations.get_customer_orders(
            id="QR-F5AAAA11", t="tok-f5", limit=10, db=db, tenant=tenant
        )

    db.close()
    engine.dispose()
