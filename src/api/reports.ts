import { Decimal } from 'decimal.js';
import { logEvent } from '../lib/logger';
import { FinanceEntry } from '../types/pos';
import { v4 as uuidv4 } from 'uuid';
import { send_email } from './email';
import { apiRequest, isBackendEnabled } from './client';

import { getDB, setDB } from '../lib/db_sim';

const tenantKey = (tenant_id: string, suffix: string) => `${tenant_id}_${suffix}`;

const getTenantRows = <T extends { tenant_id?: string }>(tenant_id: string, globalKey: string, suffix: string): T[] => {
  const scoped = getDB<T>(tenantKey(tenant_id, suffix));
  if (scoped.length > 0) {
    return scoped.map((row) => ({ ...row, tenant_id }));
  }
  return getDB<T>(globalKey).filter((row) => row.tenant_id === tenant_id);
};

const saveTenantRows = <T extends { tenant_id?: string }>(tenant_id: string, globalKey: string, suffix: string, rows: T[]) => {
  const safeRows = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, tenant_id }));
  const all = getDB<T>(globalKey);
  const kept = all.filter((row) => row.tenant_id !== tenant_id);
  setDB(globalKey, [...kept, ...safeRows]);
  setDB(tenantKey(tenant_id, suffix), safeRows);
};

const getFinanceRows = (tenant_id: string) => getTenantRows<FinanceEntry>(tenant_id, 'finance', 'finance');
const saveFinanceRows = (tenant_id: string, rows: FinanceEntry[]) => saveTenantRows<FinanceEntry>(tenant_id, 'finance', 'finance', rows);

type ShiftFundingSource = 'cash' | 'safe' | 'card' | 'investor';

type OpenShiftOptions = {
  opening_cash?: string;
  funding_source?: ShiftFundingSource;
  target_cash?: string;
  topup_amount?: string;
};

export type StaffNotification = {
  id: string;
  tenant_id: string;
  username: string;
  title: string;
  message: string;
  meta?: Record<string, any>;
  read: boolean;
  created_at: string;
};

type ShiftHandoverRow = {
  id: string;
  tenant_id: string;
  handed_by: string;
  received_by: string;
  declared_cash: string;
  actual_cash?: string;
  difference?: string;
  status: 'PENDING' | 'ACCEPTED';
  created_at: string;
  accepted_at?: string;
};

type HandoverUserRow = {
  id: string;
  tenant_id: string;
  username: string;
  role: string;
};

export type YieldBatchRow = {
  id: string;
  inventory_name: string;
  meat_type: 'beef' | 'chicken';
  opened_by: string;
  opened_at?: string | null;
  raw_weight_kg: string;
  raw_to_ready_ratio: string;
  expected_ready_weight_kg: string;
  sold_ready_weight_kg: string;
  deducted_raw_weight_kg: string;
  notes?: string | null;
};

export type YieldWasteLogRow = {
  id: string;
  batch_id: string;
  inventory_name: string;
  meat_type: 'beef' | 'chicken';
  expected_raw_consumption_kg: string;
  actual_raw_consumption_kg: string;
  variance_percent: string;
  tolerance_percent: string;
  flagged: boolean;
  reason: string;
  notes?: string | null;
  created_by: string;
  created_at?: string | null;
};

const pushStaffNotification = (
  tenant_id: string,
  username: string,
  title: string,
  message: string,
  meta?: Record<string, string>,
) => {
  const rows = getTenantRows<StaffNotification>(tenant_id, 'staff_notifications', 'staff_notifications');
  rows.push({
    id: uuidv4(),
    tenant_id,
    username,
    title,
    message,
    meta,
    read: false,
    created_at: new Date().toISOString(),
  });
  saveTenantRows(tenant_id, 'staff_notifications', 'staff_notifications', rows);
};

export const get_unread_staff_notifications = (tenant_id: string, username: string) => {
  const rows = getTenantRows<StaffNotification>(tenant_id, 'staff_notifications', 'staff_notifications');
  return rows
    .filter((r) => r.tenant_id === tenant_id && r.username === username && !r.read)
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
};

export const mark_staff_notifications_read = (tenant_id: string, username: string) => {
  const rows = getTenantRows<StaffNotification>(tenant_id, 'staff_notifications', 'staff_notifications');
  const next = rows.map((r) => {
    if (r.tenant_id === tenant_id && r.username === username && !r.read) {
      return { ...r, read: true };
    }
    return r;
  });
  saveTenantRows(tenant_id, 'staff_notifications', 'staff_notifications', next);
};

export const get_unread_staff_notifications_live = async (tenant_id: string, username: string) => {
  if (!isBackendEnabled()) return get_unread_staff_notifications(tenant_id, username);
  return apiRequest<StaffNotification[]>('/api/v1/ops/staff-notifications/unread', {
    method: 'GET',
    tenantId: null,
  });
};

