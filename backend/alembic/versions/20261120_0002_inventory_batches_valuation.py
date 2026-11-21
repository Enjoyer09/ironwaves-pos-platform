"""Add physical FEFO lots and NRV valuation history without changing balances."""
from alembic import op
import sqlalchemy as sa
revision = "20261120_0002"
down_revision = "20261120_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("inventory_items", sa.Column("cost_basis_unit_cost", sa.Numeric(12,4), nullable=False, server_default="0"))
    op.add_column("inventory_items", sa.Column("expiry_required", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("UPDATE inventory_items SET cost_basis_unit_cost=unit_cost")
    op.create_table("inventory_batches",
        sa.Column("id",sa.String(36),primary_key=True),
        sa.Column("tenant_id",sa.String(36),sa.ForeignKey("tenants.id"),nullable=False),
        sa.Column("item_id",sa.String(36),nullable=False),
        sa.Column("supplier_id",sa.String(36),sa.ForeignKey("suppliers.id", ondelete="RESTRICT")),
        sa.Column("invoice_no",sa.String(120)),
        sa.Column("lot_code",sa.String(120)), sa.Column("expires_on",sa.Date()),
        sa.Column("received_at",sa.DateTime(),nullable=False),
        sa.Column("quantity_received",sa.Numeric(14,3),nullable=False),
        sa.Column("quantity_remaining",sa.Numeric(14,3),nullable=False),
        sa.Column("purchase_unit_cost",sa.Numeric(12,4),nullable=False),
        sa.Column("status",sa.String(24),nullable=False),
        sa.Column("version",sa.Integer(),nullable=False),
        sa.Column("source_kind",sa.String(40),nullable=False))
    op.create_index("ix_inventory_batch_fefo","inventory_batches",["tenant_id","item_id","expires_on","received_at"])
    op.create_index("ix_inventory_batch_active","inventory_batches",["tenant_id","item_id","expires_on","received_at"],postgresql_where=sa.text("quantity_remaining <> 0"))
    op.create_table("inventory_batch_movements",
        sa.Column("id",sa.String(36),primary_key=True),
        sa.Column("tenant_id",sa.String(36),sa.ForeignKey("tenants.id"),nullable=False),
        sa.Column("item_id",sa.String(36),nullable=False),
        sa.Column("batch_id",sa.String(36),sa.ForeignKey("inventory_batches.id"),nullable=False),
        sa.Column("movement_id",sa.String(36),sa.ForeignKey("inventory_movements.id")),
        sa.Column("quantity_delta",sa.Numeric(14,3),nullable=False),
        sa.Column("balance_after",sa.Numeric(14,3),nullable=False),
        sa.Column("kind",sa.String(40),nullable=False),
        sa.Column("created_at",sa.DateTime(),nullable=False))
    op.create_index("ix_inventory_batch_movement_lookup","inventory_batch_movements",["tenant_id","batch_id","created_at"])
    op.create_table("inventory_valuations",
        sa.Column("id",sa.String(36),primary_key=True),
        sa.Column("tenant_id",sa.String(36),sa.ForeignKey("tenants.id"),nullable=False),
        sa.Column("item_id",sa.String(36),nullable=False),
        sa.Column("quantity",sa.Numeric(14,3),nullable=False),
        sa.Column("cost_basis_unit_cost",sa.Numeric(12,4),nullable=False),
        sa.Column("previous_unit_cost",sa.Numeric(12,4),nullable=False),
        sa.Column("nrv_unit_cost",sa.Numeric(12,4),nullable=False),
        sa.Column("new_unit_cost",sa.Numeric(12,4),nullable=False),
        sa.Column("amount",sa.Numeric(14,2),nullable=False),
        sa.Column("kind",sa.String(24),nullable=False),
        sa.Column("reason",sa.Text(),nullable=False),sa.Column("actor",sa.String(120),nullable=False),
        sa.Column("transaction_id",sa.String(36),sa.ForeignKey("finance_transactions.id")),
        sa.Column("created_at",sa.DateTime(),nullable=False))
    op.create_index("ix_inventory_valuation_lookup","inventory_valuations",["tenant_id","item_id","created_at"])
    op.execute("""INSERT INTO inventory_batches (id,tenant_id,item_id,lot_code,expires_on,received_at,
        quantity_received,quantity_remaining,purchase_unit_cost,status,version,source_kind)
        SELECT md5('legacy-batch:'||id),tenant_id,id,'LEGACY',NULL,CURRENT_TIMESTAMP,
        stock_qty,stock_qty,unit_cost,'available',1,'migration_opening'
        FROM inventory_items WHERE stock_qty<>0""")
    op.execute("""INSERT INTO inventory_batch_movements(id,tenant_id,item_id,batch_id,movement_id,
        quantity_delta,balance_after,kind,created_at)
        SELECT md5('legacy-batch-movement:'||item_id),tenant_id,item_id,id,NULL,
        quantity_remaining,quantity_remaining,'migration_opening',CURRENT_TIMESTAMP FROM inventory_batches""")


def downgrade():
    bind = op.get_bind()
    has_history = bind.execute(sa.text("""SELECT
        EXISTS(SELECT 1 FROM inventory_valuations) OR
        EXISTS(SELECT 1 FROM inventory_batch_movements WHERE kind <> 'migration_opening') OR
        EXISTS(SELECT 1 FROM inventory_batches WHERE source_kind <> 'migration_opening'
            OR version <> 1 OR expires_on IS NOT NULL OR status <> 'available'
            OR coalesce(lot_code,'') <> 'LEGACY' OR supplier_id IS NOT NULL OR invoice_no IS NOT NULL)
    """)).scalar()
    if has_history:
        raise RuntimeError("Inventory lifecycle history exists. Restore a verified full snapshot instead of dropping tenant history.")
    op.drop_table("inventory_valuations")
    op.drop_table("inventory_batch_movements")
    op.drop_table("inventory_batches")
    op.drop_column("inventory_items","expiry_required")
    op.drop_column("inventory_items","cost_basis_unit_cost")
