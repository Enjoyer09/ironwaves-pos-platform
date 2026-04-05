from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import FinanceEntry, Shift, ShiftHandover, Tenant, User
from app.schemas import OpenShiftIn, ShiftHandoverAcceptIn, ShiftHandoverIn, XReportIn, ZReportIn


router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


def _rows_since(db: Session, tenant_id: str, opened_at: datetime | None) -> list[FinanceEntry]:
    query = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant_id)
    if opened_at:
        query = query.filter(FinanceEntry.created_at >= opened_at)
    return query.all()


def _normalized(value: str | None) -> str:
    return (value or "").strip().lower()


def _is_shift_sale_entry(row: FinanceEntry) -> bool:
    category = _normalized(row.category)
    return row.type == "in" and (
        category == "satış (nağd)" or category == "satış (kart)" or category == "staff ödənişi"
    )


def _is_shift_deposit_entry(row: FinanceEntry) -> bool:
    category = _normalized(row.category)
    description = _normalized(row.description)
    return row.type == "in" and ("depozit" in category or "depozit" in description or "deposit" in description)


def _get_active_shift(db: Session, tenant_id: str) -> Shift | None:
    return db.query(Shift).filter(Shift.tenant_id == tenant_id, Shift.status == "open").first()


def _shift_cash_breakdown(db: Session, tenant_id: str, shift: Shift | None) -> dict[str, Decimal]:
    if not shift:
        return {
            "opening_cash": Decimal("0"),
            "cash_in": Decimal("0"),
            "cash_out": Decimal("0"),
            "expected_cash": Decimal("0"),
        }

    shift_rows = _rows_since(db, tenant_id, shift.opened_at)
    cash_in = sum(
        (Decimal(str(row.amount)) for row in shift_rows if row.source == "cash" and row.type == "in"),
        Decimal("0"),
    )
    cash_out = sum(
        (Decimal(str(row.amount)) for row in shift_rows if row.source == "cash" and row.type == "out"),
        Decimal("0"),
    )
    opening_cash = Decimal(str(shift.opening_cash or 0))
    expected_cash = opening_cash + cash_in - cash_out
    return {
        "opening_cash": opening_cash,
        "cash_in": cash_in,
        "cash_out": cash_out,
        "expected_cash": expected_cash,
    }


