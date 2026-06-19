import pytest
from decimal import Decimal
from fastapi import HTTPException
from app.routers import pos
from app.schemas import SaleCreateIn, SaleItemIn

class FakeTenant:
    id = "test-tenant"

class FakeUser:
    username = "test-cashier"
    role = "admin"

def test_create_sale_requires_reason_for_manual_discount(monkeypatch):
    # Mock shift and session guards to let execution proceed to the discount checks
    monkeypatch.setattr(pos, "_active_shift", lambda *_: True)
    monkeypatch.setattr(pos, "_staff_shift_session_open", lambda *_: True)
    # Mock bank commission settings access which happens before discount checks
    monkeypatch.setattr(pos, "_bank_commission_config", lambda *_: (Decimal("0"), Decimal("0")))
    
    # Minimal cart items
    cart = [
        SaleItemIn(
            item_name="Espresso",
            price=Decimal("4.00"),
            qty=1,
            category="Qəhvə"
        )
    ]
    
    # 1. Payload with discount but NO reason should raise HTTPException(400)
    payload_no_reason = SaleCreateIn(
        cart_items=cart,
        payment_method="Cash",
        discount_percent=Decimal("10"),
        discount_reason=None
    )
    
    with pytest.raises(HTTPException) as exc_info:
        pos.create_sale(
            payload=payload_no_reason,
            db=None,  # Not used prior to the discount checks since we mock config/guards
            tenant=FakeTenant(),
            user=FakeUser()
        )
        
    assert exc_info.value.status_code == 400
    assert "endirim səbəbini qeyd edin" in exc_info.value.detail

    # 2. Payload with discount AND reason should pass the discount reason check
    # (and then fail later on database access or other mocks since db=None, which is expected)
    payload_with_reason = SaleCreateIn(
        cart_items=cart,
        payment_method="Cash",
        discount_percent=Decimal("10"),
        discount_reason="Müştəri məmnuniyyəti"
    )
    
    monkeypatch.setattr(pos, "_setting_value", lambda *_: {})
    
    try:
        pos.create_sale(
            payload=payload_with_reason,
            db=None,
            tenant=FakeTenant(),
            user=FakeUser()
        )
    except AttributeError:
        # Since db is None, db.query/db.add will eventually raise AttributeError/Database error,
        # which means the validation check itself succeeded and execution passed through it.
        pass
    except Exception as e:
        # Any other error than our specific validation exception is acceptable here
        assert "endirim səbəbini qeyd edin" not in str(e)
