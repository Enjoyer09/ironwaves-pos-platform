import { withThermalReceiptPrintCss } from './receipt_print_css';

const AGENT_BASE_URL = 'http://127.0.0.1:17777';
const REQUEST_TIMEOUT_MS = 15000;
// Legacy agents acknowledge only after spooling; a lost response is treated as unknown.
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

type AgentAttempt = { success: boolean; notSent?: boolean; unsupported?: boolean; pending?: boolean; error?: string; jobId: string };
function newPrintJobId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}
async function timedFetch(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { window.clearTimeout(timer); }
}
const uncertainPrintMessage = 'Çapın vəziyyəti təsdiqlənmədi. Təkrar çek göndərilmədi; printer növbəsini yoxlayın.';
async function submitAgentPrint(kind: 'raw' | 'html', content: string, printerName: string | undefined, jobId: string): Promise<AgentAttempt> {
  // The health check is read-only. A busy 4 GB cashier PC can miss the first
  // 1.5s window while opening the receipt, so retry this check only. Never
  // replay a POST: after dispatch its spool outcome may be unknown.
  let supportsJobs = false;
  let healthy = false;
  for (let attempt = 0; attempt < 2 && !healthy; attempt += 1) {
    try {
      const health = await timedFetch(`${AGENT_BASE_URL}/health`, { method: 'GET' }, 3000);
      if (!health.ok) continue;
      const data = await health.json();
      supportsJobs = data?.capabilities?.print_jobs === true;
      healthy = true;
    } catch { /* The read-only preflight can be retried safely. */ }
  }
  if (!healthy) return { success: false, notSent: true, jobId };
  try {
    const response = await timedFetch(`${AGENT_BASE_URL}/print-${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [kind]: content, printer_name: String(printerName || '').trim() || undefined, job_id: jobId }),
    }, kind === 'raw' ? 6000 : AGENT_PRINT_TIMEOUT_MS);
    if (response.ok) {
      if (supportsJobs) {
        const data = await response.json();
        if (data?.job?.job_id !== jobId || !['queued', 'processing', 'submitted'].includes(data?.job?.status)) {
          return { success: false, error: uncertainPrintMessage, jobId };
        }
        return { success: true, pending: data.job.status !== 'submitted', jobId };
      }
      return { success: true, jobId };
    }
    // Older agents may not implement RAW at all. A missing route did not spool.
    if (response.status === 404 || response.status === 405) return { success: false, notSent: true, unsupported: true, jobId };
    if (response.status === 409) return { success: false, jobId, error: 'Çap ID-si başqa çek üçün istifadə edilib. Təkrar çap göndərilmədi.' };
    // Even an HTTP error can follow a partial spool submission on older agents.
  } catch { /* Recover status below; never start a second print engine. */ }
  if (supportsJobs) {
    try {
      const response = await timedFetch(`${AGENT_BASE_URL}/jobs/${encodeURIComponent(jobId)}`, { method: 'GET' }, 1500);
      if (response.ok) {
        const data = await response.json();
        if (data?.job?.job_id === jobId && ['queued', 'processing', 'submitted'].includes(data?.job?.status)) {
          return { success: true, pending: data.job.status !== 'submitted', jobId };
        }
      }
    } catch { /* An unobservable job must not be replayed automatically. */ }
  }
  return { success: false, error: uncertainPrintMessage, jobId };
}
export async function printRawViaLocalAgent(rawCommands: string, printerName?: string): Promise<boolean> {
  if (!rawCommands.trim()) return false;
  return (await submitAgentPrint('raw', rawCommands, printerName, newPrintJobId())).success;
}
export async function printViaLocalAgent(html: string, printerName?: string): Promise<boolean> {
  const content = withThermalReceiptPrintCss(html);
  if (!content.trim()) return false;
  return (await submitAgentPrint('html', content, printerName, newPrintJobId())).success;
}

export type PrintDirectResult = {
  method: 'agent' | 'qz' | 'browser' | 'none';
  success: boolean;
  jobId?: string;
  /** Accepted by the agent; physical paper output has not been confirmed. */
  pending?: boolean;
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
    printerName?: string; useQz?: boolean; paperWidth?: '58mm' | '80mm';
    printEngine?: 'pixel_html' | 'raw_escpos'; rawCommands?: string;
    allowBrowserFallback?: boolean; preferHtml?: boolean;
    /** Reuse only for a retry of the same logical job, never a manual reprint. */
    jobId?: string;
  }
): Promise<PrintDirectResult> {
  const rawSafe = Boolean(options?.rawCommands) && !options?.preferHtml;
  const jobId = options?.jobId || newPrintJobId();
  if (options?.useQz === true) {
    try {
      const { qzPrintHtml, qzPrintRaw } = await import('./qz');
      if (rawSafe) await qzPrintRaw(options!.rawCommands!, options?.printerName);
      else await qzPrintHtml(html, { printerName: options?.printerName, paperWidth: options?.paperWidth || '80mm' });
      return { method: 'qz', success: true, jobId };
    } catch (err) {
      // QZ can also lose its acknowledgement after dispatch; do not double-print.
      return { method: 'none', success: false, jobId, error: friendlyQzError(err) };
    }
  }
  let result = await submitAgentPrint(rawSafe ? 'raw' : 'html',
    rawSafe ? options!.rawCommands! : withThermalReceiptPrintCss(html), options?.printerName, jobId);
  if (rawSafe && result.unsupported) {
    result = await submitAgentPrint('html', withThermalReceiptPrintCss(html), options?.printerName, jobId);
  }
  if (result.success) return { method: 'agent', success: true, jobId, pending: result.pending };
  if (!result.notSent) return { method: 'none', success: false, jobId, error: result.error || uncertainPrintMessage };
  // Browser fallback is safe only before dispatch or after an explicit missing route.
  if (options?.allowBrowserFallback !== false && printHtmlViaBrowserIframe(html, options?.paperWidth)) {
    return { method: 'browser', success: true, jobId };
  }
  return { method: 'none', success: false, jobId, error: 'Çap agentinə qoşulmaq mümkün olmadı. Agentin açıq olduğunu yoxlayın.' };
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
