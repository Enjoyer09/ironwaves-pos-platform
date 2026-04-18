import { getApiBaseUrl, getClientAuthSession, isBackendEnabled } from './client';

type RealtimeMessage = {
  event: string;
  tenant_id: string;
  payload?: Record<string, unknown>;
};

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
  const { access_token } = getClientAuthSession();
  const base = getRealtimeBaseUrl();
  if (!access_token || !base) return () => {};

  const url = `${base}/ws/restaurant?tenant_id=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(access_token)}`;
  let socket: WebSocket | null = null;
  let disposed = false;
  let retryTimer: number | null = null;
  let retryDelayMs = 2000;

  const connect = () => {
    if (disposed) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    socket = new window.WebSocket(url);
    socket.onopen = () => {
      retryDelayMs = 2000;
    };
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
      retryTimer = window.setTimeout(connect, retryDelayMs);
      retryDelayMs = Math.min(30000, Math.round(retryDelayMs * 1.8));
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
  const reconnectWhenReady = () => {
    if (disposed || (socket && socket.readyState === WebSocket.OPEN)) return;
    if (retryTimer) window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(connect, 500);
  };
  window.addEventListener('online', reconnectWhenReady);
  document.addEventListener('visibilitychange', reconnectWhenReady);
  return () => {
    disposed = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    window.removeEventListener('online', reconnectWhenReady);
    document.removeEventListener('visibilitychange', reconnectWhenReady);
    try {
      socket?.close();
    } catch {
      // ignore
    }
  };
}
