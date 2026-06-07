"""create delivery menu mappings table

Revision ID: 20260607_0017
Revises: 20260605_0016
Create Date: 2026-06-07 00:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260607_0017"
down_revision: Union[str, None] = "20260605_0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "delivery_menu_mappings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("external_item_id", sa.String(255), nullable=False),
        sa.Column("external_item_name", sa.String(255), nullable=True),
        sa.Column("menu_item_id", sa.String(36), sa.ForeignKey("menu_items.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("tenant_id", "provider", "external_item_id", name="uq_delivery_menu_mappings"),
    )
    op.create_index("ix_delivery_menu_mappings_tenant_id", "delivery_menu_mappings", ["tenant_id"])
    op.create_index("ix_delivery_menu_mappings_external_item_id", "delivery_menu_mappings", ["external_item_id"])


def downgrade() -> None:
    op.drop_table("delivery_menu_mappings")
