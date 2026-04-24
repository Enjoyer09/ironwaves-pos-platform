"""add hot write path indexes

Revision ID: 20260424_0005
Revises: 20260416_0004
Create Date: 2026-04-24 15:10:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260424_0005"
down_revision: Union[str, None] = "20260416_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sales_tenant_created ON sales (tenant_id, created_at)")
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_payments_tenant_paid ON payments (tenant_id, paid_at)")
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_payments_tenant_method_paid ON payments (tenant_id, method, paid_at)")
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_order_items_tenant_status_created ON order_items (tenant_id, status, created_at)")
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_order_items_tenant_check_status ON order_items (tenant_id, check_id, status)")
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_kitchen_orders_tenant_status_created ON kitchen_orders (tenant_id, status, created_at)")
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_checks_tenant_status_created ON checks (tenant_id, status, opened_at)")
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_table_sessions_tenant_table_seated ON table_sessions (tenant_id, table_id, seated_at)")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_table_sessions_tenant_table_seated")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_checks_tenant_status_created")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_kitchen_orders_tenant_status_created")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_order_items_tenant_check_status")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_order_items_tenant_status_created")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_payments_tenant_method_paid")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_payments_tenant_paid")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_sales_tenant_created")
