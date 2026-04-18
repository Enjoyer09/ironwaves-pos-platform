from datetime import datetime, timedelta
import json
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
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
    RevokedToken,
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
from app.schemas import BootstrapOwnerIn, LoginIn, PinLoginIn, RefreshIn, TokenOut, VerifyPasswordIn
from app.core.config import settings
from app.security import (
    create_access_token,
    create_refresh_token,
    create_trusted_device_token,
    decode_token,
    hash_password,
    hash_token,
    validate_password_policy,
    verify_password,
)


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_pin_attempt_tracker: dict[str, dict[str, datetime | int]] = {}
_redis_security_client = None


def _get_redis_security_client():
    global _redis_security_client
    if _redis_security_client is not None:
        return _redis_security_client
    if not settings.redis_url:
        _redis_security_client = False
        return None
    try:
        from redis import Redis
        _redis_security_client = Redis.from_url(settings.redis_url, decode_responses=True)
    except Exception:
        _redis_security_client = False
        return None
    return _redis_security_client


def _pin_attempt_key(request: Request, tenant_id: str) -> str:
    client_host = request.client.host if request.client else ""
    return f"{tenant_id}:{client_host or 'unknown'}"


def _consume_pin_attempts(request: Request, tenant_id: str) -> None:
    key = _pin_attempt_key(request, tenant_id)
    now = datetime.utcnow()
    redis_client = _get_redis_security_client()
    if redis_client:
        try:
            redis_key = f"ironwaves:pin-attempts:{key}"
            raw = redis_client.get(redis_key)
            if raw:
                state = json.loads(str(raw))
                locked_until_ts = float(state.get("locked_until_ts") or 0)
                if locked_until_ts and time.time() < locked_until_ts:
                    raise HTTPException(status_code=423, detail="Too many invalid PIN attempts. Try again later.")
            else:
                state = {}
            attempts = int(state.get("attempts", 0)) + 1
            next_state: dict[str, int | float] = {"attempts": attempts}
            ttl = max(60, int(settings.pin_lockout_minutes * 60))
            if attempts >= settings.pin_max_failed_attempts:
                next_state["locked_until_ts"] = time.time() + (settings.pin_lockout_minutes * 60)
                ttl = max(ttl, int(settings.pin_lockout_minutes * 60) + 30)
            redis_client.setex(redis_key, ttl, json.dumps(next_state))
            return
        except HTTPException:
            raise
        except Exception:
            # fallback to in-memory tracker
            pass

    state = _pin_attempt_tracker.get(key, {})
    locked_until = state.get("locked_until")
    if isinstance(locked_until, datetime) and now < locked_until:
        raise HTTPException(status_code=423, detail="Too many invalid PIN attempts. Try again later.")
    if isinstance(locked_until, datetime) and now >= locked_until:
        state = {}

    attempts = int(state.get("attempts", 0)) + 1
    next_state: dict[str, datetime | int] = {"attempts": attempts}
    if attempts >= settings.pin_max_failed_attempts:
        next_state["locked_until"] = now + timedelta(minutes=settings.pin_lockout_minutes)
    _pin_attempt_tracker[key] = next_state


def _reset_pin_attempts(request: Request, tenant_id: str) -> None:
    redis_client = _get_redis_security_client()
    if redis_client:
        try:
            redis_client.delete(f"ironwaves:pin-attempts:{_pin_attempt_key(request, tenant_id)}")
        except Exception:
            pass
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


def _refresh_cookie_secure() -> bool:
    app_url = str(settings.app_url or "").strip().lower()
    return settings.app_env.lower() == "production" or app_url.startswith("https://")


def _refresh_cookie_samesite() -> str:
    # Cross-site frontend/backend deployments (e.g. custom frontend domain + Railway backend domain)
    # require SameSite=None so browser sends refresh cookie on XHR/fetch.
    if settings.app_env.lower() == "production":
        return "none"
    return "lax"


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    safe_token = str(refresh_token or "").strip()
    if not safe_token:
        return
    response.set_cookie(
        key="refresh_token",
        value=safe_token,
        httponly=True,
        secure=_refresh_cookie_secure(),
        samesite=_refresh_cookie_samesite(),
        max_age=max(60, int(settings.refresh_token_days * 24 * 60 * 60)),
        path="/api/v1/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key="refresh_token",
        path="/api/v1/auth",
        secure=_refresh_cookie_secure(),
        samesite=_refresh_cookie_samesite(),
    )


def _extract_refresh_token(payload: RefreshIn | None, request: Request) -> str:
    body_token = str((payload.refresh_token if payload else "") or "").strip()
    if body_token:
        return body_token
    cookie_token = str(request.cookies.get("refresh_token") or "").strip()
    return cookie_token


def _request_ip(request: Request) -> str:
    client_host = request.client.host if request.client else ""
    return client_host or "ip_unknown"


