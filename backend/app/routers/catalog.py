from app.services.recipe_links import ingredient_link, menu_link, unique_named_item
from app.services.inventory_requests import inventory_request
from app.services.inventory_lock import lock_inventory
import json
import uuid
from pathlib import Path
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, case
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_tenant
from app.models import AuditLog, InventoryItem, MenuItem, Recipe, Tenant, User, Supplier
from app.schemas import InventoryItemCreateIn, InventoryItemUpdateIn, InventoryRestockIn, InventoryLossIn, MenuItemCreateIn, MenuItemUpdateIn, RecipeIngredientCreateIn
from app.services.finance_service import post_inventory_loss, post_inventory_restock


router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])

MAX_IMAGE_URL_LENGTH = 2048
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}
ALLOWED_VIDEO_TYPES = {"video/mp4": ".mp4"}
ALLOWED_MEDIA_TYPES = {**ALLOWED_IMAGE_TYPES, **ALLOWED_VIDEO_TYPES}
MAX_VIDEO_UPLOAD_BYTES = 2 * 1024 * 1024
MENU_UPLOADS_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "menu-images"


def _validate_image_url(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if normalized.startswith("data:"):
        raise HTTPException(status_code=400, detail="image_url must be a normal URL, raw data images are not allowed")
    if len(normalized) > MAX_IMAGE_URL_LENGTH:
        raise HTTPException(status_code=400, detail=f"image_url too long (max {MAX_IMAGE_URL_LENGTH} chars)")
    return normalized


def _normalize_menu_image_url(value: str | None) -> str:
    """Normalize stored image URLs to relative paths for consistent serving."""
    url = str(value or "").strip()
    if not url:
        return ""
    # Convert absolute URLs pointing to our uploads to relative paths
    uploads_marker = "/uploads/menu-images/"
    idx = url.find(uploads_marker)
    if idx >= 0:
        return url[idx:]
    return url


def _ensure_catalog_write_access(user: User):
    if str(user.role or "").lower() not in {"admin", "super_admin", "manager"}:
        raise HTTPException(status_code=403, detail="Catalog write access required")


@router.post("/uploads/menu-image")
async def upload_menu_image(
    request: Request,
    file: UploadFile = File(...),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    content_type = str(file.content_type or "").lower().strip()
    is_video = content_type in ALLOWED_VIDEO_TYPES
    if content_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(status_code=400, detail="only jpeg/png/webp/gif/mp4 file types are allowed")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="empty file")
    max_bytes = MAX_VIDEO_UPLOAD_BYTES if is_video else MAX_UPLOAD_BYTES
    if len(payload) > max_bytes:
        raise HTTPException(status_code=400, detail=f"file too large (max {max_bytes // (1024*1024)}MB)")

    # Validate actual file content via magic bytes
    magic_signatures = {
        b"\xff\xd8\xff": "image/jpeg",
        b"\x89PNG\r\n\x1a\n": "image/png",
        b"RIFF": "image/webp",
        b"GIF87a": "image/gif",
        b"GIF89a": "image/gif",
        b"\x00\x00\x00": "video/mp4",  # MP4 ftyp box starts with size bytes
    }
    detected_type = None
    for magic, mime in magic_signatures.items():
        if payload[:len(magic)] == magic:
            detected_type = mime
            break
    # MP4 additional check: ftyp marker at byte 4
    if not detected_type and len(payload) > 8 and payload[4:8] == b"ftyp":
        detected_type = "video/mp4"
    if not detected_type:
        raise HTTPException(status_code=400, detail="File content does not match a valid format")
    if detected_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(status_code=400, detail=f"Detected format {detected_type} is not allowed")

    tenant_dir = MENU_UPLOADS_ROOT / str(tenant.id)
    tenant_dir.mkdir(parents=True, exist_ok=True)
    ext = ALLOWED_MEDIA_TYPES.get(content_type, ALLOWED_MEDIA_TYPES.get(detected_type, ".bin"))
    filename = f"{uuid.uuid4().hex}{ext}"
    full_path = tenant_dir / filename
    with open(full_path, "wb") as output:
        output.write(payload)

    base = str(request.base_url).rstrip("/")
    image_url = f"/uploads/menu-images/{tenant.id}/{filename}"
    return {"success": True, "image_url": image_url}


def _normalize_unit(raw: str) -> str:
    value = str(raw or "").strip().lower()
    aliases = {
        "kg": "kq",
        "kq": "kq",
        "qram": "qram",
        "gr": "qram",
        "g": "qram",
        "l": "litr",
        "lt": "litr",
        "litr": "litr",
        "liter": "litr",
        "ml": "ml",
        "m": "metr",
        "metr": "metr",
        "meter": "metr",
        "sm": "sm",
        "cm": "sm",
        "eded": "ədəd",
        "ədəd": "ədəd",
        "adet": "ədəd",
        "piece": "ədəd",
        "pomp": "pomp",
        "pump": "pomp",
        "paket": "paket",
        "qutu": "qutu",
    }
    return aliases.get(value, value)


def _convert_recipe_qty_to_inventory_unit(quantity: Decimal, from_unit: str, inventory_unit: str) -> Decimal:
    from_normalized = _normalize_unit(from_unit)
    inventory_normalized = _normalize_unit(inventory_unit)
    if not from_normalized or from_normalized == inventory_normalized:
        return quantity

    conversions = {
        ("qram", "kq"): Decimal("0.001"),
        ("kq", "qram"): Decimal("1000"),
        ("ml", "litr"): Decimal("0.001"),
        ("litr", "ml"): Decimal("1000"),
        ("pomp", "litr"): Decimal("0.01"),
        ("litr", "pomp"): Decimal("100"),
        ("pomp", "ml"): Decimal("10"),
        ("ml", "pomp"): Decimal("0.1"),
        ("sm", "metr"): Decimal("0.01"),
        ("metr", "sm"): Decimal("100"),
    }
    factor = conversions.get((from_normalized, inventory_normalized))
    if factor is None:
        raise HTTPException(status_code=400, detail=f"{from_unit} vahidi {inventory_unit} ilə uyğun deyil")
    return quantity * factor


def _persistable_recipe_qty(quantity: Decimal, from_unit: str, inventory_unit: str) -> Decimal:
    converted = _convert_recipe_qty_to_inventory_unit(quantity, from_unit, inventory_unit).quantize(Decimal("0.0001"))
    if converted <= 0:
        raise HTTPException(400, "Resept miqdarı əsas vahiddə ən azı 0.0001 olmalıdır")
    return converted


def _resolve_receipt_supplier(db: Session, tenant_id: str, supplier_id: str | None, amount: Decimal, payment_source: str | None = None) -> Supplier | None:
    """Resolve the stock receipt's supplier (404 when not in this tenant).

    When the tenant's ``finance_v2_require_supplier`` setting is on (default off, independent of the ledger
    mode) every receipt with a value needs a real supplier, so the AP line (or the cash purchase) is never
    left unassigned. Otherwise the supplier stays optional.
    """
    from app.gl.bridge import require_supplier

    supplier = None
    if supplier_id:
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.tenant_id == tenant_id).first()
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")
    if supplier is None and amount > 0 and (str(payment_source or "").lower() == "payable" or require_supplier(db, tenant_id)):
        raise HTTPException(
            status_code=400,
            detail={"code": "supplier_required", "message": "Select a supplier for this stock receipt (required for this business)"},
        )
    return supplier


