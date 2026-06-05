"""create central backup logs table

Revision ID: 20260605_0016
Revises: 20260525_0015
Create Date: 2026-06-05 00:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260605_0016"
down_revision: Union[str, None] = "20260525_0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "central_backup_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_slug", sa.String(120), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("backup_size_bytes", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_central_backup_logs_tenant_id", "central_backup_logs", ["tenant_id"])


def downgrade() -> None:
    op.drop_table("central_backup_logs")
