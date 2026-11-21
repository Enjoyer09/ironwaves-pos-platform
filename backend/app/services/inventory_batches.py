"""Physical FEFO allocations. Financial costing remains weighted average.

Dates are inclusive in Asia/Baku: a lot expires after the specified calendar day.
Undated legacy stock is retained, never assigned a guessed expiration date.
"""
from datetime import date, datetime
from decimal import Decimal
import uuid
from fastapi import HTTPException
from app.gl.engine import business_today
from app.models import InventoryBatch, InventoryBatchMovement

ZERO = Decimal("0")


def batches_for_item(db, row):
    existing = db.query(InventoryBatch).filter(InventoryBatch.tenant_id == row.tenant_id, InventoryBatch.item_id == row.id, InventoryBatch.quantity_remaining != 0).all()
    pending = [b for b in list(db.new) + list(db.dirty) if isinstance(b, InventoryBatch) and b.tenant_id == row.tenant_id and b.item_id == row.id]
    return existing + [b for b in pending if b not in existing]


def eligible(batch, row, today=None):
    return (batch.quantity_remaining > 0 and batch.status == "available"
            and (batch.expires_on is None or batch.expires_on >= (today or business_today()))
            and (not row.expiry_required or batch.expires_on is not None))


def _allocation(db, row, batch, delta, movement, kind=None):
    db.add(InventoryBatchMovement(id=str(uuid.uuid4()), tenant_id=row.tenant_id, item_id=row.id,
        batch=batch, movement=movement, quantity_delta=delta,
        balance_after=batch.quantity_remaining, kind=kind or movement.kind))


def _new_batch(db, row, quantity, context, kind):
    expiry = context.get("expires_on")
    if isinstance(expiry, str):
        expiry = date.fromisoformat(expiry)
    batch = InventoryBatch(id=str(uuid.uuid4()), tenant_id=row.tenant_id, item_id=row.id,
        supplier_id=context.get("supplier_id"), invoice_no=context.get("invoice_no"),
        lot_code=context.get("lot_code"), expires_on=expiry, received_at=datetime.utcnow(),
        quantity_received=quantity, quantity_remaining=quantity,
        purchase_unit_cost=Decimal(str(context.get("purchase_unit_cost", row.unit_cost or 0))),
        status=context.get("batch_status", "available"), version=1, source_kind=kind)
    db.add(batch)
    return batch


