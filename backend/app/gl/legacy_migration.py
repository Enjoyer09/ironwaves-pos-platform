"""Legacy finance ledger (finance_transactions / finance_ledger_entries) → GL v2.

Guarantees
----------
* Read-only on legacy tables. Nothing legacy is updated or deleted.
* Idempotent and resumable: each legacy transaction becomes exactly one GL
  journal keyed by ``legacy:<id>``; re-running only imports what is new.
* Chronological: journals are posted in the order the legacy ledger posted
  them, so gapless journal numbers follow real history.
* Faithful: every legacy line becomes a GL line with the same side and amount.
  Only the *account* is refined (e.g. legacy "expense" → 721.1 Əmək haqqı for
  category "Maaş"). Reversals are mapped with the *original's* classification
  so they net to zero on exactly the same GL accounts.
* Verified by an independent reconciliation (``reconcile_tenant``) that
  recomputes everything from the legacy tables with plain SQL.

Pending / rejected legacy transactions have no ledger effect and are *not*
imported; they are listed in the report for a human decision.
"""
from __future__ import annotations

import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.gl import engine as gl
from app.gl import reports
from app.gl.coa_az import LEGACY_CODE_TO_ROLE
from app.gl.engine import BUSINESS_TZ, ZERO, LineIn, MigrationMeta
from app.gl.models import GLAccount, GLJournal, GLJournalLine, GLLegacyLink
from app.models import FinanceAccount, FinanceEntry, FinanceLedgerEntry, FinanceTransaction

MIGRATION_ACTOR = "system:legacy-migration"
IMPORTED_STATUSES = ("posted", "reversed")
# Journals created directly in the GL (Finance v2 UI / tax engine); legacy never sees them.
GL_ONLY_SOURCE_MODULES = ("manual", "gl")

# Legacy codes that map 1:1 onto a single GL account (balance must match exactly).
ONE_TO_ONE_CODES = ("cash", "card", "safe", "payable", "deposit", "investor", "debt", "inventory_asset", "adjustment")
# Legacy P&L codes whose lines may be refined into several GL P&L accounts.
PNL_CODES = ("revenue", "expense", "cogs")

EXPENSE_CATEGORY_ROLES = {
    "maas": "payroll_expense",
    "emek haqqi": "payroll_expense",
    "kommunal": "utilities_expense",
    "icare": "rent_expense",
    "staff benefit": "staff_meals",
    "bank komissiyasi": "bank_fees",
    "xammal": "cogs",  # raw materials expensed on purchase = cost of sales
    "cerime": "penalties",
    "anbar itkisi": "inventory_writeoff",
}
OTHER_INCOME_CATEGORIES = {"diger giris", "borc alindi"}
# Categories that are economically not revenue; imported faithfully but flagged.
FLAGGED_INCOME_CATEGORIES = {"borc alindi": "Borc alınan vəsait gəlir kimi yazılıb (əslində öhdəlikdir)"}

JOURNAL_TYPE_BY_LEGACY = {
    "income": "sales",
    "cogs_recognition": "sales",
    "deposit_apply_to_bill": "sales",
    "expense": "cash",
    "internal_transfer": "cash",
    "investor_injection": "general",
    "investor_repayment": "cash",
    "deposit_hold": "cash",
    "deposit_release": "cash",
    "deposit_refund": "cash",
    "inventory_restock": "purchase",
    "supplier_payment": "purchase",
    "inventory_loss": "adjustment",
    "cash_adjustment": "adjustment",
    "reconciliation_adjustment": "adjustment",
    "reversal": "reversal",
}


def _norm(value: str | None) -> str:
    text = str(value or "").strip().lower()
    for src, dst in (("ə", "e"), ("ı", "i"), ("ö", "o"), ("ü", "u"), ("ç", "c"), ("ş", "s"), ("ğ", "g")):
        text = text.replace(src, dst)
    text = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in text if not unicodedata.combining(ch)).strip()


