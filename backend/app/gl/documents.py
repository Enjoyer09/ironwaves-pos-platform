"""Business documents: AP bills (AR invoices deferred) and payment allocations (P3b).

Builds on top of the General Ledger:
- An AP bill posts through the posting rules (``StockReceived`` for inventory, ``ExpensePaid`` for
  expenses; credit 531 accounts_payable tagged with the supplier). Document journals are GL-only
  (``source_module="gl"``, ``source_type`` ``document`` / ``document_payment``).
- Payment journals allocate to documents (named first, then FIFO). Allocations are append-only:
  a reversed payment gets negative compensating rows.
- Maker-checker: bills and payments wait for approval per the router's gate; void, payment
  reversal and reclass always do. ``after_journal_approved`` / ``after_journal_rejected`` move the
  document when its journal is approved or rejected (same transaction).
- Invariant: sum(open document balances per partner) == partner subledger balance (excluding advances).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import and_, case, desc, func, or_
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
from app.gl.posting_rules import ExpensePaid, StockReceived, SupplierPaid, post_event

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
DOCUMENT_SOURCE = "document"
DOCUMENT_PAYMENT_SOURCE = "document_payment"
# Journals owned by a document: only the document flows (void / reverse payment) may reverse them.
DOCUMENT_SOURCE_TYPES = (DOCUMENT_SOURCE, DOCUMENT_PAYMENT_SOURCE)
RECLASS_SOURCE = "reclass"
# Documents that can still receive payments.
PAYABLE_STATUSES = ("open", "partially_paid")
# Documents that owe nothing: waiting for approval, rejected or void.
NO_BALANCE_STATUSES = ("pending_approval", "rejected", "void")
# Debit side of a bill: inventory/merchandise, or any active postable expense account.
BILL_DEBIT_ROLES = ("inventory", "merchandise")


def _uuid() -> str:
    return str(uuid.uuid4())


def _require_supplier(db: Session, tenant_id: str, supplier_id: str):
    from app.models import Supplier

    supplier = db.query(Supplier).filter(Supplier.tenant_id == tenant_id, Supplier.id == supplier_id).first()
    if supplier is None:
        raise GLError(f"Supplier {supplier_id} not found", "supplier_not_found", 404)
    return supplier


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
    if doc.status in NO_BALANCE_STATUSES:
        return ZERO

    open_bal = (Decimal(str(doc.total)) - _net_allocated(db, tenant_id, document_id)).quantize(CENT)
    return max(ZERO, open_bal)


def _lock_document(db: Session, tenant_id: str, document_id: str) -> GLDocument:
    """Row-lock the document (no-op on SQLite) and re-read it, so checks see the committed state."""
    db.flush()  # populate_existing must not discard pending changes; the checks after it query the DB
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


def _ap_credit_line(db: Session, tenant_id: str, journal: GLJournal) -> GLJournalLine | None:
    """The accounts-payable credit line (e.g. of a payment storno)."""
    ap = gl.accounts_by_role(db, tenant_id).get("accounts_payable")
    if not ap:
        return None
    return (
        db.query(GLJournalLine)
        .filter(GLJournalLine.journal_id == journal.id, GLJournalLine.account_id == ap.id, GLJournalLine.credit > 0)
        .order_by(GLJournalLine.line_no.asc())
        .first()
    )


def _pending_void(db: Session, tenant_id: str, doc: GLDocument) -> GLJournal | None:
    """The bill's storno still waiting for approval (a void request), if any."""
    if not doc.journal_id:
        return None
    db.flush()  # the engine sets pending/rejected status after its own flush
    return (
        db.query(GLJournal)
        .filter(GLJournal.tenant_id == tenant_id, GLJournal.reversal_of_id == doc.journal_id,
                GLJournal.status == "pending_approval")
        .first()
    )


def _pending_payment_journals(db: Session, tenant_id: str, document_id: str, *, reversals: bool) -> list[GLJournal]:
    """Pending ``document_payment`` journals of a bill: payments, or (``reversals``) payment stornos."""
    db.flush()
    q = db.query(GLJournal).filter(
        GLJournal.tenant_id == tenant_id,
        GLJournal.status == "pending_approval",
        GLJournal.source_type == DOCUMENT_PAYMENT_SOURCE,
        GLJournal.source_id == document_id,
    )
    q = q.filter(GLJournal.reversal_of_id.isnot(None) if reversals else GLJournal.reversal_of_id.is_(None))
    return q.order_by(GLJournal.created_at.asc()).all()


