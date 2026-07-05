import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { Customer, CustomerType, Notification } from '../types/pos';
import { filterTenantRecords, getActiveTenantId } from '../lib/tenant';
import { apiRequest, isBackendEnabled, getApiBaseUrl } from './client';

const defaultTenant = () => getActiveTenantId();

const normalizeCustomerType = (value: unknown): CustomerType => {
  switch (String(value || '').trim().toLowerCase()) {
    case 'golden':
      return 'Golden';
    case 'platinum':
      return 'Platinum';
    case 'elite':
      return 'Elite';
    case 'telebe':
    case 'tələbə':
      return 'Tələbə';
    case 'ikram':
      return 'Ikram';
    default:
      return 'Normal';
  }
};

const normalizeDiscountPercent = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

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

export type ReservationGuestRecord = {
  id: string;
  guest_ids: string[];
  full_name: string;
  phone?: string;
  email?: string;
  notes?: string;
  reservation_count: number;
  cancelled_count: number;
  completed_count: number;
  active_count: number;
  last_reservation_at?: string | null;
  next_reservation_at?: string | null;
  last_table_label?: string | null;
};

const normalizeGuestPhone = (value?: string | null) => String(value || '').trim().replace(/[^\d+]/g, '');
const normalizeGuestEmail = (value?: string | null) => String(value || '').trim().toLowerCase();