def map_role(code: str, txn_type: str, category: str | None) -> str:
    """Legacy account code (+ context) → GL system role."""
    code = str(code or "").strip().lower()
    if code == "revenue":
        return "other_income" if _norm(category) in OTHER_INCOME_CATEGORIES else "sales_revenue"
    if code == "expense":
        if txn_type == "inventory_loss":
            return "inventory_writeoff"
        return EXPENSE_CATEGORY_ROLES.get(_norm(category), "general_expense")
    role = LEGACY_CODE_TO_ROLE.get(code)
    if not role:
        raise gl.GLError(f"No GL mapping for legacy account code '{code}'", "unmapped_legacy_account")
    return role


def _business_date(ts: datetime | None) -> date:
    if ts is None:
        return gl.business_today()
    aware = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    return aware.astimezone(BUSINESS_TZ).date()


@dataclass
class TenantResult:
    tenant_id: str
    imported: int = 0
    skipped_existing: int = 0
    reversal_links: int = 0
    min_balances: dict = field(default_factory=dict)  # role -> (amount, date)
    flagged: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "tenant_id": self.tenant_id,
            "imported": self.imported,
            "skipped_existing": self.skipped_existing,
            "reversal_links": self.reversal_links,
            "lowest_balances": {k: {"amount": str(v[0]), "date": v[1].isoformat()} for k, v in self.min_balances.items()},
            "flagged": self.flagged,
        }


def _legacy_rows(db: Session, tenant_id: str, *, only_missing: bool = False, exclude_ids: set[str] | None = None):
    query = db.query(FinanceTransaction).filter(FinanceTransaction.tenant_id == tenant_id, FinanceTransaction.status.in_(IMPORTED_STATUSES))
    if exclude_ids:
        query = query.filter(~FinanceTransaction.id.in_(list(exclude_ids)))
    # Dual mode: legacy postings already replaced by a native journal must never be mirrored.
    covered = db.query(GLLegacyLink.id).filter(GLLegacyLink.tenant_id == tenant_id, GLLegacyLink.legacy_txn_id == FinanceTransaction.id)
    query = query.filter(~covered.exists())
    if only_missing:
        already = db.query(GLJournal.id).filter(GLJournal.tenant_id == tenant_id, GLJournal.legacy_ref == FinanceTransaction.id)
        query = query.filter(~already.exists())
    txns = query.order_by(
        func.coalesce(FinanceTransaction.posted_at, FinanceTransaction.created_at).asc(),
        FinanceTransaction.created_at.asc(),
        FinanceTransaction.id.asc(),
    ).all()
    code_by_account = {a.id: a.code for a in db.query(FinanceAccount).filter(FinanceAccount.tenant_id == tenant_id).all()}
    lines_by_txn: dict[str, list[FinanceLedgerEntry]] = defaultdict(list)
    line_query = db.query(FinanceLedgerEntry).filter(FinanceLedgerEntry.tenant_id == tenant_id)
    if only_missing:
        ids = [t.id for t in txns]
        if not ids:
            return txns, code_by_account, lines_by_txn
        line_query = line_query.filter(FinanceLedgerEntry.transaction_id.in_(ids))
    for line in line_query.order_by(FinanceLedgerEntry.created_at, FinanceLedgerEntry.id):
        lines_by_txn[line.transaction_id].append(line)
    return txns, code_by_account, lines_by_txn


