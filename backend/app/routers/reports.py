from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import re
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, exists, func, or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import AuditLog, BusinessProfile, FinanceAccount, FinanceLedgerEntry, FinanceTransaction, Sale, Setting, Shift, ShiftHandover, Tenant, User
from app.services.finance_service import finance_policy as _finance_policy
from app.services.finance_service import create_finance_transaction_record as _create_finance_transaction_record
from app.services.finance_service import ledger_balances_snapshot as _ledger_balances_snapshot
from app.services.finance_service import post_deposit_apply_to_bill as _post_deposit_apply_to_bill
from app.services.finance_service import post_finance_transaction_with_legacy_mirror as _post_finance_transaction
from app.services.finance_service import sales_payment_totals as _sales_payment_totals
from app.services.finance_service import shift_cash_breakdown_from_ledger as _shift_cash_breakdown
from app.schemas import OpenShiftIn, ShiftHandoverAcceptIn, ShiftHandoverIn, XReportIn, ZReportIn, ZReportReceiptHtmlIn


router = APIRouter(prefix="/api/v1/reports", tags=["reports"])
STAFF_SHIFT_SESSIONS_KEY = "staff_shift_sessions"
VOID_SALE_STATUSES = [
    "VOIDED",
    "VOID",
    "CANCELLED",
    "CANCELED",
    "CANCELLED SALE",
    "CANCELED SALE",
    "LƏĞV",
    "LƏĞV EDILDI",
    "LƏĞV EDİLDİ",
    "LEĞV",
    "LEĞV EDILDI",
    "LEĞV EDİLDİ",
    "LAGV",
    "LAGV EDILDI",
]
SALE_PAYMENT_TRANSACTION_TYPES = ["income", "deposit_apply_to_bill"]
SALE_PAYMENT_LEDGER_TRANSACTION_TYPES = ["income", "deposit_apply_to_bill", "reversal"]
BAKU_TIME_ZONE = ZoneInfo("Asia/Baku")
THERMAL_RECEIPT_PRINT_CSS = """
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  html,
  body {
    width: 74mm;
    max-width: 74mm;
    margin: 0 !important;
    padding: 0 !important;
    color: #000 !important;
    background: #fff !important;
    font-family: "Courier New", "DejaVu Sans Mono", "Liberation Mono", monospace !important;
    font-size: 14px !important;
    line-height: 1.26 !important;
    font-weight: 600 !important;
    -webkit-font-smoothing: none;
    text-rendering: geometricPrecision;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { overflow-wrap: break-word; }
  .line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content;
    align-items: start;
    gap: 6px;
    margin: 3px 0;
  }
  .line span:first-child { min-width: 0; overflow-wrap: anywhere; }
  .line span:last-child {
    text-align: right;
    white-space: nowrap;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .muted { color: #111; font-size: 12px; line-height: 1.22; font-weight: 600; }
  .bold { font-weight: 900; }
  .section-title {
    margin-top: 9px;
    font-size: 13px;
    line-height: 1.25;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 14px !important; line-height: 1.25 !important; }
  td { vertical-align: top; padding: 4px 0; font-weight: 700; }
  td:first-child { overflow-wrap: anywhere; padding-right: 6px; }
  td:last-child {
    width: 24mm;
    text-align: right;
    white-space: nowrap;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  hr { border: 0; border-top: 1.5px dashed #000; margin: 9px 0; }
  svg { max-width: 100%; }
  img { max-width: 100%; image-rendering: crisp-edges; }
"""


def _utcnow() -> datetime:
    # Keep stored timestamps UTC-naive (existing DB model expectation) without using deprecated utcnow().
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalized(value: str | None) -> str:
    return (value or "").strip().lower()


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed.replace(tzinfo=None)
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


def _posted_transaction_filters(tenant_id: str, opened_at: datetime | None, closed_at: datetime | None = None) -> list:
    filters = [
        FinanceTransaction.tenant_id == tenant_id,
        FinanceTransaction.status == "posted",
    ]
    if opened_at:
        filters.append(FinanceTransaction.created_at >= opened_at)
    if closed_at:
        filters.append(FinanceTransaction.created_at < closed_at)
    return filters


def _posted_transaction_sum(
    db: Session,
    tenant_id: str,
    opened_at: datetime | None,
    *extra_filters,
    closed_at: datetime | None = None,
) -> Decimal:
    return Decimal(
        str(
            db.query(func.coalesce(func.sum(FinanceTransaction.amount), 0))
            .filter(*_posted_transaction_filters(tenant_id, opened_at, closed_at), *extra_filters)
            .scalar()
            or 0
        )
    ).quantize(Decimal("0.01"))