export const mark_staff_notifications_read_live = async (tenant_id: string, username: string) => {
  if (!isBackendEnabled()) return mark_staff_notifications_read(tenant_id, username);
  return apiRequest<{ success: boolean; count: number }>('/api/v1/ops/staff-notifications/read', {
    method: 'POST',
    tenantId: null,
    body: {},
  });
};

export const mark_staff_notification_read_live = async (notification_id: string) => {
  if (!isBackendEnabled()) return { success: true };
  return apiRequest<{ success: boolean }>(`/api/v1/ops/staff-notifications/${encodeURIComponent(notification_id)}/read`, {
    method: 'POST',
    tenantId: null,
    body: {},
  });
};

export const get_shift_handover_history = (tenant_id: string, username?: string) => {
  const rows = getTenantRows<ShiftHandoverRow>(tenant_id, 'shift_handovers', 'shift_handovers');
  const filtered = username
    ? rows.filter((r) => r.handed_by === username || r.received_by === username)
    : rows;
  return filtered.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
};

export const get_shift_handover_history_live = async (tenant_id: string, username?: string) => {
  if (!isBackendEnabled()) return get_shift_handover_history(tenant_id, username);
  const rows = await apiRequest<ShiftHandoverRow[]>('/api/v1/reports/handovers', {
    method: 'GET',
    tenantId: tenant_id,
  });
  const filtered = username ? rows.filter((r) => r.handed_by === username || r.received_by === username) : rows;
  return filtered.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
};

export const get_pending_handover_for_user = (tenant_id: string, username: string) => {
  const rows = getTenantRows<ShiftHandoverRow>(tenant_id, 'shift_handovers', 'shift_handovers').filter(
    (r) => r.tenant_id === tenant_id && r.received_by === username && r.status === 'PENDING',
  );
  return rows.sort((a, b) => (a.created_at > b.created_at ? -1 : 1))[0] || null;
};

export const get_pending_handover_for_user_live = async (tenant_id: string, username: string) => {
  const rows = await get_shift_handover_history_live(tenant_id, username);
  return rows.find((r) => r.received_by === username && r.status === 'PENDING') || null;
};

export const get_shift_handover_users = (tenant_id: string) => {
  return getDB<any>('users')
    .filter((u) => u.tenant_id === tenant_id && ['admin', 'manager', 'staff'].includes(String(u.role || '').toLowerCase()))
    .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));
};

export const get_shift_handover_users_live = async (tenant_id: string) => {
  if (!isBackendEnabled()) return get_shift_handover_users(tenant_id);
  return apiRequest<HandoverUserRow[]>('/api/v1/reports/handover-users', {
    method: 'GET',
    tenantId: tenant_id,
  });
};

export const get_active_doner_batches_live = async (tenant_id: string) => {
  if (!isBackendEnabled()) return [];
  return apiRequest<YieldBatchRow[]>('/api/v1/ops/yield/batches/active', {
    method: 'GET',
    tenantId: null,
  });
};

export const open_doner_batch_live = async (
  payload: {
    inventory_name: string;
    meat_type: 'beef' | 'chicken';
    raw_weight_kg: string;
    raw_to_ready_ratio?: string;
    notes?: string;
  },
) => {
  if (!isBackendEnabled()) throw new Error('Backend is required');
  return apiRequest<{ success: boolean; id: string; expected_ready_weight_kg: string }>('/api/v1/ops/yield/batches/open', {
    method: 'POST',
    tenantId: null,
    body: {
      inventory_name: payload.inventory_name,
      meat_type: payload.meat_type,
      raw_weight_kg: payload.raw_weight_kg,
      raw_to_ready_ratio: payload.raw_to_ready_ratio ? Number(payload.raw_to_ready_ratio) : undefined,
      notes: payload.notes || '',
    },
  });
};

export const close_doner_batch_live = async (
  batch_id: string,
  payload: {
    actual_remaining_raw_weight_kg: string;
    notes?: string;
  },
) => {
  if (!isBackendEnabled()) throw new Error('Backend is required');
  return apiRequest<{
    success: boolean;
    flagged: boolean;
    reason: string;
    variance_percent: string;
    expected_raw_consumption_kg: string;
    actual_raw_consumption_kg: string;
  }>(`/api/v1/ops/yield/batches/${encodeURIComponent(batch_id)}/close`, {
    method: 'POST',
    tenantId: null,
    body: {
      actual_remaining_raw_weight_kg: Number(payload.actual_remaining_raw_weight_kg || 0),
      notes: payload.notes || '',
    },
  });
};

