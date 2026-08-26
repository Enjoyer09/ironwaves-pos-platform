export const THERMAL_RECEIPT_PRINT_CSS = `
  @page {
    margin: 0mm;
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
    font-size: 12px !important;
    line-height: 1.35 !important;
    font-weight: 600 !important;
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
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 4px;
    margin: 2px 0;
    font-size: 12px;
  }
  .line span:first-child {
    flex: 1 1 auto;
    min-width: 0;
    padding-right: 4px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .line span:last-child {
    text-align: right;
    flex-shrink: 0;
    white-space: nowrap;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .muted {
    color: #222;
    font-size: 10.5px;
    line-height: 1.2;
    font-weight: 600;
  }
  .bold { font-weight: 900; }
  .section-title {
    margin-top: 5px;
    font-size: 12.5px;
    line-height: 1.25;
    font-weight: 900;
    text-transform: uppercase;
  }
  h1, h2, h3 { margin: 0 0 2px; font-weight: 900; line-height: 1.2; }
  table {
    width: 100% !important;
    border-collapse: collapse;
    font-size: 12px !important;
    line-height: 1.25 !important;
    table-layout: fixed;
  }
  td {
    vertical-align: top;
    padding: 2.5px 0;
    font-weight: 700;
    word-break: keep-all;
    overflow-wrap: normal;
  }
  td:first-child {
    text-align: left;
    padding-right: 4px;
    overflow-wrap: normal;
    word-break: keep-all;
    white-space: normal;
  }
  td:last-child {
    text-align: right;
    white-space: nowrap;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    width: 33%;
  }
  hr {
    border: 0;
    border-top: 1px dashed #000;
    margin: 6px 0;
    width: 100%;
  }
  svg { max-width: 100%; }
  img { max-width: 100%; image-rendering: crisp-edges; display: block; }
`;

// Paper width override: pins the thermal canvas to the real printable area
// (72mm for an 80mm roll, 48mm for a 58mm roll) and sets a compact, fixed
// monospace font. No CSS zoom — the agent/QZ already rasterize at the correct
// dot width, so zooming would only distort and shrink the usable column.
export function thermalPaperWidthOverride(paperWidth?: '58mm' | '80mm'): string {
  const is80 = (paperWidth || '80mm') === '80mm';
  const paperMm = is80 ? 80 : 58;
  const printableMm = is80 ? 72 : 48;
  // ~15–20% böyük şrift (80mm üçün 12px → 13.5px) oxunaqlılıq üçün.
  const fontSize = is80 ? '13.5px' : '12px';
  return `
    @page { size: ${paperMm}mm auto; margin: 0mm; }
    html, body {
      width: ${printableMm}mm !important;
      max-width: ${printableMm}mm !important;
      padding: 2mm 3mm !important;
      font-size: ${fontSize} !important;
      line-height: 1.35 !important;
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
