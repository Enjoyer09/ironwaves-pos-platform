from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
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

LIABILITY_OR_CREDIT_TYPES = {"deposit_liability", "investor_liability", "revenue"}
APPROVAL_REQUIRED_TYPES = {"investor_repayment", "cash_adjustment", "reconciliation_adjustment", "reversal"}
APPROVAL_TRANSFER_THRESHOLD = Decimal("500.00")
DEFAULT_FINANCE_POLICY = {
    "large_transfer_threshold_azn": 500,
    "investor_repayment_requires_approval": True,
    "cash_adjustment_requires_approval": True,
    "reversal_requires_approval": True,
    "reconciliation_adjustment_requires_approval": True,
    "reconciliation_variance_alert_azn": 0.01,
    "negative_balance_alert_azn": 0,
    "legacy_wallet_sync_enabled": True,
    "approver_roles": ["manager", "admin", "finance_admin", "super_admin"],
}
FINANCE_VIEW_ROLES = {"manager", "admin", "finance_admin", "super_admin"}
FINANCE_WRITE_ROLES = {"manager", "admin", "finance_admin", "super_admin"}


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


def _ledger_balances_snapshot(db: Session, tenant_id: str) -> dict[str, Decimal]:
    accounts = _ensure_finance_accounts(db, tenant_id)
    snapshot: dict[str, Decimal] = {}
    for code, account in accounts.items():
        snapshot[code] = _account_ledger_totals(db, tenant_id, account)["balance"].quantize(Decimal("0.01"))
    return snapshot


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


def _finance_policy(db: Session, tenant_id: str) -> dict:
    raw = _setting_value(db, tenant_id, "finance_policy", DEFAULT_FINANCE_POLICY)
    if not isinstance(raw, dict):
        raw = {}
    merged = {**DEFAULT_FINANCE_POLICY, **raw}
    roles = merged.get("approver_roles") if isinstance(merged.get("approver_roles"), list) else DEFAULT_FINANCE_POLICY["approver_roles"]
    merged["approver_roles"] = [str(role).strip().lower() for role in roles if str(role).strip()]
    for key in ("large_transfer_threshold_azn", "reconciliation_variance_alert_azn", "negative_balance_alert_azn"):
        try:
            merged[key] = float(Decimal(str(merged.get(key))))
        except Exception:
            merged[key] = DEFAULT_FINANCE_POLICY[key]
    for key in (
        "investor_repayment_requires_approval",
        "cash_adjustment_requires_approval",
        "reversal_requires_approval",
        "reconciliation_adjustment_requires_approval",
        "legacy_wallet_sync_enabled",
    ):
        merged[key] = bool(merged.get(key))
    return merged


def _is_finance_approver(user, policy: dict | None = None) -> bool:
    roles = set((policy or DEFAULT_FINANCE_POLICY).get("approver_roles") or DEFAULT_FINANCE_POLICY["approver_roles"])
    return str(getattr(user, "role", "") or "").lower() in roles


def _ensure_finance_read_access(user) -> None:
    if str(getattr(user, "role", "") or "").lower() not in FINANCE_VIEW_ROLES:
        raise HTTPException(status_code=403, detail="Finance view access required")


def _ensure_finance_write_access(user) -> None:
    if str(getattr(user, "role", "") or "").lower() not in FINANCE_WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Finance write access required")


def _lock_finance_accounts(db: Session, tenant_id: str, *codes: str) -> dict[str, FinanceAccount]:
    normalized_codes = sorted({str(code or "").strip().lower() for code in codes if str(code or "").strip()})
    if not normalized_codes:
        return {}
    _ensure_finance_accounts(db, tenant_id)
    rows = (
        db.query(FinanceAccount)
        .filter(FinanceAccount.tenant_id == tenant_id, FinanceAccount.code.in_(normalized_codes))
        .with_for_update()
        .all()
    )
    by_code = {row.code: row for row in rows}
    missing = [code for code in normalized_codes if code not in by_code]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown finance account(s): {', '.join(missing)}")
    return by_code


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
    existing_entry_count = (
        db.query(FinanceLedgerEntry)
        .filter(FinanceLedgerEntry.tenant_id == txn.tenant_id, FinanceLedgerEntry.transaction_id == txn.id)
        .count()
    )
    if existing_entry_count > 0:
        db.add(
            AuditLog(
                tenant_id=txn.tenant_id,
                user=posted_by,
                action="FINANCE_TRANSACTION_DUPLICATE_POST_BLOCKED",
                details=json.dumps(
                    {
                        "transaction_id": txn.id,
                        "existing_entry_count": existing_entry_count,
                        "status": txn.status,
                    },
                    ensure_ascii=False,
                ),
            )
        )
        raise HTTPException(status_code=409, detail="Transaction posting was blocked because ledger entries already exist")
    source_code = _finance_account_code(db, txn.tenant_id, txn.source_account_id)
    destination_code = _finance_account_code(db, txn.tenant_id, txn.destination_account_id)
    if not source_code or not destination_code:
        raise HTTPException(status_code=400, detail="Transaction account mapping is incomplete")
    _lock_finance_accounts(db, txn.tenant_id, source_code, destination_code)
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


