import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { logEvent } from '../lib/logger';
import { CartItem, PaymentMethod } from '../types/pos';
import { create_sale, calculate_total } from './pos';
import { apiRequest, isBackendEnabled } from './client';
import { verifyLocalCredential } from '../lib/local_auth';

import { getDB, setDB } from '../lib/db_sim';

// ── Password attempt rate limiter (max 5 attempts per 5 min) ──────────────
const PASSWORD_MAX_ATTEMPTS = 5;
const PASSWORD_LOCKOUT_MS = 5 * 60 * 1000;
const passwordAttempts: { count: number; firstAttemptAt: number } = { count: 0, firstAttemptAt: 0 };

function checkPasswordRateLimit(): void {
  const now = Date.now();
  if (now - passwordAttempts.firstAttemptAt > PASSWORD_LOCKOUT_MS) {
    passwordAttempts.count = 0;
    passwordAttempts.firstAttemptAt = now;
  }
  if (passwordAttempts.count >= PASSWORD_MAX_ATTEMPTS) {
    const remainingSec = Math.ceil((PASSWORD_LOCKOUT_MS - (now - passwordAttempts.firstAttemptAt)) / 1000);
    throw new Error(`Çox sayda uğursuz cəhd. ${remainingSec} saniyə gözləyin.`);
  }
}

function recordPasswordAttempt(success: boolean): void {
  if (success) {
    passwordAttempts.count = 0;
    passwordAttempts.firstAttemptAt = 0;
  } else {
    if (passwordAttempts.count === 0) passwordAttempts.firstAttemptAt = Date.now();
    passwordAttempts.count += 1;
  }
}

