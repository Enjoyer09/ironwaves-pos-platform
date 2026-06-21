"""add phone to customer

Revision ID: 20260621_1516
Revises: 20260621_1450
Create Date: 2026-06-21 15:16:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260621_1516"
down_revision: Union[str, None] = "20260621_1450"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("phone", sa.String(length=40), nullable=True))
    op.create_index("ix_customers_phone", "customers", ["phone"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_customers_phone", table_name="customers")
    op.drop_column("customers", "phone")