def _pending_payments(db: Session, tenant_id: str, document_id: str) -> Decimal:
    """AP amount of bill payments for this document still waiting for approval (reserved, not yet allocated)."""
    db.flush()
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
    require_approval: bool = False,
) -> GLDocument:
    """Create an AP bill: post it through the posting rules and create the document.

    Inventory bills post ``StockReceived``, expense bills ``ExpensePaid`` (both on credit, supplier
    tagged on 531), as GL-only document journals. With ``require_approval`` the journal waits for a
    second person and the bill is ``pending_approval`` (owes nothing, cannot be paid) until approved.
    """
    if not str(partner_id or "").strip():
        raise GLError("Supplier is required for a bill", "partner_required", 400)
    num = str(number or "").strip()
    if not num:
        raise GLError("Bill number is required", "number_required", 400)
    if due_date < issue_date:
        raise GLError("Due date cannot be earlier than issue date", "invalid_due_date", 400)

    amount = gl.money(total)
    if amount <= ZERO:
        raise GLError("Bill total must be greater than zero", "invalid_amount", 400)
    _require_supplier(db, tenant_id, partner_id)

    # Numbers are unique per supplier, including void/rejected bills (owner decision: never reused).
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
        if existing.status in ("void", "rejected"):
            label = "voided" if existing.status == "void" else "rejected"
            raise GLError(f"Bill number {num} belongs to a {label} bill of this supplier and cannot be reused",
                          "duplicate_bill", 409)
        raise GLError(f"Bill '{num}' already exists for this supplier", "duplicate_bill", 409)

    debit_acc = _bill_debit_account(db, tenant_id, expense_account)

    doc_id = _uuid()
    if debit_acc.system_role == "inventory":
        event = StockReceived(receipt_id=f"bill:{doc_id}", posting_date=issue_date, amount=amount, paid_from=None,
                              supplier_id=partner_id, invoice_no=num, branch_id=branch_id)
    else:
        event = ExpensePaid(expense_id=f"bill:{doc_id}", posting_date=issue_date, expense_account=debit_acc.code,
                            amount=amount, paid_from=None, supplier_id=partner_id,
                            note=f"Alış fakturası {num}" + (f": {note}" if note else ""), branch_id=branch_id)
    journal = post_event(db, tenant_id, event, actor=actor, require_approval=require_approval,
                         source_module="gl", source_type=DOCUMENT_SOURCE, source_id=doc_id)

    doc = GLDocument(
        id=doc_id,
        tenant_id=tenant_id,
        kind="ap_bill",
        partner_type=partner_type,
        partner_id=partner_id,
        number=num,
        issue_date=issue_date,
        due_date=due_date,
        currency=currency,
        total=amount,
        status="pending_approval" if journal.status == "pending_approval" else "open",
        journal_id=journal.id,
        created_by=actor,
        note=note,
    )
    db.add(doc)
    db.flush()
    return doc


def _bill_debit_account(db: Session, tenant_id: str, expense_account: str | None) -> GLAccount:
    """Resolve the bill's debit account (role or code; inventory by default) and enforce the whitelist."""
    ref = str(expense_account or "inventory").strip()
    account = gl.accounts_by_role(db, tenant_id).get(ref) or (
        db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id, GLAccount.code == ref).first()
    )
    allowed = (
        account is not None
        and account.is_active
        and account.is_postable
        and (account.system_role in BILL_DEBIT_ROLES or account.account_type == "expense")
    )
    if not allowed:
        raise GLError(f"Account '{ref}' cannot be the debit of a bill; choose inventory or an active expense account",
                      "invalid_expense_account", 400)
    return account


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
    named_only: bool = False,
) -> list[GLDocumentAllocation]:
    """Allocate a payment journal line against a partner's open documents.

    Named ``document_ids`` are settled first (in the given order), then the remainder goes FIFO by
    due_date, issue_date, created_at. Whatever is left stays an unallocated advance on the partner.
    Candidate documents are row-locked in id order, and payments still pending approval keep
    their reservation on a document. With ``named_only`` only the named documents are candidates
    (no FIFO sweep), so a bill payment touches no other bill of the supplier.
    """
    rem = gl.money(amount)
    if rem <= ZERO:
        return []

    docs = _lock_payable_documents(db, tenant_id, partner_id, kind=kind,
                                   document_ids=list(document_ids or ()) if named_only else None)
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
        if _pending_void(db, tenant_id, doc) is not None:
            continue  # being voided: must not receive new settlements
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


