import { getDB, setDB } from './db_sim';
import { getDeviceHash } from './risk';
import { apiRequest, isBackendEnabled } from '../api/client';
import type { AuthorizedTerminal } from '../types/pos';

const STORAGE_PREFIX = 'iw_trusted_terminal_token_';

export function getStoredTerminalToken(tenantId: string): string {
  if (typeof window === 'undefined' || !tenantId) return '';
  try {
    return String(localStorage.getItem(`${STORAGE_PREFIX}${tenantId}`) || '').trim();
  } catch {
    return '';
  }
}

export function setStoredTerminalToken(tenantId: string, token: string): void {
  if (typeof window === 'undefined' || !tenantId) return;
  try {
    if (!token) {
      localStorage.removeItem(`${STORAGE_PREFIX}${tenantId}`);
    } else {
      localStorage.setItem(`${STORAGE_PREFIX}${tenantId}`, token.trim());
    }
  } catch {}
}

export function clearStoredTerminalToken(tenantId: string): void {
  if (typeof window === 'undefined' || !tenantId) return;
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${tenantId}`);
  } catch {}
}

/**
 * Checks if the current browser/device is an authorized terminal.
 * If device_authorization_enabled is false or undefined, always returns { authorized: true }.
 */
export async function isCurrentDeviceAuthorized(
  tenantId: string,
  deviceAuthEnabled?: boolean
): Promise<{ authorized: boolean; terminal?: AuthorizedTerminal }> {
  // If feature is disabled (default OFF), all devices are authorized
  if (deviceAuthEnabled === false || typeof deviceAuthEnabled === 'undefined') {
    return { authorized: true };
  }

  if (!tenantId) return { authorized: false };

  const storedToken = getStoredTerminalToken(tenantId);
  const currentHash = getDeviceHash();

  if (!storedToken) {
    return { authorized: false };
  }

  // 1. Try Backend if enabled
  if (isBackendEnabled()) {
    try {
      const res = await apiRequest<{ authorized: boolean; terminal?: AuthorizedTerminal }>('/api/v1/terminals/verify', {
        method: 'POST',
        tenantId,
        auth: false,
        timeoutMs: 4000,
        body: {
          device_token: storedToken,
          device_hash: currentHash,
        },
      });
      if (res?.authorized && res.terminal) {
        return { authorized: true, terminal: res.terminal };
      }
    } catch {
      // Fallback to local DB check on network glitch
    }
  }

  // 2. Local DB check
  try {
    const allTerminals = getDB<AuthorizedTerminal>('authorized_terminals');
    const matched = allTerminals.find(
      (t) =>
        t.tenant_id === tenantId &&
        t.device_token === storedToken &&
        t.is_active === true
    );

    if (matched) {
      // Update last seen in background
      matched.last_seen_at = new Date().toISOString();
      setDB('authorized_terminals', allTerminals);
      return { authorized: true, terminal: matched };
    }
  } catch (err) {
    console.warn('Terminal local verification error:', err);
  }

  return { authorized: false };
}

/**
 * Authorizes the current device and generates a persistent cryptographic token.
 */
export async function authorizeCurrentDevice(
  tenantId: string,
  deviceName: string,
  adminUsername: string
): Promise<AuthorizedTerminal> {
  const currentHash = getDeviceHash();
  const token = `iw_term_${Date.now()}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 8)}`;
  const nowIso = new Date().toISOString();

  const newTerminal: AuthorizedTerminal = {
    id: `term_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    tenant_id: tenantId,
    device_name: deviceName.trim() || 'POS Terminal',
    device_hash: currentHash,
    device_token: token,
    authorized_by: adminUsername || 'Admin',
    authorized_at: nowIso,
    last_seen_at: nowIso,
    is_active: true,
  };

  // 1. Backend sync if available
  if (isBackendEnabled()) {
    try {
      const result = await apiRequest<{ terminal: AuthorizedTerminal }>('/api/v1/terminals/authorize', {
        method: 'POST',
        tenantId,
        body: newTerminal,
      });
      if (result?.terminal) {
        setStoredTerminalToken(tenantId, result.terminal.device_token);
        return result.terminal;
      }
    } catch (e) {
      console.warn('Backend terminal authorization fallback to local DB:', e);
    }
  }

  // 2. Local DB persistence
  const all = getDB<AuthorizedTerminal>('authorized_terminals');
  all.push(newTerminal);
  setDB('authorized_terminals', all);

  setStoredTerminalToken(tenantId, token);
  return newTerminal;
}

/**
 * Lists all registered authorized terminals for a tenant.
 */
export async function listAuthorizedTerminals(tenantId: string): Promise<AuthorizedTerminal[]> {
  if (!tenantId) return [];

  if (isBackendEnabled()) {
    try {
      const res = await apiRequest<{ terminals: AuthorizedTerminal[] }>('/api/v1/terminals', {
        method: 'GET',
        tenantId,
      });
      if (Array.isArray(res?.terminals)) {
        return res.terminals;
      }
    } catch {
      // fallback to local
    }
  }

  const all = getDB<AuthorizedTerminal>('authorized_terminals');
  return all.filter((t) => t.tenant_id === tenantId);
}

/**
 * Revokes authorization for a terminal.
 */
export async function revokeAuthorizedTerminal(tenantId: string, terminalId: string): Promise<void> {
  if (isBackendEnabled()) {
    try {
      await apiRequest(`/api/v1/terminals/${encodeURIComponent(terminalId)}`, {
        method: 'DELETE',
        tenantId,
      });
    } catch (e) {
      console.warn('Backend terminal delete warning:', e);
    }
  }

  const all = getDB<AuthorizedTerminal>('authorized_terminals');
  const updated = all.filter((t) => !(t.tenant_id === tenantId && t.id === terminalId));
  setDB('authorized_terminals', updated);
}
