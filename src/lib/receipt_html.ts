import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { tx } from '../i18n';

type ReceiptLang = 'az' | 'ru' | 'en';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value: unknown): string {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function numeric(value: unknown): number {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function splitAmounts(sale: any): { cash: number; card: number } {
  const directCash = numeric(sale?.split_cash);
  const directCard = numeric(sale?.split_card);
  if (directCash > 0 || directCard > 0) return { cash: directCash, card: directCard };
  const parts = Array.isArray(sale?.payment_parts) ? sale.payment_parts : [];
  return parts.reduce(
    (acc: { cash: number; card: number }, part: any) => {
      const method = String(part?.method || part?.source || '').toLowerCase();
      const amount = numeric(part?.amount);
      if (method.includes('cash') || method.includes('nəğd') || method.includes('nagd')) acc.cash += amount;
      if (method.includes('card') || method.includes('kart')) acc.card += amount;
      return acc;
    },
    { cash: 0, card: 0 },
  );
}

export function formatReceiptDisplayId(id: string): string {
  if (!id) return '-';
  return String(id).split('-')[0].toUpperCase();
}

export function generateReceiptBarcodeSvg(value: string): string {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, value, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      width: 1.2,
      height: 34,
    });
    return svg.outerHTML;
  } catch {
    return '';
  }
}

