/**
 * Print idempotency guard (Faza A / P1-1).
 *
 * Prevents the SAME kitchen ticket from printing twice on ONE device — e.g. when a
 * WebSocket push and the 8s poll both surface a freshly arrived KDS order before the
 * in-memory "seen ids" ref updates, or across a KDS remount. Keys are stored in
 * localStorage with a TTL so they survive reloads but self-expire.
 *
 * Scope note: localStorage is per-device, so this does NOT coordinate a waiter's POS
 * device with a separate kitchen KDS device. Authoritative cross-device idempotency is
 * delivered by the server-side print queue (Faza B: unique (tenant, kitchen_order, station)).
 */

const STORAGE_KEY = 'ironwaves_printed_tickets';
const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

type Entry = { at: number };
type Store = Record<string, Entry>;

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function save(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage full / unavailable — dedupe silently degrades to no-op
  }
}

function prune(store: Store, now: number): Store {
  for (const key of Object.keys(store)) {
    const entry = store[key];
    if (!entry || typeof entry.at !== 'number' || now - entry.at > TTL_MS) {
      delete store[key];
    }
  }
  return store;
}

/** True if this ticket key was printed within the TTL window (and should be skipped). */
export function wasTicketPrinted(key: string, now: number = Date.now()): boolean {
  if (!key) return false;
  const store = prune(load(), now);
  return Boolean(store[key]);
}

/** Record that a ticket key has been printed. */
export function markTicketPrinted(key: string, now: number = Date.now()): void {
  if (!key) return;
  const store = prune(load(), now);
  store[key] = { at: now };
  save(store);
}

/** Release a previously-claimed key (call when an optimistic auto-print attempt failed). */
export function clearTicketPrinted(key: string): void {
  if (!key) return;
  const store = load();
  if (store[key]) {
    delete store[key];
    save(store);
  }
}
