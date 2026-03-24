import json
import secrets
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import FinanceEntry, MenuItem, Sale, Tenant
from app.schemas import SaleCreateIn, SaleCreateOut


router = APIRouter(prefix="/api/v1/pos", tags=["pos"])


@router.get("/menu")
def get_menu(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    rows = (
        db.query(MenuItem)
        .filter(MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)
        .order_by(MenuItem.category.asc(), MenuItem.item_name.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "item_name": r.item_name,
            "category": r.category,
            "price": str(r.price),
            "is_coffee": r.is_coffee,
            "is_active": r.is_active,
        }
        for r in rows
    ]


@router.post("/sale", response_model=SaleCreateOut)
def create_sale(payload: SaleCreateIn, db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    if not payload.cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    subtotal = sum((Decimal(str(i.price)) * i.qty for i in payload.cart_items), Decimal("0"))
    discount = (subtotal * (Decimal(str(payload.discount_percent)) / Decimal("100"))).quantize(Decimal("0.01"))
    total = (subtotal - discount).quantize(Decimal("0.01"))

    receipt_code = secrets.token_hex(5).upper()
    receipt_token = secrets.token_hex(10)

    sale = Sale(
        tenant_id=tenant.id,
        cashier=user.username,
        customer_card_id=payload.customer_card_id,
        payment_method=payload.payment_method,
        order_type=payload.order_type,
        receipt_code=receipt_code,
        receipt_token=receipt_token,
        total=total,
        discount_amount=discount,
        items_json=json.dumps([i.model_dump() for i in payload.cart_items], ensure_ascii=False),
        status="COMPLETED",
        created_at=datetime.utcnow(),
    )
    db.add(sale)
    db.flush()

    source = "cash" if payload.payment_method.lower() in ["cash", "nəğd"] else "card"
    db.add(
        FinanceEntry(
            tenant_id=tenant.id,
            type="in",
            category="Satış",
            source=source,
            amount=total,
            description=f"POS Sale {sale.id}",
            created_by=user.username,
        )
    )

    db.commit()

    return {
        "sale_id": sale.id,
        "receipt_code": receipt_code,
        "receipt_token": receipt_token,
        "total": total,
        "created_at": sale.created_at,
    }


@router.post("/sync")
def sync_offline_sales(payload: list[SaleCreateIn], db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user=Depends(get_current_user)):
    synced = 0
    failed = 0
    for row in payload:
        try:
            create_sale(row, db=db, tenant=tenant, user=user)
            synced += 1
        except Exception:
            failed += 1
            db.rollback()
    return {"synced": synced, "failed": failed}