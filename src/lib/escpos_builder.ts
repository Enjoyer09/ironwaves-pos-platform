import { KitchenTicketData } from './kitchen_ticket_html';

const ESC = '\x1B';
const GS = '\x1D';

/**
 * Strips non-ASCII characters to standard Latin equivalents for raw thermal code pages (CP437/PC857)
 */
export function sanitizeEscPosText(text: string): string {
  if (!text) return '';
  return text
    .replace(/Ə/g, 'E')
    .replace(/ə/g, 'e')
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'g')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .replace(/I/g, 'I')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'o')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 's')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'u')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'c');
}

/**
 * Normalizes a stored `modifier_json` string into ticket-ready modifier fields.
 * Safe on null / non-JSON / unexpected shapes (returns {}). Accepts an array of
 * strings, an array of `{name|label, price?}` objects, or a `{modifiers|selected}`
 * wrapper. Today `modifier_json` is unpopulated (café quick-mods live in `note`);
 * this keeps the send-time ticket forward-compatible with structured modifiers.
 */
export function parseModifierJson(input?: string | null): {
  modifiers?: Array<{ name: string; price?: number | string }>;
  selected_modifiers?: string[];
} {
  if (!input || typeof input !== 'string') return {};
  let parsed: any;
  try {
    parsed = JSON.parse(input);
  } catch {
    return {};
  }
  if (!parsed) return {};
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.modifiers)
      ? parsed.modifiers
      : Array.isArray(parsed?.selected)
        ? parsed.selected
        : null;
  if (!arr) return {};
  const names: string[] = [];
  const objs: Array<{ name: string; price?: number | string }> = [];
  for (const el of arr) {
    if (typeof el === 'string') {
      const name = el.trim();
      if (name) names.push(name);
    } else if (el && typeof el === 'object' && (el.name || el.label)) {
      const name = String(el.name || el.label).trim();
      if (name) objs.push({ name, price: el.price });
    }
  }
  const out: { modifiers?: Array<{ name: string; price?: number | string }>; selected_modifiers?: string[] } = {};
  if (objs.length) out.modifiers = objs;
  if (names.length) out.selected_modifiers = names;
  return out;
}

export interface EscPosTicketItem {
  item_name?: string;
  name?: string;
  qty?: number;
  quantity?: number;
  notes?: string;
  modifiers?: Array<{ name: string; price?: number | string }>;
  selected_modifiers?: string[];
  seat_label?: string;
  seat?: string;
  cup_mode?: 'paper' | 'glass';
}

export interface EscPosTicketData {
  company_name?: string;
  ticket_id?: string;
  order_id?: string;
  display_order_id?: string;
  table_label?: string | null;
  table_name?: string | null;
  order_type_label?: string;
  order_type?: string;
  created_at?: string | number | Date;
  server_name?: string;
  cup_mode?: 'paper' | 'glass';
  notes?: string;
  items: EscPosTicketItem[];
}

function wrapEscPosText(text: string, maxLen: number): string[] {
  if (!text) return [];
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + (currentLine ? ' ' : '') + word).length <= maxLen) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      if (word.length > maxLen) {
        let remaining = word;
        while (remaining.length > maxLen) {
          lines.push(remaining.slice(0, maxLen));
          remaining = remaining.slice(maxLen);
        }
        currentLine = remaining;
      } else {
        currentLine = word;
      }
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function centerText(text: string, width: number): string {
  const t = text.slice(0, width);
  const pad = Math.max(0, Math.floor((width - t.length) / 2));
  return ' '.repeat(pad) + t;
}

/**
 * Builds native ESC/POS thermal printer commands for Kitchen Order Tickets
 */
