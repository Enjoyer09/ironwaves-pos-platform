from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models import AuditLog, FinanceAccount, FinanceEntry, FinanceLedgerEntry, FinanceTransaction, Setting, Shift


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


def _setting_value(db: Session, tenant_id: str, key: str, default):
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    if not row or row.value in (None, ""):
        return default
    try:
        return json.loads(row.value)
    except Exception:
        return default


def finance_policy(db: Session, tenant_id: str) -> dict:
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


def ensure_finance_accounts(db: Session, tenant_id: str) -> dict[str, FinanceAccount]:
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


def finance_account(db: Session, tenant_id: str, code: str) -> FinanceAccount:
    account = ensure_finance_accounts(db, tenant_id).get(code)
    if not account:
        raise HTTPException(status_code=400, detail=f"Unknown finance account: {code}")
    return account


def account_ledger_totals(db: Session, tenant_id: str, account: FinanceAccount) -> dict[str, Decimal]:
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
        .filter(FinanceLedgerEntry.tenant_id == tenant_id, FinanceLedgerEntry.account_id == account.id)
        .one()
    )
    debit = Decimal(str(debit_raw or 0))
    credit = Decimal(str(credit_raw or 0))
    balance = credit - debit if account.account_type in LIABILITY_OR_CREDIT_TYPES else debit - credit
    return {"debit": debit, "credit": credit, "balance": balance}


def account_ledger_totals_for_update(db: Session, tenant_id: str, account: FinanceAccount) -> dict[str, Decimal]:
    """
    Lock ledger rows for a single account while computing totals.

    Intended for write paths that already lock FinanceAccount metadata rows and
    need a stricter balance check inside the same transaction boundary.
    """
    rows = (
        db.query(FinanceLedgerEntry.entry_side, FinanceLedgerEntry.amount)
        .filter(FinanceLedgerEntry.tenant_id == tenant_id, FinanceLedgerEntry.account_id == account.id)
        .with_for_update()
        .all()
    )
    debit = sum((Decimal(str(amount or 0)) for side, amount in rows if str(side).lower() == "debit"), Decimal("0"))
    credit = sum((Decimal(str(amount or 0)) for side, amount in rows if str(side).lower() == "credit"), Decimal("0"))
    balance = credit - debit if account.account_type in LIABILITY_OR_CREDIT_TYPES else debit - credit
    return {"debit": debit, "credit": credit, "balance": balance}


def ledger_balances_snapshot(db: Session, tenant_id: str) -> dict[str, Decimal]:
    accounts = ensure_finance_accounts(db, tenant_id)
    if not accounts:
        return {}
    account_ids = [account.id for account in accounts.values()]
    totals_rows = (
        db.query(
            FinanceLedgerEntry.account_id,
            func.coalesce(
                func.sum(
                    case(
                        (FinanceLedgerEntry.entry_side == "debit", FinanceLedgerEntry.amount),
                        else_=0,
                    )
                ),
                0,
            ).label("debit_total"),
            func.coalesce(
                func.sum(
                    case(
                        (FinanceLedgerEntry.entry_side == "credit", FinanceLedgerEntry.amount),
                        else_=0,
                    )
                ),
                0,
            ).label("credit_total"),
        )
        .filter(
            FinanceLedgerEntry.tenant_id == tenant_id,
            FinanceLedgerEntry.account_id.in_(account_ids),
        )
        .group_by(FinanceLedgerEntry.account_id)
        .all()
    )
    totals_by_account_id: dict[str, tuple[Decimal, Decimal]] = {
        str(account_id): (Decimal(str(debit_total or 0)), Decimal(str(credit_total or 0)))
        for account_id, debit_total, credit_total in totals_rows
    }
    result: dict[str, Decimal] = {}
    for code, account in accounts.items():
        debit, credit = totals_by_account_id.get(account.id, (Decimal("0"), Decimal("0")))
        balance = credit - debit if account.account_type in LIABILITY_OR_CREDIT_TYPES else debit - credit
        result[code] = balance.quantize(Decimal("0.01"))
    return result


