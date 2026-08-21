import { tx } from '../i18n';
import { THERMAL_RECEIPT_PRINT_CSS } from './receipt_print_css';

type TicketLang = 'az' | 'ru' | 'en';

export interface KitchenTicketItem {
  item_name: string;
  qty: number;
  category?: string;
  notes?: string;
  modifiers?: Array<{ name: string; price?: number | string }>;
  selected_modifiers?: string[];
  seat_label?: string;
  cup_mode?: 'paper' | 'glass';
}

export interface KitchenTicketData {
  ticket_id?: string;
  order_id?: string;
  table_label?: string | null;
  table_name?: string | null;
  order_type?: 'Dine In' | 'Take Away' | 'Order Online' | string;
  created_at?: string | number | Date;
  server_name?: string;
  cup_mode?: 'paper' | 'glass';
  notes?: string;
  items: KitchenTicketItem[];
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildKitchenTicketHtml({
  ticket,
  lang = 'az',
  companyName = '',
}: {
  ticket: KitchenTicketData;
  lang?: TicketLang;
  companyName?: string;
}): string {
  const displayId = String(ticket.ticket_id || ticket.order_id || 'ORDER').split('-')[0].toUpperCase();
  const dateObj = ticket.created_at ? new Date(ticket.created_at) : new Date();
  const dateStr = Number.isNaN(dateObj.getTime())
    ? new Date().toLocaleString('az-AZ')
    : dateObj.toLocaleString('az-AZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

  const tableLabel = ticket.table_label || ticket.table_name;
  const isTakeAway = String(ticket.order_type || '').toLowerCase().includes('take') || String(ticket.order_type || '').toLowerCase().includes('paket');
  const isOnline = String(ticket.order_type || '').toLowerCase().includes('online');

  const orderTypeLabel = isTakeAway
    ? tx(lang, 'PAKET (TAKE AWAY)', 'НА ВЫНОС (TAKE AWAY)', 'TAKE AWAY')
    : isOnline
    ? tx(lang, 'ONLİYN SİFARİŞ', 'ОНЛАЙН ЗАКАЗ', 'ONLINE ORDER')
    : tableLabel
    ? `${tx(lang, 'MASA', 'СТОЛ', 'TABLE')}: ${tableLabel.toUpperCase()}`
    : tx(lang, 'ZAL (DINE IN)', 'В ЗАЛЕ (DINE IN)', 'DINE IN');

  const totalQty = ticket.items.reduce((sum, it) => sum + (Number(it.qty) || 1), 0);

  const itemsHtml = ticket.items
    .map((item) => {
      const qty = Number(item.qty) || 1;
      const notes = (item.notes || '').trim();
      const seat = (item.seat_label || '').trim();
      const cupMode = item.cup_mode;

      const mods: string[] = [];
      if (Array.isArray(item.modifiers)) {
        item.modifiers.forEach((m) => {
          if (m?.name) mods.push(m.name);
        });
      }
      if (Array.isArray(item.selected_modifiers)) {
        item.selected_modifiers.forEach((m) => {
          if (m) mods.push(m);
        });
      }

      return `
        <div style="border-bottom: 1px dashed #444; padding: 2px 0; page-break-inside: avoid; break-inside: avoid;">
          <div style="font-size: 13px; font-weight: 900; line-height: 1.2; word-break: break-word;">
            <span style="font-size: 14px; font-weight: 900; margin-right: 3px;">${qty}x</span>
            ${esc(item.item_name)}
          </div>

          ${
            mods.length > 0
              ? `<div style="margin: 1px 0 1px 14px; font-size: 10px; font-weight: 700; color: #111;">
                  ${mods.map((m) => `<div>+ ${esc(m)}</div>`).join('')}
                </div>`
              : ''
          }

          ${
            seat
              ? `<div style="margin: 1px 0 0 14px; font-size: 10px; font-weight: 800;">
                  [ ${tx(lang, 'Yer', 'Место', 'Seat')}: ${esc(seat)} ]
                </div>`
              : ''
          }

          ${
            cupMode
              ? `<div style="margin: 1px 0 0 14px; font-size: 10px; font-weight: 800;">
                  [ ${cupMode === 'glass' ? tx(lang, 'Şüşə fincan', 'Стекло', 'Glass') : tx(lang, 'Kağız fincan', 'Бумажный', 'Paper')} ]
                </div>`
              : ''
          }

          ${
            notes
              ? `<div style="margin: 1px 0 0 14px; padding: 1px 3px; border-left: 2px solid #000; font-size: 10px; font-weight: 900;">
                  ⚡ ${tx(lang, 'Qeyd', 'Прим.', 'Note')}: ${esc(notes)}
                </div>`
              : ''
          }
        </div>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <title>Kitchen Ticket - ${displayId}</title>
  <style>
    ${THERMAL_RECEIPT_PRINT_CSS}
    .kitchen-box {
      border: 1.5px solid #000;
      padding: 3px 4px;
      margin-bottom: 4px;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .kitchen-title {
      font-size: 11px !important;
      font-weight: 900 !important;
      text-transform: uppercase;
    }
    .kitchen-target {
      font-size: 15px !important;
      font-weight: 900 !important;
      margin-top: 1px;
      text-transform: uppercase;
      word-break: break-word;
    }
    .kitchen-meta-row {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.2;
      margin: 1px 0;
    }
  </style>
</head>
<body>
  <div class="kitchen-box">
    ${companyName ? `<div style="font-size: 9px; font-weight: 800; text-transform: uppercase;">${esc(companyName)}</div>` : ''}
    <div class="kitchen-title">*** ${tx(lang, 'MƏTBƏX SİFARİŞİ', 'ЗАКАЗ НА КУХНЮ', 'KITCHEN TICKET')} ***</div>
    <div class="kitchen-target">${esc(orderTypeLabel)}</div>
  </div>

  <div style="page-break-inside: avoid; break-inside: avoid;">
    <div class="kitchen-meta-row">
      <span>${tx(lang, 'Çek', 'Чек', 'Ticket')}: <b>#${displayId}</b></span>
      <span>${dateStr.split(' ')[1] || ''}</span>
    </div>
    <div class="kitchen-meta-row">
      <span>${tx(lang, 'Tarix', 'Дата', 'Date')}: ${dateStr.split(' ')[0] || ''}</span>
      ${ticket.server_name ? `<span>${tx(lang, 'Xidmət', 'Офиц.', 'Server')}: <b>${esc(ticket.server_name)}</b></span>` : ''}
    </div>
    ${
      ticket.cup_mode
        ? `<div class="kitchen-meta-row"><span>${tx(lang, 'Fincan', 'Чашка', 'Cup')}: <b>${ticket.cup_mode === 'glass' ? tx(lang, 'Şüşə', 'Стекло', 'Glass') : tx(lang, 'Kağız', 'Бумажный', 'Paper')}</b></span></div>`
        : ''
    }
    ${
      ticket.notes
        ? `<div style="margin-top: 2px; padding: 1px 3px; border-left: 2px solid #000; font-size: 10px; font-weight: 900;">
            ⚡ ${tx(lang, 'Qeyd', 'Заметка', 'Note')}: ${esc(ticket.notes)}
          </div>`
        : ''
    }
  </div>

  <div style="border-top: 1.5px solid #000; margin-top: 3px; padding-top: 2px;">
    ${itemsHtml}
  </div>

  <div style="border-top: 1.5px solid #000; margin-top: 4px; padding-top: 3px; display: flex; justify-content: space-between; font-size: 12px; font-weight: 900; page-break-inside: avoid; break-inside: avoid;">
    <span>${tx(lang, 'CƏMİ SAY', 'ВСЕГО', 'TOTAL')}:</span>
    <span>${totalQty} ${tx(lang, 'ədəd', 'шт', 'pcs')}</span>
  </div>

  <div style="text-align: center; margin-top: 6px; font-size: 10px; font-weight: 700; color: #333; page-break-inside: avoid; break-inside: avoid;">
    -- ${tx(lang, 'Mətbəx Çapı Tamamlandı', 'Печать для кухни завершена', 'Kitchen Print Finished')} --
  </div>
</body>
</html>`;
}