def _add_supplier_payable(supplier: Supplier | None, payment_source: str | None, amount: Decimal) -> None:
    """A receipt on credit raises the supplier's operational balance (paid back via suppliers.pay_supplier)."""
    if supplier is not None and str(payment_source or "payable").strip().lower() == "payable":
        supplier.balance += amount


def _log_inventory_audit(db: Session, tenant_id: str, username: str, action: str, details: dict):
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            user=username,
            action=action,
            details=json.dumps(details, ensure_ascii=False),
        )
    )


class InventoryItemOut(BaseModel):
    id: str
    tenant_id: str
    name: str
    unit: str
    category: str | None = None
    type: str | None = None
    stock_qty: str
    unit_cost: str
    min_limit: str
    expiry_required: bool = False
    legacy_negative_allowed: bool = False
    cost_basis_unit_cost: str = "0"


class MenuItemOut(BaseModel):
    id: str
    tenant_id: str
    item_name: str
    category: str
    price: str
    is_coffee: bool
    sort_order: int
    image_url: str | None = None
    description: str | None = None
    is_active: bool


class MenuReorderIn(BaseModel):
    item_ids: list[str]


class RecipeIngredientOut(BaseModel):
    id: str
    tenant_id: str
    menu_item_name: str
    ingredient_name: str
    quantity_required: str
    unit: str
    unit_cost: str
    line_cost: str
    inventory_item_id: str | None = None
    menu_item_id: str | None = None


class RecipeIngredientReplaceIn(BaseModel):
    inventory_item_id: str | None = None
    ingredient_name: str
    quantity_required: Decimal = Field(gt=0, decimal_places=4)
    quantity_unit: str | None = None


class RecipeReplaceIn(BaseModel):
    menu_item_name: str
    ingredients: list[RecipeIngredientReplaceIn]


@router.get("/public-menu", response_model=list[MenuItemOut])
def list_public_menu_items(
    response: Response,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    rows = (
        db.query(MenuItem)
        .filter(MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)
        .order_by(MenuItem.sort_order.asc(), MenuItem.category.asc(), MenuItem.item_name.asc())
        .all()
    )
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "item_name": row.item_name,
            "category": row.category,
            "price": str(row.price),
            "is_coffee": bool(row.is_coffee),
            "sort_order": int(row.sort_order or 0),
            "image_url": _normalize_menu_image_url(row.image_url),
            "description": row.description or "",
            "is_active": bool(row.is_active),
        }
        for row in rows
    ]


@router.get("/menu", response_model=list[MenuItemOut])
def list_menu_items(
    response: Response,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    response.headers["Cache-Control"] = "private, max-age=30, stale-while-revalidate=300"
    rows = (
        db.query(MenuItem)
        .filter(MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)
        .order_by(MenuItem.sort_order.asc(), MenuItem.category.asc(), MenuItem.item_name.asc())
        .all()
    )
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "item_name": row.item_name,
            "category": row.category,
            "price": str(row.price),
            "is_coffee": bool(row.is_coffee),
            "sort_order": int(row.sort_order or 0),
            "image_url": _normalize_menu_image_url(row.image_url),
            "description": row.description or "",
            "is_active": bool(row.is_active),
        }
        for row in rows
    ]


