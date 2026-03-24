from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import FinanceEntry, Shift, Tenant
from app.schemas import OpenShiftIn, XReportIn, ZReportIn


router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


def _sum_source(db: Session, tenant_id: str, source: str, typ: str) -> Decimal:
    rows = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant_id, FinanceEntry.source == source, FinanceEntry.type == typ).all()
    return sum((Decimal(str(r.amount)) for r in rows), Decimal("0"))


@router.post("/open-shift")
def open_shift(payload: OpenShiftIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = db.query(Shift).filter(Shift.tenant_id == tenant.id, Shift.status == "open").first()
    if active:
        raise HTTPException(status_code=400, detail="Shift already open")

    row = Shift(
        tenant_id=tenant.id,
        status="open",
        opened_by=user.username,
        opened_at=datetime.utcnow(),
        opening_cash=payload.opening_cash,
    )
    db.add(row)
    db.add(
        FinanceEntry(
            tenant_id=tenant.id,
            type="in",
            category="Kassa Açılışı",
            source="cash",
            amount=payload.opening_cash,
            description="Shift opening cash",
            created_by=user.username,
        )
    )
    db.commit()
    return {"success": True, "shift_id": row.id}


@router.post("/x-report")
def x_report(payload: XReportIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = db.query(Shift).filter(Shift.tenant_id == tenant.id, Shift.status == "open").first()
    if not active:
        raise HTTPException(status_code=400, detail="Shift is closed")

    cash_in = _sum_source(db, tenant.id, "cash", "in")
    cash_out = _sum_source(db, tenant.id, "cash", "out")
    expected = cash_in - cash_out
    diff = Decimal(str(payload.actual_cash)) - expected

    if diff != 0:
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="in" if diff > 0 else "out",
                category="Kassa Artığı" if diff > 0 else "Kassa Kəsiri",
                source="cash",
                amount=abs(diff),
                description="X-report difference",
                created_by=user.username,
            )
        )
        db.commit()

    return {"expected_cash": str(expected), "actual_cash": str(payload.actual_cash), "difference": str(diff)}


@router.post("/z-report")
def z_report(payload: ZReportIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = db.query(Shift).filter(Shift.tenant_id == tenant.id, Shift.status == "open").first()
    if not active:
        raise HTTPException(status_code=400, detail="Shift is closed")

    if payload.wage_amount > 0:
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="out",
                category="Maaş",
                source="cash",
                amount=payload.wage_amount,
                description="Shift close wage",
                created_by=user.username,
            )
        )

    active.status = "closed"
    active.closed_by = user.username
    active.closed_at = datetime.utcnow()
    db.commit()

    return {"success": True, "shift_id": active.id, "closed_at": active.closed_at.isoformat()}