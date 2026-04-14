import { readScopedStorage } from '../lib/storage_keys';
import { emitPerfEvent } from '../lib/perf';

const ENV = ((import.meta as any)?.env || {}) as Record<string, string | undefined>;
const BACKEND_FLAG = String(ENV.VITE_USE_BACKEND || '').toLowerCase();
const FORCE_LOCAL_KEY = 'ironwaves_force_local_mode';
const BACKEND_SUSPENDED_UNTIL_KEY = 'ironwaves_backend_suspended_until';
const DEFAULT_RAILWAY_API_BASE_URL = 'https://ironwaves-pos-platform-production.up.railway.app';

function shouldUseDefaultRailwayBackend() {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.host || '').toLowerCase();
  return host.endsWith('ironwaves.store');
}

export function isBackendEnabled() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(FORCE_LOCAL_KEY) === '1') return false;
    const suspendedUntil = Number(localStorage.getItem(BACKEND_SUSPENDED_UNTIL_KEY) || 0);
    if (suspendedUntil && Date.now() < suspendedUntil) return false;
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

export function suspendBackendTemporarily(ms: number = 60000) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BACKEND_SUSPENDED_UNTIL_KEY, String(Date.now() + ms));
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

let cachedSessionRaw = '';
let cachedSession: PersistedSession = {};
const telemetryThrottle: Record<string, number> = {};

function getPersistedSession(): PersistedSession {
  try {
    const raw = readScopedStorage('emalatkhana-pos-session');
    if (raw === cachedSessionRaw) return cachedSession;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const state = parsed?.state || {};
    cachedSessionRaw = raw;
    cachedSession = {
      access_token: state?.access_token || null,
      user: state?.user || null,
    };
    return cachedSession;
  } catch {
    cachedSessionRaw = '';
    cachedSession = {};
    return {};
  }
}

function emitClientTelemetry(action: string, details: Record<string, any>) {
  try {
    if (!isBackendEnabled()) return;
    const base = getApiBaseUrl();
    if (!base) return;
    const key = `${action}:${String(details?.path || '')}:${String(details?.message || '').slice(0, 120)}`;
    const now = Date.now();
    if (telemetryThrottle[key] && now - telemetryThrottle[key] < 10000) return;
    telemetryThrottle[key] = now;
    const body = JSON.stringify({
      user: String(getPersistedSession().user ? 'client' : 'anonymous'),
      action,
      details: {
        ...details,
        tenant_id: String(getPersistedSession().user?.tenant_id || 'tenant_default'),
        ts: new Date().toISOString(),
      },
    });
    fetch(`${base}/api/v1/ops/logs/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-domain': window.location.host,
      },
      body,
    }).catch(() => {});
  } catch {
    // telemetry must be best-effort
  }
}

type ApiRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  suspendOnNetworkError?: boolean;
  // pass null to skip x-tenant-id header (use backend host/domain resolver)
  tenantId?: string | null;
  signal?: AbortSignal;
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
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 20000;
  const controller = typeof AbortController !== 'undefined' && timeoutMs > 0 ? new AbortController() : null;
  let timedOut = false;
  const timeoutId = controller
    ? window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs)
    : null;
  const requestSignal = controller?.signal || options.signal;
  const externalSignal = options.signal;
  let removeExternalAbortListener: (() => void) | null = null;
  if (controller && externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onAbort, { once: true });
      removeExternalAbortListener = () => externalSignal.removeEventListener('abort', onAbort);
    }
  }
  try {
    res = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: requestSignal,
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
      ? (timedOut ? `sorğu vaxt limiti keçdi (${Math.round(timeoutMs / 1000)} saniyə)` : 'sorğu ləğv edildi')
      : error instanceof Error ? error.message : String(error);
    emitClientTelemetry('API_NETWORK_ERROR', {
      method: options.method || 'GET',
      path,
      message,
      timeout_ms: timeoutMs,
      timed_out: timedOut,
      online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    });
    if (options.suspendOnNetworkError === true && !isAbort) {
      suspendBackendTemporarily();
    }
    throw new Error(`Backendə qoşulma alınmadı (${options.method || 'GET'} ${path}): ${message}`);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    if (removeExternalAbortListener) removeExternalAbortListener();
  }

  const text = await res.text();
  let responseWasJson = true;
  const data = text ? (() => {
    try {
      return JSON.parse(text);
    } catch {
      responseWasJson = false;
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
    const detail = responseWasJson && data && typeof data === 'object' && (data as any).detail
      ? (data as any).detail
      : `Server düzgün JSON cavabı qaytarmadı (HTTP ${res.status})`;
    if (res.status >= 500 || res.status === 429) {
      emitClientTelemetry('API_SERVER_ERROR', {
        method: options.method || 'GET',
        path,
        status: res.status,
        detail: String(detail),
        request_id: String(res.headers.get('x-request-id') || ''),
      });
    }
    if (options.suspendOnNetworkError !== false && String(detail).includes('Tenant not configured')) {
      suspendBackendTemporarily(5 * 60 * 1000);
    }
    throw new Error(String(detail));
  }

  if ((endedAt - startedAt) > 2500) {
    emitClientTelemetry('API_SLOW_REQUEST', {
      method: options.method || 'GET',
      path,
      status: res.status,
      duration_ms: Math.round(endedAt - startedAt),
      request_id: String(res.headers.get('x-request-id') || ''),
    });
  }

  return data as T;
}
