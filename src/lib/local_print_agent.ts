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
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    // Remove any previous print frame to guarantee exactly 1 print dialog
    const existing = document.getElementById('iw-print-frame');
    if (existing && existing.parentNode) {
      try { existing.parentNode.removeChild(existing); } catch {}
    }

    const iframe = document.createElement('iframe');
    iframe.id = 'iw-print-frame';
    Object.assign(iframe.style, {
      position: 'fixed',
      top: '-9999px',
      left: '-9999px',
      width: '1px',
      height: '1px',
      border: '0',
      opacity: '0',
      pointerEvents: 'none',
      visibility: 'hidden',
    });
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      try { document.body.removeChild(iframe); } catch {}
      return false;
    }

    const cleanHtml = withThermalReceiptPrintCss(html);
    doc.open();
    doc.write(cleanHtml);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.warn('Browser print execution failed:', e);
      } finally {
        setTimeout(() => {
          try {
            const el = document.getElementById('iw-print-frame');
            if (el && el.parentNode) el.parentNode.removeChild(el);
          } catch {}
        }, 5000);
      }
    }, 250);

    return true;
  } catch (err) {
    console.warn('Browser print fallback error:', err);
    return false;
  }
}

export async function printRawViaLocalAgent(rawCommands: string, printerName?: string): Promise<boolean> {
  if (!rawCommands || !rawCommands.trim()) return false;
  try {
    const response = await fetch(`${AGENT_BASE_URL}/print-raw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw: rawCommands,
        printer_name: String(printerName || '').trim() || undefined,
      }),
      signal: timeoutSignal(3500),
    });
    return response.ok;
  } catch {
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
    preferHtml?: boolean;
  }
): Promise<PrintDirectResult> {
  const browserFallbackAllowed = options?.allowBrowserFallback !== false;
  let lastError = '';

  // 1) İldırım Sürətli ESC/POS Rejimi (0.05 saniyə):
  //    Mətbəx çekləri və kassa çekləri birbaşa Print Agent-in /print-raw
  //    axınına göndərilir (Chrome/HTML gözləməsi 0-a enir).
  if (options?.rawCommands && !options?.preferHtml) {
    try {
      const rawSuccess = await printRawViaLocalAgent(options.rawCommands, options?.printerName);
      if (rawSuccess) {
        return { method: 'agent', success: true };
      }
    } catch (e: any) {
      lastError = e?.message || '';
    }
  }

  // 2) Əgər istifadəçi açıq şəkildə QZ Tray seçibsə, QZ birinci sınansın (agent timeout gözlənilməsin)
  if (options?.useQz === true) {
    try {
      const { qzPrintHtml, qzPrintRaw } = await import('./qz');
      const rawSafe = Boolean(options?.rawCommands) && !options?.preferHtml;
      if (rawSafe) {
        await qzPrintRaw(options!.rawCommands as string, options?.printerName);
      } else {
        await qzPrintHtml(html, {
          printerName: options?.printerName,
          paperWidth: options?.paperWidth || '80mm',
        });
      }
      return { method: 'qz', success: true };
    } catch (err) {
      lastError = friendlyQzError(err);
      console.warn('QZ Tray print attempted but failed:', err);
    }
  }

  // 3) Əsas HTML Çap Yolu: Lokal Print Agent
  try {
    const agentSuccess = await printViaLocalAgent(html, options?.printerName);
    if (agentSuccess) {
      return { method: 'agent', success: true };
    }
  } catch (e: any) {
    lastError = e?.message || '';
  }

  // 4) Brauzer fallback (yalnız icazə verildikdə)
  if (browserFallbackAllowed) {
    const browserSuccess = printHtmlViaBrowserIframe(html, options?.paperWidth);
    if (browserSuccess) {
      return { method: 'browser', success: true };
    }
  }

  return {
    method: 'none',
    success: false,
    error:
      lastError ||
      'Çap Agent (və ya QZ Tray) tapılmadı. Termal çeklər brauzer dialoqu ilə ' +
        'düzgün çap olunmur (başlıq/fayl yolu və avto-kəsmə yoxdur). Zəhmət olmasa ' +
        'iRonWaves Print Agent-i işə salın: `npm run print-agent`.',
  };
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
