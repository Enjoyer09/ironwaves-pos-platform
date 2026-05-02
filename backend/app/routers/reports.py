from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import AuditLog, FinanceAccount, FinanceTransaction, Sale, Setting, Shift, ShiftHandover, Tenant, User
from app.services.finance_service import finance_policy as _finance_policy
from app.services.finance_service import create_finance_transaction_record as _create_finance_transaction_record
from app.services.finance_service import ledger_balances_snapshot as _ledger_balances_snapshot
from app.services.finance_service import post_deposit_apply_to_bill as _post_deposit_apply_to_bill
from app.services.finance_service import post_finance_transaction_with_legacy_mirror as _post_finance_transaction
from app.services.finance_service import shift_cash_breakdown_from_ledger as _shift_cash_breakdown
from app.schemas import OpenShiftIn, ShiftHandoverAcceptIn, ShiftHandoverIn, XReportIn, ZReportIn, ZReportReceiptHtmlIn


router = APIRouter(prefix="/api/v1/reports", tags=["reports"])
STAFF_SHIFT_SESSIONS_KEY = "staff_shift_sessions"
VOID_SALE_STATUSES = ["VOIDED", "VOID", "CANCELLED", "CANCELED"]


def _utcnow() -> datetime:
    # Keep stored timestamps UTC-naive (existing DB model expectation) without using deprecated utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalized(value: str | None) -> str:
    return (value or "").strip().lower()


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


def _group_transaction_amounts(rows: list[FinanceTransaction], exclude_categories: set[str] | None = None) -> tuple[Decimal, list[dict]]:
    groups: dict[str, Decimal] = {}
    excluded = exclude_categories or set()
    for row in rows:
        category = str(row.category or "").strip() or str(row.transaction_type or "").strip() or "Maliyyə əməliyyatı"
        if _normalized(category) in excluded:
            continue
        groups[category] = groups.get(category, Decimal("0")) + Decimal(str(row.amount or 0))
    lines = [
        {"label": label, "amount": str(amount.quantize(Decimal("0.01")))}
        for label, amount in sorted(groups.items(), key=lambda item: item[1], reverse=True)
    ]
    total = sum((Decimal(str(row["amount"])) for row in lines), Decimal("0"))
    return total.quantize(Decimal("0.01")), lines


def _posted_transaction_filters(tenant_id: str, opened_at: datetime | None) -> list:
    filters = [
        FinanceTransaction.tenant_id == tenant_id,
        FinanceTransaction.status == "posted",
    ]
    if opened_at:
        filters.append(FinanceTransaction.created_at >= opened_at)
    return filters


def _posted_transaction_sum(db: Session, tenant_id: str, opened_at: datetime | None, *extra_filters) -> Decimal:
    return Decimal(
        str(
            db.query(func.coalesce(func.sum(FinanceTransaction.amount), 0))
            .filter(*_posted_transaction_filters(tenant_id, opened_at), *extra_filters)
            .scalar()
            or 0
        )
    ).quantize(Decimal("0.01"))


def _group_posted_transaction_amounts(
    db: Session,
    tenant_id: str,
    opened_at: datetime | None,
    *extra_filters,
    exclude_categories: set[str] | None = None,
) -> tuple[Decimal, list[dict]]:
    excluded = exclude_categories or set()
    rows = (
        db.query(
            FinanceTransaction.category,
            FinanceTransaction.transaction_type,
            func.coalesce(func.sum(FinanceTransaction.amount), 0),
        )
        .filter(*_posted_transaction_filters(tenant_id, opened_at), *extra_filters)
        .group_by(FinanceTransaction.category, FinanceTransaction.transaction_type)
        .all()
    )
    lines: list[dict] = []
    for category, transaction_type, amount_raw in rows:
        label = str(category or "").strip() or str(transaction_type or "").strip() or "Maliyyə əməliyyatı"
        if _normalized(label) in excluded:
            continue
        amount = Decimal(str(amount_raw or 0)).quantize(Decimal("0.01"))
        if amount == 0:
            continue
        lines.append({"label": label, "amount": str(amount)})
    lines.sort(key=lambda row: Decimal(str(row["amount"])), reverse=True)
    total = sum((Decimal(str(row["amount"])) for row in lines), Decimal("0"))
    return total.quantize(Decimal("0.01")), lines


