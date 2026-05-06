from datetime import datetime, timedelta
from decimal import Decimal
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
import json

from app.models import (
    AuditLog,
    FinanceAccount,
    FinanceEntry,
    FinanceLedgerEntry,
    FinanceReconciliation,
    FinanceTransaction,
    InventoryItem,
    Recipe,
    Sale,
    Setting,
    Shift,
    Tenant,
)
from app.schemas import FinanceEntryIn, FinanceReconciliationIn, FinanceTransactionIn, InvestorRepayIn, TransferIn


router = APIRouter(prefix="/api/v1/finance", tags=["finance"])
VOID_SALE_STATUSES = ["VOIDED", "VOID", "CANCELLED", "CANCELED"]


FINANCE_CATEGORY_LABELS: dict[str, str] = {
    "founder_investment": "Təsisçi İnvestisiyası",
    "borrowed_funds_in": "Borc Alındı",
    "other_income": "Digər Giriş",
    "raw_material": "Xammal",
    "utilities": "Kommunal",
    "payroll": "Maaş",
    "rent": "İcarə",
    "penalty": "Cərimə",
    "other_expense": "Digər Xərc",
    "internal_transfer": "Daxili Transfer",
    "bank_commission": "Bank Komissiyası",
    "investor_liability_reduction": "İnvestor Borcu Azaldılması",
    "investor_repayment": "İnvestora Geri Ödəniş",
    "borrowed_to_cash_mirror": "Borcdan Kassaya Daxilolma",
    "investor_liability": "İnvestor Borcu",
}

FINANCE_CATEGORY_ALIASES: dict[str, set[str]] = {
    "founder_investment": {"tesisci investisiyasi", "founder investment", "investiciya uchreditelya"},
    "borrowed_funds_in": {"borc alindi", "borrowed funds in", "poluchen dolg"},
    "other_income": {"diger giris", "other income", "prochiy prihod"},
    "raw_material": {"xammal", "raw material", "syrie"},
    "utilities": {"kommunal", "utilities", "kommunalnye"},
    "payroll": {"maas", "payroll", "zarplata"},
    "rent": {"icare", "rent", "arenda"},
    "penalty": {"cerime", "penalty", "shtraf"},
    "other_expense": {"diger xerc", "other expense", "prochiy rashod"},
    "internal_transfer": {"daxili transfer", "internal transfer", "vnutrenniy perevod"},
    "bank_commission": {"bank komissiyasi", "bank commission", "bankovskaya komissiya"},
    "investor_liability_reduction": {"investor borcu azaldilmasi", "investor liability reduction", "dolg investoru umenshen"},
    "investor_repayment": {"investora geri odenis", "investor repayment", "vozvrat investoru"},
    "borrowed_to_cash_mirror": {"borcdan kassaya daxilolma", "borrowed to cash", "iz dolga v kassu"},
    "investor_liability": {"investor borcu", "investor liability", "dolg investoru"},
}

APPROVAL_TRANSFER_THRESHOLD = Decimal("500.00")
DEFAULT_FINANCE_POLICY = {
    "large_transfer_threshold_azn": 500,
    "investor_repayment_requires_approval": True,
    "cash_adjustment_requires_approval": True,
    "reversal_requires_approval": True,
    "reconciliation_adjustment_requires_approval": True,
    "reconciliation_variance_alert_azn": 0.01,
    "negative_balance_alert_azn": 0,
    "legacy_wallet_sync_enabled": False,
    "approver_roles": ["manager", "admin", "finance_admin", "super_admin"],
}
FINANCE_VIEW_ROLES = {"manager", "admin", "finance_admin", "super_admin"}
FINANCE_WRITE_ROLES = {"manager", "admin", "finance_admin", "super_admin"}
ANOMALY_SNAPSHOT_CACHE_TTL_SECONDS = 60
_anomaly_snapshot_cache: dict[str, tuple[datetime, tuple[bool, bool, bool, bool, bool]]] = {}
_anomaly_snapshot_cache_lock = Lock()


def _normalize_text(value: str) -> str:
    return (
        (value or "")
        .replace("ə", "e")
        .replace("Ə", "e")
        .replace("ı", "i")
        .replace("İ", "i")
        .replace("ö", "o")
        .replace("Ö", "o")
        .replace("ü", "u")
        .replace("Ü", "u")
        .replace("ç", "c")
        .replace("Ç", "c")
        .replace("ş", "s")
        .replace("Ş", "s")
        .replace("ğ", "g")
        .replace("Ğ", "g")
        .strip()
        .lower()
    )


def _finance_category_code(value: str | None = None, category_code: str | None = None) -> str | None:
    normalized_code = _normalize_text(category_code or "").replace(" ", "_")
    if normalized_code in FINANCE_CATEGORY_LABELS:
        return normalized_code
    normalized_value = _normalize_text(value or "")
    if not normalized_value:
        return None
    for code, aliases in FINANCE_CATEGORY_ALIASES.items():
        if normalized_value == _normalize_text(FINANCE_CATEGORY_LABELS.get(code, "")) or normalized_value in aliases:
            return code
    return None


def _finance_category_label(value: str | None = None, category_code: str | None = None) -> str:
    code = _finance_category_code(value, category_code)
    if code and code in FINANCE_CATEGORY_LABELS:
        return FINANCE_CATEGORY_LABELS[code]
    return (value or "").strip()


from app.services.finance_service import (  # noqa: E402 - keep router API thin while preserving helper names
    FINANCE_ACCOUNT_DEFS,
    account_ledger_totals as _account_ledger_totals,
    account_ledger_totals_for_update as _account_ledger_totals_for_update,
    create_finance_transaction_record as _create_finance_transaction_record,
    ensure_finance_accounts as _ensure_finance_accounts,
    finance_account as _finance_account,
    finance_account_code as _finance_account_code,
    finance_policy as _finance_policy,
    ledger_balances_snapshot as _ledger_balances_snapshot,
    lock_finance_accounts as _lock_finance_accounts,
    mark_original_transaction_reversed as _mark_original_transaction_reversed,
    mirror_posted_transaction_to_legacy_wallet as _mirror_posted_transaction_to_legacy_wallet,
    post_existing_transaction as _post_existing_transaction,
    post_finance_transaction as _post_finance_transaction,
    post_finance_transaction_with_legacy_mirror as _post_finance_transaction_with_legacy_mirror,
    shift_cash_breakdown_from_ledger as _shift_cash_breakdown_from_ledger,
)


def _is_finance_approver(user, policy: dict | None = None) -> bool:
    roles = set((policy or DEFAULT_FINANCE_POLICY).get("approver_roles") or DEFAULT_FINANCE_POLICY["approver_roles"])
    return str(getattr(user, "role", "") or "").lower() in roles


def _ensure_finance_read_access(user) -> None:
    if str(getattr(user, "role", "") or "").lower() not in FINANCE_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Finance view access required")


def _ensure_finance_write_access(user) -> None:
    if str(getattr(user, "role", "") or "").lower() not in FINANCE_WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Finance write access required")


def _approval_required(transaction_type: str, amount: Decimal, explicit: bool | None = None, policy: dict | None = None) -> bool:
    if explicit is not None:
        return bool(explicit)
    tx_type = _normalize_text(transaction_type).replace("-", "_")
    policy = policy or DEFAULT_FINANCE_POLICY
    if tx_type == "investor_repayment" and bool(policy.get("investor_repayment_requires_approval", True)):
        return True
    if tx_type == "cash_adjustment" and bool(policy.get("cash_adjustment_requires_approval", True)):
        return True
    if tx_type == "reversal" and bool(policy.get("reversal_requires_approval", True)):
        return True
    if tx_type == "reconciliation_adjustment" and bool(policy.get("reconciliation_adjustment_requires_approval", True)):
        return True
    threshold = Decimal(str(policy.get("large_transfer_threshold_azn", APPROVAL_TRANSFER_THRESHOLD)))
    if tx_type == "internal_transfer" and Decimal(str(amount)) >= threshold:
        return True
    return False


def _post_legacy_finance_entry(db: Session, entry: FinanceEntry, username: str) -> FinanceTransaction:
    category = entry.category or ""
    if entry.type == "in" and entry.source == "cash" and _is_founder_investment_category(category):
        return _post_finance_transaction(
            db,
            tenant_id=entry.tenant_id,
            transaction_type="investor_injection",
            amount=Decimal(str(entry.amount)),
            source_code="investor",
            destination_code="cash",
            created_by=username,
            category=category,
            note=entry.description,
            legacy_finance_entry_id=entry.id,
        )
    if entry.type == "in":
        return _post_finance_transaction(
            db,
            tenant_id=entry.tenant_id,
            transaction_type="income",
            amount=Decimal(str(entry.amount)),
            source_code="revenue",
            destination_code=entry.source,
            created_by=username,
            category=category,
            note=entry.description,
            legacy_finance_entry_id=entry.id,
        )
    if entry.type == "out":
        return _post_finance_transaction(
            db,
            tenant_id=entry.tenant_id,
            transaction_type="expense",
            amount=Decimal(str(entry.amount)),
            source_code=entry.source,
            destination_code="expense",
            created_by=username,
            category=category,
            note=entry.description,
            legacy_finance_entry_id=entry.id,
        )
    raise HTTPException(status_code=400, detail="Unsupported finance entry type")


def _is_founder_investment_category(category: str) -> bool:
    return _finance_category_code(category) == "founder_investment"


def _wallet_balance(db: Session, tenant_id: str, source: str) -> Decimal:
    account = _finance_account(db, tenant_id, str(source or "").strip().lower())
    return _account_ledger_totals_for_update(db, tenant_id, account)["balance"]


def _setting_value(db: Session, tenant_id: str, key: str, default):
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    if not row or row.value is None:
        return default
    try:
        return json.loads(row.value)
    except Exception:
        return default


