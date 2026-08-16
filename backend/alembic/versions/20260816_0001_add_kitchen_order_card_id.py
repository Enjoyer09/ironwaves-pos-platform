"""add card_id to kitchen orders for customer order tracking

Revision ID: 20260816_0001
Revises: 20260622_1250
Create Date: 2026-08-16 10:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260816_0001"
down_revision: Union[str, None] = "20260622_1250"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("kitchen_orders", sa.Column("card_id", sa.String(length=80), nullable=True))
    op.create_index("ix_kitchen_orders_tenant_card_created", "kitchen_orders", ["tenant_id", "card_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_kitchen_orders_tenant_card_created", table_name="kitchen_orders")
    op.drop_column("kitchen_orders", "card_id")
