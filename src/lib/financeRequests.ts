const memoryKeys = new Map<string, string>();

const canonical = (value: any): any => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};

const digest = async (value: unknown): Promise<string> => {
  const serialized = JSON.stringify(canonical(value));
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(serialized);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return serialized;
};

const storageKey = async (tenantId: string, actor: string, kind: string, payload: unknown) =>
  `finance-request:${await digest({ tenantId, actor, kind, payload })}`;

export async function withFinanceRequestKey<T>(
  tenantId: string,
  actor: string,
  kind: string,
  payload: unknown,
  send: (idempotencyKey: string) => Promise<T>,
): Promise<T> {
  const slot = await storageKey(tenantId, actor, kind, payload);
  let key = memoryKeys.get(slot);
  try { key ||= typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(slot) || undefined : undefined; } catch { /* storage may be disabled */ }
  if (!key) {
    key = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    memoryKeys.set(slot, key);
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(slot, key); } catch { /* keep in memory for this page */ }
  }
  try {
    const result = await send(key);
    memoryKeys.delete(slot);
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(slot); } catch { /* ignore storage cleanup errors */ }
    return result;
  } catch (error) {
    memoryKeys.set(slot, key);
    throw error;
  }
}
