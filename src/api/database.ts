import { logEvent } from '../lib/logger';
import { clearDBCache, getDB, setDB } from '../lib/db_sim';
import { apiRequest, getApiBaseUrl, isBackendEnabled } from './client';

export type RestorePreview = {
  available_tables: string[];
  row_counts: Record<string, number>;
  warnings: string[];
};

export type RestoreReport = {
  success: boolean;
  restored_tables: string[];
  restored_rows: number;
  skipped_tables: string[];
  rejected_rows: number;
  rejected_samples: Array<{ table: string; reason: string; row_index: number; row: any }>;
  warnings: string[];
};

export type RestoreChunk = {
  table: string;
  jsonData: string;
};

const genId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

// İcazə verilən cədvəllər (Whitelist)
const ALLOWED_TABLES = [
  'users',
  'menu_items',
  'menu',
  'sales',
  'finance',
  'finance_audit',
  'finance_audit_log',
  'tables',
  'kitchen_orders',
  'z_reports',
  'inventory',
  'ingredients',
  'customers',
  'customer_consents',
  'recipes',
  'customer_coupons',
  'admin_notes',
  'happy_hours',
  'refunds',
  'correction_requests',
  'shift_handovers',
  'settings',
  'notifications',
  'business_profile',
  'logs',
  'system_logs'
];

const TABLE_ALIASES: Record<string, string[]> = {
  menu_items: ['menu'],
  menu: ['menu_items'],
  finance: ['expenses'],
  inventory: ['ingredients'],
  ingredients: ['inventory'],
  recipes: ['recipe'],
  customers: ['tenant_customers'],
};

function sanitizeNonStandardJson(input: string): string {
  // Some external backups (especially Python exports) can contain NaN/Infinity,
  // which are invalid in strict JSON and break JSON.parse in browsers.
  return input
    .replace(/\b-?Infinity\b/g, 'null')
    .replace(/\bNaN\b/g, 'null');
}

function parseRestoreJson(jsonData: string): Record<string, any> {
  try {
    const parsed = JSON.parse(jsonData);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Backup kök strukturu obyekt olmalıdır');
    }
    return parsed as Record<string, any>;
  } catch (error) {
    if (!/\b(?:-?Infinity|NaN)\b/.test(jsonData)) throw error;
    const parsed = JSON.parse(sanitizeNonStandardJson(jsonData));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Backup kök strukturu obyekt olmalıdır');
    }
    return parsed as Record<string, any>;
  }
}

function isHostedLiveApp(): boolean {
  if (typeof window === 'undefined') return false;
  return String(window.location.host || '').toLowerCase().endsWith('ironwaves.store');
}

function buildRestoreChunkObject(rawData: Record<string, any>, table: string): Record<string, any> {
  const chunk: Record<string, any> = {};
  for (const metaKey of ['_tenant_id', '_backup_timestamp']) {
    if (metaKey in rawData) chunk[metaKey] = rawData[metaKey];
  }
  if (Array.isArray(rawData[table])) {
    chunk[table] = rawData[table];
  }
  const aliases = TABLE_ALIASES[table] || [];
  for (const alias of aliases) {
    if (Array.isArray(rawData[alias])) {
      chunk[alias] = rawData[alias];
    }
  }
  return chunk;
}

export function splitRestoreIntoChunks(jsonData: string, selectedTables: string[]): RestoreChunk[] {
  const parsed = parseRestoreJson(jsonData);
  const chunks: RestoreChunk[] = [];
  for (const table of selectedTables) {
    const chunkObject = buildRestoreChunkObject(parsed, table);
    const hasRows = Object.entries(chunkObject).some(([key, value]) => !key.startsWith('_') && Array.isArray(value));
    if (!hasRows) continue;
    chunks.push({
      table,
      jsonData: JSON.stringify(chunkObject),
    });
  }
  return chunks;
}

const EXPENSE_CATEGORY_HINTS = ['xammal', 'icare', 'kommunal', 'maas', 'cerime', 'expense', 'rent', 'salary'];

