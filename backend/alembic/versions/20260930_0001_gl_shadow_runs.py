"""Finance v2 shadow mode: gl_shadow_runs job log (additive)

Revision ID: 20260930_0001
Revises: 20260929_0001
Create Date: 2026-09-30 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260930_0001"
down_revision: Union[str, None] = "20260929_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "gl_shadow_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_type", sa.String(16), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("imported", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ok", sa.Boolean(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
    )
    op.create_index("ix_gl_shadow_runs_tenant_type_started", "gl_shadow_runs", ["tenant_id", "run_type", "started_at"])


def downgrade() -> None:
    op.drop_index("ix_gl_shadow_runs_tenant_type_started", table_name="gl_shadow_runs")
    op.drop_table("gl_shadow_runs")
