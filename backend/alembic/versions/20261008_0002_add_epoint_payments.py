"""F3/F6 — epoint_payments (epoint.az ödəniş cəhdləri)

Revision ID: 20261008_0002
Revises: 20261008_0001
Create Date: 2026-10-08 19:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261008_0002"
down_revision: Union[str, None] = "20261008_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "epoint_payments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("card_id", sa.String(80), nullable=False),
        sa.Column("order_id", sa.String(36), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(8), nullable=False, server_default="AZN"),
        sa.Column("transaction", sa.String(64), nullable=True),
        sa.Column("status", sa.String(24), nullable=False, server_default="new"),
        sa.Column("code", sa.String(16), nullable=True),
        sa.Column("rrn", sa.String(64), nullable=True),
        sa.Column("message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_epoint_payments_tenant_id", "epoint_payments", ["tenant_id"])
    op.create_index("ix_epoint_payments_card_id", "epoint_payments", ["card_id"])
    op.create_index("ix_epoint_payments_order_id", "epoint_payments", ["order_id"])
    op.create_index("ix_epoint_payments_transaction", "epoint_payments", ["transaction"])


def downgrade() -> None:
    op.drop_index("ix_epoint_payments_transaction", table_name="epoint_payments")
    op.drop_index("ix_epoint_payments_order_id", table_name="epoint_payments")
    op.drop_index("ix_epoint_payments_card_id", table_name="epoint_payments")
    op.drop_index("ix_epoint_payments_tenant_id", table_name="epoint_payments")
    op.drop_table("epoint_payments")
