"""Business documents (AP bills, AR invoices) and payment allocations (P3b).

Builds on top of the General Ledger:
- An AP bill posts a double-entry compound journal (debit expense/inventory, credit 531 accounts_payable).
- Payment journals allocate to documents (FIFO or explicitly).
- Invariant: sum(open document balances per partner) == partner subledger balance (excluding advances).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.gl import engine as gl
from app.gl.engine import GLError, LineIn
from app.gl.models import (
    DOCUMENT_KINDS,
    DOCUMENT_STATUSES,
    GLAccount,
    GLDocument,
    GLDocumentAllocation,
    GLJournal,
    GLJournalLine,
)
from app.gl.posting_rules import SupplierPaid, post_event

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
DOCUMENT_PAYMENT_SOURCE = "document_payment"
# Documents that can still receive payments.
PAYABLE_STATUSES = ("open", "partially_paid")


def _uuid() -> str:
    return str(uuid.uuid4())


def _net_allocated(db: Session, tenant_id: str, document_id: str) -> Decimal:
    """Net settled amount (allocations are append-only; corrections are negative rows)."""
    allocated = (
        db.query(func.coalesce(func.sum(GLDocumentAllocation.amount), 0))
        .filter(GLDocumentAllocation.tenant_id == tenant_id, GLDocumentAllocation.document_id == document_id)
        .scalar()
    )
    return Decimal(str(allocated)).quantize(CENT)


def get_document_open_balance(db: Session, tenant_id: str, document_id: str) -> Decimal:
    """Compute remaining unpaid balance: total - sum(allocations)."""
    doc = db.query(GLDocument).filter(GLDocument.tenant_id == tenant_id, GLDocument.id == document_id).first()
    if not doc:
        raise GLError(f"Document {document_id} not found", "not_found", 404)
    if doc.status == "void":
        return ZERO

    open_bal = (Decimal(str(doc.total)) - _net_allocated(db, tenant_id, document_id)).quantize(CENT)
    return max(ZERO, open_bal)


def _lock_document(db: Session, tenant_id: str, document_id: str) -> GLDocument:
    """Row-lock the document (no-op on SQLite) and re-read it, so checks see the committed state."""
    doc = (
        db.query(GLDocument)
        .filter(GLDocument.tenant_id == tenant_id, GLDocument.id == document_id)
        .with_for_update()
        .populate_existing()
        .first()
    )
    if not doc:
        raise GLError(f"Document {document_id} not found", "not_found", 404)
    return doc


def _refresh_status(db: Session, tenant_id: str, doc: GLDocument) -> None:
    """Recompute open/partially_paid/paid from the NET allocations (void stays void)."""
    if doc.status not in PAYABLE_STATUSES + ("paid",):
        return
    net = _net_allocated(db, tenant_id, doc.id)
    if net <= ZERO:
        doc.status = "open"
    elif net >= Decimal(str(doc.total)):
        doc.status = "paid"
    else:
        doc.status = "partially_paid"


def _ap_debit_line(db: Session, tenant_id: str, journal: GLJournal) -> GLJournalLine | None:
    """The accounts-payable debit line of a payment journal (found by account, never by position)."""
    ap = gl.accounts_by_role(db, tenant_id).get("accounts_payable")
    if not ap:
        return None
    return (
        db.query(GLJournalLine)
        .filter(GLJournalLine.journal_id == journal.id, GLJournalLine.account_id == ap.id, GLJournalLine.debit > 0)
        .order_by(GLJournalLine.line_no.asc())
        .first()
    )


def _pending_payments(db: Session, tenant_id: str, document_id: str) -> Decimal:
    """AP amount of bill payments for this document still waiting for approval (reserved, not yet allocated)."""
    ap = gl.accounts_by_role(db, tenant_id).get("accounts_payable")
    if not ap:
        return ZERO
    pending = (
        db.query(func.coalesce(func.sum(GLJournalLine.debit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(
            GLJournal.tenant_id == tenant_id,
            GLJournal.status == "pending_approval",
            GLJournal.source_type == DOCUMENT_PAYMENT_SOURCE,
            GLJournal.source_id == document_id,
            GLJournal.reversal_of_id.is_(None),
            GLJournalLine.account_id == ap.id,
        )
        .scalar()
    )
    return Decimal(str(pending)).quantize(CENT)


def _available_to_pay(db: Session, tenant_id: str, doc: GLDocument) -> tuple[Decimal, Decimal]:
    """(open balance minus pending payments, pending payments) for a locked document."""
    if doc.status not in PAYABLE_STATUSES:
        return ZERO, ZERO
    open_bal = max(ZERO, (Decimal(str(doc.total)) - _net_allocated(db, tenant_id, doc.id)).quantize(CENT))
    pending = _pending_payments(db, tenant_id, doc.id)
    return max(ZERO, open_bal - pending), pending


def create_bill(
    db: Session,
    tenant_id: str,
    *,
    partner_id: str,
    number: str,
    issue_date: date,
    due_date: date,
    total: Decimal | str,
    expense_account: str | None = None,
    partner_type: str = "supplier",
    currency: str = "AZN",
    note: str | None = None,
    branch_id: str | None = None,
    actor: str = "system",
) -> GLDocument:
    """Create an AP bill, posting its double-entry journal and creating the document."""
    if not str(partner_id or "").strip():
        raise GLError("Supplier is required for a bill", "partner_required", 400)
    num = str(number or "").strip()
    if not num:
        raise GLError("Bill number is required", "number_required", 400)
    if due_date < issue_date:
        raise GLError("Due date cannot be earlier than issue date", "invalid_due_date", 400)

    amount = Decimal(str(total or 0)).quantize(CENT)
    if amount <= ZERO:
        raise GLError("Bill total must be greater than zero", "invalid_amount", 400)

    # Check uniqueness
    existing = (
        db.query(GLDocument)
        .filter(
            GLDocument.tenant_id == tenant_id,
            GLDocument.kind == "ap_bill",
            GLDocument.partner_id == partner_id,
            GLDocument.number == num,
        )
        .first()
    )
    if existing:
        raise GLError(f"Bill '{num}' already exists for this supplier", "duplicate_bill", 409)

    # Resolve debit account (inventory by default, or specific expense account)
    by_role = gl.accounts_by_role(db, tenant_id)
    debit_target = expense_account or "inventory"
    debit_acc = by_role.get(debit_target)
    if not debit_acc:
        # Try finding by code
        debit_acc = db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id, GLAccount.code == debit_target).first()
    if not debit_acc:
        raise GLError(f"Debit account '{debit_target}' not found in chart", "account_not_found", 400)

    credit_acc = by_role.get("accounts_payable")
    if not credit_acc:
        raise GLError("Accounts payable account (531) not found in chart", "ap_account_not_found", 500)

    memo_text = f"Faktura {num}: {note or ''}".strip()
    lines = [
        LineIn(account=debit_acc.id, debit=amount, credit=ZERO, memo=memo_text, branch_id=branch_id),
        LineIn(
            account=credit_acc.id,
            debit=ZERO,
            credit=amount,
            memo=memo_text,
            partner_type=partner_type,
            partner_id=partner_id,
            branch_id=branch_id,
        ),
    ]

    journal = gl.create_journal(
        db,
        tenant_id=tenant_id,
        journal_type="purchase",
        posting_date=issue_date,
        description=f"Alış fakturası: {num}",
        lines=lines,
        created_by=actor,
        source_module="gl",
        source_type="document",
        source_id=f"bill:{num}",
        branch_id=branch_id,
    )

    doc = GLDocument(
        id=_uuid(),
        tenant_id=tenant_id,
        kind="ap_bill",
        partner_type=partner_type,
        partner_id=partner_id,
        number=num,
        issue_date=issue_date,
        due_date=due_date,
        currency=currency,
        total=amount,
        status="open",
        journal_id=journal.id,
        created_by=actor,
        note=note,
    )
    db.add(doc)
    db.flush()
    return doc


def allocate_payment(
    db: Session,
    tenant_id: str,
    *,
    payment_journal_id: str,
    journal_line_no: int,
    partner_id: str,
    amount: Decimal | str,
    document_ids: list[str] | None = None,
    kind: str = "ap_bill",
) -> list[GLDocumentAllocation]:
    """Allocate a payment journal line against a partner's open documents.

    Named ``document_ids`` are settled first (in the given order), then the remainder goes FIFO by
    due_date, issue_date, created_at. Whatever is left stays an unallocated advance on the partner.
    Candidate documents are row-locked in id order, and payments still pending approval keep
    their reservation on a document.
    """
    rem = gl.money(amount)
    if rem <= ZERO:
        return []

    db.flush()  # populate_existing below must not discard pending changes
    docs = (
        db.query(GLDocument)
        .filter(
            GLDocument.tenant_id == tenant_id,
            GLDocument.kind == kind,
            GLDocument.partner_id == partner_id,
            GLDocument.status.in_(PAYABLE_STATUSES),
        )
        .order_by(GLDocument.id.asc())
        .with_for_update()
        .populate_existing()
        .all()
    )
    by_id = {d.id: d for d in docs}
    named: list[GLDocument] = []
    for did in document_ids or ():
        if did in by_id and by_id[did] not in named:
            named.append(by_id[did])
    rest = sorted((d for d in docs if d not in named), key=lambda d: (d.due_date, d.issue_date, d.created_at or datetime.min))

    allocations: list[GLDocumentAllocation] = []
    for doc in named + rest:
        if rem <= ZERO:
            break
        available, _ = _available_to_pay(db, tenant_id, doc)
        if available <= ZERO:
            continue
        take = min(rem, available)
        alloc = GLDocumentAllocation(
            id=_uuid(),
            tenant_id=tenant_id,
            document_id=doc.id,
            journal_id=payment_journal_id,
            journal_line_no=journal_line_no,
            amount=take,
        )
        db.add(alloc)
        db.flush()
        allocations.append(alloc)
        rem -= take
        _refresh_status(db, tenant_id, doc)

    db.flush()
    return allocations


def _allocate_journal(db: Session, tenant_id: str, journal: GLJournal, *, partner_id: str,
                      document_ids: tuple[str, ...] | list[str] = ()) -> list[GLDocumentAllocation]:
    """Allocate a posted payment journal's AP debit line once (replay-safe)."""
    if db.query(GLDocumentAllocation.id).filter(GLDocumentAllocation.tenant_id == tenant_id,
                                                GLDocumentAllocation.journal_id == journal.id).first():
        return []
    line = _ap_debit_line(db, tenant_id, journal)
    if line is None:
        return []
    return allocate_payment(
        db,
        tenant_id,
        payment_journal_id=journal.id,
        journal_line_no=line.line_no,
        partner_id=line.partner_id or partner_id,
        amount=Decimal(str(line.debit)),
        document_ids=list(document_ids),
    )


