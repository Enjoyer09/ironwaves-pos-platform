"""P1.4 — broadcast seqmenti (`app/services/push_audience.py`).

Niyə bu testlər: seqment mühərriki panelin ön baxışı (`POST /push/preview`) ilə
real göndərmənin (`POST /push/broadcast`) **eyni** funksiyasıdır. Burada səhv
olsa panel "412 alıcı" deyib 30 nəfərə göndərə bilər — P0.4 dürüstlük qaydasının
birbaşa pozulması — və ya səhv seqmentə spam gedər.

Dörd qayda qəsdən kilidlənir:

  1. **`days` heç vaxt 0 olmur.** Panel sahəni boş göndərə bilər; `0 gün` "yeni"
     üçün heç kimi, "yatmış" üçün hamını seçərdi. Normalizer seqmentdən asılı
     default qoyur (`new` → 30, qalanı → 60) və aşağı həddi 1-dir.
  2. **Say pillələri ayrıdır.** `matched` (seqmentə uyğun), `with_token`
     (token-i olan), `undeliverable` (native cihaz tokeni), `recipients` (real
     göndəriləcək) — tək rəqəm göstərmək tenant-ı aldadardı.
  3. **`current_tier_key` `operations._compute_tier` ilə hərfi eynidir.** Fərq
     yaranarsa panel "Gold-a göndər" deyib başqa dəstəyə göndərər.
  4. **Modul heç vaxt exception atmır.** Xarab sətir, `None`, tz-aware/naive
     qarışığı — hamısı sadəcə "uyğunsuz" sayılır.

Fayl yalnız saf funksiyaları import edir (DB, HTTP, auth yoxdur). JS güzgüsü
`src/lib/push.ts`-dədir və `tests/crm_local_smoke.test.mjs` onu eyni girişlərlə
yoxlayır.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.services.push_audience import (
    AUDIENCE_SEGMENTS,
    DEFAULT_DORMANT_DAYS,
    DEFAULT_MIN_STARS,
    DEFAULT_NEW_DAYS,
    MAX_AUDIENCE_DAYS,
    SEGMENT_LABELS,
    audience_label,
    current_tier_key,
    normalize_audience_spec,
    resolve_push_audience,
)

NOW = datetime(2026, 9, 5, 12, 0, 0)

SUB_A = "11111111-1111-4111-8111-111111111111"
SUB_B = "22222222-2222-4222-8222-222222222222"
SUB_C = "33333333-3333-4333-8333-333333333333"
#: Native APNs cihaz tokeni — çatdırıla bilməyən forma.
NATIVE_TOKEN = "a" * 64

TIERS = [
    {"key": "bronze", "threshold": 0, "label": {"az": "Bürünc"}},
    {"key": "silver", "threshold": 50, "label": {"az": "Gümüş"}},
    {"key": "gold", "threshold": 200, "label": {"az": "Qızıl"}},
]


def row(**kwargs):
    """Sətir köməkçisi — endpoint-in verdiyi sxem (hamısı optional)."""
    base = {"card_id": "c1", "push_token": SUB_A, "created_at": NOW, "last_sale_at": NOW, "stars": 0, "lifetime_stars": 0}
    base.update(kwargs)
    return base


# ---------------------------------------------------------------------------
# normalize_audience_spec
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", [None, {}, [], "", 0, "zibil", {"segment": "yoxdur"}])
def test_normalize_unknown_input_falls_back_to_all(value):
    """Naməlum seqment "all"-a düşür — endpoint 500 qaytarmasın."""
    assert normalize_audience_spec(value)["segment"] == "all"


@pytest.mark.parametrize("segment", AUDIENCE_SEGMENTS)
def test_normalize_keeps_every_known_segment(segment):
    assert normalize_audience_spec({"segment": segment})["segment"] == segment


def test_normalize_lowercases_and_trims_segment():
    assert normalize_audience_spec({"segment": "  DORMANT "})["segment"] == "dormant"


@pytest.mark.parametrize(
    ("segment", "expected"),
    [("new", DEFAULT_NEW_DAYS), ("dormant", DEFAULT_DORMANT_DAYS), ("all", DEFAULT_DORMANT_DAYS)],
)
def test_normalize_days_default_depends_on_segment(segment, expected):
    """Boş sahə seqmentə uyğun defaultla dolur, `0` ilə deyil."""
    assert normalize_audience_spec({"segment": segment})["days"] == expected


@pytest.mark.parametrize("raw", [0, -5, "0", "", None, "zibil", True, float("inf")])
def test_normalize_never_yields_zero_days(raw):
    """`days=0` "yeni" üçün heç kimi, "yatmış" üçün hamını seçərdi — aşağı hədd 1."""
    assert normalize_audience_spec({"segment": "new", "days": raw})["days"] >= 1


def test_normalize_clamps_days_to_max():
    assert normalize_audience_spec({"days": 99999})["days"] == MAX_AUDIENCE_DAYS


@pytest.mark.parametrize(("raw", "expected"), [("7", 7), ("7.9", 7), (7.9, 7)])
def test_normalize_coerces_numeric_days(raw, expected):
    assert normalize_audience_spec({"days": raw})["days"] == expected


@pytest.mark.parametrize("raw", [0, -3, "", None, True])
def test_normalize_min_stars_floor_is_one(raw):
    """`min_stars=0` "balansı olanlar" seqmentini mənasız edir (hamı keçər)."""
    assert normalize_audience_spec({"min_stars": raw})["min_stars"] == DEFAULT_MIN_STARS


def test_normalize_trims_value_to_32_chars():
    assert normalize_audience_spec({"value": "  " + "g" * 80})["value"] == "g" * 32


def test_normalize_output_shape_is_fixed():
    """Endpoint bu 4 açarı gözləyir — sxem dəyişsə router səssiz sınar."""
    assert set(normalize_audience_spec(None)) == {"segment", "value", "days", "min_stars"}


# ---------------------------------------------------------------------------
# current_tier_key — `operations._compute_tier` ilə paritet
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("stars", "expected"),
    [(0, "bronze"), (49, "bronze"), (50, "silver"), (199, "silver"), (200, "gold"), (5000, "gold")],
)
def test_tier_picks_last_reached_threshold(stars, expected):
    assert current_tier_key(stars, TIERS) == expected


def test_tier_sorts_unordered_rows_before_deciding():
    """Ayarlarda pillələr istənilən sırada saxlanıla bilər."""
    shuffled = [TIERS[2], TIERS[0], TIERS[1]]
    assert current_tier_key(120, shuffled) == "silver"


@pytest.mark.parametrize("stars", [-10, None, "zibil", ""])
def test_tier_treats_bad_stars_as_zero(stars):
    assert current_tier_key(stars, TIERS) == "bronze"


@pytest.mark.parametrize("tiers", [None, [], [{}], [{"key": "  "}], "zibil"])
def test_tier_returns_empty_when_catalogue_unusable(tiers):
    """Pillə yoxdursa boş sətir — uydurma "bronze" qaytarmaq səhv seqment verərdi."""
    assert current_tier_key(100, tiers) == ""


def test_tier_key_is_lowercased():
    assert current_tier_key(0, [{"key": "  GOLD  ", "threshold": 0}]) == "gold"


# ---------------------------------------------------------------------------
# audience_label — paneldə və `push_deliveries.segment_value`-da görünən mətn
# ---------------------------------------------------------------------------


def test_label_new_and_dormant_carry_the_day_window():
    assert audience_label({"segment": "new", "days": 14}) == f"{SEGMENT_LABELS['new']} (son 14 gün)"
    assert "45 gündən çox" in audience_label({"segment": "dormant", "days": 45})


def test_label_has_balance_shows_threshold():
    assert audience_label({"segment": "has_balance", "min_stars": 12}).endswith("(≥ 12)")


def test_label_tier_uses_azerbaijani_name_from_catalogue():
    assert audience_label({"segment": "tier", "value": "GOLD"}, TIERS) == f"{SEGMENT_LABELS['tier']}: Qızıl"


def test_label_tier_falls_back_to_key_when_unknown():
    assert audience_label({"segment": "tier", "value": "platinum"}, TIERS).endswith(": platinum")


def test_label_tier_without_value_shows_dash():
    assert audience_label({"segment": "tier"}, TIERS).endswith(": —")


def test_label_all_is_plain():
    assert audience_label(None) == SEGMENT_LABELS["all"]


# ---------------------------------------------------------------------------
# resolve_push_audience — say pillələri
# ---------------------------------------------------------------------------


def test_audience_reports_every_stage_separately():
    """Bir rəqəm yox, dörd rəqəm: uyğun → token-i olan → çatdırılmayan → alıcı.

    Panel "412 uyğun müştəri, 128-i abunədir" yaza bilsin. Tək `recipients`
    göstərmək tenant-a hamıya çatacağı illüziyasını verərdi.
    """
    rows = [
        row(card_id="1", push_token=SUB_A),
        row(card_id="2", push_token=NATIVE_TOKEN),   # native cihaz tokeni
        row(card_id="3", push_token=""),             # abunə deyil
        row(card_id="4", push_token=SUB_A),          # təkrar token
        row(card_id="5", push_token=SUB_B),
    ]
    audience = resolve_push_audience(rows, {"segment": "all"}, now=NOW, tiers=TIERS)
    assert audience.total == 5
    assert audience.matched == 5
    assert audience.with_token == 3          # SUB_A, SUB_B, NATIVE (təkrar silinib)
    assert audience.undeliverable == 1
    assert audience.recipients == 2
    assert audience.tokens == [SUB_A, SUB_B]
    assert "native" in audience.note.lower() or "cihaz tokeni" in audience.note


def test_audience_dict_never_leaks_tokens():
    """Cavab paneldə göstərilir — token siyahısı ora düşməməlidir."""
    audience = resolve_push_audience([row()], {"segment": "all"}, now=NOW)
    data = audience.as_dict()
    assert "tokens" not in data
    assert SUB_A not in str(data)
    assert set(data) == {"recipients", "matched", "with_token", "undeliverable", "capped", "total", "label", "note"}


@pytest.mark.parametrize("rows", [None, [], [None, "zibil", 5], [{}, {"push_token": None}]])
def test_audience_never_raises_on_garbage_rows(rows):
    audience = resolve_push_audience(rows, {"segment": "new"}, now=NOW)
    assert audience.recipients == 0


def test_audience_mixed_naive_and_aware_datetimes_do_not_crash():
    """DB naive UTC verir, bəzi yollar tz-aware — müqayisə `TypeError` atmamalıdır."""
    aware = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)
    audience = resolve_push_audience(
        [row(created_at=aware), row(created_at="2026-09-01T10:00:00Z"), row(created_at="xarab-tarix")],
        {"segment": "new", "days": 30},
        now=NOW,
    )
    assert audience.matched == 2  # xarab tarix uyğunsuz sayılır


# ---------------------------------------------------------------------------
# Seqmentlərin qaydası
# ---------------------------------------------------------------------------


def test_segment_new_uses_registration_window():
    rows = [
        row(card_id="tazə", created_at=NOW - timedelta(days=5)),
        row(card_id="sərhəd", created_at=NOW - timedelta(days=30)),
        row(card_id="köhnə", created_at=NOW - timedelta(days=31)),
        row(card_id="tarixsiz", created_at=None),
    ]
    audience = resolve_push_audience(rows, {"segment": "new", "days": 30}, now=NOW)
    assert audience.matched == 2  # "tazə" + "sərhəd" (>= şərti daxildir)


def test_segment_dormant_uses_last_sale():
    rows = [
        row(card_id="aktiv", last_sale_at=NOW - timedelta(days=10)),
        row(card_id="yatmış", last_sale_at=NOW - timedelta(days=90)),
    ]
    audience = resolve_push_audience(rows, {"segment": "dormant", "days": 60}, now=NOW)
    assert audience.matched == 1


def test_segment_dormant_falls_back_to_registration_for_never_buyers():
    """Heç vaxt alış etməyən müştəri dərhal "yatmış" sayılmır.

    Əks halda dünən qeydiyyatdan keçən müştəri ilk gündən "sizi darıxdıq"
    bildirişi alardı.
    """
    rows = [
        row(card_id="dünən", last_sale_at=None, created_at=NOW - timedelta(days=1)),
        row(card_id="çoxdan", last_sale_at=None, created_at=NOW - timedelta(days=120)),
        row(card_id="tarixsiz", last_sale_at=None, created_at=None),
    ]
    audience = resolve_push_audience(rows, {"segment": "dormant", "days": 60}, now=NOW)
    assert audience.matched == 1


def test_segment_tier_matches_computed_tier_not_a_stored_field():
    rows = [row(card_id="a", lifetime_stars=0), row(card_id="b", lifetime_stars=60), row(card_id="c", lifetime_stars=500)]
    audience = resolve_push_audience(rows, {"segment": "tier", "value": "silver"}, now=NOW, tiers=TIERS)
    assert audience.matched == 1


def test_segment_tier_without_value_matches_nobody():
    """Boş pillə "hamı" demək DEYİL — yoxsa "Gold-a göndər" bütün bazaya gedər."""
    rows = [row(card_id="a", lifetime_stars=0), row(card_id="b", lifetime_stars=500)]
    assert resolve_push_audience(rows, {"segment": "tier", "value": ""}, now=NOW, tiers=TIERS).matched == 0


def test_segment_tier_without_catalogue_matches_nobody():
    rows = [row(lifetime_stars=500)]
    assert resolve_push_audience(rows, {"segment": "tier", "value": "gold"}, now=NOW, tiers=None).matched == 0


def test_segment_has_balance_uses_current_stars_not_lifetime():
    """Balans `stars`-dır; `lifetime_stars` pillə üçündür — qarışsa hədiyyəsi
    olmayan müştəri "balansın var" bildirişi alar."""
    rows = [row(card_id="a", stars=0, lifetime_stars=900), row(card_id="b", stars=5, lifetime_stars=5)]
    audience = resolve_push_audience(rows, {"segment": "has_balance", "min_stars": 3}, now=NOW, tiers=TIERS)
    assert audience.matched == 1


# ---------------------------------------------------------------------------
# Hədd (cap) və etiket
# ---------------------------------------------------------------------------


def test_audience_caps_recipients_and_says_so():
    rows = [row(card_id=str(i), push_token=t) for i, t in enumerate([SUB_A, SUB_B, SUB_C])]
    audience = resolve_push_audience(rows, {"segment": "all"}, now=NOW, limit=2)
    assert audience.recipients == 2
    assert audience.capped is True
    assert audience.with_token == 3          # kəsilmə uyğun sayı gizlətmir
    assert "həddinə qədər kəsildi" in audience.note


def test_audience_not_capped_when_exactly_at_limit():
    rows = [row(card_id="1", push_token=SUB_A), row(card_id="2", push_token=SUB_B)]
    audience = resolve_push_audience(rows, {"segment": "all"}, now=NOW, limit=2)
    assert (audience.recipients, audience.capped) == (2, False)


@pytest.mark.parametrize("limit", [0, None, -5])
def test_audience_zero_limit_falls_back_to_platform_max(limit):
    """`limit=0` "heç kimə göndərmə" demək deyil — bu, kütləvi bildirişin
    gündəlik həddi (`broadcast_daily_limit`) ilə qarışdırılmamalıdır."""
    audience = resolve_push_audience([row()], {"segment": "all"}, now=NOW, limit=limit)
    assert audience.recipients == 1


def test_audience_carries_the_label_for_the_delivery_log():
    audience = resolve_push_audience([row()], {"segment": "new", "days": 7}, now=NOW)
    assert audience.label == f"{SEGMENT_LABELS['new']} (son 7 gün)"


def test_audience_note_is_empty_when_nothing_is_wrong():
    audience = resolve_push_audience([row()], {"segment": "all"}, now=NOW)
    assert audience.note == ""


def test_audience_defaults_to_all_when_spec_missing():
    rows = [row(card_id="1"), row(card_id="2", push_token=SUB_B)]
    assert resolve_push_audience(rows, None, now=NOW).recipients == 2
