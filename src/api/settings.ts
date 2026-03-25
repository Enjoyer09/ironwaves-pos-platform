import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { Settings, User } from '../types/pos';
import { getActiveTenantId } from '../lib/tenant';

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
      print_settings: { use_qz: false, printer_name: '' },
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
        manager: ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'ai', 'menu', 'recipes'],
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
      manager: ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'ai', 'menu', 'recipes'],
      kitchen: ['kds']
    };
    saveSettings(s);
  }
  if (!s.print_settings) {
    s.print_settings = { use_qz: false, printer_name: '' };
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

export function update_print_settings(payload: { use_qz: boolean; printer_name: string }) {
  const settings = getSettings();
  settings.print_settings = payload;
  saveSettings(settings);
  logEvent('admin', 'PRINT_SETTINGS_UPDATED', payload);
  return { success: true };
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

export function get_business_profile(tenant_id?: string) {
  const resolvedTenant = resolveTenant(tenant_id);
  const profiles = getDB<any>('business_profile');
  const current = profiles.find((p) => p.tenant_id === resolvedTenant);
  if (current) return current;

  const created = {
    tenant_id: resolvedTenant,
    company_name: 'IRONWAVES POS',
    voen: '',
    phone: '',
    address: '',
    website: 'http://socialbee.ironwaves.store',
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

// --- İstifadəçi İdarəetməsi ---

export function create_user(payload: Omit<User, 'id' | 'failed_attempts' | 'is_locked' | 'lock_until'>) {
  const users = getDB<User>('users');
  
  const existing = users.find(u => u.username === payload.username || (u.pin && u.pin === payload.pin));
  if (existing) throw new Error('Bu istifadəçi adı və ya PIN artıq mövcuddur');

  if (payload.password && payload.password.length < 4) throw new Error('Şifrə minimum 4 simvol olmalıdır');

  // Gələcəkdə password bura girməmişdən öncə bcrypt ilə hash olunur
  const newUser: User = {
    id: uuidv4(),
    ...payload,
    two_factor_enabled: Boolean((payload as any).two_factor_enabled),
    failed_attempts: 0,
    is_locked: false
  };

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

export function update_user_credentials(
  username: string,
  updates: { password?: string; pin?: string; two_factor_enabled?: boolean },
  updated_by: string = 'admin'
) {
  const users = getDB<User>('users');
  const index = users.findIndex((u) => u.username === username);
  if (index === -1) throw new Error('İstifadəçi tapılmadı');

  if (updates.password && updates.password.length < 4) {
    throw new Error('Şifrə minimum 4 simvol olmalıdır');
  }
  if (updates.pin && (updates.pin.length < 4 || updates.pin.length > 15)) {
    throw new Error('PIN 4-15 rəqəm aralığında olmalıdır');
  }

  users[index] = {
    ...users[index],
    ...updates,
    two_factor_enabled:
      typeof updates.two_factor_enabled === 'boolean'
        ? updates.two_factor_enabled
        : users[index].two_factor_enabled,
  };
  setDB('users', users);
  logEvent(updated_by, 'USER_CREDENTIALS_UPDATED', { target_user: username });
  return true;
}
