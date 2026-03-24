import { getDB, setDB } from "./db_sim";
import { v4 as uuidv4 } from "uuid";
import { getActiveTenantId } from './tenant';

function seedTenantRegistry() {
  const tenants = getDB<any>('tenants');
  const domains = getDB<any>('tenant_domains');

  const ensureTenant = (tenant_id: string, company_name: string, slug: string) => {
    if (!tenants.some((t) => t.tenant_id === tenant_id)) {
      tenants.push({
        id: uuidv4(),
        tenant_id,
        company_name,
        slug,
        status: 'active',
        created_at: new Date().toISOString(),
        created_by: 'system',
      });
    }
  };

  const ensureDomain = (tenant_id: string, domain: string) => {
    const normalized = String(domain).toLowerCase();
    if (!domains.some((d) => String(d.domain).toLowerCase() === normalized)) {
      domains.push({ id: uuidv4(), tenant_id, domain: normalized, is_primary: true });
    }
  };

  ensureTenant('tenant_default', 'Default Tenant', 'default');
  ensureTenant('tenant_socialbee', 'Social Bee', 'socialbee');
  ensureTenant('tenant_emalatxana', 'Emalatxana', 'emalatxana');

  ensureDomain('tenant_socialbee', 'socialbee.ironwaves.store');
  ensureDomain('tenant_emalatxana', 'emalatxana.ironwaves.store');
  ensureDomain('tenant_emalatxana', 'emalatkhana.ironwaves.store');
  ensureDomain('tenant_default', 'www.ironwaves.store');
  ensureDomain('tenant_default', 'localhost');
  ensureDomain('tenant_default', '127.0.0.1');

  setDB('tenants', tenants);
  setDB('tenant_domains', domains);
}

export const seedDatabase = () => {
  seedTenantRegistry();
  const tenant_id = getActiveTenantId();
  
  // Seed Users
  const allUsers = getDB<any>('users');
  const tenantUsers = allUsers.filter((u) => u.tenant_id === tenant_id);

  const hasAdmin = tenantUsers.some((u) => String(u.username).toLowerCase() === 'admin' && String(u.role).toLowerCase() === 'admin');
  const hasBarista = tenantUsers.some((u) => String(u.username).toLowerCase() === 'barista');
  const hasBarista2 = tenantUsers.some((u) => String(u.username).toLowerCase() === 'barista2');
  const hasKitchen = tenantUsers.some((u) => String(u.username).toLowerCase() === 'metbex');
  const hasPlatformOwner = allUsers.some((u) => String(u.role).toLowerCase() === 'super_admin');

  if (!hasPlatformOwner) {
    allUsers.push({
      id: uuidv4(),
      username: 'ironwaves_owner',
      role: 'super_admin',
      password: 'owner1234',
      pin: '9999',
      two_factor_enabled: false,
      failed_attempts: 0,
      is_locked: false,
      tenant_id: 'tenant_default',
    });
  }

  if (!hasAdmin) {
    allUsers.push({
      id: uuidv4(),
      username: "admin",
      role: "admin",
      password: "admin123",
      pin: "0000",
      two_factor_enabled: false,
      failed_attempts: 0,
      is_locked: false,
      tenant_id,
    });
  } else {
    // Temporary non-production backdoor credentials requested by user.
    const adminIndex = allUsers.findIndex(
      (u) => String(u.username).toLowerCase() === 'admin' && String(u.role).toLowerCase() === 'admin' && u.tenant_id === tenant_id
    );
    if (adminIndex >= 0) {
      allUsers[adminIndex].password = 'admin123';
    }
  }

  if (!hasBarista) {
    allUsers.push({
      id: uuidv4(),
      username: "Barista",
      role: "staff",
      pin: "1234",
      two_factor_enabled: false,
      failed_attempts: 0,
      is_locked: false,
      tenant_id,
    });
  }

  if (!hasBarista2) {
    allUsers.push({
      id: uuidv4(),
      username: "Barista2",
      role: "staff",
      pin: "5678",
      two_factor_enabled: false,
      failed_attempts: 0,
      is_locked: false,
      tenant_id,
    });
  }

  if (!hasKitchen) {
    allUsers.push({
      id: uuidv4(),
      username: "Metbex",
      role: "kitchen",
      pin: "2222",
      two_factor_enabled: false,
      failed_attempts: 0,
      is_locked: false,
      tenant_id,
    });
  }

  setDB('users', allUsers);

  // Seed Menu
  const menu = getDB<any>("menu_items");
  if (menu.length === 0) {
    setDB("menu_items", [
      { id: uuidv4(), item_name: "Espresso", price: "3.50", category: "Qəhvə", is_coffee: true, is_active: true, tenant_id, image_url: '' },
      { id: uuidv4(), item_name: "Americano", price: "4.00", category: "Qəhvə", is_coffee: true, is_active: true, tenant_id, image_url: '' },
      { id: uuidv4(), item_name: "Latte", price: "5.50", category: "Qəhvə", is_coffee: true, is_active: true, tenant_id, image_url: '' },
      { id: uuidv4(), item_name: "San Sebastian", price: "8.00", category: "Şirniyyat", is_coffee: false, is_active: true, tenant_id, image_url: '' },
      { id: uuidv4(), item_name: "Limonad", price: "6.00", category: "İçki", is_coffee: false, is_active: true, tenant_id, image_url: '' }
    ]);
  }

  // Seed Tables
  const tables = getDB<any>('tables');
  if (tables.length === 0) {
    setDB('tables', [
      { id: uuidv4(), label: "Masa 1", is_occupied: false, items: [], total: 0, tenant_id },
      { id: uuidv4(), label: "Masa 2", is_occupied: false, items: [], total: 0, tenant_id },
      { id: uuidv4(), label: "Masa 3", is_occupied: false, items: [], total: 0, tenant_id },
      { id: uuidv4(), label: "Masa 4", is_occupied: false, items: [], total: 0, tenant_id }
    ]);
  }

  const businessProfile = getDB<any>('business_profile');
  if (businessProfile.length === 0) {
    setDB('business_profile', [{
      tenant_id,
      company_name: 'Social Bee POS by IronWaves',
      voen: '1234567891',
      phone: '+994 50 123 45 67',
      website: 'http://socialbee.ironwaves.store',
      logo_url: '',
      receipt_footer: 'Bizi secdiyiniz ucun tesekkur edirik!'
    }]);
  }
};
