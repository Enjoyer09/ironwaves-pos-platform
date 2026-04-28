import { v4 as uuidv4 } from 'uuid';
import { apiRequest, isBackendEnabled } from './client';
import { getDB, setDB } from '../lib/db_sim';
import { Decimal } from 'decimal.js';
import { PaymentMethod } from '../types/pos';
import { get_tables, pay_table } from './tables';
import { get_settings } from './settings';

export type FloorPlanRecord = {
  id: string;
  name: string;
  width_units: number;
  height_units: number;
  is_active: boolean;
};

export type TableLayoutUpdatePayload = {
  floor_plan_id?: string | null;
  label?: string;
  pos_x?: number;
  pos_y?: number;
  width_units?: number;
  height_units?: number;
  capacity?: number;
  shape?: string;
  status?: string;
};

export type FloorTableState = {
  id: string;
  label: string;
  floor_plan_id?: string | null;
  shape?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number;
  status: string;
  locked_by?: string | null;
  active_session_id?: string | null;
  locked_at?: string | null;
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
    amount_paid?: string;
    balance_due?: string;
    opened_at?: string | null;
    payments?: Array<{
      id: string;
      method: string;
      amount: string;
      status: string;
      split_group?: string | null;
      paid_by?: string | null;
      paid_at?: string | null;
    }>;
  } | null;
  rounds?: Array<{
    id: string;
    round_no: number;
    course_no: number;
    status: string;
    sent_by?: string | null;
    sent_at?: string | null;
    items: Array<{
      id: string;
      item_name: string;
      qty: number;
      price: string;
      seat_no?: number | null;
      course_no?: number;
      status: string;
      status_reason?: string | null;
      action_by?: string | null;
      manager_approved_by?: string | null;
      parent_item_id?: string | null;
      note?: string | null;
      modifier_json?: string | null;
    }>;
  }>;
  draft_items?: Array<{
    id: string;
    item_name: string;
    qty: number;
    price: string;
    seat_no?: number | null;
    course_no?: number;
    status: string;
    status_reason?: string | null;
    note?: string | null;
    modifier_json?: string | null;
  }>;
};

export type TablesBootstrapRecord = {
  tables: any[];
  floor_plans: FloorPlanRecord[];
  floor_state: {
    floor: FloorPlanRecord;
    tables: FloorTableState[];
  };
};

const localReservationKey = 'restaurant_reservations';
const localFloorKey = 'restaurant_floor_plans';

function getLocalReservations(tenant_id: string): ReservationRecord[] {
  return getDB<any>(localReservationKey).filter((row) => row.tenant_id === tenant_id);
}

function saveLocalReservations(rows: any[]) {
  setDB(localReservationKey, rows);
}

