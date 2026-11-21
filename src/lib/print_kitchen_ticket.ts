import { buildKitchenTicketHtml, KitchenTicketData } from './kitchen_ticket_html';
import { buildKitchenTicketEscPos } from './escpos_builder';
import { printDirectOrFallback } from './local_print_agent';
import { wasTicketPrinted, markTicketPrinted, clearTicketPrinted } from './print_dedupe';

type PaperWidth = '58mm' | '80mm';

export interface PrintKitchenTicketOptions {
  ticket: KitchenTicketData;
  lang?: 'az' | 'ru' | 'en';
  companyName?: string;
  paperWidth?: PaperWidth;
  printerName?: string;
  useQz?: boolean;
  printEngine?: string;
  allowBrowserFallback?: boolean;
  /**
   * İdiompo­tentlik açarı. Verilirse, eyni açar ilə təkrar çap `print_dedupe`
   * vasitəsilə (2 saat TTL) qarşısından alınır. Agent üçün də sabit ID yaranır.
   * Yalnız dedupe === true və açıq dedupeKey olduqda işləyir.
   */
  dedupeKey?: string;
  /**
   * Dedupe aktivləşdirilsin? Standart `false`. Manual təkrar-çap üçün `false`
   * ötürülməlidir ki, eyni çek təkrar çap olunsun.
   */
  dedupe?: boolean;
}

/**
 * Metbəx çeki çapını vahid yerdən idarə edir: HTML + ESC/POS qurur və
 * printDirectOrFallback ilə göndərir. Dedupe (print_dedupe) burada mərkəzləşir,
 * beləliklə həm ofisiant (POS / Masa) həm də KDS tərəfi eyni qoruyucudan faydalanır.
 */
export async function printKitchenTicket(
  opts: PrintKitchenTicketOptions,
): Promise<{ success: boolean; method?: string; error?: string; deduped?: boolean }> {
  const {
    ticket,
    lang = 'az',
    companyName = '',
    paperWidth = '58mm',
    printerName,
    useQz = false,
    printEngine = 'raw_escpos',
    allowBrowserFallback = false,
  } = opts;

  // Dedupe yalnız və yalnız çağırıcı açıq şəkildə `opts.dedupe === true` VƏ `opts.dedupeKey`
  // təyin etdikdə (məsələn KDS avto-polling fon dövründə) işə düşür.
  // Ofisiantın və ya POS-un birbaşa sifariş göndərməsi həmişə 100% çap olunmalıdır (heç vaxt bloklanmır).
  const dedupeKey = opts.dedupe === true && opts.dedupeKey ? opts.dedupeKey : '';

  if (dedupeKey && wasTicketPrinted(dedupeKey)) {
    return { success: true, method: 'deduped', deduped: true };
  }

  const html = buildKitchenTicketHtml({ ticket, lang, companyName, paperWidth });
  const rawCmds = buildKitchenTicketEscPos(ticket, { paperWidth });

  // Automatic retries of one KDS ticket share an agent job ID, including reloads.
  // Manual reprints deliberately receive a fresh ID in printDirectOrFallback.
  const jobId = dedupeKey ? `kds_${Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`${window.location.origin}:${dedupeKey}`),
  ))).map(byte => byte.toString(16).padStart(2, '0')).join('')}` : undefined;

  const res = await printDirectOrFallback(html, {
    printerName,
    jobId,
    useQz,
    paperWidth,
    printEngine: printEngine === 'pixel_html' ? 'pixel_html' : 'raw_escpos',
    rawCommands: rawCmds,
    allowBrowserFallback,
  });

  if (dedupeKey) {
    if (res.success) {
      markTicketPrinted(dedupeKey);
    } else {
      clearTicketPrinted(dedupeKey);
    }
  }
  return res;
}
