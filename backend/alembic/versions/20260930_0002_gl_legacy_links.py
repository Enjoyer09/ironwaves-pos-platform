"""Finance v2 dual mode: gl_legacy_links (additive)

Revision ID: 20260930_0002
Revises: 20260930_0001
Create Date: 2026-09-30 16:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260930_0002"
down_revision: Union[str, None] = "20260930_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "gl_legacy_links",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("legacy_txn_id", sa.String(36), nullable=False),
        sa.Column("journal_id", sa.String(36), sa.ForeignKey("gl_journals.id"), nullable=False),
        sa.Column("event_type", sa.String(48), nullable=False),
        sa.Column("wallet_diff", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("tenant_id", "legacy_txn_id", name="uq_gl_legacy_links_txn"),
    )
    op.create_index("ix_gl_legacy_links_tenant_journal", "gl_legacy_links", ["tenant_id", "journal_id"])


def downgrade() -> None:
    op.drop_index("ix_gl_legacy_links_tenant_journal", table_name="gl_legacy_links")
    op.drop_table("gl_legacy_links")
