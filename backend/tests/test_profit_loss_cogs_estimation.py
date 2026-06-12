import json
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

    def one(self):
        sales = self.db_instance.sales_rows
        sales_count_raw = len(sales)
        revenue_raw = sum(r.total for r in sales)
        cogs_recorded_raw = sum(r.cogs for r in sales if r.cogs is not None)
        cogs_uncomputed_count_raw = sum(1 for r in sales if r.cogs is None)
        cogs_uncomputed_revenue_raw = sum(r.total for r in sales if r.cogs is None)
        return (
            sales_count_raw,
            revenue_raw,
            cogs_recorded_raw,
            cogs_uncomputed_count_raw,
            cogs_uncomputed_revenue_raw,
        )

    def all(self):
        if any("items_json" in str(ent) for ent in self.entities):
            return [SimpleNamespace(items_json=r.items_json) for r in self.db_instance.sales_rows if r.cogs is None]
        return self.rows

    def scalar(self):
        return sum(Decimal(str(r.amount)) for r in self.db_instance.posted_txns if getattr(r, "transaction_type", "") == "expense")


class _FakeDB:
    def __init__(self, query_rows):
        self.sales_rows = query_rows[0]
        self.recipe_rows = query_rows[1]
        self.inventory_rows = query_rows[2]
        self.posted_txns = query_rows[3]

    def query(self, *args, **kwargs):
        arg_str = str(args[0]).lower()
        if "recipe" in arg_str:
            return _FakeQuery(self, args, self.recipe_rows)
        elif "inventoryitem" in arg_str:
            return _FakeQuery(self, args, self.inventory_rows)
        elif "financetransaction" in arg_str:
            return _FakeQuery(self, args, self.posted_txns)
        else:
            return _FakeQuery(self, args, self.sales_rows)


def test_profit_loss_report_estimates_missing_cogs_from_recipe_inventory(monkeypatch):
    monkeypatch.setattr(
        finance,
        "_setting_value",
        lambda *_args, **_kwargs: {"remove_paper_packaging_for_table": True},
    )

    sales_rows = [
        SimpleNamespace(
            total=Decimal("10.00"),
            cogs=None,
            items_json=json.dumps(
                [
                    {"item_name": "Affogato", "qty": 2, "cup_mode": "glass"},
                ],
                ensure_ascii=False,
            ),
        ),
        SimpleNamespace(
            total=Decimal("20.00"),
            cogs=Decimal("2.5000"),
            items_json=json.dumps([{"item_name": "Espresso", "qty": 1}], ensure_ascii=False),
        ),
    ]
    posted_txns = []
    recipe_rows = [
        ("affogato", "Espresso Shot", Decimal("1.0000")),
        ("affogato", "Paper Cup", Decimal("1.0000")),
    ]
    inventory_rows = [
        ("Espresso Shot", Decimal("0.8000")),
        ("Paper Cup", Decimal("0.2000")),
    ]
    db = _FakeDB([sales_rows, recipe_rows, inventory_rows, posted_txns])

    report = finance._profit_loss_report(db, "tenant-1", None, None)

    assert report["cogs_recorded"] == "2.50"
    # 2 * Espresso Shot (0.8) with glass mode excludes paper cup => 1.6 estimated
    assert report["cogs_estimated"] == "1.60"
    assert report["cogs"] == "4.10"
    assert report["cogs_estimated_sales_count"] == 1
    assert report["has_uncomputed_cogs"] is False
    assert report["cogs_unresolved_sales_count"] == 0
    assert report["cogs_coverage_percent"] == "100.00"


def test_profit_loss_report_prefers_cogs_snapshot_when_present(monkeypatch):
    monkeypatch.setattr(
        finance,
        "_setting_value",
        lambda *_args, **_kwargs: {"remove_paper_packaging_for_table": True},
    )
    sales_rows = [
        SimpleNamespace(
            total=Decimal("12.00"),
            cogs=None,
            items_json=json.dumps(
                [
                    {"item_name": "Affogato", "qty": 1, "_cogs_snapshot": "1.2500"},
                    {"item_name": "Cookie", "qty": 1, "_cogs_snapshot": "0.3500"},
                ],
                ensure_ascii=False,
            ),
        )
    ]
    posted_txns = []
    # No recipe/inventory rows required when snapshot is present.
    recipe_rows = []
    inventory_rows = []
    db = _FakeDB([sales_rows, recipe_rows, inventory_rows, posted_txns])

    report = finance._profit_loss_report(db, "tenant-1", None, None)

    assert report["cogs_recorded"] == "0.00"
    assert report["cogs_estimated"] == "1.60"
    assert report["cogs"] == "1.60"
    assert report["has_uncomputed_cogs"] is False
    assert report["cogs_unresolved_sales_count"] == 0
