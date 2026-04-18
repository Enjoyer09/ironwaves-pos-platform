import json
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
