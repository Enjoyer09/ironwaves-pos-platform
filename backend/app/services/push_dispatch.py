"""P1.4 — push göndərmənin DB tərəfi: konfiqurasiya oxunuşu + jurnal.

Niyə `push_service.py`-dən ayrı: o modul **saf**dır (şəbəkə çağırışı istisna),
DB import etmir və `src/lib/push.ts` ilə güzgüdür. Bura isə `Setting`,
`Customer`, `PushDelivery` sətirləri ilə işləyir.

Niyə router-də deyil: üç fərqli çağıran var — `pos.py` (checkout),
`operations.py` (hədiyyə kodu, sifariş statusu) və `birthday_scheduler.py` —
və hər üçü indiyə qədər `pos.py`-dəki qlobal göndəriciyə tərs istiqamətdə
import edirdi.

⚠️ `app.routers.pos.send_push_notification` **qəsdən** aşağı səviyyəli tikiş
kimi saxlanılır: mövcud 9 test onu `monkeypatch` ilə əvəz edir. Ona görə
import həmişə **çağırış anında** (lazy) edilir — modul yüklənmə anında
tutulsa, monkeypatch işləməz.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Iterable, Mapping, Sequence

from sqlalchemy.orm import Session

from app.models import Customer, PushDelivery, Setting, Sale
from app.services.push_audience import PushAudience, normalize_audience_spec, resolve_push_audience
from app.services.push_service import (
    MAX_BROADCAST_RECIPIENTS,
    PushConfig,
    PushResult,
    dedupe_tokens,
    normalize_push_settings,
    resolve_client_app_id,
    resolve_push_config,
    sanitize_push_text,
    send_onesignal,
)

logger = logging.getLogger(__name__)

PUSH_SETTINGS_KEY = "push_settings"
CUSTOMER_APP_SETTINGS_KEY = "customer_app_settings"

#: Seqment hesablaması üçün yaddaşa alınan maksimum müştəri sətri. Süzgəc saf
#: funksiyada (Python tərəfdə) işlədiyi üçün sətirlər oxunur; bu hədd real tenant
#: ölçüsündən (min-onminlərlə müştəri) çox yuxarıdadır və yalnız yaddaş qoruyucusudur.
MAX_AUDIENCE_SCAN = 100_000


def _read_json_setting(db: Session, tenant_id: str, key: str) -> dict[str, Any]:
    """`operations._setting_value(db, tid, key, {})` ilə eyni semantika."""
    try:
        row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    except Exception as exc:  # pragma: no cover - DB problemi push-u dayandırmasın
        logger.warning("[PUSH] ayar oxunmadı (%s): %s", key, exc)
        return {}
    if not row or row.value is None:
        return {}
    try:
        parsed = json.loads(row.value)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def load_push_settings(db: Session, tenant_id: str) -> dict[str, Any]:
    """Normalizasiya olunmuş `push_settings` (REST açarı **açıq** — server tərəf)."""
    return normalize_push_settings(_read_json_setting(db, tenant_id, PUSH_SETTINGS_KEY))


def load_tenant_app_id(db: Session, tenant_id: str) -> str:
    """`customer_app_settings.onesignal_app_id` — brauzer SDK-sının init dəyəri."""
    blob = _read_json_setting(db, tenant_id, CUSTOMER_APP_SETTINGS_KEY)
    return str(blob.get("onesignal_app_id") or "").strip()


def _platform_credentials() -> tuple[str, str]:
    """Platforma env cütü. Import burada olur ki, `app.core.config` testdə lazım olmasın."""
    try:
        from app.core.config import settings as app_settings

        return (
            str(getattr(app_settings, "onesignal_app_id", "") or "").strip(),
            str(getattr(app_settings, "onesignal_rest_api_key", "") or "").strip(),
        )
    except Exception:  # pragma: no cover - konfiqurasiya yoxdursa push sadəcə sönür
        return "", ""


def resolve_tenant_push_config(db: Session, tenant_id: str) -> tuple[PushConfig, dict[str, Any]]:
    """(config, push_settings) — hər ikisi bir oxunuşdan çıxır."""
    push_settings = load_push_settings(db, tenant_id)
    platform_app_id, platform_key = _platform_credentials()
    config = resolve_push_config(
        tenant_app_id=load_tenant_app_id(db, tenant_id),
        tenant_rest_key=push_settings.get("onesignal_rest_api_key"),
        platform_app_id=platform_app_id,
        platform_rest_key=platform_key,
    )
    return config, push_settings


def client_app_id_for_tenant(db: Session, tenant_id: str) -> str:
    """Müştəri sessiyasında qaytarılan app id — göndərici ilə **eyni prioritet**."""
    platform_app_id, _ = _platform_credentials()
    return resolve_client_app_id(load_tenant_app_id(db, tenant_id), platform_app_id)


# ---------------------------------------------------------------------------
# Aşağı səviyyəli tikiş (`pos.send_push_notification`) ilə əlaqə
# ---------------------------------------------------------------------------


def _call_seam(token: str, title: str, body: str, config: PushConfig) -> Any:
    """`pos.send_push_notification`-u çağırır — imzasına uyğunlaşaraq.

    Mövcud testlər tikişi `lambda token, title, body` ilə əvəz edir, ona görə
    `config` yalnız funksiya onu qəbul edirsə göndərilir. `inspect` ilə yoxlanır,
    çünki TypeError-a görə yenidən cəhd etmək real TypeError-u da udardı.
    """
    import inspect

    from app.routers.pos import send_push_notification as seam

    supports_config = False
    try:
        params = inspect.signature(seam).parameters
        supports_config = "config" in params or any(
            p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()
        )
    except (TypeError, ValueError):  # pragma: no cover - built-in/C funksiya
        supports_config = False

    if supports_config:
        return seam(token, title, body, config=config)
    return seam(token, title, body)


def _coerce_result(raw: Any, attempted: int) -> PushResult:
    """Tikiş əvəz olunubsa (test/monkeypatch) nəticəni bilmirik — cəhd sayılır.

    Bu, köhnə davranışı qoruyur: `birthday_scheduler`-in `notified` sayğacı
    monkeypatch altında yenə 1 sayır, amma **real** göndərmədə artıq provayderin
    cavabı işlədilir.
    """
    if isinstance(raw, PushResult):
        return raw
    return PushResult(status="sent", attempted=attempted, accepted=attempted)


# ---------------------------------------------------------------------------
# Jurnal
# ---------------------------------------------------------------------------


def record_delivery(
    db: Session,
    tenant_id: str,
    result: PushResult,
    *,
    kind: str = "event",
    event: str | None = None,
    title: str = "",
    body: str = "",
    card_id: str | None = None,
    segment: str | None = None,
    segment_value: str | None = None,
    created_by: str | None = None,
    config: PushConfig | None = None,
    commit: bool = False,
) -> PushDelivery | None:
    """`push_deliveries` sətri yazır. Jurnal xətası göndərməni pozmur.

    `commit=False` (default) — çağıran onsuz da `db.commit()` edir (checkout,
    sifariş statusu, hədiyyə kodu, ad günü skanı hamısı elə edir). Sətir orada
    birlikdə yazılır, yəni push jurnalı üçün ayrıca tranzaksiya açılmır.
    """
    try:
        row = PushDelivery(
            tenant_id=tenant_id,
            kind=str(kind or "event")[:16],
            event=(str(event)[:40] if event else None),
            title=(str(title)[:160] if title else None),
            body=(str(body)[:2000] if body else None),
            segment=(str(segment)[:40] if segment else None),
            segment_value=(str(segment_value)[:80] if segment_value else None),
            card_id=(str(card_id)[:80] if card_id else None),
            status=str(result.status or "skipped")[:16],
            config_source=str((config.source if config else "none") or "none")[:16],
            recipients=int(result.attempted or 0),
            accepted=int(result.accepted or 0),
            failed=int(result.failed or 0),
            provider_id=((result.provider_ids or [None])[0] or None),
            error=((result.error or "")[:2000] or None),
            details=json.dumps(result.as_log_dict(), ensure_ascii=False)[:4000],
            created_by=(str(created_by)[:80] if created_by else None),
        )
        db.add(row)
        if commit:
            db.commit()
        return row
    except Exception as exc:  # pragma: no cover - jurnal ikinci dərəcəlidir
        logger.warning("[PUSH] jurnal yazılmadı: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Hadisə push-u (checkout, hədiyyə kodu, sifariş statusu, ad günü)
# ---------------------------------------------------------------------------


def send_event_push(
    db: Session,
    tenant_id: str,
    *,
    event: str,
    title: str,
    body: str,
    card_id: str | None = None,
    customer: Customer | None = None,
    token: str | None = None,
    data: Mapping[str, Any] | None = None,
    commit: bool = False,
) -> PushResult:
    """Bir müştəriyə hadisə push-u. **Heç vaxt exception atmır.**

    Jurnal yalnız real cəhd olanda yazılır (abunəlik id-si var). Abunə olmayan
    müştərinin hər çeki üçün sətir yaratmaq cədvəli mənasız şişirdərdi.
    """
    try:
        config, push_settings = resolve_tenant_push_config(db, tenant_id)

        if not bool(push_settings.get("enabled", True)):
            return PushResult(status="skipped", error="Push bildirişləri söndürülüb.")
        if not bool(push_settings.get("event_push_enabled", True)):
            return PushResult(status="skipped", error="Hadisə push-ları söndürülüb.")

        target = customer
        if target is None and card_id:
            target = (
                db.query(Customer)
                .filter(Customer.tenant_id == tenant_id, Customer.card_id == card_id)
                .first()
            )
        push_token = str(token or (target.push_token if target else "") or "").strip()
        if not push_token:
            return PushResult(status="skipped", error="Müştəridə abunəlik id-si yoxdur.")

        clean_title, clean_body = sanitize_push_text(title, body)
        # Konfiqurasiya natamam olsa da tikişdən keçilir: qərarı `send_onesignal`
        # verir (`skipped` + səbəb). Burada qabaqcadan kəsmək tikişi əvəz edən
        # testləri və gələcək alternativ provayderi kənarda qoyardı.
        try:
            result = _coerce_result(_call_seam(push_token, clean_title, clean_body, config), 1)
        except Exception as exc:
            result = PushResult(status="failed", attempted=1, failed=1, error=f"göndərmə xətası: {exc}"[:500])

        record_delivery(
            db,
            tenant_id,
            result,
            kind="event",
            event=event,
            title=clean_title,
            body=clean_body,
            card_id=(card_id or (target.card_id if target else None)),
            config=config,
            commit=commit,
        )
        return result
    except Exception as exc:  # pragma: no cover - push heç bir axını dayandırmır
        logger.warning("[PUSH] hadisə push-u alınmadı (%s): %s", event, exc)
        return PushResult(status="failed", error=str(exc)[:300])


# ---------------------------------------------------------------------------
# Kütləvi göndərmə (paneldən: test və broadcast)
# ---------------------------------------------------------------------------


def send_bulk_push(
    db: Session,
    tenant_id: str,
    *,
    tokens: Sequence[str] | Iterable[str],
    title: str,
    body: str,
    kind: str = "broadcast",
    segment: str | None = None,
    segment_value: str | None = None,
    created_by: str | None = None,
    url: str | None = None,
    commit: bool = True,
) -> tuple[PushResult, PushConfig]:
    """Çoxlu abunəliyə göndərir və jurnala yazır.

    Tikişdən (`pos.send_push_notification`) yox, birbaşa `send_onesignal`-dan
    keçir: batch-ləmə və provayder cavabının hesabı burada lazımdır.
    """
    config, push_settings = resolve_tenant_push_config(db, tenant_id)
    recipients = dedupe_tokens(list(tokens or ()))[:MAX_BROADCAST_RECIPIENTS]
    clean_title, clean_body = sanitize_push_text(title, body)

    if not bool(push_settings.get("enabled", True)):
        result = PushResult(status="skipped", attempted=len(recipients), error="Push bildirişləri söndürülüb.")
    elif kind == "broadcast" and not bool(push_settings.get("broadcast_enabled", False)):
        result = PushResult(
            status="skipped",
            attempted=len(recipients),
            error="Kütləvi bildiriş söndürülüb (Ayarlar → Bildirişlər).",
        )
    else:
        result = send_onesignal(config, recipients, clean_title, clean_body, url=url)

    record_delivery(
        db,
        tenant_id,
        result,
        kind=kind,
        event="manual",
        title=clean_title,
        body=clean_body,
        segment=segment,
        segment_value=segment_value,
        created_by=created_by,
        config=config,
        commit=commit,
    )
    return result, config


# ---------------------------------------------------------------------------
# Seqment (audience) — DB sorğusu. Süzgəc `push_audience.py`-dədir.
# ---------------------------------------------------------------------------


def _void_sale_statuses() -> list[str]:
    """Ləğv edilmiş satış statusları — maliyyə modulundakı **eyni** siyahı.

    Lazy import: `finance_service` `fastapi.HTTPException` gətirir, bu modul isə
    `fastapi`-siz qalmalıdır (testlər onu birbaşa import edir). Siyahı əlçatan
    deyilsə minimal dəst işlədilir — "son aktivlik" hesabı üçün bu, ləğv edilmiş
    çeki aktivlik saymaq riskini kiçildir.
    """
    try:
        from app.services.finance_service import VOID_SALE_STATUSES

        return [str(s).upper() for s in VOID_SALE_STATUSES]
    except Exception:  # pragma: no cover - modul qrafiki dəyişsə
        return ["VOIDED", "VOID", "CANCELLED", "CANCELED"]


def load_audience_rows(db: Session, tenant_id: str, *, limit: int = MAX_AUDIENCE_SCAN) -> list[dict[str, Any]]:
    """Seqment üçün müştəri sətirləri: balans, qeydiyyat və **son satış** tarixi.

    `Customer`-də `last_visit` sütunu yoxdur, ona görə son aktivlik `sales`
    üzərində qruplanmış alt-sorğu ilə hesablanır (ləğv edilmiş çeklər çıxılır).
    Ləğv olunmuş satışı aktivlik saymaq "yatmış müştəri" seqmentini yanlış
    daraldardı.

    `push_token`-suz müştərilər də qaytarılır: panel "uyğun müştəri" və "abunəçi"
    saylarını ayrı göstərir, yəni süzgəc mərhələsində itki görünməlidir.
    """
    from sqlalchemy import func

    try:
        void_statuses = _void_sale_statuses()
        last_sale = (
            db.query(
                Sale.customer_card_id.label("card_id"),
                func.max(Sale.created_at).label("last_sale_at"),
            )
            .filter(
                Sale.tenant_id == tenant_id,
                Sale.customer_card_id.isnot(None),
                ~func.upper(func.trim(func.coalesce(Sale.status, ""))).in_(void_statuses),
            )
            .group_by(Sale.customer_card_id)
            .subquery()
        )
        rows = (
            db.query(
                Customer.card_id,
                Customer.push_token,
                Customer.created_at,
                Customer.stars,
                Customer.lifetime_stars,
                last_sale.c.last_sale_at,
            )
            .outerjoin(last_sale, last_sale.c.card_id == Customer.card_id)
            .filter(Customer.tenant_id == tenant_id)
            .limit(max(1, int(limit or MAX_AUDIENCE_SCAN)))
            .all()
        )
    except Exception as exc:  # pragma: no cover - sorğu problemi göndərməni dayandırmır
        logger.warning("[PUSH] audience sorğusu alınmadı: %s", exc)
        return []

    return [
        {
            "card_id": row[0],
            "push_token": row[1],
            "created_at": row[2],
            "stars": row[3],
            "lifetime_stars": row[4],
            "last_sale_at": row[5],
        }
        for row in rows
    ]


def resolve_audience_for_tenant(
    db: Session,
    tenant_id: str,
    spec: Mapping[str, Any] | None,
    *,
    tiers: Sequence[Mapping[str, Any]] | None = None,
    now=None,
) -> PushAudience:
    """Ön baxış və göndərmə **eyni** funksiyadan keçir.

    Bu, P0.4 dürüstlük qaydasıdır: panel "412 alıcı" yazıb 30 nəfərə göndərməsin.
    `POST /push/preview` və `POST /push/broadcast` ikisi də bunu çağırır.
    """
    return resolve_push_audience(
        load_audience_rows(db, tenant_id),
        normalize_audience_spec(spec),
        now=now,
        tiers=tiers,
    )


def count_broadcasts_today(db: Session, tenant_id: str, *, now=None) -> int:
    """Bu gün paneldən göndərilmiş broadcast sayı (gündəlik hədd üçün).

    `skipped` sətirlər sayılmır — söndürülmüş ayar ucbatından baş tutmayan cəhd
    həddi yeməməlidir.
    """
    from datetime import datetime, timedelta

    reference = now or datetime.utcnow()
    day_start = reference.replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        return int(
            db.query(PushDelivery)
            .filter(
                PushDelivery.tenant_id == tenant_id,
                PushDelivery.kind == "broadcast",
                PushDelivery.created_at >= day_start,
                PushDelivery.created_at < day_start + timedelta(days=1),
                PushDelivery.status.in_(("sent", "partial", "failed")),
            )
            .count()
        )
    except Exception as exc:  # pragma: no cover - cədvəl hələ yoxdursa
        logger.warning("[PUSH] gündəlik say oxunmadı: %s", exc)
        return 0
