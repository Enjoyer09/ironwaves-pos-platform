import json
import secrets
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - Python fallback safety
    ZoneInfo = None

from anyio import from_thread
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import AuditLog, Check, FinanceEntry, FloorPlan, Guest, ItemStatusLog, KitchenOrder, OrderItem, OrderRound, Payment, Reservation, Sale, Setting, Table, TableSession, Tenant, User
from app.realtime import broadcast_tenant_event
from app.services.finance_service import (
    post_deposit_apply_to_bill as _post_deposit_apply_to_bill,
    post_sale_cogs as _post_sale_cogs,
    post_sale_payment as _post_sale_payment,
)
from app.routers.operations import _collect_stock_ops
from app.schemas import (
    DraftItemUpdateIn,
    FloorPlanCreateIn,
    FloorPlanUpdateIn,
    OrderItemActionIn,
    RestaurantRoundItemIn,
    ReservationCreateIn,
    ReservationSeatIn,
    ReservationUpdateIn,
    SettleCheckIn,
    SendDraftItemsIn,
    SendRoundIn,
    TableCombineIn,
    TableLockTransferIn,
    TableLayoutUpdateIn,
    TableSplitIn,
    TableUnlockIn,
)
from app.security import verify_password


router = APIRouter(prefix="/api/v1/restaurant", tags=["restaurant"])


STATUS_ALIASES = {
    "NEW": "SENT",
    "IN_PREP": "PREPARING",
}

TERMINAL_ITEM_STATUSES = {"VOIDED", "COMPED", "WASTE", "REMAKE"}

ACTION_RULES = {
    "DECREASE": {
        "allowed": {"DRAFT", "SENT", "PREPARING"},
        "manager_after_ready": True,
        "billing_effect": "reduce_billable_qty",
        "kitchen_effect": "partial_cancel_request",
    },
    "VOID": {
        "allowed": {"SENT", "PREPARING", "READY", "VOID_REQUESTED"},
        "manager_statuses": {"READY", "VOID_REQUESTED"},
        "billing_effect": "remove_from_bill",
        "kitchen_effect": "cancel_request",
    },
    "COMP": {
        "allowed": {"SENT", "PREPARING", "READY", "SERVED"},
        "manager_statuses": {"READY", "SERVED"},
        "billing_effect": "comp_to_zero",
        "kitchen_effect": "billing_only",
    },
    "WASTE": {
        "allowed": {"SENT", "PREPARING", "READY", "SERVED"},
        "manager_statuses": {"READY", "SERVED"},
        "billing_effect": "waste_to_zero",
        "kitchen_effect": "mark_waste",
    },
    "REMAKE": {
        "allowed": {"SENT", "PREPARING", "READY"},
        "manager_statuses": {"READY"},
        "billing_effect": "replace_original",
        "kitchen_effect": "correction_remake",
    },
}

ACTION_ALIASES = {
    "AZALT": "DECREASE",
    "QTY_DECREASE": "DECREASE",
    "PARTIAL_VOID": "DECREASE",
    "CANCEL": "VOID",
    "VOID_REQUEST": "VOID",
    "COMPED": "COMP",
    "HESABDAN_SIL": "COMP",
    "ISRAF": "WASTE",
    "CORRECTION": "REMAKE",
    "REMAKE_CORRECTION": "REMAKE",
}


def _restaurant_now() -> datetime:
    if ZoneInfo:
        return datetime.now(ZoneInfo("Asia/Baku")).replace(tzinfo=None)
    return datetime.utcnow() + timedelta(hours=4)


def _normalize_item_status(status: str | None) -> str:
    normalized = str(status or "DRAFT").upper().strip()
    return STATUS_ALIASES.get(normalized, normalized)


def _normalize_item_action(action: str | None) -> str:
    normalized = str(action or "").upper().strip()
    return ACTION_ALIASES.get(normalized, normalized)


def _emit_realtime(tenant_id: str, event: str, payload: dict | None = None) -> None:
    try:
        from_thread.run(broadcast_tenant_event, tenant_id, event, payload or {})
    except Exception:
        pass


def _log_item_status(
    db: Session,
    tenant_id: str,
    item: OrderItem,
    old_status: str | None,
    new_status: str,
    changed_by: str | None,
    reason: str | None = None,
    *,
    action_type: str | None = None,
    quantity_before: int | None = None,
    quantity_after: int | None = None,
    approved_by: str | None = None,
    reason_code: str | None = None,
    billing_effect: str | None = None,
    kitchen_effect: str | None = None,
    meta: dict | None = None,
) -> None:
    db.add(
        ItemStatusLog(
            tenant_id=tenant_id,
            order_item_id=item.id,
            check_id=item.check_id,
            round_id=item.round_id,
            action_type=action_type,
            old_status=old_status,
            new_status=new_status,
            quantity_before=quantity_before,
            quantity_after=quantity_after,
            changed_by=changed_by,
            approved_by=approved_by,
            reason_code=reason_code,
            reason=reason,
            billing_effect=billing_effect,
            kitchen_effect=kitchen_effect,
            meta_json=json.dumps(meta or {}, ensure_ascii=False) if meta else None,
        )
    )


def _ensure_floor_admin(user: User):
    if str(user.role or "").lower() not in {"admin", "manager", "super_admin", "host", "staff"}:
        raise HTTPException(status_code=403, detail="Restaurant access required")


def _is_manager(user: User) -> bool:
    return str(user.role or "").lower() in {"admin", "manager", "super_admin"}


def _table_lock_holder(table: Table) -> str | None:
    return str(table.locked_by or table.assigned_to or "").strip() or None


def _apply_table_lock(table: Table, owner: str | None, session_id: str | None = None) -> None:
    table.locked_by = owner or None
    table.assigned_to = owner or None
    table.active_session_id = session_id or table.active_session_id
    table.locked_at = datetime.utcnow() if owner else None


def _release_table_lock(table: Table) -> None:
    table.locked_by = None
    table.assigned_to = None
    table.active_session_id = None
    table.locked_at = None


def _ensure_table_write_access(table: Table, user: User, allow_manager_override: bool = True) -> str | None:
    lock_holder = _table_lock_holder(table)
    if not lock_holder:
        return None
    if lock_holder == user.username:
        return lock_holder
    if allow_manager_override and _is_manager(user):
        return lock_holder
    raise HTTPException(status_code=403, detail=f"Bu masa artıq {lock_holder} tərəfindən istifadə olunur")


def _resolve_manager_override_user(db: Session, tenant_id: str, manager_password: str | None) -> User:
    override_password = str(manager_password or "").strip()
    if not override_password:
        raise HTTPException(status_code=403, detail="Manager approval required")
    candidates = db.query(User).filter(User.tenant_id == tenant_id, User.is_active == True).all()  # noqa: E712
    for candidate in candidates:
        if not _is_manager(candidate):
            continue
        if candidate.password_hash and verify_password(override_password, candidate.password_hash):
            return candidate
    raise HTTPException(status_code=403, detail="Manager/Admin override failed")


def _json_load(value: str | None, default):
    try:
        return json.loads(value or "")
    except Exception:
        return default


def _setting_value(db: Session, tenant_id: str, key: str, default):
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    if not row or row.value is None:
        return default
    if isinstance(default, (dict, list)):
        return _json_load(row.value, default)
    if isinstance(default, bool):
        return str(row.value).lower() in {"1", "true", "yes"}
    if isinstance(default, int):
        try:
            return int(row.value)
        except Exception:
            return default
    return row.value


def _normalize_payment_method(value: str | None) -> str:
    return str(value or "").strip().lower()


def _reservation_lock_hours(db: Session, tenant_id: str) -> float:
    table_service = _setting_value(db, tenant_id, "table_service_settings", {"deposit_per_guest_azn": 0, "reservation_lock_hours": 2})
    try:
        return max(0.0, float(table_service.get("reservation_lock_hours") or 2))
    except Exception:
        return 2.0


def _late_release_minutes(db: Session, tenant_id: str) -> int:
    table_service = _setting_value(db, tenant_id, "table_service_settings", {"late_release_minutes": 15})
    try:
        return max(5, int(table_service.get("late_release_minutes") or 15))
    except Exception:
        return 15


def _find_locked_reservation(db: Session, tenant_id: str, table_id: str) -> Reservation | None:
    now = _restaurant_now()
    lock_until = now + timedelta(hours=_reservation_lock_hours(db, tenant_id))
    late_release_cutoff = now - timedelta(minutes=_late_release_minutes(db, tenant_id))
    return (
        db.query(Reservation)
        .filter(
            Reservation.tenant_id == tenant_id,
            Reservation.assigned_table_id == table_id,
            Reservation.status.in_(["BOOKED", "LATE"]),
            Reservation.reservation_at >= now,
            Reservation.reservation_at <= lock_until,
        )
        .order_by(Reservation.reservation_at.asc())
        .first()
    ) or (
        db.query(Reservation)
        .filter(
            Reservation.tenant_id == tenant_id,
            Reservation.assigned_table_id == table_id,
            Reservation.status == "LATE",
            Reservation.reservation_at >= late_release_cutoff,
            Reservation.reservation_at <= now,
        )
        .order_by(Reservation.reservation_at.asc())
        .first()
    )


def _validate_reservation_table(
    db: Session,
    tenant_id: str,
    table_id: str | None,
    reservation_at: datetime,
    duration_minutes: int = 90,
    exclude_reservation_id: str | None = None,
) -> None:
    if not table_id:
        return
    table = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Assigned table not found")
    if str(table.status or "").upper() == "DIRTY":
        raise HTTPException(status_code=400, detail="Dirty table cannot be assigned to reservation")
    active_session, active_check = _ensure_active_session_and_check(db, tenant_id, table)
    if active_session or active_check or bool(table.is_occupied):
        raise HTTPException(status_code=400, detail="Table already has an active session")
    new_start = reservation_at
    new_end = reservation_at + timedelta(minutes=max(15, int(duration_minutes or 90)))
    overlaps = (
        db.query(Reservation)
        .filter(
            Reservation.tenant_id == tenant_id,
            Reservation.assigned_table_id == table_id,
            Reservation.status.in_(["BOOKED", "LATE"]),
        )
        .order_by(Reservation.reservation_at.asc())
        .all()
    )
    for reservation in overlaps:
        if exclude_reservation_id and reservation.id == exclude_reservation_id:
            continue
        existing_start = reservation.reservation_at
        existing_end = existing_start + timedelta(minutes=max(15, int(reservation.duration_minutes or 90)))
        if new_start < existing_end and new_end > existing_start:
            raise HTTPException(status_code=400, detail="Table already has a conflicting reservation")


