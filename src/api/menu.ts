import { v4 as uuidv4 } from 'uuid';
import { logEvent } from '../lib/logger';
import { Decimal } from 'decimal.js';
import { getDB, setDB } from '../lib/db_sim';

export interface MenuItem {
  id: string;
  tenant_id: string;
  item_name: string;
  price: Decimal;
  category: string;
  is_coffee: boolean;
  is_active: boolean;
  image_url?: string;
}

export function get_menu_items(tenant_id: string, search?: string, category_filter?: string) {
  let items = getDB<any>('menu_items').filter((i) => i.tenant_id === tenant_id && i.is_active);
  if (category_filter && category_filter !== 'ALL') {
    items = items.filter(i => i.category === category_filter);
  }
  if (search) {
    items = items.filter(i => i.item_name.toLowerCase().includes(search.toLowerCase()));
  }
  return items;
}

export function create_menu_item(
  tenant_id: string,
  data: { item_name: string; price: Decimal; category: string; is_coffee: boolean; image_url?: string },
  user: string = 'system'
) {
  const menuItems = getDB<any>('menu_items');
  const newItem: MenuItem = {
    id: uuidv4(),
    tenant_id,
    ...data,
    is_active: true
  };
  menuItems.push(newItem);
  setDB('menu_items', menuItems);
  logEvent(user, 'MENU_ADD', { item_name: data.item_name, price: data.price.toString(), category: data.category });
  return newItem;
}

export function update_menu_item(tenant_id: string, item_id: string, updates: Partial<MenuItem>, user: string = 'system') {
  const menuItems = getDB<any>('menu_items');
  const index = menuItems.findIndex(i => i.id === item_id);
  if (index === -1) throw new Error('Menyu məhsulu tapılmadı');
  if (menuItems[index].tenant_id !== tenant_id) throw new Error('Bu məhsul üçün icazə yoxdur');
  
  menuItems[index] = { ...menuItems[index], ...updates };
  setDB('menu_items', menuItems);
  logEvent(user, 'MENU_EDIT', { item_id, changes: updates });
  return menuItems[index];
}

export function soft_delete_menu_item(tenant_id: string, item_id: string, user: string = 'system') {
  const menuItems = getDB<any>('menu_items');
  const index = menuItems.findIndex(i => i.id === item_id);
  if (index === -1) throw new Error('Menyu məhsulu tapılmadı');
  if (menuItems[index].tenant_id !== tenant_id) throw new Error('Bu məhsul üçün icazə yoxdur');
  
  menuItems[index].is_active = false;
  setDB('menu_items', menuItems);
  logEvent(user, 'MENU_SOFT_DELETE', { item_id, item_name: menuItems[index].item_name });
  return true;
}

export function import_menu_from_excel(file: any, user: string = 'system') {
  // Simulyasiya: Faylı oxuyub 1 məhsul əlavə edirik
  logEvent(user, 'MENU_EXCEL_IMPORT', { status: 'success' });
  return true;
}

export function export_menu_to_excel(user: string = 'system') {
  // Simulyasiya: Fayl yükləndi
  logEvent(user, 'MENU_EXCEL_EXPORT', { status: 'success' });
  return 'base64_or_blob_url_simulated';
}