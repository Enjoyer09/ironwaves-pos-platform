from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import RefreshToken, Tenant, User
from app.schemas import LoginIn, PinLoginIn, RefreshIn, TokenOut
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_token,
    verify_password,
)


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


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


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    user = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, User.username == payload.username, User.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    now = datetime.utcnow()
    if user.locked_until and now < user.locked_until:
        raise HTTPException(status_code=423, detail="Account temporarily locked")

    if not verify_password(payload.password, user.password_hash):
        user.failed_attempts = (user.failed_attempts or 0) + 1
        if user.failed_attempts >= 5:
            user.locked_until = now + timedelta(minutes=5)
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user.failed_attempts = 0
    user.locked_until = None

    return _issue_tokens_for_user(db, tenant, user)


@router.post("/pin-login", response_model=TokenOut)
def pin_login(payload: PinLoginIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    pin = str(payload.pin or "").strip()
    if not pin:
        raise HTTPException(status_code=400, detail="PIN required")

    users = (
        db.query(User)
        .filter(
            User.tenant_id == tenant.id,
            User.is_active == True,
            User.role.in_(["staff", "manager", "kitchen"]),
        )
        .all()
    )

    now = datetime.utcnow()
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
    return {"success": True}


@router.get("/me")
def me(user=Depends(get_current_user), tenant: Tenant = Depends(get_tenant)):
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "tenant_id": tenant.id,
    }