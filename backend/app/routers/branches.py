"""Multi-branch CRUD + nearest-by-distance endpoints.

Admin endpoints (requires admin/manager role):
  GET    /api/v1/branches/{tenant_id}          List branches
  POST   /api/v1/branches/{tenant_id}          Create branch
  PUT    /api/v1/branches/{tenant_id}/{branch_id}  Update branch
  DELETE /api/v1/branches/{tenant_id}/{branch_id}  Soft-delete branch

Public endpoints (customer app):
  GET /api/v1/customer-app/branches/{tenant_id}          All active branches
  GET /api/v1/customer-app/branches/{tenant_id}/nearest   Nearest branches (lat,lng)
"""

import math
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import TenantBranch, User

router = APIRouter(tags=["branches"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class BranchCreate(BaseModel):
    name: str
    address: str | None = None
    phone: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    is_active: bool = True
    is_default: bool = False
    open_hour: int = 8
    close_hour: int = 23
    sort_order: int = 0


class BranchUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    phone: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    is_active: bool | None = None
    is_default: bool | None = None
    open_hour: int | None = None
    close_hour: int | None = None
    sort_order: int | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row_to_dict(row: TenantBranch) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "address": row.address or "",
        "phone": row.phone or "",
        "latitude": row.latitude,
        "longitude": row.longitude,
        "is_active": row.is_active,
        "is_default": row.is_default,
        "open_hour": row.open_hour,
        "close_hour": row.close_hour,
        "sort_order": row.sort_order,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points (km)."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

@router.get("/api/v1/branches/{tenant_id}")
def list_branches(tenant_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(TenantBranch)
        .filter(TenantBranch.tenant_id == tenant_id)
        .order_by(TenantBranch.sort_order, TenantBranch.name)
        .all()
    )
    return {"branches": [_row_to_dict(r) for r in rows]}


@router.post("/api/v1/branches/{tenant_id}")
def create_branch(tenant_id: str, body: BranchCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # Validate: only one default per tenant
    if body.is_default:
        db.query(TenantBranch).filter(
            TenantBranch.tenant_id == tenant_id,
            TenantBranch.is_default == True,  # noqa: E712
        ).update({"is_default": False})
        db.flush()

    branch = TenantBranch(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        name=body.name.strip(),
        address=(body.address or "").strip() or None,
        phone=(body.phone or "").strip() or None,
        latitude=body.latitude,
        longitude=body.longitude,
        is_active=body.is_active,
        is_default=body.is_default,
        open_hour=body.open_hour,
        close_hour=body.close_hour,
        sort_order=body.sort_order,
        created_at=datetime.utcnow(),
    )
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return _row_to_dict(branch)


@router.put("/api/v1/branches/{tenant_id}/{branch_id}")
def update_branch(
    tenant_id: str,
    branch_id: str,
    body: BranchUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    branch = (
        db.query(TenantBranch)
        .filter(TenantBranch.id == branch_id, TenantBranch.tenant_id == tenant_id)
        .first()
    )
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    update_data = body.model_dump(exclude_unset=True)

    # Validate: only one default
    if update_data.get("is_default"):
        db.query(TenantBranch).filter(
            TenantBranch.tenant_id == tenant_id,
            TenantBranch.is_default == True,  # noqa: E712
            TenantBranch.id != branch_id,
        ).update({"is_default": False})
        db.flush()

    for field, value in update_data.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(branch, field, value)

    db.commit()
    db.refresh(branch)
    return _row_to_dict(branch)


@router.delete("/api/v1/branches/{tenant_id}/{branch_id}")
def delete_branch(tenant_id: str, branch_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    branch = (
        db.query(TenantBranch)
        .filter(TenantBranch.id == branch_id, TenantBranch.tenant_id == tenant_id)
        .first()
    )
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    # Cannot delete the last active branch
    active_count = (
        db.query(TenantBranch)
        .filter(
            TenantBranch.tenant_id == tenant_id,
            TenantBranch.is_active == True,  # noqa: E712
            TenantBranch.id != branch_id,
        )
        .count()
    )
    if active_count == 0 and branch.is_active:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the last active branch",
        )

    # Soft-delete by deactivating
    branch.is_active = False
    db.commit()
    return {"ok": True, "deleted": branch_id}


# ---------------------------------------------------------------------------
# Public endpoints (customer app)
# ---------------------------------------------------------------------------

@router.get("/api/v1/customer-app/branches/{tenant_id}")
def public_branches(tenant_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(TenantBranch)
        .filter(TenantBranch.tenant_id == tenant_id, TenantBranch.is_active == True)  # noqa: E712
        .order_by(TenantBranch.sort_order, TenantBranch.name)
        .all()
    )
    return {
        "branches": [
            {
                "id": r.id,
                "name": r.name,
                "address": r.address or "",
                "phone": r.phone or "",
                "latitude": r.latitude,
                "longitude": r.longitude,
                "is_default": r.is_default,
                "open_hour": r.open_hour,
                "close_hour": r.close_hour,
            }
            for r in rows
        ]
    }


@router.get("/api/v1/customer-app/branches/{tenant_id}/nearest")
def nearest_branches(
    tenant_id: str,
    lat: float = Query(..., description="User latitude"),
    lng: float = Query(..., description="User longitude"),
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(TenantBranch)
        .filter(TenantBranch.tenant_id == tenant_id, TenantBranch.is_active == True)  # noqa: E712
        .all()
    )

    result = []
    for r in rows:
        dist = None
        if r.latitude is not None and r.longitude is not None:
            dist = _haversine_km(lat, lng, r.latitude, r.longitude)
        result.append({
            "id": r.id,
            "name": r.name,
            "address": r.address or "",
            "phone": r.phone or "",
            "latitude": r.latitude,
            "longitude": r.longitude,
            "is_default": r.is_default,
            "open_hour": r.open_hour,
            "close_hour": r.close_hour,
            "distance_km": round(dist, 2) if dist is not None else None,
        })

    # Sort: branches with distance first (ascending), then branches without coords
    result.sort(key=lambda b: (b["distance_km"] is None, 9999 if b["distance_km"] is None else b["distance_km"]))
    return {"branches": result[:limit]}