def _group_posted_transaction_amounts(
    db: Session,
    tenant_id: str,
    opened_at: datetime | None,
    *extra_filters,
    closed_at: datetime | None = None,
    exclude_categories: set[str] | None = None,
) -> tuple[Decimal, list[dict]]:
    excluded = exclude_categories or set()
    rows = (
        db.query(
            FinanceTransaction.category,
            FinanceTransaction.transaction_type,
            func.coalesce(func.sum(FinanceTransaction.amount), 0),
        )
        .filter(*_posted_transaction_filters(tenant_id, opened_at, closed_at), *extra_filters)
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


def _posted_transactions_since(
    db: Session,
    tenant_id: str,
    opened_at: datetime | None,
    closed_at: datetime | None = None,
) -> list[FinanceTransaction]:
    return db.query(FinanceTransaction).filter(*_posted_transaction_filters(tenant_id, opened_at, closed_at)).all()


def _finance_account_code_map(db: Session, tenant_id: str) -> dict[str, str]:
    rows = db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant_id).all()
    return {row.id: row.code for row in rows}


def _shift_sales_payment_totals(db: Session, tenant_id: str, opened_at: datetime | None, closed_at: datetime | None) -> tuple[Decimal, Decimal]:
    totals = _sales_payment_totals(db, tenant_id, opened_at, closed_at)
    return totals["cash_sales"], totals["card_sales"]


def _shift_sales_totals(db: Session, tenant_id: str, opened_at: datetime | None, closed_at: datetime | None) -> dict[str, Decimal]:
    return _sales_payment_totals(db, tenant_id, opened_at, closed_at)


def _sale_is_void_expr(tenant_id: str):
    sale_status_is_void = func.upper(func.trim(func.coalesce(Sale.status, ""))).in_(VOID_SALE_STATUSES)
    sale_has_posted_payment = exists().where(
        and_(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == Sale.id,
            FinanceTransaction.status == "posted",
            FinanceTransaction.transaction_type.in_(SALE_PAYMENT_TRANSACTION_TYPES),
        )
    )
    sale_has_payment_ledger = exists().where(
        and_(
            FinanceTransaction.tenant_id == tenant_id,
            FinanceTransaction.related_order_id == Sale.id,
            FinanceTransaction.transaction_type.in_(SALE_PAYMENT_LEDGER_TRANSACTION_TYPES),
        )
    )
    return or_(sale_status_is_void, and_(sale_has_payment_ledger, ~sale_has_posted_payment))


def _shift_void_sales_total(db: Session, tenant_id: str, opened_at: datetime | None, closed_at: datetime | None) -> Decimal:
    query = db.query(func.coalesce(func.sum(Sale.total), 0)).filter(
        Sale.tenant_id == tenant_id,
        _sale_is_void_expr(tenant_id),
    )
    if opened_at:
        query = query.filter(Sale.created_at >= opened_at)
    if closed_at:
        query = query.filter(Sale.created_at < closed_at)
    return Decimal(str(query.scalar() or 0)).quantize(Decimal("0.01"))


def _shift_cashier_breakdown(db: Session, tenant_id: str, opened_at: datetime | None, closed_at: datetime | None) -> list[dict]:
    filters = [
        Sale.tenant_id == tenant_id,
        ~_sale_is_void_expr(tenant_id),
    ]
    if opened_at:
        filters.append(Sale.created_at >= opened_at)
    if closed_at:
        filters.append(Sale.created_at < closed_at)

    rows = db.query(Sale.id, Sale.cashier, Sale.total, Sale.payment_method).filter(*filters).all()
    sale_ids = [row.id for row in rows]
    payments_by_sale: dict[str, dict[str, Decimal]] = {}
    if sale_ids:
        payment_rows = (
            db.query(
                FinanceTransaction.related_order_id,
                FinanceAccount.code,
                func.coalesce(func.sum(FinanceTransaction.amount), 0),
            )
            .join(FinanceAccount, FinanceAccount.id == FinanceTransaction.destination_account_id)
            .filter(
                FinanceTransaction.tenant_id == tenant_id,
                FinanceTransaction.related_order_id.in_(sale_ids),
                FinanceTransaction.status == "posted",
                FinanceTransaction.transaction_type == "income",
                FinanceAccount.code.in_(["cash", "card"]),
            )
            .group_by(FinanceTransaction.related_order_id, FinanceAccount.code)
            .all()
        )
        for sale_id, code, amount_raw in payment_rows:
            bucket = payments_by_sale.setdefault(str(sale_id), {"cash": Decimal("0.00"), "card": Decimal("0.00")})
            bucket[str(code or "")] = Decimal(str(amount_raw or 0)).quantize(Decimal("0.01"))

    grouped: dict[str, dict[str, Decimal | int | str]] = {}
    for row in rows:
        cashier = str(row.cashier or "-")
        current = grouped.setdefault(
            cashier,
            {"cashier": cashier, "sales_count": 0, "total": Decimal("0.00"), "cash": Decimal("0.00"), "card": Decimal("0.00")},
        )
        total = Decimal(str(row.total or 0)).quantize(Decimal("0.01"))
        current["sales_count"] = int(current["sales_count"]) + 1
        current["total"] = Decimal(str(current["total"])) + total
        split = payments_by_sale.get(str(row.id), {"cash": Decimal("0.00"), "card": Decimal("0.00")})
        split_cash = Decimal(str(split.get("cash") or 0)).quantize(Decimal("0.01"))
        split_card = Decimal(str(split.get("card") or 0)).quantize(Decimal("0.01"))
        if split_cash > 0 or split_card > 0:
            current["cash"] = Decimal(str(current["cash"])) + split_cash
            current["card"] = Decimal(str(current["card"])) + split_card
        elif "kart" in str(row.payment_method or "").lower() or "card" in str(row.payment_method or "").lower():
            current["card"] = Decimal(str(current["card"])) + total
        else:
            current["cash"] = Decimal(str(current["cash"])) + total

    return [
        {
            "cashier": str(row["cashier"]),
            "sales_count": int(row["sales_count"]),
            "total": str(Decimal(str(row["total"])).quantize(Decimal("0.01"))),
            "cash": str(Decimal(str(row["cash"])).quantize(Decimal("0.01"))),
            "card": str(Decimal(str(row["card"])).quantize(Decimal("0.01"))),
        }
        for row in sorted(grouped.values(), key=lambda item: Decimal(str(item["total"])), reverse=True)
    ]


