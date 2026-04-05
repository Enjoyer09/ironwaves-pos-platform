from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
import json

from app.models import AuditLog, FinanceEntry, Sale, Setting, Shift, Tenant
from app.schemas import FinanceEntryIn, InvestorRepayIn, TransferIn


router = APIRouter(prefix="/api/v1/finance", tags=["finance"])


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


def _is_founder_investment_category(category: str) -> bool:
    normalized = _normalize_text(category)
    has_founder = "tesisci" in normalized or "founder" in normalized or "учред" in normalized
    has_investment = "investis" in normalized or "investment" in normalized or "инвест" in normalized
    return has_founder and has_investment


def _wallet_balance(db: Session, tenant_id: str, source: str) -> Decimal:
    ins = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant_id, FinanceEntry.source == source, FinanceEntry.type == "in").all()
    outs = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant_id, FinanceEntry.source == source, FinanceEntry.type == "out").all()
    in_total = sum((Decimal(str(x.amount)) for x in ins), Decimal("0"))
    out_total = sum((Decimal(str(x.amount)) for x in outs), Decimal("0"))
    return in_total - out_total


def _setting_value(db: Session, tenant_id: str, key: str, default):
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    if not row or row.value is None:
        return default
    try:
        return json.loads(row.value)
    except Exception:
        return default


def _investor_debt_balance(db: Session, tenant_id: str) -> Decimal:
    return _wallet_balance(db, tenant_id, "investor")


def _is_investor_liability_reduction(row: FinanceEntry) -> bool:
    category = _normalize_text(row.category)
    return (
        "investor borcu azaldilmasi" in category
        or "investor liability reduction" in category
        or "dolg investoru umenshen" in category
    ) and _normalize_text(row.source) == "investor"


def _investor_summary(db: Session, tenant_id: str) -> dict[str, Decimal]:
    entries = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant_id).all()
    invested = sum(
        (
            Decimal(str(row.amount))
            for row in entries
            if row.type == "in" and _is_founder_investment_category(row.category or "")
        ),
        Decimal("0"),
    )
    repaid = sum(
        (
            Decimal(str(row.amount))
            for row in entries
            if row.type == "out" and _is_investor_liability_reduction(row)
        ),
        Decimal("0"),
    )
    debt = Decimal.max(Decimal("0"), invested - repaid)
    return {
        "invested_total": invested,
        "repaid_total": repaid,
        "debt_remaining": debt,
    }


def _is_sale_ledger_entry(row: FinanceEntry) -> bool:
    category = _normalize_text(row.category)
    return row.type == "in" and (
        category == "satis (nagd)" or category == "satis (kart)" or category == "staff odenisi"
    )


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
    has_any_issue = any(
        [
            payload.get("has_investor_mismatch"),
            payload.get("has_reconciliation_issue"),
            payload.get("has_shift_cash_mismatch"),
            payload.get("has_deposit_risk"),
            payload.get("has_closed_shift_open_deposit"),
        ]
    )
    if not has_any_issue:
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
            bool(recent_details.get("has_investor_mismatch")) == bool(payload.get("has_investor_mismatch"))
            and bool(recent_details.get("has_reconciliation_issue")) == bool(payload.get("has_reconciliation_issue"))
            and bool(recent_details.get("has_shift_cash_mismatch")) == bool(payload.get("has_shift_cash_mismatch"))
            and bool(recent_details.get("has_deposit_risk")) == bool(payload.get("has_deposit_risk"))
            and bool(recent_details.get("has_closed_shift_open_deposit")) == bool(payload.get("has_closed_shift_open_deposit"))
        )
        if same_flags:
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


