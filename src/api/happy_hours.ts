import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { HappyHour } from '../types/pos';
import { getActiveTenantId } from '../lib/tenant';

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

export function get_active_happy_hour() {
  const tenantId = defaultTenant();
  const happyHours = getDB<HappyHour>('happy_hours');
  const now = new Date();
  const currentDay = now.getDay(); // 0-6 (Bazar - Şənbə)
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  for (const hh of happyHours) {
    if (hh.tenant_id !== tenantId || !hh.is_active) continue;
    
    // Gün yoxlanışı
    if (!hh.days_of_week.includes(currentDay)) continue;

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

export function delete_happy_hour(happy_hour_id: string) {
  let happyHours = getDB<HappyHour>('happy_hours');
  const hh = happyHours.find(h => h.id === happy_hour_id);
  
  if (!hh) throw new Error('Happy Hour tapılmadı');

  happyHours = happyHours.filter(h => h.id !== happy_hour_id);
  setDB('happy_hours', happyHours);

  logEvent('system', 'HAPPY_HOUR_DELETE', { name: hh.name });
  return { success: true };
}
