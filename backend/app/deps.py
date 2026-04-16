from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session
from datetime import datetime

from app.db import get_db
from app.core.config import settings
from app.models import RevokedToken, Tenant, User
from app.security import decode_token, hash_token
from app.tenant import resolve_tenant_from_request

_redis_token_client = None


def _get_redis_token_client():
    global _redis_token_client
    if _redis_token_client is not None:
        return _redis_token_client
    if not settings.redis_url:
        _redis_token_client = False
        return None
    try:
        from redis import Redis
        _redis_token_client = Redis.from_url(settings.redis_url, decode_responses=True)
    except Exception:
        _redis_token_client = False
        return None
    return _redis_token_client


def _is_token_revoked(tenant_id: str, token_hash: str, db: Session) -> bool:
    redis_client = _get_redis_token_client()
    if redis_client:
        try:
            if redis_client.exists(f"ironwaves:revoked:{tenant_id}:{token_hash}"):
                return True
        except Exception:
            pass
    return (
        db.query(RevokedToken)
        .filter(RevokedToken.tenant_id == tenant_id, RevokedToken.token_hash == token_hash)
        .first()
        is not None
    )


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

    token_hash = hash_token(token)
    db.query(RevokedToken).filter(RevokedToken.expires_at < datetime.utcnow()).delete(synchronize_session=False)
    if _is_token_revoked(tenant.id, token_hash, db):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")

    user = (
        db.query(User)
        .filter(User.id == payload.get("sub"), User.tenant_id == tenant.id, User.is_active == True)
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def get_super_admin(user: User = Depends(get_current_user), tenant: Tenant = Depends(get_tenant)) -> User:
    if user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    if tenant.domain != settings.platform_tenant_domain:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin is limited to the platform domain")
    return user