def post_supplier_payment(
    db: Session,
    tenant_id: str,
    event: SupplierPaid,
    *,
    actor: str,
    source_module: str = "pos",
    source_type: str | None = None,
    source_id: str | None = None,
    require_approval: bool = False,
) -> GLJournal:
    """Post a SupplierPaid event and, once posted, allocate it to the supplier's bills
    (``event.document_ids`` first, then FIFO; any excess stays an advance).

    Used by ``pay_bill`` (GL-only document payment) and by the legacy supplier payment
    (``source_module="pos"``, linked to its legacy transaction by the bridge). A pending
    journal is allocated by ``after_journal_approved``. Never commits.
    """
    key = f"supplier_payment:{event.payment_id}"
    existed = db.query(GLJournal.id).filter(GLJournal.tenant_id == tenant_id, GLJournal.idempotency_key == key).first() is not None
    journal = post_event(db, tenant_id, event, actor=actor, require_approval=require_approval,
                         source_module=source_module, source_type=source_type, source_id=source_id)
    if journal.status == "posted" and not existed:
        _allocate_journal(db, tenant_id, journal, partner_id=event.supplier_id, document_ids=event.document_ids)
    return journal


def _payment_result(db: Session, tenant_id: str, doc: GLDocument, journal: GLJournal, *, replayed: bool) -> dict:
    line = _ap_debit_line(db, tenant_id, journal)
    allocations_count = (
        db.query(GLDocumentAllocation)
        .filter(GLDocumentAllocation.tenant_id == tenant_id, GLDocumentAllocation.document_id == doc.id,
                GLDocumentAllocation.journal_id == journal.id)
        .count()
    )
    return {
        "document_id": doc.id,
        "number": doc.number,
        "status": doc.status,
        "paid_amount": str(Decimal(str(line.debit)).quantize(CENT)) if line else "0.00",
        "remaining_open": str(get_document_open_balance(db, tenant_id, doc.id)),
        "journal_no": journal.journal_no,
        "journal_id": journal.id,
        "journal_status": journal.status,
        "allocations_count": allocations_count,
        "replayed": replayed,
    }


