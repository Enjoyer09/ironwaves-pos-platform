"""P4.5 — `/customer-app/push-engagement` endpointi (bildirişə toxunma).

Niyə test lazımdır: hadisə statistikanı **artırır** və panel onu "müştəri
bildirişi gördü" kimi göstərir. Səhv qəbul edilən saxta açılma, yaxud təkrar
hadisənin iki dəfə sayılması paneli yalançı uğur göstərməyə vadar edər —
P0.4-ün pozulması olardı. Kilidlənən qaydalar:

  1. **Müştəri sessiyası məcburidir** (id + t) — açıq endpoint istənilən şəxsə
     saxta açılma yaratmağa icazə verərdi.
  2. **Təkrar hadisə udulur** — mobil şəbəkə eyni hadisəni iki dəfə göndərə bilər.
  3. **`delivery_id` tenant-a aid olmalıdır** — başqa tenant-ın id-sini vermək
     onun statistikasını şişirdə bilməz.
  4. **Abunəlik yoxdursa rədd olunur** — hadisəni heç bir cihaza bağlaya
     bilmiriksə, uydurma id yazmaqdansa açıq deyirik.
"""

import importlib
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


class _FakeQuery:
    """`filter()` şərtlərini **mətn** kimi yığır və `first()`-də tətbiq edir.

    Niyə belə: endpoint tenant-ı SQL `WHERE`-də süzür. Stub heç nə süzməsəydi,
    "başqa tenant-ın göndərməsi" testi endpoint-in öz süzgəcini deyil, stub-un
    davranışını yoxlayardı — yəni yaşıl qalıb real boşluğu gizlədərdi.
    """

    def __init__(self, items, criteria=()):
        self.items = list(items)
        self.criteria = list(criteria)

    def filter(self, *a, **k):
        return _FakeQuery(self.items, self.criteria + [str(x) for x in a])

    def _rows(self):
        if not self.items:
            return []
        item = self.items[0]
        text = " ".join(self.criteria)
        # Produksiyada `PushDelivery.tenant_id == tenant.id` SQL-dəki süzgəcdir.
        if "tenant_id" in text and getattr(item, "tenant_id", TENANT.id) != TENANT.id:
            return []
        return self.items

    def first(self):
        rows = self._rows()
        return rows[0] if rows else None

    def all(self):
        return self._rows()


class _FakeDB:
    """`Customer`, `PushDelivery`, `PushEngagement` sorğularını cavablandırır.

    `existing_engagement` verilərsə təkrar hadisə vəziyyətini simulyasiya edir
    (unikal məhdudiyyət əvəzinə — SQL-in özü real DB testdə yoxlanır).
    """

    def __init__(self, *, customer=None, delivery=None, existing_engagement=None):
        self.customer = customer
        self.delivery = delivery
        self.existing_engagement = existing_engagement
        self.added = []
        self.commits = 0

    def query(self, model_class, *a, **k):
        name = getattr(model_class, "__name__", "")
        items = []
        if name == "Customer":
            items = [self.customer] if self.customer else []
        elif name == "PushDelivery":
            items = [self.delivery] if self.delivery else []
        elif name == "PushEngagement":
            items = [self.existing_engagement] if self.existing_engagement else []
        return _FakeQuery(items)

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1


TENANT = SimpleNamespace(id="tenant-1")


def _ops():
    _bootstrap_env()
    return importlib.import_module("app.routers.operations")


def _post(db, **overrides):
    ops = _ops()
    payload = overrides.pop("payload", None)
    params = {"id": "QR-1", "t": "secret", "db": db, "tenant": TENANT}
    params.update(overrides)
    if payload is None:
        return ops.record_push_engagement(
            ops.PushEngagementIn(delivery_id="d-1"), **params
        )
    return ops.record_push_engagement(payload, **params)


def _customer(card_id="QR-1", push_token="onesignal:sub-1"):
    return SimpleNamespace(card_id=card_id, push_token=push_token, secret_token="secret")