def _add_auth_audit_log(db: Session, tenant_id: str, username: str, action: str, request: Request, details: dict | None = None) -> None:
    payload = {
        "username": username,
        "ip": _request_ip(request),
        "user_agent": str(request.headers.get("user-agent") or "")[:240],
        **(details or {}),
    }
    db.add(AuditLog(tenant_id=tenant_id, user=username or "anonymous", action=action, details=json.dumps(payload, ensure_ascii=False)))


def _token_expiry_from_payload(payload: dict) -> datetime:
    exp = payload.get("exp")
    if isinstance(exp, datetime):
        return exp
    if isinstance(exp, (int, float)):
        return datetime.utcfromtimestamp(exp)
    try:
        return datetime.fromtimestamp(float(exp))
    except Exception:
        return datetime.utcnow() + timedelta(minutes=settings.access_token_minutes)


def _blacklist_token(db: Session, tenant_id: str, token: str, token_type: str, user_id: str | None = None) -> None:
    raw = str(token or "").strip()
    if not raw:
        return
    try:
        payload = decode_token(raw)
    except Exception:
        return
    if payload.get("tenant_id") != tenant_id or payload.get("type") != token_type:
        return
    token_hash = hash_token(raw)
    exists = db.query(RevokedToken).filter(RevokedToken.tenant_id == tenant_id, RevokedToken.token_hash == token_hash).first()
    if exists:
        return
    row = RevokedToken(
        tenant_id=tenant_id,
        token_hash=token_hash,
        token_type=token_type,
        user_id=user_id or payload.get("sub"),
        expires_at=_token_expiry_from_payload(payload),
    )
    db.add(row)
    redis_client = _get_redis_security_client()
    if redis_client:
        try:
            ttl = max(60, int((row.expires_at - datetime.utcnow()).total_seconds()))
            redis_client.setex(f"ironwaves:revoked:{tenant_id}:{token_hash}", ttl, "1")
        except Exception:
            pass


def _tenant_pin_min_length(db: Session, tenant_id: str) -> int:
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == "session_settings").first()
    try:
        value = json.loads(row.value or "{}") if row else {}
        configured = int(value.get("staff_pin_length") or settings.pin_min_length)
    except Exception:
        configured = settings.pin_min_length
    return 4 if configured == 4 else 6


def _assert_pin_format(pin: str, min_length: int | None = None) -> None:
    required = int(min_length or settings.pin_min_length)
    if not pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN yalnız rəqəmlərdən ibarət olmalıdır")
    if len(pin) < required or len(pin) > 15:
        raise HTTPException(status_code=400, detail=f"PIN ən azı {required}, ən çox 15 rəqəm olmalıdır")
    if len(set(pin)) == 1:
        raise HTTPException(status_code=400, detail="PIN eyni rəqəmin təkrarından ibarət ola bilməz")
    sequences = "01234567890123456789"
    reverse_sequences = "98765432109876543210"
    if pin in sequences or pin in reverse_sequences:
        raise HTTPException(status_code=400, detail="PIN ardıcıl rəqəmlərdən ibarət ola bilməz")


def _assert_strong_password(password: str) -> None:
    try:
        validate_password_policy(password, min_length=settings.password_min_length)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
    response: Response,
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
    _assert_strong_password(password)

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
    result = _issue_tokens_for_user(db, tenant, user)
    _set_refresh_cookie(response, result.get("refresh_token", ""))
    return result


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    username_norm = (payload.username or "").strip().lower()
    user = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, func.lower(User.username) == username_norm, User.is_active == True)
        .first()
    )
    if not user:
        _add_auth_audit_log(db, tenant.id, username_norm, "AUTH_LOGIN_FAILED", request, {"reason": "unknown_user"})
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.role == "super_admin" and tenant.domain != settings.platform_tenant_domain:
        _add_auth_audit_log(db, tenant.id, user.username, "AUTH_LOGIN_BLOCKED", request, {"reason": "super_admin_wrong_domain"})
        db.commit()
        raise HTTPException(status_code=403, detail="Super admin can only sign in on the platform domain")

    now = datetime.utcnow()
    if user.locked_until and now < user.locked_until:
        _add_auth_audit_log(db, tenant.id, user.username, "AUTH_LOGIN_BLOCKED", request, {"reason": "account_locked"})
        db.commit()
        raise HTTPException(status_code=423, detail="Account temporarily locked")

    if not verify_password(payload.password, user.password_hash):
        user.failed_attempts = (user.failed_attempts or 0) + 1
        if user.failed_attempts >= 5:
            user.locked_until = now + timedelta(minutes=5)
        _add_auth_audit_log(db, tenant.id, user.username, "AUTH_LOGIN_FAILED", request, {"reason": "bad_password", "failed_attempts": user.failed_attempts})
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    trusted_device = False if user.role == "super_admin" else _is_trusted_device(request, tenant, user)

    if bool(user.totp_enabled) and user.totp_secret and not trusted_device:
        code = str(payload.second_factor_code or "").strip().replace(" ", "")
        if not code:
            _add_auth_audit_log(db, tenant.id, user.username, "AUTH_2FA_REQUIRED", request)
            db.commit()
            raise HTTPException(status_code=401, detail="2FA_REQUIRED")
        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(code, valid_window=1):
            _add_auth_audit_log(db, tenant.id, user.username, "AUTH_LOGIN_FAILED", request, {"reason": "bad_2fa"})
            db.commit()
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
    _add_auth_audit_log(db, tenant.id, user.username, "AUTH_LOGIN_SUCCESS", request)
    db.commit()
    _set_refresh_cookie(response, result.get("refresh_token", ""))
    return result