def _overpayment(amount: Decimal, available: Decimal, pending: Decimal, number: str) -> GLError:
    message = (f"Payment {amount} ₼ exceeds the open balance {available} ₼ of bill {number}; "
               f"pay at most {available} ₼ (overpayments are not accepted for bills)")
    if pending > ZERO:
        message += f". {pending} ₼ is already reserved by payments awaiting approval"
    return GLError(message, "overpayment_not_allowed", 409)


def pay_bill(
    db: Session,
    tenant_id: str,
    document_id: str,
    *,
    amount: Decimal | str,
    paid_from: str,
    posting_date: date | None = None,
    bank_fee: Decimal | str = ZERO,
    actor: str = "system",
    note: str | None = None,
    idempotency_key: str | None = None,
    require_approval: bool = False,
) -> dict:
    """Pay an open bill from a wallet: a GL-only ``document_payment`` journal allocated to the bill.

    Race- and retry-safe: the document row is locked first, and the journal key is
    ``supplier_payment:bill:{doc_id}:{idempotency_key}``, so the same key replays the original
    result (409 ``idempotency_conflict`` for a different amount). Overpayment is rejected (409).
    With ``require_approval`` the journal waits for a second person; its amount stays reserved
    and is allocated on approval (``after_journal_approved``).
    """
    pay_amount = gl.money(amount)
    if pay_amount <= ZERO:
        raise GLError("Payment amount must be greater than zero", "invalid_amount", 400)
    fee = gl.money(bank_fee)
    if fee < ZERO:
        raise GLError("Bank fee cannot be negative", "invalid_amount", 400)

    doc = _lock_document(db, tenant_id, document_id)
    payment_id = f"bill:{doc.id}:{idempotency_key or _uuid()}"
    existing = (
        db.query(GLJournal)
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.idempotency_key == f"supplier_payment:{payment_id}")
        .first()
    )
    if existing is not None:
        line = _ap_debit_line(db, tenant_id, existing)
        if line is None or Decimal(str(line.debit)) != pay_amount or Decimal(str(existing.total_debit)) != pay_amount + fee:
            raise GLError("This payment key was already used with a different amount", "idempotency_conflict", 409)
        return _payment_result(db, tenant_id, doc, existing, replayed=True)

    if doc.status not in PAYABLE_STATUSES + ("paid",):
        raise GLError(f"Cannot pay a bill in status '{doc.status}'", "invalid_status", 409)
    p_date = posting_date or gl.business_today()
    if p_date < doc.issue_date:
        raise GLError(f"Payment date {p_date.isoformat()} is before the bill's issue date {doc.issue_date.isoformat()}",
                      "payment_before_issue", 400)
    available, pending = _available_to_pay(db, tenant_id, doc)
    if pay_amount > available:
        raise _overpayment(pay_amount, available, pending, doc.number)

    event = SupplierPaid(
        payment_id=payment_id,
        posting_date=p_date,
        supplier_id=doc.partner_id,
        amount=pay_amount,
        paid_from=paid_from,
        bank_fee=fee,
        document_ids=(doc.id,),
        note=note,
    )
    journal = post_supplier_payment(db, tenant_id, event, actor=actor, source_module="gl", source_type=DOCUMENT_PAYMENT_SOURCE,
                                    source_id=doc.id, require_approval=require_approval)
    return _payment_result(db, tenant_id, doc, journal, replayed=False)


