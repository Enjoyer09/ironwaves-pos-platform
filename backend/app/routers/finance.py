from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import FinanceEntry, Tenant
from app.schemas import FinanceEntryIn, TransferIn


router = APIRouter(prefix="/api/v1/finance", tags=["finance"])


def _wallet_balance(db: Session, tenant_id: str, source: str) -> Decimal:
    ins = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant_id, FinanceEntry.source == source, FinanceEntry.type == "in").all()
    outs = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant_id, FinanceEntry.source == source, FinanceEntry.type == "out").all()
    in_total = sum((Decimal(str(x.amount)) for x in ins), Decimal("0"))
    out_total = sum((Decimal(str(x.amount)) for x in outs), Decimal("0"))
    return in_total - out_total


@router.get("/balances")
def get_balances(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    return {
        "cash": str(_wallet_balance(db, tenant.id, "cash")),
        "card": str(_wallet_balance(db, tenant.id, "card")),
        "safe": str(_wallet_balance(db, tenant.id, "safe")),
        "investor": str(_wallet_balance(db, tenant.id, "investor")),
    }


@router.post("/entry")
def create_entry(payload: FinanceEntryIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    amount = Decimal(str(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    if payload.type == "out":
        bal = _wallet_balance(db, tenant.id, payload.source)
        if bal < amount:
            raise HTTPException(status_code=400, detail="Insufficient balance")

    row = FinanceEntry(
        tenant_id=tenant.id,
        type=payload.type,
        category=payload.category,
        source=payload.source,
        amount=amount,
        description=payload.description,
        created_by=user.username,
    )
    db.add(row)
    db.commit()
    return {"success": True, "id": row.id}


@router.post("/transfer")
def transfer(payload: TransferIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    amount = Decimal(str(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    direction_map = {
        "cash_to_safe": ("cash", "safe"),
        "safe_to_cash": ("safe", "cash"),
        "cash_to_card": ("cash", "card"),
        "card_to_cash": ("card", "cash"),
    }
    if payload.direction not in direction_map:
        raise HTTPException(status_code=400, detail="Invalid transfer direction")

    source, target = direction_map[payload.direction]
    bal = _wallet_balance(db, tenant.id, source)
    if bal < amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    db.add(
        FinanceEntry(
            tenant_id=tenant.id,
            type="out",
            category="Daxili Transfer",
            source=source,
            amount=amount,
            description=payload.description,
            created_by=user.username,
        )
    )
    db.add(
        FinanceEntry(
            tenant_id=tenant.id,
            type="in",
            category="Daxili Transfer",
            source=target,
            amount=amount,
            description=payload.description,
            created_by=user.username,
        )
    )
    db.commit()
    return {"success": True}