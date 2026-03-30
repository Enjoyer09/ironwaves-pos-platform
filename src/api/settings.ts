import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { Settings, User } from '../types/pos';
import { getActiveTenantId } from '../lib/tenant';
import { apiRequest, isBackendEnabled } from './client';
import { hashLocalCredential } from '../lib/local_auth';

const resolveTenant = (tenant_id?: string) => tenant_id || getActiveTenantId();

// Mərkəzi settings obyektini tapmaq (ya da yaratmaq) üçün kiçik helper:
function getSettings(tenant_id?: string): Settings {
  const resolvedTenant = resolveTenant(tenant_id);
  let settingsArr = getDB<Settings>('settings');
  const current = settingsArr.find((s) => s.tenant_id === resolvedTenant);
  if (current) return current;

  if (settingsArr.length === 0 || !current) {
    const defaultSettings: Settings = {
      tenant_id: resolvedTenant,
      service_fee_percent: 0,
      ui_visibility: { staff_show_tables: true, manager_show_tables: true, staff_show_kitchen: true },
      time_settings: { shift_start_time: '08:00', shift_end_time: '23:00', utc_offset: 4, timezone: 'Asia/Baku' },
      email_settings: {
        enabled: false,
        provider: 'none',
        resend_api_key: '',
        sender_email: '',
        recipient_emails: [],
        webhook_url: '',
        timeout_sec: 15,
      },
      bank_commission: { min_amount: 0.10, percent: 1.5 },
      inventory_settings: {
        default_critical_threshold: 5,
        unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
      },
      staff_benefits: {
        daily_limit_azn: 6,
        allowed_scope: 'all',
        included_categories: [],
        included_items: [],
        item_unit_cap_azn: 6,
      },
      print_settings: { use_qz: false, printer_name: '' },
      qr_settings: { base_url: '' },
      customer_app_settings: {
        enabled: true,
        program_mode: 'points',
        layout_preset: 'rewards',
        app_name: 'Loyalty Club',
        hero_title: 'Xoş gəldiniz',
        hero_subtitle: 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.',
        hero_image_url: '',
        background_image_url: '',
        points_label: 'Ulduz',
        reward_name: 'Reward',
        reward_threshold: 10,
        reward_description: '10 ulduza 1 pulsuz içki',
        cashback_percent: 5,
        primary_color: '#facc15',
        accent_color: '#22d3ee',
        show_qr_card: true,
        show_wallet: true,
        ai_barista_enabled: false,
        ai_falci_enabled: false,
        show_campaigns: true,
        show_history: true,
        show_notifications: true,
      },
      omnitech_settings: {
        enabled: false,
        api_base_url: '',
        api_key: '',
        merchant_id: '',
        terminal_id: '',
        fiscal_device_id: ''
      },
      role_modules: {
        staff: ['pos', 'tables', 'kds', 'zreport'],
        manager: ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'ai', 'menu', 'recipes'],
        kitchen: ['kds']
      }
    };
    settingsArr.push(defaultSettings);
    setDB('settings', settingsArr);
    return defaultSettings;
  }
  return settingsArr[0];
}

function saveSettings(settings: Settings) {
  const all = getDB<Settings>('settings');
  const idx = all.findIndex((s) => s.tenant_id === settings.tenant_id);
  if (idx >= 0) {
    all[idx] = settings;
  } else {
    all.push(settings);
  }
  setDB('settings', all);
}

export function update_service_fee(percent: number) {
  const settings = getSettings();
  settings.service_fee_percent = percent;
  saveSettings(settings);
  logEvent('admin', 'SERVICE_FEE_UPDATE', { percent });
  return { success: true, service_fee_percent: percent };
}

export function update_ui_visibility(payload: { staff_show_tables: boolean; manager_show_tables: boolean; staff_show_kitchen: boolean }) {
  const settings = getSettings();
  settings.ui_visibility = payload;
  saveSettings(settings);
  logEvent('admin', 'UI_SETTINGS_UPDATE', {});
  return { success: true };
}

export function update_time_settings(payload: { shift_start_time: string; shift_end_time: string; utc_offset: number; timezone: string }) {
  const settings = getSettings();
  settings.time_settings = payload;
  saveSettings(settings);
  logEvent('admin', 'TIME_SETTINGS_UPDATE', {});
  return { success: true };
}