export const get_yield_waste_logs_live = async (tenant_id: string) => {
  if (!isBackendEnabled()) return [];
  return apiRequest<YieldWasteLogRow[]>('/api/v1/ops/yield/waste-logs', {
    method: 'GET',
    tenantId: null,
  });
};

const getBusinessProfile = (tenant_id: string) => {
  const profiles = getDB<any>('business_profile');
  return profiles.find((p) => p.tenant_id === tenant_id) || null;
};

const getShiftState = (tenant_id: string) => {
  const rows = getTenantRows<any>(tenant_id, 'shift_state', 'shift_state');
  return rows.find((r) => r.tenant_id === tenant_id) || null;
};

const shiftStatusCache: Record<
  string,
  {
    status: string;
    opened_by?: string;
    timestamp?: string;
    opening_cash?: string;
    staff_shift_required?: boolean;
    staff_sessions_count?: number;
    staff_session_open?: boolean;
    staff_session_opened_at?: string | null;
  }
> = {};
const expectedCashCache: Record<string, Decimal> = {};

const saveShiftState = (tenant_id: string, payload: any) => {
  saveTenantRows(tenant_id, 'shift_state', 'shift_state', [payload]);
};

// FUNKSIYA: open_shift
export const open_shift = async (
  opened_by: string,
  tenant_id: string,
  options: string | OpenShiftOptions = '0',
) => {
  const normalizedOptions: OpenShiftOptions =
    typeof options === 'string'
      ? { opening_cash: options }
      : (options || {});
  const fundingSource = (normalizedOptions.funding_source || 'cash') as ShiftFundingSource;
  const targetCash = new Decimal(normalizedOptions.target_cash || normalizedOptions.opening_cash || '0');
  const topupAmount = new Decimal(normalizedOptions.topup_amount || '0');

  if (isBackendEnabled()) {
    const res = await apiRequest<any>('/api/v1/reports/open-shift', {
      method: 'POST',
      tenantId: tenant_id,
      body: {
        opening_cash: normalizedOptions.opening_cash || targetCash.toFixed(2),
        funding_source: fundingSource,
        target_cash: targetCash.toFixed(2),
        topup_amount: topupAmount.toFixed(2),
      },
    });
    const actualOpeningCash = String(res?.opening_cash ?? normalizedOptions.opening_cash ?? targetCash.toFixed(2));
    const next = {
      id: String(res?.shift_id || uuidv4()),
      tenant_id,
      opened_by,
      status: 'Open',
      timestamp: new Date().toISOString(),
      opening_cash: actualOpeningCash,
      opening_source: fundingSource,
      opening_target_cash: targetCash.toFixed(2),
      opening_topup_amount: topupAmount.toFixed(2),
    };
    saveShiftState(tenant_id, next);
    shiftStatusCache[tenant_id] = {
      status: 'Open',
      opened_by: String(res?.opened_by || opened_by),
      timestamp: next.timestamp,
      opening_cash: actualOpeningCash,
      staff_shift_required: true,
      staff_sessions_count: Number(res?.staff_sessions_count || 1),
      staff_session_open: Boolean(res?.staff_session_open ?? true),
      staff_session_opened_at: res?.staff_session_opened_at || new Date().toISOString(),
    };
    logEvent(opened_by, 'SHIFT_OPENED', { tenant_id, backend: true, funding_source: fundingSource, topup_amount: topupAmount.toFixed(2) });
    return next;
  }
  const current_shift = getShiftState(tenant_id);
  if (current_shift && current_shift.status === 'Open') {
    throw new Error('Açıq növbə mövcuddur!');
  }

  const financeRows = getFinanceRows(tenant_id);
  const now = new Date().toISOString();
  const currentCash = financeRows.reduce((sum, row) => {
    if (row.source !== 'cash') return sum;
    const amount = new Decimal(row.amount || 0);
    return row.type === 'in' ? sum.plus(amount) : sum.minus(amount);
  }, new Decimal(0));

  if (topupAmount.gt(0)) {
    if (fundingSource === 'investor') {
      financeRows.push(
        {
          id: uuidv4(),
          tenant_id,
          type: 'in',
          category: 'Təsisçi İnvestisiyası',
          amount: topupAmount.toString(),
          source: 'cash',
          description: `Gün açılışı tamamlanması (${targetCash.toFixed(2)} ₼ hədəf). Mənbə: investor`,
          created_at: now,
          is_deleted: false,
        },
        {
          id: uuidv4(),
          tenant_id,
          type: 'in',
          category: 'İnvestor Borcu',
          amount: topupAmount.toString(),
          source: 'investor',
          description: `Auto liability mirror: Gün açılışı tamamlanması (${targetCash.toFixed(2)} ₼ hədəf). Mənbə: investor`,
          created_at: now,
          is_deleted: false,
        },
      );
    } else if (fundingSource === 'cash') {
      financeRows.push({
        id: uuidv4(),
        tenant_id,
        type: 'in',
        category: 'Kassa Açılışı',
        amount: topupAmount.toString(),
        source: 'cash',
        description: `Gün açılışı tamamlanması (hədəf ${targetCash.toFixed(2)} ₼)`,
        created_at: now,
        is_deleted: false,
      });
    } else {
      financeRows.push(
        {
          id: uuidv4(),
          tenant_id,
          type: 'out',
          category: 'Daxili Transfer',
          amount: topupAmount.toString(),
          source: fundingSource,
          description: `Gün açılışı üçün ${fundingSource} -> cash`,
          created_at: now,
          is_deleted: false,
        },
        {
          id: uuidv4(),
          tenant_id,
          type: 'in',
          category: 'Daxili Transfer',
          amount: topupAmount.toString(),
          source: 'cash',
          description: `Gün açılışı üçün ${fundingSource} -> cash`,
          created_at: now,
          is_deleted: false,
        },
      );
    }
    saveFinanceRows(tenant_id, financeRows);
  }

  const openingCash = currentCash.plus(topupAmount).toFixed(2);

  const nextTimestamp = new Date(Date.now() + 1).toISOString();
  const next = {
    id: uuidv4(),
    tenant_id,
    opened_by,
    status: 'Open',
    timestamp: nextTimestamp,
    opening_cash: openingCash,
    opening_source: fundingSource,
    opening_target_cash: targetCash.toFixed(2),
    opening_topup_amount: topupAmount.toFixed(2),
  };

  saveShiftState(tenant_id, next);
  shiftStatusCache[tenant_id] = {
    status: 'Open',
    opened_by,
    timestamp: next.timestamp,
  };

  logEvent(opened_by, 'SHIFT_OPENED', {
    tenant_id,
    timestamp: next.timestamp,
    funding_source: fundingSource,
    topup_amount: topupAmount.toFixed(2),
  });
  return next;
};

