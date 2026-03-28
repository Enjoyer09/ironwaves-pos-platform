import { getApiBaseUrl, isBackendEnabled } from '../api/client';

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
  
  // Həmçinin local storage-də tarixçə kimi saxlaya bilərik
  const existingLogs = JSON.parse(localStorage.getItem('system_logs') || '[]');
  existingLogs.push(logEntry);
  localStorage.setItem('system_logs', JSON.stringify(existingLogs.slice(-1000))); // Son 1000 log

  // Tenant-a aid ayrıca log saxlanışı (admin panel üçün)
  const tenantKey = `${tenantId}_logs`;
  const tenantLogs = JSON.parse(localStorage.getItem(tenantKey) || '[]');
  tenantLogs.push(logEntry);
  localStorage.setItem(tenantKey, JSON.stringify(tenantLogs.slice(-1000)));

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
  const rows = JSON.parse(localStorage.getItem(key) || '[]');
  rows.push(entry);
  localStorage.setItem(key, JSON.stringify(rows.slice(-500)));

  logEvent('System', 'UI_ERROR', { tenant_id: tenantId, module, message, ...context });
};
