"""Request replay protection committed atomically with manual money operations."""
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import uuid

from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models import FinanceOperationRequest


def _canonical(value):
    if isinstance(value, Decimal):
        return format(value.quantize(Decimal("0.01")), "f")
    if isinstance(value, dict):
        return {key: _canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    return value


def reserve_request(db: Session, tenant_id: str, actor: str, kind: str, payload, *, track_without_key=False):
    """An INSERT conflict waits for the first request's commit/rollback on PG.

    No intermediate commit: failed money operations also discard the reservation.
    The unique key is tenant-wide, so reusing it on another route is a conflict.
    """
    key = payload.idempotency_key
    if key is None and not track_without_key:
        return None, None
    request_payload = payload.model_dump(exclude={"idempotency_key"})
    # Preserve existing request hashes for clients that omit the newly added field.
    if kind == "entry" and request_payload.get("counterparty") is None:
        request_payload.pop("counterparty", None)
    data = {"actor": actor, "kind": kind, "payload": _canonical(request_payload)}
    fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    request_id = str(uuid.uuid4())
    values = dict(id=request_id, tenant_id=tenant_id, idempotency_key=key, operation_type=kind,
                  request_hash=fingerprint, created_by=actor, bank_commission=Decimal("0.00"),
                  created_at=datetime.now(timezone.utc).replace(tzinfo=None))
    dialect = db.get_bind().dialect.name
    insert = pg_insert if dialect == "postgresql" else sqlite_insert if dialect == "sqlite" else None
    if insert is None:
        raise RuntimeError("Manual finance requests require PostgreSQL or SQLite")
    result = db.execute(insert(FinanceOperationRequest).values(**values).on_conflict_do_nothing(
        index_elements=["tenant_id", "idempotency_key"]))
    if result.rowcount:
        return db.get(FinanceOperationRequest, request_id), None
    existing = db.query(FinanceOperationRequest).filter(
        FinanceOperationRequest.tenant_id == tenant_id,
        FinanceOperationRequest.idempotency_key == key,
    ).one()
    if existing.request_hash != fingerprint:
        raise HTTPException(status_code=409, detail="Idempotency key was already used for a different finance request")
    if not existing.response_json:
        raise HTTPException(status_code=409, detail="Finance request is still in progress; retry with the same key")
    return existing, {**json.loads(existing.response_json), "replayed": True}


def complete_request(record, response: dict, *, transaction_id=None):
    if record is not None:
        record.response_json = json.dumps(response, ensure_ascii=False)
        if transaction_id:
            record.transaction_id = transaction_id
    return response


def transfer_request(db: Session, tenant_id: str, transaction_id: str):
    return db.query(FinanceOperationRequest).filter(
        FinanceOperationRequest.tenant_id == tenant_id,
        FinanceOperationRequest.operation_type == "transfer",
        FinanceOperationRequest.transaction_id == transaction_id,
    ).first()