// FUNKSIYA: close_shift
export const close_shift = (tenant_id: string, closed_by: string) => {
  const openShift = getShiftState(tenant_id);
  if (!openShift) {
    throw new Error('Bağlanacaq açıq növbə yoxdur');
  }
  if (openShift.status !== 'Open') {
    throw new Error('Bu tenant üçün açıq növbə yoxdur');
  }

  const closed = {
    ...openShift,
    status: 'Closed',
    closed_by,
    closed_at: new Date().toISOString(),
  };

  saveShiftState(tenant_id, closed);
  shiftStatusCache[tenant_id] = {
    status: 'Closed',
    opened_by: closed.opened_by,
    timestamp: closed.timestamp,
  };

  logEvent(closed_by, 'SHIFT_CLOSED', { tenant_id, shift_id: openShift.id });

  return closed;
};

export const handover_shift = (
  tenant_id: string,
  handed_by: string,
  received_by: string,
  declared_cash: string,
) => {
  const shift = getShiftState(tenant_id);
  if (!shift || shift.status !== 'Open') {
    throw new Error('Təhvil üçün açıq növbə yoxdur.');
  }
  if (!received_by || String(received_by).trim() === '') {
    throw new Error('Təhvil alan işçi seçilməlidir.');
  }

  const declared = new Decimal(declared_cash || '0');
  const now = new Date().toISOString();

  const handovers = getTenantRows<ShiftHandoverRow>(tenant_id, 'shift_handovers', 'shift_handovers');
  handovers.push({
    id: uuidv4(),
    tenant_id,
    handed_by,
    received_by,
    declared_cash: declared.toString(),
    status: 'PENDING',
    created_at: now,
  });
  saveTenantRows(tenant_id, 'shift_handovers', 'shift_handovers', handovers);

  pushStaffNotification(
    tenant_id,
    received_by,
    'Smena Təhvil Alındı',
    `${handed_by} sizə ${declared.toFixed(2)} ₼ ilə smena təhvil verdi. Təsdiq edin.`,
    {
      handed_by,
      declared_cash: declared.toString(),
      handed_over_at: now,
    },
  );

  logEvent(handed_by, 'SHIFT_HANDOVER', {
    tenant_id,
    received_by,
    declared_cash: declared.toString(),
    status: 'PENDING',
  });

  return { success: true, declared_cash: declared.toString(), status: 'PENDING' };
};

export const handover_shift_live = async (
  tenant_id: string,
  handed_by: string,
  received_by: string,
  declared_cash: string,
) => {
  if (!isBackendEnabled()) return handover_shift(tenant_id, handed_by, received_by, declared_cash);
  return apiRequest<any>('/api/v1/ops/shift-handover', {
    method: 'POST',
    tenantId: null,
    body: { received_by, declared_cash },
  });
};