def migrate_tenant(db: Session, tenant_id: str, *, batch_size: int = 500, commit: bool = True, incremental: bool = False,
                   exclude_ids: set[str] | None = None) -> TenantResult:
    """Import posted/reversed legacy transactions of one tenant. See module docstring.

    ``incremental=True`` (shadow mode) reads only legacy rows that are not in the
    GL yet, so a run with nothing new costs two small queries. Historic lowest
    balances are only computed in full mode.
    """
    gl.ensure_chart(db, tenant_id, actor=MIGRATION_ACTOR)
    result = TenantResult(tenant_id=tenant_id)
    txns, code_by_account, lines_by_txn = _legacy_rows(db, tenant_id, only_missing=incremental, exclude_ids=exclude_ids)
    if incremental and not txns:
        return result
    migrated: dict[str, str] = {
        ref: jid for ref, jid in db.query(GLJournal.legacy_ref, GLJournal.id).filter(
            GLJournal.tenant_id == tenant_id, GLJournal.legacy_ref.isnot(None)).all()
    }
    by_id = {t.id: t for t in txns}
    running: dict[str, Decimal] = defaultdict(lambda: ZERO)
    watched = {"cash_drawer", "safe", "bank_main"}
    pending_in_batch = 0

    for txn in txns:
        legacy_lines = lines_by_txn.get(txn.id, [])
        # Classification context: reversals use the original's type/category.
        ctx = txn
        if txn.transaction_type == "reversal":
            ctx = by_id.get(txn.reference) or db.query(FinanceTransaction).filter(FinanceTransaction.id == txn.reference).first()
            if ctx is None:
                raise gl.GLError(f"Reversal {txn.id} references unknown transaction {txn.reference}", "orphan_reversal")
        ctx_category = ctx.category

        lines: list[LineIn] = []
        for line in legacy_lines:
            role = map_role(code_by_account[line.account_id], ctx.transaction_type, ctx_category)
            amount = Decimal(str(line.amount))
            is_debit = line.entry_side == "debit"
            lines.append(LineIn(role, debit=amount if is_debit else ZERO, credit=ZERO if is_debit else amount))
            if role in watched and not incremental:
                running[role] += amount if is_debit else -amount
        posting_date = _business_date(txn.posted_at or (legacy_lines[0].created_at if legacy_lines else txn.created_at))
        for role in watched:
            if role in running and (role not in result.min_balances or running[role] < result.min_balances[role][0]):
                result.min_balances[role] = (running[role], posting_date)

        if txn.id in migrated:
            result.skipped_existing += 1
            continue
        if not legacy_lines:
            raise gl.GLError(f"Legacy transaction {txn.id} is {txn.status} but has no ledger lines", "legacy_without_lines")

        flag = FLAGGED_INCOME_CATEGORIES.get(_norm(ctx_category)) if ctx.transaction_type == "income" else None
        if flag and txn.transaction_type != "reversal":
            result.flagged.append({"legacy_id": txn.id, "date": posting_date.isoformat(), "amount": str(txn.amount), "reason": flag})

        reversal_of = None
        if txn.transaction_type == "reversal":
            reversal_of = migrated.get(txn.reference)
            if not reversal_of:
                original_covered = db.query(GLLegacyLink.id).filter(
                    GLLegacyLink.tenant_id == tenant_id, GLLegacyLink.legacy_txn_id == txn.reference).first()
                if not original_covered:
                    raise gl.GLError(f"Original of reversal {txn.id} was not migrated first", "reversal_order")
                # Dual mode fallback: the original lives in a native journal; mirror this
                # legacy reversal as a standalone correction (same wallet effect, no link).

        sale_id = txn.related_order_id
        journal = gl.create_journal(
            db,
            tenant_id=tenant_id,
            journal_type=("general" if txn.transaction_type == "income" and not sale_id
                          else JOURNAL_TYPE_BY_LEGACY.get(txn.transaction_type, "general")),
            lines=lines,
            created_by=MIGRATION_ACTOR,
            posting_date=posting_date,
            description=(txn.note or txn.category or txn.transaction_type or "")[:2000],
            source_module="legacy",
            source_type="sale" if sale_id else txn.transaction_type,
            source_id=sale_id or txn.id,
            idempotency_key=f"legacy:{txn.id}",
            legacy_ref=txn.id,
            reversal_of_id=reversal_of,
            migration=MigrationMeta(
                created_by=txn.created_by or "unknown",
                created_at=txn.created_at or datetime.utcnow(),
                posted_by=txn.posted_by,
                posted_at=txn.posted_at,
                approved_by=txn.approved_by,
                approved_at=txn.approved_at,
            ),
        )
        migrated[txn.id] = journal.id
        result.imported += 1
        if reversal_of:
            original = db.query(GLJournal).filter(GLJournal.id == reversal_of).one()
            if original.reversed_by_id is None:
                original.reversed_by_id = journal.id
                result.reversal_links += 1
        pending_in_batch += 1
        if commit and pending_in_batch >= batch_size:
            db.commit()
            pending_in_batch = 0
    db.flush()
    if commit:
        db.commit()
    return result


