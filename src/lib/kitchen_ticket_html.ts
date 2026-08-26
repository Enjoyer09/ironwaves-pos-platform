import { tx } from '../i18n';
import { THERMAL_RECEIPT_PRINT_CSS, thermalPaperWidthOverride } from './receipt_print_css';

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
  order_type_label?: string;
  created_at?: string | number | Date;
  server_name?: string;
  cup_mode?: 'paper' | 'glass';
  notes?: string;
  /** Mətbəxə "dəyişiklik" çeki üçün görkəmli bayraq (LƏĞV / YENİDƏN DÜZƏLT və s.). */
  changeBanner?: string;
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
  paperWidth = '80mm',
}: {
  ticket: KitchenTicketData;
  lang?: TicketLang;
  companyName?: string;
  paperWidth?: '58mm' | '80mm';
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

  const rawTarget = ticket.order_type_label || ticket.table_label || ticket.table_name;
  const isTakeAway = String(ticket.order_type || '').toLowerCase().includes('take') || String(ticket.order_type || '').toLowerCase().includes('paket');
  const isOnline = String(ticket.order_type || '').toLowerCase().includes('online');

  const orderTypeLabel = isTakeAway
    ? tx(lang, 'PAKET (TAKE AWAY)', 'НА ВЫНОС (TAKE AWAY)', 'TAKE AWAY')
    : isOnline
    ? tx(lang, 'ONLİYN SİFARİŞ', 'ОНЛАЙН ЗАКАЗ', 'ONLINE ORDER')
    : rawTarget
    ? `${tx(lang, 'MASA', 'СТОЛ', 'TABLE')}: ${String(rawTarget).toUpperCase()}`
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
        <div style="border-bottom: 1.5px dashed #444; padding: 4px 0; page-break-inside: avoid; break-inside: avoid;">
          <div style="font-size: 14px; font-weight: 900; line-height: 1.3; word-break: break-word;">
            <span style="font-size: 16px; font-weight: 900; margin-right: 4px;">${qty}x</span>
            ${esc(item.item_name)}
          </div>

          ${
            mods.length > 0
              ? `<div style="margin: 2px 0 2px 16px; font-size: 12px; font-weight: 700; color: #111;">
                  ${mods.map((m) => `<div>+ ${esc(m)}</div>`).join('')}
                </div>`
              : ''
          }

          ${
            seat
              ? `<div style="margin: 2px 0 0 16px; font-size: 12px; font-weight: 800;">
                  [ ${tx(lang, 'Yer', 'Место', 'Seat')}: ${esc(seat)} ]
                </div>`
              : ''
          }

          ${
            cupMode
              ? `<div style="margin: 2px 0 0 16px; font-size: 12px; font-weight: 800;">
                  [ ${cupMode === 'glass' ? tx(lang, 'Şüşə fincan', 'Стекло', 'Glass') : tx(lang, 'Kağız fincan', 'Бумажный', 'Paper')} ]
                </div>`
              : ''
          }

          ${
            notes
              ? `<div style="margin: 2px 0 0 16px; padding: 2px 4px; border-left: 3px solid #000; font-size: 12px; font-weight: 900;">
                  ! ${tx(lang, 'Qeyd', 'Прим.', 'Note')}: ${esc(notes)}
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
    ${thermalPaperWidthOverride(paperWidth)}
    .kitchen-box {
      border: 2px solid #000;
      padding: 4px 6px;
      margin-bottom: 6px;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .kitchen-title {
      font-size: 13px !important;
      font-weight: 900 !important;
      text-transform: uppercase;
    }
    .kitchen-target {
      font-size: 18px !important;
      font-weight: 900 !important;
      margin-top: 2px;
      text-transform: uppercase;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="kitchen-box">
    ${companyName ? `<div style="font-size: 11px; font-weight: 800; text-transform: uppercase;">${esc(companyName)}</div>` : ''}
    <div class="kitchen-title">*** ${tx(lang, 'MƏTBƏX SİFARİŞİ', 'ЗАКАЗ НА КУХНЮ', 'KITCHEN TICKET')} ***</div>
    <div class="kitchen-target">${esc(orderTypeLabel)}</div>
   </div>

   ${
     ticket.changeBanner
       ? `<div style="border:2px solid #000; background:#000; color:#fff; text-align:center; font-size:14px; font-weight:900; padding:5px 3px; margin-top:4px; text-transform:uppercase; letter-spacing:0.5px;">⚠ ${esc(ticket.changeBanner)}</div>`
       : ''
   }

  <div style="page-break-inside: avoid; break-inside: avoid; margin-bottom: 4px;">
    <div class="line">
      <span>${tx(lang, 'Çek №', 'Чек №', 'Ticket #')}</span>
      <span class="bold">#${displayId}</span>
    </div>
    <div class="line">
      <span>${tx(lang, 'Tarix / Saat', 'Дата / Время', 'Date / Time')}</span>
      <span>${esc(dateStr)}</span>
    </div>
    ${
      ticket.server_name
        ? `<div class="line">
            <span>${tx(lang, 'Xidmət (Operator)', 'Официант', 'Server')}</span>
            <span class="bold">${esc(ticket.server_name)}</span>
          </div>`
        : ''
    }
    ${
      ticket.cup_mode
        ? `<div class="line">
            <span>${tx(lang, 'Fincan', 'Чашка', 'Cup')}</span>
            <span class="bold">${ticket.cup_mode === 'glass' ? tx(lang, 'Şüşə', 'Стекло', 'Glass') : tx(lang, 'Kağız', 'Бумажный', 'Paper')}</span>
          </div>`
        : ''
    }
    ${
      ticket.notes
        ? `<div style="margin-top: 3px; padding: 2px 4px; border-left: 3px solid #000; font-size: 12px; font-weight: 900;">
            ! ${tx(lang, 'Qeyd', 'Заметка', 'Note')}: ${esc(ticket.notes)}
          </div>`
        : ''
    }
  </div>

  <div style="border-top: 2px solid #000; margin-top: 4px; padding-top: 2px;">
    ${itemsHtml}
  </div>

  <div class="line bold" style="border-top: 2px solid #000; margin-top: 6px; padding-top: 4px; font-size: 15px !important; page-break-inside: avoid; break-inside: avoid;">
    <span>${tx(lang, 'CƏMİ SAY', 'ВСЕГО', 'TOTAL')}:</span>
    <span>${totalQty} ${tx(lang, 'ədəd', 'шт', 'pcs')}</span>
  </div>

  <div style="text-align: center; margin-top: 8px; font-size: 11px; font-weight: 700; color: #333; page-break-inside: avoid; break-inside: avoid;">
    -- ${tx(lang, 'Mətbəx Çapı Tamamlandı', 'Печать для кухни завершена', 'Kitchen Print Finished')} --
  </div>
</body>
</html>`;
}
