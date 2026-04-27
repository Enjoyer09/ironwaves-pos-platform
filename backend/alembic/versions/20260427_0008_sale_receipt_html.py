"""add sale receipt html snapshot

Revision ID: 20260427_0008
Revises: 20260427_0007
Create Date: 2026-04-27 18:20:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260427_0008"
down_revision: Union[str, None] = "20260427_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("receipt_html", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("sales", "receipt_html")
