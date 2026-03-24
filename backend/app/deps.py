from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Tenant, User
from app.security import decode_token
from app.tenant import resolve_tenant_from_request


def get_tenant(request: Request, db: Session = Depends(get_db)) -> Tenant:
    tenant = resolve_tenant_from_request(request, db)
    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant not configured for this domain")
    if tenant.status != "active":
        raise HTTPException(status_code=403, detail="Tenant is suspended")
    return tenant


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    token = authorization.split(" ", 1)[1]
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    if payload.get("tenant_id") != tenant.id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Tenant mismatch")

    user = (
        db.query(User)
        .filter(User.id == payload.get("sub"), User.tenant_id == tenant.id, User.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def get_super_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return user