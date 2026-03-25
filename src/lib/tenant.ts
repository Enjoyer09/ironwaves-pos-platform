const DOMAIN_TENANT_MAP: Record<string, string> = {
  'localhost': 'tenant_default',
  '127.0.0.1': 'tenant_default',
};

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

function slugToTenant(subdomain: string): string {
  const safe = String(subdomain || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 40);
  return safe ? `tenant_${safe}` : 'tenant_default';
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

export function resolveTenantIdFromHost(inputHost?: string): string {
  const host = normalizeHost(
    inputHost || (typeof window !== 'undefined' ? window.location.host : ''),
  );

  if (!host) return 'tenant_default';
  const dynamicMappings = readDomainMappings();
  if (dynamicMappings[host]) return dynamicMappings[host];
  if (DOMAIN_TENANT_MAP[host]) return DOMAIN_TENANT_MAP[host];

  // Generic subdomain strategy: <tenant>.ironwaves.store
  if (host.endsWith('.ironwaves.store')) {
    const sub = host.replace('.ironwaves.store', '');
    if (sub && sub !== 'www') {
      return slugToTenant(sub);
    }
  }

  return 'tenant_default';
}

export function getActiveTenantId(): string {
  const hostMapped = resolveTenantIdFromHost();
  // In real multi-tenant domains, host mapping should win over stale local storage.
  if (hostMapped && hostMapped !== 'tenant_default') {
    return hostMapped;
  }
  try {
    const manual =
      typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_TENANT_KEY) : null;
    if (manual && manual.startsWith('tenant_')) return manual;
  } catch {
    // Ignore localStorage read errors in restricted environments.
  }
  return hostMapped;
}

export function setActiveTenantId(tenantId: string): void {
  const safe = String(tenantId || '').trim() || 'tenant_default';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACTIVE_TENANT_KEY, safe);
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
