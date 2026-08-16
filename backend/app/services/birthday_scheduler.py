"""
Per-tenant doğum günü reward scheduler (P1-2).

Hər tenant öz vaxt qurşağında (default: Asia/Baku) "bugün" tarixini hesablayır.
Müştərinin doğum günü bugünə düşərsə:
  - stars  + bonus
  - lifetime_stars + bonus  (tier irəliləyişinə təsir edir)
  - LoyaltyLedgerEntry(unit='birthday', entry_type='earn') — il-əsaslı idempotency
  - in-app Notification + FCM push

İdempotency iki qatlıdır:
  1. Gündəlik guard marker (Setting 'birthday_scheduler_last_run') — process
     restart-a davamlı, gündə yalnız 1 dəfə skan.
  2. İl-əsaslı ledger yoxlaması — eyni il üçün artıq 'Birthday bonus {year}'
     sətri varsa grant təkrarlanmır (multi-worker qorunması).

Default olaraq qapalıdır: tenant `customer_app_settings.birthday_enabled`
açmadan heç bir müştəriyə grant verilmir.
"""

import json
import logging
import threading
import time
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import SessionLocal
from app.models import Customer, LoyaltyLedgerEntry, Notification, Setting, Tenant

logger = logging.getLogger("ironwaves.birthday_scheduler")

# Bakı vaxt zonası: UTC+4 (ZoneInfo fallback)
BAKU_TZ_NAME = "Asia/Baku"
BAKU_UTC_OFFSET = timedelta(hours=4)

SCHEDULER_CHECK_INTERVAL = 1800  # hər 30 dəqiqə yoxla (saniyə)
DEFAULT_BIRTHDAY_BONUS = 5  # default bonus ulduz sayı
GUARD_SETTING_KEY = "birthday_scheduler_last_run"

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None


# ──────────────────────────────────────────
# Vaxt qurşağı köməkçiləri
# ──────────────────────────────────────────

def _baku_today() -> date:
    """Bakı vaxt qurşağında cari tarix (scheduler guard marker üçün)."""
    if ZoneInfo:
        try:
            return datetime.now(ZoneInfo(BAKU_TZ_NAME)).date()
        except Exception:
            pass
    return (datetime.utcnow() + BAKU_UTC_OFFSET).date()


def _tenant_today(db: Session, tenant: Tenant) -> date:
    """
    Tenant-ın vaxt qurşağında cari tarix.

    `time_settings.timezone` (default: Asia/Baku) istifadə olunur; ZoneInfo
    mövcud deyilsə və ya qurşaq tanınmırsa UTC+4 fallback.
    """
    tz_name = BAKU_TZ_NAME
    row = (
        db.query(Setting)
        .filter(Setting.tenant_id == tenant.id, Setting.key == "time_settings")
        .first()
    )
    if row and row.value:
        try:
            parsed = json.loads(row.value)
            candidate = (parsed or {}).get("timezone")
            if isinstance(candidate, str) and candidate.strip():
                tz_name = candidate.strip()
        except (json.JSONDecodeError, TypeError):
            pass
    if ZoneInfo:
        try:
            return datetime.now(ZoneInfo(tz_name)).date()
        except Exception:
            pass
    return (datetime.utcnow() + BAKU_UTC_OFFSET).date()


# ──────────────────────────────────────────
# Guard marker (gündəlik)
# ──────────────────────────────────────────

def _get_guard_date(db: Session, tenant_id: str) -> str | None:
    row = (
        db.query(Setting)
        .filter(Setting.tenant_id == tenant_id, Setting.key == GUARD_SETTING_KEY)
        .first()
    )
    return str(row.value or "").strip() if row and row.value else None


def _set_guard_date(db: Session, tenant_id: str, value: str) -> None:
    import uuid
    row = (
        db.query(Setting)
        .filter(Setting.tenant_id == tenant_id, Setting.key == GUARD_SETTING_KEY)
        .first()
    )
    if not row:
        row = Setting(id=str(uuid.uuid4()), tenant_id=tenant_id, key=GUARD_SETTING_KEY)
        db.add(row)
    row.value = value
    row.updated_at = datetime.utcnow()


# ──────────────────────────────────────────
# Push + bildiriş
# ──────────────────────────────────────────

def _send_customer_push(customer: Customer, title: str, body: str) -> bool:
    """Müştəriyə FCM push göndərir. Push token yoxdursa səssiz keçilir."""
    if not customer or not customer.push_token:
        return False
    try:
        from app.routers.pos import send_push_notification
        send_push_notification(customer.push_token, title, body)
        return True
    except Exception as pe:
        logger.warning("Birthday push xətası (müştəri %s): %s", customer.card_id, str(pe)[:150])
        return False