def _mirror_posted_transaction_to_legacy_wallet(db: Session, txn: FinanceTransaction, posted_by: str) -> list[FinanceEntry]:
    policy = _finance_policy(db, txn.tenant_id)
    if not bool(policy.get("legacy_wallet_sync_enabled", True)):
        db.add(
            AuditLog(
                tenant_id=txn.tenant_id,
                user=posted_by,
                action="FINANCE_LEGACY_WALLET_SYNC_SKIPPED",
                details=json.dumps(
                    {
                        "transaction_id": txn.id,
                        "transaction_type": txn.transaction_type,
                        "reason": "legacy_wallet_sync_disabled",
                    },
                    ensure_ascii=False,
                ),
            )
        )
        return []
    if txn.status != "posted" or txn.legacy_finance_entry_id:
        return []
    existing = (
        db.query(FinanceEntry)
        .filter(
            FinanceEntry.tenant_id == txn.tenant_id,
            FinanceEntry.description.contains(f"Ledger mirror: {txn.id}"),
        )
        .first()
    )
    if existing:
        return []

    source_code = _finance_account_code(db, txn.tenant_id, txn.source_account_id)
    destination_code = _finance_account_code(db, txn.tenant_id, txn.destination_account_id)
    amount = Decimal(str(txn.amount)).quantize(Decimal("0.01"))
    note = f"{txn.note or txn.category or txn.transaction_type} | Ledger mirror: {txn.id}"
    rows: list[FinanceEntry] = []

    def add_entry(entry_type: str, category: str, source: str, description: str):
        row = FinanceEntry(
            tenant_id=txn.tenant_id,
            type=entry_type,
            category=category,
            source=source,
            amount=amount,
            description=description,
            created_by=posted_by,
        )
        db.add(row)
        rows.append(row)

    if txn.transaction_type in {"income", "cash_adjustment", "reconciliation_adjustment"} and destination_code in {"cash", "card", "safe", "debt"}:
        add_entry("in", txn.category or "Ledger Mədaxil", destination_code, note)
    elif txn.transaction_type == "expense" and source_code in {"cash", "card", "safe"}:
        add_entry("out", txn.category or "Ledger Xərc", source_code, note)
    elif txn.transaction_type == "internal_transfer" and source_code and destination_code:
        add_entry("out", "Daxili Transfer", source_code, note)
        add_entry("in", "Daxili Transfer", destination_code, note)
    elif txn.transaction_type == "investor_repayment" and source_code in {"cash", "card", "safe"}:
        add_entry("out", "İnvestora Geri Ödəniş", source_code, note)
        add_entry("out", "İnvestor Borcu Azaldılması", "investor", note)
    elif txn.transaction_type == "deposit_hold" and destination_code in {"cash", "card", "safe"}:
        add_entry("in", "Depozit Alındı", destination_code, note)
        add_entry("in", "Depozit Öhdəliyi", "deposit", note)
    elif txn.transaction_type in {"deposit_release", "deposit_refund"} and source_code in {"cash", "card", "safe"}:
        add_entry("out", "Depozit Qaytarıldı", source_code, note)
        add_entry("out", "Depozit Öhdəliyi Azaldıldı", "deposit", note)
    elif txn.transaction_type == "reversal" and source_code and destination_code:
        if source_code in {"cash", "card", "safe", "deposit", "investor", "debt"}:
            add_entry("out", txn.category or "Ledger Reversal", source_code, note)
        if destination_code in {"cash", "card", "safe", "deposit", "investor", "debt"}:
            add_entry("in", txn.category or "Ledger Reversal", destination_code, note)

    if rows:
        db.add(
            AuditLog(
                tenant_id=txn.tenant_id,
                user=posted_by,
                action="FINANCE_LEGACY_WALLET_SYNCED",
                details=json.dumps(
                    {
                        "transaction_id": txn.id,
                        "transaction_type": txn.transaction_type,
                        "rows": [
                            {"type": row.type, "category": row.category, "source": row.source, "amount": str(row.amount)}
                            for row in rows
                        ],
                    },
                    ensure_ascii=False,
                ),
            )
        )
    return rows


