from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
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
    Sale,
    Setting,
    Shift,
    Tenant,
)
from app.schemas import FinanceEntryIn, FinanceReconciliationIn, FinanceTransactionIn, InvestorRepayIn, TransferIn


router = APIRouter(prefix="/api/v1/finance", tags=["finance"])


FINANCE_ACCOUNT_DEFS: dict[str, tuple[str, str]] = {
    "cash": ("cash_drawer", "Nağd Kassa"),
    "card": ("bank_account", "Bank/Kart"),
    "safe": ("safe", "Seyf"),
    "deposit": ("deposit_liability", "Depozit Öhdəliyi"),
    "investor": ("investor_liability", "Investor Borcu"),
    "debt": ("receivable", "Nisyə/Borc"),
    "revenue": ("revenue", "Satış Gəliri"),
    "expense": ("expense", "Xərc"),
    "adjustment": ("adjustment", "Maliyyə Düzəlişi"),
}

LIABILITY_OR_CREDIT_TYPES = {"deposit_liability", "investor_liability", "revenue"}
APPROVAL_REQUIRED_TYPES = {"investor_repayment", "cash_adjustment", "reconciliation_adjustment", "reversal"}
APPROVAL_TRANSFER_THRESHOLD = Decimal("500.00")


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


def _ensure_finance_accounts(db: Session, tenant_id: str) -> dict[str, FinanceAccount]:
    rows = db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant_id).all()
    by_code = {row.code: row for row in rows}
    changed = False
    for code, (account_type, name) in FINANCE_ACCOUNT_DEFS.items():
        if code not in by_code:
            account = FinanceAccount(
                tenant_id=tenant_id,
                code=code,
                name=name,
                account_type=account_type,
                currency="AZN",
                is_active=True,
            )
            db.add(account)
            by_code[code] = account
            changed = True
    if changed:
        db.flush()
    return by_code


def _finance_account(db: Session, tenant_id: str, code: str) -> FinanceAccount:
    accounts = _ensure_finance_accounts(db, tenant_id)
    account = accounts.get(code)
    if not account:
        raise HTTPException(status_code=400, detail=f"Unknown finance account: {code}")
    return account


def _account_ledger_totals(db: Session, tenant_id: str, account: FinanceAccount) -> dict[str, Decimal]:
    rows = (
        db.query(FinanceLedgerEntry)
        .filter(FinanceLedgerEntry.tenant_id == tenant_id, FinanceLedgerEntry.account_id == account.id)
        .all()
    )
    debit = sum((Decimal(str(row.amount)) for row in rows if row.entry_side == "debit"), Decimal("0"))
    credit = sum((Decimal(str(row.amount)) for row in rows if row.entry_side == "credit"), Decimal("0"))
    if account.account_type in LIABILITY_OR_CREDIT_TYPES:
        balance = credit - debit
    else:
        balance = debit - credit
    return {"debit": debit, "credit": credit, "balance": balance}


def _add_ledger_entry(
    db: Session,
    *,
    tenant_id: str,
    transaction_id: str,
    account_id: str,
    entry_side: str,
    amount: Decimal,
    description: str | None,
):
    db.add(
        FinanceLedgerEntry(
            tenant_id=tenant_id,
            transaction_id=transaction_id,
            account_id=account_id,
            entry_side=entry_side,
            amount=amount,
            currency="AZN",
            description=description,
        )
    )


def _is_finance_approver(user) -> bool:
    return str(getattr(user, "role", "") or "").lower() in {"manager", "admin", "finance_admin", "super_admin"}


def _approval_required(transaction_type: str, amount: Decimal, explicit: bool | None = None) -> bool:
    if explicit is not None:
        return bool(explicit)
    tx_type = _normalize_text(transaction_type).replace("-", "_")
    if tx_type in APPROVAL_REQUIRED_TYPES:
        return True
    if tx_type == "internal_transfer" and Decimal(str(amount)) >= APPROVAL_TRANSFER_THRESHOLD:
        return True
    return False


def _finance_account_code(db: Session, tenant_id: str, account_id: str | None) -> str | None:
    if not account_id:
        return None
    row = db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant_id, FinanceAccount.id == account_id).first()
    return row.code if row else None


