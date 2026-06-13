"""add sale loyalty fields

Revision ID: 20260613_0018
Revises: 20260607_0017
Create Date: 2026-06-13 17:08:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260613_0018"
down_revision: Union[str, None] = "20260607_0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("customer_stars_after", sa.Integer(), nullable=True, server_default="0"))
    op.add_column("sales", sa.Column("free_coffees_applied", sa.Integer(), nullable=True, server_default="0"))


def downgrade() -> None:
    op.drop_column("sales", "customer_stars_after")
    op.drop_column("sales", "free_coffees_applied")
