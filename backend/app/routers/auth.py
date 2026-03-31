from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
import pyotp
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import (
    AuditLog,
    Customer,
    FinanceEntry,
    HappyHour,
    InventoryItem,
    KitchenOrder,
    LoyaltyLedgerEntry,
    MenuItem,
    Notification,
    RefreshToken,
    Recipe,
    RewardClaim,
    Sale,
    Setting,
    Shift,
    ShiftHandover,
    StaffNotification,
    Table,
    Tenant,
    User,
)
from app.schemas import BootstrapOwnerIn, LoginIn, PinLoginIn, RefreshIn, TokenOut
from app.core.config import settings
from app.security import (
    create_access_token,
    create_refresh_token,
    create_trusted_device_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
PIN_MAX_FAILED_ATTEMPTS = 10
PIN_LOCKOUT_MINUTES = 5
_pin_attempt_tracker: dict[str, dict[str, datetime | int]] = {}


def _pin_attempt_key(request: Request, tenant_id: str) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    client_host = request.client.host if request.client else ""
    return f"{tenant_id}:{forwarded or client_host or 'unknown'}"


def _consume_pin_attempts(request: Request, tenant_id: str) -> None:
    key = _pin_attempt_key(request, tenant_id)
    now = datetime.utcnow()
    state = _pin_attempt_tracker.get(key, {})
    locked_until = state.get("locked_until")
    if isinstance(locked_until, datetime) and now < locked_until:
        raise HTTPException(status_code=423, detail="Too many invalid PIN attempts. Try again later.")
    if isinstance(locked_until, datetime) and now >= locked_until:
        state = {}

    attempts = int(state.get("attempts", 0)) + 1
    next_state: dict[str, datetime | int] = {"attempts": attempts}
    if attempts >= PIN_MAX_FAILED_ATTEMPTS:
        next_state["locked_until"] = now + timedelta(minutes=PIN_LOCKOUT_MINUTES)
    _pin_attempt_tracker[key] = next_state


def _reset_pin_attempts(request: Request, tenant_id: str) -> None:
    _pin_attempt_tracker.pop(_pin_attempt_key(request, tenant_id), None)


def _issue_tokens_for_user(db: Session, tenant: Tenant, user: User) -> dict:
    access = create_access_token(subject=user.id, tenant_id=tenant.id, role=user.role)
    refresh = create_refresh_token(subject=user.id, tenant_id=tenant.id)

    refresh_row = RefreshToken(
        tenant_id=tenant.id,
        user_id=user.id,
        token_hash=hash_token(refresh),
        expires_at=datetime.utcnow() + timedelta(days=7),
        revoked=False,
    )
    db.add(refresh_row)
    db.commit()

    return {
        "access_token": access,
        "refresh_token": refresh,
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "tenant_id": tenant.id,
        },
    }


def _request_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    client_host = request.client.host if request.client else ""
    return forwarded or client_host or "ip_unknown"


def _is_trusted_device(request: Request, tenant: Tenant, user: User) -> bool:
    token = str(request.headers.get("x-trusted-device-token") or "").strip()
    device_hash = str(request.headers.get("x-device-hash") or "").strip()
    if not token or not device_hash:
        return False
    try:
        data = decode_token(token)
    except Exception:
        return False
    if data.get("type") != "trusted_device":
        return False
    if data.get("sub") != user.id:
        return False
    if data.get("tenant_id") != tenant.id:
        return False
    if data.get("device_hash") != device_hash:
        return False
    return True


def _assert_platform_domain(tenant: Tenant) -> None:
    if tenant.domain != settings.platform_tenant_domain:
        raise HTTPException(status_code=403, detail="Platform owner bootstrap is only allowed on the platform domain")


def _has_platform_owner(db: Session, tenant_id: str) -> bool:
    return (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.role == "super_admin", User.is_active == True)
        .first()
        is not None
    )


def _ensure_demo_user(db: Session, tenant_id: str, username: str, password: str, role: str, pin: str | None = None):
    row = db.query(User).filter(User.tenant_id == tenant_id, User.username == username).first()
    if not row:
        row = User(
            tenant_id=tenant_id,
            username=username,
            email=None,
            password_hash=hash_password(password),
            pin_hash=hash_password(pin or password) if pin or role in {"staff", "kitchen"} else None,
            role=role,
            is_active=True,
        )
        db.add(row)
        return

    row.password_hash = hash_password(password)
    row.pin_hash = hash_password(pin or password) if pin or role in {"staff", "kitchen"} else row.pin_hash
    row.role = role
    row.is_active = True
    row.failed_attempts = 0
    row.locked_until = None


