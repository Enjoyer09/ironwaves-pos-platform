from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Tenant


def resolve_tenant_from_request(request: Request, db: Session) -> Tenant | None:
    # 1) Prefer frontend host/domain header (Plan B)
    domain = (request.headers.get("x-tenant-domain") or "").split(":")[0].lower().strip()
    if not domain:
        domain = (request.headers.get("host") or "").split(":")[0].lower().strip()

    if not domain:
        return None

    # 2) Use tenant_domains mapping table if present
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
        # If tenant_domains does not exist or query fails, fallback to Tenant.domain
        pass

    # 3) Fallback: tenants.domain
    tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
    if tenant:
        return tenant

    # 4) Final fallback: explicit tenant id if provided
    explicit = request.headers.get("x-tenant-id")
    if explicit:
        tenant = db.query(Tenant).filter(Tenant.id == explicit).first()
        if tenant:
            return tenant

    return None