export interface Table {
  id: string;
  tenant_id: string;
  label: string;
  floor_plan_id?: string | null;
  pos_x?: number;
  pos_y?: number;
  is_occupied: boolean;
  assigned_to?: string | null;
  guest_count?: number;
  deposit_guest_count?: number;
  deposit_amount?: string;
  deposit_seat_labels?: string[];
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

type TableSeatReassignPayload = {
  from_seat: string;
  to_seat: string;
  item_name?: string;
  mode?: 'item' | 'seat';
};

type TableOpenPayload = {
  guest_count: number;
  deposit_guest_count: number;
  deposit_seat_labels?: string[];
  opened_by: string;
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

type OfflineTableOpType = 'open' | 'send_to_kitchen' | 'pay';
type OfflineTableOpRecord = {
  id: string;
  tenant_id: string;
  table_id: string;
  op_type: OfflineTableOpType;
  payload: Record<string, unknown>;
  created_at: string;
  synced_at?: string;
  retry_count?: number;
  next_attempt_at?: string;
  last_attempt_at?: string;
  last_error?: string;
  status: 'pending' | 'synced';
};

const OFFLINE_TABLE_OPS_KEY = 'offline_table_ops';
const TABLE_OPS_SYNC_BATCH = 20;
const TABLE_OPS_BASE_DELAY_MS = 15_000;

const createOfflineOpId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `tblop_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const getOfflineTableOps = () => getDB<OfflineTableOpRecord>(OFFLINE_TABLE_OPS_KEY) || [];
const setOfflineTableOps = (rows: OfflineTableOpRecord[]) => setDB(OFFLINE_TABLE_OPS_KEY, rows);

const enqueueOfflineTableOp = (
  tenant_id: string,
  table_id: string,
  op_type: OfflineTableOpType,
  payload: Record<string, unknown>,
) => {
  const rows = getOfflineTableOps();
  // TTL: remove ops older than 24 hours to prevent stale payment data accumulation
  const TTL_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const filtered = rows.filter((row) => {
    if (row.status === 'synced') return false;
    const createdMs = new Date(row.created_at).getTime();
    return !Number.isNaN(createdMs) && (now - createdMs) < TTL_MS;
  });
  filtered.push({
    id: createOfflineOpId(),
    tenant_id,
    table_id,
    op_type,
    payload,
    created_at: new Date().toISOString(),
    retry_count: 0,
    status: 'pending',
  });
  setOfflineTableOps(filtered);
};

const isTableOpAlreadyAppliedError = (message: string, opType: OfflineTableOpType) => {
  const m = String(message || '').toLowerCase();
  if (!m) return false;
  if (opType === 'open' && (m.includes('masa artıq açıqdır') || m.includes('already open'))) return true;
  if (opType === 'send_to_kitchen' && (m.includes('artıq mətbəxə göndərilib') || m.includes('already sent'))) return true;
  if (opType === 'pay' && (m.includes('masa boşdur') || m.includes('istifadədə deyil') || m.includes('already paid'))) return true;
  return false;
};

export const syncPendingOfflineTableOps = async (tenant_id: string) => {
  if (!isBackendEnabled()) return { synced: 0, failed: 0 };
  const rows = getOfflineTableOps();
  const nowMs = Date.now();
  const pending = rows
    .filter((row) => row.tenant_id === tenant_id && row.status === 'pending')
    .filter((row) => !row.next_attempt_at || new Date(String(row.next_attempt_at)).getTime() <= nowMs)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .slice(0, TABLE_OPS_SYNC_BATCH);
  if (!pending.length) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  for (const row of pending) {
    try {
      if (row.op_type === 'open') {
        await apiRequest<any>(`/api/v1/ops/tables/${encodeURIComponent(row.table_id)}/open`, {
          method: 'POST',
          tenantId: null,
          body: row.payload,
        });
      } else if (row.op_type === 'send_to_kitchen') {
        await apiRequest<any>(`/api/v1/ops/tables/${encodeURIComponent(row.table_id)}/send-to-kitchen`, {
          method: 'POST',
          tenantId: null,
          body: row.payload,
        });
      } else if (row.op_type === 'pay') {
        await apiRequest<any>(`/api/v1/ops/tables/${encodeURIComponent(row.table_id)}/pay`, {
          method: 'POST',
          tenantId: null,
          body: row.payload,
        });
      }
      row.status = 'synced';
      row.synced_at = new Date().toISOString();
      row.last_error = '';
      synced += 1;
    } catch (error) {
      const message = String((error as any)?.message || 'sync_failed');
      const alreadyApplied = isTableOpAlreadyAppliedError(message, row.op_type);
      if (alreadyApplied) {
        row.status = 'synced';
        row.synced_at = new Date().toISOString();
        row.last_error = message.slice(0, 500);
        synced += 1;
      } else {
        const retryCount = Number(row.retry_count || 0) + 1;
        const delay = TABLE_OPS_BASE_DELAY_MS * (2 ** Math.min(retryCount, 6));
        row.retry_count = retryCount;
        row.last_attempt_at = new Date().toISOString();
        row.next_attempt_at = new Date(Date.now() + delay).toISOString();
        row.last_error = message.slice(0, 500);
        failed += 1;
      }
    }
  }
  setOfflineTableOps(rows);
  return { synced, failed };
};

export type OfflineTableOpSummary = {
  id: string;
  table_id: string;
  op_type: OfflineTableOpType;
  created_at: string;
  retry_count: number;
  last_error?: string;
  next_attempt_at?: string;
};

export const getPendingOfflineTableOpsCount = (tenant_id: string): number => {
  return getOfflineTableOps().filter((row) => row.tenant_id === tenant_id && row.status === 'pending').length;
};

export const getPendingOfflineTableOps = (tenant_id: string, limit = 8): OfflineTableOpSummary[] => {
  return getOfflineTableOps()
    .filter((row) => row.tenant_id === tenant_id && row.status === 'pending')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, Math.max(1, limit))
    .map((row) => ({
      id: row.id,
      table_id: row.table_id,
      op_type: row.op_type,
      created_at: row.created_at,
      retry_count: Number(row.retry_count || 0),
      last_error: row.last_error,
      next_attempt_at: row.next_attempt_at,
    }));
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
export const create_table = (tenant_id: string, label: string, created_by: string, floor_plan_id?: string | null) => {
  const tables = getDB<Table>('tables');

  // Input validation
  const trimmedLabel = String(label || '').trim();
  if (!trimmedLabel) throw new Error('Masa adı boş ola bilməz');
  if (trimmedLabel.length > 50) throw new Error('Masa adı 50 simvoldan uzun ola bilməz');
  
  if (tables.find(t => t.label === trimmedLabel && t.tenant_id === tenant_id)) {
    throw new Error('Eyni adlı masa artıq mövcuddur');
  }

  let active_floor_id = floor_plan_id;
  if (!active_floor_id) {
    const floors = getDB<any>('restaurant_floor_plans').filter((row) => row.tenant_id === tenant_id);
    const activeFloor = floors.find((row) => row.is_active) || floors[0];
    if (activeFloor) {
      active_floor_id = activeFloor.id;
    }
  }

  const new_table: Table = {
    id: uuidv4(),
    tenant_id,
    label: trimmedLabel,
    floor_plan_id: active_floor_id || null,
    pos_x: 0,
    pos_y: 0,
    is_occupied: false,
    assigned_to: null,
    guest_count: 0,
    deposit_guest_count: 0,
    deposit_amount: '0',
    deposit_seat_labels: [],
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
  if (table.is_occupied && table.assigned_to && table.assigned_to !== sent_by) {
    throw new Error(`Bu masa ${table.assigned_to} üçün aktivdir`);
  }

  // Masa məlumatlarını yeniləyək
  table.is_occupied = true;
  const existing = Array.isArray(table.items) ? table.items : [];
  // Mark all already-stored items as kitchen_sent so they're distinguishable
  const existingMarked = existing.map((item: any) => ({ ...item, kitchen_sent: true }));
  const merged = [...existingMarked];
  // New incoming items also get kitchen_sent=true (they're being sent now)
  const incomingMarked = cart_items.map((item) => ({ ...item, kitchen_sent: true }));
  incomingMarked.forEach((incoming) => {
    const idx = merged.findIndex((m: any) => m.id === incoming.id || (m.item_name === incoming.item_name && String(m.seat_label || '') === String((incoming as any).seat_label || '')));
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], qty: Number(merged[idx].qty || 0) + Number(incoming.qty || 0) };
    } else {
      merged.push(incoming);
    }
  });
  table.items = merged as any;
  table.cup_mode = options?.cup_mode || 'paper';
  if (!table.assigned_to) table.assigned_to = sent_by;
  
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

export const open_table = (table_id: string, payload: TableOpenPayload) => {
  const tables = getDB<Table>('tables');
  const table = tables.find((t) => t.id === table_id);
  if (!table) throw new Error('Masa tapılmadı');
  if (table.is_occupied && table.assigned_to && table.assigned_to !== payload.opened_by) {
    throw new Error(`Bu masa ${table.assigned_to} üçün aktivdir`);
  }
  if (table.is_occupied && ((Array.isArray(table.items) && table.items.length > 0) || new Decimal(table.deposit_amount || 0).greaterThan(0))) {
    throw new Error('Masa artıq açıqdır');
  }
  const settings = getDB<any>('settings').find((s: any) => s.tenant_id === table.tenant_id) || {};
  const reservationLockHours = Math.max(0, Number(settings.table_service_settings?.reservation_lock_hours ?? 2));
  const now = new Date();
  const lockUntil = new Date(now.getTime() + reservationLockHours * 60 * 60 * 1000);
  const lockedReservation = getDB<any>('restaurant_reservations').find((row: any) => (
    row.tenant_id === table.tenant_id
    && row.assigned_table_id === table.id
    && String(row.status || '').toUpperCase() === 'BOOKED'
    && new Date(row.reservation_at) >= now
    && new Date(row.reservation_at) <= lockUntil
  ));
  if (lockedReservation) {
    throw new Error(`Bu masa rezervdədir və ${new Date(lockedReservation.reservation_at).toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' })} üçün bağlıdır`);
  }

  const guestCount = Math.max(1, Number(payload.guest_count || 0));
  const depositSeatLabels = Array.isArray(payload.deposit_seat_labels)
    ? payload.deposit_seat_labels.map((label) => String(label || '').trim()).filter(Boolean)
    : [];
  const depositGuestCount = Math.max(0, Math.min(guestCount, depositSeatLabels.length || Number(payload.deposit_guest_count || 0)));
  const depositPerGuest = new Decimal(settings.table_service_settings?.deposit_per_guest_azn || 0);
  const depositAmount = depositPerGuest.times(depositGuestCount).toFixed(2);

  table.is_occupied = true;
  table.assigned_to = payload.opened_by;
  table.guest_count = guestCount;
  table.deposit_guest_count = depositGuestCount;
  table.deposit_amount = depositAmount;
  table.deposit_seat_labels = depositSeatLabels.length ? depositSeatLabels : Array.from({ length: depositGuestCount }, (_, idx) => `Adam-${idx + 1}`);
  setDB('tables', tables);

  if (new Decimal(depositAmount).greaterThan(0)) {
    const finance = getDB<any>('finance');
    finance.push({
      id: uuidv4(),
      tenant_id: table.tenant_id,
      type: 'in',
      category: 'Masa Depoziti',
      amount: depositAmount,
      source: 'cash',
      description: `${table.label} üçün depozit (${depositGuestCount} nəfər)`,
      created_at: new Date().toISOString(),
      is_deleted: false,
    });
    finance.push({
      id: uuidv4(),
      tenant_id: table.tenant_id,
      type: 'in',
      category: 'Depozit Öhdəliyi',
      amount: depositAmount,
      source: 'deposit',
      description: `${table.label} üçün depozit öhdəliyi (${depositGuestCount} nəfər)`,
      created_at: new Date().toISOString(),
      is_deleted: false,
    });
    setDB('finance', finance);
  }

  logEvent(payload.opened_by, 'TABLE_OPENED', {
    tenant_id: table.tenant_id,
    table_id,
    table_label: table.label,
    guest_count: guestCount,
    deposit_guest_count: depositGuestCount,
    deposit_amount: depositAmount,
  });
  return { success: true, guest_count: guestCount, deposit_guest_count: depositGuestCount, deposit_amount: depositAmount, deposit_seat_labels: table.deposit_seat_labels };
};

// FUNKSIYA: pay_table
export const pay_table = (
  table_id: string, 
  payment_method: PaymentMethod, 
  paid_by: string,
  split_cash: Decimal | null = null,
  split_card: Decimal | null = null,
  options?: { cup_mode?: 'paper' | 'glass'; pay_scope?: 'full' | 'seat'; seat_label?: string; discount_percent?: number | string | Decimal | null }
) => {
  let tables = getDB<Table>('tables');
  const table = tables.find(t => t.id === table_id);
  
  if (!table) throw new Error('Masa tapılmadı');
  if (!table.is_occupied || (table.items.length === 0 && new Decimal(table.deposit_amount || 0).lessThanOrEqualTo(0))) {
    throw new Error('Masa boşdur və ya istifadədə deyil');
  }

  const settings = getDB<any>('settings').find((s: any) => s.tenant_id === table.tenant_id) || {};
  const payScope = options?.pay_scope || 'full';
  const seatLabel = options?.seat_label || '';
  const allItems = Array.isArray(table.items) ? table.items : [];
  const itemsForSale = payScope === 'seat' ? allItems.filter((item: any) => String(item.seat_label || '') === seatLabel) : allItems;
  const remainingItems = payScope === 'seat' ? allItems.filter((item: any) => String(item.seat_label || '') !== seatLabel) : [];
  const itemsTotal = itemsForSale.reduce((acc, item) => acc.plus(new Decimal(item.price || 0).times(item.qty || 0)), new Decimal(0));
  const serviceFeePercent = new Decimal(settings.service_fee_percent || 0);
  const discountPercent = Decimal.max(new Decimal(0), Decimal.min(new Decimal(options?.discount_percent || 0), new Decimal(50))).toDecimalPlaces(2);
  const preDiscountServiceFeeAmount = itemsTotal.times(serviceFeePercent).div(100).toDecimalPlaces(2);
  const depositPerGuest = new Decimal(settings.table_service_settings?.deposit_per_guest_azn || 0);
  const depositAmount = payScope === 'seat'
    ? ((table.deposit_seat_labels || []).includes(seatLabel) ? depositPerGuest : new Decimal(0))
    : new Decimal(table.deposit_amount || 0);
  const preDiscountPayableTotal = Decimal.max(itemsTotal.plus(preDiscountServiceFeeAmount), depositAmount).toDecimalPlaces(2);
  
  // Use calculate_total to properly account for standard and summer promotion discounts
  const calc = calculate_total(
    itemsForSale.map((item) => ({
      price: new Decimal(item.price || 0),
      qty: item.qty || 0,
      is_coffee: item.is_coffee || false,
      category: item.category || '',
      item_name: item.item_name || '',
    })),
    table.tenant_id,
    'Normal',
    Number(discountPercent.toString()),
    false,
    null,
    null,
    settings.beverage_service_settings
  );
  const discountedItemsTotal = calc.final_total;
  const serviceFeeAmount = discountedItemsTotal.times(serviceFeePercent).div(100).toDecimalPlaces(2);
  const payableTotal = Decimal.max(discountedItemsTotal.plus(serviceFeeAmount), depositAmount).toDecimalPlaces(2);
  const discountAmount = Decimal.max(new Decimal(0), preDiscountPayableTotal.minus(payableTotal)).toDecimalPlaces(2);
  const extraDue = Decimal.max(new Decimal(0), payableTotal.minus(depositAmount)).toDecimalPlaces(2);
  const paidTotal = payableTotal.toFixed(2);

  // Atomik Transaction: satış yaradırıq.
  const result = create_sale({
    cart_items: itemsForSale,
    payment_method,
    cashier: paid_by,
    customer_card_id: null,
    discount_percent: discountPercent,
    is_eco_cup: false,
    is_test: false,
    split_cash,
    split_card,
    card_tips: new Decimal(0),
    tenant_id: table.tenant_id,
    order_type: 'Dine In',
    cup_mode: options?.cup_mode || table.cup_mode || 'paper'
  });

  const sales = getDB<any>('sales');
  const sale = sales.find((s: any) => s.id === result.sale_id);
  if (sale) {
    sale.original_total = itemsTotal.toFixed(2);
    sale.total = paidTotal;
    sale.discount_amount = discountAmount.toFixed(2);
    (sale as any).discount_percent = discountPercent.toFixed(2);
    (sale as any).discounted_items_total = discountedItemsTotal.toFixed(2);
    (sale as any).service_fee_amount = serviceFeeAmount.toFixed(2);
    (sale as any).deposit_amount = depositAmount.toFixed(2);
    (sale as any).extra_due = extraDue.toFixed(2);
  }
  setDB('sales', sales);

  const finance = getDB<any>('finance').filter((row: any) => row.sale_id !== result.sale_id);
  if (extraDue.greaterThan(0)) {
    if (payment_method === 'Split' && split_cash !== null && split_card !== null) {
      finance.push({
        id: uuidv4(),
        tenant_id: table.tenant_id,
        sale_id: result.sale_id,
        type: 'in',
        category: 'Satış (Nağd)',
        amount: split_cash.toFixed(2),
        source: 'cash',
        description: 'Table payment split cash',
        created_at: new Date().toISOString(),
        is_deleted: false,
      });
      finance.push({
        id: uuidv4(),
        tenant_id: table.tenant_id,
        sale_id: result.sale_id,
        type: 'in',
        category: 'Satış (Kart)',
        amount: split_card.toFixed(2),
        source: 'card',
        description: 'Table payment split card',
        created_at: new Date().toISOString(),
        is_deleted: false,
      });
    } else {
      finance.push({
        id: uuidv4(),
        tenant_id: table.tenant_id,
        sale_id: result.sale_id,
        type: 'in',
        category: payment_method === 'Kart' ? 'Satış (Kart)' : 'Satış (Nağd)',
        amount: extraDue.toFixed(2),
        source: payment_method === 'Kart' ? 'card' : 'cash',
        description: 'Table payment additional due',
        created_at: new Date().toISOString(),
        is_deleted: false,
      });
    }
  }
  if (depositAmount.greaterThan(0)) {
    finance.push({
      id: uuidv4(),
      tenant_id: table.tenant_id,
      sale_id: result.sale_id,
      type: 'out',
      category: 'Depozit Öhdəliyi Azaldılması',
      amount: depositAmount.toFixed(2),
      source: 'deposit',
      description: 'Table payment deposit settlement',
      created_at: new Date().toISOString(),
      is_deleted: false,
    });
  }
  setDB('finance', finance);

  // Uğurlu ödənişdən sonra masanı sıfırlayırıq
  if (payScope === 'seat') {
    table.items = remainingItems as any;
    table.total = remainingItems.reduce((acc, item) => acc.plus(new Decimal(item.price || 0).times(item.qty || 0)), new Decimal(0)).toFixed(2);
    table.deposit_seat_labels = (table.deposit_seat_labels || []).filter((label) => label !== seatLabel);
    table.deposit_guest_count = table.deposit_seat_labels.length;
    table.deposit_amount = depositPerGuest.times(table.deposit_guest_count).toFixed(2);
    table.guest_count = Math.max(0, Number(table.guest_count || 0) - 1);
    table.is_occupied = table.items.length > 0 || new Decimal(table.deposit_amount || 0).greaterThan(0) || Number(table.guest_count || 0) > 0;
    if (!table.is_occupied) table.assigned_to = null;
  } else {
    table.is_occupied = false;
    table.assigned_to = null;
    table.guest_count = 0;
    table.deposit_guest_count = 0;
    table.deposit_amount = '0';
    table.deposit_seat_labels = [];
    table.items = [];
    table.total = '0';
  }
  setDB('tables', tables);

  logEvent(paid_by, 'TABLE_SALE_CREATED', { 
    tenant_id: table.tenant_id, 
    table_id, 
    total: paidTotal, 
    payment_method 
  });

  return {
    sale_id: result.sale_id,
    success: true,
    items_total: itemsTotal.toFixed(2),
    discount_percent: discountPercent.toFixed(2),
    discount_amount: discountAmount.toFixed(2),
    discounted_items_total: discountedItemsTotal.toFixed(2),
    service_fee_amount: serviceFeeAmount.toFixed(2),
    deposit_amount: depositAmount.toFixed(2),
    extra_due: extraDue.toFixed(2),
    final_total: paidTotal,
  };
};

export const revise_table_items = (table_id: string, payload: TableRevisionPayload) => {
  const tables = getDB<Table>('tables');
  const table = tables.find((t) => t.id === table_id);
  if (!table) throw new Error('Masa tapılmadı');

  const currentItems = Array.isArray(table.items) ? table.items : [];
  const nextItems = payload.items.filter((item) => Number(item.qty || 0) > 0);

  // Split removed items into draft (not yet kitchen-sent) and sent categories
  const removedDraft: any[] = [];
  const removedSent: any[] = [];
  currentItems.forEach((oldItem: any) => {
    const next = nextItems.find((item: any) => item.item_name === oldItem.item_name && String(item.seat_label || '') === String(oldItem.seat_label || ''));
    const removedQty = Number(oldItem.qty || 0) - Number(next?.qty || 0);
    if (removedQty > 0) {
      const entry = { ...oldItem, qty: removedQty };
      if (oldItem.kitchen_sent) {
        removedSent.push(entry);
      } else {
        removedDraft.push(entry);
      }
    }
  });

  if (removedDraft.length === 0 && removedSent.length === 0) throw new Error('Dəyişiklik tapılmadı');

  // Manager override required only if kitchen-sent items are being removed
  let overrideUsername = payload.actor;
  if (removedSent.length > 0) {
    checkPasswordRateLimit();
    const users = getDB<any>('users');
    const overrideUser = users.find((row: any) => {
      const role = String(row.role || '').toLowerCase();
      if (!['admin', 'manager', 'super_admin'].includes(role)) return false;
      return verifyLocalCredential(payload.override_password || '', row.password_hash || row.password);
    });
    if (!overrideUser) {
      recordPasswordAttempt(false);
      throw new Error('Manager/Admin override alınmadı');
    }
    recordPasswordAttempt(true);
    overrideUsername = overrideUser.username;
  }

  const nowIso = new Date().toISOString();
  const removedItems = [
    ...removedDraft.map((item) => ({ ...item, action: 'CANCEL', reason: payload.reason || 'Draft silindi', updated_by: overrideUsername, updated_at: nowIso })),
    ...removedSent.map((item) => ({ ...item, action: 'CANCEL', reason: payload.reason, updated_by: overrideUsername, updated_at: nowIso })),
  ];

  // Preserve kitchen_sent flag from existing items
  const oldMap: Record<string, any> = {};
  currentItems.forEach((item: any) => {
    const key = `${String(item.item_name || '').trim()}__${String(item.seat_label || '').trim()}`;
    oldMap[key] = item;
  });
  const nextItemsWithFlags = nextItems.map((item) => {
    const key = `${String(item.item_name || '').trim()}__${String(item.seat_label || '').trim()}`;
    const oldRef = oldMap[key] || {};
    return { ...item, kitchen_sent: Boolean(oldRef.kitchen_sent) };
  }).filter((item) => Number(item.qty || 0) > 0);

  table.items = nextItemsWithFlags as any;
  table.total = nextItemsWithFlags
    .reduce((acc, item) => acc.plus(new Decimal(item.price).times(item.qty)), new Decimal(0))
    .toFixed(2);
  table.is_occupied = nextItemsWithFlags.length > 0;
  setDB('tables', tables);

  // Notify kitchen only when sent items were removed
  if (removedSent.length > 0) {
    const kitchenOrders = getDB<any>('kitchen_orders');
    const activeOrder = [...kitchenOrders]
      .filter((row: any) => row.tenant_id === table.tenant_id && row.table_label === table.label && ['NEW', 'PREPARING', 'READY'].includes(String(row.status || '')))
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    if (activeOrder) {
      const items = Array.isArray(activeOrder.items) ? activeOrder.items : [];
      activeOrder.items = [...items, ...removedSent.map((item) => ({ ...item, action: 'CANCEL', reason: payload.reason, updated_by: overrideUsername, updated_at: nowIso }))];
      activeOrder.priority = 'URGENT';
      setDB('kitchen_orders', kitchenOrders);
    }
  }

  logEvent(payload.actor, 'TABLE_ITEM_REVISED', {
    tenant_id: table.tenant_id,
    table_id,
    table_label: table.label,
    reason: payload.reason || 'Draft silindi',
    override_by: overrideUsername,
    removed_draft_count: removedDraft.length,
    removed_sent_count: removedSent.length,
  });
  return { success: true, override_by: overrideUsername, table_total: table.total };
};

export const abort_table = (table_id: string, actor: string) => {
  const tables = getDB<Table>('tables');
  const table = tables.find((t) => t.id === table_id);
  if (!table) throw new Error('Masa tapılmadı');
  if (!table.is_occupied) throw new Error('Masa artıq bağlıdır');

  const items = Array.isArray(table.items) ? table.items : [];
  const hasSentItems = items.some((item: any) => Boolean(item.kitchen_sent));
  if (hasSentItems) {
    throw new Error('Mətbəxə göndərilmiş sifariş var. Masanı ləğv etmək üçün menecer override istifadə edin.');
  }

  table.is_occupied = false;
  table.assigned_to = null;
  table.guest_count = 0;
  table.deposit_guest_count = 0;
  table.deposit_amount = '0';
  table.deposit_seat_labels = [];
  table.items = [];
  table.total = '0';
  setDB('tables', tables);

  logEvent(actor, 'TABLE_ABORTED', { tenant_id: table.tenant_id, table_id, table_label: table.label });
  return { success: true };
};

export const abort_table_live = async (table_id: string, actor: string) => {
  if (!isBackendEnabled()) return abort_table(table_id, actor);
  try {
    return await apiRequest<{ success: boolean }>(`/api/v1/ops/tables/${encodeURIComponent(table_id)}/abort`, {
      method: 'POST',
      tenantId: null,
      body: {},
    });
  } catch (error) {
    if (isRecoverableNetworkFailure(error)) return abort_table(table_id, actor);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend abort failed: ${message}`);
  }
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
  target.assigned_to = source.assigned_to || target.assigned_to || null;
  target.guest_count = source.guest_count || 0;
  target.deposit_guest_count = source.deposit_guest_count || 0;
  target.deposit_amount = source.deposit_amount || '0';
  target.deposit_seat_labels = Array.isArray(source.deposit_seat_labels) ? [...source.deposit_seat_labels] : [];

  source.items = [];
  source.total = '0';
  source.is_occupied = false;
  source.assigned_to = null;
  source.guest_count = 0;
  source.deposit_guest_count = 0;
  source.deposit_amount = '0';
  source.deposit_seat_labels = [];

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
    const idx = targetItems.findIndex((row: any) => row.id === incoming.id || (row.item_name === incoming.item_name && String(row.seat_label || '') === String(incoming.seat_label || '')));
    if (idx >= 0) targetItems[idx] = { ...targetItems[idx], qty: Number(targetItems[idx].qty || 0) + Number(incoming.qty || 0) };
    else targetItems.push(incoming as any);
  });

  target.items = targetItems as any;
  target.total = new Decimal(target.total || 0).plus(new Decimal(source.total || 0)).toFixed(2);
  target.is_occupied = true;
  target.assigned_to = target.assigned_to || source.assigned_to || null;
  target.guest_count = Number(target.guest_count || 0) + Number(source.guest_count || 0);
  target.deposit_guest_count = Number(target.deposit_guest_count || 0) + Number(source.deposit_guest_count || 0);
  target.deposit_amount = new Decimal(target.deposit_amount || 0).plus(new Decimal(source.deposit_amount || 0)).toFixed(2);
  target.deposit_seat_labels = [...(target.deposit_seat_labels || []), ...(source.deposit_seat_labels || [])];

  source.items = [];
  source.total = '0';
  source.is_occupied = false;
  source.assigned_to = null;
  source.guest_count = 0;
  source.deposit_guest_count = 0;
  source.deposit_amount = '0';
  source.deposit_seat_labels = [];

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
    return await apiRequest<any[]>('/api/v1/ops/tables', {
      tenantId: null,
      timeoutMs: 5000,
      retryCount: 0,
    });
  } catch (error) {
    if (!isRecoverableNetworkFailure(error)) throw error;
    return get_tables(tenant_id);
  }
};

export const create_table_live = async (tenant_id: string, label: string, created_by: string, floor_plan_id?: string | null) => {
  if (!isBackendEnabled()) return create_table(tenant_id, label, created_by, floor_plan_id);
  try {
    return await apiRequest<any>('/api/v1/ops/tables', { method: 'POST', tenantId: null, body: { label, floor_plan_id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend create failed: ${message}`);
  }
};

