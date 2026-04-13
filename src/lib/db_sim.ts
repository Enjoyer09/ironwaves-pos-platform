import { hostScopedKey } from './storage_keys';

const memCache = new Map<string, any[]>();

const scopedDbKey = (key: string) => hostScopedKey(`db_${key}`);

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    if (!/\b(?:-?Infinity|NaN)\b/.test(raw)) throw new Error('Invalid JSON');
    // Fallback for non-standard JSON literals from imported backups (NaN/Infinity).
    const normalized = raw
      .replace(/\b-?Infinity\b/g, 'null')
      .replace(/\bNaN\b/g, 'null');
    return JSON.parse(normalized);
  }
}

function normalizeRows(value: unknown): any[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row !== undefined && row !== null);
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
    const safe = normalizeRows(parsed);
    memCache.set(key, safe);
    return safe as T[];
  } catch {
    memCache.set(key, []);
    return [];
  }
}

export function setDB<T>(key: string, data: T[]): void {
  try {
    const safe = normalizeRows(data);
    const serialized = JSON.stringify(safe);
    localStorage.setItem(scopedDbKey(key), serialized);
    memCache.set(key, safe);
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
