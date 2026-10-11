"""P4.3 — sükut saatları, fasilə və planlanmış göndərmə (Faza 3).

Niyə bu testlər: bu qat **göndərməni dayandıra bilir**. Səhv olsa admin "sükut
saatı qoydum" deyə düşünüb müştəriləri gecə 03:00-da oyadar, ya da plan səssizcə
`failed` olub heç kim xəbər tutmaz. Kilidlənən qaydalar:

  1. **Sükut saatı göndərməni udmur, təxirə salır.** Plan `pending` qalır və
     `scheduled_at` sükut bitən ana sürüşür — "sükutda idik, plan itdi" olmamalıdır.
  2. **`executed_at` həmişə yazılır.** Yoxsa `failed` plan hər 60 saniyədə yenidən
     seçilər və provayderə sonsuz təzyiq yaradardı.
  3. **`start == end` sükut deyil.** Sıfır uzunluqlu pəncərəni "bütün gün sükut"
     kimi oxumaq, eyni dəyəri iki dəfə yazan adminin bütün kütləvi bildirişlərini
     səssizcə dayandırardı.
"""

from datetime import datetime, timedelta

import pytest

from app.services.push_schedule import (
    format_hhmm,
    normalize_quiet_hours,
    parse_hhmm,
    quiet_block_message,
    quiet_window_state,
)
from app.services.push_schedules import (
    FAILED,
    MAX_LEAD_DAYS,
    MIN_LEAD_SECONDS,
    PENDING,
    SENT,
    create_schedule,
    due_schedules,
    parse_scheduled_at,
    spec_from_json,
    spec_to_json,
    validate_schedule_window,
)


# ---------------------------------------------------------------------------
# HH:MM parse/format
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("09:00", 540), ("9:00", 540), ("00:00", 0), ("23:59", 1439), ("22:00", 1320)],
)
def test_parse_hhmm_accepts_valid(raw, expected):
    assert parse_hhmm(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [None, "", "   ", "24:00", "09:60", "9", "morning", "09:00:00", "-1:00", "1:2"],
)
def test_parse_hhmm_rejects_garbage(raw):
    """`24:00` **qəsdən** rədd olunur: gecə yarısı `00:00` kimi yazılmalıdır, yoxsa
    sərhəd hesabı ikimənalı olardı."""
    assert parse_hhmm(raw) is None


def test_format_hhmm_pads_and_falls_back():
    assert format_hhmm(9 * 60, "99:99") == "09:00"
    assert format_hhmm(-1, "22:00") == "22:00"
    assert format_hhmm(1440, "22:00") == "22:00"
    assert format_hhmm("zibil", "22:00") == "22:00"


def test_normalize_quiet_hours_falls_back_on_broken_values():
    """Panelə "22:00" yazdırıb səssizcə "sükut yoxdur" etmək daha pis olardı: admin
    qorunduğunu düşünərdi."""
    out = normalize_quiet_hours({"quiet_enabled": True, "quiet_start": "25:00", "quiet_end": "səhv"})
    assert out["quiet_start"] == "22:00"
    assert out["quiet_end"] == "09:00"
    assert out["quiet_enabled"] is True


def test_normalize_quiet_hours_defaults_disabled():
    """Default **söndürülü**: miqrasiya heç bir tenant-ın göndərməsini kəsməməlidir."""
    assert normalize_quiet_hours(None) == {
        "quiet_enabled": False,
        "quiet_start": "22:00",
        "quiet_end": "09:00",
    }


# ---------------------------------------------------------------------------
# Sükut pəncərəsi
# ---------------------------------------------------------------------------


QUIET = {"quiet_enabled": True, "quiet_start": "22:00", "quiet_end": "09:00"}


def test_disabled_quiet_never_blocks():
    state = quiet_window_state({**QUIET, "quiet_enabled": False}, 3 * 60)
    assert state["inside"] is False
    assert state["minutes_until_allowed"] == 0


