from __future__ import annotations

from datetime import datetime
from decimal import Decimal
import secrets

from sqlalchemy.orm import Session

from app.models import FinanceEntry


def normalize_restore_finance_source(value: str | None) -> str:
    source = str(value or "").strip().lower()
    if source in {"cash", "kassa", "nağd", "negd", "nəğd"}:
        return "cash"
    if source in {"card", "bank", "bank kartı", "kart"}:
        return "card"
    if source in {"safe", "seyf"}:
        return "safe"
    if source in {"debt", "borc", "nisye", "nisyə"}:
        return "debt"
    if source in {"investor", "tesisci", "təsisçi"}:
        return "investor"
    if source in {"deposit", "depozit"}:
        return "deposit"
    return source or "cash"


def has_legacy_investor_context(*values: str | None) -> bool:
    haystack = " ".join(str(value or "").strip().lower() for value in values)
    return any(token in haystack for token in {"investor", "təsisçi", "tesisci", "founder"})


def is_restore_investor_liability_reduction(category: str | None, source: str | None) -> bool:
    normalized_category = str(category or "").strip().lower()
    normalized_source = str(source or "").strip().lower()
    return normalized_source == "investor" and any(
        token in normalized_category
        for token in {"investor borcu azaldılması", "investor liability reduction", "dolg investoru umenshen"}
    )


def restore_legacy_finance_rows(
    db: Session,
    *,
    tenant_id: str,
    rows: list,
    default_username: str,
    parse_dt,
    parse_decimal,
    reject_row,
) -> int:
    restored_count = 0
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            reject_row("Maliyyə sətri obyekt deyil", idx, row)
            continue
        category = str(row.get("category") or "Digər").strip() or "Digər"
        description = str(row.get("description") or row.get("reason") or "").strip()
        subject = str(row.get("subject") or "").strip()
        if subject and subject.lower() not in description.lower():
            description = f"{subject} | {description}".strip(" |")
        created_at = parse_dt(row.get("created_at")) or datetime.utcnow()
        created_by = str(row.get("created_by") or row.get("spender") or default_username or "restore")
        normalized_source = normalize_restore_finance_source(row.get("source"))
        tx_type = str(row.get("type") or "in").strip().lower() or "in"
        investor_context = has_legacy_investor_context(
            row.get("source"),
            row.get("subject"),
            row.get("description"),
            row.get("reason"),
            category,
        )
        liability_reduction = is_restore_investor_liability_reduction(category, normalized_source)
        stored_source = normalized_source
        if tx_type == "out" and normalized_source == "investor" and investor_context and not liability_reduction:
            stored_source = "legacy_investor_expense"
        amount = parse_decimal(row.get("amount"), "0.00")
        db.add(
            FinanceEntry(
                id=str(row.get("id") or secrets.token_hex(16)),
                tenant_id=tenant_id,
                type=tx_type,
                category=category,
                source=stored_source,
                amount=amount,
                description=description or None,
                created_by=created_by,
                created_at=created_at,
            )
        )
        restored_count += 1
        should_create_liability_mirror = investor_context and not liability_reduction and (
            (tx_type == "in" and stored_source in {"cash", "card", "safe", "debt", "deposit"})
            or (tx_type == "out" and normalized_source == "investor")
        )
        if should_create_liability_mirror:
            db.add(
                FinanceEntry(
                    id=secrets.token_hex(16),
                    tenant_id=tenant_id,
                    type="in",
                    category="İnvestor Borcu",
                    source="investor",
                    amount=amount,
                    description=(f"Legacy restore mirror: {description}" if description else "Legacy restore mirror"),
                    created_by=created_by,
                    created_at=created_at,
                )
            )
            restored_count += 1
    return restored_count
