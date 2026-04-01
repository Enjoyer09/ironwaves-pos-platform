import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { logEvent } from '../lib/logger';
import { CartItem, PaymentMethod } from '../types/pos';
import { create_sale } from './pos';
import { apiRequest, isBackendEnabled } from './client';
import { verifyLocalCredential } from '../lib/local_auth';

import { getDB, setDB } from '../lib/db_sim';

export interface Table {
  id: string;
  tenant_id: string;
  label: string;
  is_occupied: boolean;
  items: CartItem[];
  total: string; // Decimal format
  cup_mode?: 'paper' | 'glass';
  kitchen_status?: string | null;
}

type TableRevisionPayload = {
  items: CartItem[];
  reason: string;
  override_password: string;
  actor: string;
};

const isRecoverableNetworkFailure = (error: unknown) => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('backendə qoşulma alınmadı') ||
    message.includes('backend') ||
    message.includes('network')
  );
};

// FUNKSIYA: get_tables
export const get_tables = (tenant_id: string) => {
  return getDB<Table>('tables')
    .filter(t => t.tenant_id === tenant_id)
    .map((t: any) => {
      let items: any[] = [];
      if (Array.isArray(t.items)) {
        items = t.items;
      } else if (typeof t.items === 'string') {
        try {
          const parsed = JSON.parse(t.items);
          items = Array.isArray(parsed) ? parsed : [];
        } catch {
          items = [];
        }
      }
      return { ...t, items };
    });
};

// FUNKSIYA: create_table
export const create_table = (tenant_id: string, label: string, created_by: string) => {
  const tables = getDB<Table>('tables');
  
  if (tables.find(t => t.label === label && t.tenant_id === tenant_id)) {
    throw new Error('Eyni adlı masa artıq mövcuddur');
  }

  const new_table: Table = {
    id: uuidv4(),
    tenant_id,
    label,
    is_occupied: false,
    items: [],
    total: '0'
  };

  tables.push(new_table);
  setDB('tables', tables);

  logEvent(created_by, 'TABLE_CREATED', { tenant_id, label });
  return new_table;
};

// FUNKSIYA: delete_table
export const delete_table = (table_id: string, deleted_by: string) => {
  let tables = getDB<Table>('tables');
  const table = tables.find(t => t.id === table_id);
  
  if (!table) throw new Error('Masa tapılmadı');
  if (table.is_occupied) throw new Error('İstifadədə olan masa silinə bilməz');

  tables = tables.filter(t => t.id !== table_id);
  setDB('tables', tables);

  logEvent(deleted_by, 'TABLE_DELETED', { tenant_id: table.tenant_id, label: table.label });
  return { success: true };
};

// FUNKSIYA: send_to_kitchen
export const send_to_kitchen = (
  table_id: string, 
  cart_items: CartItem[], 
  sent_by: string,
  options?: { cup_mode?: 'paper' | 'glass' }
) => {
  const tables = getDB<Table>('tables');
  const table = tables.find(t => t.id === table_id);
  
  if (!table) throw new Error('Masa tapılmadı');

  // Masa məlumatlarını yeniləyək
  table.is_occupied = true;
  const existing = Array.isArray(table.items) ? table.items : [];
  const merged = [...existing];
  cart_items.forEach((incoming) => {
    const idx = merged.findIndex((m: any) => m.id === incoming.id || m.item_name === incoming.item_name);
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], qty: Number(merged[idx].qty || 0) + Number(incoming.qty || 0) };
    } else {
      merged.push(incoming);
    }
  });
  table.items = merged as any;
  table.cup_mode = options?.cup_mode || 'paper';
  
  // Totalı decimal ilə hesablayaq
  const rawTotal = cart_items.reduce((acc, curr) => {
    return acc.plus(new Decimal(curr.price).times(curr.qty));
  }, new Decimal(table.total));
  
  table.total = rawTotal.toString();
  setDB('tables', tables);

  // Mətbəx sifarişini dərhal yazaq (Ödənişi gözləmir)
  const kitchen_orders = getDB<any>('kitchen_orders');

  // Scam/double-tap qoruması: eyni masa + eyni səbət 45 saniyə içində təkrar göndərilməsin.
  const fingerprint = JSON.stringify(
    cart_items.map((i) => ({ n: i.item_name, q: i.qty, p: i.price })).sort((a, b) => a.n.localeCompare(b.n))
  );
  const nowMs = Date.now();
  const duplicate = kitchen_orders.find((o: any) => {
    if (o.tenant_id !== table.tenant_id) return false;
    if (o.table_label !== table.label) return false;
    if (!['NEW', 'PREPARING'].includes(String(o.status))) return false;
    const orderMs = new Date(o.created_at).getTime();
    if (Number.isNaN(orderMs) || nowMs - orderMs > 45_000) return false;
    const orderFingerprint = JSON.stringify(
      (o.items || [])
        .map((i: any) => ({ n: i.item_name, q: i.qty, p: i.price }))
        .sort((a: any, b: any) => String(a.n).localeCompare(String(b.n)))
    );
    return orderFingerprint === fingerprint;
  });

  if (duplicate) {
    throw new Error('Bu sifariş artıq mətbəxə göndərilib (təkrar klik bloklandı).');
  }

  const order_id = uuidv4();
  kitchen_orders.push({
    id: order_id,
    tenant_id: table.tenant_id,
    sale_id: `table-${table.id}-${Date.now()}`, // Müvəqqəti sale_id
    table_label: table.label,
    status: 'NEW',
    priority: 'NORMAL',
    items: cart_items,
    created_at: new Date().toISOString()
  });
  setDB('kitchen_orders', kitchen_orders);

  logEvent(sent_by, 'TABLE_SENT_TO_KITCHEN', { 
    tenant_id: table.tenant_id, 
    table_id, 
    items_count: cart_items.length 
  });
  
  return { kitchen_order_id: order_id, success: true };
};

