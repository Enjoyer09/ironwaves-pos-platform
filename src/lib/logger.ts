import { getApiBaseUrl, isBackendEnabled } from '../api/client';

const GLOBAL_LOG_LIMIT = 200;
const TENANT_LOG_LIMIT = 300;
const UI_ERROR_LIMIT = 150;

function readArray(key: string): any[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArraySafely(key: string, rows: any[], preferredLimit: number) {
  const candidates = [preferredLimit, Math.min(preferredLimit, 100), Math.min(preferredLimit, 50), 10];
  for (const limit of candidates) {
    try {
      localStorage.setItem(key, JSON.stringify(rows.slice(-limit)));
      return;
    } catch {
      // Try again with fewer rows.
    }
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore storage cleanup failures
  }
}

export const logEvent = (
  user: string,
  action: string,
  details: Record<string, any>
) => {
  const tenantId = details?.tenant_id || 'tenant_default';
  const logEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    tenant_id: tenantId,
    user,
    action,
    details,
  };
  
  // Real layihədə bu DB-yə (logs cədvəlinə) yazılacaq.
  // Hazırda konsola structured JSON olaraq çıxarırıq.
  console.log(JSON.stringify(logEntry, null, 2));
  
  // Həmçinin local storage-də tarixçə kimi saxlaya bilərik.
  // Quota dolanda bu hissə tətbiqi çökdürməməlidir.
  const existingLogs = readArray('system_logs');
  existingLogs.push(logEntry);
  writeArraySafely('system_logs', existingLogs, GLOBAL_LOG_LIMIT);

  // Tenant-a aid ayrıca log saxlanışı (admin panel üçün)
  const tenantKey = `${tenantId}_logs`;
  const tenantLogs = readArray(tenantKey);
  tenantLogs.push(logEntry);
  writeArraySafely(tenantKey, tenantLogs, TENANT_LOG_LIMIT);

  if (isBackendEnabled()) {
    const base = getApiBaseUrl();
    if (base) {
      fetch(`${base}/api/v1/ops/logs/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-domain': window.location.host,
        },
        body: JSON.stringify({ user, action, details }),
      }).catch(() => {});
    }
  }
};

export const logUiError = (
  tenantId: string,
  module: string,
  message: string,
  context?: Record<string, any>,
) => {
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    tenant_id: tenantId,
    module,
    message,
    context: context || {},
  };

  const key = `${tenantId}_ui_errors`;
  const rows = readArray(key);
  rows.push(entry);
  writeArraySafely(key, rows, UI_ERROR_LIMIT);

  logEvent('System', 'UI_ERROR', { tenant_id: tenantId, module, message, ...context });
};