def _lock_payable_documents(db: Session, tenant_id: str, partner_id: str, *, kind: str = "ap_bill",
                            document_ids: list[str] | None = None) -> list[GLDocument]:
    """Row-lock (id order) the partner's payable documents, or only ``document_ids`` when given."""
    db.flush()  # populate_existing below must not discard pending changes
    q = db.query(GLDocument).filter(
        GLDocument.tenant_id == tenant_id,
        GLDocument.kind == kind,
        GLDocument.partner_id == partner_id,
        GLDocument.status.in_(PAYABLE_STATUSES),
    )
    if document_ids is not None:
        if not document_ids:
            return []
        q = q.filter(GLDocument.id.in_(document_ids))
    return q.order_by(GLDocument.id.asc()).with_for_update().populate_existing().all()


def _allocate_journal(db: Session, tenant_id: str, journal: GLJournal, *, partner_id: str,
                      document_ids: tuple[str, ...] | list[str] = (),
                      named_only: bool = False) -> list[GLDocumentAllocation]:
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
        named_only=named_only,
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
    named_only: bool = False,
) -> GLJournal:
    """Post a SupplierPaid event and, once posted, allocate it to the supplier's bills
    (``event.document_ids`` first, then FIFO; any excess stays an advance).

    Used by ``pay_bill`` (GL-only document payment, ``named_only``: the caller has locked and
    checked the one bill) and by the legacy supplier payment (``source_module="pos"``, linked
    to its legacy transaction by the bridge). A pending journal is allocated by
    ``after_journal_approved``. Never commits.

    Lock order is documents before journal: a FIFO allocation locks the supplier's payable bills
    (id order) BEFORE posting, so it cannot deadlock with a bill payment that holds one bill and
    waits on the journal sequence / wallet / audit locks.
    """
    key = f"supplier_payment:{event.payment_id}"
    existed = db.query(GLJournal.id).filter(GLJournal.tenant_id == tenant_id, GLJournal.idempotency_key == key).first() is not None
    if not named_only and not existed and not require_approval:
        _lock_payable_documents(db, tenant_id, event.supplier_id)
    journal = post_event(db, tenant_id, event, actor=actor, require_approval=require_approval,
                         source_module=source_module, source_type=source_type, source_id=source_id)
    if journal.status == "posted" and not existed:
        _allocate_journal(db, tenant_id, journal, partner_id=event.supplier_id, document_ids=event.document_ids,
                          named_only=named_only)
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
    if _pending_void(db, tenant_id, doc) is not None:
        raise GLError(f"Bill {doc.number} has a void request awaiting approval; it cannot be paid", "void_pending", 409)
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
                                    source_id=doc.id, require_approval=require_approval, named_only=True)
    return _payment_result(db, tenant_id, doc, journal, replayed=False)


def after_journal_approved(db: Session, tenant_id: str, journal: GLJournal) -> None:
    """Document side effects of an approved journal. The router calls it in the same transaction
    as ``engine.approve_journal``; raising rolls the approval back.

    - ``document``: the bill journal → bill ``pending_approval`` becomes ``open``.
    - ``document`` storno (void): re-check no net allocations / pending payments, then ``void``.
    - ``document_payment``: lock the bill, re-check the amount still fits, then allocate.
    - ``document_payment`` storno: negative compensating allocations, status recomputed.
    - ``reclass``: the unassigned AP must not go negative.
    """
    if journal.status != "posted":
        return
    if journal.source_type == DOCUMENT_SOURCE:
        if journal.reversal_of_id:
            _complete_void(db, tenant_id, journal)
        else:
            doc = _document_of_journal(db, tenant_id, journal.id)
            if doc is not None and doc.status == "pending_approval":
                doc.status = "open"
                db.flush()
        return
    if journal.source_type == RECLASS_SOURCE:
        _check_reclass_posted(db, tenant_id, journal)
        return
    if journal.source_type != DOCUMENT_PAYMENT_SOURCE:
        return
    if journal.reversal_of_id:
        _compensate_reversed_payment(db, tenant_id, journal)
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
    _allocate_journal(db, tenant_id, journal, partner_id=doc.partner_id, document_ids=(doc.id,), named_only=True)


