function normalizeHost(rawHost?: string): string {
  return String(rawHost || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];
}

export function hostScopedKey(baseKey: string): string {
  const host = typeof window !== 'undefined' ? normalizeHost(window.location.host) : '';
  return host ? `${baseKey}__${host}` : `${baseKey}__global`;
}

export function readScopedStorage(baseKey: string): string | null {
  try {
    const scoped = localStorage.getItem(hostScopedKey(baseKey));
    if (scoped !== null) return scoped;
    return localStorage.getItem(baseKey);
  } catch {
    return null;
  }
}

export function writeScopedStorage(baseKey: string, value: string): void {
  try {
    localStorage.setItem(hostScopedKey(baseKey), value);
  } catch {
    // ignore storage write failures
  }
}

export function removeScopedStorage(baseKey: string): void {
  try {
    localStorage.removeItem(hostScopedKey(baseKey));
    localStorage.removeItem(baseKey);
  } catch {
    // ignore storage removal failures
  }
}
