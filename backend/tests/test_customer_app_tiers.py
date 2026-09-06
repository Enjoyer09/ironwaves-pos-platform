"""P1.2 — tier (səviyyə) nərdivanının normalizeri və oxunuşu.

Niyə bu testlər: nərdivan **tək blobda** (`app_settings["tiers"]`) saxlanılır və
dörd yerdən oxunur:

  * `operations.py::_norm_customer_app_tiers` — PATCH-də yazılanı təmizləyir;
  * `operations.py::_compute_tier` — customer app-a hansı pillədə olduğunu deyir;
  * `loyalty_accrual.py::find_tier_multiplier` — kassada çarpanı seçir;
  * `src/api/settings.ts::normCustomerAppTiers` + `src/api/crm.ts::computeTier`
    — panelin ön baxışı və lokal rejim (JS güzgüləri).

PATCH birləşməsi **yalnız üst səviyyə açar** dəqiqliyindədir: `tiers` göndərilsə
nərdivanın hamısı əvəz olunur. Ona görə normalizerin hər qaydası (nə atılır, nə
kəsilir, nə çevrilir) burada yazılıb — qayda səssizcə dəyişsə tenant-ın nərdivanı
bir PATCH-lə itə bilər.

Bu fayl yalnız **saf funksiyaları** import edir (DB, HTTP, auth yoxdur).
"""

import pytest

from app.routers.operations import (
    DEFAULT_TIERS,
    FALLBACK_TIER_COLOR,
    MAX_CUSTOMER_APP_TIERS,
    _compute_tier,
    _default_customer_app_tiers,
    _norm_customer_app_tiers,
    _tier_threshold,
)
from app.services.loyalty_accrual import (
    MAX_TIER_MULTIPLIER,
    find_tier_multiplier,
    resolve_tier_multiplier,
)

TIER_FIELDS = {"key", "label", "threshold", "color", "multiplier", "discount_percent"}
GATE_ON = {"tier_multiplier_enabled": True}


# ---------------------------------------------------------------- defaultlar


def test_default_ladder_shape():
    """Default nərdivan: 3 pillə, sıralı, ən aşağısı 0-dan başlayır."""
    rows = _default_customer_app_tiers()
    assert [r["key"] for r in rows] == ["bronze", "silver", "gold"]
    assert [r["threshold"] for r in rows] == [0, 100, 300]
    assert rows[0]["threshold"] == 0, "ən aşağı pillə 0 olmasa yeni müştəri tier-siz qalır"
    for row in rows:
        assert set(row) == TIER_FIELDS, "JS güzgüsü ilə eyni sahələr olmalıdır"
        assert set(row["label"]) == {"az", "ru", "en"}
        assert row["color"].startswith("#")
        # P1.2a — `discount_percent` defaultda da olmalıdır, yoxsa JS tərəfin
        # defaultu ilə forması fərqlənir (orada həmişə var).
        assert row["discount_percent"] == 0.0


def test_fallback_color_is_lowest_tier():
    """Fallback rəng ən aşağı pillənin rəngidir — `loyalty.ts::FALLBACK_TIER_COLOR` güzgüsü."""
    assert FALLBACK_TIER_COLOR == DEFAULT_TIERS[0]["color"]


def test_default_copy_is_deep():
    """`label` dict-i paylaşılsa çağıran tərəf modul defaultunu korlayır."""
    first = _default_customer_app_tiers()
    first[0]["label"]["az"] = "DƏYİŞDİ"
    first[0]["threshold"] = 999
    assert _default_customer_app_tiers()[0]["label"]["az"] == DEFAULT_TIERS[0]["label"]["az"]
    assert _default_customer_app_tiers()[0]["threshold"] == 0


# ------------------------------------------------------- defaultlara qayıtma

