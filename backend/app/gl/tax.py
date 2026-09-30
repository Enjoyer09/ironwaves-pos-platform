"""Tenant tax regimes for Finance v2.

Supported regimes (chosen per tenant, effective from the 1st day of a month):
- ``simplified``: tax on gross receipts at a tenant-configured rate (e.g. 2%, 5%).
  Not deducted from the sale price; accrued monthly as an expense
  (Dr 731.3 Sadələşdirilmiş vergi xərci / Cr 521.2 öhdəlik).
- ``vat``: VAT is split out of each sale (Dr cash / Cr 601.1 net / Cr 521.1 VAT);
  input VAT on purchases goes to 241.
- ``exempt``: no tax effect.

Rates are configuration, not code: the accountant confirms them per tenant.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.gl.engine import (
    GLError,
    LineIn,
    ZERO,
    accounts_by_role,
    append_audit,
    create_journal,
    get_or_create_period,
    money,
    round_money,
)
from app.gl.models import GLAccount, GLFiscalPeriod, GLJournal, GLJournalLine, GLTaxProfile, TAX_REGIMES


@dataclass(frozen=True)
class TaxSettings:
    regime: str
    simplified_rate: Decimal
    vat_rate: Decimal
    prices_include_vat: bool
    effective_from: date | None
    configured: bool

    def as_dict(self) -> dict:
        return {
            "regime": self.regime,
            "simplified_rate": str(self.simplified_rate),
            "vat_rate": str(self.vat_rate),
            "prices_include_vat": self.prices_include_vat,
            "effective_from": self.effective_from.isoformat() if self.effective_from else None,
            "configured": self.configured,
        }


UNCONFIGURED = TaxSettings("exempt", ZERO, ZERO, True, None, False)


def get_tax_profile(db: Session, tenant_id: str, on_date: date) -> TaxSettings:
    row = (
        db.query(GLTaxProfile)
        .filter(GLTaxProfile.tenant_id == tenant_id, GLTaxProfile.effective_from <= on_date)
        .order_by(GLTaxProfile.effective_from.desc())
        .first()
    )
    if not row:
        return UNCONFIGURED
    return TaxSettings(
        regime=row.regime,
        simplified_rate=Decimal(str(row.simplified_rate)),
        vat_rate=Decimal(str(row.vat_rate)),
        prices_include_vat=bool(row.prices_include_vat),
        effective_from=row.effective_from,
        configured=True,
    )


def _rate(value, label: str) -> Decimal:
    try:
        rate = Decimal(str(value if value is not None else "0").replace(",", "."))
    except Exception as exc:
        raise GLError(f"Invalid {label}", "invalid_rate") from exc
    if not rate.is_finite() or rate < 0 or rate > 100 or rate != rate.quantize(Decimal("0.01")):
        raise GLError(f"{label} must be between 0 and 100 with at most 2 decimals", "invalid_rate")
    return rate.quantize(Decimal("0.01"))


def set_tax_profile(
    db: Session,
    tenant_id: str,
    *,
    regime: str,
    effective_from: date,
    actor: str,
    simplified_rate=None,
    vat_rate=None,
    prices_include_vat: bool = True,
    note: str | None = None,
) -> GLTaxProfile:
    regime = str(regime or "").strip().lower()
    if regime not in TAX_REGIMES:
        raise GLError(f"Unknown tax regime: {regime}", "invalid_regime")
    if effective_from.day != 1:
        raise GLError("A tax regime change must start on the first day of a month", "invalid_effective_date")
    s_rate = _rate(simplified_rate, "simplified_rate") if regime == "simplified" else Decimal("0.00")
    v_rate = _rate(vat_rate, "vat_rate") if regime == "vat" else Decimal("0.00")
    if regime == "simplified" and s_rate <= 0:
        raise GLError("simplified_rate must be > 0 for the simplified regime", "invalid_rate")
    if regime == "vat" and v_rate <= 0:
        raise GLError("vat_rate must be > 0 for the VAT regime", "invalid_rate")

    period = get_or_create_period(db, tenant_id, effective_from)
    if period.status != "open":
        raise GLError("Tax regime cannot change for a closed or soft-closed period", "period_closed", 409)
    # Changing the regime of a month that already has posted journals would make
    # those journals inconsistent with the regime; only future/empty months.
    later_posted = (
        db.query(func.count(GLJournal.id))
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.status == "posted", GLJournal.posting_date >= effective_from)
        .scalar()
    )
    if later_posted:
        raise GLError(
            "There are posted journals on or after this date; choose the first day of a future month",
            "regime_change_after_postings",
            409,
        )

    row = db.query(GLTaxProfile).filter(GLTaxProfile.tenant_id == tenant_id, GLTaxProfile.effective_from == effective_from).first()
    before = None
    if row:
        before = {"regime": row.regime, "simplified_rate": str(row.simplified_rate), "vat_rate": str(row.vat_rate)}
    else:
        row = GLTaxProfile(tenant_id=tenant_id, effective_from=effective_from, created_by=actor)
        db.add(row)
    row.regime = regime
    row.simplified_rate = s_rate
    row.vat_rate = v_rate
    row.prices_include_vat = bool(prices_include_vat)
    row.note = (note or "")[:1000] or None
    db.flush()
    append_audit(
        db, tenant_id, event_type="TAX_PROFILE_SET", entity_type="tax_profile", entity_id=row.id, actor=actor,
        payload={"before": before, "after": {"regime": regime, "simplified_rate": str(s_rate), "vat_rate": str(v_rate),
                 "prices_include_vat": bool(prices_include_vat), "effective_from": effective_from.isoformat()}},
    )
    return row


def split_vat(gross, rate: Decimal, *, inclusive: bool = True) -> tuple[Decimal, Decimal]:
    """Return (net, vat). With inclusive prices VAT is extracted: vat = gross * r / (100 + r)."""
    gross = money(gross)
    rate = Decimal(str(rate))
    if rate <= 0:
        return gross, ZERO
    if inclusive:
        vat = round_money(gross * rate / (Decimal("100") + rate))
        return gross - vat, vat
    vat = round_money(gross * rate / Decimal("100"))
    return gross, vat


def _period_revenue_base(db: Session, tenant_id: str, period: GLFiscalPeriod) -> Decimal:
    """Net credit turnover on revenue accounts (incl. contra 602) in the period, from posted journals."""
    credit, debit = (
        db.query(func.coalesce(func.sum(GLJournalLine.credit), 0), func.coalesce(func.sum(GLJournalLine.debit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .join(GLAccount, GLAccount.id == GLJournalLine.account_id)
        .filter(
            GLJournalLine.tenant_id == tenant_id,
            GLJournal.status == "posted",
            GLJournal.period_id == period.id,
            GLAccount.account_type == "revenue",
        )
        .one()
    )
    return (Decimal(str(credit or 0)) - Decimal(str(debit or 0))).quantize(Decimal("0.01"))


def _already_accrued(db: Session, tenant_id: str, period: GLFiscalPeriod, payable: GLAccount) -> Decimal:
    credit, debit = (
        db.query(func.coalesce(func.sum(GLJournalLine.credit), 0), func.coalesce(func.sum(GLJournalLine.debit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(
            GLJournalLine.tenant_id == tenant_id,
            GLJournalLine.account_id == payable.id,
            GLJournal.status == "posted",
            GLJournal.source_type == "simplified_tax",
            GLJournal.source_id == period.id,
        )
        .one()
    )
    return (Decimal(str(credit or 0)) - Decimal(str(debit or 0))).quantize(Decimal("0.01"))


def accrue_simplified_tax(db: Session, tenant_id: str, *, year: int, month: int, actor: str) -> dict:
    """Accrue (or true-up) the simplified tax for a month. Safe to run repeatedly:
    it posts only the delta between the computed tax and what is already accrued."""
    period = get_or_create_period(db, tenant_id, date(year, month, 1))
    profile = get_tax_profile(db, tenant_id, period.start_date)
    if profile.regime != "simplified":
        raise GLError("Tenant is not on the simplified tax regime for this period", "regime_mismatch", 409)
    roles = accounts_by_role(db, tenant_id)
    payable = roles["simplified_tax_payable"]
    base = _period_revenue_base(db, tenant_id, period)
    due = round_money(max(base, ZERO) * profile.simplified_rate / Decimal("100"))
    accrued = _already_accrued(db, tenant_id, period, payable)
    delta = due - accrued
    result = {"period": f"{year}-{month:02d}", "base": str(base), "rate": str(profile.simplified_rate),
              "tax_due": str(due), "previously_accrued": str(accrued), "posted_delta": str(delta), "journal_id": None}
    if delta == 0:
        return result
    expense, liability = ("simplified_tax_expense", "simplified_tax_payable")
    lines = (
        [LineIn(expense, debit=delta), LineIn(liability, credit=delta)]
        if delta > 0
        else [LineIn(liability, debit=-delta), LineIn(expense, credit=-delta)]
    )
    journal = create_journal(
        db,
        tenant_id=tenant_id,
        journal_type="tax",
        lines=lines,
        created_by=actor,
        posting_date=period.end_date,
        description=f"Sadələşdirilmiş vergi {year}-{month:02d}: baza {base} × {profile.simplified_rate}%",
        source_module="gl",
        source_type="simplified_tax",
        source_id=period.id,
        idempotency_key=f"tax:simplified:{period.id}:{due}",
        allow_soft_closed=True,
    )
    result["journal_id"] = journal.id
    return result


def tax_summary(db: Session, tenant_id: str, *, year: int, month: int) -> dict:
    period = get_or_create_period(db, tenant_id, date(year, month, 1))
    profile = get_tax_profile(db, tenant_id, period.start_date)
    roles = accounts_by_role(db, tenant_id)

    def turnover(account: GLAccount) -> tuple[Decimal, Decimal]:
        d, c = (
            db.query(func.coalesce(func.sum(GLJournalLine.debit), 0), func.coalesce(func.sum(GLJournalLine.credit), 0))
            .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
            .filter(GLJournalLine.account_id == account.id, GLJournal.status == "posted", GLJournal.period_id == period.id)
            .one()
        )
        return Decimal(str(d or 0)), Decimal(str(c or 0))

    out: dict = {"period": f"{year}-{month:02d}", "profile": profile.as_dict()}
    if profile.regime == "simplified":
        base = _period_revenue_base(db, tenant_id, period)
        due = round_money(max(base, ZERO) * profile.simplified_rate / Decimal("100"))
        accrued = _already_accrued(db, tenant_id, period, roles["simplified_tax_payable"])
        out.update({"base": str(base), "tax_due": str(due), "accrued": str(accrued), "up_to_date": due == accrued})
    elif profile.regime == "vat":
        od, oc = turnover(roles["vat_output"])
        idr, icr = turnover(roles["vat_input"])
        output_vat, input_vat = oc - od, idr - icr
        out.update({"output_vat": str(output_vat), "input_vat": str(input_vat), "vat_payable": str(output_vat - input_vat)})
    return out
