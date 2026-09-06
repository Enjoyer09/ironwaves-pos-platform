"""P1.4b — broadcast seqmenti (audience) mühərriki. **Saf modul.**

Niyə saf: seqment qaydası panelin ön baxışı (`POST /push/preview`) ilə real
göndərmənin (`POST /push/broadcast`) **eyni** olmalıdır. İki yerdə ayrı süzgəc
yazılsa panel "412 alıcı" deyib 30 nəfərə göndərmək mümkündür — P0.4-dəki
dürüstlük qaydasının birbaşa pozulması. Ona görə süzgəc bir funksiyadadır və
həm ön baxış, həm göndərmə onu çağırır.

DB sorğusu **burada deyil**, endpoint-dədir. Səbəb texnikidir: `Customer`-də
`last_visit` sütunu YOXDUR (`app/models.py:538`), yəni "dormant" üçün son satış
tarixi `sales` üzərində qruplanmış sorğu ilə hesablanmalıdır. O sorğu router-də
qalır, bura yalnız **sətirlər** (dict) gəlir — beləliklə modul `sqlalchemy`
import etmir və testlər onu birbaşa import edə bilir.

Sətir sxemi (hamısı optional, tipi səhv olsa da funksiya atmır):

    {"card_id", "push_token", "created_at", "last_sale_at", "stars", "lifetime_stars"}

Bu modul **heç vaxt exception atmır**.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping, Sequence

from app.services.push_service import (
    MAX_BROADCAST_RECIPIENTS,
    split_deliverable_tokens,
)

#: Panelin seçim siyahısı. Sıra panelə göstərilən sıradır.
AUDIENCE_SEGMENTS: tuple[str, ...] = ("all", "new", "dormant", "tier", "has_balance")

#: "Yeni müştəri" pəncərəsi (gün). Qeydiyyat tarixi bu pəncərədədirsə yenidir.
DEFAULT_NEW_DAYS = 30

#: "Yatmış müştəri" pəncərəsi (gün). Son aktivlik bundan köhnədirsə yatmışdır.
DEFAULT_DORMANT_DAYS = 60

MAX_AUDIENCE_DAYS = 3650

#: `has_balance` üçün minimum balans defaultu. `0` mənasızdır (hamı keçər), ona
#: görə aşağı hədd 1-dir.
DEFAULT_MIN_STARS = 1
MAX_MIN_STARS = 1_000_000

SEGMENT_LABELS: dict[str, str] = {
    "all": "Bütün abunəçilər",
    "new": "Yeni müştərilər",
    "dormant": "Yatmış müştərilər",
    "tier": "Səviyyə",
    "has_balance": "Balansı olanlar",
}


def _norm_int(value: Any, fallback: int, minimum: int = 0, maximum: int | None = None) -> int:
    """`push_service._norm_int` ilə eyni semantika (bura kopyalanır ki, modul
    yalnız saf sabitlər üçün import etsin). `OverflowError` `float('inf')` üçündür."""
    if value is None or (isinstance(value, str) and not value.strip()) or isinstance(value, bool):
        parsed = int(fallback)
    else:
        try:
            parsed = int(float(value))
        except (TypeError, ValueError, OverflowError):
            parsed = int(fallback)
    if parsed < minimum:
        parsed = minimum
    return min(parsed, maximum) if maximum is not None else parsed


def _as_naive_utc(value: Any) -> datetime | None:
    """`datetime`-i naive UTC-ə gətirir; tanınmayan tip üçün `None`.

    Niyə: DB sütunları naive UTC-dir (`default=datetime.utcnow`), amma bəzi yollar
    tz-aware dəyər gətirə bilir və naive ↔ aware müqayisəsi `TypeError` atır. Bu
    modul atmamalıdır, ona görə aware dəyər UTC-ə çevrilib tzinfo atılır.
    """
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    if isinstance(value, str) and value.strip():
        raw = value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            return None
        return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
    return None


def normalize_audience_spec(value: Mapping[str, Any] | None) -> dict[str, Any]:
    """Seqment parametrlərini validasiya edir. Heç vaxt atmır.

    `days` seqmentdən asılı defaultla doldurulur (`new` → 30, `dormant` → 60),
    çünki panel sahəni boş göndərə bilər və "0 gün" heç bir seqment üçün mənalı
    deyil (hamısını və ya heç kimi seçərdi).
    """
    raw = dict(value) if isinstance(value, Mapping) else {}
    segment = str(raw.get("segment") or "all").strip().lower()
    if segment not in AUDIENCE_SEGMENTS:
        segment = "all"
    default_days = DEFAULT_NEW_DAYS if segment == "new" else DEFAULT_DORMANT_DAYS
    return {
        "segment": segment,
        "value": str(raw.get("value") or "").strip()[:32],
        "days": _norm_int(raw.get("days"), default_days, 1, MAX_AUDIENCE_DAYS),
        "min_stars": _norm_int(raw.get("min_stars"), DEFAULT_MIN_STARS, 1, MAX_MIN_STARS),
    }


def _tier_threshold(row: Any) -> int:
    """`operations._tier_threshold`-un eynisi (o fayl `fastapi` gətirir)."""
    return _norm_int((row or {}).get("threshold") if isinstance(row, Mapping) else None, 0, 0, 1_000_000)


def current_tier_key(lifetime_stars: Any, tiers: Sequence[Mapping[str, Any]] | None) -> str:
    """Müştərinin cari pilləsi — `operations._compute_tier` ilə **eyni qayda**.

    Qayda təkrarlanır, çünki `_compute_tier` router faylındadır. Fərq yaranarsa
    panel "Gold-a göndər" deyib başqa dəstəyə göndərər, ona görə qayda burada da
    hərfi saxlanılır: sətirlər həddə görə sıralanır, `lifetime_stars >= threshold`
    olan **sonuncu** pillə seçilir, mənfi ulduz 0 sayılır.
    """
    rows = [t for t in (tiers or ()) if isinstance(t, Mapping) and str(t.get("key") or "").strip()]
    if not rows:
        return ""
    rows = sorted(rows, key=_tier_threshold)
    stars = _norm_int(lifetime_stars, 0, 0)
    current = rows[0]
    for row in rows:
        if stars >= _tier_threshold(row):
            current = row
        else:
            break
    return str(current.get("key") or "").strip().lower()


@dataclass
class PushAudience:
    """Seqmentin **dürüst** nəticəsi.

    `matched` seqmentə uyğun müştəri sayıdır (token olsun-olmasın), `tokens` isə
    yalnız real göndərilə bilənlərdir. Panel hər iki rəqəmi göstərir: "412 uyğun
    müştəri, 128-i bildirişə abunədir" — tək rəqəm göstərmək tenant-a 412 nəfərə
    çatacağı illüziyasını verərdi.
    """

    tokens: list[str] = field(default_factory=list)
    #: Seqmentə uyğun müştəri sayı (token şərti olmadan).
    matched: int = 0
    #: Uyğun müştərilərdən token-i olanlar (çatdırıla bilməyənlər də daxil).
    with_token: int = 0
    #: OneSignal abunəlik id-si olmayan tokenlər (native APNs/FCM cihaz tokeni).
    undeliverable: int = 0
    #: `MAX_BROADCAST_RECIPIENTS` həddi işə düşdü?
    capped: bool = False
    #: Verilən bütün sətir sayı — panelin "X müştəridən Y" mətni üçün.
    total: int = 0
    label: str = ""
    note: str = ""

    @property
    def recipients(self) -> int:
        return len(self.tokens)

    def as_dict(self) -> dict[str, Any]:
        """Endpoint cavabı — **token siyahısı YOX** (paneldə lazım deyil)."""
        return {
            "recipients": self.recipients,
            "matched": self.matched,
            "with_token": self.with_token,
            "undeliverable": self.undeliverable,
            "capped": self.capped,
            "total": self.total,
            "label": self.label,
            "note": self.note,
        }


def audience_label(spec: Mapping[str, Any] | None, tiers: Sequence[Mapping[str, Any]] | None = None) -> str:
    """Panelə və `push_deliveries.segment_value`-a yazılan insan-oxunaqlı ad."""
    normalized = normalize_audience_spec(spec)
    segment = normalized["segment"]
    base = SEGMENT_LABELS.get(segment, segment)
    if segment == "new":
        return f"{base} (son {normalized['days']} gün)"
    if segment == "dormant":
        return f"{base} ({normalized['days']} gündən çox aktivlik yoxdur)"
    if segment == "has_balance":
        return f"{base} (≥ {normalized['min_stars']})"
    if segment == "tier":
        key = normalized["value"].lower()
        for row in tiers or ():
            if isinstance(row, Mapping) and str(row.get("key") or "").strip().lower() == key:
                label = row.get("label")
                if isinstance(label, Mapping):
                    name = str(label.get("az") or label.get("en") or key).strip()
                else:
                    name = str(label or key).strip()
                return f"{base}: {name or key}"
        return f"{base}: {key or '—'}"
    return base


def _matches(
    row: Mapping[str, Any],
    spec: Mapping[str, Any],
    *,
    now: datetime,
    tiers: Sequence[Mapping[str, Any]] | None,
) -> bool:
    segment = spec["segment"]
    if segment == "all":
        return True

    if segment == "new":
        created = _as_naive_utc(row.get("created_at"))
        if created is None:
            return False
        return created >= now - timedelta(days=int(spec["days"]))

    if segment == "dormant":
        cutoff = now - timedelta(days=int(spec["days"]))
        last_sale = _as_naive_utc(row.get("last_sale_at"))
        if last_sale is not None:
            return last_sale <= cutoff
        # Heç vaxt alış etməyib: qeydiyyat tarixi baza kimi işlənir, yoxsa dünən
        # qeydiyyatdan keçən müştəri dərhal "yatmış" sayılıb spam alardı.
        created = _as_naive_utc(row.get("created_at"))
        return created is not None and created <= cutoff

    if segment == "tier":
        wanted = str(spec.get("value") or "").strip().lower()
        if not wanted:
            return False
        return current_tier_key(row.get("lifetime_stars"), tiers) == wanted

    if segment == "has_balance":
        return _norm_int(row.get("stars"), 0, 0) >= int(spec["min_stars"])

    return False  # pragma: no cover - normalizer naməlum seqmenti "all"-a çevirir


def resolve_push_audience(
    rows: Iterable[Mapping[str, Any]] | None,
    spec: Mapping[str, Any] | None = None,
    *,
    now: datetime | None = None,
    tiers: Sequence[Mapping[str, Any]] | None = None,
    limit: int = MAX_BROADCAST_RECIPIENTS,
) -> PushAudience:
    """Seqmenti tətbiq edir və göndəriləcək token siyahısını qaytarır.

    Süzgəc sırası **qəsdən** belədir: seqment → token varlığı → çatdırıla bilmə →
    təkrarların silinməsi → hədd. Beləliklə panel hər pillədə itkini görür
    ("412 uyğun, 128-i abunə, 9-u native cihaz tokeni").

    Heç vaxt exception atmır: xarab sətir sadəcə uyğunsuz sayılır.
    """
    normalized = normalize_audience_spec(spec)
    reference = _as_naive_utc(now) or datetime.utcnow()
    cap = max(0, int(limit or 0)) or MAX_BROADCAST_RECIPIENTS

    total = 0
    matched = 0
    tokens: list[Any] = []
    for row in rows or ():
        total += 1
        if not isinstance(row, Mapping):
            continue
        try:
            hit = _matches(row, normalized, now=reference, tiers=tiers)
        except Exception:  # pragma: no cover - süzgəc heç vaxt göndərməni dayandırmır
            hit = False
        if not hit:
            continue
        matched += 1
        token = str(row.get("push_token") or "").strip()
        if token:
            tokens.append(token)

    deliverable, undeliverable = split_deliverable_tokens(tokens)
    capped = len(deliverable) > cap
    result = PushAudience(
        tokens=deliverable[:cap],
        matched=matched,
        with_token=len(deliverable) + len(undeliverable),
        undeliverable=len(undeliverable),
        capped=capped,
        total=total,
        label=audience_label(normalized, tiers),
    )

    notes: list[str] = []
    if result.undeliverable:
        notes.append(
            f"{result.undeliverable} token OneSignal abunəliyi deyil (mobil tətbiqin cihaz tokeni) — "
            "onlara çatdırılma mümkün deyil."
        )
    if capped:
        notes.append(f"Alıcı sayı {cap} həddinə qədər kəsildi.")
    result.note = " ".join(notes)
    return result
