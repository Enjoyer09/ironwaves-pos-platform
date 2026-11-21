"""Serialize inventory mutations per tenant until the transaction ends.

PostgreSQL transaction locks also cover creation of previously absent items.
SQLite is supported for sequential unit tests only.
"""
import hashlib
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.models import InventoryItem, Supplier, InventoryBatch


def lock_inventory(db: Session, tenant_id: str) -> None:
    if db.get_bind().dialect.name != "postgresql":
        return
    transaction = db.get_transaction() or db.begin()
    key = (str(tenant_id), transaction)
    acquired = db.info.setdefault("inventory_locks", set())
    if key in acquired:
        return
    lock_id = int.from_bytes(hashlib.blake2b(f"inventory:{tenant_id}".encode(), digest_size=8).digest(), "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})
    # Objects may have been loaded before waiting. Reload them on next access.
    for obj in list(db.identity_map.values()):
        if isinstance(obj, (InventoryItem, Supplier, InventoryBatch)) and obj.tenant_id == tenant_id and obj not in db.dirty:
            db.expire(obj)
    acquired.clear()
    acquired.add(key)
