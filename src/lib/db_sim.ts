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
  const safe = normalizeRows(data);
  memCache.set(key, safe);
  try {
    const serialized = JSON.stringify(safe);
    // Skip localStorage write if data is too large (>2MB) to prevent QuotaExceededError
    if (serialized.length > 2_000_000) {
      return;
    }
    // Defer the blocking localStorage write to the next tick to prevent UI freeze
    setTimeout(() => {
      try {
        localStorage.setItem(scopedDbKey(key), serialized);
      } catch {
        // QuotaExceededError or RangeError — try to free space
        try {
          localStorage.removeItem(scopedDbKey(key));
        } catch {
          // ignore
        }
      }
    }, 0);
  } catch {
    // ignore serialization errors
  }
}

export function clearDBCache(key?: string): void {
  if (key) {
    memCache.delete(key);
    return;
  }
  memCache.clear();
}