def _shift_item_sales_breakdown(db: Session, tenant_id: str, opened_at: datetime | None, closed_at: datetime | None) -> list[dict]:
    filters = [
        Sale.tenant_id == tenant_id,
        ~_sale_is_void_expr(tenant_id),
    ]
    if opened_at:
        filters.append(Sale.created_at >= opened_at)
    if closed_at:
        filters.append(Sale.created_at < closed_at)

    rows = db.query(Sale.items_json).filter(*filters).all()
    
    item_totals: dict[str, dict[str, Decimal]] = {}
    for (items_json_str,) in rows:
        try:
            items = json.loads(items_json_str)
            if not isinstance(items, list):
                continue
            for item in items:
                name = str(item.get("item_name") or item.get("name") or "Bilinməyən")
                qty = Decimal(str(item.get("qty") or 0))
                price = Decimal(str(item.get("price") or 0))
                total = qty * price
                if name not in item_totals:
                    item_totals[name] = {"qty": Decimal("0"), "total": Decimal("0.00")}
                item_totals[name]["qty"] += qty
                item_totals[name]["total"] += total
        except Exception:
            pass

    result = []
    for name, data in item_totals.items():
        qty_val = data["qty"]
        # Determine if qty should be formatted as int or decimal
        if qty_val == qty_val.to_integral_value():
            qty_str = str(int(qty_val))
        else:
            qty_str = str(qty_val.normalize())
            
        result.append({
            "item_name": name,
            "qty": qty_str,
            "total": str(data["total"].quantize(Decimal("0.01"))),
        })
    
    result.sort(key=lambda x: Decimal(x["total"]), reverse=True)
    return result


def _shift_cogs_total(db: Session, tenant_id: str, opened_at: datetime | None, closed_at: datetime | None) -> Decimal:
    filters = [
        Sale.tenant_id == tenant_id,
        ~_sale_is_void_expr(tenant_id),
    ]
    if opened_at:
        filters.append(Sale.created_at >= opened_at)
    if closed_at:
        filters.append(Sale.created_at < closed_at)
    return Decimal(
        str(db.query(func.coalesce(func.sum(Sale.cogs), 0)).filter(*filters).scalar() or 0)
    ).quantize(Decimal("0.01"))


def _shift_cash_breakdown_for_receipt(db: Session, tenant_id: str, shift: Shift) -> dict[str, Decimal]:
    opening_cash = Decimal(str(shift.opening_cash or 0)).quantize(Decimal("0.01"))
    account_id_by_code = {code: account_id for account_id, code in _finance_account_code_map(db, tenant_id).items()}
    cash_account_id = account_id_by_code.get("cash")
    if not cash_account_id:
        actual_cash = Decimal(str(shift.actual_cash or shift.closing_cash or opening_cash)).quantize(Decimal("0.01"))
        return {
            "opening_cash": opening_cash,
            "cash_in": Decimal("0.00"),
            "cash_out": Decimal("0.00"),
            "expected_cash": actual_cash,
        }

    query = db.query(FinanceLedgerEntry.entry_side, FinanceLedgerEntry.amount).filter(
        FinanceLedgerEntry.tenant_id == tenant_id,
        FinanceLedgerEntry.account_id == cash_account_id,
    )
    if shift.opened_at:
        query = query.filter(FinanceLedgerEntry.created_at >= shift.opened_at)
    if shift.closed_at:
        query = query.filter(FinanceLedgerEntry.created_at < shift.closed_at)
    rows = query.all()
    cash_in = sum(
        (Decimal(str(amount or 0)) for side, amount in rows if str(side or "").lower() == "debit"),
        Decimal("0"),
    ).quantize(Decimal("0.01"))
    cash_out = sum(
        (Decimal(str(amount or 0)) for side, amount in rows if str(side or "").lower() == "credit"),
        Decimal("0"),
    ).quantize(Decimal("0.01"))
    expected_cash = (opening_cash + cash_in - cash_out).quantize(Decimal("0.01"))
    return {
        "opening_cash": opening_cash,
        "cash_in": cash_in,
        "cash_out": cash_out,
        "expected_cash": expected_cash,
    }