RESET_INPUTS = [
    (None, "açar yoxdur / null"),
    ([], "boş massiv — panel bunu göndərməməlidir, göndərsə nərdivan sıfırlanır"),
    ("gold", "sətir"),
    ({"key": "gold"}, "tək obyekt (massiv deyil)"),
    (0, "rəqəm"),
    ([{}, {"label": "VIP"}], "bütün sətirlər açarsız"),
    ([{"key": "!!!"}], "açar yalnız qadağan simvollardan"),
    ([1, "x", None, True], "heç bir sətir dict deyil"),
]


@pytest.mark.parametrize("raw,why", RESET_INPUTS)
def test_reset_inputs_fall_back_to_defaults(raw, why):
    assert _norm_customer_app_tiers(raw) == _default_customer_app_tiers(), why


# ------------------------------------------------------------------- açarlar

KEY_CASES = [
    ("gold", "gold", "təmiz açar dəyişmir"),
    ("  Gold  ", "gold", "kənar boşluqlar atılır"),
    ("Gold-Star!!", "goldstar", "qadağan simvollar silinir, birləşdirilmir"),
    ("VIP_2", "vip_2", "alt xətt və rəqəm qalır"),
    ("Qızıl", "qzl", "ASCII olmayan hərflər silinir — panel açarı latın yazmalıdır"),
    ("abcdefghij" * 4, "abcdefghij" * 3 + "ab", "32 simvola kəsilir"),
]


@pytest.mark.parametrize("raw,expected,why", KEY_CASES)
def test_key_slug(raw, expected, why):
    rows = _norm_customer_app_tiers([{"key": raw}])
    assert rows[0]["key"] == expected, why


def test_keyless_rows_are_dropped():
    rows = _norm_customer_app_tiers([{"key": "a"}, {}, {"key": ""}, {"key": "   "}, "x", None])
    assert [r["key"] for r in rows] == ["a"]


def test_duplicate_keys_are_kept():
    """Backend dedup ETMİR — panel bunu xəbərdarlıqla göstərir, gizlətmir.

    İkisi qalır, tətbiqdə hansının görünəcəyini `threshold` müəyyən edir.
    """
    rows = _norm_customer_app_tiers(
        [{"key": "gold", "threshold": 0}, {"key": "gold", "threshold": 100}]
    )
    assert [r["key"] for r in rows] == ["gold", "gold"]
    assert [r["threshold"] for r in rows] == [0, 100]


# -------------------------------------------------------------------- adlar


def test_label_dict_falls_back_az_then_key():
    rows = _norm_customer_app_tiers([{"key": "bronze", "label": {"az": "Bürünc"}}])
    assert rows[0]["label"] == {"az": "Bürünc", "ru": "Bürünc", "en": "Bürünc"}


def test_label_empty_dict_falls_back_to_key():
    rows = _norm_customer_app_tiers([{"key": "bronze", "label": {}}])
    assert rows[0]["label"] == {"az": "bronze", "ru": "bronze", "en": "bronze"}


def test_label_string_applies_to_all_languages():
    rows = _norm_customer_app_tiers([{"key": "vip", "label": "  VIP  "}])
    assert rows[0]["label"] == {"az": "VIP", "ru": "VIP", "en": "VIP"}


@pytest.mark.parametrize("raw", [0, False, None, "", "   "])
def test_label_falsy_falls_back_to_key(raw):
    """`str(value or "")` — `0` və `False` boş sayılır (JS `|| ''` güzgüsü)."""
    rows = _norm_customer_app_tiers([{"key": "bronze", "label": raw}])
    assert rows[0]["label"]["az"] == "bronze"


def test_label_is_truncated_to_60():
    rows = _norm_customer_app_tiers([{"key": "a", "label": "ə" * 80}])
    assert len(rows[0]["label"]["az"]) == 60


# ------------------------------------------------------------------ rəqəmlər

