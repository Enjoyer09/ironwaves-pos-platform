import importlib
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


class _FakeDB:
    def __init__(self):
        self._queue: list[object] = []
        self.added = []
        self.flush_count = 0
        self.commit_count = 0

    def set_first_queue(self, *values):
        self._queue = list(values)

    def add(self, row):
        self.added.append(row)

    def flush(self):
        self.flush_count += 1

    def commit(self):
        self.commit_count += 1

    def query(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        if not self._queue:
            return None
        return self._queue.pop(0)


def test_feedback_submit_rejects_invalid_receipt_token():
    _bootstrap_env()
    router = importlib.import_module("app.routers.customer_feedback_ops")
    db = _FakeDB()
    db.set_first_queue(
        SimpleNamespace(id="sale-1", receipt_code="RCP-1", receipt_token="valid-token", cashier="tester")
    )
    payload = SimpleNamespace(
        tenant_id="tenant-1",
        sale_id="sale-1",
        receipt_id="RCP-1",
        receipt_token="wrong-token",
        score=5,
        source="receipt",
        comment=None,
        contact=None,
    )

    with pytest.raises(HTTPException) as exc:
        router.submit_feedback(payload, db=db)

    assert exc.value.status_code == 400
    assert "token" in str(exc.value.detail).lower()
    assert db.commit_count == 0


def test_redeem_feedback_coupon_blocks_original_sale():
    _bootstrap_env()
    router = importlib.import_module("app.routers.customer_feedback_ops")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(username="cashier")
    db.set_first_queue(
        SimpleNamespace(id="sale-1", tenant_id="tenant-1"),
        SimpleNamespace(
            tenant_id="tenant-1",
            code="FB-AAAA1111",
            status="PENDING",
            sale_id="sale-1",
            percent=5,
        ),
    )
    payload = SimpleNamespace(code="FB-AAAA1111", sale_id="sale-1")

    with pytest.raises(HTTPException) as exc:
        router.redeem_feedback_coupon(payload, db=db, tenant=tenant, user=user)

    assert exc.value.status_code == 400
    assert "original sale" in str(exc.value.detail).lower()
    assert db.commit_count == 0


def test_feedback_submit_returns_existing_coupon_for_receipt_alias_without_new_commit():
    _bootstrap_env()
    router = importlib.import_module("app.routers.customer_feedback_ops")
    db = _FakeDB()
    db.set_first_queue(
        SimpleNamespace(id="sale-1", receipt_code="RCP-1", receipt_token="valid-token", cashier="tester"),
        SimpleNamespace(code="FB-EXISTS01", percent=10),
    )
    payload = SimpleNamespace(
        tenant_id="tenant-1",
        sale_id="sale-1",
        receipt_id="RCP-1",
        receipt_token="valid-token",
        score=5,
        source="receipt",
        comment=None,
        contact=None,
    )

    out = router.submit_feedback(payload, db=db)

    assert out["success"] is True
    assert out["already_submitted"] is True
    assert out["coupon_code"] == "FB-EXISTS01"
    assert out["coupon_percent"] == 10
    assert db.commit_count == 0
