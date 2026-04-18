from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import FinanceAccount, FinanceLedgerEntry, FinanceTransaction, Shift, Tenant
from app.services.finance_service import account_ledger_totals_for_update, shift_cash_breakdown_from_ledger


pytestmark = pytest.mark.integration


def _integration_db_url() -> str:
    raw = str(os.getenv("INTEGRATION_DATABASE_URL") or "").strip()
    if not raw:
        pytest.skip("INTEGRATION_DATABASE_URL is not set")
    if not raw.startswith("postgresql"):
        pytest.skip("Integration test requires a PostgreSQL URL")
    return raw


@pytest.fixture(scope="session")
def _engine():
    engine = create_engine(_integration_db_url(), future=True, pool_pre_ping=True)
    Base.metadata.create_all(bind=engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture()
def db(_engine):
    connection = _engine.connect()
    transaction = connection.begin()
    SessionLocal = sessionmaker(bind=connection, autoflush=False, autocommit=False, expire_on_commit=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


def _seed_tenant(db) -> Tenant:
    tenant = Tenant(
        id=str(uuid.uuid4()),
        name=f"Integration Tenant {uuid.uuid4().hex[:8]}",
        slug=f"it-{uuid.uuid4().hex[:10]}",
        domain=f"it-{uuid.uuid4().hex[:10]}.example.test",
        status="active",
    )
    db.add(tenant)
    db.flush()
    return tenant


def _create_account(db, tenant_id: str, code: str, account_type: str) -> FinanceAccount:
    account = FinanceAccount(
        tenant_id=tenant_id,
        code=code,
        name=code.capitalize(),
        account_type=account_type,
        currency="AZN",
        is_active=True,
    )
    db.add(account)
    db.flush()
    return account


def _create_transaction(db, tenant_id: str) -> FinanceTransaction:
    txn = FinanceTransaction(
        tenant_id=tenant_id,
        transaction_type="internal_transfer",
        status="posted",
        amount=Decimal("1.00"),
        currency="AZN",
        created_by="integration",
    )
    db.add(txn)
    db.flush()
    return txn


def test_account_ledger_totals_for_update_with_real_postgres(db):
    tenant = _seed_tenant(db)
    cash_account = _create_account(db, tenant.id, "cash", "cash_drawer")
    txn = _create_transaction(db, tenant.id)
    db.add_all(
        [
            FinanceLedgerEntry(
                tenant_id=tenant.id,
                transaction_id=txn.id,
                account_id=cash_account.id,
                entry_side="debit",
                amount=Decimal("15.00"),
                currency="AZN",
                description="integration debit",
            ),
            FinanceLedgerEntry(
                tenant_id=tenant.id,
                transaction_id=txn.id,
                account_id=cash_account.id,
                entry_side="credit",
                amount=Decimal("4.00"),
                currency="AZN",
                description="integration credit",
            ),
        ]
    )
    db.flush()

    totals = account_ledger_totals_for_update(db, tenant.id, cash_account)

    assert totals["debit"] == Decimal("15.00")
    assert totals["credit"] == Decimal("4.00")
    assert totals["balance"] == Decimal("11.00")


def test_shift_cash_breakdown_from_ledger_lock_mode_with_real_postgres(db):
    tenant = _seed_tenant(db)
    cash_account = _create_account(db, tenant.id, "cash", "cash_drawer")
    txn = _create_transaction(db, tenant.id)
    opened_at = datetime.utcnow()
    shift = Shift(
        tenant_id=tenant.id,
        status="open",
        opened_by="integration",
        opened_at=opened_at,
        opening_cash=Decimal("5.00"),
    )
    db.add(shift)
    db.flush()

    db.add(
        FinanceLedgerEntry(
            tenant_id=tenant.id,
            transaction_id=txn.id,
            account_id=cash_account.id,
            entry_side="debit",
            amount=Decimal("99.00"),
            currency="AZN",
            description="before shift open",
            created_at=opened_at - timedelta(minutes=1),
        )
    )
    db.add(
        FinanceLedgerEntry(
            tenant_id=tenant.id,
            transaction_id=txn.id,
            account_id=cash_account.id,
            entry_side="debit",
            amount=Decimal("20.00"),
            currency="AZN",
            description="after shift debit",
            created_at=opened_at + timedelta(seconds=1),
        )
    )
    db.add(
        FinanceLedgerEntry(
            tenant_id=tenant.id,
            transaction_id=txn.id,
            account_id=cash_account.id,
            entry_side="credit",
            amount=Decimal("7.00"),
            currency="AZN",
            description="after shift credit",
            created_at=opened_at + timedelta(seconds=2),
        )
    )
    db.flush()

    result = shift_cash_breakdown_from_ledger(db, tenant.id, shift, lock_for_update=True)

    assert result["opening_cash"] == Decimal("5.00")
    assert result["cash_in"] == Decimal("20.00")
    assert result["cash_out"] == Decimal("7.00")
    assert result["expected_cash"] == Decimal("18.00")

