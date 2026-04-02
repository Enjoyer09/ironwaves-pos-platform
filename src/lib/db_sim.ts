import { hostScopedKey } from './storage_keys';

const memCache = new Map<string, any[]>();

const scopedDbKey = (key: string) => hostScopedKey(`db_${key}`);

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Fallback for non-standard JSON literals from imported backups (NaN/Infinity).
    const normalized = raw
      .replace(/\b-?Infinity\b/g, 'null')
      .replace(/\bNaN\b/g, 'null');
    return JSON.parse(normalized);
  }
}

export function getDB<T>(key: string): T[] {
  if (memCache.has(key)) {
    return memCache.get(key) as T[];
  }

  try {
    const data = localStorage.getItem(scopedDbKey(key)) ?? localStorage.getItem(key);
    if (!data) {
      memCache.set(key, []);
      return [];
    }
    const parsed = safeParse(data);
    const safe = Array.isArray(parsed) ? parsed : [];
    memCache.set(key, safe);
    return safe as T[];
  } catch {
    memCache.set(key, []);
    return [];
  }
}

export function setDB<T>(key: string, data: T[]): void {
  try {
    localStorage.setItem(scopedDbKey(key), JSON.stringify(data));
    memCache.set(key, Array.isArray(data) ? data : []);
  } catch (e) {
    console.error('LocalStorage error:', e);
  }
}

export function clearDBCache(key?: string): void {
  if (key) {
    memCache.delete(key);
    return;
  }
  memCache.clear();
}