@router.get("/balances")
def get_balances(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    return {
        "cash": str(_wallet_balance(db, tenant.id, "cash")),
        "card": str(_wallet_balance(db, tenant.id, "card")),
        "safe": str(_wallet_balance(db, tenant.id, "safe")),
        "investor": str(_wallet_balance(db, tenant.id, "investor")),
        "debt": str(_wallet_balance(db, tenant.id, "debt")),
        "deposit": str(_wallet_balance(db, tenant.id, "deposit")),
    }


@router.get("/anomalies")
def get_finance_anomalies(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    cash_balance = _wallet_balance(db, tenant.id, "cash")
    deposit_balance = _wallet_balance(db, tenant.id, "deposit")
    investor_ledger_balance = _wallet_balance(db, tenant.id, "investor")
    investor_summary = _investor_summary(db, tenant.id)
    investor_gap = abs(investor_ledger_balance - investor_summary["debt_remaining"])

    total_revenue = sum(
        (Decimal(str(row.total)) for row in db.query(Sale).filter(Sale.tenant_id == tenant.id).all()),
        Decimal("0"),
    )
    ledger_sales_total = sum(
        (
            Decimal(str(row.amount))
            for row in db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant.id).all()
            if _is_sale_ledger_entry(row)
        ),
        Decimal("0"),
    )
    reconciliation_gap = total_revenue - ledger_sales_total

    active_shift = _active_shift(db, tenant.id)
    expected_cash = Decimal("0")
    shift_cash_gap = Decimal("0")
    if active_shift:
        shift_rows = _shift_rows(db, tenant.id, active_shift)
        cash_in = sum((Decimal(str(row.amount)) for row in shift_rows if row.source == "cash" and row.type == "in"), Decimal("0"))
        cash_out = sum((Decimal(str(row.amount)) for row in shift_rows if row.source == "cash" and row.type == "out"), Decimal("0"))
        expected_cash = Decimal(str(active_shift.opening_cash or 0)) + cash_in - cash_out
        shift_cash_gap = abs(cash_balance - expected_cash)

    result = {
        "cash_balance": str(cash_balance.quantize(Decimal("0.01"))),
        "deposit_balance": str(deposit_balance.quantize(Decimal("0.01"))),
        "investor_ledger_balance": str(investor_ledger_balance.quantize(Decimal("0.01"))),
        "investor_calculated_debt": str(investor_summary["debt_remaining"].quantize(Decimal("0.01"))),
        "investor_ledger_gap": str(investor_gap.quantize(Decimal("0.01"))),
        "has_investor_mismatch": investor_gap > Decimal("0.01"),
        "total_revenue": str(total_revenue.quantize(Decimal("0.01"))),
        "ledger_sales_total": str(ledger_sales_total.quantize(Decimal("0.01"))),
        "reconciliation_gap": str(reconciliation_gap.quantize(Decimal("0.01"))),
        "has_reconciliation_issue": abs(reconciliation_gap) > Decimal("0.01"),
        "expected_cash": str(expected_cash.quantize(Decimal("0.01"))),
        "shift_cash_gap": str(shift_cash_gap.quantize(Decimal("0.01"))),
        "has_shift_cash_mismatch": shift_cash_gap > Decimal("0.01"),
        "has_deposit_risk": deposit_balance > cash_balance,
        "deposit_cash_gap": str(Decimal.max(Decimal("0"), deposit_balance - cash_balance).quantize(Decimal("0.01"))),
        "has_closed_shift_open_deposit": active_shift is None and deposit_balance > Decimal("0.01"),
        "shift_open": active_shift is not None,
    }
    _log_finance_anomaly_snapshot(db, tenant.id, user.username, result)
    return result


@router.get("/entries")
def list_entries(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
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
    amount = Decimal(str(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    valid_sources = {"cash", "card", "safe", "investor", "debt"}
    if payload.source not in valid_sources:
        raise HTTPException(status_code=400, detail="Invalid wallet source")

    if payload.source == "investor":
        raise HTTPException(status_code=400, detail="Investor wallet can only be changed via dedicated investor flows")

    if payload.type == "out":
        bal = _wallet_balance(db, tenant.id, payload.source)
        if bal < amount:
            raise HTTPException(status_code=400, detail="Insufficient balance")

    row = FinanceEntry(
        tenant_id=tenant.id,
        type=payload.type,
        category=payload.category,
        source=payload.source,
        amount=amount,
        description=payload.description,
        created_by=user.username,
    )
    db.add(row)

    if payload.type == "in" and payload.source == "debt":
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="in",
                category="Borcdan Kassaya Daxilolma",
                source="cash",
                amount=amount,
                description=f"Auto mirror: {payload.description or payload.category}",
                created_by=user.username,
            )
        )

    if payload.type == "in" and payload.source == "cash" and _is_founder_investment_category(payload.category):
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="in",
                category="İnvestor Borcu",
                source="investor",
                amount=amount,
                description=f"Auto liability mirror: {payload.description or payload.category}",
                created_by=user.username,
            )
        )

    db.commit()
    return {"success": True, "id": row.id}


