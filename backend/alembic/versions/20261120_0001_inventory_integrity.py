"""Stable recipe references and prospective stock movement ledger."""
from alembic import op
import sqlalchemy as sa
revision = "20261120_0001"
down_revision = "20261115_0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("recipes", sa.Column("inventory_item_id", sa.String(36), nullable=True))
    op.add_column("recipes", sa.Column("menu_item_id", sa.String(36), nullable=True))
    for column, target in (("inventory_item_id", "inventory_items"), ("menu_item_id", "menu_items")):
        op.create_foreign_key(f"fk_recipe_{column}", "recipes", target, [column], ["id"], ondelete="RESTRICT")
        op.create_index(f"ix_recipes_{column}", "recipes", [column])
    # Only uniquely matched tenant-local names are linked. Ambiguous rows stay
    # unresolved for review rather than assigning the wrong ingredient.
    for column, table, name, legacy in (("inventory_item_id", "inventory_items", "name", "ingredient_name"), ("menu_item_id", "menu_items", "item_name", "menu_item_name")):
        op.execute(sa.text(f"""UPDATE recipes r SET {column} = (
            SELECT min(i.id) FROM {table} i WHERE i.tenant_id=r.tenant_id
            AND lower(trim(i.{name}))=lower(trim(r.{legacy})) HAVING count(*)=1)"""))
    op.create_table("inventory_movements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(36), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("item_id", sa.String(36), nullable=False),
        sa.Column("item_name", sa.String(255), nullable=False),
        sa.Column("unit", sa.String(32), nullable=False),
        sa.Column("quantity_before", sa.Numeric(14,3), nullable=False),
        sa.Column("quantity_after", sa.Numeric(14,3), nullable=False),
        sa.Column("unit_cost", sa.Numeric(12,4), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("actor", sa.String(120), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False))
    for col in ("tenant_id", "item_id", "created_at"):
        op.create_index(f"ix_inventory_movements_{col}", "inventory_movements", [col])
    op.execute("""INSERT INTO inventory_movements
        (id,tenant_id,item_id,item_name,unit,quantity_before,quantity_after,unit_cost,kind,created_at)
        SELECT md5('opening:' || id),tenant_id,id,name,unit,0,stock_qty,unit_cost,'migration_opening',CURRENT_TIMESTAMP
        FROM inventory_items""")


def downgrade():
    op.drop_table("inventory_movements")
    for col in ("menu_item_id", "inventory_item_id"):
        op.drop_index(f"ix_recipes_{col}", table_name="recipes")
        op.drop_constraint(f"fk_recipe_{col}", "recipes", type_="foreignkey")
        op.drop_column("recipes", col)
