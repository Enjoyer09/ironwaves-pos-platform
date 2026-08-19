"""add tenant_branches for multi-branch support

Revision ID: 20260819_0001
Revises: 20260816_0006
Create Date: 2026-08-19 12:00:00
"""

from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op


revision: str = "20260819_0001"
down_revision: Union[str, None] = "20260816_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_branches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("address", sa.String(300), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("latitude", sa.Float, nullable=True),
        sa.Column("longitude", sa.Float, nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("open_hour", sa.Integer(), nullable=False, server_default=sa.text("8")),
        sa.Column("close_hour", sa.Integer(), nullable=False, server_default=sa.text("23")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "name", name="uq_tenant_branch_name"),
    )
    op.create_index("ix_tenant_branches_tenant_id", "tenant_branches", ["tenant_id"])
    op.create_index("ix_tenant_branches_tenant_active", "tenant_branches", ["tenant_id", "is_active"])

    # Backfill: create a default branch for each tenant from business_profiles
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            INSERT INTO tenant_branches (id, tenant_id, name, address, phone, is_active, is_default, sort_order, created_at)
            SELECT
                lower(hex(randomblob(4)) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))))
            , bp.tenant_id
            , COALESCE(bp.company_name, 'Main')
            , bp.address
            , bp.phone
            , 1
            , 1
            , 0
            , datetime('now')
            FROM business_profiles bp
            WHERE NOT EXISTS (
                SELECT 1 FROM tenant_branches tb WHERE tb.tenant_id = bp.tenant_id
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_table("tenant_branches")
