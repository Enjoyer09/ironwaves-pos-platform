"""add birth_date to customers for birthday rewards

Revision ID: 20260816_0003
Revises: 20260816_0002
Create Date: 2026-08-16 12:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260816_0003"
down_revision: Union[str, None] = "20260816_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable — optional field; existing customers are untouched, no backfill needed.
    op.add_column("customers", sa.Column("birth_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("customers", "birth_date")
