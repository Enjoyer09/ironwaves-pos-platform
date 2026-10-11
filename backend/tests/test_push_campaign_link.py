"""P4.2 — kampaniya ↔ bildiriş əlaqəsi.

Niyə: panel "Elan et" düyməsi ilə kampaniyanı müştərilərə elan edir. Əlaqə
saxlanmasa "bu kampaniya işlədi?" sualı cavabsız qalar və atribusiya (Faza 4)
qurula bilməz. Burada üç qayda kilidlənir:

  1. **Yanlış kampaniya id-si qəbul olunmur.** Başqa tenant-ın və ya silinmiş
     kampaniyanın id-si tarixçəni korlayardı: sonradan "bu kampaniya 400 nəfərə
     getdi" hesabatı yalana çevrilərdi.
  2. **Kampaniyasız bildiriş də işləyir.** `campaign_id=None` → sütun NULL qalır
     və ümumi kütləvi bildiriş heç bir kampaniyaya yazılmır.
  3. **Tarixçə süzgəci dürüstdür.** `campaign_id` ilə sorğu yalnız o kampaniyanın
     sətirlərini qaytarır — panelin "3 bildiriş" rəqəmi buradan gəlir.
"""

import importlib
import json
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.push_dispatch import record_delivery
from app.services.push_service import PushConfig, PushResult


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


# ---------------------------------------------------------------------------
# `record_delivery` — sxem səviyyəsi (DB yoxdur, sətir obyekti yoxlanılır)
# ---------------------------------------------------------------------------

class _CaptureDB:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)

    def commit(self):
        pass


def test_record_delivery_keeps_campaign_id():
    db = _CaptureDB()
    row = record_delivery(
        db,
        "tenant-1",
        PushResult(status="sent", attempted=10, accepted=9, failed=1),
        kind="broadcast",
        campaign_id="camp-123",
        config=PushConfig(app_id="app", rest_api_key="key", source="tenant"),
    )
    assert row is not None
    assert row.campaign_id == "camp-123"


def test_record_delivery_without_campaign_leaves_null():
    db = _CaptureDB()
    row = record_delivery(
        db,
        "tenant-1",
        PushResult(status="sent", attempted=1, accepted=1, failed=0),
        kind="broadcast",
        config=PushConfig(app_id="app", rest_api_key="key", source="tenant"),
    )
    assert row is not None
    assert row.campaign_id is None


def test_record_delivery_truncates_overlong_campaign_id():
    """Sütun `String(36)`-dır; 200 simvolluq id SQL xətası ilə jurnalı itirərdi."""
    db = _CaptureDB()
    row = record_delivery(
        db,
        "tenant-1",
        PushResult(status="sent", attempted=1, accepted=1, failed=0),
        kind="broadcast",
        campaign_id="x" * 200,
        config=PushConfig(app_id="app", rest_api_key="key", source="tenant"),
    )
    assert row is not None
    assert len(row.campaign_id) == 36


# ---------------------------------------------------------------------------
# Broadcast endpointi — kampaniya yoxlaması
# ---------------------------------------------------------------------------

class _FakeQuery:
    def __init__(self, items):
        self.items = items

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def group_by(self, *args, **kwargs):
        return self

    def all(self):
        return self.items

    def first(self):
        return self.items[0] if self.items else None


class _FakeDB:
    """Yalnız `HappyHour` sorğusunu cavablandıran minimum stub."""

    def __init__(self, campaign=None):
        self.campaign = campaign
        self.added = []
        self.commits = 0

    def query(self, model_class, *args, **kwargs):
        name = getattr(model_class, "__name__", "")
        if name == "HappyHour":
            return _FakeQuery([self.campaign] if self.campaign else [])
        if name == "Customer":
            return _FakeQuery([])
        return _FakeQuery([])

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1


