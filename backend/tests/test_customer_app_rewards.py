"""P1.3 — hədiyyə kataloqunun normalizeri, effektiv kataloq və wallet payload-u.

Niyə bu testlər: kataloq **tək blobda** (`app_settings["rewards"]`) yaşayır və
beş yerdən oxunur:

  * `operations.py::_norm_customer_app_rewards` — PATCH-də yazılanı təmizləyir;
  * `operations.py::_reward_catalog` — effektiv kataloq (boşdursa köhnə tək hədiyyə);
  * `operations.py::_reward_catalog_payload` — `wallet.rewards` (müştəri nərdivanı);
  * `operations.py::claim_customer_reward` — hansı sətir tələb olunur, stok yetirmi;
  * `src/lib/loyalty.ts` + `src/api/crm.ts` — panelin ön baxışı və lokal rejim (JS güzgüləri).

İki qayda burada **qəsdən** kilidlənir, çünki səssiz dəyişsə data itər:

  1. `rewards` üçün **boş massiv qanuni dəyərdir** ("kataloq yoxdur, köhnə tək
     hədiyyə işləsin") — `tiers`-dəki "boş = defaultlara qaytar" semantikasının
     ƏKSİ. Normalizer boş girişə default kataloq QAYTARMAMALIDIR.
  2. Təkrar `id` **atılır** (ilk sətir qalır), tier açarında olduğu kimi sadəcə
     xəbərdarlıq deyil: verilmiş claim kodları `reward_id` ilə sətrə bağlanır,
     iki sətir eyni id ilə qalsa kod hansına aid olduğu bilinməz.

Bu fayl yalnız **saf funksiyaları** import edir (DB, HTTP, auth yoxdur);
`_reward_stock_used` DB tələb etdiyi üçün onun nəticəsi `stock_used` dict-i kimi
əl ilə verilir — payload düsturu elə bu dict-in üstündə işləyir.
"""

import pytest

from app.routers.operations import (
    DEFAULT_CUSTOMER_APP_SETTINGS,
    LEGACY_REWARD_ID,
    MAX_CUSTOMER_APP_REWARDS,
    MAX_REWARD_POINTS_COST,
    MAX_REWARD_STOCK_LIMIT,
    _norm_customer_app_rewards,
    _norm_reward_id,
    _reward_catalog,
    _reward_catalog_payload,
)

REWARD_FIELDS = {
    "id",
    "title",
    "description",
    "points_cost",
    "menu_item_id",
    "active",
    "stock_limit",
}
PAYLOAD_FIELDS = {
    "id",
    "title",
    "description",
    "title_i18n",
    "description_i18n",
    "threshold",
    "points_cost",
    "menu_item_id",
    "menu_item_name",
    "stock_limit",
    "stock_remaining",
    "available_count",
    "locked",
}
DEFAULT_COST = DEFAULT_CUSTOMER_APP_SETTINGS["reward_threshold"]


def row(**kwargs) -> dict:
    """Minimal keçərli sətir — testdə yalnız yoxlanan açar yazılır."""
    base = {"id": "free-coffee", "title": "Pulsuz qəhvə", "points_cost": 10}
    base.update(kwargs)
    return base


# ------------------------------------------------------------------ id qaydası


def test_reward_id_allows_dash_but_strips_the_rest():
    """Defis qəbul edilir (köhnə id `default-reward`), qalan simvollar atılır."""
    assert _norm_reward_id("Free-Coffee") == "free-coffee"
    assert _norm_reward_id(" FREE_coffee 2 ") == "free_coffee2"
    assert _norm_reward_id("qəhvə!!") == "qhv"
    assert _norm_reward_id(None) == ""
    assert _norm_reward_id("") == ""


def test_reward_id_is_capped_at_32_chars():
    assert len(_norm_reward_id("a" * 200)) == 32


