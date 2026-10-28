"""Compound transfer posting: one approval, one commit, a fixed server fee."""
from decimal import Decimal

from fastapi import HTTPException

from app.gl import bridge, posting_rules as rules
from app.gl.engine import business_today
from app.services import finance_service as finance


def commission(db, tenant_id, source, target, amount):
    if source != "card" or target not in {"cash", "debt"}:
        return Decimal("0.00")
    if tenant_id == "6e2c0d4c-6fab-4e49-8f9d-2d675457c655":
        return Decimal("0.60") if amount <= Decimal("100") else (amount * Decimal("0.005")).quantize(Decimal("0.01"))
    config = finance._setting_value(db, tenant_id, "bank_commission", {"card_transfer_percent": 0.5})
    percent = finance.commission_percent(config, "card_transfer_percent", "0.5")
    return (amount * percent / Decimal("100")).quantize(Decimal("0.01"))


def ensure_capacity(db, txn, operation):
    source = finance.finance_account_code(db, txn.tenant_id, txn.source_account_id)
    target = finance.finance_account_code(db, txn.tenant_id, txn.destination_account_id)
    fee = Decimal(str(operation.bank_commission))
    accounts = finance.lock_finance_accounts(db, txn.tenant_id, source, target, "expense" if fee > 0 else "")
    available = finance.account_ledger_totals_for_update(db, txn.tenant_id, accounts[source])["balance"]
    if Decimal(str(txn.amount)) + fee > available:
        raise HTTPException(status_code=400, detail="Insufficient balance for transfer and bank commission")
    return source, target


def post_compound(db, txn, operation, actor):
    source, target = ensure_capacity(db, txn, operation)
    fee = Decimal(str(operation.bank_commission))
    finance.post_existing_transaction(db, txn, actor)
    finance.mirror_posted_transaction_to_legacy_wallet(db, txn, actor)
    if fee > 0:
        fee_txn = finance.create_finance_transaction_record(
            db, tenant_id=txn.tenant_id, transaction_type="expense", status="approved", amount=fee,
            source_code=source, destination_code="expense", created_by=txn.created_by,
            category="Bank Komissiyası", note=f"Transfer komissiyası: {txn.id}",
        )
        fee_txn.approved_by = txn.approved_by
        fee_txn.approved_at = txn.approved_at
        finance.post_existing_transaction(db, fee_txn, actor)
        finance.mirror_posted_transaction_to_legacy_wallet(db, fee_txn, actor)
        operation.fee_transaction_id = fee_txn.id

    def event():
        day = business_today()
        amount = Decimal(str(txn.amount))
        if target == "debt":
            journals = [rules.post_event(db, txn.tenant_id, rules.FinancingMovement(txn.id, day, "lend_out", source, amount), actor=actor)]
            if fee > 0:
                journals.append(rules.post_event(db, txn.tenant_id, rules.ExpensePaid(f"{txn.id}:fee", day, "bank_fees", fee, source, note="Transfer komissiyası"), actor=actor))
            return journals
        return rules.WalletTransfer(txn.id, day, source, target, amount, bank_fee=fee, note=txn.note)

    bridge.emit(db, txn.tenant_id, event, actor=actor, event_type="WalletTransfer")