export function update_email_settings(payload: {
  enabled?: boolean;
  provider?: 'none' | 'resend' | 'webhook';
  resend_api_key?: string;
  sender_email?: string;
  recipient_emails?: string[];
  webhook_url?: string;
  timeout_sec?: number;
}) {
  const settings = getSettings();
  settings.email_settings = {
    enabled: Boolean(payload.enabled),
    provider: payload.provider || 'none',
    resend_api_key: payload.resend_api_key || '',
    sender_email: payload.sender_email || '',
    recipient_emails: payload.recipient_emails || [],
    webhook_url: payload.webhook_url || '',
    timeout_sec: Number.isFinite(payload.timeout_sec as number)
      ? Math.max(5, Number(payload.timeout_sec))
      : 15,
  };
  saveSettings(settings);
  logEvent('admin', 'REPORT_EMAIL_SETTINGS_UPDATED', {
    enabled: settings.email_settings.enabled,
    provider: settings.email_settings.provider,
    sender: settings.email_settings.sender_email,
    recipients: settings.email_settings.recipient_emails,
  });
  return { success: true };
}

export function update_bank_commission(payload: { min_amount: number; percent: number }) {
  const settings = getSettings();
  settings.bank_commission = payload;
  saveSettings(settings);
  logEvent('admin', 'BANK_COMMISSION_UPDATE', payload);
  return { success: true };
}

export function get_settings(tenant_id?: string) {
  const s = getSettings(tenant_id);
  if (!s.role_modules) {
    s.role_modules = {
      staff: ['pos', 'tables', 'kds', 'zreport'],
      manager: ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'ai', 'menu', 'recipes'],
      kitchen: ['kds']
    };
    saveSettings(s);
  }
  if (!s.print_settings) {
    s.print_settings = { use_qz: false, printer_name: '' };
    saveSettings(s);
  }
  if (!s.qr_settings) {
    s.qr_settings = { base_url: '' };
    saveSettings(s);
  }
  if (!s.customer_app_settings) {
    s.customer_app_settings = {
      enabled: true,
      program_mode: 'points',
      layout_preset: 'rewards',
      app_name: 'Loyalty Club',
      hero_title: 'Xoş gəldiniz',
      hero_subtitle: 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.',
      hero_image_url: '',
      background_image_url: '',
      points_label: 'Ulduz',
      reward_name: 'Reward',
      reward_threshold: 10,
      reward_description: '10 ulduza 1 pulsuz içki',
      cashback_percent: 5,
      primary_color: '#facc15',
      accent_color: '#22d3ee',
      show_qr_card: true,
      show_wallet: true,
      ai_barista_enabled: false,
      ai_falci_enabled: false,
      show_campaigns: true,
      show_history: true,
      show_notifications: true,
    };
    saveSettings(s);
  }
  if (!s.omnitech_settings) {
    s.omnitech_settings = {
      enabled: false,
      api_base_url: '',
      api_key: '',
      merchant_id: '',
      terminal_id: '',
      fiscal_device_id: ''
    };
    saveSettings(s);
  }
  if (!s.email_settings) {
    s.email_settings = {
      enabled: false,
      provider: 'none',
      resend_api_key: '',
      sender_email: '',
      recipient_emails: [],
      webhook_url: '',
      timeout_sec: 15,
    };
    saveSettings(s);
  } else {
    s.email_settings = {
      enabled: Boolean(s.email_settings.enabled),
      provider: (s.email_settings.provider as any) || 'none',
      resend_api_key: s.email_settings.resend_api_key || '',
      sender_email: s.email_settings.sender_email || '',
      recipient_emails: s.email_settings.recipient_emails || [],
      webhook_url: (s.email_settings as any).webhook_url || '',
      timeout_sec: Number((s.email_settings as any).timeout_sec || 15),
    };
    saveSettings(s);
  }
  if (!s.inventory_settings) {
    s.inventory_settings = {
      default_critical_threshold: 5,
      unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
    };
    saveSettings(s);
  }
  if (!s.staff_benefits) {
    s.staff_benefits = {
      daily_limit_azn: 6,
      allowed_scope: 'all',
      included_categories: [],
      included_items: [],
      item_unit_cap_azn: 6,
    };
    saveSettings(s);
  } else if (!(s.staff_benefits as any).allowed_scope) {
    s.staff_benefits = {
      daily_limit_azn: Number((s.staff_benefits as any).daily_limit_azn ?? 6),
      allowed_scope: 'all',
      included_categories: [],
      included_items: [],
      item_unit_cap_azn: Number((s.staff_benefits as any).non_coffee_unit_cap_azn ?? 6),
    };
    saveSettings(s);
  }
  return s;
}