def after_journal_approved(db: Session, tenant_id: str, journal: GLJournal) -> None:
    """Document side effects of an approved journal. The router calls it in the same transaction
    as ``engine.approve_journal``; raising rolls the approval back.

    ``document_payment``: lock the bill, re-check the amount still fits, then allocate.
    """
    if journal.source_type != DOCUMENT_PAYMENT_SOURCE or journal.reversal_of_id or journal.status != "posted":
        return
    doc = _lock_document(db, tenant_id, journal.source_id)
    line = _ap_debit_line(db, tenant_id, journal)
    if line is None:
        return
    if db.query(GLDocumentAllocation.id).filter(GLDocumentAllocation.tenant_id == tenant_id,
                                                GLDocumentAllocation.journal_id == journal.id).first():
        return
    amount = Decimal(str(line.debit)).quantize(CENT)
    available, pending = _available_to_pay(db, tenant_id, doc)
    if amount > available:
        raise _overpayment(amount, available, pending, doc.number)
    _allocate_journal(db, tenant_id, journal, partner_id=doc.partner_id, document_ids=(doc.id,))


def after_journal_rejected(db: Session, tenant_id: str, journal: GLJournal) -> None:
    """Document side effects of a rejected journal (same transaction as ``engine.reject_journal``).

    A rejected ``document_payment`` was never allocated: rejecting it just releases its
    reservation, so there is nothing to write.
    """
    return None


