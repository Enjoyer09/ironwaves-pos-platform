"""store z report receipt html on shifts

Revision ID: 20260429_0009
Revises: 20260427_0008
Create Date: 2026-04-29 00:00:00
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260429_0009"
down_revision: Union[str, None] = "20260427_0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE shifts ADD COLUMN IF NOT EXISTS z_report_html TEXT")


def downgrade() -> None:
    op.drop_column("shifts", "z_report_html")