def _investor_debt_balance(db: Session, tenant_id: str) -> Decimal:
    return _ledger_balances_snapshot(db, tenant_id).get("investor", Decimal("0.00"))


def _active_shift(db: Session, tenant_id: str) -> Shift | None:
    return db.query(Shift).filter(Shift.tenant_id == tenant_id, Shift.status == "open").first()


def _shift_rows(db: Session, tenant_id: str, shift: Shift | None) -> list[FinanceEntry]:
    query = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant_id)
    if shift and shift.opened_at:
        query = query.filter(FinanceEntry.created_at >= shift.opened_at)
    return query.all()


def _log_finance_anomaly_snapshot(
    db: Session,
    tenant_id: str,
    username: str,
    payload: dict,
):
    flag_signature = (
        bool(payload.get("has_investor_mismatch")),
        bool(payload.get("has_reconciliation_issue")),
        bool(payload.get("has_shift_cash_mismatch")),
        bool(payload.get("has_deposit_risk")),
        bool(payload.get("has_closed_shift_open_deposit")),
    )
    has_any_issue = any(flag_signature)
    if not has_any_issue:
        return

    now = datetime.utcnow()
    with _anomaly_snapshot_cache_lock:
        cached = _anomaly_snapshot_cache.get(tenant_id)
    if cached:
        cached_at, cached_signature = cached
        if cached_signature == flag_signature and (now - cached_at).total_seconds() < ANOMALY_SNAPSHOT_CACHE_TTL_SECONDS:
            return

    cutoff = datetime.utcnow() - timedelta(minutes=15)
    recent = (
        db.query(AuditLog)
        .filter(
            AuditLog.tenant_id == tenant_id,
            AuditLog.action == "FINANCE_ANOMALY_SNAPSHOT",
            AuditLog.created_at >= cutoff,
        )
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    if recent:
        try:
            recent_details = json.loads(recent.details or "{}")
        except Exception:
            recent_details = {}
        same_flags = (
            bool(recent_details.get("has_investor_mismatch")) == flag_signature[0]
            and bool(recent_details.get("has_reconciliation_issue")) == flag_signature[1]
            and bool(recent_details.get("has_shift_cash_mismatch")) == flag_signature[2]
            and bool(recent_details.get("has_deposit_risk")) == flag_signature[3]
            and bool(recent_details.get("has_closed_shift_open_deposit")) == flag_signature[4]
        )
        if same_flags:
            with _anomaly_snapshot_cache_lock:
                _anomaly_snapshot_cache[tenant_id] = (now, flag_signature)
            return

    db.add(
        AuditLog(
            tenant_id=tenant_id,
            user=username,
            action="FINANCE_ANOMALY_SNAPSHOT",
            details=json.dumps(payload, ensure_ascii=False),
        )
    )
    db.commit()
    with _anomaly_snapshot_cache_lock:
        _anomaly_snapshot_cache[tenant_id] = (now, flag_signature)


def _sales_reconciliation_totals(
    db: Session,
    tenant_id: str,
    start: datetime | None = None,
    end: datetime | None = None,
) -> tuple[Decimal, Decimal, Decimal]:
    sales_filters = [
        Sale.tenant_id == tenant_id,
        ~func.upper(func.coalesce(Sale.status, "")).in_(VOID_SALE_STATUSES),
    ]
    if start:
        sales_filters.append(Sale.created_at >= start)
    if end:
        sales_filters.append(Sale.created_at <= end)

    ledger_filters = [
        FinanceTransaction.tenant_id == tenant_id,
        FinanceTransaction.status == "posted",
        FinanceTransaction.transaction_type.in_(["income", "deposit_apply_to_bill"]),
        FinanceTransaction.related_order_id.isnot(None),
        ~func.upper(func.coalesce(Sale.status, "")).in_(VOID_SALE_STATUSES),
    ]
    if start:
        ledger_filters.append(Sale.created_at >= start)
    if end:
        ledger_filters.append(Sale.created_at <= end)

    total_revenue = Decimal(
        str(
            db.query(func.coalesce(func.sum(Sale.total), 0))
            .filter(*sales_filters)
            .scalar()
            or 0
        )
    ).quantize(Decimal("0.01"))
    ledger_sales_total = Decimal(
        str(
            db.query(func.coalesce(func.sum(FinanceTransaction.amount), 0))
            .select_from(FinanceTransaction)
            .join(Sale, and_(Sale.id == FinanceTransaction.related_order_id, Sale.tenant_id == FinanceTransaction.tenant_id))
            .filter(*ledger_filters)
            .scalar()
            or 0
        )
    ).quantize(Decimal("0.01"))
    return total_revenue, ledger_sales_total, (total_revenue - ledger_sales_total).quantize(Decimal("0.01"))


def _build_finance_anomalies(db: Session, tenant_id: str) -> dict:
    ledger_balances = _ledger_balances_snapshot(db, tenant_id)
    cash_balance = ledger_balances.get("cash", Decimal("0.00"))
    deposit_balance = ledger_balances.get("deposit", Decimal("0.00"))
    investor_ledger_balance = ledger_balances.get("investor", Decimal("0.00"))
    investor_calculated_debt = investor_ledger_balance
    investor_gap = Decimal("0.00")

    active_shift = _active_shift(db, tenant_id)
    total_revenue, ledger_sales_total, reconciliation_gap = _sales_reconciliation_totals(db, tenant_id)
    now = datetime.utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    period_start = active_shift.opened_at if active_shift and active_shift.opened_at else day_start
    current_revenue, current_ledger_total, current_reconciliation_gap = _sales_reconciliation_totals(db, tenant_id, period_start, None)
    expected_cash = Decimal("0")
    shift_cash_gap = Decimal("0")
    if active_shift:
        shift_breakdown = _shift_cash_breakdown_from_ledger(db, tenant_id, active_shift)
        expected_cash = shift_breakdown["expected_cash"]
        shift_cash_gap = abs(cash_balance - expected_cash)

    return {
        "cash_balance": str(cash_balance.quantize(Decimal("0.01"))),
        "deposit_balance": str(deposit_balance.quantize(Decimal("0.01"))),
        "investor_ledger_balance": str(investor_ledger_balance.quantize(Decimal("0.01"))),
        "investor_calculated_debt": str(investor_calculated_debt.quantize(Decimal("0.01"))),
        "investor_ledger_gap": str(investor_gap.quantize(Decimal("0.01"))),
        "legacy_wallet_sync_enabled": bool(_finance_policy(db, tenant_id).get("legacy_wallet_sync_enabled", True)),
        "has_investor_mismatch": False,
        "total_revenue": str(total_revenue.quantize(Decimal("0.01"))),
        "ledger_sales_total": str(ledger_sales_total.quantize(Decimal("0.01"))),
        "reconciliation_gap": str(reconciliation_gap.quantize(Decimal("0.01"))),
        "has_reconciliation_issue": abs(reconciliation_gap) > Decimal("0.01"),
        "current_period_revenue": str(current_revenue.quantize(Decimal("0.01"))),
        "current_period_ledger_sales_total": str(current_ledger_total.quantize(Decimal("0.01"))),
        "current_period_reconciliation_gap": str(current_reconciliation_gap.quantize(Decimal("0.01"))),
        "has_current_period_reconciliation_issue": abs(current_reconciliation_gap) > Decimal("0.01"),
        "current_period_start": period_start.isoformat() if period_start else None,
        "expected_cash": str(expected_cash.quantize(Decimal("0.01"))),
        "shift_cash_gap": str(shift_cash_gap.quantize(Decimal("0.01"))),
        "has_shift_cash_mismatch": shift_cash_gap > Decimal("0.01"),
        "has_deposit_risk": deposit_balance > cash_balance,
        "deposit_cash_gap": str(Decimal.max(Decimal("0"), deposit_balance - cash_balance).quantize(Decimal("0.01"))),
        "has_closed_shift_open_deposit": active_shift is None and deposit_balance > Decimal("0.01"),
        "shift_open": active_shift is not None,
    }


@router.get("/balances")
def get_balances(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_read_access(user)
    balances = _ledger_balances_snapshot(db, tenant.id, ensure_accounts=False)
    return {
        "cash": str(balances.get("cash", Decimal("0.00"))),
        "card": str(balances.get("card", Decimal("0.00"))),
        "safe": str(balances.get("safe", Decimal("0.00"))),
        "investor": str(balances.get("investor", Decimal("0.00"))),
        "debt": str(balances.get("debt", Decimal("0.00"))),
        "deposit": str(balances.get("deposit", Decimal("0.00"))),
    }


@router.get("/summary")
def get_finance_summary(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_read_access(user)
    accounts = {row.code: row for row in db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant.id).all()}
    balances = _ledger_balances_snapshot(db, tenant.id, ensure_accounts=False)
    account_by_id = {row.id: row for row in accounts.values()}
    alerts = _finance_alerts(db, tenant.id)
    pending_rows = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.status == "pending_approval")
        .order_by(FinanceTransaction.created_at.asc())
        .limit(5)
        .all()
    )
    pending_count = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.status == "pending_approval")
        .count()
    )
    latest_reconciliation = (
        db.query(FinanceReconciliation)
        .filter(FinanceReconciliation.tenant_id == tenant.id)
        .order_by(FinanceReconciliation.created_at.desc())
        .first()
    )
    return {
        "balances": {
            "cash": str(balances.get("cash", Decimal("0.00"))),
            "card": str(balances.get("card", Decimal("0.00"))),
            "safe": str(balances.get("safe", Decimal("0.00"))),
            "investor": str(balances.get("investor", Decimal("0.00"))),
            "debt": str(balances.get("debt", Decimal("0.00"))),
            "deposit": str(balances.get("deposit", Decimal("0.00"))),
        },
        "alerts": alerts,
        "pending_approvals_count": pending_count,
        "pending_approvals_preview": [_transaction_out(row, account_by_id) for row in pending_rows],
        "latest_reconciliation": {
            "id": latest_reconciliation.id,
            "account_code": account_by_id.get(latest_reconciliation.account_id).code if latest_reconciliation.account_id in account_by_id else None,
            "account_name": account_by_id.get(latest_reconciliation.account_id).name if latest_reconciliation.account_id in account_by_id else None,
            "expected_balance": str(Decimal(str(latest_reconciliation.expected_balance)).quantize(Decimal("0.01"))),
            "counted_balance": str(Decimal(str(latest_reconciliation.counted_balance)).quantize(Decimal("0.01"))),
            "variance": str(Decimal(str(latest_reconciliation.variance)).quantize(Decimal("0.01"))),
            "notes": latest_reconciliation.notes,
            "reconciled_by": latest_reconciliation.reconciled_by,
            "reconciled_at": latest_reconciliation.reconciled_at.isoformat() if latest_reconciliation.reconciled_at else None,
            "created_by": latest_reconciliation.created_by,
            "created_at": latest_reconciliation.created_at.isoformat() if latest_reconciliation.created_at else None,
        } if latest_reconciliation else None,
    }