def test_legacy_reward_id_survives_normalization():
    """`LEGACY_REWARD_ID` normalizerdən dəyişmədən keçməlidir, yoxsa köhnə
    claim-lər kataloq sətrinə bağlanmaz."""
    assert _norm_reward_id(LEGACY_REWARD_ID) == LEGACY_REWARD_ID


# ------------------------------------------------------- normalizer: boş giriş


@pytest.mark.parametrize("value", [None, [], "", 0, {}, "rewards", 42])
def test_empty_or_broken_input_returns_empty_list(value):
    """⚠️ Ən vacib qayda: boş giriş → `[]`, DEFAULT KATALOQ DEYİL.

    `tiers` boş olanda defaultlara qaytarılır; `rewards` boş olanda "kataloq
    yoxdur" deməkdir və köhnə tək hədiyyə işləyir. Bu iki semantika bir-birinin
    əksidir — burada qarışsa panel kataloqu heç vaxt boşalda bilməz."""
    assert _norm_customer_app_rewards(value) == []


def test_non_dict_rows_are_dropped():
    out = _norm_customer_app_rewards([None, "x", 5, [], row()])
    assert [r["id"] for r in out] == ["free-coffee"]


def test_rows_without_usable_id_are_dropped():
    """Boş id-li sətir SƏSSİZCƏ atılır — tier-dən fərqli olaraq default id yoxdur.
    Panel elə buna görə yeni sətrə avtomatik `reward-N` id verir."""
    out = _norm_customer_app_rewards([{"title": "Adsız"}, {"id": "!!!"}, row()])
    assert [r["id"] for r in out] == ["free-coffee"]


# --------------------------------------------------------- normalizer: forması


def test_normalized_row_has_exactly_the_expected_fields():
    out = _norm_customer_app_rewards([row()])
    assert len(out) == 1
    assert set(out[0]) == REWARD_FIELDS


def test_plain_string_title_is_expanded_to_all_three_languages():
    out = _norm_customer_app_rewards([row(title="Latte")])
    assert out[0]["title"] == {"az": "Latte", "ru": "Latte", "en": "Latte"}


def test_i18n_title_falls_back_to_az_when_ru_or_en_missing():
    out = _norm_customer_app_rewards([row(title={"az": "Qəhvə", "en": "Coffee"})])
    assert out[0]["title"] == {"az": "Qəhvə", "ru": "Qəhvə", "en": "Coffee"}


def test_missing_title_falls_back_to_the_id_not_to_empty():
    """Ad boş qalsa müştəri boş sətir görər, ona görə fallback id-dir."""
    out = _norm_customer_app_rewards([{"id": "free-coffee", "points_cost": 10}])
    assert out[0]["title"]["az"] == "free-coffee"


def test_missing_description_falls_back_to_empty_string():
    """Açıqlama boş qala BİLƏR — ad kimi məcburi deyil."""
    out = _norm_customer_app_rewards([row()])
    assert out[0]["description"] == {"az": "", "ru": "", "en": ""}


def test_title_and_description_are_length_capped():
    out = _norm_customer_app_rewards([row(title="t" * 200, description="d" * 500)])
    assert len(out[0]["title"]["az"]) == 60
    assert len(out[0]["description"]["az"]) == 240


# --------------------------------------------------------- normalizer: rəqəmlər


@pytest.mark.parametrize("bad", [0, -5, None, "", "abc", False])
def test_invalid_points_cost_falls_back_to_reward_threshold_default(bad):
    """`0`/mənfi → default 10, **1 DEYİL**. 1 olsaydı səhv yazılmış sətir hər
    şeyi praktiki olaraq pulsuz edərdi (`normalizeRewardThreshold` ilə eyni qayda)."""
    out = _norm_customer_app_rewards([row(points_cost=bad)])
    assert out[0]["points_cost"] == DEFAULT_COST


def test_points_cost_is_capped_at_the_maximum():
    out = _norm_customer_app_rewards([row(points_cost=MAX_REWARD_POINTS_COST * 10)])
    assert out[0]["points_cost"] == MAX_REWARD_POINTS_COST


