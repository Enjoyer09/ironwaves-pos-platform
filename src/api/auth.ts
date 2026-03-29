// MODUL 1: AUTENTİFİKASİYA ÜÇÜN LOCAL STORE (BACKEND SİMULYASİYASI)
import { logEvent } from "../lib/logger";
import { getDB, setDB } from '../lib/db_sim';
import { getActiveTenantId } from '../lib/tenant';
import { LoginRiskContext } from '../lib/risk';
import { apiRequest, isBackendEnabled } from './client';
import { readScopedStorage, removeScopedStorage, writeScopedStorage } from '../lib/storage_keys';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 5;
const TRUST_WINDOW_DAYS = 14;

// Sadə JWT bənzəri token generator (real layihədə JWT)
const generateToken = () => Math.random().toString(36).substring(2) + Date.now().toString(36);

type TrustedAdminContext = {
  username: string;
  tenant_id: string;
  device_hash: string;
  ip: string;
  last_verified_at: string;
};

function getTrustedContexts(): TrustedAdminContext[] {
  try {
    const raw = readScopedStorage('trusted_admin_contexts');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setTrustedContexts(items: TrustedAdminContext[]) {
  writeScopedStorage('trusted_admin_contexts', JSON.stringify(items));
}

function getTrustedDeviceToken(): string {
  return String(readScopedStorage('trusted_admin_2fa_token') || '').trim();
}

function setTrustedDeviceToken(token: string) {
  const safe = String(token || '').trim();
  if (!safe) {
    removeScopedStorage('trusted_admin_2fa_token');
    return;
  }
  writeScopedStorage('trusted_admin_2fa_token', safe);
}

function isContextTrusted(username: string, tenant_id: string, ctx?: LoginRiskContext): boolean {
  if (!ctx?.device_hash) return false;
  const trusted = getTrustedContexts();
  const hit = trusted.find((t) =>
    t.username.toLowerCase() === username.toLowerCase() &&
    t.tenant_id === tenant_id &&
    t.device_hash === ctx.device_hash
  );
  if (!hit) return false;

  const last = new Date(hit.last_verified_at);
  const now = new Date();
  const maxAgeMs = TRUST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (Number.isNaN(last.getTime()) || now.getTime() - last.getTime() > maxAgeMs) return false;

  // If both IPs are known and changed, require 2FA again.
  if (ctx.ip && hit.ip && ctx.ip !== 'ip_unknown' && hit.ip !== 'ip_unknown' && ctx.ip !== hit.ip) {
    return false;
  }
  return true;
}

function trustContext(username: string, tenant_id: string, ctx?: LoginRiskContext) {
  if (!ctx?.device_hash) return;
  const trusted = getTrustedContexts();
  const nowIso = new Date().toISOString();
  const idx = trusted.findIndex((t) =>
    t.username.toLowerCase() === username.toLowerCase() &&
    t.tenant_id === tenant_id &&
    t.device_hash === ctx.device_hash
  );

  const next: TrustedAdminContext = {
    username,
    tenant_id,
    device_hash: ctx.device_hash,
    ip: ctx.ip || 'ip_unknown',
    last_verified_at: nowIso,
  };

  if (idx >= 0) trusted[idx] = next;
  else trusted.push(next);
  setTrustedContexts(trusted.slice(-100));
}

export const authApi = {
  reset_admin_lockout: (username: string) => {
    const normalized = String(username || '').trim().toLowerCase();
    if (!normalized) return { success: false };
    const attemptsKey = `failed_admin_attempts_${normalized}`;
    const lockKey = `admin_lockout_${normalized}`;
    localStorage.removeItem(attemptsKey);
    localStorage.removeItem(lockKey);
    return { success: true };
  },

  // Staff və manager üçün PIN login
  pin_login: async (pin: string, tenant_id: string = getActiveTenantId()) => {
    if (isBackendEnabled()) {
      const result = await apiRequest<any>('/api/v1/auth/pin-login', {
        method: 'POST',
        auth: false,
        tenantId: null,
        body: {
          pin: String(pin || ''),
          tenant_id: null,
        },
      });
      const backendUser = result?.user || {};
      const user = {
        username: backendUser.username,
        role: backendUser.role,
        tenant_id: backendUser.tenant_id || tenant_id || getActiveTenantId(),
      };

      logEvent(user.username, 'SUCCESSFUL_LOGIN', { role: user.role, tenant_id: user.tenant_id, method: 'PIN', backend: true });
      return {
        access_token: String(result?.access_token || ''),
        refresh_token: String(result?.refresh_token || ''),
        user,
      };
    }

    const attemptsKey = `failed_attempts_${tenant_id}_${pin}`;
    const lockKey = `lockout_time_${tenant_id}_${pin}`;
    const attemptsStr = localStorage.getItem(attemptsKey) || "0";
    const lockTimeStr = localStorage.getItem(lockKey);
    
    // Kilidlənməni yoxla
    if (lockTimeStr) {
      const lockTime = new Date(lockTimeStr);
      if (new Date() < lockTime) {
        throw new Error("Hesabınız kilidlənib. Zəhmət olmasa bir neçə dəqiqə gözləyin.");
      } else {
        localStorage.removeItem(lockKey);
        localStorage.removeItem(attemptsKey);
      }
    }

    // Bazadan yoxlama (yeni users cədvəli + legacy tenant key)
    const users = getDB<any>('users');
    const legacyUsers = getDB<any>(`${tenant_id}_users`);
    const dbUser = [...users, ...legacyUsers].find(
      (u: any) =>
        (u.pin === pin || u.pin_hash === pin) &&
        (u.tenant_id ? u.tenant_id === tenant_id : tenant_id === 'tenant_default') &&
        ['staff', 'kitchen'].includes(String(u.role || '').toLowerCase())
    );
    
    let user = null;
    if (dbUser) {
      user = { username: dbUser.username, role: dbUser.role, tenant_id: dbUser.tenant_id };
    }

    if (!user) {
      let attempts = parseInt(attemptsStr, 10) + 1;
      localStorage.setItem(attemptsKey, attempts.toString());
      
      logEvent("UNKNOWN", "FAILED_LOGIN", { pin_length: pin.length, attempts, tenant_id });

      if (attempts >= MAX_FAILED_ATTEMPTS) {
        const lockoutTime = new Date();
        lockoutTime.setMinutes(lockoutTime.getMinutes() + LOCKOUT_MINUTES);
        localStorage.setItem(lockKey, lockoutTime.toISOString());
        throw new Error(`5 uğursuz cəhd! Hesab ${LOCKOUT_MINUTES} dəqiqə kilidləndi.`);
      }
      throw new Error("Yanlış PIN kod");
    }

    // Uğurlu giriş - sıfırlama
    localStorage.removeItem(attemptsKey);
    localStorage.removeItem(lockKey);

    // İstifadəçi bazasında failed_attempts reset
    if (dbUser?.id) {
      const allUsers = getDB<any>('users');
      const idx = allUsers.findIndex((u) => u.id === dbUser.id);
      if (idx >= 0) {
        allUsers[idx].failed_attempts = 0;
        allUsers[idx].is_locked = false;
        setDB('users', allUsers);
      }
    }
    
    const access_token = generateToken();
    const refresh_token = generateToken();

    logEvent(user.username, "SUCCESSFUL_LOGIN", { role: user.role, tenant_id, method: "PIN" });

    return { access_token, refresh_token, user };
  },

  // Admin üçün username + password login
  password_login: async (
    username: string,
    password: string,
    second_factor_pin: string,
    tenant_id: string = getActiveTenantId(),
    risk_context?: LoginRiskContext,
    remember_device: boolean = true,
  ) => {
    if (isBackendEnabled()) {
      const result = await apiRequest<any>('/api/v1/auth/login', {
        method: 'POST',
        auth: false,
        tenantId: null,
        headers: {
          'x-device-hash': String(risk_context?.device_hash || ''),
          'x-trusted-device-token': getTrustedDeviceToken(),
        },
        body: {
          username: String(username || '').trim(),
          password: String(password || ''),
          second_factor_code: String(second_factor_pin || '').trim(),
          remember_device,
          tenant_id: null,
        },
      });

      const backendUser = result?.user || {};
      const user = {
        username: backendUser.username,
        role: backendUser.role,
        tenant_id: backendUser.tenant_id || tenant_id || getActiveTenantId(),
      };

      if (String(result?.trusted_device_token || '').trim()) {
        setTrustedDeviceToken(String(result.trusted_device_token));
      }

      logEvent(user.username, 'ADMIN_LOGIN', { method: 'PASSWORD', tenant_id: user.tenant_id, backend: true });
      return {
        access_token: String(result?.access_token || ''),
        refresh_token: String(result?.refresh_token || ''),
        user,
      };
    }

    const trimmedUser = String(username || '').trim();
    const trimmedPass = String(password || '');
    const trimmedPin = String(second_factor_pin || '').trim();
    if (!trimmedUser || !trimmedPass) {
      throw new Error('İstifadəçi adı və şifrə daxil edin');
    }

    const normalized = String(username || '').toLowerCase();
    const attemptsKey = `failed_admin_attempts_${normalized}`;
    const lockKey = `admin_lockout_${normalized}`;

    const lockUntil = localStorage.getItem(lockKey);
    if (lockUntil && new Date() < new Date(lockUntil)) {
      const remainingSec = Math.max(1, Math.ceil((new Date(lockUntil).getTime() - Date.now()) / 1000));
      throw new Error(`Hesab müvəqqəti kilidlənib. ${remainingSec} san sonra yenidən yoxlayın.`);
    }

    const users = getDB<any>('users');
    const dbUser = users.find(
      (u: any) =>
        String(u.username).toLowerCase() === String(trimmedUser).toLowerCase() &&
        (u.tenant_id ? u.tenant_id === tenant_id : tenant_id === 'tenant_default') &&
        ['admin', 'manager', 'super_admin'].includes(String(u.role || '').toLowerCase())
    );

    const isPasswordMatch = dbUser && String(dbUser.password || '') === trimmedPass;
    const requiredPin = String(dbUser?.pin || '').trim();
    const isTwoFactorEnabled = Boolean(dbUser?.two_factor_enabled);
    const trustedContext = isContextTrusted(trimmedUser, tenant_id, risk_context);
    const requiresSecondFactor = isTwoFactorEnabled && !trustedContext;
    const isSecondFactorValid = requiresSecondFactor ? requiredPin === trimmedPin : true;

    if (dbUser && isPasswordMatch && isSecondFactorValid) {
      localStorage.removeItem(attemptsKey);
      localStorage.removeItem(lockKey);
      const access_token = generateToken();
      const refresh_token = generateToken();
      const user = { username: dbUser.username, role: dbUser.role, tenant_id: dbUser.tenant_id || tenant_id };

      if (isTwoFactorEnabled) {
        trustContext(trimmedUser, tenant_id, risk_context);
      }

      logEvent(user.username, 'ADMIN_LOGIN', { method: 'PASSWORD', tenant_id: user.tenant_id });
      return { access_token, refresh_token, user };
    }

    const attempts = Number(localStorage.getItem(attemptsKey) || '0') + 1;
    localStorage.setItem(attemptsKey, String(attempts));
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const lockoutTime = new Date();
      lockoutTime.setMinutes(lockoutTime.getMinutes() + LOCKOUT_MINUTES);
      localStorage.setItem(lockKey, lockoutTime.toISOString());
    }
    logEvent(username, 'FAILED_ADMIN_LOGIN', {
      method: 'PASSWORD_2FA',
      attempts,
      tenant_id,
      has_2fa_pin: Boolean(trimmedPin),
      requires_2fa: requiresSecondFactor,
    });
    if (requiresSecondFactor && requiredPin.length < 4) {
      throw new Error('2FA aktivdir, amma PIN qurulmayıb. Ayarlar panelindən 2FA PIN təyin edin.');
    }
    if (requiresSecondFactor && !trimmedPin) {
      throw new Error('2FA_REQUIRED');
    }
    throw new Error('Yanlış istifadəçi adı, şifrə və ya 2FA PIN');
  },

  logout: async (token: string, username: string) => {
    const safeToken = String(token || '');
    if (isBackendEnabled()) {
      const tenantId = getActiveTenantId();
      await apiRequest('/api/v1/auth/logout', {
        method: 'POST',
        auth: false,
        tenantId,
        body: { refresh_token: safeToken },
      });
    }
    logEvent(username, "LOGOUT", { token_preview: safeToken.substring(0, 5) });
    return { success: true };
  },

  refresh_token: async (refresh_token: string, tenant_id: string = getActiveTenantId()) => {
    if (!isBackendEnabled()) {
      return null;
    }
    const result = await apiRequest<any>('/api/v1/auth/refresh', {
      method: 'POST',
      auth: false,
      tenantId: tenant_id,
      body: { refresh_token },
    });
    return {
      access_token: String(result?.access_token || ''),
      refresh_token: String(result?.refresh_token || ''),
      user: result?.user,
    };
  },

  me: async () => {
    if (!isBackendEnabled()) return null;
    return apiRequest<any>('/api/v1/auth/me', {
      method: 'GET',
      tenantId: null,
    });
  },

  platform_owner_bootstrap_status: async () => {
    if (!isBackendEnabled()) return { available: false };
    return apiRequest<{ available: boolean }>('/api/v1/auth/bootstrap-owner/status', {
      method: 'GET',
      auth: false,
      tenantId: null,
    });
  },

  bootstrap_platform_owner: async (username: string, password: string) => {
    if (!isBackendEnabled()) {
      throw new Error('Backend tələb olunur');
    }
    return apiRequest<any>('/api/v1/auth/bootstrap-owner', {
      method: 'POST',
      auth: false,
      tenantId: null,
      body: { username, password },
    });
  },
};