def _merge_table_items(existing: list[dict], incoming: list[dict]) -> list[dict]:
    merged = list(existing)
    for item in incoming:
        idx = next(
            (
                i
                for i, row in enumerate(merged)
                if (
                    str(row.get("id") or "") == str(item.get("id") or "")
                    or (
                        str(row.get("item_name") or "").strip() == str(item.get("item_name") or "").strip()
                        and str(row.get("seat_label") or "").strip() == str(item.get("seat_label") or "").strip()
                    )
                )
            ),
            -1,
        )
        if idx >= 0:
            merged[idx]["qty"] = int(merged[idx].get("qty") or 0) + int(item.get("qty") or 0)
        else:
            merged.append(item)
    return merged


def _ensure_active_session_and_check(db: Session, tenant_id: str, table: Table) -> tuple[TableSession | None, Check | None]:
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

    legacy_items = _json_load(table.items_json, [])
    legacy_deposit = Decimal(str(table.deposit_amount or 0)).quantize(Decimal("0.01"))
    needs_bootstrap = bool(table.is_occupied and (legacy_items or legacy_deposit > 0 or int(table.guest_count or 0) > 0))
    if active_session or not needs_bootstrap:
        return active_session, active_check

    active_session = TableSession(
        tenant_id=tenant_id,
        table_id=table.id,
        reservation_id=None,
        assigned_waiter=table.assigned_to,
        guest_count=max(1, int(table.guest_count or 1)),
        status="SEATED",
    )
    db.add(active_session)
    db.flush()

    active_check = Check(
        tenant_id=tenant_id,
        table_session_id=active_session.id,
        check_number=f"CHK-{datetime.utcnow().strftime('%H%M%S')}",
        guest_count=active_session.guest_count,
        subtotal=Decimal(str(table.total or 0)).quantize(Decimal("0.01")),
        service_charge=Decimal("0.00"),
        tax_amount=Decimal("0.00"),
        total=Decimal(str(table.total or 0)).quantize(Decimal("0.01")),
        status="OPEN",
    )
    db.add(active_check)
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            user=table.assigned_to or "system",
            action="LEGACY_TABLE_BOOTSTRAPPED",
            details=f"{table.label}:{active_session.id}",
        )
    )
    _apply_table_lock(table, table.assigned_to, active_session.id)
    db.commit()
    db.refresh(active_session)
    db.refresh(active_check)
    return active_session, active_check


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
    _assign_unassigned_tables_to_floor(db, tenant_id, row)
    db.commit()
    db.refresh(row)
    return row


def _assign_unassigned_tables_to_floor(db: Session, tenant_id: str, floor: FloorPlan) -> bool:
    unassigned_tables = (
        db.query(Table)
        .filter(Table.tenant_id == tenant_id, Table.floor_plan_id.is_(None))
        .order_by(Table.label.asc())
        .all()
    )
    if not unassigned_tables:
        return False
    max_cols = max(6, int(floor.width_units or 12))
    slot_width = 3
    slot_height = 3
    assigned_count = (
        db.query(Table)
        .filter(Table.tenant_id == tenant_id, Table.floor_plan_id == floor.id)
        .count()
    )
    per_row = max(1, max_cols // slot_width)
    cursor = assigned_count
    for table in unassigned_tables:
        table.floor_plan_id = floor.id
        table.pos_x = (cursor % per_row) * slot_width
        table.pos_y = (cursor // per_row) * slot_height
        if table.width_units is None or int(table.width_units or 0) <= 0:
            table.width_units = 2
        if table.height_units is None or int(table.height_units or 0) <= 0:
            table.height_units = 2
        if table.capacity is None or int(table.capacity or 0) <= 0:
            table.capacity = 4
        if not str(table.shape or "").strip():
            table.shape = "rectangle"
        if not str(table.status or "").strip():
            table.status = "AVAILABLE"
        cursor += 1
    return True


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


def _floor_plan_payload(row: FloorPlan) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "width_units": row.width_units,
        "height_units": row.height_units,
        "is_active": row.is_active,
    }


def _tables_list_payload(db: Session, tenant_id: str) -> list[dict]:
    rows = db.query(Table).filter(Table.tenant_id == tenant_id).order_by(Table.label.asc()).all()
    kitchen_rows = (
        db.query(KitchenOrder)
        .filter(KitchenOrder.tenant_id == tenant_id, KitchenOrder.status.in_(["NEW", "PREPARING", "READY"]))
        .order_by(KitchenOrder.created_at.desc())
        .all()
    )
    status_by_table: dict[str, str] = {}
    for kitchen_row in kitchen_rows:
        label = str(kitchen_row.table_label or "").strip()
        if not label or label in status_by_table:
            continue
        status_by_table[label] = str(kitchen_row.status or "NEW")
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "label": row.label,
            "floor_plan_id": row.floor_plan_id,
            "pos_x": row.pos_x,
            "pos_y": row.pos_y,
            "is_occupied": bool(row.is_occupied),
            "assigned_to": row.assigned_to,
            "guest_count": int(row.guest_count or 0),
            "deposit_guest_count": int(row.deposit_guest_count or 0),
            "deposit_amount": str(row.deposit_amount or 0),
            "deposit_seat_labels": _json_load(row.deposit_seats_json, []),
            "total": str(row.total),
            "items": _json_load(row.items_json, []),
            "kitchen_status": status_by_table.get(row.label),
        }
        for row in rows
    ]


