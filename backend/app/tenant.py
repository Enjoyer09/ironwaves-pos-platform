import logging

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import ProgrammingError

from app.core.config import settings
from app.models import Tenant

logger = logging.getLogger("ironwaves.tenant")

_redis_tenant_cache = None


def _get_redis_tenant_client():
    global _redis_tenant_cache
    if _redis_tenant_cache is not None:
        return _redis_tenant_cache
    if not settings.redis_url:
        _redis_tenant_cache = False
        return None
    try:
        from redis import Redis
        _redis_tenant_cache = Redis.from_url(settings.redis_url, decode_responses=True)
    except Exception:
        _redis_tenant_cache = False
        return None
    return _redis_tenant_cache


def _normalize_domain(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if not value:
        return ""
    if value.startswith("http://"):
        value = value[7:]
    elif value.startswith("https://"):
        value = value[8:]
    value = value.split("/")[0].split("?")[0].split("#")[0]
    value = value.split(":")[0]
    return value.strip(".")


def _wildcard_slug(domain: str) -> str:
    safe = _normalize_domain(domain)
    parts = safe.split(".")
    if len(parts) < 3:
        return ""
    if ".".join(parts[1:]) != "ironwaves.store":
        return ""
    return parts[0].strip().lower()


def _alias(slug: str, name: str, aliases: list[str]) -> dict:
    safe_aliases = [str(alias or "").strip().lower() for alias in aliases if str(alias or "").strip()]
    return {"slug": slug, "name": name, "aliases": safe_aliases}


TENANT_DOMAIN_ALIASES = {}
for _domain in ["emalatkhana.ironwaves.store", "emalatxana.ironwaves.store"]:
    TENANT_DOMAIN_ALIASES[_domain] = _alias(
        "emalatxana",
        "Emalatxana",
        ["emalatkhana.ironwaves.store", "emalatxana.ironwaves.store"],
    )

# Common typo/alternate spelling used while provisioning the coffee tenant.
for _domain in ["emalatkofe.ironwaves.store", "emalatkoe.ironwaves.store"]:
    TENANT_DOMAIN_ALIASES[_domain] = _alias(
        "emalatkofe",
        "EmalatKofe",
        ["emalatkofe.ironwaves.store", "emalatkoe.ironwaves.store"],
    )


def _sync_single_domain_alias(db: Session, tenant_id: str, domain: str) -> None:
    safe_domain = str(domain or "").strip().lower()
    if not safe_domain or not tenant_id:
        return
    _sync_domain_aliases(db, tenant_id, [safe_domain])


def _resolve_slug_fallback_tenant(domain: str, db: Session) -> Tenant | None:
    safe_domain = _normalize_domain(domain)
    if not safe_domain:
        return None
    slug = _wildcard_slug(safe_domain)
    if not slug:
        return None
    tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if not tenant:
        return None
    _sync_single_domain_alias(db, tenant.id, safe_domain)
    db.commit()
    return tenant


def _sync_domain_aliases(db: Session, tenant_id: str, aliases: list[str]) -> None:
    for alias in aliases:
        safe_alias = str(alias or "").strip().lower()
        if not safe_alias:
            continue
        try:
            db.execute(
                text(
                    """
                    INSERT INTO tenant_domains (domain, tenant_id, is_active)
                    VALUES (:domain, :tenant_id, TRUE)
                    ON CONFLICT (domain)
                    DO UPDATE SET tenant_id = EXCLUDED.tenant_id, is_active = TRUE
                    """
                ),
                {"domain": safe_alias, "tenant_id": tenant_id},
            )
        except ProgrammingError:
            try:
                db.execute(
                    text(
                        """
                        INSERT INTO tenant_domains (domain, tenant_id)
                        VALUES (:domain, :tenant_id)
                        ON CONFLICT (domain)
                        DO UPDATE SET tenant_id = EXCLUDED.tenant_id
                        """
                    ),
                    {"domain": safe_alias, "tenant_id": tenant_id},
                )
            except ProgrammingError:
                pass


def _resolve_known_alias_tenant(domain: str, db: Session) -> Tenant | None:
    alias = TENANT_DOMAIN_ALIASES.get(domain)
    if not alias:
        return None
    tenant = db.query(Tenant).filter(Tenant.slug == alias["slug"]).first()
    if not tenant:
        # Never auto-create a tenant just because a known alias domain was visited.
        # Deleted/suspended tenants must stay deleted/suspended until a super admin
        # explicitly provisions them again.
        return None
    _sync_domain_aliases(db, tenant.id, alias["aliases"])
    db.commit()
    return tenant


def resolve_tenant_from_request(request: Request, db: Session) -> Tenant | None:
    request_id = str(getattr(getattr(request, "state", None), "request_id", "") or "")

    def _remember(source: str, domain: str, tenant: Tenant | None) -> None:
        try:
            request.state.tenant_resolution_source = source
            request.state.tenant_resolution_domain = domain
            request.state.tenant_resolution_tenant_id = tenant.id if tenant else None

            # Cache successfully resolved tenant in Redis for 5 minutes (300s)
            if tenant and domain and source != "redis_cache":
                r_client = _get_redis_tenant_client()
                if r_client:
                    r_client.setex(f"ironwaves:tenant-by-domain:{domain}", 300, tenant.id)
        except Exception:
            pass

    def _log(event: str, **extra) -> None:
        if not settings.tenant_resolution_debug:
            return
        logger.info(
            {
                "event": event,
                "request_id": request_id,
                "path": request.url.path,
                **extra,
            }
        )

    # Single-tenant fallback mode: ignore domain mapping complexity.
    if settings.single_tenant_mode:
        if settings.single_tenant_id:
            tenant = db.query(Tenant).filter(Tenant.id == settings.single_tenant_id).first()
            if tenant:
                _remember("single_tenant_id", "", tenant)
                _log("tenant_resolved", source="single_tenant_id", tenant_id=tenant.id, tenant_slug=tenant.slug)
                return tenant
        # Last resort: first active tenant.
        tenant = db.query(Tenant).filter(Tenant.status == "active").order_by(Tenant.created_at.asc()).first()
        if tenant:
            _remember("single_tenant_first_active", "", tenant)
            _log("tenant_resolved", source="single_tenant_first_active", tenant_id=tenant.id, tenant_slug=tenant.slug)
            return tenant

    explicit = (request.headers.get("x-tenant-id") or "").strip()
    has_auth_context = bool((request.headers.get("authorization") or "").strip())

    # Domain is the security boundary for public/auth routes. Never trust
    # caller-controlled x-tenant-id before resolving the requested host.
    domain = _normalize_domain(request.headers.get("x-tenant-domain"))
    if not domain:
        domain = _normalize_domain(request.headers.get("host"))
    _log(
        "tenant_resolve_attempt",
        domain=domain,
        host=request.headers.get("host"),
        x_tenant_domain=request.headers.get("x-tenant-domain"),
        x_tenant_id=explicit or None,
    )

    # ── Redis Cache Lookup ──
    redis_client = _get_redis_tenant_client()
    if redis_client and domain:
        try:
            cached_id = redis_client.get(f"ironwaves:tenant-by-domain:{domain}")
            if cached_id:
                tenant = db.query(Tenant).filter(Tenant.id == cached_id).first()
                if tenant:
                    _remember("redis_cache", domain, tenant)
                    _log("tenant_resolved", source="redis_cache", domain=domain, tenant_id=tenant.id, tenant_slug=tenant.slug)
                    return tenant
        except Exception as e:
            logger.warning(f"Redis tenant cache read error: {e}")

    if domain:
        # 1) Use tenant_domains mapping table if present
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
                    requested_slug = _wildcard_slug(domain)
                    if requested_slug and requested_slug != str(tenant.slug or "").strip().lower():
                        tenant_by_slug = db.query(Tenant).filter(Tenant.slug == requested_slug).first()
                        if tenant_by_slug:
                            _sync_single_domain_alias(db, tenant_by_slug.id, domain)
                            db.commit()
                            _remember("tenant_domains_slug_override", domain, tenant_by_slug)
                            _log("tenant_resolved", source="tenant_domains_slug_override", domain=domain, tenant_id=tenant_by_slug.id, tenant_slug=tenant_by_slug.slug)
                            return tenant_by_slug
                    _remember("tenant_domains_active", domain, tenant)
                    _log("tenant_resolved", source="tenant_domains_active", domain=domain, tenant_id=tenant.id, tenant_slug=tenant.slug)
                    return tenant
        except ProgrammingError:
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
                        requested_slug = _wildcard_slug(domain)
                        if requested_slug and requested_slug != str(tenant.slug or "").strip().lower():
                            tenant_by_slug = db.query(Tenant).filter(Tenant.slug == requested_slug).first()
                            if tenant_by_slug:
                                _sync_single_domain_alias(db, tenant_by_slug.id, domain)
                                db.commit()
                                _remember("tenant_domains_legacy_slug_override", domain, tenant_by_slug)
                                _log("tenant_resolved", source="tenant_domains_legacy_slug_override", domain=domain, tenant_id=tenant_by_slug.id, tenant_slug=tenant_by_slug.slug)
                                return tenant_by_slug
                        _remember("tenant_domains_legacy", domain, tenant)
                        _log("tenant_resolved", source="tenant_domains_legacy", domain=domain, tenant_id=tenant.id, tenant_slug=tenant.slug)
                        return tenant
            except ProgrammingError:
                # If tenant_domains does not exist or query fails, fallback to Tenant.domain
                pass

        # 2) Fallback: tenants.domain
        tenant = db.query(Tenant).filter(Tenant.domain == domain).first()
        if tenant:
            _remember("tenant_domain_column", domain, tenant)
            _log("tenant_resolved", source="tenant_domain_column", domain=domain, tenant_id=tenant.id, tenant_slug=tenant.slug)
            return tenant

        tenant = _resolve_known_alias_tenant(domain, db)
        if tenant:
            _remember("known_domain_alias", domain, tenant)
            _log("tenant_resolved", source="known_domain_alias", domain=domain, tenant_id=tenant.id, tenant_slug=tenant.slug)
            return tenant

        # Self-heal missing tenant_domains rows for managed wildcard domains
        # (e.g. socialbee.ironwaves.store -> slug: socialbee).
        tenant = _resolve_slug_fallback_tenant(domain, db)
        if tenant:
            _remember("slug_wildcard", domain, tenant)
            _log("tenant_resolved", source="slug_wildcard", domain=domain, tenant_id=tenant.id, tenant_slug=tenant.slug)
            return tenant

    # Legacy header fallback is opt-in and only allowed on authenticated traffic.
    if explicit and has_auth_context and settings.allow_legacy_tenant_header_fallback:
        tenant = db.query(Tenant).filter(Tenant.id == explicit).first()
        if tenant:
            _remember("legacy_header_fallback", domain, tenant)
            _log("tenant_resolved", source="legacy_header_fallback", domain=domain, tenant_id=tenant.id, tenant_slug=tenant.slug)
            return tenant

    _remember("not_found", domain, None)
    _log("tenant_resolve_failed", domain=domain, host=request.headers.get("host"), x_tenant_domain=request.headers.get("x-tenant-domain"), x_tenant_id=explicit or None)
    return None
