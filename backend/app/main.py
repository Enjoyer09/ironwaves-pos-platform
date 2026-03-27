from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import Base, engine, SessionLocal
from app.models import Tenant, User
from app.routers import auth, finance, pos, reports, settings, tenants
from app.security import hash_password


app = FastAPI(title=settings.app_name)


def _parse_cors_origins(raw: str) -> list[str]:
    items = [v.strip() for v in str(raw or '').split(',') if v.strip()]
    return items or ["http://localhost:5173"]

_origins = _parse_cors_origins(settings.cors_origins)
_allow_credentials = not (_origins == ["*"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _seed_initial_data(db: Session):
    tenant = db.query(Tenant).filter(Tenant.slug == settings.default_tenant_slug).first()
    if not tenant:
        tenant = Tenant(
            name=settings.default_tenant_name,
            slug=settings.default_tenant_slug,
            domain=settings.default_tenant_domain,
            status="active",
            created_at=datetime.utcnow(),
        )
        db.add(tenant)
        db.flush()

    super_exists = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, User.username == settings.superadmin_username)
        .first()
    )
    if not super_exists:
        db.add(
            User(
                tenant_id=tenant.id,
                username=settings.superadmin_username,
                email=settings.superadmin_email,
                password_hash=hash_password(settings.superadmin_password),
                role="super_admin",
                is_active=True,
            )
        )
    else:
        # Keep platform owner always recoverable in deployments.
        super_exists.password_hash = hash_password(settings.superadmin_password)
        super_exists.role = "super_admin"
        super_exists.is_active = True
        super_exists.failed_attempts = 0
        super_exists.locked_until = None

    # Seed demo staff users for PIN login tests in non-production setups.
    staff_seed = [
        ("barista", "1234", "staff"),
        ("barista2", "5678", "staff"),
    ]
    for username, pin, role in staff_seed:
        row = (
            db.query(User)
            .filter(User.tenant_id == tenant.id, User.username == username)
            .first()
        )
        if not row:
            db.add(
                User(
                    tenant_id=tenant.id,
                    username=username,
                    email=None,
                    password_hash=hash_password(pin),
                    pin_hash=hash_password(pin),
                    role=role,
                    is_active=True,
                )
            )
        elif not row.pin_hash:
            row.pin_hash = hash_password(pin)
    db.commit()


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        _seed_initial_data(db)


@app.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name}


app.include_router(auth.router)
app.include_router(pos.router)
app.include_router(finance.router)
app.include_router(reports.router)
app.include_router(tenants.router)
app.include_router(settings.router)