def _post_existing_transaction(db: Session, txn: FinanceTransaction, posted_by: str) -> FinanceTransaction:
    if txn.status == "posted":
        return txn
    if txn.status not in {"pending_approval", "approved", "draft"}:
        raise HTTPException(status_code=400, detail=f"Transaction cannot be posted from status {txn.status}")
    source_code = _finance_account_code(db, txn.tenant_id, txn.source_account_id)
    destination_code = _finance_account_code(db, txn.tenant_id, txn.destination_account_id)
    if not source_code or not destination_code:
        raise HTTPException(status_code=400, detail="Transaction account mapping is incomplete")
    source = _finance_account(db, txn.tenant_id, source_code)
    destination = _finance_account(db, txn.tenant_id, destination_code)
    description = txn.note or txn.category or txn.transaction_type
    _add_ledger_entry(
        db,
        tenant_id=txn.tenant_id,
        transaction_id=txn.id,
        account_id=destination.id,
        entry_side="debit",
        amount=Decimal(str(txn.amount)),
        description=description,
    )
    _add_ledger_entry(
        db,
        tenant_id=txn.tenant_id,
        transaction_id=txn.id,
        account_id=source.id,
        entry_side="credit",
        amount=Decimal(str(txn.amount)),
        description=description,
    )
    now = datetime.utcnow()
    txn.status = "posted"
    txn.posted_by = posted_by
    txn.posted_at = now
    db.add(
        AuditLog(
            tenant_id=txn.tenant_id,
            user=posted_by,
            action="FINANCE_TRANSACTION_POSTED",
            details=json.dumps(
                {
                    "transaction_id": txn.id,
                    "transaction_type": txn.transaction_type,
                    "source": source_code,
                    "destination": destination_code,
                    "amount": str(Decimal(str(txn.amount)).quantize(Decimal("0.01"))),
                },
                ensure_ascii=False,
            ),
        )
    )
    return txn


def _create_finance_transaction_record(
    db: Session,
    *,
    tenant_id: str,
    transaction_type: str,
    status: str,
    amount: Decimal,
    source_code: str,
    destination_code: str,
    created_by: str,
    category: str | None = None,
    counterparty: str | None = None,
    reference: str | None = None,
    note: str | None = None,
    related_shift_id: str | None = None,
    related_table_id: str | None = None,
    related_order_id: str | None = None,
    legacy_finance_entry_id: str | None = None,
) -> FinanceTransaction:
    source = _finance_account(db, tenant_id, source_code)
    destination = _finance_account(db, tenant_id, destination_code)
    now = datetime.utcnow()
    txn = FinanceTransaction(
        tenant_id=tenant_id,
        transaction_type=transaction_type,
        status=status,
        source_account_id=source.id,
        destination_account_id=destination.id,
        amount=Decimal(str(amount)).quantize(Decimal("0.01")),
        currency="AZN",
        category=category,
        counterparty=counterparty,
        reference=reference,
        note=note,
        created_by=created_by,
        created_at=now,
        related_shift_id=related_shift_id,
        related_table_id=related_table_id,
        related_order_id=related_order_id,
        legacy_finance_entry_id=legacy_finance_entry_id,
    )
    db.add(txn)
    db.flush()
    return txn


def _post_finance_transaction(
    db: Session,
    *,
    tenant_id: str,
    transaction_type: str,
    amount: Decimal,
    source_code: str | None,
    destination_code: str | None,
    created_by: str,
    category: str | None = None,
    counterparty: str | None = None,
    reference: str | None = None,
    note: str | None = None,
    related_shift_id: str | None = None,
    related_table_id: str | None = None,
    related_order_id: str | None = None,
    legacy_finance_entry_id: str | None = None,
) -> FinanceTransaction:
    amount = Decimal(str(amount)).quantize(Decimal("0.01"))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Ledger transaction amount must be > 0")
    if not source_code or not destination_code:
        raise HTTPException(status_code=400, detail="Ledger transaction requires source and destination accounts")

    txn = _create_finance_transaction_record(
        db,
        tenant_id=tenant_id,
        transaction_type=transaction_type,
        status="approved",
        amount=amount,
        source_code=source_code,
        destination_code=destination_code,
        created_by=created_by,
        category=category,
        counterparty=counterparty,
        reference=reference,
        note=note,
        related_shift_id=related_shift_id,
        related_table_id=related_table_id,
        related_order_id=related_order_id,
        legacy_finance_entry_id=legacy_finance_entry_id,
    )
    return _post_existing_transaction(db, txn, created_by)


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
    _ensure_finance_accounts(db, tenant.id)
    db.commit()
    return {
        "cash": str(_wallet_balance(db, tenant.id, "cash")),
        "card": str(_wallet_balance(db, tenant.id, "card")),
        "safe": str(_wallet_balance(db, tenant.id, "safe")),
        "investor": str(_wallet_balance(db, tenant.id, "investor")),
        "debt": str(_wallet_balance(db, tenant.id, "debt")),
        "deposit": str(_wallet_balance(db, tenant.id, "deposit")),
    }


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


@router.get("/ledger/accounts")
def list_ledger_accounts(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    accounts = _ensure_finance_accounts(db, tenant.id)
    db.commit()
    ordered = [accounts[code] for code in FINANCE_ACCOUNT_DEFS.keys() if code in accounts]
    return [_account_out(account, _account_ledger_totals(db, tenant.id, account)) for account in ordered]


@router.get("/ledger/transactions")
def list_ledger_transactions(limit: int = 200, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_accounts(db, tenant.id)
    db.commit()
    limit = min(max(int(limit or 200), 1), 500)
    rows = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id)
        .order_by(FinanceTransaction.created_at.desc())
        .limit(limit)
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
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "posted_at": row.posted_at.isoformat() if row.posted_at else None,
            "reversed_at": row.reversed_at.isoformat() if row.reversed_at else None,
            "legacy_finance_entry_id": row.legacy_finance_entry_id,
        }
        for row in rows
    ]


