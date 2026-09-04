"""
`customer_app_settings.reward_threshold` üç ayrı yerdə oxunur (P0.3):

  * `app.routers.pos._reward_threshold`  — satış axını (ulduz qazanma)
  * `app.routers.operations._norm_int`   — customer-app sessiyası (`next_reward_at`)
                                           və reward claim endpoint-i
  * `src/lib/loyalty.ts::normalizeRewardThreshold` — frontend lokal rejim güzgüsü

Əvvəl `pos.py` həddi hardcoded `10` saxlayırdı, `operations.py` isə ayardan
oxuyurdu. Nəticə: tenant həddi 8 qoysa müştəri tətbiqdə "8 ulduz" görürdü,
kassada isə 10-luq dövrə ilə qazanırdı. Bu test iki backend oxuyucusunun
eyni cavabı verməsini qoruyur.

Qeyd: satış endpoint-inin özü burada çağırılmır (DB + auth fixture-ları
lazımdır). Test hədd funksiyasını və accrual düsturunu ayrı-ayrı yoxlayır —
regresiya `_reward_threshold` yenidən sabit ədədə dönsə tutulur.
"""

from app.routers.pos import _reward_threshold
from app.routers.operations import _norm_int


# `_norm_int(raw, 10, 1, 1000)` — `operations.py`-in reward_threshold üçün
# işlətdiyi dəqiq çağırış. Cədvəl hər iki tərəf üçün gözlənən nəticədir.
CASES = [
    # (xam dəyər, gözlənən hədd, izah)
    (8, 8, "normal tenant dəyəri"),
    (1, 1, "ən aşağı qanuni hədd — hər qəhvə pulsuz, amma tenant istəyibsə qanunidir"),
    (10, 10, "default ilə üst-üstə düşən dəyər"),
    ("12", 12, "settings JSON-ında string kimi saxlanılıb"),
    ("8.5", 8, "legacy float string — əvvəl int() ValueError → 500 verirdi"),
    (8.9, 8, "float aşağı kəsilir"),
    (None, 10, "ayar heç vaxt yazılmayıb"),
    ("", 10, "boş string"),
    ("   ", 10, "yalnız boşluq"),
    ("abc", 10, "zibil dəyər"),
    (0, 10, "SIFIR → 10, 1 DEYİL: hədd 1 olsa hər qəhvə pulsuz olar"),
    (-5, 10, "mənfi dəyər"),
    (5000, 1000, "ağıllı yuxarı hədd"),
    (True, 10, "bool int-in alt sinfidir — qəsdən rədd edilir"),
    (False, 10, "bool int-in alt sinfidir — qəsdən rədd edilir"),
]


def test_reward_threshold_normalization_table():
    for raw, expected, why in CASES:
        assert _reward_threshold({"reward_threshold": raw}) == expected, why


def test_reward_threshold_matches_operations_normalizer():
    """İki oxuyucu bir-birindən ayrılsa POS ilə customer app yenə fərqli sayar."""
    for raw, expected, why in CASES:
        pos_value = _reward_threshold({"reward_threshold": raw})
        ops_value = _norm_int(raw, 10, 1, 1000)
        assert pos_value == ops_value == expected, why


def test_missing_key_falls_back_to_ten():
    assert _reward_threshold({}) == 10
    assert _reward_threshold({"other_setting": 3}) == 10


def _accrual(current_stars: int, coffee_qty: int, app_settings: dict):
    """`pos.py:751-752`-dəki düsturun eynisi — hədd funksiyadan gəlir."""
    threshold = _reward_threshold(app_settings)
    free_coffees = int((current_stars + coffee_qty) // threshold)
    stars_after = (current_stars + coffee_qty) % threshold if coffee_qty > 0 else current_stars
    return free_coffees, stars_after


def test_accrual_uses_tenant_threshold_not_hardcoded_ten():
    settings = {"reward_threshold": 8}
    # 8 hədd ilə 8-ci qəhvə hədiyyə verir; hardcoded 10 ilə 0 hədiyyə olardı.
    assert _accrual(0, 8, settings) == (1, 0)
    assert _accrual(7, 1, settings) == (1, 0)
    assert _accrual(7, 2, settings) == (1, 1)
    # Bir satışda birdən çox dövrə tamamlana bilər.
    assert _accrual(0, 17, {"reward_threshold": 5}) == (3, 2)


def test_accrual_leaves_stars_untouched_without_coffee():
    """Qəhvə yoxsa balans dəyişmir (məs. yalnız desert satışı)."""
    assert _accrual(3, 0, {"reward_threshold": 8}) == (0, 3)


def test_accrual_survives_broken_setting():
    """Zibil ayar satış axınını dayandırmamalıdır — 10-luq köhnə dövrəyə düşür."""
    assert _accrual(0, 10, {"reward_threshold": "abc"}) == (1, 0)
    assert _accrual(0, 10, {"reward_threshold": 0}) == (1, 0)
