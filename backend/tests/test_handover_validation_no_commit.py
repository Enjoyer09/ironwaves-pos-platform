import importlib
import os
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


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


def test_operations_handover_validation_rejects_without_commit(monkeypatch):
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    db = _FakeDB()
    user = SimpleNamespace(username="tester")
    shift = SimpleNamespace()

    monkeypatch.setattr(
        operations,
        "_shift_cash_breakdown_from_ledger",
        lambda *_args, **_kwargs: {"expected_cash": Decimal("100.00")},
    )

    with pytest.raises(HTTPException) as exc:
        operations._validate_shift_handover_cash(
            db=db,
            tenant_id="tenant-1",
            user=user,
            shift=shift,
            declared_cash=Decimal("80.00"),
        )

    assert exc.value.status_code == 400
    assert db.commit_count == 0
    assert len(db.added) == 1


def test_reports_handover_validation_rejects_without_commit(monkeypatch):
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB()
    user = SimpleNamespace(username="tester")
    shift = SimpleNamespace()

    monkeypatch.setattr(
        reports,
        "_shift_cash_breakdown",
        lambda *_args, **_kwargs: {"expected_cash": Decimal("100.00")},
    )

    with pytest.raises(HTTPException) as exc:
        reports._validate_shift_handover_cash(
            db=db,
            tenant_id="tenant-1",
            user=user,
            shift=shift,
            declared_cash=Decimal("80.00"),
        )

    assert exc.value.status_code == 400
    assert db.commit_count == 0
    assert len(db.added) == 1
