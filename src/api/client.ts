import { emitPerfEvent } from '../lib/perf';

const ENV = ((import.meta as any)?.env || {}) as Record<string, string | undefined>;
const BACKEND_FLAG = String(ENV.VITE_USE_BACKEND || '').toLowerCase();
const FORCE_LOCAL_KEY = 'ironwaves_force_local_mode';

function normalizeConfiguredApiBaseUrl() {
  const configured = String(ENV.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
  if (!configured) return '';
  if (configured.startsWith('http://') || configured.startsWith('https://')) return configured;
  return `https://${configured}`;
}

export function isBackendEnabled() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(FORCE_LOCAL_KEY) === '1') return false;
  } catch {
    // no-op
  }
  const forceEnabled = BACKEND_FLAG === '1' || BACKEND_FLAG === 'true' || BACKEND_FLAG === 'yes';
  return forceEnabled || Boolean(normalizeConfiguredApiBaseUrl());
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
  return normalizeConfiguredApiBaseUrl();
}

type SessionAuthSnapshot = {
  access_token?: string | null;
  user?: { tenant_id?: string } | null;
};

let sessionAuthSnapshot: SessionAuthSnapshot = {};
const telemetryThrottle: Record<string, number> = {};
const inFlightGetRequests = new Map<string, Promise<any>>();
const IN_FLIGHT_GET_TTL_MS = 1000;
let lastAuthExpiredEventAt = 0;
const getResponseCache = new Map<string, { expiresAt: number; data: any }>();

function cloneCachedData<T>(data: T): T {
  try {
    if (typeof structuredClone === 'function') return structuredClone(data);
  } catch {
    // fall through
  }
  try {
    return JSON.parse(JSON.stringify(data)) as T;
  } catch {
    return data;
  }
}

function getResponseCacheTtl(path: string): number {
  const cleanPath = String(path || '').split('?')[0];
  if (
    cleanPath === '/api/v1/pos/menu' ||
    cleanPath === '/api/v1/ops/tables' ||
    cleanPath === '/api/v1/restaurant/tables-bootstrap' ||
    cleanPath === '/api/v1/ops/settings' ||
    cleanPath === '/api/v1/finance/summary' ||
    cleanPath === '/api/v1/finance/balances' ||
    cleanPath === '/api/v1/finance/anomalies' ||
    cleanPath === '/api/v1/finance/ledger/accounts' ||
    cleanPath === '/api/v1/reports/status' ||
    cleanPath === '/api/v1/analytics/summary' ||
    cleanPath === '/api/v1/analytics/sales'
  ) {
    return 12000;
  }
  if (cleanPath === '/api/v1/pos/menu/images') return 120000;
  if (cleanPath === '/api/v1/restaurant/kitchen-feed') return 5000;
  if (cleanPath.startsWith('/api/v1/restaurant/floor-plans/') && cleanPath.endsWith('/state')) return 12000;
  if (cleanPath.startsWith('/api/v1/finance/reports/')) return 12000;
  return 0;
}

export function setClientAuthSession(snapshot: SessionAuthSnapshot | null | undefined): void {
  sessionAuthSnapshot = {
    access_token: snapshot?.access_token || null,
    user: snapshot?.user || null,
  };
}

export function getClientAuthSession(): SessionAuthSnapshot {
  return sessionAuthSnapshot;
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
        tenant_id: String(getClientAuthSession().user?.tenant_id || 'tenant_default'),
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
  cacheMode?: RequestCache;
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  // pass null to skip x-tenant-id header (use backend host/domain resolver)
  tenantId?: string | null;
  signal?: AbortSignal;
};

function createRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // no-op
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const isRetryableStatus = (status: number) => status === 429 || status === 502 || status === 503 || status === 504;

const isAbortError = (error: unknown) =>
  typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError';

export async function apiRequest<T = any>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  const isDedupableGet = method === 'GET' && options.body === undefined;
  if (isDedupableGet) {
    const cacheTtlMs = getResponseCacheTtl(path);
    const dedupeKey = JSON.stringify({
      base: getApiBaseUrl(),
      path,
      tenantId: options.tenantId ?? '',
      auth: options.auth !== false,
      headers: options.headers || {},
    });
    if (cacheTtlMs > 0) {
      const cached = getResponseCache.get(dedupeKey);
      if (cached && cached.expiresAt > Date.now()) {
        return Promise.resolve(cloneCachedData(cached.data));
      }
    }
    const existing = inFlightGetRequests.get(dedupeKey);
    if (existing) return existing as Promise<T>;
    const promise = apiRequestNetwork<T>(path, { ...options, signal: undefined }).then((data) => {
      if (cacheTtlMs > 0) {
        getResponseCache.set(dedupeKey, {
          expiresAt: Date.now() + cacheTtlMs,
          data: cloneCachedData(data),
        });
      }
      return data;
    });
    inFlightGetRequests.set(dedupeKey, promise);
    window.setTimeout(() => {
      if (inFlightGetRequests.get(dedupeKey) === promise) {
        inFlightGetRequests.delete(dedupeKey);
      }
    }, IN_FLIGHT_GET_TTL_MS);
    const clearDedupe = () => {
      window.setTimeout(() => {
        if (inFlightGetRequests.get(dedupeKey) === promise) {
          inFlightGetRequests.delete(dedupeKey);
        }
      }, 50);
    };
    promise.then(clearDedupe, clearDedupe);
    return promise;
  }
  return apiRequestNetwork<T>(path, options).then((data) => {
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      getResponseCache.clear();
      inFlightGetRequests.clear();
    }
    return data;
  });
}

