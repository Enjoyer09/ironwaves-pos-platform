import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { tx } from '../i18n';
import { THERMAL_RECEIPT_PRINT_CSS, thermalPaperWidthOverride } from './receipt_print_css';

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

function isVoidSaleStatus(status: unknown): boolean {
  return [
    'VOIDED',
    'VOID',
    'CANCELLED',
    'CANCELED',
    'CANCELLED SALE',
    'CANCELED SALE',
    'LƏĞV',
    'LƏĞV EDILDI',
    'LƏĞV EDİLDİ',
    'LAGV',
    'LAGV EDILDI',
  ].includes(String(status || '').trim().toUpperCase());
}

export function formatReceiptDisplayId(id: string): string {
  if (!id) return '-';
  return String(id).split('-')[0].toUpperCase();
}

export function generateReceiptBarcodeSvg(value: string): string {
  try {
    if (typeof document === 'undefined') return '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, value, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      width: 2,
      height: 48,
    });
    svg.setAttribute('style', 'height:48px;max-width:92%;display:block;margin:0 auto;');
    return svg.outerHTML;
  } catch {
    return '';
  }
}

// Satış ID üçün 1D barkod (CODE128). Çapda görünməməsinin qarşısını almaq üçün
// əvvəlcə PNG data-URL (headless Chrome-da ən etibarlı), alınmazsa inline SVG
// ehtiyat yolunu istifadə edir. Mərkəzləşdirilmiş olaraq SALE:<id> yazısı ilə gəlir.
export function generateReceiptBarcodeHtml(value: string): string {
  if (typeof document === 'undefined') return '';
  const tryPng = (): string => {
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, value, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        width: 2,
        height: 50,
      });
      const url = canvas.toDataURL('image/png');
      if (url && url.length > 50) {
        return `<img src="${url}" alt="barcode" style="height:50px;max-width:92%;display:block;margin:0 auto;image-rendering:pixelated;" />`;
      }
    } catch {
      /* fall through to SVG */
    }
    return '';
  };
  const trySvg = (): string => {
    try {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      JsBarcode(svg, value, {
        format: 'CODE128',
        displayValue: false,
        margin: 0,
        width: 2,
        height: 50,
      });
      svg.setAttribute('style', 'height:50px;max-width:92%;display:block;margin:0 auto;');
      return svg.outerHTML;
    } catch {
      return '';
    }
  };
  return tryPng() || trySvg();
}