export function buildKitchenTicketEscPos(
  ticket: EscPosTicketData | KitchenTicketData,
  options?: { paperWidth?: '58mm' | '80mm' }
): string {
  const is58 = (options?.paperWidth || '58mm') === '58mm';
  // 58mm paper: Font A = 32 chars max, use 30 for safety
  // 80mm paper: Font A = 42 chars max, use 40 for safety
  const lineChars = is58 ? 30 : 40;
  const solidLine = '='.repeat(lineChars) + '\n';
  const dashLine = '-'.repeat(lineChars) + '\n';
  const dotLine = '. '.repeat(Math.floor(lineChars / 2)).trimEnd() + '\n';

  // Helper: is this string a raw UUID (not a display label)?
  const isUUID = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());

  // Resolve table display - never show raw UUID
  const rawTarget =
    (ticket as any).order_type_label ||
    ticket.table_label ||
    (ticket as any).table_name;

  const tableDisplay =
    rawTarget && !isUUID(String(rawTarget))
      ? sanitizeEscPosText(String(rawTarget)).toUpperCase()
      : 'SIFARIS';

  let cmd = '';

  // Font helpers: ESC ! bit layout varies on cheap thermal firmwares
  // (emphasis bit can halve the printable width), so use the widely
  // supported ESC E (bold) and GS ! (character size) commands instead.
  const boldOn = ESC + 'E\x01';
  const boldOff = ESC + 'E\x00';
  const doubleHeightOn = GS + '!\x01';  // height x2, width unchanged
  const sizeReset = GS + '!\x00';

  // ── INIT ──────────────────────────────────────────
  cmd += ESC + '@';       // Initialize printer (resets all settings)
  cmd += ESC + 't\x00';  // Code page PC437 - most compatible, no special chars

  // ── HEADER ────────────────────────────────────────
  cmd += ESC + 'a\x01';  // Center align

  // Company name (normal font)
  const comp = (ticket as any).company_name;
  if (comp) {
    cmd += ESC + '!\x00';
    cmd += sanitizeEscPosText(comp).toUpperCase() + '\n';
  }

  cmd += solidLine;

  // "METBEX SIFARISI" — bold via ESC E (does not change column width)
  cmd += boldOn;
  cmd += centerText('METBEX  SIFARISI', lineChars) + '\n';
  cmd += boldOff;

  cmd += dashLine;

  // MASA label — double height (GS !) + bold, width unchanged
  cmd += doubleHeightOn;
  cmd += boldOn;
  const masaLine = tableDisplay.slice(0, lineChars);  // Hard cap at lineChars
  cmd += centerText(masaLine, lineChars) + '\n';
  cmd += boldOff;
  cmd += sizeReset;

  cmd += solidLine;

  // ── INFO ROW ──────────────────────────────────────
  cmd += ESC + 'a\x00';  // Left align
  cmd += ESC + '!\x00';  // Normal

  const now = ticket.created_at ? new Date(ticket.created_at) : new Date();
  const timeStr = now.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
  const dateStr = `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getFullYear()}`;

  const timeLabel = `Saat: ${timeStr}`;
  const dateLabel = `Tarix: ${dateStr}`;
  // Keep on one line only if it comfortably fits; some firmwares expose fewer
  // columns than the nominal 58mm width, so fall back to two lines.
  if (timeLabel.length + dateLabel.length + 2 <= lineChars - 4) {
    const gap = Math.max(1, lineChars - timeLabel.length - dateLabel.length);
    cmd += timeLabel + ' '.repeat(gap) + dateLabel + '\n';
  } else {
    cmd += timeLabel + '\n' + dateLabel + '\n';
  }

  const rawTicketId = (ticket as any).ticket_id || (ticket as any).order_id || (ticket as any).display_order_id || '';
  const ticketDisplayId = String(rawTicketId).split('-')[0].toUpperCase();
  if (ticketDisplayId) {
    cmd += boldOn;
    cmd += `Cek: #${ticketDisplayId}\n`;
    cmd += boldOff;
  }

  if (ticket.server_name) {
    cmd += `Ofisiant: ${sanitizeEscPosText(ticket.server_name)}\n`;
  }
  if (ticket.cup_mode) {
    cmd += `Fincan: ${ticket.cup_mode === 'glass' ? 'Suse' : 'Kagiz'}\n`;
  }
  if (ticket.notes) {
    const noteLines = wrapEscPosText(sanitizeEscPosText(ticket.notes), lineChars - 8);
    noteLines.forEach((ln) => { cmd += `! QEYD: ${ln}\n`; });
  }

  cmd += solidLine;

  // ── ITEMS ─────────────────────────────────────────
  const items = ticket.items || [];
  items.forEach((item: any, idx: number) => {
    const qty = Number(item.qty || item.quantity || 1);
    const rawName = sanitizeEscPosText(String(item.item_name || item.name || ''));

    // Item number badge + qty
    cmd += boldOn;
    cmd += `${(idx + 1)}. `;
    cmd += boldOff;

    // Item name in double height (GS !) + bold — width unchanged
    cmd += doubleHeightOn;
    cmd += boldOn;
    const prefix = `${qty}x `;
    const availWidth = lineChars - prefix.length - 3;
    const nameLines = wrapEscPosText(rawName, availWidth);
    if (nameLines.length > 0) {
      cmd += `${prefix}${nameLines[0]}\n`;
      for (let i = 1; i < nameLines.length; i++) {
        cmd += `   ${nameLines[i]}\n`;
      }
    } else {
      cmd += `${prefix}${rawName}\n`;
    }
    cmd += boldOff;
    cmd += sizeReset;  // Reset normal

    // Modifiers
    const mods: string[] = [];
    if (Array.isArray(item.modifiers)) {
      item.modifiers.forEach((m: any) => { if (m?.name) mods.push(sanitizeEscPosText(m.name)); });
    }
    if (Array.isArray(item.selected_modifiers)) {
      item.selected_modifiers.forEach((m: any) => { if (m) mods.push(sanitizeEscPosText(m)); });
    }
    mods.forEach((m) => {
      wrapEscPosText(`+ ${m}`, lineChars - 4).forEach((ml) => {
        cmd += `    ${ml}\n`;
      });
    });

    // Seat
    const seat = item.seat_label || item.seat;
    if (seat) {
      cmd += `  >> Yer: ${sanitizeEscPosText(seat)}\n`;
    }

    // Item note
    if (item.notes) {
      wrapEscPosText(`! ${sanitizeEscPosText(item.notes)}`, lineChars - 4).forEach((nl) => {
        cmd += `    ${nl}\n`;
      });
    }

    cmd += dotLine;
  });

  // ── TOTAL ─────────────────────────────────────────
  const totalQty = items.reduce((sum: number, item: any) => sum + Number(item.qty || item.quantity || 1), 0);

  cmd += ESC + 'a\x01';  // Center
  cmd += boldOn;
  cmd += `UMUMI: ${totalQty} MEHSUL\n`;
  cmd += boldOff;

  cmd += solidLine;

  cmd += centerText('-- METBEX CAPI --', lineChars) + '\n';

  // ── FEED + CUT ────────────────────────────────────
  cmd += '\n\n\n\n';
  cmd += GS + 'V\x41\x03';  // Full cut

  return cmd;
}

