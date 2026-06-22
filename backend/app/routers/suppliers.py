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


@router.get("", response_model=list[SupplierOut])
def get_suppliers(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_supplier_write_access(user)
    suppliers = db.query(Supplier).filter(Supplier.tenant_id == tenant.id).order_by(Supplier.name).all()
    return suppliers


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
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.tenant_id == tenant.id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


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

    post_finance_transaction(
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

    supplier.balance -= amount
    db.commit()
    db.refresh(supplier)
    return {
        "id": supplier.id,
        "name": supplier.name,
        "balance": str(supplier.balance),
    }
