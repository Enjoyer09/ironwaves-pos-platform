"""guest lookup normalized phone index

Revision ID: 20260429_0011
Revises: 20260429_0010
Create Date: 2026-04-29 00:20:00
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260429_0011"
down_revision: Union[str, None] = "20260429_0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_guests_tenant_phone_normalized "
            "ON guests (tenant_id, regexp_replace(phone, '[^0-9+]', '', 'g')) "
            "WHERE phone IS NOT NULL AND phone <> ''"
        )
        op.execute("ANALYZE guests")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_guests_tenant_phone_normalized")