export function update_inventory_settings(payload: { default_critical_threshold: number; unit_options: string[] }) {
  const settings = getSettings();
  const cleanUnits = Array.from(new Set((payload.unit_options || []).map((u) => String(u || '').trim()).filter(Boolean)));
  settings.inventory_settings = {
    default_critical_threshold: Number.isFinite(payload.default_critical_threshold)
      ? Math.max(0, Number(payload.default_critical_threshold))
      : 5,
    unit_options: cleanUnits.length ? cleanUnits : ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
  };
  saveSettings(settings);
  logEvent('admin', 'INVENTORY_SETTINGS_UPDATED', settings.inventory_settings);
  return { success: true, inventory_settings: settings.inventory_settings };
}

export function update_staff_benefits(payload: {
  daily_limit_azn: number;
  allowed_scope: 'all' | 'categories' | 'items';
  included_categories: string[];
  included_items: string[];
  item_unit_cap_azn: number;
}) {
  const settings = getSettings();
  settings.staff_benefits = {
    daily_limit_azn: Number.isFinite(payload.daily_limit_azn) ? Math.max(0, Number(payload.daily_limit_azn)) : 6,
    allowed_scope: payload.allowed_scope || 'all',
    included_categories: Array.from(new Set((payload.included_categories || []).map((v) => String(v || '').trim()).filter(Boolean))),
    included_items: Array.from(new Set((payload.included_items || []).map((v) => String(v || '').trim()).filter(Boolean))),
    item_unit_cap_azn: Number.isFinite(payload.item_unit_cap_azn)
      ? Math.max(0, Number(payload.item_unit_cap_azn))
      : 6,
  };
  saveSettings(settings);
  logEvent('admin', 'STAFF_BENEFITS_UPDATED', settings.staff_benefits);
  return { success: true, staff_benefits: settings.staff_benefits };
}

export function update_print_settings(payload: { use_qz: boolean; printer_name: string }) {
  const settings = getSettings();
  settings.print_settings = payload;
  saveSettings(settings);
  logEvent('admin', 'PRINT_SETTINGS_UPDATED', payload);
  return { success: true };
}

export function update_qr_settings(payload: { base_url: string }) {
  const settings = getSettings();
  settings.qr_settings = {
    base_url: String(payload.base_url || '').trim(),
  };
  saveSettings(settings);
  logEvent('admin', 'QR_SETTINGS_UPDATED', settings.qr_settings);
  return { success: true };
}

