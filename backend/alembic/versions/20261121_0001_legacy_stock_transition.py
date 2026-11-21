"""Preserve existing undated stock policy while new products use strict FEFO."""
from alembic import op
import sqlalchemy as sa
revision = "20261121_0001"
down_revision = "20261120_0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("inventory_items", sa.Column("legacy_negative_allowed", sa.Boolean(), nullable=False, server_default=sa.false()))
    # This is a compatibility flag only: quantities and financial values are not
    # changed. Dated/quarantined lots can never use the legacy allowance.
    op.execute("UPDATE inventory_items SET legacy_negative_allowed=TRUE")


def downgrade():
    op.drop_column("inventory_items", "legacy_negative_allowed")
