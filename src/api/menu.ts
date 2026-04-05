import { v4 as uuidv4 } from 'uuid';
import { logEvent } from '../lib/logger';
import { Decimal } from 'decimal.js';
import { getDB, setDB } from '../lib/db_sim';
import { apiRequest, isBackendEnabled } from './client';
import { getResolvedTenantIdFromHost } from '../lib/tenant';

const isRecoverableNetworkFailure = (error: unknown) => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('backendə qoşulma alınmadı') ||
    message.includes('network')
  );
};

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

export async function get_menu_items_live(tenant_id: string, search?: string, category_filter?: string) {
  if (!isBackendEnabled()) {
    return get_menu_items(tenant_id, search, category_filter);
  }
  let items: any[] = [];
  try {
    items = await apiRequest<any[]>('/api/v1/catalog/menu', { tenantId: null });
  } catch (error) {
    if (isRecoverableNetworkFailure(error)) {
      return get_menu_items(tenant_id, search, category_filter);
    }
    throw error;
  }
  const all = getDB<any>('menu_items').filter((i) => i.tenant_id !== tenant_id);
  setDB('menu_items', [...all, ...items.map((i) => ({ ...i, tenant_id: i?.tenant_id || tenant_id }))]);
  if (category_filter && category_filter !== 'ALL') {
    items = items.filter((i) => i.category === category_filter);
  }
  if (search) {
    items = items.filter((i) => String(i.item_name || '').toLowerCase().includes(search.toLowerCase()));
  }
  return items;
}

export async function get_public_menu_live() {
  const tenantId = getResolvedTenantIdFromHost() || 'tenant_default';
  if (!isBackendEnabled()) {
    return get_menu_items(tenantId);
  }
  let items = await apiRequest<any[]>('/api/v1/catalog/public-menu', {
    method: 'GET',
    tenantId: null,
    auth: false,
  });
  const all = getDB<any>('menu_items').filter((i) => i.tenant_id !== tenantId);
  setDB('menu_items', [...all, ...items.map((i) => ({ ...i, tenant_id: i?.tenant_id || tenantId }))]);
  return items;
}

export async function create_menu_item_live(
  tenant_id: string,
  data: { item_name: string; price: Decimal; category: string; is_coffee: boolean; image_url?: string },
  user: string = 'system'
) {
  if (!isBackendEnabled()) {
    return create_menu_item(tenant_id, data, user);
  }
  try {
    const created = await apiRequest<any>('/api/v1/catalog/menu', {
      method: 'POST',
      tenantId: null,
      body: {
        item_name: data.item_name,
        price: new Decimal(data.price).toFixed(2),
        category: data.category,
        is_coffee: data.is_coffee,
      },
    });
    const menuItems = getDB<any>('menu_items').filter((i) => !(i.tenant_id === tenant_id && String(i.id) === String(created?.id)));
    setDB('menu_items', [...menuItems, { ...created, tenant_id: created?.tenant_id || tenant_id }]);
    return created;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Menu backend write failed: ${message}`);
  }
}

export async function soft_delete_menu_item_live(tenant_id: string, item_id: string, user: string = 'system') {
  if (!isBackendEnabled()) {
    return soft_delete_menu_item(tenant_id, item_id, user);
  }
  try {
    const result = await apiRequest<{ success: boolean }>(`/api/v1/catalog/menu/${encodeURIComponent(item_id)}`, {
      method: 'DELETE',
      tenantId: null,
    });
    const menuItems = getDB<any>('menu_items');
    const idx = menuItems.findIndex((i) => String(i.id) === String(item_id) && i.tenant_id === tenant_id);
    if (idx >= 0) {
      menuItems[idx] = { ...menuItems[idx], is_active: false };
      setDB('menu_items', menuItems);
    }
    return result;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Menu backend delete failed: ${message}`);
  }
}
