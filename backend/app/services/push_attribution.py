"""P4.4 — göndərmə → istifadə hunisi (saf hesablama).

**Nəyi BİLMİRİK və bunu gizlətmirik.** Repoda bildirişin *açılması* (open/click)
haqqında bir dənə də siqnal yoxdur: OneSignal payload-ında korrelyasiya id yoxdur
(`build_onesignal_payload` yalnız `app_id`/`contents`/`headings`/`url` yazır),
webhook qəbuledicisi yoxdur, tətbiqdə `pushNotificationActionPerformed`
yalnız `console.log` edir. Ona görə huni **"göndərildi → OneSignal qəbul etdi →
kasa endirimi tətbiq etdi"** kimi qurulur və panel bunu sözü ilə deyir.

Son pillə **atribusiya deyil, redemption-dır**: `Sale.campaign_id` kassada
kampaniya endirimi *tətbiq olunanda* yazılır. Müştəri endirimi görüb gəldi, yoxsa
onsuz da gələcəkdi — bu, satış sətrindən bilinmir. Ona görə funksiya
`conversion_rate` yerinə `redemption_rate` qaytarır və
`attribution="redemption"` yazır. "Faizlə X qazandıq" demək P0.4-də təmizlədiyimiz
saxta vəd probleminin eynisidir.
"""

from __future__ import annotations

from typing import Any

#: Huninin son pilləsinin HƏQİQİ mənası. Panel bu sözü göstərir.
ATTRIBUTION_REDEMPTION = "redemption"
#: Göndərmə olub, endirim tətbiq olunmayıb — "işləmədi" demək DEYİL, sadəcə siqnal yoxdur.
ATTRIBUTION_NONE = "no_redemption"

#: P4.5 — qəbul olunan toxunma hadisələri. Bu gün yalnız `opened`: tətbiq
#: bildirişə toxunanda `Capacitor` `pushNotificationActionPerformed` verir.
#: `clicked` (düyməyə klik) üçün yer saxlanılır — hazırda heç bir düymə yoxdur,
#: ona görə qəbul etsək panel boş kateqoriya göstərərdi.
PUSH_ENGAGEMENT_KINDS = ("opened",)


