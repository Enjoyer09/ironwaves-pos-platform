"""
Per-tenant avtomatik backup scheduler.

Hər tenant öz backup saatını seçə bilər (default: 03:00 Bakı).
Backup hədəfi: webhook URL və/və ya lokal disk.
Scheduler hər saat yoxlama edir, vaxtı gələn tenant-ları backup edir.
"""

import gzip
import hashlib
import hmac
import json
import logging
import os
import threading
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import (
    AgentInsight,
    AuditLog,
    BusinessProfile,
    Check,
    Customer,
    CustomerConsent,
    DonerBatch,
    FeedbackCoupon,
    FeedbackEntry,
    FinanceAccount,
    FinanceEntry,
    FinanceLedgerEntry,
    FinanceReconciliation,
    FinanceTransaction,
    FloorPlan,
    Guest,
    HappyHour,
    InventoryItem,
    ItemStatusLog,
    KitchenOrder,
    LoyaltyLedgerEntry,
    MenuItem,
    Notification,
    OrderItem,
    OrderRound,
    Payment,
    Recipe,
    Reservation,
    RewardClaim,
    Sale,
    Setting,
    Shift,
    ShiftHandover,
    StaffNotification,
    Table,
    TableSession,
    Tenant,
    User,
    WasteLog,
)
from app.json_utils import safe_json_list

logger = logging.getLogger("ironwaves.backup_scheduler")

# Bakı vaxt zonası: UTC+4
BAKU_UTC_OFFSET = timezone(timedelta(hours=4))
DEFAULT_BACKUP_HOUR = 3  # Default: gecə saat 03:00
SCHEDULER_CHECK_INTERVAL = 3600  # Hər saat yoxla (saniyə)
BACKUP_DIR = Path("/app/backups")  # Server-dəki backup qovluğu
MAX_LOCAL_BACKUPS = 7  # Hər tenant üçün max saxlanacaq backup sayı


# ──────────────────────────────────────────
# Serialization helpers (mirror of operations.py)
# ──────────────────────────────────────────

