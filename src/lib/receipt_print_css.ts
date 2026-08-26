export const THERMAL_RECEIPT_PRINT_CSS = `
  @page {
    margin: 0mm !important;
    padding: 0mm !important;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  html,
  body {
    margin: 0 !important;
    padding: 0 !important;
    color: #000 !important;
    background: #fff !important;
    font-family: "Courier New", "Lucida Console", "Liberation Mono", monospace !important;
    /* 80mm kağızın enini tam doldurmaq üçün iri şrift (terminal çapda rahat oxunur). */
    font-size: 18px !important;
    line-height: 1.3 !important;
    font-weight: 700 !important;
    -webkit-font-smoothing: none;
    text-rendering: geometricPrecision;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    /* Utilize the full printable width; never break words letter-by-letter. */
    overflow-wrap: normal !important;
    word-break: keep-all !important;
    white-space: normal !important;
  }
  @media print {
    html,
    body {
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
    }
  }
  div, table, tr, td, p {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  .line {
    width: 100% !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: baseline !important;
    gap: 10px !important;
    margin: 4px 0 !important;
    /* Tarix/Saat sətri kimi iki sütunlu məlumatlar sözləri sındırmasın. */
    font-size: 18px !important;
  }
  .line span:first-child {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    padding-right: 10px !important;
    text-align: left !important;
    white-space: normal !important;
    word-break: keep-all !important;
    overflow-wrap: normal !important;
  }
  .line span:last-child {
    text-align: right !important;
    flex-shrink: 0 !important;
    white-space: nowrap !important;
    font-weight: 800 !important;
    font-variant-numeric: tabular-nums !important;
  }
  .muted {
    color: #222 !important;
    font-size: 15px !important;
    line-height: 1.25 !important;
    font-weight: 600 !important;
  }
  .bold { font-weight: 900 !important; }
  .section-title {
    margin-top: 6px !important;
    margin-bottom: 2px !important;
    font-size: 18px !important;
    line-height: 1.25 !important;
    font-weight: 900 !important;
    text-transform: uppercase !important;
  }
  h1, h2, h3 { margin: 0 0 3px !important; font-weight: 900 !important; line-height: 1.2 !important; }
  table {
    width: 100% !important;
    border-collapse: collapse !important;
    font-size: 18px !important;
    line-height: 1.3 !important;
    table-layout: auto !important;
  }
  td {
    vertical-align: top !important;
    padding: 4px 0 !important;
    font-weight: 700 !important;
  }
  td:first-child {
    text-align: left !important;
    padding-right: 10px !important;
    overflow-wrap: normal !important;
    word-break: keep-all !important;
    white-space: normal !important;
  }
  td:last-child {
    text-align: right !important;
    white-space: nowrap !important;
    font-weight: 800 !important;
    font-variant-numeric: tabular-nums !important;
  }
  hr {
    border: 0 !important;
    border-top: 1.5px dashed #000 !important;
    margin: 6px 0 !important;
    width: 100% !important;
  }
  svg { max-width: 100% !important; display: block !important; margin: 0 auto !important; }
  img { max-width: 100% !important; image-rendering: crisp-edges !important; display: block !important; margin: 0 auto !important; }
`;

// Paper width override: pins the thermal canvas to the real printable area
// (72mm for an 80mm roll, 48mm for a 58mm roll) and sets a compact, fixed
// monospace font. Defaults to 80mm roll (72mm printable width / 576 dot).
// Brauzer fallback-i söndürüldüyündən (termal çeklər yalnız Print Agent/QZ ilə
// çap olunur) burada margin əlavə etmirik — əks halda kağızın yuxarısında boşluq
// qalar. Kağızın enini tam doldururuq.
export function thermalPaperWidthOverride(paperWidth?: '58mm' | '80mm'): string {
  const is58 = paperWidth === '58mm';
  const paperMm = is58 ? 58 : 80;
  const printableMm = is58 ? 48 : 72;
  const fontSize = is58 ? '16px' : '18px';
  return `
    @page { size: ${paperMm}mm auto; margin: 0mm !important; padding: 0mm !important; }
    html, body {
      width: ${printableMm}mm !important;
      max-width: ${printableMm}mm !important;
      min-width: ${printableMm}mm !important;
      padding: 2mm 2.5mm !important;
      margin: 0 !important;
      font-size: ${fontSize} !important;
      line-height: 1.3 !important;
    }
    table, .line { font-size: ${fontSize} !important; }
  `;
}

export function withThermalReceiptPrintCss(html: string): string {
  const source = String(html || '');
  if (!source.trim()) return source;
  if (source.includes('data-iw-thermal-receipt-css="1"')) return source;
  const styleTag = `<style data-iw-thermal-receipt-css="1">${THERMAL_RECEIPT_PRINT_CSS}</style>`;
  if (/<\/head>/i.test(source)) {
    return source.replace(/<\/head>/i, `${styleTag}</head>`);
  }
  if (/<head[^>]*>/i.test(source)) {
    return source.replace(/<head([^>]*)>/i, `<head$1>${styleTag}`);
  }
  if (/<html[^>]*>/i.test(source)) {
    return source.replace(/<html([^>]*)>/i, `<html$1><head>${styleTag}</head>`);
  }
  return `<html><head>${styleTag}</head><body>${source}</body></html>`;
}
