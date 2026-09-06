"""P1.1 — konfiqurasiya edilə bilən ulduz/xal qazanma mühərriki.

Niyə ayrı modul: bu funksiya **kassanın pul yazan yolundadır** (`pos.py::create_sale`).
Router-dən ayrı saxlanır ki, testlər FastAPI/DB qaldırmadan onu import edə bilsin.

Əvvəl (P0-a qədər) qazanma sərt kodlanmışdı: hər "qəhvəyəbənzər" içki = 1 ulduz.
Panelin dörd sahəsi (`earn_rate_per_azn`, `min_purchase_for_earn`,
`first_purchase_bonus`, `double_points_days`) və tier `multiplier`-i heç yerdə
oxunmurdu — P0.4 onlara "tətbiqdə hələ işləmir" nişanı qoydu, bu modul isə
onları həqiqətən işlədir.

**Geriyə uyğunluq (vacib):** bu açarların hazırda saxlanmış default dəyərləri
zərərsiz DEYİL — `earn_rate_per_azn=2.0`, `first_purchase_bonus=5`,
`gold.multiplier=1.5`. Onları qapısız qoşmaq hər mövcud tenant-ı səssizcə
"1 içki = 1 ulduz"-dan "1 AZN = 2 ulduz"-a keçirərdi (5 AZN latte = 10 ulduz =
default həddə dərhal pulsuz qəhvə). Ona görə hər yeni davranışın **açıq keçidi**
var və hamısı sönülü başlayır:

* `earn_basis`                  — `"per_drink"` (default, köhnə davranış) / `"per_azn"`
* `first_purchase_bonus_enabled` — default `False`
* `tier_multiplier_enabled`      — default `False`

`min_purchase_for_earn` (default 0) və `double_points_days` (default boş) öz
defaultlarında onsuz da təsirsizdir, ona görə onlara ayrı keçid lazım deyil.

Hesablama sırası (frontend güzgüsü `src/lib/loyalty.ts` ilə **eyni** olmalıdır):

1. minimum məbləğ yoxlanışı → keçmirsə qazanma 0 (bonus da yoxdur)
2. baza: `per_drink` → içki sayı; `per_azn` → `floor(məbləğ × dərəcə)`
3. baza 0-dırsa dayan (2x və multiplier heç nəyi çoxalda bilmir)
4. 2x gün → baza ×2
5. tier multiplier → `floor(baza × multiplier)`
6. ilk alış bonusu → düz üstünə gəlir (çoxaldılmır)
7. `MAX_EARN_PER_SALE` ilə kəsilir

Bütün nəticələr tam ədəddir (ulduz kəsr olmur) və hər addımda **aşağıya
yuvarlaqlaşdırılır**. Funksiya heç bir halda exception atmır — satış axını
ayardaki bir yazı səhvinə görə 500 verməməlidir.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, ROUND_HALF_UP
from typing import Any, Iterable, Mapping

DEFAULT_EARN_BASIS = "per_drink"
EARN_BASIS_CHOICES = ("per_drink", "per_azn")

DEFAULT_EARN_RATE_PER_AZN = 2.0
MAX_EARN_RATE_PER_AZN = 1000.0
MAX_MIN_PURCHASE = 100000.0
MAX_FIRST_PURCHASE_BONUS = 1000
MAX_TIER_MULTIPLIER = 10.0

#: Bir satışda qazanıla biləcək maksimum ulduz. Ayar səhv qoyulsa (məs. dərəcə
#: 1000, məbləğ 500 AZN) balansın partlamasının qarşısını alır.
MAX_EARN_PER_SALE = 10_000


def _as_decimal(value: Any, fallback: str = "0") -> Decimal:
    """Hər cür girişi Decimal-a çevirir; bool "yoxdur" sayılır (True == 1 tələsi)."""
    if value is None or isinstance(value, bool):
        return Decimal(fallback)
    if isinstance(value, Decimal):
        return value if value.is_finite() else Decimal(fallback)
    try:
        parsed = Decimal(str(value).strip() or fallback)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(fallback)
    return parsed if parsed.is_finite() else Decimal(fallback)


def _floor_int(value: Decimal) -> int:
    """Aşağıya yuvarlaqlaşdırma — mənfi dəyərlər üçün də 0-dan aşağı düşmür."""
    if value <= 0:
        return 0
    return int(value.to_integral_value(rounding=ROUND_FLOOR))


def _quantize_money(value: Decimal) -> Decimal:
    """Məbləği 2 onluğa yuvarlaqlaşdırır.

    Frontend güzgüsü (`src/lib/loyalty.ts`) məbləği `Math.round(x * 100)` ilə
    qəpiyə çevirir. Çek məbləği hər iki tərəfdə onsuz da 2 onluqdur, amma legacy
    və ya offline data 3 onluq gətirsə minimum yoxlanışı iki tərəfdə fərqli
    nəticə verməsin.
    """
    try:
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return value


def _flag(settings: Mapping[str, Any], key: str) -> bool:
    """Ayar açarının "açıqdır" oxunuşu. `"false"` / `"0"` sətirləri də sönülüdür."""
    raw = settings.get(key)
    if isinstance(raw, str):
        return raw.strip().lower() not in ("", "0", "false", "no", "off")
    return bool(raw)


def resolve_earn_basis(settings: Mapping[str, Any]) -> str:
    """`earn_basis` — tanınmayan dəyər köhnə davranışa (`per_drink`) düşür."""
    raw = str(settings.get("earn_basis") or "").strip().lower()
    return raw if raw in EARN_BASIS_CHOICES else DEFAULT_EARN_BASIS


def resolve_earn_rate(settings: Mapping[str, Any]) -> Decimal:
    """1 AZN-ə düşən ulduz. 0..1000; mənfi/xətalı dəyər 0-a düşür."""
    rate = _as_decimal(settings.get("earn_rate_per_azn"), "0")
    if rate < 0:
        return Decimal("0")
    return min(rate, Decimal(str(MAX_EARN_RATE_PER_AZN)))


def resolve_min_purchase(settings: Mapping[str, Any]) -> Decimal:
    """Qazanma üçün minimum çek məbləği. 0 = limit yoxdur."""
    minimum = _as_decimal(settings.get("min_purchase_for_earn"), "0")
    if minimum < 0:
        return Decimal("0")
    return min(minimum, Decimal(str(MAX_MIN_PURCHASE)))


def resolve_double_days(settings: Mapping[str, Any]) -> set[int]:
    """2x günlər — **B.E=1 … Bazar=7** (sistemin hər yerdəki konvensiyası).

    Köhnə `0` (bəzi lokal tiplərdə "Sunday" kimi şərh olunub) 7-yə çevrilir,
    yoxsa Bazar səssizcə itir. Diapazondan kənar dəyərlər atılır.
    """
    raw = settings.get("double_points_days")
    if not isinstance(raw, Iterable) or isinstance(raw, (str, bytes)):
        return set()
    days: set[int] = set()
    for item in raw:
        if isinstance(item, bool):
            continue
        try:
            day = int(float(str(item).strip()))
        except (ValueError, TypeError):
            continue
        if day == 0:
            day = 7
        if 1 <= day <= 7:
            days.add(day)
    return days


def resolve_first_purchase_bonus(settings: Mapping[str, Any]) -> int:
    """İlk alış bonusu — **yalnız `first_purchase_bonus_enabled` açıq olanda**."""
    if not _flag(settings, "first_purchase_bonus_enabled"):
        return 0
    bonus = _floor_int(_as_decimal(settings.get("first_purchase_bonus"), "0"))
    return min(bonus, MAX_FIRST_PURCHASE_BONUS)


def resolve_tier_multiplier(settings: Mapping[str, Any], multiplier: Any) -> Decimal:
    """Tier çarpanı — **yalnız `tier_multiplier_enabled` açıq olanda**.

    Sönülüdürsə 1.0 qaytarır (təsirsiz). Default tier nərdivanında
    `gold.multiplier = 1.5` var, ona görə bu keçid olmadan qoşulması mövcud
    qızıl müştərilərin qazancını xəbərsiz artırardı.
    """
    if not _flag(settings, "tier_multiplier_enabled"):
        return Decimal("1")
    value = _as_decimal(multiplier, "1")
    if value < 0:
        return Decimal("1")
    return min(value, Decimal(str(MAX_TIER_MULTIPLIER)))


def find_tier_multiplier(settings: Mapping[str, Any] | None, lifetime_stars: Any) -> Decimal:
    """`tiers` nərdivanında `lifetime_stars`-a uyğun pillənin xam `multiplier`-i.

    Niyə burada: kassa tier sətrini özü seçməməlidir — panel, customer app və
    accrual eyni nərdivanı eyni qayda ilə oxumalıdır.

    Qayda `operations.py::_compute_tier`-in **eynidir** (yoxsa tətbiq "Gold ×1.5"
    göstərib kassa ×1 sayar): sıralanmış pillələrdə `lifetime_stars`-dan böyük
    olmayan sonuncu pillə; heç biri uyğun gəlməsə ən aşağı pillə. Açarı olmayan
    sətirlər orada da atılır.

    Bu funksiya `tier_multiplier_enabled` keçidini **yoxlamır** — o yoxlama
    `resolve_tier_multiplier`-dədir. Buradan xam dəyər çıxır, oradan keçir.
    """
    cfg: Mapping[str, Any] = settings if isinstance(settings, Mapping) else {}
    raw = cfg.get("tiers")
    if not isinstance(raw, list):
        return Decimal("1")
    rows = [r for r in raw if isinstance(r, Mapping) and str(r.get("key") or "").strip()]
    if not rows:
        return Decimal("1")
    stars = _floor_int(_as_decimal(lifetime_stars, "0"))
    ordered = sorted(rows, key=lambda r: _floor_int(_as_decimal(r.get("threshold"), "0")))
    current = ordered[0]
    for row in ordered:
        if stars >= _floor_int(_as_decimal(row.get("threshold"), "0")):
            current = row
        else:
            break
    return _as_decimal(current.get("multiplier"), "1")


@dataclass(frozen=True)
class AccrualBreakdown:
    """Nə qədər qazanıldı və **niyə** — ledger təsviri və push mətni bundan qurulur."""

    earned: int
    base: int = 0
    double_day_applied: bool = False
    tier_bonus: int = 0
    first_purchase_bonus: int = 0
    blocked_by_minimum: bool = False
    capped: bool = False
    basis: str = DEFAULT_EARN_BASIS

    def describe(self) -> str:
        """`LoyaltyLedgerEntry.description` üçün qısa, audit oxunaqlı sətir."""
        if self.blocked_by_minimum:
            return "Points earn skipped (below minimum purchase)"
        parts = [
            "per drink" if self.basis == "per_drink" else "per AZN",
            f"base {self.base}",
        ]
        if self.double_day_applied:
            parts.append("2x day")
        if self.tier_bonus:
            parts.append(f"tier +{self.tier_bonus}")
        if self.first_purchase_bonus:
            parts.append(f"first purchase +{self.first_purchase_bonus}")
        if self.capped:
            parts.append(f"capped at {MAX_EARN_PER_SALE}")
        return "Points earn (" + ", ".join(parts) + ")"


def compute_points_earned(
    settings: Mapping[str, Any] | None,
    *,
    drink_qty: int = 0,
    eligible_total: Any = 0,
    weekday: int | None = None,
    is_first_purchase: bool = False,
    tier_multiplier: Any = None,
) -> AccrualBreakdown:
    """Bu satışda qazanılan ulduz sayı.

    `settings` — tenant-ın `customer_app_settings` blobu (`None` olarsa hər şey
    default: köhnə "1 içki = 1 ulduz" davranışı).
    `eligible_total` — endirimlərdən **sonra**, pulsuz içki güzəştindən **əvvəl**
    olan çek məbləği. Bu sıra qəsdəndir: pulsuz içki sayı qazanılan ulduzdan
    asılıdır, ona görə qazanma güzəştdən əvvəlki məbləğdən hesablanmalıdır,
    yoxsa dairəvi asılılıq yaranır.
    `weekday` — B.E=1 … Bazar=7 (`datetime.weekday() + 1`). `None` = 2x yoxlanmır.
    `tier_multiplier` — müştərinin tier sətrindəki `multiplier`.
    """
    cfg: Mapping[str, Any] = settings if isinstance(settings, Mapping) else {}
    basis = resolve_earn_basis(cfg)
    total = _quantize_money(_as_decimal(eligible_total, "0"))
    minimum = resolve_min_purchase(cfg)

    if minimum > 0 and total < minimum:
        return AccrualBreakdown(earned=0, blocked_by_minimum=True, basis=basis)

    try:
        qty = int(drink_qty or 0)
    except (ValueError, TypeError):
        qty = 0
    qty = max(0, qty)

    if basis == "per_azn":
        base = _floor_int(total * resolve_earn_rate(cfg))
    else:
        base = qty

    if base <= 0:
        # Bonuslar sıfır bazanı çoxalda bilmir; ilk alış bonusu da real qazanma
        # olmadan verilmir (yoxsa 0 AZN-lik "test" satışı bonus qoparardı).
        return AccrualBreakdown(earned=0, base=0, basis=basis)

    earned = base
    double_days = resolve_double_days(cfg)
    double_applied = weekday is not None and int(weekday) in double_days
    if double_applied:
        earned *= 2

    multiplier = resolve_tier_multiplier(cfg, tier_multiplier)
    tier_bonus = 0
    if multiplier != 1:
        after_tier = _floor_int(Decimal(earned) * multiplier)
        tier_bonus = after_tier - earned
        earned = after_tier

    first_bonus = resolve_first_purchase_bonus(cfg) if is_first_purchase else 0
    earned += first_bonus

    capped = earned > MAX_EARN_PER_SALE
    if capped:
        earned = MAX_EARN_PER_SALE

    return AccrualBreakdown(
        earned=max(0, earned),
        base=base,
        double_day_applied=double_applied,
        tier_bonus=tier_bonus,
        first_purchase_bonus=first_bonus,
        capped=capped,
        basis=basis,
    )