# `threshold` ayrı cədvəldədir, çünki **ən aşağı pillə həmişə 0-a məcbur edilir**:
# tək sətirli nərdivanda hər hədd 0 çıxardı və test heç nə yoxlamazdı. Ona görə
# hər case-də 0-da "dayaq" sətir var və yoxlanan sətir ikincidir.
THRESHOLD_CASES = [
    (150, 150, "tam ədəd olduğu kimi"),
    ("300", 300, "rəqəmli sətir"),
    (150.7, 150, "KƏSİLİR, yuvarlaqlaşmır — `int(float(x))`; JS `Math.round` 151 verirdi"),
    (-5, 0, "mənfi hədd 0-a"),
    (9_999_999, 1_000_000, "yuxarı hədd"),
    (True, 0, "bool 'yoxdur' sayılır (True == 1 tələsi)"),
    ("abc", 0, "zibil fallback-a"),
    (None, 0, "yoxdursa 0"),
]


@pytest.mark.parametrize("raw,expected,why", THRESHOLD_CASES)
def test_threshold_bounds(raw, expected, why):
    rows = _norm_customer_app_tiers([{"key": "anchor", "threshold": 0}, {"key": "b", "threshold": raw}])
    row = next(r for r in rows if r["key"] == "b")
    assert row["threshold"] == expected, f"threshold={raw!r}: {why}"


FLOAT_CASES = [
    ("multiplier", 1.5, 1.5, "onluq çarpan"),
    ("multiplier", "1.5", 1.5, "rəqəmli sətir"),
    ("multiplier", 0, 0.0, "0 QANUNİDİR — bu pillə qazanmır"),
    ("multiplier", -3, 0.0, "mənfi 0-a"),
    ("multiplier", 25, float(MAX_TIER_MULTIPLIER), "yuxarı hədd accrual-ın həddidir"),
    ("multiplier", None, 1.0, "yoxdursa 1"),
    ("multiplier", "abc", 1.0, "zibil 1-ə"),
    ("multiplier", float("inf"), 1.0, "inf 1-ə"),
    ("multiplier", 1.23456, 1.2346, "4 onluğa yuvarlaqlaşır"),
    ("discount_percent", 5, 5.0, "tam faiz"),
    ("discount_percent", 150, 100.0, "yuxarı hədd"),
    ("discount_percent", -1, 0.0, "mənfi 0-a"),
    ("discount_percent", None, 0.0, "yoxdursa 0"),
]


@pytest.mark.parametrize("field,raw,expected,why", FLOAT_CASES)
def test_float_bounds(field, raw, expected, why):
    rows = _norm_customer_app_tiers([{"key": "a", field: raw}])
    assert rows[0][field] == expected, f"{field}={raw!r}: {why}"


COLOR_CASES = [
    ("#ABC", "#ABC", "3 rəqəmli hex"),
    ("#cd7f32", "#cd7f32", "6 rəqəmli hex"),
    ("#11223344", "#11223344", "8 rəqəmli hex (alfa)"),
    ("  #cd7f32  ", "#cd7f32", "boşluqlar atılır"),
    ("red", FALLBACK_TIER_COLOR, "ad qəbul edilmir — dəyər inline style-a düşür"),
    ("#GGGGGG", FALLBACK_TIER_COLOR, "hex olmayan simvol"),
    ("cd7f32", FALLBACK_TIER_COLOR, "# olmadan"),
    ("javascript:alert(1)", FALLBACK_TIER_COLOR, "inyeksiya cəhdi"),
    (0, FALLBACK_TIER_COLOR, "rəqəm"),
    (None, FALLBACK_TIER_COLOR, "yoxdur"),
]


@pytest.mark.parametrize("raw,expected,why", COLOR_CASES)
def test_color_validation(raw, expected, why):
    rows = _norm_customer_app_tiers([{"key": "a", "color": raw}])
    assert rows[0]["color"] == expected, why


# ----------------------------------------------------------- sıra və hədd


def test_rows_are_sorted_by_threshold():
    rows = _norm_customer_app_tiers(
        [
            {"key": "gold", "threshold": 300},
            {"key": "bronze", "threshold": 0},
            {"key": "silver", "threshold": 100},
        ]
    )
    assert [r["key"] for r in rows] == ["bronze", "silver", "gold"]


