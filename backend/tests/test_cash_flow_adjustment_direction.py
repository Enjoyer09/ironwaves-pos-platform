from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

from app.routers import finance


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *args, **kwargs):
        return self

    def all(self):
        return self._rows


class _FakeDB:
    def __init__(self, query_rows):
        self._query_rows = list(query_rows)

    def query(self, *args, **kwargs):
        if not self._query_rows:
            raise AssertionError("Unexpected extra query call")
        return _FakeQuery(self._query_rows.pop(0))


def test_cash_flow_report_adjustment_net_uses_cash_direction():
    posted_rows = [
        # +20 into cash
        SimpleNamespace(
            transaction_type="cash_adjustment",
            amount=Decimal("20.00"),
            source_account_id="acc-adjustment",
            destination_account_id="acc-cash",
            created_at=datetime(2026, 1, 1, 10, 0, 0),
            posted_at=None,
        ),
        # -5 out of cash
        SimpleNamespace(
            transaction_type="cash_adjustment",
            amount=Decimal("5.00"),
            source_account_id="acc-cash",
            destination_account_id="acc-adjustment",
            created_at=datetime(2026, 1, 1, 11, 0, 0),
            posted_at=None,
        ),
        # should not affect cash net: safe -> adjustment
        SimpleNamespace(
            transaction_type="reconciliation_adjustment",
            amount=Decimal("9.00"),
            source_account_id="acc-safe",
            destination_account_id="acc-adjustment",
            created_at=datetime(2026, 1, 1, 12, 0, 0),
            posted_at=None,
        ),
    ]
    account_rows = [
        ("acc-cash", "cash"),
        ("acc-adjustment", "adjustment"),
        ("acc-safe", "safe"),
    ]
    db = _FakeDB([posted_rows, account_rows])

    report = finance._cash_flow_report(db, "tenant-1", None, None)

    assert report["adjustment_net"] == "15.00"