def _floor_state_payload(db: Session, tenant_id: str, floor: FloorPlan) -> dict:
    tables = (
        db.query(Table)
        .filter(
            Table.tenant_id == tenant_id,
            (Table.floor_plan_id == floor.id) | Table.floor_plan_id.is_(None),
        )
        .order_by(Table.label.asc())
        .all()
    )
    table_ids = [row.id for row in tables]

    active_sessions_by_table: dict[str, TableSession] = {}
    checks_by_session: dict[str, Check] = {}
    reserved_by_table: dict[str, Reservation] = {}

    if table_ids:
        sessions = (
            db.query(TableSession)
            .filter(
                TableSession.tenant_id == tenant_id,
                TableSession.table_id.in_(table_ids),
                TableSession.closed_at.is_(None),
            )
            .order_by(TableSession.table_id.asc(), TableSession.seated_at.desc())
            .all()
        )
        for session in sessions:
            if session.table_id not in active_sessions_by_table:
                active_sessions_by_table[session.table_id] = session

        session_ids = [row.id for row in active_sessions_by_table.values()]
        if session_ids:
            checks = (
                db.query(Check)
                .filter(
                    Check.tenant_id == tenant_id,
                    Check.table_session_id.in_(session_ids),
                    Check.status.in_(["OPEN", "PARTIALLY_PAID"]),
                )
                .order_by(Check.table_session_id.asc(), Check.opened_at.desc())
                .all()
            )
            for check in checks:
                if check.table_session_id not in checks_by_session:
                    checks_by_session[check.table_session_id] = check

        now = _restaurant_now()
        lock_until = now + timedelta(hours=_reservation_lock_hours(db, tenant_id))
        late_release_cutoff = now - timedelta(minutes=_late_release_minutes(db, tenant_id))
        reservations = (
            db.query(Reservation)
            .filter(
                Reservation.tenant_id == tenant_id,
                Reservation.assigned_table_id.in_(table_ids),
                Reservation.status.in_(["BOOKED", "LATE"]),
                Reservation.reservation_at >= late_release_cutoff,
                Reservation.reservation_at <= lock_until,
            )
            .order_by(Reservation.reservation_at.asc())
            .all()
        )
        for reservation in reservations:
            table_id_key = str(reservation.assigned_table_id or "")
            if not table_id_key or table_id_key in reserved_by_table:
                continue
            status_value = str(reservation.status or "").upper()
            is_locked_booked = status_value == "BOOKED" and reservation.reservation_at >= now
            is_late_hold = status_value == "LATE" and reservation.reservation_at <= now
            if is_locked_booked or is_late_hold:
                reserved_by_table[table_id_key] = reservation

    floor_tables_payload: list[dict] = []
    for table in tables:
        active_session = active_sessions_by_table.get(table.id)
        active_check = checks_by_session.get(active_session.id) if active_session else None
        reserved = reserved_by_table.get(table.id)
        minutes_seated = None
        if active_session and active_session.seated_at:
            minutes_seated = int(max(0, (datetime.utcnow() - active_session.seated_at).total_seconds() // 60))
        computed_status = "AVAILABLE"
        if str(table.status or "").upper() == "DIRTY":
            computed_status = "DIRTY"
        elif active_session:
            computed_status = "ACTIVE_CHECK" if active_check else "SEATED"
        elif reserved:
            computed_status = "RESERVED"

        floor_tables_payload.append(
            {
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
                "locked_by": _table_lock_holder(table),
                "active_session_id": table.active_session_id,
                "locked_at": table.locked_at.isoformat() if table.locked_at else None,
                "status": computed_status,
                "guest_count": active_session.guest_count if active_session else table.guest_count,
                "assigned_waiter": active_session.assigned_waiter if active_session else table.assigned_to,
                "minutes_seated": minutes_seated,
                "check_total": str(active_check.total if active_check else Decimal(str(table.total or 0)).quantize(Decimal("0.01"))),
                "session_id": active_session.id if active_session else None,
                "check_id": active_check.id if active_check else None,
                "reservation": None
                if not reserved
                else {
                    "id": reserved.id,
                    "party_size": reserved.party_size,
                    "reservation_at": reserved.reservation_at.isoformat(),
                },
            }
        )

    return {
        "floor": _floor_plan_payload(floor),
        "tables": floor_tables_payload,
    }


def _normalize_guest_phone(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return "".join(ch for ch in raw if ch.isdigit() or ch == "+")


def _normalize_guest_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def _find_existing_guest(db: Session, tenant_id: str, phone: str | None, email: str | None) -> Guest | None:
    normalized_phone = _normalize_guest_phone(phone)
    normalized_email = _normalize_guest_email(email)
    rows = db.query(Guest).filter(Guest.tenant_id == tenant_id).order_by(Guest.created_at.asc()).all()
    if normalized_phone:
        for row in rows:
            if _normalize_guest_phone(row.phone) == normalized_phone:
                return row
    if normalized_email:
        for row in rows:
            if _normalize_guest_email(row.email) == normalized_email:
                return row
    return None


def _compute_table_status(
    db: Session,
    tenant_id: str,
    table: Table,
    active_session: TableSession | None = None,
    active_check: Check | None = None,
    reserved: Reservation | None = None,
    active_loaded: bool = False,
    reservation_loaded: bool = False,
) -> str:
    if not active_loaded:
        active_session, active_check = _ensure_active_session_and_check(db, tenant_id, table)
    if str(table.status or "").upper() == "DIRTY":
        return "DIRTY"
    if active_session:
        if active_check:
            return "ACTIVE_CHECK"
        return "SEATED"
    if not active_session and not reservation_loaded:
        reserved = _find_locked_reservation(db, tenant_id, table.id)
    if reserved:
        return "RESERVED"
    return "AVAILABLE"


def _table_state_payload(
    db: Session,
    tenant_id: str,
    table: Table,
    active_session: TableSession | None = None,
    active_check: Check | None = None,
    reserved: Reservation | None = None,
    active_loaded: bool = False,
    reservation_loaded: bool = False,
) -> dict:
    if not active_loaded:
        active_session, active_check = _ensure_active_session_and_check(db, tenant_id, table)
    if not active_session and not reservation_loaded:
        reserved = _find_locked_reservation(db, tenant_id, table.id)
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
        "locked_by": _table_lock_holder(table),
        "active_session_id": table.active_session_id,
        "locked_at": table.locked_at.isoformat() if table.locked_at else None,
        "status": _compute_table_status(
            db,
            tenant_id,
            table,
            active_session,
            active_check,
            reserved,
            active_loaded=True,
            reservation_loaded=True,
        ),
        "guest_count": active_session.guest_count if active_session else table.guest_count,
        "assigned_waiter": active_session.assigned_waiter if active_session else table.assigned_to,
        "minutes_seated": minutes_seated,
        "check_total": str(active_check.total if active_check else Decimal(str(table.total or 0)).quantize(Decimal("0.01"))),
        "session_id": active_session.id if active_session else None,
        "check_id": active_check.id if active_check else None,
        "reservation": None if not reserved else {
            "id": reserved.id,
            "party_size": reserved.party_size,
            "reservation_at": reserved.reservation_at.isoformat(),
        },
    }


def _table_detail_payload(db: Session, tenant_id: str, table: Table) -> dict:
    active_session, active_check = _ensure_active_session_and_check(db, tenant_id, table)
    reserved = None if active_session else _find_locked_reservation(db, tenant_id, table.id)
    payments_payload: list[dict] = []
    amount_paid = Decimal("0.00")
    rounds_payload: list[dict] = []
    draft_items_payload: list[dict] = []
    if active_check:
        payments = (
            db.query(Payment)
            .filter(Payment.tenant_id == tenant_id, Payment.check_id == active_check.id)
            .order_by(Payment.paid_at.asc())
            .all()
        )
        amount_paid = sum((Decimal(str(row.amount or 0)) for row in payments if str(row.status or "").upper() == "POSTED"), Decimal("0.00")).quantize(Decimal("0.01"))
        payments_payload = [
            {
                "id": row.id,
                "method": row.method,
                "amount": str(row.amount or Decimal("0.00")),
                "status": row.status,
                "split_group": row.split_group,
                "paid_by": row.paid_by,
                "paid_at": row.paid_at.isoformat() if row.paid_at else None,
            }
            for row in payments
        ]
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
                        "status_reason": item.status_reason,
                        "action_by": item.action_by,
                        "manager_approved_by": item.manager_approved_by,
                        "parent_item_id": item.parent_item_id,
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
        draft_items = (
            db.query(OrderItem)
            .filter(
                OrderItem.tenant_id == tenant_id,
                OrderItem.check_id == active_check.id,
                OrderItem.round_id.is_(None),
                OrderItem.status == "DRAFT",
            )
            .order_by(OrderItem.created_at.asc())
            .all()
        )
        draft_items_payload = [
            {
                "id": item.id,
                "item_name": item.item_name,
                "qty": item.qty,
                "price": str(item.price or Decimal("0.00")),
                "seat_no": item.seat_no,
                "course_no": item.course_no,
                "status": item.status,
                "status_reason": item.status_reason,
                "note": item.note,
                "modifier_json": item.modifier_json,
            }
            for item in draft_items
        ]

    return {
        "table": _table_state_payload(
            db,
            tenant_id,
            table,
            active_session,
            active_check,
            reserved,
            active_loaded=True,
            reservation_loaded=True,
        ),
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
            "amount_paid": str(amount_paid),
            "balance_due": str(max(Decimal(str(active_check.total or 0)) - amount_paid, Decimal("0.00")).quantize(Decimal("0.01"))),
            "opened_at": active_check.opened_at.isoformat() if active_check.opened_at else None,
            "payments": payments_payload,
        },
        "rounds": rounds_payload,
        "draft_items": draft_items_payload,
    }


def _billable_item_price(item: OrderItem) -> Decimal:
    if _normalize_item_status(item.status) in {"VOID_REQUESTED", "VOIDED", "WASTE", "REMAKE"}:
        return Decimal("0.00")
    if _normalize_item_status(item.status) == "COMPED":
        return Decimal("0.00")
    return Decimal(str(item.price or 0)).quantize(Decimal("0.01"))


def _sync_round_status_from_items(db: Session, tenant_id: str, round_id: str | None) -> None:
    if not round_id:
        return
    round_row = db.query(OrderRound).filter(OrderRound.id == round_id, OrderRound.tenant_id == tenant_id).first()
    if not round_row:
        return
    items = db.query(OrderItem).filter(OrderItem.tenant_id == tenant_id, OrderItem.round_id == round_id).all()
    active_statuses = {_normalize_item_status(item.status) for item in items}
    if active_statuses & {"VOID_REQUESTED", "REMAKE", "WASTE"}:
        round_row.status = "VOID_REQUESTED"
    elif active_statuses & {"NEW", "SENT"}:
        round_row.status = "SENT"
    elif active_statuses & {"IN_PREP", "PREPARING"}:
        round_row.status = "PREPARING"
    elif active_statuses & {"READY"}:
        round_row.status = "READY"
    else:
        round_row.status = "DONE"


def _transition_kitchen_item_status(
    db: Session,
    tenant_id: str,
    user: User,
    item: OrderItem,
    next_status: str,
    reason: str,
) -> dict:
    normalized_next = str(next_status or "").upper().strip()
    if normalized_next == "IN_PREP":
        normalized_next = "PREPARING"
    if normalized_next not in {"PREPARING", "READY", "SERVED"}:
        raise HTTPException(status_code=400, detail="Unsupported kitchen item status")
    old_status = _normalize_item_status(item.status or "SENT")
    allowed = {
        "PREPARING": {"NEW", "SENT"},
        "READY": {"NEW", "SENT", "PREPARING"},
        "SERVED": {"READY"},
    }
    if old_status in {"VOID_REQUESTED", "VOIDED", "COMPED", "WASTE", "REMAKE"}:
        raise HTTPException(status_code=400, detail="Cannot update terminal/cancelled item")
    if old_status not in allowed[normalized_next] and old_status != normalized_next:
        raise HTTPException(status_code=400, detail=f"Invalid item transition {old_status} -> {normalized_next}")
    now = datetime.utcnow()
    item.status = normalized_next
    item.action_by = user.username
    if normalized_next == "SERVED":
        item.served_at = now
    _log_item_status(
        db,
        tenant_id,
        item,
        old_status,
        normalized_next,
        user.username,
        reason,
        action_type=f"KITCHEN_{normalized_next}",
        quantity_before=item.qty,
        quantity_after=item.qty,
        billing_effect="none",
        kitchen_effect=f"set_{normalized_next.lower()}",
    )
    _sync_round_status_from_items(db, tenant_id, item.round_id)
    return {"old_status": old_status, "new_status": normalized_next}


def _sync_check_and_table_from_items(db: Session, tenant_id: str, table: Table, active_check: Check | None) -> None:
    if not active_check:
        return
    rows = (
        db.query(OrderItem)
        .filter(OrderItem.tenant_id == tenant_id, OrderItem.check_id == active_check.id)
        .order_by(OrderItem.created_at.asc())
        .all()
    )
    visible_items: list[dict] = []
    subtotal = Decimal("0.00")
    for row in rows:
        effective_price = _billable_item_price(row)
        if effective_price > 0:
            visible_items.append(
                {
                    "id": row.menu_item_id or row.id,
                    "item_name": row.item_name,
                    "qty": row.qty,
                    "price": str(effective_price),
                    "seat_label": f"Seat {row.seat_no}" if row.seat_no else None,
                    "status": row.status,
                    "status_reason": row.status_reason,
                }
            )
        subtotal += effective_price * Decimal(str(row.qty or 0))
    subtotal = subtotal.quantize(Decimal("0.01"))
    service_fee_percent = Decimal(str(_setting_value(db, tenant_id, "service_fee_percent", 0) or 0))
    service_charge = (subtotal * service_fee_percent / Decimal("100")).quantize(Decimal("0.01"))
    active_check.subtotal = subtotal
    active_check.service_charge = service_charge
    active_check.total = (subtotal + service_charge + Decimal(str(active_check.tax_amount or 0))).quantize(Decimal("0.01"))
    table.total = active_check.total
    table.items_json = json.dumps(visible_items, ensure_ascii=False)


def _latest_item_action_log(db: Session, tenant_id: str, item_id: str) -> ItemStatusLog | None:
    return (
        db.query(ItemStatusLog)
        .filter(ItemStatusLog.tenant_id == tenant_id, ItemStatusLog.order_item_id == item_id)
        .order_by(ItemStatusLog.changed_at.desc())
        .first()
    )


def _should_consume_nonbillable_item_stock(db: Session, tenant_id: str, item: OrderItem) -> bool:
    if item.stock_consumed_at:
        return False
    status = _normalize_item_status(item.status)
    if status == "WASTE":
        return True
    if status not in {"COMPED", "REMAKE"}:
        return False
    latest_log = _latest_item_action_log(db, tenant_id, item.id)
    old_status = _normalize_item_status(latest_log.old_status if latest_log else None)
    if item.served_at:
        return True
    return old_status in {"READY", "SERVED"}


def _nonbillable_stock_items_for_check(db: Session, tenant_id: str, check_id: str) -> list[dict]:
    rows = (
        db.query(OrderItem)
        .filter(OrderItem.tenant_id == tenant_id, OrderItem.check_id == check_id)
        .order_by(OrderItem.created_at.asc())
        .all()
    )
    stock_items: list[dict] = []
    for row in rows:
        if not _should_consume_nonbillable_item_stock(db, tenant_id, row):
            continue
        stock_items.append(
            {
                "order_item_id": row.id,
                "item_name": row.item_name,
                "qty": row.qty,
                "price": "0.00",
                "status": row.status,
                "status_reason": row.status_reason,
            }
        )
    return stock_items


def _apply_stock_consumption(
    db: Session,
    tenant_id: str,
    user: User,
    stock_ops: list[tuple],
    *,
    sale_id: str | None,
    source: str,
    table: Table,
    extra: dict | None = None,
) -> None:
    for inventory, qty_required in stock_ops:
        inventory.stock_qty = (Decimal(str(inventory.stock_qty or 0)) - qty_required).quantize(Decimal("0.001"))
        db.add(
            AuditLog(
                tenant_id=tenant_id,
                user=user.username,
                action="INVENTORY_CONSUMED" if source == "restaurant_settlement" else "INVENTORY_WASTE_CONSUMED",
                details=json.dumps(
                    {
                        "item_name": inventory.name,
                        "qty_removed": str(qty_required),
                        "unit": inventory.unit,
                        "remaining_qty": str(inventory.stock_qty),
                        "sale_id": sale_id,
                        "source": source,
                        "table_id": table.id,
                        "table_label": table.label,
                        **(extra or {}),
                    },
                    ensure_ascii=False,
                ),
            )
        )


def _action_stock_consumption_reason(old_status: str, new_status: str) -> str | None:
    if new_status == "WASTE":
        return "waste"
    if new_status == "COMPED" and old_status in {"READY", "SERVED"}:
        return "comped_after_prepared"
    if new_status == "REMAKE" and old_status in {"READY", "SERVED"}:
        return "remake_replaced_prepared_item"
    return None


def _consume_action_item_stock_if_needed(
    db: Session,
    tenant_id: str,
    user: User,
    item: OrderItem,
    table: Table | None,
    *,
    old_status: str,
    new_status: str,
    action: str,
) -> None:
    if item.stock_consumed_at:
        return
    reason = _action_stock_consumption_reason(old_status, new_status)
    if not reason:
        return
    if not table:
        return
    stock_item = {
        "order_item_id": item.id,
        "item_name": item.item_name,
        "qty": item.qty,
        "price": "0.00",
        "status": item.status,
        "status_reason": item.status_reason,
    }
    stock_ops, cogs_total = _collect_stock_ops(db, tenant_id, [stock_item])
    _apply_stock_consumption(
        db,
        tenant_id,
        user,
        stock_ops,
        sale_id=None,
        source=f"restaurant_item_{reason}",
        table=table,
        extra={
            "order_item_id": item.id,
            "check_id": item.check_id,
            "round_id": item.round_id,
            "action": action,
            "old_status": old_status,
            "new_status": new_status,
            "stock_policy": "immediate_nonbillable_item_consumption",
            "waste_cogs": str(cogs_total),
        },
    )
    item.stock_consumed_at = datetime.utcnow()
    item.stock_consumption_reason = reason


def _apply_order_item_action(
    db: Session,
    tenant_id: str,
    user: User,
    item: OrderItem,
    action: str,
    reason: str | None,
    manager_password: str | None = None,
    remake_note: str | None = None,
    reason_code: str | None = None,
    quantity_delta: int | None = None,
    correction_note: str | None = None,
    correction_modifier_json: str | None = None,
) -> dict:
    normalized_action = _normalize_item_action(action)
    current_status = _normalize_item_status(item.status)
    reason_text = str(reason or reason_code or normalized_action).strip()
    rule = ACTION_RULES.get(normalized_action)
    if not rule:
        raise HTTPException(status_code=400, detail="Unsupported item action")
    if current_status == "DRAFT" and normalized_action not in {"DECREASE", "VOID"}:
        raise HTTPException(status_code=400, detail="Draft item can only be edited or deleted")
    if current_status not in rule["allowed"] and not (current_status == "DRAFT" and normalized_action in {"DECREASE", "VOID"}):
        raise HTTPException(status_code=400, detail=f"{normalized_action} is not allowed for {current_status}")
    if current_status in TERMINAL_ITEM_STATUSES and normalized_action != "VOID":
        raise HTTPException(status_code=400, detail=f"{current_status} item cannot be changed")

    manager_user = None
    if current_status in set(rule.get("manager_statuses") or set()):
        manager_user = _resolve_manager_override_user(db, tenant_id, manager_password)

    item.action_by = user.username
    if manager_user:
        item.manager_approved_by = manager_user.username

    base_result = {
        "action": normalized_action,
        "billing_effect": rule.get("billing_effect"),
        "kitchen_effect": rule.get("kitchen_effect"),
        "manager": manager_user.username if manager_user else None,
        "meta": {},
    }

    if normalized_action == "DECREASE":
        delta = max(1, int(quantity_delta or 1))
        if current_status == "DRAFT":
            item.qty = max(0, int(item.qty or 0) - delta)
            if item.qty <= 0:
                item.status = "VOIDED"
                item.cancelled_at = datetime.utcnow()
                item.status_reason = reason_text
            return {**base_result, "final_status": item.status, "meta": {"delta": delta}}
        if delta >= int(item.qty or 0):
            item.status = "VOID_REQUESTED"
            item.cancelled_at = datetime.utcnow()
            item.status_reason = reason_text
            return {**base_result, "final_status": "VOID_REQUESTED", "meta": {"delta": delta, "mode": "full_cancel_request"}}

        item.qty = int(item.qty or 0) - delta
        cancel_item = OrderItem(
            tenant_id=tenant_id,
            check_id=item.check_id,
            round_id=item.round_id,
            table_id=item.table_id,
            menu_item_id=item.menu_item_id,
            seat_no=item.seat_no,
            course_no=item.course_no,
            item_name=item.item_name,
            qty=delta,
            price=item.price,
            status="VOID_REQUESTED",
            status_reason=reason_text,
            action_by=user.username,
            parent_item_id=item.id,
            modifier_json=item.modifier_json,
            note=item.note,
            sent_at=item.sent_at,
            cancelled_at=datetime.utcnow(),
        )
        db.add(cancel_item)
        db.flush()
        _log_item_status(
            db,
            tenant_id,
            cancel_item,
            None,
            "VOID_REQUESTED",
            user.username,
            reason_text,
            action_type="DECREASE",
            quantity_before=0,
            quantity_after=delta,
            approved_by=manager_user.username if manager_user else None,
            reason_code=reason_code,
            billing_effect=rule.get("billing_effect"),
            kitchen_effect=rule.get("kitchen_effect"),
            meta={"parent_item_id": item.id, "mode": "partial_cancel_request"},
        )
        return {**base_result, "final_status": item.status, "partial_cancel_item_id": cancel_item.id, "meta": {"delta": delta, "mode": "partial_cancel_request"}}

    if normalized_action == "VOID":
        if current_status == "DRAFT":
            item.status = "VOIDED"
            item.cancelled_at = datetime.utcnow()
        elif current_status in {"SENT", "PREPARING"}:
            item.status = "VOID_REQUESTED"
            item.cancelled_at = datetime.utcnow()
        elif current_status in {"VOID_REQUESTED", "READY"}:
            if not manager_user:
                manager_user = _resolve_manager_override_user(db, tenant_id, manager_password)
                item.manager_approved_by = manager_user.username
            item.status = "VOIDED"
            item.cancelled_at = datetime.utcnow()
        else:
            raise HTTPException(status_code=400, detail=f"VOID is not allowed for {current_status}")
        item.status_reason = reason_text
        return {**base_result, "final_status": item.status, "manager": manager_user.username if manager_user else None}

    if normalized_action == "COMP":
        item.status = "COMPED"
        item.status_reason = reason_text
        return {**base_result, "final_status": "COMPED"}

    if normalized_action == "WASTE":
        item.status = "WASTE"
        item.status_reason = reason_text
        item.cancelled_at = datetime.utcnow()
        return {**base_result, "final_status": "WASTE"}

    if normalized_action == "REMAKE":
        item.status = "REMAKE"
        item.status_reason = reason_text
        item.cancelled_at = datetime.utcnow()
        next_round_no = (db.query(OrderRound).filter(OrderRound.tenant_id == tenant_id, OrderRound.check_id == item.check_id).count() or 0) + 1
        sent_at = datetime.utcnow()
        remake_round = OrderRound(
            tenant_id=tenant_id,
            check_id=item.check_id,
            round_no=next_round_no,
            course_no=item.course_no or 1,
            status="SENT",
            sent_by=user.username,
            sent_at=sent_at,
        )
        db.add(remake_round)
        db.flush()
        remake_item = OrderItem(
            tenant_id=tenant_id,
            check_id=item.check_id,
            round_id=remake_round.id,
            table_id=item.table_id,
            menu_item_id=item.menu_item_id,
            seat_no=item.seat_no,
            course_no=item.course_no,
            item_name=item.item_name,
            qty=item.qty,
            price=item.price,
            status="SENT",
            status_reason=remake_note or correction_note or reason_text,
            action_by=user.username,
            manager_approved_by=manager_user.username if manager_user else None,
            parent_item_id=item.id,
            modifier_json=correction_modifier_json if correction_modifier_json is not None else item.modifier_json,
            note=correction_note or remake_note or item.note,
            sent_at=sent_at,
        )
        db.add(remake_item)
        db.flush()
        _log_item_status(
            db,
            tenant_id,
            remake_item,
            None,
            "SENT",
            user.username,
            remake_note or correction_note or reason_text,
            action_type="REMAKE",
            quantity_before=0,
            quantity_after=remake_item.qty,
            approved_by=manager_user.username if manager_user else None,
            reason_code=reason_code,
            billing_effect="replacement_item_billable",
            kitchen_effect="correction_remake",
            meta={"parent_item_id": item.id, "round_no": next_round_no},
        )
        return {**base_result, "final_status": "REMAKE", "remake_round_id": remake_round.id, "remake_item_id": remake_item.id, "meta": {"round_no": next_round_no}}

    raise HTTPException(status_code=400, detail="Unsupported item action")


@router.get("/floor-plans")
def get_floor_plans(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    _ensure_default_floor(db, tenant.id)
    rows = db.query(FloorPlan).filter(FloorPlan.tenant_id == tenant.id).order_by(FloorPlan.created_at.asc()).all()
    return [_floor_plan_payload(row) for row in rows]


@router.get("/tables-bootstrap")
def get_tables_bootstrap(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    default_floor = _ensure_default_floor(db, tenant.id)
    floors = db.query(FloorPlan).filter(FloorPlan.tenant_id == tenant.id).order_by(FloorPlan.created_at.asc()).all()
    active_floor = next((row for row in floors if row.is_active), None) or (floors[0] if floors else default_floor)
    return {
        "tables": _tables_list_payload(db, tenant.id),
        "floor_plans": [_floor_plan_payload(row) for row in floors],
        "floor_state": _floor_state_payload(db, tenant.id, active_floor),
    }


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
    _emit_realtime(tenant.id, "floor.updated", {"floor_id": row.id, "action": "created"})
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
    _emit_realtime(tenant.id, "floor.updated", {"floor_id": row.id, "action": "updated"})
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
    return _floor_state_payload(db, tenant.id, floor)


@router.post("/floor-plans/{floor_id}/repair-orphans")
def repair_floor_orphan_tables(
    floor_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    floor = db.query(FloorPlan).filter(FloorPlan.id == floor_id, FloorPlan.tenant_id == tenant.id).first()
    if not floor:
        raise HTTPException(status_code=404, detail="Floor plan not found")
    changed = _assign_unassigned_tables_to_floor(db, tenant.id, floor)
    if changed:
        db.commit()
        _emit_realtime(tenant.id, "floor.updated", {"floor_id": floor.id, "action": "repair-orphans"})
    return {"ok": True, "changed": bool(changed)}


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
    if payload.label is not None:
        next_label = str(payload.label or "").strip()
        if not next_label:
            raise HTTPException(status_code=400, detail="Table label is required")
        duplicate = (
            db.query(Table)
            .filter(
                Table.tenant_id == tenant.id,
                Table.id != table.id,
                Table.label.ilike(next_label),
            )
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="Table already exists")
        if table.label != next_label:
            db.add(
                AuditLog(
                    tenant_id=tenant.id,
                    user=user.username,
                    action="TABLE_RENAMED",
                    details=json.dumps({"table_id": table.id, "before": table.label, "after": next_label}, ensure_ascii=False),
                )
            )
        table.label = next_label
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
        next_status = str(payload.status).upper()
        table.status = next_status
        if next_status == "AVAILABLE":
            table.is_occupied = False
            table.guest_count = 0
            table.deposit_guest_count = 0
            table.deposit_amount = Decimal("0.00")
            table.deposit_seats_json = "[]"
            table.items_json = "[]"
            table.total = Decimal("0.00")
            _release_table_lock(table)
    db.commit()
    _emit_realtime(tenant.id, "floor.updated", {"table_id": table.id, "floor_id": table.floor_plan_id, "action": "layout"})
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


@router.post("/tables/{table_id}/unlock")
def unlock_table(
    table_id: str,
    payload: TableUnlockIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    if not _is_manager(user):
        raise HTTPException(status_code=403, detail="Manager override required")
    table = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    previous_owner = _table_lock_holder(table)
    _release_table_lock(table)
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="TABLE_UNLOCKED",
            details=json.dumps({"table_id": table.id, "table_label": table.label, "old_owner": previous_owner, "reason": payload.reason or ""}, ensure_ascii=False),
        )
    )
    db.commit()
    _emit_realtime(tenant.id, "table.updated", {"table_id": table.id, "action": "unlocked"})
    _emit_realtime(tenant.id, "floor.updated", {"table_id": table.id, "action": "unlocked"})
    return {"ok": True, "old_owner": previous_owner}


@router.post("/tables/{table_id}/transfer-lock")
def transfer_table_lock(
    table_id: str,
    payload: TableLockTransferIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    table = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    old_owner = _table_lock_holder(table)
    if old_owner and old_owner != user.username and not _is_manager(user):
        raise HTTPException(status_code=403, detail=f"Bu masa artıq {old_owner} tərəfindən istifadə olunur")
    new_owner = str(payload.new_owner or "").strip()
    if not new_owner:
        raise HTTPException(status_code=400, detail="New owner is required")
    receiver = db.query(User).filter(User.tenant_id == tenant.id, User.username == new_owner, User.is_active == True).first()  # noqa: E712
    if not receiver or str(receiver.role or "").lower() not in {"staff", "manager", "admin", "super_admin"}:
        raise HTTPException(status_code=404, detail="Target user not found")
    _apply_table_lock(table, receiver.username, table.active_session_id)
    active_session = None
    if table.active_session_id:
        active_session = db.query(TableSession).filter(TableSession.id == table.active_session_id, TableSession.tenant_id == tenant.id).first()
    if active_session:
        active_session.assigned_waiter = receiver.username
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="TABLE_LOCK_TRANSFERRED",
            details=json.dumps(
                {"table_id": table.id, "table_label": table.label, "old_owner": old_owner, "new_owner": receiver.username, "reason": payload.reason or ""},
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    _emit_realtime(tenant.id, "table.updated", {"table_id": table.id, "action": "lock-transferred", "old_owner": old_owner, "new_owner": receiver.username})
    _emit_realtime(tenant.id, "floor.updated", {"table_id": table.id, "action": "lock-transferred"})
    return {"ok": True, "old_owner": old_owner, "new_owner": receiver.username}


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
    _emit_realtime(tenant.id, "floor.updated", {"table_id": source.id, "target_table_id": target.id, "action": "combined"})
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
    _emit_realtime(tenant.id, "floor.updated", {"table_id": table.id, "merged_group_id": merge_id, "action": "split"})
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
        now = _restaurant_now()
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
    next_status = str(payload.status or "BOOKED").upper()
    if next_status not in {"BOOKED", "WAITLIST", "LATE"}:
        next_status = "BOOKED"
    assigned_table_id = payload.assigned_table_id
    if next_status == "WAITLIST":
        assigned_table_id = None
    _validate_reservation_table(db, tenant.id, assigned_table_id, payload.reservation_at, payload.duration_minutes)
    guest = _find_existing_guest(db, tenant.id, payload.phone, payload.email)
    if guest:
        guest.full_name = payload.guest_name.strip() or guest.full_name
        if payload.phone is not None:
            guest.phone = payload.phone
        if payload.email is not None:
            guest.email = payload.email
        if payload.special_note:
            existing_note = str(guest.notes or "").strip()
            next_note = str(payload.special_note or "").strip()
            guest.notes = next_note if not existing_note else f"{existing_note}\n{next_note}"
    else:
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
        assigned_table_id=assigned_table_id,
        reservation_at=payload.reservation_at,
        duration_minutes=max(15, payload.duration_minutes),
        party_size=max(1, payload.party_size),
        status=next_status,
        special_note=payload.special_note,
        created_by=user.username,
    )
    db.add(row)
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="RESERVATION_CREATED", details=payload.guest_name))
    db.commit()
    _emit_realtime(tenant.id, "reservation.updated", {"reservation_id": row.id, "action": "created"})
    if assigned_table_id and next_status in {"BOOKED", "LATE"}:
        _emit_realtime(tenant.id, "floor.updated", {"table_id": assigned_table_id, "action": "reserved"})
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
    matched_guest = None
    if payload.phone is not None or payload.email is not None:
        matched_guest = _find_existing_guest(
            db,
            tenant.id,
            payload.phone if payload.phone is not None else (guest.phone if guest else None),
            payload.email if payload.email is not None else (guest.email if guest else None),
        )
        if matched_guest and guest and matched_guest.id != guest.id:
            row.guest_id = matched_guest.id
            guest = matched_guest
    if payload.guest_name is not None:
        if guest:
            guest.full_name = payload.guest_name.strip()
    if payload.phone is not None and guest:
        guest.phone = payload.phone
    if payload.email is not None and guest:
        guest.email = payload.email
    next_reservation_at = payload.reservation_at if payload.reservation_at is not None else row.reservation_at
    next_duration_minutes = max(15, payload.duration_minutes) if payload.duration_minutes is not None else row.duration_minutes
    if payload.reservation_at is not None:
        row.reservation_at = payload.reservation_at
    if payload.duration_minutes is not None:
        row.duration_minutes = next_duration_minutes
    if payload.party_size is not None:
        row.party_size = max(1, payload.party_size)
    if payload.special_note is not None:
        row.special_note = payload.special_note
        if guest:
            guest.notes = payload.special_note
    if payload.assigned_table_id is not None:
        _validate_reservation_table(db, tenant.id, payload.assigned_table_id, next_reservation_at, next_duration_minutes, exclude_reservation_id=row.id)
        row.assigned_table_id = payload.assigned_table_id
    elif payload.reservation_at is not None or payload.duration_minutes is not None:
        _validate_reservation_table(db, tenant.id, row.assigned_table_id, next_reservation_at, next_duration_minutes, exclude_reservation_id=row.id)
    if payload.status is not None:
        row.status = str(payload.status).upper()
        if row.status == "WAITLIST":
            row.assigned_table_id = None
    db.commit()
    _emit_realtime(tenant.id, "reservation.updated", {"reservation_id": row.id, "action": "updated"})
    if row.assigned_table_id and row.status in {"BOOKED", "LATE"}:
        _emit_realtime(tenant.id, "floor.updated", {"table_id": row.assigned_table_id, "action": "reservation-updated"})
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
    _emit_realtime(tenant.id, "reservation.updated", {"reservation_id": reservation_id, "action": "cancelled"})
    if row.assigned_table_id:
        _emit_realtime(tenant.id, "floor.updated", {"table_id": row.assigned_table_id, "action": "reservation-cancelled"})
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
    if str(reservation.status or "").upper() in {"CANCELLED", "NO_SHOW"}:
        raise HTTPException(status_code=400, detail="Reservation cannot be seated in its current status")
    existing_owner = _table_lock_holder(table)
    if existing_owner and existing_owner != (payload.assigned_waiter or user.username) and not _is_manager(user):
        raise HTTPException(status_code=403, detail=f"Bu masa artıq {existing_owner} tərəfindən istifadə olunur")
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
    _apply_table_lock(table, session.assigned_waiter, session.id)
    table.guest_count = session.guest_count
    table.status = "ACTIVE_CHECK"
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="RESERVATION_SEATED", details=f"{reservation.id}:{table.label}"))
    db.commit()
    _emit_realtime(tenant.id, "reservation.updated", {"reservation_id": reservation.id, "action": "seated", "table_id": table.id})
    _emit_realtime(tenant.id, "table.updated", {"table_id": table.id, "session_id": session.id, "check_id": check.id})
    _emit_realtime(tenant.id, "floor.updated", {"table_id": table.id, "action": "seated"})
    return {"ok": True, "table_session_id": session.id, "check_id": check.id}