def shift_cash_breakdown_from_ledger(db: Session, tenant_id: str, shift: Shift | None) -> dict[str, Decimal]:
    if not shift:
        return {
            "opening_cash": Decimal("0.00"),
            "cash_in": Decimal("0.00"),
            "cash_out": Decimal("0.00"),
            "expected_cash": Decimal("0.00"),
        }

    cash_account = finance_account(db, tenant_id, "cash")
    query = db.query(FinanceLedgerEntry).filter(
        FinanceLedgerEntry.tenant_id == tenant_id,
        FinanceLedgerEntry.account_id == cash_account.id,
    )
    if shift.opened_at:
        query = query.filter(FinanceLedgerEntry.created_at >= shift.opened_at)
    debit_sum, credit_sum = query.with_entities(
        func.coalesce(
            func.sum(case((FinanceLedgerEntry.entry_side == "debit", FinanceLedgerEntry.amount), else_=0)),
            0,
        ),
        func.coalesce(
            func.sum(case((FinanceLedgerEntry.entry_side == "credit", FinanceLedgerEntry.amount), else_=0)),
            0,
        ),
    ).one()
    cash_in = Decimal(str(debit_sum or 0)).quantize(Decimal("0.01"))
    cash_out = Decimal(str(credit_sum or 0)).quantize(Decimal("0.01"))
    opening_cash = Decimal(str(shift.opening_cash or 0)).quantize(Decimal("0.01"))
    expected_cash = (opening_cash + cash_in - cash_out).quantize(Decimal("0.01"))
    return {
        "opening_cash": opening_cash,
        "cash_in": cash_in,
        "cash_out": cash_out,
        "expected_cash": expected_cash,
    }


def lock_finance_accounts(db: Session, tenant_id: str, *codes: str) -> dict[str, FinanceAccount]:
    normalized_codes = sorted({str(code or "").strip().lower() for code in codes if str(code or "").strip()})
    if not normalized_codes:
        return {}
    ensure_finance_accounts(db, tenant_id)
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


def finance_account_code(db: Session, tenant_id: str, account_id: str | None) -> str | None:
    if not account_id:
        return None
    row = db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant_id, FinanceAccount.id == account_id).first()
    return row.code if row else None


def add_ledger_entry(
    db: Session,
    *,
    tenant_id: str,
    transaction_id: str,
    account_id: str,
    entry_side: str,
    amount: Decimal,
    description: str | None,
) -> None:
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


def create_finance_transaction_record(
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
    source = finance_account(db, tenant_id, source_code)
    destination = finance_account(db, tenant_id, destination_code)
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
        created_at=datetime.utcnow(),
        related_shift_id=related_shift_id,
        related_table_id=related_table_id,
        related_order_id=related_order_id,
        legacy_finance_entry_id=legacy_finance_entry_id,
    )
    db.add(txn)
    db.flush()
    return txn


def post_existing_transaction(db: Session, txn: FinanceTransaction, posted_by: str) -> FinanceTransaction:
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
                    {"transaction_id": txn.id, "existing_entry_count": existing_entry_count, "status": txn.status},
                    ensure_ascii=False,
                ),
            )
        )
        raise HTTPException(status_code=409, detail="Transaction posting was blocked because ledger entries already exist")

    source_code = finance_account_code(db, txn.tenant_id, txn.source_account_id)
    destination_code = finance_account_code(db, txn.tenant_id, txn.destination_account_id)
    if not source_code or not destination_code:
        raise HTTPException(status_code=400, detail="Transaction account mapping is incomplete")
    lock_finance_accounts(db, txn.tenant_id, source_code, destination_code)
    source = finance_account(db, txn.tenant_id, source_code)
    destination = finance_account(db, txn.tenant_id, destination_code)
    description = txn.note or txn.category or txn.transaction_type
    add_ledger_entry(
        db,
        tenant_id=txn.tenant_id,
        transaction_id=txn.id,
        account_id=destination.id,
        entry_side="debit",
        amount=Decimal(str(txn.amount)),
        description=description,
    )
    add_ledger_entry(
        db,
        tenant_id=txn.tenant_id,
        transaction_id=txn.id,
        account_id=source.id,
        entry_side="credit",
        amount=Decimal(str(txn.amount)),
        description=description,
    )
    txn.status = "posted"
    txn.posted_by = posted_by
    txn.posted_at = datetime.utcnow()
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


