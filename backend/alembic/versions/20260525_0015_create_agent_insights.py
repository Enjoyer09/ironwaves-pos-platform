"""create agent insights table

Revision ID: 20260525_0015
Revises: 20260502_0014
Create Date: 2026-05-25 00:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260525_0015"
down_revision: Union[str, None] = "20260502_0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_insights",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("insight_type", sa.String(64), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_agent_insights_tenant_id", "agent_insights", ["tenant_id"])
    op.create_index("ix_agent_insights_tenant_created", "agent_insights", ["tenant_id", "created_at"])


def downgrade() -> None:
    op.drop_table("agent_insights")
