from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

from app.routers import finance


class _FakeQuery:
    def __init__(self, db_instance, entities, rows):
        self.db_instance = db_instance
        self.entities = entities
        self.rows = rows

    def filter(self, *args, **kwargs):
        return self

    def group_by(self, *args, **kwargs):
        return self

    def all(self):
        ent_str = str(self.entities[0]).lower() if self.entities else ""
        if "transaction_type" in ent_str:
            groups = {}
            for r in self.db_instance.posted_rows:
                groups.setdefault(r.transaction_type, []).append(r)
            return [
                (tx_type, sum(item.amount for item in items), len(items))
                for tx_type, items in groups.items()
            ]
        elif "financeaccount.id" in ent_str or "id" in ent_str:
            return self.db_instance.account_rows
        else:
            return [
                (r.amount, r.source_account_id, r.destination_account_id)
                for r in self.db_instance.posted_rows
                if r.transaction_type in {"cash_adjustment", "reconciliation_adjustment"}
            ]


class _FakeDB:
    def __init__(self, query_rows):
        self.posted_rows = query_rows[0]
        self.account_rows = query_rows[1]

    def query(self, *args, **kwargs):
        return _FakeQuery(self, args, None)


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
