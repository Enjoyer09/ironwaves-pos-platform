"""Finance v2 cut-over: gl_alerts (reconciliation alerting, additive)

Revision ID: 20261002_0001
Revises: 20261001_0001
Create Date: 2026-10-02 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261002_0001"
down_revision: Union[str, None] = "20261001_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "gl_alerts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("alert_type", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("context", sa.Text(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("occurrences", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("acknowledged_by", sa.String(80), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_gl_alerts_tenant_type_status", "gl_alerts", ["tenant_id", "alert_type", "status"])


def downgrade() -> None:
    op.drop_index("ix_gl_alerts_tenant_type_status", table_name="gl_alerts")
    op.drop_table("gl_alerts")
