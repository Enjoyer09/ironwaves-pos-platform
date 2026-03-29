import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { get_settings, update_business_profile } from './settings';
import { create_user } from './settings';
import { logEvent } from '../lib/logger';
import { getTenantDomains, setTenantDomains } from '../lib/tenant';
import { apiRequest, isBackendEnabled } from './client';

export interface TenantRecord {
  id: string;
  tenant_id: string;
  company_name: string;
  slug: string;
  status: 'provisioning' | 'active' | 'suspended';
  created_at: string;
  created_by: string;
}

const TENANT_TABLE_KEYS = [
  'users',
  'settings',
  'business_profile',
  'menu_items',
  'menu',
  'tables',
  'sales',
  'finance',
  'finance_audit_log',
  'logs',
  'z_reports',
  'shift_handovers',
  'correction_requests',
  'refunds',
  'kitchen_orders',
  'happy_hours',
  'inventory',
  'ingredients',
  'recipes',
  'customers',
  'notifications',
  'promo_codes',
  'customer_coupons',
  'campaigns',
  'admin_notes',
  'staff_notifications',
];

function assertPlatformOwner(actorRole?: string) {
  if (String(actorRole || '').toLowerCase() !== 'super_admin') {
    throw new Error('Bu funksiyaya yalnız platform sahibi (super_admin) giriş edə bilər.');
  }
}

