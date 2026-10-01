"""Finance v2 GL API — /api/v1/gl

Gated by ``settings.finance_v2_enabled`` or, per tenant, by dual ledger mode (404 otherwise). Nothing in the legacy
finance flows calls into this module yet; wiring happens in P1 (shadow mode).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.gl import engine, reports, tax
from app.gl.engine import GLError, LineIn
from app.gl.legacy_migration import GL_ONLY_SOURCE_MODULES
from app.gl.models import GLAccount, GLJournal, GLJournalLine
from app.models import Tenant
from app.services.finance_service import finance_policy

GL_READ_ROLES = {"admin", "super_admin", "finance_admin", "manager", "accountant", "auditor"}
GL_WRITE_ROLES = {"admin", "super_admin", "finance_admin", "manager", "accountant"}
GL_APPROVER_ROLES = {"admin", "super_admin", "finance_admin"}
GL_CONTROLLER_ROLES = {"admin", "super_admin", "finance_admin"}


def _tenant_enabled(db: Session, tenant_id: str) -> bool:
    """The API is on globally via the flag, or per tenant once it runs the GL natively (dual mode)."""
    if settings.finance_v2_enabled:
        return True
    from app.gl.bridge import get_ledger_mode

    try:
        return get_ledger_mode(db, tenant_id) == "dual"
    except Exception:
        return False


def _enabled(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> None:
    if not _tenant_enabled(db, tenant.id):
        raise HTTPException(status_code=404, detail="Not Found")


# Router-level dependency runs before auth, so a disabled API is indistinguishable from a missing one.
router = APIRouter(prefix="/api/v1/gl", tags=["finance-v2"], dependencies=[Depends(_enabled)])


def _role(user) -> str:
    return str(getattr(user, "role", "") or "").strip().lower()


def _require(user, roles: set[str]) -> None:
    if _role(user) not in roles:
        raise HTTPException(status_code=403, detail="Insufficient finance permissions")


def _run(db: Session, fn):
    """Execute a write, commit on success, rollback and map GLError otherwise."""
    try:
        result = fn()
        db.commit()
        return result
    except GLError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})
    except Exception:
        db.rollback()
        raise


def _read(fn):
    try:
        return fn()
    except GLError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message})


# ─────────────────────────────── serializers ────────────────────────────


def _account_out(a: GLAccount) -> dict:
    return {
        "id": a.id, "code": a.code, "name": a.name, "parent_id": a.parent_id, "account_class": a.account_class,
        "account_type": a.account_type, "normal_side": a.normal_side, "is_postable": a.is_postable,
        "system_role": a.system_role, "allow_negative": a.allow_negative, "is_system": a.is_system, "is_active": a.is_active,
    }


def _journal_out(db: Session, j: GLJournal, with_lines: bool = False) -> dict:
    out = {
        "id": j.id, "journal_no": j.journal_no, "journal_type": j.journal_type, "status": j.status,
        "posting_date": j.posting_date.isoformat(), "description": j.description, "total": str(j.total_debit),
        "currency": j.currency, "branch_id": j.branch_id, "source_module": j.source_module, "source_type": j.source_type,
        "source_id": j.source_id, "reversal_of_id": j.reversal_of_id, "reversed_by_id": j.reversed_by_id,
        "created_by": j.created_by, "created_at": j.created_at.isoformat() if j.created_at else None,
        "approved_by": j.approved_by, "posted_by": j.posted_by, "posted_at": j.posted_at.isoformat() if j.posted_at else None,
        "rejected_by": j.rejected_by, "reject_reason": j.reject_reason,
    }
    if with_lines:
        accounts = {a.id: a for a in db.query(GLAccount).filter(GLAccount.tenant_id == j.tenant_id).all()}
        out["lines"] = [
            {"line_no": l.line_no, "account_id": l.account_id, "account_code": accounts[l.account_id].code,
             "account_name": accounts[l.account_id].name, "debit": str(l.debit), "credit": str(l.credit), "memo": l.memo,
             "partner_type": l.partner_type, "partner_id": l.partner_id, "tax_code": l.tax_code, "branch_id": l.branch_id}
            for l in db.query(GLJournalLine).filter(GLJournalLine.journal_id == j.id).order_by(GLJournalLine.line_no).all()
        ]
    return out


# ─────────────────────────────── schemas ────────────────────────────────


class SubaccountIn(BaseModel):
    parent_code: str = Field(min_length=1, max_length=20)
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=160)
    allow_negative: bool = True


class JournalLineIn(BaseModel):
    account: str = Field(min_length=1, max_length=64, description="account code, id or system role")
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")
    memo: str | None = Field(default=None, max_length=1000)
    partner_type: str | None = Field(default=None, max_length=24)
    partner_id: str | None = Field(default=None, max_length=64)
    branch_id: str | None = Field(default=None, max_length=36)


class JournalIn(BaseModel):
    journal_type: str = "general"
    posting_date: date | None = None
    description: str = Field(min_length=1, max_length=2000)
    lines: list[JournalLineIn] = Field(min_length=2, max_length=200)
    idempotency_key: str | None = Field(default=None, max_length=120)
    branch_id: str | None = Field(default=None, max_length=36)


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


class ReverseIn(ReasonIn):
    posting_date: date | None = None


class PeriodStatusIn(BaseModel):
    status: str = Field(pattern="^(open|soft_closed|closed)$")
    reason: str | None = Field(default=None, max_length=2000)


class TaxProfileIn(BaseModel):
    regime: str = Field(pattern="^(simplified|vat|exempt)$")
    effective_from: date
    simplified_rate: Decimal | None = None
    vat_rate: Decimal | None = None
    prices_include_vat: bool = True
    note: str | None = Field(default=None, max_length=1000)


class AccrueIn(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)


class CreateBillIn(BaseModel):
    partner_id: str = Field(min_length=1, max_length=64)
    number: str = Field(min_length=1, max_length=64)
    issue_date: date
    due_date: date
    total: Decimal = Field(gt=Decimal("0"))
    expense_account: str | None = None
    note: str | None = Field(default=None, max_length=1000)
    branch_id: str | None = Field(default=None, max_length=36)


class PayBillIn(BaseModel):
    # Money arrives as strings (decimal-safe) or numbers; documents.pay_bill validates it with engine.money.
    amount: Decimal = Field(gt=Decimal("0"))
    paid_from: str = Field(pattern="^(cash_drawer|bank_main|safe)$")
    posting_date: date | None = None
    bank_fee: Decimal = Decimal("0")
    note: str | None = Field(default=None, max_length=1000)
    # One key per payment dialog: retries and double clicks replay the original payment.
    idempotency_key: str = Field(min_length=8, max_length=80, pattern="^[A-Za-z0-9:_-]+$")


class ReclassifyAPIn(BaseModel):
    amount: Decimal = Field(gt=Decimal("0"))
    to_supplier_id: str = Field(min_length=1, max_length=64)
    reason: str = Field(default="Təchizatçı təyini", max_length=500)
    posting_date: date | None = None


# ─────────────────────────────── chart ──────────────────────────────────


@router.get("/capabilities")
def capabilities(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """What the UI may show for this tenant/user. Reaching this endpoint at all means the API is enabled."""
    _require(user, GL_READ_ROLES)
    from app.gl.bridge import get_ledger_mode
    from app.gl.read_model import reports_source

    role = _role(user)
    chart_ready = db.query(GLAccount.id).filter(GLAccount.tenant_id == tenant.id).first() is not None
    return {
        "enabled": True,
        "ledger_mode": get_ledger_mode(db, tenant.id),
        "reports_source": reports_source(db, tenant.id),
        "chart_ready": chart_ready,
        "role": role,
        "can_read": role in GL_READ_ROLES,
        "can_write": role in GL_WRITE_ROLES,
        "can_approve": role in GL_APPROVER_ROLES,
        "can_control": role in GL_CONTROLLER_ROLES,
        "can_audit": role in (GL_CONTROLLER_ROLES | {"auditor"}),
        "business_today": engine.business_today().isoformat(),
    }


@router.post("/setup")
def setup_chart(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_CONTROLLER_ROLES)
    accounts = _run(db, lambda: engine.ensure_chart(db, tenant.id, actor=user.username))
    return {"success": True, "accounts": len(accounts)}


@router.get("/accounts")
def list_accounts(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_READ_ROLES)
    rows = db.query(GLAccount).filter(GLAccount.tenant_id == tenant.id).order_by(GLAccount.code).all()
    return [_account_out(a) for a in rows]


@router.post("/accounts")
def create_account(payload: SubaccountIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_CONTROLLER_ROLES)
    account = _run(db, lambda: engine.create_subaccount(
        db, tenant.id, parent_code=payload.parent_code, code=payload.code, name=payload.name,
        actor=user.username, allow_negative=payload.allow_negative,
    ))
    return _account_out(account)


# ─────────────────────────────── journals ───────────────────────────────


def _manual_needs_approval(db: Session, tenant_id: str, user, total: Decimal) -> bool:
    if _role(user) not in GL_APPROVER_ROLES:
        return True
    threshold = Decimal(str(finance_policy(db, tenant_id).get("large_transfer_threshold_azn", 500)))
    return total >= threshold


@router.post("/journals")
def create_manual_journal(payload: JournalIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_WRITE_ROLES)
    if payload.journal_type not in {"general", "adjustment", "cash", "bank", "opening"}:
        raise HTTPException(status_code=400, detail={"code": "invalid_journal_type", "message": "Manual journals must be general/adjustment/cash/bank/opening"})

    def work():
        total = sum((Decimal(str(l.debit)) for l in payload.lines), Decimal("0"))
        journal = engine.create_journal(
            db,
            tenant_id=tenant.id,
            journal_type=payload.journal_type,
            lines=[LineIn(account=l.account, debit=l.debit, credit=l.credit, memo=l.memo, partner_type=l.partner_type,
                          partner_id=l.partner_id, branch_id=l.branch_id) for l in payload.lines],
            created_by=user.username,
            posting_date=payload.posting_date,
            description=payload.description,
            source_module="manual",
            idempotency_key=f"manual:{payload.idempotency_key}" if payload.idempotency_key else None,
            branch_id=payload.branch_id,
            require_approval=_manual_needs_approval(db, tenant.id, user, total),
            allow_soft_closed=_role(user) in GL_CONTROLLER_ROLES,
        )
        return _journal_out(db, journal, with_lines=True)

    return _run(db, work)


@router.get("/journals")
def list_journals(
    status: str | None = None,
    journal_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user),
):
    _require(user, GL_READ_ROLES)
    query = db.query(GLJournal).filter(GLJournal.tenant_id == tenant.id)
    if status:
        query = query.filter(GLJournal.status == status)
    if journal_type:
        query = query.filter(GLJournal.journal_type == journal_type)
    if date_from:
        query = query.filter(GLJournal.posting_date >= date_from)
    if date_to:
        query = query.filter(GLJournal.posting_date <= date_to)
    total = query.count()
    rows = query.order_by(GLJournal.posting_date.desc(), GLJournal.created_at.desc()).offset(offset).limit(limit).all()
    return {"total": total, "limit": limit, "offset": offset, "items": [_journal_out(db, j) for j in rows]}


@router.get("/journals/{journal_id}")
def get_journal(journal_id: str, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_READ_ROLES)
    journal = db.query(GLJournal).filter(GLJournal.tenant_id == tenant.id, GLJournal.id == journal_id).first()
    if not journal:
        raise HTTPException(status_code=404, detail="Journal not found")
    return _journal_out(db, journal, with_lines=True)


@router.post("/journals/{journal_id}/approve")
def approve(journal_id: str, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_APPROVER_ROLES)
    from app.gl import documents

    def work():
        documents.lock_documents_for_journal(db, tenant.id, journal_id)  # same lock order as pay/void
        journal = engine.approve_journal(db, tenant.id, journal_id, approver=user.username, allow_soft_closed=True)
        # Same transaction: if the document side cannot follow (e.g. bill already settled), the approval rolls back.
        documents.after_journal_approved(db, tenant.id, journal)
        return journal

    journal = _run(db, work)
    return _journal_out(db, journal)


@router.post("/journals/{journal_id}/reject")
def reject(journal_id: str, payload: ReasonIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_APPROVER_ROLES)
    from app.gl import documents

    def work():
        documents.lock_documents_for_journal(db, tenant.id, journal_id)
        journal = engine.reject_journal(db, tenant.id, journal_id, actor=user.username, reason=payload.reason)
        documents.after_journal_rejected(db, tenant.id, journal)
        return journal

    journal = _run(db, work)
    return _journal_out(db, journal)


@router.post("/journals/{journal_id}/reverse")
def reverse(journal_id: str, payload: ReverseIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_WRITE_ROLES)
    from app.gl.documents import DOCUMENT_SOURCE_TYPES

    original = db.query(GLJournal).filter(GLJournal.tenant_id == tenant.id, GLJournal.id == journal_id).first()
    if original is not None:
        # Bill and bill-payment journals belong to the document: a bare storno would leave the bill open.
        if original.source_type in DOCUMENT_SOURCE_TYPES:
            raise HTTPException(status_code=409, detail={
                "code": "document_managed",
                "message": "This journal belongs to an AP bill. Void the bill or reverse the payment in Bills instead.",
            })
        # Operational journals (sales, stock, shifts, mirrored legacy) are owned by their source module:
        # reversing them here would leave the sale/legacy ledger untouched and the books out of sync.
        if original.source_type == engine.YEAR_CLOSE_SOURCE:
            raise HTTPException(status_code=409, detail={"code": "use_year_reopen", "message": "Reopen the fiscal year instead of reversing its closing journal"})
        if original.legacy_ref or (original.source_module not in GL_ONLY_SOURCE_MODULES):
            raise HTTPException(status_code=409, detail={
                "code": "source_managed",
                "message": "This journal comes from an operation (sale, stock, shift...). Correct it in that module (void/refund/adjustment) or post an adjusting journal.",
            })
    journal = _run(db, lambda: engine.reverse_journal(
        db, tenant.id, journal_id, actor=user.username, reason=payload.reason, posting_date=payload.posting_date,
        # Reversals always go through a second person.
        require_approval=True,
    ))
    return _journal_out(db, journal)


# ─────────────────────────────── periods ────────────────────────────────


@router.get("/periods")
def list_periods(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_READ_ROLES)
    return reports.periods_overview(db, tenant.id)


@router.post("/periods/{year}/{month}/status")
def change_period_status(year: int, month: int, payload: PeriodStatusIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_CONTROLLER_ROLES)
    if not (2000 <= year <= 2100 and 1 <= month <= 12):
        raise HTTPException(status_code=400, detail="Invalid period")
    period = _run(db, lambda: engine.set_period_status(db, tenant.id, year=year, month=month, status=payload.status, actor=user.username, reason=payload.reason))
    return {"year": period.year, "month": period.month, "status": period.status}


# ─────────────────────────────── sub-ledgers ────────────────────────────


@router.get("/subledger/{ledger}")
def partner_subledger(ledger: str, as_of: date | None = None,
                      db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """AP / AR per partner with FIFO aging (0-30 / 31-60 / 61-90 / 90+ days)."""
    _require(user, GL_READ_ROLES)
    from app.gl.subledger import subledger

    return _read(lambda: subledger(db, tenant.id, ledger, as_of=as_of))


# ─────────────────────────────── fiscal year ────────────────────────────


@router.get("/years/{year}")
def fiscal_year_status(year: int, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_READ_ROLES)
    from app.gl.year_end import year_status

    return _read(lambda: year_status(db, tenant.id, year))


@router.post("/years/{year}/close")
def close_year(year: int, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_CONTROLLER_ROLES)
    from app.gl.year_end import close_fiscal_year

    journal = _run(db, lambda: close_fiscal_year(db, tenant.id, year, actor=user.username))
    return _journal_out(db, journal, with_lines=True)


@router.post("/years/{year}/reopen")
def reopen_year(year: int, payload: ReasonIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """Requests the storno of the closing journal; another approver must approve it."""
    _require(user, GL_CONTROLLER_ROLES)
    from app.gl.year_end import request_reopen_fiscal_year

    journal = _run(db, lambda: request_reopen_fiscal_year(db, tenant.id, year, actor=user.username, reason=payload.reason))
    return _journal_out(db, journal)


# ─────────────────────────────── tax ────────────────────────────────────


@router.get("/tax-profile")
def get_tax(on: date | None = None, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_READ_ROLES)
    return tax.get_tax_profile(db, tenant.id, on or engine.business_today()).as_dict()


@router.post("/tax-profile")
def set_tax(payload: TaxProfileIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_CONTROLLER_ROLES)
    _run(db, lambda: tax.set_tax_profile(
        db, tenant.id, regime=payload.regime, effective_from=payload.effective_from, actor=user.username,
        simplified_rate=payload.simplified_rate, vat_rate=payload.vat_rate, prices_include_vat=payload.prices_include_vat, note=payload.note,
    ))
    return tax.get_tax_profile(db, tenant.id, payload.effective_from).as_dict()


@router.post("/tax/simplified/accrue")
def accrue_tax(payload: AccrueIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_CONTROLLER_ROLES)
    return _run(db, lambda: tax.accrue_simplified_tax(db, tenant.id, year=payload.year, month=payload.month, actor=user.username))


@router.get("/tax/summary")
def tax_summary(year: int, month: int, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_READ_ROLES)
    return _read(lambda: tax.tax_summary(db, tenant.id, year=year, month=month))


# ─────────────────────────────── reports ────────────────────────────────


@router.get("/reports/trial-balance")
def trial_balance(date_from: date | None = None, date_to: date | None = None, branch_id: str | None = None,
                  db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_READ_ROLES)
    return _read(lambda: reports.trial_balance(db, tenant.id, date_from=date_from, date_to=date_to, branch_id=branch_id))


@router.get("/reports/balance-sheet")
def balance_sheet(as_of: date | None = None, branch_id: str | None = None,
                  db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_READ_ROLES)
    return _read(lambda: reports.balance_sheet(db, tenant.id, as_of=as_of or engine.business_today(), branch_id=branch_id))


@router.get("/reports/profit-loss")
def profit_loss(date_from: date, date_to: date, branch_id: str | None = None,
                db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_READ_ROLES)
    return _read(lambda: reports.profit_and_loss(db, tenant.id, date_from=date_from, date_to=date_to, branch_id=branch_id))


@router.get("/reports/account-ledger/{account_id}")
def account_ledger(account_id: str, date_from: date | None = None, date_to: date | None = None,
                   limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0),
                   db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    _require(user, GL_READ_ROLES)
    return _read(lambda: reports.account_ledger(db, tenant.id, account_id, date_from=date_from, date_to=date_to, limit=limit, offset=offset))


@router.get("/shadow/status")
def shadow_status(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """Shadow-mode evidence for cut-over: recent sync batches and nightly reconciliations."""
    _require(user, GL_CONTROLLER_ROLES | {"auditor"})
    from app.gl.shadow import shadow_status as _status

    return _status(db, tenant.id)


@router.get("/integrity")
def integrity(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """Audit-chain and materialized-balance verification (for auditors / nightly checks)."""
    _require(user, GL_CONTROLLER_ROLES | {"auditor"})
    return {
        "audit_chain": engine.verify_audit_chain(db, tenant.id),
        "balances": reports.verify_materialized_balances(db, tenant.id),
        "trial_balance_balanced": reports.trial_balance(db, tenant.id)["balanced"],
    }


# ─────────────────────────────── documents (bills & invoices) ───────────


@router.get("/suppliers")
def list_suppliers(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """Supplier picker for bills/reclass ([{id, name}]); readable by every GL reader (ops API is admin/manager only)."""
    _require(user, GL_READ_ROLES)
    from app.models import Supplier

    rows = db.query(Supplier.id, Supplier.name).filter(Supplier.tenant_id == tenant.id).order_by(Supplier.name.asc(), Supplier.id.asc()).all()
    return [{"id": sid, "name": name} for sid, name in rows]


@router.get("/documents")
def list_documents(kind: str = Query("ap_bill", pattern="^ap_bill$"), status: str | None = None, partner_id: str | None = None,
                   due_before: date | None = None, due_after: date | None = None, overdue_only: bool = False,
                   search: str | None = Query(None, max_length=100),
                   limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                   db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """List AP bills (AR invoices are deferred) with open balances, aging and a summary over all pages."""
    _require(user, GL_READ_ROLES)
    from app.gl import documents

    return _read(lambda: documents.list_documents(
        db, tenant.id, kind=kind, status=status, partner_id=partner_id,
        due_before=due_before, due_after=due_after, overdue_only=overdue_only, search=search, limit=limit, offset=offset
    ))


@router.post("/documents/bills")
def create_bill(payload: CreateBillIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """Create an AP bill (StockReceived / ExpensePaid on credit).

    Non-approvers and totals >= the large-transfer threshold need a second person: the bill stays
    ``pending_approval`` until its journal is approved (``rejected`` if rejected).
    """
    _require(user, GL_WRITE_ROLES)
    from app.gl import documents

    doc = _run(db, lambda: documents.create_bill(
        db, tenant.id, partner_id=payload.partner_id, number=payload.number,
        issue_date=payload.issue_date, due_date=payload.due_date, total=payload.total,
        expense_account=payload.expense_account, note=payload.note, branch_id=payload.branch_id, actor=user.username,
        require_approval=_manual_needs_approval(db, tenant.id, user, payload.total),
    ))
    return documents.get_document_detail(db, tenant.id, doc.id)


@router.get("/documents/{document_id}")
def get_document(document_id: str, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """Get document detail with payment allocations."""
    _require(user, GL_READ_ROLES)
    from app.gl import documents

    return _read(lambda: documents.get_document_detail(db, tenant.id, document_id))


@router.post("/documents/{document_id}/pay")
def pay_bill(document_id: str, payload: PayBillIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """Pay an open bill from a wallet (GL-only payment journal, idempotent per key, overpayment → 409).

    Non-approvers and amounts >= the large-transfer threshold need a second person: the journal stays
    pending and is allocated when approved.
    """
    _require(user, GL_WRITE_ROLES)
    from app.gl import documents

    return _run(db, lambda: documents.pay_bill(
        db, tenant.id, document_id, amount=payload.amount, paid_from=payload.paid_from,
        posting_date=payload.posting_date, bank_fee=payload.bank_fee, actor=user.username, note=payload.note,
        idempotency_key=payload.idempotency_key,
        require_approval=_manual_needs_approval(db, tenant.id, user, payload.amount),
    ))


@router.post("/documents/{document_id}/void")
def void_document(document_id: str, payload: ReasonIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """Request the void of an open bill: its storno waits for a second person (``pending_void_journal_id``).

    Only allowed when no payments are allocated (net) or pending; the bill becomes void on approval.
    """
    _require(user, GL_WRITE_ROLES)
    from app.gl import documents

    doc = _run(db, lambda: documents.void_document(db, tenant.id, document_id, actor=user.username, reason=payload.reason))
    return documents.get_document_detail(db, tenant.id, doc.id)


@router.post("/documents/{document_id}/payments/{journal_id}/reverse")
def reverse_bill_payment(document_id: str, journal_id: str, payload: ReasonIn, db: Session = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """Request the reversal of a posted bill payment (storno pending a second person); on approval the
    allocation is cancelled by a negative row and the bill is open again."""
    _require(user, GL_WRITE_ROLES)
    from app.gl import documents

    return _run(db, lambda: documents.reverse_bill_payment(
        db, tenant.id, document_id, journal_id, actor=user.username, reason=payload.reason,
    ))


@router.post("/documents/reclassify-unassigned")
def reclassify_unassigned(payload: ReclassifyAPIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    """Request the reclassification of unassigned AP (partner_id=NULL) to a supplier.

    Capped at the available unassigned balance; always pending owner approval by a second person.
    """
    _require(user, GL_CONTROLLER_ROLES)
    from app.gl import documents

    return _run(db, lambda: documents.reclassify_unassigned_ap(
        db, tenant.id, amount=payload.amount, to_supplier_id=payload.to_supplier_id,
        actor=user.username, reason=payload.reason, posting_date=payload.posting_date
    ))

