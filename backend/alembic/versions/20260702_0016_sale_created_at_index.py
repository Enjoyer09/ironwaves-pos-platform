"""Add index on sales.created_at for analytics date-range queries

Revision ID: 20260702_0016
Revises: 20260525_0015
Create Date: 2026-07-02
"""
from alembic import op

revision = "20260702_0016"
down_revision = "20260525_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_sales_tenant_created_at",
        "sales",
        ["tenant_id", "created_at"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_sales_tenant_created_at", table_name="sales", if_exists=True)