// FUNKSIYA: pay_table
export const pay_table = (
  table_id: string, 
  payment_method: PaymentMethod, 
  paid_by: string,
  split_cash: Decimal | null = null,
  split_card: Decimal | null = null,
  options?: { cup_mode?: 'paper' | 'glass' }
) => {
  let tables = getDB<Table>('tables');
  const table = tables.find(t => t.id === table_id);
  
  if (!table) throw new Error('Masa tapılmadı');
  if (!table.is_occupied || table.items.length === 0) {
    throw new Error('Masa boşdur və ya istifadədə deyil');
  }

  const paidTotal = table.total;

  // Atomik Transaction: satış yaradırıq.
  const result = create_sale({
    cart_items: table.items,
    payment_method,
    cashier: paid_by,
    customer_card_id: null,
    discount_percent: 0,
    is_eco_cup: false,
    is_test: false,
    split_cash,
    split_card,
    card_tips: new Decimal(0),
    tenant_id: table.tenant_id,
    order_type: 'Dine In',
    cup_mode: options?.cup_mode || table.cup_mode || 'paper'
  });

  // Uğurlu ödənişdən sonra masanı sıfırlayırıq
  table.is_occupied = false;
  table.items = [];
  table.total = '0';
  setDB('tables', tables);

  logEvent(paid_by, 'TABLE_SALE_CREATED', { 
    tenant_id: table.tenant_id, 
    table_id, 
    total: paidTotal, 
    payment_method 
  });

  return { sale_id: result.sale_id, success: true };
};

