import { apiRequest, isBackendEnabled } from '../api/client';
import { logEvent } from './logger';

const getDbName = () => {
  const host = typeof window !== 'undefined' ? window.location.host.toLowerCase().replace(/[^a-z0-9.-]/g, '_') : 'global';
  return `ironwaves-pos-offline__${host}`;
};
const DB_VERSION = 2;
const MENU_STORE = 'menu_cache';
const SALES_STORE = 'offline_sales';
const TENANT_STATUS_INDEX = 'tenant_status';
const MAX_SYNC_BATCH = 25;
const MAX_RETRY_COUNT = 8;
const BASE_RETRY_DELAY_MS = 15_000;

const normalizeOfflineSyncError = (message: string) => {
  const raw = String(message || '').trim();
  const lower = raw.toLowerCase();
  if (
    lower.includes('unauthorized') ||
    lower.includes('invalid token') ||
    lower.includes('token revoked')
  ) {
    return 'Sessiya vaxtı bitib və ya giriş etibarsızdır. Zəhmət olmasa yenidən daxil olun.';
  }
  return raw;
};

type OfflineSaleRecord = {
  id: string;
  tenant_id: string;
  sale_id: string;
  created_at: string;
  synced_at?: string;
  retry_count?: number;
  last_attempt_at?: string;
  next_attempt_at?: string;
  last_error?: string;
  status: 'pending' | 'synced';
  payload: Record<string, unknown>;
};

export type OfflineSaleSummary = {
  id: string;
  sale_id: string;
  created_at: string;
  payment_method: string;
  order_type: string;
  item_count: number;
  total: string;
  retry_count: number;
  last_attempt_at?: string;
  next_attempt_at?: string;
  last_error?: string;
  status: 'pending' | 'synced';
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(getDbName(), DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MENU_STORE)) {
        db.createObjectStore(MENU_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(SALES_STORE)) {
        const store = db.createObjectStore(SALES_STORE, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex(TENANT_STATUS_INDEX, ['tenant_id', 'status'], { unique: false });
      } else {
        const store = req.transaction?.objectStore(SALES_STORE);
        if (store && !store.indexNames.contains(TENANT_STATUS_INDEX)) {
          store.createIndex(TENANT_STATUS_INDEX, ['tenant_id', 'status'], { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const cacheMenuOffline = async (tenantId: string, menu: unknown[]) => {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MENU_STORE, 'readwrite');
      tx.objectStore(MENU_STORE).put({
        key: `${tenantId}:menu`,
        menu,
        cached_at: new Date().toISOString(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // No-op: offline cache should not break flow.
  }
};

export const getCachedMenuOffline = async (tenantId: string): Promise<unknown[] | null> => {
  try {
    const db = await openDb();
    const data = await new Promise<any>((resolve, reject) => {
      const tx = db.transaction(MENU_STORE, 'readonly');
      const req = tx.objectStore(MENU_STORE).get(`${tenantId}:menu`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return Array.isArray(data?.menu) ? data.menu : null;
  } catch {
    return null;
  }
};

export const enqueueOfflineSale = async (
  tenantId: string,
  saleId: string,
  payload: Record<string, unknown>,
) => {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, 'readwrite');
      tx.objectStore(SALES_STORE).put({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        sale_id: saleId,
        created_at: new Date().toISOString(),
        retry_count: 0,
        status: 'pending',
        payload,
      } as OfflineSaleRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // No-op
  }
};

const getPendingRowsForTenant = async (db: IDBDatabase, tenantId: string): Promise<OfflineSaleRecord[]> =>
  await new Promise<OfflineSaleRecord[]>((resolve, reject) => {
    const tx = db.transaction(SALES_STORE, 'readonly');
    const store = tx.objectStore(SALES_STORE);
    if (!store.indexNames.contains(TENANT_STATUS_INDEX)) {
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result || []) as OfflineSaleRecord[];
        resolve(rows.filter((x) => x.tenant_id === tenantId && x.status === 'pending'));
      };
      req.onerror = () => reject(req.error);
      return;
    }
    const index = store.index(TENANT_STATUS_INDEX);
    const req = index.getAll(IDBKeyRange.only([tenantId, 'pending']));
    req.onsuccess = () => resolve((req.result || []) as OfflineSaleRecord[]);
    req.onerror = () => reject(req.error);
  });

export const getPendingOfflineSalesCount = async (tenantId: string): Promise<number> => {
  try {
    const db = await openDb();
    const rows = await getPendingRowsForTenant(db, tenantId);
    db.close();
    return rows.length;
  } catch {
    return 0;
  }
};

export const getPendingOfflineSales = async (tenantId: string): Promise<OfflineSaleSummary[]> => {
  try {
    const db = await openDb();
    const rows = await getPendingRowsForTenant(db, tenantId);
    db.close();

    return rows
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((row) => {
        const cartItems = Array.isArray((row.payload as any)?.cart_items) ? ((row.payload as any).cart_items as any[]) : [];
        const subtotal = cartItems.reduce((sum, item) => {
          const qty = Number(item?.qty || 0);
          const price = Number(item?.price || 0);
          return sum + (qty * price);
        }, 0);
        const discountPercent = Number((row.payload as any)?.discount_percent || 0);
        const total = Math.max(0, subtotal - (subtotal * discountPercent / 100));
        return {
          id: row.id,
          sale_id: row.sale_id,
          created_at: row.created_at,
          payment_method: String((row.payload as any)?.payment_method || '-'),
          order_type: String((row.payload as any)?.order_type || '-'),
          item_count: cartItems.reduce((sum, item) => sum + Number(item?.qty || 0), 0),
          total: total.toFixed(2),
          retry_count: Number(row.retry_count || 0),
          last_attempt_at: row.last_attempt_at,
          next_attempt_at: row.next_attempt_at,
          last_error: row.last_error,
          status: row.status,
        };
      });
  } catch {
    return [];
  }
};

export const scheduleOfflineSaleRetryNow = async (tenantId: string, saleQueueId: string) => {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, 'readwrite');
      const store = tx.objectStore(SALES_STORE);
      const req = store.get(saleQueueId);
      req.onsuccess = () => {
        const row = req.result as OfflineSaleRecord | undefined;
        if (!row || row.tenant_id !== tenantId || row.status !== 'pending') return;
        store.put({
          ...row,
          next_attempt_at: new Date().toISOString(),
          last_error: row.last_error || '',
        } as OfflineSaleRecord);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // no-op
  }
};

export const clearSyncedOfflineSales = async (tenantId: string) => {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, 'readwrite');
      const store = tx.objectStore(SALES_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result || []) as OfflineSaleRecord[];
        rows
          .filter((row) => row.tenant_id === tenantId && row.status === 'synced')
          .forEach((row) => store.delete(row.id));
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // No-op
  }
};

export const clearAllOfflineSales = async (tenantId: string) => {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, 'readwrite');
      const store = tx.objectStore(SALES_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result || []) as OfflineSaleRecord[];
        rows
          .filter((row) => row.tenant_id === tenantId)
          .forEach((row) => store.delete(row.id));
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // No-op
  }
};

export const clearOfflineSalesStore = async () => {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, 'readwrite');
      tx.objectStore(SALES_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // No-op
  }
};

export const pruneSyncedOfflineSales = async (tenantId: string, maxAgeDays = 7) => {
  try {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, 'readwrite');
      const store = tx.objectStore(SALES_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result || []) as OfflineSaleRecord[];
        rows
          .filter((row) => row.tenant_id === tenantId && row.status === 'synced' && new Date(row.synced_at || row.created_at).getTime() < cutoff)
          .forEach((row) => store.delete(row.id));
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // No-op
  }
};