@router.post("/menu", response_model=MenuItemOut)
def create_menu_item(
    payload: MenuItemCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    item_name = str(payload.item_name or "").strip()
    category = str(payload.category or "").strip()
    if len(item_name) < 2:
        raise HTTPException(status_code=400, detail="Item name is required")
    if len(category) < 2:
        raise HTTPException(status_code=400, detail="Category is required")

    existing = (
        db.query(MenuItem)
        .filter(
            MenuItem.tenant_id == tenant.id,
            func.lower(MenuItem.item_name) == item_name.lower(),
            MenuItem.is_active == True,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Menu item already exists")

    current_max_sort = (
        db.query(func.coalesce(func.max(MenuItem.sort_order), 0))
        .filter(MenuItem.tenant_id == tenant.id)
        .scalar()
    )

    row = MenuItem(
        tenant_id=tenant.id,
        item_name=item_name,
        category=category,
        price=Decimal(str(payload.price)),
        is_coffee=bool(payload.is_coffee),
        sort_order=int(current_max_sort or 0) + 1,
        image_url=_validate_image_url(payload.image_url),
        description=str(payload.description or "").strip() or None,
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "item_name": row.item_name,
        "category": row.category,
        "price": str(row.price),
        "is_coffee": bool(row.is_coffee),
        "sort_order": int(row.sort_order or 0),
        "image_url": _normalize_menu_image_url(row.image_url),
        "description": row.description or "",
        "is_active": bool(row.is_active),
    }


@router.post("/menu/reorder")
def reorder_menu_items(
    payload: MenuReorderIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    submitted_ids = [str(item_id or "").strip() for item_id in payload.item_ids if str(item_id or "").strip()]
    active_rows = (
        db.query(MenuItem)
        .filter(MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)
        .order_by(MenuItem.sort_order.asc(), MenuItem.category.asc(), MenuItem.item_name.asc(), MenuItem.id.asc())
        .all()
    )
    if not active_rows:
        return {"success": True, "updated": 0}

    by_id = {row.id: row for row in active_rows}
    next_ids: list[str] = []
    seen: set[str] = set()
    for item_id in submitted_ids:
        if item_id in by_id and item_id not in seen:
            next_ids.append(item_id)
            seen.add(item_id)
    for row in active_rows:
        if row.id not in seen:
            next_ids.append(row.id)
            seen.add(row.id)

    updated = 0
    for index, item_id in enumerate(next_ids):
        row = by_id[item_id]
        if int(row.sort_order or 0) != index:
            row.sort_order = index
            updated += 1
    if updated:
        db.commit()
    return {"success": True, "updated": updated}


@router.delete("/menu/{item_id}")
def soft_delete_menu_item(
    item_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    row = (
        db.query(MenuItem)
        .filter(MenuItem.id == item_id, MenuItem.tenant_id == tenant.id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Menu item not found")
    if row.is_active:
        row.is_active = False
        db.commit()
    return {"success": True}


@router.patch("/menu/{item_id}", response_model=MenuItemOut)
def update_menu_item(
    item_id: str,
    payload: MenuItemUpdateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    row = (
        db.query(MenuItem)
        .filter(MenuItem.id == item_id, MenuItem.tenant_id == tenant.id, MenuItem.is_active == True)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Menu item not found")

    if payload.item_name is not None:
        next_name = str(payload.item_name or "").strip()
        if len(next_name) < 2:
            raise HTTPException(status_code=400, detail="Item name is required")
        duplicate = (
            db.query(MenuItem)
            .filter(
                MenuItem.tenant_id == tenant.id,
                MenuItem.id != row.id,
                func.lower(MenuItem.item_name) == next_name.lower(),
                MenuItem.is_active == True,
            )
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="Menu item already exists")
        row.item_name = next_name
    if payload.category is not None:
        next_category = str(payload.category or "").strip()
        if len(next_category) < 2:
            raise HTTPException(status_code=400, detail="Category is required")
        row.category = next_category
    if payload.price is not None:
        row.price = Decimal(str(payload.price))
    if payload.is_coffee is not None:
        row.is_coffee = bool(payload.is_coffee)
    if payload.image_url is not None:
        row.image_url = _validate_image_url(payload.image_url)
    if payload.description is not None:
        row.description = str(payload.description or "").strip() or None

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="MENU_EDIT",
            details=json.dumps(
                {
                    "item_id": row.id,
                    "item_name": row.item_name,
                    "category": row.category,
                    "price": str(row.price),
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "item_name": row.item_name,
        "category": row.category,
        "price": str(row.price),
        "is_coffee": bool(row.is_coffee),
        "sort_order": int(row.sort_order or 0),
        "image_url": _normalize_menu_image_url(row.image_url),
        "description": row.description or "",
        "is_active": bool(row.is_active),
    }


@router.get("/inventory/policy")
def get_inventory_policy(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    """Receipt rules the Inventory panel must follow. Any authenticated role of the tenant may read it (like the list)."""
    from app.gl.bridge import require_supplier

    return {"require_supplier": require_supplier(db, tenant.id)}


@router.get("/inventory", response_model=list[InventoryItemOut])
def list_inventory_items(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    rows = (
        db.query(InventoryItem)
        .filter(InventoryItem.tenant_id == tenant.id)
        .order_by(InventoryItem.name.asc())
        .all()
    )
    return [
        {
            "id": row.id,
            "tenant_id": row.tenant_id,
            "name": row.name,
            "unit": row.unit,
            "category": row.category,
            "type": row.category,
            "stock_qty": str(row.stock_qty),
            "unit_cost": str(row.unit_cost),
            "min_limit": str(row.min_limit),
        "expiry_required": bool(row.expiry_required),
        "legacy_negative_allowed": bool(row.legacy_negative_allowed),
        "cost_basis_unit_cost": str(row.cost_basis_unit_cost),
        }
        for row in rows
    ]


@router.post("/inventory", response_model=InventoryItemOut)
@inventory_request("inventory:create")
def create_inventory_item(
    payload: InventoryItemCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    lock_inventory(db, tenant.id)
    _ensure_catalog_write_access(user)
    name = str(payload.name or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Inventory item name is required")

    existing = (
        db.query(InventoryItem)
        .filter(
            InventoryItem.tenant_id == tenant.id,
            func.lower(InventoryItem.name) == name.lower(),
        )
        .first()
    )
    db.info["inventory_context"] = {"kind": "INVENTORY_ADD", "actor": user.username,
        "lot_code": payload.lot_code, "expires_on": payload.expires_on, "batch_status": payload.batch_status,
        "purchase_unit_cost": payload.unit_cost, "supplier_id": payload.supplier_id, "invoice_no": payload.invoice_no}
    if existing:
        if _normalize_unit(payload.unit) != _normalize_unit(existing.unit):
            raise HTTPException(status_code=409, detail="Eyni məhsula fərqli ölçü vahidində mədaxil edilə bilməz.")
        incoming_qty = Decimal(str(payload.stock_qty)).quantize(Decimal("0.001"))
        incoming_unit_cost = Decimal(str(payload.unit_cost)).quantize(Decimal("0.0001"))
        incoming_total_value_exact = incoming_qty * incoming_unit_cost
        incoming_total_value = incoming_total_value_exact.quantize(Decimal("0.01"))
        supplier = _resolve_receipt_supplier(db, tenant.id, payload.supplier_id, incoming_total_value, payload.payment_source)
        old_basis = Decimal(str(existing.stock_qty)) * Decimal(str(existing.cost_basis_unit_cost))
        old_total_value = Decimal(str(existing.stock_qty)) * Decimal(str(existing.unit_cost))
        new_total_qty = (Decimal(str(existing.stock_qty)) + incoming_qty).quantize(Decimal("0.001"))
        existing.cost_basis_unit_cost = (Decimal("0") if new_total_qty <= 0 else (old_basis + incoming_total_value_exact) / new_total_qty).quantize(Decimal("0.0001"))
        existing.stock_qty = new_total_qty
        existing.unit_cost = (
            Decimal("0") if new_total_qty <= 0 else (old_total_value + incoming_total_value_exact) / new_total_qty
        ).quantize(Decimal("0.0001"))
        if payload.expiry_required:
            existing.expiry_required = True
        existing.min_limit = Decimal(str(payload.min_limit)).quantize(Decimal("0.001"))
        existing.unit = str(payload.unit or existing.unit).strip()
        existing.category = str(payload.category or existing.category or "").strip() or None
        _log_inventory_audit(
            db,
            tenant.id,
            user.username,
            "INVENTORY_ADD",
            {
                "item_name": existing.name,
                "qty": str(incoming_qty),
                "unit": existing.unit,
                "unit_cost": str(incoming_unit_cost),
                "mode": "merge",
            },
        )
        _add_supplier_payable(supplier, payload.payment_source, incoming_total_value)
        post_inventory_restock(
            db,
            tenant_id=tenant.id,
            amount=incoming_total_value,
            created_by=user.username,
            payment_source=str(payload.payment_source or "payable"),
            category="Xammal Mədaxili",
            note=f"{existing.name} mədaxili ({incoming_qty} {existing.unit})",
            reference=str(payload.invoice_no or (supplier.name if supplier else payload.supplier) or existing.id),
            supplier_id=supplier.id if supplier else None,
        )
        db.flush()
        db.refresh(existing)
        row = existing
    else:
        opening_qty = Decimal(str(payload.stock_qty)).quantize(Decimal("0.001"))
        opening_unit_cost = Decimal(str(payload.unit_cost)).quantize(Decimal("0.0001"))
        opening_total_value = (opening_qty * opening_unit_cost).quantize(Decimal("0.01"))
        supplier = _resolve_receipt_supplier(db, tenant.id, payload.supplier_id, opening_total_value, payload.payment_source)
        row = InventoryItem(
            tenant_id=tenant.id,
            name=name,
            unit=str(payload.unit or "").strip(),
            category=str(payload.category or payload.type or "").strip() or None,
            stock_qty=opening_qty,
            unit_cost=opening_unit_cost,
            cost_basis_unit_cost=opening_unit_cost,
            expiry_required=payload.expiry_required,
            min_limit=Decimal(str(payload.min_limit)).quantize(Decimal("0.001")),
        )
        db.add(row)
        _log_inventory_audit(
            db,
            tenant.id,
            user.username,
            "INVENTORY_ADD",
            {
                "item_name": row.name,
                "qty": str(row.stock_qty),
                "unit": row.unit,
                "unit_cost": str(row.unit_cost),
                "mode": "create",
            },
        )
        _add_supplier_payable(supplier, payload.payment_source, opening_total_value)
        post_inventory_restock(
            db,
            tenant_id=tenant.id,
            amount=opening_total_value,
            created_by=user.username,
            payment_source=str(payload.payment_source or "payable"),
            category="Xammal Mədaxili",
            note=f"{row.name} ilkin mədaxil ({opening_qty} {row.unit})",
            reference=str(payload.invoice_no or (supplier.name if supplier else payload.supplier) or row.name),
            supplier_id=supplier.id if supplier else None,
        )
        db.flush()
        db.refresh(row)

    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "unit": row.unit,
        "category": row.category,
        "type": row.category,
        "stock_qty": str(row.stock_qty),
        "unit_cost": str(row.unit_cost),
        "min_limit": str(row.min_limit),
        "expiry_required": bool(row.expiry_required),
        "legacy_negative_allowed": bool(row.legacy_negative_allowed),
        "cost_basis_unit_cost": str(row.cost_basis_unit_cost),
    }


@router.put("/inventory/{item_id}", response_model=InventoryItemOut)
def update_inventory_item(
    item_id: str,
    payload: InventoryItemUpdateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    lock_inventory(db, tenant.id)
    _ensure_catalog_write_access(user)
    row = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    before = {
        "name": row.name,
        "unit": row.unit,
        "category": row.category,
        "min_limit": str(row.min_limit),
        "expiry_required": bool(row.expiry_required),
        "legacy_negative_allowed": bool(row.legacy_negative_allowed),
        "cost_basis_unit_cost": str(row.cost_basis_unit_cost),
    }

    if payload.name is not None:
        name = str(payload.name or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="Inventory item name is required")
        duplicate = (
            db.query(InventoryItem)
            .filter(
                InventoryItem.tenant_id == tenant.id,
                InventoryItem.id != item_id,
                func.lower(InventoryItem.name) == name.lower(),
            )
            .first()
        )
        if duplicate:
            raise HTTPException(status_code=400, detail="Inventory item with this name already exists")
        db.query(Recipe).filter(
            Recipe.tenant_id == tenant.id,
            or_(Recipe.inventory_item_id == row.id, (Recipe.inventory_item_id.is_(None)) & (func.lower(func.trim(Recipe.ingredient_name)) == str(row.name).strip().lower())),
        ).update({Recipe.ingredient_name: name}, synchronize_session=False)
        row.name = name

    if payload.unit is not None:
        unit = str(payload.unit or "").strip()
        if not unit:
            raise HTTPException(status_code=400, detail="Inventory unit is required")
        if _normalize_unit(unit) != _normalize_unit(row.unit):
            raise HTTPException(status_code=409, detail="Məhsulun əsas ölçü vahidi dəyişdirilə bilməz. Yeni vahid üçün ayrıca məhsul yaradın.")
        row.unit = unit

    if payload.category is not None or payload.type is not None:
        category = payload.category if payload.category is not None else payload.type
        row.category = str(category or "").strip() or None

    if payload.legacy_negative_allowed is not None:
        row.legacy_negative_allowed = payload.legacy_negative_allowed

    if payload.expiry_required is not None:
        row.expiry_required = payload.expiry_required

    if payload.min_limit is not None:
        min_limit = Decimal(str(payload.min_limit)).quantize(Decimal("0.001"))
        if min_limit < 0:
            raise HTTPException(status_code=400, detail="Min limit cannot be negative")
        row.min_limit = min_limit

    after = {
        "name": row.name,
        "unit": row.unit,
        "category": row.category,
        "min_limit": str(row.min_limit),
        "expiry_required": bool(row.expiry_required),
        "legacy_negative_allowed": bool(row.legacy_negative_allowed),
        "cost_basis_unit_cost": str(row.cost_basis_unit_cost),
    }
    _log_inventory_audit(
        db,
        tenant.id,
        user.username,
        "INVENTORY_EDIT",
        {
            "item_name": row.name,
            "before": before,
            "after": after,
        },
    )
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "unit": row.unit,
        "category": row.category,
        "type": row.category,
        "stock_qty": str(row.stock_qty),
        "unit_cost": str(row.unit_cost),
        "min_limit": str(row.min_limit),
        "expiry_required": bool(row.expiry_required),
        "legacy_negative_allowed": bool(row.legacy_negative_allowed),
        "cost_basis_unit_cost": str(row.cost_basis_unit_cost),
    }


@router.post("/inventory/{item_id}/restock", response_model=InventoryItemOut)
@inventory_request("inventory:restock")
def restock_inventory_item(
    item_id: str,
    payload: InventoryRestockIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    lock_inventory(db, tenant.id)
    _ensure_catalog_write_access(user)
    row = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    qty_added = Decimal(str(payload.qty_added))
    total_price = Decimal(str(payload.total_price))
    if qty_added <= 0:
        raise HTTPException(status_code=400, detail="Restock quantity must be > 0")
    if total_price < 0:
        raise HTTPException(status_code=400, detail="Total price cannot be negative")

    supplier = _resolve_receipt_supplier(db, tenant.id, payload.supplier_id, total_price.quantize(Decimal("0.01")), payload.payment_source)
    _add_supplier_payable(supplier, payload.payment_source, total_price)

    old_basis = Decimal(str(row.stock_qty)) * Decimal(str(row.cost_basis_unit_cost))
    old_total_value = Decimal(str(row.stock_qty)) * Decimal(str(row.unit_cost))
    new_total_qty = Decimal(str(row.stock_qty)) + qty_added
    new_unit_cost = Decimal("0") if new_total_qty <= 0 else (old_total_value + total_price) / new_total_qty

    db.info["inventory_context"] = {"kind": "INVENTORY_RESTOCK", "actor": user.username,
        "lot_code": payload.lot_code, "expires_on": payload.expires_on, "batch_status": payload.batch_status,
        "purchase_unit_cost": total_price / qty_added, "supplier_id": payload.supplier_id, "invoice_no": payload.invoice_no}
    row.cost_basis_unit_cost = (Decimal("0") if new_total_qty <= 0 else (old_basis + total_price) / new_total_qty).quantize(Decimal("0.0001"))
    row.stock_qty = new_total_qty.quantize(Decimal("0.001"))
    row.unit_cost = new_unit_cost.quantize(Decimal("0.0001"))
    _log_inventory_audit(
        db,
        tenant.id,
        user.username,
        "INVENTORY_RESTOCK",
        {
            "item_name": row.name,
            "qty_added": str(qty_added.quantize(Decimal("0.001"))),
            "unit": row.unit,
            "total_price": str(total_price.quantize(Decimal("0.01"))),
            "new_unit_cost": str(row.unit_cost),
            "supplier_id": supplier.id if supplier else None,
            "supplier_name": supplier.name if supplier else payload.supplier,
        },
    )
    post_inventory_restock(
        db,
        tenant_id=tenant.id,
        amount=total_price.quantize(Decimal("0.01")),
        created_by=user.username,
        payment_source=str(payload.payment_source or "payable"),
        category="Xammal Mədaxili",
        note=f"{row.name} mədaxili ({qty_added.quantize(Decimal('0.001'))} {row.unit})",
        reference=str(payload.invoice_no or (supplier.name if supplier else payload.supplier) or row.id),
        supplier_id=supplier.id if supplier else None,
    )
    db.flush()
    db.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "unit": row.unit,
        "category": row.category,
        "type": row.category,
        "stock_qty": str(row.stock_qty),
        "unit_cost": str(row.unit_cost),
        "min_limit": str(row.min_limit),
        "expiry_required": bool(row.expiry_required),
        "legacy_negative_allowed": bool(row.legacy_negative_allowed),
        "cost_basis_unit_cost": str(row.cost_basis_unit_cost),
    }


@router.post("/inventory/{item_id}/loss")
@inventory_request("inventory:loss")
def record_inventory_loss(
    item_id: str,
    payload: InventoryLossIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    lock_inventory(db, tenant.id)
    _ensure_catalog_write_access(user)
    row = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    qty_removed = Decimal(str(payload.qty_removed))
    if qty_removed <= 0:
        raise HTTPException(status_code=400, detail="Loss quantity must be > 0")
    if Decimal(str(row.stock_qty)) < qty_removed:
        raise HTTPException(status_code=400, detail="Insufficient inventory stock")

    db.info["inventory_context"] = {"kind": "INVENTORY_LOSS", "actor": user.username, "reason": payload.reason, "batch_id": payload.batch_id}
    row.stock_qty = (Decimal(str(row.stock_qty)) - qty_removed).quantize(Decimal("0.001"))
    loss_amount = (qty_removed * Decimal(str(row.unit_cost))).quantize(Decimal("0.01"))
    post_inventory_loss(
        db,
        tenant_id=tenant.id,
        amount=loss_amount,
        created_by=user.username,
        category="Anbar İtkisi",
        note=f"Məhsul: {row.name}, Səbəb: {payload.reason}",
        reference=row.id,
    )
    _log_inventory_audit(
        db,
        tenant.id,
        user.username,
        "INVENTORY_LOSS",
        {
            "item_name": row.name,
            "qty_removed": str(qty_removed.quantize(Decimal("0.001"))),
            "unit": row.unit,
            "reason": payload.reason,
            "loss_amount": str(loss_amount),
        },
    )
    db.flush()
    return {"success": True, "loss_amount": str(loss_amount)}


@router.delete("/inventory/{item_id}")
def delete_inventory_item(
    item_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    lock_inventory(db, tenant.id)
    _ensure_catalog_write_access(user)
    row = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    if Decimal(str(row.stock_qty or 0)) != 0:
        raise HTTPException(status_code=409, detail="Qalığı olan məhsul silinə bilməz. Əvvəlcə anbar qalığını uçot qaydasında bağlayın.")
    if db.query(Recipe.id).filter(
        Recipe.tenant_id == tenant.id,
        or_(Recipe.inventory_item_id == row.id, (Recipe.inventory_item_id.is_(None)) & (func.lower(func.trim(Recipe.ingredient_name)) == str(row.name).strip().lower())),
    ).first():
        raise HTTPException(status_code=409, detail="Məhsul reseptdə istifadə olunur və silinə bilməz.")
    _log_inventory_audit(
        db,
        tenant.id,
        user.username,
        "INVENTORY_DELETE",
        {
            "item_name": row.name,
            "stock_qty": str(row.stock_qty),
            "unit": row.unit,
        },
    )
    db.delete(row)
    db.commit()
    return {"success": True}


@router.get("/recipes/{menu_item_name:path}", response_model=list[RecipeIngredientOut])
def list_recipe_ingredients(
    menu_item_name: str,
    response: Response,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    clean_name = str(menu_item_name or "").strip()
    rows = (
        db.query(Recipe, InventoryItem)
        .outerjoin(
            InventoryItem,
            ingredient_link(tenant.id),
        )
        .filter(Recipe.tenant_id == tenant.id, menu_link(tenant.id, clean_name))
        .order_by(Recipe.ingredient_name.asc())
        .all()
    )
    if not rows and clean_name:
        rows = (
            db.query(Recipe, InventoryItem)
            .outerjoin(
                InventoryItem,
                ingredient_link(tenant.id),
            )
            .filter(Recipe.tenant_id == tenant.id, menu_link(tenant.id, clean_name))
            .order_by(Recipe.ingredient_name.asc())
            .all()
        )
    return [
        {
            "id": recipe.id,
            "tenant_id": recipe.tenant_id,
            "menu_item_name": recipe.menu_item_name,
            "ingredient_name": inventory.name if inventory else recipe.ingredient_name,
            "inventory_item_id": recipe.inventory_item_id,
            "menu_item_id": recipe.menu_item_id,
            "quantity_required": str(recipe.quantity_required),
            "unit": inventory.unit if inventory else "",
            "unit_cost": str(inventory.unit_cost) if inventory else "0",
            "line_cost": str((Decimal(str(recipe.quantity_required)) * Decimal(str(inventory.unit_cost))).quantize(Decimal("0.0001"))) if inventory else "0",
        }
        for recipe, inventory in rows
    ]


@router.get("/recipes")
def list_recipe_menu_names(
    menu_item_name: str | None = None,
    response: Response = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    if response:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    if menu_item_name:
        return list_recipe_ingredients(menu_item_name=menu_item_name, response=response, db=db, tenant=tenant, user=user)
    rows = (
        db.query(Recipe.menu_item_name)
        .filter(Recipe.tenant_id == tenant.id)
        .distinct()
        .all()
    )
    return {"menu_item_names": sorted([str(row[0]) for row in rows if row and row[0]])}


@router.post("/recipes", response_model=RecipeIngredientOut)
def create_recipe_ingredient(
    payload: RecipeIngredientCreateIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    lock_inventory(db, tenant.id)
    menu_item_name = str(payload.menu_item_name or "").strip()
    ingredient_name = str(payload.ingredient_name or "").strip()
    if len(menu_item_name) < 2:
        raise HTTPException(status_code=400, detail="Menu item is required")
    if len(ingredient_name) < 2:
        raise HTTPException(status_code=400, detail="Ingredient is required")

    inventory = unique_named_item(db, InventoryItem, tenant.id, ingredient_name, item_id=payload.inventory_item_id)
    menu = unique_named_item(db, MenuItem, tenant.id, menu_item_name, item_id=payload.menu_item_id)

    row = Recipe(
        tenant_id=tenant.id,
        menu_item_name=menu_item_name,
        inventory_item_id=inventory.id,
        menu_item_id=menu.id,
        ingredient_name=inventory.name,
        quantity_required=_persistable_recipe_qty(
            Decimal(str(payload.quantity_required)),
            str(payload.quantity_unit or inventory.unit),
            str(inventory.unit),
        ).quantize(Decimal("0.0001")),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "menu_item_name": row.menu_item_name,
        "ingredient_name": row.ingredient_name,
        "quantity_required": str(row.quantity_required),
        "unit": inventory.unit,
        "unit_cost": str(inventory.unit_cost),
        "line_cost": str((Decimal(str(row.quantity_required)) * Decimal(str(inventory.unit_cost))).quantize(Decimal("0.0001"))),
    }


@router.delete("/recipes/{recipe_id}")
def delete_recipe_ingredient(
    recipe_id: str,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    row = db.query(Recipe).filter(Recipe.id == recipe_id, Recipe.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Recipe row not found")
    db.delete(row)
    db.commit()
    return {"success": True}


@router.put("/recipes")
def replace_recipe(
    payload: RecipeReplaceIn,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    lock_inventory(db, tenant.id)
    menu_item_name = str(payload.menu_item_name or "").strip()
    if len(menu_item_name) < 2:
        raise HTTPException(status_code=400, detail="Menu item is required")

    db.query(Recipe).filter(
        Recipe.tenant_id == tenant.id,
        menu_link(tenant.id, menu_item_name)
    ).delete(synchronize_session=False)

    menu = unique_named_item(db, MenuItem, tenant.id, menu_item_name)
    saved_count = 0
    for item in payload.ingredients:
        ingredient_name = str(item.ingredient_name or "").strip()
        if len(ingredient_name) < 2:
            continue
        inventory = unique_named_item(db, InventoryItem, tenant.id, ingredient_name, item_id=item.inventory_item_id)

        db.add(
            Recipe(
                tenant_id=tenant.id,
                menu_item_name=menu_item_name,
                inventory_item_id=inventory.id,
                menu_item_id=menu.id,
                ingredient_name=inventory.name,
                quantity_required=_persistable_recipe_qty(
                    Decimal(str(item.quantity_required)),
                    str(item.quantity_unit or inventory.unit),
                    str(inventory.unit),
                ).quantize(Decimal("0.0001")),
            )
        )
        saved_count += 1

    db.commit()
    return {"success": True, "count": saved_count}


class InventoryClearIn(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


@router.post("/clear-inventory")
def clear_inventory(
    payload: InventoryClearIn | None = None,
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    lock_inventory(db, tenant.id)
    _ensure_catalog_write_access(user)
    if user.role not in {"admin", "super_admin", "finance_admin"}:
        raise HTTPException(status_code=403, detail="Yalnız adminlər üçün icazəlidir")

    if db.query(InventoryItem.id).filter(
        InventoryItem.tenant_id == tenant.id,
        InventoryItem.stock_qty != 0,
    ).first():
        raise HTTPException(status_code=409, detail="Qalığı olan məhsullar mövcuddur. Anbar təmizlənə bilməz.")
    if db.query(Recipe.id).filter(Recipe.tenant_id == tenant.id).first():
        raise HTTPException(status_code=409, detail="Reseptlər mövcuddur. Anbar təmizlənə bilməz.")

    from app.security import verify_password
    if not payload or not getattr(user, "password_hash", None) or not verify_password(payload.password, user.password_hash):
        raise HTTPException(403, "Admin şifrəsi yoxlanmadı")

    inventory_deleted = db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant.id).delete()

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="CATALOG_CLEAR_INVENTORY",
            details=json.dumps(
                {
                    "inventory_deleted": inventory_deleted,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {
        "success": True,
        "message": f"Uğurla silindi: {inventory_deleted} anbar məhsulu.",
        "inventory_deleted": inventory_deleted,
    }


@router.post("/clear-recipes")
def clear_recipes(
    db: Session = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    user: User = Depends(get_current_user),
):
    _ensure_catalog_write_access(user)
    if user.role not in {"admin", "super_admin", "finance_admin"}:
        raise HTTPException(status_code=403, detail="Yalnız adminlər üçün icazəlidir")

    recipes_deleted = db.query(Recipe).filter(Recipe.tenant_id == tenant.id).delete()

    db.add(
        AuditLog(
            tenant_id=tenant.id,
            user=user.username,
            action="CATALOG_CLEAR_RECIPES",
            details=json.dumps(
                {
                    "recipes_deleted": recipes_deleted,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {
        "success": True,
        "message": f"Uğurla silindi: {recipes_deleted} resept.",
        "recipes_deleted": recipes_deleted,
    }



class InventoryCountIn(BaseModel):
    counted_qty: Decimal = Field(ge=0, decimal_places=3)
    expected_qty: Decimal = Field(decimal_places=3)
    reason: str = Field(min_length=3, max_length=500)
    idempotency_key: str = Field(min_length=8, max_length=120)


@router.post("/inventory/{item_id}/count")
@inventory_request("inventory:count")
def count_inventory(item_id: str, payload: InventoryCountIn, db: Session = Depends(get_db),
                    tenant: Tenant = Depends(get_tenant), user: User = Depends(get_current_user)):
    _ensure_catalog_write_access(user)
    lock_inventory(db, tenant.id)
    row = db.query(InventoryItem).filter(InventoryItem.id == item_id, InventoryItem.tenant_id == tenant.id).first()
    if not row:
        raise HTTPException(404, "Inventory item not found")
    if Decimal(str(row.stock_qty)) != payload.expected_qty:
        raise HTTPException(409, "Qalıq dəyişib. Sayımı yeniləyib təkrar yoxlayın.")
    if not payload.reason.strip():
        raise HTTPException(400, "Sayım səbəbi tələb olunur")
    delta = payload.counted_qty - Decimal(str(row.stock_qty))
    amount = (abs(delta) * Decimal(str(row.unit_cost))).quantize(Decimal("0.01"))
    from app.services.finance_service import post_finance_transaction
    from app.gl import bridge, posting_rules
    from app.gl.engine import business_today
    if delta < 0:
        post_inventory_loss(db, tenant_id=tenant.id, amount=amount, created_by=user.username,
                            category="Anbar Sayım Fərqi", note=payload.reason, reference=row.id)
    elif delta > 0 and amount > 0:
        txn = post_finance_transaction(db, tenant_id=tenant.id, transaction_type="inventory_count_surplus",
            amount=amount, source_code="revenue", destination_code="inventory_asset", created_by=user.username,
            category="Anbar Sayım Artığı", note=payload.reason, reference=row.id)
        bridge.emit(db, tenant.id, lambda: posting_rules.StockCountSurplus(txn.id, business_today(), amount, payload.reason), actor=user.username)
    db.info["inventory_context"] = {"kind": "stock_count", "actor": user.username, "reason": payload.reason}
    _log_inventory_audit(db, tenant.id, user.username, "INVENTORY_COUNT", {"item_id": row.id,
        "item_name": row.name, "counted_qty": str(payload.counted_qty), "unit": row.unit,
        "difference": str(delta), "amount": str(amount), "reason": payload.reason})
    row.stock_qty = payload.counted_qty
    db.flush()
    db.info.pop("inventory_context", None)
    return {"item_id": row.id, "stock_qty": str(row.stock_qty), "difference": str(delta), "amount": str(amount)}


@router.get("/inventory/{item_id}/movements")
def inventory_movements(item_id: str, limit: int = 50, offset: int = 0,
                        db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user: User = Depends(get_current_user)):
    from app.models import InventoryMovement
    if not 1 <= limit <= 200 or offset < 0:
        raise HTTPException(400, "Invalid pagination")
    rows = db.query(InventoryMovement).filter(InventoryMovement.tenant_id == tenant.id,
        InventoryMovement.item_id == item_id).order_by(InventoryMovement.created_at.desc(), InventoryMovement.id.desc()).offset(offset).limit(limit).all()
    return [{"id": r.id, "item_id": r.item_id, "item_name": r.item_name, "unit": r.unit,
        "quantity_before": str(r.quantity_before), "quantity_after": str(r.quantity_after),
        "difference": str(r.quantity_after-r.quantity_before), "unit_cost": str(r.unit_cost),
        "kind": r.kind, "actor": r.actor, "reason": r.reason, "created_at": r.created_at.isoformat()+"Z"} for r in rows]


@router.get("/inventory-reconciliation")
def reconcile_inventory(db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user: User = Depends(get_current_user)):
    _ensure_catalog_write_access(user)
    lock_inventory(db, tenant.id)
    from app.models import InventoryMovement, InventoryBatch
    from app.services.finance_service import ledger_balances_snapshot
    items = db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant.id).all()
    physical_value = sum((Decimal(str(r.stock_qty))*Decimal(str(r.unit_cost)) for r in items), Decimal("0")).quantize(Decimal("0.01"))
    book_value = ledger_balances_snapshot(db, tenant.id, ensure_accounts=False).get("inventory_asset", Decimal("0")).quantize(Decimal("0.01"))
    totals = dict(db.query(InventoryMovement.item_id, func.sum(InventoryMovement.quantity_after-InventoryMovement.quantity_before)).filter(InventoryMovement.tenant_id == tenant.id).group_by(InventoryMovement.item_id).all())
    differences = [{"item_id": r.id, "name": r.name, "stock_qty": str(r.stock_qty), "journal_qty": str(totals.get(r.id, 0))}
                   for r in items if Decimal(str(r.stock_qty)) != Decimal(str(totals.get(r.id, 0)))]
    lot_totals = dict(db.query(InventoryBatch.item_id, func.sum(InventoryBatch.quantity_remaining)).filter(InventoryBatch.tenant_id == tenant.id).group_by(InventoryBatch.item_id).all())
    batch_differences = [{"item_id": r.id, "name": r.name, "stock_qty": str(r.stock_qty), "batch_qty": str(lot_totals.get(r.id, 0))}
        for r in items if Decimal(str(r.stock_qty)) != Decimal(str(lot_totals.get(r.id, 0)))]
    historical_value = sum((Decimal(str(r.stock_qty))*Decimal(str(r.cost_basis_unit_cost)) for r in items), Decimal("0")).quantize(Decimal("0.01"))
    return {"stock_value": str(physical_value), "historical_cost_value": str(historical_value),
            "valuation_reduction": str(historical_value-physical_value), "batch_differences": batch_differences, "ledger_value": str(book_value), "value_difference": str(physical_value-book_value),
            "quantity_differences": differences, "balanced": physical_value == book_value and not differences and not batch_differences,
            "note": "Jurnal migration tarixindən başlayır. Köhnə fərqlər avtomatik silinmir."}


@router.get("/recipe-link-issues")
def recipe_link_issues(limit: int = 100, offset: int = 0, db: Session = Depends(get_db),
                       tenant: Tenant = Depends(get_tenant), user: User = Depends(get_current_user)):
    _ensure_catalog_write_access(user)
    if not 1 <= limit <= 200 or offset < 0:
        raise HTTPException(400, "Invalid pagination")
    query = db.query(Recipe).filter(Recipe.tenant_id == tenant.id,
        or_(Recipe.inventory_item_id.is_(None), Recipe.menu_item_id.is_(None)))
    total = query.count()
    rows = query.order_by(Recipe.id).offset(offset).limit(limit).all()
    return {"total": total, "items": [{"recipe_id": r.id, "menu_item_name": r.menu_item_name,
        "ingredient_name": r.ingredient_name, "inventory_item_id": r.inventory_item_id,
        "menu_item_id": r.menu_item_id} for r in rows]}


class RecipeLinkIn(BaseModel):
    inventory_item_id: str
    menu_item_id: str
    reason: str = Field(min_length=3, max_length=500)


@router.put("/recipe-links/{recipe_id}")
def resolve_recipe_link(recipe_id: str, payload: RecipeLinkIn, db: Session = Depends(get_db),
                        tenant: Tenant = Depends(get_tenant), user: User = Depends(get_current_user)):
    _ensure_catalog_write_access(user)
    lock_inventory(db, tenant.id)
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id, Recipe.tenant_id == tenant.id).first()
    if not recipe:
        raise HTTPException(404, "Recipe not found")
    inventory = unique_named_item(db, InventoryItem, tenant.id, "", item_id=payload.inventory_item_id)
    menu = unique_named_item(db, MenuItem, tenant.id, "", item_id=payload.menu_item_id)
    # Existing quantities are expressed in the original inventory base unit.
    # Choosing a different unit requires editing the recipe with an explicit conversion.
    old_matches = db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant.id,
        func.lower(func.trim(InventoryItem.name)) == str(recipe.ingredient_name).strip().lower()).all()
    if any(_normalize_unit(r.unit) != _normalize_unit(inventory.unit) for r in old_matches):
        raise HTTPException(409, "Unit differs; edit recipe with an explicit quantity conversion")
    before = {"inventory_item_id": recipe.inventory_item_id, "menu_item_id": recipe.menu_item_id}
    recipe.inventory_item_id, recipe.menu_item_id = inventory.id, menu.id
    recipe.ingredient_name, recipe.menu_item_name = inventory.name, menu.item_name
    _log_inventory_audit(db, tenant.id, user.username, "RECIPE_LINK_RESOLVED",
        {"recipe_id": recipe.id, "before": before, **payload.model_dump()})
    db.commit()
    return {"success": True}


@router.get("/inventory/{item_id}/batches")
def list_inventory_batches(item_id: str, limit: int = 50, offset: int = 0, db: Session = Depends(get_db),
                           tenant: Tenant = Depends(get_tenant), user: User = Depends(get_current_user)):
    from app.models import InventoryBatch
    from app.services.inventory_batches import eligible
    from app.gl.engine import business_today
    if not 1 <= limit <= 200 or offset < 0:
        raise HTTPException(400, "Invalid pagination")
    row = db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant.id, InventoryItem.id == item_id).first()
    if not row:
        raise HTTPException(404, "Inventory item not found")
    query = db.query(InventoryBatch).filter(InventoryBatch.tenant_id == tenant.id, InventoryBatch.item_id == item_id)
    total = query.count()
    usable = (InventoryBatch.quantity_remaining > 0) & (InventoryBatch.status == "available") & ((InventoryBatch.expires_on >= business_today()) | (InventoryBatch.expires_on.is_(None) & (not row.expiry_required)))
    metrics = query.with_entities(
        func.coalesce(func.sum(case((usable, InventoryBatch.quantity_remaining), else_=0)), 0),
        func.coalesce(func.sum(case(((InventoryBatch.quantity_remaining > 0) & (InventoryBatch.expires_on < business_today()), InventoryBatch.quantity_remaining), else_=0)), 0),
        func.coalesce(func.sum(case(((InventoryBatch.quantity_remaining > 0) & (InventoryBatch.status == "quarantine"), InventoryBatch.quantity_remaining), else_=0)), 0),
        func.coalesce(func.sum(case(((InventoryBatch.quantity_remaining > 0) & InventoryBatch.expires_on.is_(None), InventoryBatch.quantity_remaining), else_=0)), 0)).one()
    totals = query.with_entities(func.coalesce(func.sum(InventoryBatch.quantity_remaining), 0)).scalar()
    batches = query.order_by(InventoryBatch.expires_on.asc().nullslast(), InventoryBatch.received_at, InventoryBatch.id).offset(offset).limit(limit).all()
    supplier_ids = {b.supplier_id for b in batches if b.supplier_id}
    supplier_names = dict(db.query(Supplier.id, Supplier.name).filter(Supplier.tenant_id == tenant.id, Supplier.id.in_(supplier_ids)).all()) if supplier_ids else {}
    return {"total": total, "stock_qty": str(row.stock_qty), "batch_qty": str(totals),
        "sale_eligible_qty": str(metrics[0]), "expired_qty": str(metrics[1]), "quarantine_qty": str(metrics[2]), "undated_qty": str(metrics[3]),
        "expiry_required": bool(row.expiry_required),
        "legacy_negative_allowed": bool(row.legacy_negative_allowed), "business_date": business_today().isoformat(),
        "items": [{"id": b.id, "item_id": b.item_id, "lot_code": b.lot_code, "supplier_id": b.supplier_id, "supplier_name": supplier_names.get(b.supplier_id), "invoice_no": b.invoice_no,
            "expires_on": b.expires_on.isoformat() if b.expires_on else None,
            "received_at": b.received_at.isoformat()+"Z", "quantity_received": str(b.quantity_received),
            "quantity_remaining": str(b.quantity_remaining), "purchase_unit_cost": str(b.purchase_unit_cost),
            "status": b.status, "version": b.version, "source_kind": b.source_kind,
            "expired": bool(b.expires_on and b.expires_on < business_today()), "sale_eligible": eligible(b, row)} for b in batches]}


class InventoryBatchUpdateIn(BaseModel):
    lot_code: str | None = Field(default=None, max_length=120)
    expires_on: date | None = None
    status: str = Field(pattern="^(available|quarantine)$")
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)


@router.put("/inventory/{item_id}/batches/{batch_id}")
def update_inventory_batch(item_id: str, batch_id: str, payload: InventoryBatchUpdateIn,
                           db: Session = Depends(get_db), tenant: Tenant = Depends(get_tenant), user: User = Depends(get_current_user)):
    from app.models import InventoryBatch
    from app.gl.engine import business_today
    _ensure_catalog_write_access(user)
    lock_inventory(db, tenant.id)
    row = db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant.id, InventoryItem.id == item_id).first()
    batch = db.query(InventoryBatch).filter(InventoryBatch.tenant_id == tenant.id, InventoryBatch.item_id == item_id, InventoryBatch.id == batch_id).first()
    if not row or not batch:
        raise HTTPException(404, "Partiya bu tenantın məhsuluna aid deyil")
    if batch.version != payload.expected_version:
        raise HTTPException(409, "Partiya dəyişib; siyahını yeniləyin")
    if not payload.reason.strip():
        raise HTTPException(400, "Dəyişiklik səbəbi tələb olunur")
    new_expiry = payload.expires_on if "expires_on" in payload.model_fields_set else batch.expires_on
    new_lot = payload.lot_code if "lot_code" in payload.model_fields_set else batch.lot_code
    if payload.status == "available":
        if new_expiry and new_expiry < business_today():
            raise HTTPException(400, "Vaxtı keçmiş partiya satışa buraxıla bilməz")
        if row.expiry_required and new_expiry is None:
            raise HTTPException(400, "Bu məhsul üçün son istifadə tarixi tələb olunur")
    before = {"lot_code": batch.lot_code, "expires_on": str(batch.expires_on), "status": batch.status, "version": batch.version}
    batch.lot_code, batch.expires_on, batch.status = new_lot, new_expiry, payload.status
    batch.version += 1
    _log_inventory_audit(db, tenant.id, user.username, "INVENTORY_BATCH_UPDATED",
        {"item_id": item_id, "item_name": row.name, "batch_id": batch_id, "before": before, **payload.model_dump(mode="json")})
    db.commit()
    return {"success": True, "version": batch.version}


@router.get("/inventory/{item_id}/batches/{batch_id}/movements")
def list_batch_movements(item_id: str, batch_id: str, limit: int = 50, offset: int = 0, db: Session = Depends(get_db),
                         tenant: Tenant = Depends(get_tenant), user: User = Depends(get_current_user)):
    from app.models import InventoryBatchMovement
    if not 1 <= limit <= 200 or offset < 0:
        raise HTTPException(400, "Invalid pagination")
    rows = db.query(InventoryBatchMovement).filter(InventoryBatchMovement.tenant_id == tenant.id,
        InventoryBatchMovement.item_id == item_id, InventoryBatchMovement.batch_id == batch_id).order_by(
        InventoryBatchMovement.created_at.desc(), InventoryBatchMovement.id.desc()).offset(offset).limit(limit).all()
    return [{"id": r.id, "batch_id": r.batch_id, "movement_id": r.movement_id,
        "quantity_delta": str(r.quantity_delta), "balance_after": str(r.balance_after),
        "kind": r.kind, "created_at": r.created_at.isoformat()+"Z"} for r in rows]


class InventoryValuationIn(BaseModel):
    nrv_unit_cost: Decimal = Field(ge=0, max_digits=12, decimal_places=4)
    expected_qty: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    expected_unit_cost: Decimal = Field(ge=0, max_digits=12, decimal_places=4)
    reason: str = Field(min_length=3, max_length=500)
    idempotency_key: str = Field(min_length=8, max_length=120)


@router.post("/inventory/{item_id}/valuation")
@inventory_request("inventory:valuation")
def value_inventory(item_id: str, payload: InventoryValuationIn, db: Session = Depends(get_db),
                    tenant: Tenant = Depends(get_tenant), user: User = Depends(get_current_user)):
    from app.models import InventoryValuation
    from app.services.finance_service import post_finance_transaction
    from app.gl import bridge, posting_rules
    from app.gl.engine import business_today
    _ensure_catalog_write_access(user)
    lock_inventory(db, tenant.id)
    row = db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant.id, InventoryItem.id == item_id).first()
    if not row:
        raise HTTPException(404, "Inventory item not found")
    qty, previous, basis = Decimal(str(row.stock_qty)), Decimal(str(row.unit_cost)), Decimal(str(row.cost_basis_unit_cost))
    if qty != payload.expected_qty or previous != payload.expected_unit_cost:
        raise HTTPException(409, "Qalıq və ya uçot dəyəri dəyişib; yeniləyib təkrar yoxlayın")
    if qty <= 0 or basis < previous:
        raise HTTPException(409, "Dəyərsizləşmə üçün müsbət və düzgün maya bazalı qalıq tələb olunur")
    if not payload.reason.strip():
        raise HTTPException(400, "Qiymətləndirmə səbəbi tələb olunur")
    new_cost = min(basis, payload.nrv_unit_cost).quantize(Decimal("0.0001"))
    change = new_cost-previous
    if not change:
        return {"item_id": item_id, "changed": False, "unit_cost": str(previous), "amount": "0.00"}
    amount = (abs(change)*qty).quantize(Decimal("0.01"))
    reversal = change > 0
    txn = None
    if amount:
        txn = post_finance_transaction(db, tenant_id=tenant.id,
            transaction_type="inventory_nrv_reversal" if reversal else "inventory_nrv_write_down", amount=amount,
            source_code="expense" if reversal else "inventory_asset",
            destination_code="inventory_asset" if reversal else "expense", created_by=user.username,
            category="Anbar Dəyərsizləşməsinin Bərpası" if reversal else "Anbar Dəyərsizləşməsi", note=payload.reason, reference=item_id)
        native_required = bridge.get_ledger_mode(db, tenant.id) == "dual"
        journal = bridge.emit(db, tenant.id, lambda: posting_rules.StockValuationAdjusted(txn.id, business_today(), amount, reversal, payload.reason), actor=user.username)
        if native_required and journal is None:
            raise HTTPException(409, "Maliyyə jurnalı yazılmadı; qiymətləndirmə saxlanılmadı. Açıq dövrü yoxlayın.")
    row.unit_cost = new_cost
    record = InventoryValuation(id=str(uuid.uuid4()), tenant_id=tenant.id, item_id=item_id, quantity=qty,
        cost_basis_unit_cost=basis, previous_unit_cost=previous, nrv_unit_cost=payload.nrv_unit_cost,
        new_unit_cost=new_cost, amount=amount, kind="reversal" if reversal else "write_down",
        reason=payload.reason.strip(), actor=user.username, transaction_id=txn.id if txn else None)
    db.add(record)
    _log_inventory_audit(db, tenant.id, user.username, "INVENTORY_VALUATION",
        {"item_id": item_id, "item_name": row.name, "valuation_id": record.id, "quantity": str(qty), "before": str(previous),
         "after": str(new_cost), "amount": str(amount), "kind": record.kind, "reason": record.reason})
    db.flush()
    return {"item_id": item_id, "changed": True, "unit_cost": str(new_cost), "cost_basis_unit_cost": str(basis),
        "amount": str(amount), "kind": record.kind, "valuation_id": record.id}


@router.get("/inventory/{item_id}/valuations")
def list_inventory_valuations(item_id: str, limit: int = 50, offset: int = 0, db: Session = Depends(get_db),
                              tenant: Tenant = Depends(get_tenant), user: User = Depends(get_current_user)):
    from app.models import InventoryValuation
    if not 1 <= limit <= 200 or offset < 0:
        raise HTTPException(400, "Invalid pagination")
    rows = db.query(InventoryValuation).filter(InventoryValuation.tenant_id == tenant.id,
        InventoryValuation.item_id == item_id).order_by(InventoryValuation.created_at.desc(), InventoryValuation.id.desc()).offset(offset).limit(limit).all()
    return [{"id": r.id, "quantity": str(r.quantity), "cost_basis_unit_cost": str(r.cost_basis_unit_cost),
        "previous_unit_cost": str(r.previous_unit_cost), "nrv_unit_cost": str(r.nrv_unit_cost),
        "new_unit_cost": str(r.new_unit_cost), "amount": str(r.amount), "kind": r.kind,
        "reason": r.reason, "actor": r.actor, "transaction_id": r.transaction_id, "created_at": r.created_at.isoformat()+"Z"} for r in rows]