const TENANT_SCOPED_TABLES = new Set([
  'users',
  'menu_items',
  'menu',
  'sales',
  'finance',
  'tables',
  'kitchen_orders',
  'z_reports',
  'inventory',
  'ingredients',
  'customers',
  'customer_consents',
  'recipes',
  'customer_coupons',
  'admin_notes',
  'happy_hours',
  'refunds',
  'correction_requests',
  'shift_handovers',
  'notifications',
  'business_profile',
  'logs',
  'system_logs'
]);

function getTenantScopedKeys(tenant_id: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(`${tenant_id}_`)) keys.push(k);
  }
  return keys;
}

export function backup_database(tenant_id: string): string {
  const backupData: Record<string, any> = {};

  ALLOWED_TABLES.forEach(table => {
    const tableData = getDB<any>(table);
    const filtered = tableData.filter((row: any) => !row?.tenant_id || row.tenant_id === tenant_id);
    backupData[table] = filtered;
  });

  // Tenant-prefixed collections (example: tenant_default_customers)
  const tenantKeys = getTenantScopedKeys(tenant_id);
  tenantKeys.forEach((key) => {
    backupData[key] = getDB<any>(key);
  });

  backupData['_backup_timestamp'] = new Date().toISOString();
  backupData['_tenant_id'] = tenant_id;

  logEvent('System', 'DATABASE_BACKUP_CREATED', { tables_count: ALLOWED_TABLES.length });
  
  return JSON.stringify(backupData, null, 2);
}

export async function backup_database_live(tenant_id: string): Promise<string> {
  if (!isBackendEnabled() && !isHostedLiveApp()) return backup_database(tenant_id);
  const payload = await apiRequest<Record<string, any>>('/api/v1/ops/database/backup', {
    method: 'GET',
    tenantId: tenant_id,
    suspendOnNetworkError: false,
  });
  return JSON.stringify(payload, null, 2);
}

export function get_restore_preview(tenant_id: string, jsonData: string): RestorePreview {
  const preview: RestorePreview = {
    available_tables: [],
    row_counts: {},
    warnings: [],
  };

  const data = parseRestoreJson(jsonData);

  if (data['_tenant_id'] && data['_tenant_id'] !== tenant_id) {
    preview.warnings.push('Backup fərqli tenant üçün yaradılıb.');
  }

  ALLOWED_TABLES.forEach((table) => {
    const rows = Array.isArray(data[table]) ? data[table] : null;
    if (rows) {
      preview.available_tables.push(table);
      preview.row_counts[table] = rows.length;
      return;
    }

    const aliases = TABLE_ALIASES[table] || [];
    const aliasRows = aliases.find((alias) => Array.isArray(data[alias]));
    if (aliasRows) {
      const arr = Array.isArray(data[aliasRows]) ? data[aliasRows] : [];
      preview.available_tables.push(table);
      preview.row_counts[table] = arr.length;
      preview.warnings.push(`'${table}' bölməsi '${aliasRows}' aliasından bərpa olunacaq.`);
    }
  });

  if (preview.available_tables.length === 0) {
    preview.warnings.push('Bərpa üçün uyğun cədvəl tapılmadı.');
  }

  return preview;
}

export async function get_restore_preview_live(tenant_id: string, jsonData: string): Promise<RestorePreview> {
  if (!isBackendEnabled() && !isHostedLiveApp()) return get_restore_preview(tenant_id, jsonData);
  return apiRequest<RestorePreview>('/api/v1/ops/database/restore-preview', {
    method: 'POST',
    tenantId: tenant_id,
    timeoutMs: 60000,
    suspendOnNetworkError: false,
    body: { json_data: jsonData },
  });
}

