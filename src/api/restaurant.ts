import { v4 as uuidv4 } from 'uuid';
import { apiRequest, isBackendEnabled } from './client';
import { getDB, setDB } from '../lib/db_sim';

export type FloorPlanRecord = {
  id: string;
  name: string;
  width_units: number;
  height_units: number;
  is_active: boolean;
};

export type FloorTableState = {
  id: string;
  label: string;
  floor_plan_id?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number;
  status: string;
  guest_count?: number;
  assigned_waiter?: string | null;
  minutes_seated?: number | null;
  check_total?: string;
  session_id?: string | null;
  check_id?: string | null;
  reservation?: { id: string; party_size: number; reservation_at: string } | null;
};

export type ReservationRecord = {
  id: string;
  reservation_at: string;
  duration_minutes: number;
  party_size: number;
  status: string;
  special_note?: string | null;
  assigned_table_id?: string | null;
  guest?: {
    id?: string;
    full_name: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
  } | null;
};

export type TableDetailRecord = {
  table: FloorTableState;
  session: {
    id: string;
    status: string;
    guest_count: number;
    assigned_waiter?: string | null;
    seated_at?: string | null;
    reservation_id?: string | null;
  } | null;
  check: {
    id: string;
    check_number: string;
    status: string;
    guest_count: number;
    subtotal: string;
    service_charge: string;
    tax_amount: string;
    total: string;
    opened_at?: string | null;
  } | null;
};

const localReservationKey = 'restaurant_reservations';
const localFloorKey = 'restaurant_floor_plans';

function getLocalReservations(tenant_id: string): ReservationRecord[] {
  return getDB<any>(localReservationKey).filter((row) => row.tenant_id === tenant_id);
}

function saveLocalReservations(rows: any[]) {
  setDB(localReservationKey, rows);
}

function getLocalFloorPlans(tenant_id: string): FloorPlanRecord[] {
  const existing = getDB<any>(localFloorKey).filter((row) => row.tenant_id === tenant_id);
  if (existing.length > 0) return existing;
  const seed = [{ id: `floor_${tenant_id}`, tenant_id, name: 'Main Floor', width_units: 12, height_units: 8, is_active: true }];
  setDB(localFloorKey, [...getDB<any>(localFloorKey), ...seed]);
  return seed;
}

export async function get_floor_plans_live(tenant_id: string): Promise<FloorPlanRecord[]> {
  if (!isBackendEnabled()) return getLocalFloorPlans(tenant_id);
  return apiRequest<FloorPlanRecord[]>('/api/v1/restaurant/floor-plans', { tenantId: null });
}

export async function get_floor_state_live(tenant_id: string, floorId: string): Promise<{ floor: FloorPlanRecord; tables: FloorTableState[] }> {
  if (!isBackendEnabled()) {
    const floor = getLocalFloorPlans(tenant_id).find((row) => row.id === floorId) || getLocalFloorPlans(tenant_id)[0];
    const tables = getDB<any>('tables')
      .filter((row) => row.tenant_id === tenant_id)
      .map((row, idx) => ({
        id: row.id,
        label: row.label,
        floor_plan_id: floor.id,
        x: (idx % 4) * 3,
        y: Math.floor(idx / 4) * 3,
        w: 2,
        h: 2,
        capacity: Number(row.guest_count || 4) || 4,
        status: row.is_occupied ? (Number(row.total || 0) > 0 ? 'ACTIVE_CHECK' : 'SEATED') : 'AVAILABLE',
        guest_count: row.guest_count || 0,
        assigned_waiter: row.assigned_to || null,
        minutes_seated: null,
        check_total: row.total || '0',
      }));
    return { floor, tables };
  }
  return apiRequest<{ floor: FloorPlanRecord; tables: FloorTableState[] }>(`/api/v1/restaurant/floor-plans/${encodeURIComponent(floorId)}/state`, { tenantId: null });
}

