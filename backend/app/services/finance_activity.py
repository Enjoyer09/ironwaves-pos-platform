"""SQL activity projection for paged finance reads.

Audit references identify journal-backed manual activity when legacy wallet
mirroring is disabled. They are intentionally tenant- and period-scoped.
"""

import json
from datetime import datetime

from sqlalchemy import and_, case, exists, false, func, literal, or_, select, union_all
from sqlalchemy.orm import Session, aliased

from app.models import AuditLog, FinanceAccount, FinanceEntry, FinanceTransaction


def _within(column, start: datetime | None, end: datetime | None):
    filters = []
    if start is not None:
        filters.append(column >= start)
    if end is not None:
        filters.append(column < end)
    return filters


def _audit_transaction_ids(db: Session, tenant_id: str, start: datetime | None, end: datetime | None):
    query = db.query(AuditLog.action, AuditLog.details).filter(
        AuditLog.tenant_id == tenant_id,
        AuditLog.action.in_(["FINANCE_ENTRY_CREATED", "FINANCE_LEGACY_WALLET_SYNC_SKIPPED"]),
        *_within(AuditLog.created_at, start, end),
    )
    manual_ids: set[str] = set()
    fee_ids: set[str] = set()
    for action, details in query.yield_per(500):
        try:
            value = json.loads(details or "{}")
            if action == "FINANCE_ENTRY_CREATED" and value.get("ledger_transaction_id"):
                manual_ids.add(str(value["ledger_transaction_id"]))
            elif (action == "FINANCE_LEGACY_WALLET_SYNC_SKIPPED"
                  and value.get("transaction_type") == "expense" and value.get("transaction_id")):
                fee_ids.add(str(value["transaction_id"]))
        except (ValueError, TypeError, AttributeError):
            continue
    return manual_ids, fee_ids


def activity_rows(db: Session, tenant_id: str, start: datetime | None, end: datetime | None):
    """Return a composable SQL relation; callers apply LIMIT/cursor in SQL."""
    manual_ids, fee_ids = _audit_transaction_ids(db, tenant_id, start, end)
    entry = FinanceEntry
    supplier = aliased(FinanceTransaction)
    supplier_account = aliased(FinanceAccount)
    supplier_mirror = exists(
        select(literal(1)).select_from(supplier).join(
            supplier_account, supplier_account.id == supplier.source_account_id,
        ).where(
            supplier.tenant_id == tenant_id,
            supplier.transaction_type == "supplier_payment",
            supplier.status == "posted",
            entry.type == "out",
            entry.source == supplier_account.code,
            entry.amount == supplier.amount,
            func.trim(entry.description).like(literal("%Ledger mirror: ") + supplier.id),
            *_within(supplier.created_at, start, end),
        ).correlate(entry)
    )
    legacy_rows = select(
        entry.id.label("id"), entry.type.label("type"), entry.category.label("category"),
        entry.source.label("source"), entry.amount.label("amount"),
        entry.description.label("description"), entry.created_by.label("created_by"),
        entry.created_at.label("created_at"),
        case((supplier_mirror, literal("supplier_payment")), else_=literal(None)).label("source_kind"),
    ).where(entry.tenant_id == tenant_id, *_within(entry.created_at, start, end))

    transaction = FinanceTransaction
    source_account = aliased(FinanceAccount)
    mirror_entry = aliased(FinanceEntry)
    supplier_has_mirror = exists(
        select(literal(1)).select_from(mirror_entry).join(
            source_account, source_account.id == transaction.source_account_id,
        ).where(
            mirror_entry.tenant_id == tenant_id,
            mirror_entry.type == "out",
            mirror_entry.source == source_account.code,
            mirror_entry.amount == transaction.amount,
            func.trim(mirror_entry.description).like(literal("%Ledger mirror: ") + transaction.id),
            *_within(mirror_entry.created_at, start, end),
        ).correlate(transaction)
    )
    supplier_source = aliased(FinanceAccount)
    supplier_rows = select(
        transaction.id, literal("out").label("type"),
        func.coalesce(transaction.category, "Təchizatçı Ödənişi").label("category"),
        func.coalesce(supplier_source.code, "cash").label("source"),
        transaction.amount,
        (func.coalesce(func.nullif(transaction.counterparty, ""), "Təchizatçı")
         + literal(" | ")
         + func.coalesce(func.nullif(transaction.note, ""), func.nullif(transaction.category, ""), "Təchizatçı ödənişi")).label("description"),
        transaction.created_by, transaction.created_at,
        literal("supplier_payment").label("source_kind"),
    ).outerjoin(supplier_source, supplier_source.id == transaction.source_account_id).where(
        transaction.tenant_id == tenant_id,
        transaction.transaction_type == "supplier_payment",
        transaction.status == "posted",
        ~supplier_has_mirror,
        *_within(transaction.created_at, start, end),
    )

    manual_source = aliased(FinanceAccount)
    manual_destination = aliased(FinanceAccount)
    is_income = or_(
        transaction.transaction_type.in_(["income", "investor_injection"]),
        and_(transaction.transaction_type == "internal_transfer", manual_source.code == "debt"),
    )
    direction = case((is_income, literal("in")), else_=literal("out"))
    source_code = func.coalesce(case((is_income, manual_destination.code), else_=manual_source.code), "cash")
    manual_mirror = aliased(FinanceEntry)
    has_manual_mirror = exists(
        select(literal(1)).select_from(manual_mirror).where(
            manual_mirror.tenant_id == tenant_id,
            or_(
                manual_mirror.id == transaction.legacy_finance_entry_id,
                and_(
                    func.trim(manual_mirror.description).like(literal("%Ledger mirror: ") + transaction.id),
                    manual_mirror.type == direction,
                    manual_mirror.source == source_code,
                    manual_mirror.amount == transaction.amount,
                ),
            ),
            *_within(manual_mirror.created_at, start, end),
        ).correlate(transaction, manual_source, manual_destination)
    )
    manual_filter = or_(
        transaction.id.in_(manual_ids) if manual_ids else false(),
        and_(
            transaction.id.in_(fee_ids) if fee_ids else false(),
            transaction.category == "Bank Komissiyası",
            or_(transaction.note.like("Komissiya: Xərc ödənişi (%"),
                transaction.note.like("Transfer komissiyası:%")),
        ),
    )
    manual_rows = select(
        transaction.id, direction.label("type"),
        func.coalesce(transaction.category, "").label("category"),
        source_code.label("source"), transaction.amount,
        func.coalesce(transaction.note, "").label("description"),
        transaction.created_by, transaction.created_at,
        literal(None).label("source_kind"),
    ).outerjoin(manual_source, manual_source.id == transaction.source_account_id).outerjoin(
        manual_destination, manual_destination.id == transaction.destination_account_id,
    ).where(
        transaction.tenant_id == tenant_id,
        transaction.status == "posted",
        manual_filter,
        ~has_manual_mirror,
        *_within(transaction.created_at, start, end),
    )
    return union_all(legacy_rows, supplier_rows, manual_rows).cte("finance_activity_rows")