def _mark_original_transaction_reversed(db: Session, reversal: FinanceTransaction, reversed_by: str) -> FinanceTransaction | None:
    if reversal.transaction_type != "reversal" or not reversal.reference:
        return None
    original = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == reversal.tenant_id, FinanceTransaction.id == reversal.reference)
        .with_for_update()
        .first()
    )
    if not original:
        raise HTTPException(status_code=404, detail="Original transaction for reversal was not found")
    if original.status != "posted":
        raise HTTPException(status_code=400, detail=f"Original transaction cannot be reversed from status {original.status}")
    now = datetime.utcnow()
    original.status = "reversed"
    original.reversed_by = reversed_by
    original.reversed_at = now
    db.add(
        AuditLog(
            tenant_id=reversal.tenant_id,
            user=reversed_by,
            action="FINANCE_TRANSACTION_REVERSED",
            details=json.dumps(
                {
                    "transaction_id": original.id,
                    "reversal_transaction_id": reversal.id,
                    "amount": str(Decimal(str(reversal.amount)).quantize(Decimal("0.01"))),
                },
                ensure_ascii=False,
            ),
        )
    )
    return original


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
    return _finance_category_code(category) == "founder_investment"


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
    return _ledger_balances_snapshot(db, tenant_id).get("investor", Decimal("0.00"))


def _is_investor_liability_reduction(row: FinanceEntry) -> bool:
    return _finance_category_code(row.category) == "investor_liability_reduction" and _normalize_text(row.source) == "investor"


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


def _shift_cash_breakdown_from_ledger(db: Session, tenant_id: str, shift: Shift | None) -> dict[str, Decimal]:
    if not shift:
        return {
            "opening_cash": Decimal("0.00"),
            "cash_in": Decimal("0.00"),
            "cash_out": Decimal("0.00"),
            "expected_cash": Decimal("0.00"),
        }

    cash_account = _finance_account(db, tenant_id, "cash")
    query = db.query(FinanceLedgerEntry).filter(
        FinanceLedgerEntry.tenant_id == tenant_id,
        FinanceLedgerEntry.account_id == cash_account.id,
    )
    if shift.opened_at:
        query = query.filter(FinanceLedgerEntry.created_at >= shift.opened_at)
    rows = query.all()
    cash_in = sum(
        (Decimal(str(row.amount)) for row in rows if str(row.entry_side or "").lower() == "debit"),
        Decimal("0.00"),
    )
    cash_out = sum(
        (Decimal(str(row.amount)) for row in rows if str(row.entry_side or "").lower() == "credit"),
        Decimal("0.00"),
    )
    opening_cash = Decimal(str(shift.opening_cash or 0)).quantize(Decimal("0.01"))
    expected_cash = opening_cash + cash_in - cash_out
    return {
        "opening_cash": opening_cash,
        "cash_in": cash_in.quantize(Decimal("0.01")),
        "cash_out": cash_out.quantize(Decimal("0.01")),
        "expected_cash": expected_cash.quantize(Decimal("0.01")),
    }


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
    _ensure_finance_read_access(user)
    balances = _ledger_balances_snapshot(db, tenant.id)
    db.commit()
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
    accounts = _ensure_finance_accounts(db, tenant.id)
    balances = _ledger_balances_snapshot(db, tenant.id)
    db.commit()
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
            "account_code": latest_reconciliation.account_code,
            "account_name": latest_reconciliation.account_name,
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
    accounts = _ensure_finance_accounts(db, tenant_id)
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
        balance = _account_ledger_totals(db, tenant_id, account)["balance"]
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
        investor_balance = _account_ledger_totals(db, tenant_id, investor_account)["balance"]
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
        cash_account = accounts.get("cash")
        ledger_cash = _account_ledger_totals(db, tenant_id, cash_account)["balance"] if cash_account else Decimal("0")
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
    accounts = _ensure_finance_accounts(db, tenant.id)
    db.commit()
    ordered = [accounts[code] for code in FINANCE_ACCOUNT_DEFS.keys() if code in accounts]
    return [_account_out(account, _account_ledger_totals(db, tenant.id, account)) for account in ordered]