export const revise_table_items = (table_id: string, payload: TableRevisionPayload) => {
  const tables = getDB<Table>('tables');
  const table = tables.find((t) => t.id === table_id);
  if (!table) throw new Error('Masa tapılmadı');

  const users = getDB<any>('users');
  const overrideUser = users.find((row: any) => {
    const role = String(row.role || '').toLowerCase();
    if (!['admin', 'manager', 'super_admin'].includes(role)) return false;
    return verifyLocalCredential(payload.override_password, row.password_hash || row.password);
  });
  if (!overrideUser) throw new Error('Manager/Admin override alınmadı');

  const currentItems = Array.isArray(table.items) ? table.items : [];
  const nextItems = payload.items.filter((item) => Number(item.qty || 0) > 0);
  const removedItems = currentItems.reduce<any[]>((acc, oldItem: any) => {
    const next = nextItems.find((item: any) => item.item_name === oldItem.item_name);
    const removedQty = Number(oldItem.qty || 0) - Number(next?.qty || 0);
    if (removedQty > 0) {
      acc.push({
        ...oldItem,
        qty: removedQty,
        action: 'CANCEL',
        reason: payload.reason,
        updated_by: overrideUser.username,
        updated_at: new Date().toISOString(),
      });
    }
    return acc;
  }, []);
  if (removedItems.length === 0) throw new Error('Dəyişiklik tapılmadı');

  table.items = nextItems as any;
  table.total = nextItems
    .reduce((acc, item) => acc.plus(new Decimal(item.price).times(item.qty)), new Decimal(0))
    .toFixed(2);
  table.is_occupied = nextItems.length > 0;
  setDB('tables', tables);

  const kitchenOrders = getDB<any>('kitchen_orders');
  const activeOrder = [...kitchenOrders]
    .filter((row: any) => row.tenant_id === table.tenant_id && row.table_label === table.label && ['NEW', 'PREPARING', 'READY'].includes(String(row.status || '')))
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  if (activeOrder) {
    const items = Array.isArray(activeOrder.items) ? activeOrder.items : [];
    activeOrder.items = [...items, ...removedItems];
    activeOrder.priority = 'URGENT';
    setDB('kitchen_orders', kitchenOrders);
  }

  logEvent(payload.actor, 'TABLE_ITEM_REVISED', {
    tenant_id: table.tenant_id,
    table_id,
    table_label: table.label,
    reason: payload.reason,
    override_by: overrideUser.username,
    removed_items: removedItems.map((item: any) => `${item.qty}x ${item.item_name}`),
  });
  return { success: true, override_by: overrideUser.username, table_total: table.total };
};

export const transfer_table = (table_id: string, target_table_id: string, actor: string) => {
  const tables = getDB<Table>('tables');
  const source = tables.find((t) => t.id === table_id);
  const target = tables.find((t) => t.id === target_table_id);
  if (!source || !target) throw new Error('Masa tapılmadı');
  if (source.id === target.id) throw new Error('Fərqli masa seçin');
  if (!source.is_occupied) throw new Error('Mənbə masa boşdur');
  if (target.is_occupied) throw new Error('Köçürmə üçün hədəf masa boş olmalıdır');

  target.items = Array.isArray(source.items) ? [...source.items] : [];
  target.total = source.total;
  target.is_occupied = true;

  source.items = [];
  source.total = '0';
  source.is_occupied = false;

  const kitchenOrders = getDB<any>('kitchen_orders');
  kitchenOrders.forEach((order: any) => {
    if (order.tenant_id === source.tenant_id && order.table_label === source.label && ['NEW', 'PREPARING', 'READY'].includes(String(order.status || ''))) {
      order.table_label = target.label;
    }
  });
  setDB('kitchen_orders', kitchenOrders);
  setDB('tables', tables);
  logEvent(actor, 'TABLE_TRANSFERRED', { tenant_id: source.tenant_id, from_table: source.label, to_table: target.label });
  return { success: true };
};

export const merge_tables = (table_id: string, target_table_id: string, actor: string) => {
  const tables = getDB<Table>('tables');
  const source = tables.find((t) => t.id === table_id);
  const target = tables.find((t) => t.id === target_table_id);
  if (!source || !target) throw new Error('Masa tapılmadı');
  if (source.id === target.id) throw new Error('Fərqli masa seçin');
  if (!source.is_occupied) throw new Error('Mənbə masa boşdur');

  const targetItems = Array.isArray(target.items) ? [...target.items] : [];
  const sourceItems = Array.isArray(source.items) ? source.items : [];
  sourceItems.forEach((incoming) => {
    const idx = targetItems.findIndex((row: any) => row.id === incoming.id || row.item_name === incoming.item_name);
    if (idx >= 0) targetItems[idx] = { ...targetItems[idx], qty: Number(targetItems[idx].qty || 0) + Number(incoming.qty || 0) };
    else targetItems.push(incoming as any);
  });

  target.items = targetItems as any;
  target.total = new Decimal(target.total || 0).plus(new Decimal(source.total || 0)).toFixed(2);
  target.is_occupied = true;

  source.items = [];
  source.total = '0';
  source.is_occupied = false;

  const kitchenOrders = getDB<any>('kitchen_orders');
  kitchenOrders.forEach((order: any) => {
    if (order.tenant_id === source.tenant_id && order.table_label === source.label && ['NEW', 'PREPARING', 'READY'].includes(String(order.status || ''))) {
      order.table_label = target.label;
    }
  });
  setDB('kitchen_orders', kitchenOrders);
  setDB('tables', tables);
  logEvent(actor, 'TABLE_MERGED', { tenant_id: source.tenant_id, from_table: source.label, to_table: target.label });
  return { success: true };
};

