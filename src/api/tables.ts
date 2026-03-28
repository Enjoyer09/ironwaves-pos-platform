import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { logEvent } from '../lib/logger';
import { CartItem, PaymentMethod } from '../types/pos';
import { create_sale } from './pos';
import { apiRequest, isBackendEnabled } from './client';

import { getDB, setDB } from '../lib/db_sim';

export interface Table {
  id: string;
  tenant_id: string;
  label: string;
  is_occupied: boolean;
  items: CartItem[];
  total: string; // Decimal format
  cup_mode?: 'paper' | 'glass';
}

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

export const get_tables_live = async (tenant_id: string) => {
  if (!isBackendEnabled()) return get_tables(tenant_id);
  return apiRequest<any[]>('/api/v1/ops/tables', { tenantId: null });
};

export const create_table_live = async (tenant_id: string, label: string, created_by: string) => {
  if (!isBackendEnabled()) return create_table(tenant_id, label, created_by);
  return apiRequest<any>('/api/v1/ops/tables', { method: 'POST', tenantId: null, body: { label } });
};

export const delete_table_live = async (table_id: string, deleted_by: string) => {
  if (!isBackendEnabled()) return delete_table(table_id, deleted_by);
  return apiRequest<{ success: boolean }>(`/api/v1/ops/tables/${encodeURIComponent(table_id)}`, { method: 'DELETE', tenantId: null });
};

export const send_to_kitchen_live = async (
  table_id: string,
  cart_items: CartItem[],
  sent_by: string,
  options?: { cup_mode?: 'paper' | 'glass' }
) => {
  if (!isBackendEnabled()) return send_to_kitchen(table_id, cart_items, sent_by, options);
  return apiRequest<any>(`/api/v1/ops/tables/${encodeURIComponent(table_id)}/send-to-kitchen`, {
    method: 'POST',
    tenantId: null,
    body: { cart_items, cup_mode: options?.cup_mode || 'paper' },
  });
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
  return apiRequest<any>(`/api/v1/ops/tables/${encodeURIComponent(table_id)}/pay`, {
    method: 'POST',
    tenantId: null,
    body: {
      payment_method,
      split_cash: split_cash ? split_cash.toFixed(2) : null,
      split_card: split_card ? split_card.toFixed(2) : null,
      cup_mode: options?.cup_mode || 'paper',
    },
  });
};
