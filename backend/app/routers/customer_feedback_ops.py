import csv
import io
import json
import random
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import (
    AuditLog,
    Customer,
    CustomerConsent,
    FeedbackCoupon,
    FeedbackEntry,
    Guest,
    LoyaltyLedgerEntry,
    Notification,
    Reservation,
    RewardClaim,
    Sale,
    Setting,
    Table,
    Tenant,
    User,
)
from app.security import hash_token
from app.services.input_sanitize_service import (
    clean_card_id as _clean_card_id,
    clean_customer_type as _clean_customer_type,
    clean_public_text as _clean_public_text,
    clean_secret_token as _clean_secret_token,
)

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None


router = APIRouter(prefix="/api/v1/ops", tags=["operations-customer-feedback"])


def _ensure_manager(user: User):
    if str(user.role or "").lower() not in {"admin", "manager", "super_admin"}:
        raise HTTPException(status_code=403, detail="Manager access required")


def _restaurant_now() -> datetime:
    if ZoneInfo:
        return datetime.now(ZoneInfo("Asia/Baku")).replace(tzinfo=None)
    return datetime.utcnow() + timedelta(hours=4)


def _utcnow() -> datetime:
    return datetime.utcnow()


def _feedback_coupon_percent(db: Session, tenant_id: str) -> int:
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == "feedback_settings").first()
    if not row or row.value is None:
        return 5
    try:
        raw = json.loads(row.value)
    except Exception:
        return 5
    if not isinstance(raw, dict):
        return 5
    try:
        percent = int(raw.get("coupon_percent", 5))
    except Exception:
        percent = 5
    return max(1, min(100, percent))


def _feedback_promo_enabled(db: Session, tenant_id: str) -> bool:
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == "feedback_settings").first()
    if not row or row.value is None:
        return True
    try:
        raw = json.loads(row.value)
    except Exception:
        return True
    if not isinstance(raw, dict):
        return True
    return bool(raw.get("promo_enabled", True))


def _generate_feedback_coupon_code(db: Session) -> str:
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(20):
        code = "FB-" + "".join(random.choice(chars) for _ in range(8))
        exists = db.query(FeedbackCoupon.id).filter(FeedbackCoupon.code == code).first()
        if not exists:
            return code
    return "FB-" + secrets.token_hex(4).upper()


