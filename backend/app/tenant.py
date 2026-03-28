from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Tenant


def resolve_tenant_from_request(request: Request, db: Session) -> Tenant | None:
    # Single-tenant fallback mode: ignore domain mapping complexity.
    if settings.single_tenant_mode:
        if settings.single_tenant_id:
            tenant = db.query(Tenant).filter(Tenant.id == settings.single_tenant_id).first()
            if tenant:
                return tenant
        # Last resort: first active tenant.
        tenant = db.query(Tenant).filter(Tenant.status == "active").order_by(Tenant.created_at.asc()).first()
        if tenant:
            return tenant

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
        # Backward compatibility for schemas where tenant_domains has no is_active column.
        try:
            row = db.execute(
                text(
                    """
                    SELECT tenant_id
                    FROM tenant_domains
                    WHERE domain = :d
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

    # 4) Legacy header fallback is opt-in only for local/dev compatibility.
    if settings.allow_legacy_tenant_header_fallback or settings.single_tenant_mode:
        explicit = (request.headers.get("x-tenant-id") or "").strip()
        if explicit:
            tenant = db.query(Tenant).filter(Tenant.id == explicit).first()
            if tenant:
                return tenant

    return None
