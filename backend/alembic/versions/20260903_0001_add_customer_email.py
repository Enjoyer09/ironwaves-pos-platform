"""add email column to customers table

Revision ID: 20260903_0001
Revises: 20260825_0001
Create Date: 2026-09-03 17:55:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260903_0001"
down_revision: Union[str, None] = "20260825_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "customers",
        sa.Column("email", sa.String(length=255), nullable=True),
    )
    op.create_index(
        "ix_customers_email",
        "customers",
        ["email"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_customers_email", table_name="customers")
    op.drop_column("customers", "email")
