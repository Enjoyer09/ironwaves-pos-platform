from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Tenant


def resolve_tenant_from_request(request: Request, db: Session) -> Tenant | None:
    # 1) Explicit tenant id (legacy fallback)
    explicit = request.headers.get("x-tenant-id")
    if explicit:
        tenant = db.query(Tenant).filter(Tenant.id == explicit).first()
        if tenant:
            return tenant

    # 2) Prefer frontend domain header (Plan B)
    domain = (request.headers.get("x-tenant-domain") or "").split(":")[0].lower().strip()

    # 3) fallback to request host
    if not domain:
        domain = (request.headers.get("host") or "").split(":")[0].lower().strip()
    if not domain and request.url and request.url.hostname:
        domain = str(request.url.hostname).lower().strip()

    if not domain:
        return None

    # 4) Try tenant_domains table (if exists)
    try:
        row = db.execute(
            text(
                """
                SELECT tenant_id
                FROM tenant_domains
                WHERE domain = :d
                  AND (is_active IS NULL OR is_active = TRUE)
                LIMIT 1
                """
            ),
            {"d": domain},
        ).fetchone()
        if row and row[0]:
            tenant = db.query(Tenant).filter(Tenant.id == row[0]).first()
            if tenant:
                return tenant
    except Exception:
        # table may not exist yet
        pass

    # 5) Fallback: tenants.domain
    tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
    if tenant:
        return tenant

    return None