export async function get_reservation_guests_live(tenant_id?: string): Promise<ReservationGuestRecord[]> {
  const tenantId = tenant_id || defaultTenant();
  if (!isBackendEnabled()) {
    const rows = filterTenantRecords(getDB<any>('restaurant_reservations'), tenantId);
    const grouped = new Map<string, ReservationGuestRecord>();
    const now = Date.now();
    rows.forEach((row: any) => {
      const guest = row.guest || {};
      const phone = String(guest.phone || '').trim();
      const email = String(guest.email || '').trim();
      const key = normalizeGuestPhone(phone) || normalizeGuestEmail(email) || `guest:${row.id}`;
      const current = grouped.get(key) || {
        id: key,
        guest_ids: [],
        full_name: String(guest.full_name || 'Naməlum qonaq'),
        phone,
        email,
        notes: String(row.special_note || ''),
        reservation_count: 0,
        cancelled_count: 0,
        completed_count: 0,
        active_count: 0,
        last_reservation_at: null,
        next_reservation_at: null,
        last_table_label: null,
      };
      current.reservation_count += 1;
      if (!current.phone && phone) current.phone = phone;
      if (!current.email && email) current.email = email;
      if ((guest.full_name || '').length > (current.full_name || '').length) current.full_name = guest.full_name;
      const status = String(row.status || '').toUpperCase();
      if (['CANCELLED', 'NO_SHOW'].includes(status)) current.cancelled_count += 1;
      else if (['SEATED', 'COMPLETED'].includes(status)) current.completed_count += 1;
      else current.active_count += 1;
      const reservationAt = String(row.reservation_at || '');
      if (!current.last_reservation_at || reservationAt > current.last_reservation_at) current.last_reservation_at = reservationAt;
      if (reservationAt && new Date(reservationAt).getTime() >= now) {
        if (!current.next_reservation_at || reservationAt < current.next_reservation_at) current.next_reservation_at = reservationAt;
      }
      if (row.assigned_table_id) current.last_table_label = row.assigned_table_id;
      grouped.set(key, current);
    });
    return Array.from(grouped.values()).sort((a, b) => String(a.next_reservation_at || '').localeCompare(String(b.next_reservation_at || '')));
  }
  return apiRequest<ReservationGuestRecord[]>('/api/v1/ops/customers/reservation-guests', { tenantId: null });
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
        existing.type = normalizeCustomerType(row.type);
        existing.stars = row.stars;
        existing.discount_percent = normalizeDiscountPercent(row.discount_percent);
      } else {
        customers.push({
          id: uuidv4(),
          tenant_id: tenantId,
          card_id: row.card_id,
          secret_token: row.secret_token || uuidv4(),
          type: normalizeCustomerType(row.type),
          stars: row.stars,
          discount_percent: normalizeDiscountPercent(row.discount_percent),
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

export async function get_customer_app_session_live(card_id: string, token: string, tenant_id?: string) {
  const tenantId = tenant_id || defaultTenant();
  const safeCard = String(card_id || '').trim();
  const safeToken = String(token || '').trim();
  if (!safeCard || !safeToken) {
    throw new Error('Customer session is invalid');
  }

  if (!isBackendEnabled()) {
    const customer = getCustomersLocal(tenantId).find(
      (row) => String(row.card_id || '').toLowerCase() === safeCard.toLowerCase() && row.secret_token === safeToken,
    );
    if (!customer) {
      throw new Error('Customer session is invalid');
    }
    const notifications = filterTenantRecords(getDB<Notification>('notifications'), tenantId)
      .filter((row) => row.card_id === customer.card_id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 20);
    const sales = filterTenantRecords(getDB<any>('sales'), tenantId)
      .filter((row) => row.customer_card_id === customer.card_id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 20);
    const profile = getDB<any>('business_profile').find((row) => row.tenant_id === tenantId);
    const happyHours = filterTenantRecords(getDB<any>('happy_hours'), tenantId).filter((row) => row.is_active).slice(0, 12);
    const stars = Number(customer.stars || 0);
    const settings = getDB<any>('settings').find((row) => row.tenant_id === tenantId)?.customer_app_settings || {};
    if (settings.enabled === false) {
      throw new Error('Customer app is disabled for this tenant');
    }
    const pendingClaims = (getDB<any>('reward_claims') || [])
      .filter((row) => String(row.tenant_id || '') === tenantId && row.card_id === customer.card_id && row.status === 'PENDING')
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const nextRewardAt = Math.max(1, Number(settings.reward_threshold || 10));
    const programMode = String(settings.program_mode || 'points').toLowerCase() === 'cashback' ? 'cashback' : 'points';
    const cashbackPercent = Math.max(0, Number(settings.cashback_percent || 0));
    const ledgerRows = (getDB<any>('loyalty_ledger') || []).filter(
      (row) => String(row.tenant_id || '') === tenantId && row.card_id === customer.card_id && String(row.unit || '') === 'cashback',
    );
    const cashbackEarned = ledgerRows.length > 0
      ? ledgerRows.reduce((acc: number, row: any) => acc + Number(row.amount || 0), 0)
      : sales.reduce((acc: number, row: any) => acc + (Number(row.total || 0) * cashbackPercent) / 100, 0);
    const balanceValue = programMode === 'cashback'
      ? Math.max(0, cashbackEarned - pendingClaims.length * nextRewardAt)
      : stars;
    const progressCurrent = programMode === 'cashback'
      ? Math.floor(balanceValue % nextRewardAt)
      : stars % nextRewardAt;
    const availableRewards = Math.max(0, Math.floor(balanceValue / nextRewardAt) - (programMode === 'cashback' ? 0 : pendingClaims.length));
    return {
      tenant_id: tenantId,
      branding: {
        company_name: profile?.company_name || 'iRonWaves POS',
        website: profile?.website || (typeof window !== 'undefined' ? window.location.origin : ''),
        logo_url: profile?.logo_url || '',
        receipt_footer: profile?.receipt_footer || '',
        app_name: settings.app_name || 'Loyalty Club',
        hero_title: settings.hero_title || 'Xoş gəldiniz',
        hero_subtitle: settings.hero_subtitle || 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.',
        hero_image_url: settings.hero_image_url || '',
        background_image_url: settings.background_image_url || '',
        background_color: settings.background_color || '#0b1220',
        primary_color: settings.primary_color || '#facc15',
        accent_color: settings.accent_color || '#22d3ee',
        reward_card_style: settings.reward_card_style || 'rounded',
        show_qr_card: settings.show_qr_card !== false,
        show_wallet: settings.show_wallet !== false,
        ai_barista_enabled: settings.ai_barista_enabled === true,
        ai_falci_enabled: settings.ai_falci_enabled === true,
      },
      customer: {
        card_id: customer.card_id,
        type: customer.type,
        stars,
        discount_percent: String((customer as any).discount_percent || 0),
        created_at: customer.created_at,
      },
      wallet: {
        points_label: settings.points_label || (programMode === 'cashback' ? 'Cashback' : 'Ulduz'),
        stars_balance: balanceValue,
        available_rewards: availableRewards,
        next_reward_at: nextRewardAt,
        progress_current: progressCurrent,
        progress_remaining: progressCurrent === 0 && balanceValue > 0 ? 0 : nextRewardAt - progressCurrent,
        reward_label: settings.reward_description || '10 ulduza 1 pulsuz içki',
        reward_name: settings.reward_name || 'Reward',
        program_mode: programMode,
        cashback_percent: cashbackPercent,
        rewards: [
          {
            id: 'default-reward',
            title: settings.reward_name || 'Reward',
            description: settings.reward_description || '10 ulduza 1 pulsuz içki',
            threshold: nextRewardAt,
            available_count: Math.floor(stars / nextRewardAt),
          },
        ],
      },
      campaigns: settings.show_campaigns === false ? [] : happyHours.map((row) => ({
        id: row.id,
        name: row.name,
        discount_percent: row.discount_percent,
        start_time: row.start_time,
        end_time: row.end_time,
        categories: row.categories,
      })),
      notifications: settings.show_notifications === false ? [] : notifications,
      history: settings.show_history === false ? [] : sales,
      pending_claims: pendingClaims,
      customer_app_settings: settings,
    };
  }

  return apiRequest<any>(`/api/v1/ops/customer-app/session?id=${encodeURIComponent(safeCard)}&t=${encodeURIComponent(safeToken)}`, {
    method: 'GET',
    tenantId: null,
    auth: false,
  });
}

export async function get_customer_app_bootstrap_live(tenant_id?: string) {
  const tenantId = tenant_id || defaultTenant();
  if (!isBackendEnabled()) {
    const profile = getDB<any>('business_profile').find((row) => row.tenant_id === tenantId);
    const settings = getDB<any>('settings').find((row) => row.tenant_id === tenantId)?.customer_app_settings || {};
    return {
      tenant_id: tenantId,
      enabled: settings.enabled !== false,
      branding: {
        company_name: profile?.company_name || 'iRonWaves POS',
        website: profile?.website || (typeof window !== 'undefined' ? window.location.origin : ''),
        logo_url: profile?.logo_url || '',
        app_name: settings.app_name || 'Loyalty Club',
        hero_title: settings.hero_title || 'Xoş gəldiniz',
        hero_subtitle: settings.hero_subtitle || 'QR-ni skan et və reward dünyasına qoşul.',
        background_color: settings.background_color || '#0b1220',
        primary_color: settings.primary_color || '#facc15',
        accent_color: settings.accent_color || '#22d3ee',
      },
      consent_text: settings.consent_text || 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.',
      join_customer_type: settings.join_customer_type || 'golden',
      join_discount_percent: Number(settings.join_discount_percent || 5),
    };
  }
  return apiRequest<any>('/api/v1/ops/customer-app/bootstrap', { method: 'GET', tenantId: null, auth: false });
}

export async function enroll_customer_app_live(
  consent_accepted: boolean = true,
  tenant_id?: string,
  join_customer_type?: string,
  join_discount_percent?: number,
) {
  const tenantId = tenant_id || defaultTenant();
  if (!consent_accepted) throw new Error('Consent must be accepted');
  if (!isBackendEnabled()) {
    const customers = getCustomersLocal(tenantId);
    const card_id = `QR-${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const token = uuidv4().replace(/-/g, '');
    const newCustomer: Customer = {
      id: uuidv4(),
      tenant_id: tenantId,
      card_id,
      type: normalizeCustomerType(join_customer_type || 'golden'),
      stars: 0,
      discount_percent: Number.isFinite(join_discount_percent) ? Number(join_discount_percent) : 0,
      secret_token: token,
      created_at: new Date().toISOString(),
    };
    customers.push(newCustomer);
    saveCustomersLocal(tenantId, customers);
    send_notification({ card_ids: [card_id], message: 'Loyalty club hesabınız yaradıldı. QR kartınızı kassada göstərə bilərsiniz.' });
    return { success: true, card_id, token };
  }
  return apiRequest<{ success: boolean; card_id: string; token: string }>('/api/v1/ops/customer-app/enroll', {
    method: 'POST',
    tenantId: null,
    auth: false,
    body: {
      consent_accepted: true,
      join_customer_type,
      join_discount_percent,
    },
  });
}

export async function mark_customer_notification_read_live(notification_id: string, card_id: string, token: string, tenant_id?: string) {
  const tenantId = tenant_id || defaultTenant();
  const safeId = String(notification_id || '').trim();
  const safeCard = String(card_id || '').trim();
  const safeToken = String(token || '').trim();
  if (!safeId || !safeCard || !safeToken) {
    throw new Error('Notification read request is invalid');
  }

  if (!isBackendEnabled()) {
    const notifications = filterTenantRecords(getDB<Notification>('notifications'), tenantId);
    const foreign = getDB<Notification>('notifications').filter((row) => String(row.tenant_id || '') !== tenantId);
    const row = notifications.find((entry) => entry.id === safeId && entry.card_id === safeCard);
    if (!row) throw new Error('Notification not found');
    row.is_read = true;
    setDB('notifications', [...foreign, ...notifications]);
    return { success: true };
  }

  return apiRequest<{ success: boolean }>(`/api/v1/ops/customer-app/notifications/${encodeURIComponent(safeId)}/read?id=${encodeURIComponent(safeCard)}&t=${encodeURIComponent(safeToken)}`, {
    method: 'POST',
    tenantId: null,
    auth: false,
  });
}

export async function claim_customer_reward_live(card_id: string, token: string, reward_id: string = 'default-reward', tenant_id?: string) {
  const tenantId = tenant_id || defaultTenant();
  const safeCard = String(card_id || '').trim();
  const safeToken = String(token || '').trim();
  if (!safeCard || !safeToken) {
    throw new Error('Reward claim request is invalid');
  }

  if (!isBackendEnabled()) {
    const customer = getCustomersLocal(tenantId).find(
      (row) => String(row.card_id || '').toLowerCase() === safeCard.toLowerCase() && row.secret_token === safeToken,
    );
    if (!customer) throw new Error('Customer session is invalid');
    const settings = getDB<any>('settings').find((row) => row.tenant_id === tenantId)?.customer_app_settings || {};
    const threshold = Math.max(1, Number(settings.reward_threshold || 10));
    const allClaims = getDB<any>('reward_claims') || [];
    const tenantClaims = allClaims.filter((row) => String(row.tenant_id || '') === tenantId);
    const foreignClaims = allClaims.filter((row) => String(row.tenant_id || '') !== tenantId);
    const pendingCount = tenantClaims.filter((row) => row.card_id === customer.card_id && row.status === 'PENDING').length;
    const availableRewards = Math.max(0, Math.floor(Number(customer.stars || 0) / threshold) - pendingCount);
    if (availableRewards <= 0) throw new Error('No reward available to claim');
    const claimCode = `RW${uuidv4().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    const claim = {
      id: uuidv4(),
      tenant_id: tenantId,
      card_id: customer.card_id,
      claim_code: claimCode,
      reward_name: settings.reward_name || 'Reward',
      reward_description: settings.reward_description || '10 ulduza 1 pulsuz içki',
      points_cost: threshold,
      status: 'PENDING',
      created_at: new Date().toISOString(),
      reward_id,
    };
    setDB('reward_claims', [...foreignClaims, ...tenantClaims, claim]);
    send_notification({ card_ids: [customer.card_id], message: `Reward claim code hazırdır: ${claimCode}` });
    return { success: true, claim_code: claimCode, reward_name: claim.reward_name, points_cost: threshold, available_rewards: Math.max(0, availableRewards - 1) };
  }

  return apiRequest<{ success: boolean; claim_code: string; reward_name: string; points_cost: number; available_rewards: number }>(
    `/api/v1/ops/customer-app/rewards/claim?id=${encodeURIComponent(safeCard)}&t=${encodeURIComponent(safeToken)}`,
    {
      method: 'POST',
      tenantId: null,
      auth: false,
      body: { reward_id: reward_id || 'default-reward' },
    },
  );
}

export async function save_push_token_live(card_id: string, push_token: string, token: string, tenant_id?: string) {
  const tenantId = tenant_id || defaultTenant();
  const safeCard = String(card_id || '').trim();
  const safePushToken = String(push_token || '').trim();
  const safeToken = String(token || '').trim();
  if (!safeCard || !safePushToken || !safeToken) {
    return { success: false, message: 'Invalid payload' };
  }

  if (!isBackendEnabled()) {
    const customers = getCustomersLocal(tenantId);
    const customer = customers.find((c) => c.card_id.toLowerCase() === safeCard.toLowerCase());
    if (customer) {
      (customer as any).push_token = safePushToken;
      saveCustomersLocal(tenantId, customers);
    }
    return { success: true };
  }

  return apiRequest<{ success: boolean }>('/api/v1/ops/crm/push-token', {
    method: 'POST',
    tenantId: null,
    auth: false,
    body: {
      card_id: safeCard,
      push_token: safePushToken,
      token: safeToken
    }
  });
}

export async function send_customer_otp_live(phone: string) {
  if (!isBackendEnabled()) {
    console.log('[OTP SIMULATED] Sent OTP to', phone);
    return { success: true, message: 'Təsdiq kodu göndərildi (Simulyasiya)' };
  }
  return apiRequest<{ success: boolean; message: string }>('/api/v1/ops/customer-app/otp/send', {
    method: 'POST',
    tenantId: null,
    auth: false,
    body: { phone },
  });
}

export async function verify_customer_otp_live(
  phone: string,
  code: string,
  joinCustomerType: string = 'golden',
  joinDiscountPercent: number = 0,
) {
  if (!isBackendEnabled()) {
    if (code !== '1234') {
      throw new Error('Təsdiq kodu yanlışdır');
    }
    const card_id = `QR-SIM${phone.replace(/[^\d]/g, '').slice(-6)}`;
    const token = 'simulatedtoken';
    return { success: true, is_new: true, card_id, token };
  }
  return apiRequest<{ success: boolean; is_new: boolean; card_id: string; token: string }>('/api/v1/ops/customer-app/otp/verify', {
    method: 'POST',
    tenantId: null,
    auth: false,
    body: {
      phone,
      code,
      join_customer_type: joinCustomerType,
      join_discount_percent: joinDiscountPercent,
    },
  });
}

export async function analyze_customer_fortune_live(image_base64: string, card_id: string, token: string, lang: string = 'az') {
  if (!isBackendEnabled()) {
    const result = 'Fal isti tonlar görür. Bu, yaxın zamanda daha rahatlıq, dadlı seçimlər və özünü mükafatlandırmaq vaxtı deməkdir.';
    return Promise.resolve({ success: true, fortune: result, fallback: true });
  }

  return apiRequest<{ success: boolean; fortune: string; fallback?: boolean }>(
    `/api/v1/ops/customer-app/fortune/analyze?id=${encodeURIComponent(card_id)}&t=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      tenantId: null,
      auth: false,
      body: {
        image_base64,
        lang,
      },
    }
  );
}

export async function chat_customer_barista_live(messages: Array<{ role: string; content: string }>, card_id: string, token: string, lang: string = 'az') {
  if (!isBackendEnabled()) {
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    const lower = lastUserMsg.toLowerCase();
    const answer = lower.includes('soyuq') || lower.includes('cold')
      ? 'Sənə buzlu latte və ya meyvəli soyuq içki tövsiyə edirəm. Bonusun varsa bunu desertlə birləşdirmək yaxşı olar.'
      : lower.includes('güclü') || lower.includes('strong') || lower.includes('oyaq')
      ? 'Bugünkü ritmin üçün double espresso və ya daha güclü qəhvə bazalı içki yaxşı seçimdir.'
      : 'Mood-un üçün balanslı latte, yumşaq desert və mövcud reward-unla rahat combo ən uyğun seçimdir.';
    return Promise.resolve({ success: true, message: answer, fallback: true });
  }

  return apiRequest<{ success: boolean; message: string; fallback?: boolean }>(
    `/api/v1/ops/customer-app/barista/chat?id=${encodeURIComponent(card_id)}&t=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      tenantId: null,
      auth: false,
      body: {
        messages,
        lang,
      },
    }
  );
}

export function get_customer_wallet_pass_url(card_id: string, token: string, lang: string = 'az') {
  const base = getApiBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/api/v1/ops/customer-app/wallet-pass?id=${encodeURIComponent(card_id)}&t=${encodeURIComponent(token)}&lang=${encodeURIComponent(lang)}`;
}