export function update_customer_app_settings(payload: {
  enabled: boolean;
  program_mode?: 'points' | 'cashback';
  layout_preset?: 'rewards' | 'cashback' | 'playful';
  app_name: string;
  hero_title: string;
  hero_subtitle: string;
  hero_image_url?: string;
  background_image_url?: string;
  points_label: string;
  reward_name: string;
  reward_threshold: number;
  reward_description: string;
  cashback_percent?: number;
  primary_color: string;
  accent_color: string;
  show_qr_card?: boolean;
  show_wallet?: boolean;
  ai_barista_enabled?: boolean;
  ai_falci_enabled?: boolean;
  show_campaigns: boolean;
  show_history: boolean;
  show_notifications: boolean;
}) {
  const settings = getSettings();
  settings.customer_app_settings = {
    enabled: Boolean(payload.enabled),
    program_mode: payload.program_mode === 'cashback' ? 'cashback' : 'points',
    layout_preset: payload.layout_preset === 'cashback' || payload.layout_preset === 'playful' ? payload.layout_preset : 'rewards',
    app_name: String(payload.app_name || '').trim() || 'Loyalty Club',
    hero_title: String(payload.hero_title || '').trim() || 'Xoş gəldiniz',
    hero_subtitle: String(payload.hero_subtitle || '').trim() || 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.',
    hero_image_url: String(payload.hero_image_url || '').trim(),
    background_image_url: String(payload.background_image_url || '').trim(),
    points_label: String(payload.points_label || '').trim() || 'Ulduz',
    reward_name: String(payload.reward_name || '').trim() || 'Reward',
    reward_threshold: Number.isFinite(payload.reward_threshold) ? Math.max(1, Number(payload.reward_threshold)) : 10,
    reward_description: String(payload.reward_description || '').trim() || '10 ulduza 1 pulsuz içki',
    cashback_percent: Number.isFinite(payload.cashback_percent) ? Math.max(0, Number(payload.cashback_percent)) : 5,
    primary_color: String(payload.primary_color || '').trim() || '#facc15',
    accent_color: String(payload.accent_color || '').trim() || '#22d3ee',
    show_qr_card: payload.show_qr_card !== false,
    show_wallet: payload.show_wallet !== false,
    ai_barista_enabled: payload.ai_barista_enabled === true,
    ai_falci_enabled: payload.ai_falci_enabled === true,
    show_campaigns: Boolean(payload.show_campaigns),
    show_history: Boolean(payload.show_history),
    show_notifications: Boolean(payload.show_notifications),
  };
  saveSettings(settings);
  logEvent('admin', 'CUSTOMER_APP_SETTINGS_UPDATED', settings.customer_app_settings);
  return { success: true, customer_app_settings: settings.customer_app_settings };
}

export function update_omnitech_settings(payload: {
  enabled: boolean;
  api_base_url: string;
  api_key: string;
  merchant_id: string;
  terminal_id: string;
  fiscal_device_id: string;
}) {
  const settings = getSettings();
  settings.omnitech_settings = {
    enabled: Boolean(payload.enabled),
    api_base_url: (payload.api_base_url || '').trim(),
    api_key: payload.api_key || '',
    merchant_id: (payload.merchant_id || '').trim(),
    terminal_id: (payload.terminal_id || '').trim(),
    fiscal_device_id: (payload.fiscal_device_id || '').trim(),
  };
  saveSettings(settings);
  logEvent('admin', 'OMNITECH_SETTINGS_UPDATED', {
    enabled: settings.omnitech_settings.enabled,
    api_base_url: settings.omnitech_settings.api_base_url,
    merchant_id: settings.omnitech_settings.merchant_id,
    terminal_id: settings.omnitech_settings.terminal_id,
    fiscal_device_id: settings.omnitech_settings.fiscal_device_id,
  });
  return { success: true };
}

export function update_role_modules(payload: { staff: string[]; manager: string[]; kitchen: string[] }) {
  const settings = getSettings();
  settings.role_modules = payload;
  saveSettings(settings);
  logEvent('admin', 'ROLE_MODULES_UPDATED', payload);
  return { success: true };
}

export async function get_settings_live(tenant_id?: string) {
  if (!isBackendEnabled()) return get_settings(tenant_id);
  const data = await apiRequest<Settings>('/api/v1/ops/settings', { tenantId: null });
  saveSettings(data);
  return data;
}

export async function update_qr_settings_live(payload: { base_url: string }) {
  if (!isBackendEnabled()) return update_qr_settings(payload);
  await apiRequest('/api/v1/ops/settings/qr-settings', { method: 'PATCH', tenantId: null, body: payload });
  update_qr_settings(payload);
  return { success: true };
}

export async function update_customer_app_settings_live(payload: {
  enabled: boolean;
  program_mode?: 'points' | 'cashback';
  layout_preset?: 'rewards' | 'cashback' | 'playful';
  app_name: string;
  hero_title: string;
  hero_subtitle: string;
  hero_image_url?: string;
  background_image_url?: string;
  points_label: string;
  reward_name: string;
  reward_threshold: number;
  reward_description: string;
  cashback_percent?: number;
  primary_color: string;
  accent_color: string;
  show_qr_card?: boolean;
  show_wallet?: boolean;
  ai_barista_enabled?: boolean;
  ai_falci_enabled?: boolean;
  show_campaigns: boolean;
  show_history: boolean;
  show_notifications: boolean;
}) {
  if (!isBackendEnabled()) return update_customer_app_settings(payload);
  await apiRequest('/api/v1/ops/settings/customer-app', { method: 'PATCH', tenantId: null, body: payload });
  update_customer_app_settings(payload);
  return { success: true };
}

