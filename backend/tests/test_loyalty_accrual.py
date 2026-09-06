"""P1.1 — `app.services.loyalty_accrual` üçün testlər.

Bu funksiya kassanın **pul/bonus yazan** yolundadır, ona görə testlərin əsas
yükü iki şeydədir:

1. **Geriyə uyğunluq.** Panelin dörd sahəsi (`earn_rate_per_azn`,
   `min_purchase_for_earn`, `first_purchase_bonus`, `double_points_days`) və
   tier `multiplier`-i bu buraxılışa qədər heç yerdə oxunmurdu, amma
   defaultları zərərsiz deyil: `earn_rate_per_azn=2.0`,
   `first_purchase_bonus=5`, `gold.multiplier=1.5`. Keçidlər (`earn_basis`,
   `first_purchase_bonus_enabled`, `tier_multiplier_enabled`) sönülü olduqda
   nəticə **mütləq** köhnə "1 içki = 1 ulduz" davranışı olmalıdır.
2. **Zibil ayara davamlılıq.** Satış endpoint-i bir ayar sətrinə görə 500
   verməməlidir.

Hesablama sırası da qorunur (baza → 2x gün → tier → ilk alış), çünki sıra
dəyişsə nəticə dəyişir və frontend güzgüsü (`src/lib/loyalty.ts`) ayrılar.
"""

from decimal import Decimal

from app.services.loyalty_accrual import (
    MAX_EARN_PER_SALE,
    compute_points_earned,
    find_tier_multiplier,
    resolve_double_days,
    resolve_earn_basis,
)

#: Mövcud tenant-ların blobunda real olaraq oturan "təhlükəli" defaultlar.
#: P0.1 normalizeri çatmayan açarları default ilə doldurur, ona görə bu dəyərlər
#: tenant heç nə seçməsə də saxlanılmış olur.
SHIPPED_DEFAULTS = {
    "program_mode": "points",
    "reward_threshold": 10,
    "earn_rate_per_azn": 2.0,
    "min_purchase_for_earn": 0.0,
    "first_purchase_bonus": 5,
    "double_points_days": [],
}


def test_empty_settings_keep_one_star_per_drink():
    r = compute_points_earned({}, drink_qty=3, eligible_total="15.00")
    assert r.earned == 3
    assert r.base == 3
    assert r.basis == "per_drink"
    assert r.tier_bonus == 0
    assert r.first_purchase_bonus == 0


def test_none_settings_do_not_crash():
    assert compute_points_earned(None, drink_qty=2, eligible_total=10).earned == 2


def test_shipped_defaults_change_nothing_without_gates():
    """**Ən vacib test.** Keçidlər sönülüdür → köhnə davranış birə-bir qalır.

    Bu qorunma olmasa 5.40 AZN-lik satış 3 ulduz yerinə 10 ulduz + 5 ilk alış
    bonusu verərdi və default 10 həddində hər qəhvə dərhal pulsuz olardı.
    """
    r = compute_points_earned(
        SHIPPED_DEFAULTS,
        drink_qty=3,
        eligible_total="5.40",
        weekday=6,
        is_first_purchase=True,
        tier_multiplier=1.5,  # default `gold` pilləsi
    )
    assert r.earned == 3, "qapısız qoşulma mövcud tenant-ı səssizcə dəyişdi"
    assert r.tier_bonus == 0
    assert r.first_purchase_bonus == 0
    assert not r.double_day_applied


def test_per_azn_basis_floors_the_product():
    cfg = {**SHIPPED_DEFAULTS, "earn_basis": "per_azn"}
    # 5.40 × 2 = 10.8 → 10 (kəsr ulduz yoxdur)
    assert compute_points_earned(cfg, drink_qty=3, eligible_total="5.40").earned == 10
    # İçki sayı per_azn rejimində nəticəyə təsir etmir.
    assert compute_points_earned(cfg, drink_qty=0, eligible_total="5.40").earned == 10