def test_points_cost_accepts_numeric_strings_and_floats():
    out = _norm_customer_app_rewards([row(id="a", points_cost="25"), row(id="b", points_cost=7.9)])
    costs = {r["id"]: r["points_cost"] for r in out}
    assert costs == {"a": 25, "b": 7}


def test_stock_limit_zero_means_unlimited_and_is_kept():
    """Stok limiti üçün `0` **keçərli dəyərdir** (limitsiz) — points_cost-dan fərqli
    olaraq defaulta çevrilmir."""
    out = _norm_customer_app_rewards([row(stock_limit=0)])
    assert out[0]["stock_limit"] == 0


@pytest.mark.parametrize("bad", [-5, None, "", "abc"])
def test_invalid_stock_limit_becomes_zero(bad):
    out = _norm_customer_app_rewards([row(stock_limit=bad)])
    assert out[0]["stock_limit"] == 0


def test_stock_limit_is_capped_at_the_maximum():
    out = _norm_customer_app_rewards([row(stock_limit=MAX_REWARD_STOCK_LIMIT * 3)])
    assert out[0]["stock_limit"] == MAX_REWARD_STOCK_LIMIT


def test_active_defaults_to_true_when_the_key_is_absent():
    out = _norm_customer_app_rewards([row()])
    assert out[0]["active"] is True


@pytest.mark.parametrize("falsy", [False, None, 0, ""])
def test_active_falsy_values_deactivate_the_row(falsy):
    out = _norm_customer_app_rewards([row(active=falsy)])
    assert out[0]["active"] is False


def test_menu_item_id_is_trimmed_and_capped():
    out = _norm_customer_app_rewards([row(menu_item_id="  item-1  ")])
    assert out[0]["menu_item_id"] == "item-1"
    out = _norm_customer_app_rewards([row(menu_item_id="x" * 200)])
    assert len(out[0]["menu_item_id"]) == 64


def test_missing_menu_item_id_means_any_product():
    out = _norm_customer_app_rewards([row()])
    assert out[0]["menu_item_id"] == ""


# ------------------------------------------------ normalizer: dedup, sıra, limit


def test_duplicate_ids_keep_only_the_first_row():
    """⚠️ Təkrar id ATILIR (tier açarında sadəcə xəbərdarlıqdır): verilmiş kodlar
    `reward_id` ilə bağlanır, iki eyni id qalsa kod hansı sətrə aid olduğu bilinməz.
    Qalan sətir **ilk yazılandır**, ucuz olan deyil."""
    out = _norm_customer_app_rewards(
        [
            row(id="free-coffee", title="Birinci", points_cost=50),
            row(id="free-coffee", title="İkinci", points_cost=5),
        ]
    )
    assert len(out) == 1
    assert out[0]["title"]["az"] == "Birinci"
    assert out[0]["points_cost"] == 50


def test_ids_differing_only_by_case_are_treated_as_duplicates():
    out = _norm_customer_app_rewards([row(id="Free-Coffee"), row(id="free-coffee")])
    assert len(out) == 1


def test_rows_are_sorted_cheapest_first():
    """Müştəri nərdivanı və "ən ucuz açıq sətir" məntiqi bu sıradan asılıdır."""
    out = _norm_customer_app_rewards(
        [row(id="c", points_cost=90), row(id="a", points_cost=5), row(id="b", points_cost=30)]
    )
    assert [r["id"] for r in out] == ["a", "b", "c"]
    assert [r["points_cost"] for r in out] == [5, 30, 90]


def test_row_count_is_capped_before_sorting():
    """Limit **daxil olan sıra ilə** kəsilir, qiymətə görə deyil — panel elə buna
    görə daşan sətirləri ayrıca xəbərdarlıqla göstərir."""
    rows = [row(id=f"r{i}", points_cost=1000 - i) for i in range(MAX_CUSTOMER_APP_REWARDS + 7)]
    out = _norm_customer_app_rewards(rows)
    assert len(out) == MAX_CUSTOMER_APP_REWARDS
    assert {r["id"] for r in out} == {f"r{i}" for i in range(MAX_CUSTOMER_APP_REWARDS)}


