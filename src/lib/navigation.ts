export type ModuleKey =
  | 'pos'
  | 'tables'
  | 'kds'
  | 'zreport'
  | 'finance'
  | 'inventory'
  | 'suppliers'
  | 'combos'
  | 'dashboard'
  | 'analytics'
  | 'logs'
  | 'crm'
  | 'customerapp'
  | 'posbuilder'
  | 'ai'
  | 'menu'
  | 'recipes'
  | 'tenants'
  | 'notes'
  | 'settings'
  | 'landing'
  | 'database';

export const ALL_MODULE_KEYS: ModuleKey[] = [
  'pos',
  'tables',
  'kds',
  'zreport',
  'finance',
  'inventory',
  'suppliers',
  'combos',
  'dashboard',
  'analytics',
  'logs',
  'crm',
  'customerapp',
  'posbuilder',
  'ai',
  'menu',
  'recipes',
  'tenants',
  'notes',
  'settings',
  'landing',
  'database',
];

const MODULE_ALIASES: Record<string, ModuleKey> = {
  '': 'pos',
  pos: 'pos',
  main: 'pos',
  tables: 'tables',
  kds: 'kds',
  kitchen: 'kds',
  zreport: 'zreport',
  'z-report': 'zreport',
  finance: 'finance',
  inventory: 'inventory',
  suppliers: 'suppliers',
  combos: 'combos',
  dashboard: 'dashboard',
  analytics: 'analytics',
  logs: 'logs',
  crm: 'crm',
  customers: 'crm',
  customerapp: 'customerapp',
  'customer-app': 'customerapp',
  posbuilder: 'posbuilder',
  'pos-builder': 'posbuilder',
  ai: 'ai',
  'menu-editor': 'menu',
  recipes: 'recipes',
  tenants: 'tenants',
  notes: 'notes',
  settings: 'settings',
  landing: 'landing',
  database: 'database',
};

const RESERVED_PUBLIC_PATHS = new Set([
  'receipt',
  'feedback',
  'customer',
  'menu',
  'qrmenu',
  'qr-menu',
  'm',
]);

/**
 * Extracts a valid ModuleKey from the current URL pathname.
 * Returns null if the path is a reserved public route or unknown.
 */
export function getModuleFromPathname(pathname: string): ModuleKey | null {
  if (typeof pathname !== 'string') return null;
  const clean = pathname.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  const segment = clean.split('/')[0] || '';

  if (RESERVED_PUBLIC_PATHS.has(segment)) {
    return null;
  }

  return MODULE_ALIASES[segment] || null;
}

/**
 * Returns the canonical URL pathname for a given module.
 */
export function getPathnameForModule(moduleKey: ModuleKey): string {
  if (moduleKey === 'pos') return '/';
  if (moduleKey === 'menu') return '/menu-editor';
  return `/${moduleKey}`;
}

/**
 * Checks if the current pathname is a public QR menu route.
 */
export function isPublicMenuRoute(pathname: string): boolean {
  if (typeof pathname !== 'string') return false;
  const clean = pathname.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  const segment = clean.split('/')[0] || '';
  return segment === 'menu' || segment === 'qrmenu' || segment === 'qr-menu' || segment === 'm';
}

/**
 * Checks if the current pathname is any public route (menu, receipt, feedback, landing, customer loyalty portal).
 * Note: '/customerapp' is an internal staff/admin module, NOT a public route.
 */
export function isPublicAppRoute(pathname: string): boolean {
  if (typeof pathname !== 'string') return false;
  const clean = pathname.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  const segment = clean.split('/')[0] || '';
  if (isPublicMenuRoute(pathname)) return true;
  if (segment === 'receipt' || segment === 'feedback' || segment === 'landing') return true;
  if (segment === 'customer') return true;
  return false;
}

/**
 * Extracts a tenant slug from paths like /menu/chaidan, /qrmenu/chaidan, /m/chaidan, /qr-menu/chaidan.
 */
export function extractMenuTenantSlug(pathname: string): string | null {
  if (typeof pathname !== 'string') return null;
  const clean = pathname.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  const parts = clean.split('/');
  if (parts[0] === 'menu' || parts[0] === 'qrmenu' || parts[0] === 'qr-menu' || parts[0] === 'm') {
    return parts[1] || null;
  }
  return null;
}

/**
 * Updates the browser's URL without reloading the page using History API.
 */
export function syncUrlWithModule(moduleKey: ModuleKey, replace: boolean = false) {
  if (typeof window === 'undefined' || !window.history) return;
  const targetPath = getPathnameForModule(moduleKey);
  const currentPath = window.location.pathname;
  const currentSearch = window.location.search;
  const currentHash = window.location.hash;

  if (currentPath === targetPath) return;

  const newUrl = `${targetPath}${currentSearch}${currentHash}`;
  if (replace) {
    window.history.replaceState({ moduleKey }, '', newUrl);
  } else {
    window.history.pushState({ moduleKey }, '', newUrl);
  }
}
