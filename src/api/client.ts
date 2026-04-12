import { readScopedStorage } from '../lib/storage_keys';
import { emitPerfEvent } from '../lib/perf';

const ENV = ((import.meta as any)?.env || {}) as Record<string, string | undefined>;
const BACKEND_FLAG = String(ENV.VITE_USE_BACKEND || '').toLowerCase();
const FORCE_LOCAL_KEY = 'ironwaves_force_local_mode';
const DEFAULT_RAILWAY_API_BASE_URL = 'https://ironwaves-pos-platform-production.up.railway.app';

function shouldUseDefaultRailwayBackend() {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.host || '').toLowerCase();
  return host.endsWith('ironwaves.store');
}

export function isBackendEnabled() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(FORCE_LOCAL_KEY) === '1') return false;
  } catch {
    // no-op
  }
  return BACKEND_FLAG === '1' || BACKEND_FLAG === 'true' || BACKEND_FLAG === 'yes' || shouldUseDefaultRailwayBackend();
}

export function isForceLocalMode() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(FORCE_LOCAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function setForceLocalMode(enabled: boolean) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (enabled) localStorage.setItem(FORCE_LOCAL_KEY, '1');
    else localStorage.removeItem(FORCE_LOCAL_KEY);
  } catch {
    // no-op
  }
}

export function getApiBaseUrl() {
  const configured = String(ENV.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
  if (configured) {
    if (configured.startsWith('http://') || configured.startsWith('https://')) return configured;
    return `https://${configured}`;
  }
  return shouldUseDefaultRailwayBackend() ? DEFAULT_RAILWAY_API_BASE_URL : '';
}

type PersistedSession = {
  access_token?: string | null;
  user?: { tenant_id?: string } | null;
};

function getPersistedSession(): PersistedSession {
  try {
    const raw = readScopedStorage('emalatkhana-pos-session');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const state = parsed?.state || {};
    return {
      access_token: state?.access_token || null,
      user: state?.user || null,
    };
  } catch {
    return {};
  }
}

type ApiRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  // pass null to skip x-tenant-id header (use backend host/domain resolver)
  tenantId?: string | null;
};

export async function apiRequest<T = any>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error('VITE_API_BASE_URL konfiqurasiya edilməyib');
  }

  const { access_token } = getPersistedSession();
  // Tenant id header is now opt-in only.
  // By default backend resolves tenant from x-tenant-domain to avoid stale local tenant mismatches.
  const tenantId = options.tenantId;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  // Always send the original frontend host so backend can resolve tenant correctly
  // even when API base URL points to a different host (e.g. Railway backend domain).
  headers['x-tenant-domain'] = window.location.host;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (options.auth !== false && access_token) {
    headers.Authorization = `Bearer ${access_token}`;
  }

  const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  let res: Response;
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 8000;
  const controller = typeof AbortController !== 'undefined' && timeoutMs > 0 ? new AbortController() : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    res = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller?.signal,
    });
  } catch (error) {
    const endedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    emitPerfEvent({
      type: 'api',
      label: `${options.method || 'GET'} ${path}`,
      method: options.method || 'GET',
      path,
      duration_ms: Math.round(endedAt - startedAt),
      ok: false,
      at: new Date().toISOString(),
    });
    const isAbort = typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError';
    const message = isAbort
      ? `sorğu vaxt limiti keçdi (${Math.round(timeoutMs / 1000)} saniyə)`
      : error instanceof Error ? error.message : String(error);
    throw new Error(`Backendə qoşulma alınmadı (${options.method || 'GET'} ${path}): ${message}`);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }

  const text = await res.text();
  const data = text ? (() => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  })() : null;

  const endedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  emitPerfEvent({
    type: 'api',
    label: `${options.method || 'GET'} ${path}`,
    method: options.method || 'GET',
    path,
    duration_ms: Math.round(endedAt - startedAt),
    ok: res.ok,
    status: res.status,
    at: new Date().toISOString(),
  });

  if (!res.ok) {
    const detail = (data && typeof data === 'object' && (data as any).detail) ? (data as any).detail : `HTTP ${res.status}`;
    throw new Error(String(detail));
  }

  return data as T;
}