def _z_report_financial_context(
    db: Session,
    tenant_id: str,
    shift: Shift,
    total_sales: Decimal,
    report_account_ids: list[str] | None = None,
) -> dict:
    account_ids = report_account_ids
    if account_ids is None:
        account_id_by_code = {code: account_id for account_id, code in _finance_account_code_map(db, tenant_id).items()}
        account_ids = [
            account_id
            for code, account_id in account_id_by_code.items()
            if code in {"cash", "card", "safe", "debt"} and account_id
        ]

    opened_at = shift.opened_at
    closed_at = shift.closed_at
    total_cogs = _shift_cogs_total(db, tenant_id, opened_at, closed_at)
    bank_fee_total = _posted_transaction_sum(
        db,
        tenant_id,
        opened_at,
        FinanceTransaction.transaction_type == "expense",
        FinanceTransaction.category == "Bank Komissiyası",
        closed_at=closed_at,
    )
    wage_amount = _posted_transaction_sum(
        db,
        tenant_id,
        opened_at,
        FinanceTransaction.transaction_type == "expense",
        FinanceTransaction.category == "Maaş",
        closed_at=closed_at,
    )
    deposit_total = _posted_transaction_sum(
        db,
        tenant_id,
        opened_at,
        FinanceTransaction.transaction_type == "deposit_hold",
        closed_at=closed_at,
    )
    other_income_total, other_income_lines = _group_posted_transaction_amounts(
        db,
        tenant_id,
        opened_at,
        or_(
            (FinanceTransaction.transaction_type == "income") & FinanceTransaction.related_order_id.is_(None),
            (
                FinanceTransaction.transaction_type.in_(["cash_adjustment", "reconciliation_adjustment"])
                & FinanceTransaction.destination_account_id.in_(account_ids)
            ),
            FinanceTransaction.transaction_type == "investor_injection",
        ),
        closed_at=closed_at,
        exclude_categories={"satış (nağd)", "satış (kart)", "staff ödənişi", "depozit alındı"},
    )
    other_expense_total, other_expense_lines = _group_posted_transaction_amounts(
        db,
        tenant_id,
        opened_at,
        or_(
            FinanceTransaction.transaction_type == "expense",
            (
                FinanceTransaction.transaction_type.in_(["cash_adjustment", "reconciliation_adjustment"])
                & FinanceTransaction.source_account_id.in_(account_ids)
            ),
        ),
        closed_at=closed_at,
        exclude_categories={"maaş", "bank komissiyası"},
    )
    cash_breakdown = _shift_cash_breakdown_for_receipt(db, tenant_id, shift)
    return {
        "total_cogs": total_cogs,
        "gross_profit": (total_sales - total_cogs).quantize(Decimal("0.01")),
        "bank_fee_total": bank_fee_total,
        "wage_amount": wage_amount,
        "deposit_total": deposit_total,
        "other_income_total": other_income_total,
        "other_income_lines": other_income_lines,
        "other_expense_total": other_expense_total,
        "other_expense_lines": other_expense_lines,
        "opening_cash": cash_breakdown["opening_cash"],
        "cash_movements_in": cash_breakdown["cash_in"],
        "cash_movements_out": cash_breakdown["cash_out"],
        "expected_cash": cash_breakdown["expected_cash"],
        "actual_cash": Decimal(str(shift.actual_cash or shift.closing_cash or 0)).quantize(Decimal("0.01")),
        "difference": Decimal(str(shift.cash_variance or 0)).quantize(Decimal("0.01")),
        "closing_deposit_liability": Decimal(str(shift.closing_deposit_liability or 0)).quantize(Decimal("0.01")),
        "deposit_settled_amount": Decimal(str(shift.deposit_settled_amount or 0)).quantize(Decimal("0.01")),
    }


def _replace_z_report_money_line(html: str, label: str, amount: Decimal) -> str:
    safe_amount = f"{amount.quantize(Decimal('0.01'))} ₼"
    pattern = (
        rf"(<div\b[^>]*class=[\"'][^\"']*\bline\b[^\"']*[\"'][^>]*>\s*"
        rf"<span[^>]*>\s*{re.escape(label)}\s*</span>\s*<span[^>]*>)([^<]*)(</span>\s*</div>)"
    )
    replacement = rf"\g<1>{safe_amount}\3"
    return re.sub(pattern, replacement, html, count=1, flags=re.IGNORECASE)