async function apiRequestNetwork<T = any>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error('VITE_API_BASE_URL konfiqurasiya edilməyib');
  }
  const method = String(options.method || 'GET').toUpperCase();

  const { access_token } = getClientAuthSession();
  // Tenant id header is now opt-in only.
  // By default backend resolves tenant from x-tenant-domain to avoid stale local tenant mismatches.
  const tenantId = options.tenantId;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const requestId = createRequestId();

  // Always send the original frontend host so backend can resolve tenant correctly
  // even when API base URL points to a different host (e.g. Railway backend domain).
  headers['x-tenant-domain'] = window.location.host;
  headers['x-request-id'] = requestId;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (options.auth !== false && access_token) {
    headers.Authorization = `Bearer ${access_token}`;
  }

  const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  let res: Response | null = null;
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 20000;
  const isIdempotent = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const retryCount = Math.max(0, Number.isFinite(options.retryCount as number) ? Number(options.retryCount) : (isIdempotent ? 1 : 0));
  const retryDelayMs = Math.max(100, Number(options.retryDelayMs || 350));
  let timedOut = false;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = typeof AbortController !== 'undefined' && timeoutMs > 0 ? new AbortController() : null;
    timedOut = false;
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
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        credentials: 'include',
        cache: options.cacheMode || 'no-store',
        signal: requestSignal,
      });
      if (!res.ok && isRetryableStatus(res.status) && attempt < retryCount) {
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const aborted = isAbortError(error);
      const canRetry = attempt < retryCount && !aborted && !(options.signal?.aborted);
      if (!canRetry) {
        const endedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        emitPerfEvent({
          type: 'api',
          label: `${method} ${path}`,
          method,
          path,
          duration_ms: Math.round(endedAt - startedAt),
          ok: false,
          at: new Date().toISOString(),
        });
        const message = aborted
          ? (timedOut ? `sorğu vaxt limiti keçdi (${Math.round(timeoutMs / 1000)} saniyə)` : 'sorğu ləğv edildi')
          : error instanceof Error ? error.message : String(error);
        emitClientTelemetry('API_NETWORK_ERROR', {
          method,
          path,
          message,
          timeout_ms: timeoutMs,
          timed_out: timedOut,
          online: typeof navigator !== 'undefined' ? navigator.onLine : true,
          request_id: requestId,
        });
        throw new Error(`Backendə qoşulma alınmadı (${method} ${path}, request_id: ${requestId}): ${message}`);
      }
      await sleep(retryDelayMs * (attempt + 1));
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (removeExternalAbortListener) removeExternalAbortListener();
    }
  }

  if (lastError || !res) {
    const message = lastError instanceof Error ? lastError.message : String(lastError || 'Unknown request failure');
    throw new Error(`Backend sorğusu uğursuz oldu (${method} ${path}, request_id: ${requestId}): ${message}`);
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
    const backendRequestId = String(res.headers.get('x-request-id') || requestId);
    if (res.status === 401 || res.status === 403) {
      setClientAuthSession({ access_token: null, user: null });
      const now = Date.now();
      if (now - lastAuthExpiredEventAt > 1000) {
        lastAuthExpiredEventAt = now;
        window.dispatchEvent(
          new CustomEvent('ironwaves-auth-expired', {
            detail: {
              status: res.status,
              path,
              request_id: backendRequestId,
              detail: String(detail),
            },
          }),
        );
      }
    }
    if (res.status >= 500 || res.status === 429) {
      emitClientTelemetry('API_SERVER_ERROR', {
        method: options.method || 'GET',
        path,
        status: res.status,
        detail: String(detail),
        request_id: backendRequestId,
      });
    }
    throw new Error(`${String(detail)} (request_id: ${backendRequestId})`);
  }

  if ((endedAt - startedAt) > 2500) {
    emitClientTelemetry('API_SLOW_REQUEST', {
      method: options.method || 'GET',
      path,
      status: res.status,
      duration_ms: Math.round(endedAt - startedAt),
      request_id: String(res.headers.get('x-request-id') || requestId),
    });
  }

  return data as T;
}
