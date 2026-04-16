"""add shift close audit snapshot fields

Revision ID: 20260416_0003
Revises: 20260416_0002
Create Date: 2026-04-16 00:30:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260416_0003"
down_revision: Union[str, None] = "20260416_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closing_cash NUMERIC(12,2)")
    op.execute("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS actual_cash NUMERIC(12,2)")
    op.execute("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS declared_cash NUMERIC(12,2)")
    op.execute("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cash_variance NUMERIC(12,2)")
    op.execute("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closing_deposit_liability NUMERIC(12,2)")
    op.execute("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS deposit_settled_amount NUMERIC(12,2)")


def downgrade() -> None:
    op.execute("ALTER TABLE shifts DROP COLUMN IF EXISTS deposit_settled_amount")
    op.execute("ALTER TABLE shifts DROP COLUMN IF EXISTS closing_deposit_liability")
    op.execute("ALTER TABLE shifts DROP COLUMN IF EXISTS cash_variance")
    op.execute("ALTER TABLE shifts DROP COLUMN IF EXISTS declared_cash")
    op.execute("ALTER TABLE shifts DROP COLUMN IF EXISTS actual_cash")
    op.execute("ALTER TABLE shifts DROP COLUMN IF EXISTS closing_cash")