def test_normalizer_is_idempotent():
    """PATCH → GET → PATCH dövrü sətri dəyişməməlidir."""
    once = _norm_customer_app_rewards([row(title={"az": "Qəhvə"}, description="Pulsuz", stock_limit=3)])
    assert _norm_customer_app_rewards(once) == once


def test_normalizer_does_not_mutate_the_input():
    src = [row()]
    snapshot = {k: v for k, v in src[0].items()}
    _norm_customer_app_rewards(src)
    assert src[0] == snapshot


# ------------------------------------------------------- effektiv kataloq (oxu)


def test_empty_catalog_falls_back_to_the_legacy_single_reward():
    """Kataloq boş olanda oxu yolu köhnə üç ayarı bir sətrə çevirir — customer app
    və claim endpointi eyni funksiyanı işlədir."""
    out = _reward_catalog({"reward_name": "Pulsuz latte", "reward_threshold": 8, "reward_description": "Hər 8 ulduza"})
    assert len(out) == 1
    assert out[0]["id"] == LEGACY_REWARD_ID
    assert out[0]["title"] == {"az": "Pulsuz latte", "ru": "Pulsuz latte", "en": "Pulsuz latte"}
    assert out[0]["description"]["az"] == "Hər 8 ulduza"
    assert out[0]["points_cost"] == 8
    assert out[0]["active"] is True
    assert out[0]["stock_limit"] == 0
    assert out[0]["menu_item_id"] == ""


@pytest.mark.parametrize("settings", [None, {}, {"rewards": []}, "nonsense"])
def test_legacy_fallback_uses_defaults_when_settings_are_missing(settings):
    out = _reward_catalog(settings)
    assert len(out) == 1
    assert out[0]["id"] == LEGACY_REWARD_ID
    assert out[0]["points_cost"] == DEFAULT_COST
    assert out[0]["title"]["az"] == DEFAULT_CUSTOMER_APP_SETTINGS["reward_name"]


def test_legacy_fallback_clamps_the_threshold_to_1_1000():
    """Köhnə sətrin qiyməti `reward_threshold` qaydası ilə (1..1000) kəsilir —
    kataloq sətrindəki 1..1_000_000 aralığı ilə eyni DEYİL."""
    assert _reward_catalog({"reward_threshold": 0})[0]["points_cost"] == DEFAULT_COST
    assert _reward_catalog({"reward_threshold": 99_999})[0]["points_cost"] == 1000


def test_catalog_wins_over_the_legacy_reward_when_present():
    out = _reward_catalog({"rewards": [row(id="latte", points_cost=12)], "reward_name": "Köhnə", "reward_threshold": 10})
    assert [r["id"] for r in out] == ["latte"]


def test_catalog_of_only_inactive_rows_does_not_fall_back():
    """⚠️ Hamısı deaktiv olsa da kataloq "var" sayılır: fallback baş vermir və
    `_reward_catalog_payload` boş qayıdır. Panel elə buna görə "aktiv hədiyyə
    yoxdur" xəbərdarlığı göstərir — müştəri boş nərdivan görər."""
    out = _reward_catalog({"rewards": [row(active=False)], "reward_name": "Köhnə"})
    assert [r["id"] for r in out] == ["free-coffee"]
    assert _reward_catalog_payload(out, spendable=1000) == []


def test_effective_catalog_is_never_empty_for_a_tenant_without_rewards_key():
    """Müştəri tətbiqi nərdivanı yalnız `wallet.rewards`-dan qurur, ona görə
    kataloq heç vaxt tam boş qalmamalıdır."""
    assert _reward_catalog_payload(_reward_catalog({}), spendable=0)


# ------------------------------------------------------------- wallet payload-u


