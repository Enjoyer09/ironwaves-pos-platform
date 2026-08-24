import { withThermalReceiptPrintCss } from './receipt_print_css';

const AGENT_BASE_URL = 'http://127.0.0.1:17777';
const REQUEST_TIMEOUT_MS = 15000;
// Local agent prints via a Chrome→PDF→spool chain that can exceed 2.5s on macOS.
// A too-short timeout aborts a print the agent actually accepted, dropping the
// browser back to the QZ branch → the SAME ticket prints twice (P1-2). 8s covers
// the slow-agent case while still failing fast if the agent is genuinely down.
const AGENT_PRINT_TIMEOUT_MS = 8000;

// Cyrillic (Basic + Supplement). Raw ESC/POS is forced to code page PC437, which
// cannot represent Cyrillic → mojibake on the thermal printer (P0-2). When the
// ticket contains Cyrillic we route through the Unicode-safe pixel/HTML path.
const CYRILLIC_RE = /[Ѐ-ӿ]/;

export function containsCyrillic(text: string): boolean {
  return CYRILLIC_RE.test(String(text || ''));
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export function printHtmlViaBrowserIframe(html: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      return false;
    }

    doc.open();
    doc.write(html);
    doc.close();

    iframe.contentWindow?.focus();
    setTimeout(() => {
      try {
        iframe.contentWindow?.print();
      } catch (e) {
        console.warn('iframe print error:', e);
      } finally {
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {}
        }, 3000);
      }
    }, 250);

    return true;
  } catch (err) {
    console.warn('Browser print fallback error:', err);
    return false;
  }
}

export async function printViaLocalAgent(html: string, printerName?: string): Promise<boolean> {
  const safeHtml = withThermalReceiptPrintCss(html);
  if (!safeHtml.trim()) return false;
  try {
    const response = await fetch(`${AGENT_BASE_URL}/print-html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: safeHtml,
        printer_name: String(printerName || '').trim() || undefined,
      }),
      signal: timeoutSignal(AGENT_PRINT_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function printDirectOrFallback(
  html: string,
  options?: {
    printerName?: string;
    useQz?: boolean;
    paperWidth?: '58mm' | '80mm';
    printEngine?: 'pixel_html' | 'raw_escpos';
    rawCommands?: string;
    allowBrowserFallback?: boolean;
  }
): Promise<{ method: 'agent' | 'qz' | 'browser' | 'none'; success: boolean }> {
  // 1. Try local Print Agent first
  try {
    const agentSuccess = await printViaLocalAgent(html, options?.printerName);
    if (agentSuccess) {
      return { method: 'agent', success: true };
    }
  } catch {}

  // 2. Try QZ Tray (supports explicit printer, paperWidth and raw ESC/POS commands)
  try {
    const { qzPrintHtml, qzPrintRaw } = await import('./qz');
    // Only take the raw ESC/POS path when the content is PC437-safe. Cyrillic tickets
    // must go through pixel/HTML (Unicode-safe) even if raw_escpos is selected (P0-2).
    const rawSafe =
      options?.printEngine === 'raw_escpos' &&
      Boolean(options?.rawCommands) &&
      !containsCyrillic(html);
    if (rawSafe) {
      await qzPrintRaw(options!.rawCommands as string, options?.printerName);
      return { method: 'qz', success: true };
    } else {
      await qzPrintHtml(html, {
        printerName: options?.printerName,
        paperWidth: options?.paperWidth || '58mm',
      });
      return { method: 'qz', success: true };
    }
  } catch (err) {
    console.warn('QZ Tray print attempted but failed:', err);
  }

  // 3. Fallback to Browser Print Dialog (Save to PDF / Native Print) only if allowed
  if (options?.allowBrowserFallback !== false) {
    const browserSuccess = printHtmlViaBrowserIframe(html);
    if (browserSuccess) {
      return { method: 'browser', success: true };
    }
  }

  return { method: 'none', success: false };
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

export type LocalPrintAgentPrinter = {
  name: string;
  default: boolean;
};

export async function localPrintAgentPrinters(): Promise<LocalPrintAgentPrinter[]> {
  try {
    const response = await fetch(`${AGENT_BASE_URL}/printers`, {
      method: 'GET',
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const payload = (await response.json().catch(() => ({}))) as { printers?: LocalPrintAgentPrinter[] };
    return Array.isArray(payload?.printers) ? payload.printers : [];
  } catch {
    return [];
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
