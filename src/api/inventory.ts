import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { logEvent } from '../lib/logger';
import { create_finance_entry } from './finance';
import { InventoryItem } from '../types/inventory';
import { getDB, setDB } from '../lib/db_sim';

const withTenant = (tenant_id: string, rows: any[]) =>
  rows
    .map((row) => (row?.tenant_id ? row : { ...row, tenant_id }))
    .filter((row) => row.tenant_id === tenant_id);

const getInventory = (tenant_id: string) => {
  const inventory = withTenant(tenant_id, getDB<any>('inventory'));
  if (inventory.length > 0) return inventory;
  // Legacy/backups can store stock under "ingredients"
  return withTenant(tenant_id, getDB<any>('ingredients'));
};
const saveInventory = (tenant_id: string, tenantItems: any[]) => {
  const all = getDB<any>('inventory').filter((i) => i.tenant_id !== tenant_id);
  const merged = [...all, ...tenantItems];
  setDB('inventory', merged);
  setDB('ingredients', merged);
};

export function add_inventory_item(data: {
  tenant_id?: string;
  name: string;
  stock_qty: Decimal;
  unit: string;
  category: string;
  type: string;
  unit_cost: Decimal;
  min_limit: Decimal;
}, user: string = 'system') {
  try {
    const tenant_id = data.tenant_id || 'tenant_default';
    const inventoryItems = getInventory(tenant_id);
    const existingIndex = inventoryItems.findIndex(i => i.name === data.name);
    
    if (existingIndex >= 0) {
      // Upsert: stok artırılır
      inventoryItems[existingIndex].stock_qty = new Decimal(inventoryItems[existingIndex].stock_qty).plus(data.stock_qty).toString();
      saveInventory(tenant_id, inventoryItems);
      logEvent(user, 'INVENTORY_ADD', { item_name: data.name, qty: data.stock_qty, unit_cost: data.unit_cost });
      return inventoryItems[existingIndex];
    } else {
      const newItem: InventoryItem = {
        id: uuidv4(),
        ...(data as any),
        tenant_id,
        stock_qty: data.stock_qty.toString() as any,
        unit_cost: data.unit_cost.toString() as any,
        min_limit: data.min_limit.toString() as any,
      };
      inventoryItems.push(newItem);
      saveInventory(tenant_id, inventoryItems);
      logEvent(user, 'INVENTORY_ADD', { item_name: data.name, qty: data.stock_qty, unit_cost: data.unit_cost });
      return newItem;
    }
  } catch (error: any) {
    throw new Error(`Inventory Add Failed: ${error.message}`);
  }
}

export function restock_item(tenant_id: string, item_id: string, qty_added: Decimal, total_price: Decimal, user: string = 'system') {
  try {
    const inventoryItems = getInventory(tenant_id);
    const item = inventoryItems.find(i => i.id === item_id);
    if (!item) throw new Error('Məhsul tapılmadı.');

    // Yeni unit_cost hesablanır: (Köhnə Dəyər + Yeni Dəyər) / Ümumi Miqdar
    const old_total_value = new Decimal(item.stock_qty).mul(new Decimal(item.unit_cost));
    const new_total_qty = new Decimal(item.stock_qty).plus(qty_added);
    const new_unit_cost = old_total_value.plus(total_price).div(new_total_qty);

    item.stock_qty = new_total_qty.toString() as any;
    item.unit_cost = new_unit_cost.toString() as any;
    saveInventory(tenant_id, inventoryItems);

    logEvent(user, 'INVENTORY_RESTOCK', { item_id, qty_added, new_unit_cost });
    return item;
  } catch (error: any) {
    throw new Error(`Restock Failed: ${error.message}`);
  }
}