def mirror_posted_transaction_to_legacy_wallet(db: Session, txn: FinanceTransaction, posted_by: str) -> list[FinanceEntry]:
    policy = finance_policy(db, txn.tenant_id)
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
        .filter(FinanceEntry.tenant_id == txn.tenant_id, FinanceEntry.description.contains(f"Ledger mirror: {txn.id}"))
        .first()
    )
    if existing:
        return []

    source_code = finance_account_code(db, txn.tenant_id, txn.source_account_id)
    destination_code = finance_account_code(db, txn.tenant_id, txn.destination_account_id)
    amount = Decimal(str(txn.amount)).quantize(Decimal("0.01"))
    note = f"{txn.note or txn.category or txn.transaction_type} | Ledger mirror: {txn.id}"
    rows: list[FinanceEntry] = []

    def add_entry(entry_type: str, category: str, source: str, description: str) -> None:
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

    if txn.transaction_type == "income" and destination_code in {"cash", "card", "safe", "debt"}:
        add_entry("in", txn.category or "Ledger Mədaxil", destination_code, note)
    elif txn.transaction_type in {"cash_adjustment", "reconciliation_adjustment"}:
        if destination_code in {"cash", "card", "safe", "debt"}:
            add_entry("in", txn.category or "Ledger Mədaxil", destination_code, note)
        elif source_code in {"cash", "card", "safe", "debt"}:
            add_entry("out", txn.category or "Ledger Xərc", source_code, note)
    elif txn.transaction_type == "expense" and source_code in {"cash", "card", "safe"}:
        add_entry("out", txn.category or "Ledger Xərc", source_code, note)
    elif txn.transaction_type == "internal_transfer" and source_code and destination_code:
        add_entry("out", "Daxili Transfer", source_code, note)
        add_entry("in", "Daxili Transfer", destination_code, note)
    elif txn.transaction_type == "investor_injection" and destination_code in {"cash", "card", "safe"}:
        # Legacy mirror keeps only operational cash movement.
        # Investor liability is ledger-only single source of truth.
        add_entry("in", txn.category or "Təsisçi İnvestisiyası", destination_code, note)
    elif txn.transaction_type == "investor_repayment" and source_code in {"cash", "card", "safe"}:
        # Legacy mirror keeps only operational cash movement.
        # Investor liability is ledger-only single source of truth.
        add_entry("out", "İnvestora Geri Ödəniş", source_code, note)
    elif txn.transaction_type == "deposit_hold" and destination_code in {"cash", "card", "safe"}:
        add_entry("in", "Depozit Alındı", destination_code, note)
        add_entry("in", "Depozit Öhdəliyi", "deposit", note)
    elif txn.transaction_type == "deposit_apply_to_bill" and destination_code == "deposit":
        add_entry("out", "Depozit Öhdəliyi Azaldıldı", "deposit", note)
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
                        "rows": [{"type": row.type, "category": row.category, "source": row.source, "amount": str(row.amount)} for row in rows],
                    },
                    ensure_ascii=False,
                ),
            )
        )
    return rows


def mark_original_transaction_reversed(db: Session, reversal: FinanceTransaction, reversed_by: str) -> FinanceTransaction | None:
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
    original.status = "reversed"
    original.reversed_by = reversed_by
    original.reversed_at = datetime.utcnow()
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


