/**
 * THERMAL RECEIPT PRINT CSS
 * - 58mm roll: 9px font, ~38 chars/line
 * - 80mm roll: 11px font, ~48 chars/line  (overridden by thermalPaperWidthOverride)
 * - @page margin:0 → Chrome suppresses file/date/page-number header lines
 * - Sentinel attribute prevents double injection (which would override @page size)
 */
export const THERMAL_RECEIPT_PRINT_CSS = `
  @page {
    size: auto;
    margin: 0mm !important;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  html, body {
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 1.5mm !important;
    color: #000 !important;
    background: #fff !important;
    font-family: "Courier New", "Lucida Console", "Liberation Mono", monospace !important;
    font-size: 9px !important;
    line-height: 1.3 !important;
    font-weight: 700 !important;
    -webkit-font-smoothing: none;
    text-rendering: geometricPrecision;
    overflow-wrap: break-word !important;
    word-break: break-word !important;
  }
  @media print {
    html, body {
      width: 100% !important;
      margin: 0 !important;
      padding: 0 1.5mm !important;
      overflow: visible !important;
    }
  }
  div, table, tr, td, p, body {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  .line {
    width: 100% !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: baseline !important;
    gap: 4px !important;
    margin: 1.5px 0 !important;
    font-size: 9px !important;
    overflow: hidden !important;
  }
  .line span:first-child {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    padding-right: 4px !important;
    text-align: left !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
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
    font-size: 8px !important;
    line-height: 1.2 !important;
    font-weight: 600 !important;
  }
  .bold { font-weight: 900 !important; }
  .section-title {
    margin-top: 4px !important;
    margin-bottom: 1px !important;
    font-size: 9.5px !important;
    line-height: 1.25 !important;
    font-weight: 900 !important;
    text-transform: uppercase !important;
  }
  h1, h2, h3 { margin: 0 0 2px !important; font-weight: 900 !important; line-height: 1.2 !important; }
  table {
    width: 100% !important;
    border-collapse: collapse !important;
    font-size: 9px !important;
    line-height: 1.3 !important;
    table-layout: fixed !important;
  }
  td {
    vertical-align: top !important;
    padding: 1.5px 0 !important;
    font-weight: 700 !important;
  }
  td:first-child {
    text-align: left !important;
    overflow-wrap: break-word !important;
    word-break: break-word !important;
    width: 68% !important;
    padding-right: 3px !important;
  }
  td:last-child {
    text-align: right !important;
    white-space: nowrap !important;
    font-weight: 800 !important;
    font-variant-numeric: tabular-nums !important;
    width: 32% !important;
  }
  hr {
    border: 0 !important;
    border-top: 1px dashed #000 !important;
    margin: 4px 0 !important;
    width: 100% !important;
  }
  svg { max-width: 100% !important; display: block !important; }
  img { max-width: 100% !important; image-rendering: crisp-edges !important; display: block !important; }
`;


/**
 * Paper-width override — injected AFTER THERMAL_RECEIPT_PRINT_CSS so it wins
 * the cascade. Sets explicit @page size so Chrome/Print-Agent uses the real
 * thermal paper width instead of A4, eliminating the right-side blank strip.
 * margin:0 removes Chrome's built-in file/date/page-number header text.
 */
export function thermalPaperWidthOverride(paperWidth?: '58mm' | '80mm'): string {
  const is80 = paperWidth === '80mm';
  const pageWidthMm = is80 ? 80 : 58;
  const fontSize = is80 ? '11px' : '9px';
  const mutedSize = is80 ? '9.5px' : '8px';
  const titleSize = is80 ? '11.5px' : '9.5px';
  return `
    @page {
      size: ${pageWidthMm}mm auto !important;
      margin: 0mm !important;
    }
    html, body {
      width: 100% !important;
      max-width: 100% !important;
      padding: 0 1.5mm !important;
      font-size: ${fontSize} !important;
    }
    .line { font-size: ${fontSize} !important; }
    .muted { font-size: ${mutedSize} !important; }
    .section-title { font-size: ${titleSize} !important; }
    table { font-size: ${fontSize} !important; }
    td { font-size: ${fontSize} !important; }
  `;
}

export function withThermalReceiptPrintCss(html: string): string {
  const source = String(html || '');
  if (!source.trim()) return source;
  // Skip if the sentinel attribute is present — prevents double injection
  // which would override the paper-specific @page size set by thermalPaperWidthOverride.
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