function assertLocalReservationSlotAvailable(
  tenant_id: string,
  reservationAt: string,
  durationMinutes: number,
  assignedTableId?: string | null,
  excludeReservationId?: string | null,
) {
  if (!assignedTableId) return;
  const rows = getLocalReservations(tenant_id);
  const nextStart = new Date(reservationAt).getTime();
  const nextEnd = nextStart + (Math.max(15, Number(durationMinutes || 90)) * 60 * 1000);
  const conflict = rows.find((row) => {
    if (excludeReservationId && row.id === excludeReservationId) return false;
    if (String(row.status || '').toUpperCase() !== 'BOOKED') return false;
    if (String(row.assigned_table_id || '') !== String(assignedTableId || '')) return false;
    const rowStart = new Date(row.reservation_at).getTime();
    const rowEnd = rowStart + (Math.max(15, Number(row.duration_minutes || 90)) * 60 * 1000);
    return nextStart < rowEnd && nextEnd > rowStart;
  });
  if (conflict) {
    throw new Error('Table already has a conflicting reservation');
  }
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
    const reservations = getLocalReservations(tenant_id);
    const lockHours = Math.max(0, Number(get_settings(tenant_id).table_service_settings?.reservation_lock_hours ?? 2));
    const lateReleaseMinutes = Math.max(5, Number(get_settings(tenant_id).table_service_settings?.late_release_minutes ?? 15));
    const now = new Date();
    const lockUntil = new Date(now.getTime() + lockHours * 60 * 60 * 1000);
    const lateCutoff = new Date(now.getTime() - lateReleaseMinutes * 60 * 1000);
    const tables = getDB<any>('tables')
      .filter((row) => row.tenant_id === tenant_id)
      .map((row, idx) => {
        const reserved = reservations.find((reservation) => (
          ['BOOKED', 'LATE'].includes(String(reservation.status || '').toUpperCase())
          && reservation.assigned_table_id === row.id
          && (
            (new Date(reservation.reservation_at) >= now && new Date(reservation.reservation_at) <= lockUntil)
            || (String(reservation.status || '').toUpperCase() === 'LATE' && new Date(reservation.reservation_at) >= lateCutoff && new Date(reservation.reservation_at) <= now)
          )
        ));
        return {
          id: row.id,
          label: row.label,
          floor_plan_id: floor.id,
          shape: row.shape || 'rectangle',
          x: (idx % 4) * 3,
          y: Math.floor(idx / 4) * 3,
          w: 2,
          h: 2,
          capacity: Number(row.guest_count || 4) || 4,
          status: row.is_occupied ? (Number(row.total || 0) > 0 ? 'ACTIVE_CHECK' : 'SEATED') : (reserved ? 'RESERVED' : 'AVAILABLE'),
          locked_by: row.locked_by || row.assigned_to || null,
          active_session_id: row.active_session_id || null,
          locked_at: row.locked_at || null,
          guest_count: row.guest_count || 0,
          assigned_waiter: row.assigned_to || null,
          minutes_seated: null,
          check_total: row.total || '0',
          reservation: reserved ? { id: reserved.id, party_size: reserved.party_size, reservation_at: reserved.reservation_at } : null,
        };
      });
    return { floor, tables };
  }
  return apiRequest<{ floor: FloorPlanRecord; tables: FloorTableState[] }>(`/api/v1/restaurant/floor-plans/${encodeURIComponent(floorId)}/state`, { tenantId: null });
}

export async function get_tables_bootstrap_live(tenant_id: string): Promise<TablesBootstrapRecord> {
  if (!isBackendEnabled()) {
    const floorPlans = getLocalFloorPlans(tenant_id);
    const activeFloor = floorPlans.find((row) => row.is_active) || floorPlans[0];
    const floorState = await get_floor_state_live(tenant_id, activeFloor.id);
    return {
      tables: get_tables(tenant_id),
      floor_plans: floorPlans,
      floor_state: floorState,
    };
  }
  return apiRequest<TablesBootstrapRecord>('/api/v1/restaurant/tables-bootstrap', {
    tenantId: null,
    timeoutMs: 5000,
    retryCount: 0,
  });
}

export async function update_table_layout_live(tableId: string, payload: TableLayoutUpdatePayload) {
  if (!isBackendEnabled()) {
    const tables = getDB<any>('tables');
    const idx = tables.findIndex((row) => row.id === tableId);
    if (idx < 0) throw new Error('Table not found');
    if (payload.label !== undefined) {
      const nextLabel = String(payload.label || '').trim();
      if (!nextLabel) throw new Error('Masa adı boş ola bilməz');
      const duplicate = tables.find((row) => (
        row.id !== tableId
        && String(row.tenant_id || '') === String(tables[idx].tenant_id || '')
        && String(row.label || '').trim().toLowerCase() === nextLabel.toLowerCase()
      ));
      if (duplicate) throw new Error('Eyni adlı masa artıq mövcuddur');
    }
    const nextStatus = payload.status ?? tables[idx].status ?? 'AVAILABLE';
    tables[idx] = {
      ...tables[idx],
      label: payload.label !== undefined ? String(payload.label || '').trim() : tables[idx].label,
      floor_plan_id: payload.floor_plan_id ?? tables[idx].floor_plan_id,
      pos_x: payload.pos_x ?? tables[idx].pos_x ?? 0,
      pos_y: payload.pos_y ?? tables[idx].pos_y ?? 0,
      width_units: payload.width_units ?? tables[idx].width_units ?? 2,
      height_units: payload.height_units ?? tables[idx].height_units ?? 2,
      capacity: payload.capacity ?? tables[idx].capacity ?? 4,
      shape: payload.shape ?? tables[idx].shape ?? 'rectangle',
      status: nextStatus,
    };
    if (String(nextStatus).toUpperCase() === 'AVAILABLE') {
      tables[idx] = {
        ...tables[idx],
        is_occupied: false,
        guest_count: 0,
        deposit_guest_count: 0,
        deposit_amount: '0.00',
        deposit_seats_json: '[]',
        items: [],
        items_json: '[]',
        total: '0.00',
        assigned_to: null,
        locked_by: null,
        active_session_id: null,
        locked_at: null,
      };
    }
    setDB('tables', tables);
    return { ok: true, table: tables[idx] };
  }
  return apiRequest(`/api/v1/restaurant/tables/${encodeURIComponent(tableId)}/layout`, {
    method: 'PATCH',
    tenantId: null,
    body: payload,
  });
}