def _money(value: Decimal | int | float | str | None) -> str:
    return str(Decimal(str(value or 0)).quantize(Decimal("0.01")))


def _finance_accounts_by_code(db: Session, tenant_id: str) -> dict[str, FinanceAccount]:
    rows = db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant_id).all()
    return {str(row.code or "").strip().lower(): row for row in rows}


def _period_bounds(date_from: str | None, date_to: str | None) -> tuple[datetime | None, datetime | None]:
    start = None
    end = None
    if date_from:
        try:
            start = datetime.fromisoformat(str(date_from)[:10])
        except Exception:
            raise HTTPException(status_code=400, detail="date_from format must be YYYY-MM-DD")
    if date_to:
        try:
            end = datetime.fromisoformat(str(date_to)[:10]).replace(hour=23, minute=59, second=59, microsecond=999999)
        except Exception:
            raise HTTPException(status_code=400, detail="date_to format must be YYYY-MM-DD")
    return start, end


def _sale_period_filters(tenant_id: str, start: datetime | None, end: datetime | None) -> list:
    filters = [
        Sale.tenant_id == tenant_id,
        ~func.upper(func.coalesce(Sale.status, "")).in_(VOID_SALE_STATUSES),
    ]
    if start:
        filters.append(Sale.created_at >= start)
    if end:
        filters.append(Sale.created_at <= end)
    return filters


def _posted_sale_ledger_filters(tenant_id: str) -> list:
    return [
        FinanceTransaction.tenant_id == tenant_id,
        FinanceTransaction.status == "posted",
        FinanceTransaction.transaction_type.in_(["income", "deposit_apply_to_bill"]),
        FinanceTransaction.related_order_id.isnot(None),
    ]


def _sales_ledger_reconciliation_report(
    db: Session,
    tenant_id: str,
    start: datetime | None,
    end: datetime | None,
    *,
    sample_limit: int = 50,
) -> dict:
    sales_filters = _sale_period_filters(tenant_id, start, end)
    sales_id_rows = db.query(Sale.id).filter(*sales_filters).subquery()
    sales_id_select = db.query(sales_id_rows.c.id)
    ledger_filters = _posted_sale_ledger_filters(tenant_id) + [
        FinanceTransaction.related_order_id.in_(sales_id_select),
    ]
    ledger_by_sale = (
        db.query(
            FinanceTransaction.related_order_id.label("sale_id"),
            func.coalesce(func.sum(FinanceTransaction.amount), 0).label("ledger_total"),
            func.count(FinanceTransaction.id).label("transaction_count"),
        )
        .filter(*ledger_filters)
        .group_by(FinanceTransaction.related_order_id)
        .subquery()
    )
    sales_total = Decimal(
        str(
            db.query(func.coalesce(func.sum(Sale.total), 0))
            .filter(*sales_filters)
            .scalar()
            or 0
        )
    )
    sales_count = int(db.query(func.count(Sale.id)).filter(*sales_filters).scalar() or 0)
    ledger_total = Decimal(
        str(
            db.query(func.coalesce(func.sum(FinanceTransaction.amount), 0))
            .filter(*ledger_filters)
            .scalar()
            or 0
        )
    )
    ledger_transaction_count = int(
        db.query(func.count(FinanceTransaction.id))
        .filter(*ledger_filters)
        .scalar()
        or 0
    )
    missing_query = (
        db.query(Sale.id, Sale.receipt_code, Sale.total, Sale.payment_method, Sale.cashier, Sale.created_at)
        .outerjoin(ledger_by_sale, Sale.id == ledger_by_sale.c.sale_id)
        .filter(*sales_filters, ledger_by_sale.c.sale_id.is_(None))
    )
    missing_count = int(missing_query.count())
    mismatch_query = (
        db.query(
            Sale.id,
            Sale.receipt_code,
            Sale.total,
            Sale.payment_method,
            Sale.cashier,
            Sale.created_at,
            ledger_by_sale.c.ledger_total,
            ledger_by_sale.c.transaction_count,
        )
        .join(ledger_by_sale, Sale.id == ledger_by_sale.c.sale_id)
        .filter(
            *sales_filters,
            func.abs(func.coalesce(ledger_by_sale.c.ledger_total, 0) - Sale.total) > Decimal("0.01"),
        )
    )
    mismatch_count = int(mismatch_query.count())

    def sale_sample(row, *, include_ledger: bool = False) -> dict:
        payload = {
            "sale_id": row.id,
            "receipt_code": row.receipt_code,
            "sale_total": _money(row.total),
            "payment_method": row.payment_method,
            "cashier": row.cashier,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        if not include_ledger:
            payload.update(
                {
                    "ledger_total": "0.00",
                    "gap": _money(row.total),
                    "transaction_count": 0,
                }
            )
        if include_ledger:
            ledger_value = Decimal(str(row.ledger_total or 0))
            sale_value = Decimal(str(row.total or 0))
            payload.update(
                {
                    "ledger_total": _money(ledger_value),
                    "gap": _money(sale_value - ledger_value),
                    "transaction_count": int(row.transaction_count or 0),
                }
            )
        return payload

    gap = (sales_total - ledger_total).quantize(Decimal("0.01"))
    return {
        "period": {
            "date_from": start.isoformat() if start else None,
            "date_to": end.isoformat() if end else None,
        },
        "sales_count": sales_count,
        "sales_total": _money(sales_total),
        "ledger_transaction_count": ledger_transaction_count,
        "ledger_sales_total": _money(ledger_total),
        "reconciliation_gap": str(gap),
        "has_reconciliation_issue": bool(abs(gap) > Decimal("0.01") or missing_count or mismatch_count),
        "missing_ledger_count": missing_count,
        "amount_mismatch_count": mismatch_count,
        "missing_ledger_sales": [
            sale_sample(row)
            for row in missing_query.order_by(Sale.created_at.desc()).limit(sample_limit).all()
        ],
        "amount_mismatch_sales": [
            sale_sample(row, include_ledger=True)
            for row in mismatch_query.order_by(Sale.created_at.desc()).limit(sample_limit).all()
        ],
    }


def _transaction_date(row: FinanceTransaction) -> datetime | None:
    return (
        getattr(row, "posted_at", None)
        or getattr(row, "approved_at", None)
        or getattr(row, "created_at", None)
    )


def _transaction_date_expr():
    return func.coalesce(FinanceTransaction.posted_at, FinanceTransaction.approved_at, FinanceTransaction.created_at)


def _finance_transaction_period_filters(
    tenant_id: str,
    start: datetime | None,
    end: datetime | None,
) -> list:
    txn_date = _transaction_date_expr()
    filters = [
        FinanceTransaction.tenant_id == tenant_id,
        FinanceTransaction.status == "posted",
    ]
    if start:
        filters.append(txn_date >= start)
    if end:
        filters.append(txn_date <= end)
    return filters


def _in_period(value: datetime | None, start: datetime | None, end: datetime | None) -> bool:
    if start and (not value or value < start):
        return False
    if end and (not value or value > end):
        return False
    return True


def _inventory_value(db: Session, tenant_id: str) -> Decimal:
    return sum(
        (
            Decimal(str(row.stock_qty or 0)) * Decimal(str(row.unit_cost or 0))
            for row in db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant_id).all()
        ),
        Decimal("0.00"),
    ).quantize(Decimal("0.01"))


def _estimate_sale_cogs_from_recipe(
    sale_items_json: str | None,
    recipe_map: dict[str, list[tuple[str, Decimal]]],
    unit_cost_map: dict[str, Decimal],
    *,
    remove_packaging_for_table: bool,
) -> tuple[Decimal, bool]:
    try:
        raw_items = json.loads(sale_items_json or "[]")
    except Exception:
        raw_items = []
    items = raw_items if isinstance(raw_items, list) else []
    if not items:
        return Decimal("0.0000"), True

    total = Decimal("0.0000")
    unresolved = False
    packaging_tokens = ("stəkan", "stakan", "qapaq", "kapak", "cup", "lid")
    for item in items:
        snapshot_line = (item or {}).get("_cogs_snapshot")
        if snapshot_line is not None:
            try:
                total += Decimal(str(snapshot_line)).quantize(Decimal("0.0001"))
                continue
            except Exception:
                unresolved = True
        item_name = str((item or {}).get("item_name") or "").strip().lower()
        qty = Decimal(str((item or {}).get("qty") or 0))
        if qty <= 0:
            continue
        item_cup_mode = str((item or {}).get("cup_mode") or "paper").strip().lower()
        skip_packaging = remove_packaging_for_table and item_cup_mode == "glass"
        ingredients = recipe_map.get(item_name, [])
        if not ingredients:
            unresolved = True
            continue
        for ingredient_name, qty_required in ingredients:
            ingredient_key = str(ingredient_name or "").strip().lower()
            if skip_packaging and any(token in ingredient_key for token in packaging_tokens):
                continue
            unit_cost = unit_cost_map.get(ingredient_key)
            if unit_cost is None:
                unresolved = True
                continue
            total += (qty * qty_required * unit_cost).quantize(Decimal("0.0001"))
    return total.quantize(Decimal("0.0001")), unresolved


