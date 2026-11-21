from decimal import Decimal as D
import pytest
from fastapi import HTTPException
from app.models import InventoryItem, Recipe
from app.routers import catalog
from app.schemas import InventoryItemUpdateIn
from test_gl_dual_mode_flows import db, tenant, ADMIN

@pytest.mark.parametrize("qty", ["1", "-1", "0"])
def test_inventory_delete_and_recipe_rename(db, tenant, qty):
    row = InventoryItem(tenant_id=tenant.id, name="Milk", unit="litr", stock_qty=D(qty), unit_cost=D("2"), min_limit=D("0"))
    db.add(row)
    db.commit()
    if qty != "0":
        with pytest.raises(HTTPException) as exc:
            catalog.delete_inventory_item(row.id, db=db, tenant=tenant, user=ADMIN)
        assert exc.value.status_code == 409
        with pytest.raises(HTTPException):
            catalog.clear_inventory(db=db, tenant=tenant, user=ADMIN)
    recipe = Recipe(tenant_id=tenant.id, menu_item_name="Latte", ingredient_name="Milk", quantity_required=D("0.2"))
    db.add(recipe)
    db.commit()
    catalog.update_inventory_item(row.id, InventoryItemUpdateIn(name="Fresh Milk"), db=db, tenant=tenant, user=ADMIN)
    db.refresh(recipe)
    assert recipe.ingredient_name == "Fresh Milk"
    with pytest.raises(HTTPException):
        catalog.delete_inventory_item(row.id, db=db, tenant=tenant, user=ADMIN)
    with pytest.raises(HTTPException):
        catalog.update_inventory_item(row.id, InventoryItemUpdateIn(unit="ml"), db=db, tenant=tenant, user=ADMIN)

@pytest.mark.parametrize("model,data", [
    ("InventoryRestockIn", {"qty_added": "0.0004", "total_price": "10"}),
    ("InventoryRestockIn", {"qty_added": "1", "total_price": "10.001"}),
    ("InventoryLossIn", {"qty_removed": "0.0004", "reason": "test"}),
    ("InventoryItemCreateIn", {"name": "Milk", "unit": "litr", "stock_qty": "-1", "unit_cost": "2"}),
])
def test_invalid_precision_and_negative_opening_rejected(model, data):
    from pydantic import ValidationError
    from app import schemas
    with pytest.raises(ValidationError):
        getattr(schemas, model)(**data)


def test_inventory_replay_and_conflict(db, tenant):
    from app.schemas import InventoryRestockIn
    row = InventoryItem(tenant_id=tenant.id, name="Salt", unit="kg", stock_qty=D("0"), unit_cost=D("0"), min_limit=D("0"))
    db.add(row)
    db.commit()
    payload = InventoryRestockIn(qty_added=D("2"), total_price=D("0"), idempotency_key="restock-test-001")
    first = catalog.restock_inventory_item(row.id, payload, db=db, tenant=tenant, user=ADMIN)
    second = catalog.restock_inventory_item(row.id, payload, db=db, tenant=tenant, user=ADMIN)
    assert second["stock_qty"] == first["stock_qty"] == "2.000"
    db.refresh(row)
    assert row.stock_qty == D("2")
    with pytest.raises(HTTPException) as exc:
        catalog.restock_inventory_item(row.id, payload.model_copy(update={"qty_added": D("3")}), db=db, tenant=tenant, user=ADMIN)
    assert exc.value.status_code == 409


