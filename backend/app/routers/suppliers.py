from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import uuid

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import Tenant, User, Supplier, FinanceTransaction
from app.schemas import SupplierCreate, SupplierUpdate, SupplierOut
from app.services.finance_service import post_finance_transaction

router = APIRouter(prefix="/api/v1/ops/suppliers", tags=["suppliers"])


def _ensure_supplier_write_access(user: User):
    if str(user.role or "").lower() not in {"admin", "super_admin", "manager"}:
        raise HTTPException(status_code=403, detail="Manager access required")


def _supplier_out(supplier: Supplier, *, balance: Decimal | None = None, source: str = "legacy") -> SupplierOut:
    """Build a SupplierOut response without mutating the ORM row. When ``balance``
    is given (GL AP subledger balance) it replaces the legacy numeric column."""
    return SupplierOut(
        id=supplier.id,
        tenant_id=supplier.tenant_id,
        name=supplier.name,
        contact_person=supplier.contact_person,
        phone=supplier.phone,
        email=supplier.email,
        address=supplier.address,
        notes=supplier.notes,
        balance=supplier.balance if balance is None else balance,
        balance_source=source,
        created_at=supplier.created_at,
    )


def _ap_balances(db: Session, tenant_id: str) -> dict[str, Decimal]:
    """Supplier-id -> GL AP subledger balance from a single subledger('ap') call."""
    from app.gl.subledger import subledger

    ledger = subledger(db, tenant_id, "ap")
    return {
        row["partner_id"]: Decimal(str(row["balance"]))
        for row in ledger["partners"]
        if row.get("partner_type") == "supplier" and row.get("partner_id")
    }


@router.get("", response_model=list[SupplierOut])
def get_suppliers(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_supplier_write_access(user)
    from app.gl.read_model import reports_source

    suppliers = db.query(Supplier).filter(Supplier.tenant_id == tenant.id).order_by(Supplier.name).all()
    if reports_source(db, tenant.id) == "gl":
        ap = _ap_balances(db, tenant.id)  # one subledger('ap') call for the whole list
        return [_supplier_out(s, balance=ap.get(s.id, Decimal("0.00")), source="gl") for s in suppliers]
    return [_supplier_out(s) for s in suppliers]


@router.post("", response_model=SupplierOut)
def create_supplier(
    payload: SupplierCreate,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_supplier_write_access(user)
    supplier = Supplier(
        id=str(uuid.uuid4()),
        tenant_id=tenant.id,
        name=payload.name,
        contact_person=payload.contact_person,
        phone=payload.phone,
        email=payload.email,
        address=payload.address,
        notes=payload.notes,
        balance=Decimal("0.00"),
        created_at=datetime.utcnow(),
    )
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.get("/{supplier_id}", response_model=SupplierOut)
def get_supplier(
    supplier_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_supplier_write_access(user)
    from app.gl.read_model import reports_source

    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.tenant_id == tenant.id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    if reports_source(db, tenant.id) == "gl":
        ap = _ap_balances(db, tenant.id)
        return _supplier_out(supplier, balance=ap.get(supplier.id, Decimal("0.00")), source="gl")
    return _supplier_out(supplier)


@router.put("/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: str,
    payload: SupplierUpdate,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_supplier_write_access(user)
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.tenant_id == tenant.id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    if payload.name is not None:
        supplier.name = payload.name
    if payload.contact_person is not None:
        supplier.contact_person = payload.contact_person
    if payload.phone is not None:
        supplier.phone = payload.phone
    if payload.email is not None:
        supplier.email = payload.email
    if payload.address is not None:
        supplier.address = payload.address
    if payload.notes is not None:
        supplier.notes = payload.notes

    db.commit()
    db.refresh(supplier)
    return supplier


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_supplier_write_access(user)
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.tenant_id == tenant.id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    db.delete(supplier)
    db.commit()
    return {"detail": "Supplier deleted successfully"}


class SupplierPaymentIn(BaseModel):
    amount: Decimal
    payment_source: str
    note: str | None = None
    # Finance v2 bills to settle first; the rest goes FIFO and any excess stays an advance.
    document_ids: list[str] = []


@router.post("/{supplier_id}/pay")
def pay_supplier(
    supplier_id: str,
    payload: SupplierPaymentIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_supplier_write_access(user)
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.tenant_id == tenant.id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    amount = Decimal(str(payload.amount)).quantize(Decimal("0.01"))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be > 0")

    source_code = str(payload.payment_source).strip().lower()
    if source_code not in {"cash", "card", "safe"}:
        raise HTTPException(status_code=400, detail="Payment source must be cash, card, or safe")

    legacy_txn = post_finance_transaction(
        db,
        tenant_id=tenant.id,
        transaction_type="supplier_payment",
        amount=amount,
        source_code=source_code,
        destination_code="payable",
        created_by=user.username,
        category="Təchizatçı Ödənişi",
        counterparty=supplier.name,
        note=payload.note or f"{supplier.name} öhdəlik ödənişi",
        supplier_id=supplier.id,
    )
    # Finance v2 (dual mode only).
    from app.gl import bridge as _gl_bridge, documents as _gl_documents, posting_rules as _gl_rules
    from app.gl.engine import business_today as _gl_today

    _gl_bridge.emit(
        db,
        tenant.id,
        lambda: _gl_documents.post_supplier_payment(
            db,
            tenant.id,
            _gl_rules.SupplierPaid(legacy_txn.id, _gl_today(), supplier.id, amount, source_code,
                                   document_ids=tuple(payload.document_ids), note=payload.note),
            actor=user.username,
            source_module="pos",
        ),
        actor=user.username,
        event_type="SupplierPaid",
    )

    supplier.balance -= amount
    db.commit()
    db.refresh(supplier)
    return {
        "id": supplier.id,
        "name": supplier.name,
        "balance": str(supplier.balance),
    }
