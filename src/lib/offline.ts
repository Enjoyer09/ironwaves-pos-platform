import { apiRequest, isBackendEnabled } from '../api/client';
import { logEvent } from './logger';

const getDbName = () => {
  const host = typeof window !== 'undefined' ? window.location.host.toLowerCase().replace(/[^a-z0-9.-]/g, '_') : 'global';
  return `socialbee-pos-offline__${host}`;
};
const DB_VERSION = 1;
const MENU_STORE = 'menu_cache';
const SALES_STORE = 'offline_sales';

type OfflineSaleRecord = {
  id: string;
  tenant_id: string;
  sale_id: string;
  created_at: string;
  synced_at?: string;
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

export const getPendingOfflineSalesCount = async (tenantId: string): Promise<number> => {
  try {
    const db = await openDb();
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, 'readonly');
      const req = tx.objectStore(SALES_STORE).getAll();
      req.onsuccess = () => {
        const all = Array.isArray(req.result) ? (req.result as OfflineSaleRecord[]) : [];
        resolve(all.filter((x) => x.tenant_id === tenantId && x.status === 'pending').length);
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
    return count;
  } catch {
    return 0;
  }
};

export const getPendingOfflineSales = async (tenantId: string): Promise<OfflineSaleSummary[]> => {
  try {
    const db = await openDb();
    const rows = await new Promise<OfflineSaleRecord[]>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, 'readonly');
      const req = tx.objectStore(SALES_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []) as OfflineSaleRecord[]);
      req.onerror = () => reject(req.error);
    });
    db.close();

    return rows
      .filter((row) => row.tenant_id === tenantId && row.status === 'pending')
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
          status: row.status,
        };
      });
  } catch {
    return [];
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
    const all = await new Promise<OfflineSaleRecord[]>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, 'readonly');
      const req = tx.objectStore(SALES_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []) as OfflineSaleRecord[]);
      req.onerror = () => reject(req.error);
    });

    const pending = all.filter((x) => x.tenant_id === tenantId && x.status === 'pending');
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
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        synced += 1;
      } catch {
        failed += 1;
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
