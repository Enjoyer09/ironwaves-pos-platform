from decimal import Decimal
from app.routers.pos import _calculate_discounted_items_total, _is_promo_eligible_category

class MockItem:
    def __init__(self, item_name, category, price, qty, is_coffee=False):
        self.item_name = item_name
        self.category = category
        self.price = Decimal(str(price))
        self.qty = qty
        self.is_coffee = is_coffee


def test_is_promo_eligible_category():
    assert _is_promo_eligible_category("Cold Drinks") is True
    assert _is_promo_eligible_category("iced kofe") is True
    assert _is_promo_eligible_category("Frappes") is True
    assert _is_promo_eligible_category("Smoothies") is True
    assert _is_promo_eligible_category("Desert") is False
    assert _is_promo_eligible_category("Qəhvə") is False
    # Unicode casing tests (capital dotted I)
    assert _is_promo_eligible_category("Soyuq İçkilər") is True
    assert _is_promo_eligible_category("İced Qəhvə") is True
    # Substring matches
    assert _is_promo_eligible_category("Soyuq İçkilər (Xüsusi)") is True
    assert _is_promo_eligible_category("Iced Coffee Blend") is True



def test_scenario_a_different_prices_enabled():
    # Customer buys: 1x Iced Latte (6.00 AZN) and 1x Iced Americano (3.00 AZN)
    items = [
        MockItem("Iced Latte", "Iced Coffees", 6.00, 1),
        MockItem("Iced Americano", "Iced Coffees", 3.00, 1)
    ]
    beverage_settings = {"summer_promo_enabled": True}
    total, item_promo, coffee_prices = _calculate_discounted_items_total(items, 0, beverage_settings)
    
    assert total == Decimal("7.50")
    assert item_promo[0] == Decimal("0.00")
    assert item_promo[1] == Decimal("1.50")


def test_scenario_a_different_prices_disabled():
    items = [
        MockItem("Iced Latte", "Iced Coffees", 6.00, 1),
        MockItem("Iced Americano", "Iced Coffees", 3.00, 1)
    ]
    beverage_settings = {"summer_promo_enabled": False}
    total, item_promo, coffee_prices = _calculate_discounted_items_total(items, 0, beverage_settings)
    
    assert total == Decimal("9.00")
    assert item_promo[0] == Decimal("0.00")
    assert item_promo[1] == Decimal("0.00")


def test_scenario_b_same_prices_enabled():
    # Customer buys: 2x Iced Latte (6.00 AZN each)
    items = [
        MockItem("Iced Latte", "Iced Coffees", 6.00, 2)
    ]
    beverage_settings = {"summer_promo_enabled": True}
    total, item_promo, coffee_prices = _calculate_discounted_items_total(items, 0, beverage_settings)
    
    assert total == Decimal("9.00")
    assert item_promo[0] == Decimal("3.00")


def test_scenario_b_same_prices_disabled():
    items = [
        MockItem("Iced Latte", "Iced Coffees", 6.00, 2)
    ]
    beverage_settings = {"summer_promo_enabled": False}
    total, item_promo, coffee_prices = _calculate_discounted_items_total(items, 0, beverage_settings)
    
    assert total == Decimal("12.00")
    assert item_promo[0] == Decimal("0.00")


def test_scenario_c_odd_number_enabled():
    # Customer buys: 1x Frappe (7.00 AZN), 1x Iced Latte (6.00 AZN), 1x Iced Americano (3.00 AZN)
    items = [
        MockItem("Frappe", "Frappes", 7.00, 1),
        MockItem("Iced Latte", "Iced Coffees", 6.00, 1),
        MockItem("Iced Americano", "Iced Coffees", 3.00, 1)
    ]
    beverage_settings = {"summer_promo_enabled": True}
    total, item_promo, coffee_prices = _calculate_discounted_items_total(items, 0, beverage_settings)
    
    # Sorted: 7.00, 6.00, 3.00
    # Pairs: (7.00, 6.00) -> 6.00 gets 50% off
    # Expected total: 7.00 + 3.00 + 3.00 = 13.00 AZN
    assert total == Decimal("13.00")
    assert item_promo[0] == Decimal("0.00") # Frappe
    assert item_promo[1] == Decimal("3.00") # Iced Latte
    assert item_promo[2] == Decimal("0.00") # Iced Americano


def test_scenario_c_odd_number_disabled():
    items = [
        MockItem("Frappe", "Frappes", 7.00, 1),
        MockItem("Iced Latte", "Iced Coffees", 6.00, 1),
        MockItem("Iced Americano", "Iced Coffees", 3.00, 1)
    ]
    beverage_settings = {"summer_promo_enabled": False}
    total, item_promo, coffee_prices = _calculate_discounted_items_total(items, 0, beverage_settings)
    
    assert total == Decimal("16.00")
    assert item_promo[0] == Decimal("0.00")
    assert item_promo[1] == Decimal("0.00")
    assert item_promo[2] == Decimal("0.00")


def test_update_beverage_service_settings_preserves_promo_enabled():
    from app.routers.operations import update_beverage_service_settings
    from unittest.mock import MagicMock
    
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    
    tenant = MagicMock()
    tenant.id = "tenant-1"
    
    user = MagicMock()
    user.role = "admin"
    
    payload = {
        "coffee_selection_mode": "size_only",
        "remove_paper_packaging_for_table": False,
        "discount_scope": "coffee_only",
        "summer_promo_enabled": True
    }
    
    res = update_beverage_service_settings(payload, db, tenant, user)
    assert res["success"] is True
    assert res["beverage_service_settings"]["summer_promo_enabled"] is True


def test_item_name_fallback_for_general_category():
    # Customer buys: 1x Iced Latte (6.00 AZN) and 1x Iced Espresso (4.00 AZN)
    # both under the category "Qəhvə" (not in eligible categories list)
    items = [
        MockItem("Iced Latte", "Qəhvə", 6.00, 1),
        MockItem("Iced Espresso", "Qəhvə", 4.00, 1)
    ]
    beverage_settings = {"summer_promo_enabled": True}
    total, item_promo, coffee_prices = _calculate_discounted_items_total(items, 0, beverage_settings)
    
    # Both should be eligible because their name contains "Iced"
    # Sorted: 6.00, 4.00 -> 4.00 gets 50% discount (2.00 AZN)
    assert total == Decimal("8.00")
    assert item_promo[0] == Decimal("0.00")
    assert item_promo[1] == Decimal("2.00")


