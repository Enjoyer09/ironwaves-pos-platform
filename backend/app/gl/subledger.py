"""AP / AR sub-ledgers derived from the GL (P3 foundation).

Journal lines on control accounts carry ``partner_type`` / ``partner_id``
(e.g. StockReceived / SupplierPaid tag the supplier). Per partner we rebuild
open items with FIFO settlement: amounts that increase the balance open items
(bills for AP, invoices/loans for AR), amounts that decrease it settle the oldest
open items first. What remains is aged by posting date.

This is a *derived* view: the GL is the only source of truth, so the sub-ledger
always reconciles to its control accounts by construction (``reconciled``).
Explicit bill/invoice documents with due dates and matching are the next step
(see docs/handoff); aging is by posting date until then.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.gl import engine as gl
from app.gl.engine import ZERO, GLError
from app.gl.models import GLJournal, GLJournalLine

LEDGERS = {
    # ledger: (control account roles, sign: +1 when the balance is debit-positive)
    "ap": (("accounts_payable",), -1),
    "ar": (("accounts_receivable", "other_receivable"), 1),
}
BUCKETS = (("0_30", 0, 30), ("31_60", 31, 60), ("61_90", 61, 90), ("90_plus", 91, None))
CENT = Decimal("0.01")


@dataclass
class _Partner:
    partner_type: str | None
    partner_id: str | None
    open_items: list[list] = field(default_factory=list)  # [posting_date, remaining]
    advance: Decimal = ZERO  # settlements beyond what was open (overpayment / prepayment)


def _bucket(age_days: int) -> str:
    for name, low, high in BUCKETS:
        if age_days >= low and (high is None or age_days <= high):
            return name
    return BUCKETS[0][0]


def _partner_names(db: Session, tenant_id: str, keys: set[tuple[str | None, str | None]]) -> dict[tuple, str]:
    names: dict[tuple, str] = {}
    supplier_ids = [pid for ptype, pid in keys if ptype == "supplier" and pid]
    if supplier_ids:
        from app.models import Supplier

        for sid, name in db.query(Supplier.id, Supplier.name).filter(Supplier.tenant_id == tenant_id, Supplier.id.in_(supplier_ids)).all():
            names[("supplier", sid)] = name
    for ptype, pid in keys:
        if (ptype, pid) not in names and pid:
            names[(ptype, pid)] = pid  # employees / counterparties are stored by name
    return names


def subledger(db: Session, tenant_id: str, ledger: str, *, as_of: date | None = None) -> dict:
    if ledger not in LEDGERS:
        raise GLError(f"Unknown sub-ledger: {ledger}", "invalid_ledger", 404)
    as_of = as_of or gl.business_today()
    roles, sign = LEDGERS[ledger]
    by_role = gl.accounts_by_role(db, tenant_id)
    accounts = [by_role[r] for r in roles if r in by_role]
    account_ids = [a.id for a in accounts]

    rows = (
        db.query(GLJournal.posting_date, GLJournalLine.partner_type, GLJournalLine.partner_id, GLJournalLine.debit, GLJournalLine.credit)
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(GLJournalLine.tenant_id == tenant_id, GLJournal.status == "posted", GLJournal.posting_date <= as_of,
                GLJournalLine.account_id.in_(account_ids))
        .order_by(GLJournal.posting_date.asc(), GLJournal.created_at.asc(), GLJournalLine.line_no.asc())
        .all()
    )

    partners: dict[tuple, _Partner] = {}
    control = ZERO
    for posting_date, ptype, pid, debit, credit in rows:
        amount = (Decimal(str(debit)) - Decimal(str(credit))) * sign  # + increases what is owed
        control += amount
        key = (ptype if pid else None, pid or None)
        p = partners.setdefault(key, _Partner(*key))
        if amount > 0:
            # New open item; first absorb any advance the partner already has.
            use = min(p.advance, amount)
            p.advance -= use
            if amount - use > 0:
                p.open_items.append([posting_date, amount - use])
        elif amount < 0:
            settle = -amount
            while settle > 0 and p.open_items:
                item = p.open_items[0]
                take = min(item[1], settle)
                item[1] -= take
                settle -= take
                if item[1] == 0:
                    p.open_items.pop(0)
            p.advance += settle

    names = _partner_names(db, tenant_id, set(partners))
    totals = {name: ZERO for name, _, _ in BUCKETS}
    total_advance = ZERO
    out = []
    for key, p in partners.items():
        buckets = {name: ZERO for name, _, _ in BUCKETS}
        for posting_date, remaining in p.open_items:
            buckets[_bucket((as_of - posting_date).days)] += remaining
        open_total = sum(buckets.values(), ZERO)
        balance = open_total - p.advance
        if not balance and not open_total and not p.advance:
            continue
        for name in buckets:
            totals[name] += buckets[name]
        total_advance += p.advance
        out.append({
            "partner_type": p.partner_type,
            "partner_id": p.partner_id,
            "name": names.get(key) if p.partner_id else None,
            "balance": str(balance.quantize(CENT)),
            "open": str(open_total.quantize(CENT)),
            "advance": str(p.advance.quantize(CENT)),
            "buckets": {k: str(v.quantize(CENT)) for k, v in buckets.items()},
            "oldest_open_date": p.open_items[0][0].isoformat() if p.open_items else None,
        })
    out.sort(key=lambda r: (r["partner_id"] is None, -Decimal(r["balance"]), r["name"] or ""))
    partner_total = sum((Decimal(r["balance"]) for r in out), ZERO)
    return {
        "ledger": ledger,
        "as_of": as_of.isoformat(),
        "control_accounts": [{"id": a.id, "code": a.code, "name": a.name} for a in accounts],
        "control_balance": str(control.quantize(CENT)),
        "partners": out,
        "totals": {**{k: str(v.quantize(CENT)) for k, v in totals.items()}, "advance": str(total_advance.quantize(CENT)),
                   "balance": str(partner_total.quantize(CENT))},
        "unassigned_balance": next((r["balance"] for r in out if r["partner_id"] is None), "0.00"),
        "reconciled": partner_total.quantize(CENT) == control.quantize(CENT),
    }
