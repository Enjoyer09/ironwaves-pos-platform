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
   * vasitəsilə (2 saat TTL) qarşısından alınır. Verilmədikdə məzmun-haşından
   * avtomatik yaradılır.
   */
  dedupeKey?: string;
  /**
   * Dedupe aktivləşdirilsin? Standart `true`. Manual təkrar-çap üçün `false`
   * ötürülməlidir ki, eyni çek təkrar çap olunsun.
   */
  dedupe?: boolean;
}

function hashTicket(ticket: KitchenTicketData): string {
  try {
    const payload = JSON.stringify({
      t: ticket.table_label || ticket.table_name || ticket.order_id || '',
      o: ticket.order_type || '',
      i: (ticket.items || []).map((it) => `${it.qty}x${it.item_name}`).sort(),
    });
    let h = 0;
    for (let i = 0; i < payload.length; i += 1) {
      h = (h * 31 + payload.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
  } catch {
    return 'unknown';
  }
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
    allowBrowserFallback = true,
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

  const res = await printDirectOrFallback(html, {
    printerName,
    useQz,
    paperWidth,
    printEngine,
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
