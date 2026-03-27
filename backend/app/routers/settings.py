from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import Tenant, User
from app.security import hash_password, verify_password

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
            two_factor_enabled=bool(u.pin_hash),
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
    if role in {"admin", "manager"} and len(password) < 4:
        raise HTTPException(status_code=400, detail="Password required (min 4 chars) for admin/manager")
    if role in {"staff", "kitchen"} and (len(pin) < 4 or len(pin) > 15):
        raise HTTPException(status_code=400, detail="PIN required (4-15 digits) for staff/kitchen")

    row = User(
        tenant_id=tenant.id,
        username=username,
        password_hash=hash_password(password if password else pin),
        pin_hash=hash_password(pin) if pin else None,
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
        two_factor_enabled=bool(row.pin_hash),
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
        password = str(payload.password)
        if len(password) < 4:
            raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
        if row.id == current_user.id:
            current_password = str(payload.current_password or "")
            if not current_password or not verify_password(current_password, row.password_hash):
                raise HTTPException(status_code=401, detail="Current password is incorrect")
        row.password_hash = hash_password(password)

    if payload.pin is not None:
        pin = str(payload.pin).strip()
        if len(pin) < 4 or len(pin) > 15:
            raise HTTPException(status_code=400, detail="PIN must be 4-15 digits")
        row.pin_hash = hash_password(pin)

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
    if row.role == "super_admin":
        raise HTTPException(status_code=400, detail="Super admin cannot be deleted")
    if row.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    row.is_active = False
    db.commit()
    return {"success": True}
