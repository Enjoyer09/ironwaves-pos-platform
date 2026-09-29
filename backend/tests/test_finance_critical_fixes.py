from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import finance, pos
from app.services.finance_service import commission_percent


# --- #1 approval policy cannot be bypassed by the client -------------------

def test_client_cannot_opt_out_of_cash_adjustment_approval():
    assert finance._approval_required("cash_adjustment", Decimal("5000"), False, finance.DEFAULT_FINANCE_POLICY) is True


def test_client_cannot_opt_out_of_large_transfer_approval():
    assert finance._approval_required("internal_transfer", Decimal("5000"), False, finance.DEFAULT_FINANCE_POLICY) is True


def test_client_can_escalate_to_approval():
    assert finance._approval_required("income", Decimal("1"), True, finance.DEFAULT_FINANCE_POLICY) is True


def test_small_transfer_without_policy_trigger_posts_directly():
    assert finance._approval_required("internal_transfer", Decimal("10"), False, finance.DEFAULT_FINANCE_POLICY) is False


# --- #2 investor repayment re-validated against current balances ----------

def _patch_balances(monkeypatch, debt: str, available: str):
    monkeypatch.setattr(finance, "_lock_finance_accounts", lambda *a, **k: None)
    monkeypatch.setattr(finance, "_investor_debt_balance", lambda db, t: Decimal(debt))
    monkeypatch.setattr(finance, "_wallet_balance", lambda db, t, s: Decimal(available))


def test_investor_repayment_rejected_when_exceeding_current_debt(monkeypatch):
    # Second of two 1000 requests: first one already cut the debt to 0.
    _patch_balances(monkeypatch, debt="0", available="5000")
    with pytest.raises(HTTPException) as exc:
        finance._ensure_investor_repayment_capacity(None, "t", "cash", Decimal("1000"))
    assert exc.value.status_code == 400


def test_investor_repayment_rejected_when_wallet_insufficient(monkeypatch):
    _patch_balances(monkeypatch, debt="5000", available="100")
    with pytest.raises(HTTPException):
        finance._ensure_investor_repayment_capacity(None, "t", "cash", Decimal("1000"))


def test_investor_repayment_allowed_within_limits(monkeypatch):
    _patch_balances(monkeypatch, debt="1000", available="1000")
    finance._ensure_investor_repayment_capacity(None, "t", "cash", Decimal("1000"))


# --- #3 explicit 0% commission is respected --------------------------------

@pytest.mark.parametrize("value", [0, "0", 0.0, "0.00"])
def test_zero_commission_is_kept(value):
    assert commission_percent({"card_transfer_percent": value}, "card_transfer_percent", "0.5") == Decimal("0")


@pytest.mark.parametrize("config", [{}, None, {"card_transfer_percent": None}, {"card_transfer_percent": ""}, {"card_transfer_percent": "abc"}, {"card_transfer_percent": -1}])
def test_missing_or_invalid_commission_falls_back(config):
    assert commission_percent(config, "card_transfer_percent", "0.5") == Decimal("0.5")


def test_commission_fallback_key_and_comma_decimal():
    assert commission_percent({"percent": "1,5"}, "card_sale_percent", 2, "percent") == Decimal("1.5")


# --- #4 staff benefit: only the part within the remaining limit counts -----

def _item(price, qty=1, name="Latte", category="coffee"):
    return SimpleNamespace(price=price, qty=qty, item_name=name, category=category, is_coffee=True)


def test_staff_benefit_capped_by_remaining_daily_limit():
    cfg = {"daily_limit_azn": 6, "coffee_unit_cap_azn": 6, "other_unit_cap_azn": 2, "allowed_scope": "all"}
    # 4 AZN already used today, 5 AZN coffee -> 2 covered, 3 due.
    due, benefit, remaining = pos._calculate_staff_due([_item("5")], Decimal("4"), cfg)
    assert due == Decimal("3.00")
    assert benefit == Decimal("2.00")
    assert remaining == Decimal("0.00")
    assert due + benefit == Decimal("5.00")