def void_document(
    db: Session,
    tenant_id: str,
    document_id: str,
    *,
    actor: str = "system",
    reason: str = "Ləğv edildi",
) -> GLDocument:
    """Void an open bill: reverses its journal if no payments are allocated."""
    doc = db.query(GLDocument).filter(GLDocument.tenant_id == tenant_id, GLDocument.id == document_id).first()
    if not doc:
        raise GLError(f"Document {document_id} not found", "not_found", 404)
    if doc.status == "void":
        raise GLError("Document is already void", "already_void", 409)

    alloc_count = (
        db.query(GLDocumentAllocation)
        .filter(GLDocumentAllocation.tenant_id == tenant_id, GLDocumentAllocation.document_id == document_id)
        .count()
    )
    if alloc_count > 0:
        raise GLError("Cannot void bill with existing payment allocations. Reverse payments first.", "document_has_allocations", 409)

    if doc.journal_id:
        gl.reverse_journal(db, tenant_id, doc.journal_id, actor=actor, reason=f"Faktura ləğvi: {reason}")

    doc.status = "void"
    db.flush()
    return doc


def reclassify_unassigned_ap(
    db: Session,
    tenant_id: str,
    *,
    amount: Decimal | str,
    to_supplier_id: str,
    actor: str = "system",
    reason: str = "Təchizatçı təyini",
    posting_date: date | None = None,
) -> dict:
    """Reclassify historical unassigned AP (partner_id=NULL) to a designated supplier.

    Net balance on account 531 is unchanged (debit=credit=amount),
    moving liability from unassigned to the named supplier.
    """
    amt = Decimal(str(amount or 0)).quantize(CENT)
    if amt <= ZERO:
        raise GLError("Reclassification amount must be greater than zero", "invalid_amount", 400)
    if not str(to_supplier_id or "").strip():
        raise GLError("Target supplier ID is required", "supplier_required", 400)

    by_role = gl.accounts_by_role(db, tenant_id)
    ap_acc = by_role.get("accounts_payable")
    if not ap_acc:
        raise GLError("Accounts payable (531) account not found in chart", "ap_not_found", 500)

    p_date = posting_date or gl.business_today()
    lines = [
        LineIn(
            account=ap_acc.id,
            debit=amt,
            credit=ZERO,
            memo=f"Təyin edilməmiş borcun silinməsi: {reason}",
            partner_type=None,
            partner_id=None,
        ),
        LineIn(
            account=ap_acc.id,
            debit=ZERO,
            credit=amt,
            memo=f"Təchizatçıya təyin: {reason}",
            partner_type="supplier",
            partner_id=to_supplier_id,
        ),
    ]

    journal = gl.create_journal(
        db,
        tenant_id=tenant_id,
        journal_type="adjustment",
        posting_date=p_date,
        description=f"Təchizatçı borcu yenidən təsnifatı: {to_supplier_id}",
        lines=lines,
        created_by=actor,
        source_module="gl",
        source_type="reclass",
        source_id=f"reclass:{to_supplier_id}:{_uuid()[:8]}",
    )

    return {
        "journal_no": journal.journal_no,
        "amount": str(amt),
        "to_supplier_id": to_supplier_id,
        "posting_date": journal.posting_date.isoformat(),
    }


