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

/**
 * Browser print fallback. The receipt CSS sizes content in mm, so the
 * @page rule MUST match the real thermal paper — a default `size: auto`
 * on the driver's A4/Letter paper cuts the content on both sides
 * (IMG_0492: "Tarix" wraps char-by-char, amounts vanish at the right
 * edge). Inject an explicit @page width override when the caller passes
 * paperWidth so the dialog renders to the actual paper. Explicit 2-length
 * size (58mm x 300mm) because CSS Paged Media disallows `58mm auto`.
 */
export function printHtmlViaBrowserIframe(html: string, paperWidth?: '58mm' | '80mm'): boolean {
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

    const pageWidthMm = paperWidth === '80mm' ? '80mm' : '58mm';
    const contentWidthMm = paperWidth === '80mm' ? 72 : 48;
    const pageOverride = `<style>@page { size: ${pageWidthMm} 300mm; margin: 2mm; } html, body { width: ${contentWidthMm}mm !important; max-width: ${contentWidthMm}mm !important; overflow: visible !important; margin: 0 auto !important; font-size: 12px !important; }</style>`;
    const docHtml = String(html).replace(/<\/head>/i, `${pageOverride}</head>`);

    doc.open();
    doc.write(docHtml);
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

export type PrintDirectResult = {
  method: 'agent' | 'qz' | 'browser' | 'none';
  success: boolean;
  /** Filled when printing failed and the caller should surface it to the user. */
  error?: string;
};

function friendlyQzError(err: unknown): string {
  const raw = String((err as any)?.message || err || '');
  if (!raw) return 'QZ Tray çapı alınmadı';
  if (/script load failed|script not loaded|library not available|blocked/i.test(raw)) {
    return 'QZ Tray quraşdırılmayıb və ya bloklanıb — QZ Tray proqramını quraşdırın/yeniləyin';
  }
  if (/connect|websocket|qoşul|localhost|ECONN/i.test(raw)) {
    return 'QZ Tray-ə qoşmaq mümkün olmadı — QZ Tray proqramının açıq olduğunu yoxlayın';
  }
  if (/printer|not found|tapılmadı/i.test(raw)) {
    return 'QZ Tray printeri tapa bilmədi — cihaz printerini yoxlayın';
  }
  if (/certificate|signature|security|crypto/i.test(raw)) {
    return 'QZ Tray sertifikat xətası — QZ Tray sertifikatı yeniləyin';
  }
  return `QZ çap alınmadı: ${raw.slice(0, 160)}`;
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
): Promise<PrintDirectResult> {
  // useQz:  true → QZ is the intended printer (cafés with QZ Tray). Failure is
  //         surfaced to the user — a browser dialog must NOT open, its mm CSS
  //         renders broken on A4/US-Letter preview and the receipt comes out cut
  //         (user complaint: “QZ machine still opens the print window”).
  //         false → QZ is skipped entirely (caller chose agent/browser).
  //         undefined → legacy: agent first, QZ second, window last.
  // The browser dialog is only the rescue for machines where QZ honestly does
  // NOT exist (script can't load at all) and the caller allowed the fallback.
  const qzFirst = options?.useQz === true;

  let qzScriptUnavailable = false;

  async function tryQz(): Promise<{ ok: boolean; error?: string; scriptUnavailable?: boolean }> {
    try {
      const { qzPrintHtml, qzPrintRaw } = await import('./qz');
      // Use raw ESC/POS path whenever rawCommands are provided — the commands
      // are already ASCII-sanitized by sanitizeEscPosText so no Cyrillic issue.
      // HTML pixel mode is reserved only for cases where no raw commands exist.
      const rawSafe = Boolean(options?.rawCommands);
      if (rawSafe) {
        await qzPrintRaw(options!.rawCommands as string, options?.printerName);
      } else {
        await qzPrintHtml(html, {
          printerName: options?.printerName,
          paperWidth: options?.paperWidth || '58mm',
        });
      }
      return { ok: true };
    } catch (err) {
      console.warn('QZ Tray print attempted but failed:', err);
      const raw = String((err as any)?.message || err || '');
      const scriptUnavailable = /script load failed|script not loaded|library not available/i.test(raw);
      if (scriptUnavailable) qzScriptUnavailable = true;
      return { ok: false, error: friendlyQzError(err), scriptUnavailable };
    }
  }

  let lastError: string | undefined;

  // 1. QZ first when useQz is set (explicit printer + paper width), then local
  //    agent as silent rescue, then a clear error — never the browser dialog.
  if (qzFirst) {
    const qz = await tryQz();
    if (qz.ok) return { method: 'qz', success: true };
    lastError = qz.error;

    try {
      const agentSuccess = await printViaLocalAgent(html, options?.printerName);
      if (agentSuccess) {
        return { method: 'agent', success: true };
      }
    } catch {}

    // QZ is the operator's chosen channel. When QZ fails for any reason
    // (not running, cert not accepted, connection refused) and the caller
    // allows browser fallback, open the browser print dialog as last resort.
    // Without this, non-QZ machines silently get no print at all.
    if (options?.allowBrowserFallback === true) {
      const browserSuccess = printHtmlViaBrowserIframe(html, options?.paperWidth);
      if (browserSuccess) {
        return { method: 'browser', success: true };
      }
    }
    return { method: 'none', success: false, error: lastError || 'QZ Tray çapı alınmadı' };
  }

  // 2-3. Without QZ-first: local Print Agent, then (legacy) QZ second.
  try {
    const agentSuccess = await printViaLocalAgent(html, options?.printerName);
    if (agentSuccess) {
      return { method: 'agent', success: true };
    }
  } catch {}

  if (options?.useQz === false) {
    // Caller explicitly disabled QZ — it must not be attempted on the side.
    if (options?.allowBrowserFallback === true) {
      const browserSuccess = printHtmlViaBrowserIframe(html, options?.paperWidth);
      if (browserSuccess) {
        return { method: 'browser', success: true };
      }
    }
    return { method: 'none', success: false, error: 'Çap mediası əlçan deyil' };
  }

  // Legacy (undefined): QZ second, then browser dialog as the classic final rescue.
  const qz = await tryQz();
  if (qz.ok) return { method: 'qz', success: true };
  lastError = qz.error;

  if (options?.allowBrowserFallback === true) {
    const browserSuccess = printHtmlViaBrowserIframe(html, options?.paperWidth);
    if (browserSuccess) {
      return { method: 'browser', success: true };
    }
  }

  return { method: 'none', success: false, error: lastError || 'Çap mediası əlçan deyil' };
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