def _normalize_guest_phone(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return "".join(ch for ch in raw if ch.isdigit() or ch == "+")


def _normalize_guest_email(value: str | None) -> str:
    return str(value or "").strip().lower()


class CustomerImportRowIn(BaseModel):
    card_id: str = Field(min_length=3, max_length=80)
    secret_token: str | None = None
    type: str = Field(default="Golden", min_length=2, max_length=32)
    stars: int = Field(default=0, ge=0, le=100000)
    discount_percent: float = Field(default=0, ge=0, le=100)


class CustomerForgetIn(BaseModel):
    reason: str | None = Field(default=None, min_length=2, max_length=240)
    dry_run: bool = False


class FeedbackSubmitIn(BaseModel):
    tenant_id: str
    sale_id: str | None = None
    receipt_id: str
    receipt_token: str
    source: str = "receipt"
    score: int = Field(ge=1, le=5)
    comment: str | None = None
    contact: str | None = None


class FeedbackCouponRedeemIn(BaseModel):
    code: str
    sale_id: str


@router.get("/customers")
def list_customers(
    search: str | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    del user
    query = db.query(Customer).filter(Customer.tenant_id == tenant.id)
    if search:
        safe_search = str(search).strip()
        query = query.filter(Customer.card_id.ilike(f"%{safe_search}%"))
    rows = query.order_by(Customer.created_at.desc()).limit(200).all()
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "card_id": row.card_id,
            "type": row.type,
            "stars": row.stars,
            "discount_percent": str(row.discount_percent),
            "secret_token": row.secret_token,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.get("/customers/reservation-guests")
def list_reservation_guests(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    del user
    rows = (
        db.query(Reservation)
        .filter(Reservation.tenant_id == tenant.id)
        .order_by(Reservation.reservation_at.desc())
        .all()
    )
    guests = {row.id: row for row in db.query(Guest).filter(Guest.tenant_id == tenant.id).all()}
    now = _restaurant_now()
    grouped: dict[str, dict] = {}

    for reservation in rows:
        guest = guests.get(reservation.guest_id) if reservation.guest_id else None
        if not guest:
            continue
        phone = str(guest.phone or "").strip()
        email = str(guest.email or "").strip()
        dedupe_key = _normalize_guest_phone(phone) or _normalize_guest_email(email) or f"guest:{guest.id}"
        current = grouped.get(dedupe_key)
        if not current:
            current = {
                "id": dedupe_key,
                "guest_ids": [],
                "full_name": guest.full_name,
                "phone": phone,
                "email": email,
                "notes": str(guest.notes or "").strip(),
                "reservation_count": 0,
                "cancelled_count": 0,
                "completed_count": 0,
                "active_count": 0,
                "last_reservation_at": None,
                "next_reservation_at": None,
                "last_table_label": None,
            }
            grouped[dedupe_key] = current

        if guest.id not in current["guest_ids"]:
            current["guest_ids"].append(guest.id)
        if not current["phone"] and phone:
            current["phone"] = phone
        if not current["email"] and email:
            current["email"] = email
        if len(str(guest.full_name or "").strip()) > len(str(current["full_name"] or "").strip()):
            current["full_name"] = guest.full_name
        if len(str(guest.notes or "").strip()) > len(str(current["notes"] or "").strip()):
            current["notes"] = str(guest.notes or "").strip()

        current["reservation_count"] += 1
        status = str(reservation.status or "").upper()
        if status in {"CANCELLED", "NO_SHOW"}:
            current["cancelled_count"] += 1
        elif status in {"SEATED", "COMPLETED"}:
            current["completed_count"] += 1
        elif status in {"BOOKED", "LATE", "WAITLIST"}:
            current["active_count"] += 1

        if reservation.reservation_at and (
            current["last_reservation_at"] is None or reservation.reservation_at > datetime.fromisoformat(current["last_reservation_at"])
        ):
            current["last_reservation_at"] = reservation.reservation_at.isoformat()
            if reservation.assigned_table_id:
                table = db.query(Table).filter(Table.id == reservation.assigned_table_id, Table.tenant_id == tenant.id).first()
                current["last_table_label"] = table.label if table else current["last_table_label"]

        if reservation.reservation_at and reservation.reservation_at >= now:
            if current["next_reservation_at"] is None or reservation.reservation_at < datetime.fromisoformat(current["next_reservation_at"]):
                current["next_reservation_at"] = reservation.reservation_at.isoformat()

    return sorted(
        grouped.values(),
        key=lambda row: (row["next_reservation_at"] is None, row["next_reservation_at"] or "", -(row["reservation_count"] or 0)),
    )


@router.post("/customers/qr-batch")
def create_qr_batch(
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    count = max(1, min(int(payload.get("count", 1)), 200))
    customer_type = _clean_customer_type(payload.get("customer_type"))
    discount_percent = max(0.0, min(100.0, float(payload.get("discount_percent", 0))))
    created = []
    for _ in range(count):
        card_id = f"QR-{secrets.randbelow(1000000):06d}"
        customer = Customer(
            tenant_id=tenant.id,
            card_id=card_id,
            secret_token=secrets.token_hex(16),
            type=customer_type,
            stars=0,
            discount_percent=discount_percent,
        )
        db.add(customer)
        db.flush()
        created.append(
            {
                "id": customer.id,
                "tenant_id": customer.tenant_id,
                "card_id": customer.card_id,
                "secret_token": customer.secret_token,
                "type": customer.type,
                "stars": customer.stars,
                "discount_percent": str(customer.discount_percent),
                "created_at": customer.created_at.isoformat() if customer.created_at else None,
            }
        )
    db.commit()
    return created


@router.post("/customers/import")
def import_customers(
    payload: list[CustomerImportRowIn],
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    imported = 0
    updated = 0
    for row in payload:
        card_id = _clean_card_id(row.card_id)
        customer_type = _clean_customer_type(row.type)
        secret_token = _clean_secret_token(row.secret_token)
        stars = max(0, min(int(row.stars or 0), 100000))
        discount_percent = max(0.0, min(100.0, float(row.discount_percent or 0)))
        customer = (
            db.query(Customer)
            .filter(Customer.tenant_id == tenant.id, func.lower(Customer.card_id) == card_id.lower())
            .first()
        )
        if customer:
            customer.type = customer_type or customer.type or "Golden"
            customer.stars = stars
            customer.discount_percent = discount_percent
            if secret_token:
                customer.secret_token = secret_token
            updated += 1
            continue
        db.add(
            Customer(
                tenant_id=tenant.id,
                card_id=card_id,
                secret_token=secret_token or secrets.token_hex(16),
                type=customer_type,
                stars=stars,
                discount_percent=discount_percent,
            )
        )
        imported += 1
    db.commit()
    return {"success": True, "imported": imported, "updated": updated}


@router.delete("/customers/{card_id}/forget")
def forget_customer(
    card_id: str,
    payload: CustomerForgetIn | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    clean_card_id = _clean_card_id(card_id)
    customer = (
        db.query(Customer)
        .filter(Customer.tenant_id == tenant.id, func.lower(Customer.card_id) == clean_card_id.lower())
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    affected_sales = (
        db.query(Sale)
        .filter(Sale.tenant_id == tenant.id, func.lower(Sale.customer_card_id) == clean_card_id.lower())
        .all()
    )
    notifications_count = db.query(Notification).filter(Notification.tenant_id == tenant.id, func.lower(Notification.card_id) == clean_card_id.lower()).count()
    consents_count = db.query(CustomerConsent).filter(CustomerConsent.tenant_id == tenant.id, func.lower(CustomerConsent.card_id) == clean_card_id.lower()).count()
    reward_claims_count = db.query(RewardClaim).filter(RewardClaim.tenant_id == tenant.id, func.lower(RewardClaim.card_id) == clean_card_id.lower()).count()
    loyalty_entries_count = db.query(LoyaltyLedgerEntry).filter(LoyaltyLedgerEntry.tenant_id == tenant.id, func.lower(LoyaltyLedgerEntry.card_id) == clean_card_id.lower()).count()
    planned_report = {
        "card_hash": hash_token(clean_card_id.lower()),
        "sales_unlinked": len(affected_sales),
        "notifications_deleted": int(notifications_count or 0),
        "consents_deleted": int(consents_count or 0),
        "reward_claims_deleted": int(reward_claims_count or 0),
        "loyalty_entries_deleted": int(loyalty_entries_count or 0),
    }
    if payload and bool(payload.dry_run):
        return {"success": True, "dry_run": True, "report": planned_report}

    for sale in affected_sales:
        sale.customer_card_id = None
        sale.reward_claim_code = None

    db.query(Notification).filter(Notification.tenant_id == tenant.id, func.lower(Notification.card_id) == clean_card_id.lower()).delete(synchronize_session=False)
    db.query(CustomerConsent).filter(CustomerConsent.tenant_id == tenant.id, func.lower(CustomerConsent.card_id) == clean_card_id.lower()).delete(synchronize_session=False)
    db.query(RewardClaim).filter(RewardClaim.tenant_id == tenant.id, func.lower(RewardClaim.card_id) == clean_card_id.lower()).delete(synchronize_session=False)
    db.query(LoyaltyLedgerEntry).filter(LoyaltyLedgerEntry.tenant_id == tenant.id, func.lower(LoyaltyLedgerEntry.card_id) == clean_card_id.lower()).delete(synchronize_session=False)
    db.delete(customer)
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="GDPR_CUSTOMER_FORGOTTEN",
            details=json.dumps(
                {
                    **planned_report,
                    "reason": _clean_public_text((payload.reason if payload else "") or "", max_len=240, field_name="Səbəb"),
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {"success": True, "report": planned_report}


@router.get("/customers/{card_id}/forget-preview")
def forget_customer_preview(
    card_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_manager(user)
    clean_card_id = _clean_card_id(card_id)
    customer = (
        db.query(Customer)
        .filter(Customer.tenant_id == tenant.id, func.lower(Customer.card_id) == clean_card_id.lower())
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    sales_unlinked = db.query(Sale).filter(Sale.tenant_id == tenant.id, func.lower(Sale.customer_card_id) == clean_card_id.lower()).count()
    notifications_deleted = db.query(Notification).filter(Notification.tenant_id == tenant.id, func.lower(Notification.card_id) == clean_card_id.lower()).count()
    consents_deleted = db.query(CustomerConsent).filter(CustomerConsent.tenant_id == tenant.id, func.lower(CustomerConsent.card_id) == clean_card_id.lower()).count()
    reward_claims_deleted = db.query(RewardClaim).filter(RewardClaim.tenant_id == tenant.id, func.lower(RewardClaim.card_id) == clean_card_id.lower()).count()
    loyalty_entries_deleted = db.query(LoyaltyLedgerEntry).filter(LoyaltyLedgerEntry.tenant_id == tenant.id, func.lower(LoyaltyLedgerEntry.card_id) == clean_card_id.lower()).count()
    return {
        "success": True,
        "card_hash": hash_token(clean_card_id.lower()),
        "sales_unlinked": int(sales_unlinked or 0),
        "notifications_deleted": int(notifications_deleted or 0),
        "consents_deleted": int(consents_deleted or 0),
        "reward_claims_deleted": int(reward_claims_deleted or 0),
        "loyalty_entries_deleted": int(loyalty_entries_deleted or 0),
    }


@router.post("/feedback/submit")
def submit_feedback(
    payload: FeedbackSubmitIn,
    db: Session = Depends(get_db),
):
    tenant_id = str(payload.tenant_id or "").strip()
    receipt_id = str(payload.receipt_id or "").strip()
    receipt_token = str(payload.receipt_token or "").strip()
    if not tenant_id or not receipt_id or not receipt_token:
        raise HTTPException(status_code=400, detail="tenant_id, receipt_id və receipt_token məcburidir")

    sale = (
        db.query(Sale)
        .filter(Sale.tenant_id == tenant_id, (Sale.id == receipt_id) | (Sale.receipt_code == receipt_id))
        .first()
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Çek tapılmadı")
    if str(sale.receipt_token or "") != receipt_token:
        raise HTTPException(status_code=400, detail="Çek token etibarsızdır")
    if payload.sale_id and str(payload.sale_id).strip() and str(payload.sale_id).strip() != str(sale.id):
        raise HTTPException(status_code=400, detail="sale_id çek ilə uyğun deyil")
    canonical_receipt_id = str(sale.id)

    existing_coupon = (
        db.query(FeedbackCoupon)
        .filter(
            FeedbackCoupon.tenant_id == tenant_id,
            FeedbackCoupon.receipt_id == canonical_receipt_id,
            FeedbackCoupon.receipt_token == receipt_token,
        )
        .first()
    )
    if existing_coupon:
        return {"success": True, "already_submitted": True, "coupon_code": existing_coupon.code, "coupon_percent": int(existing_coupon.percent or 5)}

    now = _utcnow()
    feedback_entry = FeedbackEntry(
        tenant_id=tenant_id,
        sale_id=sale.id,
        receipt_id=canonical_receipt_id,
        receipt_token=receipt_token,
        source=str(payload.source or "receipt").strip() or "receipt",
        score=max(1, min(5, int(payload.score or 0))),
        comment=str(payload.comment or "").strip()[:800] or None,
        contact=str(payload.contact or "").strip()[:120] or None,
        staff_username=str(sale.cashier or "").strip() or None,
        created_at=now,
    )
    db.add(feedback_entry)
    db.flush()

    promo_enabled = _feedback_promo_enabled(db, tenant_id)
    coupon = None
    if promo_enabled:
        coupon_percent = _feedback_coupon_percent(db, tenant_id)
        coupon = FeedbackCoupon(
            tenant_id=tenant_id,
            feedback_entry_id=feedback_entry.id,
            sale_id=sale.id,
            receipt_id=canonical_receipt_id,
            receipt_token=receipt_token,
            code=_generate_feedback_coupon_code(db),
            percent=coupon_percent,
            status="PENDING",
            source="feedback",
            issued_at=now,
        )
        db.add(coupon)
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            user="feedback_portal",
            action="FEEDBACK_SUBMITTED",
            details=json.dumps(
                {
                    "feedback_entry_id": feedback_entry.id,
                    "sale_id": sale.id,
                    "receipt_id": canonical_receipt_id,
                    "receipt_ref": receipt_id,
                    "score": int(feedback_entry.score or 0),
                    "coupon_code": coupon.code if coupon else None,
                    "promo_enabled": promo_enabled,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {
        "success": True,
        "already_submitted": False,
        "coupon_code": coupon.code if coupon else None,
        "coupon_percent": int(coupon.percent or 5) if coupon else None,
    }


@router.get("/feedback/coupon/by-receipt")
def find_feedback_coupon_by_receipt(
    tenant_id: str,
    receipt_id: str,
    receipt_token: str,
    db: Session = Depends(get_db),
):
    tenant_id = str(tenant_id or "").strip()
    receipt_id = str(receipt_id or "").strip()
    receipt_token = str(receipt_token or "").strip()
    if not tenant_id or not receipt_id or not receipt_token:
        raise HTTPException(status_code=400, detail="tenant_id, receipt_id və receipt_token məcburidir")
    sale = (
        db.query(Sale)
        .filter(Sale.tenant_id == tenant_id, (Sale.id == receipt_id) | (Sale.receipt_code == receipt_id))
        .first()
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Çek tapılmadı")
    if str(sale.receipt_token or "") != receipt_token:
        raise HTTPException(status_code=400, detail="Çek token etibarsızdır")
    coupon = (
        db.query(FeedbackCoupon)
        .filter(
            FeedbackCoupon.tenant_id == tenant_id,
            FeedbackCoupon.receipt_id == str(sale.id),
            FeedbackCoupon.receipt_token == receipt_token,
        )
        .first()
    )
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found")
    return {
        "id": coupon.id,
        "tenant_id": coupon.tenant_id,
        "code": coupon.code,
        "percent": int(coupon.percent or 5),
        "status": coupon.status,
        "issued_at": coupon.issued_at.isoformat() if coupon.issued_at else None,
        "redeemed_at": coupon.redeemed_at.isoformat() if coupon.redeemed_at else None,
        "sale_id": coupon.sale_id,
        "receipt_id": coupon.receipt_id,
        "redeemed_sale_id": coupon.redeemed_sale_id,
    }


@router.get("/feedback/coupon/lookup")
def lookup_feedback_coupon(
    code: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    del user
    safe_code = str(code or "").strip().upper()
    if not safe_code:
        raise HTTPException(status_code=400, detail="Coupon code is required")
    row = db.query(FeedbackCoupon).filter(FeedbackCoupon.tenant_id == tenant.id, FeedbackCoupon.code == safe_code).first()
    if not row:
        raise HTTPException(status_code=404, detail="Coupon not found")
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "code": row.code,
        "percent": int(row.percent or 5),
        "status": row.status,
        "issued_at": row.issued_at.isoformat() if row.issued_at else None,
        "redeemed_at": row.redeemed_at.isoformat() if row.redeemed_at else None,
        "sale_id": row.sale_id,
        "receipt_id": row.receipt_id,
        "redeemed_sale_id": row.redeemed_sale_id,
    }


@router.post("/feedback/coupon/redeem")
def redeem_feedback_coupon(
    payload: FeedbackCouponRedeemIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    safe_code = str(payload.code or "").strip().upper()
    safe_sale_id = str(payload.sale_id or "").strip()
    if not safe_code or not safe_sale_id:
        raise HTTPException(status_code=400, detail="code və sale_id məcburidir")
    redeem_sale = db.query(Sale).filter(Sale.tenant_id == tenant.id, Sale.id == safe_sale_id).first()
    if not redeem_sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    coupon = db.query(FeedbackCoupon).filter(FeedbackCoupon.tenant_id == tenant.id, FeedbackCoupon.code == safe_code).first()
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found")
    if str(coupon.status or "").upper() != "PENDING":
        return {"success": False, "reason": "already_redeemed"}
    if str(coupon.sale_id or "") == safe_sale_id:
        raise HTTPException(status_code=400, detail="Coupon cannot be redeemed on the original sale")

    coupon.status = "REDEEMED"
    coupon.redeemed_at = _utcnow()
    coupon.redeemed_sale_id = safe_sale_id
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=str(user.username or "system"),
            action="FEEDBACK_COUPON_REDEEMED",
            details=json.dumps({"coupon_code": coupon.code, "sale_id": safe_sale_id}, ensure_ascii=False),
        )
    )
    db.commit()
    return {"success": True}


@router.get("/feedback/inbox")
def feedback_inbox(
    date_from: str | None = None,
    date_to: str | None = None,
    min_score: int | None = Query(default=None, ge=1, le=5),
    max_score: int | None = Query(default=None, ge=1, le=5),
    limit: int = Query(default=200, ge=1, le=2000),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    del user
    query = db.query(FeedbackEntry, FeedbackCoupon).outerjoin(
        FeedbackCoupon, FeedbackCoupon.feedback_entry_id == FeedbackEntry.id
    ).filter(FeedbackEntry.tenant_id == tenant.id)
    if date_from:
        query = query.filter(FeedbackEntry.created_at >= datetime.fromisoformat(f"{date_from}T00:00:00"))
    if date_to:
        query = query.filter(FeedbackEntry.created_at <= datetime.fromisoformat(f"{date_to}T23:59:59"))
    if min_score is not None:
        query = query.filter(FeedbackEntry.score >= int(min_score))
    if max_score is not None:
        query = query.filter(FeedbackEntry.score <= int(max_score))
    rows = query.order_by(FeedbackEntry.created_at.desc()).limit(limit).all()
    return [
        {
            "id": entry.id,
            "tenant_id": entry.tenant_id,
            "sale_id": entry.sale_id,
            "receipt_id": entry.receipt_id,
            "score": int(entry.score or 0),
            "comment": entry.comment,
            "contact": entry.contact,
            "staff_username": entry.staff_username,
            "source": entry.source,
            "created_at": entry.created_at.isoformat() if entry.created_at else None,
            "coupon_code": coupon.code if coupon else None,
            "coupon_percent": int(coupon.percent or 0) if coupon else None,
            "coupon_status": coupon.status if coupon else None,
            "coupon_redeemed_at": coupon.redeemed_at.isoformat() if coupon and coupon.redeemed_at else None,
        }
        for entry, coupon in rows
    ]


@router.get("/feedback/inbox/export.csv")
def feedback_inbox_export_csv(
    date_from: str | None = None,
    date_to: str | None = None,
    min_score: int | None = Query(default=None, ge=1, le=5),
    max_score: int | None = Query(default=None, ge=1, le=5),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    del user
    query = db.query(FeedbackEntry, FeedbackCoupon).outerjoin(
        FeedbackCoupon, FeedbackCoupon.feedback_entry_id == FeedbackEntry.id
    ).filter(FeedbackEntry.tenant_id == tenant.id)
    if date_from:
        query = query.filter(FeedbackEntry.created_at >= datetime.fromisoformat(f"{date_from}T00:00:00"))
    if date_to:
        query = query.filter(FeedbackEntry.created_at <= datetime.fromisoformat(f"{date_to}T23:59:59"))
    if min_score is not None:
        query = query.filter(FeedbackEntry.score >= int(min_score))
    if max_score is not None:
        query = query.filter(FeedbackEntry.score <= int(max_score))
    rows = query.order_by(FeedbackEntry.created_at.desc()).limit(10000).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["created_at", "score", "comment", "contact", "staff_username", "sale_id", "receipt_id", "coupon_code", "coupon_percent", "coupon_status", "coupon_redeemed_at"])
    for entry, coupon in rows:
        writer.writerow(
            [
                entry.created_at.isoformat() if entry.created_at else "",
                int(entry.score or 0),
                entry.comment or "",
                entry.contact or "",
                entry.staff_username or "",
                entry.sale_id or "",
                entry.receipt_id or "",
                coupon.code if coupon else "",
                int(coupon.percent or 0) if coupon else "",
                coupon.status if coupon else "",
                coupon.redeemed_at.isoformat() if coupon and coupon.redeemed_at else "",
            ]
        )
    output.seek(0)
    filename = f"feedback_inbox_{tenant.id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename=\"{filename}\"'},
    )
