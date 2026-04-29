"""order item stock consumption markers

Revision ID: 20260429_0012
Revises: 20260429_0011
Create Date: 2026-04-29 00:00:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260429_0012"
down_revision: Union[str, None] = "20260429_0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_consumed_at TIMESTAMP WITHOUT TIME ZONE")
    op.execute("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_consumption_reason VARCHAR(80)")


def downgrade() -> None:
    op.execute("ALTER TABLE order_items DROP COLUMN IF EXISTS stock_consumption_reason")
    op.execute("ALTER TABLE order_items DROP COLUMN IF EXISTS stock_consumed_at")
