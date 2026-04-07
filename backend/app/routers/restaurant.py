import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import AuditLog, Check, FloorPlan, Guest, KitchenOrder, OrderItem, OrderRound, Reservation, Table, TableSession, Tenant, User
from app.schemas import (
    FloorPlanCreateIn,
    FloorPlanUpdateIn,
    ReservationCreateIn,
    ReservationSeatIn,
    ReservationUpdateIn,
    SendRoundIn,
    TableCombineIn,
    TableLayoutUpdateIn,
    TableSplitIn,
)


router = APIRouter(prefix="/api/v1/restaurant", tags=["restaurant"])


def _ensure_floor_admin(user: User):
    if str(user.role or "").lower() not in {"admin", "manager", "super_admin", "host"}:
        raise HTTPException(status_code=403, detail="Restaurant access required")


def _ensure_default_floor(db: Session, tenant_id: str) -> FloorPlan:
    row = (
        db.query(FloorPlan)
        .filter(FloorPlan.tenant_id == tenant_id)
        .order_by(FloorPlan.is_active.desc(), FloorPlan.created_at.asc())
        .first()
    )
    if row:
        return row
    row = FloorPlan(tenant_id=tenant_id, name="Main Floor", width_units=12, height_units=8, is_active=True)
    db.add(row)
    db.flush()
    unassigned_tables = db.query(Table).filter(Table.tenant_id == tenant_id, Table.floor_plan_id.is_(None)).all()
    cursor_x = 0
    cursor_y = 0
    for table in unassigned_tables:
        table.floor_plan_id = row.id
        table.pos_x = cursor_x
        table.pos_y = cursor_y
        cursor_x += 3
        if cursor_x >= 12:
            cursor_x = 0
            cursor_y += 3
    db.commit()
    db.refresh(row)
    return row


def _guest_payload(guest: Guest | None) -> dict:
    if not guest:
        return {}
    return {
        "id": guest.id,
        "full_name": guest.full_name,
        "phone": guest.phone,
        "email": guest.email,
        "notes": guest.notes,
    }


def _compute_table_status(db: Session, tenant_id: str, table: Table) -> str:
    active_session = (
        db.query(TableSession)
        .filter(
            TableSession.tenant_id == tenant_id,
            TableSession.table_id == table.id,
            TableSession.closed_at.is_(None),
        )
        .order_by(TableSession.seated_at.desc())
        .first()
    )
    if str(table.status or "").upper() == "DIRTY":
        return "DIRTY"
    if active_session:
        active_check = (
            db.query(Check)
            .filter(
                Check.tenant_id == tenant_id,
                Check.table_session_id == active_session.id,
                Check.status.in_(["OPEN", "PARTIALLY_PAID"]),
            )
            .order_by(Check.opened_at.desc())
            .first()
        )
        if active_check:
            return "ACTIVE_CHECK"
        return "SEATED"
    reserved = (
        db.query(Reservation)
        .filter(
            Reservation.tenant_id == tenant_id,
            Reservation.assigned_table_id == table.id,
            Reservation.status == "BOOKED",
        )
        .order_by(Reservation.reservation_at.asc())
        .first()
    )
    if reserved:
        return "RESERVED"
    return "AVAILABLE"


