"""add composite indexes for high-traffic runtime queries

Revision ID: 20260416_0002
Revises: 20260414_0001
Create Date: 2026-04-16 00:00:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260416_0002"
down_revision: Union[str, None] = "20260414_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_staff_notifications_tenant_user_unread_created ON staff_notifications (tenant_id, username, is_read, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notifications_tenant_unread_created ON notifications (tenant_id, is_read, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tables_tenant_label ON tables (tenant_id, label)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tables_tenant_status ON tables (tenant_id, status)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tables_tenant_status")
    op.execute("DROP INDEX IF EXISTS ix_tables_tenant_label")
    op.execute("DROP INDEX IF EXISTS ix_notifications_tenant_unread_created")
    op.execute("DROP INDEX IF EXISTS ix_staff_notifications_tenant_user_unread_created")