@router.post("/checks/{check_id}/draft-items")
def add_check_draft_item(
    check_id: str,
    payload: RestaurantRoundItemIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    check = db.query(Check).filter(Check.id == check_id, Check.tenant_id == tenant.id, Check.status == "OPEN").first()
    if not check:
        raise HTTPException(status_code=404, detail="Open check not found")
    session = db.query(TableSession).filter(TableSession.id == check.table_session_id, TableSession.tenant_id == tenant.id, TableSession.closed_at.is_(None)).first()
    if not session:
        raise HTTPException(status_code=400, detail="Check does not have an active session")
    table = db.query(Table).filter(Table.id == session.table_id, Table.tenant_id == tenant.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    _ensure_table_write_access(table, user)

    row = OrderItem(
        tenant_id=tenant.id,
        check_id=check.id,
        round_id=None,
        table_id=table.id,
        menu_item_id=payload.id,
        seat_no=payload.seat_no,
        course_no=max(1, payload.course_no or 1),
        item_name=payload.item_name,
        qty=payload.qty,
        price=payload.price,
        status="DRAFT",
        modifier_json=payload.modifier_json,
        note=payload.note,
    )
    db.add(row)
    db.flush()
    _log_item_status(db, tenant.id, row, None, "DRAFT", user.username, "Draft item added")
    _sync_check_and_table_from_items(db, tenant.id, table, check)
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="ORDER_DRAFT_ITEM_ADDED", details=json.dumps({"check_id": check.id, "table_id": table.id, "item_id": row.id, "item_name": row.item_name, "qty": row.qty}, ensure_ascii=False)))
    db.commit()
    _emit_realtime(tenant.id, "check.updated", {"table_id": table.id, "check_id": check.id, "action": "draft-item-added"})
    return {"ok": True, "item_id": row.id, "status": row.status}