def record_batch_movement(db, row, before, after, movement, context):
    before, after = before.quantize(Decimal("0.001")), after.quantize(Decimal("0.001"))
    delta = after-before
    lots = batches_for_item(db, row)
    # Old databases/manual imports may have no lot history yet; seed the exact
    # pre-operation quantity, including legacy deficits, without changing stock.
    if not lots and before:
        baseline = _new_batch(db, row, before, {}, "legacy_opening")
        _allocation(db, row, baseline, before, None, "legacy_opening")
        lots.append(baseline)
    if sum((b.quantity_remaining for b in lots), ZERO) != before:
        raise HTTPException(409, "Partiya qalığı anbarla uyğun deyil. Əməliyyat dayandırıldı; tutuşdurmanı yoxlayın.")
    if delta > 0:
        receipt = movement.kind in {"INVENTORY_ADD", "INVENTORY_RESTOCK", "opening"}
        metadata = dict(context)
        if not receipt:
            metadata["batch_status"] = "quarantine"
        expiry = metadata.get("expires_on")
        if isinstance(expiry, str):
            expiry = date.fromisoformat(expiry)
        if receipt and row.expiry_required and not expiry:
            raise HTTPException(400, "Bu məhsulun mədaxili üçün son istifadə tarixi tələb olunur")
        if receipt and expiry and expiry < business_today() and metadata.get("batch_status", "available") != "quarantine":
            raise HTTPException(400, "Vaxtı keçmiş partiya yalnız karantinə qəbul edilə bilər")
        left = delta
        for batch in sorted(lots, key=lambda b: (b.received_at, b.id)):
            if batch.quantity_remaining >= 0:
                continue
            used = min(left, -batch.quantity_remaining)
            batch.quantity_remaining += used
            batch.version += 1
            _allocation(db, row, batch, used, movement)
            left -= used
            if not left:
                break
        if left or receipt:
            if not receipt:
                old_basis = Decimal(str(row.cost_basis_unit_cost or row.unit_cost or 0))
                row.cost_basis_unit_cost = ((max(before, ZERO)*old_basis + left*Decimal(str(row.unit_cost or 0))) / after).quantize(Decimal("0.0001"))
            batch = _new_batch(db, row, delta if receipt else left, metadata, movement.kind)
            _allocation(db, row, batch, batch.quantity_remaining, movement)
            if receipt and left != delta:
                offset = delta-left
                batch.quantity_remaining = left
                _allocation(db, row, batch, -offset, movement, "legacy_deficit_offset")
    elif delta < 0:
        if row in db.new and not lots:
            deficit = _new_batch(db, row, delta, {}, "legacy_deficit")
            _allocation(db, row, deficit, delta, movement)
            return
        physical_adjustment = movement.kind in {"INVENTORY_LOSS", "stock_count", "INVENTORY_WASTE_CONSUMED"} or "waste" in movement.kind.lower()
        specific = context.get("batch_id")
        if specific:
            chosen = [b for b in lots if b.id == specific]
            if not chosen:
                raise HTTPException(404, "Partiya bu tenantın məhsuluna aid deyil")
        else:
            chosen = lots
        available = [b for b in chosen if b.quantity_remaining > 0 and (physical_adjustment or eligible(b, row))]
        available.sort(key=lambda b: (b.expires_on or date.max, b.received_at, b.id))
        needed = -delta
        shortage = sum((b.quantity_remaining for b in available), ZERO) < needed
        legacy_allowed = False
        if shortage and not physical_adjustment and not specific and not row.expiry_required and row.legacy_negative_allowed:
            # Even depleted dated lots retain the strict safety policy; exhausting
            # a dated lot must never reactivate the undated legacy allowance.
            controls = db.query(InventoryBatch.id).filter(InventoryBatch.tenant_id == row.tenant_id,
                InventoryBatch.item_id == row.id,
                (InventoryBatch.expires_on.isnot(None)) | (InventoryBatch.status == "quarantine")).first()
            pending_controls = any(b.expires_on is not None or b.status == "quarantine" for b in lots)
            legacy_allowed = controls is None and not pending_controls
        if shortage and not legacy_allowed:
            raise HTTPException(409, "Satışa yararlı partiya qalığı kifayət deyil. Vaxtı keçmiş, karantindəki və tarixi tələb olunan partiyaları yoxlayın.")
        for batch in available:
            used = min(needed, batch.quantity_remaining)
            batch.quantity_remaining -= used
            batch.version += 1
            _allocation(db, row, batch, -used, movement)
            needed -= used
            if not needed:
                break
        if needed and legacy_allowed:
            deficit = next((b for b in lots if b.quantity_remaining < 0), None)
            if deficit is None:
                deficit = _new_batch(db, row, -needed, {}, "legacy_stock_deficit")
            else:
                deficit.quantity_remaining -= needed
                deficit.version += 1
            _allocation(db, row, deficit, -needed, movement, "legacy_stock_deficit")


def stock_consumption_qty(quantity):
    """Financial COGS and physical FEFO must use the same stored precision."""
    quantity = Decimal(str(quantity))
    rounded = quantity.quantize(Decimal('0.001'))
    if quantity > 0 and rounded <= 0:
        raise HTTPException(400, 'Resept miqdarı anbarın 0.001 əsas vahid dəqiqliyindən kiçikdir. Daha kiçik əsas vahid seçin.')
    return rounded