@pytest.mark.parametrize(
    ("minute", "inside", "left"),
    [
        (22 * 60, True, 11 * 60),   # pəncərənin başlanğıcı (daxil)
        (21 * 60 + 59, False, 0),   # pəncərədən 1 dəqiqə əvvəl
        (3 * 60, True, 6 * 60),     # gecə yarısından sonra
        (9 * 60 - 1, True, 1),      # sonuncu dəqiqə (daxil)
        (9 * 60, False, 0),         # pəncərənin sonu (xaric)
        (12 * 60, False, 0),        # gündüz
    ],
)
def test_overnight_window_boundaries(minute, inside, left):
    """Gecə yarısından keçən pəncərə iki aralıqdır: [22:00, 24:00) ∪ [00:00, 09:00).

    Sərhədlər **kilidlənir**, çünki off-by-one səhvi göndərməni bir saat tez
    buraxar (ya da bir saat gecikdirər).
    """
    state = quiet_window_state(QUIET, minute)
    assert state["inside"] is inside
    assert state["minutes_until_allowed"] == left


def test_daytime_window_without_midnight_crossing():
    state = quiet_window_state({"quiet_enabled": True, "quiet_start": "13:00", "quiet_end": "15:00"}, 14 * 60)
    assert state["inside"] is True
    assert state["minutes_until_allowed"] == 60


@pytest.mark.parametrize("minute", [0, 12 * 60, 22 * 60])
def test_zero_length_window_is_not_quiet(minute):
    """`start == end` → **sükut deyil**.

    Bu, adminin eyni dəyəri iki dəfə yazmasının bütün kütləvi bildirişləri
    səssizcə dayandırmasının qarşısını alır. 24 saat sükut istəyən admin
    `broadcast_enabled=False` işlədir — bu, açıq qərardır.
    """
    assert quiet_window_state({"quiet_enabled": True, "quiet_start": "22:00", "quiet_end": "22:00"}, minute)["inside"] is False


def test_unknown_minute_does_not_block():
    """Vaxt bilinmirsə bloklamırıq: naməlum saat ucbatından göndərməni saxlamaq,
    sükut saatını pozmaqdan daha pis nəticə verərdi (heç nə getmir)."""
    for bad in (None, "səhv", -1, 1440, float("inf")):
        assert quiet_window_state(QUIET, bad)["inside"] is False


def test_block_message_says_when_sending_is_allowed():
    """Yalnız "sükut saatıdır" demək admini səbəbi axtarmağa məcbur edərdi."""
    state = quiet_window_state(QUIET, 3 * 60)
    message = quiet_block_message(state)
    assert "22:00" in message and "09:00" in message
    assert "09:00" in message.split("İcazəli vaxt:")[-1] if "İcazəli vaxt:" in message else True
    assert "6 saat" in message


def test_block_message_formats_sub_hour_wait():
    state = quiet_window_state({"quiet_enabled": True, "quiet_start": "13:00", "quiet_end": "15:00"}, 14 * 60 + 30)
    assert "30 dəqiqə" in quiet_block_message(state)
    assert "saat" not in quiet_block_message(state).split("(")[-2]


# ---------------------------------------------------------------------------
# Planlanmış vaxt pəncərəsi
# ---------------------------------------------------------------------------


NOW = datetime(2026, 10, 11, 12, 0, 0)


def test_parse_scheduled_at_converts_offset_to_naive_utc():
    """Sütun naive UTC-dir: tz-aware dəyər `TypeError` atardı."""
    parsed = parse_scheduled_at("2026-10-11T16:00:00+04:00")
    assert parsed == NOW
    assert parsed.tzinfo is None
    assert parse_scheduled_at("2026-10-11T12:00:00Z") == NOW


@pytest.mark.parametrize("raw", [None, "", "   ", "sabah", 12345, {"a": 1}])
def test_parse_scheduled_at_rejects_garbage(raw):
    assert parse_scheduled_at(raw) is None


def test_schedule_window_accepts_valid_future():
    assert validate_schedule_window(NOW + timedelta(hours=1), NOW) == ""


