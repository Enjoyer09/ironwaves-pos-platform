"""Atomically persist stock mutations and their replay response."""
from functools import wraps
from fastapi import HTTPException
from app.services.finance_requests import reserve_request, complete_request


def inventory_request(kind):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            import inspect
            bound = inspect.signature(function).bind(*args, **kwargs)
            values = bound.arguments
            db, tenant, user, payload = (values[k] for k in ("db", "tenant", "user", "payload"))
            if str(user.role or "").lower() not in {"admin", "super_admin", "manager"}:
                raise HTTPException(403, "Catalog write access required")
            class RequestPayload:
                idempotency_key = payload.idempotency_key
                def model_dump(self, **options):
                    return {"item_id": values.get("item_id"), "data": payload.model_dump(mode="json", exclude={"idempotency_key"})}
            try:
                record, replay = reserve_request(db, tenant.id, user.username, kind, RequestPayload())
                if replay is not None:
                    return replay
                response = function(*args, **kwargs)
                complete_request(record, response)
                db.commit()
                return response
            except Exception:
                db.rollback()
                raise
            finally:
                db.info.pop("inventory_context", None)
        return wrapped
    return decorate