function formatEscPosTwoColumns(left: string, right: string, width: number): string {
  const rightStr = right.trim();
  const maxLeftLen = Math.max(1, width - rightStr.length - 1);
  if (left.length <= maxLeftLen) {
    const spaces = Math.max(1, width - left.length - rightStr.length);
    return left + ' '.repeat(spaces) + rightStr + '\n';
  }
  const lines = wrapEscPosText(left, maxLeftLen);
  let res = lines[0] + ' '.repeat(Math.max(1, width - lines[0].length - rightStr.length)) + rightStr + '\n';
  for (let i = 1; i < lines.length; i++) {
    res += lines[i] + '\n';
  }
  return res;
}

/**
 * Generates an ESC/POS raster bitmap command (GS v 0) from QR code URL.
 * Works universally on 100% of POS thermal printers (XP-58, POS-58, Epson, Xprinter, etc.)
 * regardless of whether the firmware supports 2D barcode commands.
 */
export async function generateEscPosQrBitmap(text: string, moduleSize = 4): Promise<string> {
  if (!text) return '';
  try {
    const QRCode = (await import('qrcode')).default;
    // Generate black & white bitmap
    const qrData = await QRCode.create(text, { errorCorrectionLevel: 'M' });
    const modules = qrData.modules;
    const size = modules.size; // e.g. 25-33 modules
    const width = size * moduleSize;
    const height = size * moduleSize;
    const bytesWidth = Math.ceil(width / 8);

    // Build raw monochrome bytes
    const buffer = new Uint8Array(bytesWidth * height);
    for (let y = 0; y < height; y++) {
      const moduleY = Math.floor(y / moduleSize);
      for (let x = 0; x < width; x++) {
        const moduleX = Math.floor(x / moduleSize);
        if (modules.get(moduleX, moduleY)) {
          const byteIndex = y * bytesWidth + Math.floor(x / 8);
          const bitIndex = 7 - (x % 8);
          buffer[byteIndex] |= (1 << bitIndex);
        }
      }
    }

    const xL = bytesWidth % 256;
    const xH = Math.floor(bytesWidth / 256);
    const yL = height % 256;
    const yH = Math.floor(height / 256);

    let bin = '';
    for (let i = 0; i < buffer.length; i++) {
      bin += String.fromCharCode(buffer[i]);
    }

    // GS v 0 0 xL xH yL yH data...
    return ESC + 'a\x01' + GS + 'v0\x00' + String.fromCharCode(xL, xH, yL, yH) + bin + ESC + 'a\x00';
  } catch (err) {
    console.warn('Failed to generate ESC/POS QR bitmap:', err);
    return '';
  }
}