def _posted_transactions_since(db: Session, tenant_id: str, opened_at: datetime | None) -> list[FinanceTransaction]:
    query = db.query(FinanceTransaction).filter(
        FinanceTransaction.tenant_id == tenant_id,
        FinanceTransaction.status == "posted",
    )
    if opened_at:
        query = query.filter(FinanceTransaction.created_at >= opened_at)
    return query.all()


def _finance_account_code_map(db: Session, tenant_id: str) -> dict[str, str]:
    rows = db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant_id).all()
    return {row.id: row.code for row in rows}


def _shift_sales_payment_totals(db: Session, tenant_id: str, opened_at: datetime | None, closed_at: datetime | None) -> tuple[Decimal, Decimal]:
    account_codes = _finance_account_code_map(db, tenant_id)
    rows = (
        db.query(
            FinanceTransaction.destination_account_id,
            func.coalesce(func.sum(FinanceTransaction.amount), 0),
        )
        .select_from(FinanceTransaction)
        .join(Sale, and_(Sale.id == FinanceTransaction.related_order_id, Sale.tenant_id == FinanceTransaction.tenant_id))
        .filter(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.status == "posted",
            FinanceTransaction.transaction_type == "income",
            FinanceTransaction.related_order_id.isnot(None),
            ~func.upper(func.coalesce(Sale.status, "")).in_(VOID_SALE_STATUSES),
        )
    )
    if opened_at:
        rows = rows.filter(FinanceTransaction.created_at >= opened_at)
    if closed_at:
        rows = rows.filter(FinanceTransaction.created_at <= closed_at)
    grouped = rows.group_by(FinanceTransaction.destination_account_id).all()
    cash = Decimal("0.00")
    card = Decimal("0.00")
    for account_id, amount_raw in grouped:
        code = account_codes.get(str(account_id or ""))
        amount = Decimal(str(amount_raw or 0)).quantize(Decimal("0.01"))
        if code == "cash":
            cash += amount
        elif code == "card":
            card += amount
    return cash.quantize(Decimal("0.01")), card.quantize(Decimal("0.01"))


def _shift_void_sales_total(db: Session, tenant_id: str, opened_at: datetime | None, closed_at: datetime | None) -> Decimal:
    query = db.query(func.coalesce(func.sum(Sale.total), 0)).filter(
        Sale.tenant_id == tenant_id,
        func.upper(func.coalesce(Sale.status, "")).in_(VOID_SALE_STATUSES),
    )
    if opened_at:
        query = query.filter(Sale.created_at >= opened_at)
    if closed_at:
        query = query.filter(Sale.created_at <= closed_at)
    return Decimal(str(query.scalar() or 0)).quantize(Decimal("0.01"))


def _replace_z_report_money_line(html: str, label: str, amount: Decimal) -> str:
    safe_amount = f"{amount.quantize(Decimal('0.01'))} ₼"
    pattern = rf"(<div class=\"line\"><span>{re.escape(label)}</span><span>)([^<]*)(</span></div>)"
    replacement = rf"\g<1>{safe_amount}\3"
    return re.sub(pattern, replacement, html, count=1)


def _correct_z_report_receipt_html(html: str, cash_sales: Decimal, card_sales: Decimal) -> str:
    if not html:
        return html
    corrected = _replace_z_report_money_line(html, "Nağd Satış", cash_sales)
    corrected = _replace_z_report_money_line(corrected, "Kart Satış", card_sales)
    corrected = _replace_z_report_money_line(corrected, "Ümumi Satış", cash_sales + card_sales)
    return corrected


def _get_active_shift(db: Session, tenant_id: str) -> Shift | None:
    return db.query(Shift).filter(Shift.tenant_id == tenant_id, Shift.status == "open").first()


def _get_active_shift_for_update(db: Session, tenant_id: str) -> Shift | None:
    if not hasattr(db, "query"):
        return _get_active_shift(db, tenant_id)
    try:
        return db.query(Shift).filter(Shift.tenant_id == tenant_id, Shift.status == "open").with_for_update().first()
    except Exception:
        return _get_active_shift(db, tenant_id)


