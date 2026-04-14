"""finance hardening indexes and constraints

Revision ID: 20260414_0001
Revises:
Create Date: 2026-04-14 00:00:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260414_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_finance_transactions_tenant_created ON finance_transactions (tenant_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_finance_transactions_tenant_status_created ON finance_transactions (tenant_id, status, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_finance_transactions_tenant_type_created ON finance_transactions (tenant_id, transaction_type, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_finance_ledger_entries_tenant_account_created ON finance_ledger_entries (tenant_id, account_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_finance_ledger_entries_tenant_transaction ON finance_ledger_entries (tenant_id, transaction_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_tenant_created ON audit_logs (tenant_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_tenant_action_created ON audit_logs (tenant_id, action, created_at)")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ck_finance_transactions_amount_positive'
            ) THEN
                ALTER TABLE finance_transactions
                ADD CONSTRAINT ck_finance_transactions_amount_positive
                CHECK (amount > 0);
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ck_finance_transactions_status_valid'
            ) THEN
                ALTER TABLE finance_transactions
                ADD CONSTRAINT ck_finance_transactions_status_valid
                CHECK (status IN ('draft','pending_approval','approved','posted','rejected','reversed'));
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ck_finance_ledger_entries_amount_positive'
            ) THEN
                ALTER TABLE finance_ledger_entries
                ADD CONSTRAINT ck_finance_ledger_entries_amount_positive
                CHECK (amount > 0);
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ck_finance_ledger_entries_side_valid'
            ) THEN
                ALTER TABLE finance_ledger_entries
                ADD CONSTRAINT ck_finance_ledger_entries_side_valid
                CHECK (entry_side IN ('debit','credit'));
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE finance_ledger_entries DROP CONSTRAINT IF EXISTS ck_finance_ledger_entries_side_valid")
    op.execute("ALTER TABLE finance_ledger_entries DROP CONSTRAINT IF EXISTS ck_finance_ledger_entries_amount_positive")
    op.execute("ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS ck_finance_transactions_status_valid")
    op.execute("ALTER TABLE finance_transactions DROP CONSTRAINT IF EXISTS ck_finance_transactions_amount_positive")
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_tenant_action_created")
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_tenant_created")
    op.execute("DROP INDEX IF EXISTS ix_finance_ledger_entries_tenant_transaction")
    op.execute("DROP INDEX IF EXISTS ix_finance_ledger_entries_tenant_account_created")
    op.execute("DROP INDEX IF EXISTS ix_finance_transactions_tenant_type_created")
    op.execute("DROP INDEX IF EXISTS ix_finance_transactions_tenant_status_created")
    op.execute("DROP INDEX IF EXISTS ix_finance_transactions_tenant_created")