def post_finance_transaction(
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

    txn = create_finance_transaction_record(
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
    return post_existing_transaction(db, txn, created_by)


def post_finance_transaction_with_legacy_mirror(db: Session, **kwargs) -> FinanceTransaction:
    txn = post_finance_transaction(db, **kwargs)
    mirror_posted_transaction_to_legacy_wallet(db, txn, kwargs["created_by"])
    return txn


def _normalize_sale_payment_source(payment_source: str | None) -> str:
    source = str(payment_source or "").strip().lower()
    if source in {"cash", "nəğd", "nagd", "nağd", "naghd"}:
        return "cash"
    return "card"


def post_sale_payment(
    db: Session,
    *,
    tenant_id: str,
    sale_id: str,
    amount: Decimal,
    payment_source: str,
    created_by: str,
    category: str | None = None,
    note: str | None = None,
    related_table_id: str | None = None,
    card_fee_percent: Decimal | str | int | float = Decimal("0"),
) -> list[FinanceTransaction]:
    """Post a POS/table sale payment to ledger and mirror legacy wallet rows.

    This keeps Sale + ledger + legacy compatibility inside the caller's current
    database transaction. The caller owns the final commit/rollback.
    """
    amount = Decimal(str(amount)).quantize(Decimal("0.01"))
    if amount <= 0:
        return []

    source = _normalize_sale_payment_source(payment_source)
    payment_category = category or ("Satış (Nağd)" if source == "cash" else "Satış (Kart)")
    payment_note = note or f"POS Sale {sale_id}"
    transactions: list[FinanceTransaction] = []

    sale_txn = post_finance_transaction(
        db,
        tenant_id=tenant_id,
        transaction_type="income",
        amount=amount,
        source_code="revenue",
        destination_code=source,
        created_by=created_by,
        category=payment_category,
        note=payment_note,
        related_table_id=related_table_id,
        related_order_id=sale_id,
    )
    mirror_posted_transaction_to_legacy_wallet(db, sale_txn, created_by)
    transactions.append(sale_txn)

    if source == "card":
        fee_percent = Decimal(str(card_fee_percent or "0"))
        card_fee = (amount * (fee_percent / Decimal("100"))).quantize(Decimal("0.01"))
        if card_fee > 0:
            fee_txn = post_finance_transaction(
                db,
                tenant_id=tenant_id,
                transaction_type="expense",
                amount=card_fee,
                source_code="card",
                destination_code="expense",
                created_by=created_by,
                category="Bank Komissiyası",
                note=f"{payment_note} kart komissiyası",
                related_table_id=related_table_id,
                related_order_id=sale_id,
            )
            mirror_posted_transaction_to_legacy_wallet(db, fee_txn, created_by)
            transactions.append(fee_txn)

    return transactions


def post_deposit_hold(
    db: Session,
    *,
    tenant_id: str,
    amount: Decimal,
    destination_code: str = "cash",
    created_by: str,
    note: str | None = None,
    related_table_id: str | None = None,
    related_order_id: str | None = None,
) -> FinanceTransaction | None:
    amount = Decimal(str(amount)).quantize(Decimal("0.01"))
    if amount <= 0:
        return None
    txn = post_finance_transaction(
        db,
        tenant_id=tenant_id,
        transaction_type="deposit_hold",
        amount=amount,
        source_code="deposit",
        destination_code=destination_code,
        created_by=created_by,
        category="Depozit Alındı",
        note=note,
        related_table_id=related_table_id,
        related_order_id=related_order_id,
    )
    mirror_posted_transaction_to_legacy_wallet(db, txn, created_by)
    return txn


def post_deposit_apply_to_bill(
    db: Session,
    *,
    tenant_id: str,
    amount: Decimal,
    created_by: str,
    note: str | None = None,
    related_table_id: str | None = None,
    related_order_id: str | None = None,
) -> FinanceTransaction | None:
    """Recognize a held deposit as bill revenue without reducing cash."""
    amount = Decimal(str(amount)).quantize(Decimal("0.01"))
    if amount <= 0:
        return None
    txn = post_finance_transaction(
        db,
        tenant_id=tenant_id,
        transaction_type="deposit_apply_to_bill",
        amount=amount,
        source_code="revenue",
        destination_code="deposit",
        created_by=created_by,
        category="Depozit hesaba tətbiq edildi",
        note=note,
        related_table_id=related_table_id,
        related_order_id=related_order_id,
    )
    mirror_posted_transaction_to_legacy_wallet(db, txn, created_by)
    return txn


def post_deposit_refund(
    db: Session,
    *,
    tenant_id: str,
    amount: Decimal,
    source_code: str = "cash",
    created_by: str,
    note: str | None = None,
    related_table_id: str | None = None,
    related_order_id: str | None = None,
) -> FinanceTransaction | None:
    amount = Decimal(str(amount)).quantize(Decimal("0.01"))
    if amount <= 0:
        return None
    txn = post_finance_transaction(
        db,
        tenant_id=tenant_id,
        transaction_type="deposit_refund",
        amount=amount,
        source_code=source_code,
        destination_code="deposit",
        created_by=created_by,
        category="Depozit Qaytarıldı",
        note=note,
        related_table_id=related_table_id,
        related_order_id=related_order_id,
    )
    mirror_posted_transaction_to_legacy_wallet(db, txn, created_by)
    return txn
