import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import (
    AuditLog,
    DeliveryMenuMapping,
    InventoryItem,
    KitchenOrder,
    MenuItem,
    Recipe,
    Sale,
    Setting,
    Shift,
    StaffNotification,
    Tenant,
    User,
)
from app.realtime import broadcast_tenant_event
from app.services.finance_service import post_sale_cogs, post_sale_payment

router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"])
logger = logging.getLogger(__name__)


# --- Pydantic Schemas for Delivery Menu Mappings ---

class DeliveryMenuMappingCreate(BaseModel):
    provider: str
    external_item_id: str
    external_item_name: str | None = None
    menu_item_id: str


class DeliveryMenuMappingUpdate(BaseModel):
    external_item_id: str | None = None
    external_item_name: str | None = None
    menu_item_id: str | None = None


class DeliveryMenuMappingOut(BaseModel):
    id: str
    tenant_id: str
    provider: str
    external_item_id: str
    external_item_name: str | None = None
    menu_item_id: str
    menu_item_name: str | None = None
    menu_item_price: Decimal | None = None

    class Config:
        from_attributes = True


# --- Mappings CRUD Endpoints ---

@router.get("/menu-mappings", response_model=list[DeliveryMenuMappingOut])
def list_menu_mappings(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    current_user: User = Depends(get_current_user),
):
    if str(current_user.role or "").lower() not in {"admin", "super_admin", "manager"}:
        raise HTTPException(status_code=403, detail="Permission denied")

    rows = (
        db.query(DeliveryMenuMapping, MenuItem)
        .outerjoin(MenuItem, MenuItem.id == DeliveryMenuMapping.menu_item_id)
        .filter(DeliveryMenuMapping.tenant_id == tenant.id)
        .all()
    )

    result = []
    for mapping, item in rows:
        result.append(
            DeliveryMenuMappingOut(
                id=mapping.id,
                tenant_id=mapping.tenant_id,
                provider=mapping.provider,
                external_item_id=mapping.external_item_id,
                external_item_name=mapping.external_item_name,
                menu_item_id=mapping.menu_item_id,
                menu_item_name=item.item_name if item else None,
                menu_item_price=item.price if item else None,
            )
        )
    return result


@router.post("/menu-mappings", response_model=DeliveryMenuMappingOut)
def create_menu_mapping(
    payload: DeliveryMenuMappingCreate,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    current_user: User = Depends(get_current_user),
):
    if str(current_user.role or "").lower() not in {"admin", "super_admin", "manager"}:
        raise HTTPException(status_code=403, detail="Permission denied")

    provider = payload.provider.strip().lower()
    if provider not in {"bolt", "wolt"}:
        raise HTTPException(status_code=400, detail="Provider must be 'bolt' or 'wolt'")

    # Check if menu item exists
    menu_item = db.query(MenuItem).filter(MenuItem.id == payload.menu_item_id, MenuItem.tenant_id == tenant.id).first()
    if not menu_item:
        raise HTTPException(status_code=404, detail="Internal Menu Item not found")

    # Check duplicate
    existing = db.query(DeliveryMenuMapping).filter(
        DeliveryMenuMapping.tenant_id == tenant.id,
        DeliveryMenuMapping.provider == provider,
        DeliveryMenuMapping.external_item_id == payload.external_item_id
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Mapping rule already exists for this external ID")

    mapping = DeliveryMenuMapping(
        tenant_id=tenant.id,
        provider=provider,
        external_item_id=payload.external_item_id.strip(),
        external_item_name=payload.external_item_name.strip() if payload.external_item_name else None,
        menu_item_id=payload.menu_item_id,
    )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)

    return DeliveryMenuMappingOut(
        id=mapping.id,
        tenant_id=mapping.tenant_id,
        provider=mapping.provider,
        external_item_id=mapping.external_item_id,
        external_item_name=mapping.external_item_name,
        menu_item_id=mapping.menu_item_id,
        menu_item_name=menu_item.item_name,
        menu_item_price=menu_item.price,
    )