def _ledger_equity_total(db: Session, tenant_id: str) -> tuple[Decimal, list[str]]:
    equity_account_rows = (
        db.query(FinanceAccount.id, FinanceAccount.code, FinanceAccount.account_type)
        .filter(FinanceAccount.tenant_id == tenant_id)
        .all()
    )
    equity_account_ids: list[str] = []
    equity_account_codes: list[str] = []
    for account_id, code, account_type in equity_account_rows:
        normalized_code = str(code or "").strip().lower()
        normalized_type = str(account_type or "").strip().lower()
        if normalized_type in {"equity", "owner_equity", "retained_earnings", "capital", "adjustment"} or normalized_code in {
            "equity",
            "owner_equity",
            "retained_earnings",
            "capital",
            "adjustment",
        }:
            equity_account_ids.append(str(account_id))
            equity_account_codes.append(normalized_code)
    if not equity_account_ids:
        return Decimal("0.00"), []

    debit_raw, credit_raw = (
        db.query(
            func.coalesce(
                func.sum(
                    case(
                        (FinanceLedgerEntry.entry_side == "debit", FinanceLedgerEntry.amount),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (FinanceLedgerEntry.entry_side == "credit", FinanceLedgerEntry.amount),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .filter(
            FinanceLedgerEntry.tenant_id == tenant_id,
            FinanceLedgerEntry.account_id.in_(equity_account_ids),
        )
        .one()
    )
    debit = Decimal(str(debit_raw or 0))
    credit = Decimal(str(credit_raw or 0))
    return (credit - debit).quantize(Decimal("0.01")), sorted(set(equity_account_codes))


def _balance_sheet_report(db: Session, tenant_id: str) -> dict:
    balances = _ledger_balances_snapshot(db, tenant_id)
    cash = balances.get("cash", Decimal("0.00"))
    card = balances.get("card", Decimal("0.00"))
    safe = balances.get("safe", Decimal("0.00"))
    receivable = balances.get("debt", Decimal("0.00"))
    inventory = _inventory_value(db, tenant_id)
    deposit = balances.get("deposit", Decimal("0.00"))
    investor = balances.get("investor", Decimal("0.00"))
    assets_total = cash + card + safe + receivable + inventory
    liabilities_total = deposit + investor
    equity_estimate = assets_total - liabilities_total
    ledger_equity, equity_account_codes = _ledger_equity_total(db, tenant_id)
    accounting_residual = (assets_total - (liabilities_total + ledger_equity)).quantize(Decimal("0.01"))
    balanced = accounting_residual == Decimal("0.00")
    return {
        "assets": {
            "cash": _money(cash),
            "bank_card": _money(card),
            "safe": _money(safe),
            "receivables": _money(receivable),
            "inventory": _money(inventory),
            "total": _money(assets_total),
        },
        "liabilities": {
            "deposits": _money(deposit),
            "investor": _money(investor),
            "total": _money(liabilities_total),
        },
        "equity": {
            "estimated_equity": _money(equity_estimate),
            "ledger_equity": _money(ledger_equity),
            "equity_account_codes": equity_account_codes,
            "accounting_residual": _money(accounting_residual),
            "note": (
                "Balanced yoxlaması ledger equity əsasında hesablanır. "
                "estimated_equity yalnız müqayisə/keçid göstəricisidir."
            ),
        },
        "balanced": balanced,
    }


def _profit_loss_report(db: Session, tenant_id: str, start: datetime | None, end: datetime | None) -> dict:
    sales_filters = _sale_period_filters(tenant_id, start, end)
    (
        sales_count_raw,
        revenue_raw,
        cogs_recorded_raw,
        cogs_uncomputed_count_raw,
        cogs_uncomputed_revenue_raw,
    ) = (
        db.query(
            func.count(Sale.id),
            func.coalesce(func.sum(Sale.total), 0),
            func.coalesce(
                func.sum(
                    case(
                        (Sale.cogs.isnot(None), Sale.cogs),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (Sale.cogs.is_(None), 1),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (Sale.cogs.is_(None), Sale.total),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .filter(*sales_filters)
        .one()
    )
    sales_count = int(sales_count_raw or 0)
    revenue = Decimal(str(revenue_raw or 0))
    cogs_recorded = Decimal(str(cogs_recorded_raw or 0))
    cogs_uncomputed_sales_count = int(cogs_uncomputed_count_raw or 0)
    cogs_uncomputed_revenue = Decimal(str(cogs_uncomputed_revenue_raw or 0))
    cogs_uncomputed_rows = (
        db.query(Sale.items_json)
        .filter(*sales_filters, Sale.cogs.is_(None))
        .all()
    )
    estimated_cogs = Decimal("0.0000")
    cogs_estimated_sales_count = 0
    unresolved_estimate_count = 0
    if cogs_uncomputed_rows:
        beverage_settings = _setting_value(
            db,
            tenant_id,
            "beverage_service_settings",
            {"remove_paper_packaging_for_table": True},
        )
        remove_packaging_for_table = bool((beverage_settings or {}).get("remove_paper_packaging_for_table", True))
        recipe_rows = (
            db.query(Recipe.menu_item_name, Recipe.ingredient_name, Recipe.quantity_required)
            .filter(Recipe.tenant_id == tenant_id)
            .all()
        )
        inventory_rows = (
            db.query(InventoryItem.name, InventoryItem.unit_cost)
            .filter(InventoryItem.tenant_id == tenant_id)
            .all()
        )
        recipe_map: dict[str, list[tuple[str, Decimal]]] = {}
        for menu_item_name, ingredient_name, quantity_required in recipe_rows:
            key = str(menu_item_name or "").strip().lower()
            recipe_map.setdefault(key, []).append((str(ingredient_name or ""), Decimal(str(quantity_required or 0))))
        unit_cost_map = {
            str(name or "").strip().lower(): Decimal(str(unit_cost or 0))
            for name, unit_cost in inventory_rows
        }
        for row in cogs_uncomputed_rows:
            estimate, unresolved = _estimate_sale_cogs_from_recipe(
                getattr(row, "items_json", None),
                recipe_map,
                unit_cost_map,
                remove_packaging_for_table=remove_packaging_for_table,
            )
            if estimate > 0:
                cogs_estimated_sales_count += 1
            if unresolved:
                unresolved_estimate_count += 1
            estimated_cogs += estimate
    cogs = (cogs_recorded + estimated_cogs).quantize(Decimal("0.0001"))
    cogs_coverage_percent = (
        (Decimal(str(sales_count - unresolved_estimate_count)) / Decimal(str(sales_count)) * Decimal("100")).quantize(Decimal("0.01"))
        if sales_count
        else Decimal("100.00")
    )

    expense_filters = _finance_transaction_period_filters(tenant_id, start, end) + [
        FinanceTransaction.transaction_type == "expense",
    ]
    operating_expenses = Decimal(
        str(
            db.query(func.coalesce(func.sum(FinanceTransaction.amount), 0))
            .filter(*expense_filters)
            .scalar()
            or 0
        )
    )
    expense_count = int(
        db.query(func.count(FinanceTransaction.id))
        .filter(*expense_filters)
        .scalar()
        or 0
    )
    gross_profit = revenue - cogs
    net_profit = gross_profit - operating_expenses
    return {
        "revenue": _money(revenue),
        "cogs": _money(cogs),
        "cogs_recorded": _money(cogs_recorded),
        "cogs_estimated": _money(estimated_cogs),
        "cogs_estimated_sales_count": cogs_estimated_sales_count,
        "gross_profit": _money(gross_profit),
        "operating_expenses": _money(operating_expenses),
        "net_profit": _money(net_profit),
        "sales_count": sales_count,
        "expense_count": expense_count,
        "has_uncomputed_cogs": unresolved_estimate_count > 0,
        "cogs_uncomputed_sales_count": cogs_uncomputed_sales_count,
        "cogs_uncomputed_revenue": _money(cogs_uncomputed_revenue),
        "cogs_unresolved_sales_count": unresolved_estimate_count,
        "cogs_coverage_percent": str(cogs_coverage_percent),
        "cogs_note": (
            "COGS bəzi satışlar üçün recipe+inventory əsasında təxmini hesablandı; həll olunmayan satışlar qala bilər."
            if unresolved_estimate_count > 0
            else (
                "COGS tamdır (recorded + recipe/inventory estimate)."
                if cogs_estimated_sales_count > 0
                else "COGS bütün satışlar üçün mövcuddur."
            )
        ),
    }


def _cash_flow_report(db: Session, tenant_id: str, start: datetime | None, end: datetime | None) -> dict:
    period_filters = _finance_transaction_period_filters(tenant_id, start, end)
    grouped_rows = (
        db.query(
            FinanceTransaction.transaction_type,
            func.coalesce(func.sum(FinanceTransaction.amount), 0),
            func.count(FinanceTransaction.id),
        )
        .filter(*period_filters)
        .group_by(FinanceTransaction.transaction_type)
        .all()
    )
    totals_by_type = {
        str(transaction_type or ""): Decimal(str(total or 0))
        for transaction_type, total, _count in grouped_rows
    }
    transaction_count = sum((int(count or 0) for _transaction_type, _total, count in grouped_rows), 0)
    operating_inflow = totals_by_type.get("income", Decimal("0.00"))
    operating_outflow = totals_by_type.get("expense", Decimal("0.00"))
    financing_inflow = totals_by_type.get("investor_injection", Decimal("0.00"))
    financing_outflow = totals_by_type.get("investor_repayment", Decimal("0.00"))
    deposit_inflow = totals_by_type.get("deposit_hold", Decimal("0.00"))
    deposit_outflow = totals_by_type.get("deposit_release", Decimal("0.00")) + totals_by_type.get("deposit_refund", Decimal("0.00"))
    account_code_by_id = {
        str(account_id): str(code or "").strip().lower()
        for account_id, code in db.query(FinanceAccount.id, FinanceAccount.code).filter(FinanceAccount.tenant_id == tenant_id).all()
    }
    adjustment_net = Decimal("0.00")
    adjustment_rows = (
        db.query(
            FinanceTransaction.amount,
            FinanceTransaction.source_account_id,
            FinanceTransaction.destination_account_id,
        )
        .filter(
            *period_filters,
            FinanceTransaction.transaction_type.in_(["cash_adjustment", "reconciliation_adjustment"]),
        )
        .all()
    )
    for amount_raw, source_account_id, destination_account_id in adjustment_rows:
        amount = Decimal(str(amount_raw or 0))
        source_code = account_code_by_id.get(str(source_account_id or ""), "")
        destination_code = account_code_by_id.get(str(destination_account_id or ""), "")
        # Directional effect on cash flow:
        # - cash as destination -> inflow
        # - cash as source -> outflow
        if destination_code == "cash" and source_code != "cash":
            adjustment_net += amount
        elif source_code == "cash" and destination_code != "cash":
            adjustment_net -= amount
    net_cash_flow = operating_inflow - operating_outflow + financing_inflow - financing_outflow + deposit_inflow - deposit_outflow + adjustment_net
    return {
        "operating_inflow": _money(operating_inflow),
        "operating_outflow": _money(operating_outflow),
        "financing_inflow": _money(financing_inflow),
        "financing_outflow": _money(financing_outflow),
        "deposit_inflow": _money(deposit_inflow),
        "deposit_outflow": _money(deposit_outflow),
        "adjustment_net": _money(adjustment_net),
        "net_cash_flow": _money(net_cash_flow),
        "transaction_count": transaction_count,
    }


@router.get("/reports/overview")
def get_finance_reports_overview(
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    _ensure_finance_read_access(user)
    start, end = _period_bounds(date_from, date_to)
    return {
        "period": {
            "date_from": date_from,
            "date_to": date_to,
        },
        "balance_sheet": _balance_sheet_report(db, tenant.id),
        "profit_loss": _profit_loss_report(db, tenant.id, start, end),
        "cash_flow": _cash_flow_report(db, tenant.id, start, end),
    }


@router.get("/reports/sales-ledger-reconciliation")
def get_sales_ledger_reconciliation(
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    _ensure_finance_read_access(user)
    start, end = _period_bounds(date_from, date_to)
    sample_limit = min(max(int(limit or 50), 1), 200)
    return _sales_ledger_reconciliation_report(db, tenant.id, start, end, sample_limit=sample_limit)


@router.post("/reports/sales-ledger-reconciliation/audit")
def audit_sales_ledger_reconciliation(
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    _ensure_finance_write_access(user)
    start, end = _period_bounds(date_from, date_to)
    payload = _sales_ledger_reconciliation_report(db, tenant.id, start, end, sample_limit=50)
    if not payload.get("has_reconciliation_issue"):
        return {"logged": False, "report": payload}
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="SALES_LEDGER_RECONCILIATION_MISMATCH",
            details=json.dumps(payload, ensure_ascii=False),
        )
    )
    db.commit()
    return {"logged": True, "report": payload}


def _account_out(account: FinanceAccount, totals: dict[str, Decimal]) -> dict:
    return {
        "id": account.id,
        "code": account.code,
        "name": account.name,
        "account_type": account.account_type,
        "currency": account.currency,
        "is_active": account.is_active,
        "debit_total": str(totals["debit"].quantize(Decimal("0.01"))),
        "credit_total": str(totals["credit"].quantize(Decimal("0.01"))),
        "ledger_balance": str(totals["balance"].quantize(Decimal("0.01"))),
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }


def _transaction_out(row: FinanceTransaction, account_by_id: dict[str, FinanceAccount]) -> dict:
    return {
        "id": row.id,
        "transaction_type": row.transaction_type,
        "status": row.status,
        "source_account": account_by_id.get(row.source_account_id).code if row.source_account_id in account_by_id else None,
        "destination_account": account_by_id.get(row.destination_account_id).code if row.destination_account_id in account_by_id else None,
        "amount": str(Decimal(str(row.amount)).quantize(Decimal("0.01"))),
        "currency": row.currency,
        "category": row.category,
        "counterparty": row.counterparty,
        "reference": row.reference,
        "note": row.note,
        "created_by": row.created_by,
        "approved_by": row.approved_by,
        "posted_by": row.posted_by,
        "reversed_by": row.reversed_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
        "posted_at": row.posted_at.isoformat() if row.posted_at else None,
        "reversed_at": row.reversed_at.isoformat() if row.reversed_at else None,
        "legacy_finance_entry_id": row.legacy_finance_entry_id,
    }


def _finance_alerts(db: Session, tenant_id: str) -> list[dict]:
    accounts = _finance_accounts_by_code(db, tenant_id)
    balances = _ledger_balances_snapshot(db, tenant_id)
    policy = _finance_policy(db, tenant_id)
    alerts: list[dict] = []

    pending_count = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant_id, FinanceTransaction.status == "pending_approval")
        .count()
    )
    if pending_count:
        alerts.append(
            {
                "id": "pending-approvals",
                "title": "Təsdiq gözləyən əməliyyatlar",
                "body": f"{pending_count} maliyyə əməliyyatı təsdiq gözləyir.",
                "tone": "amber",
                "action": "Təsdiqlə",
                "tab": "overview",
                "severity": "warning",
                "count": pending_count,
            }
        )

    failed_count = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant_id, FinanceTransaction.status == "rejected")
        .count()
    )
    if failed_count:
        alerts.append(
            {
                "id": "failed-postings",
                "title": "Rədd edilmiş yazılış var",
                "body": f"{failed_count} maliyyə əməliyyatı rədd edilib və yoxlanma gözləyir.",
                "tone": "rose",
                "action": "Bax",
                "tab": "ledger",
                "severity": "critical",
                "count": failed_count,
            }
        )

    negative_accounts = []
    for code in ("cash", "card", "safe"):
        account = accounts.get(code)
        if not account:
            continue
        balance = Decimal(str(balances.get(code, Decimal("0.00"))))
        threshold = Decimal(str(policy.get("negative_balance_alert_azn", 0)))
        if balance < (Decimal("0") - threshold):
            negative_accounts.append((account.name, balance))
    if negative_accounts:
        detail = ", ".join(f"{name}: {balance.quantize(Decimal('0.01'))} ₼" for name, balance in negative_accounts)
        alerts.append(
            {
                "id": "negative-balance-risk",
                "title": "Mənfi balans riski",
                "body": detail,
                "tone": "rose",
                "action": "Bax",
                "tab": "ledger",
                "severity": "critical",
                "count": len(negative_accounts),
            }
        )

    latest_reconciliation = (
        db.query(FinanceReconciliation)
        .filter(FinanceReconciliation.tenant_id == tenant_id)
        .order_by(FinanceReconciliation.created_at.desc())
        .first()
    )
    variance_threshold = Decimal(str(policy.get("reconciliation_variance_alert_azn", 0.01)))
    if latest_reconciliation and abs(Decimal(str(latest_reconciliation.variance))) > variance_threshold:
        alerts.append(
            {
                "id": "unreconciled-variance",
                "title": "Uyğunlaşdırılmamış fərq",
                "body": f"Son reconciliation fərqi: {Decimal(str(latest_reconciliation.variance)).quantize(Decimal('0.01'))} ₼.",
                "tone": "rose",
                "action": "Uyğunlaşdır",
                "tab": "reconciliation",
                "severity": "critical",
                "count": 1,
            }
        )

    investor_account = accounts.get("investor")
    if investor_account:
        investor_balance = Decimal(str(balances.get("investor", Decimal("0.00"))))
        if investor_balance > Decimal("0.01"):
            alerts.append(
                {
                    "id": "investor-liability-open",
                    "title": "Açıq investor borcu",
                    "body": f"Investor borcu açıqdır: {investor_balance.quantize(Decimal('0.01'))} ₼.",
                    "tone": "amber",
                    "action": "Investor",
                    "tab": "investor",
                    "severity": "warning",
                    "count": 1,
                }
            )

    active_shift = _active_shift(db, tenant_id)
    if active_shift:
        ledger_cash = Decimal(str(balances.get("cash", Decimal("0.00"))))
        shift_breakdown = _shift_cash_breakdown_from_ledger(db, tenant_id, active_shift)
        expected_cash = shift_breakdown["expected_cash"]
        shift_gap = abs(ledger_cash - expected_cash)
        if shift_gap > variance_threshold:
            alerts.append(
                {
                    "id": "unreconciled-till",
                    "title": "Uyğunlaşdırılmamış kassa",
                    "body": f"Olmalı kassa ilə ledger kassa arasında {shift_gap.quantize(Decimal('0.01'))} ₼ fərq var.",
                    "tone": "rose",
                    "action": "Uyğunlaşdır",
                    "tab": "reconciliation",
                    "severity": "critical",
                    "count": 1,
                }
            )

    return alerts


@router.get("/ledger/accounts")
def list_ledger_accounts(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_read_access(user)
    accounts = _finance_accounts_by_code(db, tenant.id)
    ordered = [accounts[code] for code in FINANCE_ACCOUNT_DEFS.keys() if code in accounts]
    return [_account_out(account, _account_ledger_totals(db, tenant.id, account)) for account in ordered]


@router.get("/alerts")
def list_finance_alerts(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_read_access(user)
    alerts = _finance_alerts(db, tenant.id)
    return alerts


@router.get("/ledger/transactions")
def list_ledger_transactions(
    limit: int = 200,
    offset: int = 0,
    date_from: str | None = None,
    date_to: str | None = None,
    transaction_type: str | None = None,
    status: str | None = None,
    account: str | None = None,
    counterparty: str | None = None,
    min_amount: str | None = None,
    max_amount: str | None = None,
    search: str | None = None,
    include_total: bool = False,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    _ensure_finance_read_access(user)
    accounts = _finance_accounts_by_code(db, tenant.id)
    limit = min(max(int(limit or 200), 1), 1000)
    offset = max(int(offset or 0), 0)

    def parse_dt(value: str | None, end_of_day: bool = False) -> datetime | None:
        if not value:
            return None
        try:
            raw = value.strip()
            if len(raw) == 10:
                raw = f"{raw}T{'23:59:59.999999' if end_of_day else '00:00:00'}"
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            return None

    query = db.query(FinanceTransaction).filter(FinanceTransaction.tenant_id == tenant.id)
    start = parse_dt(date_from)
    end = parse_dt(date_to, end_of_day=True)
    if start:
        query = query.filter(FinanceTransaction.created_at >= start)
    if end:
        query = query.filter(FinanceTransaction.created_at <= end)
    if transaction_type and transaction_type != "all":
        query = query.filter(FinanceTransaction.transaction_type == transaction_type)
    if status and status != "all":
        query = query.filter(FinanceTransaction.status == status)
    if account and account != "all":
        account_row = accounts.get(account)
        if account_row:
            query = query.filter(
                or_(
                    FinanceTransaction.source_account_id == account_row.id,
                    FinanceTransaction.destination_account_id == account_row.id,
                )
            )
        else:
            query = query.filter(FinanceTransaction.id == "__no_such_account__")
    if counterparty:
        query = query.filter(FinanceTransaction.counterparty.ilike(f"%{counterparty.strip()}%"))
    if min_amount:
        try:
            query = query.filter(FinanceTransaction.amount >= Decimal(str(min_amount)))
        except Exception:
            pass
    if max_amount:
        try:
            query = query.filter(FinanceTransaction.amount <= Decimal(str(max_amount)))
        except Exception:
            pass
    if search:
        token = f"%{search.strip()}%"
        query = query.filter(
            or_(
                FinanceTransaction.id.ilike(token),
                FinanceTransaction.transaction_type.ilike(token),
                FinanceTransaction.status.ilike(token),
                FinanceTransaction.category.ilike(token),
                FinanceTransaction.counterparty.ilike(token),
                FinanceTransaction.reference.ilike(token),
                FinanceTransaction.note.ilike(token),
                FinanceTransaction.created_by.ilike(token),
                FinanceTransaction.posted_by.ilike(token),
            )
        )

    total = query.count() if include_total else None
    rows = query.order_by(FinanceTransaction.created_at.desc()).offset(offset).limit(limit).all()
    account_by_id = {row.id: row for row in db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant.id).all()}
    rows_out = [_transaction_out(row, account_by_id) for row in rows]
    if include_total:
        return {
            "rows": rows_out,
            "total": int(total or 0),
            "limit": limit,
            "offset": offset,
        }
    return rows_out


@router.get("/ledger/transactions/{transaction_id}")
def get_ledger_transaction_detail(transaction_id: str, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_read_access(user)
    row = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.id == transaction_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Finance transaction not found")

    account_by_id = {account.id: account for account in db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant.id).all()}
    entries = (
        db.query(FinanceLedgerEntry)
        .filter(FinanceLedgerEntry.tenant_id == tenant.id, FinanceLedgerEntry.transaction_id == row.id)
        .order_by(FinanceLedgerEntry.created_at.asc())
        .all()
    )
    audit_rows = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == tenant.id, AuditLog.details.contains(row.id))
        .order_by(AuditLog.created_at.desc())
        .limit(50)
        .all()
    )
    reversal_rows = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.reference == row.id)
        .order_by(FinanceTransaction.created_at.desc())
        .all()
    )
    if row.transaction_type == "reversal" and row.reference:
        original = (
            db.query(FinanceTransaction)
            .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.id == row.reference)
            .first()
        )
        if original:
            reversal_rows = [original] + reversal_rows
    return {
        "transaction": {
            "id": row.id,
            "transaction_type": row.transaction_type,
            "status": row.status,
            "source_account": account_by_id.get(row.source_account_id).code if row.source_account_id in account_by_id else None,
            "destination_account": account_by_id.get(row.destination_account_id).code if row.destination_account_id in account_by_id else None,
            "amount": str(Decimal(str(row.amount)).quantize(Decimal("0.01"))),
            "currency": row.currency,
            "category": row.category,
            "counterparty": row.counterparty,
            "reference": row.reference,
            "note": row.note,
            "created_by": row.created_by,
            "approved_by": row.approved_by,
            "posted_by": row.posted_by,
            "reversed_by": row.reversed_by,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "approved_at": row.approved_at.isoformat() if row.approved_at else None,
            "posted_at": row.posted_at.isoformat() if row.posted_at else None,
            "reversed_at": row.reversed_at.isoformat() if row.reversed_at else None,
            "legacy_finance_entry_id": row.legacy_finance_entry_id,
        },
        "entries": [
            {
                "id": entry.id,
                "transaction_id": entry.transaction_id,
                "account_code": account_by_id.get(entry.account_id).code if entry.account_id in account_by_id else None,
                "account_name": account_by_id.get(entry.account_id).name if entry.account_id in account_by_id else None,
                "entry_side": entry.entry_side,
                "amount": str(Decimal(str(entry.amount)).quantize(Decimal("0.01"))),
                "currency": entry.currency,
                "description": entry.description,
                "created_at": entry.created_at.isoformat() if entry.created_at else None,
            }
            for entry in entries
        ],
        "reversal_history": [
            {
                "id": reversal.id,
                "transaction_type": reversal.transaction_type,
                "status": reversal.status,
                "source_account": account_by_id.get(reversal.source_account_id).code if reversal.source_account_id in account_by_id else None,
                "destination_account": account_by_id.get(reversal.destination_account_id).code if reversal.destination_account_id in account_by_id else None,
                "amount": str(Decimal(str(reversal.amount)).quantize(Decimal("0.01"))),
                "currency": reversal.currency,
                "category": reversal.category,
                "counterparty": reversal.counterparty,
                "reference": reversal.reference,
                "note": reversal.note,
                "created_by": reversal.created_by,
                "approved_by": reversal.approved_by,
                "posted_by": reversal.posted_by,
                "reversed_by": reversal.reversed_by,
                "created_at": reversal.created_at.isoformat() if reversal.created_at else None,
                "approved_at": reversal.approved_at.isoformat() if reversal.approved_at else None,
                "posted_at": reversal.posted_at.isoformat() if reversal.posted_at else None,
                "reversed_at": reversal.reversed_at.isoformat() if reversal.reversed_at else None,
                "legacy_finance_entry_id": reversal.legacy_finance_entry_id,
            }
            for reversal in reversal_rows
            if reversal.id != row.id
        ],
        "audit_logs": [
            {
                "id": log.id,
                "action": log.action,
                "user": log.user,
                "details": log.details,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in audit_rows
        ],
    }


@router.get("/ledger/entries")
def list_ledger_entries(limit: int = 300, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_read_access(user)
    limit = min(max(int(limit or 300), 1), 1000)
    rows = (
        db.query(FinanceLedgerEntry)
        .filter(FinanceLedgerEntry.tenant_id == tenant.id)
        .order_by(FinanceLedgerEntry.created_at.desc())
        .limit(limit)
        .all()
    )
    account_by_id = {row.id: row for row in db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant.id).all()}
    return [
        {
            "id": row.id,
            "transaction_id": row.transaction_id,
            "account_code": account_by_id.get(row.account_id).code if row.account_id in account_by_id else None,
            "account_name": account_by_id.get(row.account_id).name if row.account_id in account_by_id else None,
            "entry_side": row.entry_side,
            "amount": str(Decimal(str(row.amount)).quantize(Decimal("0.01"))),
            "currency": row.currency,
            "description": row.description,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


def _manual_transaction_accounts(payload: FinanceTransactionIn) -> tuple[str, str]:
    tx_type = _normalize_text(payload.transaction_type).replace("-", "_")
    source = (payload.source_account_code or "").strip().lower() or None
    destination = (payload.destination_account_code or "").strip().lower() or None
    if tx_type == "income":
        return "revenue", destination or source or "cash"
    if tx_type == "expense":
        return source or "cash", "expense"
    if tx_type == "internal_transfer":
        if not source or not destination:
            raise HTTPException(status_code=400, detail="Internal transfer requires source and destination accounts")
        return source, destination
    if tx_type == "investor_repayment":
        return source or "cash", "investor"
    if tx_type == "deposit_hold":
        return "deposit", destination or "cash"
    if tx_type == "deposit_apply_to_bill":
        return "revenue", "deposit"
    if tx_type in {"deposit_release", "deposit_refund"}:
        return source or "cash", "deposit"
    if tx_type in {"cash_adjustment", "reconciliation_adjustment"}:
        # Direction-aware adjustment mapping:
        # - source=cash (or another wallet) means decrease that source into adjustment
        # - destination=cash (or another wallet) means increase destination from adjustment
        if source and destination:
            return source, destination
        if source:
            return source, ("cash" if source == "adjustment" else "adjustment")
        if destination:
            return ("adjustment" if destination != "adjustment" else "cash"), destination
        return "adjustment", "cash"
    raise HTTPException(status_code=400, detail="Unsupported finance transaction type")


@router.post("/ledger/transactions")
def create_ledger_transaction(payload: FinanceTransactionIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_write_access(user)
    amount = Decimal(str(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")
    source, destination = _manual_transaction_accounts(payload)
    tx_type = _normalize_text(payload.transaction_type).replace("-", "_")
    category_label = _finance_category_label(payload.category, payload.category_code) if (payload.category or payload.category_code) else None
    policy = _finance_policy(db, tenant.id)
    if _approval_required(tx_type, amount, payload.requires_approval, policy):
        txn = _create_finance_transaction_record(
            db,
            tenant_id=tenant.id,
            transaction_type=tx_type,
            status="pending_approval",
            amount=amount,
            source_code=source,
            destination_code=destination,
            created_by=user.username,
            category=category_label,
            counterparty=payload.counterparty,
            reference=payload.reference,
            note=payload.note,
        )
        db.add(
            AuditLog(
                tenant_id=tenant.id,
                user=user.username,
                action="FINANCE_TRANSACTION_APPROVAL_REQUESTED",
                details=json.dumps(
                    {
                        "transaction_id": txn.id,
                        "transaction_type": tx_type,
                        "source": source,
                        "destination": destination,
                        "amount": str(amount.quantize(Decimal("0.01"))),
                    },
                    ensure_ascii=False,
                ),
            )
        )
    else:
        txn = _post_finance_transaction(
            db,
            tenant_id=tenant.id,
            transaction_type=tx_type,
            amount=amount,
            source_code=source,
            destination_code=destination,
            created_by=user.username,
            category=category_label,
            counterparty=payload.counterparty,
            reference=payload.reference,
            note=payload.note,
        )
        _mirror_posted_transaction_to_legacy_wallet(db, txn, user.username)
    db.commit()
    return {"success": True, "transaction_id": txn.id, "status": txn.status}


@router.get("/approvals/pending")
def list_pending_approvals(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    if not _is_finance_approver(user, _finance_policy(db, tenant.id)):
        raise HTTPException(status_code=403, detail="Finance approval access required")
    rows = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.status == "pending_approval")
        .order_by(FinanceTransaction.created_at.asc())
        .all()
    )
    account_by_id = {row.id: row for row in db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant.id).all()}
    return [
        {
            "id": row.id,
            "transaction_type": row.transaction_type,
            "status": row.status,
            "source_account": account_by_id.get(row.source_account_id).code if row.source_account_id in account_by_id else None,
            "destination_account": account_by_id.get(row.destination_account_id).code if row.destination_account_id in account_by_id else None,
            "amount": str(Decimal(str(row.amount)).quantize(Decimal("0.01"))),
            "currency": row.currency,
            "category": row.category,
            "counterparty": row.counterparty,
            "reference": row.reference,
            "note": row.note,
            "created_by": row.created_by,
            "approved_by": row.approved_by,
            "posted_by": row.posted_by,
            "reversed_by": row.reversed_by,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "approved_at": row.approved_at.isoformat() if row.approved_at else None,
            "posted_at": row.posted_at.isoformat() if row.posted_at else None,
            "reversed_at": row.reversed_at.isoformat() if row.reversed_at else None,
            "legacy_finance_entry_id": row.legacy_finance_entry_id,
        }
        for row in rows
    ]


@router.post("/ledger/transactions/{transaction_id}/approve")
def approve_ledger_transaction(transaction_id: str, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    if not _is_finance_approver(user, _finance_policy(db, tenant.id)):
        raise HTTPException(status_code=403, detail="Finance approval requires manager/admin role")
    txn = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.id == transaction_id)
        .with_for_update()
        .first()
    )
    if not txn:
        raise HTTPException(status_code=404, detail="Finance transaction not found")
    if txn.status != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Transaction is not pending approval: {txn.status}")
    creator_username = str(txn.created_by or "").strip().lower()
    approver_username = str(user.username or "").strip().lower()
    if creator_username and creator_username == approver_username:
        db.add(
            AuditLog(
                tenant_id=tenant.id,
                user=user.username,
                action="FINANCE_TRANSACTION_SELF_APPROVAL_BLOCKED",
                details=json.dumps(
                    {
                        "transaction_id": txn.id,
                        "amount": str(txn.amount),
                        "created_by": txn.created_by,
                    },
                    ensure_ascii=False,
                ),
            )
        )
        db.commit()
        raise HTTPException(
            status_code=403,
            detail="Yaratdığınız maliyyə əməliyyatını özünüz təsdiqləyə bilməzsiniz",
        )
    now = datetime.utcnow()
    txn.status = "approved"
    txn.approved_by = user.username
    txn.approved_at = now
    _mark_original_transaction_reversed(db, txn, user.username)
    _post_existing_transaction(db, txn, user.username)
    _mirror_posted_transaction_to_legacy_wallet(db, txn, user.username)
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="FINANCE_TRANSACTION_APPROVED",
            details=json.dumps({"transaction_id": txn.id, "amount": str(txn.amount)}, ensure_ascii=False),
        )
    )
    db.commit()
    return {"success": True, "transaction_id": txn.id, "status": txn.status}


@router.post("/ledger/transactions/{transaction_id}/reject")
def reject_ledger_transaction(transaction_id: str, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    if not _is_finance_approver(user, _finance_policy(db, tenant.id)):
        raise HTTPException(status_code=403, detail="Finance rejection requires manager/admin role")
    txn = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.id == transaction_id)
        .with_for_update()
        .first()
    )
    if not txn:
        raise HTTPException(status_code=404, detail="Finance transaction not found")
    if txn.status != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Transaction is not pending approval: {txn.status}")
    txn.status = "rejected"
    txn.approved_by = user.username
    txn.approved_at = datetime.utcnow()
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="FINANCE_TRANSACTION_REJECTED",
            details=json.dumps({"transaction_id": txn.id, "amount": str(txn.amount)}, ensure_ascii=False),
        )
    )
    db.commit()
    return {"success": True, "transaction_id": txn.id, "status": txn.status}