/**
 * Builds native ESC/POS thermal printer commands for Table Check Receipts
 */
export async function buildTableReceiptEscPos({
  tableLabel,
  operator,
  items,
  breakdown,
  companyName = 'iRonWaves Platform',
  voen = '',
  phone = '',
  address = '',
  feedbackUrl = '',
  footer = 'Bizi secdiyiniz ucun tesekkur edirik!',
  paperWidth = '58mm',
}: {
  tableLabel: string;
  operator: string;
  items: Array<{ item_name?: string; name?: string; qty?: number; quantity?: number; price?: number | string }>;
  breakdown: {
    itemsTotal: number;
    discountPercent?: number;
    discountAmount?: number;
    serviceFee?: number;
    deposit?: number;
    finalTotal: number;
    dueNow: number;
  };
  companyName?: string;
  voen?: string;
  phone?: string;
  address?: string;
  feedbackUrl?: string;
  footer?: string;
  paperWidth?: '58mm' | '80mm';
}): Promise<string> {
  const is58 = (paperWidth || '58mm') === '58mm';
  // 58mm paper: 32 columns full width
  // 80mm paper: 42 columns full width
  const lineChars = is58 ? 32 : 42;
  const solidLine = '='.repeat(lineChars) + '\n';
  const dashLine = '-'.repeat(lineChars) + '\n';

  const CTR  = ESC + 'a\x01'; // center
  const LEFT = ESC + 'a\x00'; // left
  const boldOn  = ESC + 'E\x01';
  const boldOff = ESC + 'E\x00';
  // Double-width (approx 15% wider feel, 2x actual) — used for shop name & total
  const dblWidOn  = GS + '!\x10';
  const dblWidOff = GS + '!\x00';

  let cmd = '';
  cmd += ESC + '@';         // full reset
  cmd += ESC + 't\x00';    // code page PC437
  cmd += '\n';              // one feed so printer doesn't clip first byte

  // ── Header (centered) ───────────────────────────────────────────
  cmd += CTR;
  const comp = sanitizeEscPosText((companyName || 'IronWaves POS').trim());
  if (comp) {
    cmd += boldOn + dblWidOn;
    cmd += centerText(comp, Math.floor(lineChars / 2)) + '\n';
    cmd += dblWidOff + boldOff;
  }

  const safeVoen    = sanitizeEscPosText((voen    || '').trim());
  const safePhone   = sanitizeEscPosText((phone   || '').trim());
  const safeAddress = sanitizeEscPosText((address || '').trim());
  if (safeVoen)    cmd += `VOEN: ${safeVoen}\n`;
  if (safePhone)   cmd += `Tel: ${safePhone}\n`;
  if (safeAddress) cmd += `${safeAddress}\n`;

  cmd += dashLine;
  cmd += boldOn;
  cmd += centerText('*** MASA HESABI ***', lineChars) + '\n';
  cmd += boldOff;
  cmd += dashLine;

  // ── Info rows (left-aligned two-column) ─────────────────────────
  cmd += LEFT;
  cmd += formatEscPosTwoColumns('Masa:', sanitizeEscPosText(tableLabel), lineChars);
  cmd += formatEscPosTwoColumns('Xidmet:', sanitizeEscPosText(operator || 'staff'), lineChars);

  const now = new Date();
  const timeStr = now.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
  const dateStr = `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getFullYear()}`;
  cmd += formatEscPosTwoColumns('Tarix:', `${dateStr} ${timeStr}`, lineChars);

  cmd += solidLine;

  // ── Items ───────────────────────────────────────────────────────
  cmd += LEFT;
  items.forEach((item) => {
    const qty = Number(item.qty || item.quantity || 1);
    const rawName = sanitizeEscPosText(String(item.item_name || item.name || 'Mehsul'));
    const linePrice = Number(item.price || 0) * qty;
    const priceStr = `${linePrice.toFixed(2)} M`;
    const label = `${qty}x ${rawName}`;
    cmd += boldOn + formatEscPosTwoColumns(label, priceStr, lineChars) + boldOff;
  });

  cmd += solidLine;

  // ── Breakdown ───────────────────────────────────────────────────
  cmd += formatEscPosTwoColumns('Sifaris cemi:', `${Number(breakdown.itemsTotal || 0).toFixed(2)} M`, lineChars);
  if (Number(breakdown.discountAmount || 0) > 0) {
    const discLabel = `Endirim (${Number(breakdown.discountPercent || 0).toFixed(0)}%):`;
    cmd += formatEscPosTwoColumns(discLabel, `-${Number(breakdown.discountAmount || 0).toFixed(2)} M`, lineChars);
  }
  if (Number(breakdown.serviceFee || 0) > 0) {
    cmd += formatEscPosTwoColumns('Servis haqqi:', `${Number(breakdown.serviceFee || 0).toFixed(2)} M`, lineChars);
  }
  if (Number(breakdown.deposit || 0) > 0) {
    cmd += formatEscPosTwoColumns('Depozit:', `${Number(breakdown.deposit || 0).toFixed(2)} M`, lineChars);
  }
  if (Number(breakdown.dueNow || 0) !== Number(breakdown.finalTotal || 0)) {
    cmd += formatEscPosTwoColumns('Elave odenis:', `${Number(breakdown.dueNow || 0).toFixed(2)} M`, lineChars);
  }

  cmd += solidLine;

  // ── YEKUN — double-width centered ───────────────────────────────
  cmd += CTR + boldOn + dblWidOn;
  const totalStr = `${Number(breakdown.finalTotal || 0).toFixed(2)} M`;
  cmd += `YEKUN: ${totalStr}\n`;
  cmd += dblWidOff + boldOff;

  // ── Feedback QR Code ─────────────────────────────────────────────
  if (feedbackUrl) {
    const qrBitmapCmd = await generateEscPosQrBitmap(feedbackUrl, is58 ? 4 : 5);
    if (qrBitmapCmd) {
      cmd += dashLine;
      cmd += CTR;
      cmd += '\n' + qrBitmapCmd + '\n';
      cmd += boldOn + 'Reyiniz bizim ucun onemlidir!\n' + boldOff;
      cmd += 'QR skan edib reyinizi bildirin.\n';
    }
  }

  // ── Footer ───────────────────────────────────────────────────────
  cmd += dashLine;
  cmd += CTR;
  cmd += sanitizeEscPosText(footer || 'Bizi secdiyiniz ucun tesekkur edirik!') + '\n';

  cmd += '\n\n\n\n';
  cmd += GS + 'V\x41\x03'; // auto-cut

  return cmd;
}