def after_journal_rejected(db: Session, tenant_id: str, journal: GLJournal) -> None:
    """Document side effects of a rejected journal (same transaction as ``engine.reject_journal``).

    - Rejected bill journal → bill ``rejected`` (owes nothing; its number stays taken).
    - A rejected ``document_payment`` was never allocated: rejecting it just releases its
      reservation. A rejected void / payment storno leaves the bill as it was.
    """
    if journal.source_type == DOCUMENT_SOURCE and not journal.reversal_of_id:
        doc = _document_of_journal(db, tenant_id, journal.id)
        if doc is not None and doc.status == "pending_approval":
            doc.status = "rejected"
            db.flush()


def _document_of_journal(db: Session, tenant_id: str, journal_id: str | None) -> GLDocument | None:
    """The (locked) document whose source journal is ``journal_id``."""
    if not journal_id:
        return None
    doc_id = db.query(GLDocument.id).filter(GLDocument.tenant_id == tenant_id, GLDocument.journal_id == journal_id).scalar()
    return _lock_document(db, tenant_id, doc_id) if doc_id else None


def _void_blockers(db: Session, tenant_id: str, doc: GLDocument) -> None:
    if _net_allocated(db, tenant_id, doc.id) != ZERO:
        raise GLError(f"Bill {doc.number} has payments allocated. Reverse its payments first, then void it.",
                      "document_has_allocations", 409)
    if _pending_payments(db, tenant_id, doc.id) > ZERO:
        raise GLError(f"Bill {doc.number} has a payment awaiting approval. Approve or reject it first.",
                      "payment_pending", 409)


def _complete_void(db: Session, tenant_id: str, storno: GLJournal) -> None:
    """Approved bill storno: re-check under the document lock, then the bill becomes void."""
    doc = _document_of_journal(db, tenant_id, storno.reversal_of_id)
    if doc is None:
        return
    _void_blockers(db, tenant_id, doc)
    doc.status = "void"
    db.flush()


def _compensate_reversed_payment(db: Session, tenant_id: str, storno: GLJournal) -> None:
    """Approved payment storno: append negative allocations cancelling the original payment's ones."""
    if db.query(GLDocumentAllocation.id).filter(GLDocumentAllocation.tenant_id == tenant_id,
                                                GLDocumentAllocation.journal_id == storno.id).first():
        return
    line = _ap_credit_line(db, tenant_id, storno)
    if line is None:
        return
    per_doc = (
        db.query(GLDocumentAllocation.document_id, func.sum(GLDocumentAllocation.amount))
        .filter(GLDocumentAllocation.tenant_id == tenant_id, GLDocumentAllocation.journal_id == storno.reversal_of_id)
        .group_by(GLDocumentAllocation.document_id)
        .order_by(GLDocumentAllocation.document_id.asc())
        .all()
    )
    for document_id, amount in per_doc:
        net = Decimal(str(amount or 0)).quantize(CENT)
        if net == ZERO:
            continue
        doc = _lock_document(db, tenant_id, document_id)
        db.add(GLDocumentAllocation(id=_uuid(), tenant_id=tenant_id, document_id=doc.id, journal_id=storno.id,
                                    journal_line_no=line.line_no, amount=-net))
        db.flush()
        _refresh_status(db, tenant_id, doc)
    db.flush()


def void_document(
    db: Session,
    tenant_id: str,
    document_id: str,
    *,
    actor: str = "system",
    reason: str = "Ləğv edildi",
) -> GLDocument:
    """Request the void of an open bill: a storno of its journal that waits for a second person.

    The bill stays ``open`` (and cannot be paid) until the storno is approved; then
    ``after_journal_approved`` re-checks and marks it ``void``. Blocked while payments are
    allocated (net), a payment is pending, or a void is already pending.
    """
    doc = _lock_document(db, tenant_id, document_id)
    if doc.status == "void":
        raise GLError("Document is already void", "already_void", 409)
    if doc.status not in PAYABLE_STATUSES + ("paid",):
        raise GLError(f"Cannot void a bill in status '{doc.status}'", "invalid_status", 409)
    _void_blockers(db, tenant_id, doc)
    if _pending_void(db, tenant_id, doc) is not None:
        raise GLError(f"A void of bill {doc.number} is already awaiting approval", "void_pending", 409)

    if doc.journal_id:
        gl.reverse_journal(db, tenant_id, doc.journal_id, actor=actor, reason=f"Faktura ləğvi: {reason}", require_approval=True)
    else:  # no journal to reverse (never posted)
        doc.status = "void"
    db.flush()
    return doc