@router.post("/checks/{check_id}/send")
def send_check_drafts(
    check_id: str,
    payload: SendDraftItemsIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    check = db.query(Check).filter(Check.id == check_id, Check.tenant_id == tenant.id, Check.status == "OPEN").first()
    if not check:
        raise HTTPException(status_code=404, detail="Open check not found")
    session = db.query(TableSession).filter(TableSession.id == check.table_session_id, TableSession.tenant_id == tenant.id, TableSession.closed_at.is_(None)).first()
    if not session:
        raise HTTPException(status_code=400, detail="Check does not have an active session")
    table = db.query(Table).filter(Table.id == session.table_id, Table.tenant_id == tenant.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    _ensure_table_write_access(table, user)

    draft_items = (
        db.query(OrderItem)
        .filter(
            OrderItem.tenant_id == tenant.id,
            OrderItem.check_id == check.id,
            OrderItem.round_id.is_(None),
            OrderItem.status == "DRAFT",
        )
        .order_by(OrderItem.created_at.asc())
        .with_for_update()
        .all()
    )
    if not draft_items:
        raise HTTPException(status_code=400, detail="No draft items to send")

    next_round_no = (db.query(OrderRound).filter(OrderRound.tenant_id == tenant.id, OrderRound.check_id == check.id).count() or 0) + 1
    sent_at = datetime.utcnow()
    round_row = OrderRound(
        tenant_id=tenant.id,
        check_id=check.id,
        round_no=next_round_no,
        course_no=max(1, payload.course_no or 1),
        status="SENT",
        sent_by=payload.sent_by or user.username,
        sent_at=sent_at,
    )
    db.add(round_row)
    db.flush()

    items_payload: list[dict] = []
    for item in draft_items:
        old_status = item.status
        item.round_id = round_row.id
        item.status = "SENT"
        item.sent_at = sent_at
        item.action_by = user.username
        _log_item_status(db, tenant.id, item, old_status, "SENT", user.username, f"Round {next_round_no} sent")
        items_payload.append(
            {
                "item_name": item.item_name,
                "qty": item.qty,
                "price": str(item.price or Decimal("0.00")),
                "seat_label": f"Seat {item.seat_no}" if item.seat_no else None,
                "course_no": item.course_no,
                "note": item.note,
                "modifier_json": item.modifier_json,
            }
        )

    kitchen_row = KitchenOrder(
        tenant_id=tenant.id,
        table_label=table.label,
        order_type="Dine In",
        status="NEW",
        priority="NORMAL",
        items_json=json.dumps(items_payload, ensure_ascii=False),
    )
    db.add(kitchen_row)
    _sync_check_and_table_from_items(db, tenant.id, table, check)
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="ROUND_SENT", details=json.dumps({"table_id": table.id, "table": table.label, "check_id": check.id, "round_id": round_row.id, "round_no": next_round_no, "item_count": len(draft_items)}, ensure_ascii=False)))
    db.commit()
    _emit_realtime(tenant.id, "kitchen.updated", {"table_id": table.id, "round_id": round_row.id, "status": "SENT"})
    _emit_realtime(tenant.id, "check.updated", {"table_id": table.id, "check_id": check.id, "round_id": round_row.id, "action": "drafts-sent"})
    _emit_realtime(tenant.id, "table.updated", {"table_id": table.id, "round_id": round_row.id, "action": "round-sent"})
    return {"ok": True, "round_id": round_row.id, "round_no": round_row.round_no, "sent_count": len(draft_items), "check_total": str(check.total or Decimal("0.00"))}


