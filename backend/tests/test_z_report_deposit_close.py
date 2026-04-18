import importlib
import os
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.schemas import ZReportIn


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


class _FakeDB:
    def __init__(self):
        self.commit_count = 0

    class _FakeQuery:
        def filter(self, *_args, **_kwargs):
            return self

        def first(self):
            return None

    def commit(self):
        self.commit_count += 1

    def query(self, *_args, **_kwargs):
        return self._FakeQuery()


def _fake_active_shift():
    return SimpleNamespace(
        id="shift-1",
        opened_at=datetime(2026, 1, 1, 10, 0, 0),
        status="open",
        closed_by=None,
        closed_at=None,
        actual_cash=Decimal("0.00"),
        declared_cash=Decimal("0.00"),
        cash_variance=Decimal("0.00"),
        closing_deposit_liability=Decimal("0.00"),
        deposit_settled_amount=Decimal("0.00"),
        closing_cash=Decimal("0.00"),
    )


def test_z_report_blocks_when_open_deposit_exists_without_override(monkeypatch):
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(username="tester")

    monkeypatch.setattr(reports, "_get_active_shift", lambda *_: _fake_active_shift())
    monkeypatch.setattr(
        reports,
        "_shift_cash_breakdown",
        lambda *_args, **_kwargs: {
            "expected_cash": Decimal("100.00"),
            "opening_cash": Decimal("50.00"),
            "cash_in": Decimal("60.00"),
            "cash_out": Decimal("10.00"),
        },
    )
    monkeypatch.setattr(reports, "_cash_adjustment_requires_manual_approval", lambda *_: False)
    monkeypatch.setattr(reports, "_ledger_balances_snapshot", lambda *_: {"deposit": Decimal("12.00")})

    payload = ZReportIn(actual_cash=Decimal("100.00"), wage_amount=Decimal("0"), allow_open_deposit_close=False)

    with pytest.raises(HTTPException) as exc:
        reports.z_report(payload, db=db, tenant=tenant, user=user)

    assert exc.value.status_code == 400
    assert "Açıq depozit öhdəliyi var" in str(exc.value.detail)
    assert db.commit_count == 0


def test_z_report_blocks_if_deposit_still_open_after_auto_settle(monkeypatch):
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(username="tester")
    settle_calls = {"count": 0}
    balances = iter(
        [
            {"deposit": Decimal("15.00")},  # before settle
            {"deposit": Decimal("3.00")},   # after settle -> still open, must fail
        ]
    )

    monkeypatch.setattr(reports, "_get_active_shift", lambda *_: _fake_active_shift())
    monkeypatch.setattr(
        reports,
        "_shift_cash_breakdown",
        lambda *_args, **_kwargs: {
            "expected_cash": Decimal("100.00"),
            "opening_cash": Decimal("50.00"),
            "cash_in": Decimal("60.00"),
            "cash_out": Decimal("10.00"),
        },
    )
    monkeypatch.setattr(reports, "_cash_adjustment_requires_manual_approval", lambda *_: False)
    monkeypatch.setattr(reports, "_ledger_balances_snapshot", lambda *_: next(balances))
    monkeypatch.setattr(
        reports,
        "_post_deposit_apply_to_bill",
        lambda *args, **kwargs: settle_calls.__setitem__("count", settle_calls["count"] + 1),
    )

    payload = ZReportIn(actual_cash=Decimal("100.00"), wage_amount=Decimal("0"), allow_open_deposit_close=True)

    with pytest.raises(HTTPException) as exc:
        reports.z_report(payload, db=db, tenant=tenant, user=user)

    assert exc.value.status_code == 400
    assert "Depozit öhdəliyi bağlanmadı" in str(exc.value.detail)
    assert settle_calls["count"] == 1
    assert db.commit_count == 0


def test_z_report_closes_successfully_and_keeps_closing_cash_as_actual(monkeypatch):
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(username="tester")
    active_shift = _fake_active_shift()
    settle_calls = {"count": 0}
    balances = iter(
        [
            {"deposit": Decimal("15.00")},  # before settle
            {"deposit": Decimal("0.00")},   # after settle
        ]
    )

    monkeypatch.setattr(reports, "_get_active_shift", lambda *_: active_shift)
    monkeypatch.setattr(
        reports,
        "_shift_cash_breakdown",
        lambda *_args, **_kwargs: {
            "expected_cash": Decimal("100.00"),
            "opening_cash": Decimal("50.00"),
            "cash_in": Decimal("60.00"),
            "cash_out": Decimal("10.00"),
        },
    )
    monkeypatch.setattr(reports, "_cash_adjustment_requires_manual_approval", lambda *_: False)
    monkeypatch.setattr(reports, "_ledger_balances_snapshot", lambda *_: next(balances))
    monkeypatch.setattr(
        reports,
        "_post_deposit_apply_to_bill",
        lambda *args, **kwargs: settle_calls.__setitem__("count", settle_calls["count"] + 1),
    )
    monkeypatch.setattr(reports, "_posted_transactions_since", lambda *_: [])
    monkeypatch.setattr(reports, "_finance_account_code_map", lambda *_: {})
    monkeypatch.setattr(reports, "_group_transaction_amounts", lambda *_args, **_kwargs: (Decimal("0.00"), []))
    monkeypatch.setattr(reports, "_post_finance_transaction", lambda *args, **kwargs: None)

    payload = ZReportIn(actual_cash=Decimal("100.00"), wage_amount=Decimal("0"), allow_open_deposit_close=True)
    result = reports.z_report(payload, db=db, tenant=tenant, user=user)

    assert result["success"] is True
    assert Decimal(result["open_deposit_liability"]) == Decimal("15.00")
    assert Decimal(result["closing_deposit_liability"]) == Decimal("0.00")
    assert Decimal(result["deposit_settled_amount"]) == Decimal("15.00")
    assert Decimal(result["closing_cash"]) == Decimal("100.00")
    assert settle_calls["count"] == 1
    assert db.commit_count == 1