def _grant_birthday(
    db: Session,
    tenant: Tenant,
    customer: Customer,
    *,
    today: date,
    bonus: int,
) -> bool:
    """
    Tək müştəriyə doğum günü grant-ı verir.

    İl-əsaslı idempotency: bu il üçün 'Birthday bonus {year}' ledger sətri
    artıq varsa heç nə etmir. Uğurlu olarsa True qaytarır.
    """
    year = today.year
    existing = (
        db.query(LoyaltyLedgerEntry)
        .filter(
            LoyaltyLedgerEntry.tenant_id == tenant.id,
            LoyaltyLedgerEntry.card_id == customer.card_id,
            LoyaltyLedgerEntry.unit == "birthday",
            LoyaltyLedgerEntry.entry_type == "earn",
            LoyaltyLedgerEntry.description == f"Birthday bonus {year}",
        )
        .first()
    )
    if existing:
        return False

    customer.stars = int(customer.stars or 0) + bonus
    customer.lifetime_stars = int(customer.lifetime_stars or 0) + bonus
    db.add(
        LoyaltyLedgerEntry(
            tenant_id=tenant.id,
            card_id=customer.card_id,
            unit="birthday",
            entry_type="earn",
            amount=Decimal(bonus),
            description=f"Birthday bonus {year}",
        )
    )
    db.add(
        Notification(
            tenant_id=tenant.id,
            card_id=customer.card_id,
            message=f"Doğum gününüz mübarək! 🎂 +{bonus} ★ hesabınıza əlavə edildi",
        )
    )
    return True


# ──────────────────────────────────────────
# Skan (əsas məntiq — test edilə bilər)
# ──────────────────────────────────────────

def run_birthday_scan(db: Session, today: date | None = None) -> dict[str, Any]:
    """
    Bütün aktiv tenant-lar üzrə doğum günü skanı.

    `today` verilməzsə hər tenant üçün öz vaxt qurşağında cari tarix
    hesablanır. Test-lər `today`-ni sabitləyərək zamandan asılılığı kəsə bilər.

    Qaytarma: {scanned_tenants, granted, notified, skipped}
    """
    granted = 0
    notified = 0
    skipped = 0
    scanned_tenants = 0

    tenants = db.query(Tenant).filter(Tenant.status == "active").all()
    for tenant in tenants:
        scanned_tenants += 1
        try:
            tenant_today = today or _tenant_today(db, tenant)
            app_settings_row = (
                db.query(Setting)
                .filter(Setting.tenant_id == tenant.id, Setting.key == "customer_app_settings")
                .first()
            )
            app_settings: dict = {}
            if app_settings_row and app_settings_row.value:
                try:
                    app_settings = json.loads(app_settings_row.value) or {}
                except (json.JSONDecodeError, TypeError):
                    app_settings = {}
            if not isinstance(app_settings, dict):
                app_settings = {}

            if not bool(app_settings.get("birthday_enabled", False)):
                continue
            try:
                bonus = max(1, int(app_settings.get("birthday_bonus_stars") or DEFAULT_BIRTHDAY_BONUS))
            except (ValueError, TypeError):
                bonus = DEFAULT_BIRTHDAY_BONUS

            today_md = tenant_today.strftime("%m-%d")
            customers = (
                db.query(Customer)
                .filter(Customer.tenant_id == tenant.id, Customer.birth_date.isnot(None))
                .all()
            )
            for customer in customers:
                try:
                    if not customer.birth_date or customer.birth_date.strftime("%m-%d") != today_md:
                        continue
                    if _grant_birthday(db, tenant, customer, today=tenant_today, bonus=bonus):
                        granted += 1
                        if _send_customer_push(
                            customer,
                            "Doğum gününüz mübarək! 🎂",
                            f"+{bonus} ★ hesabınıza əlavə edildi",
                        ):
                            notified += 1
                    else:
                        skipped += 1
                except Exception as cust_err:
                    logger.warning(
                        "Tenant %s müştəri %s birthday xətası: %s",
                        tenant.id, customer.card_id, str(cust_err)[:150],
                    )
            db.commit()
        except Exception as tenant_err:
            logger.error("Tenant %s birthday skan xətası: %s", tenant.id, str(tenant_err)[:200])

    return {
        "scanned_tenants": scanned_tenants,
        "granted": granted,
        "notified": notified,
        "skipped": skipped,
    }


# ──────────────────────────────────────────
# Scheduler loop
# ──────────────────────────────────────────

def _scheduler_loop():
    """Hər 30 dəqiqə oyanır, gündə yalnız 1 dəfə skan işlədir (guard marker)."""
    logger.info("Birthday Scheduler başladı (hər %d saniyə yoxlama, gündə 1 dəfə skan)", SCHEDULER_CHECK_INTERVAL)
    while True:
        try:
            with SessionLocal() as db:
                super_tenant = (
                    db.query(Tenant)
                    .filter(Tenant.slug == settings.platform_tenant_slug)
                    .first()
                )
                if not super_tenant:
                    logger.warning("Birthday scheduler: super tenant tapılmadı, skan atlanır.")
                    time.sleep(SCHEDULER_CHECK_INTERVAL)
                    continue

                today_str = _baku_today().isoformat()
                last_run = _get_guard_date(db, super_tenant.id)
                if last_run == today_str:
                    logger.info("Birthday skan bu gün artıq icra olunub (%s).", last_run)
                    time.sleep(SCHEDULER_CHECK_INTERVAL)
                    continue

                result = run_birthday_scan(db)
                _set_guard_date(db, super_tenant.id, today_str)
                db.commit()
                logger.info(
                    "Birthday skan tamamlandı: %s",
                    {k: v for k, v in result.items()},
                )
        except Exception as e:
            logger.error("Birthday scheduler xətası: %s", str(e)[:300])
        time.sleep(SCHEDULER_CHECK_INTERVAL)


def start_birthday_scheduler():
    """Background thread-də doğum günü scheduler-i başladır."""
    t = threading.Thread(target=_scheduler_loop, daemon=True, name="birthday-scheduler")
    t.start()
    logger.info("Birthday Scheduler background thread başladı.")