def _get_handover_for_update(db: Session, tenant_id: str, handover_id: str) -> ShiftHandover | None:
    if not hasattr(db, "query"):
        return db.query(ShiftHandover).filter(ShiftHandover.id == handover_id, ShiftHandover.tenant_id == tenant_id).first()
    try:
        return (
            db.query(ShiftHandover)
            .filter(ShiftHandover.id == handover_id, ShiftHandover.tenant_id == tenant_id)
            .with_for_update()
            .first()
        )
    except Exception:
        return db.query(ShiftHandover).filter(ShiftHandover.id == handover_id, ShiftHandover.tenant_id == tenant_id).first()


def _wallet_balance(db: Session, tenant_id: str, source: str) -> Decimal:
    return _ledger_balances_snapshot(db, tenant_id).get(str(source or "").strip().lower(), Decimal("0.00"))


def _setting_value(db: Session, tenant_id: str, key: str, default):
    # Unit-test fakes may not provide query-capable DB sessions.
    if not hasattr(db, "query"):
        return default
    try:
        row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    except Exception:
        return default
    if not row or row.value is None:
        return default
    try:
        import json

        return json.loads(row.value)
    except Exception:
        return default


def _set_setting_value(db: Session, tenant_id: str, key: str, value) -> None:
    # Unit-test fakes may not provide query-capable DB sessions.
    # In that case, keep this as a no-op and let caller continue with in-memory session map.
    if not hasattr(db, "query") or not hasattr(db, "add"):
        return
    try:
        row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
        payload = json.dumps(value, ensure_ascii=False)
        if row:
            row.value = payload
        else:
            db.add(Setting(tenant_id=tenant_id, key=key, value=payload))
    except Exception:
        return


def _staff_shift_sessions(db: Session, tenant_id: str) -> dict[str, str]:
    raw = _setting_value(db, tenant_id, STAFF_SHIFT_SESSIONS_KEY, {})
    if not isinstance(raw, dict):
        return {}
    sessions: dict[str, str] = {}
    for username, opened_at in raw.items():
        key = _normalized(str(username))
        if not key:
            continue
        sessions[key] = str(opened_at or "")
    return sessions


def _open_staff_shift_session(db: Session, tenant_id: str, username: str, opened_at: datetime | None = None) -> dict[str, str]:
    key = _normalized(username)
    if not key:
        return _staff_shift_sessions(db, tenant_id)
    sessions = _staff_shift_sessions(db, tenant_id)
    sessions[key] = (opened_at or _utcnow()).isoformat()
    _set_setting_value(db, tenant_id, STAFF_SHIFT_SESSIONS_KEY, sessions)
    return sessions


def _clear_staff_shift_sessions(db: Session, tenant_id: str) -> None:
    _set_setting_value(db, tenant_id, STAFF_SHIFT_SESSIONS_KEY, {})


def _cash_adjustment_requires_manual_approval(db: Session, tenant_id: str, amount: Decimal) -> bool:
    policy = _finance_policy(db, tenant_id)
    if not bool(policy.get("cash_adjustment_requires_approval", True)):
        return False
    threshold = Decimal(str(policy.get("large_transfer_threshold_azn", 500) or 500))
    return abs(amount) >= threshold


def _validate_shift_handover_cash(db: Session, tenant_id: str, user: User, shift: Shift, declared_cash: Decimal) -> None:
    declared = Decimal(str(declared_cash)).quantize(Decimal("0.01"))
    if declared < 0:
        raise HTTPException(status_code=400, detail="Declared cash cannot be negative")
    expected = _shift_cash_breakdown(db, tenant_id, shift, lock_for_update=True)["expected_cash"].quantize(Decimal("0.01"))
    variance = declared - expected
    if abs(variance) > Decimal("0.01"):
        db.add(
            AuditLog(
                tenant_id=tenant_id,
                user=user.username,
                action="SHIFT_HANDOVER_DECLARED_CASH_REJECTED",
                details=json.dumps({"declared_cash": str(declared), "expected_cash": str(expected), "variance": str(variance)}, ensure_ascii=False),
            )
        )
        raise HTTPException(status_code=400, detail=f"Declared cash does not match expected cash ({expected} ₼)")


