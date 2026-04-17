import importlib
import os
from decimal import Decimal
from types import SimpleNamespace

from app.schemas import XReportIn


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


def test_x_report_creates_pending_approval_when_cash_adjustment_policy_requires(monkeypatch):
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB()
    tenant = SimpleNamespace(id="tenant-1")
    user = SimpleNamespace(username="tester")
    post_called = {"count": 0}

    monkeypatch.setattr(reports, "_get_active_shift", lambda *_: SimpleNamespace(id="shift-1"))
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
    monkeypatch.setattr(reports, "_cash_adjustment_requires_manual_approval", lambda *_: True)
    monkeypatch.setattr(
        reports,
        "_create_finance_transaction_record",
        lambda *args, **kwargs: SimpleNamespace(id="txn-pending-1", status="pending_approval"),
    )
    monkeypatch.setattr(
        reports,
        "_post_finance_transaction",
        lambda *args, **kwargs: post_called.__setitem__("count", post_called["count"] + 1),
    )

    payload = XReportIn(actual_cash=Decimal("120.00"))
    result = reports.x_report(payload, db=db, tenant=tenant, user=user)

    assert result["approval_required"] is True
    assert result["pending_transaction_id"] == "txn-pending-1"
    assert result["pending_status"] == "pending_approval"
    assert post_called["count"] == 0
    assert db.commit_count == 1
