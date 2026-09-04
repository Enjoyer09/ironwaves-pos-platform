import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { HappyHour } from '../types/pos';
import { getActiveTenantId } from '../lib/tenant';
import { apiRequest, isBackendEnabled } from './client';

const defaultTenant = () => getActiveTenantId();

export function create_happy_hour(payload: Omit<HappyHour, 'id' | 'tenant_id' | 'created_at'>) {
  const tenantId = defaultTenant();
  const happyHours = getDB<HappyHour>('happy_hours');

  const newHH: HappyHour = {
    id: uuidv4(),
    tenant_id: tenantId,
    ...payload,
    created_at: new Date().toISOString()
  };

  happyHours.push(newHH);
  setDB('happy_hours', happyHours);

  logEvent('system', 'HAPPY_HOUR_CREATE', { name: newHH.name, discount: newHH.discount_percent, categories: newHH.categories });
  return newHH;
}

export async function create_happy_hour_live(payload: Omit<HappyHour, 'id' | 'tenant_id' | 'created_at'>) {
  if (!isBackendEnabled()) return create_happy_hour(payload);
  return apiRequest<any>('/api/v1/ops/happy-hours', {
    method: 'POST',
    tenantId: null,
    body: payload,
  });
}

export function get_active_happy_hour() {
  const tenantId = defaultTenant();
  const happyHours = getDB<HappyHour>('happy_hours');
  const now = new Date();
  // Gün nömrələnməsi backend ilə eynidir: B.E=1 … Bazar=7
  // (`operations.py:6900` → `now.weekday() + 1`). `getDay()` Bazar üçün 0
  // qaytarır, ona görə çevrilir — əvvəl bu səbəbdən bazar günü heç bir
  // happy hour aktiv görünmürdü.
  const currentDay = now.getDay() === 0 ? 7 : now.getDay();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  for (const hh of happyHours) {
    if (hh.tenant_id !== tenantId || !hh.is_active) continue;

    // Gün yoxlanışı — sətir backend ixracından gəlibsə sahə
    // `days_of_week_json` adlanır.
    const rawDays = Array.isArray(hh.days_of_week)
      ? hh.days_of_week
      : Array.isArray((hh as any).days_of_week_json)
        ? (hh as any).days_of_week_json
        : [];
    const days = rawDays.map((d: any) => (Number(d) === 0 ? 7 : Number(d)));
    if (!days.includes(currentDay)) continue;

    // Saat yoxlanışı
    if (currentTime >= hh.start_time && currentTime <= hh.end_time) {
      return {
        name: hh.name,
        discount_percent: hh.discount_percent,
        categories: hh.categories,
        end_time: hh.end_time
      };
    }
  }

  return null;
}

export async function get_active_happy_hour_live() {
  if (!isBackendEnabled()) return get_active_happy_hour();
  return apiRequest<any>('/api/v1/ops/happy-hours/active', { tenantId: null });
}

export function toggle_happy_hour(happy_hour_id: string, is_active: boolean) {
  const happyHours = getDB<HappyHour>('happy_hours');
  const hh = happyHours.find(h => h.id === happy_hour_id);
  
  if (!hh) throw new Error('Happy Hour tapılmadı');

  hh.is_active = is_active;
  setDB('happy_hours', happyHours);

  const action = is_active ? 'HAPPY_HOUR_ACTIVATE' : 'HAPPY_HOUR_DEACTIVATE';
  logEvent('system', action, { id: happy_hour_id });
  
  return hh;
}

export async function toggle_happy_hour_live(happy_hour_id: string, is_active: boolean) {
  if (!isBackendEnabled()) return toggle_happy_hour(happy_hour_id, is_active);
  await apiRequest(`/api/v1/ops/happy-hours/${encodeURIComponent(happy_hour_id)}`, {
    method: 'PATCH',
    tenantId: null,
    body: { is_active },
  });
  return { success: true };
}

export function delete_happy_hour(happy_hour_id: string) {
  let happyHours = getDB<HappyHour>('happy_hours');
  const hh = happyHours.find(h => h.id === happy_hour_id);
  
  if (!hh) throw new Error('Happy Hour tapılmadı');

  happyHours = happyHours.filter(h => h.id !== happy_hour_id);
  setDB('happy_hours', happyHours);

  logEvent('system', 'HAPPY_HOUR_DELETE', { name: hh.name });
  return { success: true };
}

export async function delete_happy_hour_live(happy_hour_id: string) {
  if (!isBackendEnabled()) return delete_happy_hour(happy_hour_id);
  await apiRequest(`/api/v1/ops/happy-hours/${encodeURIComponent(happy_hour_id)}`, {
    method: 'DELETE',
    tenantId: null,
  });
  return { success: true };
}
