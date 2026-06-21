"""add push token column to customer

Revision ID: 20260621_1450
Revises: 20260619_0019
Create Date: 2026-06-21 14:50:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260621_1450"
down_revision: Union[str, None] = "20260619_0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("customers", sa.Column("push_token", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("customers", "push_token")