def _serialize_value(val: Any) -> Any:
    """Təkli dəyəri JSON-uyğun formata çevirir."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, (int, float, bool, str)):
        return val
    return str(val)


def _serialize_row(row, fields: list[str] | None = None) -> dict:
    """SQLAlchemy model sətirini dict-ə çevirir."""
    keys = fields or [c.name for c in row.__table__.columns]
    return {k: _serialize_value(getattr(row, k, None)) for k in keys}


def _all_cols(model, *, exclude: set[str] | None = None) -> list[str]:
    """Model-in bütün sütun adlarını qaytarır, exclude-dakıları çıxarır."""
    ex = exclude or set()
    return [c.name for c in model.__table__.columns if c.name not in ex]


# ──────────────────────────────────────────
# Per-tenant backup builder
# ──────────────────────────────────────────

def _build_tenant_backup(db: Session, tenant: Tenant) -> dict:
    """Bir tenant üçün tam JSON backup yaradır."""
    tid = tenant.id

    def _q(model):
        return db.query(model).filter(model.tenant_id == tid).all()

    # Settings bundle
    settings_rows = _q(Setting)
    settings_bundle = {}
    for s in settings_rows:
        try:
            settings_bundle[s.key] = json.loads(s.value) if s.value else None
        except (json.JSONDecodeError, TypeError):
            settings_bundle[s.key] = s.value

    return {
        "_backup_version": "2.0",
        "_backup_timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "_tenant_id": tid,
        "_tenant_slug": tenant.slug,
        "_tenant_name": tenant.name,
        # ── İstifadəçilər (həssas data olmadan) ──
        "users": [
            _serialize_row(r, ["id", "tenant_id", "username", "email", "role", "is_active", "created_at"])
            for r in _q(User)
        ],
        # ── Menyu ──
        "menu_items": [
            _serialize_row(r, _all_cols(MenuItem))
            for r in _q(MenuItem)
        ],
        # ── Satışlar ──
        "sales": [
            {**_serialize_row(r, [c for c in _all_cols(Sale) if c != "items_json"]),
             "items": safe_json_list(r.items_json)}
            for r in _q(Sale)
        ],
        # ── Maliyyə (legacy) ──
        "finance": [
            _serialize_row(r, _all_cols(FinanceEntry))
            for r in _q(FinanceEntry)
        ],
        # ── Masalar ──
        "tables": [
            _serialize_row(r, _all_cols(Table))
            for r in _q(Table)
        ],
        # ── Mətbəx sifarişləri ──
        "kitchen_orders": [
            {**_serialize_row(r, [c for c in _all_cols(KitchenOrder) if c != "items_json"]),
             "items": safe_json_list(r.items_json)}
            for r in _q(KitchenOrder)
        ],
        # ── Anbar ──
        "inventory": [
            _serialize_row(r, _all_cols(InventoryItem))
            for r in _q(InventoryItem)
        ],
        # ── Müştərilər ──
        "customers": [
            _serialize_row(r, _all_cols(Customer))
            for r in _q(Customer)
        ],
        "customer_consents": [
            _serialize_row(r, _all_cols(CustomerConsent))
            for r in _q(CustomerConsent)
        ],
        # ── Reseptlər ──
        "recipes": [
            _serialize_row(r, _all_cols(Recipe))
            for r in _q(Recipe)
        ],
        # ── Happy hours ──
        "happy_hours": [
            _serialize_row(r, _all_cols(HappyHour))
            for r in _q(HappyHour)
        ],
        # ── Növbə təhvil-təslimi ──
        "shift_handovers": [
            _serialize_row(r, _all_cols(ShiftHandover))
            for r in _q(ShiftHandover)
        ],
        # ── Parametrlər ──
        "settings": settings_bundle,
        # ── Bildirişlər ──
        "notifications": [
            _serialize_row(r, _all_cols(Notification))
            for r in _q(Notification)
        ],
        # ── Biznes profili ──
        "business_profile": [
            _serialize_row(r, _all_cols(BusinessProfile))
            for r in _q(BusinessProfile)
        ],
        # ── Audit logları ──
        "logs": [
            _serialize_row(r, _all_cols(AuditLog))
            for r in _q(AuditLog)
        ],
        # ═══════════════════════════════════════
        # ── Yeni əlavə olunan cədvəllər (v2.0) ──
        # ═══════════════════════════════════════
        "shifts": [
            {**_serialize_row(r, _all_cols(Shift, exclude={"z_report_html"})),
             "z_report_html_length": len(r.z_report_html or "")}
            for r in _q(Shift)
        ],
        "floor_plans": [
            _serialize_row(r, _all_cols(FloorPlan))
            for r in _q(FloorPlan)
        ],
        "guests": [
            _serialize_row(r, _all_cols(Guest))
            for r in _q(Guest)
        ],
        "reservations": [
            _serialize_row(r, _all_cols(Reservation))
            for r in _q(Reservation)
        ],
        "table_sessions": [
            _serialize_row(r, _all_cols(TableSession))
            for r in _q(TableSession)
        ],
        "checks": [
            _serialize_row(r, _all_cols(Check))
            for r in _q(Check)
        ],
        "order_rounds": [
            _serialize_row(r, _all_cols(OrderRound))
            for r in _q(OrderRound)
        ],
        "order_items": [
            {**_serialize_row(r, [c for c in _all_cols(OrderItem) if c != "modifier_json"]),
             "modifiers": safe_json_list(r.modifier_json)}
            for r in _q(OrderItem)
        ],
        "item_status_logs": [
            _serialize_row(r, _all_cols(ItemStatusLog))
            for r in _q(ItemStatusLog)
        ],
        "payments": [
            _serialize_row(r, _all_cols(Payment))
            for r in _q(Payment)
        ],
        "finance_accounts": [
            _serialize_row(r, _all_cols(FinanceAccount))
            for r in _q(FinanceAccount)
        ],
        "finance_transactions": [
            _serialize_row(r, _all_cols(FinanceTransaction))
            for r in _q(FinanceTransaction)
        ],
        "finance_ledger_entries": [
            _serialize_row(r, _all_cols(FinanceLedgerEntry))
            for r in _q(FinanceLedgerEntry)
        ],
        "finance_reconciliations": [
            _serialize_row(r, _all_cols(FinanceReconciliation))
            for r in _q(FinanceReconciliation)
        ],
        "reward_claims": [
            _serialize_row(r, _all_cols(RewardClaim))
            for r in _q(RewardClaim)
        ],
        "feedback_entries": [
            _serialize_row(r, _all_cols(FeedbackEntry))
            for r in _q(FeedbackEntry)
        ],
        "feedback_coupons": [
            _serialize_row(r, _all_cols(FeedbackCoupon))
            for r in _q(FeedbackCoupon)
        ],
        "loyalty_ledger": [
            _serialize_row(r, _all_cols(LoyaltyLedgerEntry))
            for r in _q(LoyaltyLedgerEntry)
        ],
        "staff_notifications": [
            _serialize_row(r, _all_cols(StaffNotification))
            for r in _q(StaffNotification)
        ],
        "doner_batches": [
            _serialize_row(r, _all_cols(DonerBatch))
            for r in _q(DonerBatch)
        ],
        "waste_logs": [
            _serialize_row(r, _all_cols(WasteLog))
            for r in _q(WasteLog)
        ],
        "agent_insights": [
            _serialize_row(r, _all_cols(AgentInsight))
            for r in _q(AgentInsight)
        ],
    }


# ──────────────────────────────────────────
# Webhook göndərmə
# ──────────────────────────────────────────

def _sign_payload(payload_bytes: bytes, secret: str) -> str:
    """HMAC-SHA256 imza yaradır."""
    return hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()


def _send_webhook(url: str, payload_bytes: bytes, tenant_slug: str,
                   secret: str | None = None) -> tuple[bool, str]:
    """
    Backup JSON-u tenant-ın webhook URL-unə POST edir.
    Gzip sıxışdırma ilə göndərir.
    """
    compressed = gzip.compress(payload_bytes, compresslevel=6)

    headers = {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "X-Backup-Tenant": tenant_slug,
        "X-Backup-Timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "X-Backup-Size-Original": str(len(payload_bytes)),
        "X-Backup-Size-Compressed": str(len(compressed)),
    }

    if secret:
        sig = _sign_payload(payload_bytes, secret)
        headers["X-Backup-Signature"] = f"sha256={sig}"

    req = urllib.request.Request(
        url,
        data=compressed,
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            status = resp.getcode()
            if 200 <= status < 300:
                return True, f"HTTP {status}"
            return False, f"HTTP {status}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {str(e.reason)[:200]}"
    except urllib.error.URLError as e:
        return False, f"Bağlantı xətası: {str(e.reason)[:200]}"
    except Exception as e:
        return False, f"Xəta: {str(e)[:200]}"


# ──────────────────────────────────────────
# Lokal diskə yazma
# ──────────────────────────────────────────

def _save_to_disk(payload_bytes: bytes, tenant_slug: str,
                   local_path: str | None = None) -> tuple[bool, str]:
    """
    Backup JSON-u lokal diskə yazır.
    local_path verilməsə, default BACKUP_DIR istifadə olunur.
    Köhnə backuplar MAX_LOCAL_BACKUPS-dan çox olarsa silinir.
    """
    try:
        base_dir = Path(local_path) if local_path else BACKUP_DIR / tenant_slug
        base_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now(tz=BAKU_UTC_OFFSET).strftime("%Y%m%d_%H%M%S")
        filename = f"{tenant_slug}_backup_{timestamp}.json.gz"
        filepath = base_dir / filename

        # Gzip ilə yaz
        with open(filepath, "wb") as f:
            f.write(gzip.compress(payload_bytes, compresslevel=6))

        file_size = filepath.stat().st_size
        logger.info("Tenant %s: diskə yazıldı → %s (%d bytes)",
                     tenant_slug, filepath, file_size)

        # Köhnə backupları təmizlə
        _cleanup_old_backups(base_dir, tenant_slug)

        return True, f"Diskə yazıldı: {filepath} ({file_size} bytes)"
    except Exception as e:
        return False, f"Diskə yazma xətası: {str(e)[:200]}"


def _cleanup_old_backups(backup_dir: Path, tenant_slug: str):
    """MAX_LOCAL_BACKUPS-dan çox backup varsa köhnələri silir."""
    try:
        files = sorted(
            [f for f in backup_dir.glob(f"{tenant_slug}_backup_*.json.gz")],
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        for old_file in files[MAX_LOCAL_BACKUPS:]:
            old_file.unlink()
            logger.info("Köhnə backup silindi: %s", old_file)
    except Exception as e:
        logger.warning("Köhnə backup təmizləmə xətası: %s", str(e)[:100])


# ──────────────────────────────────────────
# Audit log
# ──────────────────────────────────────────

def _log_backup_result(db: Session, tenant_id: str, success: bool,
                        detail: str, backup_size: int = 0):
    """Backup nəticəsini audit_logs-a yazır."""
    import uuid
    log = AuditLog(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        user="system:backup_scheduler",
        action="auto_backup_webhook" if success else "auto_backup_webhook_failed",
        details=json.dumps({
            "success": success,
            "detail": detail,
            "backup_size_bytes": backup_size,
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        }, ensure_ascii=False),
        created_at=datetime.utcnow(),
    )
    db.add(log)
    db.commit()


# ──────────────────────────────────────────
# Scheduler loop
# ──────────────────────────────────────────

def _get_tenant_backup_settings(db: Session, tenant_id: str) -> dict:
    """Tenant-ın backup parametrlərini oxuyur."""
    keys = [
        "backup_enabled", "backup_webhook_url", "backup_webhook_secret",
        "backup_hour", "backup_target", "backup_local_path",
    ]
    rows = (
        db.query(Setting)
        .filter(Setting.tenant_id == tenant_id)
        .filter(Setting.key.in_(keys))
        .all()
    )
    result = {}
    for r in rows:
        val = r.value
        if r.key == "backup_enabled":
            val = str(val or "").strip().lower() in ("true", "1", "yes")
        elif r.key == "backup_hour":
            try:
                val = int(val)
                if not (0 <= val <= 23):
                    val = DEFAULT_BACKUP_HOUR
            except (ValueError, TypeError):
                val = DEFAULT_BACKUP_HOUR
        result[r.key] = val
    return result


def _process_single_tenant(tenant: Tenant, current_hour_baku: int):
    """
    Bir tenant üçün backup yaradıb webhook-a və/və ya diskə yazır.
    Yalnız tenant-ın seçdiyi saat gəldikdə işləyir.
    """
    tenant_id = tenant.id
    tenant_slug = tenant.slug

    try:
        with SessionLocal() as db:
            cfg = _get_tenant_backup_settings(db, tenant_id)

        if not cfg.get("backup_enabled", False):
            return

        # Saat yoxlaması — tenant-ın seçdiyi saat indi gəlib?
        tenant_hour = cfg.get("backup_hour", DEFAULT_BACKUP_HOUR)
        if current_hour_baku != tenant_hour:
            return

        # Backup hədəfi: "webhook", "disk", "both" (default: webhook)
        backup_target = str(cfg.get("backup_target") or "webhook").strip().lower()
        webhook_url = str(cfg.get("backup_webhook_url") or "").strip()
        webhook_secret = str(cfg.get("backup_webhook_secret") or "").strip() or None
        local_path = str(cfg.get("backup_local_path") or "").strip() or None

        # Heç bir hədəf yoxdursa ötür
        has_webhook = backup_target in ("webhook", "both") and webhook_url
        has_disk = backup_target in ("disk", "both")
        if not has_webhook and not has_disk:
            logger.info("Tenant %s: backup aktiv amma hədəf təyin olunmayıb, ötürülür", tenant_slug)
            return

        # Backup yaratmaq
        logger.info("Tenant %s: backup yaradılır (hədəf: %s)...", tenant_slug, backup_target)
        with SessionLocal() as db:
            backup_data = _build_tenant_backup(db, tenant)

        payload_bytes = json.dumps(backup_data, ensure_ascii=False, default=str).encode("utf-8")
        payload_size = len(payload_bytes)
        results = []

        # ── Diskə yazma ──
        if has_disk:
            ok, msg = _save_to_disk(payload_bytes, tenant_slug, local_path)
            results.append(f"Disk: {'✅' if ok else '❌'} {msg}")

        # ── Webhook göndərmə ──
        if has_webhook:
            ok, msg = _send_webhook(webhook_url, payload_bytes, tenant_slug, webhook_secret)
            results.append(f"Webhook: {'✅' if ok else '❌'} {msg}")

        detail = " | ".join(results)
        success = "❌" not in detail

        # Audit log
        with SessionLocal() as db:
            _log_backup_result(db, tenant_id, success, detail, payload_size)

        if success:
            logger.info("Tenant %s: backup tamamlandı ✅ — %s", tenant_slug, detail)
        else:
            logger.warning("Tenant %s: backup problemi ❌ — %s", tenant_slug, detail)

    except Exception as e:
        logger.error("Tenant %s: backup zamanı xəta: %s", tenant_slug, str(e)[:300])
        try:
            with SessionLocal() as db:
                _log_backup_result(db, tenant_id, False, f"Xəta: {str(e)[:300]}")
        except Exception:
            pass


def _scheduler_loop():
    """
    Əsas scheduler döngüsü — hər saat başı yoxlayır.
    Hər tenant-ın öz backup saatı var, vaxtı gəlmişsə backup edir.
    """
    logger.info("Backup Scheduler başladı (hər saat yoxlama, default saat: %02d:00 Bakı)",
                DEFAULT_BACKUP_HOUR)

    while True:
        # Növbəti tam saata qədər gözlə
        now_baku = datetime.now(tz=BAKU_UTC_OFFSET)
        next_check = (now_baku + timedelta(hours=1)).replace(minute=0, second=5, microsecond=0)
        wait_seconds = (next_check - now_baku).total_seconds()
        if wait_seconds > 0:
            logger.info("Backup Scheduler: növbəti yoxlamaya %.0f dəqiqə qalıb (saat %02d:00)",
                         wait_seconds / 60, next_check.hour)
            time.sleep(wait_seconds)

        current_hour = datetime.now(tz=BAKU_UTC_OFFSET).hour
        logger.info("═══ Backup yoxlama başladı (Bakı saatı: %02d:00) ═══", current_hour)

        try:
            with SessionLocal() as db:
                tenants = db.query(Tenant).filter(Tenant.status == "active").all()

            processed = 0
            for tenant in tenants:
                _process_single_tenant(tenant, current_hour)
                processed += 1

            logger.info("═══ Backup yoxlama bitdi (%d tenant yoxlandı) ═══", processed)
        except Exception as e:
            logger.error("Backup scheduler xətası: %s", str(e)[:300])


def start_backup_scheduler():
    """Background thread-də backup scheduler-i başladır."""
    t = threading.Thread(target=_scheduler_loop, daemon=True, name="backup-scheduler")
    t.start()
    logger.info("Backup Scheduler background thread başladı.")
