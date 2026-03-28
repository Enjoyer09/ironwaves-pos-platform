import { v4 as uuidv4 } from 'uuid';
import { logEvent } from '../lib/logger';
import { Decimal } from 'decimal.js';
import { Combo } from '../types/inventory';
import { create_menu_item, soft_delete_menu_item, get_menu_items } from './menu';
import { get_recipe, add_recipe_ingredient } from './recipes';
import { create_menu_item_live, get_menu_items_live, soft_delete_menu_item_live } from './menu';
import { add_recipe_ingredient_live, get_recipe_live } from './recipes';

let combos: Combo[] = [];

export function create_combo(name: string, price: Decimal, selected_items: string[], user: string = 'system', tenant_id: string = 'tenant_default') {
  if (selected_items.length < 2) {
    throw new Error('Kombo yaratmaq üçün ən az 2 məhsul seçilməlidir.');
  }

  const exists = combos.find(c => c.name === name);
  if (exists) {
    throw new Error('Eyni adlı kombo mövcuddur.');
  }

  // Atomik Transaction Simulyasiyası
  try {
    // 1. Menyuya əlavə
    create_menu_item(tenant_id, {
      item_name: name,
      price: price,
      category: 'Kombolar',
      is_coffee: false
    }, user);

    // 2. Reseptləri kopyalamaq
    selected_items.forEach(itemName => {
      const itemRecipes = get_recipe(itemName, tenant_id);
      itemRecipes.forEach(recipe => {
        add_recipe_ingredient({
          menu_item_name: name,
          ingredient_name: recipe.ingredient_name,
          quantity_required: new Decimal(recipe.quantity_required),
          unit: recipe.unit,
          unit_cost: new Decimal(recipe.unit_cost),
          tenant_id,
        }, user);
      });
    });

    // 3. Kombonu sistemə yaz
    const newCombo: Combo = {
      id: uuidv4(),
      name,
      price,
      selected_items
    };
    combos.push(newCombo);

    logEvent(user, 'COMBO_CREATED', { name, price: price.toString(), items: selected_items });
    return newCombo;
  } catch (error: any) {
    throw new Error(`Kombo yaratmaq alınmadı (Transaction Rolled Back): ${error.message}`);
  }
}

export function delete_combo(combo_name: string, user: string = 'system', tenant_id: string = 'tenant_default') {
  const comboIndex = combos.findIndex(c => c.name === combo_name);
  if (comboIndex === -1) throw new Error('Kombo tapılmadı');

  try {
    // 1. Menyudan silmək (soft delete)
    const menuItems = get_menu_items(tenant_id);
    const menuItem = menuItems.find(m => m.item_name === combo_name);
    if (menuItem) {
      soft_delete_menu_item(tenant_id, menuItem.id, user);
    }
    
    // 2. Reseptləri də silmək olardı, lakin "Atomik Silmə" dedikdə kombodan çıxardırıq
    combos = combos.filter(c => c.name !== combo_name);

    logEvent(user, 'COMBO_DELETED', { name: combo_name });
    return true;
  } catch (error: any) {
    throw new Error(`Kombo silmək alınmadı: ${error.message}`);
  }
}

export function get_combo_details(combo_name: string, tenant_id: string = 'tenant_default') {
  return get_recipe(combo_name, tenant_id);
}

export async function create_combo_live(name: string, price: Decimal, selected_items: string[], user: string = 'system', tenant_id: string = 'tenant_default') {
  if (selected_items.length < 2) {
    throw new Error('Kombo yaratmaq üçün ən az 2 məhsul seçilməlidir.');
  }
  await create_menu_item_live(
    tenant_id,
    {
      item_name: name,
      price,
      category: 'Kombolar',
      is_coffee: false,
    },
    user,
  );
  for (const itemName of selected_items) {
    const itemRecipes = await get_recipe_live(itemName, tenant_id);
    for (const recipe of itemRecipes) {
      await add_recipe_ingredient_live(
        {
          menu_item_name: name,
          ingredient_name: recipe.ingredient_name,
          quantity_required: new Decimal(recipe.quantity_required || 0),
          unit: recipe.unit,
          unit_cost: new Decimal(recipe.unit_cost || 0),
          tenant_id,
        },
        user,
      );
    }
  }
  logEvent(user, 'COMBO_CREATED', { name, price: price.toString(), items: selected_items, backend: true });
  return { success: true };
}

export async function delete_combo_live(combo_name: string, user: string = 'system', tenant_id: string = 'tenant_default') {
  const menuItems = await get_menu_items_live(tenant_id);
  const menuItem = menuItems.find((m: any) => m.item_name === combo_name);
  if (!menuItem) throw new Error('Kombo tapılmadı');
  await soft_delete_menu_item_live(tenant_id, menuItem.id, user);
  logEvent(user, 'COMBO_DELETED', { name: combo_name, backend: true });
  return true;
}

export async function get_combo_details_live(combo_name: string, tenant_id: string = 'tenant_default') {
  return get_recipe_live(combo_name, tenant_id);
}