@router.get("/status")
def report_status(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = _get_active_shift(db, tenant.id)
    if not active:
        return {"status": "Closed", "tenant_id": tenant.id}
    return {
        "status": "Open",
        "tenant_id": tenant.id,
        "opened_by": active.opened_by,
        "opened_at": active.opened_at.isoformat() if active.opened_at else None,
        "opening_cash": str(Decimal(str(active.opening_cash or 0)).quantize(Decimal("0.01"))),
    }


@router.get("/expected-cash")
def expected_cash(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = _get_active_shift(db, tenant.id)
    breakdown = _shift_cash_breakdown(db, tenant.id, active)
    return {
        "expected_cash": str(breakdown["expected_cash"].quantize(Decimal("0.01"))),
        "opening_cash": str(breakdown["opening_cash"].quantize(Decimal("0.01"))),
        "cash_in": str(breakdown["cash_in"].quantize(Decimal("0.01"))),
        "cash_out": str(breakdown["cash_out"].quantize(Decimal("0.01"))),
        "shift_open": bool(active),
    }


@router.post("/open-shift")
def open_shift(payload: OpenShiftIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = _get_active_shift(db, tenant.id)
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
    db.commit()
    return {"success": True, "shift_id": row.id}


@router.post("/x-report")
def x_report(payload: XReportIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = _get_active_shift(db, tenant.id)
    if not active:
        raise HTTPException(status_code=400, detail="Shift is closed")

    breakdown = _shift_cash_breakdown(db, tenant.id, active)
    expected = breakdown["expected_cash"]
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

    return {
        "expected_cash": str(expected.quantize(Decimal("0.01"))),
        "actual_cash": str(Decimal(str(payload.actual_cash)).quantize(Decimal("0.01"))),
        "difference": str(diff.quantize(Decimal("0.01"))),
        "opening_cash": str(breakdown["opening_cash"].quantize(Decimal("0.01"))),
        "cash_in": str(breakdown["cash_in"].quantize(Decimal("0.01"))),
        "cash_out": str(breakdown["cash_out"].quantize(Decimal("0.01"))),
    }


@router.post("/z-report")
def z_report(payload: ZReportIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = _get_active_shift(db, tenant.id)
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

    breakdown = _shift_cash_breakdown(db, tenant.id, active)
    expected = breakdown["expected_cash"]
    shift_rows = _rows_since(db, tenant.id, active.opened_at)
    cash_sales = sum(
        (Decimal(str(row.amount)) for row in shift_rows if _is_shift_sale_entry(row) and row.source == "cash"),
        Decimal("0"),
    )
    card_sales = sum(
        (Decimal(str(row.amount)) for row in shift_rows if _is_shift_sale_entry(row) and row.source == "card"),
        Decimal("0"),
    )
    deposit_total = sum(
        (Decimal(str(row.amount)) for row in shift_rows if _is_shift_deposit_entry(row)),
        Decimal("0"),
    )

    active.status = "closed"
    active.closed_by = user.username
    active.closed_at = datetime.utcnow()
    db.commit()

    return {
        "success": True,
        "shift_id": active.id,
        "closed_at": active.closed_at.isoformat(),
        "cash_sales": str(cash_sales.quantize(Decimal("0.01"))),
        "card_sales": str(card_sales.quantize(Decimal("0.01"))),
        "deposit_total": str(deposit_total.quantize(Decimal("0.01"))),
        "expected_cash": str(expected.quantize(Decimal("0.01"))),
        "actual_cash": str(Decimal(str(payload.actual_cash)).quantize(Decimal("0.01"))),
        "wage_amount": str(Decimal(str(payload.wage_amount)).quantize(Decimal("0.01"))),
        "opening_cash": str(breakdown["opening_cash"].quantize(Decimal("0.01"))),
        "cash_movements_in": str(breakdown["cash_in"].quantize(Decimal("0.01"))),
        "cash_movements_out": str(breakdown["cash_out"].quantize(Decimal("0.01"))),
    }


@router.get("/handovers")
def list_handovers(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    rows = (
        db.query(ShiftHandover)
        .filter(ShiftHandover.tenant_id == tenant.id)
        .order_by(ShiftHandover.created_at.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "handed_by": row.handed_by,
            "received_by": row.received_by,
            "declared_cash": str(row.declared_cash),
            "actual_cash": str(row.actual_cash) if row.actual_cash is not None else None,
            "difference": str(row.difference) if row.difference is not None else None,
            "status": row.status,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "accepted_at": row.accepted_at.isoformat() if row.accepted_at else None,
        }
        for row in rows
    ]


@router.get("/handover-users")
def list_handover_users(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    rows = (
        db.query(User)
        .filter(
            User.tenant_id == tenant.id,
            User.is_active == True,
            User.role.in_(["admin", "manager", "staff"]),
        )
        .order_by(User.username.asc())
        .all()
    )
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "username": row.username,
            "role": row.role,
        }
        for row in rows
    ]


@router.post("/handovers")
def create_handover(payload: ShiftHandoverIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = db.query(Shift).filter(Shift.tenant_id == tenant.id, Shift.status == "open").first()
    if not active:
        raise HTTPException(status_code=400, detail="Shift is closed")
    received_by = str(payload.received_by or "").strip()
    if not received_by:
        raise HTTPException(status_code=400, detail="Receiver is required")
    if received_by == user.username:
        raise HTTPException(status_code=400, detail="Cannot hand over shift to yourself")
    receiver = (
        db.query(User)
        .filter(User.tenant_id == tenant.id, func.lower(User.username) == received_by.lower(), User.is_active == True)
        .first()
    )
    if not receiver:
        raise HTTPException(status_code=404, detail="Receiver user not found")
    if str(receiver.role or "").lower() not in {"admin", "manager", "staff"}:
        raise HTTPException(status_code=400, detail="Receiver role is not eligible for shift handover")
    row = ShiftHandover(
        tenant_id=tenant.id,
        handed_by=user.username,
        received_by=receiver.username,
        declared_cash=payload.declared_cash,
        status="PENDING",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"success": True, "id": row.id, "status": row.status}


@router.post("/handovers/{handover_id}/accept")
def accept_handover(handover_id: str, payload: ShiftHandoverAcceptIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = db.query(Shift).filter(Shift.tenant_id == tenant.id, Shift.status == "open").first()
    if not active:
        raise HTTPException(status_code=400, detail="Shift is closed")
    row = db.query(ShiftHandover).filter(ShiftHandover.id == handover_id, ShiftHandover.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Handover not found")
    if row.status != "PENDING":
        raise HTTPException(status_code=400, detail="Handover already accepted")
    if row.received_by != user.username:
        raise HTTPException(status_code=403, detail="This handover is not assigned to you")

    actual = Decimal(str(payload.actual_cash))
    declared = Decimal(str(row.declared_cash))
    difference = actual - declared
    if difference != 0:
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="in" if difference > 0 else "out",
                category="Kassa Artığı" if difference > 0 else "Kassa Kəsiri",
                source="cash",
                amount=abs(difference),
                description=f"Smeni qəbul fərqi ({row.handed_by} -> {user.username})",
                created_by=user.username,
            )
        )

    active.opened_by = user.username
    row.status = "ACCEPTED"
    row.actual_cash = actual
    row.difference = difference
    row.accepted_at = datetime.utcnow()
    db.commit()
    return {
        "success": True,
        "handover_id": row.id,
        "declared_cash": str(row.declared_cash),
        "actual_cash": str(actual),
        "difference": str(difference),
    }
