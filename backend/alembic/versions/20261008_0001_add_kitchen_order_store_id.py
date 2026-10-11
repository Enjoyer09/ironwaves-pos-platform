"""F5.2 — kitchen_orders.store_id (online sifarişin filialı)

Revision ID: 20261008_0001
Revises: 20261002_0001
Create Date: 2026-10-08 16:30:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261008_0001"
down_revision: Union[str, None] = "20261002_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("kitchen_orders", sa.Column("store_id", sa.String(80), nullable=True))


def downgrade() -> None:
    op.drop_column("kitchen_orders", "store_id")
