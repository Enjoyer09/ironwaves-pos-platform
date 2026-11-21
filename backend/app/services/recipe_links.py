"""ID first recipe resolution; unresolved legacy rows retain exact-name fallback."""
from sqlalchemy import and_, or_, func, select
from sqlalchemy.orm import aliased
from app.models import InventoryItem, MenuItem, Recipe


def ingredient_link(tenant_id):
    candidate = aliased(InventoryItem)
    count = select(func.count(candidate.id)).where(candidate.tenant_id == tenant_id,
        func.lower(func.trim(candidate.name)) == func.lower(func.trim(Recipe.ingredient_name))).correlate(Recipe).scalar_subquery()
    return and_(InventoryItem.tenant_id == tenant_id, or_(
        InventoryItem.id == Recipe.inventory_item_id,
        and_(Recipe.inventory_item_id.is_(None), count == 1, func.lower(func.trim(InventoryItem.name)) == func.lower(func.trim(Recipe.ingredient_name))),
    ))


def ingredient_for_recipe(db, tenant_id, recipe):
    query = db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant_id)
    if recipe.inventory_item_id:
        return query.filter(InventoryItem.id == recipe.inventory_item_id).first()
    matches = query.filter(func.lower(func.trim(InventoryItem.name)) == str(recipe.ingredient_name).strip().lower()).limit(2).all()
    return matches[0] if len(matches) == 1 else None


def menu_link(tenant_id, name):
    ids = select(MenuItem.id).where(MenuItem.tenant_id == tenant_id, func.lower(func.trim(MenuItem.item_name)) == str(name).strip().lower())
    return or_(Recipe.menu_item_id.in_(ids), and_(Recipe.menu_item_id.is_(None), func.lower(func.trim(Recipe.menu_item_name)) == str(name).strip().lower()))


def unique_named_item(db, model, tenant_id, name, *, item_id=None):
    from fastapi import HTTPException
    query = db.query(model).filter(model.tenant_id == tenant_id)
    if item_id:
        item = query.filter(model.id == item_id).first()
        if not item:
            raise HTTPException(404, "Tenant-local recipe target not found")
        return item
    name_column = model.name if model is InventoryItem else model.item_name
    matches = query.filter(func.lower(func.trim(name_column)) == str(name).strip().lower()).limit(2).all()
    if len(matches) > 1:
        raise HTTPException(409, "Ambiguous recipe target; select its stable ID")
    if not matches:
        raise HTTPException(404, "Recipe target not found; create the item first")
    return matches[0]


def load_recipe_inventory(db, tenant_id, menu_names):
    """Resolve one cart in three queries, including ID-linked renamed products."""
    names = {str(name).strip().lower() for name in menu_names}
    if not names:
        return {}, {}
    menus = db.query(MenuItem).filter(MenuItem.tenant_id == tenant_id,
        func.lower(func.trim(MenuItem.item_name)).in_(names)).all()
    menu_names_by_id = {row.id: str(row.item_name).strip().lower() for row in menus}
    recipes = db.query(Recipe).filter(Recipe.tenant_id == tenant_id, or_(
        Recipe.menu_item_id.in_(menu_names_by_id),
        and_(Recipe.menu_item_id.is_(None), func.lower(func.trim(Recipe.menu_item_name)).in_(names)))).all()
    ids = {row.inventory_item_id for row in recipes if row.inventory_item_id}
    legacy_names = {str(row.ingredient_name).strip().lower() for row in recipes if not row.inventory_item_id}
    inventory = db.query(InventoryItem).filter(InventoryItem.tenant_id == tenant_id, or_(
        InventoryItem.id.in_(ids), func.lower(func.trim(InventoryItem.name)).in_(legacy_names))).all()
    by_id = {row.id: row for row in inventory}
    by_name = {}
    for row in inventory:
        by_name.setdefault(str(row.name).strip().lower(), []).append(row)
    grouped, resolved = {}, {}
    for row in recipes:
        name = menu_names_by_id.get(row.menu_item_id) if row.menu_item_id else str(row.menu_item_name).strip().lower()
        grouped.setdefault(name, []).append(row)
        matches = by_name.get(str(row.ingredient_name).strip().lower(), [])
        resolved[row.id] = by_id.get(row.inventory_item_id) if row.inventory_item_id else matches[0] if len(matches) == 1 else None
    return grouped, resolved