def _delivery(campaign_id="c1"):
    return SimpleNamespace(id="d-1", tenant_id="tenant-1", campaign_id=campaign_id)


@pytest.fixture
def resolve_customer(monkeypatch):
    """`_resolve_customer_session`-u xətti stub ilə əvəz edir — auth-ın özü
    ayrı test faylında yoxlanır (`test_customer_app_features.py`)."""
    ops = _ops()

    def fake(db, tenant_id, card_id, token):
        return db.customer

    monkeypatch.setattr(ops, "_resolve_customer_session", fake)


def test_records_an_open_with_customer_token_as_subscription(resolve_customer):
    db = _FakeDB(customer=_customer(), delivery=_delivery())
    body = _post(db)

    assert body == {"success": True, "recorded": True}
    assert len(db.added) == 1
    row = db.added[0]
    assert row.tenant_id == "tenant-1"
    assert row.delivery_id == "d-1"
    assert row.kind == "opened"
    # `subscription_id` verilməyib → müştərinin cari push token-i işlədilir.
    assert row.subscription_id == "onesignal:sub-1"
    assert row.card_id == "QR-1"
    assert db.commits == 1


def test_explicit_subscription_id_wins(resolve_customer):
    db = _FakeDB(customer=_customer(), delivery=_delivery())
    body = _post(
        db,
        payload=_ops().PushEngagementIn(
            delivery_id="d-1", subscription_id="onesignal:other-9"
        ),
    )

    assert body["recorded"] is True
    assert db.added[0].subscription_id == "onesignal:other-9"


def test_duplicate_event_is_silently_ignored(resolve_customer):
    """Təkrar hadisə udulur, yeni sətir yazılmır."""
    db = _FakeDB(
        customer=_customer(),
        delivery=_delivery(),
        existing_engagement=SimpleNamespace(id="already"),
    )
    body = _post(db)

    assert body == {"success": True, "recorded": False, "reason": "already_recorded"}
    assert db.added == []
    assert db.commits == 0


def test_delivery_from_another_tenant_is_rejected(resolve_customer):
    """Başqa tenant-ın göndərmə id-si → 404. Statistika şişirdilə bilməz."""
    db = _FakeDB(
        customer=_customer(),
        delivery=SimpleNamespace(id="d-1", tenant_id="tenant-OTHER", campaign_id="c1"),
    )
    with pytest.raises(HTTPException) as exc:
        _post(db)
    assert exc.value.status_code == 404


def test_unknown_delivery_is_rejected(resolve_customer):
    db = _FakeDB(customer=_customer(), delivery=None)
    with pytest.raises(HTTPException) as exc:
        _post(db)
    assert exc.value.status_code == 404


def test_customer_without_subscription_is_rejected(resolve_customer):
    """`push_token` yoxdursa hadisəni cihaza bağlaya bilmirik — açıq rədd."""
    db = _FakeDB(customer=_customer(push_token=""), delivery=_delivery())
    with pytest.raises(HTTPException) as exc:
        _post(db)
    assert exc.value.status_code == 400
    assert "Abunəlik" in exc.value.detail


def test_unknown_kind_is_rejected(resolve_customer):
    db = _FakeDB(customer=_customer(), delivery=_delivery())
    with pytest.raises(HTTPException) as exc:
        _post(db, payload=_ops().PushEngagementIn(delivery_id="d-1", kind="clicked"))
    assert exc.value.status_code == 400


def test_empty_delivery_id_is_rejected(resolve_customer):
    db = _FakeDB(customer=_customer(), delivery=_delivery())
    with pytest.raises(HTTPException) as exc:
        _post(db, payload=_ops().PushEngagementIn(delivery_id="   "))
    assert exc.value.status_code == 400


def test_missing_customer_session_is_refused():
    """Stub-sız: sessiya xətası 401 olmalıdır (auth işləyir)."""
    db = _FakeDB(customer=None, delivery=_delivery())
    with pytest.raises(HTTPException) as exc:
        _post(db)
    assert exc.value.status_code == 401