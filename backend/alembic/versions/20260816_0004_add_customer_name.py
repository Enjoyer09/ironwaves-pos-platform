"""add name to customers for P0-3 onboarding

Revision ID: 20260816_0004
Revises: 20260816_0003
Create Date: 2026-08-16 13:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260816_0004"
down_revision: Union[str, None] = "20260816_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable — optional field; existing customers are untouched, no backfill needed.
    op.add_column("customers", sa.Column("name", sa.String(120), nullable=True))


def downgrade() -> None:
    op.drop_column("customers", "name")
