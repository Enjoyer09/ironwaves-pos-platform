"""add discount reason column

Revision ID: 20260619_0019
Revises: 20260613_0018
Create Date: 2026-06-19 19:45:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260619_0019"
down_revision: Union[str, None] = "20260613_0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sales", sa.Column("discount_reason", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("sales", "discount_reason")
