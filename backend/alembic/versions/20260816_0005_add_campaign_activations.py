"""add campaign_activations for P1-4 server-validated campaigns

Revision ID: 20260816_0005
Revises: 20260816_0004
Create Date: 2026-08-16 14:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260816_0005"
down_revision: Union[str, None] = "20260816_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "campaign_activations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("campaign_id", sa.String(36), sa.ForeignKey("happy_hours.id"), nullable=False),
        sa.Column("card_id", sa.String(80), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="ACTIVE"),
        sa.Column("activated_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", "campaign_id", "card_id", name="uq_campaign_activation_per_customer"),
    )
    op.create_index("ix_campaign_activations_tenant_id", "campaign_activations", ["tenant_id"])
    op.create_index("ix_campaign_activations_campaign_id", "campaign_activations", ["campaign_id"])
    op.create_index("ix_campaign_activations_card_id", "campaign_activations", ["card_id"])


def downgrade() -> None:
    # Only active campaign sessions are lost — transient data by design.
    op.drop_table("campaign_activations")