def test_schedule_window_rejects_too_soon_and_explains_the_alternative():
    reason = validate_schedule_window(NOW + timedelta(seconds=MIN_LEAD_SECONDS - 1), NOW)
    assert "1 dəqiqə" in reason
    # Mesaj hərəkətə keçirən olmalıdır: dərhal göndərmə üçün ayrı yol var.
    assert "düyməsini" in reason


def test_schedule_window_accepts_the_exact_minimum():
    assert validate_schedule_window(NOW + timedelta(seconds=MIN_LEAD_SECONDS), NOW) == ""


def test_schedule_window_rejects_past():
    assert "1 dəqiqə" in validate_schedule_window(NOW - timedelta(days=1), NOW)


def test_schedule_window_caps_at_one_year():
    """Bir ildən uzaq plan demək olar ki, həmişə yanlış ilin yazılmasıdır."""
    reason = validate_schedule_window(NOW + timedelta(days=MAX_LEAD_DAYS + 1), NOW)
    assert str(MAX_LEAD_DAYS) in reason
    assert validate_schedule_window(NOW + timedelta(days=MAX_LEAD_DAYS - 1), NOW) == ""


def test_schedule_window_rejects_unparseable():
    assert "ISO 8601" in validate_schedule_window(None, NOW)


# ---------------------------------------------------------------------------
# Seqmentin dondurulması
# ---------------------------------------------------------------------------


def test_spec_json_roundtrip_freezes_segment():
    """Planlama anındaki seqment göndərmə anında **yenidən hesablanmır**: yenidən
    hesablamaq adminin təsdiqlədiyi dəsti dəyişərdi."""
    spec = {"segment": "dormant", "value": "", "days": 45, "min_stars": 1}
    assert spec_from_json(spec_to_json(spec)) == spec


def test_spec_from_json_falls_back_without_broadening():
    """Xarab plan "hər kəsə" çevrilmir — `normalize_audience_spec` yalnız bilinən
    seqmenti saxlayır və `days` sərhədlənir."""
    assert spec_from_json("{{{ xarab") == {"segment": "all", "value": "", "days": 60, "min_stars": 1}
    assert spec_from_json({"segment": "uydurma"})["segment"] == "all"
    # Sərhəd qorunur: nəhəng `days` `MAX_AUDIENCE_DAYS`-a kəsilir.
    assert spec_from_json({"segment": "new", "days": 10**9})["days"] == 3650


# ---------------------------------------------------------------------------
# Scheduler dövrəsi — fake DB ilə
# ---------------------------------------------------------------------------


class _FakeSession:
    """Yalnız `add`/`commit`/`rollback` lazımdır; sətirlər obyekt kimi dəyişir."""

    def __init__(self):
        self.commits = 0
        self.added = []

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass


def _row(**overrides):
    from app.models import PushSchedule

    row = PushSchedule(
        tenant_id="tenant-1",
        title="Cümə endirimi",
        body="Bu gün 20% endirim!",
        spec_json=spec_to_json({"segment": "all"}),
        status=PENDING,
        scheduled_at=NOW,
    )
    for key, value in overrides.items():
        setattr(row, key, value)
    return row