export async function combine_tables_live(tableId: string, targetTableId: string) {
  if (!isBackendEnabled()) {
    const tables = getDB<any>('tables');
    const source = tables.find((row) => row.id === tableId);
    const target = tables.find((row) => row.id === targetTableId);
    if (!source || !target) throw new Error('Table not found');
    const mergedGroupId = source.merged_group_id || target.merged_group_id || uuidv4();
    source.merged_group_id = mergedGroupId;
    target.merged_group_id = mergedGroupId;
    setDB('tables', tables);
    return { ok: true, merged_group_id: mergedGroupId };
  }
  return apiRequest(`/api/v1/restaurant/tables/${encodeURIComponent(tableId)}/combine`, {
    method: 'POST',
    tenantId: null,
    body: { target_table_id: targetTableId },
  });
}

export async function split_table_group_live(tableId: string, mergedGroupId?: string | null) {
  if (!isBackendEnabled()) {
    const tables = getDB<any>('tables').map((row) => (
      mergedGroupId && row.merged_group_id === mergedGroupId
        ? { ...row, merged_group_id: null }
        : row.id === tableId
          ? { ...row, merged_group_id: null }
          : row
    ));
    setDB('tables', tables);
    return { ok: true };
  }
  return apiRequest(`/api/v1/restaurant/tables/${encodeURIComponent(tableId)}/split`, {
    method: 'POST',
    tenantId: null,
    body: { merged_group_id: mergedGroupId || null },
  });
}

export async function unlock_table_live(tableId: string, reason?: string) {
  if (!isBackendEnabled()) {
    const tables = getDB<any>('tables');
    const idx = tables.findIndex((row) => row.id === tableId);
    if (idx < 0) throw new Error('Table not found');
    tables[idx] = { ...tables[idx], assigned_to: null, locked_by: null, locked_at: null, active_session_id: null };
    setDB('tables', tables);
    return { ok: true };
  }
  return apiRequest(`/api/v1/restaurant/tables/${encodeURIComponent(tableId)}/unlock`, {
    method: 'POST',
    tenantId: null,
    body: { reason: reason || '' },
  });
}

export async function transfer_table_lock_live(tableId: string, newOwner: string, reason?: string) {
  if (!isBackendEnabled()) {
    const tables = getDB<any>('tables');
    const idx = tables.findIndex((row) => row.id === tableId);
    if (idx < 0) throw new Error('Table not found');
    tables[idx] = { ...tables[idx], assigned_to: newOwner, locked_by: newOwner, locked_at: new Date().toISOString() };
    setDB('tables', tables);
    return { ok: true, new_owner: newOwner };
  }
  return apiRequest(`/api/v1/restaurant/tables/${encodeURIComponent(tableId)}/transfer-lock`, {
    method: 'POST',
    tenantId: null,
    body: { new_owner: newOwner, reason: reason || '' },
  });
}

