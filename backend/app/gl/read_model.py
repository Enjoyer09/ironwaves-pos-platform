"""Finance v2 read model (P2c): serve existing finance screens from the GL.

Per-tenant ``finance_v2_reports_source`` (Setting): ``legacy`` (default) or ``gl``.
``gl`` is only allowed for tenants in ``dual`` ledger mode, so the GL contains
both native and mirrored postings and is complete.

The switch is made at the lowest layer (``finance_service.ledger_balances_snapshot``
and ``shift_cash_breakdown_from_ledger``), so every consumer — balances, summary,
anomalies, X/Z/handover expected cash, day opening, Z deposit checks — changes
source together and can never show two different numbers. Response shapes are
the legacy ones: the frontend does not change.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.gl import engine as gl
from app.gl import reports as gl_reports
from app.gl.coa_az import LEGACY_CODE_TO_ROLE
from app.gl.models import GLAccount, GLAccountBalance, GLJournal, GLJournalLine
from app.models import Setting

SOURCE_SETTING_KEY = "finance_v2_reports_source"
REPORT_SOURCES = ("legacy", "gl")
CENT = Decimal("0.01")
ZERO = Decimal("0.00")
CASH_LIKE_ROLES = ("cash_drawer", "bank_main", "safe")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ─────────────────────────────── setting ────────────────────────────────


def reports_source(db: Session, tenant_id: str) -> str:
    if not hasattr(db, "query"):
        return "legacy"
    try:
        row = db.query(Setting.value).filter(Setting.tenant_id == tenant_id, Setting.key == SOURCE_SETTING_KEY).first()
    except Exception:
        return "legacy"
    if not row or not row[0]:
        return "legacy"
    try:
        source = str(json.loads(row[0]).get("source") or "legacy")
    except Exception:
        return "legacy"
    return source if source in REPORT_SOURCES else "legacy"


def set_reports_source(db: Session, tenant_id: str, source: str, *, actor: str, reason: str) -> dict:
    from app.gl.bridge import get_ledger_mode

    if source not in REPORT_SOURCES:
        raise gl.GLError(f"Unknown reports source: {source}", "invalid_source")
    if not str(reason or "").strip():
        raise gl.GLError("A reason is required", "reason_required")
    if source == "gl" and get_ledger_mode(db, tenant_id) != "dual":
        raise gl.GLError("Reports can only be served from the GL for tenants in dual mode", "requires_dual_mode", 409)
    previous = reports_source(db, tenant_id)
    value = json.dumps({"source": source, "since": _utcnow().isoformat(), "by": actor})
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == SOURCE_SETTING_KEY).first()
    if row:
        row.value = value
    else:
        db.add(Setting(tenant_id=tenant_id, key=SOURCE_SETTING_KEY, value=value))
    gl.append_audit(db, tenant_id, event_type="REPORTS_SOURCE_CHANGED", entity_type="tenant", entity_id=tenant_id, actor=actor,
                    payload={"from": previous, "to": source, "reason": reason})
    db.flush()
    return {"tenant_id": tenant_id, "from": previous, "to": source}


# ─────────────────────────────── catch-up ───────────────────────────────


def catch_up(db: Session, tenant_id: str) -> int:
    """Mirror, inside the current transaction, any committed legacy posting the
    shadow job has not imported yet, so a GL read never lags the legacy ledger.

    Legacy postings made *by the current request* (still pending for a native
    journal) are excluded: they will be covered by ``bridge.emit`` or mirrored
    later — never both. Cheap when there is nothing new (two small queries).
    Never raises.
    """
    from app.gl.bridge import PENDING_KEY
    from app.gl.legacy_migration import migrate_tenant

    info = getattr(db, "info", None)
    pending = set(info.get(PENDING_KEY) or []) if isinstance(info, dict) else set()
    try:
        with db.begin_nested():
            return migrate_tenant(db, tenant_id, commit=False, incremental=True, exclude_ids=pending).imported
    except Exception:
        import logging

        logging.getLogger("ironwaves.gl_read_model").exception("gl read-model catch-up failed tenant=%s", tenant_id)
        return 0


# ─────────────────────────────── balances ───────────────────────────────


def gl_wallet_balances(db: Session, tenant_id: str, *, sync: bool = True) -> dict[str, Decimal]:
    """Balances keyed by *legacy* wallet codes, signed like the legacy snapshot
    (assets debit-positive, liabilities credit-positive). From materialized balances."""
    if sync:
        catch_up(db, tenant_id)
    rows = (
        db.query(GLAccount.system_role, GLAccount.account_type, GLAccount.normal_side,
                 func.coalesce(func.sum(GLAccountBalance.debit_total), 0), func.coalesce(func.sum(GLAccountBalance.credit_total), 0))
        .outerjoin(GLAccountBalance, (GLAccountBalance.account_id == GLAccount.id) & (GLAccountBalance.tenant_id == GLAccount.tenant_id))
        .filter(GLAccount.tenant_id == tenant_id)
        .group_by(GLAccount.id, GLAccount.system_role, GLAccount.account_type, GLAccount.normal_side)
        .all()
    )
    by_role: dict[str, Decimal] = {}
    revenue = expense = ZERO
    for role, account_type, normal_side, debit, credit in rows:
        d, c = Decimal(str(debit)), Decimal(str(credit))
        if role:
            by_role[role] = d - c if normal_side == "debit" else c - d
        if account_type == "revenue":
            revenue += c - d
        elif account_type == "expense" and role != "cogs":
            expense += d - c
    out: dict[str, Decimal] = {}
    for code, role in LEGACY_CODE_TO_ROLE.items():
        out[code] = by_role.get(role, ZERO)
    # Legacy "adjustment" is debit-normal; GL suspense (538.9) is a credit-normal liability.
    out["adjustment"] = -by_role.get("suspense", ZERO)
    out["revenue"] = revenue
    out["expense"] = expense
    return {code: amount.quantize(CENT) for code, amount in out.items()}


def gl_shift_cash_breakdown(db: Session, tenant_id: str, shift, *, lock_for_update: bool = False, until: datetime | None = None) -> dict[str, Decimal]:
    """Expected drawer cash for a shift from the GL, same shape as the legacy breakdown.

    Movements are journals posted on the drawer account from ``shift.opened_at``
    (by posting time, like the legacy version) up to ``until`` (default: now).
    """
    if not shift:
        return {"opening_cash": ZERO, "cash_in": ZERO, "cash_out": ZERO, "expected_cash": ZERO}
    catch_up(db, tenant_id)
    cash = db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id, GLAccount.system_role == "cash_drawer")
    cash = (cash.with_for_update() if lock_for_update else cash).one()  # serialize with drawer postings
    query = (
        db.query(func.coalesce(func.sum(GLJournalLine.debit), 0), func.coalesce(func.sum(GLJournalLine.credit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(GLJournalLine.tenant_id == tenant_id, GLJournalLine.account_id == cash.id, GLJournal.status == "posted")
    )
    if shift.opened_at:
        query = query.filter(GLJournal.posted_at >= shift.opened_at)
    if until:
        query = query.filter(GLJournal.posted_at <= until)
    debit, credit = query.one()
    opening = Decimal(str(shift.opening_cash or 0)).quantize(CENT)
    cash_in, cash_out = Decimal(str(debit)).quantize(CENT), Decimal(str(credit)).quantize(CENT)
    return {"opening_cash": opening, "cash_in": cash_in, "cash_out": cash_out, "expected_cash": (opening + cash_in - cash_out).quantize(CENT)}


# ─────────────────────────────── overview (legacy shape) ────────────────


def _s(value: Decimal) -> str:
    return str(Decimal(value).quantize(CENT))


def gl_balance_sheet(db: Session, tenant_id: str, *, as_of: date | None = None) -> dict:
    as_of = as_of or gl.business_today()
    bs = gl_reports.balance_sheet(db, tenant_id, as_of=as_of)
    wallets = gl_wallet_balances(db, tenant_id, sync=False) if as_of >= gl.business_today() else None
    by_role_amount: dict[str, Decimal] = defaultdict(lambda: ZERO)
    accounts = {a.code: a for a in db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id).all()}
    for section in ("assets", "liabilities"):
        for line in bs[section]["lines"]:
            account = accounts.get(line["code"])
            by_role_amount[(account.system_role if account else None) or line["code"]] += Decimal(line["amount"])
    assets_total, liab_total, equity_total = Decimal(bs["assets"]["total"]), Decimal(bs["liabilities"]["total"]), Decimal(bs["equity"]["total"])
    known_assets = {"cash_drawer", "bank_main", "safe", "other_receivable", "accounts_receivable", "inventory", "merchandise"}
    known_liab = {"customer_deposits", "investor_loan", "accounts_payable"}
    return {
        "source": "gl",
        "as_of": as_of.isoformat(),
        "assets": {
            "cash": _s(by_role_amount["cash_drawer"]),
            "bank_card": _s(by_role_amount["bank_main"]),
            "safe": _s(by_role_amount["safe"]),
            "receivables": _s(by_role_amount["other_receivable"] + by_role_amount["accounts_receivable"]),
            "inventory": _s(by_role_amount["inventory"] + by_role_amount["merchandise"]),
            "other": _s(assets_total - sum((by_role_amount[r] for r in known_assets), ZERO)),
            "total": _s(assets_total),
        },
        "liabilities": {
            "deposits": _s(by_role_amount["customer_deposits"]),
            "investor": _s(by_role_amount["investor_loan"]),
            "payables": _s(by_role_amount["accounts_payable"]),
            "other": _s(liab_total - sum((by_role_amount[r] for r in known_liab), ZERO)),
            "total": _s(liab_total),
        },
        "equity": {
            "estimated_equity": _s(assets_total - liab_total),
            "ledger_equity": _s(equity_total),
            "equity_account_codes": [line["code"] for line in bs["equity"]["lines"]],
            "accounting_residual": bs["difference"],
            "note": "Mənbə: yeni baş kitab (GL). Balans double-entry invariantından gəlir.",
        },
        "balanced": bs["balanced"],
        "wallets_check": {k: _s(v) for k, v in (wallets or {}).items() if k in {"cash", "card", "safe"}},
    }


def gl_profit_loss(db: Session, tenant_id: str, date_from: date | None, date_to: date | None) -> dict:
    date_to = date_to or gl.business_today()
    date_from = date_from or date(2000, 1, 1)
    pl = gl_reports.profit_and_loss(db, tenant_id, date_from=date_from, date_to=date_to)
    from app.models import Sale  # sales count stays operational data

    start = datetime.combine(date_from, datetime.min.time())
    end = datetime.combine(date_to, datetime.max.time())
    sales_count = db.query(func.count(Sale.id)).filter(Sale.tenant_id == tenant_id, Sale.created_at >= start, Sale.created_at <= end).scalar() or 0
    operating = Decimal(pl["operating_expenses"]["total"]) + Decimal(pl["finance_costs"]["total"]) + Decimal(pl["taxes"]["total"]) - Decimal(pl["other_income"]["total"])
    expense_count = (
        db.query(func.count(func.distinct(GLJournal.id)))
        .join(GLJournalLine, GLJournalLine.journal_id == GLJournal.id)
        .join(GLAccount, GLAccount.id == GLJournalLine.account_id)
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.status == "posted", GLJournal.posting_date >= date_from,
                GLJournal.posting_date <= date_to, GLAccount.account_type == "expense", GLAccount.system_role != "cogs")
        .scalar() or 0
    )
    return {
        "source": "gl",
        "revenue": pl["revenue"]["total"],
        "cogs": pl["cogs"]["total"],
        "cogs_recorded": pl["cogs"]["total"],
        "cogs_estimated": "0.00",
        "cogs_estimated_sales_count": 0,
        "gross_profit": pl["gross_profit"],
        "operating_expenses": _s(operating),
        "net_profit": pl["net_profit"],
        "sales_count": int(sales_count),
        "expense_count": int(expense_count),
        "has_uncomputed_cogs": False,
        "cogs_uncomputed_sales_count": 0,
        "cogs_uncomputed_revenue": "0.00",
        "cogs_unresolved_sales_count": 0,
        "cogs_coverage_percent": "100.00",
        "cogs_note": "Mənbə: yeni baş kitab (GL). Maya dəyəri satış anında yazılır, təxmin tətbiq olunmur.",
        "lines": {group: pl[group] for group in ("revenue", "cogs", "operating_expenses", "other_income", "finance_costs", "taxes")},
    }


_FINANCING_SOURCES = {"financing", "investor_injection", "investor_repayment"}
_DEPOSIT_SOURCES = {"deposit", "deposit_hold", "deposit_refund", "deposit_release"}
_ADJUSTMENT_SOURCES = {"cash_adjustment", "reconciliation_adjustment", "shift"}


def gl_cash_flow(db: Session, tenant_id: str, date_from: date | None, date_to: date | None) -> dict:
    """Direct-method cash flow over drawer + bank + safe. Transfers between them net to zero."""
    cash_ids = [a.id for a in db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id, GLAccount.system_role.in_(CASH_LIKE_ROLES)).all()]
    query = (
        db.query(GLJournal.id, GLJournal.source_type, GLJournal.journal_type,
                 func.sum(GLJournalLine.debit) - func.sum(GLJournalLine.credit))
        .join(GLJournalLine, GLJournalLine.journal_id == GLJournal.id)
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.status == "posted", GLJournalLine.account_id.in_(cash_ids))
        .group_by(GLJournal.id, GLJournal.source_type, GLJournal.journal_type)
    )
    if date_from:
        query = query.filter(GLJournal.posting_date >= date_from)
    if date_to:
        query = query.filter(GLJournal.posting_date <= date_to)
    buckets = {k: [ZERO, ZERO] for k in ("operating", "financing", "deposit", "adjustment")}
    count = 0
    for _jid, source_type, journal_type, net in query.all():
        net = Decimal(str(net or 0))
        count += 1
        if net == 0:
            continue  # internal transfer between cash-like accounts
        src = str(source_type or "")
        if src in _FINANCING_SOURCES:
            key = "financing"
        elif src in _DEPOSIT_SOURCES:
            key = "deposit"
        elif src in _ADJUSTMENT_SOURCES or journal_type == "adjustment":
            key = "adjustment"
        else:
            key = "operating"
        buckets[key][0 if net > 0 else 1] += abs(net)
    net_total = sum((b[0] - b[1] for b in buckets.values()), ZERO)
    return {
        "source": "gl",
        "operating_inflow": _s(buckets["operating"][0]),
        "operating_outflow": _s(buckets["operating"][1]),
        "financing_inflow": _s(buckets["financing"][0]),
        "financing_outflow": _s(buckets["financing"][1]),
        "deposit_inflow": _s(buckets["deposit"][0]),
        "deposit_outflow": _s(buckets["deposit"][1]),
        "adjustment_net": _s(buckets["adjustment"][0] - buckets["adjustment"][1]),
        "net_cash_flow": _s(net_total),
        "transaction_count": count,
    }


# ─────────────────────────────── parity ─────────────────────────────────


def parity_report(db: Session, tenant_id: str, *, shifts: int = 10) -> dict:
    """Legacy vs GL numbers for everything this read model serves.

    Differences are expected only where dual mode recorded an explained
    difference (e.g. card fees legacy forgot); ``unexplained`` must be empty
    before switching the reports source.
    """
    from app.gl.bridge import get_ledger_mode
    from app.models import Shift
    from app.services.finance_service import _legacy_ledger_balances_snapshot, _legacy_shift_cash_breakdown
    from app.gl.models import GLLegacyLink

    diffs: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for (raw,) in db.query(GLLegacyLink.wallet_diff).filter(GLLegacyLink.tenant_id == tenant_id, GLLegacyLink.wallet_diff.isnot(None)).all():
        for code, amount in json.loads(raw).items():
            diffs[code] += Decimal(amount)

    legacy = _legacy_ledger_balances_snapshot(db, tenant_id)
    glb = gl_wallet_balances(db, tenant_id)  # includes catch-up of unmirrored legacy postings
    balance_rows, unexplained = [], []
    for code in ("cash", "card", "safe", "deposit", "investor", "payable", "debt", "inventory_asset"):
        leg, g = legacy.get(code, ZERO), glb.get(code, ZERO)
        # Diffs are debit-positive; liabilities are shown credit-positive.
        explained = diffs.get(code, ZERO) * (-1 if code in {"deposit", "investor", "payable"} else 1)
        ok = (leg + explained).quantize(CENT) == g
        balance_rows.append({"code": code, "legacy": _s(leg), "gl": _s(g), "explained_diff": _s(explained), "ok": ok})
        if not ok:
            unexplained.append(f"balance:{code}")

    shift_rows = []
    for shift in db.query(Shift).filter(Shift.tenant_id == tenant_id).order_by(Shift.opened_at.desc()).limit(shifts).all():
        until = shift.closed_at
        leg = _legacy_shift_cash_breakdown(db, tenant_id, shift, until=until)
        g = gl_shift_cash_breakdown(db, tenant_id, shift, until=until)
        shift_rows.append({"shift_id": shift.id, "status": shift.status, "opened_at": shift.opened_at.isoformat() if shift.opened_at else None,
                           "legacy_expected": _s(leg["expected_cash"]), "gl_expected": _s(g["expected_cash"]),
                           "diff": _s(g["expected_cash"] - leg["expected_cash"])})

    return {
        "tenant_id": tenant_id,
        "ledger_mode": get_ledger_mode(db, tenant_id),
        "reports_source": reports_source(db, tenant_id),
        "balances": balance_rows,
        "shifts": shift_rows,
        "unexplained": unexplained,
        "ok": not unexplained,
    }