export const accept_shift_handover = (
  tenant_id: string,
  handover_id: string,
  received_by: string,
  actual_cash: string,
) => {
  const shift = getShiftState(tenant_id);
  if (!shift || shift.status !== 'Open') {
    throw new Error('Açıq növbə yoxdur.');
  }

  const handovers = getTenantRows<ShiftHandoverRow>(tenant_id, 'shift_handovers', 'shift_handovers');
  const idx = handovers.findIndex((h) => h.id === handover_id && h.tenant_id === tenant_id);
  if (idx < 0) throw new Error('Təhvil qeydi tapılmadı.');

  const row = handovers[idx];
  if (row.status !== 'PENDING') throw new Error('Bu təhvil artıq təsdiqlənib.');
  if (row.received_by !== received_by) throw new Error('Bu təhvil sizə aid deyil.');

  const declared = new Decimal(row.declared_cash || '0');
  const actual = new Decimal(actual_cash || '0');
  const difference = actual.minus(declared);

  if (!difference.isZero()) {
    const allFinances = getFinanceRows(tenant_id);
    allFinances.push({
      id: uuidv4(),
      tenant_id,
      type: difference.isPositive() ? 'in' : 'out',
      category: difference.isPositive() ? 'Kassa Artığı' : 'Kassa Kəsiri',
      amount: difference.abs().toString(),
      source: 'cash',
      description: `Smeni qəbul fərqi (${row.handed_by} -> ${received_by})`,
      created_at: new Date().toISOString(),
      is_deleted: false,
    });
    saveFinanceRows(tenant_id, allFinances);
  }

  const acceptedAt = new Date().toISOString();
  handovers[idx] = {
    ...row,
    status: 'ACCEPTED',
    actual_cash: actual.toString(),
    difference: difference.toString(),
    accepted_at: acceptedAt,
  };
  saveTenantRows(tenant_id, 'shift_handovers', 'shift_handovers', handovers);

  saveShiftState(tenant_id, {
    ...shift,
    opened_by: received_by,
    handed_over_by: row.handed_by,
    handed_over_at: acceptedAt,
    status: 'Open',
  });

  logEvent(received_by, 'SHIFT_HANDOVER_ACCEPTED', {
    tenant_id,
    handover_id,
    handed_by: row.handed_by,
    declared_cash: declared.toString(),
    actual_cash: actual.toString(),
    difference: difference.toString(),
  });

  return {
    success: true,
    handover_id,
    declared_cash: declared.toString(),
    actual_cash: actual.toString(),
    difference: difference.toString(),
  };
};

export const accept_shift_handover_live = async (
  tenant_id: string,
  handover_id: string,
  received_by: string,
  actual_cash: string,
) => {
  if (!isBackendEnabled()) return accept_shift_handover(tenant_id, handover_id, received_by, actual_cash);
  return apiRequest<any>(`/api/v1/ops/shift-handover/${encodeURIComponent(handover_id)}/accept`, {
    method: 'POST',
    tenantId: null,
    body: { actual_cash },
  });
};

export const get_shift_status = (tenant_id: string) => {
  if (isBackendEnabled() && shiftStatusCache[tenant_id]) {
    return { tenant_id, ...shiftStatusCache[tenant_id] };
  }
  const current = getShiftState(tenant_id);
  if (!current) return { status: 'Closed', tenant_id };
  return { status: current.status, tenant_id, opened_by: current.opened_by, timestamp: current.timestamp };
};

export const refresh_shift_status = async (tenant_id: string) => {
  if (isBackendEnabled()) {
    const res = await apiRequest<any>('/api/v1/reports/status', {
      method: 'GET',
      tenantId: tenant_id,
    });
    const normalized = {
      status: String(res?.status || 'Closed') === 'Open' ? 'Open' : 'Closed',
      opened_by: res?.opened_by,
      timestamp: res?.opened_at || res?.timestamp,
      opening_cash: String(res?.opening_cash || '0'),
      staff_shift_required: Boolean(res?.staff_shift_required ?? true),
      staff_sessions_count: Number(res?.staff_sessions_count || 0),
      staff_session_open: Boolean(res?.staff_session_open ?? false),
      staff_session_opened_at: res?.staff_session_opened_at || null,
    };
    shiftStatusCache[tenant_id] = normalized;
    return { tenant_id, ...normalized };
  }
  return get_shift_status(tenant_id);
};

