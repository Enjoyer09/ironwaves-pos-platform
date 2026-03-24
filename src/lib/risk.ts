// Lightweight risk-context helpers for adaptive 2FA.
// We keep this client-side for now because the project currently uses local storage as data backend.

export interface LoginRiskContext {
  device_hash: string;
  ip: string;
}

export function getDeviceHash(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator);
  const scr = typeof screen !== 'undefined' ? screen : ({} as Screen);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown_tz';
  const raw = [
    nav.userAgent || 'ua_unknown',
    nav.language || 'lang_unknown',
    // @ts-ignore platform exists in browsers
    nav.platform || 'platform_unknown',
    `${scr.width || 0}x${scr.height || 0}`,
    tz,
  ].join('|');

  // Fast deterministic string hash (non-crypto, sufficient for device fingerprint grouping).
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `dev_${(h >>> 0).toString(16)}`;
}

export async function getPublicIp(timeoutMs: number = 2500): Promise<string> {
  const fallback = 'ip_unknown';
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return fallback;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    return typeof data?.ip === 'string' && data.ip.trim() ? data.ip.trim() : fallback;
  } catch {
    return fallback;
  } finally {
    window.clearTimeout(timeout);
  }
}