export async function update_role_modules_live(payload: { staff: string[]; manager: string[]; kitchen: string[] }) {
  if (!isBackendEnabled()) return update_role_modules(payload);
  await apiRequest('/api/v1/ops/settings/role-modules', { method: 'PATCH', tenantId: null, body: payload });
  const settings = getSettings();
  settings.role_modules = payload;
  saveSettings(settings);
  return { success: true };
}

export async function update_email_settings_live(payload: {
  enabled?: boolean;
  provider?: 'none' | 'resend' | 'webhook';
  resend_api_key?: string;
  sender_email?: string;
  recipient_emails?: string[];
  webhook_url?: string;
  timeout_sec?: number;
}) {
  if (!isBackendEnabled()) return update_email_settings(payload);
  await apiRequest('/api/v1/ops/settings/email-settings', { method: 'PATCH', tenantId: null, body: payload });
  update_email_settings(payload);
  return { success: true };
}

export async function update_staff_benefits_live(payload: {
  daily_limit_azn: number;
  allowed_scope: 'all' | 'categories' | 'items';
  included_categories: string[];
  included_items: string[];
  item_unit_cap_azn: number;
}) {
  if (!isBackendEnabled()) return update_staff_benefits(payload);
  await apiRequest('/api/v1/ops/settings/staff-benefits', { method: 'PATCH', tenantId: null, body: payload });
  update_staff_benefits(payload);
  return { success: true };
}

export async function setup_totp_live() {
  if (!isBackendEnabled()) {
    throw new Error('Google Authenticator yalnız backend aktiv olduqda qoşula bilər');
  }
  return apiRequest<{ secret: string; otpauth_url: string }>('/api/v1/settings/2fa/totp/setup', {
    method: 'POST',
    tenantId: null,
  });
}

export async function verify_totp_live(code: string) {
  if (!isBackendEnabled()) {
    throw new Error('Google Authenticator yalnız backend aktiv olduqda qoşula bilər');
  }
  await apiRequest('/api/v1/settings/2fa/totp/verify', {
    method: 'POST',
    tenantId: null,
    body: { code: String(code || '').trim() },
  });
  return { success: true };
}

export async function disable_totp_live(current_password: string) {
  if (!isBackendEnabled()) {
    throw new Error('Google Authenticator yalnız backend aktiv olduqda söndürülə bilər');
  }
  await apiRequest('/api/v1/settings/2fa/totp/disable', {
    method: 'POST',
    tenantId: null,
    body: { current_password: String(current_password || '') },
  });
  return { success: true };
}

export function get_business_profile(tenant_id?: string) {
  const resolvedTenant = resolveTenant(tenant_id);
  const profiles = getDB<any>('business_profile');
  const current = profiles.find((p) => p.tenant_id === resolvedTenant);
  if (current) return current;

  const created = {
    tenant_id: resolvedTenant,
    company_name: 'iRonWaves POS RC',
    voen: '',
    phone: '',
    address: '',
    website: 'https://super.ironwaves.store',
    logo_url: '',
    receipt_footer: 'Bizi secdiyiniz ucun tesekkur edirik!'
  };
  profiles.push(created);
  setDB('business_profile', profiles);
  return created;
}

export function update_business_profile(tenant_id: string, payload: {
  company_name: string;
  voen: string;
  phone: string;
  address?: string;
  website: string;
  logo_url?: string;
  receipt_footer?: string;
}, updated_by: string = 'admin') {
  const profiles = getDB<any>('business_profile');
  const resolvedTenant = resolveTenant(tenant_id);
  const idx = profiles.findIndex((p) => p.tenant_id === resolvedTenant);
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...payload };
  } else {
    profiles.push({ tenant_id: resolvedTenant, ...payload });
  }
  setDB('business_profile', profiles);
  logEvent(updated_by, 'BUSINESS_PROFILE_UPDATED', { tenant_id: resolvedTenant });
  return true;
}