def test_broadcast_rejects_unknown_campaign_before_sending(monkeypatch):
    """Yanlış id → 404 və provayderə heç nə getmir. Səssiz qəbul etsəydik
    tarixçə saxta atribusiya ilə dolar."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    sent = {"called": False}

    def _fail_send(*args, **kwargs):  # pragma: no cover - çağırılmamalıdır
        sent["called"] = True
        raise AssertionError("göndərmə çağırıldı")

    monkeypatch.setattr(operations, "send_bulk_push", _fail_send)
    monkeypatch.setattr(operations, "load_push_settings", lambda db, tid: {"enabled": True, "broadcast_enabled": True})
    monkeypatch.setattr(operations, "_push_broadcast_state", lambda db, tid, s: {"daily_limit": 5, "used_today": 0, "remaining": 5})
    monkeypatch.setattr(operations, "resolve_tenant_push_config", lambda db, tid: (SimpleNamespace(ok=True, source="tenant", reason=None), {}))
    monkeypatch.setattr(operations, "resolve_audience_for_tenant", lambda *a, **k: SimpleNamespace(tokens=["t1"], recipients=1, matched=1, as_dict=lambda: {}, label="Hamı", with_token=1, undeliverable=0))
    monkeypatch.setattr(operations, "_push_tiers", lambda db, tid: [])

    db = _FakeDB(campaign=None)
    with pytest.raises(HTTPException) as err:
        operations.send_push_broadcast(
            payload=operations.PushBroadcastIn(body="Salam", campaign_id="yoxdur"),
            db=db,
            tenant=SimpleNamespace(id="tenant-1"),
            user=SimpleNamespace(username="admin", role="admin"),
        )
    assert err.value.status_code == 404
    assert sent["called"] is False
    assert db.commits == 0


def test_broadcast_links_the_notification_to_the_campaign(monkeypatch):
    """Kampaniya mövcuddursa göndərmə həmin id ilə jurnala yazılır və cavabda
    kampaniya adı qaytarılır — panel "nə elan etdik" sualına cavab verə bilir."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    captured: dict = {}

    def _capture_send(db, tenant_id, **kwargs):
        captured.update(kwargs)
        return PushResult(status="sent", attempted=2, accepted=2, failed=0), SimpleNamespace(source="tenant", app_id="a", rest_api_key="k")

    monkeypatch.setattr(operations, "send_bulk_push", _capture_send)
    monkeypatch.setattr(operations, "load_push_settings", lambda db, tid: {"enabled": True, "broadcast_enabled": True})
    monkeypatch.setattr(operations, "_push_broadcast_state", lambda db, tid, s: {"daily_limit": 5, "used_today": 0, "remaining": 5})
    monkeypatch.setattr(operations, "resolve_tenant_push_config", lambda db, tid: (SimpleNamespace(ok=True, source="tenant", reason=None), {}))
    monkeypatch.setattr(operations, "resolve_audience_for_tenant", lambda *a, **k: SimpleNamespace(tokens=["t1", "t2"], recipients=2, matched=2, as_dict=lambda: {"recipients": 2}, label="Bütün abunəçilər", with_token=2, undeliverable=0))
    monkeypatch.setattr(operations, "_push_tiers", lambda db, tid: [])
    monkeypatch.setattr(operations, "_push_config_public", lambda cfg: {})

    db = _FakeDB(campaign=SimpleNamespace(id="camp-1", name="Cümə endirimi"))
    res = operations.send_push_broadcast(
        payload=operations.PushBroadcastIn(body="Cümə endirimi başladı", campaign_id="camp-1"),
        db=db,
        tenant=SimpleNamespace(id="tenant-1"),
        user=SimpleNamespace(username="admin", role="admin"),
    )

    assert captured["campaign_id"] == "camp-1"
    assert res["campaign_id"] == "camp-1"
    assert res["campaign_name"] == "Cümə endirimi"

    audit = [row for row in db.added if getattr(row, "action", "") == "PUSH_BROADCAST_SENT"]
    assert len(audit) == 1
    details = json.loads(audit[0].details)
    assert details["campaign_id"] == "camp-1"
    assert details["campaign_name"] == "Cümə endirimi"


def test_broadcast_without_campaign_stays_unattributed(monkeypatch):
    """Ümumi kütləvi bildiriş heç bir kampaniyaya yazılmamalıdır — əks halda
    kampaniya hesabatı ümumi bildirişlərlə şişərdi."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    captured: dict = {}

    def _capture_send(db, tenant_id, **kwargs):
        captured.update(kwargs)
        return PushResult(status="sent", attempted=1, accepted=1, failed=0), SimpleNamespace(source="tenant", app_id="a", rest_api_key="k")

    monkeypatch.setattr(operations, "send_bulk_push", _capture_send)
    monkeypatch.setattr(operations, "load_push_settings", lambda db, tid: {"enabled": True, "broadcast_enabled": True})
    monkeypatch.setattr(operations, "_push_broadcast_state", lambda db, tid, s: {"daily_limit": 5, "used_today": 0, "remaining": 5})
    monkeypatch.setattr(operations, "resolve_tenant_push_config", lambda db, tid: (SimpleNamespace(ok=True, source="tenant", reason=None), {}))
    monkeypatch.setattr(operations, "resolve_audience_for_tenant", lambda *a, **k: SimpleNamespace(tokens=["t1"], recipients=1, matched=1, as_dict=lambda: {"recipients": 1}, label="Hamı", with_token=1, undeliverable=0))
    monkeypatch.setattr(operations, "_push_tiers", lambda db, tid: [])
    monkeypatch.setattr(operations, "_push_config_public", lambda cfg: {})

    db = _FakeDB(campaign=None)
    res = operations.send_push_broadcast(
        payload=operations.PushBroadcastIn(body="Salam"),
        db=db,
        tenant=SimpleNamespace(id="tenant-1"),
        user=SimpleNamespace(username="admin", role="admin"),
    )
    assert captured["campaign_id"] is None
    assert res["campaign_id"] is None
    assert res["campaign_name"] is None