@router.post("/transfer")
def transfer(payload: TransferIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
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
    commission = Decimal("0")
    commission_cfg = _setting_value(db, tenant.id, "bank_commission", {"card_transfer_percent": 0.5})
    card_transfer_percent = Decimal(str(commission_cfg.get("card_transfer_percent", 0.5) or 0.5))
    if payload.direction in {"card_to_cash", "card_to_debt"}:
        commission = (amount * (card_transfer_percent / Decimal("100"))).quantize(Decimal("0.01"))

    bal = _wallet_balance(db, tenant.id, source)
    if bal < amount + commission:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    db.add(
        FinanceEntry(
            tenant_id=tenant.id,
            type="out",
            category="Daxili Transfer",
            source=source,
            amount=amount,
            description=payload.description,
            created_by=user.username,
        )
    )
    db.add(
        FinanceEntry(
            tenant_id=tenant.id,
            type="in",
            category="Daxili Transfer",
            source=target,
            amount=amount,
            description=payload.description,
            created_by=user.username,
        )
    )
    if commission > 0:
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="out",
                category="Bank Komissiyası",
                source=source,
                amount=commission,
                description=f"Transfer komissiyası: {payload.direction}",
                created_by=user.username,
            )
        )
    db.commit()
    return {"success": True, "commission": str(commission)}


@router.post("/repay-investor")
def repay_investor(payload: InvestorRepayIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    amount = Decimal(str(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    pay_from = str(payload.pay_from or "").strip().lower()
    if pay_from not in {"cash", "card", "safe"}:
        raise HTTPException(status_code=400, detail="Invalid repayment source")

    available = _wallet_balance(db, tenant.id, pay_from)
    if available <= 0:
        raise HTTPException(status_code=400, detail="Selected wallet has no balance")

    debt = _investor_debt_balance(db, tenant.id)
    if debt <= 0:
        raise HTTPException(status_code=400, detail="No investor debt to repay")

    payable = min(amount, available, debt)
    if payable <= 0:
        raise HTTPException(status_code=400, detail="Nothing payable")

    payment_row = FinanceEntry(
        tenant_id=tenant.id,
        type="out",
        category="İnvestora Geri Ödəniş",
        source=pay_from,
        amount=payable,
        description=payload.description or "İnvestora ödəniş",
        created_by=user.username,
    )
    liability_row = FinanceEntry(
        tenant_id=tenant.id,
        type="out",
        category="İnvestor Borcu Azaldılması",
        source="investor",
        amount=payable,
        description=f"Liability reduced via {pay_from}",
        created_by=user.username,
    )
    db.add(payment_row)
    db.add(liability_row)
    db.commit()

    remaining_debt = _investor_debt_balance(db, tenant.id)
    return {
        "success": True,
        "payment_entry_id": payment_row.id,
        "liability_entry_id": liability_row.id,
        "paid": str(payable),
        "remaining_debt": str(remaining_debt),
    }
