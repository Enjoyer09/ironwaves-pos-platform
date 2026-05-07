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
