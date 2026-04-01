export type PerfEvent = {
  type: 'api';
  label: string;
  method: string;
  path: string;
  duration_ms: number;
  ok: boolean;
  status?: number;
  at: string;
};

export function isPerfDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('perf') === '1';
  } catch {
    return false;
  }
}

export function emitPerfEvent(event: PerfEvent): void {
  if (typeof window === 'undefined' || !isPerfDebugEnabled()) return;
  window.dispatchEvent(new CustomEvent('app-perf', { detail: event }));
}