def reverse_bill_payment(db: Session, tenant_id: str, document_id: str, journal_id: str, *, actor: str, reason: str) -> dict:
    """Request the reversal of a posted bill payment (storno, always pending a second person).

    On approval ``after_journal_approved`` appends negative allocations, so the bill is open again
    and can be paid again or voided.
    """
    doc = _lock_document(db, tenant_id, document_id)
    journal = db.query(GLJournal).filter(GLJournal.tenant_id == tenant_id, GLJournal.id == journal_id).first()
    allocated = journal is not None and db.query(GLDocumentAllocation.id).filter(
        GLDocumentAllocation.tenant_id == tenant_id, GLDocumentAllocation.document_id == doc.id,
        GLDocumentAllocation.journal_id == journal.id).first() is not None
    if (not allocated or journal.source_type != DOCUMENT_PAYMENT_SOURCE or journal.source_id != doc.id
            or journal.reversal_of_id):
        raise GLError(f"No posted payment {journal_id} on bill {doc.number}", "payment_not_found", 404)
    storno = gl.reverse_journal(db, tenant_id, journal.id, actor=actor, reason=f"Faktura ödənişinin ləğvi: {reason}",
                                require_approval=True)
    return {
        "document_id": doc.id,
        "journal_id": storno.id,
        "journal_no": storno.journal_no,
        "journal_status": storno.status,
        "reversal_of_id": journal.id,
    }


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
    """Request the reclassification of historical unassigned AP (partner_id=NULL) to a supplier.

    Net balance on account 531 is unchanged (debit=credit=amount), moving liability from
    unassigned to the named supplier. Bounded by the posted unassigned balance as of the posting
    date minus reclassifications still pending, and always owner-approved (pending journal).
    """
    amt = gl.money(amount)
    if amt <= ZERO:
        raise GLError("Reclassification amount must be greater than zero", "invalid_amount", 400)
    if not str(to_supplier_id or "").strip():
        raise GLError("Target supplier ID is required", "supplier_required", 400)
    supplier = _require_supplier(db, tenant_id, to_supplier_id)

    by_role = gl.accounts_by_role(db, tenant_id)
    ap_acc = by_role.get("accounts_payable")
    if not ap_acc:
        raise GLError("Accounts payable (531) account not found in chart", "ap_not_found", 500)
    # Serialize reclass requests: the pending reservations below must see each other.
    db.query(GLAccount).filter(GLAccount.tenant_id == tenant_id, GLAccount.id == ap_acc.id).with_for_update().one()

    p_date = posting_date or gl.business_today()
    pending = _pending_reclass(db, tenant_id, ap_acc)
    available = max(ZERO, _unassigned_ap(db, tenant_id, ap_acc, p_date) - pending)
    if amt > available:
        message = (f"Reclassification {amt} ₼ exceeds the unassigned supplier debt available on {p_date.isoformat()} "
                   f"({available} ₼)")
        if pending > ZERO:
            message += f"; {pending} ₼ is already reserved by reclassifications awaiting approval"
        raise GLError(message, "reclass_exceeds_unassigned", 409)

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
        description=f"Təchizatçı borcu yenidən təsnifatı: {supplier.name}",
        lines=lines,
        created_by=actor,
        source_module="gl",
        source_type=RECLASS_SOURCE,
        source_id=f"reclass:{to_supplier_id}:{_uuid()[:8]}",
        require_approval=True,
    )

    return {
        "journal_id": journal.id,
        "journal_no": journal.journal_no,
        "status": journal.status,
        "amount": str(amt),
        "to_supplier_id": to_supplier_id,
        "posting_date": journal.posting_date.isoformat(),
    }


