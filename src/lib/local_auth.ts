const HASH_PREFIX = 'sha256:';

function bytesToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isHashedLocalCredential(value?: string | null): boolean {
  return String(value || '').startsWith(HASH_PREFIX);
}

export async function hashLocalCredential(value: string): Promise<string> {
  const raw = String(value || '');
  if (!raw) return '';
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(raw);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return `${HASH_PREFIX}${bytesToHex(digest)}`;
  }
  return raw;
}

export async function verifyLocalCredential(rawValue: string, storedValue?: string | null): Promise<boolean> {
  const safeStored = String(storedValue || '');
  if (!safeStored) return false;
  if (!isHashedLocalCredential(safeStored)) {
    return String(rawValue || '') === safeStored;
  }
  const hashed = await hashLocalCredential(rawValue);
  return hashed === safeStored;
}