def test_lowest_threshold_is_forced_to_zero():
    """Ən aşağı pillə 0-dan başlamalıdır, yoxsa 0 ulduzlu müştəri heç bir pilləyə düşmür."""
    rows = _norm_customer_app_tiers(
        [{"key": "a", "threshold": 200}, {"key": "b", "threshold": 50}, {"key": "c", "threshold": 100}]
    )
    assert [(r["key"], r["threshold"]) for r in rows] == [("b", 0), ("c", 100), ("a", 200)]


def test_equal_thresholds_keep_input_order():
    """`list.sort` stabildir — JS `Array.sort` da (ES2019+) stabildir."""
    rows = _norm_customer_app_tiers([{"key": "x", "threshold": 5}, {"key": "y", "threshold": 5}])
    assert [r["key"] for r in rows] == ["x", "y"]


def test_row_cap():
    rows = _norm_customer_app_tiers([{"key": f"t{i}", "threshold": i * 10} for i in range(15)])
    assert len(rows) == MAX_CUSTOMER_APP_TIERS == 12
    assert [r["key"] for r in rows] == [f"t{i}" for i in range(12)]


def test_cap_is_applied_before_dropping_keyless_rows():
    """Kəsim əvvəl olur: 12 açarsız sətirdən sonra gələn açarlı sətir çatmır."""
    raw = [{} for _ in range(12)] + [{"key": "gold"}]
    assert _norm_customer_app_tiers(raw) == _default_customer_app_tiers()


def test_normalize_is_idempotent():
    """Panel save-dən sonra nəticəni yenidən normalizə edir — ikinci keçid dəyişməməlidir."""
    once = _norm_customer_app_tiers(
        [
            {"key": "Gold-Star", "label": {"az": "Qızıl"}, "threshold": 300.9, "color": "red", "multiplier": 25},
            {"key": "bronze", "threshold": 40},
        ]
    )
    assert _norm_customer_app_tiers(once) == once


# ------------------------------------------- _compute_tier <-> accrual pariteti

LADDER = [
    {"key": "bronze", "label": {"az": "Bürünc", "ru": "Бронза", "en": "Bronze"},
     "threshold": 0, "color": "#cd7f32", "multiplier": 1, "discount_percent": 0},
    {"key": "silver", "label": {"az": "Gümüş", "ru": "Серебро", "en": "Silver"},
     "threshold": 100, "color": "#c0c0c0", "multiplier": 1.25, "discount_percent": 0},
    {"key": "gold", "label": {"az": "Qızıl", "ru": "Золото", "en": "Gold"},
     "threshold": 300, "color": "#d8b156", "multiplier": 1.5, "discount_percent": 5},
]


@pytest.mark.parametrize("stars,key", [(0, "bronze"), (99, "bronze"), (100, "silver"),
                                      (299, "silver"), (300, "gold"), (10_000, "gold")])
def test_compute_tier_picks_the_last_reached_row(stars, key):
    assert _compute_tier(stars, LADDER)["key"] == key


@pytest.mark.parametrize("stars", [0, 1, 99, 100, 101, 299, 300, 301, 5000])
def test_compute_tier_multiplier_matches_accrual(stars):
    """Tətbiqdə görünən çarpan kassada işlənən çarpanla eyni olmalıdır.

    Fərqlənsə müştəri "Qızıl ×1.5" görüb ×1 qazanır — və şikayət kassaya gəlir.
    """
    shown = _compute_tier(stars, LADDER)["multiplier"]
    applied = find_tier_multiplier({"tiers": LADDER}, stars)
    assert float(shown) == float(applied)


@pytest.mark.parametrize("raw,expected", [(0, 0.0), (1.5, 1.5), (None, 1.0), (True, 1.0)])
def test_compute_tier_multiplier_edge_values_match_accrual(raw, expected):
    """P1.2d — `float(x or 1)` `multiplier: 0`-ı 1 göstərirdi, accrual isə 0 sayırdı."""
    ladder = [{"key": "solo", "threshold": 0, "multiplier": raw}]
    shown = _compute_tier(50, ladder)["multiplier"]
    assert shown == expected
    assert float(shown) == float(find_tier_multiplier({"tiers": ladder}, 50))