export function record_loss(item_id: string, qty_removed: Decimal, reason: string, recorded_by: string) {
  try {
    if (!reason) throw new Error('İtki səbəbi məcburidir.');

    const allInventory = getDB<any>('inventory');
    const found = allInventory.find(i => i.id === item_id);
    const tenant_id = found?.tenant_id || 'tenant_default';
    const inventoryItems = getInventory(tenant_id);
    const item = inventoryItems.find(i => i.id === item_id);
    if (!item) throw new Error('Məhsul tapılmadı.');

    if (new Decimal(item.stock_qty).lessThan(qty_removed)) {
      throw new Error('Anbarda kifayət qədər məhsul yoxdur.');
    }

    // Stok azaldılır
    item.stock_qty = new Decimal(item.stock_qty).minus(qty_removed).toString() as any;
    const loss_amount = qty_removed.mul(new Decimal(item.unit_cost));
    saveInventory(tenant_id, inventoryItems);

    // Maliyyəyə "Anbar İtkisi" yazılır (Atomik yanaşma)
    create_finance_entry(
      tenant_id,
      'out', 
      'Anbar İtkisi', 
      loss_amount.toString(), 
      'debt', 
      `Məhsul: ${item.name}, Səbəb: ${reason}`, 
      recorded_by
    );

    logEvent(recorded_by, 'INVENTORY_LOSS', { item_id, qty: qty_removed, loss_amount, reason });
    return true;
  } catch (error: any) {
    throw new Error(`Record Loss Failed: ${error.message}`);
  }
}

export function update_inventory_item(item_id: string, updates: Partial<InventoryItem>, user: string = 'system') {
  const allInventory = getDB<any>('inventory');
  const found = allInventory.find(i => i.id === item_id);
  const tenant_id = found?.tenant_id || 'tenant_default';
  const inventoryItems = getInventory(tenant_id);
  const index = inventoryItems.findIndex(i => i.id === item_id);
  if (index === -1) throw new Error('Məhsul tapılmadı.');
  
  inventoryItems[index] = { ...inventoryItems[index], ...updates };
  saveInventory(tenant_id, inventoryItems);
  logEvent(user, 'INVENTORY_EDIT', { item_id, changes: updates });
  return inventoryItems[index];
}

export function delete_inventory_item(item_id: string, user: string = 'system') {
  const allInventory = getDB<any>('inventory');
  const found = allInventory.find(i => i.id === item_id);
  const tenant_id = found?.tenant_id || 'tenant_default';
  const inventoryItems = getInventory(tenant_id);
  const item = inventoryItems.find(i => i.id === item_id);
  if (!item) throw new Error('Məhsul tapılmadı.');

  // QEYD: Əgər məhsul reseptdə istifadə olunursa, xəbərdarlıq məntiqi bura əlavə ediləcək.

  const filtered = inventoryItems.filter(i => i.id !== item_id);
  saveInventory(tenant_id, filtered);
  logEvent(user, 'INVENTORY_DELETE', { item_name: item.name });
  return true;
}

export function get_low_stock_items(tenant_id: string = 'tenant_default', defaultCriticalThreshold: number = 5) {
  const inventoryItems = getInventory(tenant_id);
  return inventoryItems
    .filter(i => {
      const minLimitRaw = i.min_limit ?? defaultCriticalThreshold;
      const minLimit = new Decimal(minLimitRaw || 0);
      return new Decimal(i.stock_qty || 0).lessThanOrEqualTo(minLimit);
    })
    .map(i => ({
      name: i.name,
      stock_qty: i.stock_qty,
      min_limit: i.min_limit ?? defaultCriticalThreshold,
      unit: i.unit
    }));
}

export function analyze_inventory_ai() {
  // Gemini API simulyasiyası
  return "AI Analiz: Qəhvə dənələri minimum limitə yaxındır. Növbəti həftə üçün 10 kq sifariş verməyiniz tövsiyə olunur. Süd ehtiyatınız qaydasındadır.";
}

export function get_inventory_items(tenant_id: string = 'tenant_default') {
  return getInventory(tenant_id);
}