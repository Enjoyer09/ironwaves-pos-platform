from fastapi import Request
from sqlalchemy.orm import Session

from app.models import Tenant


def resolve_tenant_from_request(request: Request, db: Session) -> Tenant | None:
    explicit = request.headers.get("x-tenant-id")
    if explicit:
        return db.query(Tenant).filter(Tenant.id == explicit).first()

    host = (request.headers.get("host") or "").split(":")[0].lower()
    if not host:
        return None

    tenant = db.query(Tenant).filter(Tenant.domain == host).first()
    if tenant:
        return tenant

    return None