def test_per_azn_with_zero_rate_earns_nothing():
    cfg = {"earn_basis": "per_azn", "earn_rate_per_azn": 0}
    assert compute_points_earned(cfg, drink_qty=3, eligible_total="50.00").earned == 0


def test_unknown_basis_falls_back_to_per_drink():
    assert resolve_earn_basis({"earn_basis": "per_kilogram"}) == "per_drink"
    assert resolve_earn_basis({"earn_basis": ""}) == "per_drink"
    assert resolve_earn_basis({}) == "per_drink"
    cfg = {"earn_basis": "zibil", "earn_rate_per_azn": 5}
    assert compute_points_earned(cfg, drink_qty=2, eligible_total="10.00").earned == 2


def test_minimum_purchase_blocks_everything():
    cfg = {"min_purchase_for_earn": 10, "first_purchase_bonus": 5, "first_purchase_bonus_enabled": True}
    r = compute_points_earned(cfg, drink_qty=3, eligible_total="9.99", is_first_purchase=True)
    assert r.earned == 0
    assert r.blocked_by_minimum
    assert r.first_purchase_bonus == 0, "minimumdan aşağıda ilk alış bonusu da verilmir"


def test_minimum_purchase_is_inclusive():
    cfg = {"min_purchase_for_earn": 10}
    assert compute_points_earned(cfg, drink_qty=3, eligible_total="10.00").earned == 3
    assert compute_points_earned(cfg, drink_qty=3, eligible_total="10.01").earned == 3


def test_double_points_day_doubles_the_base():
    cfg = {"double_points_days": [6, 7]}
    assert compute_points_earned(cfg, drink_qty=3, eligible_total=15, weekday=6).earned == 6
    assert compute_points_earned(cfg, drink_qty=3, eligible_total=15, weekday=5).earned == 3
    # `weekday=None` → gün yoxlanmır (offline replay kimi hallar).
    assert compute_points_earned(cfg, drink_qty=3, eligible_total=15).earned == 3


def test_double_points_day_numbering_is_monday_one_sunday_seven():
    """Lokal `HappyHour` tipindəki "0=Sunday" şərhi YANLIŞDIR (P0.7 tapıntısı).

    Sistemin hər yerində B.E=1 … Bazar=7. Köhnə `0` itməməlidir.
    """
    assert resolve_double_days({"double_points_days": [0]}) == {7}
    assert resolve_double_days({"double_points_days": ["1", 3.0, 7]}) == {1, 3, 7}
    assert resolve_double_days({"double_points_days": [8, -1, 99]}) == set()
    assert resolve_double_days({"double_points_days": [True, False]}) == set()
    assert resolve_double_days({"double_points_days": "1,2"}) == set()
    assert resolve_double_days({"double_points_days": None}) == set()
    assert compute_points_earned({"double_points_days": [0]}, drink_qty=2, eligible_total=8, weekday=7).earned == 4


def test_tier_multiplier_needs_its_gate():
    off = compute_points_earned({}, drink_qty=4, eligible_total=20, tier_multiplier=1.5)
    assert off.earned == 4 and off.tier_bonus == 0

    on = compute_points_earned(
        {"tier_multiplier_enabled": True}, drink_qty=4, eligible_total=20, tier_multiplier=1.5
    )
    assert on.earned == 6 and on.tier_bonus == 2


def test_tier_multiplier_floors_and_tolerates_odd_values():
    cfg = {"tier_multiplier_enabled": True}
    # 3 × 1.5 = 4.5 → 4
    assert compute_points_earned(cfg, drink_qty=3, eligible_total=15, tier_multiplier=1.5).earned == 4
    # Çarpan 1-dən kiçikdirsə azaldır (tenant belə qoyubsa qanunidir).
    assert compute_points_earned(cfg, drink_qty=3, eligible_total=15, tier_multiplier=0.5).earned == 1
    # Zibil / yoxdur → 1 (təsirsiz).
    assert compute_points_earned(cfg, drink_qty=3, eligible_total=15, tier_multiplier="abc").earned == 3
    assert compute_points_earned(cfg, drink_qty=3, eligible_total=15, tier_multiplier=None).earned == 3
    assert compute_points_earned(cfg, drink_qty=3, eligible_total=15, tier_multiplier=-2).earned == 3
    # Yuxarı hədd 10.
    assert compute_points_earned(cfg, drink_qty=1, eligible_total=5, tier_multiplier=999).earned == 10


