import importlib
import os
from decimal import Decimal
from types import SimpleNamespace

import pytest
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


def test_balances_endpoint_allows_staff_role(monkeypatch):
    _bootstrap_env()
    finance = importlib.import_module("app.routers.finance")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    
    # 1. Staff user
    staff_user = SimpleNamespace(username="staff1", role="staff")
    monkeypatch.setattr(finance, "_ledger_balances_snapshot", lambda _db, _tenant_id, ensure_accounts=False: {
        "cash": Decimal("150.00"),
        "card": Decimal("200.00"),
        "safe": Decimal("300.00"),
        "investor": Decimal("400.00"),
        "debt": Decimal("50.00"),
        "deposit": Decimal("80.00"),
    })
    
    res = finance.get_balances(db=db, tenant=tenant, user=staff_user)
    assert res["cash"] == "150.00"
    assert res["deposit"] == "80.00"
    assert res["card"] == "0.00"
    assert res["safe"] == "0.00"
    assert res["investor"] == "0.00"
    assert res["debt"] == "0.00"

    # 2. Manager user
    manager_user = SimpleNamespace(username="manager1", role="manager")
    monkeypatch.setattr(finance, "_ensure_finance_read_access", lambda _u: None)
    
    res_m = finance.get_balances(db=db, tenant=tenant, user=manager_user)
    assert res_m["cash"] == "150.00"
    assert res_m["deposit"] == "80.00"
    assert res_m["card"] == "200.00"
    assert res_m["safe"] == "300.00"
    assert res_m["investor"] == "400.00"
    assert res_m["debt"] == "50.00"


def test_open_shift_allows_overdraft_on_safe_card(monkeypatch):
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(username="tester", role="staff")
    called = {"count": 0}

    monkeypatch.setattr(reports, "_get_active_shift", lambda _db, _tenant_id: None)
    monkeypatch.setattr(reports, "_post_finance_transaction", lambda *args, **kwargs: called.__setitem__("count", called["count"] + 1))
    monkeypatch.setattr(reports, "_ledger_balances_snapshot", lambda _db, _tenant_id: {"cash": Decimal("0.00")})
    
    # Mock source wallet balance as 0 (safe balance = 0)
    monkeypatch.setattr(reports, "_wallet_balance", lambda _db, _tenant_id, _source: Decimal("0.00"))

    payload = OpenShiftIn(
        opening_cash=Decimal("0.00"),
        funding_source="safe",
        target_cash=Decimal("100.00"),
        topup_amount=Decimal("100.00"),
    )

    # This should succeed now because we commented out the "Insufficient balance" check
    result = reports.open_shift(payload, db=db, tenant=tenant, user=user)
    assert result["success"] is True
    assert result["funding_source"] == "safe"
    assert result["topup_amount"] == "100.00"
    assert called["count"] == 1
    assert db.commit_count == 1