export async function get_business_profile_live(tenant_id?: string) {
  if (!isBackendEnabled()) return get_business_profile(tenant_id);
  const data = await apiRequest<any>('/api/v1/ops/business-profile', { tenantId: null });
  const profiles = getDB<any>('business_profile');
  const resolvedTenant = resolveTenant(tenant_id);
  const idx = profiles.findIndex((p) => p.tenant_id === resolvedTenant);
  if (idx >= 0) profiles[idx] = data;
  else profiles.push(data);
  setDB('business_profile', profiles);
  return data;
}

export async function get_public_branding_live(tenant_id?: string) {
  if (!isBackendEnabled()) return get_business_profile(tenant_id);
  const data = await apiRequest<any>('/api/v1/ops/public-branding', { tenantId: null, auth: false });
  const profiles = getDB<any>('business_profile');
  const resolvedTenant = resolveTenant(tenant_id);
  const idx = profiles.findIndex((p) => p.tenant_id === resolvedTenant);
  if (idx >= 0) profiles[idx] = { ...profiles[idx], ...data };
  else profiles.push(data);
  setDB('business_profile', profiles);
  return data;
}

export async function update_business_profile_live(tenant_id: string, payload: {
  company_name: string;
  voen: string;
  phone: string;
  address?: string;
  website: string;
  logo_url?: string;
  receipt_footer?: string;
}, updated_by: string = 'admin') {
  if (!isBackendEnabled()) return update_business_profile(tenant_id, payload, updated_by);
  await apiRequest('/api/v1/ops/business-profile', { method: 'PUT', tenantId: null, body: payload });
  update_business_profile(tenant_id, payload, updated_by);
  return true;
}

// --- İstifadəçi İdarəetməsi ---

export async function create_user(payload: Omit<User, 'id' | 'failed_attempts' | 'is_locked' | 'lock_until'>) {
  const users = getDB<User>('users');
  const role = String(payload.role || '').toLowerCase();
  const usesPassword = ['admin', 'manager', 'super_admin'].includes(role);
  const usesPin = ['staff', 'kitchen'].includes(role);
  
  const existing = users.find(u => u.username === payload.username || (u.pin && u.pin === payload.pin));
  if (existing) throw new Error('Bu istifadəçi adı və ya PIN artıq mövcuddur');

  if (usesPassword && (!payload.password || payload.password.length < 4)) throw new Error('Şifrə minimum 4 simvol olmalıdır');
  if (usesPin && (!payload.pin || payload.pin.length < 4 || payload.pin.length > 15)) throw new Error('PIN 4-15 rəqəm aralığında olmalıdır');
  if (usesPassword && payload.pin) throw new Error('Admin/Manager yalnız şifrə ilə giriş etməlidir');
  if (usesPin && payload.password) throw new Error('Staff/Kitchen yalnız PIN ilə giriş etməlidir');

  // Gələcəkdə password bura girməmişdən öncə bcrypt ilə hash olunur
  const newUser: User = {
    id: uuidv4(),
    ...payload,
    password: undefined,
    pin: undefined,
    two_factor_enabled: Boolean((payload as any).two_factor_enabled),
    failed_attempts: 0,
    is_locked: false
  };
  if (usesPassword) {
    (newUser as any).password_hash = await hashLocalCredential(String(payload.password || ''));
  }
  if (usesPin) {
    (newUser as any).pin_hash = await hashLocalCredential(String(payload.pin || ''));
  }

  users.push(newUser);
  setDB('users', users);

  logEvent('admin', 'USER_UPSERT', { target_user: payload.username, role: payload.role });
  return newUser;
}

export function delete_user(username: string) {
  let users = getDB<User>('users');
  if (username === 'admin' || username === 'super_admin') throw new Error('Əsas admin silinə bilməz!');

  const userExists = users.some(u => u.username === username);
  if (!userExists) throw new Error('İstifadəçi tapılmadı');

  users = users.filter(u => u.username !== username);
  setDB('users', users);

  logEvent('admin', 'USER_DELETE', { target_user: username });
  return { success: true };
}

export function get_users(tenant_id?: string) {
  const resolvedTenant = resolveTenant(tenant_id);
  return getDB<User>('users').filter((u) => u.tenant_id === resolvedTenant);
}

