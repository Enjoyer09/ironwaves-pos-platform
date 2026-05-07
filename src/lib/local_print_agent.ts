import { withThermalReceiptPrintCss } from './receipt_print_css';

const AGENT_BASE_URL = 'http://127.0.0.1:17777';
const REQUEST_TIMEOUT_MS = 900;

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export async function printViaLocalAgent(html: string, printerName?: string): Promise<boolean> {
  const safeHtml = withThermalReceiptPrintCss(html);
  if (!safeHtml.trim()) return false;
  const response = await fetch(`${AGENT_BASE_URL}/print-html`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html: safeHtml,
      printer_name: String(printerName || '').trim() || undefined,
    }),
    signal: timeoutSignal(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `Print Agent HTTP ${response.status}`);
  }
  return true;
}

export async function localPrintAgentHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${AGENT_BASE_URL}/health`, {
      method: 'GET',
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export type LocalPrintAgentInfo = {
  online: boolean;
  version: string;
};

export async function localPrintAgentInfo(): Promise<LocalPrintAgentInfo> {
  try {
    const response = await fetch(`${AGENT_BASE_URL}/version`, {
      method: 'GET',
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { online: false, version: '' };
    const payload = (await response.json().catch(() => ({}))) as { version?: string };
    return { online: true, version: String(payload?.version || '').trim() };
  } catch {
    return { online: false, version: '' };
  }
}

function semverToParts(input: string): number[] {
  return String(input || '')
    .split('.')
    .slice(0, 3)
    .map((part) => Number(String(part).replace(/\D+/g, '')) || 0);
}

export function isAgentVersionOutdated(currentVersion: string, minimumVersion: string): boolean {
  const current = semverToParts(currentVersion);
  const minimum = semverToParts(minimumVersion);
  for (let index = 0; index < Math.max(current.length, minimum.length); index += 1) {
    const currentPart = current[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (currentPart < minimumPart) return true;
    if (currentPart > minimumPart) return false;
  }
  return false;
}