@router.post("/pin-login", response_model=TokenOut)
def pin_login(payload: PinLoginIn, request: Request, response: Response, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    pin = str(payload.pin or "").strip()
    if not pin:
        raise HTTPException(status_code=400, detail="PIN required")
    _assert_pin_format(pin, _tenant_pin_min_length(db, tenant.id))

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
    matches: list[User] = []
    for u in users:
        if u.locked_until and now < u.locked_until:
            continue
        pin_hash = u.pin_hash or u.password_hash
        if pin_hash and verify_password(pin, pin_hash):
            matches.append(u)

    if not matches:
        _add_auth_audit_log(db, tenant.id, "pin_login", "AUTH_PIN_FAILED", request, {"reason": "invalid_pin"})
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid PIN")
    if len(matches) > 1:
        _add_auth_audit_log(db, tenant.id, "pin_login", "AUTH_PIN_BLOCKED", request, {"reason": "duplicate_pin"})
        db.commit()
        raise HTTPException(status_code=409, detail="Bu PIN bir neçə staff hesabında istifadə olunur. PIN-ləri unikal edin.")

    matched = matches[0]

    _reset_pin_attempts(request, tenant.id)
    matched.failed_attempts = 0
    matched.locked_until = None
    db.flush()
    _add_auth_audit_log(db, tenant.id, matched.username, "AUTH_PIN_SUCCESS", request, {"role": matched.role})

    result = _issue_tokens_for_user(db, tenant, matched)
    _set_refresh_cookie(response, result.get("refresh_token", ""))
    return result


@router.post("/refresh", response_model=TokenOut)
def refresh_token(
    request: Request,
    response: Response,
    payload: RefreshIn | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    raw_refresh = _extract_refresh_token(payload, request)
    if not raw_refresh:
        raise HTTPException(status_code=401, detail="Refresh token required")
    try:
        data = decode_token(raw_refresh)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if data.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token type")
    if data.get("tenant_id") != tenant.id:
        raise HTTPException(status_code=401, detail="Tenant mismatch")

    token_hash = hash_token(raw_refresh)
    revoked_exists = (
        db.query(RevokedToken)
        .filter(RevokedToken.tenant_id == tenant.id, RevokedToken.token_hash == token_hash)
        .first()
    )
    if revoked_exists:
        raise HTTPException(status_code=401, detail="Refresh token revoked")
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
    result = {
        "access_token": access,
        "refresh_token": refresh,
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "tenant_id": tenant.id,
        },
    }
    _set_refresh_cookie(response, refresh)
    return result


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    payload: RefreshIn | None = None,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    refresh_token_raw = _extract_refresh_token(payload, request)
    row = None
    if refresh_token_raw:
        token_hash = hash_token(refresh_token_raw)
        row = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash, RefreshToken.tenant_id == tenant.id).first()
        if row:
            row.revoked = True
            _blacklist_token(db, tenant.id, refresh_token_raw, "refresh", row.user_id)
    if authorization and authorization.lower().startswith("bearer "):
        _blacklist_token(db, tenant.id, authorization.split(" ", 1)[1], "access", row.user_id if row else None)
    _add_auth_audit_log(
        db,
        tenant.id,
        "logout",
        "AUTH_LOGOUT",
        request,
        {"refresh_revoked": bool(row), "refresh_token_present": bool(refresh_token_raw)},
    )
    db.commit()
    _clear_refresh_cookie(response)
    if settings.demo_tenant_enabled and tenant.domain == settings.demo_tenant_domain:
        _reset_demo_tenant_runtime(db, tenant)
    return {"success": True}


@router.post("/verify-password")
def verify_current_password(
    payload: VerifyPasswordIn,
    current_user: User = Depends(get_current_user),
):
    raw = str(payload.password or "")
    if not raw:
        raise HTTPException(status_code=400, detail="Password required")
    return {"success": verify_password(raw, current_user.password_hash)}


@router.get("/me")
def me(user=Depends(get_current_user), tenant: Tenant = Depends(get_tenant)):
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "tenant_id": tenant.id,
    }