@router.patch("/order-items/{item_id}/draft")
def update_draft_item(
    item_id: str,
    payload: DraftItemUpdateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    item = db.query(OrderItem).filter(OrderItem.id == item_id, OrderItem.tenant_id == tenant.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    if str(item.status or "").upper() != "DRAFT" or item.round_id is not None:
        raise HTTPException(status_code=400, detail="Only draft items can be edited directly")
    table = db.query(Table).filter(Table.id == item.table_id, Table.tenant_id == tenant.id).first() if item.table_id else None
    check = db.query(Check).filter(Check.id == item.check_id, Check.tenant_id == tenant.id).first()
    if table:
        _ensure_table_write_access(table, user)
    if payload.qty is not None:
        item.qty = payload.qty
    if payload.note is not None:
        item.note = payload.note
    if payload.modifier_json is not None:
        item.modifier_json = payload.modifier_json
    if table and check:
        _sync_check_and_table_from_items(db, tenant.id, table, check)
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="ORDER_DRAFT_ITEM_UPDATED", details=json.dumps({"item_id": item.id, "qty": item.qty}, ensure_ascii=False)))
    db.commit()
    if table and check:
        _emit_realtime(tenant.id, "check.updated", {"table_id": table.id, "check_id": check.id, "action": "draft-item-updated"})
    return {"ok": True, "item_id": item.id, "status": item.status, "qty": item.qty}


@router.delete("/order-items/{item_id}/draft")
def delete_draft_item(
    item_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    item = db.query(OrderItem).filter(OrderItem.id == item_id, OrderItem.tenant_id == tenant.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    if str(item.status or "").upper() != "DRAFT" or item.round_id is not None:
        raise HTTPException(status_code=400, detail="Only draft items can be removed directly")
    table = db.query(Table).filter(Table.id == item.table_id, Table.tenant_id == tenant.id).first() if item.table_id else None
    check = db.query(Check).filter(Check.id == item.check_id, Check.tenant_id == tenant.id).first()
    if table:
        _ensure_table_write_access(table, user)
    old_status = item.status
    item.status = "VOIDED"
    item.cancelled_at = datetime.utcnow()
    item.action_by = user.username
    item.status_reason = "Draft removed"
    _log_item_status(db, tenant.id, item, old_status, "VOIDED", user.username, "Draft removed")
    if table and check:
        _sync_check_and_table_from_items(db, tenant.id, table, check)
    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="ORDER_DRAFT_ITEM_REMOVED", details=json.dumps({"item_id": item.id, "item_name": item.item_name}, ensure_ascii=False)))
    db.commit()
    if table and check:
        _emit_realtime(tenant.id, "check.updated", {"table_id": table.id, "check_id": check.id, "action": "draft-item-removed"})
    return {"ok": True, "item_id": item.id, "status": item.status}


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
    _ensure_table_write_access(table, user)
    active_session, active_check = _ensure_active_session_and_check(db, tenant.id, table)
    if not active_session:
        raise HTTPException(status_code=400, detail="Table does not have an active session")
    if not active_check:
        raise HTTPException(status_code=400, detail="Open check not found")
    next_round_no = (db.query(OrderRound).filter(OrderRound.tenant_id == tenant.id, OrderRound.check_id == active_check.id).count() or 0) + 1
    round_row = OrderRound(
        tenant_id=tenant.id,
        check_id=active_check.id,
        round_no=next_round_no,
        course_no=max(1, payload.course_no or 1),
        status="SENT",
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
            status="SENT",
            sent_at=round_row.sent_at or datetime.utcnow(),
            modifier_json=item.modifier_json,
            note=item.note,
        )
        db.add(row)
        db.flush()
        _log_item_status(db, tenant.id, row, None, "SENT", user.username, f"Round {next_round_no} sent")
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
    table.items_json = json.dumps(
        _merge_table_items(
            _json_load(table.items_json, []),
            [
                {
                    "id": row.get("id"),
                    "item_name": row["item_name"],
                    "qty": row["qty"],
                    "price": row["price"],
                    "category": row.get("category"),
                    "is_coffee": bool(row.get("is_coffee")),
                    "seat_label": f"Seat {row['seat_no']}" if row.get("seat_no") else None,
                }
                for row in items_payload
            ],
        ),
        ensure_ascii=False,
    )
    table.is_occupied = True
    table.status = "ACTIVE_CHECK"
    if not _table_lock_holder(table):
        _apply_table_lock(table, active_session.assigned_waiter or payload.sent_by or user.username, active_session.id)

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
    _emit_realtime(tenant.id, "check.updated", {"table_id": table.id, "check_id": active_check.id, "round_id": round_row.id, "action": "round-sent"})
    _emit_realtime(tenant.id, "kitchen.updated", {"table_id": table.id, "round_id": round_row.id, "status": "NEW"})
    _emit_realtime(tenant.id, "floor.updated", {"table_id": table.id, "action": "active-check"})
    return {
        "ok": True,
        "round_id": round_row.id,
        "check_id": active_check.id,
        "round_no": next_round_no,
        "check_total": str(active_check.total),
    }