def test_id_link_and_stock_count_journal(db, tenant):
    from app.services.recipe_links import ingredient_for_recipe
    from app.models import InventoryMovement
    row = InventoryItem(tenant_id=tenant.id, name="Beans", unit="kg", stock_qty=D("10"), unit_cost=D("2"), min_limit=D("0"))
    db.add(row)
    db.flush()
    recipe = Recipe(tenant_id=tenant.id, inventory_item_id=row.id, menu_item_name="Coffee", ingredient_name="Old name", quantity_required=D("0.1"))
    db.add(recipe)
    db.commit()
    assert ingredient_for_recipe(db, tenant.id, recipe).id == row.id
    payload = catalog.InventoryCountIn(counted_qty=D("8"), expected_qty=D("10"), reason="Physical count", idempotency_key="count-test-001")
    result = catalog.count_inventory(row.id, payload, db=db, tenant=tenant, user=ADMIN)
    assert D(result["difference"]) == D("-2")
    assert catalog.count_inventory(row.id, payload, db=db, tenant=tenant, user=ADMIN)["replayed"]
    moves = db.query(InventoryMovement).filter(InventoryMovement.item_id == row.id).order_by(InventoryMovement.created_at).all()
    assert len(moves) == 2
    assert moves[-1].quantity_before == D("10") and moves[-1].quantity_after == D("8")
    assert moves[-1].kind == "stock_count"


def test_count_surplus_and_stale_count(db, tenant):
    from app.gl import engine as gl
    from app.models import InventoryMovement
    row = InventoryItem(tenant_id=tenant.id, name="Tea", unit="kg", stock_qty=D("4"), unit_cost=D("3"), min_limit=D("0"))
    db.add(row)
    db.commit()
    before = gl.account_balance(db, tenant.id, gl.accounts_by_role(db, tenant.id)["inventory"])
    payload = catalog.InventoryCountIn(counted_qty=D("6"), expected_qty=D("4"), reason="Physical count surplus", idempotency_key="surplus-count-01")
    result = catalog.count_inventory(row.id, payload, db=db, tenant=tenant, user=ADMIN)
    assert D(result["amount"]) == D("6")
    assert gl.account_balance(db, tenant.id, gl.accounts_by_role(db, tenant.id)["inventory"]) - before == D("6")
    with pytest.raises(HTTPException) as exc:
        catalog.count_inventory(row.id, payload.model_copy(update={"idempotency_key": "stale-count-01"}), db=db, tenant=tenant, user=ADMIN)
    assert exc.value.status_code == 409
    report = catalog.reconcile_inventory(db=db, tenant=tenant, user=ADMIN)
    assert not report["quantity_differences"]


def test_ambiguous_recipe_requires_explicit_same_tenant_id(db, tenant):
    from app.models import MenuItem, Tenant
    from app.schemas import RecipeIngredientCreateIn
    from app.services.recipe_links import unique_named_item
    rows = [InventoryItem(tenant_id=tenant.id, name="Duplicate Salt", unit="kg", stock_qty=D("0"), unit_cost=D("0"), min_limit=D("0")) for _ in range(2)]
    menu = MenuItem(tenant_id=tenant.id, item_name="Soup", category="Food", price=D("5"))
    db.add_all(rows+[menu]); db.commit()
    with pytest.raises(HTTPException) as exc:
        unique_named_item(db, InventoryItem, tenant.id, "Duplicate Salt")
    assert exc.value.status_code == 409
    recipe = Recipe(tenant_id=tenant.id, menu_item_name=menu.item_name, ingredient_name="Duplicate Salt", quantity_required=D("0.1"))
    db.add(recipe); db.commit()
    issues = catalog.recipe_link_issues(db=db, tenant=tenant, user=ADMIN)
    assert any(r["recipe_id"] == recipe.id for r in issues["items"])
    assert recipe.inventory_item_id is None
    catalog.resolve_recipe_link(recipe.id, catalog.RecipeLinkIn(inventory_item_id=rows[1].id, menu_item_id=menu.id, reason="Verified product"), db=db, tenant=tenant, user=ADMIN)
    assert recipe.inventory_item_id == rows[1].id
    other = Tenant(id="other-recipe-tenant", name="Other", slug="other-recipe", domain="other-recipe.test", status="active")
    db.add(other); db.flush()
    foreign = InventoryItem(tenant_id=other.id, name="Other Salt", unit="kg", stock_qty=D("0"), unit_cost=D("0"), min_limit=D("0"))
    db.add(foreign); db.commit()
    with pytest.raises(HTTPException) as exc:
        catalog.resolve_recipe_link(recipe.id, catalog.RecipeLinkIn(inventory_item_id=foreign.id, menu_item_id=menu.id, reason="Wrong tenant"), db=db, tenant=tenant, user=ADMIN)
    assert exc.value.status_code == 404
    payload = RecipeIngredientCreateIn(menu_item_name="Soup", ingredient_name="Duplicate Salt", inventory_item_id=rows[1].id, menu_item_id=menu.id, quantity_required=D("0.2"))
    result = catalog.create_recipe_ingredient(payload, db=db, tenant=tenant, user=ADMIN)
    assert db.get(Recipe, result["id"]).inventory_item_id == rows[1].id


