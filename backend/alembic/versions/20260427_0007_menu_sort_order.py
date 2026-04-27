"""menu sort order support

Revision ID: 20260427_0007
Revises: 20260424_0006
Create Date: 2026-04-27 17:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260427_0007"
down_revision: Union[str, None] = "20260424_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("menu_items", sa.Column("sort_order", sa.Integer(), nullable=True))
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY tenant_id
                       ORDER BY category ASC, item_name ASC, id ASC
                   ) - 1 AS next_sort_order
            FROM menu_items
        )
        UPDATE menu_items
        SET sort_order = ranked.next_sort_order
        FROM ranked
        WHERE menu_items.id = ranked.id
        """
    )
    op.alter_column("menu_items", "sort_order", existing_type=sa.Integer(), nullable=False, server_default="0")
    op.create_index("ix_menu_items_tenant_sort_order", "menu_items", ["tenant_id", "sort_order"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_menu_items_tenant_sort_order", table_name="menu_items")
    op.drop_column("menu_items", "sort_order")
