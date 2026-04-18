import importlib
import os
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.schemas import OpenShiftIn


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


class _FakeDB:
    def __init__(self):
        self.added = []
        self.flush_count = 0
        self.commit_count = 0
        self.rollback_count = 0

    class _FakeQuery:
        def filter(self, *_args, **_kwargs):
            return self

        def first(self):
            return None

    def add(self, row):
        self.added.append(row)

    def flush(self):
        self.flush_count += 1

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def query(self, *_args, **_kwargs):
        return self._FakeQuery()


def test_open_shift_rejects_cash_topup_and_does_not_post_finance_txn(monkeypatch):
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(username="tester")
    called = {"count": 0}

    monkeypatch.setattr(reports, "_get_active_shift", lambda _db, _tenant_id: None)
    monkeypatch.setattr(reports, "_post_finance_transaction", lambda *args, **kwargs: called.__setitem__("count", called["count"] + 1))
    monkeypatch.setattr(reports, "_ledger_balances_snapshot", lambda _db, _tenant_id: {"cash": Decimal("100.00")})

    payload = OpenShiftIn(
        opening_cash=Decimal("0"),
        funding_source="cash",
        target_cash=Decimal("100"),
        topup_amount=Decimal("10"),
    )

    with pytest.raises(HTTPException) as exc:
        reports.open_shift(payload, db=db, tenant=tenant, user=user)

    assert exc.value.status_code == 400
    assert "cash mənbədən topup" in str(exc.value.detail)
    assert called["count"] == 0
    assert db.commit_count == 0
    assert db.rollback_count == 1


def test_open_shift_cash_snapshot_without_topup_creates_shift_only(monkeypatch):
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(username="tester")
    called = {"count": 0}

    monkeypatch.setattr(reports, "_get_active_shift", lambda _db, _tenant_id: None)
    monkeypatch.setattr(reports, "_post_finance_transaction", lambda *args, **kwargs: called.__setitem__("count", called["count"] + 1))
    monkeypatch.setattr(reports, "_ledger_balances_snapshot", lambda _db, _tenant_id: {"cash": Decimal("42.50")})

    payload = OpenShiftIn(
        opening_cash=Decimal("0"),
        funding_source="cash",
        target_cash=Decimal("42.50"),
        topup_amount=Decimal("0"),
    )

    result = reports.open_shift(payload, db=db, tenant=tenant, user=user)

    assert result["success"] is True
    assert result["funding_source"] == "cash"
    assert Decimal(result["opening_cash"]) == Decimal("42.50")
    assert called["count"] == 0
    assert db.commit_count == 1
