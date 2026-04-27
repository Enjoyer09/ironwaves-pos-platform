from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import pyotp
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings as app_settings
from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import (
    AuditLog,
    Check,
    Customer,
    FeedbackCoupon,
    FeedbackEntry,
    FinanceAccount,
    FinanceEntry,
    FinanceLedgerEntry,
    FinanceTransaction,
    FloorPlan,
    Guest,
    HappyHour,
    ItemStatusLog,
    InventoryItem,
    KitchenOrder,
    LoyaltyLedgerEntry,
    MenuItem,
    Notification,
    OrderItem,
    OrderRound,
    Payment,
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
    Recipe,
)
from app.schemas import SystemResetIn, TotpDisableIn, TotpSetupOut, TotpVerifyIn
from app.security import hash_password, validate_password_policy, verify_password

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class UserCreateIn(BaseModel):
    username: str
    role: str
    password: str | None = None
    pin: str | None = None
    two_factor_enabled: bool | None = False


class UserCredentialsUpdateIn(BaseModel):
    password: str | None = None
    pin: str | None = None
    two_factor_enabled: bool | None = None
    current_password: str | None = None


class UserOut(BaseModel):
    id: str
    tenant_id: str
    username: str
    role: str
    two_factor_enabled: bool
    is_active: bool


def _ensure_user_management_access(user: User):
    if user.role not in {"admin", "super_admin", "manager"}:
        raise HTTPException(status_code=403, detail="User management access required")


def _assert_target_allowed(actor: User, target_role: str):
    actor_role = str(actor.role or "").lower()
    target_role_norm = str(target_role or "").lower()
    if actor_role == "manager" and target_role_norm in {"manager", "admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Manager cannot manage admin/manager accounts")


def _clean_role(value: str) -> str:
    role = str(value or "").strip().lower()
    if role not in {"admin", "manager", "staff", "kitchen"}:
        raise HTTPException(status_code=400, detail="Invalid role")
    return role


def _uses_password(role: str) -> bool:
    return str(role or "").lower() in {"admin", "manager", "super_admin"}


def _uses_pin(role: str) -> bool:
    return str(role or "").lower() in {"staff", "kitchen"}


def _assert_unique_pin(db: Session, tenant_id: str, pin: str, exclude_user_id: str | None = None):
    pin_value = str(pin or "").strip()
    if not pin_value:
        return
    rows = (
        db.query(User)
        .filter(
            User.tenant_id == tenant_id,
            User.is_active == True,
            User.role.in_(["staff", "kitchen"]),
        )
        .all()
    )
    for row in rows:
        if exclude_user_id and row.id == exclude_user_id:
            continue
        pin_hash = row.pin_hash or row.password_hash
        if pin_hash and verify_password(pin_value, pin_hash):
            raise HTTPException(status_code=409, detail="Bu PIN artıq başqa staff/kitchen hesabında istifadə olunur")


def _tenant_pin_min_length(db: Session, tenant_id: str) -> int:
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == "session_settings").first()
    try:
        import json

        value = json.loads(row.value or "{}") if row else {}
        configured = int(value.get("staff_pin_length") or app_settings.pin_min_length)
    except Exception:
        configured = app_settings.pin_min_length
    return 4 if configured == 4 else 6


def _assert_strong_pin(pin: str, min_length: int | None = None) -> None:
    pin_value = str(pin or "").strip()
    required = int(min_length or app_settings.pin_min_length)
    if not pin_value.isdigit():
        raise HTTPException(status_code=400, detail="PIN yalnız rəqəmlərdən ibarət olmalıdır")
    if len(pin_value) < required or len(pin_value) > 15:
        raise HTTPException(status_code=400, detail=f"PIN ən azı {required}, ən çox 15 rəqəm olmalıdır")
    if len(set(pin_value)) == 1:
        raise HTTPException(status_code=400, detail="PIN eyni rəqəmin təkrarından ibarət ola bilməz")


def _assert_strong_password(password: str) -> None:
    try:
        validate_password_policy(password, min_length=app_settings.password_min_length)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    current_user: User = Depends(get_current_user),
):
    _ensure_user_management_access(current_user)
    rows = db.query(User).filter(User.tenant_id == tenant.id, User.is_active == True).all()
    return [
        UserOut(
            id=u.id,
            tenant_id=u.tenant_id,
            username=u.username,
            role=u.role,
            two_factor_enabled=bool(u.totp_enabled),
            is_active=bool(u.is_active),
        )
        for u in rows
    ]


