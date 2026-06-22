"""add suppliers table

Revision ID: 20260622_1250
Revises: 20260621_1516
Create Date: 2026-06-22 12:50:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260622_1250"
down_revision: Union[str, None] = "20260621_1516"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "suppliers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("contact_person", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=80), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("balance", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0.00"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_suppliers_tenant_id", "suppliers", ["tenant_id"], unique=False)
    
    op.add_column("finance_transactions", sa.Column("supplier_id", sa.String(length=36), nullable=True))
    op.create_index("ix_finance_transactions_supplier_id", "finance_transactions", ["supplier_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_finance_transactions_supplier_id", table_name="finance_transactions")
    op.drop_column("finance_transactions", "supplier_id")
    op.drop_index("ix_suppliers_tenant_id", table_name="suppliers")
    op.drop_table("suppliers")
