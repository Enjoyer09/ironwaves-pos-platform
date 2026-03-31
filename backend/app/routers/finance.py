from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
import json

from app.models import FinanceEntry, Setting, Tenant
from app.schemas import FinanceEntryIn, TransferIn


router = APIRouter(prefix="/api/v1/finance", tags=["finance"])


def _normalize_text(value: str) -> str:
    return (
        (value or "")
        .replace("ə", "e")
        .replace("Ə", "e")
        .replace("ı", "i")
        .replace("İ", "i")
        .replace("ö", "o")
        .replace("Ö", "o")
        .replace("ü", "u")
        .replace("Ü", "u")
        .replace("ç", "c")
        .replace("Ç", "c")
        .replace("ş", "s")
        .replace("Ş", "s")
        .replace("ğ", "g")
        .replace("Ğ", "g")
        .strip()
        .lower()
    )


def _is_founder_investment_category(category: str) -> bool:
    normalized = _normalize_text(category)
    has_founder = "tesisci" in normalized or "founder" in normalized or "учред" in normalized
    has_investment = "investis" in normalized or "investment" in normalized or "инвест" in normalized
    return has_founder and has_investment


def _wallet_balance(db: Session, tenant_id: str, source: str) -> Decimal:
    ins = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant_id, FinanceEntry.source == source, FinanceEntry.type == "in").all()
    outs = db.query(FinanceEntry).filter(FinanceEntry.tenant_id == tenant_id, FinanceEntry.source == source, FinanceEntry.type == "out").all()
    in_total = sum((Decimal(str(x.amount)) for x in ins), Decimal("0"))
    out_total = sum((Decimal(str(x.amount)) for x in outs), Decimal("0"))
    return in_total - out_total


def _setting_value(db: Session, tenant_id: str, key: str, default):
    row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == key).first()
    if not row or row.value is None:
        return default
    try:
        return json.loads(row.value)
    except Exception:
        return default


@router.get("/balances")
def get_balances(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    return {
        "cash": str(_wallet_balance(db, tenant.id, "cash")),
        "card": str(_wallet_balance(db, tenant.id, "card")),
        "safe": str(_wallet_balance(db, tenant.id, "safe")),
        "investor": str(_wallet_balance(db, tenant.id, "investor")),
        "debt": str(_wallet_balance(db, tenant.id, "debt")),
    }


@router.get("/entries")
def list_entries(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    rows = (
        db.query(FinanceEntry)
        .filter(FinanceEntry.tenant_id == tenant.id)
        .order_by(FinanceEntry.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "type": r.type,
            "category": r.category,
            "source": r.source,
            "amount": str(r.amount),
            "description": r.description,
            "created_by": r.created_by,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/entry")
def create_entry(payload: FinanceEntryIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    amount = Decimal(str(payload.amount))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be > 0")

    valid_sources = {"cash", "card", "safe", "investor", "debt"}
    if payload.source not in valid_sources:
        raise HTTPException(status_code=400, detail="Invalid wallet source")

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

    if payload.type == "in" and payload.source == "debt":
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="in",
                category="Borcdan Kassaya Daxilolma",
                source="cash",
                amount=amount,
                description=f"Auto mirror: {payload.description or payload.category}",
                created_by=user.username,
            )
        )

    if payload.type == "in" and payload.source == "cash" and _is_founder_investment_category(payload.category):
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="in",
                category="İnvestor Borcu",
                source="investor",
                amount=amount,
                description=f"Auto liability mirror: {payload.description or payload.category}",
                created_by=user.username,
            )
        )

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
        "cash_to_debt": ("cash", "debt"),
        "card_to_debt": ("card", "debt"),
    }
    if payload.direction not in direction_map:
        raise HTTPException(status_code=400, detail="Invalid transfer direction")

    source, target = direction_map[payload.direction]
    commission = Decimal("0")
    commission_cfg = _setting_value(db, tenant.id, "bank_commission", {"card_transfer_percent": 0.5})
    card_transfer_percent = Decimal(str(commission_cfg.get("card_transfer_percent", 0.5) or 0.5))
    if payload.direction in {"card_to_cash", "card_to_debt"}:
        commission = (amount * (card_transfer_percent / Decimal("100"))).quantize(Decimal("0.01"))

    bal = _wallet_balance(db, tenant.id, source)
    if bal < amount + commission:
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
    if commission > 0:
        db.add(
            FinanceEntry(
                tenant_id=tenant.id,
                type="out",
                category="Bank Komissiyası",
                source=source,
                amount=commission,
                description=f"Transfer komissiyası: {payload.direction}",
                created_by=user.username,
            )
        )
    db.commit()
    return {"success": True, "commission": str(commission)}