def _format_z_report_time(value: datetime | None) -> str:
    if not value:
        return "-"
    source = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return source.astimezone(BAKU_TIME_ZONE).strftime("%H:%M:%S")


def _z_report_money_line_exists(html: str, label: str) -> bool:
    pattern = (
        rf"<div\b[^>]*class=[\"'][^\"']*\bline\b[^\"']*[\"'][^>]*>\s*"
        rf"<span[^>]*>\s*{re.escape(label)}\s*</span>\s*<span[^>]*>[^<]*</span>\s*</div>"
    )
    return re.search(pattern, html or "", flags=re.IGNORECASE) is not None


def _insert_z_report_money_line_after(html: str, anchor_label: str, label: str, amount: Decimal) -> str:
    if not html or _z_report_money_line_exists(html, label):
        return html
    safe_amount = f"{amount.quantize(Decimal('0.01'))} ₼"
    line = f'<div class="line"><span>{label}</span><span>{safe_amount}</span></div>'
    anchor_pattern = (
        rf"(<div\b[^>]*class=[\"'][^\"']*\bline\b[^\"']*[\"'][^>]*>\s*"
        rf"<span[^>]*>\s*{re.escape(anchor_label)}\s*</span>\s*<span[^>]*>[^<]*</span>\s*</div>)"
    )
    if re.search(anchor_pattern, html, flags=re.IGNORECASE):
        return re.sub(anchor_pattern, rf"\1\n            {line}", html, count=1, flags=re.IGNORECASE)
    total_pattern = (
        r"(<div\b[^>]*class=[\"'][^\"']*\bline\b[^\"']*[\"'][^>]*>\s*"
        r"<span[^>]*>\s*Ümumi Satış\s*</span>\s*<span[^>]*>[^<]*</span>\s*</div>)"
    )
    return re.sub(total_pattern, rf"{line}\n            \1", html, count=1, flags=re.IGNORECASE)


def _z_report_text_line_exists(html: str, label: str) -> bool:
    pattern = (
        rf"<div\b[^>]*class=[\"'][^\"']*\bline\b[^\"']*[\"'][^>]*>\s*"
        rf"<span[^>]*>\s*{re.escape(label)}\s*</span>\s*<span[^>]*>[^<]*</span>\s*</div>"
    )
    return re.search(pattern, html or "", flags=re.IGNORECASE) is not None


def _insert_z_report_text_line_after(html: str, anchor_label: str, label: str, value: str) -> str:
    if not html or _z_report_text_line_exists(html, label):
        return html
    line = f'<div class="line"><span>{label}</span><span>{value}</span></div>'
    anchor_pattern = (
        rf"(<div\b[^>]*class=[\"'][^\"']*\bline\b[^\"']*[\"'][^>]*>\s*"
        rf"<span[^>]*>\s*{re.escape(anchor_label)}\s*</span>\s*<span[^>]*>[^<]*</span>\s*</div>)"
    )
    if re.search(anchor_pattern, html, flags=re.IGNORECASE):
        return re.sub(anchor_pattern, rf"\1\n            {line}", html, count=1, flags=re.IGNORECASE)
    return html


def _replace_z_report_cashier_breakdown(html: str, rows: list[dict]) -> str:
    corrected = html or ""
    for row in rows or []:
        cashier = str(row.get("cashier") or "-")
        sales_count = int(row.get("sales_count") or 0)
        total = Decimal(str(row.get("total") or 0)).quantize(Decimal("0.01"))
        cash = Decimal(str(row.get("cash") or 0)).quantize(Decimal("0.01"))
        card = Decimal(str(row.get("card") or 0)).quantize(Decimal("0.01"))
        replacement = (
            f'<div class="line"><span>{cashier} ({sales_count})</span><span>{total} ₼</span></div>\n'
            f'        <div class="muted">cash {cash} ₼ • card {card} ₼</div>'
        )
        pattern = (
            rf"<div\b[^>]*class=[\"'][^\"']*\bline\b[^\"']*[\"'][^>]*>\s*"
            rf"<span[^>]*>\s*{re.escape(cashier)}\s*\(\d+\)\s*</span>\s*<span[^>]*>[^<]*</span>\s*</div>\s*"
            rf"<div\b[^>]*class=[\"'][^\"']*\bmuted\b[^\"']*[\"'][^>]*>[^<]*</div>"
        )
        corrected = re.sub(pattern, replacement, corrected, count=1, flags=re.IGNORECASE)
    return corrected


