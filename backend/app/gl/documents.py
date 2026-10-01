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


def _uuid() -> str:
    return str(uuid.uuid4())


def get_document_open_balance(db: Session, tenant_id: str, document_id: str) -> Decimal:
    """Compute remaining unpaid balance: total - sum(allocations)."""
    doc = db.query(GLDocument).filter(GLDocument.tenant_id == tenant_id, GLDocument.id == document_id).first()
    if not doc:
        raise GLError(f"Document {document_id} not found", "not_found", 404)
    if doc.status == "void":
        return ZERO

    allocated = (
        db.query(func.coalesce(func.sum(GLDocumentAllocation.amount), 0))
        .filter(GLDocumentAllocation.tenant_id == tenant_id, GLDocumentAllocation.document_id == document_id)
        .scalar()
    )
    open_bal = (Decimal(str(doc.total)) - Decimal(str(allocated))).quantize(CENT)
    return max(ZERO, open_bal)


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
    """Allocate a payment journal line against open documents for a partner.

    If ``document_ids`` is provided, allocates against those documents in order.
    Otherwise allocates FIFO by due_date ASC, issue_date ASC.
    """
    rem = Decimal(str(amount or 0)).quantize(CENT)
    if rem <= ZERO:
        return []

    q = (
        db.query(GLDocument)
        .filter(
            GLDocument.tenant_id == tenant_id,
            GLDocument.kind == kind,
            GLDocument.partner_id == partner_id,
            GLDocument.status.in_(("open", "partially_paid")),
        )
    )
    if document_ids:
        docs = [d for did in document_ids for d in q.all() if d.id == did]
    else:
        docs = q.order_by(GLDocument.due_date.asc(), GLDocument.issue_date.asc(), GLDocument.created_at.asc()).all()

    allocations: list[GLDocumentAllocation] = []
    for doc in docs:
        if rem <= ZERO:
            break
        open_bal = get_document_open_balance(db, tenant_id, doc.id)
        if open_bal <= ZERO:
            continue
        take = min(rem, open_bal)
        alloc = GLDocumentAllocation(
            id=_uuid(),
            tenant_id=tenant_id,
            document_id=doc.id,
            journal_id=payment_journal_id,
            journal_line_no=journal_line_no,
            amount=take,
        )
        db.add(alloc)
        allocations.append(alloc)
        rem -= take

        # Update status
        if open_bal - take <= ZERO:
            doc.status = "paid"
        else:
            doc.status = "partially_paid"

    db.flush()
    return allocations


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
) -> dict:
    """Pay an open bill from a specified wallet, posting SupplierPaid and allocating."""
    doc = db.query(GLDocument).filter(GLDocument.tenant_id == tenant_id, GLDocument.id == document_id).first()
    if not doc:
        raise GLError(f"Document {document_id} not found", "not_found", 404)
    if doc.status in ("paid", "void"):
        raise GLError(f"Cannot pay document in status '{doc.status}'", "invalid_status", 409)

    open_bal = get_document_open_balance(db, tenant_id, doc.id)
    pay_amount = Decimal(str(amount or 0)).quantize(CENT)
    if pay_amount <= ZERO:
        raise GLError("Payment amount must be greater than zero", "invalid_amount", 400)
    if pay_amount > open_bal:
        raise GLError(f"Payment amount ({pay_amount} ₼) exceeds open bill balance ({open_bal} ₼)", "overpayment_not_allowed", 400)

    p_date = posting_date or gl.business_today()
    event = SupplierPaid(
        payment_id=_uuid(),
        posting_date=p_date,
        supplier_id=doc.partner_id,
        amount=pay_amount,
        paid_from=paid_from,
        bank_fee=bank_fee,
    )
    journal = post_event(db, tenant_id, event, actor=actor)

    # Line 1 is the debit to accounts_payable
    allocations = allocate_payment(
        db,
        tenant_id,
        payment_journal_id=journal.id,
        journal_line_no=1,
        partner_id=doc.partner_id,
        amount=pay_amount,
        document_ids=[doc.id],
    )

    remaining_open = get_document_open_balance(db, tenant_id, doc.id)
    return {
        "document_id": doc.id,
        "number": doc.number,
        "status": doc.status,
        "paid_amount": str(pay_amount),
        "remaining_open": str(remaining_open),
        "journal_no": journal.journal_no,
        "allocations_count": len(allocations),
    }


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
