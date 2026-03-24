import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { Customer, CustomerType, Notification } from '../types/pos';
import { getActiveTenantId } from '../lib/tenant';

const defaultTenant = () => getActiveTenantId();

export function create_customer(payload: { card_id: string; type: CustomerType; initial_stars: number }) {
  const tenantId = defaultTenant();
  const customers = getDB<Customer>('customers');

  const existing = customers.find((c) => c.card_id === payload.card_id && c.tenant_id === tenantId);
  if (existing) {
    existing.type = payload.type;
    existing.stars = payload.initial_stars;
    setDB('customers', customers);
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
  setDB('customers', customers);
  
  logEvent('system', 'CUSTOMER_UPSERT', { card_id: payload.card_id, type: payload.type, tenant_id: tenantId });
  return newCustomer;
}

export function get_customer_by_qr(card_id: string) {
  const tenantId = defaultTenant();
  const customers = getDB<Customer>('customers');
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
  const notifications = getDB<Notification>('notifications');

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

  setDB('notifications', notifications);
  logEvent('system', 'CRM_SEND', { customer_count: count, tenant_id: tenantId });
  return { success: true, count };
}

export function mark_notification_read(notification_id: string) {
  const notifications = getDB<Notification>('notifications');
  const notif = notifications.find((n) => n.id === notification_id);
  if (!notif) throw new Error('Bildiriş tapılmadı');
  
  notif.is_read = true;
  setDB('notifications', notifications);
  return { success: true };
}

export async function generate_campaign_ai(goal: string) {
  const customers = getDB<Customer>('customers');
  const customerCount = customers.length;
  
  // Gemini API simulyasiyası
  const prompt = `Bizim ${customerCount} müştərimiz var. Hədəfimiz: ${goal}. Mənə 1 qısa kampaniya ideyası ver.`;
  
  logEvent('system', 'AI_CAMPAIGN_REQUEST', { goal, tenant_id: defaultTenant });
  
  return Promise.resolve(`AI Simulyasiyası: ${customerCount} müştərini cəlb etmək üçün "Həftəsonu Kofe Günü" adlı kampaniya başladın! Hər gələnə 2 qat ulduz (stars) verilsin.`);
}