export async function act_on_order_item_live(
  itemId: string,
  payload: {
    action: string;
    reason?: string | null;
    reason_code?: string | null;
    quantity_delta?: number | null;
    note?: string | null;
    modifier_json?: string | null;
    manager_password?: string | null;
    remake_note?: string | null;
  },
) {
  if (!isBackendEnabled()) {
    return { ok: true, item_id: itemId, status: payload.action };
  }
  return apiRequest(`/api/v1/restaurant/order-items/${encodeURIComponent(itemId)}/action`, {
    method: 'POST',
    tenantId: null,
    body: payload,
  });
}

export async function add_check_draft_item_live(
  checkId: string,
  payload: { id?: string; item_name: string; price: string; qty: number; category?: string; is_coffee?: boolean; seat_no?: number | null; course_no?: number; note?: string | null; modifier_json?: string | null },
) {
  if (!isBackendEnabled()) {
    return { ok: true, item_id: uuidv4(), status: 'DRAFT' };
  }
  return apiRequest(`/api/v1/restaurant/checks/${encodeURIComponent(checkId)}/draft-items`, {
    method: 'POST',
    tenantId: null,
    body: payload,
  });
}

export async function send_check_drafts_live(
  checkId: string,
  payload: { sent_by?: string; course_no?: number } = {},
) {
  if (!isBackendEnabled()) {
    return { ok: true, round_id: uuidv4(), round_no: 1, sent_count: 0, check_total: '0.00' };
  }
  return apiRequest(`/api/v1/restaurant/checks/${encodeURIComponent(checkId)}/send`, {
    method: 'POST',
    tenantId: null,
    body: payload,
  });
}

export async function update_draft_item_live(itemId: string, payload: { qty?: number; note?: string | null; modifier_json?: string | null }) {
  if (!isBackendEnabled()) {
    return { ok: true, item_id: itemId, status: 'DRAFT', qty: payload.qty || 1 };
  }
  return apiRequest(`/api/v1/restaurant/order-items/${encodeURIComponent(itemId)}/draft`, {
    method: 'PATCH',
    tenantId: null,
    body: payload,
  });
}

export async function delete_draft_item_live(itemId: string) {
  if (!isBackendEnabled()) {
    return { ok: true, item_id: itemId, status: 'VOIDED' };
  }
  return apiRequest(`/api/v1/restaurant/order-items/${encodeURIComponent(itemId)}/draft`, {
    method: 'DELETE',
    tenantId: null,
  });
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
      draft_items: [],
    };
  }
  return apiRequest<TableDetailRecord>(`/api/v1/restaurant/tables/${encodeURIComponent(tableId)}/detail`, { tenantId: null });
}

export async function send_table_round_live(
  tableId: string,
  payload: {
    items: Array<{ id?: string; item_name: string; price: string; qty: number; category?: string; is_coffee?: boolean; seat_no?: number | null; course_no?: number; note?: string; modifier_json?: string }>;
    sent_by?: string;
    course_no?: number;
  }
) {
  if (!isBackendEnabled()) {
    return { ok: true, round_id: uuidv4(), round_no: 1, check_total: '0.00' };
  }
  return apiRequest(`/api/v1/restaurant/tables/${encodeURIComponent(tableId)}/send-round`, {
    method: 'POST',
    tenantId: null,
    body: payload,
  });
}

export async function get_kitchen_feed_live(tenant_id: string) {
  if (!isBackendEnabled()) return [];
  return apiRequest<any[]>('/api/v1/restaurant/kitchen-feed', { tenantId: null });
}

export async function accept_kitchen_round_live(roundId: string) {
  if (!isBackendEnabled()) return { success: true };
  return apiRequest(`/api/v1/restaurant/kitchen-feed/${encodeURIComponent(roundId)}/accept`, {
    method: 'POST',
    tenantId: null,
    body: {},
  });
}

export async function complete_kitchen_round_live(roundId: string, ready_items: string[] = []) {
  if (!isBackendEnabled()) return { success: true };
  return apiRequest(`/api/v1/restaurant/kitchen-feed/${encodeURIComponent(roundId)}/complete`, {
    method: 'POST',
    tenantId: null,
    body: { ready_items },
  });
}