@router.post("/ledger/transactions/{transaction_id}/reverse")
def request_transaction_reversal(transaction_id: str, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_write_access(user)
    original = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.id == transaction_id)
        .with_for_update()
        .first()
    )
    if not original:
        raise HTTPException(status_code=404, detail="Finance transaction not found")
    if original.status != "posted":
        raise HTTPException(status_code=400, detail="Only posted transactions can be reversed")
    existing_reversal = (
        db.query(FinanceTransaction)
        .filter(
            FinanceTransaction.tenant_id == tenant.id,
            FinanceTransaction.transaction_type == "reversal",
            FinanceTransaction.reference == original.id,
            FinanceTransaction.status.in_(["pending_approval", "approved", "posted"]),
        )
        .with_for_update()
        .first()
    )
    if existing_reversal:
        raise HTTPException(status_code=400, detail="This transaction already has an active reversal request/history")
    source_code = _finance_account_code(db, tenant.id, original.destination_account_id)
    destination_code = _finance_account_code(db, tenant.id, original.source_account_id)
    if not source_code or not destination_code:
        raise HTTPException(status_code=400, detail="Original transaction account mapping is incomplete")
    policy = _finance_policy(db, tenant.id)
    requires_approval = _approval_required("reversal", Decimal(str(original.amount)), None, policy)
    reversal = _create_finance_transaction_record(
        db,
        tenant_id=tenant.id,
        transaction_type="reversal",
        status="pending_approval" if requires_approval else "approved",
        amount=Decimal(str(original.amount)),
        source_code=source_code,
        destination_code=destination_code,
        created_by=user.username,
        category=f"Reversal: {original.category or original.transaction_type}",
        reference=original.id,
        note=f"Reversal {'request' if requires_approval else 'auto-post'} for {original.id}",
    )
    if not requires_approval:
        now = datetime.utcnow()
        reversal.approved_by = user.username
        reversal.approved_at = now
        _mark_original_transaction_reversed(db, reversal, user.username)
        _post_existing_transaction(db, reversal, user.username)
        _mirror_posted_transaction_to_legacy_wallet(db, reversal, user.username)
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="FINANCE_REVERSAL_REQUESTED" if requires_approval else "FINANCE_REVERSAL_AUTO_POSTED",
            details=json.dumps(
                {
                    "transaction_id": original.id,
                    "reversal_transaction_id": reversal.id,
                    "requires_approval": requires_approval,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {"success": True, "transaction_id": reversal.id, "status": reversal.status}


@router.get("/reconciliations")
def list_reconciliations(limit: int = 100, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_read_access(user)
    limit = min(max(int(limit or 100), 1), 500)
    rows = (
        db.query(FinanceReconciliation)
        .filter(FinanceReconciliation.tenant_id == tenant.id)
        .order_by(FinanceReconciliation.created_at.desc())
        .limit(limit)
        .all()
    )
    account_by_id = {row.id: row for row in db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant.id).all()}
    return [
        {
            "id": row.id,
            "account_code": account_by_id.get(row.account_id).code if row.account_id in account_by_id else None,
            "account_name": account_by_id.get(row.account_id).name if row.account_id in account_by_id else None,
            "status": row.status,
            "expected_balance": str(Decimal(str(row.expected_balance)).quantize(Decimal("0.01"))),
            "counted_balance": str(Decimal(str(row.counted_balance)).quantize(Decimal("0.01"))),
            "variance": str(Decimal(str(row.variance)).quantize(Decimal("0.01"))),
            "notes": row.notes,
            "reconciled_by": row.reconciled_by,
            "reconciled_at": row.reconciled_at.isoformat() if row.reconciled_at else None,
            "created_by": row.created_by,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.post("/reconciliations")
def create_reconciliation(payload: FinanceReconciliationIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_write_access(user)
    account = _finance_account(db, tenant.id, payload.account_code.strip().lower())
    expected = Decimal(str(payload.expected_balance)).quantize(Decimal("0.01"))
    counted = Decimal(str(payload.counted_balance)).quantize(Decimal("0.01"))
    variance = counted - expected
    row = FinanceReconciliation(
        tenant_id=tenant.id,
        account_id=account.id,
        status="reconciled" if abs(variance) <= Decimal("0.01") else "variance",
        expected_balance=expected,
        counted_balance=counted,
        variance=variance,
        notes=payload.notes,
        reconciled_by=user.username,
        reconciled_at=datetime.utcnow(),
        created_by=user.username,
    )
    db.add(row)
    db.flush()
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="FINANCE_RECONCILIATION_RECORDED",
            details=json.dumps(
                {
                    "reconciliation_id": row.id,
                    "account": account.code,
                    "expected": str(expected),
                    "counted": str(counted),
                    "variance": str(variance),
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {"success": True, "id": row.id, "variance": str(variance)}


@router.get("/anomalies")
def get_finance_anomalies(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    _ensure_finance_read_access(user)
    return _build_finance_anomalies(db, tenant.id)


@router.post("/anomalies/snapshot")
def create_finance_anomaly_snapshot(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user=Depends(get_current_user),
):
    _ensure_finance_read_access(user)
    result = _build_finance_anomalies(db, tenant.id)
    _log_finance_anomaly_snapshot(db, tenant.id, user.username, result)
    return {"success": True, "snapshot": result}


@router.get("/entries")
def list_entries(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_read_access(user)
    rows = (
        db.query(FinanceEntry)
        .filter(FinanceEntry.tenant_id == tenant.id)
        .order_by(FinanceEntry.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "type": r.type,
            "category": r.category,
            "source": r.source,
            "amount": str(r.amount),
            "description": r.description,
            "created_by": r.created_by,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/entry")
def create_entry(payload: FinanceEntryIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_write_access(user)
    amount = Decimal(str(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    valid_sources = {"cash", "card", "safe", "investor", "debt"}
    if payload.source not in valid_sources:
        raise HTTPException(status_code=400, detail="Invalid wallet source")

    if payload.source == "investor":
        raise HTTPException(status_code=400, detail="Investor wallet can only be changed via dedicated investor flows")

    _lock_finance_accounts(db, tenant.id, payload.source)
    if payload.type == "out":
        bal = _wallet_balance(db, tenant.id, payload.source)
        if bal < amount:
            raise HTTPException(status_code=400, detail="Insufficient balance")

    category_label = _finance_category_label(payload.category, payload.category_code)

    virtual_row = FinanceEntry(
        tenant_id=tenant.id,
        type=payload.type,
        category=category_label,
        source=payload.source,
        amount=amount,
        description=payload.description,
        created_by=user.username,
    )
    posted_txn: FinanceTransaction | None = None
    mirror_rows: list[FinanceEntry] = []
    if payload.type == "in" and payload.source == "debt":
        posted_txn = _post_finance_transaction(
            db,
            tenant_id=tenant.id,
            transaction_type="internal_transfer",
            amount=amount,
            source_code="debt",
            destination_code="cash",
            created_by=user.username,
            category=category_label or "Borc Alındı",
            note=payload.description or "Borcdan kassaya daxilolma",
        )
        mirror_rows = _mirror_posted_transaction_to_legacy_wallet(db, posted_txn, user.username)
    else:
        posted_txn = _post_legacy_finance_entry(db, virtual_row, user.username)
        if posted_txn:
            mirror_rows = _mirror_posted_transaction_to_legacy_wallet(db, posted_txn, user.username)

    entry_id = mirror_rows[0].id if mirror_rows else (posted_txn.id if posted_txn else None)

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="FINANCE_ENTRY_CREATED",
            details=json.dumps(
                {
                    "entry_id": entry_id,
                    "entry_type": virtual_row.type,
                        "category": virtual_row.category,
                        "category_code": _finance_category_code(virtual_row.category, payload.category_code),
                    "source": virtual_row.source,
                    "amount": str(amount.quantize(Decimal("0.01"))),
                    "ledger_transaction_id": posted_txn.id if posted_txn else None,
                    "legacy_rows": [
                        {
                            "id": mirror.id,
                            "type": mirror.type,
                            "category": mirror.category,
                            "source": mirror.source,
                            "amount": str(Decimal(str(mirror.amount)).quantize(Decimal("0.01"))),
                        }
                        for mirror in mirror_rows
                    ],
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {"success": True, "id": entry_id or ""}


@router.post("/transfer")
def transfer(payload: TransferIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_write_access(user)
    amount = Decimal(str(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    direction_map = {
        "cash_to_safe": ("cash", "safe"),
        "safe_to_cash": ("safe", "cash"),
        "cash_to_card": ("cash", "card"),
        "card_to_cash": ("card", "cash"),
        "cash_to_debt": ("cash", "debt"),
        "card_to_debt": ("card", "debt"),
    }
    if payload.direction not in direction_map:
        raise HTTPException(status_code=400, detail="Invalid transfer direction")

    source, target = direction_map[payload.direction]
    _lock_finance_accounts(db, tenant.id, source, target)
    commission = Decimal("0")
    commission_cfg = _setting_value(db, tenant.id, "bank_commission", {"card_transfer_percent": 0.5})
    card_transfer_percent = Decimal(str(commission_cfg.get("card_transfer_percent", 0.5) or 0.5))
    if payload.direction in {"card_to_cash", "card_to_debt"}:
        commission = (amount * (card_transfer_percent / Decimal("100"))).quantize(Decimal("0.01"))

    bal = _wallet_balance(db, tenant.id, source)
    if bal < amount + commission:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    _post_finance_transaction_with_legacy_mirror(
        db,
        tenant_id=tenant.id,
        transaction_type="internal_transfer",
        amount=amount,
        source_code=source,
        destination_code=target,
        created_by=user.username,
        category="Daxili Transfer",
        note=payload.description,
    )
    if commission > 0:
        _post_finance_transaction_with_legacy_mirror(
            db,
            tenant_id=tenant.id,
            transaction_type="expense",
            amount=commission,
            source_code=source,
            destination_code="expense",
            created_by=user.username,
            category="Bank Komissiyası",
            note=f"Transfer komissiyası: {payload.direction}",
        )
    db.commit()
    return {"success": True, "commission": str(commission)}


@router.post("/repay-investor")
def repay_investor(payload: InvestorRepayIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_write_access(user)
    amount = Decimal(str(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    pay_from = str(payload.pay_from or "").strip().lower()
    if pay_from not in {"cash", "card", "safe"}:
        raise HTTPException(status_code=400, detail="Invalid repayment source")

    _lock_finance_accounts(db, tenant.id, pay_from, "investor")
    available = _wallet_balance(db, tenant.id, pay_from)
    if available <= 0:
        raise HTTPException(status_code=400, detail="Selected wallet has no balance")

    debt = _investor_debt_balance(db, tenant.id)
    if debt <= 0:
        raise HTTPException(status_code=400, detail="No investor debt to repay")

    payable = min(amount, available, debt)
    if payable <= 0:
        raise HTTPException(status_code=400, detail="Nothing payable")

    policy = _finance_policy(db, tenant.id)
    requires_approval = _approval_required("investor_repayment", payable, None, policy)
    if requires_approval:
        txn = _create_finance_transaction_record(
            db,
            tenant_id=tenant.id,
            transaction_type="investor_repayment",
            status="pending_approval",
            amount=payable,
            source_code=pay_from,
            destination_code="investor",
            created_by=user.username,
            category="İnvestora Geri Ödəniş",
            note=payload.description or "İnvestora ödəniş",
        )
        db.add(
            AuditLog(
                tenant_id=tenant.id,
                user=user.username,
                action="FINANCE_INVESTOR_REPAYMENT_APPROVAL_REQUESTED",
                details=json.dumps(
                    {
                        "transaction_id": txn.id,
                        "source": pay_from,
                        "amount": str(payable.quantize(Decimal("0.01"))),
                    },
                    ensure_ascii=False,
                ),
            )
        )
        db.commit()
        remaining_debt = _investor_debt_balance(db, tenant.id)
        return {
            "success": True,
            "transaction_id": txn.id,
            "status": txn.status,
            "requested_amount": str(payable),
            "paid": "0.00",
            "remaining_debt": str(remaining_debt),
        }

    posted_txn = _post_finance_transaction_with_legacy_mirror(
        db,
        tenant_id=tenant.id,
        transaction_type="investor_repayment",
        amount=payable,
        source_code=pay_from,
        destination_code="investor",
        created_by=user.username,
        category="İnvestora Geri Ödəniş",
        note=payload.description or "İnvestora ödəniş",
    )
    db.commit()

    remaining_debt = _investor_debt_balance(db, tenant.id)
    legacy_rows = (
        db.query(FinanceEntry)
        .filter(FinanceEntry.tenant_id == tenant.id, FinanceEntry.description.contains(f"Ledger mirror: {posted_txn.id}"))
        .all()
    )
    payment_row = next((row for row in legacy_rows if str(row.category or "") == "İnvestora Geri Ödəniş"), None)
    liability_row = next((row for row in legacy_rows if str(row.category or "") == "İnvestor Borcu Azaldılması"), None)
    return {
        "success": True,
        "transaction_id": posted_txn.id,
        "status": posted_txn.status,
        "payment_entry_id": payment_row.id if payment_row else posted_txn.id,
        "liability_entry_id": liability_row.id if liability_row else posted_txn.id,
        "paid": str(payable),
        "remaining_debt": str(remaining_debt),
    }
