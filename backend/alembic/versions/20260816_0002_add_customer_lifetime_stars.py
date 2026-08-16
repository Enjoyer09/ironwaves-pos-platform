"""add lifetime_stars to customers for tier progression

Revision ID: 20260816_0002
Revises: 20260816_0001
Create Date: 2026-08-16 11:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260816_0002"
down_revision: Union[str, None] = "20260816_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("lifetime_stars", sa.Integer(), nullable=False, server_default="0"))
    # Backfill: existing customers keep the stars they already earned — nobody starts at zero.
    op.execute("UPDATE customers SET lifetime_stars = stars WHERE lifetime_stars = 0")


def downgrade() -> None:
    op.drop_column("customers", "lifetime_stars")