def test_payload_has_exactly_the_documented_fields():
    out = _reward_catalog_payload(_norm_customer_app_rewards([row()]), spendable=0)
    assert set(out[0]) == PAYLOAD_FIELDS


def test_payload_skips_inactive_rows():
    rows = _norm_customer_app_rewards([row(id="on", points_cost=5), row(id="off", points_cost=6, active=False)])
    out = _reward_catalog_payload(rows, spendable=100)
    assert [r["id"] for r in out] == ["on"]


def test_threshold_mirrors_points_cost():
    """`threshold` köhnə app-lar üçün saxlanılan addır — dəyər fərqlənməməlidir."""
    out = _reward_catalog_payload(_norm_customer_app_rewards([row(points_cost=25)]), spendable=0)
    assert out[0]["threshold"] == out[0]["points_cost"] == 25


def test_available_count_is_spendable_divided_by_cost():
    out = _reward_catalog_payload(_norm_customer_app_rewards([row(points_cost=10)]), spendable=35)
    assert out[0]["available_count"] == 3
    assert out[0]["locked"] is False


def test_locked_is_true_when_the_customer_cannot_afford_the_row():
    out = _reward_catalog_payload(_norm_customer_app_rewards([row(points_cost=10)]), spendable=9)
    assert out[0]["available_count"] == 0
    assert out[0]["locked"] is True


def test_negative_spendable_is_treated_as_zero():
    """PENDING claim-lər balansdan çox olsa `spendable` mənfi ola bilər."""
    out = _reward_catalog_payload(_norm_customer_app_rewards([row()]), spendable=-50)
    assert out[0]["available_count"] == 0
    assert out[0]["locked"] is True


def test_unlimited_stock_reports_none_not_zero():
    """⚠️ `stock_remaining is None` = limitsiz, `0` = bitdi. Müştəri tətbiqi bu
    ikisini fərqli göstərir, ona görə `None` heç vaxt 0-a çevrilməməlidir."""
    out = _reward_catalog_payload(_norm_customer_app_rewards([row(stock_limit=0)]), spendable=1000)
    assert out[0]["stock_remaining"] is None
    assert out[0]["available_count"] == 100


def test_stock_limit_caps_available_count():
    rows = _norm_customer_app_rewards([row(points_cost=10, stock_limit=2)])
    out = _reward_catalog_payload(rows, spendable=1000)
    assert out[0]["stock_remaining"] == 2
    assert out[0]["available_count"] == 2


def test_issued_claims_reduce_the_remaining_stock():
    rows = _norm_customer_app_rewards([row(points_cost=10, stock_limit=5)])
    out = _reward_catalog_payload(rows, spendable=1000, stock_used={"free-coffee": 3})
    assert out[0]["stock_remaining"] == 2
    assert out[0]["available_count"] == 2


def test_exhausted_stock_locks_the_row_even_with_enough_points():
    rows = _norm_customer_app_rewards([row(points_cost=10, stock_limit=2)])
    out = _reward_catalog_payload(rows, spendable=10_000, stock_used={"free-coffee": 2})
    assert out[0]["stock_remaining"] == 0
    assert out[0]["available_count"] == 0
    assert out[0]["locked"] is True


def test_stock_used_above_the_limit_never_goes_negative():
    """Limit sonradan aşağı endirilə bilər — artıq verilmiş kodlar ləğv olunmur,
    sadəcə yenisi verilmir."""
    rows = _norm_customer_app_rewards([row(points_cost=10, stock_limit=2)])
    out = _reward_catalog_payload(rows, spendable=10_000, stock_used={"free-coffee": 9})
    assert out[0]["stock_remaining"] == 0
    assert out[0]["available_count"] == 0


def test_stock_used_for_another_row_is_ignored():
    rows = _norm_customer_app_rewards([row(points_cost=10, stock_limit=2)])
    out = _reward_catalog_payload(rows, spendable=1000, stock_used={"other-row": 99})
    assert out[0]["stock_remaining"] == 2


