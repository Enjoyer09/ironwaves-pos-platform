"""add menu_items hot path index

Revision ID: 20260424_0006
Revises: 20260424_0005
Create Date: 2026-04-24 20:05:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260424_0006"
down_revision: Union[str, None] = "20260424_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_menu_items_tenant_active_category_item "
            "ON menu_items (tenant_id, is_active, category, item_name)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_menu_items_tenant_active_category_item")
