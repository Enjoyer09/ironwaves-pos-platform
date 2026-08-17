"""add campaign_id to sales for P1-4b campaign discount attribution

Revision ID: 20260816_0006
Revises: 20260816_0005
Create Date: 2026-08-17 11:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260816_0006"
down_revision: Union[str, None] = "20260816_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Additive, nullable — existing sales are untouched (no campaign attribution).
    op.add_column("sales", sa.Column("campaign_id", sa.String(36), nullable=True))
    op.create_index("ix_sales_campaign_id", "sales", ["campaign_id"])


def downgrade() -> None:
    op.drop_index("ix_sales_campaign_id", table_name="sales")
    op.drop_column("sales", "campaign_id")
