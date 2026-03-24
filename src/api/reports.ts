import { Decimal } from 'decimal.js';
import { logEvent } from '../lib/logger';
import { FinanceEntry } from '../types/pos';
import { v4 as uuidv4 } from 'uuid';
import { send_email } from './email';

import { getDB, setDB } from '../lib/db_sim';

type StaffNotification = {
  id: string;
  tenant_id: string;
  username: string;
  title: string;
  message: string;
  meta?: Record<string, string>;
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

const pushStaffNotification = (
  tenant_id: string,
  username: string,
  title: string,
  message: string,
  meta?: Record<string, string>,
) => {
  const rows = getDB<StaffNotification>('staff_notifications');
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
  setDB('staff_notifications', rows);
};

export const get_unread_staff_notifications = (tenant_id: string, username: string) => {
  const rows = getDB<StaffNotification>('staff_notifications');
  return rows
    .filter((r) => r.tenant_id === tenant_id && r.username === username && !r.read)
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
};

export const mark_staff_notifications_read = (tenant_id: string, username: string) => {
  const rows = getDB<StaffNotification>('staff_notifications');
  const next = rows.map((r) => {
    if (r.tenant_id === tenant_id && r.username === username && !r.read) {
      return { ...r, read: true };
    }
    return r;
  });
  setDB('staff_notifications', next);
};

export const get_shift_handover_history = (tenant_id: string, username?: string) => {
  const rows = getDB<ShiftHandoverRow>('shift_handovers').filter((r) => r.tenant_id === tenant_id);
  const filtered = username
    ? rows.filter((r) => r.handed_by === username || r.received_by === username)
    : rows;
  return filtered.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
};

export const get_pending_handover_for_user = (tenant_id: string, username: string) => {
  const rows = getDB<ShiftHandoverRow>('shift_handovers').filter(
    (r) => r.tenant_id === tenant_id && r.received_by === username && r.status === 'PENDING',
  );
  return rows.sort((a, b) => (a.created_at > b.created_at ? -1 : 1))[0] || null;
};

const getBusinessProfile = (tenant_id: string) => {
  const profiles = getDB<any>('business_profile');
  return profiles.find((p) => p.tenant_id === tenant_id) || null;
};

const getShiftState = (tenant_id: string) => {
  const rows = getDB<any>('shift_state');
  return rows.find((r) => r.tenant_id === tenant_id) || null;
};

const saveShiftState = (tenant_id: string, payload: any) => {
  const rows = getDB<any>('shift_state');
  const kept = rows.filter((r) => r.tenant_id !== tenant_id);
  setDB('shift_state', [...kept, payload]);
};

// FUNKSIYA: open_shift
export const open_shift = (opened_by: string, tenant_id: string) => {
  const current_shift = getShiftState(tenant_id);
  if (current_shift && current_shift.status === 'Open') {
    throw new Error('Açıq növbə mövcuddur!');
  }

  const next = {
    id: uuidv4(),
    tenant_id,
    opened_by,
    status: 'Open',
    timestamp: new Date().toISOString()
  };

  saveShiftState(tenant_id, next);

  logEvent(opened_by, 'SHIFT_OPENED', { tenant_id, timestamp: next.timestamp });
  return next;
};

// FUNKSIYA: close_shift
export const close_shift = (closed_by: string) => {
  const allStates = getDB<any>('shift_state');
  const openShift = allStates.find((s) => s.status === 'Open');
  if (!openShift) {
    throw new Error('Bağlanacaq açıq növbə yoxdur');
  }

  const tenant_id = openShift.tenant_id;
  const closed = {
    ...openShift,
    status: 'Closed',
    closed_by,
    closed_at: new Date().toISOString(),
  };

  saveShiftState(tenant_id, closed);

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

  const handovers = getDB<ShiftHandoverRow>('shift_handovers');
  handovers.push({
    id: uuidv4(),
    tenant_id,
    handed_by,
    received_by,
    declared_cash: declared.toString(),
    status: 'PENDING',
    created_at: now,
  });
  setDB('shift_handovers', handovers);

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

  const handovers = getDB<ShiftHandoverRow>('shift_handovers');
  const idx = handovers.findIndex((h) => h.id === handover_id && h.tenant_id === tenant_id);
  if (idx < 0) throw new Error('Təhvil qeydi tapılmadı.');

  const row = handovers[idx];
  if (row.status !== 'PENDING') throw new Error('Bu təhvil artıq təsdiqlənib.');
  if (row.received_by !== received_by) throw new Error('Bu təhvil sizə aid deyil.');

  const declared = new Decimal(row.declared_cash || '0');
  const actual = new Decimal(actual_cash || '0');
  const difference = actual.minus(declared);

  if (!difference.isZero()) {
    const allFinances = getDB<FinanceEntry>('finance');
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
    setDB('finance', allFinances);
  }

  const acceptedAt = new Date().toISOString();
  handovers[idx] = {
    ...row,
    status: 'ACCEPTED',
    actual_cash: actual.toString(),
    difference: difference.toString(),
    accepted_at: acceptedAt,
  };
  setDB('shift_handovers', handovers);

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

export const get_shift_status = (tenant_id: string) => {
  const current = getShiftState(tenant_id);
  if (!current) return { status: 'Closed', tenant_id };
  return { status: current.status, tenant_id, opened_by: current.opened_by, timestamp: current.timestamp };
};

// Helper: cash drawer expected amount from finance ledger.
export const get_expected_cash = (tenant_id: string) => {
  const finances = getDB<FinanceEntry>('finance').filter(
    (f) => f.tenant_id === tenant_id && f.source === 'cash' && !f.is_deleted,
  );

  let expected_cash = new Decimal(0);
  finances.forEach((f) => {
    if (f.type === 'in') expected_cash = expected_cash.plus(new Decimal(f.amount || 0));
    else expected_cash = expected_cash.minus(new Decimal(f.amount || 0));
  });

  return expected_cash;
};

// FUNKSIYA: x_report
export const x_report = (actual_cash: string, handed_by: string, tenant_id: string) => {
  const shift = getShiftState(tenant_id);
  if (!shift || shift.status !== 'Open') {
    throw new Error('X-Hesabat üçün əvvəlcə günü (növbəni) açın.');
  }
  const expected_cash = get_expected_cash(tenant_id);

  const actual = new Decimal(actual_cash);
  const difference = actual.minus(expected_cash);

  // Fərq varsa Finance'ə yazılır
  if (!difference.isZero()) {
    const allFinances = getDB<FinanceEntry>('finance');
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
    setDB('finance', allFinances);
  }

  logEvent(handed_by, 'X_REPORT_CREATED', { 
    tenant_id, 
    expected: expected_cash.toString(), 
    actual: actual.toString(), 
    difference: difference.toString() 
  });

  return { expected_cash: expected_cash.toString(), actual_cash: actual.toString(), difference: difference.toString() };
};

// FUNKSIYA: z_report
export const z_report = async (
  actual_cash: string, 
  wage_amount: string, 
  generated_by: string,
  tenant_id: string
) => {
  const shift = getShiftState(tenant_id);
  if (!shift || shift.status !== 'Open') {
    throw new Error('Z-Hesabat üçün əvvəlcə günü (növbəni) açın.');
  }
  const allFinances = getDB<FinanceEntry>('finance');
  const finances = allFinances.filter(f => f.tenant_id === tenant_id && !f.is_deleted);
  
  let cash_sales = new Decimal(0);
  let card_sales = new Decimal(0);
  
  finances.forEach(f => {
    if (f.type === 'in' && String(f.category || '').includes('Satış')) {
      if (f.source === 'cash') cash_sales = cash_sales.plus(f.amount);
      if (f.source === 'card') card_sales = card_sales.plus(f.amount);
    }
  });

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
    setDB('finance', allFinances);
  }

  const reports = getDB<any>('z_reports');
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
  setDB('z_reports', reports);

  // Z reportdan sonra növbəni avtomatik bağlayırıq.
  saveShiftState(tenant_id, {
    ...shift,
    status: 'Closed',
    closed_by: generated_by,
    closed_at: new Date().toISOString(),
  });

  let email_sent = false;
  let email_error = '';
  try {
    const html = `
      <h2>${profile?.company_name || 'Social Bee POS'} - Z Report</h2>
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
        <div class="bold" style="font-size:15px">${profile?.company_name || 'SOCIAL BEE POS'}</div>
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
        <div class="line"><span>Açılış (sabah)</span><span>${actual.toFixed(2)} ₼</span></div>
        <hr />
        <div class="muted">${profile?.receipt_footer || 'Bizi seçdiyiniz üçün təşəkkür edirik!'}</div>
      </body>
    </html>
  `;
  
  return { success: true, total_sales: total_sales.toString(), wage: wage.toString(), receipt_html, email_sent, email_error };
};