def _table_state_payload(db: Session, tenant_id: str, table: Table) -> dict:
    active_session = (
        db.query(TableSession)
        .filter(
            TableSession.tenant_id == tenant_id,
            TableSession.table_id == table.id,
            TableSession.closed_at.is_(None),
        )
        .order_by(TableSession.seated_at.desc())
        .first()
    )
    active_check = None
    if active_session:
        active_check = (
            db.query(Check)
            .filter(
                Check.tenant_id == tenant_id,
                Check.table_session_id == active_session.id,
                Check.status.in_(["OPEN", "PARTIALLY_PAID"]),
            )
            .order_by(Check.opened_at.desc())
            .first()
        )
    reserved = (
        db.query(Reservation)
        .filter(
            Reservation.tenant_id == tenant_id,
            Reservation.assigned_table_id == table.id,
            Reservation.status == "BOOKED",
        )
        .order_by(Reservation.reservation_at.asc())
        .first()
    )
    minutes_seated = None
    if active_session and active_session.seated_at:
        minutes_seated = int(max(0, (datetime.utcnow() - active_session.seated_at).total_seconds() // 60))
    return {
        "id": table.id,
        "label": table.label,
        "floor_plan_id": table.floor_plan_id,
        "shape": table.shape,
        "x": table.pos_x,
        "y": table.pos_y,
        "w": table.width_units,
        "h": table.height_units,
        "capacity": table.capacity,
        "merged_group_id": table.merged_group_id,
        "status": _compute_table_status(db, tenant_id, table),
        "guest_count": active_session.guest_count if active_session else table.guest_count,
        "assigned_waiter": active_session.assigned_waiter if active_session else table.assigned_to,
        "minutes_seated": minutes_seated,
        "check_total": str(active_check.total if active_check else Decimal("0.00")),
        "session_id": active_session.id if active_session else None,
        "check_id": active_check.id if active_check else None,
        "reservation": None if not reserved else {
            "id": reserved.id,
            "party_size": reserved.party_size,
            "reservation_at": reserved.reservation_at.isoformat(),
        },
    }


def _table_detail_payload(db: Session, tenant_id: str, table: Table) -> dict:
    active_session = (
        db.query(TableSession)
        .filter(
            TableSession.tenant_id == tenant_id,
            TableSession.table_id == table.id,
            TableSession.closed_at.is_(None),
        )
        .order_by(TableSession.seated_at.desc())
        .first()
    )
    active_check = None
    if active_session:
        active_check = (
            db.query(Check)
            .filter(
                Check.tenant_id == tenant_id,
                Check.table_session_id == active_session.id,
                Check.status.in_(["OPEN", "PARTIALLY_PAID"]),
            )
            .order_by(Check.opened_at.desc())
            .first()
        )
    rounds_payload: list[dict] = []
    if active_check:
        rounds = (
            db.query(OrderRound)
            .filter(OrderRound.tenant_id == tenant_id, OrderRound.check_id == active_check.id)
            .order_by(OrderRound.round_no.asc(), OrderRound.sent_at.asc())
            .all()
        )
        round_ids = [row.id for row in rounds]
        items_map: dict[str, list[dict]] = {}
        if round_ids:
            items = (
                db.query(OrderItem)
                .filter(OrderItem.tenant_id == tenant_id, OrderItem.round_id.in_(round_ids))
                .order_by(OrderItem.created_at.asc())
                .all()
            )
            for item in items:
                items_map.setdefault(item.round_id or "", []).append(
                    {
                        "id": item.id,
                        "item_name": item.item_name,
                        "qty": item.qty,
                        "price": str(item.price or Decimal("0.00")),
                        "seat_no": item.seat_no,
                        "course_no": item.course_no,
                        "status": item.status,
                        "note": item.note,
                        "modifier_json": item.modifier_json,
                    }
                )
        rounds_payload = [
            {
                "id": row.id,
                "round_no": row.round_no,
                "course_no": row.course_no,
                "status": row.status,
                "sent_by": row.sent_by,
                "sent_at": row.sent_at.isoformat() if row.sent_at else None,
                "items": items_map.get(row.id, []),
            }
            for row in rounds
        ]

    return {
        "table": _table_state_payload(db, tenant_id, table),
        "session": None if not active_session else {
            "id": active_session.id,
            "status": active_session.status,
            "guest_count": active_session.guest_count,
            "assigned_waiter": active_session.assigned_waiter,
            "seated_at": active_session.seated_at.isoformat() if active_session.seated_at else None,
            "reservation_id": active_session.reservation_id,
        },
        "check": None if not active_check else {
            "id": active_check.id,
            "check_number": active_check.check_number,
            "status": active_check.status,
            "guest_count": active_check.guest_count,
            "subtotal": str(active_check.subtotal or Decimal("0.00")),
            "service_charge": str(active_check.service_charge or Decimal("0.00")),
            "tax_amount": str(active_check.tax_amount or Decimal("0.00")),
            "total": str(active_check.total or Decimal("0.00")),
            "opened_at": active_check.opened_at.isoformat() if active_check.opened_at else None,
        },
        "rounds": rounds_payload,
    }


@router.get("/floor-plans")
def get_floor_plans(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    _ensure_default_floor(db, tenant.id)
    rows = db.query(FloorPlan).filter(FloorPlan.tenant_id == tenant.id).order_by(FloorPlan.created_at.asc()).all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "width_units": row.width_units,
            "height_units": row.height_units,
            "is_active": row.is_active,
        }
        for row in rows
    ]


@router.post("/floor-plans")
def create_floor_plan(
    payload: FloorPlanCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    if payload.is_active:
        db.query(FloorPlan).filter(FloorPlan.tenant_id == tenant.id).update({"is_active": False}, synchronize_session=False)
    row = FloorPlan(
        tenant_id=tenant.id,
        name=payload.name.strip(),
        width_units=max(6, payload.width_units),
        height_units=max(4, payload.height_units),
        is_active=payload.is_active,
    )
    db.add(row)
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="FLOOR_PLAN_CREATED", details=row.name))
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name, "width_units": row.width_units, "height_units": row.height_units, "is_active": row.is_active}