// Helper: cash drawer expected amount from finance ledger.
export const get_expected_cash = (tenant_id: string) => {
  if (isBackendEnabled() && expectedCashCache[tenant_id]) {
    return expectedCashCache[tenant_id];
  }
  const shift = getShiftState(tenant_id);
  if (!shift || shift.status !== 'Open') {
    return new Decimal(0);
  }
  const openedAt = shift.timestamp ? new Date(shift.timestamp).getTime() : 0;
  const openingCash = new Decimal(shift.opening_cash || '0');
  const finances = getFinanceRows(tenant_id).filter((f) => {
    if (f.source !== 'cash' || f.is_deleted) return false;
    const createdAt = f.created_at ? new Date(f.created_at).getTime() : 0;
    return !openedAt || createdAt >= openedAt;
  });

  let expected_cash = openingCash;
  finances.forEach((f) => {
    if (f.type === 'in') expected_cash = expected_cash.plus(new Decimal(f.amount || 0));
    else expected_cash = expected_cash.minus(new Decimal(f.amount || 0));
  });

  return expected_cash;
};

export const refresh_expected_cash = async (tenant_id: string) => {
  if (isBackendEnabled()) {
    const res = await apiRequest<any>('/api/v1/reports/expected-cash', {
      method: 'GET',
      tenantId: tenant_id,
    });
    const value = new Decimal(String(res?.expected_cash || '0'));
    expectedCashCache[tenant_id] = value;
    return value;
  }
  return get_expected_cash(tenant_id);
};

// FUNKSIYA: x_report
export const x_report = async (actual_cash: string, handed_by: string, tenant_id: string) => {
  if (isBackendEnabled()) {
    const res = await apiRequest<any>('/api/v1/reports/x-report', {
      method: 'POST',
      tenantId: tenant_id,
      body: { actual_cash },
    });
    logEvent(handed_by, 'X_REPORT_CREATED', {
      tenant_id,
      expected: String(res?.expected_cash || '0'),
      actual: String(res?.actual_cash || actual_cash),
      difference: String(res?.difference || '0'),
      backend: true,
    });
    return {
      expected_cash: String(res?.expected_cash || '0'),
      actual_cash: String(res?.actual_cash || actual_cash),
      difference: String(res?.difference || '0'),
    };
  }
  const shift = getShiftState(tenant_id);
  if (!shift || shift.status !== 'Open') {
    throw new Error('X-Hesabat üçün əvvəlcə günü (növbəni) açın.');
  }
  const expected_cash = get_expected_cash(tenant_id);

  const actual = new Decimal(actual_cash);
  const difference = actual.minus(expected_cash);

  // Fərq varsa Finance'ə yazılır
  if (!difference.isZero()) {
    const allFinances = getFinanceRows(tenant_id);
    allFinances.push({
      id: uuidv4(),
      tenant_id,
      type: difference.isPositive() ? 'in' : 'out',
      category: difference.isPositive() ? 'Kassa Artığı' : 'Kassa Kəsiri',
      amount: difference.abs().toString(),
      source: 'cash',
      description: 'X-Hesabat Kassa Fərqi',
      created_at: new Date().toISOString(),
      is_deleted: false
    });
    saveFinanceRows(tenant_id, allFinances);
  }

  logEvent(handed_by, 'X_REPORT_CREATED', { 
    tenant_id, 
    expected: expected_cash.toString(), 
    actual: actual.toString(), 
    difference: difference.toString() 
  });

  expectedCashCache[tenant_id] = actual;

  return { expected_cash: expected_cash.toString(), actual_cash: actual.toString(), difference: difference.toString() };
};