# ─────────────────────────────── reconciliation ─────────────────────────


def _legacy_net_by_code(db: Session, tenant_id: str) -> dict[str, Decimal]:
    rows = (
        db.query(
            FinanceAccount.code,
            func.coalesce(func.sum(FinanceLedgerEntry.amount).filter(FinanceLedgerEntry.entry_side == "debit"), 0),
            func.coalesce(func.sum(FinanceLedgerEntry.amount).filter(FinanceLedgerEntry.entry_side == "credit"), 0),
        )
        .join(FinanceAccount, FinanceAccount.id == FinanceLedgerEntry.account_id)
        .join(FinanceTransaction, FinanceTransaction.id == FinanceLedgerEntry.transaction_id)
        .filter(FinanceLedgerEntry.tenant_id == tenant_id, FinanceTransaction.status.in_(IMPORTED_STATUSES))
        .group_by(FinanceAccount.code)
        .all()
    )
    return {code: Decimal(str(d)) - Decimal(str(c)) for code, d, c in rows}


def _gl_net_by_account(db: Session, tenant_id: str) -> dict[str, Decimal]:
    rows = (
        db.query(GLJournalLine.account_id, func.coalesce(func.sum(GLJournalLine.debit), 0), func.coalesce(func.sum(GLJournalLine.credit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(GLJournalLine.tenant_id == tenant_id, GLJournal.status == "posted", GLJournal.legacy_ref.isnot(None))
        .group_by(GLJournalLine.account_id)
        .all()
    )
    return {acc: Decimal(str(d)) - Decimal(str(c)) for acc, d, c in rows}


def reconcile_tenant(db: Session, tenant_id: str) -> dict:
    """Independent verification of a tenant's migration. ``ok`` must be True before cut-over."""
    checks: list[dict] = []

    def check(name: str, legacy, gl_value, ok: bool | None = None):
        passed = (legacy == gl_value) if ok is None else ok
        checks.append({"check": name, "legacy": str(legacy), "gl": str(gl_value), "ok": bool(passed)})

    legacy_txn_count, legacy_debit_total = (
        db.query(func.count(func.distinct(FinanceTransaction.id)), func.coalesce(func.sum(FinanceLedgerEntry.amount), 0))
        .join(FinanceLedgerEntry, FinanceLedgerEntry.transaction_id == FinanceTransaction.id)
        .filter(FinanceTransaction.tenant_id == tenant_id, FinanceTransaction.status.in_(IMPORTED_STATUSES), FinanceLedgerEntry.entry_side == "debit")
        .one()
    )
    gl_count, gl_debit_total = (
        db.query(func.count(GLJournal.id), func.coalesce(func.sum(GLJournal.total_debit), 0))
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.status == "posted", GLJournal.legacy_ref.isnot(None))
        .one()
    )
    check("transaction_count", int(legacy_txn_count), int(gl_count))
    check("total_debit", Decimal(str(legacy_debit_total)), Decimal(str(gl_debit_total)))

    per_txn_mismatch = (
        db.query(func.count(FinanceTransaction.id))
        .join(GLJournal, (GLJournal.legacy_ref == FinanceTransaction.id) & (GLJournal.tenant_id == FinanceTransaction.tenant_id))
        .filter(FinanceTransaction.tenant_id == tenant_id, GLJournal.total_debit != FinanceTransaction.amount)
        .scalar()
    )
    check("per_transaction_amount_mismatches", 0, int(per_txn_mismatch))

    legacy_net = _legacy_net_by_code(db, tenant_id)
    gl_net = _gl_net_by_account(db, tenant_id)
    accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id).all()}
    by_role = {a.system_role: a for a in accounts.values() if a.system_role}
    for code in ONE_TO_ONE_CODES:
        account = by_role[LEGACY_CODE_TO_ROLE[code]]
        check(f"balance:{code}→{account.code}", legacy_net.get(code, ZERO).quantize(Decimal("0.01")), gl_net.get(account.id, ZERO).quantize(Decimal("0.01")))
    legacy_pnl = sum((legacy_net.get(c, ZERO) for c in PNL_CODES), ZERO).quantize(Decimal("0.01"))
    gl_pnl = sum((v for acc, v in gl_net.items() if accounts[acc].account_type in {"revenue", "expense"}), ZERO).quantize(Decimal("0.01"))
    check("profit_and_loss_net (revenue+expense+cogs)", legacy_pnl, gl_pnl)
    unexpected = sorted(accounts[a].code for a, v in gl_net.items() if v and accounts[a].account_type not in {"revenue", "expense"}
                        and accounts[a].system_role not in {LEGACY_CODE_TO_ROLE[c] for c in ONE_TO_ONE_CODES})
    check("no_unexpected_balance_sheet_accounts", "[]", str(unexpected), ok=not unexpected)

    legacy_reversed = db.query(func.count(FinanceTransaction.id)).filter(FinanceTransaction.tenant_id == tenant_id, FinanceTransaction.status == "reversed").scalar()
    gl_reversed = db.query(func.count(GLJournal.id)).filter(GLJournal.tenant_id == tenant_id, GLJournal.legacy_ref.isnot(None), GLJournal.reversed_by_id.isnot(None)).scalar()
    check("reversal_links", int(legacy_reversed), int(gl_reversed))

    tb = reports.trial_balance(db, tenant_id)
    check("trial_balance_balanced", True, tb["balanced"])
    check("materialized_balances_valid", True, reports.verify_materialized_balances(db, tenant_id)["valid"])
    check("audit_chain_valid", True, gl.verify_audit_chain(db, tenant_id)["valid"])
    bs = reports.balance_sheet(db, tenant_id, as_of=gl.business_today())
    check("balance_sheet_balanced", True, bs["balanced"])

    return {"tenant_id": tenant_id, "ok": all(c["ok"] for c in checks), "checks": checks}