export function restore_database(tenant_id: string, jsonData: string, selectedTables?: string[]): RestoreReport {
  try {
    const data = parseRestoreJson(jsonData);
    const report: RestoreReport = {
      success: true,
      restored_tables: [],
      restored_rows: 0,
      skipped_tables: [],
      rejected_rows: 0,
      rejected_samples: [],
      warnings: [],
    };
    
    // Legacy backup-lar çox vaxt tenant_default kimi gəlir. Admin artıq restore-u
    // təsdiqlədiyi üçün data cari tenant-a map olunur, sadəcə audit üçün xəbərdarlıq saxlanır.
    if (data['_tenant_id'] && data['_tenant_id'] !== tenant_id) {
      report.warnings.push('Backup fərqli tenant üçün yaradılıb; məlumatlar cari tenant-a bərpa olundu.');
    }

    const hasAliasDataInBackup = (table: string) => {
      const aliases = TABLE_ALIASES[table] || [];
      return aliases.some((alias) => Array.isArray(data[alias]) && data[alias].length > 0);
    };

    const resolveIncomingRows = (table: string): { rows: any[]; from: string } | null => {
      if (Array.isArray(data[table])) return { rows: data[table], from: table };
      const aliases = TABLE_ALIASES[table] || [];
      for (const alias of aliases) {
        if (Array.isArray(data[alias])) return { rows: data[alias], from: alias };
      }
      return null;
    };

    const normalizeRow = (table: string, row: any, rowIndex: number) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        report.rejected_rows += 1;
        report.rejected_samples.push({ table, reason: 'sətir obyekt deyil', row_index: rowIndex, row });
        return null;
      }
      const base = TENANT_SCOPED_TABLES.has(table)
        ? (row?.tenant_id ? row : { ...row, tenant_id })
        : row;

      if (table === 'inventory' || table === 'ingredients') {
        const name = String(base?.name || '').trim();
        if (!name) {
          report.rejected_rows += 1;
          report.rejected_samples.push({ table, reason: 'inventory.name boşdur', row_index: rowIndex, row: row });
          return null;
        }
        return {
          id: base?.id || genId(),
          name,
          stock_qty: base?.stock_qty ?? 0,
          unit: base?.unit || 'ədəd',
          unit_cost: base?.unit_cost ?? 0,
          min_limit: base?.min_limit ?? 0,
          type: base?.type || 'Xammal',
          category: base?.category || 'Digər',
          tenant_id,
        };
      }

      if (table === 'recipes') {
        const menuItem = String(base?.menu_item_name || base?.menu_item || base?.item_name || '').trim();
        const ingName = String(base?.ingredient_name || base?.ingredient || '').trim();
        if (!menuItem || !ingName) {
          report.rejected_rows += 1;
          report.rejected_samples.push({ table, reason: 'recipes menu_item_name/ingredient_name boşdur', row_index: rowIndex, row: row });
          return null;
        }
        return {
          id: base?.id || genId(),
          menu_item_name: menuItem,
          ingredient_name: ingName,
          quantity_required: base?.quantity_required ?? base?.qty ?? base?.quantity ?? base?.amount ?? 0,
          unit: base?.unit || 'q',
          unit_cost: base?.unit_cost ?? 0,
          line_cost: base?.line_cost ?? 0,
          tenant_id,
        };
      }

      if (table === 'menu' || table === 'menu_items') {
        const itemName = String(base?.item_name || base?.name || base?.item || '').trim();
        if (!itemName) {
          report.rejected_rows += 1;
          report.rejected_samples.push({ table, reason: 'menu item_name boşdur', row_index: rowIndex, row: row });
          return null;
        }
        return {
          id: base?.id || genId(),
          item_name: itemName,
          price: base?.price ?? base?.cost ?? 0,
          category: base?.category || 'Digər',
          is_coffee: Boolean(base?.is_coffee),
          is_active: base?.is_active ?? true,
          printer_target: base?.printer_target || 'kitchen',
          tenant_id,
        };
      }

      if (table === 'kitchen_orders') {
        const status = String(base?.status || 'NEW').toUpperCase();
        const hasItems = Array.isArray(base?.items) || typeof base?.items === 'string';
        if (!hasItems || !['NEW', 'PREPARING', 'DONE'].includes(status)) {
          // Skip malformed rows (e.g. sales rows accidentally placed under kitchen_orders)
          report.rejected_rows += 1;
          report.rejected_samples.push({ table, reason: 'kitchen_orders malformed row', row_index: rowIndex, row: row });
          return null;
        }
        return {
          id: base?.id || genId(),
          tenant_id,
          sale_id: base?.sale_id || '',
          table_label: base?.table_label || null,
          order_type: base?.order_type || 'Dine In',
          status,
          priority: base?.priority || 'NORMAL',
          items: base?.items,
          created_at: base?.created_at || new Date().toISOString(),
          completed_at: base?.completed_at,
        };
      }

      if (table === 'finance') {
        const rawCategory = String(base?.category || '');
        const rawType = String(base?.type || '').toLowerCase();
        const normalizedCat = rawCategory.toLowerCase();
        const looksExpense = EXPENSE_CATEGORY_HINTS.some((token) => normalizedCat.includes(token));
        if (rawType === 'in' && looksExpense) {
          report.warnings.push(`Finance entry warning: '${rawCategory}' kateqoriyası 'in' tipində gəldi.`);
        }
      }

      return base;
    };

    const selectedSet = new Set(
      (selectedTables && selectedTables.length ? selectedTables : ALLOWED_TABLES)
        .filter((t) => ALLOWED_TABLES.includes(t)),
    );

    ALLOWED_TABLES.forEach(table => {
      if (!selectedSet.has(table)) return;
      const resolved = resolveIncomingRows(table);
      if (!resolved) {
        report.skipped_tables.push(table);
        return;
      }
      const incoming = resolved.rows;
      if (resolved.from !== table) {
        report.warnings.push(`'${table}' cədvəli '${resolved.from}' bölməsindən bərpa olundu.`);
      }

      // Alias cədvəldə data varsa, boş array ilə əsas cədvəli silməyək
      if (incoming.length === 0 && hasAliasDataInBackup(table)) {
        report.skipped_tables.push(table);
        return;
      }

      // Mövcud tenant datanı sil və yenisi ilə əvəz et
      const existing = getDB<any>(table);
      const keptOtherTenants = existing.filter((row: any) => row?.tenant_id && row.tenant_id !== tenant_id);
      const normalizedIncoming = incoming
        .map((row: any, idx: number) => normalizeRow(table, row, idx))
        .filter((row: any) => row !== null);

      const merged = [...keptOtherTenants, ...normalizedIncoming];
      setDB(table, merged);
      report.restored_tables.push(table);
      report.restored_rows += normalizedIncoming.length;

      // Alias cədvəlləri də sinxron saxla
      const aliases = TABLE_ALIASES[table] || [];
      aliases.forEach((alias) => {
        if (!selectedSet.has(table)) return;
        const aliasExisting = getDB<any>(alias);
        const aliasKept = aliasExisting.filter((row: any) => row?.tenant_id && row.tenant_id !== tenant_id);
        setDB(alias, [...aliasKept, ...normalizedIncoming]);
      });
    });

    // Restore tenant-prefixed collections exactly
    Object.keys(data)
      .filter((k) => k.startsWith(`${tenant_id}_`) && Array.isArray(data[k]))
      .forEach((tenantKey) => {
        setDB(tenantKey, data[tenantKey]);
      });

    // Legacy backup format support: `{ customers: [...] }` -> `${tenant}_customers`
    if (Array.isArray(data.customers) && !data[`${tenant_id}_customers`]) {
      setDB(`${tenant_id}_customers`, data.customers);
      report.warnings.push('customers məlumatı legacy formatdan tenant prefiksli cədvələ köçürüldü.');
    }

    if (Array.isArray(data.admin_notes)) {
      const scopedNotes = data.admin_notes.map((row: any) => ({ ...row, tenant_id }));
      setDB('admin_notes', scopedNotes);
      setDB(`${tenant_id}_admin_notes`, scopedNotes);
      report.warnings.push('admin_notes məlumatı lokal qeyd panelinə bərpa olundu.');
    }

    if (Array.isArray(data.customer_coupons)) {
      const scopedCoupons = data.customer_coupons.map((row: any) => ({ ...row, tenant_id }));
      setDB('customer_coupons', scopedCoupons);
      setDB(`${tenant_id}_customer_coupons`, scopedCoupons);
      report.warnings.push('customer_coupons məlumatı lokal CRM cache-ə bərpa olundu.');
    }

    // Legacy alias support for recipe/ingredients keys
    if (!Array.isArray(data.recipes) && Array.isArray(data.recipe)) {
      const recipeRows = data.recipe
        .map((row: any, idx: number) => normalizeRow('recipes', row, idx))
        .filter((row: any) => row !== null);
      const existingRecipes = getDB<any>('recipes').filter((row: any) => row?.tenant_id && row.tenant_id !== tenant_id);
      setDB('recipes', [...existingRecipes, ...recipeRows]);
      report.warnings.push('recipe aliası recipes cədvəlinə köçürüldü.');
    }

    clearDBCache();

    logEvent('System', 'DATABASE_RESTORE_COMPLETED', {
      timestamp: new Date().toISOString(),
      restored_tables: report.restored_tables,
      restored_rows: report.restored_rows,
      rejected_rows: report.rejected_rows,
      rejected_samples: report.rejected_samples.slice(0, 20),
    });
    return report;
  } catch (err) {
    logEvent('System', 'DATABASE_RESTORE_FAILED', { error: String(err) });
    throw err;
  }
}