def _business_profile(db: Session, tenant: Tenant) -> dict[str, str]:
    profile = None
    if hasattr(db, "query"):
        try:
            profile = db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant.id).first()
        except Exception:
            profile = None
    return {
        "company_name": str(getattr(profile, "company_name", "") or tenant.name or "iRonWaves POS"),
        "voen": "-",
        "phone": str(getattr(profile, "phone", "") or "-"),
        "address": str(getattr(profile, "address", "") or "-"),
        "receipt_footer": str(getattr(profile, "receipt_footer", "") or "Bizi seçdiyiniz üçün təşəkkür edirik!"),
    }


def _build_z_report_receipt_html(
    *,
    db: Session,
    tenant: Tenant,
    shift: Shift,
    cash_sales: Decimal,
    card_sales: Decimal,
    total_sales: Decimal,
    deposit_applied_sales: Decimal,
    void_sales: Decimal,
    cashier_breakdown: list[dict],
    item_breakdown: list[dict] | None = None,
    sales_count: int = 0,
    wage_amount: Decimal = Decimal("0.00"),
    total_cogs: Decimal = Decimal("0.00"),
    gross_profit: Decimal = Decimal("0.00"),
    bank_fee_total: Decimal = Decimal("0.00"),
    opening_cash: Decimal = Decimal("0.00"),
    expected_cash: Decimal = Decimal("0.00"),
    actual_cash: Decimal = Decimal("0.00"),
    difference: Decimal = Decimal("0.00"),
    cash_movements_in: Decimal = Decimal("0.00"),
    cash_movements_out: Decimal = Decimal("0.00"),
    deposit_total: Decimal = Decimal("0.00"),
    closing_deposit_liability: Decimal = Decimal("0.00"),
    deposit_settled_amount: Decimal = Decimal("0.00"),
    other_income_total: Decimal = Decimal("0.00"),
    other_income_lines: list[dict] | None = None,
    other_expense_total: Decimal = Decimal("0.00"),
    other_expense_lines: list[dict] | None = None,
) -> str:
    profile = _business_profile(db, tenant)
    report_id = str(shift.id or "Z-REPORT")[:8].upper()
    cashier_rows = "\n".join(
        (
            f'<div class="line"><span>{row.get("cashier") or "-"} ({int(row.get("sales_count") or 0)})</span>'
            f'<span>{Decimal(str(row.get("total") or 0)).quantize(Decimal("0.01"))} ₼</span></div>\n'
            f'<div class="muted">cash {Decimal(str(row.get("cash") or 0)).quantize(Decimal("0.01"))} ₼ • '
            f'card {Decimal(str(row.get("card") or 0)).quantize(Decimal("0.01"))} ₼</div>'
        )
        for row in cashier_breakdown
    )
    item_rows = "\n".join(
        (
            f'<div class="line"><span>{row.get("item_name") or "Bilinməyən"} '
            f'<span class="muted">({row.get("qty") or 0}x)</span></span>'
            f'<span>{Decimal(str(row.get("total") or 0)).quantize(Decimal("0.01"))} ₼</span></div>'
        )
        for row in (item_breakdown or [])
    )
    other_income_rows = "\n".join(
        f'<div class="line"><span>{row.get("label") or "Digər giriş"}</span>'
        f'<span>{Decimal(str(row.get("amount") or 0)).quantize(Decimal("0.01"))} ₼</span></div>'
        for row in (other_income_lines or [])
    )
    other_expense_rows = "\n".join(
        f'<div class="line"><span>{row.get("label") or "Digər xərc"}</span>'
        f'<span>{Decimal(str(row.get("amount") or 0)).quantize(Decimal("0.01"))} ₼</span></div>'
        for row in (other_expense_lines or [])
    )
    deposit_line = (
        f'<div class="line"><span>Depozitdən ödənən</span><span>{deposit_applied_sales.quantize(Decimal("0.01"))} ₼</span></div>'
        if deposit_applied_sales > Decimal("0.00")
        else ""
    )
    return f"""
      <html>
        <head>
          <style>
            {THERMAL_RECEIPT_PRINT_CSS}
          </style>
        </head>
        <body>
          <div class="bold" style="font-size:15px">{profile["company_name"]}</div>
          <div class="muted">VÖEN: {profile["voen"]}</div>
          <div class="muted">Tel: {profile["phone"]}</div>
          <div class="muted">{profile["address"]}</div>
          <hr />
          <div class="line"><span>Z-Hesabat</span><span>{report_id}</span></div>
          <div class="line"><span>Operator</span><span>{shift.closed_by or shift.opened_by or "-"}</span></div>
          <div class="line"><span>Açılış saatı</span><span>{_format_z_report_time(shift.opened_at)}</span></div>
          <div class="line"><span>Bağlanış saatı</span><span>{_format_z_report_time(shift.closed_at)}</span></div>
          <hr />
          <div class="section-title">Satış xülasəsi</div>
          <div class="line"><span>Ümumi Satış</span><span>{total_sales.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Nağd Satış</span><span>{cash_sales.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Kart Satış</span><span>{card_sales.quantize(Decimal("0.01"))} ₼</span></div>
          {deposit_line}
          <div class="line"><span>Void/Cancel</span><span>{void_sales.quantize(Decimal("0.01"))} ₼</span></div>
          <hr />
          <div class="section-title">Mənfəət xülasəsi</div>
          <div class="line"><span>Maya (COGS)</span><span>{total_cogs.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Brutto Mənfəət</span><span>{gross_profit.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Bank faizi</span><span>{bank_fee_total.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Maaş Çıxışı</span><span>{wage_amount.quantize(Decimal("0.01"))} ₼</span></div>
          <hr />
          <div class="section-title">Kassa bağlanışı</div>
          <div class="line"><span>Növbə Açılışı</span><span>{opening_cash.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Olmalı kassa</span><span>{expected_cash.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Faktiki bağlanış</span><span>{actual_cash.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Bağlanış fərqi</span><span>{difference.quantize(Decimal("0.01"))} ₼</span></div>
          <hr />
          <div class="section-title">Kassa hərəkətləri</div>
          <div class="line"><span>Kassa girişləri</span><span>{cash_movements_in.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Kassa çıxışları</span><span>{cash_movements_out.quantize(Decimal("0.01"))} ₼</span></div>
          <hr />
          <div class="section-title">Digər giriş pulları</div>
          <div class="line"><span>Cəmi</span><span>{other_income_total.quantize(Decimal("0.01"))} ₼</span></div>
          {other_income_rows or '<div class="muted">Bu növbədə əlavə giriş yoxdur</div>'}
          <hr />
          <div class="section-title">Digər xərclər</div>
          <div class="line"><span>Cəmi</span><span>{other_expense_total.quantize(Decimal("0.01"))} ₼</span></div>
          {other_expense_rows or '<div class="muted">Bu növbədə əlavə xərc yoxdur</div>'}
          <hr />
          <div class="section-title">Depozit xülasəsi</div>
          <div class="line"><span>Bu növbədə toplanan depozit</span><span>{deposit_total.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Depozitdən bağlanan</span><span>{deposit_settled_amount.quantize(Decimal("0.01"))} ₼</span></div>
          <div class="line"><span>Aktiv depozit öhdəliyi</span><span>{closing_deposit_liability.quantize(Decimal("0.01"))} ₼</span></div>
          <hr />
          <div class="section-title">Kassir Breakdown</div>
          {cashier_rows or '<div class="muted">Kassir fəaliyyəti yoxdur</div>'}
          <hr />
          <div class="section-title">Məhsul Satışları</div>
          {item_rows or '<div class="muted">Məhsul satışı yoxdur</div>'}
          <hr />
          <div class="line"><span>Satış sayı</span><span>{int(sales_count or 0)}</span></div>
          <div class="muted">{profile["receipt_footer"]}</div>
        </body>
      </html>
    """