def round2(value: float) -> float:
    """Riyazi yuvarlaqlaşdırma (yarısı yuxarı), 2 onluq.

    Python-un `round()` **bankir** yuvarlaqlaşdırmasıdır (0.5 → 0), JS-in
    `Math.round()` isə yuxarı. Güzgü funksiya `push.ts`-dədir və paritet testi
    hər iki tərəfi eyni rəqəm gözləyir — ona görə burada açıq `floor(v+0.5)`
    işlədilir, `round` yox.
    """
    try:
        num = float(value)
    except (TypeError, ValueError):
        return 0.0
    if num != num or num in (float("inf"), float("-inf")):  # NaN / inf
        return 0.0
    if num < 0:
        # Mənfi dəyər biznes məntiqində olmur (say/endirim/pul ≥ 0). Yenə də
        # simmetrik davranaq ki, sürpriz rəqəm ekrana düşməsin.
        return -((-num * 100 + 0.5) // 1) / 100
    return int(num * 100 + 0.5) / 100


def _safe_int(value: Any) -> int:
    try:
        num = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return num if num > 0 else 0


def _safe_float(value: Any) -> float:
    try:
        num = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    if num != num or num in (float("inf"), float("-inf")):
        return 0.0
    return num if num > 0 else 0.0


def rate(part: Any, whole: Any) -> float:
    """`part / whole * 100`, 2 onluq. `whole <= 0` → `0.0` (sıfıra bölmə yox)."""
    whole_num = _safe_float(whole)
    if whole_num <= 0:
        return 0.0
    return round2(_safe_float(part) * 100 / whole_num)


def per_unit(part: Any, count: Any) -> float:
    """`part / count`, 2 onluq. `count <= 0` → `0.0`."""
    count_num = _safe_float(count)
    if count_num <= 0:
        return 0.0
    return round2(_safe_float(part) / count_num)


def build_funnel(
    *,
    sends: Any = 0,
    recipients: Any = 0,
    accepted: Any = 0,
    failed: Any = 0,
    orders: Any = 0,
    customers: Any = 0,
    revenue: Any = 0,
    discount: Any = 0,
    opened: Any = 0,
    openers: Any = 0,
    open_tracking: bool = False,
) -> dict:
    """Bir kampaniyanın hunisi. Bütün girişlər mənfi ola bilməz.

    `accepted` = OneSignal qəbul etdiyi abunəlik sayı (provayderin `recipients`
    sahəsi), `recipients` = bizim göndərdiyimiz token sayı. İkisi fərqlidirsə
    bu, provayderin süzgəcidir — panel hər ikisini göstərir.

    `opened`/`openers` P4.5-dir və **qismən** məlumatdır: hadisə yalnız tətbiq
    içindən gəlir. Tətbiqi açmadan, bildiriş panelindən silən müştəri
    görünmür — ona görə `open_tracking` ayrıca bayraqdır və `open_rate`
    hesablananda panel bunu "ən azı" kimi oxumalıdır.
    """
    sends_n = _safe_int(sends)
    recipients_n = _safe_int(recipients)
    accepted_n = _safe_int(accepted)
    failed_n = _safe_int(failed)
    orders_n = _safe_int(orders)
    customers_n = _safe_int(customers)
    revenue_f = _safe_float(revenue)
    discount_f = _safe_float(discount)
    opened_n = _safe_int(opened)
    openers_n = _safe_int(openers)

    # Açılma sayı göndəriləndən çox ola bilməz. Olursa bu, məlumat xətasıdır
    # (məs. eyni göndərmə iki dəfə sayılıb) — səssizcə 100%-dən yuxarı faiz
    # göstərməkdənsə kəsirik və bu, "ən azı" mənasını saxlayır.
    if recipients_n > 0 and opened_n > recipients_n:
        opened_n = recipients_n

    if orders_n > 0:
        attribution = ATTRIBUTION_REDEMPTION
    else:
        attribution = ATTRIBUTION_NONE

    return {
        "sends": sends_n,
        "recipients": recipients_n,
        "accepted": accepted_n,
        "failed": failed_n,
        # Provayder qəbulu: göndərdiyimiz token-lərdən neçəsi çatdırıla bildi.
        "delivery_rate": rate(accepted_n, recipients_n),
        # P4.5 — tətbiqdən gələn toxunma. **Qismən** ölçüdür (bax docstring).
        "opened": opened_n,
        "openers": openers_n,
        "open_rate": rate(opened_n, recipients_n),
        # Pəncərədə bu kampaniyanın endirimini tətbiq edən satış sətirləri.
        "orders": orders_n,
        "customers": customers_n,
        "revenue": round2(revenue_f),
        "discount": round2(discount_f),
        # Net = müştərinin ödədiyi. Endirim çıxılmış haldır, çünki `Sale.total`
        # endirimdən SONRAKI məbləğdir.
        "avg_order_value": per_unit(revenue_f, orders_n),
        "discount_per_order": per_unit(discount_f, orders_n),
        # Əsas rəqəm. Adı **redemption**, çünki bu, kassada tətbiq olunan
        # endirimdir — bildirişin səbəb olduğu sübut deyil.
        "redemption_rate": rate(orders_n, recipients_n),
        "attribution": attribution,
        #: `True` olanda açılma rəqəmi real hadisələrdən gəlir (tətbiq bildirib).
        #: `False` olanda panel "izlənmir" yazmalıdır, "0 açılma" yox.
        "open_tracking": bool(open_tracking),
    }


def summarize(funnels: list[dict]) -> dict:
    """Kampaniyaların cəmi. Yüzdə **yenidən hesablanır** — ortalaması yox.

    Səbəb: yüzdələrin ortasını götürmək kiçik kampaniyaya böyüyü qədər çəki
    verərdi (5 nəfərlik plan 5000 nəfərlik planı "düzəldərdi"). Cəm əvvəlcə
    toplanır, sonra bölünür.
    """
    total_sends = total_recipients = total_accepted = total_failed = 0
    total_orders = total_campaigns_with_orders = 0
    total_revenue = total_discount = 0.0
    total_opened = 0
    any_open_tracking = False
    # Müştəriləri kampaniyalar arası **təkrarsız** sayırıq: eyni adam iki
    # kampaniyada alıbsa, cəmdə iki dəfə saymaq "daha çox müştəri" yalanı olardı.
    # Cəm üçün dəqiq unikal say üçün ayrı sorğu lazımdır; burada `None` qoyuruq
    # ki, panel uydurma rəqəm göstərməsin.
    for row in funnels or []:
        total_sends += _safe_int(row.get("sends"))
        total_recipients += _safe_int(row.get("recipients"))
        total_accepted += _safe_int(row.get("accepted"))
        total_failed += _safe_int(row.get("failed"))
        total_orders += _safe_int(row.get("orders"))
        total_revenue += _safe_float(row.get("revenue"))
        total_discount += _safe_float(row.get("discount"))
        # Açılmalar kampaniyalar arası **toplanır**: eyni adam iki fərqli
        # bildirişi açıbsa bu, iki açılmadır. (Müştəri sayında isə təkrarsızlıq
        # lazımdır — orada məna "neçə adam"dır, burada "neçə toxunma".)
        total_opened += _safe_int(row.get("opened"))
        if row.get("open_tracking"):
            any_open_tracking = True
        if _safe_int(row.get("orders")) > 0:
            total_campaigns_with_orders += 1

    return {
        "campaigns": len(funnels or []),
        "campaigns_with_orders": total_campaigns_with_orders,
        "sends": total_sends,
        "recipients": total_recipients,
        "accepted": total_accepted,
        "failed": total_failed,
        "delivery_rate": rate(total_accepted, total_recipients),
        "opened": total_opened,
        "open_rate": rate(total_opened, total_recipients),
        "orders": total_orders,
        #: `None` — cəmdə təkrarsız müştəri sayı bu aqreqatdan çıxmır.
        "customers": None,
        "revenue": round2(total_revenue),
        "discount": round2(total_discount),
        "avg_order_value": per_unit(total_revenue, total_orders),
        "discount_per_order": per_unit(total_discount, total_orders),
        "redemption_rate": rate(total_orders, total_recipients),
        "attribution": (
            ATTRIBUTION_REDEMPTION if total_orders > 0 else ATTRIBUTION_NONE
        ),
        # Cəmdə açılma izləməsi **hər hansı** kampaniyada varsa `True`. Qarışıq
        # halda (biri izlənir, biri yox) panel "qismən" yazır — `any` seçməyimiz
        # səbəbi budur, ortalamada itməsin.
        "open_tracking": any_open_tracking,
    }