export async function restore_database_live(tenant_id: string, jsonData: string, selectedTables?: string[]): Promise<RestoreReport> {
  const hasBackendTransport = Boolean(getApiBaseUrl());
  if (!hasBackendTransport) {
    if (isHostedLiveApp()) {
      throw new Error('Canlı domen rejimində restore yalnız backend/NeonDB üzərindən icra oluna bilər. Lokal rejimi söndürün və backend bağlantısını yoxlayın.');
    }
    return restore_database(tenant_id, jsonData, selectedTables);
  }
  const selected = Array.isArray(selectedTables) ? selectedTables.filter(Boolean) : [];

  const sendSingleRestore = (payloadJson: string, payloadTables: string[]) =>
    apiRequest<RestoreReport>('/api/v1/ops/database/restore', {
      method: 'POST',
      tenantId: tenant_id,
      timeoutMs: 300000,
      suspendOnNetworkError: false,
      body: {
        json_data: payloadJson,
        selected_tables: payloadTables,
      },
    });

  const mergeReports = (reports: RestoreReport[]): RestoreReport => {
    const restoredTables = Array.from(new Set(reports.flatMap((report) => report.restored_tables || [])));
    const skippedTables = Array.from(new Set(reports.flatMap((report) => report.skipped_tables || [])))
      .filter((table) => !restoredTables.includes(table));
    return {
      success: reports.every((report) => report.success !== false),
      restored_tables: restoredTables,
      restored_rows: reports.reduce((sum, report) => sum + Number(report.restored_rows || 0), 0),
      skipped_tables: skippedTables,
      rejected_rows: reports.reduce((sum, report) => sum + Number(report.rejected_rows || 0), 0),
      rejected_samples: reports.flatMap((report) => report.rejected_samples || []).slice(0, 50),
      warnings: Array.from(new Set(reports.flatMap((report) => report.warnings || []))),
    };
  };

  try {
    return await sendSingleRestore(jsonData, selected);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    const isNetworkFailure = message.includes('Backendə qoşulma alınmadı') || message.includes('Failed to fetch');
    if (!isNetworkFailure) throw error;

    const chunks = splitRestoreIntoChunks(jsonData, selected);
    if (chunks.length <= 1) throw error;

    const orderedChunks = [...chunks].sort((a, b) => {
      if (a.table === 'users' && b.table !== 'users') return 1;
      if (b.table === 'users' && a.table !== 'users') return -1;
      return 0;
    });
    const reports: RestoreReport[] = [];

    for (const chunk of orderedChunks) {
      try {
        reports.push(await sendSingleRestore(chunk.jsonData, [chunk.table]));
      } catch (chunkError) {
        const chunkMessage = chunkError instanceof Error ? chunkError.message : String(chunkError || '');
        throw new Error(`Restore chunk uğursuz oldu (${chunk.table}): ${chunkMessage}`);
      }
    }

    const merged = mergeReports(reports);
    merged.warnings = Array.from(new Set([
      ...(merged.warnings || []),
      'Böyük restore sorğusu parçalanmış backend batch-lərlə tamamlandı.',
    ]));
    return merged;
  }
}