def test_first_purchase_bonus_needs_its_gate():
    cfg = {"first_purchase_bonus": 5}
    assert compute_points_earned(cfg, drink_qty=1, eligible_total=5, is_first_purchase=True).earned == 1

    gated = {**cfg, "first_purchase_bonus_enabled": True}
    r = compute_points_earned(gated, drink_qty=1, eligible_total=5, is_first_purchase=True)
    assert r.earned == 6 and r.first_purchase_bonus == 5
    # Təkrar müştəridə verilmir.
    assert compute_points_earned(gated, drink_qty=1, eligible_total=5).earned == 1


def test_gate_flags_accept_string_false():
    """Ayar JSON-u bəzən string saxlayır — `"false"` sönülü sayılmalıdır."""
    cfg = {"first_purchase_bonus": 5, "first_purchase_bonus_enabled": "false"}
    assert compute_points_earned(cfg, drink_qty=1, eligible_total=5, is_first_purchase=True).earned == 1
    cfg = {"first_purchase_bonus": 5, "first_purchase_bonus_enabled": "1"}
    assert compute_points_earned(cfg, drink_qty=1, eligible_total=5, is_first_purchase=True).earned == 6


def test_zero_base_earns_nothing_even_on_first_purchase():
    """Qəhvəsiz satış (yalnız desert) və 0 AZN-lik satış bonus qoparmamalıdır."""
    cfg = {"first_purchase_bonus": 50, "first_purchase_bonus_enabled": True, "double_points_days": [1]}
    r = compute_points_earned(cfg, drink_qty=0, eligible_total="6.00", weekday=1, is_first_purchase=True)
    assert r.earned == 0 and r.base == 0 and r.first_purchase_bonus == 0

    cfg2 = {**cfg, "earn_basis": "per_azn", "earn_rate_per_azn": 2}
    assert compute_points_earned(cfg2, drink_qty=3, eligible_total="0.00", is_first_purchase=True).earned == 0


def test_operation_order_is_base_double_tier_then_flat_bonus():
    """Sıra dəyişsə nəticə dəyişir — 2 → 4 → 6 → 11 (bonus çoxaldılmır)."""
    cfg = {
        "double_points_days": [3],
        "tier_multiplier_enabled": True,
        "first_purchase_bonus": 5,
        "first_purchase_bonus_enabled": True,
    }
    r = compute_points_earned(
        cfg, drink_qty=2, eligible_total="12.00", weekday=3, is_first_purchase=True, tier_multiplier=1.5
    )
    assert (r.base, r.double_day_applied, r.tier_bonus, r.first_purchase_bonus, r.earned) == (2, True, 2, 5, 11)


def test_absurd_settings_are_capped_not_crashing():
    cfg = {"earn_basis": "per_azn", "earn_rate_per_azn": 1000}
    r = compute_points_earned(cfg, drink_qty=1, eligible_total="500.00")
    assert r.earned == MAX_EARN_PER_SALE and r.capped


def test_garbage_values_never_raise():
    cases = [
        ({"earn_basis": "per_azn", "earn_rate_per_azn": "abc"}, "10.00", 0),
        ({"earn_basis": "per_azn", "earn_rate_per_azn": -5}, "10.00", 0),
        ({"earn_basis": "per_azn", "earn_rate_per_azn": True}, "10.00", 0),
        ({"min_purchase_for_earn": "abc"}, "10.00", 2),
        ({"min_purchase_for_earn": -50}, "10.00", 2),
        ({"double_points_days": {"a": 1}}, "10.00", 2),
    ]
    for cfg, total, expected in cases:
        assert compute_points_earned(cfg, drink_qty=2, eligible_total=total, weekday=3).earned == expected, cfg
    # Məbləğ özü zibil olsa da (`None`, boş sətir) per_drink yolu işləməlidir.
    for total in (None, "", "abc", "  "):
        assert compute_points_earned({}, drink_qty=2, eligible_total=total).earned == 2