def test_compute_tier_multiplier_is_capped_like_accrual():
    """Köhnə blobda `25` qalsa panel 25 göstərib kassa 10 işlədə bilməz."""
    ladder = [{"key": "solo", "threshold": 0, "multiplier": 25}]
    assert _compute_tier(50, ladder)["multiplier"] == float(MAX_TIER_MULTIPLIER)


def test_compute_tier_progress():
    """Faiz `int(...)` ilə KƏSİLİR — JS güzgüsü `Math.trunc` işlətməlidir."""
    assert _compute_tier(0, LADDER)["progress_pct"] == 0
    assert _compute_tier(50, LADDER)["progress_pct"] == 50
    assert _compute_tier(99, LADDER)["progress_pct"] == 99
    assert _compute_tier(299, LADDER)["progress_pct"] == 99
    # Ən yuxarı pillədə növbəti yoxdur — 100% və `next_threshold is None`.
    top = _compute_tier(300, LADDER)
    assert top["progress_pct"] == 100 and top["next_threshold"] is None


def test_compute_tier_falls_back_to_defaults():
    for raw in (None, [], [{}], [{"key": ""}]):
        assert _compute_tier(0, raw)["key"] == DEFAULT_TIERS[0]["key"]


def test_find_tier_multiplier_ignores_unusable_settings():
    """Accrual bir ayar sətrinə görə satışı dayandırmamalıdır."""
    for raw in (None, {}, {"tiers": None}, {"tiers": "gold"}, {"tiers": []}, {"tiers": [{}]}):
        assert float(find_tier_multiplier(raw, 500)) == 1.0


# --------------------------------------------------- _tier_threshold (tək qayda)

# P1.2d — hədd əvvəl `_compute_tier` içində üç fərqli qayda ilə oxunurdu
# (sıralamada `max(0, int(...))`, müqayisədə xam `int(...)`, `next_threshold`-da
# yenə xam). `_tier_threshold` onları birləşdirir və `_norm_customer_app_tiers`-in
# yazma qaydası ilə eynidir. JS güzgüsü: `crm.ts::computeTier`-dəki `threshold()`.
THRESHOLD_READ_CASES = [
    ({"threshold": 100}, 100, "tam ədəd"),
    ({"threshold": "300"}, 300, "rəqəmli sətir"),
    ({"threshold": "99.9"}, 99, "onluq sətir KƏSİLİR — `int('99.9')` exception atırdı"),
    ({"threshold": 99.9}, 99, "onluq ədəd kəsilir"),
    ({"threshold": -50}, 0, "mənfi 0-a"),
    ({"threshold": 9_999_999}, 1_000_000, "yuxarı hədd yazma qaydası ilə eyni"),
    ({"threshold": True}, 0, "bool 'yoxdur' sayılır — `Number(true)` 1 verir, biz 0"),
    ({"threshold": ""}, 0, "boş sətir"),
    ({"threshold": "abc"}, 0, "zibil — ValueError ATMIR"),
    ({"threshold": []}, 0, "list — TypeError ATMIR"),
    ({"threshold": None}, 0, "yoxdur"),
    ({}, 0, "açar yoxdur"),
    (None, 0, "sətir özü yoxdur"),
]


@pytest.mark.parametrize("row,expected,why", THRESHOLD_READ_CASES)
def test_tier_threshold_reader(row, expected, why):
    assert _tier_threshold(row) == expected, why


def test_compute_tier_never_raises_on_garbage_rows():
    """Bu funksiya customer app-ın OXUMA yolundadır — bir zibil sətir 500 verməməlidir."""
    ladder = [
        {"key": "a", "threshold": "abc", "multiplier": "yox"},
        {"key": "b", "threshold": [], "color": 0, "label": 5},
        {"key": "c", "threshold": "150.9", "multiplier": None},
        None,
        "x",
        {"threshold": 10},
    ]
    out = _compute_tier(200, ladder)
    assert out["key"] == "c" and out["progress_pct"] == 100


