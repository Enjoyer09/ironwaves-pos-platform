import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { Customer, CustomerType, Notification } from '../types/pos';
import { filterTenantRecords, getActiveTenantId } from '../lib/tenant';
import { apiRequest, isBackendEnabled } from './client';

const defaultTenant = () => getActiveTenantId();

const getCustomersLocal = (tenantId: string) => {
  const tenantRows = getDB<Customer>(`${tenantId}_customers`) || [];
  if (tenantRows.length > 0) return tenantRows;
  return filterTenantRecords(getDB<Customer>('customers'), tenantId);
};

const saveCustomersLocal = (tenantId: string, rows: Customer[]) => {
  const shared = getDB<Customer>('customers').filter((row) => String(row.tenant_id || '') !== tenantId);
  const next = [...shared, ...(Array.isArray(rows) ? rows : [])];
  setDB('customers', next);
  setDB(`${tenantId}_customers`, rows);
};

export function create_customer(payload: { card_id: string; type: CustomerType; initial_stars: number }) {
  const tenantId = defaultTenant();
  const customers = getCustomersLocal(tenantId);

  const existing = customers.find((c) => c.card_id === payload.card_id && c.tenant_id === tenantId);
  if (existing) {
    existing.type = payload.type;
    existing.stars = payload.initial_stars;
    saveCustomersLocal(tenantId, customers);
    logEvent('system', 'CUSTOMER_UPSERT', { card_id: payload.card_id, type: payload.type, tenant_id: tenantId });
    return existing;
  }

  const newCustomer: Customer = {
    id: uuidv4(),
    tenant_id: tenantId,
    card_id: payload.card_id,
    type: payload.type,
    stars: payload.initial_stars,
    secret_token: uuidv4(),
    created_at: new Date().toISOString(),
  };

  customers.push(newCustomer);
  saveCustomersLocal(tenantId, customers);
  
  logEvent('system', 'CUSTOMER_UPSERT', { card_id: payload.card_id, type: payload.type, tenant_id: tenantId });
  return newCustomer;
}

export function get_customer_by_qr(card_id: string) {
  const tenantId = defaultTenant();
  const customers = getCustomersLocal(tenantId);
  const customer = customers.find((c) => c.card_id === card_id && c.tenant_id === tenantId);
  if (!customer) throw new Error('Müştəri tapılmadı');
  return {
    card_id: customer.card_id,
    stars: customer.stars,
    type: customer.type,
    secret_token: customer.secret_token
  };
}

export function send_notification(payload: { card_ids: string[]; message: string }) {
  const tenantId = defaultTenant();
  const notifications = filterTenantRecords(getDB<Notification>('notifications'), tenantId);
  const foreignNotifications = getDB<Notification>('notifications').filter((row) => String(row.tenant_id || '') !== tenantId);

  let count = 0;
  for (const card_id of payload.card_ids) {
    const notif: Notification = {
      id: uuidv4(),
      tenant_id: tenantId,
      card_id,
      message: payload.message,
      is_read: false,
      created_at: new Date().toISOString()
    };
    notifications.push(notif);
    count++;
  }

  setDB('notifications', [...foreignNotifications, ...notifications]);
  logEvent('system', 'CRM_SEND', { customer_count: count, tenant_id: tenantId });
  return { success: true, count };
}

export function mark_notification_read(notification_id: string) {
  const tenantId = defaultTenant();
  const notifications = filterTenantRecords(getDB<Notification>('notifications'), tenantId);
  const foreignNotifications = getDB<Notification>('notifications').filter((row) => String(row.tenant_id || '') !== tenantId);
  const notif = notifications.find((n) => n.id === notification_id);
  if (!notif) throw new Error('Bildiriş tapılmadı');
  
  notif.is_read = true;
  setDB('notifications', [...foreignNotifications, ...notifications]);
  return { success: true };
}

export async function generate_campaign_ai(goal: string) {
  const customers = getCustomersLocal(defaultTenant());
  const customerCount = customers.length;
  
  // Gemini API simulyasiyası
  const prompt = `Bizim ${customerCount} müştərimiz var. Hədəfimiz: ${goal}. Mənə 1 qısa kampaniya ideyası ver.`;
  
  logEvent('system', 'AI_CAMPAIGN_REQUEST', { goal, tenant_id: defaultTenant });
  
  return Promise.resolve(`AI Simulyasiyası: ${customerCount} müştərini cəlb etmək üçün "Həftəsonu Kofe Günü" adlı kampaniya başladın! Hər gələnə 2 qat ulduz (stars) verilsin.`);
}

export async function get_customers_live(tenant_id?: string) {
  const tenantId = tenant_id || defaultTenant();
  if (!isBackendEnabled()) return getCustomersLocal(tenantId);
  return apiRequest<any[]>('/api/v1/ops/customers', { tenantId: null });
}

export async function import_customers_live(
  rows: Array<{ card_id: string; secret_token?: string; type?: string; stars?: number; discount_percent?: number | string }>,
  tenant_id?: string,
) {
  const tenantId = tenant_id || defaultTenant();
  const normalized = rows
    .map((row) => ({
      card_id: String(row.card_id || '').trim(),
      secret_token: String(row.secret_token || '').trim() || undefined,
      type: String(row.type || 'Golden').trim() || 'Golden',
      stars: Math.max(0, Number(row.stars || 0)),
      discount_percent: String(row.discount_percent ?? 0),
    }))
    .filter((row) => row.card_id.length >= 2);

  if (!normalized.length) {
    throw new Error('Import üçün ən azı 1 düzgün kart ID lazımdır');
  }

  if (!isBackendEnabled()) {
    const customers = getCustomersLocal(tenantId);
    normalized.forEach((row) => {
      const existing = customers.find((c: any) => String(c.card_id || '').toLowerCase() === row.card_id.toLowerCase());
      if (existing) {
        existing.secret_token = row.secret_token || existing.secret_token;
        existing.type = row.type;
        existing.stars = row.stars;
        existing.discount_percent = row.discount_percent;
      } else {
        customers.push({
          id: uuidv4(),
          tenant_id: tenantId,
          card_id: row.card_id,
          secret_token: row.secret_token || uuidv4(),
          type: row.type,
          stars: row.stars,
          discount_percent: row.discount_percent,
          created_at: new Date().toISOString(),
        });
      }
    });
    saveCustomersLocal(tenantId, customers);
    return { success: true, imported: normalized.length, updated: 0 };
  }

  return apiRequest<{ success: boolean; imported: number; updated: number }>('/api/v1/ops/customers/import', {
    method: 'POST',
    tenantId: null,
    body: normalized,
  });
}