def test_describe_is_audit_readable():
    cfg = {"double_points_days": [3], "first_purchase_bonus": 5, "first_purchase_bonus_enabled": True}
    text = compute_points_earned(
        cfg, drink_qty=2, eligible_total=12, weekday=3, is_first_purchase=True
    ).describe()
    assert "per drink" in text and "base 2" in text and "2x day" in text and "first purchase +5" in text
    assert compute_points_earned({"min_purchase_for_earn": 99}, drink_qty=1, eligible_total=5).describe() == (
        "Points earn skipped (below minimum purchase)"
    )


# ── find_tier_multiplier — `operations.py::_compute_tier` ilə eyni qayda ─────

#: `operations.py::DEFAULT_TIERS`-in kopyası (label-lar testə lazım deyil).
TIER_LADDER = [
    {"key": "bronze", "threshold": 0, "multiplier": 1},
    {"key": "silver", "threshold": 100, "multiplier": 1},
    {"key": "gold", "threshold": 300, "multiplier": 1.5},
]


def test_tier_lookup_matches_the_ladder():
    cfg = {"tiers": TIER_LADDER}
    assert find_tier_multiplier(cfg, 0) == 1
    assert find_tier_multiplier(cfg, 299) == 1
    assert find_tier_multiplier(cfg, 300) == Decimal("1.5")  # sərhəd daxildir
    assert find_tier_multiplier(cfg, 10_000) == Decimal("1.5")


def test_tier_lookup_is_order_independent():
    """Panel sətirləri istənilən sırada saxlaya bilər — nəticə dəyişməməlidir."""
    shuffled = {"tiers": [TIER_LADDER[2], TIER_LADDER[0], TIER_LADDER[1]]}
    assert find_tier_multiplier(shuffled, 300) == Decimal("1.5")
    assert find_tier_multiplier(shuffled, 50) == 1


def test_tier_lookup_falls_back_to_lowest_tier():
    """Heç bir pillə uyğun gəlmirsə ən aşağısı — `_compute_tier` də belə edir."""
    cfg = {"tiers": [{"key": "silver", "threshold": 100, "multiplier": 2}]}
    assert find_tier_multiplier(cfg, 0) == Decimal("2")


def test_tier_lookup_tolerates_missing_and_garbage_rows():
    assert find_tier_multiplier(None, 500) == 1
    assert find_tier_multiplier({}, 500) == 1
    assert find_tier_multiplier({"tiers": []}, 500) == 1
    assert find_tier_multiplier({"tiers": "gold"}, 500) == 1
    # Açarı olmayan sətirlər atılır (normalizer də atır), qalan zibil 1-ə düşür.
    assert find_tier_multiplier({"tiers": [{"threshold": 0, "multiplier": 9}]}, 500) == 1
    assert find_tier_multiplier({"tiers": [{"key": "x", "threshold": "abc", "multiplier": "abc"}]}, 500) == 1


def test_tier_multiplier_reaches_the_engine_only_through_its_gate():
    """Nərdivan + keçid birlikdə: qapı sönülüdürsə çarpan heç nə etmir."""
    cfg = {"tiers": TIER_LADDER}
    mult = find_tier_multiplier(cfg, 500)  # gold → 1.5
    assert compute_points_earned(cfg, drink_qty=4, eligible_total=20, tier_multiplier=mult).earned == 4
    on = {**cfg, "tier_multiplier_enabled": True}
    assert compute_points_earned(on, drink_qty=4, eligible_total=20, tier_multiplier=mult).earned == 6