def test_fuzzy_recipe_target_does_not_create_or_select_inventory(db, tenant):
    from app.models import MenuItem
    row = InventoryItem(tenant_id=tenant.id, name="Milk chocolate", unit="kg", stock_qty=D("1"), unit_cost=D("2"), min_limit=D("0"))
    menu = MenuItem(tenant_id=tenant.id, item_name="Dessert", category="Food", price=D("5"))
    db.add_all([row, menu]); db.commit()
    before = db.query(InventoryItem).filter_by(tenant_id=tenant.id).count()
    with pytest.raises(HTTPException) as exc:
        catalog.replace_recipe(catalog.RecipeReplaceIn(menu_item_name="Dessert", ingredients=[catalog.RecipeIngredientReplaceIn(ingredient_name="Milk", quantity_required=D("0.1"))]), db=db, tenant=tenant, user=ADMIN)
    assert exc.value.status_code == 404
    db.rollback()
    assert db.query(InventoryItem).filter_by(tenant_id=tenant.id).count() == before


def test_failed_inventory_restore_does_not_commit_deleted_stock(db, tenant):
    from app.services.legacy_import_service import restore_generic_model_rows
    row = InventoryItem(tenant_id=tenant.id, name="Original stock", unit="kg", stock_qty=D("5"), unit_cost=D("2"), min_limit=D("0"))
    db.add(row); db.commit()
    item_id = row.id
    with pytest.raises(Exception):
        restore_generic_model_rows(db, model=InventoryItem, tenant_id=tenant.id,
            rows=[{"name": "Invalid", "unit": "kg", "stock_qty": "not-a-number"}],
            parse_dt=lambda v: v, parse_decimal=D, reject_row=lambda *args: None)
    db.rollback()
    original = db.get(InventoryItem, item_id)
    assert original is not None and original.stock_qty == D("5")


def test_recipe_conversion_cannot_silently_round_to_zero():
    with pytest.raises(HTTPException):
        catalog._persistable_recipe_qty(D("0.0001"), "qram", "kq")


def test_batched_recipe_resolution_uses_ids_after_both_names_change(db, tenant):
    from app.models import MenuItem
    from app.services.recipe_links import load_recipe_inventory
    row = InventoryItem(tenant_id=tenant.id, name="Milk original", unit="litr", stock_qty=D("10"), unit_cost=D("2"), min_limit=D("0"))
    menu = MenuItem(tenant_id=tenant.id, item_name="Latte original", category="Coffee", price=D("5"))
    db.add_all([row, menu]); db.flush()
    recipe = Recipe(tenant_id=tenant.id, ingredient_name=row.name, menu_item_name=menu.item_name, inventory_item_id=row.id, menu_item_id=menu.id, quantity_required=D("0.2"))
    db.add(recipe); db.commit()
    row.name = "Milk renamed"; menu.item_name = "Latte renamed"; db.commit()
    grouped, resolved = load_recipe_inventory(db, tenant.id, {"latte renamed"})
    assert [r.id for r in grouped["latte renamed"]] == [recipe.id]
    assert resolved[recipe.id].id == row.id