def test_language_selection_falls_back_to_az():
    rows = _norm_customer_app_rewards([row(title={"az": "Qəhvə", "en": "Coffee"}, description={"az": "Pulsuz"})])
    ru = _reward_catalog_payload(rows, spendable=0, lang="ru")[0]
    en = _reward_catalog_payload(rows, spendable=0, lang="en")[0]
    # ru boş yazılmayıb, normalizer onu az-a bərabər etdi
    assert ru["title"] == "Qəhvə"
    assert en["title"] == "Coffee"
    assert ru["description"] == "Pulsuz"


def test_unknown_language_falls_back_to_az():
    rows = _norm_customer_app_rewards([row(title={"az": "Qəhvə"})])
    out = _reward_catalog_payload(rows, spendable=0, lang="tr")
    assert out[0]["title"] == "Qəhvə"


def test_i18n_maps_always_carry_all_three_keys():
    out = _reward_catalog_payload(_norm_customer_app_rewards([row()]), spendable=0)
    assert set(out[0]["title_i18n"]) == {"az", "ru", "en"}
    assert set(out[0]["description_i18n"]) == {"az", "ru", "en"}


def test_menu_item_name_is_resolved_from_the_map():
    rows = _norm_customer_app_rewards([row(menu_item_id="item-1")])
    out = _reward_catalog_payload(rows, spendable=0, menu_names={"item-1": "Flat White"})
    assert out[0]["menu_item_name"] == "Flat White"


def test_deleted_menu_item_leaves_an_empty_name_but_keeps_the_link():
    """Silinmiş məhsul sətri sındırmır: ad boş qalır, `menu_item_id` qalır və
    kassada endirim ən ucuz səbət sətrinə düşür (P1.3e)."""
    rows = _norm_customer_app_rewards([row(menu_item_id="gone")])
    out = _reward_catalog_payload(rows, spendable=0, menu_names={"item-1": "Flat White"})
    assert out[0]["menu_item_id"] == "gone"
    assert out[0]["menu_item_name"] == ""


def test_row_without_a_menu_link_has_no_name_lookup():
    rows = _norm_customer_app_rewards([row()])
    out = _reward_catalog_payload(rows, spendable=0, menu_names={"": "Yanlış"})
    assert out[0]["menu_item_name"] == ""


def test_payload_preserves_the_cheapest_first_order():
    rows = _norm_customer_app_rewards([row(id="c", points_cost=90), row(id="a", points_cost=5)])
    out = _reward_catalog_payload(rows, spendable=0)
    assert [r["id"] for r in out] == ["a", "c"]


# ------------------------------------ köhnə `available_rewards` ilə uyğunluq


@pytest.mark.parametrize("stars,threshold", [(0, 10), (9, 10), (10, 10), (35, 10), (100, 7)])
def test_single_row_catalog_matches_the_legacy_stars_div_threshold_formula(stars, threshold):
    """Bir sətirli kataloqda `max(available_count)` köhnə `stars // threshold`
    düsturu ilə eyni olmalıdır — `available_rewards` mənasını dəyişməyib."""
    rows = _reward_catalog({"reward_threshold": threshold})
    out = _reward_catalog_payload(rows, spendable=stars)
    assert max((r["available_count"] for r in out), default=0) == stars // threshold


def test_available_rewards_is_max_over_rows_and_unlocked_is_a_distinct_count():
    """`available_rewards` = ƏN UCUZ sətirdən neçə dəfə (köhnə məna),
    `unlocked_rewards` = açıq FƏRQLİ sətir sayı (yeni)."""
    rows = _norm_customer_app_rewards(
        [row(id="cheap", points_cost=10), row(id="mid", points_cost=25), row(id="lux", points_cost=200)]
    )
    out = _reward_catalog_payload(rows, spendable=50)
    counts = {r["id"]: r["available_count"] for r in out}
    assert counts == {"cheap": 5, "mid": 2, "lux": 0}
    assert max(counts.values()) == 5
    assert sum(1 for v in counts.values() if v > 0) == 2
