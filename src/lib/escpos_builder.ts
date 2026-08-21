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

/**
 * Builds native ESC/POS thermal printer commands for Kitchen Order Tickets
 */
export function buildKitchenTicketEscPos(
  ticket: EscPosTicketData | KitchenTicketData,
  options?: { paperWidth?: '58mm' | '80mm' }
): string {
  const is58 = (options?.paperWidth || '58mm') === '58mm';
  const divider = is58
    ? '--------------------------------\n'
    : '------------------------------------------\n';
  const dotted = is58
    ? '- - - - - - - - - - - - - - - -\n'
    : '- - - - - - - - - - - - - - - - - - - - - \n';

  let cmd = '';

  // 1. Initialize printer & set code page
  cmd += ESC + '@'; // Initialize
  cmd += ESC + 't' + '\x00'; // Code table standard

  // 2. Header (Centered, Large)
  cmd += ESC + 'a' + '\x01'; // Center
  const comp = (ticket as any).company_name;
  if (comp) {
    cmd += ESC + '!' + '\x00'; // Normal
    cmd += sanitizeEscPosText(comp).toUpperCase() + '\n';
  }
  cmd += ESC + '!' + '\x18'; // Double height + bold
  cmd += '*** METBEX SIFARISI ***\n';
  cmd += ESC + '!' + '\x38'; // Double width + double height + bold
  const target =
    (ticket as any).order_type_label ||
    ticket.table_label ||
    (ticket.table_name ? `MASA ${ticket.table_name}` : 'SIFARIS');
  cmd += sanitizeEscPosText(target).toUpperCase() + '\n';
  cmd += ESC + '!' + '\x00'; // Reset normal

  cmd += divider;

  // 3. Metadata (Left aligned)
  cmd += ESC + 'a' + '\x00'; // Left align
  const orderId = (ticket as any).display_order_id || ticket.order_id || ticket.ticket_id || '1';
  const now = ticket.created_at ? new Date(ticket.created_at) : new Date();
  const dateStr = now.toLocaleDateString('az-AZ');
  const timeStr = now.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit' });

  cmd += `Cek: #${orderId}   Saat: ${timeStr}\n`;
  cmd += `Tarix: ${dateStr}\n`;
  if (ticket.server_name) {
    cmd += `Xidmet: ${sanitizeEscPosText(ticket.server_name)}\n`;
  }
  if (ticket.cup_mode) {
    cmd += `Fincan: ${ticket.cup_mode === 'glass' ? 'Suse' : 'Kagiz'}\n`;
  }
  if (ticket.notes) {
    cmd += `* Qeyd: ${sanitizeEscPosText(ticket.notes)}\n`;
  }

  cmd += divider;

  // 4. Order Items
  (ticket.items || []).forEach((item: any) => {
    const qty = Number(item.qty || item.quantity || 1);
    const name = sanitizeEscPosText(String(item.item_name || item.name || ''));

    // Large bold line for item
    cmd += ESC + '!' + '\x28'; // Double height + Bold
    cmd += `${qty}x ${name}\n`;
    cmd += ESC + '!' + '\x00'; // Reset normal

    const mods: string[] = [];
    if (Array.isArray(item.modifiers)) {
      item.modifiers.forEach((m: any) => {
        if (m?.name) mods.push(m.name);
      });
    }
    if (Array.isArray(item.selected_modifiers)) {
      item.selected_modifiers.forEach((m: any) => {
        if (m) mods.push(m);
      });
    }

    if (mods.length > 0) {
      mods.forEach((m) => {
        cmd += `   + ${sanitizeEscPosText(m)}\n`;
      });
    }

    const seat = item.seat_label || item.seat;
    if (seat) {
      cmd += `   [ Yer: ${sanitizeEscPosText(seat)} ]\n`;
    }

    if (item.notes) {
      cmd += `   ! Qeyd: ${sanitizeEscPosText(item.notes)}\n`;
    }

    cmd += dotted;
  });

  // 5. Total
  const totalQty = (ticket.items || []).reduce(
    (sum: number, item: any) => sum + Number(item.qty || item.quantity || 1),
    0
  );
  cmd += ESC + '!' + '\x18'; // Double height + Bold
  cmd += `CEMI SAY: ${totalQty} eded\n`;
  cmd += ESC + '!' + '\x00'; // Reset normal

  cmd += ESC + 'a' + '\x01'; // Center
  cmd += '-- Metbex Capi --\n';

  // 6. Feed and Cut
  cmd += '\n\n\n\n'; // Feed 4 lines
  cmd += GS + 'V' + '\x41' + '\x03'; // Cut paper

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
  cmd += ESC + '!' + '\x18';
  cmd += '=== TEST CAPI ===\n';
  cmd += ESC + '!' + '\x00';
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
