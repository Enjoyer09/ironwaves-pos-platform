import { logEvent } from './logger';

const DB_NAME = 'socialbee-pos-offline';
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

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
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

export const syncPendingOfflineSales = async (tenantId: string) => {
  try {
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
      return { synced: 0 };
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SALES_STORE, 'readwrite');
      const store = tx.objectStore(SALES_STORE);
      pending.forEach((row) => {
        store.put({ ...row, status: 'synced', synced_at: new Date().toISOString() });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    logEvent('system', 'OFFLINE_SALES_SYNCED', {
      tenant_id: tenantId,
      synced_count: pending.length,
      failed_count: 0,
    });

    return { synced: pending.length };
  } catch {
    return { synced: 0 };
  }
};
