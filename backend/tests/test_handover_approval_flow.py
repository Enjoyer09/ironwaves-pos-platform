import importlib
import os
from decimal import Decimal
from types import SimpleNamespace

from app.schemas import ShiftHandoverAcceptIn


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


class _FakeDB:
    def __init__(self):
        self.added = []
        self.commit_count = 0

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commit_count += 1

    def query(self, *args, **kwargs):
        return self

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        if not hasattr(self, "_queue") or not self._queue:
            return None
        return self._queue.pop(0)

    def set_first_queue(self, *values):
        self._queue = list(values)


def test_reports_accept_handover_creates_pending_adjustment_when_policy_requires(monkeypatch):
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(username="receiver")
    active_shift = SimpleNamespace(id="shift-1", tenant_id="tenant-1", status="open", opened_by="old")
    row = SimpleNamespace(
        id="handover-1",
        tenant_id="tenant-1",
        status="PENDING",
        received_by="receiver",
        handed_by="sender",
        declared_cash=Decimal("100.00"),
        actual_cash=None,
        difference=None,
        accepted_at=None,
    )
    db.set_first_queue(active_shift, row)

    monkeypatch.setattr(reports, "_cash_adjustment_requires_manual_approval", lambda *_: True)
    monkeypatch.setattr(
        reports,
        "_create_finance_transaction_record",
        lambda *args, **kwargs: SimpleNamespace(id="txn-1", status="pending_approval"),
    )
    called = {"post": 0}
    monkeypatch.setattr(reports, "_post_finance_transaction", lambda *args, **kwargs: called.__setitem__("post", called["post"] + 1))

    payload = ShiftHandoverAcceptIn(actual_cash=Decimal("120.00"))
    out = reports.accept_handover("handover-1", payload, db=db, tenant=tenant, user=user)

    assert out["approval_required"] is True
    assert out["pending_transaction_id"] == "txn-1"
    assert called["post"] == 0
    assert db.commit_count == 1


def test_operations_accept_handover_creates_pending_adjustment_when_policy_requires(monkeypatch):
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(username="receiver")
    active_shift = SimpleNamespace(id="shift-1", tenant_id="tenant-1", status="open", opened_by="old")
    row = SimpleNamespace(
        id="handover-1",
        tenant_id="tenant-1",
        status="PENDING",
        received_by="receiver",
        handed_by="sender",
        declared_cash=Decimal("100.00"),
        actual_cash=None,
        difference=None,
        accepted_at=None,
    )
    db.set_first_queue(active_shift, row)

    monkeypatch.setattr(operations, "_cash_adjustment_requires_manual_approval", lambda *_: True)
    monkeypatch.setattr(
        operations,
        "_create_finance_transaction_record",
        lambda *args, **kwargs: SimpleNamespace(id="txn-2", status="pending_approval"),
    )
    called = {"post": 0}
    monkeypatch.setattr(operations, "_post_finance_transaction", lambda *args, **kwargs: called.__setitem__("post", called["post"] + 1))

    payload = ShiftHandoverAcceptIn(actual_cash=Decimal("130.00"))
    out = operations.accept_shift_handover_op("handover-1", payload, db=db, tenant=tenant, user=user)

    assert out["approval_required"] is True
    assert out["pending_transaction_id"] == "txn-2"
    assert called["post"] == 0
    assert db.commit_count == 1
