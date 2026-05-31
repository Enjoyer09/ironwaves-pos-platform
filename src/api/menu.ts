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
  sort_order?: number;
  item_name: string;
  price: Decimal;
  category: string;
  is_coffee: boolean;
  is_active: boolean;
  image_url?: string;
  description?: string;
}

export function get_menu_items(tenant_id: string, search?: string, category_filter?: string) {
  let items = getDB<any>('menu_items')
    .filter((i) => i.tenant_id === tenant_id && i.is_active)
    .sort((a, b) => {
      const sortDiff = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
      if (sortDiff !== 0) return sortDiff;
      const categoryDiff = String(a.category || '').localeCompare(String(b.category || ''));
      if (categoryDiff !== 0) return categoryDiff;
      return String(a.item_name || '').localeCompare(String(b.item_name || ''));
    });
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
  data: { item_name: string; price: Decimal; category: string; is_coffee: boolean; image_url?: string; description?: string },
  user: string = 'system'
) {
  const menuItems = getDB<any>('menu_items');
  const newItem: MenuItem = {
    id: uuidv4(),
    tenant_id,
    sort_order: menuItems.filter((i) => i.tenant_id === tenant_id).length,
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

export async function get_menu_items_live(
  tenant_id: string,
  search?: string,
  category_filter?: string,
  options?: { signal?: AbortSignal },
) {
  if (!isBackendEnabled()) {
    return get_menu_items(tenant_id, search, category_filter);
  }
  let items: any[] = [];
  try {
    items = await apiRequest<any[]>('/api/v1/catalog/menu', { tenantId: null, signal: options?.signal });
  } catch (error) {
    if (isRecoverableNetworkFailure(error)) {
      return get_menu_items(tenant_id, search, category_filter);
    }
    throw error;
  }
  const normalizedItems = items
    .map((i, index) => ({ ...i, tenant_id: i?.tenant_id || tenant_id, sort_order: Number(i?.sort_order ?? index) }))
    .sort((a, b) => {
      const sortDiff = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
      if (sortDiff !== 0) return sortDiff;
      const categoryDiff = String(a.category || '').localeCompare(String(b.category || ''));
      if (categoryDiff !== 0) return categoryDiff;
      return String(a.item_name || '').localeCompare(String(b.item_name || ''));
    });
  const all = getDB<any>('menu_items').filter((i) => i.tenant_id !== tenant_id);
  setDB('menu_items', [...all, ...normalizedItems]);
  if (category_filter && category_filter !== 'ALL') {
    items = normalizedItems.filter((i) => i.category === category_filter);
  } else {
    items = normalizedItems;
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
  data: { item_name: string; price: Decimal; category: string; is_coffee: boolean; image_url?: string; description?: string },
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
        image_url: data.image_url || '',
        description: data.description || '',
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

export async function upload_menu_image_live(file: File): Promise<string> {
  if (!isBackendEnabled()) {
    throw new Error('Şəkil yükləmə backend tələb edir');
  }
  const form = new FormData();
  form.append('file', file);
  const result = await apiRequest<{ success?: boolean; image_url?: string }>('/api/v1/catalog/uploads/menu-image', {
    method: 'POST',
    tenantId: null,
    body: form,
  });
  const imageUrl = String(result?.image_url || '').trim();
  if (!imageUrl) {
    throw new Error('Şəkil URL qaytarılmadı');
  }
  return imageUrl;
}

export async function update_menu_item_live(
  tenant_id: string,
  item_id: string,
  updates: Partial<MenuItem>,
  user: string = 'system',
) {
  if (!isBackendEnabled()) {
    return update_menu_item(tenant_id, item_id, updates, user);
  }
  try {
    const payload: Record<string, any> = {};
    if (updates.item_name !== undefined) payload.item_name = String(updates.item_name || '').trim();
    if (updates.price !== undefined) payload.price = new Decimal(updates.price as any).toFixed(2);
    if (updates.category !== undefined) payload.category = String(updates.category || '').trim();
    if (updates.is_coffee !== undefined) payload.is_coffee = Boolean(updates.is_coffee);
    if (updates.image_url !== undefined) payload.image_url = String(updates.image_url || '');
    if (updates.description !== undefined) payload.description = String(updates.description || '');
    const updated = await apiRequest<any>(`/api/v1/catalog/menu/${encodeURIComponent(item_id)}`, {
      method: 'PATCH',
      tenantId: null,
      body: payload,
    });
    const menuItems = getDB<any>('menu_items');
    const idx = menuItems.findIndex((i) => String(i.id) === String(item_id) && i.tenant_id === tenant_id);
    if (idx >= 0) {
      menuItems[idx] = { ...menuItems[idx], ...updated, tenant_id: updated?.tenant_id || tenant_id };
      setDB('menu_items', menuItems);
    }
    return updated;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Menu backend update failed: ${message}`);
  }
}

export async function soft_delete_menu_item_live(tenant_id: string, item_id: string, user: string = 'system') {
  if (!isBackendEnabled()) {
    return soft_delete_menu_item(tenant_id, item_id, user);
  }
  const markLocalInactive = () => {
    const menuItems = getDB<any>('menu_items');
    const idx = menuItems.findIndex((i) => String(i.id) === String(item_id) && i.tenant_id === tenant_id);
    if (idx >= 0) {
      menuItems[idx] = { ...menuItems[idx], is_active: false };
      setDB('menu_items', menuItems);
    }
  };
  try {
    const result = await apiRequest<{ success: boolean }>(`/api/v1/catalog/menu/${encodeURIComponent(item_id)}`, {
      method: 'DELETE',
      tenantId: null,
    });
    markLocalInactive();
    return result;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('menu item not found')) {
      markLocalInactive();
      return { success: true };
    }
    throw new Error(`Menu backend delete failed: ${message}`);
  }
}

export async function reorder_menu_items_live(tenant_id: string, orderedIds: string[]) {
  const normalizedIds = orderedIds.map((itemId) => String(itemId || '').trim()).filter(Boolean);
  const menuItems = getDB<any>('menu_items');
  const localTenantItems = menuItems
    .filter((i) => i.tenant_id === tenant_id && i.is_active)
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  const orderedLocalIds = [
    ...normalizedIds.filter((itemId, index) => normalizedIds.indexOf(itemId) === index),
    ...localTenantItems.map((i) => String(i.id)).filter((itemId) => !normalizedIds.includes(itemId)),
  ];

  const applyLocalOrder = () => {
    const sortOrderById = new Map<string, number>();
    orderedLocalIds.forEach((itemId, index) => sortOrderById.set(itemId, index));
    const nextItems = menuItems.map((item) => {
      if (item.tenant_id !== tenant_id) return item;
      const nextSortOrder = sortOrderById.get(String(item.id));
      return nextSortOrder === undefined ? item : { ...item, sort_order: nextSortOrder };
    });
    setDB('menu_items', nextItems);
  };

  if (!isBackendEnabled()) {
    applyLocalOrder();
    return { success: true, updated: orderedLocalIds.length };
  }
  try {
    const result = await apiRequest<{ success: boolean; updated: number }>('/api/v1/catalog/menu/reorder', {
      method: 'POST',
      tenantId: null,
      body: { item_ids: orderedLocalIds },
    });
    applyLocalOrder();
    return result;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Menu backend reorder failed: ${message}`);
  }
}


// ─── AI Auto-Image Assignment ────────────────────────────────────────────────

export interface AutoImageResult {
  item_id: string;
  item_name: string;
  image_url: string | null;
  status: 'assigned' | 'skipped' | 'failed';
}

export interface AutoImageResponse {
  success: boolean;
  total: number;
  assigned: number;
  skipped: number;
  failed: number;
  results: AutoImageResult[];
}

export async function auto_assign_menu_images(options: {
  category?: string;
  item_ids?: string[];
  overwrite?: boolean;
}): Promise<AutoImageResponse> {
  return apiRequest<AutoImageResponse>('/api/v1/ops/agent/menu/auto-image', {
    method: 'POST',
    tenantId: null,
    body: {
      category: options.category || null,
      item_ids: options.item_ids || null,
      overwrite: options.overwrite || false,
    },
  });
}

export interface StockPhotoResult {
  id: string;
  url_medium: string;
  url_large: string;
  url_small: string;
  photographer: string;
  alt: string;
}

export async function search_stock_image(query: string): Promise<{ success: boolean; results: StockPhotoResult[] }> {
  return apiRequest<{ success: boolean; results: StockPhotoResult[] }>(
    `/api/v1/ops/agent/menu/search-image?query=${encodeURIComponent(query)}`,
    { method: 'GET', tenantId: null }
  );
}
