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
  cmd += '1x Test Mehsul 1\n';
  cmd += '2x Test Mehsul 2\n';
  cmd += '--------------------------------\n';
  cmd += 'QZ Tray Baglantisi Ugurludur!\n';
  cmd += '\n\n\n\n';
  cmd += GS + 'V' + '\x41' + '\x03';
  return cmd;
}