export async function start_kitchen_item_live(itemId: string) {
  if (!isBackendEnabled()) return { success: true, item_id: itemId, new_status: 'PREPARING' };
  return apiRequest(`/api/v1/restaurant/kitchen/items/${encodeURIComponent(itemId)}/start`, {
    method: 'POST',
    tenantId: null,
  });
}

export async function ready_kitchen_item_live(itemId: string) {
  if (!isBackendEnabled()) return { success: true, item_id: itemId, new_status: 'READY' };
  return apiRequest(`/api/v1/restaurant/kitchen/items/${encodeURIComponent(itemId)}/ready`, {
    method: 'POST',
    tenantId: null,
  });
}

export async function serve_kitchen_item_live(itemId: string) {
  if (!isBackendEnabled()) return { success: true, item_id: itemId, new_status: 'SERVED' };
  return apiRequest(`/api/v1/restaurant/kitchen/items/${encodeURIComponent(itemId)}/serve`, {
    method: 'POST',
    tenantId: null,
  });
}

export async function get_order_item_status_logs_live(itemId: string) {
  if (!isBackendEnabled()) return [];
  return apiRequest<Array<{
    id: string;
    order_item_id: string;
    old_status?: string | null;
    new_status: string;
    changed_by?: string | null;
    reason?: string | null;
    changed_at?: string | null;
  }>>(`/api/v1/restaurant/order-items/${encodeURIComponent(itemId)}/status-logs`, {
    tenantId: null,
  });
}

export async function settle_table_check_live(
  tableId: string,
  payload: {
    payment_method: PaymentMethod;
    split_cash?: Decimal | null;
    split_card?: Decimal | null;
    parts?: Array<{ method: 'Nəğd' | 'Kart'; amount: string }>;
  },
) {
  if (!isBackendEnabled()) {
    return pay_table(
      tableId,
      payload.payment_method,
      'staff',
      payload.split_cash || null,
      payload.split_card || null,
      { pay_scope: 'full' },
    );
  }
  return apiRequest(`/api/v1/restaurant/tables/${encodeURIComponent(tableId)}/settle-check`, {
    method: 'POST',
    tenantId: null,
    body: {
      payment_method: payload.payment_method,
      split_cash: payload.split_cash ? payload.split_cash.toFixed(2) : null,
      split_card: payload.split_card ? payload.split_card.toFixed(2) : null,
      parts: (payload.parts || []).map((row) => ({
        method: row.method,
        amount: row.amount,
      })),
    },
  });
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
    status?: string | null;
  },
) {
  if (!isBackendEnabled()) {
    const nextStatus = String(payload.status || 'BOOKED').toUpperCase();
    const assignedTableId = nextStatus === 'WAITLIST' ? null : (payload.assigned_table_id || null);
    assertLocalReservationSlotAvailable(
      tenant_id,
      payload.reservation_at,
      payload.duration_minutes || 90,
      assignedTableId,
      null,
    );
    const rows = getDB<any>(localReservationKey);
    const created = {
      id: uuidv4(),
      tenant_id,
      reservation_at: payload.reservation_at,
      duration_minutes: payload.duration_minutes || 90,
      party_size: payload.party_size || 2,
      status: nextStatus,
      special_note: payload.special_note || '',
      assigned_table_id: assignedTableId,
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
      const current = rows[idx];
      const nextStatus = String(payload.status ?? current.status ?? 'BOOKED').toUpperCase();
      const nextAssignedTableId =
        nextStatus === 'WAITLIST'
          ? null
          : (payload.assigned_table_id !== undefined ? payload.assigned_table_id : current.assigned_table_id);
      assertLocalReservationSlotAvailable(
        current.tenant_id,
        payload.reservation_at ?? current.reservation_at,
        payload.duration_minutes ?? current.duration_minutes ?? 90,
        nextAssignedTableId,
        reservationId,
      );
      rows[idx] = { ...rows[idx], ...payload, status: nextStatus, assigned_table_id: nextAssignedTableId };
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