export async function update_user_credentials(
  username: string,
  updates: { password?: string; pin?: string; two_factor_enabled?: boolean },
  updated_by: string = 'admin'
) {
  const users = getDB<User>('users');
  const index = users.findIndex((u) => u.username === username);
  if (index === -1) throw new Error('İstifadəçi tapılmadı');
  const role = String(users[index].role || '').toLowerCase();
  const usesPassword = ['admin', 'manager', 'super_admin'].includes(role);
  const usesPin = ['staff', 'kitchen'].includes(role);

  if (updates.password && updates.password.length < 4) {
    throw new Error('Şifrə minimum 4 simvol olmalıdır');
  }
  if (updates.pin && (updates.pin.length < 4 || updates.pin.length > 15)) {
    throw new Error('PIN 4-15 rəqəm aralığında olmalıdır');
  }
  if (updates.password !== undefined && !usesPassword) {
    throw new Error('Bu rol şifrə ilə giriş etmir');
  }
  if (updates.pin !== undefined && !usesPin) {
    throw new Error('Bu rol PIN ilə giriş etmir');
  }

  const nextUser: any = {
    ...users[index],
    ...updates,
    two_factor_enabled:
      typeof updates.two_factor_enabled === 'boolean'
        ? updates.two_factor_enabled
        : users[index].two_factor_enabled,
  };
  if (usesPassword && updates.password !== undefined) {
    nextUser.password_hash = await hashLocalCredential(updates.password);
    delete nextUser.password;
  }
  if (usesPin && updates.pin !== undefined) {
    nextUser.pin_hash = await hashLocalCredential(updates.pin);
    delete nextUser.pin;
  }
  users[index] = nextUser;
  setDB('users', users);
  logEvent(updated_by, 'USER_CREDENTIALS_UPDATED', { target_user: username });
  return true;
}

type BackendUserRecord = {
  id: string;
  tenant_id: string;
  username: string;
  role: 'super_admin' | 'admin' | 'manager' | 'staff' | 'kitchen';
  two_factor_enabled?: boolean;
  is_active?: boolean;
};

export async function get_users_live(tenant_id?: string): Promise<User[]> {
  if (!isBackendEnabled()) {
    return get_users(tenant_id);
  }
  const rows = await apiRequest<BackendUserRecord[]>('/api/v1/settings/users', { method: 'GET', tenantId: null });
  return rows.map((u) => ({
    id: u.id,
    tenant_id: u.tenant_id,
    username: u.username,
    role: u.role,
    two_factor_enabled: Boolean(u.two_factor_enabled),
    failed_attempts: 0,
    is_locked: false,
  }));
}

export async function create_user_live(
  payload: Omit<User, 'id' | 'failed_attempts' | 'is_locked' | 'lock_until'>
): Promise<User> {
  if (!isBackendEnabled()) {
    return create_user(payload);
  }
  const created = await apiRequest<BackendUserRecord>('/api/v1/settings/users', {
    method: 'POST',
    tenantId: null,
    body: payload,
  });
  return {
    id: created.id,
    tenant_id: created.tenant_id,
    username: created.username,
    role: created.role,
    two_factor_enabled: Boolean(created.two_factor_enabled),
    failed_attempts: 0,
    is_locked: false,
  };
}

export async function delete_user_live(username: string): Promise<{ success: boolean }> {
  if (!isBackendEnabled()) {
    return delete_user(username);
  }
  return apiRequest<{ success: boolean }>(`/api/v1/settings/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    tenantId: null,
  });
}

export async function update_user_credentials_live(
  username: string,
  updates: { password?: string; pin?: string; two_factor_enabled?: boolean; current_password?: string },
  updated_by: string = 'admin'
): Promise<boolean> {
  if (!isBackendEnabled()) {
    return update_user_credentials(username, updates, updated_by);
  }
  await apiRequest<{ success: boolean }>(`/api/v1/settings/users/${encodeURIComponent(username)}/credentials`, {
    method: 'PATCH',
    tenantId: null,
    body: updates,
  });
  return true;
}

export async function update_api_key_live(api_key: string) {
  if (!isBackendEnabled()) {
    const settings = getSettings();
    settings.gemini_api_key = api_key;
    saveSettings(settings);
    return { success: true };
  }
  await apiRequest('/api/v1/ops/settings/gemini-key', {
    method: 'PATCH',
    tenantId: null,
    body: { api_key },
  });
  const settings = getSettings();
  settings.gemini_api_key = api_key;
  saveSettings(settings);
  return { success: true };
}
