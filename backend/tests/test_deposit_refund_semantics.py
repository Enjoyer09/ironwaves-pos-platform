from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import finance_service


def test_post_deposit_refund_uses_wallet_to_deposit_mapping(monkeypatch):
    captured = {}

    def _fake_post_finance_transaction(db, **kwargs):
        captured.update(kwargs)
        return SimpleNamespace(id="txn-1")

    monkeypatch.setattr(finance_service, "post_finance_transaction", _fake_post_finance_transaction)
    monkeypatch.setattr(finance_service, "mirror_posted_transaction_to_legacy_wallet", lambda *args, **kwargs: [])

    txn = finance_service.post_deposit_refund(
        db=object(),
        tenant_id="tenant-1",
        amount=Decimal("10.00"),
        source_code="cash",
        created_by="tester",
    )

    assert txn is not None
    assert captured["transaction_type"] == "deposit_refund"
    assert captured["source_code"] == "cash"
    assert captured["destination_code"] == "deposit"


def test_post_deposit_refund_rejects_non_wallet_source():
    with pytest.raises(HTTPException) as exc:
        finance_service.post_deposit_refund(
            db=object(),
            tenant_id="tenant-1",
            amount=Decimal("10.00"),
            source_code="deposit",
            created_by="tester",
        )
    assert exc.value.status_code == 400