def _unassigned_ap(db: Session, tenant_id: str, ap_acc: GLAccount, as_of: date) -> Decimal:
    """Posted AP credit balance without a partner (partner_id NULL/empty) up to ``as_of``."""
    debit, credit = (
        db.query(func.coalesce(func.sum(GLJournalLine.debit), 0), func.coalesce(func.sum(GLJournalLine.credit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(
            GLJournalLine.tenant_id == tenant_id,
            GLJournalLine.account_id == ap_acc.id,
            or_(GLJournalLine.partner_id.is_(None), GLJournalLine.partner_id == ""),
            GLJournal.status == "posted",
            GLJournal.posting_date <= as_of,
        )
        .one()
    )
    return (Decimal(str(credit)) - Decimal(str(debit))).quantize(CENT)


def _pending_reclass(db: Session, tenant_id: str, ap_acc: GLAccount) -> Decimal:
    """Unassigned AP already reserved by reclass journals waiting for approval."""
    db.flush()
    pending = (
        db.query(func.coalesce(func.sum(GLJournalLine.debit), 0))
        .join(GLJournal, GLJournal.id == GLJournalLine.journal_id)
        .filter(
            GLJournal.tenant_id == tenant_id,
            GLJournal.status == "pending_approval",
            GLJournal.source_type == RECLASS_SOURCE,
            GLJournalLine.account_id == ap_acc.id,
            GLJournalLine.partner_id.is_(None),
        )
        .scalar()
    )
    return Decimal(str(pending)).quantize(CENT)


def _check_reclass_posted(db: Session, tenant_id: str, journal: GLJournal) -> None:
    """After a reclass is approved the unassigned AP must still be >= 0 (else the approval rolls back)."""
    ap_acc = gl.accounts_by_role(db, tenant_id).get("accounts_payable")
    if ap_acc is None:
        return
    # No extra lock here: approvals are already serialized by the audit chain head the engine locked.
    remaining = _unassigned_ap(db, tenant_id, ap_acc, journal.posting_date)
    if remaining < ZERO:
        raise GLError(f"Approving this reclassification would leave the unassigned supplier debt at {remaining} ₼ "
                      f"on {journal.posting_date.isoformat()}; it was reduced meanwhile", "reclass_exceeds_unassigned", 409)


def list_documents(
    db: Session,
    tenant_id: str,
    *,
    kind: str | None = None,
    status: str | None = None,
    partner_id: str | None = None,
    due_before: date | None = None,
    due_after: date | None = None,
    overdue_only: bool = False,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """List documents with pagination and remaining open balance.

    ``summary`` aggregates the whole filtered set (not just the page): ``total_billed`` (excluding
    void/rejected bills), ``total_open``, ``overdue_open`` and ``overdue_count``. ``search`` matches
    the bill number or the supplier name (case-insensitive).
    """
    from app.models import Supplier

    today = gl.business_today()
    overdue_cond = and_(GLDocument.status.in_(PAYABLE_STATUSES), GLDocument.due_date < today)
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
    if overdue_only:
        q = q.filter(overdue_cond)
    term = str(search or "").strip()
    if term:
        pattern = f"%{term}%"
        matching_suppliers = db.query(Supplier.id).filter(Supplier.tenant_id == tenant_id, Supplier.name.ilike(pattern))
        q = q.filter(or_(GLDocument.number.ilike(pattern), GLDocument.partner_id.in_(matching_suppliers)))

    total = q.count()

    net = (
        db.query(GLDocumentAllocation.document_id.label("document_id"), func.sum(GLDocumentAllocation.amount).label("net"))
        .filter(GLDocumentAllocation.tenant_id == tenant_id)
        .group_by(GLDocumentAllocation.document_id)
        .subquery()
    )
    remaining = GLDocument.total - func.coalesce(net.c.net, 0)
    open_expr = case((and_(GLDocument.status.in_(PAYABLE_STATUSES), remaining > 0), remaining), else_=0)
    billed, open_sum, overdue_open, overdue_count = (
        q.outerjoin(net, net.c.document_id == GLDocument.id)
        .with_entities(
            func.coalesce(func.sum(case((GLDocument.status.notin_(("void", "rejected")), GLDocument.total), else_=0)), 0),
            func.coalesce(func.sum(open_expr), 0),
            func.coalesce(func.sum(case((overdue_cond, open_expr), else_=0)), 0),
            func.coalesce(func.sum(case((overdue_cond, 1), else_=0)), 0),
        )
        .one()
    )
    summary = {
        "total_billed": str(Decimal(str(billed)).quantize(CENT)),
        "total_open": str(Decimal(str(open_sum)).quantize(CENT)),
        "overdue_open": str(Decimal(str(overdue_open)).quantize(CENT)),
        "overdue_count": int(overdue_count or 0),
    }
    items = q.order_by(desc(GLDocument.issue_date), desc(GLDocument.created_at)).limit(limit).offset(offset).all()

    # Pre-fetch supplier names
    supplier_ids = list({d.partner_id for d in items if d.partner_type == "supplier"})
    supplier_names = {}
    if supplier_ids:
        from app.models import Supplier

        for sid, sname in db.query(Supplier.id, Supplier.name).filter(Supplier.tenant_id == tenant_id, Supplier.id.in_(supplier_ids)).all():
            supplier_names[sid] = sname

    docs_out = []
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

    return {"total": total, "items": docs_out, "summary": summary}


def get_document_detail(db: Session, tenant_id: str, document_id: str) -> dict:
    """Get full document detail with payment allocations and linked journal lines."""
    doc = db.query(GLDocument).filter(GLDocument.tenant_id == tenant_id, GLDocument.id == document_id).first()
    if not doc:
        raise GLError(f"Document {document_id} not found", "not_found", 404)

    open_bal = get_document_open_balance(db, tenant_id, doc.id)
    today = gl.business_today()
    is_overdue = doc.status in ("open", "partially_paid") and doc.due_date < today

    allocs = (
        db.query(GLDocumentAllocation, GLJournal.journal_no, GLJournal.posting_date, GLJournal.source_type,
                 GLJournal.reversed_by_id)
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
            # Only positive rows of this bill's own payments (not yet reversed) can be reversed here.
            "source_type": j_source_type,
            "reversed": j_reversed_by is not None,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a, j_no, j_date, j_source_type, j_reversed_by in allocs
    ]

    source = db.query(GLJournal).filter(GLJournal.tenant_id == tenant_id, GLJournal.id == doc.journal_id).first() if doc.journal_id else None
    lines = []
    if source is not None:
        lines = [
            {"line_no": line.line_no, "account_code": code, "account_name": name, "debit": str(line.debit),
             "credit": str(line.credit), "memo": line.memo}
            for line, code, name in (
                db.query(GLJournalLine, GLAccount.code, GLAccount.name)
                .join(GLAccount, GLAccount.id == GLJournalLine.account_id)
                .filter(GLJournalLine.journal_id == source.id)
                .order_by(GLJournalLine.line_no.asc())
                .all()
            )
        ]
    pending_void = _pending_void(db, tenant_id, doc)
    pending_payments = []
    for j in _pending_payment_journals(db, tenant_id, doc.id, reversals=False):
        line = _ap_debit_line(db, tenant_id, j)
        pending_payments.append({
            "journal_id": j.id,
            "amount": str(Decimal(str(line.debit)).quantize(CENT)) if line else "0.00",
            "posting_date": j.posting_date.isoformat(),
            "created_by": j.created_by,
            "created_at": j.created_at.isoformat() if j.created_at else None,
        })
    pending_reversals = [
        {"journal_id": j.id, "reversal_of_id": j.reversal_of_id, "created_by": j.created_by}
        for j in _pending_payment_journals(db, tenant_id, doc.id, reversals=True)
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
        "journal_status": source.status if source is not None else None,
        "note": doc.note,
        "created_by": doc.created_by,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "allocations": alloc_list,
        "lines": lines,
        "pending_void_journal_id": pending_void.id if pending_void is not None else None,
        "pending_payments": pending_payments,
        "pending_payment_reversals": pending_reversals,
    }


def lock_documents_for_journal(db: Session, tenant_id: str, journal_id: str) -> None:
    """Lock the document a journal belongs to *before* the engine locks the journal/audit chain.

    Pay / void / reverse-payment requests lock the document first; approving or rejecting a
    document journal must take the locks in the same order, or PostgreSQL could deadlock.
    """
    journal = db.query(GLJournal.source_type, GLJournal.source_id).filter(
        GLJournal.tenant_id == tenant_id, GLJournal.id == journal_id).first()
    if journal is None or journal.source_type not in DOCUMENT_SOURCE_TYPES or not journal.source_id:
        return
    if db.query(GLDocument.id).filter(GLDocument.tenant_id == tenant_id, GLDocument.id == journal.source_id).first():
        _lock_document(db, tenant_id, journal.source_id)