def list_documents(
    db: Session,
    tenant_id: str,
    *,
    kind: str | None = None,
    status: str | None = None,
    partner_id: str | None = None,
    due_before: date | None = None,
    due_after: date | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """List documents with pagination and remaining open balance."""
    q = db.query(GLDocument).filter(GLDocument.tenant_id == tenant_id)
    if kind:
        q = q.filter(GLDocument.kind == kind)
    if status:
        q = q.filter(GLDocument.status == status)
    if partner_id:
        q = q.filter(GLDocument.partner_id == partner_id)
    if due_before:
        q = q.filter(GLDocument.due_date <= due_before)
    if due_after:
        q = q.filter(GLDocument.due_date >= due_after)

    total = q.count()
    items = q.order_by(desc(GLDocument.issue_date), desc(GLDocument.created_at)).limit(limit).offset(offset).all()

    # Pre-fetch supplier names
    supplier_ids = list({d.partner_id for d in items if d.partner_type == "supplier"})
    supplier_names = {}
    if supplier_ids:
        from app.models import Supplier

        for sid, sname in db.query(Supplier.id, Supplier.name).filter(Supplier.tenant_id == tenant_id, Supplier.id.in_(supplier_ids)).all():
            supplier_names[sid] = sname

    docs_out = []
    today = gl.business_today()
    for d in items:
        open_bal = get_document_open_balance(db, tenant_id, d.id)
        is_overdue = d.status in ("open", "partially_paid") and d.due_date < today
        days_overdue = (today - d.due_date).days if is_overdue else 0
        docs_out.append({
            "id": d.id,
            "kind": d.kind,
            "partner_type": d.partner_type,
            "partner_id": d.partner_id,
            "partner_name": supplier_names.get(d.partner_id, d.partner_id),
            "number": d.number,
            "issue_date": d.issue_date.isoformat(),
            "due_date": d.due_date.isoformat(),
            "currency": d.currency,
            "total": str(d.total),
            "open": str(open_bal),
            "status": d.status,
            "is_overdue": is_overdue,
            "days_overdue": days_overdue,
            "journal_id": d.journal_id,
            "note": d.note,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        })

    return {"total": total, "items": docs_out}


def get_document_detail(db: Session, tenant_id: str, document_id: str) -> dict:
    """Get full document detail with payment allocations and linked journal lines."""
    doc = db.query(GLDocument).filter(GLDocument.tenant_id == tenant_id, GLDocument.id == document_id).first()
    if not doc:
        raise GLError(f"Document {document_id} not found", "not_found", 404)

    open_bal = get_document_open_balance(db, tenant_id, doc.id)
    today = gl.business_today()
    is_overdue = doc.status in ("open", "partially_paid") and doc.due_date < today

    allocs = (
        db.query(GLDocumentAllocation, GLJournal.journal_no, GLJournal.posting_date)
        .join(GLJournal, GLJournal.id == GLDocumentAllocation.journal_id)
        .filter(GLDocumentAllocation.tenant_id == tenant_id, GLDocumentAllocation.document_id == document_id)
        .order_by(GLDocumentAllocation.created_at.asc())
        .all()
    )

    alloc_list = [
        {
            "id": a.id,
            "journal_id": a.journal_id,
            "journal_no": j_no,
            "posting_date": j_date.isoformat(),
            "journal_line_no": a.journal_line_no,
            "amount": str(a.amount),
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a, j_no, j_date in allocs
    ]

    partner_name = doc.partner_id
    if doc.partner_type == "supplier":
        from app.models import Supplier

        s = db.query(Supplier.name).filter(Supplier.tenant_id == tenant_id, Supplier.id == doc.partner_id).first()
        if s:
            partner_name = s[0]

    return {
        "id": doc.id,
        "kind": doc.kind,
        "partner_type": doc.partner_type,
        "partner_id": doc.partner_id,
        "partner_name": partner_name,
        "number": doc.number,
        "issue_date": doc.issue_date.isoformat(),
        "due_date": doc.due_date.isoformat(),
        "currency": doc.currency,
        "total": str(doc.total),
        "open": str(open_bal),
        "status": doc.status,
        "is_overdue": is_overdue,
        "days_overdue": (today - doc.due_date).days if is_overdue else 0,
        "journal_id": doc.journal_id,
        "note": doc.note,
        "created_by": doc.created_by,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "allocations": alloc_list,
    }