@router.patch("/menu-mappings/{mapping_id}", response_model=DeliveryMenuMappingOut)
def update_menu_mapping(
    mapping_id: str,
    payload: DeliveryMenuMappingUpdate,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    current_user: User = Depends(get_current_user),
):
    if str(current_user.role or "").lower() not in {"admin", "super_admin", "manager"}:
        raise HTTPException(status_code=403, detail="Permission denied")

    mapping = db.query(DeliveryMenuMapping).filter(DeliveryMenuMapping.id == mapping_id, DeliveryMenuMapping.tenant_id == tenant.id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping rule not found")

    if payload.menu_item_id is not None:
        menu_item = db.query(MenuItem).filter(MenuItem.id == payload.menu_item_id, MenuItem.tenant_id == tenant.id).first()
        if not menu_item:
            raise HTTPException(status_code=404, detail="Internal Menu Item not found")
        mapping.menu_item_id = payload.menu_item_id

    if payload.external_item_id is not None:
        ext_id = payload.external_item_id.strip()
        if not ext_id:
            raise HTTPException(status_code=400, detail="External item ID cannot be empty")
        if ext_id != mapping.external_item_id:
            existing = db.query(DeliveryMenuMapping).filter(
                DeliveryMenuMapping.tenant_id == tenant.id,
                DeliveryMenuMapping.provider == mapping.provider,
                DeliveryMenuMapping.external_item_id == ext_id
            ).first()
            if existing:
                raise HTTPException(status_code=409, detail="Mapping rule already exists for this external ID")
        mapping.external_item_id = ext_id

    if payload.external_item_name is not None:
        mapping.external_item_name = payload.external_item_name.strip() if payload.external_item_name else None

    db.commit()
    db.refresh(mapping)

    menu_item = db.query(MenuItem).filter(MenuItem.id == mapping.menu_item_id).first()
    return DeliveryMenuMappingOut(
        id=mapping.id,
        tenant_id=mapping.tenant_id,
        provider=mapping.provider,
        external_item_id=mapping.external_item_id,
        external_item_name=mapping.external_item_name,
        menu_item_id=mapping.menu_item_id,
        menu_item_name=menu_item.item_name if menu_item else None,
        menu_item_price=menu_item.price if menu_item else None,
    )


@router.delete("/menu-mappings/{mapping_id}")
def delete_menu_mapping(
    mapping_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    current_user: User = Depends(get_current_user),
):
    if str(current_user.role or "").lower() not in {"admin", "super_admin", "manager"}:
        raise HTTPException(status_code=403, detail="Permission denied")

    mapping = db.query(DeliveryMenuMapping).filter(DeliveryMenuMapping.id == mapping_id, DeliveryMenuMapping.tenant_id == tenant.id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping rule not found")

    db.delete(mapping)
    db.commit()
    return {"success": True}


def _verify_signature(body_bytes: bytes, secret_key: str, header_signature: str) -> bool:
    if not secret_key:
        return False
    computed = hmac.new(secret_key.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed, header_signature)


async def process_delivery_order_logic(
    db: Session,
    tenant: Tenant,
    provider: str,  # "bolt" or "wolt"
    order_id: str,
    raw_items: list,
) -> dict:
    tenant_id = tenant.id
    provider_title = "Bolt Food" if provider == "bolt" else "Wolt"
    cashier_name = "Bolt Food Integration" if provider == "bolt" else "Wolt Integration"

    # 5. Check duplicate (idempotency)
    existing_sale = db.query(Sale).filter(Sale.tenant_id == tenant_id, Sale.offline_request_id == order_id).first()
    if existing_sale:
        return {"status": "ok", "message": "Order already processed", "sale_id": existing_sale.id}

    # 6. Verify active shift
    active_shift = db.query(Shift).filter(Shift.tenant_id == tenant_id, Shift.status == "open").first()
    if not active_shift:
        raise HTTPException(status_code=400, detail="Active shift is not open. Please open the shift in POS.")

    # 7. Map items and calculate price
    cart_items = []
    cogs_total = Decimal("0.0000")
    stock_ops = []

    for item in raw_items:
        ext_id = str(item.get("id") or "").strip()
        item_name = str(item.get("name") or "").strip()
        qty = int(item.get("quantity") or 1)
        price_val = Decimal(str(item.get("price") or 0))

        # Look up menu item
        menu_item = None
        if ext_id:
            mapping = db.query(DeliveryMenuMapping).filter(
                DeliveryMenuMapping.tenant_id == tenant_id,
                DeliveryMenuMapping.provider == provider,
                DeliveryMenuMapping.external_item_id == ext_id
            ).first()
            if mapping:
                menu_item = db.query(MenuItem).filter(
                    MenuItem.tenant_id == tenant_id,
                    MenuItem.id == mapping.menu_item_id,
                    MenuItem.is_active == True
                ).first()
            if not menu_item:
                menu_item = db.query(MenuItem).filter(
                    MenuItem.tenant_id == tenant_id,
                    MenuItem.id == ext_id,
                    MenuItem.is_active == True
                ).first()
        if not menu_item and item_name:
            menu_item = db.query(MenuItem).filter(
                MenuItem.tenant_id == tenant_id,
                func.lower(MenuItem.item_name) == item_name.lower(),
                MenuItem.is_active == True
            ).first()

        if menu_item:
            mapped_name = menu_item.item_name
            mapped_category = menu_item.category
            is_coffee = menu_item.is_coffee
            unit_price = price_val
        else:
            mapped_name = f"{provider_title} Məhsulu ({item_name})" if item_name else f"{provider_title} Məhsulu ({ext_id})"
            mapped_category = "Delivery"
            is_coffee = False
            unit_price = price_val

        cart_items.append({
            "item_name": mapped_name,
            "price": str(unit_price),
            "qty": qty,
            "category": mapped_category,
            "is_coffee": is_coffee,
        })

        if menu_item:
            recipes = db.query(Recipe).filter(Recipe.tenant_id == tenant_id, func.lower(Recipe.menu_item_name) == menu_item.item_name.lower()).all()
            for recipe in recipes:
                inventory = db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant_id, func.lower(InventoryItem.name) == recipe.ingredient_name.lower()).first()
                if inventory:
                    qty_required = (Decimal(str(recipe.quantity_required)) * qty).quantize(Decimal("0.0001"))
                    stock_ops.append((inventory, qty_required))
                    cogs_total += (qty_required * Decimal(str(inventory.unit_cost or 0))).quantize(Decimal("0.0001"))

    if not cart_items:
        raise HTTPException(status_code=400, detail="Order has no items")

    subtotal = sum((Decimal(item["price"]) * item["qty"] for item in cart_items), Decimal("0"))
    total = subtotal.quantize(Decimal("0.01"))

    # 8. Create Sale
    sale = Sale(
        tenant_id=tenant_id,
        cashier=cashier_name,
        payment_method="card",
        order_type="Delivery",
        offline_request_id=order_id,
        receipt_code=secrets.token_hex(5).upper(),
        receipt_token=secrets.token_hex(10),
        total=total,
        discount_amount=Decimal("0.00"),
        cogs=cogs_total.quantize(Decimal("0.0001")),
        items_json=json.dumps(cart_items, ensure_ascii=False),
        status="COMPLETED",
        created_at=datetime.utcnow(),
    )
    db.add(sale)
    db.flush()

    for inventory, qty_required in stock_ops:
        inventory.stock_qty = (Decimal(str(inventory.stock_qty)) - qty_required).quantize(Decimal("0.001"))
        db.add(
            AuditLog(
                tenant_id=tenant_id,
                user=cashier_name,
                action="INVENTORY_CONSUMED",
                details=json.dumps(
                    {
                        "item_name": inventory.name,
                        "qty_removed": str(qty_required),
                        "unit": inventory.unit,
                        "remaining_qty": str(inventory.stock_qty),
                        "sale_id": sale.id,
                        "source": f"{provider}_webhook",
                    },
                    ensure_ascii=False,
                ),
            )
        )

    post_sale_payment(
        db,
        tenant_id=tenant_id,
        sale_id=sale.id,
        amount=total,
        payment_source="card",
        created_by=cashier_name,
        category="Satış (Kart)",
        note=f"{provider_title} Order {order_id}",
    )

    post_sale_cogs(
        db,
        tenant_id=tenant_id,
        sale_id=sale.id,
        amount=Decimal(str(cogs_total or 0)).quantize(Decimal("0.01")),
        created_by=cashier_name,
        note=f"{provider_title} order COGS {sale.id}",
    )

    # 9. Create KitchenOrder
    kitchen_order = KitchenOrder(
        tenant_id=tenant_id,
        sale_id=sale.id,
        table_label=f"{provider_title} #{order_id[-5:]}" if len(order_id) >= 5 else f"{provider_title} #{order_id}",
        order_type="Delivery",
        status="NEW",
        priority="NORMAL",
        items_json=json.dumps(cart_items, ensure_ascii=False),
    )
    db.add(kitchen_order)
    db.flush()

    # 10. Create StaffNotification
    summarized_items_text = ", ".join([f"{item['qty']}x {item['item_name']}" for item in cart_items])[:180]
    active_users = db.query(User).filter(User.tenant_id == tenant_id, User.is_active == True).all()
    allowed_roles = {"staff", "manager", "admin", "super_admin"}
    usernames = [row.username for row in active_users if str(row.role or "").lower() in allowed_roles]

    for username in usernames:
        db.add(
            StaffNotification(
                tenant_id=tenant_id,
                username=username,
                title=f"Yeni {provider_title} Sifarişi",
                message=f"{provider_title} sifarişi #{order_id[-5:] if len(order_id) >= 5 else order_id} mətbəxə ötürüldü: {summarized_items_text}",
                meta_json=json.dumps({"sale_id": sale.id, "kitchen_order_id": kitchen_order.id}, ensure_ascii=False),
                is_read=False,
            )
        )

    db.commit()

    # 11. Broadcast realtime event
    await broadcast_tenant_event(tenant_id, "kitchen.updated", {})

    return {"status": "ok", "message": "Order processed successfully", "sale_id": sale.id}


@router.post("/bolt/webhook/{tenant_id}")
async def bolt_webhook(
    tenant_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    # 1. Resolve tenant
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if tenant.status != "active":
        raise HTTPException(status_code=403, detail="Tenant is suspended")


    # 2. Fetch delivery integrations settings
    setting_row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == "delivery_integrations").first()
    settings_dict = {}
    if setting_row and setting_row.value:
        try:
            settings_dict = json.loads(setting_row.value)
        except Exception:
            pass

    if not settings_dict.get("bolt_food_enabled"):
        raise HTTPException(status_code=400, detail="Bolt Food integration is disabled")

    # 3. Read body bytes and verify signature
    body_bytes = await request.body()
    secret_key = str(settings_dict.get("bolt_food_secret_key") or "").strip()
    if secret_key:
        signature = request.headers.get("X-Bolt-Signature") or ""
        if not signature or not _verify_signature(body_bytes, secret_key, signature):
            raise HTTPException(status_code=401, detail="Invalid X-Bolt-Signature")

    # 4. Parse payload
    try:
        payload = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    order_id = str(payload.get("order_id") or "").strip()
    if not order_id:
        raise HTTPException(status_code=400, detail="Missing order_id")

    raw_items = payload.get("items") or []

    # 5. Call processing logic
    return await process_delivery_order_logic(db, tenant, "bolt", order_id, raw_items)


@router.post("/wolt/webhook/{tenant_id}")
async def wolt_webhook(
    tenant_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    # 1. Resolve tenant
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if tenant.status != "active":
        raise HTTPException(status_code=403, detail="Tenant is suspended")


    # 2. Fetch delivery integrations settings
    setting_row = db.query(Setting).filter(Setting.tenant_id == tenant_id, Setting.key == "delivery_integrations").first()
    settings_dict = {}
    if setting_row and setting_row.value:
        try:
            settings_dict = json.loads(setting_row.value)
        except Exception:
            pass

    if not settings_dict.get("wolt_enabled"):
        raise HTTPException(status_code=400, detail="Wolt integration is disabled")

    # 3. Read body bytes and verify signature
    body_bytes = await request.body()
    secret_key = str(settings_dict.get("wolt_client_secret") or "").strip()
    if secret_key:
        signature = request.headers.get("X-Wolt-Signature") or ""
        if not signature or not _verify_signature(body_bytes, secret_key, signature):
            raise HTTPException(status_code=401, detail="Invalid X-Wolt-Signature")

    # 4. Parse payload
    try:
        payload = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    order_id = str(payload.get("order_id") or "").strip()
    if not order_id:
        raise HTTPException(status_code=400, detail="Missing order_id")

    raw_items = payload.get("items") or []

    # 5. Call processing logic
    return await process_delivery_order_logic(db, tenant, "wolt", order_id, raw_items)