# ------------------------------------------------ mənfi balans (idxal / legacy)


def test_negative_stars_are_treated_as_zero():
    """`loyalty_accrual._floor_int` mənfini 0 sayır — oxuma da eyni etməlidir.

    Etməsə bərabər hədli nərdivanda (iki sətir 0-da) tətbiq birinci sətri, kassa
    isə sonuncunu seçir: müştəri ×1 görüb ×3 qazanır.
    """
    ladder = [{"key": "x", "threshold": 0, "multiplier": 1}, {"key": "y", "threshold": 0, "multiplier": 3}]
    assert _compute_tier(-5, ladder) == _compute_tier(0, ladder)
    assert float(_compute_tier(-5, ladder)["multiplier"]) == float(find_tier_multiplier({"tiers": ladder}, -5))


@pytest.mark.parametrize("stars", [-1000, -5, 0, 50])
def test_progress_pct_is_never_negative(stars):
    """Faiz birbaşa CSS eninə gedir — mənfi dəyər zolağı sıçradır."""
    assert 0 <= _compute_tier(stars, LADDER)["progress_pct"] <= 100


# ------------------------------------- göstərilən çarpan == kassada işlənən çarpan

STORED_LADDERS = [
    ([{"key": "solo", "threshold": 0, "multiplier": 0}], "0 — bu pillə qazanmır"),
    ([{"key": "solo", "threshold": 0, "multiplier": 25}], "hədddən böyük"),
    ([{"key": "solo", "threshold": 0, "multiplier": -3}], "mənfi (saxlanılanda 0 olur)"),
    ([{"key": "solo", "threshold": 0, "multiplier": "abc"}], "zibil"),
    ([{"key": "solo", "threshold": 0, "multiplier": True}], "bool"),
    ([{"key": "a", "threshold": 0}, {"key": "b", "threshold": 0, "multiplier": 3}], "bərabər hədd"),
    ([{"key": "a", "threshold": 50}, {"key": "b", "threshold": 150, "multiplier": 2}], "ən aşağı 0 deyil"),
    (LADDER, "normal nərdivan"),
]


@pytest.mark.parametrize("raw,why", STORED_LADDERS)
@pytest.mark.parametrize("stars", [-5, 0, 1, 49, 50, 99, 100, 149, 150, 299, 300, 5000])
def test_shown_multiplier_equals_applied_multiplier(raw, why, stars):
    """Tətbiqdə görünən çarpan kassada işlənənlə eyni olmalıdır.

    Nərdivan **saxlanma formasında** (normalizerdən keçmiş) yoxlanılır: panel
    mənfi çarpan saxlaya bilmir (`_norm_float` onu 0-a çevirir), ona görə
    `resolve_tier_multiplier`-in "mənfi → 1" müdafiə budağı blobdan yox, yalnız
    kod səhvindən gələ bilər.
    """
    stored = _norm_customer_app_tiers(raw)
    shown = float(_compute_tier(stars, stored)["multiplier"])
    applied = float(resolve_tier_multiplier(GATE_ON, find_tier_multiplier({"tiers": stored}, stars)))
    assert shown == applied, f"{why} @ {stars} ulduz"


def test_gate_off_means_no_tier_bonus():
    """Keçid sönülüdürsə kassa 1 işlədir — panel isə nərdivanın çarpanını göstərir.

    Bu QƏSDƏN fərqdir (P1.1b geriyə uyğunluq qapısı), ona görə burada yazılıb:
    `tier_multiplier_enabled` sönülü olanda "×1.5" nişanı yanıltmasın deyə panel
    keçidin vəziyyətini də göstərməlidir.
    """
    stored = _norm_customer_app_tiers(LADDER)
    assert float(resolve_tier_multiplier({}, find_tier_multiplier({"tiers": stored}, 300))) == 1.0
    assert float(_compute_tier(300, stored)["multiplier"]) == 1.5
