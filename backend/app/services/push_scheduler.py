"""P4.3 — planlanmış push scheduler-i.

`birthday_scheduler.py` ilə **eyni naxış**: daemon thread hər `CHECK_INTERVAL`
saniyədə oyanır, işi bir funksiyaya (`run_due_schedules`) verir ki, testlər
loop-u qaldırmadan onu birbaşa çağıra bilsin.

Üç dürüstlük qaydası:

  1. **Sükut saatı göndərməni udmur, təxirə salır.** Sükut içində vaxtı çatan plan
     `scheduled_at` sükut bitən ana sürüşdürülür və `status="pending"` qalır.
     Göndərməyə icazə verib müştəriləri gecə oyatmaq, ya da planı səssizcə
     "failed" etmək ikisi də pisdir.
  2. **Cəhd bir dəfədir.** `executed_at` yazılır — `failed` plan hər dövrədə
     yenidən cəhd olunmur (sonsuz dövrə + provayderə təkrar təzyiq).
  3. **Nəticə `push_deliveries`-ə yazılır.** Plan cədvəli **niyyəti** saxlayır;
     tarixçə tək mənbədə qalır, yoxsa panel iki fərqli "göndərilənlər" siyahısı
     göstərərdi.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models import PushDelivery, Setting
from app.services.push_dispatch import (
    load_push_settings,
    resolve_audience_for_tenant,
    send_bulk_push,
)
from app.services.push_schedule import quiet_block_message, quiet_window_state
from app.services.push_schedules import (
    FAILED,
    SENT,
    due_schedules,
    spec_from_json,
)

logger = logging.getLogger("ironwaves.push_scheduler")

CHECK_INTERVAL = 60  # saniyə — planlar dəqiqə dəqiqliyindədir, 60 saniyə kifayətdir

DEFAULT_TZ = "Asia/Baku"
DEFAULT_UTC_OFFSET = timedelta(hours=4)

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None


def tenant_minute_of_day(db: Session, tenant_id: str, *, now: datetime | None = None) -> int:
    """Tenant-ın vaxt qurşağında günün dəqiqəsi (0..1439).

    `time_settings.timezone` (default `Asia/Baku`) oxunur — `birthday_scheduler`
    ilə eyni mənbə, yoxsa iki scheduler fərqli "gecə" təsəvvürünə sahib olardı.
    `ZoneInfo` yoxdursa UTC+4 fallback.
    """
    tz_name = DEFAULT_TZ
    try:
        row = (
            db.query(Setting)
            .filter(Setting.tenant_id == tenant_id, Setting.key == "time_settings")
            .first()
        )
        if row and row.value:
            parsed = json.loads(row.value)
            candidate = (parsed or {}).get("timezone")
            if isinstance(candidate, str) and candidate.strip():
                tz_name = candidate.strip()
    except Exception:  # pragma: no cover - ayar oxunmasa default işləyir
        pass

    reference = now or datetime.utcnow()
    if ZoneInfo:
        try:
            naive = reference.replace(tzinfo=None) if reference.tzinfo else reference
            local = naive.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(tz_name))
            return local.hour * 60 + local.minute
        except Exception:  # pragma: no cover
            pass
    shifted = reference + DEFAULT_UTC_OFFSET
    return shifted.hour * 60 + shifted.minute


def _tiers_for(db: Session, tenant_id: str) -> list[dict]:
    """`operations._push_tiers` ilə eyni nəticə, lakin modul importunu gecikdirərək.

    Lazy import qəsdəndir: `operations` `fastapi` gətirir, scheduler isə onu loop-un
    importunda dartmaq məcburiyyətində deyil. Lazım olan yeganə dəyər
    `customer_app_settings.tiers`-dir və normalizer həmin router-dədir.
    """
    try:
        from app.routers.operations import _norm_customer_app_tiers, _setting_value

        blob = _setting_value(db, tenant_id, "customer_app_settings", {})
        return _norm_customer_app_tiers((blob or {}).get("tiers") if isinstance(blob, dict) else None)
    except Exception as exc:  # pragma: no cover - seqment onsuz da işləyir
        logger.warning("Plan üçün tier oxunmadı: %s", str(exc)[:150])
        return []


def _newest_delivery(db: Session, tenant_id: str):
    """Tenant-ın ən yeni `push_deliveries` sətri.

    `send_bulk_push` az öncə yazdı, yəni ən yenisi bizimkidir. `delivery_id`
    **yalnız** panelin "plan → tarixçə" keçidi üçündür; hesabatın mənbəyi həmişə
    `push_deliveries`-in özüdür (tək həqiqət mənbəyi).
    """
    try:
        return (
            db.query(PushDelivery)
            .filter(PushDelivery.tenant_id == tenant_id)
            .order_by(PushDelivery.created_at.desc())
            .first()
        )
    except Exception as exc:  # pragma: no cover - keçid ikinci dərəcəlidir
        logger.warning("Jurnal sətri tapılmadı: %s", str(exc)[:150])
        return None


def _finish(row, db: Session, *, status: str, error: str | None, now: datetime) -> None:
    """Planı terminal statusa keçirir və commit edir.

    `executed_at` **həmişə** yazılır (səhv halda da) — yoxsa `failed` plan hər
    dövrədə yenidən seçilər və provayderə sonsuz təzyiq yaradardı.
    """
    row.status = status
    row.error = (str(error)[:2000] if error else None)
    row.executed_at = now
    db.commit()


def run_due_schedules(db: Session, *, now: datetime | None = None) -> dict[str, Any]:
    """Vaxtı çatmış planları göndərir. **Heç vaxt exception atmır.**

    Qaytarma: `{checked, sent, deferred, failed}` — scheduler logu və testlər
    bunu oxuyur.
    """
    reference = now or datetime.utcnow()
    result = {"checked": 0, "sent": 0, "deferred": 0, "failed": 0}

    try:
        rows = due_schedules(db, reference)
    except Exception as exc:  # pragma: no cover - cədvəl yoxdursa
        logger.warning("Plan siyahısı oxunmadı: %s", str(exc)[:200])
        return result

    for row in rows:
        result["checked"] += 1
        try:
            push_settings = load_push_settings(db, row.tenant_id)

            # Sükut saatı → planı təxirə sal, göndərmə.
            quiet = quiet_window_state(
                push_settings, tenant_minute_of_day(db, row.tenant_id, now=reference)
            )
            if quiet["inside"]:
                minutes = int(quiet["minutes_until_allowed"] or 0)
                if minutes > 0:
                    row.scheduled_at = reference + timedelta(minutes=minutes)
                row.error = quiet_block_message(quiet)
                db.commit()
                result["deferred"] += 1
                logger.info("Plan %s sükut saatına düşdü, təxirə salındı.", row.id)
                continue

            if not bool(push_settings.get("enabled", True)):
                _finish(row, db, status=FAILED, error="Push bildirişləri söndürülüb.", now=reference)
                result["failed"] += 1
                continue
            if not bool(push_settings.get("broadcast_enabled", False)):
                _finish(
                    row, db, status=FAILED,
                    error="Kütləvi bildiriş söndürülüb (Ayarlar → Bildirişlər).", now=reference,
                )
                result["failed"] += 1
                continue

            spec = spec_from_json(row.spec_json)
            # Seqment göndərmə anında TƏZƏ hesablanır: `spec` dondurulub, tokenlər yox.
            # Ona görə plan 3 gün sonra göndəriləndə yeni abunəçilər də alır, amma
            # "kimə" qərarı (seqment) adminin təsdiqlədiyi kimi qalır.
            audience = resolve_audience_for_tenant(
                db, row.tenant_id, spec, tiers=_tiers_for(db, row.tenant_id), now=reference
            )
            if not audience.tokens:
                _finish(
                    row, db, status=FAILED,
                    error=(
                        f"Planlanmış seqmentdə çatdırıla bilən abunəçi yoxdur "
                        f"(uyğun müştəri: {audience.matched}, abunəliyi olan: "
                        f"{audience.with_token}, çatdırılmayan: {audience.undeliverable}, "
                        f"razılığı geri götürən: {audience.no_consent})."
                    ),
                    now=reference,
                )
                result["failed"] += 1
                continue

            _, config = send_bulk_push(
                db,
                row.tenant_id,
                tokens=audience.tokens,
                title=row.title or "",
                body=row.body or "",
                kind="broadcast",
                segment=spec["segment"],
                segment_value=audience.label,
                campaign_id=row.campaign_id,
                created_by=row.created_by or "scheduler",
                url=(row.url or None),
            )
            # Jurnal sətri yeni yazıldı — ən yenisi bizimkidir.
            newest = _newest_delivery(db, row.tenant_id)
            row.delivery_id = getattr(newest, "id", None)
            _finish(
                row, db,
                status=(SENT if config.ok else FAILED),
                error=(None if config.ok else (config.reason or "Provayder konfiqurasiyası natamamdır.")),
                now=reference,
            )
            result["sent" if config.ok else "failed"] += 1
        except Exception as exc:
            logger.error("Plan %s göndərilmədi: %s", getattr(row, "id", "?"), str(exc)[:200])
            try:
                _finish(row, db, status=FAILED, error=str(exc)[:300], now=reference)
            except Exception:  # pragma: no cover
                db.rollback()
            result["failed"] += 1

    return result


def _scheduler_loop() -> None:
    """Hər `CHECK_INTERVAL` saniyədə vaxtı çatmış planları yoxlayır."""
    logger.info("Push Scheduler başladı (hər %d saniyə yoxlama)", CHECK_INTERVAL)
    while True:
        try:
            from app.db import SessionLocal

            with SessionLocal() as db:
                result = run_due_schedules(db)
                if result["checked"]:
                    logger.info("Push plan dövrəsi: %s", result)
        except Exception as exc:
            logger.error("Push Scheduler xətası: %s", str(exc)[:300])
        time.sleep(CHECK_INTERVAL)


def start_push_scheduler() -> None:
    """Arxa fon thread-ində planlanmış push scheduler-ini başladır."""
    t = threading.Thread(target=_scheduler_loop, daemon=True, name="push-scheduler")
    t.start()
    logger.info("Push Scheduler background thread başladı.")
