"""P4.3 — `/push/schedule` endpointləri və broadcast-da sükut/fasilə qapısı.

Niyə: planlama **yazma** əməliyyatıdır və göndərmə ilə eyni riski daşıyır — səhv
vaxt və ya səhv seqment min müştəriyə gedir və geri alınmır. Kilidlənən qaydalar:

  1. **Sükut saatı dərhal göndərməni bloklayır, planlamanı yox.** Admin "sabah
     09:00" planlayır və scheduler vaxtı özü sürüşdürür; əks davranış admini gecə
     paneldə gözləməyə məcbur edərdi.
  2. **Göndərilmiş plan ləğv olunmur** (409): bildiriş telefonlardadır.
  3. **Yanlış kampaniya id-si 404**: səssiz qəbul tarixçəni saxta atribusiya ilə doldurar.
  4. **Boş mətn / http keçidi 400**: OneSignal yalnız https qəbul edir, boş mətn isə
     "göndərildi" görünüb heç nə etməzdi.
"""

import importlib
import json
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.push_schedule import quiet_window_state


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


class _FakeQuery:
    def __init__(self, items):
        self.items = items

    def filter(self, *a, **k):
        return self

    def order_by(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def all(self):
        return self.items

    def first(self):
        return self.items[0] if self.items else None


class _FakeDB:
    """`HappyHour` və `PushSchedule` sorğularını cavablandıran minimum stub."""

    def __init__(self, campaign=None, schedules=()):
        self.campaign = campaign
        self.schedules = list(schedules)
        self.added = []
        self.commits = 0

    def query(self, model_class, *a, **k):
        name = getattr(model_class, "__name__", "")
        if name == "HappyHour":
            return _FakeQuery([self.campaign] if self.campaign else [])
        if name == "PushSchedule":
            return _FakeQuery(self.schedules)
        return _FakeQuery([])

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1


ADMIN = SimpleNamespace(username="admin", role="admin")
TENANT = SimpleNamespace(id="tenant-1")


def _ops():
    _bootstrap_env()
    return importlib.import_module("app.routers.operations")


# ---------------------------------------------------------------------------
# Broadcast — sükut saatı və fasilə qapısı
# ---------------------------------------------------------------------------


def _patch_broadcast_ok(monkeypatch, ops, *, settings, state=None):
    """Broadcast-ın bütün asılılıqlarını "hər şey qaydasındadır" vəziyyətinə gətirir.

    `state` verilməzsə sükut/fasilə **real** funksiyadan hesablanır və
    `_tenant_minute_of_day`-in patch-lənmiş dəyərini işlədir — yoxsa test
    "gecə 03:00" deyib gündüz vəziyyətini yoxlayardı.
    """
    minute = {"value": 12 * 60}
    monkeypatch.setattr(ops, "_tenant_minute_of_day", lambda db, tid: minute["value"])
    monkeypatch.setattr(ops, "load_push_settings", lambda db, tid: settings)
    monkeypatch.setattr(
        ops, "_push_broadcast_state",
        lambda db, tid, s: state or {
            "daily_limit": 5, "used_today": 0, "remaining": 5,
            "cooldown_minutes": 0, "cooldown_remaining_minutes": 0, "next_allowed_at": None,
            "quiet": quiet_window_state(s, minute["value"]),
        },
    )
    monkeypatch.setattr(ops, "resolve_tenant_push_config", lambda db, tid: (SimpleNamespace(ok=True, source="tenant", reason=None), {}))
    monkeypatch.setattr(
        ops, "resolve_audience_for_tenant",
        lambda *a, **k: SimpleNamespace(
            tokens=["t1"], recipients=1, matched=1, as_dict=lambda: {"recipients": 1},
            label="Hamı", with_token=1, undeliverable=0,
        ),
    )
    monkeypatch.setattr(ops, "_push_tiers", lambda db, tid: [])
    monkeypatch.setattr(ops, "_push_config_public", lambda cfg: {})
    monkeypatch.setattr(ops, "send_bulk_push", lambda *a, **k: (_sent(), SimpleNamespace(source="tenant", app_id="a", rest_api_key="k")))
    return minute


def _sent():
    from app.services.push_service import PushResult

    return PushResult(status="sent", attempted=1, accepted=1, failed=0)


def _broadcast(ops, db, monkeypatch, **payload):
    return ops.send_push_broadcast(
        payload=ops.PushBroadcastIn(**payload),
        db=db,
        tenant=TENANT,
        user=ADMIN,
    )


def test_immediate_broadcast_is_blocked_inside_quiet_hours(monkeypatch):
    """Dərhal göndərmə sükutda bloklanır — admin indi basır, müştəriləri gecə
    oyatmaq onun qərarı deyil. Səbəb **nə vaxt** mümkün olduğunu deməlidir."""
    ops = _ops()
    settings = {"enabled": True, "broadcast_enabled": True, "quiet_enabled": True,
                "quiet_start": "22:00", "quiet_end": "09:00"}
    minute = _patch_broadcast_ok(monkeypatch, ops, settings=settings)
    minute["value"] = 3 * 60  # gecə 03:00

    db = _FakeDB()
    with pytest.raises(HTTPException) as err:
        _broadcast(ops, db, monkeypatch, body="Gecə bildirişi")

    assert err.value.status_code == 400
    assert "Sükut saatıdır" in err.value.detail
    assert "09:00" in err.value.detail
    assert db.commits == 0
    assert db.added == []


def test_immediate_broadcast_passes_outside_quiet_hours(monkeypatch):
    ops = _ops()
    settings = {"enabled": True, "broadcast_enabled": True, "quiet_enabled": True,
                "quiet_start": "22:00", "quiet_end": "09:00"}
    minute = _patch_broadcast_ok(monkeypatch, ops, settings=settings)
    minute["value"] = 12 * 60  # gündüz

    res = _broadcast(ops, _FakeDB(), monkeypatch, body="Gündüz bildirişi")
    assert res["success"] is True


def test_cooldown_blocks_a_second_broadcast_too_soon(monkeypatch):
    """Gündəlik hədd "neçə dəfə", fasilə "nə qədər tez-tez". Beş bildirişi 10
    dəqiqə içində göndərmək həddi keçməz, amma müştərilər üçün spamdır."""
    ops = _ops()
    settings = {"enabled": True, "broadcast_enabled": True}
    _patch_broadcast_ok(
        monkeypatch, ops, settings=settings,
        state={
            "daily_limit": 5, "used_today": 1, "remaining": 4,
            "cooldown_minutes": 30, "cooldown_remaining_minutes": 22,
            "next_allowed_at": "2026-10-11T12:22:00",
            "quiet": quiet_window_state(settings, 12 * 60),
        },
    )

    db = _FakeDB()
    with pytest.raises(HTTPException) as err:
        _broadcast(ops, db, monkeypatch, body="Tez-tez")
    assert err.value.status_code == 429
    assert "fasilə" in err.value.detail
    assert "22 dəqiqə" in err.value.detail
    assert db.commits == 0


def test_quiet_gate_runs_before_the_cooldown_gate(monkeypatch):
    """Sıra **kilidlidir**: sükut daha güclü səbəbdir (vaxt bitəndə özü keçir),
    fasilə isə yalnız gözləmə tələb edir. Sıra dəyişsə admin gecə yarısı "fasilə
    gözlənilir" mesajı alıb sükut saatından xəbərsiz qalardı."""
    ops = _ops()
    settings = {"enabled": True, "broadcast_enabled": True}
    _patch_broadcast_ok(
        monkeypatch, ops, settings=settings,
        state={
            "daily_limit": 5, "used_today": 1, "remaining": 4,
            "cooldown_minutes": 30, "cooldown_remaining_minutes": 22,
            "next_allowed_at": "2026-10-11T03:22:00",
            "quiet": quiet_window_state(
                {"quiet_enabled": True, "quiet_start": "22:00", "quiet_end": "09:00"}, 3 * 60
            ),
        },
    )
    with pytest.raises(HTTPException) as err:
        _broadcast(ops, _FakeDB(), monkeypatch, body="Gecə")
    assert err.value.status_code == 400
    assert "Sükut saatıdır" in err.value.detail


# ---------------------------------------------------------------------------
# `/push/schedule` — yaratma
# ---------------------------------------------------------------------------


def test_schedule_requires_body(monkeypatch):
    ops = _ops()
    with pytest.raises(HTTPException) as err:
        ops.create_push_schedule(
            payload=ops.PushScheduleIn(body="   ", scheduled_at="2026-10-12T09:00:00"),
            db=_FakeDB(), tenant=TENANT, user=ADMIN,
        )
    assert err.value.status_code == 400
    assert "boşdur" in err.value.detail


@pytest.mark.parametrize("url", ["http://x.az", "javascript:alert(1)", "/menu"])
def test_schedule_rejects_non_https_url(monkeypatch, url):
    ops = _ops()
    with pytest.raises(HTTPException) as err:
        ops.create_push_schedule(
            payload=ops.PushScheduleIn(body="Salam", url=url, scheduled_at="2026-10-12T09:00:00"),
            db=_FakeDB(), tenant=TENANT, user=ADMIN,
        )
    assert err.value.status_code == 400
    assert "https://" in err.value.detail


def test_schedule_rejects_a_past_time(monkeypatch):
    ops = _ops()
    with pytest.raises(HTTPException) as err:
        ops.create_push_schedule(
            payload=ops.PushScheduleIn(body="Salam", scheduled_at="2020-01-01T00:00:00"),
            db=_FakeDB(), tenant=TENANT, user=ADMIN,
        )
    assert err.value.status_code == 400
    assert "1 dəqiqə" in err.value.detail


def test_schedule_rejects_unknown_campaign(monkeypatch):
    """Səhv id tarixçəni saxta atribusiya ilə doldurardı."""
    ops = _ops()
    with pytest.raises(HTTPException) as err:
        ops.create_push_schedule(
            payload=ops.PushScheduleIn(body="Salam", campaign_id="yoxdur", scheduled_at="2027-01-01T09:00:00"),
            db=_FakeDB(campaign=None), tenant=TENANT, user=ADMIN,
        )
    assert err.value.status_code == 404


def test_schedule_creates_row_audits_and_does_not_send(monkeypatch):
    """Planlama **göndərmir**: heç bir `send_bulk_push` çağırışı olmamalıdır."""
    ops = _ops()
    sent = {"calls": 0}
    monkeypatch.setattr(ops, "send_bulk_push", lambda *a, **k: sent.__setitem__("calls", sent["calls"] + 1))
    monkeypatch.setattr(ops, "load_push_settings", lambda db, tid: {"quiet_enabled": False})
    monkeypatch.setattr(ops, "_tenant_minute_of_day", lambda db, tid: 12 * 60)

    db = _FakeDB(campaign=SimpleNamespace(id="camp-1", name="Cümə"))
    res = ops.create_push_schedule(
        payload=ops.PushScheduleIn(
            title="Cümə endirimi", body="Bu gün 20% endirim!",
            scheduled_at="2027-01-01T09:00:00", campaign_id="camp-1",
            audience=ops.PushAudienceIn(segment="dormant", days=45),
        ),
        db=db, tenant=TENANT, user=ADMIN,
    )

    assert sent["calls"] == 0
    assert res["success"] is True
    assert res["schedule"]["status"] == "pending"
    assert res["schedule"]["campaign_id"] == "camp-1"
    # Seqment **dondurulur** — göndərmə anında yenidən hesablanmır.
    assert res["schedule"]["audience"]["segment"] == "dormant"
    assert res["schedule"]["audience"]["days"] == 45
    assert db.commits == 1

    audit = [r for r in db.added if getattr(r, "action", "") == "PUSH_SCHEDULE_CREATED"]
    assert len(audit) == 1
    details = json.loads(audit[0].details)
    assert details["campaign_id"] == "camp-1"
    assert details["segment"]["segment"] == "dormant"


def test_schedule_inside_quiet_still_creates_the_plan(monkeypatch):
    """Sükut saatı planlamanı **bloklamır** — scheduler vaxtı sürüşdürür.
    Bloklasaydıq admin gecə paneldə gözləməli olardı."""
    ops = _ops()
    monkeypatch.setattr(ops, "send_bulk_push", lambda *a, **k: None)
    monkeypatch.setattr(
        ops, "load_push_settings",
        lambda db, tid: {"quiet_enabled": True, "quiet_start": "22:00", "quiet_end": "09:00"},
    )
    monkeypatch.setattr(ops, "_tenant_minute_of_day", lambda db, tid: 3 * 60)

    res = ops.create_push_schedule(
        payload=ops.PushScheduleIn(body="Sabah açılış endirimi", scheduled_at="2027-01-01T09:00:00"),
        db=_FakeDB(), tenant=TENANT, user=ADMIN,
    )
    assert res["success"] is True
    assert res["schedule"]["status"] == "pending"


# ---------------------------------------------------------------------------
# `/push/schedule/{id}` — ləğv
# ---------------------------------------------------------------------------


def test_cancel_pending_schedule(monkeypatch):
    ops = _ops()
    from app.models import PushSchedule

    row = PushSchedule(
        tenant_id="tenant-1", title="T", body="B", spec_json="{}",
        status="pending", scheduled_at=__import__("datetime").datetime(2027, 1, 1, 9, 0),
    )
    db = _FakeDB(schedules=[row])
    res = ops.cancel_push_schedule(schedule_id=row.id, db=db, tenant=TENANT, user=ADMIN)

    assert res["schedule"]["status"] == "canceled"
    assert row.status == "canceled"
    assert row.executed_at is not None
    assert "admin" in row.error
    assert any(getattr(r, "action", "") == "PUSH_SCHEDULE_CANCELED" for r in db.added)


def test_cannot_cancel_an_already_sent_schedule(monkeypatch):
    """Göndərilmiş bildiriş telefonlardadır — geri alınmır. `409` panelə bunu
    'artıq getdi' kimi göstərir."""
    ops = _ops()
    from app.models import PushSchedule

    row = PushSchedule(
        tenant_id="tenant-1", title="T", body="B", spec_json="{}",
        status="sent", scheduled_at=__import__("datetime").datetime(2027, 1, 1, 9, 0),
    )
    db = _FakeDB(schedules=[row])
    with pytest.raises(HTTPException) as err:
        ops.cancel_push_schedule(schedule_id=row.id, db=db, tenant=TENANT, user=ADMIN)
    assert err.value.status_code == 409
    assert "sent" in err.value.detail
    assert db.commits == 0


def test_cancel_unknown_schedule_is_404(monkeypatch):
    ops = _ops()
    with pytest.raises(HTTPException) as err:
        ops.cancel_push_schedule(schedule_id="yoxdur", db=_FakeDB(), tenant=TENANT, user=ADMIN)
    assert err.value.status_code == 404


# ---------------------------------------------------------------------------
# Rol qapısı
# ---------------------------------------------------------------------------


def test_schedule_write_requires_admin(monkeypatch):
    ops = _ops()
    with pytest.raises(HTTPException) as err:
        ops.create_push_schedule(
            payload=ops.PushScheduleIn(body="Salam", scheduled_at="2027-01-01T09:00:00"),
            db=_FakeDB(), tenant=TENANT, user=SimpleNamespace(username="m", role="manager"),
        )
    assert err.value.status_code == 403


def test_schedule_read_allows_manager(monkeypatch):
    """Oxuma manager-ə açıqdır: kampaniyanı adətən o planlayır."""
    ops = _ops()
    monkeypatch.setattr(ops, "_push_schedule_public", lambda row: {"id": row.id})
    res = ops.list_push_schedules(
        limit=50, status=None, campaign_id=None,
        db=_FakeDB(schedules=[]), tenant=TENANT,
        user=SimpleNamespace(username="m", role="manager"),
    )
    assert res["count"] == 0
    assert res["statuses"] == ["pending", "sent", "canceled", "failed"]
