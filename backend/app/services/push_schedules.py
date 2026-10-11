"""P4.3 — planlanmış push cədvəli (`push_schedules`).

Niyyət **burada** saxlanır, göndərmə `push_scheduler`-də olur, nəticə isə
`push_deliveries`-ə yazılır. Üç yol var və hamısı bu moduldan keçir:

  1. paneldən planlama (`POST /push/schedule`),
  2. ləğv (`DELETE /push/schedule/{id}`),
  3. vaxtı çatmış sətirlərin göndərilməsi (`due_schedules` + `push_scheduler`).

Modul `sqlalchemy` import edir (DB ilə işləyir), lakin `fastapi` import etmir —
ona görə scheduler loop-u onu birbaşa çağıra bilir və testlər HTTP qatını
qaldırmır.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Mapping

from sqlalchemy.orm import Session

from app.models import PushSchedule
from app.services.push_audience import normalize_audience_spec

logger = logging.getLogger(__name__)

#: Gözləyən plan üçün status. `sent`/`canceled`/`failed` terminaldır.
PENDING = "pending"
SENT = "sent"
CANCELED = "canceled"
FAILED = "failed"

SCHEDULE_STATUSES = (PENDING, SENT, CANCELED, FAILED)

#: Bir dövrədə göndəriləcək maksimum plan. Scheduler loop-u uzun tranzaksiyalarla
#: bağlanmasın və bir tenant-ın yığılmış planları bütün növbəni tutmasın.
MAX_DUE_PER_CYCLE = 20

#: Planlama üçün minimum gələcək (saniyə). "İndi" üçün planlama sadəcə dərhal
#: göndərmədir — panel onu ayrı düymə ilə edir. Sıfıra yaxın vaxt yazan adminin
#: planı scheduler-i gözləmədən dərhal işləyərdi, yəni sükut saatı qapısı da
#: atlanmış olardı.
MIN_LEAD_SECONDS = 60

#: İnsan səhvi qoruyucusu: bir ildən uzaq plan demək olar ki, həmişə yanlış ilin
#: yazılmasıdır (`2027` yerinə `2026`).
MAX_LEAD_DAYS = 365


def parse_scheduled_at(value: Any) -> datetime | None:
    """ISO 8601 → naive UTC `datetime`. Tanınmasa `None`.

    `Z` və açıq ofset qəbul olunur və UTC-yə çevrilir: `datetime.utcnow()` ilə
    müqayisə olunan sütun naive UTC-dir, tz-aware dəyər `TypeError` atardı.
    """
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        raw = value.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def validate_schedule_window(
    scheduled_at: datetime | None,
    now: datetime,
    *,
    min_lead_seconds: int = MIN_LEAD_SECONDS,
    max_lead_days: int = MAX_LEAD_DAYS,
) -> str:
    """Vaxt pəncərəsini yoxlayır. Boş sətir = qaydasındadır, yoxsa səbəb.

    Səbəb **Azərbaycanca** qaytarılır — endpoint onu birbaşa 400 `detail`-inə
    qoyur, panel heç bir çevrilmə etmir.
    """
    if scheduled_at is None:
        return "Planlanmış vaxt düzgün deyil (ISO 8601 formatı gözlənilir)."
    delta = (scheduled_at - now).total_seconds()
    if delta < int(min_lead_seconds):
        return (
            "Planlanmış vaxt ən azı 1 dəqiqə sonra olmalıdır. "
            "Dərhal göndərmək üçün adi göndərmə düyməsini işlədin."
        )
    if delta > int(max_lead_days) * 86400:
        return f"Planlanmış vaxt {int(max_lead_days)} gündən uzaq ola bilməz — ili yoxlayın."
    return ""


def schedule_spec(spec: Mapping[str, Any] | None) -> dict[str, Any]:
    """Seqmenti **dondurur**: planlama anındaki parametrlər saxlanılır.

    Yenidən hesablamaq adminin təsdiqlədiyi dəsti dəyişərdi (yeni abunəçilər
    əlavə olunar, sükutə düşənlər çıxar). Ona görə plan `spec`-i saxlayır, sətirlər
    isə göndərmə anında təzə oxunur — "kimə" sabit, tokenlər təzə.
    """
    return normalize_audience_spec(spec)


def spec_to_json(spec: Mapping[str, Any] | None) -> str:
    return json.dumps(schedule_spec(spec), ensure_ascii=False)[:2000]


def spec_from_json(raw: Any) -> dict[str, Any]:
    """Xarab JSON **atmır** — `normalize_audience_spec`-in defaultuna düşür.

    Bu, diqqəti çəkən bir qoruyucudur: xarab plan "hər kəsə" yayım etmir, çünki
    normalizer yalnız **bilinən** seqmenti saxlayır (`value`/`days` sərhədlənir).
    """
    if isinstance(raw, Mapping):
        return normalize_audience_spec(raw)
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            return normalize_audience_spec(None)
        return normalize_audience_spec(parsed if isinstance(parsed, Mapping) else None)
    return normalize_audience_spec(None)


def create_schedule(
    db: Session,
    tenant_id: str,
    *,
    title: str,
    body: str,
    scheduled_at: datetime,
    spec: Mapping[str, Any] | None = None,
    url: str | None = None,
    campaign_id: str | None = None,
    created_by: str | None = None,
) -> PushSchedule:
    """Plan sətri yaradır. **Commit etmir** — çağıran öz tranzaksiyasını bağlayır."""
    row = PushSchedule(
        tenant_id=tenant_id,
        title=(str(title or "").strip()[:160] or ""),
        body=str(body or "").strip()[:2000],
        url=(str(url or "").strip()[:500] or None),
        spec_json=spec_to_json(spec),
        campaign_id=(str(campaign_id)[:36] if campaign_id else None),
        status=PENDING,
        scheduled_at=scheduled_at,
        created_by=(str(created_by)[:80] if created_by else None),
    )
    db.add(row)
    return row


def due_schedules(db: Session, now: datetime, *, limit: int = MAX_DUE_PER_CYCLE) -> list[PushSchedule]:
    """Vaxtı çatmış **gözləyən** planlar (ən köhnə əvvəldə).

    Yalnız `status == "pending"` seçilir: `failed`/`sent` sətirlər terminaldır,
    yoxsa uğursuz plan hər dövrədə yenidən cəhd olunub provayderə sonsuz təzyiq
    yaradardı. Sükut saatı göndərməni təxirə salanda statusu **dəyişmir** —
    sadəcə `scheduled_at` irəli sürüşür, yəni plan növbədə qalır.
    """
    return (
        db.query(PushSchedule)
        .filter(PushSchedule.status == PENDING, PushSchedule.scheduled_at <= now)
        .order_by(PushSchedule.scheduled_at.asc())
        .limit(max(1, int(limit or MAX_DUE_PER_CYCLE)))
        .all()
    )