export const syncPendingOfflineSales = async (tenantId: string) => {
  try {
    if (!isBackendEnabled()) {
      return { synced: 0, failed: 0 };
    }

    const db = await openDb();
    const allPending = await getPendingRowsForTenant(db, tenantId);
    const nowMs = Date.now();
    const pending = allPending
      .filter((row) => !row.next_attempt_at || new Date(String(row.next_attempt_at)).getTime() <= nowMs)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(0, MAX_SYNC_BATCH);
    if (!pending.length) {
      db.close();
      return { synced: 0, failed: 0 };
    }

    let synced = 0;
    let failed = 0;

    for (const row of pending) {
      try {
        await apiRequest('/api/v1/pos/sale', {
          method: 'POST',
          tenantId: null,
          body: row.payload,
        });

        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(SALES_STORE, 'readwrite');
          tx.objectStore(SALES_STORE).put({
            ...row,
            status: 'synced',
            synced_at: new Date().toISOString(),
            last_error: '',
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        synced += 1;
      } catch (error) {
        const message = normalizeOfflineSyncError(String((error as any)?.message || 'sync_failed'));
        const retryCount = Number(row.retry_count || 0) + 1;
        const cappedRetry = Math.min(retryCount, MAX_RETRY_COUNT);
        const nextAttemptDelay = BASE_RETRY_DELAY_MS * (2 ** Math.min(cappedRetry, 6));
        const nextAttemptAt = new Date(Date.now() + nextAttemptDelay).toISOString();
        const dedupedAsSynced = /already exists|duplicate|uq_sales_tenant_offline_request_id/i.test(message);
        const shouldKeepPending = !dedupedAsSynced;

        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(SALES_STORE, 'readwrite');
          tx.objectStore(SALES_STORE).put({
            ...row,
            status: shouldKeepPending ? 'pending' : 'synced',
            synced_at: shouldKeepPending ? row.synced_at : new Date().toISOString(),
            retry_count: retryCount,
            last_attempt_at: new Date().toISOString(),
            next_attempt_at: shouldKeepPending ? nextAttemptAt : row.next_attempt_at,
            last_error: message.slice(0, 500),
          } as OfflineSaleRecord);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        failed += shouldKeepPending ? 1 : 0;
        synced += dedupedAsSynced ? 1 : 0;
      }
    }
    db.close();

    await pruneSyncedOfflineSales(tenantId);

    logEvent('system', 'OFFLINE_SALES_SYNCED', {
      tenant_id: tenantId,
      synced_count: synced,
      failed_count: failed,
    });

    return { synced, failed };
  } catch {
    return { synced: 0, failed: 0 };
  }
};
