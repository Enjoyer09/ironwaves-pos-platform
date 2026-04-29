"""finance report period indexes

Revision ID: 20260429_0013
Revises: 20260429_0012
Create Date: 2026-04-29 00:00:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260429_0013"
down_revision: Union[str, None] = "20260429_0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_finance_txn_tenant_status_report_date
            ON finance_transactions (
                tenant_id,
                status,
                COALESCE(posted_at, approved_at, created_at)
            )
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_finance_txn_tenant_type_status_report_date
            ON finance_transactions (
                tenant_id,
                transaction_type,
                status,
                COALESCE(posted_at, approved_at, created_at)
            )
            """
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX IF EXISTS ix_finance_txn_tenant_type_status_report_date")
        op.execute("DROP INDEX IF EXISTS ix_finance_txn_tenant_status_report_date")