// FUNKSIYA: z_report
export const z_report = async (
  actual_cash: string, 
  wage_amount: string, 
  generated_by: string,
  tenant_id: string,
  opts?: { allowOpenDepositClose?: boolean }
) => {
  if (isBackendEnabled()) {
    const res = await apiRequest<any>('/api/v1/reports/z-report', {
      method: 'POST',
      tenantId: tenant_id,
      body: {
        actual_cash,
        wage_amount,
        allow_open_deposit_close: Boolean(opts?.allowOpenDepositClose),
      },
    });

    const currentShift = getShiftState(tenant_id);
    if (currentShift) {
      saveShiftState(tenant_id, {
        ...currentShift,
        status: 'Closed',
        closed_by: generated_by,
        closed_at: new Date().toISOString(),
      });
    }
    shiftStatusCache[tenant_id] = {
      status: 'Closed',
      opened_by: currentShift?.opened_by,
      timestamp: currentShift?.timestamp,
    };

    const profile = getBusinessProfile(tenant_id);
    const reportId = String(res?.shift_id || '').slice(0, 8).toUpperCase() || 'Z-REPORT';
    const receipt_html = `
      <html>
        <head>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: Inter, Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
            .line { display:flex; justify-content:space-between; gap:8px; margin: 2px 0; }
            .muted { color:#555; font-size:11px; }
            .bold { font-weight: 700; }
            hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
          </style>
        </head>
        <body>
          ${profile?.logo_url ? `<img src="${profile.logo_url}" style="height:34px;max-width:180px;object-fit:contain;margin-bottom:6px"/>` : ''}
          <div class="bold" style="font-size:15px">${profile?.company_name || 'IRONWAVES POS'}</div>
          <div class="muted">VÖEN: ${profile?.voen || '-'}</div>
          <div class="muted">Tel: ${profile?.phone || '-'}</div>
          <div class="muted">${profile?.address || '-'}</div>
          <hr />
          <div class="line"><span>Z-Hesabat</span><span>${new Date().toLocaleDateString()}</span></div>
          <div class="line"><span>Report ID</span><span>${reportId}</span></div>
          <div class="line"><span>Operator</span><span>${generated_by}</span></div>
          <div class="line"><span>Tarix</span><span>${new Date().toLocaleString()}</span></div>
          <hr />
          <div class="line"><span>Nağd Satış</span><span>${new Decimal(res?.cash_sales || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Kart Satış</span><span>${new Decimal(res?.card_sales || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Maaş Çıxışı</span><span>${new Decimal(res?.wage_amount || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Açılış (növbə)</span><span>${new Decimal(res?.opening_cash || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Kassa girişləri</span><span>${new Decimal(res?.cash_movements_in || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Kassa çıxışları</span><span>${new Decimal(res?.cash_movements_out || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Faktiki bağlanış</span><span>${new Decimal(res?.actual_cash || actual_cash || 0).toFixed(2)} ₼</span></div>
          <hr />
          <div class="muted">${profile?.receipt_footer || 'Bizi seçdiyiniz üçün təşəkkür edirik!'}</div>
        </body>
      </html>
    `;

    return {
      success: Boolean(res?.success),
      total_sales: new Decimal(res?.cash_sales || 0).plus(new Decimal(res?.card_sales || 0)).toString(),
      wage: String(res?.wage_amount || wage_amount || '0'),
      open_deposit_liability: String(res?.open_deposit_liability || '0'),
      receipt_html,
      email_sent: false,
      email_error: '',
    };
  }
  const shift = getShiftState(tenant_id);
  if (!shift || shift.status !== 'Open') {
    throw new Error('Z-Hesabat üçün əvvəlcə günü (növbəni) açın.');
  }
  const allFinances = getFinanceRows(tenant_id);
  const finances = allFinances.filter(f => !f.is_deleted);
  
  let cash_sales = new Decimal(0);
  let card_sales = new Decimal(0);
  
  finances.forEach(f => {
    if (f.type === 'in' && String(f.category || '').includes('Satış')) {
      if (f.source === 'cash') cash_sales = cash_sales.plus(f.amount);
      if (f.source === 'card') card_sales = card_sales.plus(f.amount);
    }
  });

  const normalize = (value: string | undefined | null) => String(value || '').trim().toLowerCase();
  const otherIncomeMap = new Map<string, Decimal>();
  const otherExpenseMap = new Map<string, Decimal>();
  finances.forEach((f) => {
    const category = String(f.category || '').trim() || (f.type === 'in' ? 'Giriş' : 'Xərc');
    const normalizedCategory = normalize(category);
    if (f.type === 'in') {
      if (normalizedCategory.includes('satış') || normalizedCategory.includes('depozit')) return;
      otherIncomeMap.set(category, (otherIncomeMap.get(category) || new Decimal(0)).plus(new Decimal(f.amount || 0)));
    }
    if (f.type === 'out') {
      if (normalizedCategory === 'maaş') return;
      otherExpenseMap.set(category, (otherExpenseMap.get(category) || new Decimal(0)).plus(new Decimal(f.amount || 0)));
    }
  });
  const other_income_lines = Array.from(otherIncomeMap.entries()).map(([label, amount]) => ({ label, amount: amount.toFixed(2) }));
  const other_expense_lines = Array.from(otherExpenseMap.entries()).map(([label, amount]) => ({ label, amount: amount.toFixed(2) }));
  const other_income_total = other_income_lines.reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0));
  const other_expense_total = other_expense_lines.reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0));

  const total_sales = cash_sales.plus(card_sales);
  const wage = new Decimal(wage_amount);
  const actual = new Decimal(actual_cash || '0');
  const reportId = uuidv4();
  const profile = getBusinessProfile(tenant_id);

  // Maaş çıxışını finance-a yazaq
  if (wage.greaterThan(0)) {
    allFinances.push({
      id: uuidv4(),
      tenant_id,
      type: 'out',
      category: 'Maaş',
      amount: wage.toString(),
      source: 'cash',
      description: 'Z-Hesabat Maaş Çıxışı',
      created_at: new Date().toISOString(),
      is_deleted: false
    });
    saveFinanceRows(tenant_id, allFinances);
  }

  const reports = getTenantRows<any>(tenant_id, 'z_reports', 'z_reports');
  reports.push({
    id: reportId,
    tenant_id,
    total_sales: total_sales.toString(),
    cash_sales: cash_sales.toString(),
    card_sales: card_sales.toString(),
    wage: wage.toString(),
    actual_cash: actual.toString(),
    generated_by,
    created_at: new Date().toISOString(),
  });
  saveTenantRows(tenant_id, 'z_reports', 'z_reports', reports);

  // Z reportdan sonra növbəni avtomatik bağlayırıq.
  saveShiftState(tenant_id, {
    ...shift,
    status: 'Closed',
    closed_by: generated_by,
    closed_at: new Date().toISOString(),
  });
  expectedCashCache[tenant_id] = actual;
  shiftStatusCache[tenant_id] = {
    status: 'Closed',
    opened_by: shift.opened_by,
    timestamp: shift.timestamp,
  };

  let email_sent = false;
  let email_error = '';
  try {
    const html = `
      <h2>${profile?.company_name || 'IRONWAVES POS'} - Z Report</h2>
      <p><b>Date:</b> ${new Date().toLocaleString()}</p>
      <p><b>Total sales:</b> ${total_sales.toFixed(2)} ₼</p>
      <p><b>Cash:</b> ${cash_sales.toFixed(2)} ₼</p>
      <p><b>Card:</b> ${card_sales.toFixed(2)} ₼</p>
      <p><b>Wage:</b> ${wage.toFixed(2)} ₼</p>
      <p><b>Next opening cash:</b> ${actual.toFixed(2)} ₼</p>
      <p><b>Report ID:</b> ${reportId.slice(0, 8).toUpperCase()}</p>
    `;
    const sent = await send_email({
      tenant_id,
      subject: `Z Report ${new Date().toLocaleDateString()} • ${reportId.slice(0, 8).toUpperCase()}`,
      html,
    });
    email_sent = sent.success;
    email_error = sent.message;
  } catch (e: any) {
    email_error = e?.message || 'email failed';
  }

  logEvent(generated_by, 'Z_REPORT_CREATED', { 
    tenant_id,
    total_sales: total_sales.toString(),
    cash_sales: cash_sales.toString(),
    card_sales: card_sales.toString(),
    wage: wage.toString(),
    email_sent,
    email_error,
  });

  const receipt_html = `
    <html>
      <head>
        <style>
          @page { size: 80mm auto; margin: 4mm; }
          body { font-family: Inter, Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
          .line { display:flex; justify-content:space-between; gap:8px; margin: 2px 0; }
          .muted { color:#555; font-size:11px; }
          .bold { font-weight: 700; }
          hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
        </style>
      </head>
      <body>
        ${profile?.logo_url ? `<img src="${profile.logo_url}" style="height:34px;max-width:180px;object-fit:contain;margin-bottom:6px"/>` : ''}
        <div class="bold" style="font-size:15px">${profile?.company_name || 'IRONWAVES POS'}</div>
        <div class="muted">VÖEN: ${profile?.voen || '-'}</div>
        <div class="muted">Tel: ${profile?.phone || '-'}</div>
        <div class="muted">${profile?.address || '-'}</div>
        <hr />
        <div class="line"><span>Z-Hesabat</span><span>${new Date().toLocaleDateString()}</span></div>
        <div class="line"><span>Report ID</span><span>${reportId.slice(0, 8).toUpperCase()}</span></div>
        <div class="line"><span>Operator</span><span>${generated_by}</span></div>
        <div class="line"><span>Tarix</span><span>${new Date().toLocaleString()}</span></div>
        <hr />
        <div class="line"><span>Nağd Satış</span><span>${cash_sales.toFixed(2)} ₼</span></div>
        <div class="line"><span>Kart Satış</span><span>${card_sales.toFixed(2)} ₼</span></div>
        <div class="line"><span>Ümumi Satış</span><span>${total_sales.toFixed(2)} ₼</span></div>
        <div class="line"><span>Maaş Çıxışı</span><span>${wage.toFixed(2)} ₼</span></div>
        <div class="line"><span>Açılış (növbə)</span><span>${new Decimal(shift.opening_cash || 0).toFixed(2)} ₼</span></div>
        <div class="line"><span>Faktiki bağlanış</span><span>${actual.toFixed(2)} ₼</span></div>
        <hr />
        <div class="muted">${profile?.receipt_footer || 'Bizi seçdiyiniz üçün təşəkkür edirik!'}</div>
      </body>
    </html>
  `;
  
  return {
    success: true,
    total_sales: total_sales.toString(),
    wage: wage.toString(),
    receipt_html,
    email_sent,
    email_error,
    other_income_total: other_income_total.toFixed(2),
    other_income_lines,
    other_expense_total: other_expense_total.toFixed(2),
    other_expense_lines,
  };
};