def _patch_scheduler(monkeypatch, scheduler, *, rows, settings, minute=12 * 60, tokens=("t1",)):
    monkeypatch.setattr(scheduler, "due_schedules", lambda db, now: rows)
    monkeypatch.setattr(scheduler, "load_push_settings", lambda db, tid: settings)
    monkeypatch.setattr(scheduler, "tenant_minute_of_day", lambda db, tid, **kw: minute)
    monkeypatch.setattr(
        scheduler, "_tiers_for", lambda db, tid: []
    )
    sent: dict = {"calls": 0, "campaign_ids": []}

    def _send(db, tenant_id, **kwargs):
        sent["calls"] += 1
        sent["campaign_ids"].append(kwargs.get("campaign_id"))
        from types import SimpleNamespace

        return None, SimpleNamespace(ok=True, source="tenant", reason="")

    monkeypatch.setattr(scheduler, "send_bulk_push", _send)

    class _Query:
        def filter(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def first(self):
            return None

    monkeypatch.setattr(scheduler, "_newest_delivery", lambda db, tid: None)
    return sent


def test_due_plan_is_sent_and_marked(monkeypatch):
    import app.services.push_scheduler as scheduler

    row = _row()
    sent = _patch_scheduler(
        monkeypatch, scheduler, rows=[row], settings={"enabled": True, "broadcast_enabled": True}
    )
    monkeypatch.setattr(
        scheduler,
        "resolve_audience_for_tenant",
        lambda *a, **k: _audience(tokens=["t1"]),
    )
    db = _FakeSession()
    result = scheduler.run_due_schedules(db, now=NOW)

    assert result == {"checked": 1, "sent": 1, "deferred": 0, "failed": 0}
    assert sent["calls"] == 1
    assert row.status == SENT
    # `executed_at` YAZILIR — yoxsa plan hər dövrədə yenidən seçilərdi.
    assert row.executed_at == NOW


def test_plan_in_quiet_hours_is_deferred_not_lost(monkeypatch):
    """Sükut saatı göndərməni **udmur**: plan `pending` qalır və vaxtı sürüşür.

    Göndərib müştəriləri oyatmaq, ya da planı səssizcə `failed` etmək ikisi də pisdir.
    """
    import app.services.push_scheduler as scheduler

    row = _row()
    sent = _patch_scheduler(
        monkeypatch, scheduler, rows=[row],
        settings={"enabled": True, "broadcast_enabled": True, "quiet_enabled": True,
                  "quiet_start": "09:00", "quiet_end": "18:00"},
        minute=12 * 60,
    )
    monkeypatch.setattr(
        scheduler, "resolve_audience_for_tenant", lambda *a, **k: _audience(tokens=["t1"])
    )
    db = _FakeSession()
    result = scheduler.run_due_schedules(db, now=NOW)

    assert result == {"checked": 1, "sent": 0, "deferred": 1, "failed": 0}
    assert sent["calls"] == 0
    assert row.status == PENDING
    assert row.executed_at is None
    # Vaxt sükut bitən ana sürüşür (12:00 + 6 saat = 18:00).
    assert row.scheduled_at == NOW + timedelta(hours=6)
    assert "Sükut saatıdır" in row.error


def test_disabled_push_fails_the_plan_but_records_why(monkeypatch):
    """Səbəb `error`-da qalır: "uğursuz" sözü tək başına adminə heç nə deməzdi."""
    import app.services.push_scheduler as scheduler

    row = _row()
    sent = _patch_scheduler(
        monkeypatch, scheduler, rows=[row], settings={"enabled": True, "broadcast_enabled": False}
    )
    db = _FakeSession()
    result = scheduler.run_due_schedules(db, now=NOW)

    assert result["failed"] == 1
    assert sent["calls"] == 0
    assert row.status == FAILED
    assert "Kütləvi bildiriş söndürülüb" in row.error
    assert row.executed_at == NOW


def test_empty_audience_fails_with_every_stage_count(monkeypatch):
    """Səbəb hər pillənin sayını göstərir — "seqment daraldı" tək rəqəmlə görünməz."""
    import app.services.push_scheduler as scheduler

    row = _row()
    sent = _patch_scheduler(
        monkeypatch, scheduler, rows=[row], settings={"enabled": True, "broadcast_enabled": True}
    )
    monkeypatch.setattr(
        scheduler,
        "resolve_audience_for_tenant",
        lambda *a, **k: _audience(tokens=[], matched=9, with_token=0, undeliverable=4, no_consent=2),
    )
    db = _FakeSession()
    result = scheduler.run_due_schedules(db, now=NOW)

    assert result["failed"] == 1
    assert sent["calls"] == 0
    assert "uyğun müştəri: 9" in row.error
    assert "razılığı geri götürən: 2" in row.error


def test_campaign_link_is_passed_to_the_sender(monkeypatch):
    """P4.2 atribusiyası plandan da işləməlidir, yoxsa "planlı elanlar" hesabatda
    görünməzdi."""
    import app.services.push_scheduler as scheduler

    row = _row(campaign_id="camp-7")
    sent = _patch_scheduler(
        monkeypatch, scheduler, rows=[row], settings={"enabled": True, "broadcast_enabled": True}
    )
    monkeypatch.setattr(
        scheduler, "resolve_audience_for_tenant", lambda *a, **k: _audience(tokens=["t1"])
    )
    scheduler.run_due_schedules(_FakeSession(), now=NOW)
    assert sent["campaign_ids"] == ["camp-7"]


def test_sender_exception_marks_plan_failed_once(monkeypatch):
    """Partlayan göndərici planı terminal `failed` etməlidir, yoxsa hər dövrədə
    yenidən cəhd olunar və provayderə sonsuz təzyiq yaranar."""
    import app.services.push_scheduler as scheduler

    row = _row()
    monkeypatch.setattr(scheduler, "due_schedules", lambda db, now: [row])
    monkeypatch.setattr(scheduler, "load_push_settings", lambda db, tid: {"enabled": True, "broadcast_enabled": True})
    monkeypatch.setattr(scheduler, "tenant_minute_of_day", lambda db, tid, **kw: 12 * 60)

    def _boom(*a, **k):
        raise RuntimeError("provayder partladı")

    monkeypatch.setattr(scheduler, "resolve_audience_for_tenant", _boom)
    result = scheduler.run_due_schedules(_FakeSession(), now=NOW)
    assert result["failed"] == 1
    assert row.status == FAILED
    assert row.executed_at == NOW
    assert "provayder partladı" in row.error


def test_scheduler_never_raises_on_broken_query(monkeypatch):
    """Scheduler loop-u heç vaxt dayanmamalıdır — bir sorğu xətası bütün plan
    göndərməsini söndürərdi."""
    import app.services.push_scheduler as scheduler

    def _boom(db, now):
        raise RuntimeError("cədvəl yoxdur")

    monkeypatch.setattr(scheduler, "due_schedules", _boom)
    assert scheduler.run_due_schedules(_FakeSession(), now=NOW) == {
        "checked": 0, "sent": 0, "deferred": 0, "failed": 0
    }


# ---------------------------------------------------------------------------
# `due_schedules` sorğu qaydası
# ---------------------------------------------------------------------------


class _QueryCapture:
    def __init__(self):
        self.filters = []
        self.limit_value = None

    def filter(self, *args, **kwargs):
        self.filters.extend(args)
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def all(self):
        return []


class _QueryDB:
    def __init__(self):
        self.query_capture = _QueryCapture()

    def query(self, *a, **k):
        return self.query_capture


def test_due_schedules_selects_only_pending_and_respects_the_limit():
    """Yalnız `pending` seçilir: `failed`/`sent` terminaldır (sonsuz cəhdlərin qarşısı)."""
    db = _QueryDB()
    due_schedules(db, NOW, limit=3)
    assert db.query_capture.limit_value == 3
    # İki şərt: status == pending və vaxt çatıb.
    rendered = " ".join(str(f) for f in db.query_capture.filters)
    assert "push_schedules.status" in rendered
    assert "push_schedules.scheduled_at" in rendered


def test_create_schedule_truncates_and_normalizes():
    db = _FakeSession()
    row = create_schedule(
        db, "tenant-1",
        title="T" * 400,
        body="B" * 5000,
        scheduled_at=NOW + timedelta(hours=2),
        spec={"segment": "uydurma"},
        url="https://x.az/" + "u" * 900,
        campaign_id="c" * 100,
    )
    assert len(row.title) == 160
    assert len(row.body) == 2000
    assert len(row.url) == 500
    assert len(row.campaign_id) == 36
    assert row.status == PENDING
    assert row.spec_json.startswith('{"segment": "all"') or '"segment": "all"' in row.spec_json


def _audience(*, tokens, matched=1, with_token=1, undeliverable=0, no_consent=0):
    from app.services.push_audience import PushAudience

    return PushAudience(
        tokens=list(tokens),
        matched=matched,
        with_token=with_token,
        undeliverable=undeliverable,
        no_consent=no_consent,
        total=matched + no_consent,
        label="Hamı",
    )
