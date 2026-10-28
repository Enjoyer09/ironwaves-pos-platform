"""Durable manual-finance request keys and compound transfer fee snapshots.

Revision ID: 20261026_0001
Revises: 20261011_0004
"""
from alembic import op
import sqlalchemy as sa

revision = "20261026_0001"
down_revision = "20261011_0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "finance_operation_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=True),
        sa.Column("operation_type", sa.String(32), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("created_by", sa.String(80), nullable=False),
        sa.Column("transaction_id", sa.String(36), sa.ForeignKey("finance_transactions.id"), nullable=True),
        sa.Column("bank_commission", sa.Numeric(12, 2), nullable=False, server_default="0.00"),
        sa.Column("fee_transaction_id", sa.String(36), sa.ForeignKey("finance_transactions.id"), nullable=True),
        sa.Column("response_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_finance_operation_tenant_key"),
        sa.UniqueConstraint("tenant_id", "transaction_id", name="uq_finance_operation_transaction"),
        sa.CheckConstraint("bank_commission >= 0", name="ck_finance_operation_commission_nonnegative"),
    )
    op.create_index("ix_finance_operation_tenant_created", "finance_operation_requests", ["tenant_id", "created_at"])


def downgrade():
    op.drop_index("ix_finance_operation_tenant_created", table_name="finance_operation_requests")
    op.drop_table("finance_operation_requests")