@router.post("/order-items/{item_id}/action")
def act_on_order_item(
    item_id: str,
    payload: OrderItemActionIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    item = db.query(OrderItem).filter(OrderItem.id == item_id, OrderItem.tenant_id == tenant.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    table = db.query(Table).filter(Table.id == item.table_id, Table.tenant_id == tenant.id).first() if item.table_id else None
    if table:
        _ensure_table_write_access(table, user)
    old_status = _normalize_item_status(item.status)
    old_qty = int(item.qty or 0)
    result = _apply_order_item_action(
        db,
        tenant.id,
        user,
        item,
        payload.action,
        payload.reason,
        manager_password=payload.manager_password,
        remake_note=payload.remake_note,
        reason_code=payload.reason_code,
        quantity_delta=payload.quantity_delta,
        correction_note=payload.note,
        correction_modifier_json=payload.modifier_json,
    )
    new_status = _normalize_item_status(item.status)
    new_qty = int(item.qty or 0)
    if old_status != new_status or old_qty != new_qty:
        if new_status in {"VOIDED", "VOID_REQUESTED", "WASTE", "REMAKE"} and not item.cancelled_at:
            item.cancelled_at = datetime.utcnow()
        _log_item_status(
            db,
            tenant.id,
            item,
            old_status,
            new_status,
            user.username,
            payload.reason,
            action_type=result.get("action") or _normalize_item_action(payload.action),
            quantity_before=old_qty,
            quantity_after=new_qty,
            approved_by=result.get("manager"),
            reason_code=payload.reason_code,
            billing_effect=result.get("billing_effect"),
            kitchen_effect=result.get("kitchen_effect"),
            meta=result.get("meta") or {},
        )
        _sync_round_status_from_items(db, tenant.id, item.round_id)
        _consume_action_item_stock_if_needed(
            db,
            tenant.id,
            user,
            item,
            table,
            old_status=old_status,
            new_status=new_status,
            action=result.get("action") or _normalize_item_action(payload.action),
        )
    active_check = db.query(Check).filter(Check.id == item.check_id, Check.tenant_id == tenant.id).first()
    if table and active_check:
        _sync_check_and_table_from_items(db, tenant.id, table, active_check)
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="ORDER_ITEM_ACTION",
            details=json.dumps(
                {
                    "item_id": item.id,
                    "table_id": item.table_id,
                    "check_id": item.check_id,
                    "action": str(payload.action or "").upper(),
                    "final_status": result.get("final_status"),
                    "reason": payload.reason,
                    "reason_code": payload.reason_code,
                    "quantity_before": old_qty,
                    "quantity_after": new_qty,
                    "manager_id": result.get("manager"),
                    "billing_effect": result.get("billing_effect"),
                    "kitchen_effect": result.get("kitchen_effect"),
                    "meta": result.get("meta") or {},
                    "timestamp": datetime.utcnow().isoformat(),
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    if table:
        _emit_realtime(tenant.id, "table.updated", {"table_id": table.id, "action": "item-status", "item_id": item.id, "status": item.status})
        _emit_realtime(tenant.id, "check.updated", {"table_id": table.id, "check_id": item.check_id, "action": "item-status"})
        _emit_realtime(tenant.id, "kitchen.updated", {"table_id": table.id, "round_id": item.round_id, "status": item.status})
    return {
        "ok": True,
        "item_id": item.id,
        "status": item.status,
        "qty": item.qty,
        "manager_approved_by": item.manager_approved_by,
        "partial_cancel_item_id": result.get("partial_cancel_item_id"),
        "remake_item_id": result.get("remake_item_id"),
        "remake_round_id": result.get("remake_round_id"),
    }


@router.post("/tables/{table_id}/settle-check")
def settle_check(
    table_id: str,
    payload: SettleCheckIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    table = db.query(Table).filter(Table.id == table_id, Table.tenant_id == tenant.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    _ensure_table_write_access(table, user)
    active_session, active_check = _ensure_active_session_and_check(db, tenant.id, table)
    if not active_session:
        raise HTTPException(status_code=400, detail="Table does not have an active session")
    if not active_check:
        raise HTTPException(status_code=400, detail="Open check not found")

    items = _json_load(table.items_json, [])
    deposit_amount = Decimal(str(table.deposit_amount or 0)).quantize(Decimal("0.01"))
    items_total = sum((Decimal(str(item.get("price") or 0)) * Decimal(str(item.get("qty") or 0)) for item in items), Decimal("0.00")).quantize(Decimal("0.01"))
    service_fee_percent = Decimal(str(_setting_value(db, tenant.id, "service_fee_percent", 0) or 0))
    service_fee_amount = (items_total * service_fee_percent / Decimal("100")).quantize(Decimal("0.01"))
    final_total = max(items_total + service_fee_amount, deposit_amount).quantize(Decimal("0.01"))
    extra_due = max(final_total - deposit_amount, Decimal("0.00")).quantize(Decimal("0.01"))

    existing_payments = (
        db.query(Payment)
        .filter(Payment.tenant_id == tenant.id, Payment.check_id == active_check.id, Payment.status == "POSTED")
        .all()
    )
    already_paid = sum((Decimal(str(row.amount or 0)) for row in existing_payments), Decimal("0.00")).quantize(Decimal("0.01"))
    balance_due = max(extra_due - already_paid, Decimal("0.00")).quantize(Decimal("0.01"))

    payment_parts: list[tuple[str, Decimal]] = []
    if payload.parts:
      for row in payload.parts:
        amount = Decimal(str(row.amount or 0)).quantize(Decimal("0.01"))
        if amount > 0:
            payment_parts.append((_normalize_payment_method(row.method), amount))
    else:
        payment_method = _normalize_payment_method(payload.payment_method)
        if payment_method == "split":
            split_cash = Decimal(str(payload.split_cash or 0)).quantize(Decimal("0.01"))
            split_card = Decimal(str(payload.split_card or 0)).quantize(Decimal("0.01"))
            if split_cash > 0:
                payment_parts.append(("cash", split_cash))
            if split_card > 0:
                payment_parts.append(("card", split_card))
        elif balance_due > 0:
            payment_parts.append((payment_method, balance_due))

    payment_total = sum((amount for _, amount in payment_parts), Decimal("0.00")).quantize(Decimal("0.01"))
    if payment_total != balance_due:
        raise HTTPException(status_code=400, detail="Payment parts must match the outstanding balance")

    stock_ops, cogs_total = _collect_stock_ops(db, tenant.id, items)
    receipt_code = secrets.token_hex(5).upper()
    receipt_token = secrets.token_hex(10)
    sale = Sale(
        tenant_id=tenant.id,
        cashier=user.username,
        customer_card_id=None,
        payment_method=payload.payment_method,
        order_type="Dine In",
        receipt_code=receipt_code,
        receipt_token=receipt_token,
        total=final_total,
        discount_amount=Decimal("0.00"),
        cogs=cogs_total,
        items_json=json.dumps(items, ensure_ascii=False),
        status="COMPLETED",
        created_at=datetime.utcnow(),
    )
    db.add(sale)
    db.flush()

    split_group = str(uuid.uuid4()) if len(payment_parts) > 1 else None
    for method, amount in payment_parts:
        normalized = "cash" if method in {"cash", "nəğd", "staff"} else "card"
        db.add(
            Payment(
                tenant_id=tenant.id,
                check_id=active_check.id,
                method=normalized.upper(),
                amount=amount,
                status="POSTED",
                split_group=split_group,
                paid_by=user.username,
            )
        )
        _post_sale_payment(
            db,
            tenant_id=tenant.id,
            sale_id=sale.id,
            amount=amount,
            payment_source=normalized,
            created_by=user.username,
            category="Satış (Nağd)" if normalized == "cash" else "Satış (Kart)",
            note=f"Restaurant check payment {sale.id}",
            related_table_id=table.id,
        )

    if deposit_amount > 0:
        _post_deposit_apply_to_bill(
            db,
            tenant_id=tenant.id,
            amount=deposit_amount,
            created_by=user.username,
            note=f"Restaurant check deposit settlement {sale.id}",
            related_table_id=table.id,
            related_order_id=sale.id,
        )

    _apply_stock_consumption(
        db,
        tenant.id,
        user,
        stock_ops,
        sale_id=sale.id,
        source="restaurant_settlement",
        table=table,
    )
    _post_sale_cogs(
        db,
        tenant_id=tenant.id,
        sale_id=sale.id,
        amount=Decimal(str(cogs_total or 0)).quantize(Decimal("0.01")),
        created_by=user.username,
        note=f"Restaurant sale COGS {sale.id}",
        related_table_id=table.id,
    )

    nonbillable_stock_items = _nonbillable_stock_items_for_check(db, tenant.id, active_check.id)
    if nonbillable_stock_items:
        waste_stock_ops, waste_cogs_total = _collect_stock_ops(db, tenant.id, nonbillable_stock_items)
        _apply_stock_consumption(
            db,
            tenant.id,
            user,
            waste_stock_ops,
            sale_id=sale.id,
            source="restaurant_nonbillable_waste",
            table=table,
            extra={
                "stock_policy": "nonbillable_prepared_or_waste_item",
                "source_items": nonbillable_stock_items,
                "waste_cogs": str(waste_cogs_total),
            },
        )

    done_time = datetime.utcnow()
    active_check.subtotal = items_total
    active_check.service_charge = service_fee_amount
    active_check.tax_amount = Decimal("0.00")
    active_check.total = final_total
    active_check.status = "CLOSED"
    active_check.closed_at = done_time
    active_session.status = "CLOSED"
    active_session.closed_at = done_time
    db.query(OrderRound).filter(OrderRound.tenant_id == tenant.id, OrderRound.check_id == active_check.id).update({"status": "DONE"}, synchronize_session=False)
    db.query(OrderItem).filter(OrderItem.tenant_id == tenant.id, OrderItem.check_id == active_check.id, OrderItem.status.in_(["NEW", "SENT", "PREPARING", "READY"])).update({"status": "SERVED"}, synchronize_session=False)
    kitchen_rows = (
        db.query(KitchenOrder)
        .filter(KitchenOrder.tenant_id == tenant.id, KitchenOrder.table_label == table.label, KitchenOrder.status.in_(["NEW", "PREPARING", "READY"]))
        .all()
    )
    for kitchen_row in kitchen_rows:
        kitchen_row.status = "DONE"
        kitchen_row.completed_at = done_time

    table.is_occupied = False
    table.guest_count = 0
    table.deposit_guest_count = 0
    table.deposit_amount = Decimal("0.00")
    table.deposit_seats_json = "[]"
    table.items_json = "[]"
    table.total = Decimal("0.00")
    table.status = "DIRTY"
    _release_table_lock(table)

    db.add(AuditLog(tenant_id=tenant.id, user=user.username, action="CHECK_SETTLED", details=f"{table.label}:{active_check.check_number}"))
    db.commit()
    _emit_realtime(tenant.id, "check.updated", {"table_id": table.id, "check_id": active_check.id, "action": "settled"})
    _emit_realtime(tenant.id, "floor.updated", {"table_id": table.id, "action": "dirty"})
    _emit_realtime(tenant.id, "kitchen.updated", {"table_id": table.id, "action": "closed"})
    return {
        "ok": True,
        "sale_id": sale.id,
        "check_id": active_check.id,
        "check_number": active_check.check_number,
        "items_total": str(items_total),
        "service_fee_amount": str(service_fee_amount),
        "deposit_amount": str(deposit_amount),
        "extra_due": str(extra_due),
        "final_total": str(final_total),
        "payment_total": str(payment_total),
        "payment_count": len(payment_parts),
        "check_status": active_check.status,
    }


@router.get("/kitchen-feed")
def get_kitchen_feed(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    active_statuses = ["NEW", "SENT", "PREPARING", "READY", "VOID_REQUESTED"]
    recent_cutoff = datetime.utcnow() - timedelta(hours=6)
    rows = (
        db.query(OrderRound, Table, Check)
        .join(Check, Check.id == OrderRound.check_id)
        .join(TableSession, TableSession.id == Check.table_session_id)
        .join(Table, Table.id == TableSession.table_id)
        .filter(
            OrderRound.tenant_id == tenant.id,
            OrderRound.status.in_(active_statuses),
            OrderRound.sent_at >= recent_cutoff,
        )
        .order_by(OrderRound.sent_at.desc())
        .limit(200)
        .all()
    )
    round_ids = [round_row.id for round_row, _, _ in rows]
    item_rows = {}
    if round_ids:
        for item in (
            db.query(OrderItem)
            .filter(OrderItem.tenant_id == tenant.id, OrderItem.round_id.in_(round_ids), OrderItem.status.in_(["NEW", "SENT", "PREPARING", "READY", "SERVED", "VOID_REQUESTED", "VOIDED", "COMPED", "WASTE", "REMAKE"]))
            .order_by(OrderItem.created_at.asc())
            .all()
        ):
            item_rows.setdefault(item.round_id, []).append(
                {
                    "id": item.id,
                    "item_name": item.item_name,
                    "qty": item.qty,
                    "price": str(item.price or Decimal("0.00")),
                    "seat_label": f"Seat {item.seat_no}" if item.seat_no else None,
                    "action": item.status,
                    "status": item.status,
                    "sent_at": item.sent_at.isoformat() if item.sent_at else None,
                    "served_at": item.served_at.isoformat() if item.served_at else None,
                    "cancelled_at": item.cancelled_at.isoformat() if item.cancelled_at else None,
                    "course_no": item.course_no,
                    "note": item.note,
                    "reason": item.status_reason,
                    "parent_item_id": item.parent_item_id,
                    "modifier_json": item.modifier_json,
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
    items_to_start = (
        db.query(OrderItem)
        .filter(OrderItem.tenant_id == tenant.id, OrderItem.round_id == row.id, OrderItem.status.in_(["NEW", "SENT"]))
        .all()
    )
    for item in items_to_start:
        _transition_kitchen_item_status(db, tenant.id, user, item, "PREPARING", "Kitchen accepted")
    check = db.query(Check).filter(Check.id == row.check_id, Check.tenant_id == tenant.id).first()
    table = None
    if check:
        session = db.query(TableSession).filter(TableSession.id == check.table_session_id, TableSession.tenant_id == tenant.id).first()
        if session:
            table = db.query(Table).filter(Table.id == session.table_id, Table.tenant_id == tenant.id).first()
    db.commit()
    _emit_realtime(tenant.id, "kitchen.updated", {"round_id": row.id, "table_id": table.id if table else None, "status": "PREPARING"})
    _emit_realtime(tenant.id, "table.updated", {"table_id": table.id if table else None, "round_id": row.id, "action": "preparing"})
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
        if str(item.status or "").upper() in {"VOIDED", "WASTE", "COMPED", "VOID_REQUESTED"}:
            continue
        ready_key = f"{item.item_name} · Seat {item.seat_no}" if item.seat_no else item.item_name
        if not ready_items or ready_key in ready_items or item.item_name in ready_items:
            _transition_kitchen_item_status(db, tenant.id, user, item, "READY", "Kitchen marked ready")
    check = db.query(Check).filter(Check.id == row.check_id, Check.tenant_id == tenant.id).first()
    table = None
    if check:
        session = db.query(TableSession).filter(TableSession.id == check.table_session_id, TableSession.tenant_id == tenant.id).first()
        if session:
            table = db.query(Table).filter(Table.id == session.table_id, Table.tenant_id == tenant.id).first()
    db.commit()
    _emit_realtime(tenant.id, "kitchen.updated", {"round_id": row.id, "table_id": table.id if table else None, "status": "READY"})
    _emit_realtime(tenant.id, "table.updated", {"table_id": table.id if table else None, "round_id": row.id, "action": "ready"})
    return {"success": True}


@router.post("/kitchen/items/{item_id}/start")
def start_kitchen_item(
    item_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    item = db.query(OrderItem).filter(OrderItem.id == item_id, OrderItem.tenant_id == tenant.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    result = _transition_kitchen_item_status(db, tenant.id, user, item, "PREPARING", "Kitchen item started")
    check = db.query(Check).filter(Check.id == item.check_id, Check.tenant_id == tenant.id).first()
    table = db.query(Table).filter(Table.id == item.table_id, Table.tenant_id == tenant.id).first() if item.table_id else None
    if table and check:
        _sync_check_and_table_from_items(db, tenant.id, table, check)
    db.commit()
    _emit_realtime(tenant.id, "kitchen.updated", {"item_id": item.id, "round_id": item.round_id, "table_id": table.id if table else None, "status": item.status})
    _emit_realtime(tenant.id, "table.updated", {"item_id": item.id, "round_id": item.round_id, "table_id": table.id if table else None, "action": "item-preparing"})
    return {"success": True, "item_id": item.id, **result}


@router.post("/kitchen/items/{item_id}/ready")
def ready_kitchen_item(
    item_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    item = db.query(OrderItem).filter(OrderItem.id == item_id, OrderItem.tenant_id == tenant.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    result = _transition_kitchen_item_status(db, tenant.id, user, item, "READY", "Kitchen item ready")
    check = db.query(Check).filter(Check.id == item.check_id, Check.tenant_id == tenant.id).first()
    table = db.query(Table).filter(Table.id == item.table_id, Table.tenant_id == tenant.id).first() if item.table_id else None
    if table and check:
        _sync_check_and_table_from_items(db, tenant.id, table, check)
    db.commit()
    _emit_realtime(tenant.id, "kitchen.updated", {"item_id": item.id, "round_id": item.round_id, "table_id": table.id if table else None, "status": item.status})
    _emit_realtime(tenant.id, "table.updated", {"item_id": item.id, "round_id": item.round_id, "table_id": table.id if table else None, "action": "item-ready"})
    return {"success": True, "item_id": item.id, **result}


@router.post("/kitchen/items/{item_id}/serve")
def serve_kitchen_item(
    item_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    item = db.query(OrderItem).filter(OrderItem.id == item_id, OrderItem.tenant_id == tenant.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    result = _transition_kitchen_item_status(db, tenant.id, user, item, "SERVED", "Kitchen item served/picked up")
    check = db.query(Check).filter(Check.id == item.check_id, Check.tenant_id == tenant.id).first()
    table = db.query(Table).filter(Table.id == item.table_id, Table.tenant_id == tenant.id).first() if item.table_id else None
    if table and check:
        _sync_check_and_table_from_items(db, tenant.id, table, check)
    db.commit()
    _emit_realtime(tenant.id, "kitchen.updated", {"item_id": item.id, "round_id": item.round_id, "table_id": table.id if table else None, "status": item.status})
    _emit_realtime(tenant.id, "table.updated", {"item_id": item.id, "round_id": item.round_id, "table_id": table.id if table else None, "action": "item-served"})
    return {"success": True, "item_id": item.id, **result}


@router.get("/order-items/{item_id}/status-logs")
def get_order_item_status_logs(
    item_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_floor_admin(user)
    item = db.query(OrderItem).filter(OrderItem.id == item_id, OrderItem.tenant_id == tenant.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    rows = (
        db.query(ItemStatusLog)
        .filter(ItemStatusLog.tenant_id == tenant.id, ItemStatusLog.order_item_id == item.id)
        .order_by(ItemStatusLog.changed_at.asc())
        .all()
    )
    return [
        {
            "id": row.id,
            "order_item_id": row.order_item_id,
            "check_id": row.check_id,
            "round_id": row.round_id,
            "action_type": row.action_type,
            "old_status": row.old_status,
            "new_status": row.new_status,
            "quantity_before": row.quantity_before,
            "quantity_after": row.quantity_after,
            "changed_by": row.changed_by,
            "approved_by": row.approved_by,
            "reason_code": row.reason_code,
            "reason": row.reason,
            "billing_effect": row.billing_effect,
            "kitchen_effect": row.kitchen_effect,
            "meta": _json_load(row.meta_json, {}) if row.meta_json else {},
            "changed_at": row.changed_at.isoformat() if row.changed_at else None,
        }
        for row in rows
    ]