export const open_table_live = async (table_id: string, payload: TableOpenPayload) => {
  if (!isBackendEnabled()) return open_table(table_id, payload);
  try {
    return await apiRequest<any>(`/api/v1/ops/tables/${encodeURIComponent(table_id)}/open`, {
      method: 'POST',
      tenantId: null,
      body: {
        guest_count: payload.guest_count,
        deposit_guest_count: payload.deposit_guest_count,
        deposit_seat_labels: payload.deposit_seat_labels || [],
      },
    });
  } catch (error) {
    if (isRecoverableNetworkFailure(error)) {
      const result = open_table(table_id, payload);
      const syncPayload = {
        guest_count: payload.guest_count,
        deposit_guest_count: payload.deposit_guest_count,
        deposit_seat_labels: payload.deposit_seat_labels || [],
      };
      const table = getDB<Table>('tables').find((row) => row.id === table_id);
      if (table) enqueueOfflineTableOp(table.tenant_id, table_id, 'open', syncPayload);
      return result;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend open failed: ${message}`);
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
    if (isRecoverableNetworkFailure(error)) {
      const result = send_to_kitchen(table_id, cart_items, sent_by, options);
      const table = getDB<Table>('tables').find((row) => row.id === table_id);
      if (table) {
        enqueueOfflineTableOp(table.tenant_id, table_id, 'send_to_kitchen', {
          cart_items,
          cup_mode: options?.cup_mode || 'paper',
        });
      }
      return result;
    }
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
  options?: { cup_mode?: 'paper' | 'glass'; pay_scope?: 'full' | 'seat'; seat_label?: string; discount_percent?: number | string | Decimal | null }
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
        pay_scope: options?.pay_scope || 'full',
        seat_label: options?.seat_label || null,
        discount_percent: options?.discount_percent !== null && options?.discount_percent !== undefined
          ? new Decimal(options.discount_percent || 0).toDecimalPlaces(2).toFixed(2)
          : '0.00',
      },
    });
  } catch (error) {
    if (isRecoverableNetworkFailure(error)) {
      const result = pay_table(table_id, payment_method, paid_by, split_cash, split_card, options);
      const table = getDB<Table>('tables').find((row) => row.id === table_id);
      if (table) {
        enqueueOfflineTableOp(table.tenant_id, table_id, 'pay', {
          payment_method,
          split_cash: split_cash ? split_cash.toFixed(2) : null,
          split_card: split_card ? split_card.toFixed(2) : null,
          cup_mode: options?.cup_mode || 'paper',
          pay_scope: options?.pay_scope || 'full',
          seat_label: options?.seat_label || null,
          discount_percent: options?.discount_percent !== null && options?.discount_percent !== undefined
            ? new Decimal(options.discount_percent || 0).toDecimalPlaces(2).toFixed(2)
            : '0.00',
        });
      }
      return result;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Tables backend pay failed: ${message}`);
  }
};

