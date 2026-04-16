"""add settings and ledger hot-path indexes

Revision ID: 20260416_0004
Revises: 20260416_0003
Create Date: 2026-04-16 16:05:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260416_0004"
down_revision: Union[str, None] = "20260416_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_settings_tenant_key ON settings (tenant_id, key)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_finance_ledger_entries_tenant_account_side "
        "ON finance_ledger_entries (tenant_id, account_id, entry_side)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_finance_ledger_entries_tenant_account_side")
    op.execute("DROP INDEX IF EXISTS ix_settings_tenant_key")
