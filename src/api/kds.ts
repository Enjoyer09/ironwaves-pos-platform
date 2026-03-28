import { logEvent } from '../lib/logger';
import { KitchenOrder } from '../types/pos';

import { getDB, setDB } from '../lib/db_sim';
import { apiRequest, isBackendEnabled } from './client';

// FUNKSIYA: get_kitchen_orders
export const get_kitchen_orders = (tenant_id: string) => {
  const orders = getDB<KitchenOrder>('kitchen_orders')
    .filter(o => o.tenant_id === tenant_id && (o.status === 'NEW' || o.status === 'PREPARING' || o.status === 'READY'));

  // QAYDALAR: priority=URGENT olanlar öndə göstərilir
  return orders.sort((a, b) => {
    if (a.priority === 'URGENT' && b.priority !== 'URGENT') return -1;
    if (a.priority !== 'URGENT' && b.priority === 'URGENT') return 1;
    // Yenilər daha əvvəl gəlir
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
};

// FUNKSIYA: accept_order (NEW -> PREPARING)
export const accept_order = (order_id: string, accepted_by: string) => {
  const orders = getDB<KitchenOrder>('kitchen_orders');
  const order = orders.find(o => o.id === order_id);
  
  if (!order) throw new Error('Sifariş tapılmadı');
  
  order.status = 'PREPARING';
  setDB('kitchen_orders', orders);

  logEvent(accepted_by, 'KITCHEN_ACCEPTED', { tenant_id: order.tenant_id, order_id });
  return { success: true };
};

// FUNKSIYA: mark_urgent
export const mark_urgent = (order_id: string, marked_by: string) => {
  const orders = getDB<KitchenOrder>('kitchen_orders');
  const order = orders.find(o => o.id === order_id);
  
  if (!order) throw new Error('Sifariş tapılmadı');

  order.priority = 'URGENT';
  setDB('kitchen_orders', orders);

  logEvent(marked_by, 'KITCHEN_MARKED_URGENT', { tenant_id: order.tenant_id, order_id });
  return { success: true };
};

// FUNKSIYA: complete_order (PREPARING -> DONE)
export const complete_order = (order_id: string, completed_by: string) => {
  const orders = getDB<KitchenOrder>('kitchen_orders');
  const order = orders.find(o => o.id === order_id);
  
  if (!order) throw new Error('Sifariş tapılmadı');
  
  order.status = 'READY';
  const now = new Date();
  order.completed_at = now.toISOString();
  
  const createdDate = new Date(order.created_at);
  const prep_time_minutes = Math.floor((now.getTime() - createdDate.getTime()) / 60000);

  setDB('kitchen_orders', orders);

  logEvent(completed_by, 'KITCHEN_COMPLETED', { 
    tenant_id: order.tenant_id, 
    order_id, 
    prep_time_minutes 
  });
  
  return { success: true };
};

export const reset_kitchen_orders = (tenant_id: string, reset_by: string) => {
  const all = getDB<KitchenOrder>('kitchen_orders');
  const kept = all.filter((o) => o.tenant_id !== tenant_id);
  setDB('kitchen_orders', kept);
  logEvent(reset_by, 'KITCHEN_RESET', { tenant_id });
  return { success: true };
};

export const get_kitchen_orders_live = async (tenant_id: string) => {
  if (!isBackendEnabled()) return get_kitchen_orders(tenant_id);
  return apiRequest<any[]>('/api/v1/ops/kitchen-orders', { tenantId: null });
};

export const accept_order_live = async (order_id: string, accepted_by: string) => {
  if (!isBackendEnabled()) return accept_order(order_id, accepted_by);
  return apiRequest<{ success: boolean }>(`/api/v1/ops/kitchen-orders/${encodeURIComponent(order_id)}/accept`, { method: 'POST', tenantId: null, body: {} });
};

export const complete_order_live = async (order_id: string, completed_by: string) => {
  if (!isBackendEnabled()) return complete_order(order_id, completed_by);
  return apiRequest<{ success: boolean }>(`/api/v1/ops/kitchen-orders/${encodeURIComponent(order_id)}/complete`, { method: 'POST', tenantId: null, body: {} });
};
