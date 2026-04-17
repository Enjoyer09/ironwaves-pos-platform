import importlib
import os
from decimal import Decimal
from types import SimpleNamespace


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


def test_reports_handover_validation_uses_lock_for_update(monkeypatch):
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    calls: list[bool] = []

    def _fake_shift_breakdown(db, tenant_id, shift, **kwargs):
        calls.append(bool(kwargs.get("lock_for_update")))
        return {"expected_cash": Decimal("10.00")}

    monkeypatch.setattr(reports, "_shift_cash_breakdown", _fake_shift_breakdown)

    reports._validate_shift_handover_cash(
        db=SimpleNamespace(add=lambda *_: None),
        tenant_id="tenant-1",
        user=SimpleNamespace(username="tester"),
        shift=SimpleNamespace(),
        declared_cash=Decimal("10.00"),
    )

    assert calls == [True]


def test_operations_handover_validation_uses_lock_for_update(monkeypatch):
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    calls: list[bool] = []

    def _fake_shift_breakdown(db, tenant_id, shift, **kwargs):
        calls.append(bool(kwargs.get("lock_for_update")))
        return {"expected_cash": Decimal("20.00")}

    monkeypatch.setattr(operations, "_shift_cash_breakdown_from_ledger", _fake_shift_breakdown)

    result = operations._validate_shift_handover_cash(
        db=SimpleNamespace(add=lambda *_: None),
        tenant_id="tenant-1",
        user=SimpleNamespace(username="tester"),
        shift=SimpleNamespace(),
        declared_cash=Decimal("20.00"),
    )

    assert calls == [True]
    assert result == Decimal("20.00")