@router.post("/users", response_model=UserOut)
def create_user(
    payload: UserCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    current_user: User = Depends(get_current_user),
):
    _ensure_user_management_access(current_user)

    username = str(payload.username or "").strip()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")

    role = _clean_role(payload.role)
    _assert_target_allowed(current_user, role)
    normalized = username.lower()
    existing = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, func.lower(User.username) == normalized)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    password = str(payload.password or "")
    pin = str(payload.pin or "").strip()
    if _uses_password(role):
        _assert_strong_password(password)
    if _uses_pin(role):
        _assert_strong_pin(pin, _tenant_pin_min_length(db, tenant.id))
    if _uses_password(role) and pin:
        raise HTTPException(status_code=400, detail="Admin/manager accounts must use password login only")
    if _uses_pin(role) and password:
        raise HTTPException(status_code=400, detail="Staff/kitchen accounts must use PIN login only")
    if _uses_pin(role):
        _assert_unique_pin(db, tenant.id, pin)

    row = User(
        tenant_id=tenant.id,
        username=username,
        password_hash=hash_password(password if _uses_password(role) else pin),
        pin_hash=hash_password(pin) if _uses_pin(role) else None,
        role=role,
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return UserOut(
        id=row.id,
        tenant_id=row.tenant_id,
        username=row.username,
        role=row.role,
        two_factor_enabled=bool(row.totp_enabled),
        is_active=bool(row.is_active),
    )


@router.patch("/users/{username}/credentials")
def update_user_credentials(
    username: str,
    payload: UserCredentialsUpdateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    current_user: User = Depends(get_current_user),
):
    _ensure_user_management_access(current_user)
    username_norm = str(username or "").strip().lower()
    row = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, func.lower(User.username) == username_norm, User.is_active == True)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    _assert_target_allowed(current_user, row.role)

    if payload.password is not None:
        if not _uses_password(row.role):
            raise HTTPException(status_code=400, detail="This role does not use password login")
        password = str(payload.password)
        _assert_strong_password(password)
        # For self password updates require current password verification.
        if row.id == current_user.id:
            current_password = str(payload.current_password or "")
            if not current_password or not verify_password(current_password, row.password_hash):
                raise HTTPException(status_code=401, detail="Current password is incorrect")
        row.password_hash = hash_password(password)

    if payload.pin is not None:
        if not _uses_pin(row.role):
            raise HTTPException(status_code=400, detail="This role does not use PIN login")
        pin = str(payload.pin).strip()
        _assert_strong_pin(pin, _tenant_pin_min_length(db, tenant.id))
        _assert_unique_pin(db, tenant.id, pin, exclude_user_id=row.id)
        row.pin_hash = hash_password(pin)

    db.commit()
    return {"success": True}


@router.post("/2fa/totp/setup", response_model=TotpSetupOut)
def setup_totp(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    current_user: User = Depends(get_current_user),
):
    if not _uses_password(current_user.role):
        raise HTTPException(status_code=400, detail="This role does not support TOTP login")
    secret = pyotp.random_base32()
    current_user.totp_secret = secret
    current_user.totp_enabled = False
    db.commit()
    issuer = tenant.name or "iRonWaves POS"
    otpauth_url = pyotp.TOTP(secret).provisioning_uri(name=current_user.username, issuer_name=issuer)
    return TotpSetupOut(secret=secret, otpauth_url=otpauth_url)


@router.post("/2fa/totp/verify")
def verify_totp(
    payload: TotpVerifyIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.totp_secret:
        raise HTTPException(status_code=400, detail="TOTP setup not started")
    code = str(payload.code or "").strip().replace(" ", "")
    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid authenticator code")
    current_user.totp_enabled = True
    db.commit()
    return {"success": True}


@router.post("/2fa/totp/disable")
def disable_totp(
    payload: TotpDisableIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(str(payload.current_password or ""), current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if not current_user.totp_enabled:
        current_user.totp_secret = None
        db.commit()
        return {"success": True}
    code = str(payload.code or "").strip().replace(" ", "")
    if current_user.totp_secret and code:
        totp = pyotp.TOTP(current_user.totp_secret)
        if not totp.verify(code, valid_window=1):
            raise HTTPException(status_code=400, detail="Invalid authenticator code")
    current_user.totp_secret = None
    current_user.totp_enabled = False
    db.commit()
    return {"success": True}


@router.post("/reset-system")
def reset_system(
    payload: SystemResetIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    current_user: User = Depends(get_current_user),
):
    if str(current_user.role or "").lower() not in {"admin", "super_admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")
    if not verify_password(str(payload.current_password or ""), current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if bool(current_user.totp_enabled) and current_user.totp_secret:
        code = str(payload.code or "").strip().replace(" ", "")
        if not code:
          raise HTTPException(status_code=401, detail="2FA_REQUIRED")
        totp = pyotp.TOTP(current_user.totp_secret)
        if not totp.verify(code, valid_window=1):
            raise HTTPException(status_code=400, detail="Invalid authenticator code")

    db.query(FeedbackCoupon).filter(FeedbackCoupon.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(FeedbackEntry).filter(FeedbackEntry.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(ItemStatusLog).filter(ItemStatusLog.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Payment).filter(Payment.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(OrderItem).filter(OrderItem.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(OrderRound).filter(OrderRound.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Check).filter(Check.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(TableSession).filter(TableSession.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Reservation).filter(Reservation.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Guest).filter(Guest.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(KitchenOrder).filter(KitchenOrder.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Table).filter(Table.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(FloorPlan).filter(FloorPlan.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(FinanceLedgerEntry).filter(FinanceLedgerEntry.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(FinanceTransaction).filter(FinanceTransaction.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Sale).filter(Sale.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(RewardClaim).filter(RewardClaim.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(LoyaltyLedgerEntry).filter(LoyaltyLedgerEntry.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Notification).filter(Notification.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(StaffNotification).filter(StaffNotification.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Customer).filter(Customer.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(ShiftHandover).filter(ShiftHandover.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Shift).filter(Shift.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(HappyHour).filter(HappyHour.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Recipe).filter(Recipe.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(MenuItem).filter(MenuItem.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Setting).filter(Setting.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(AuditLog).filter(AuditLog.tenant_id == tenant.id).delete(synchronize_session=False)
    db.commit()
    return {"success": True}


@router.delete("/users/{username}")
def delete_user(
    username: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    current_user: User = Depends(get_current_user),
):
    _ensure_user_management_access(current_user)

    username_norm = str(username or "").strip().lower()
    row = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, func.lower(User.username) == username_norm, User.is_active == True)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    _assert_target_allowed(current_user, row.role)
    if row.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if row.role == "super_admin":
        active_super_admin_count = (
            db.query(User)
            .filter(User.tenant_id == tenant.id, User.role == "super_admin", User.is_active == True)  # noqa: E712
            .count()
        )
        if active_super_admin_count <= 1:
            raise HTTPException(status_code=400, detail="Son platform owner silinə bilməz")

    row.is_active = False
    db.commit()
    return {"success": True}