def _reset_demo_tenant_runtime(db: Session, tenant: Tenant):
    db.query(RefreshToken).filter(RefreshToken.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(AuditLog).filter(AuditLog.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Sale).filter(Sale.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(KitchenOrder).filter(KitchenOrder.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Table).filter(Table.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Recipe).filter(Recipe.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Setting).filter(Setting.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(ShiftHandover).filter(ShiftHandover.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Customer).filter(Customer.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Notification).filter(Notification.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(StaffNotification).filter(StaffNotification.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(HappyHour).filter(HappyHour.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(MenuItem).filter(MenuItem.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Shift).filter(Shift.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(RewardClaim).filter(RewardClaim.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(LoyaltyLedgerEntry).filter(LoyaltyLedgerEntry.tenant_id == tenant.id).delete(synchronize_session=False)

    _ensure_demo_user(db, tenant.id, settings.demo_admin_username, settings.demo_admin_password, "admin")
    _ensure_demo_user(db, tenant.id, settings.demo_manager_username, settings.demo_manager_password, "manager")
    _ensure_demo_user(db, tenant.id, settings.demo_staff_username, settings.demo_staff_pin, "staff", settings.demo_staff_pin)
    _ensure_demo_user(db, tenant.id, settings.demo_kitchen_username, settings.demo_kitchen_pin, "kitchen", settings.demo_kitchen_pin)

    db.add_all(
        [
            MenuItem(tenant_id=tenant.id, item_name="Espresso", category="Coffee", price="3.00", is_coffee=True, is_active=True),
            MenuItem(tenant_id=tenant.id, item_name="Americano", category="Coffee", price="4.00", is_coffee=True, is_active=True),
            MenuItem(tenant_id=tenant.id, item_name="Cappuccino", category="Coffee", price="4.80", is_coffee=True, is_active=True),
            MenuItem(tenant_id=tenant.id, item_name="Cheesecake", category="Dessert", price="6.50", is_coffee=False, is_active=True),
        ]
    )
    db.add_all(
        [
            Table(tenant_id=tenant.id, label="Table 1", is_occupied=False, total="0", items_json="[]"),
            Table(tenant_id=tenant.id, label="Table 2", is_occupied=False, total="0", items_json="[]"),
            Table(tenant_id=tenant.id, label="Table 3", is_occupied=False, total="0", items_json="[]"),
        ]
    )
    db.add_all(
        [
            InventoryItem(tenant_id=tenant.id, name="Coffee Beans", unit="kq", category="Raw Material", stock_qty="3.000", unit_cost="18.0000", min_limit="1.000"),
            InventoryItem(tenant_id=tenant.id, name="Milk", unit="litr", category="Raw Material", stock_qty="20.000", unit_cost="2.2000", min_limit="8.000"),
            InventoryItem(tenant_id=tenant.id, name="Paper Cup", unit="ədəd", category="Packaging", stock_qty="150.000", unit_cost="0.1000", min_limit="60.000"),
        ]
    )
    db.add_all(
        [
            Recipe(tenant_id=tenant.id, menu_item_name="Espresso", ingredient_name="Coffee Beans", quantity_required="0.0180"),
            Recipe(tenant_id=tenant.id, menu_item_name="Americano", ingredient_name="Coffee Beans", quantity_required="0.0180"),
            Recipe(tenant_id=tenant.id, menu_item_name="Cappuccino", ingredient_name="Coffee Beans", quantity_required="0.0180"),
            Recipe(tenant_id=tenant.id, menu_item_name="Cappuccino", ingredient_name="Milk", quantity_required="0.1800"),
        ]
    )
    db.add(Setting(tenant_id=tenant.id, key="qr_settings", value=f'{{"base_url":"https://{tenant.domain}"}}'))
    db.commit()


@router.get("/bootstrap-owner/status")
def bootstrap_owner_status(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    _assert_platform_domain(tenant)
    return {"available": not _has_platform_owner(db, tenant.id)}


@router.post("/bootstrap-owner", response_model=TokenOut)
def bootstrap_owner(
    payload: BootstrapOwnerIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    _assert_platform_domain(tenant)
    if _has_platform_owner(db, tenant.id):
        raise HTTPException(status_code=409, detail="Platform owner already exists")

    username = str(payload.username or "").strip()
    password = str(payload.password or "")
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    exists = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, func.lower(User.username) == username.lower())
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = User(
        tenant_id=tenant.id,
        username=username,
        email=settings.superadmin_email,
        password_hash=hash_password(password),
        role="super_admin",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _issue_tokens_for_user(db, tenant, user)


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    username_norm = (payload.username or "").strip().lower()
    user = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, func.lower(User.username) == username_norm, User.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.role == "super_admin" and tenant.domain != settings.platform_tenant_domain:
        raise HTTPException(status_code=403, detail="Super admin can only sign in on the platform domain")

    now = datetime.utcnow()
    if user.locked_until and now < user.locked_until:
        raise HTTPException(status_code=423, detail="Account temporarily locked")

    if not verify_password(payload.password, user.password_hash):
        user.failed_attempts = (user.failed_attempts or 0) + 1
        if user.failed_attempts >= 5:
            user.locked_until = now + timedelta(minutes=5)
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    trusted_device = False if user.role == "super_admin" else _is_trusted_device(request, tenant, user)

    if bool(user.totp_enabled) and user.totp_secret and not trusted_device:
        code = str(payload.second_factor_code or "").strip().replace(" ", "")
        if not code:
            raise HTTPException(status_code=401, detail="2FA_REQUIRED")
        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(code, valid_window=1):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")

    user.failed_attempts = 0
    user.locked_until = None

    result = _issue_tokens_for_user(db, tenant, user)
    remember_device = bool(payload.remember_device)
    device_hash = str(request.headers.get("x-device-hash") or "").strip()
    if user.role != "super_admin" and bool(user.totp_enabled) and user.totp_secret and remember_device and device_hash:
        result["trusted_device_token"] = create_trusted_device_token(
            subject=user.id,
            tenant_id=tenant.id,
            device_hash=device_hash,
            ip=_request_ip(request),
        )
    return result


@router.post("/pin-login", response_model=TokenOut)
def pin_login(payload: PinLoginIn, request: Request, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    pin = str(payload.pin or "").strip()
    if not pin:
        raise HTTPException(status_code=400, detail="PIN required")

    users = (
        db.query(User)
        .filter(
            User.tenant_id == tenant.id,
            User.is_active == True,
            User.role.in_(["staff", "kitchen"]),
        )
        .all()
    )

    now = datetime.utcnow()
    _consume_pin_attempts(request, tenant.id)
    matched: User | None = None
    for u in users:
        if u.locked_until and now < u.locked_until:
            continue
        pin_hash = u.pin_hash or u.password_hash
        if pin_hash and verify_password(pin, pin_hash):
            matched = u
            break

    if not matched:
        raise HTTPException(status_code=401, detail="Invalid PIN")

    _reset_pin_attempts(request, tenant.id)
    matched.failed_attempts = 0
    matched.locked_until = None
    db.flush()

    return _issue_tokens_for_user(db, tenant, matched)


@router.post("/refresh", response_model=TokenOut)
def refresh_token(payload: RefreshIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    try:
        data = decode_token(payload.refresh_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if data.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token type")
    if data.get("tenant_id") != tenant.id:
        raise HTTPException(status_code=401, detail="Tenant mismatch")

    token_hash = hash_token(payload.refresh_token)
    token_row = (
        db.query(RefreshToken)
        .filter(
            RefreshToken.token_hash == token_hash,
            RefreshToken.tenant_id == tenant.id,
            RefreshToken.revoked == False,
        )
        .first()
    )
    if not token_row:
        raise HTTPException(status_code=401, detail="Refresh token revoked")
    if datetime.utcnow() > token_row.expires_at:
        raise HTTPException(status_code=401, detail="Refresh token expired")

    user = db.query(User).filter(User.id == data.get("sub"), User.tenant_id == tenant.id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    token_row.revoked = True
    access = create_access_token(subject=user.id, tenant_id=tenant.id, role=user.role)
    refresh = create_refresh_token(subject=user.id, tenant_id=tenant.id)

    db.add(
        RefreshToken(
            tenant_id=tenant.id,
            user_id=user.id,
            token_hash=hash_token(refresh),
            expires_at=datetime.utcnow() + timedelta(days=7),
            revoked=False,
        )
    )
    db.commit()

    return {
        "access_token": access,
        "refresh_token": refresh,
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "tenant_id": tenant.id,
        },
    }


@router.post("/logout")
def logout(payload: RefreshIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    token_hash = hash_token(payload.refresh_token)
    row = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash, RefreshToken.tenant_id == tenant.id).first()
    if row:
        row.revoked = True
        db.commit()
    if settings.demo_tenant_enabled and tenant.domain == settings.demo_tenant_domain:
        _reset_demo_tenant_runtime(db, tenant)
    return {"success": True}


@router.get("/me")
def me(user=Depends(get_current_user), tenant: Tenant = Depends(get_tenant)):
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "tenant_id": tenant.id,
    }