@router.get("/alerts")
def list_finance_alerts(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_read_access(user)
    alerts = _finance_alerts(db, tenant.id)
    db.commit()
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
    accounts = _ensure_finance_accounts(db, tenant.id)
    db.commit()
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
def get_finance_anomalies(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _ensure_finance_read_access(user)
    ledger_balances = _ledger_balances_snapshot(db, tenant.id)
    cash_balance = ledger_balances.get("cash", Decimal("0.00"))
    deposit_balance = ledger_balances.get("deposit", Decimal("0.00"))
    investor_ledger_balance = ledger_balances.get("investor", Decimal("0.00"))
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
        shift_breakdown = _shift_cash_breakdown_from_ledger(db, tenant.id, active_shift)
        expected_cash = shift_breakdown["expected_cash"]
        shift_cash_gap = abs(cash_balance - expected_cash)

    result = {
        "cash_balance": str(cash_balance.quantize(Decimal("0.01"))),
        "deposit_balance": str(deposit_balance.quantize(Decimal("0.01"))),
        "investor_ledger_balance": str(investor_ledger_balance.quantize(Decimal("0.01"))),
        "investor_calculated_debt": str(investor_summary["debt_remaining"].quantize(Decimal("0.01"))),
        "investor_ledger_gap": str(investor_gap.quantize(Decimal("0.01"))),
        "legacy_wallet_sync_enabled": bool(_finance_policy(db, tenant.id).get("legacy_wallet_sync_enabled", True)),
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

    row = FinanceEntry(
        tenant_id=tenant.id,
        type=payload.type,
        category=category_label,
        source=payload.source,
        amount=amount,
        description=payload.description,
        created_by=user.username,
    )
    db.add(row)
    created_mirror_rows: list[FinanceEntry] = []

    if payload.type == "in" and payload.source == "debt":
        mirror_row = FinanceEntry(
            tenant_id=tenant.id,
            type="in",
            category="Borcdan Kassaya Daxilolma",
            source="cash",
            amount=amount,
            description=f"Auto mirror: {payload.description or payload.category}",
            created_by=user.username,
        )
        db.add(mirror_row)
        created_mirror_rows.append(mirror_row)

    if payload.type == "in" and payload.source == "cash" and _is_founder_investment_category(category_label):
        mirror_row = FinanceEntry(
            tenant_id=tenant.id,
            type="in",
            category="İnvestor Borcu",
            source="investor",
            amount=amount,
            description=f"Auto liability mirror: {payload.description or payload.category}",
            created_by=user.username,
        )
        db.add(mirror_row)
        created_mirror_rows.append(mirror_row)

    db.flush()
    posted_txn: FinanceTransaction | None = None
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
            legacy_finance_entry_id=row.id,
        )
    else:
        posted_txn = _post_legacy_finance_entry(db, row, user.username)

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="FINANCE_ENTRY_CREATED",
            details=json.dumps(
                {
                    "entry_id": row.id,
                    "entry_type": row.type,
                        "category": row.category,
                        "category_code": _finance_category_code(row.category, payload.category_code),
                    "source": row.source,
                    "amount": str(amount.quantize(Decimal("0.01"))),
                    "ledger_transaction_id": posted_txn.id if posted_txn else None,
                    "mirror_rows": [
                        {
                            "id": mirror.id,
                            "type": mirror.type,
                            "category": mirror.category,
                            "source": mirror.source,
                            "amount": str(Decimal(str(mirror.amount)).quantize(Decimal("0.01"))),
                        }
                        for mirror in created_mirror_rows
                    ],
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {"success": True, "id": row.id}


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