export async function buildSaleReceiptHtml({
  sale,
  profile,
  lang = 'az',
  receiptUrl = '',
  feedbackUrl = '',
  operator = '',
  paperWidth = '80mm',
}: {
  sale: any;
  profile?: any;
  lang?: ReceiptLang;
  receiptUrl?: string;
  feedbackUrl?: string;
  operator?: string;
  paperWidth?: '58mm' | '80mm';
}): Promise<string> {
  const saleId = String(sale?.sale_id || sale?.id || '').trim();
  const displayId = formatReceiptDisplayId(saleId);
  // Feedback QR is meaningless on a voided sale — fall back to receipt URL.
  const qrTarget = !isVoidSaleStatus(sale?.status)
    ? (String(feedbackUrl || receiptUrl || '').trim() || `SALE:${displayId}`)
    : (String(receiptUrl || '').trim() || `SALE:${displayId}`);
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
    const promoD = Number(item?.promo_discount || 0);
    let lineHtml = `
      <tr>
        <td>${qty}x ${name}</td>
        <td>${money(price)} ₼</td>
      </tr>
    `;
    if (promoD > 0) {
      lineHtml += `
        <tr>
          <td style="padding-left: 12px; font-style: italic; font-size: 12px; color: #4b5563;">${esc(tx(lang, '[Promo] 2-ci məhsul 50% endirim', '[Промо] 2-й товар скидка 50%', '[Promo] 2nd Item 50% Off'))}</td>
          <td style="font-style: italic; font-size: 12px; color: #4b5563;">-${money(promoD)} ₼</td>
        </tr>
      `;
    }
    return lineHtml;
  }).join('');
  const subtotal = Number(sale?.original_total ?? 0) || (Number(sale?.total || 0) + Number(sale?.discount_amount || 0));
  const total = Number(sale?.total || 0);
  const discount = Number(sale?.discount_amount || 0);
  const isVoided = isVoidSaleStatus(sale?.status);
  const paymentMethod = isVoided
    ? tx(lang, 'Ləğv edildi', 'Отменено', 'Voided')
    : String(sale?.payment_method || '').trim();
  const split = splitAmounts(sale);
  const isSplit = !isVoided && (paymentMethod.toLowerCase().includes('split') || split.cash > 0 || split.card > 0);
  const freeCoffees = Number(sale?.free_coffees_applied || 0);
  const customerId = String(sale?.customer_card_id || '').trim();
  const starsAfter = Number(sale?.customer_stars_after || 0);
  const createdAt = sale?.created_at
    ? new Date(sale.created_at).toLocaleString('az-AZ')
    : new Date().toLocaleString('az-AZ');
  // Encode the short display ID — must match the human-readable text under the barcode.
  const barcodeHtml = generateReceiptBarcodeHtml(`SALE:${displayId}`);
  const companyName = profile?.company_name || 'IRONWAVES POS';

  // --- Fiskal / vergi (forward-compatible; təhlükəsiz default-lar) ---
  // Fiskal inteqrasiya YOXDUR (fiscal_enabled=false) → çek AÇIQ "QEYRİ-FİSKAL" etiketi ilə çap olunur.
  // Sertifikatlı e-kassa (NKA) inteqrasiyası gələndə fiscal_enabled=true olur və sale-ə fiskal ID/QR düşür.
  const fiscalEnabled = profile?.fiscal_enabled === true;
  const receiptTypeLabel = fiscalEnabled
    ? tx(lang, 'KASSA ÇEKİ', 'КАССОВЫЙ ЧЕК', 'CASHIER RECEIPT')
    : tx(lang, 'QEYRİ-FİSKAL QƏBZ', 'НЕФИСКАЛЬНЫЙ ЧЕК', 'NON-FISCAL RECEIPT');

  // ƏDV (VAT) — AZ konvensiyası: qiymətə DAXİL. Default rejim 'simplified' → ƏDV sətri çap olunmur.
  const taxRegime = String(profile?.tax_regime || 'simplified').toLowerCase();
  const vatRate = numeric(profile?.vat_rate) || 18;
  const isVat = taxRegime === 'vat' && vatRate > 0 && total > 0 && !isVoided;
  const vatNet = isVat ? total / (1 + vatRate / 100) : 0;
  const vatAmount = isVat ? total - vatNet : 0;

  // Alınan/Qaytarılan (tendered/change) — Sale-də hələ sahə yoxdur → yalnız gələcəkdə mövcud olduqda çap olunur.
  const tendered = numeric(sale?.cash_tendered ?? sale?.amount_tendered ?? sale?.tendered);
  const showTender = !isVoided && tendered > 0 && tendered >= total;
  const changeDue = showTender ? tendered - total : 0;

  // Fiskal blok — yalnız inteqrasiya aktiv VƏ fiskal data mövcud olduqda (bugün heç vaxt).
  const fiscalId = String(sale?.fiscal_id || '').trim();
  const fiscalDocNo = String(sale?.fiscal_doc_no || '').trim();
  const nkaRegNo = String(profile?.nka_registration_no || '').trim();
  const fiscalQrValue = String(sale?.fiscal_qr || '').trim();
  const showFiscal = fiscalEnabled && Boolean(fiscalId || fiscalQrValue);
  let fiscalQrDataUrl = '';
  if (showFiscal && fiscalQrValue) {
    try {
      fiscalQrDataUrl = await QRCode.toDataURL(fiscalQrValue, {
        width: 156,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#FFFFFF' },
      });
    } catch {
      fiscalQrDataUrl = '';
    }
  }

  return `
    <html>
      <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width" />
          <style data-iw-thermal-receipt-css="1">
            ${THERMAL_RECEIPT_PRINT_CSS}
            ${thermalPaperWidthOverride(paperWidth)}
          </style>
      </head>
      <body>
        ${profile?.logo_url ? `<img src="${esc(profile.logo_url)}" style="height:30px;max-width:160px;object-fit:contain;margin-bottom:4px" />` : ''}
        <div class="bold" style="text-align:center">${esc(companyName)}</div>
        ${profile?.voen ? `<div class="muted" style="text-align:center">VÖEN: ${esc(profile.voen)}</div>` : ''}
        ${profile?.phone ? `<div class="muted" style="text-align:center">Tel: ${esc(profile.phone)}</div>` : ''}
        ${profile?.address ? `<div class="muted" style="text-align:center">${esc(profile.address)}</div>` : ''}
        <hr />
        <div class="section-title" style="text-align:center">${receiptTypeLabel}</div>
        ${!fiscalEnabled ? `<div class="muted" style="text-align:center">(${tx(lang, 'DAXİLİ', 'ВНУТРЕННИЙ', 'INTERNAL')})</div>` : ''}
        <hr />
        <div class="line"><span>${tx(lang, 'Çek №', 'Чек №', 'Check #')}</span><span class="bold">#${esc(displayId)}</span></div>
        <div class="line"><span>${tx(lang, 'Operator', 'Оператор', 'Operator')}</span><span>${esc(operator || sale?.cashier || '-')}</span></div>
        <div class="line"><span>${tx(lang, 'Tarix', 'Дата', 'Date')}</span><span>${esc(createdAt)}</span></div>
        <div class="line"><span>${tx(lang, 'Tip', 'Тип', 'Type')}</span><span>${esc(sale?.order_type || 'Take Away')}</span></div>
        ${isVoided ? `<div class="line bold"><span>${tx(lang, 'Status', 'Статус', 'Status')}</span><span>${tx(lang, 'LƏĞV EDİLDİ', 'ОТМЕНЕНО', 'VOIDED')}</span></div>` : ''}
        <hr />
        ${barcodeHtml ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;margin:6px 0 6px 0;text-align:center;">
          ${barcodeHtml}
          <div style="font-size:12px;font-weight:800;letter-spacing:1px;margin-top:2px;">SALE:${esc(displayId)}</div>
        </div>` : ''}
        <table>${lines || `<tr><td>${tx(lang, 'Məhsul məlumatı yoxdur', 'Нет данных о товарах', 'No item details')}</td><td>0.00 ₼</td></tr>`}</table>
        <hr />
        <div class="line"><span>${tx(lang, 'Ara cəm', 'Промежуточный итог', 'Subtotal')}</span><span>${money(subtotal)} ₼</span></div>
        <div class="line"><span>${tx(lang, 'Endirim', 'Скидка', 'Discount')}</span><span>- ${money(discount)} ₼</span></div>
        ${freeCoffees > 0 ? `<div class="line"><span>${tx(lang, 'Pulsuz kofe', 'Бесплатный кофе', 'Free coffee')}</span><span>${freeCoffees}</span></div>` : ''}
        ${customerId ? `<div class="line"><span>${tx(lang, 'Müştəri ID', 'ID клиента', 'Customer ID')}</span><span>${esc(customerId)}</span></div>` : ''}
        ${customerId ? `<div class="line"><span>${tx(lang, 'Ulduz balansı', 'Баaranс звезд', 'Star Balance')}</span><span>${starsAfter}</span></div>` : ''}
        <div class="line bold" style="font-size:16px;"><span>${tx(lang, 'Yekun', 'Итого', 'Total')}</span><span>${money(total)} ₼</span></div>
        ${isVat ? `<div class="line"><span>${tx(lang, `o cümlədən ƏDV (${vatRate}%)`, `в т.ч. НДС (${vatRate}%)`, `incl. VAT (${vatRate}%)`)}</span><span>${money(vatAmount)} ₼</span></div>` : ''}
        ${isVat ? `<div class="line"><span>${tx(lang, 'ƏDV-siz məbləğ', 'Сумма без НДС', 'Amount excl. VAT')}</span><span>${money(vatNet)} ₼</span></div>` : ''}
        ${(!isVat && taxRegime === 'simplified' && !isVoided) ? `<div class="muted">${tx(lang, 'Sadələşdirilmiş vergi rejimi', 'Упрощённый налоговый режим', 'Simplified tax regime')}</div>` : ''}
        <div class="line"><span>${tx(lang, 'Ödəniş', 'Оплата', 'Payment')}</span><span>${esc((paymentMethod === 'Nəğd' ? 'Nağd' : paymentMethod) || '-')}</span></div>
        ${isSplit ? `<div class="line"><span>${tx(lang, 'Split nağd', 'Split наличные', 'Split cash')}</span><span>${money(split.cash)} ₼</span></div>` : ''}
        ${isSplit ? `<div class="line"><span>${tx(lang, 'Split kart', 'Split карта', 'Split card')}</span><span>${money(split.card)} ₼</span></div>` : ''}
        ${showTender ? `<div class="line"><span>${tx(lang, 'Alınan', 'Получено', 'Tendered')}</span><span>${money(tendered)} ₼</span></div>` : ''}
        ${showTender ? `<div class="line bold"><span>${tx(lang, 'Qaytarılan', 'Сдача', 'Change')}</span><span>${money(changeDue)} ₼</span></div>` : ''}
        <hr />
        ${!isVoided ? `
        <div style="display:flex;justify-content:center;margin:8px 0 6px 0">
          <img src="${qrDataUrl}" alt="receipt qr" style="width:112px;height:112px" />
        </div>
        <div class="muted" style="font-size:11px;text-align:center">${tx(lang, 'Rəyiniz bizim üçün çox önəmlidir, lütfən QR skan edib rəyinizi bildirin.', 'Ваше мнение очень важно для нас. Пожалуйста, отсканируйте QR и оставьте отзыв.', 'Your feedback matters to us. Please scan the QR code and share your review.')}</div>
        ` : ''}
        ${showFiscal ? `
        <hr />
        <div class="section-title" style="text-align:center">${tx(lang, 'FİSKAL MƏLUMAT', 'ФИСКАЛЬНЫЕ ДАННЫЕ', 'FISCAL DATA')}</div>
        ${fiscalId ? `<div class="line"><span>${tx(lang, 'Fiskal ID', 'Фискальный ID', 'Fiscal ID')}</span><span>${esc(fiscalId)}</span></div>` : ''}
        ${fiscalDocNo ? `<div class="line"><span>${tx(lang, 'Sənəd №', 'Документ №', 'Doc No')}</span><span>${esc(fiscalDocNo)}</span></div>` : ''}
        ${nkaRegNo ? `<div class="line"><span>${tx(lang, 'NKA qeydiyyat №', 'Рег. № ККА', 'NKA Reg. No')}</span><span>${esc(nkaRegNo)}</span></div>` : ''}
        ${fiscalQrDataUrl ? `<div style="display:flex;justify-content:center;margin:6px 0"><img src="${fiscalQrDataUrl}" alt="fiscal qr" style="width:112px;height:112px" /></div>` : ''}
        ` : ''}
        <hr />
        <div class="muted" style="text-align:center">${esc(profile?.receipt_footer || tx(lang, 'Bizi seçdiyiniz üçün təşəkkür edirik!', 'Спасибо, что выбрали нас!', 'Thank you for choosing us!'))}</div>
        <div style="height:2mm"></div>
      </body>
    </html>
  `;
}

export async function buildTableReceiptHtml({
  tableLabel,
  operator,
  items,
  breakdown,
  profile,
  lang = 'az',
  feedbackUrl = '',
  paperWidth = '80mm',
  checkId = '',
  checkNo = '',
}: {
  tableLabel: string;
  operator: string;
  items: Array<{ item_name: string; qty: number; price: number | string }>;
  breakdown: {
    itemsTotal: number;
    discountPercent: number;
    discountAmount: number;
    serviceFee: number;
    deposit: number;
    finalTotal: number;
    dueNow: number;
  };
  profile?: any;
  lang?: ReceiptLang;
  feedbackUrl?: string;
  paperWidth?: '58mm' | '80mm';
  checkId?: string;
  checkNo?: string | number;
}): Promise<string> {
  const companyName = profile?.company_name || 'IRONWAVES POS';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const createdAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const rawCheckId = String(checkNo || checkId || '').trim();
  const displayCheckId = rawCheckId ? (rawCheckId.length > 8 ? formatReceiptDisplayId(rawCheckId) : rawCheckId) : '';

  const lines = items
    .map((item) => {
      const qty = Number(item.qty || 1);
      const name = esc(item.item_name || '-');
      const lineTotal = Number(item.price || 0) * qty;
      return `
        <tr>
          <td>${qty}x ${name}</td>
          <td>${money(lineTotal)} ₼</td>
        </tr>
      `;
    })
    .join('');

  let qrDataUrl = '';
  if (feedbackUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(feedbackUrl, {
        width: 156,
        margin: 2,
        errorCorrectionLevel: 'L',
        color: { dark: '#000000', light: '#FFFFFF' },
      });
    } catch {
      qrDataUrl = '';
    }
  }

  return `
    <html>
      <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width" />
          <title>Table Receipt - ${esc(tableLabel)}</title>
          <style data-iw-thermal-receipt-css="1">
            ${THERMAL_RECEIPT_PRINT_CSS}
            ${thermalPaperWidthOverride(paperWidth)}
          </style>
      </head>
      <body>
        ${profile?.logo_url ? `<img src="${esc(profile.logo_url)}" style="height:30px;max-width:160px;object-fit:contain;margin-bottom:4px" />` : ''}
        <div class="bold" style="text-align:center">${esc(companyName)}</div>
        ${profile?.voen ? `<div class="muted" style="text-align:center">VÖEN: ${esc(profile.voen)}</div>` : ''}
        ${profile?.phone ? `<div class="muted" style="text-align:center">Tel: ${esc(profile.phone)}</div>` : ''}
        ${profile?.address ? `<div class="muted" style="text-align:center">${esc(profile.address)}</div>` : ''}
        <hr />
        <div class="section-title" style="text-align:center">${tx(lang, 'MASA HESABI', 'СЧЕТ СТОЛА', 'TABLE CHECK')}</div>
        <div class="muted" style="text-align:center">(${tx(lang, 'DAXİLİ', 'ВНУТРЕННИЙ', 'INTERNAL')})</div>
        <hr />
        ${displayCheckId ? `<div class="line"><span>${tx(lang, 'Çek №', 'Чек №', 'Check #')}</span><span class="bold">#${esc(displayCheckId)}</span></div>` : ''}
        <div class="line"><span>${tx(lang, 'Masa', 'Стол', 'Table')}</span><span class="bold">${esc(tableLabel)}</span></div>
        <div class="line"><span>${tx(lang, 'Operator', 'Оператор', 'Operator')}</span><span>${esc(operator || 'staff')}</span></div>
        <div class="line"><span>${tx(lang, 'Tarix', 'Дата', 'Date')}</span><span>${esc(createdAt)}</span></div>
        <div class="line"><span>${tx(lang, 'Tip', 'Тип', 'Type')}</span><span>${tx(lang, 'Masa', 'Стол', 'Dine In')}</span></div>
        <hr />
        <table>${lines || `<tr><td>${tx(lang, 'Sifariş yoxdur', 'Нет позиций', 'No items')}</td><td>0.00 ₼</td></tr>`}</table>
        <hr />
        <div class="line"><span>${tx(lang, 'Ara cəm', 'Промежуточный итог', 'Subtotal')}</span><span>${money(breakdown.itemsTotal)} ₼</span></div>
        <div class="line"><span>${tx(lang, 'Endirim', 'Скидка', 'Discount')}${Number(breakdown.discountPercent || 0) > 0 ? ` (${Number(breakdown.discountPercent).toFixed(0)}%)` : ''}</span><span>- ${money(breakdown.discountAmount || 0)} ₼</span></div>
        ${
          Number(breakdown.serviceFee || 0) > 0
            ? `<div class="line"><span>${tx(lang, 'Servis haqqı', 'Сервисный сбор', 'Service Fee')}</span><span>${money(breakdown.serviceFee)} ₼</span></div>`
            : ''
        }
        ${
          Number(breakdown.deposit || 0) > 0
            ? `<div class="line"><span>${tx(lang, 'Depozit', 'Депозит', 'Deposit')}</span><span>${money(breakdown.deposit)} ₼</span></div>`
            : ''
        }
        ${
          Number(breakdown.dueNow || 0) > 0 && Number(breakdown.dueNow || 0) !== Number(breakdown.finalTotal || 0)
            ? `<div class="line"><span>${tx(lang, 'Əlavə ödəniş', 'К доплате', 'Due Now')}</span><span>${money(breakdown.dueNow)} ₼</span></div>`
            : ''
        }
        <div class="line bold"><span>${tx(lang, 'Yekun', 'Итого', 'Total')}</span><span>${money(breakdown.finalTotal)} ₼</span></div>
        ${
          qrDataUrl
            ? `
          <hr />
          <div style="display:flex;justify-content:center;margin:6px 0 4px 0">
            <img src="${qrDataUrl}" alt="receipt qr" style="width:96px;height:96px" />
          </div>
          <div class="muted" style="text-align:center">${tx(lang, 'Rəyiniz bizim üçün çox önəmlidir, lütfən QR skan edib rəyinizi bildirin.', 'Ваше мнение очень важно для нас. Пожалуйста, отсканируйте QR и оставьте отзыв.', 'Your feedback matters to us. Please scan the QR code and share your review.')}</div>
          `
            : ''
        }
        <hr />
        <div class="muted" style="text-align:center">${esc(profile?.receipt_footer || tx(lang, 'Bizi seçdiyiniz üçün təşəkkür edirik!', 'Спасибо, что выбрали нас!', 'Thank you for choosing us!'))}</div>
        <div style="height:2mm"></div>
      </body>
    </html>
  `;
}