export const get_tables_live = async (tenant_id: string) => {
  if (!isBackendEnabled()) return get_tables(tenant_id);
  try {
    return await apiRequest<any[]>('/api/v1/ops/tables', { tenantId: null });
  } catch (error) {
    if (!isRecoverableNetworkFailure(error)) throw error;
    return get_tables(tenant_id);
  }
};

export const create_table_live = async (tenant_id: string, label: string, created_by: string) => {
  if (!isBackendEnabled()) return create_table(tenant_id, label, created_by);
  try {
    return await apiRequest<any>('/api/v1/ops/tables', { method: 'POST', tenantId: null, body: { label } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend create failed: ${message}`);
  }
};

export const delete_table_live = async (table_id: string, deleted_by: string) => {
  if (!isBackendEnabled()) return delete_table(table_id, deleted_by);
  try {
    return await apiRequest<{ success: boolean }>(`/api/v1/ops/tables/${encodeURIComponent(table_id)}`, { method: 'DELETE', tenantId: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend delete failed: ${message}`);
  }
};

export const send_to_kitchen_live = async (
  table_id: string,
  cart_items: CartItem[],
  sent_by: string,
  options?: { cup_mode?: 'paper' | 'glass' }
) => {
  if (!isBackendEnabled()) return send_to_kitchen(table_id, cart_items, sent_by, options);
  try {
    return await apiRequest<any>(`/api/v1/ops/tables/${encodeURIComponent(table_id)}/send-to-kitchen`, {
      method: 'POST',
      tenantId: null,
      body: { cart_items, cup_mode: options?.cup_mode || 'paper' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend kitchen send failed: ${message}`);
  }
};

export const pay_table_live = async (
  table_id: string,
  payment_method: PaymentMethod,
  paid_by: string,
  split_cash: Decimal | null = null,
  split_card: Decimal | null = null,
  options?: { cup_mode?: 'paper' | 'glass' }
) => {
  if (!isBackendEnabled()) return pay_table(table_id, payment_method, paid_by, split_cash, split_card, options);
  try {
    return await apiRequest<any>(`/api/v1/ops/tables/${encodeURIComponent(table_id)}/pay`, {
      method: 'POST',
      tenantId: null,
      body: {
        payment_method,
        split_cash: split_cash ? split_cash.toFixed(2) : null,
        split_card: split_card ? split_card.toFixed(2) : null,
        cup_mode: options?.cup_mode || 'paper',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend pay failed: ${message}`);
  }
};

export const transfer_table_live = async (table_id: string, target_table_id: string, actor: string) => {
  if (!isBackendEnabled()) return transfer_table(table_id, target_table_id, actor);
  try {
    return await apiRequest<{ success: boolean }>(`/api/v1/ops/tables/${encodeURIComponent(table_id)}/transfer`, {
      method: 'POST',
      tenantId: null,
      body: { target_table_id },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend transfer failed: ${message}`);
  }
};

export const merge_tables_live = async (table_id: string, target_table_id: string, actor: string) => {
  if (!isBackendEnabled()) return merge_tables(table_id, target_table_id, actor);
  try {
    return await apiRequest<{ success: boolean }>(`/api/v1/ops/tables/${encodeURIComponent(table_id)}/merge`, {
      method: 'POST',
      tenantId: null,
      body: { target_table_id },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend merge failed: ${message}`);
  }
};

export const revise_table_items_live = async (table_id: string, payload: TableRevisionPayload) => {
  if (!isBackendEnabled()) return revise_table_items(table_id, payload);
  try {
    return await apiRequest<{ success: boolean; override_by: string; table_total: string }>(
      `/api/v1/ops/tables/${encodeURIComponent(table_id)}/items`,
      {
        method: 'PATCH',
        tenantId: null,
        body: {
          items: payload.items.map((item) => ({
            id: item.id,
            item_name: item.item_name,
            price: new Decimal(item.price).toFixed(2),
            qty: item.qty,
            is_coffee: item.is_coffee,
            category: item.category,
          })),
          reason: payload.reason,
          override_password: payload.override_password,
        },
      },
    );
  } catch (error) {
    if (isRecoverableNetworkFailure(error)) return revise_table_items(table_id, payload);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend revise failed: ${message}`);
  }
};