function normalizeSlug(input: string): string {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

function tenantFromSlug(slug: string): string {
  const safe = normalizeSlug(slug);
  return safe ? `tenant_${safe.replace(/-/g, '_')}` : 'tenant_default';
}

function generateTempPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export async function list_tenants(): Promise<TenantRecord[]> {
  if (isBackendEnabled()) {
    const rows = await apiRequest<any[]>('/api/v1/admin/tenants');
    return (rows || []).map((r) => ({
      id: String(r.id),
      tenant_id: String(r.id),
      company_name: String(r.name || ''),
      slug: String(r.slug || ''),
      status: (String(r.status || 'active') as any),
      created_at: new Date().toISOString(),
      created_by: 'system',
    }));
  }
  return getDB<TenantRecord>('tenants').sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function create_tenant(payload: {
  company_name: string;
  slug: string;
  domain?: string;
  admin_username?: string;
  admin_password?: string;
  admin_2fa_pin?: string;
  created_by?: string;
  created_by_role?: string;
}) {
  assertPlatformOwner(payload.created_by_role);

  if (isBackendEnabled()) {
    const companyName = String(payload.company_name || '').trim();
    const slug = normalizeSlug(payload.slug || companyName);
    const domain = String(payload.domain || `${slug}.ironwaves.store`).toLowerCase().trim();
    const adminUsername = String(payload.admin_username || '').trim();
    const adminPassword = String(payload.admin_password || '').trim();
    if (!adminUsername || !adminPassword) {
      throw new Error('Admin username və şifrə mütləqdir');
    }
    const created = await apiRequest<any>('/api/v1/admin/tenants', {
      method: 'POST',
      body: {
        name: companyName,
        slug,
        domain,
        admin_username: adminUsername,
        admin_password: adminPassword,
      },
    });

    return {
      success: true,
      tenant_id: String(created.id),
      domain: String(created.domain || domain),
      admin_username: adminUsername,
      admin_password: adminPassword,
      admin_2fa_pin: payload.admin_2fa_pin || '',
    };
  }

  const companyName = String(payload.company_name || '').trim();
  const slug = normalizeSlug(payload.slug || companyName);
  const domain = String(payload.domain || `${slug}.ironwaves.store`).toLowerCase().trim();

  if (!companyName) throw new Error('Şirkət adı boş ola bilməz');
  if (!slug) throw new Error('Slug düzgün deyil');
  if (!domain) throw new Error('Domain boş ola bilməz');

  const tenant_id = tenantFromSlug(slug);
  const created_by = payload.created_by || 'admin';

  const tenants = getDB<TenantRecord>('tenants');
  if (tenants.some((t) => t.tenant_id === tenant_id)) {
    throw new Error('Bu tenant artıq mövcuddur');
  }

  const domainRows = getTenantDomains();
  if (domainRows.some((d) => d.domain === domain)) {
    throw new Error('Bu domain artıq istifadə olunur');
  }

  const now = new Date().toISOString();
  const tenantRecord: TenantRecord = {
    id: uuidv4(),
    tenant_id,
    company_name: companyName,
    slug,
    status: 'provisioning',
    created_at: now,
    created_by,
  };

  tenants.push(tenantRecord);
  setDB('tenants', tenants);

  domainRows.push({
    id: uuidv4(),
    tenant_id,
    domain,
    is_primary: true,
  });
  setTenantDomains(domainRows);

  // Provision defaults for the new tenant.
  get_settings(tenant_id);
  update_business_profile(
    tenant_id,
    {
      company_name: companyName,
      voen: '',
      phone: '',
      address: '',
      website: `https://${domain}`,
      logo_url: '',
      receipt_footer: 'Bizi secdiyiniz ucun tesekkur edirik!',
    },
    created_by,
  );

  const users = getDB<any>('users');
  const adminUsername = String(payload.admin_username || '').trim();
  const adminPassword = String(payload.admin_password || '').trim();
  if (!adminUsername || !adminPassword) {
    throw new Error('Admin username və şifrə mütləqdir');
  }
  const admin2faPin = String(payload.admin_2fa_pin || Math.floor(100000 + Math.random() * 900000)).trim();
  if (!users.some((u) => u.tenant_id === tenant_id && String(u.username).toLowerCase() === adminUsername.toLowerCase())) {
    await create_user({
      tenant_id,
      username: adminUsername,
      role: 'admin',
      password: adminPassword,
      pin: admin2faPin,
    } as any);
  }

  const menu = getDB<any>('menu_items');
  if (!menu.some((m) => m.tenant_id === tenant_id)) {
    const defaults = [
      { item_name: 'Americano', price: '4.00', category: 'Qəhvə', is_coffee: true },
      { item_name: 'Espresso', price: '3.50', category: 'Qəhvə', is_coffee: true },
      { item_name: 'Latte', price: '5.00', category: 'Qəhvə', is_coffee: true },
    ];
    defaults.forEach((m) => {
      menu.push({ id: uuidv4(), tenant_id, is_active: true, image_url: '', ...m });
    });
    setDB('menu_items', menu);
  }

  const tables = getDB<any>('tables');
  if (!tables.some((t) => t.tenant_id === tenant_id)) {
    ['Masa 1', 'Masa 2', 'Masa 3', 'Masa 4'].forEach((label) => {
      tables.push({ id: uuidv4(), tenant_id, label, is_occupied: false, items: [], total: 0 });
    });
    setDB('tables', tables);
  }

  const updatedTenants = getDB<TenantRecord>('tenants').map((t) =>
    t.tenant_id === tenant_id ? { ...t, status: 'active' as const } : t,
  );
  setDB('tenants', updatedTenants);

  logEvent(created_by, 'TENANT_CREATED', {
    tenant_id,
    company_name: companyName,
    domain,
  });

  return {
    success: true,
    tenant_id,
    domain,
    admin_username: adminUsername,
    admin_password: adminPassword,
    admin_2fa_pin: admin2faPin,
  };
}

export async function suspend_tenant(payload: {
  tenant_id: string;
  suspended_by?: string;
  suspended_by_role?: string;
}) {
  assertPlatformOwner(payload.suspended_by_role);
  if (isBackendEnabled()) {
    await apiRequest(`/api/v1/admin/tenants/${encodeURIComponent(payload.tenant_id)}/suspend`, {
      method: 'POST',
      body: {},
    });
    return { success: true };
  }
  const target = String(payload.tenant_id || '').trim();
  if (!target) throw new Error('tenant_id boş ola bilməz');

  const tenants = getDB<TenantRecord>('tenants');
  const idx = tenants.findIndex((t) => t.tenant_id === target);
  if (idx < 0) throw new Error('Tenant tapılmadı');

  tenants[idx] = { ...tenants[idx], status: 'suspended' };
  setDB('tenants', tenants);

  logEvent(payload.suspended_by || 'owner', 'TENANT_SUSPENDED', {
    tenant_id: target,
  });

  return { success: true };
}

export async function delete_tenant(payload: {
  tenant_id: string;
  deleted_by?: string;
  deleted_by_role?: string;
}) {
  assertPlatformOwner(payload.deleted_by_role);
  if (isBackendEnabled()) {
    await apiRequest(`/api/v1/admin/tenants/${encodeURIComponent(payload.tenant_id)}`, {
      method: 'DELETE',
      body: {},
    });
    return { success: true };
  }
  const target = String(payload.tenant_id || '').trim();
  if (!target) throw new Error('tenant_id boş ola bilməz');
  if (target === 'tenant_default') throw new Error('tenant_default silinə bilməz');

  const tenants = getDB<TenantRecord>('tenants').filter((t) => t.tenant_id !== target);
  setDB('tenants', tenants);

  const domainRows = getTenantDomains().filter((d) => d.tenant_id !== target);
  setTenantDomains(domainRows);

  TENANT_TABLE_KEYS.forEach((key) => {
    const rows = getDB<any>(key);
    if (!Array.isArray(rows) || rows.length === 0) return;
    const filtered = rows.filter((r: any) => String(r?.tenant_id || '') !== target);
    if (filtered.length !== rows.length) {
      setDB(key, filtered);
    }
  });

  logEvent(payload.deleted_by || 'owner', 'TENANT_DELETED', {
    tenant_id: target,
  });

  return { success: true };
}

export async function clone_tenant_as_demo(payload: {
  source_tenant_id: string;
  demo_slug: string;
  demo_domain?: string;
  created_by?: string;
  created_by_role?: string;
}) {
  assertPlatformOwner(payload.created_by_role);

  if (isBackendEnabled()) {
    const sourceTenant = String(payload.source_tenant_id || '').trim();
    const demoSlug = normalizeSlug(payload.demo_slug || `demo-${sourceTenant}`);
    const demoDomain = String(payload.demo_domain || `${demoSlug}.ironwaves.store`).toLowerCase().trim();
    const demoPassword = generateTempPassword();
    const result = await apiRequest<any>(`/api/v1/admin/tenants/${encodeURIComponent(sourceTenant)}/clone`, {
      method: 'POST',
      body: {
        name: `Demo - ${sourceTenant}`,
        slug: demoSlug,
        domain: demoDomain,
        admin_username: 'demo_admin',
        admin_password: demoPassword,
      },
    });
    return {
      success: true,
      demo_tenant_id: String(result.id),
      demo_domain: String(result.domain || demoDomain),
      demo_admin_username: 'demo_admin',
      demo_admin_password: demoPassword,
      demo_admin_2fa_pin: '',
    };
  }

  const sourceTenant = String(payload.source_tenant_id || '').trim();
  if (!sourceTenant) throw new Error('source_tenant_id boş ola bilməz');

  const demoSlug = normalizeSlug(payload.demo_slug || `demo-${sourceTenant}`);
  if (!demoSlug) throw new Error('Demo slug düzgün deyil');

  const demoDomain = String(payload.demo_domain || `${demoSlug}.ironwaves.store`).toLowerCase().trim();

  const demoPassword = generateTempPassword();
  const created = await create_tenant({
    company_name: `Demo - ${sourceTenant}`,
    slug: demoSlug,
    domain: demoDomain,
    admin_username: 'demo_admin',
    admin_password: demoPassword,
    admin_2fa_pin: '123456',
    created_by: payload.created_by || 'owner',
    created_by_role: payload.created_by_role,
  });

  const demoTenant = created.tenant_id;

  // Clone minimal operational data for demo experience.
  const cloneTable = (key: string, mapper?: (row: any) => any) => {
    const sourceRows = getDB<any>(key).filter((r) => String(r?.tenant_id || '') === sourceTenant);
    if (!sourceRows.length) return;
    const allRows = getDB<any>(key);
    sourceRows.forEach((row) => {
      const cloned = {
        ...row,
        id: uuidv4(),
        tenant_id: demoTenant,
      } as any;
      allRows.push(mapper ? mapper(cloned) : cloned);
    });
    setDB(key, allRows);
  };

  cloneTable('menu_items');
  cloneTable('tables', (r) => ({ ...r, is_occupied: false, items: [], total: 0 }));
  cloneTable('inventory');
  cloneTable('ingredients');
  cloneTable('recipes');
  cloneTable('settings');
  cloneTable('business_profile');

  logEvent(payload.created_by || 'owner', 'TENANT_CLONED_DEMO', {
    source_tenant_id: sourceTenant,
    demo_tenant_id: demoTenant,
    demo_domain: demoDomain,
  });

  return {
    success: true,
    demo_tenant_id: demoTenant,
    demo_domain: demoDomain,
    demo_admin_username: 'demo_admin',
    demo_admin_password: demoPassword,
    demo_admin_2fa_pin: '123456',
  };
}