export async function buildSaleReceiptHtml({
  sale,
  profile,
  lang = 'az',
  receiptUrl = '',
  feedbackUrl = '',
  operator = '',
}: {
  sale: any;
  profile?: any;
  lang?: ReceiptLang;
  receiptUrl?: string;
  feedbackUrl?: string;
  operator?: string;
}): Promise<string> {
  const saleId = String(sale?.sale_id || sale?.id || '').trim();
  const displayId = formatReceiptDisplayId(saleId);
  const qrTarget = String(feedbackUrl || receiptUrl || '').trim() || `SALE:${displayId}`;
  const qrDataUrl = await QRCode.toDataURL(qrTarget, {
    width: 156,
    margin: 2,
    errorCorrectionLevel: 'L',
    color: { dark: '#000000', light: '#FFFFFF' },
  });
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const lines = items.map((item: any) => {
    const qty = Number(item?.qty || item?.quantity || 1);
    const name = esc(item?.item_name || item?.name || '-');
    const price = Number(item?.line_total ?? item?.total ?? 0) || (Number(item?.price || 0) * qty);
    return `
      <tr>
        <td style="padding:4px 4px 4px 0">${qty}x ${name}</td>
        <td style="padding:4px 0;text-align:right;white-space:nowrap">${money(price)} ₼</td>
      </tr>
    `;
  }).join('');
  const subtotal = Number(sale?.original_total ?? 0) || (Number(sale?.total || 0) + Number(sale?.discount_amount || 0));
  const total = Number(sale?.total || 0);
  const discount = Number(sale?.discount_amount || 0);
  const paymentMethod = String(sale?.payment_method || '').trim();
  const split = splitAmounts(sale);
  const isSplit = paymentMethod.toLowerCase().includes('split') || split.cash > 0 || split.card > 0;
  const freeCoffees = Number(sale?.free_coffees_applied || 0);
  const customerId = String(sale?.customer_card_id || '').trim();
  const starsAfter = Number(sale?.customer_stars_after || 0);
  const createdAt = sale?.created_at ? new Date(sale.created_at).toLocaleString() : new Date().toLocaleString();
  const barcodeSvg = generateReceiptBarcodeSvg(`SALE:${saleId || displayId}`);
  const companyName = profile?.company_name || 'IRONWAVES POS';

  return `
    <html>
      <head>
        <style>
          @page { size: 80mm auto; margin: 4mm; }
          body { font-family: Inter, Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
          .line { display:flex; justify-content:space-between; gap:8px; margin: 2px 0; }
          .muted { color:#555; font-size:11px; }
          .bold { font-weight: 700; }
          hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
        </style>
      </head>
      <body style="font-family:Arial;padding:16px;max-width:320px;margin:0 auto">
        ${profile?.logo_url ? `<img src="${esc(profile.logo_url)}" style="height:34px;max-width:180px;object-fit:contain;margin-bottom:6px" />` : ''}
        <div class="bold" style="font-size:15px">${esc(companyName)}</div>
        <div class="muted">VÖEN: ${esc(profile?.voen || '-')}</div>
        <div class="muted">Tel: ${esc(profile?.phone || '-')}</div>
        <div class="muted">${esc(profile?.address || '-')}</div>
        <hr />
        <div class="line"><span>${tx(lang, 'Satış ID', 'ID продажи', 'Sale ID')}</span><span>${esc(displayId)}</span></div>
        <div class="line"><span>${tx(lang, 'Operator', 'Оператор', 'Operator')}</span><span>${esc(operator || sale?.cashier || '-')}</span></div>
        <div class="line"><span>${tx(lang, 'Tarix', 'Дата', 'Date')}</span><span>${esc(createdAt)}</span></div>
        <div class="line"><span>${tx(lang, 'Tip', 'Тип', 'Type')}</span><span>${esc(sale?.order_type || 'Take Away')}</span></div>
        <div style="margin-top:8px;text-align:center">${barcodeSvg || ''}</div>
        <div class="muted" style="text-align:center">SALE:${esc(displayId)}</div>
        <hr />
        <table style="width:100%;font-size:13px">${lines || `<tr><td style="padding:4px 0">${tx(lang, 'Məhsul məlumatı yoxdur', 'Нет данных о товарах', 'No item details')}</td></tr>`}</table>
        <hr />
        <div class="line"><span>${tx(lang, 'Ara cəm', 'Промежуточный итог', 'Subtotal')}</span><span>${money(subtotal)} ₼</span></div>
        <div class="line"><span>${tx(lang, 'Endirim', 'Скидка', 'Discount')}</span><span>- ${money(discount)} ₼</span></div>
        ${freeCoffees > 0 ? `<div class="line"><span>${tx(lang, 'Pulsuz kofe', 'Бесплатный кофе', 'Free coffee')}</span><span>${freeCoffees}</span></div>` : ''}
        ${customerId ? `<div class="line"><span>${tx(lang, 'Müştəri ID', 'ID клиента', 'Customer ID')}</span><span>${esc(customerId)}</span></div>` : ''}
        ${customerId ? `<div class="line"><span>${tx(lang, 'Ulduz balansı', 'Баланс звезд', 'Star Balance')}</span><span>${starsAfter}</span></div>` : ''}
        <div class="line bold" style="font-size:13px"><span>${tx(lang, 'Yekun', 'Итого', 'Total')}</span><span>${money(total)} ₼</span></div>
        <div class="line"><span>${tx(lang, 'Ödəniş', 'Оплата', 'Payment')}</span><span>${esc(paymentMethod || '-')}</span></div>
        ${isSplit ? `<div class="line"><span>${tx(lang, 'Split nağd', 'Split наличные', 'Split cash')}</span><span>${money(split.cash)} ₼</span></div>` : ''}
        ${isSplit ? `<div class="line"><span>${tx(lang, 'Split kart', 'Split карта', 'Split card')}</span><span>${money(split.card)} ₼</span></div>` : ''}
        <hr />
        <div style="display:flex;justify-content:center;margin:8px 0 6px 0">
          <img src="${qrDataUrl}" alt="receipt qr" style="width:108px;height:108px" />
        </div>
        <div class="muted" style="font-size:10px;text-align:center">${tx(lang, 'Rəyiniz bizim üçün çox önəmlidir, lütfən QR skan edib rəyinizi bildirin.', 'Ваше мнение очень важно для нас. Пожалуйста, отсканируйте QR и оставьте отзыв.', 'Your feedback matters to us. Please scan the QR code and share your review.')}</div>
        <hr />
        <div class="muted">${esc(profile?.receipt_footer || tx(lang, 'Bizi seçdiyiniz üçün təşəkkür edirik!', 'Спасибо, что выбрали нас!', 'Thank you for choosing us!'))}</div>
      </body>
    </html>
  `;
}