/**
 * Builds native ESC/POS thermal printer commands for POS Sales Receipts
 */
export async function buildSaleReceiptEscPos({
  sale,
  profile,
  operator,
  feedbackUrl = '',
  paperWidth = '58mm',
}: {
  sale: any;
  profile?: any;
  operator?: string;
  feedbackUrl?: string;
  paperWidth?: '58mm' | '80mm';
}): Promise<string> {
  const is58 = (paperWidth || '58mm') === '58mm';
  const lineChars = is58 ? 32 : 42;
  const solidLine = '='.repeat(lineChars) + '\n';
  const dashLine = '-'.repeat(lineChars) + '\n';

  const boldOn = ESC + 'E\x01';
  const boldOff = ESC + 'E\x00';
  const doubleHeightOn = GS + '!\x01';
  const sizeReset = GS + '!\x00';

  let cmd = '';
  cmd += ESC + '@';
  cmd += ESC + 't\x00';

  // Header Center
  cmd += ESC + 'a\x01';
  const comp = profile?.company_name || 'iRonWaves Platform';
  cmd += boldOn;
  cmd += sanitizeEscPosText(comp) + '\n';
  cmd += boldOff;

  cmd += `VOEN: ${sanitizeEscPosText(profile?.voen || '-')}\n`;
  cmd += `Tel: ${sanitizeEscPosText(profile?.phone || '-')}\n`;
  if (profile?.address && profile.address !== '-') cmd += `${sanitizeEscPosText(profile.address)}\n`;

  cmd += dashLine;
  cmd += boldOn;
  cmd += centerText('*** KASSA CEKI (DAXILI) ***', lineChars) + '\n';
  cmd += boldOff;
  cmd += dashLine;

  // Metadata Left
  cmd += ESC + 'a\x00';
  const saleId = String(sale?.sale_id || sale?.id || '').split('-')[0].toUpperCase();
  if (saleId) cmd += formatEscPosTwoColumns('Satis ID:', `#${saleId}`, lineChars);
  cmd += formatEscPosTwoColumns('Operator:', sanitizeEscPosText(operator || sale?.cashier || 'staff'), lineChars);

  const now = sale?.created_at ? new Date(sale.created_at) : new Date();
  const timeStr = now.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });
  const dateStr = `${now.getDate().toString().padStart(2, '0')}.${(now.getMonth() + 1).toString().padStart(2, '0')}.${now.getFullYear()}`;
  cmd += formatEscPosTwoColumns('Tarix:', `${dateStr} ${timeStr}`, lineChars);
  cmd += formatEscPosTwoColumns('Tip:', sanitizeEscPosText(sale?.order_type || 'Take Away'), lineChars);

  cmd += solidLine;

  const items = Array.isArray(sale?.items) ? sale.items : [];
  items.forEach((item: any) => {
    const qty = Number(item.qty || item.quantity || 1);
    const rawName = sanitizeEscPosText(String(item.item_name || item.name || 'Mehsul'));
    const lineTotal = Number(item.line_total ?? item.total ?? 0) || (Number(item.price || 0) * qty);
    const label = `${qty}x ${rawName}`;
    cmd += formatEscPosTwoColumns(label, `${lineTotal.toFixed(2)} M`, lineChars);
  });

  cmd += solidLine;

  const subtotal = Number(sale?.original_total ?? 0) || (Number(sale?.total || 0) + Number(sale?.discount_amount || 0));
  const discount = Number(sale?.discount_amount || 0);
  const total = Number(sale?.total || 0);

  cmd += formatEscPosTwoColumns('Ara cem:', `${subtotal.toFixed(2)} M`, lineChars);
  if (discount > 0) {
    cmd += formatEscPosTwoColumns('Endirim:', `-${discount.toFixed(2)} M`, lineChars);
  }

  cmd += solidLine;

  cmd += doubleHeightOn;
  cmd += boldOn;
  cmd += formatEscPosTwoColumns('YEKUN:', `${total.toFixed(2)} M`, lineChars);
  cmd += boldOff;
  cmd += sizeReset;

  const payMethod = sanitizeEscPosText(String(sale?.payment_method || 'Nagd'));
  cmd += formatEscPosTwoColumns('Odenis:', payMethod, lineChars);

  // Feedback QR Code (Universal Raster Bitmap)
  if (feedbackUrl) {
    const qrBitmapCmd = await generateEscPosQrBitmap(feedbackUrl, is58 ? 4 : 5);
    if (qrBitmapCmd) {
      cmd += dashLine;
      cmd += '\n' + qrBitmapCmd + '\n';
      cmd += ESC + 'a\x01';
      cmd += 'Reyiniz bizim ucun onemlidir!\n';
      cmd += 'QR skan edib reyinizi bildirin.\n';
    }
  }

  cmd += dashLine;
  cmd += ESC + 'a\x01';
  cmd += sanitizeEscPosText(profile?.receipt_footer || 'Bizi secdiyiniz ucun tesekkur edirik!') + '\n';

  cmd += '\n\n\n\n';
  cmd += GS + 'V\x41\x03';

  return cmd;
}

/**
 * Builds a simple test receipt for POS / Kitchen testing
 */
export function buildTestTicketEscPos(type: 'cashier' | 'kitchen', printerName: string): string {
  let cmd = '';
  cmd += ESC + '@';
  cmd += ESC + 't' + '\x00';
  cmd += ESC + 'a' + '\x01';
  cmd += GS + '!' + '\x01';
  cmd += ESC + 'E' + '\x01';
  cmd += '=== TEST CAPI ===\n';
  cmd += ESC + 'E' + '\x00';
  cmd += GS + '!' + '\x00';
  cmd += `Nov: ${type === 'kitchen' ? 'METBEX' : 'KASSA'}\n`;
  cmd += `Printer: ${sanitizeEscPosText(printerName || 'Default')}\n`;
  cmd += `Saat: ${new Date().toLocaleTimeString()}\n`;
  cmd += '--------------------------------\n';
  cmd += '1x Test Mehsul 1         2.50 M\n';
  cmd += '2x Test Mehsul 2         5.00 M\n';
  cmd += '--------------------------------\n';
  cmd += 'QZ Tray Baglantisi Ugurludur!\n';
  cmd += '\n\n\n\n';
  cmd += GS + 'V' + '\x41' + '\x03';
  return cmd;
}
