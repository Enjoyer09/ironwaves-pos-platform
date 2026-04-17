from decimal import Decimal
from types import SimpleNamespace

from app.services import finance_service


class _FakeDB:
    def __init__(self):
        self.added = []

    def add(self, row):
        self.added.append(row)


def test_legacy_mirror_investor_injection_adds_only_operational_cash_entry(monkeypatch):
    db = _FakeDB()
    txn = SimpleNamespace(
        id="txn-1",
        tenant_id="tenant-1",
        transaction_type="investor_injection",
        source_account_id="investor-account-id",
        destination_account_id="cash-account-id",
        amount=Decimal("120.00"),
        note="Founder top-up",
        category="Təsisçi İnvestisiyası",
    )

    def _fake_account_code(_db, _tenant_id, account_id):
        if account_id == "investor-account-id":
            return "investor"
        if account_id == "cash-account-id":
            return "cash"
        return None

    monkeypatch.setattr(finance_service, "finance_account_code", _fake_account_code)

    rows = finance_service.mirror_posted_transaction_to_legacy_wallet(db, txn, "tester")

    assert len(rows) == 1
    only_row = rows[0]
    assert only_row.type == "in"
    assert only_row.source == "cash"
    assert only_row.category in {"Təsisçi İnvestisiyası", "Ledger Mədaxil"}

    # Extra guard: no investor/deposit mirror row for liability side.
    assert all(getattr(row, "source", None) not in {"investor", "deposit"} for row in rows)
