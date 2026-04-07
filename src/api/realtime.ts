import { readScopedStorage } from '../lib/storage_keys';
import { getApiBaseUrl, isBackendEnabled } from './client';

type PersistedSession = {
  access_token?: string | null;
  user?: { tenant_id?: string } | null;
};

type RealtimeMessage = {
  event: string;
  tenant_id: string;
  payload?: Record<string, unknown>;
};

function getPersistedSession(): PersistedSession {
  try {
    const raw = readScopedStorage('emalatkhana-pos-session');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const state = parsed?.state || {};
    return {
      access_token: state?.access_token || null,
      user: state?.user || null,
    };
  } catch {
    return {};
  }
}

function getRealtimeBaseUrl(): string {
  const apiBase = getApiBaseUrl();
  if (!apiBase) return '';
  if (apiBase.startsWith('https://')) return `wss://${apiBase.slice('https://'.length)}`;
  if (apiBase.startsWith('http://')) return `ws://${apiBase.slice('http://'.length)}`;
  return apiBase;
}

export function subscribeTenantRealtime(
  tenantId: string,
  onMessage: (message: RealtimeMessage) => void,
): () => void {
  if (!isBackendEnabled() || typeof window === 'undefined' || !tenantId) return () => {};
  const { access_token } = getPersistedSession();
  const base = getRealtimeBaseUrl();
  if (!access_token || !base) return () => {};

  const url = `${base}/ws/restaurant?tenant_id=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(access_token)}`;
  let socket: WebSocket | null = null;
  let disposed = false;
  let retryTimer: number | null = null;

  const connect = () => {
    if (disposed) return;
    socket = new window.WebSocket(url);
    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data || '{}'));
        if (parsed?.tenant_id === tenantId) onMessage(parsed as RealtimeMessage);
      } catch {
        // ignore malformed messages
      }
    };
    socket.onclose = () => {
      if (disposed) return;
      retryTimer = window.setTimeout(connect, 2000);
    };
    socket.onerror = () => {
      try {
        socket?.close();
      } catch {
        // ignore
      }
    };
  };

  connect();
  return () => {
    disposed = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    try {
      socket?.close();
    } catch {
      // ignore
    }
  };
}
