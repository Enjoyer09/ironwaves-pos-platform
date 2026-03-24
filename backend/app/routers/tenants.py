from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_super_admin, get_tenant
from app.models import AuditLog, FinanceEntry, MenuItem, RefreshToken, Sale, Shift, Tenant, User
from app.schemas import TenantCloneIn, TenantCreateIn, TenantOut
from app.security import hash_password


router = APIRouter(prefix="/api/v1/admin/tenants", tags=["tenants"])


def _default_menu_rows(tenant_id: str) -> list[MenuItem]:
    return [
        MenuItem(
            tenant_id=tenant_id,
            item_name="Espresso",
            category="Qəhvə",
            price="3.00",
            is_coffee=True,
            is_active=True,
        ),
        MenuItem(
            tenant_id=tenant_id,
            item_name="Cappuccino",
            category="Qəhvə",
            price="4.50",
            is_coffee=True,
            is_active=True,
        ),
        MenuItem(
            tenant_id=tenant_id,
            item_name="Cheesecake",
            category="Şirniyyat",
            price="6.00",
            is_coffee=False,
            is_active=True,
        ),
    ]


@router.get("", response_model=list[TenantOut])
def list_tenants(
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    rows = db.query(Tenant).order_by(Tenant.created_at.desc()).all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "slug": t.slug,
            "domain": t.domain,
            "status": t.status,
        }
        for t in rows
    ]


@router.post("", response_model=TenantOut)
def create_tenant(
    payload: TenantCreateIn,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    slug = payload.slug.strip().lower()
    domain = payload.domain.strip().lower()

    exists = db.query(Tenant).filter((Tenant.slug == slug) | (Tenant.domain == domain)).first()
    if exists:
        raise HTTPException(status_code=400, detail="Tenant slug/domain already exists")

    tenant = Tenant(
        name=payload.name.strip(),
        slug=slug,
        domain=domain,
        status="active",
        created_at=datetime.utcnow(),
    )
    db.add(tenant)
    db.flush()

    db.add(
        User(
            tenant_id=tenant.id,
            username=payload.admin_username.strip(),
            email=None,
            password_hash=hash_password(payload.admin_password),
            role="admin",
            is_active=True,
        )
    )

    for row in _default_menu_rows(tenant.id):
        db.add(row)

    db.commit()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "domain": tenant.domain,
        "status": tenant.status,
    }


@router.post("/{tenant_id}/suspend", response_model=TenantOut)
def suspend_tenant(
    tenant_id: str,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    tenant.status = "suspended"
    db.commit()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "domain": tenant.domain,
        "status": tenant.status,
    }


@router.post("/{tenant_id}/activate", response_model=TenantOut)
def activate_tenant(
    tenant_id: str,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    tenant.status = "active"
    db.commit()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "domain": tenant.domain,
        "status": tenant.status,
    }


@router.post("/{tenant_id}/clone", response_model=TenantOut)
def clone_tenant(
    tenant_id: str,
    payload: TenantCloneIn,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    source = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source tenant not found")

    new_slug = payload.slug.strip().lower()
    new_domain = payload.domain.strip().lower()
    exists = db.query(Tenant).filter((Tenant.slug == new_slug) | (Tenant.domain == new_domain)).first()
    if exists:
        raise HTTPException(status_code=400, detail="Target slug/domain already exists")

    tenant = Tenant(
        name=payload.name.strip(),
        slug=new_slug,
        domain=new_domain,
        status="active",
        created_at=datetime.utcnow(),
    )
    db.add(tenant)
    db.flush()

    db.add(
        User(
            tenant_id=tenant.id,
            username=payload.admin_username.strip(),
            email=None,
            password_hash=hash_password(payload.admin_password),
            role="admin",
            is_active=True,
        )
    )

    source_menu = db.query(MenuItem).filter(MenuItem.tenant_id == source.id).all()
    if source_menu:
        for m in source_menu:
            db.add(
                MenuItem(
                    tenant_id=tenant.id,
                    item_name=m.item_name,
                    category=m.category,
                    price=m.price,
                    is_coffee=m.is_coffee,
                    is_active=m.is_active,
                )
            )
    else:
        for row in _default_menu_rows(tenant.id):
            db.add(row)

    db.commit()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "domain": tenant.domain,
        "status": tenant.status,
    }


@router.delete("/{tenant_id}")
def delete_tenant(
    tenant_id: str,
    db: Session = Depends(get_db),
    _super_admin=Depends(get_super_admin),
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if tenant.slug in {"socialbee", "platform", "default"}:
        raise HTTPException(status_code=400, detail="Protected tenant cannot be deleted")

    # Remove dependent rows first (no ON DELETE CASCADE configured in this MVP schema).
    db.query(RefreshToken).filter(RefreshToken.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(AuditLog).filter(AuditLog.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Sale).filter(Sale.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(MenuItem).filter(MenuItem.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(Shift).filter(Shift.tenant_id == tenant.id).delete(synchronize_session=False)
    db.query(User).filter(User.tenant_id == tenant.id).delete(synchronize_session=False)
    db.delete(tenant)
    db.commit()

    return {"success": True}