@router.patch("/floor-plans/{floor_id}")
def update_floor_plan(
    floor_id: str,
    payload: FloorPlanUpdateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    row = db.query(FloorPlan).filter(FloorPlan.id == floor_id, FloorPlan.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Floor plan not found")
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.width_units is not None:
        row.width_units = max(6, payload.width_units)
    if payload.height_units is not None:
        row.height_units = max(4, payload.height_units)
    if payload.is_active is not None:
        if payload.is_active:
            db.query(FloorPlan).filter(FloorPlan.tenant_id == tenant.id).update({"is_active": False}, synchronize_session=False)
        row.is_active = payload.is_active
    db.commit()
    return {"ok": True}


@router.get("/floor-plans/{floor_id}/state")
def get_floor_state(
    floor_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    floor = db.query(FloorPlan).filter(FloorPlan.id == floor_id, FloorPlan.tenant_id == tenant.id).first()
    if not floor:
        raise HTTPException(status_code=404, detail="Floor plan not found")
    tables = db.query(Table).filter(Table.tenant_id == tenant.id, Table.floor_plan_id == floor.id).order_by(Table.label.asc()).all()
    return {
        "floor": {
            "id": floor.id,
            "name": floor.name,
            "width_units": floor.width_units,
            "height_units": floor.height_units,
            "is_active": floor.is_active,
        },
        "tables": [_table_state_payload(db, tenant.id, table) for table in tables],
    }


@router.patch("/tables/{table_id}/layout")
def update_table_layout(
    table_id: str,
    payload: TableLayoutUpdateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    table = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    if payload.floor_plan_id is not None:
        table.floor_plan_id = payload.floor_plan_id
    if payload.pos_x is not None:
        table.pos_x = payload.pos_x
    if payload.pos_y is not None:
        table.pos_y = payload.pos_y
    if payload.width_units is not None:
        table.width_units = max(1, payload.width_units)
    if payload.height_units is not None:
        table.height_units = max(1, payload.height_units)
    if payload.capacity is not None:
        table.capacity = max(1, payload.capacity)
    if payload.shape is not None:
        table.shape = payload.shape
    if payload.status is not None:
        table.status = str(payload.status).upper()
    db.commit()
    return {"ok": True, "table": _table_state_payload(db, tenant.id, table)}


@router.get("/tables/{table_id}/detail")
def get_table_detail(
    table_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    table = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    return _table_detail_payload(db, tenant.id, table)


@router.post("/tables/{table_id}/combine")
def combine_tables(
    table_id: str,
    payload: TableCombineIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    source = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    target = db.query(Table).filter(Table.id == payload.target_table_id, Table.tenant_id == tenant.id).first()
    if not source or not target:
        raise HTTPException(status_code=404, detail="Table not found")
    merge_id = source.merged_group_id or target.merged_group_id or str(uuid.uuid4())
    source.merged_group_id = merge_id
    target.merged_group_id = merge_id
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="TABLES_COMBINED", details=f"{source.label} + {target.label}"))
    db.commit()
    return {"ok": True, "merged_group_id": merge_id}


@router.post("/tables/{table_id}/split")
def split_tables(
    table_id: str,
    payload: TableSplitIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    table = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    merge_id = payload.merged_group_id or table.merged_group_id
    if not merge_id:
        return {"ok": True}
    db.query(Table).filter(Table.tenant_id == tenant.id, Table.merged_group_id == merge_id).update({"merged_group_id": None}, synchronize_session=False)
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="TABLES_SPLIT", details=merge_id))
    db.commit()
    return {"ok": True}


@router.get("/reservations")
def get_reservations(
    date: str | None = Query(default=None),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    if date:
        day_start = datetime.fromisoformat(f"{date}T00:00:00")
    else:
        now = datetime.utcnow()
        day_start = datetime(now.year, now.month, now.day)
    day_end = day_start + timedelta(days=1)
    rows = (
        db.query(Reservation)
        .filter(
            Reservation.tenant_id == tenant.id,
            Reservation.reservation_at >= day_start,
            Reservation.reservation_at < day_end,
        )
        .order_by(Reservation.reservation_at.asc())
        .all()
    )
    guest_map = {
        row.id: row
        for row in db.query(Guest).filter(Guest.tenant_id == tenant.id, Guest.id.in_([r.guest_id for r in rows if r.guest_id])).all()
    }
    return [
        {
            "id": row.id,
            "reservation_at": row.reservation_at.isoformat(),
            "duration_minutes": row.duration_minutes,
            "party_size": row.party_size,
            "status": row.status,
            "special_note": row.special_note,
            "assigned_table_id": row.assigned_table_id,
            "guest": _guest_payload(guest_map.get(row.guest_id)),
        }
        for row in rows
    ]


@router.post("/reservations")
def create_reservation(
    payload: ReservationCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    guest = Guest(
        tenant_id=tenant.id,
        full_name=payload.guest_name.strip(),
        phone=payload.phone,
        email=payload.email,
        notes=payload.special_note,
    )
    db.add(guest)
    db.flush()
    row = Reservation(
        tenant_id=tenant.id,
        guest_id=guest.id,
        assigned_table_id=payload.assigned_table_id,
        reservation_at=payload.reservation_at,
        duration_minutes=max(15, payload.duration_minutes),
        party_size=max(1, payload.party_size),
        status="BOOKED",
        special_note=payload.special_note,
        created_by=user.username,
    )
    db.add(row)
    if payload.assigned_table_id:
        table = db.query(Table).filter(Table.id == payload.assigned_table_id, Table.tenant_id == tenant.id).first()
        if table and _compute_table_status(db, tenant.id, table) == "AVAILABLE":
            table.status = "RESERVED"
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="RESERVATION_CREATED", details=payload.guest_name))
    db.commit()
    return {"id": row.id, "status": row.status}


@router.patch("/reservations/{reservation_id}")
def update_reservation(
    reservation_id: str,
    payload: ReservationUpdateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    row = db.query(Reservation).filter(Reservation.id == reservation_id, Reservation.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Reservation not found")
    guest = db.query(Guest).filter(Guest.id == row.guest_id, Guest.tenant_id == tenant.id).first() if row.guest_id else None
    if payload.guest_name is not None:
        if guest:
            guest.full_name = payload.guest_name.strip()
    if payload.phone is not None and guest:
        guest.phone = payload.phone
    if payload.email is not None and guest:
        guest.email = payload.email
    if payload.reservation_at is not None:
        row.reservation_at = payload.reservation_at
    if payload.duration_minutes is not None:
        row.duration_minutes = max(15, payload.duration_minutes)
    if payload.party_size is not None:
        row.party_size = max(1, payload.party_size)
    if payload.special_note is not None:
        row.special_note = payload.special_note
        if guest:
            guest.notes = payload.special_note
    if payload.assigned_table_id is not None:
        row.assigned_table_id = payload.assigned_table_id
    if payload.status is not None:
        row.status = str(payload.status).upper()
    db.commit()
    return {"ok": True}


@router.delete("/reservations/{reservation_id}")
def cancel_reservation(
    reservation_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    row = db.query(Reservation).filter(Reservation.id == reservation_id, Reservation.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Reservation not found")
    row.status = "CANCELLED"
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="RESERVATION_CANCELLED", details=reservation_id))
    db.commit()
    return {"ok": True}


@router.post("/reservations/{reservation_id}/seat")
def seat_reservation(
    reservation_id: str,
    payload: ReservationSeatIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    reservation = db.query(Reservation).filter(Reservation.id == reservation_id, Reservation.tenant_id == tenant.id).first()
    table = db.query(Table).filter(Table.id == payload.table_id, Table.tenant_id == tenant.id).first()
    if not reservation or not table:
        raise HTTPException(status_code=404, detail="Reservation or table not found")
    active = (
        db.query(TableSession)
        .filter(TableSession.tenant_id == tenant.id, TableSession.table_id == table.id, TableSession.closed_at.is_(None))
        .first()
    )
    if active:
        raise HTTPException(status_code=400, detail="Table already has an active session")
    session = TableSession(
        tenant_id=tenant.id,
        table_id=table.id,
        reservation_id=reservation.id,
        assigned_waiter=payload.assigned_waiter or user.username,
        guest_count=max(1, payload.guest_count or reservation.party_size),
        status="SEATED",
    )
    db.add(session)
    db.flush()
    check = Check(
        tenant_id=tenant.id,
        table_session_id=session.id,
        check_number=f"CHK-{datetime.utcnow().strftime('%H%M%S')}",
        guest_count=session.guest_count,
        status="OPEN",
    )
    db.add(check)
    reservation.status = "SEATED"
    reservation.assigned_table_id = table.id
    table.is_occupied = True
    table.assigned_to = session.assigned_waiter
    table.guest_count = session.guest_count
    table.status = "ACTIVE_CHECK"
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="RESERVATION_SEATED", details=f"{reservation.id}:{table.label}"))
    db.commit()
    return {"ok": True, "table_session_id": session.id, "check_id": check.id}


@router.post("/tables/{table_id}/send-round")
def send_round(
    table_id: str,
    payload: SendRoundIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    table = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    active_session = (
        db.query(TableSession)
        .filter(TableSession.tenant_id == tenant.id, TableSession.table_id == table.id, TableSession.closed_at.is_(None))
        .order_by(TableSession.seated_at.desc())
        .first()
    )
    if not active_session:
        raise HTTPException(status_code=400, detail="Table does not have an active session")
    active_check = (
        db.query(Check)
        .filter(Check.tenant_id == tenant.id, Check.table_session_id == active_session.id, Check.status.in_(["OPEN", "PARTIALLY_PAID"]))
        .order_by(Check.opened_at.desc())
        .first()
    )
    if not active_check:
        raise HTTPException(status_code=400, detail="Open check not found")
    next_round_no = (db.query(OrderRound).filter(OrderRound.tenant_id == tenant.id, OrderRound.check_id == active_check.id).count() or 0) + 1
    round_row = OrderRound(
        tenant_id=tenant.id,
        check_id=active_check.id,
        round_no=next_round_no,
        course_no=max(1, payload.course_no or 1),
        status="NEW",
        sent_by=payload.sent_by or user.username,
    )
    db.add(round_row)
    db.flush()

    items_payload: list[dict] = []
    round_total = Decimal("0.00")
    for item in payload.items:
        line_total = (Decimal(str(item.price or 0)) * Decimal(str(item.qty or 0))).quantize(Decimal("0.01"))
        round_total += line_total
        row = OrderItem(
            tenant_id=tenant.id,
            check_id=active_check.id,
            round_id=round_row.id,
            table_id=table.id,
            menu_item_id=item.id,
            seat_no=item.seat_no,
            course_no=max(1, item.course_no or payload.course_no or 1),
            item_name=item.item_name,
            qty=item.qty,
            price=item.price,
            status="NEW",
            modifier_json=item.modifier_json,
            note=item.note,
        )
        db.add(row)
        items_payload.append(
            {
                "item_name": item.item_name,
                "qty": item.qty,
                "price": str(item.price),
                "seat_no": item.seat_no,
                "course_no": item.course_no or payload.course_no or 1,
                "note": item.note,
                "modifier_json": item.modifier_json,
            }
        )

    active_check.subtotal = (Decimal(str(active_check.subtotal or 0)) + round_total).quantize(Decimal("0.01"))
    active_check.service_charge = Decimal("0.00")
    active_check.tax_amount = Decimal("0.00")
    active_check.total = (Decimal(str(active_check.total or 0)) + round_total).quantize(Decimal("0.01"))
    table.total = active_check.total
    table.is_occupied = True
    table.status = "ACTIVE_CHECK"
    if not table.assigned_to:
        table.assigned_to = active_session.assigned_waiter or payload.sent_by or user.username

    kitchen_row = KitchenOrder(
        tenant_id=tenant.id,
        sale_id=active_check.id,
        table_label=table.label,
        order_type="DINE_IN",
        status="NEW",
        priority="NORMAL",
        items_json=__import__("json").dumps(
            [
                {
                    "item_name": row["item_name"],
                    "qty": row["qty"],
                    "price": row["price"],
                    "seat_label": f"Seat {row['seat_no']}" if row.get("seat_no") else None,
                    "course_no": row.get("course_no"),
                    "note": row.get("note"),
                }
                for row in items_payload
            ],
            ensure_ascii=False,
        ),
    )
    db.add(kitchen_row)
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="ROUND_SENT", details=f"{table.label}:#{next_round_no}"))
    db.commit()
    return {
        "ok": True,
        "round_id": round_row.id,
        "check_id": active_check.id,
        "round_no": next_round_no,
        "check_total": str(active_check.total),
    }


@router.get("/kitchen-feed")
def get_kitchen_feed(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(OrderRound, Table, Check)
        .join(Check, Check.id == OrderRound.check_id)
        .join(TableSession, TableSession.id == Check.table_session_id)
        .join(Table, Table.id == TableSession.table_id)
        .filter(OrderRound.tenant_id == tenant.id, OrderRound.status.in_(["NEW", "PREPARING", "READY"]))
        .order_by(OrderRound.sent_at.desc())
        .all()
    )
    round_ids = [round_row.id for round_row, _, _ in rows]
    item_rows = {}
    if round_ids:
        for item in (
            db.query(OrderItem)
            .filter(OrderItem.tenant_id == tenant.id, OrderItem.round_id.in_(round_ids), OrderItem.status.in_(["NEW", "PREPARING", "READY", "SERVED"]))
            .order_by(OrderItem.created_at.asc())
            .all()
        ):
            item_rows.setdefault(item.round_id, []).append(
                {
                    "item_name": item.item_name,
                    "qty": item.qty,
                    "price": str(item.price or Decimal("0.00")),
                    "seat_label": f"Seat {item.seat_no}" if item.seat_no else None,
                    "action": None,
                    "status": item.status,
                    "course_no": item.course_no,
                    "note": item.note,
                }
            )
    return [
        {
            "id": round_row.id,
            "sale_id": check.id,
            "table_label": table.label,
            "order_type": "DINE_IN",
            "status": round_row.status,
            "priority": "NORMAL",
            "round_no": round_row.round_no,
            "course_no": round_row.course_no,
            "items": item_rows.get(round_row.id, []),
            "created_at": round_row.sent_at.isoformat() if round_row.sent_at else datetime.utcnow().isoformat(),
        }
        for round_row, table, check in rows
    ]


@router.post("/kitchen-feed/{round_id}/accept")
def accept_kitchen_round(
    round_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(OrderRound).filter(OrderRound.id == round_id, OrderRound.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Round not found")
    row.status = "PREPARING"
    db.query(OrderItem).filter(OrderItem.tenant_id == tenant.id, OrderItem.round_id == row.id).update({"status": "PREPARING"}, synchronize_session=False)
    db.commit()
    return {"success": True}


@router.post("/kitchen-feed/{round_id}/complete")
def complete_kitchen_round(
    round_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    row = db.query(OrderRound).filter(OrderRound.id == round_id, OrderRound.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Round not found")
    ready_items = list(payload.get("ready_items") or [])
    row.status = "READY"
    items = db.query(OrderItem).filter(OrderItem.tenant_id == tenant.id, OrderItem.round_id == row.id).all()
    for item in items:
        ready_key = f"{item.item_name} · Seat {item.seat_no}" if item.seat_no else item.item_name
        if not ready_items or ready_key in ready_items or item.item_name in ready_items:
            item.status = "READY"
    db.commit()
    return {"success": True}