def _correct_z_report_receipt_html(
    html: str,
    cash_sales: Decimal,
    card_sales: Decimal,
    total_sales: Decimal | None = None,
    deposit_applied_sales: Decimal = Decimal("0.00"),
    void_sales: Decimal = Decimal("0.00"),
    opened_at: datetime | None = None,
    closed_at: datetime | None = None,
    cashier_breakdown: list[dict] | None = None,
) -> str:
    if not html:
        return html
    final_total = (total_sales if total_sales is not None else cash_sales + card_sales).quantize(Decimal("0.01"))
    corrected = _replace_z_report_money_line(html, "Nağd Satış", cash_sales)
    corrected = _replace_z_report_money_line(corrected, "Kart Satış", card_sales)
    if deposit_applied_sales > Decimal("0.00"):
        corrected = _replace_z_report_money_line(corrected, "Depozitdən ödənən", deposit_applied_sales)
        corrected = _insert_z_report_money_line_after(corrected, "Kart Satış", "Depozitdən ödənən", deposit_applied_sales)
    if void_sales > Decimal("0.00"):
        corrected = _replace_z_report_money_line(corrected, "Void/Cancel", void_sales)
        corrected = _insert_z_report_money_line_after(corrected, "Depozitdən ödənən" if deposit_applied_sales > Decimal("0.00") else "Kart Satış", "Void/Cancel", void_sales)
    corrected = _replace_z_report_money_line(corrected, "Ümumi Satış", final_total)
    corrected = _insert_z_report_text_line_after(corrected, "Operator", "Açılış saatı", _format_z_report_time(opened_at))
    corrected = _insert_z_report_text_line_after(corrected, "Açılış saatı", "Bağlanış saatı", _format_z_report_time(closed_at))
    if cashier_breakdown:
        corrected = _replace_z_report_cashier_breakdown(corrected, cashier_breakdown)
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
                    if tenant.id == "6e2c0d4c-6fab-4e49-8f9d-2d675457c655":
                        # Apply custom bank tiered transfer commission rule for Emalat Coffee
                        if topup_amount <= Decimal("100"):
                            commission = Decimal("0.60")
                        else:
                            commission = (topup_amount * Decimal("0.005")).quantize(Decimal("0.01"))
                    else:
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
        db.flush()

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
    sales_totals = _shift_sales_totals(db, tenant.id, active.opened_at, None)
    cash_sales = sales_totals["cash_sales"]
    card_sales = sales_totals["card_sales"]
    deposit_applied_sales = sales_totals["deposit_applied"]
    total_sales = sales_totals["sales_total"]
    sales_count = int(sales_totals["sales_count"])
    ledger_sales_total = sales_totals["ledger_sales_total"]
    reconciliation_gap = sales_totals["reconciliation_gap"]
    void_sales = sales_totals["void_sales"]
    cashier_breakdown = _shift_cashier_breakdown(db, tenant.id, active.opened_at, None)
    item_breakdown = _shift_item_sales_breakdown(db, tenant.id, active.opened_at, None)
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
        exclude_categories={"maaş", "bank komissiyası"},
    )
    receipt_context = _z_report_financial_context(
        db,
        tenant.id,
        active,
        total_sales,
        report_account_ids=report_account_ids,
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
        "opened_at": active.opened_at.isoformat() if active.opened_at else None,
        "closed_at": active.closed_at.isoformat(),
        "total_sales": str(total_sales.quantize(Decimal("0.01"))),
        "sales_count": sales_count,
        "cash_sales": str(cash_sales.quantize(Decimal("0.01"))),
        "card_sales": str(card_sales.quantize(Decimal("0.01"))),
        "deposit_applied_sales": str(deposit_applied_sales.quantize(Decimal("0.01"))),
        "ledger_sales_total": str(ledger_sales_total.quantize(Decimal("0.01"))),
        "reconciliation_gap": str(reconciliation_gap.quantize(Decimal("0.01"))),
        "void_sales": str(void_sales.quantize(Decimal("0.01"))),
        "total_cogs": str(receipt_context["total_cogs"].quantize(Decimal("0.01"))),
        "gross_profit": str(receipt_context["gross_profit"].quantize(Decimal("0.01"))),
        "bank_fee_total": str(receipt_context["bank_fee_total"].quantize(Decimal("0.01"))),
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
        "cashier_breakdown": cashier_breakdown,
        "item_breakdown": item_breakdown,
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
        query = query.filter(Shift.closed_at < end)
    rows = query.order_by(Shift.closed_at.desc()).limit(limit).all()
    result = []
    for row in rows:
        if not row.z_report_html:
            continue
        sales_totals = _shift_sales_totals(db, tenant.id, row.opened_at, row.closed_at)
        cash_sales = sales_totals["cash_sales"]
        card_sales = sales_totals["card_sales"]
        deposit_applied_sales = sales_totals["deposit_applied"]
        total_sales = sales_totals["sales_total"]
        sales_count = int(sales_totals["sales_count"])
        void_sales = sales_totals["void_sales"]
        cashier_breakdown = _shift_cashier_breakdown(db, tenant.id, row.opened_at, row.closed_at)
        item_breakdown = _shift_item_sales_breakdown(db, tenant.id, row.opened_at, row.closed_at)
        receipt_context = _z_report_financial_context(db, tenant.id, row, total_sales)
        corrected_html = _build_z_report_receipt_html(
            db=db,
            tenant=tenant,
            shift=row,
            cash_sales=cash_sales,
            card_sales=card_sales,
            total_sales=total_sales,
            deposit_applied_sales=deposit_applied_sales,
            void_sales=void_sales,
            cashier_breakdown=cashier_breakdown,
            item_breakdown=item_breakdown,
            sales_count=sales_count,
            wage_amount=receipt_context["wage_amount"],
            total_cogs=receipt_context["total_cogs"],
            gross_profit=receipt_context["gross_profit"],
            bank_fee_total=receipt_context["bank_fee_total"],
            opening_cash=receipt_context["opening_cash"],
            expected_cash=receipt_context["expected_cash"],
            actual_cash=receipt_context["actual_cash"],
            difference=receipt_context["difference"],
            cash_movements_in=receipt_context["cash_movements_in"],
            cash_movements_out=receipt_context["cash_movements_out"],
            deposit_total=receipt_context["deposit_total"],
            closing_deposit_liability=receipt_context["closing_deposit_liability"],
            deposit_settled_amount=receipt_context["deposit_settled_amount"],
            other_income_total=receipt_context["other_income_total"],
            other_income_lines=receipt_context["other_income_lines"],
            other_expense_total=receipt_context["other_expense_total"],
            other_expense_lines=receipt_context["other_expense_lines"],
        )
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
                "deposit_applied_sales": str(deposit_applied_sales),
                "void_sales": str(void_sales),
                "total_sales": str(total_sales.quantize(Decimal("0.01"))),
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
