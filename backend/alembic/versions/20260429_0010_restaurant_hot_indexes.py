"""restaurant table hot path indexes

Revision ID: 20260429_0010
Revises: 20260429_0009
Create Date: 2026-04-29 00:10:00
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260429_0010"
down_revision: Union[str, None] = "20260429_0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_table_sessions_tenant_table_open "
            "ON table_sessions (tenant_id, table_id) WHERE closed_at IS NULL"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_checks_tenant_session_status "
            "ON checks (tenant_id, table_session_id, status)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_reservations_tenant_table_status_at "
            "ON reservations (tenant_id, assigned_table_id, status, reservation_at)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_order_rounds_tenant_status_sent "
            "ON order_rounds (tenant_id, status, sent_at DESC) "
            "WHERE status IN ('NEW','SENT','PREPARING','READY','VOID_REQUESTED')"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_order_rounds_tenant_check_round "
            "ON order_rounds (tenant_id, check_id, round_no)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_order_items_tenant_round_status "
            "ON order_items (tenant_id, round_id, status)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_order_items_tenant_check_draft "
            "ON order_items (tenant_id, check_id) WHERE round_id IS NULL AND status = 'DRAFT'"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_payments_tenant_check_status "
            "ON payments (tenant_id, check_id, status)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_kitchen_orders_tenant_status_created_partial "
            "ON kitchen_orders (tenant_id, status, created_at DESC) WHERE status IN ('NEW','PREPARING','READY')"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_menu_items_tenant_active "
            "ON menu_items (tenant_id, is_active) WHERE is_active = true"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_guests_tenant_phone_lower "
            "ON guests (tenant_id, lower(phone))"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_guests_tenant_email_lower "
            "ON guests (tenant_id, lower(email))"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sales_tenant_status_created "
            "ON sales (tenant_id, status, created_at DESC)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_audit_logs_tenant_created "
            "ON audit_logs (tenant_id, created_at DESC)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_item_status_logs_tenant_item_at "
            "ON item_status_logs (tenant_id, order_item_id, created_at DESC)"
        )
        op.execute(
            "ANALYZE table_sessions, checks, reservations, order_rounds, order_items, "
            "payments, kitchen_orders, menu_items, guests, sales, audit_logs, item_status_logs"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_item_status_logs_tenant_item_at")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_audit_logs_tenant_created")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_sales_tenant_status_created")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_guests_tenant_email_lower")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_guests_tenant_phone_lower")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_menu_items_tenant_active")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_kitchen_orders_tenant_status_created_partial")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_payments_tenant_check_status")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_order_items_tenant_check_draft")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_order_items_tenant_round_status")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_order_rounds_tenant_check_round")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_order_rounds_tenant_status_sent")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_reservations_tenant_table_status_at")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_checks_tenant_session_status")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_table_sessions_tenant_table_open")
