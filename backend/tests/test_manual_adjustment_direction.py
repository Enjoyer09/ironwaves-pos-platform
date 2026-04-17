from app.routers import finance
from app.schemas import FinanceTransactionIn


def test_manual_cash_adjustment_uses_source_direction_for_cash_subtract():
    payload = FinanceTransactionIn(
        transaction_type="cash_adjustment",
        source_account_code="cash",
        destination_account_code=None,
        amount="10.00",
    )
    source, destination = finance._manual_transaction_accounts(payload)
    assert source == "cash"
    assert destination == "adjustment"


def test_manual_cash_adjustment_defaults_to_adjustment_to_cash_when_unspecified():
    payload = FinanceTransactionIn(
        transaction_type="cash_adjustment",
        amount="10.00",
    )
    source, destination = finance._manual_transaction_accounts(payload)
    assert source == "adjustment"
    assert destination == "cash"
