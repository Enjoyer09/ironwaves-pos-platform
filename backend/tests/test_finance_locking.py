from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

from app.services import finance_service


class _FakeQuery:
    def __init__(self, *, rows=None, one_result=None):
        self._rows = rows or []
        self._one_result = one_result
        self.lock_called = False

    def filter(self, *args, **kwargs):
        return self

    def with_for_update(self):
        self.lock_called = True
        return self

    def with_entities(self, *args, **kwargs):
        return self

    def all(self):
        return self._rows

    def one(self):
        return self._one_result


class _FakeSession:
    def __init__(self, queries):
        self._queries = list(queries)

    def query(self, *args, **kwargs):
        if not self._queries:
            raise AssertionError("Unexpected extra query call")
        return self._queries.pop(0)


def test_account_ledger_totals_for_update_locks_account_and_ledger_rows():
    account_lock_query = _FakeQuery(one_result=("account-row",))
    ledger_lock_query = _FakeQuery(rows=[("debit", Decimal("10.00")), ("credit", Decimal("3.00"))])
    db = _FakeSession([account_lock_query, ledger_lock_query])
    account = SimpleNamespace(id="acc-1", account_type="asset")

    result = finance_service.account_ledger_totals_for_update(db, "tenant-1", account)

    assert account_lock_query.lock_called is True
    assert ledger_lock_query.lock_called is True
    assert result["debit"] == Decimal("10.00")
    assert result["credit"] == Decimal("3.00")
    assert result["balance"] == Decimal("7.00")


def test_shift_cash_breakdown_from_ledger_lock_mode_locks_before_totals(monkeypatch):
    account = SimpleNamespace(id="cash-account")
    monkeypatch.setattr(finance_service, "finance_account", lambda db, tenant_id, code: account)

    account_lock_query = _FakeQuery(one_result=("account-row",))
    ledger_lock_query = _FakeQuery(rows=[("debit", Decimal("20.00")), ("credit", Decimal("4.00"))])
    db = _FakeSession([account_lock_query, ledger_lock_query])
    shift = SimpleNamespace(opening_cash=Decimal("5.00"), opened_at=datetime(2026, 1, 1))

    result = finance_service.shift_cash_breakdown_from_ledger(
        db,
        "tenant-1",
        shift,
        lock_for_update=True,
    )

    assert account_lock_query.lock_called is True
    assert ledger_lock_query.lock_called is True
    assert result["opening_cash"] == Decimal("5.00")
    assert result["cash_in"] == Decimal("20.00")
    assert result["cash_out"] == Decimal("4.00")
    assert result["expected_cash"] == Decimal("21.00")