export async function get_table_detail_live(tenant_id: string, tableId: string): Promise<TableDetailRecord | null> {
  if (!isBackendEnabled()) {
    const row = getDB<any>('tables').find((table) => table.tenant_id === tenant_id && table.id === tableId);
    if (!row) return null;
    return {
      table: {
        id: row.id,
        label: row.label,
        x: 0,
        y: 0,
        w: 2,
        h: 2,
        capacity: Number(row.guest_count || 4),
        status: row.is_occupied ? 'ACTIVE_CHECK' : 'AVAILABLE',
        guest_count: Number(row.guest_count || 0),
        assigned_waiter: row.assigned_to || null,
        check_total: row.total || '0',
      },
      session: row.is_occupied ? {
        id: `local_session_${row.id}`,
        status: 'SEATED',
        guest_count: Number(row.guest_count || 0),
        assigned_waiter: row.assigned_to || null,
        seated_at: null,
      } : null,
      check: row.is_occupied ? {
        id: `local_check_${row.id}`,
        check_number: `CHK-${String(row.label || '').replace(/\s+/g, '')}`,
        status: 'OPEN',
        guest_count: Number(row.guest_count || 0),
        subtotal: row.total || '0',
        service_charge: '0',
        tax_amount: '0',
        total: row.total || '0',
      } : null,
    };
  }
  return apiRequest<TableDetailRecord>(`/api/v1/restaurant/tables/${encodeURIComponent(tableId)}/detail`, { tenantId: null });
}

export async function get_reservations_live(tenant_id: string, date: string): Promise<ReservationRecord[]> {
  if (!isBackendEnabled()) {
    return getLocalReservations(tenant_id).filter((row) => String(row.reservation_at || '').startsWith(date)).sort((a, b) => a.reservation_at.localeCompare(b.reservation_at));
  }
  return apiRequest<ReservationRecord[]>(`/api/v1/restaurant/reservations?date=${encodeURIComponent(date)}`, { tenantId: null });
}

export async function create_reservation_live(
  tenant_id: string,
  payload: {
    guest_name: string;
    phone?: string;
    email?: string;
    reservation_at: string;
    duration_minutes?: number;
    party_size?: number;
    special_note?: string;
    assigned_table_id?: string | null;
  },
) {
  if (!isBackendEnabled()) {
    const rows = getDB<any>(localReservationKey);
    const created = {
      id: uuidv4(),
      tenant_id,
      reservation_at: payload.reservation_at,
      duration_minutes: payload.duration_minutes || 90,
      party_size: payload.party_size || 2,
      status: 'BOOKED',
      special_note: payload.special_note || '',
      assigned_table_id: payload.assigned_table_id || null,
      guest: { full_name: payload.guest_name, phone: payload.phone || '', email: payload.email || '' },
    };
    rows.push(created);
    saveLocalReservations(rows);
    return created;
  }
  return apiRequest('/api/v1/restaurant/reservations', {
    method: 'POST',
    tenantId: null,
    body: payload,
  });
}

export async function update_reservation_live(reservationId: string, payload: Record<string, any>) {
  if (!isBackendEnabled()) {
    const rows = getDB<any>(localReservationKey);
    const idx = rows.findIndex((row) => row.id === reservationId);
    if (idx >= 0) {
      rows[idx] = { ...rows[idx], ...payload };
      saveLocalReservations(rows);
      return rows[idx];
    }
    throw new Error('Reservation not found');
  }
  return apiRequest(`/api/v1/restaurant/reservations/${encodeURIComponent(reservationId)}`, {
    method: 'PATCH',
    tenantId: null,
    body: payload,
  });
}

export async function delete_reservation_live(reservationId: string) {
  if (!isBackendEnabled()) {
    const rows = getDB<any>(localReservationKey).map((row) => row.id === reservationId ? { ...row, status: 'CANCELLED' } : row);
    saveLocalReservations(rows);
    return { ok: true };
  }
  return apiRequest(`/api/v1/restaurant/reservations/${encodeURIComponent(reservationId)}`, {
    method: 'DELETE',
    tenantId: null,
  });
}

export async function seat_reservation_live(reservationId: string, payload: { table_id: string; guest_count?: number; assigned_waiter?: string }) {
  if (!isBackendEnabled()) {
    const reservations = getDB<any>(localReservationKey);
    const reservation = reservations.find((row) => row.id === reservationId);
    if (!reservation) throw new Error('Reservation not found');
    reservation.status = 'SEATED';
    reservation.assigned_table_id = payload.table_id;
    saveLocalReservations(reservations);
    return { ok: true };
  }
  return apiRequest(`/api/v1/restaurant/reservations/${encodeURIComponent(reservationId)}/seat`, {
    method: 'POST',
    tenantId: null,
    body: payload,
  });
}
