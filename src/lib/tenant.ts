import { readScopedStorage, writeScopedStorage } from './storage_keys';

const DOMAIN_TENANT_MAP: Record<string, string> = {
  'localhost': 'tenant_default',
  '127.0.0.1': 'tenant_default',
};

const ENV = ((import.meta as any)?.env || {}) as Record<string, string | undefined>;
// Multi-tenant should be enabled by default.
// Set VITE_SINGLE_TENANT_MODE=true only for dedicated single-tenant deployments.
const SINGLE_TENANT_MODE = String(ENV.VITE_SINGLE_TENANT_MODE || 'false').toLowerCase() === 'true';
const SINGLE_TENANT_ID = String(ENV.VITE_SINGLE_TENANT_ID || '').trim();

const ACTIVE_TENANT_KEY = 'active_tenant_id';
const TENANT_DOMAINS_KEY = 'tenant_domains';

function normalizeHost(rawHost: string): string {
  return String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];
}

function readDomainMappings(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(TENANT_DOMAINS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    parsed.forEach((row: any) => {
      const domain = normalizeHost(row?.domain || '');
      const tenantId = String(row?.tenant_id || '').trim();
      if (domain && tenantId) {
        map[domain] = tenantId;
      }
    });
    return map;
  } catch {
    return {};
  }
}

export function getResolvedTenantIdFromHost(inputHost?: string): string | null {
  if (SINGLE_TENANT_MODE && SINGLE_TENANT_ID) return SINGLE_TENANT_ID;
  const host = normalizeHost(
    inputHost || (typeof window !== 'undefined' ? window.location.host : ''),
  );

  if (!host) return null;
  const dynamicMappings = readDomainMappings();
  if (dynamicMappings[host]) return dynamicMappings[host];
  if (DOMAIN_TENANT_MAP[host]) return DOMAIN_TENANT_MAP[host];

  // Production-style unknown hosts must not silently fall back into tenant_default.
  // Only explicit local/dev hosts may use tenant_default.
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'tenant_default';
  }
  return null;
}

export function resolveTenantIdFromHost(inputHost?: string): string {
  return getResolvedTenantIdFromHost(inputHost) || 'tenant_default';
}

export function isKnownTenantHost(inputHost?: string): boolean {
  return Boolean(getResolvedTenantIdFromHost(inputHost));
}

export function getActiveTenantId(): string {
  if (SINGLE_TENANT_MODE && SINGLE_TENANT_ID) return SINGLE_TENANT_ID;
  const hostMapped = getResolvedTenantIdFromHost();
  // In real multi-tenant domains, host mapping should win over stale local storage.
  if (hostMapped) {
    return hostMapped;
  }
  try {
    const manual =
      typeof localStorage !== 'undefined' ? readScopedStorage(ACTIVE_TENANT_KEY) : null;
    // Accept UUID or legacy tenant_* identifiers.
    if (manual && manual.length >= 6) return manual;
  } catch {
    // Ignore localStorage read errors in restricted environments.
  }
  return hostMapped || 'tenant_default';
}

export function setActiveTenantId(tenantId: string): void {
  if (SINGLE_TENANT_MODE) return;
  const safe = String(tenantId || '').trim() || 'tenant_default';
  try {
    if (typeof localStorage !== 'undefined') {
      writeScopedStorage(ACTIVE_TENANT_KEY, safe);
    }
  } catch {
    // Ignore localStorage write errors.
  }
}

export function normalizeTenantId(input?: string): string {
  const raw = String(input || '').trim();
  return raw || getActiveTenantId();
}

export function isTenantRecord(record: any, tenantId?: string): boolean {
  const active = normalizeTenantId(tenantId);
  // Global records without tenant_id are treated as visible for backward compatibility.
  if (!record || typeof record !== 'object' || !('tenant_id' in record)) return true;
  return !record.tenant_id || String(record.tenant_id) === active;
}

export function filterTenantRecords<T extends Record<string, any>>(rows: T[], tenantId?: string): T[] {
  return (Array.isArray(rows) ? rows : []).filter((row) => isTenantRecord(row, tenantId));
}

export function getTenantDomains(): Array<{ id: string; tenant_id: string; domain: string; is_primary: boolean }> {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(TENANT_DOMAINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setTenantDomains(rows: Array<{ id: string; tenant_id: string; domain: string; is_primary: boolean }>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TENANT_DOMAINS_KEY, JSON.stringify(Array.isArray(rows) ? rows : []));
  } catch {
    // Ignore write errors.
  }
}
