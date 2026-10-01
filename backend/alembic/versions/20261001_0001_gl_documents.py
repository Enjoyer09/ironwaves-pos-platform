"""Finance v2 P3b: gl_documents and gl_document_allocations (additive)

Revision ID: 20261001_0001
Revises: 20260930_0002
Create Date: 2026-10-01 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261001_0001"
down_revision: Union[str, None] = "20260930_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "gl_documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("partner_type", sa.String(24), nullable=False),
        sa.Column("partner_id", sa.String(64), nullable=False),
        sa.Column("number", sa.String(64), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="AZN"),
        sa.Column("total", sa.Numeric(18, 2), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("journal_id", sa.String(36), sa.ForeignKey("gl_journals.id"), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("tenant_id", "kind", "partner_id", "number", name="uq_gl_documents_partner_number"),
    )
    op.create_index("ix_gl_documents_tenant_kind_status", "gl_documents", ["tenant_id", "kind", "status"])
    op.create_index("ix_gl_documents_tenant_partner", "gl_documents", ["tenant_id", "partner_id"])
    op.create_index("ix_gl_documents_tenant_due", "gl_documents", ["tenant_id", "due_date"])

    op.create_table(
        "gl_document_allocations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("gl_documents.id"), nullable=False),
        sa.Column("journal_id", sa.String(36), sa.ForeignKey("gl_journals.id"), nullable=False),
        sa.Column("journal_line_no", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_gl_doc_alloc_tenant_document", "gl_document_allocations", ["tenant_id", "document_id"])
    op.create_index("ix_gl_doc_alloc_tenant_journal", "gl_document_allocations", ["tenant_id", "journal_id"])


def downgrade() -> None:
    op.drop_index("ix_gl_doc_alloc_tenant_journal", table_name="gl_document_allocations")
    op.drop_index("ix_gl_doc_alloc_tenant_document", table_name="gl_document_allocations")
    op.drop_table("gl_document_allocations")

    op.drop_index("ix_gl_documents_tenant_due", table_name="gl_documents")
    op.drop_index("ix_gl_documents_tenant_partner", table_name="gl_documents")
    op.drop_index("ix_gl_documents_tenant_kind_status", table_name="gl_documents")
    op.drop_table("gl_documents")