export const reassign_table_seat = (table_id: string, payload: TableSeatReassignPayload) => {
  const tables = getDB<Table>('tables');
  const table = tables.find((row) => row.id === table_id);
  if (!table) throw new Error('Masa tapılmadı');

  const fromSeat = String(payload.from_seat || '').trim();
  const toSeat = String(payload.to_seat || '').trim();
  const mode = payload.mode || 'item';
  const itemName = String(payload.item_name || '').trim();
  if (!fromSeat || !toSeat || fromSeat === toSeat) throw new Error('Seat seçimi yanlışdır');
  if (mode === 'item' && !itemName) throw new Error('Məhsul adı lazımdır');

  const nextItems = (Array.isArray(table.items) ? table.items : []).map((row: any) => {
    const seat = String(row.seat_label || '').trim();
    const name = String(row.item_name || '').trim();
    const shouldMove = seat === fromSeat && (mode === 'seat' || name === itemName);
    return shouldMove ? { ...row, seat_label: toSeat } : row;
  });
  table.items = nextItems as any;

  if (Array.isArray(table.deposit_seat_labels) && table.deposit_seat_labels.includes(fromSeat)) {
    const remaining = table.deposit_seat_labels.filter((label) => label !== fromSeat);
    if (!remaining.includes(toSeat)) remaining.push(toSeat);
    table.deposit_seat_labels = remaining.sort((a, b) => Number(String(a).split('-')[1] || 0) - Number(String(b).split('-')[1] || 0));
    table.deposit_guest_count = table.deposit_seat_labels.length;
  }
  setDB('tables', tables);
  return { success: true };
};

export const reassign_table_seat_live = async (table_id: string, payload: TableSeatReassignPayload) => {
  if (!isBackendEnabled()) {
    return reassign_table_seat(table_id, payload);
  }
  try {
    return await apiRequest(`/api/v1/ops/tables/${table_id}/seats/reassign`, {
      method: 'POST',
      tenantId: null,
      body: payload,
    });
  } catch (error) {
    if (isRecoverableNetworkFailure(error)) {
      return reassign_table_seat(table_id, payload);
    }
    throw error;
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