@router.get("/status")
def report_status(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = _get_active_shift(db, tenant.id)
    sessions = _staff_shift_sessions(db, tenant.id)
    current_user_key = _normalized(getattr(user, "username", None))
    staff_session_open = current_user_key in sessions if current_user_key else False
    staff_session_opened_at = sessions.get(current_user_key) if current_user_key else None
    if not active:
        return {
            "status": "Closed",
            "tenant_id": tenant.id,
            "staff_shift_required": True,
            "staff_sessions_count": len(sessions),
            "staff_session_open": staff_session_open,
            "staff_session_opened_at": staff_session_opened_at,
        }
    return {
        "status": "Open",
        "tenant_id": tenant.id,
        "opened_by": active.opened_by,
        "opened_at": active.opened_at.isoformat() if active.opened_at else None,
        "opening_cash": str(Decimal(str(active.opening_cash or 0)).quantize(Decimal("0.01"))),
        "opening_source": active.opening_source,
        "opening_target_cash": str(Decimal(str(active.opening_target_cash or 0)).quantize(Decimal("0.01"))),
        "opening_topup_amount": str(Decimal(str(active.opening_topup_amount or 0)).quantize(Decimal("0.01"))),
        "staff_shift_required": True,
        "staff_sessions_count": len(sessions),
        "staff_session_open": staff_session_open,
        "staff_session_opened_at": staff_session_opened_at,
    }


@router.get("/expected-cash")
def expected_cash(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = _get_active_shift(db, tenant.id)
    breakdown = _shift_cash_breakdown(db, tenant.id, active, lock_for_update=True)
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
        sessions = _open_staff_shift_session(db, tenant.id, user.username, _utcnow())
        db.commit()
        current_key = _normalized(user.username)
        return {
            "success": True,
            "shift_id": active.id,
            "already_open": True,
            "opened_by": active.opened_by,
            "opening_cash": str(Decimal(str(active.opening_cash or 0)).quantize(Decimal("0.01"))),
            "staff_session_open": bool(current_key in sessions),
            "staff_session_opened_at": sessions.get(current_key),
        }

    funding_source = _normalized(payload.funding_source or "cash") or "cash"
    valid_sources = {"cash", "safe", "card", "investor"}
    if funding_source not in valid_sources:
        raise HTTPException(status_code=400, detail="Invalid funding source")

    target_cash = Decimal(str(payload.target_cash if payload.target_cash is not None else payload.opening_cash or 0))
    topup_amount = Decimal(str(payload.topup_amount if payload.topup_amount is not None else Decimal("0")))
    if target_cash < 0 or topup_amount < 0:
        raise HTTPException(status_code=400, detail="Amounts must be >= 0")

    try:
        funding_at = _utcnow()
        if topup_amount > 0:
            if funding_source == "investor":
                _post_finance_transaction(
                    db,
                    tenant_id=tenant.id,
                    transaction_type="investor_injection",
                    amount=topup_amount,
                    source_code="investor",
                    destination_code="cash",
                    created_by=user.username,
                    category="Təsisçi İnvestisiyası",
                    note=f"Gün açılışı tamamlanması ({target_cash.quantize(Decimal('0.01'))} ₼ hədəf). Mənbə: investor",
                )
            elif funding_source == "cash":
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Gün açılışında cash mənbədən topup icazəli deyil. "
                        "Topup üçün investor/safe/card seçin."
                    ),
                )
            else:
                source_balance = _wallet_balance(db, tenant.id, funding_source)
                commission = Decimal("0")
                if funding_source == "card":
                    commission_cfg = _setting_value(db, tenant.id, "bank_commission", {"card_transfer_percent": 0.5})
                    card_transfer_percent = Decimal(str(commission_cfg.get("card_transfer_percent", 0.5) or 0.5))
                    commission = (topup_amount * (card_transfer_percent / Decimal("100"))).quantize(Decimal("0.01"))
                if source_balance < topup_amount + commission:
                    raise HTTPException(status_code=400, detail="Insufficient balance")
                _post_finance_transaction(
                    db,
                    tenant_id=tenant.id,
                    transaction_type="internal_transfer",
                    amount=topup_amount,
                    source_code=funding_source,
                    destination_code="cash",
                    created_by=user.username,
                    category="Daxili Transfer",
                    note=f"Gün açılışı üçün {funding_source} -> cash",
                )
                if commission > 0:
                    _post_finance_transaction(
                        db,
                        tenant_id=tenant.id,
                        transaction_type="expense",
                        amount=commission,
                        source_code="card",
                        destination_code="expense",
                        created_by=user.username,
                        category="Bank Komissiyası",
                        note="Gün açılışı üçün kartdan kassaya köçürmə komissiyası",
                    )

        db.flush()
        opening_cash = _ledger_balances_snapshot(db, tenant.id).get("cash", Decimal("0.00")).quantize(Decimal("0.01"))
        opened_at = max(_utcnow(), funding_at + timedelta(milliseconds=1))
        row = Shift(
            tenant_id=tenant.id,
            status="open",
            opened_by=user.username,
            opened_at=opened_at,
            opening_cash=opening_cash,
            opening_source=funding_source,
            opening_target_cash=target_cash.quantize(Decimal("0.01")),
            opening_topup_amount=topup_amount.quantize(Decimal("0.01")),
        )
        db.add(row)
        sessions = _open_staff_shift_session(db, tenant.id, user.username, opened_at)
        db.flush()
        db.commit()
        current_key = _normalized(user.username)
        return {
            "success": True,
            "shift_id": row.id,
            "opening_cash": str(opening_cash),
            "funding_source": funding_source,
            "topup_amount": str(topup_amount.quantize(Decimal("0.01"))),
            "staff_session_open": bool(current_key in sessions),
            "staff_session_opened_at": sessions.get(current_key),
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/x-report")
def x_report(payload: XReportIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = _get_active_shift(db, tenant.id)
    if not active:
        raise HTTPException(status_code=400, detail="Shift is closed")

    breakdown = _shift_cash_breakdown(db, tenant.id, active)
    expected = breakdown["expected_cash"]
    diff = Decimal(str(payload.actual_cash)) - expected

    if diff != 0 and _cash_adjustment_requires_manual_approval(db, tenant.id, diff):
        pending_txn = _create_finance_transaction_record(
            db,
            tenant_id=tenant.id,
            transaction_type="cash_adjustment",
            status="pending_approval",
            amount=abs(diff),
            source_code="adjustment" if diff > 0 else "cash",
            destination_code="cash" if diff > 0 else "adjustment",
            created_by=user.username,
            category="Kassa Artığı" if diff > 0 else "Kassa Kəsiri",
            note="X-report difference (approval required)",
            related_shift_id=active.id if active else None,
        )
        db.add(
            AuditLog(
                tenant_id=tenant.id,
                user=user.username,
                action="FINANCE_X_REPORT_ADJUSTMENT_APPROVAL_REQUESTED",
                details=json.dumps(
                    {
                        "transaction_id": pending_txn.id,
                        "status": pending_txn.status,
                        "difference": str(diff.quantize(Decimal("0.01"))),
                    },
                    ensure_ascii=False,
                ),
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
            "approval_required": True,
            "pending_transaction_id": pending_txn.id,
            "pending_status": pending_txn.status,
        }

    if diff != 0:
        _post_finance_transaction(
            db,
            tenant_id=tenant.id,
            transaction_type="cash_adjustment",
            amount=abs(diff),
            source_code="adjustment" if diff > 0 else "cash",
            destination_code="cash" if diff > 0 else "adjustment",
            created_by=user.username,
            category="Kassa Artığı" if diff > 0 else "Kassa Kəsiri",
            note="X-report difference",
            related_shift_id=active.id if active else None,
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
    active = _get_active_shift_for_update(db, tenant.id)
    if not active:
        raise HTTPException(status_code=400, detail="Shift is closed")

    breakdown_before_wage = _shift_cash_breakdown(db, tenant.id, active, lock_for_update=True)
    if Decimal(str(payload.wage_amount or 0)) > breakdown_before_wage["expected_cash"]:
        raise HTTPException(status_code=400, detail="Kassada maaş üçün kifayət qədər məbləğ yoxdur")

    if payload.wage_amount > 0:
        _post_finance_transaction(
            db,
            tenant_id=tenant.id,
            transaction_type="expense",
            amount=Decimal(str(payload.wage_amount)),
            source_code="cash",
            destination_code="expense",
            created_by=user.username,
            category="Maaş",
            note="Shift close wage",
            related_shift_id=active.id,
        )

    breakdown = _shift_cash_breakdown(db, tenant.id, active, lock_for_update=True)
    expected = breakdown["expected_cash"]
    actual_cash = Decimal(str(payload.actual_cash)).quantize(Decimal("0.01"))
    difference = (actual_cash - expected).quantize(Decimal("0.01"))
    if difference != 0 and _cash_adjustment_requires_manual_approval(db, tenant.id, difference):
        raise HTTPException(
            status_code=400,
            detail="Z-report kassa fərqi approval tələb edir. Finance təsdiqi olmadan bağlanış mümkün deyil.",
        )

    deposit_balance_before = _ledger_balances_snapshot(db, tenant.id).get("deposit", Decimal("0.00")).quantize(Decimal("0.01"))
    deposit_settled_amount = Decimal("0.00")
    if deposit_balance_before > Decimal("0.01") and not bool(payload.allow_open_deposit_close):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Açıq depozit öhdəliyi var ({deposit_balance_before} ₼). "
                "Əvvəl depozitləri bağlayın və ya allow_open_deposit_close=true ilə təsdiqləyin."
            ),
        )
    if deposit_balance_before > Decimal("0.01") and bool(payload.allow_open_deposit_close):
        _post_deposit_apply_to_bill(
            db,
            tenant_id=tenant.id,
            amount=deposit_balance_before,
            created_by=user.username,
            note="Z-report close: open deposit liability settled",
        )
        deposit_settled_amount = deposit_balance_before
    deposit_balance_after = _ledger_balances_snapshot(db, tenant.id).get("deposit", Decimal("0.00")).quantize(Decimal("0.01"))
    if deposit_balance_after > Decimal("0.01"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Depozit öhdəliyi bağlanmadı ({deposit_balance_after} ₼ qalıq). "
                "Z-hesabat bağlanmadan əvvəl depozitləri manual bağlayın."
            ),
        )
    if difference != 0:
        _post_finance_transaction(
            db,
            tenant_id=tenant.id,
            transaction_type="cash_adjustment",
            amount=abs(difference),
            source_code="adjustment" if difference > 0 else "cash",
            destination_code="cash" if difference > 0 else "adjustment",
            created_by=user.username,
            category="Kassa Artığı" if difference > 0 else "Kassa Kəsiri",
            note="Z-report difference",
            related_shift_id=active.id,
    )
    account_codes = _finance_account_code_map(db, tenant.id)
    account_id_by_code = {code: account_id for account_id, code in account_codes.items()}
    report_account_ids = [
        account_id
        for code, account_id in account_id_by_code.items()
        if code in {"cash", "card", "safe", "debt"} and account_id
    ]
    cash_sales, card_sales = _shift_sales_payment_totals(db, tenant.id, active.opened_at, None)
    void_sales = _shift_void_sales_total(db, tenant.id, active.opened_at, None)
    deposit_total = _posted_transaction_sum(
        db,
        tenant.id,
        active.opened_at,
        FinanceTransaction.transaction_type == "deposit_hold",
    )
    other_income_total, other_income_lines = _group_posted_transaction_amounts(
        db,
        tenant.id,
        active.opened_at,
        or_(
            (FinanceTransaction.transaction_type == "income") & FinanceTransaction.related_order_id.is_(None),
            (
                FinanceTransaction.transaction_type.in_(["cash_adjustment", "reconciliation_adjustment"])
                & FinanceTransaction.destination_account_id.in_(report_account_ids)
            ),
            FinanceTransaction.transaction_type == "investor_injection",
        ),
        exclude_categories={"satış (nağd)", "satış (kart)", "staff ödənişi", "depozit alındı"},
    )
    other_expense_total, other_expense_lines = _group_posted_transaction_amounts(
        db,
        tenant.id,
        active.opened_at,
        or_(
            FinanceTransaction.transaction_type == "expense",
            (
                FinanceTransaction.transaction_type.in_(["cash_adjustment", "reconciliation_adjustment"])
                & FinanceTransaction.source_account_id.in_(report_account_ids)
            ),
        ),
        exclude_categories={"maaş"},
    )

    active.status = "closed"
    active.closed_by = user.username
    active.closed_at = _utcnow()
    _clear_staff_shift_sessions(db, tenant.id)
    active.actual_cash = actual_cash
    active.declared_cash = actual_cash
    active.cash_variance = difference
    active.closing_deposit_liability = deposit_balance_after
    active.deposit_settled_amount = deposit_settled_amount
    active.closing_cash = actual_cash.quantize(Decimal("0.01"))
    db.commit()

    return {
        "success": True,
        "shift_id": active.id,
        "closed_at": active.closed_at.isoformat(),
        "total_sales": str((cash_sales + card_sales).quantize(Decimal("0.01"))),
        "cash_sales": str(cash_sales.quantize(Decimal("0.01"))),
        "card_sales": str(card_sales.quantize(Decimal("0.01"))),
        "void_sales": str(void_sales.quantize(Decimal("0.01"))),
        "deposit_total": str(deposit_total.quantize(Decimal("0.01"))),
        "expected_cash": str(expected.quantize(Decimal("0.01"))),
        "actual_cash": str(actual_cash),
        "difference": str(difference),
        "wage_amount": str(Decimal(str(payload.wage_amount)).quantize(Decimal("0.01"))),
        "open_deposit_liability": str(deposit_balance_before),
        "closing_deposit_liability": str(deposit_balance_after),
        "deposit_settled_amount": str(deposit_settled_amount),
        "closing_cash": str(actual_cash.quantize(Decimal("0.01"))),
        "opening_cash": str(breakdown["opening_cash"].quantize(Decimal("0.01"))),
        "cash_movements_in": str(breakdown["cash_in"].quantize(Decimal("0.01"))),
        "cash_movements_out": str(breakdown["cash_out"].quantize(Decimal("0.01"))),
        "other_income_total": str(other_income_total),
        "other_income_lines": other_income_lines,
        "other_expense_total": str(other_expense_total),
        "other_expense_lines": other_expense_lines,
    }


@router.put("/shifts/{shift_id}/z-receipt-html")
def save_z_report_receipt_html(
    shift_id: str,
    payload: ZReportReceiptHtmlIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    row = db.query(Shift).filter(Shift.id == shift_id, Shift.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Shift not found")
    row.z_report_html = payload.receipt_html
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="Z_REPORT_RECEIPT_SNAPSHOT_SAVED",
            details=json.dumps({"shift_id": row.id}, ensure_ascii=False),
        )
    )
    db.commit()
    return {"success": True, "shift_id": row.id}


@router.get("/z-receipts")
def list_z_report_receipts(
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    start = _parse_iso_datetime(date_from)
    end = _parse_iso_datetime(date_to)
    query = db.query(Shift).filter(
        Shift.tenant_id == tenant.id,
        Shift.status == "closed",
        Shift.z_report_html.isnot(None),
    )
    if start:
        query = query.filter(Shift.closed_at >= start)
    if end:
        query = query.filter(Shift.closed_at <= end)
    rows = query.order_by(Shift.closed_at.desc()).limit(limit).all()
    result = []
    for row in rows:
        if not row.z_report_html:
            continue
        cash_sales, card_sales = _shift_sales_payment_totals(db, tenant.id, row.opened_at, row.closed_at)
        void_sales = _shift_void_sales_total(db, tenant.id, row.opened_at, row.closed_at)
        corrected_html = _correct_z_report_receipt_html(row.z_report_html or "", cash_sales, card_sales)
        result.append(
            {
                "id": row.id,
                "opened_at": row.opened_at.isoformat() if row.opened_at else None,
                "closed_at": row.closed_at.isoformat() if row.closed_at else None,
                "opened_by": row.opened_by,
                "closed_by": row.closed_by,
                "actual_cash": str(row.actual_cash) if row.actual_cash is not None else None,
                "cash_variance": str(row.cash_variance) if row.cash_variance is not None else None,
                "cash_sales": str(cash_sales),
                "card_sales": str(card_sales),
                "void_sales": str(void_sales),
                "total_sales": str((cash_sales + card_sales).quantize(Decimal("0.01"))),
                "z_report_html": corrected_html,
            }
        )
    return result


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
    active = _get_active_shift_for_update(db, tenant.id)
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
    declared_cash = Decimal(str(payload.declared_cash)).quantize(Decimal("0.01"))
    _validate_shift_handover_cash(db, tenant.id, user, active, declared_cash)
    row = ShiftHandover(
        tenant_id=tenant.id,
        handed_by=user.username,
        received_by=receiver.username,
        declared_cash=declared_cash,
        status="PENDING",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"success": True, "id": row.id, "status": row.status}


@router.post("/handovers/{handover_id}/accept")
def accept_handover(handover_id: str, payload: ShiftHandoverAcceptIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    active = _get_active_shift_for_update(db, tenant.id)
    if not active:
        raise HTTPException(status_code=400, detail="Shift is closed")
    row = _get_handover_for_update(db, tenant.id, handover_id)
    if not row:
        raise HTTPException(status_code=404, detail="Handover not found")
    if row.status != "PENDING":
        raise HTTPException(status_code=400, detail="Handover already accepted")
    if row.received_by != user.username:
        raise HTTPException(status_code=403, detail="This handover is not assigned to you")

    actual = Decimal(str(payload.actual_cash)).quantize(Decimal("0.01"))
    if actual < 0:
        raise HTTPException(status_code=400, detail="Actual cash cannot be negative")
    declared = Decimal(str(row.declared_cash))
    difference = actual - declared
    pending_txn_id: str | None = None
    pending_status: str | None = None
    approval_required = False
    if difference != 0:
        if _cash_adjustment_requires_manual_approval(db, tenant.id, difference):
            pending_txn = _create_finance_transaction_record(
                db,
                tenant_id=tenant.id,
                transaction_type="cash_adjustment",
                status="pending_approval",
                amount=abs(difference),
                source_code="adjustment" if difference > 0 else "cash",
                destination_code="cash" if difference > 0 else "adjustment",
                created_by=user.username,
                category="Kassa Artığı" if difference > 0 else "Kassa Kəsiri",
                note=f"Smeni qəbul fərqi ({row.handed_by} -> {user.username}) — approval tələb olunur",
                related_shift_id=active.id,
            )
            approval_required = True
            pending_txn_id = pending_txn.id
            pending_status = pending_txn.status
            db.add(
                AuditLog(
                    tenant_id=tenant.id,
                    user=user.username,
                    action="FINANCE_HANDOVER_ADJUSTMENT_APPROVAL_REQUESTED",
                    details=json.dumps(
                        {
                            "handover_id": row.id,
                            "transaction_id": pending_txn.id,
                            "difference": str(difference.quantize(Decimal("0.01"))),
                            "status": pending_txn.status,
                        },
                        ensure_ascii=False,
                    ),
                )
            )
        else:
            _post_finance_transaction(
                db,
                tenant_id=tenant.id,
                transaction_type="cash_adjustment",
                amount=abs(difference),
                source_code="adjustment" if difference > 0 else "cash",
                destination_code="cash" if difference > 0 else "adjustment",
                created_by=user.username,
                category="Kassa Artığı" if difference > 0 else "Kassa Kəsiri",
                note=f"Smeni qəbul fərqi ({row.handed_by} -> {user.username})",
                related_shift_id=active.id,
            )

    active.opened_by = user.username
    row.status = "ACCEPTED"
    row.actual_cash = actual
    row.difference = difference
    row.accepted_at = _utcnow()
    db.commit()
    return {
        "success": True,
        "handover_id": row.id,
        "declared_cash": str(row.declared_cash),
        "actual_cash": str(actual),
        "difference": str(difference),
        "approval_required": approval_required,
        "pending_transaction_id": pending_txn_id,
        "pending_status": pending_status,
    }
