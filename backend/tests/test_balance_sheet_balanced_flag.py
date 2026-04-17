from decimal import Decimal

from app.routers import finance


def test_balance_sheet_balanced_uses_ledger_equity(monkeypatch):
    monkeypatch.setattr(
        finance,
        "_ledger_balances_snapshot",
        lambda *_: {
            "cash": Decimal("100.00"),
            "card": Decimal("0.00"),
            "safe": Decimal("0.00"),
            "debt": Decimal("0.00"),
            "deposit": Decimal("20.00"),
            "investor": Decimal("0.00"),
        },
    )
    monkeypatch.setattr(finance, "_inventory_value", lambda *_: Decimal("0.00"))

    # Assets=100, Liabilities=20.
    # If ledger equity=70 => residual=10 => not balanced (must be False).
    monkeypatch.setattr(finance, "_ledger_equity_total", lambda *_: (Decimal("70.00"), ["adjustment"]))
    report_unbalanced = finance._balance_sheet_report(None, "tenant-1")
    assert report_unbalanced["balanced"] is False
    assert report_unbalanced["equity"]["accounting_residual"] == "10.00"

    # Assets=100, Liabilities=20, Equity=80 => residual=0 => balanced True.
    monkeypatch.setattr(finance, "_ledger_equity_total", lambda *_: (Decimal("80.00"), ["adjustment"]))
    report_balanced = finance._balance_sheet_report(None, "tenant-1")
    assert report_balanced["balanced"] is True
    assert report_balanced["equity"]["accounting_residual"] == "0.00"