def reconcile_dual_tenant(db: Session, tenant_id: str) -> dict:
    """Reconciliation for tenants in *dual* mode.

    Native journals intentionally differ from legacy (one compound journal per
    sale, card fees legacy forgot, VAT split ...), so 1:1 counts no longer apply.
    What must hold instead:

    * completeness — every posted legacy transaction is either mirrored (shadow)
      or covered by a native journal, never both;
    * money — every legacy wallet/balance-sheet account equals its GL account
      after adding the per-event differences recorded at posting time;
    * all generic GL integrity checks.
    """
    import json as _json

    from app.gl.bridge import WALLET_CODES

    checks: list[dict] = []

    def check(name: str, legacy, gl_value, ok: bool | None = None):
        passed = (legacy == gl_value) if ok is None else ok
        checks.append({"check": name, "legacy": str(legacy), "gl": str(gl_value), "ok": bool(passed)})

    legacy_ids = {tid for (tid,) in db.query(FinanceTransaction.id).filter(
        FinanceTransaction.tenant_id == tenant_id, FinanceTransaction.status.in_(IMPORTED_STATUSES)).all()}
    mirrored = {ref for (ref,) in db.query(GLJournal.legacy_ref).filter(
        GLJournal.tenant_id == tenant_id, GLJournal.legacy_ref.isnot(None)).all()}
    links = db.query(GLLegacyLink).filter(GLLegacyLink.tenant_id == tenant_id).all()
    covered = {link.legacy_txn_id for link in links}
    check("every_legacy_txn_accounted_for", len(legacy_ids), len(legacy_ids & (mirrored | covered)))
    check("no_txn_both_mirrored_and_covered", 0, len(mirrored & covered))

    diffs: dict[str, Decimal] = defaultdict(lambda: ZERO)
    explained: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(lambda: ZERO))
    for link in links:
        if link.wallet_diff:
            for code, amount in _json.loads(link.wallet_diff).items():
                diffs[code] += Decimal(amount)
                explained[link.event_type][code] += Decimal(amount)

    legacy_net = _legacy_net_by_code(db, tenant_id)
    by_role = {a.system_role: a for a in db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id, GLAccount.system_role.isnot(None)).all()}

    # GL-only journals (manual entries from the Finance v2 UI, tax accruals and their reversals) have no
    # legacy counterpart by design; their effect on wallet accounts is an explained difference.
    wallet_code_by_account = {by_role[LEGACY_CODE_TO_ROLE[code]].id: code for code in WALLET_CODES if LEGACY_CODE_TO_ROLE.get(code) in by_role}
    gl_only = (
        db.query(GLJournalLine.account_id, func.coalesce(func.sum(GLJournalLine.debit), 0), func.coalesce(func.sum(GLJournalLine.credit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(GLJournalLine.tenant_id == tenant_id, GLJournal.status == "posted", GLJournal.legacy_ref.is_(None),
                GLJournal.source_module.in_(GL_ONLY_SOURCE_MODULES), GLJournalLine.account_id.in_(list(wallet_code_by_account)))
        .group_by(GLJournalLine.account_id).all()
    )
    for account_id, d, c in gl_only:
        amount = Decimal(str(d)) - Decimal(str(c))
        if amount:
            code = wallet_code_by_account[account_id]
            diffs[code] += amount
            explained["GLOnlyJournal"][code] += amount
    gl_all = {
        acc: Decimal(str(d)) - Decimal(str(c))
        for acc, d, c in db.query(GLJournalLine.account_id, func.coalesce(func.sum(GLJournalLine.debit), 0), func.coalesce(func.sum(GLJournalLine.credit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(GLJournalLine.tenant_id == tenant_id, GLJournal.status == "posted")
        .group_by(GLJournalLine.account_id).all()
    }
    for code in WALLET_CODES:
        account = by_role[LEGACY_CODE_TO_ROLE[code]]
        expected = (legacy_net.get(code, ZERO) + diffs.get(code, ZERO)).quantize(Decimal("0.01"))
        check(f"balance:{code}→{account.code} (legacy + explained diff)", expected, gl_all.get(account.id, ZERO).quantize(Decimal("0.01")))

    check("trial_balance_balanced", True, reports.trial_balance(db, tenant_id)["balanced"])
    check("materialized_balances_valid", True, reports.verify_materialized_balances(db, tenant_id)["valid"])
    check("audit_chain_valid", True, gl.verify_audit_chain(db, tenant_id)["valid"])
    check("balance_sheet_balanced", True, reports.balance_sheet(db, tenant_id, as_of=gl.business_today())["balanced"])
    return {
        "tenant_id": tenant_id,
        "mode": "dual",
        "ok": all(c["ok"] for c in checks),
        "checks": checks,
        "native_journals": len({link.journal_id for link in links}),
        "explained_differences": {evt: {k: str(v) for k, v in codes.items() if v} for evt, codes in explained.items()},
    }


def open_items(db: Session, tenant_id: str) -> dict:
    """Things that were deliberately *not* migrated and need a human decision."""
    not_posted = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.tenant_id == tenant_id, ~FinanceTransaction.status.in_(IMPORTED_STATUSES))
        .order_by(FinanceTransaction.created_at)
        .all()
    )
    direct_wallet_rows = (
        db.query(FinanceEntry)
        .filter(FinanceEntry.tenant_id == tenant_id, ~func.coalesce(FinanceEntry.description, "").contains("Ledger mirror:"))
        .order_by(FinanceEntry.created_at)
        .all()
    )
    return {
        "unposted_legacy_transactions": [
            {"id": t.id, "status": t.status, "type": t.transaction_type, "amount": str(t.amount), "created_by": t.created_by,
             "created_at": t.created_at.isoformat() if t.created_at else None, "note": t.note}
            for t in not_posted
        ],
        "wallet_rows_without_ledger": [
            {"id": r.id, "type": r.type, "category": r.category, "source": r.source, "amount": str(r.amount),
             "created_at": r.created_at.isoformat() if r.created_at else None, "description": (r.description or "")[:120]}
            for r in direct_wallet_rows
        ],
    }
