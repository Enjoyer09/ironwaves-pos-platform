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

import base64
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import SessionLocal
from app.models import (
    AgentInsight,
    AuditLog,
    BusinessProfile,
    CentralBackupLog,
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


def _get_central_backup_tenant_ids(db: Session, super_tenant_id: str) -> list[str]:
    """Mərkəzi backup olunacak tenant ID-lərini oxuyur."""
    row = db.query(Setting).filter(Setting.tenant_id == super_tenant_id, Setting.key == "central_backup_tenant_ids").first()
    if not row or not row.value:
        return []
    try:
        val = json.loads(row.value)
        if isinstance(val, list):
            return [str(item) for item in val]
    except Exception:
        pass
    return []


def _set_setting_value(db: Session, tenant_id: str, key: str, value: str):
    """Setting dəyərini yeniləyir və ya yaradır."""
    s = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    if not s:
        import uuid
        s = Setting(id=str(uuid.uuid4()), tenant_id=tenant_id, key=key)
        db.add(s)
    s.value = value
    s.updated_at = datetime.utcnow()


def _log_central_backup_result(
    db: Session,
    tenant_id: str,
    tenant_slug: str,
    status: str,
    detail: str,
    backup_size_bytes: int = 0
):
    """Mərkəzi backup loqunu central_backup_logs cədvəlinə yazır."""
    import uuid
    log = CentralBackupLog(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        tenant_slug=tenant_slug,
        status=status,
        detail=detail,
        backup_size_bytes=backup_size_bytes,
        created_at=datetime.utcnow()
    )
    db.add(log)
    db.commit()


def _save_central_backup_to_disk(
    final_payload: bytes,
    tenant_slug: str,
    filename: str,
    local_path: str | None = None
) -> tuple[bool, str]:
    """Mərkəzi backup faylını diskə yazır."""
    try:
        base_dir = Path(local_path) if local_path else BACKUP_DIR / tenant_slug
        base_dir.mkdir(parents=True, exist_ok=True)
        filepath = base_dir / filename
        
        with open(filepath, "wb") as f:
            f.write(final_payload)
            
        file_size = filepath.stat().st_size
        
        # Köhnə backupları təmizlə
        _cleanup_old_central_backups(base_dir, tenant_slug)
        
        return True, f"Diskə yazıldı: {filepath} ({file_size} bytes)"
    except Exception as e:
        return False, f"Diskə yazma xətası: {str(e)[:200]}"


def _cleanup_old_central_backups(backup_dir: Path, tenant_slug: str):
    """Mərkəzi backup üçün köhnə backup fayllarını təmizləyir."""
    try:
        files = sorted(
            [f for f in backup_dir.glob(f"{tenant_slug}_backup_*")],
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )
        for old_file in files[MAX_LOCAL_BACKUPS:]:
            old_file.unlink()
            logger.info("Köhnə mərkəzi backup silindi: %s", old_file)
    except Exception as e:
        logger.warning("Köhnə backup təmizləmə xətası: %s", str(e)[:100])


def _send_central_backup_webhook(
    url: str,
    payload_bytes: bytes,
    tenant_slug: str,
    filename: str,
    original_size: int,
    compressed_size: int,
    secret: str | None = None,
    is_encrypted: bool = False
) -> tuple[bool, str]:
    """Mərkəzi backup faylını webhook-a POST edir."""
    headers = {
        "Content-Type": "application/octet-stream" if is_encrypted else "application/json",
        "X-Backup-Tenant": tenant_slug,
        "X-Backup-Timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "X-Backup-Size-Original": str(original_size),
        "X-Backup-Size-Compressed": str(compressed_size),
        "X-Backup-Encrypted": "true" if is_encrypted else "false",
        "X-Backup-Filename": filename,
    }
    
    if not is_encrypted:
        headers["Content-Encoding"] = "gzip"

    if secret:
        sig = _sign_payload(payload_bytes, secret)
        headers["X-Backup-Signature"] = f"sha256={sig}"

    req = urllib.request.Request(
        url,
        data=payload_bytes,
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


def _process_central_backup_for_tenant(db: Session, tenant: Tenant, cfg: dict) -> bool:
    """
    Bir tenant üçün mərkəzi backup-ı hazırlayır, şifrələyir və hədəflərə ötürür.
    Nəticəni cədvəldə loqlayır.
    """
    tenant_id = tenant.id
    tenant_slug = tenant.slug

    try:
        backup_target = str(cfg.get("backup_target") or "webhook").strip().lower()
        webhook_url = str(cfg.get("backup_webhook_url") or "").strip()
        webhook_secret = str(cfg.get("backup_webhook_secret") or "").strip() or None
        local_path = str(cfg.get("backup_local_path") or "").strip() or None

        has_webhook = backup_target in ("webhook", "both") and webhook_url
        has_disk = backup_target in ("disk", "both")
        if not has_webhook and not has_disk:
            logger.info("Mərkəzi backup: Tenant %s üçün heç bir backup hədəfi seçilməyib.", tenant_slug)
            return True

        logger.info("Mərkəzi backup: Tenant %s üçün backup yaradılır (hədəf: %s)...", tenant_slug, backup_target)
        backup_data = _build_tenant_backup(db, tenant)

        original_bytes = json.dumps(backup_data, ensure_ascii=False, default=str).encode("utf-8")
        compressed_bytes = gzip.compress(original_bytes, compresslevel=6)

        # Şifrələmə yoxlanışı
        encryption_key = os.environ.get("SYSTEM_BACKUP_ENCRYPTION_KEY", "").strip()
        is_encrypted = False
        final_payload = compressed_bytes

        if encryption_key:
            try:
                # 32-baytlıq URL-safe base64 açar çıxarılır
                key = base64.urlsafe_b64encode(hashlib.sha256(encryption_key.encode("utf-8")).digest())
                fernet = Fernet(key)
                final_payload = fernet.encrypt(compressed_bytes)
                is_encrypted = True
            except Exception as enc_err:
                logger.error("Tenant %s şifrələmə xətası: %s", tenant_slug, str(enc_err))
                _log_central_backup_result(
                    db,
                    tenant_id=tenant_id,
                    tenant_slug=tenant_slug,
                    status="failed",
                    detail=f"Şifrələmə xətası: {str(enc_err)[:200]}"
                )
                return False

        results = []
        timestamp = datetime.now(tz=BAKU_UTC_OFFSET).strftime("%Y%m%d_%H%M%S")
        filename = f"{tenant_slug}_backup_{timestamp}.json.gz"
        if is_encrypted:
            filename += ".enc"

        # Diskə yazma
        if has_disk:
            disk_ok, disk_msg = _save_central_backup_to_disk(final_payload, tenant_slug, filename, local_path)
            results.append(f"Disk: {'✅' if disk_ok else '❌'} {disk_msg}")

        # Webhook göndərmə
        if has_webhook:
            webhook_ok, webhook_msg = _send_central_backup_webhook(
                webhook_url, final_payload, tenant_slug, filename,
                original_size=len(original_bytes),
                compressed_size=len(compressed_bytes),
                secret=webhook_secret,
                is_encrypted=is_encrypted
            )
            results.append(f"Webhook: {'✅' if webhook_ok else '❌'} {webhook_msg}")

        detail = " | ".join(results)
        success = "❌" not in detail

        _log_central_backup_result(
            db,
            tenant_id=tenant_id,
            tenant_slug=tenant_slug,
            status="success" if success else "failed",
            detail=detail,
            backup_size_bytes=len(final_payload)
        )

        if success:
            logger.info("Mərkəzi backup: Tenant %s tamamlandı ✅ — %s", tenant_slug, detail)
        else:
            logger.warning("Mərkəzi backup: Tenant %s xətalarla tamamlandı ❌ — %s", tenant_slug, detail)

        return success

    except Exception as e:
        logger.error("Mərkəzi backup: Tenant %s xətası: %s", tenant_slug, str(e)[:300])
        try:
            _log_central_backup_result(
                db,
                tenant_id=tenant_id,
                tenant_slug=tenant_slug,
                status="failed",
                detail=f"Xəta: {str(e)[:300]}"
            )
        except Exception:
            pass
        return False


def _scheduler_loop():
    """
    Mərkəzi backup scheduler döngüsü — hər saat başı yoxlayır.
    Super Admin-in təyin etdiyi mərkəzi backup saatında işləyir.
    """
    logger.info("Mərkəzi Backup Scheduler başladı (hər saat yoxlama, default saat: %02d:00 Bakı)",
                DEFAULT_BACKUP_HOUR)

    while True:
        # Növbəti tam saata qədər gözlə
        now_baku = datetime.now(tz=BAKU_UTC_OFFSET)
        next_check = (now_baku + timedelta(hours=1)).replace(minute=0, second=5, microsecond=0)
        wait_seconds = (next_check - now_baku).total_seconds()
        if wait_seconds > 0:
            logger.info("Mərkəzi Backup Scheduler: növbəti yoxlamaya %.0f dəqiqə qalıb (saat %02d:00)",
                         wait_seconds / 60, next_check.hour)
            time.sleep(wait_seconds)

        current_hour = datetime.now(tz=BAKU_UTC_OFFSET).hour
        logger.info("═══ Mərkəzi Backup yoxlama başladı (Bakı saatı: %02d:00) ═══", current_hour)

        try:
            with SessionLocal() as db:
                # 1. Super tenant-ı tapırıq
                super_tenant = db.query(Tenant).filter(Tenant.slug == settings.platform_tenant_slug).first()
                if not super_tenant:
                    logger.warning("Super Tenant tapılmadı! Platforma settings-də 'platform_tenant_slug' yoxlayın.")
                    continue

                # 2. Super tenant-ın backup parametrlərini oxuyuruq
                cfg = _get_tenant_backup_settings(db, super_tenant.id)
                if not cfg.get("backup_enabled", False):
                    logger.info("Mərkəzi backup söndürülüb (backup_enabled = False).")
                    continue

                backup_hour = cfg.get("backup_hour", DEFAULT_BACKUP_HOUR)
                if current_hour != backup_hour:
                    logger.info("Cari saat (%02d) mərkəzi backup saatına (%02d) uyğun deyil.", current_hour, backup_hour)
                    continue

                logger.info("Mərkəzi backup saatı gəldi (%02d:00 Bakı). Backup prosesi başlayır...", backup_hour)

                # 3. Backup olunacaq tenant siyahısını oxuyuruq
                enabled_ids = _get_central_backup_tenant_ids(db, super_tenant.id)
                
                # Bütün aktiv tenant-ları çəkirik
                active_tenants = db.query(Tenant).filter(Tenant.status == "active").all()
                
                tenants_to_process = []
                for tenant in active_tenants:
                    # Super tenant həmişə daxildir, digərləri isə siyahıda varsa
                    if tenant.slug == settings.platform_tenant_slug or tenant.id in enabled_ids:
                        tenants_to_process.append(tenant)

                if not tenants_to_process:
                    logger.info("Backup olunacaq heç bir tenant tapılmadı.")
                    continue

                logger.info("Mərkəzi backup olunacaq tenantlar: %s", [t.slug for t in tenants_to_process])

                success_count = 0
                failed_count = 0
                
                for tenant in tenants_to_process:
                    try:
                        with SessionLocal() as tenant_db:
                            ok = _process_central_backup_for_tenant(tenant_db, tenant, cfg)
                            if ok:
                                success_count += 1
                            else:
                                failed_count += 1
                    except Exception as t_err:
                        logger.error("Tenant %s central backup exception: %s", tenant.slug, str(t_err))
                        failed_count += 1
                        try:
                            with SessionLocal() as log_db:
                                _log_central_backup_result(
                                    log_db,
                                    tenant_id=tenant.id,
                                    tenant_slug=tenant.slug,
                                    status="failed",
                                    detail=f"Kritik Xəta: {str(t_err)[:300]}"
                                )
                        except Exception:
                            pass

                # Super tenant settings-ə nəticəni yazırıq
                status_str = "success" if failed_count == 0 else "failed"
                timestamp_str = datetime.now(tz=BAKU_UTC_OFFSET).isoformat()
                
                _set_setting_value(db, super_tenant.id, "last_backup_status", status_str)
                _set_setting_value(db, super_tenant.id, "last_backup_at", timestamp_str)
                db.commit()
                
                logger.info("═══ Mərkəzi backup prosesi tamamlandı: Uğurlu: %d, Xətalı: %d ═══", 
                            success_count, failed_count)

        except Exception as e:
            logger.error("Mərkəzi backup scheduler xətası: %s", str(e)[:300])


def start_backup_scheduler():
    """Background thread-də mərkəzi backup scheduler-i başladır."""
    t = threading.Thread(target=_scheduler_loop, daemon=True, name="backup-scheduler")
    t.start()
    logger.info("Mərkəzi Backup Scheduler background thread başladı.")