@router.get("/ledger/transactions/{transaction_id}")
def get_ledger_transaction_detail(transaction_id: str, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_accounts(db, tenant.id)
    db.commit()
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
    _ensure_finance_accounts(db, tenant.id)
    db.commit()
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
    if tx_type in {"deposit_release", "deposit_refund"}:
        return source or "cash", "deposit"
    if tx_type in {"cash_adjustment", "reconciliation_adjustment"}:
        return "adjustment", destination or source or "cash"
    raise HTTPException(status_code=400, detail="Unsupported finance transaction type")


@router.post("/ledger/transactions")
def create_ledger_transaction(payload: FinanceTransactionIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    amount = Decimal(str(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")
    source, destination = _manual_transaction_accounts(payload)
    tx_type = _normalize_text(payload.transaction_type).replace("-", "_")
    if _approval_required(tx_type, amount, payload.requires_approval):
        txn = _create_finance_transaction_record(
            db,
            tenant_id=tenant.id,
            transaction_type=tx_type,
            status="pending_approval",
            amount=amount,
            source_code=source,
            destination_code=destination,
            created_by=user.username,
            category=payload.category,
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
            category=payload.category,
            counterparty=payload.counterparty,
            reference=payload.reference,
            note=payload.note,
        )
    db.commit()
    return {"success": True, "transaction_id": txn.id, "status": txn.status}


@router.get("/approvals/pending")
def list_pending_approvals(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_accounts(db, tenant.id)
    db.commit()
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
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "posted_at": row.posted_at.isoformat() if row.posted_at else None,
            "reversed_at": row.reversed_at.isoformat() if row.reversed_at else None,
            "legacy_finance_entry_id": row.legacy_finance_entry_id,
        }
        for row in rows
    ]


@router.post("/ledger/transactions/{transaction_id}/approve")
def approve_ledger_transaction(transaction_id: str, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    if not _is_finance_approver(user):
        raise HTTPException(status_code=403, detail="Finance approval requires manager/admin role")
    txn = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.id == transaction_id)
        .first()
    )
    if not txn:
        raise HTTPException(status_code=404, detail="Finance transaction not found")
    if txn.status != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Transaction is not pending approval: {txn.status}")
    now = datetime.utcnow()
    txn.status = "approved"
    txn.approved_by = user.username
    txn.approved_at = now
    _post_existing_transaction(db, txn, user.username)
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
    if not _is_finance_approver(user):
        raise HTTPException(status_code=403, detail="Finance rejection requires manager/admin role")
    txn = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.id == transaction_id)
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
    original = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant.id, FinanceTransaction.id == transaction_id)
        .first()
    )
    if not original:
        raise HTTPException(status_code=404, detail="Finance transaction not found")
    if original.status != "posted":
        raise HTTPException(status_code=400, detail="Only posted transactions can be reversed")
    source_code = _finance_account_code(db, tenant.id, original.destination_account_id)
    destination_code = _finance_account_code(db, tenant.id, original.source_account_id)
    if not source_code or not destination_code:
        raise HTTPException(status_code=400, detail="Original transaction account mapping is incomplete")
    reversal = _create_finance_transaction_record(
        db,
        tenant_id=tenant.id,
        transaction_type="reversal",
        status="pending_approval",
        amount=Decimal(str(original.amount)),
        source_code=source_code,
        destination_code=destination_code,
        created_by=user.username,
        category=f"Reversal: {original.category or original.transaction_type}",
        reference=original.id,
        note=f"Reversal request for {original.id}",
    )
    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="FINANCE_REVERSAL_REQUESTED",
            details=json.dumps({"transaction_id": original.id, "reversal_transaction_id": reversal.id}, ensure_ascii=False),
        )
    )
    db.commit()
    return {"success": True, "transaction_id": reversal.id, "status": reversal.status}


@router.get("/reconciliations")
def list_reconciliations(limit: int = 100, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_accounts(db, tenant.id)
    db.commit()
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

    db.flush()
    _post_legacy_finance_entry(db, row, user.username)
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
    db.flush()
    _post_finance_transaction(
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
        _post_finance_transaction(
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
    db.flush()
    _post_finance_transaction(
        db,
        tenant_id=tenant.id,
        transaction_type="investor_repayment",
        amount=payable,
        source_code=pay_from,
        destination_code="investor",
        created_by=user.username,
        category="İnvestora Geri Ödəniş",
        note=payload.description or "İnvestora ödəniş",
        legacy_finance_entry_id=payment_row.id,
    )
    db.commit()

    remaining_debt = _investor_debt_balance(db, tenant.id)
    return {
        "success": True,
        "payment_entry_id": payment_row.id,
        "liability_entry_id": liability_row.id,
        "paid": str(payable),
        "remaining_debt": str(remaining_debt),
    }
