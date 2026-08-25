export const THERMAL_RECEIPT_PRINT_CSS = `
  @page {
    size: auto;
    margin: 0mm;
  }
  * {
    box-sizing: border-box;
  }
  html,
  body {
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 auto !important;
    padding: 0 1.5mm !important;
    color: #000 !important;
    background: #fff !important;
    font-family: "Courier New", "Lucida Console", "Liberation Mono", monospace !important;
    font-size: 12.5px !important;
    line-height: 1.25 !important;
    font-weight: 700 !important;
    -webkit-font-smoothing: none;
    text-rendering: geometricPrecision;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  @media print {
    html,
    body {
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 1mm !important;
    }
  }
  div, table, tr, td, p {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  body { overflow-wrap: break-word; word-wrap: break-word; }
  .line {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 4px;
    margin: 2.5px 0;
    font-size: 12.5px;
  }
  .line span:first-child { min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
  .line span:last-child {
    text-align: right;
    white-space: nowrap;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .muted {
    color: #111;
    font-size: 11px;
    line-height: 1.25;
    font-weight: 600;
  }
  .bold { font-weight: 900; }
  .section-title {
    margin-top: 6px;
    font-size: 12.5px;
    line-height: 1.25;
    font-weight: 900;
    text-transform: uppercase;
  }
  h1, h2, h3 { margin: 0 0 2px; font-weight: 900; line-height: 1.2; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px !important;
    line-height: 1.25 !important;
    table-layout: auto;
  }
  td {
    vertical-align: top;
    padding: 4px 0;
    font-weight: 700;
  }
  td:first-child { overflow-wrap: anywhere; padding-right: 6px; white-space: normal; }
  /* Qty column: only applies to 3+ column tables (e.g. table-check receipts).
     POS receipts are 2-column (name+qty | price) — the qty lives inside the
     name cell, so the price cell below is their only right column. */
  td:nth-child(2):not(:last-child) {
    width: 10mm;
    text-align: center;
    white-space: nowrap;
    font-weight: 800;
    padding-right: 4px;
  }
  td:last-child {
    width: 16mm;
    margin-right: 0;
    min-width: 16mm;
    text-align: right;
    white-space: nowrap;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  hr {
    border: 0;
    border-top: 1.5px dashed #000;
    margin: 8px 0;
  }
  svg { max-width: 100%; }
  img { max-width: 100%; image-rendering: crisp-edges; }
`;

// Paper width override: 58mm printers fit ~48-52mm of printable content, 80mm ~72-76mm.
// Returns BARE CSS rules (no <style> wrapper). Every caller embeds this inside an
// already-open <style> block, so wrapping it in its own <style> tag closed that block
// early — the HTML parser stopped at the nested </style>, dropped the html/body rule as
// an invalid selector, and leaked any trailing CSS (e.g. kitchen ticket's .kitchen-*
// rules) as visible text at the top of the ticket. Keep this unwrapped.
export function thermalPaperWidthOverride(paperWidth?: '58mm' | '80mm'): string {
  const contentWidth = paperWidth === '80mm' ? '76mm' : '52mm';
  const fontSize = paperWidth === '80mm' ? '14px' : '12.5px';
  return `
    html, body { max-width: ${contentWidth} !important; font-size: ${fontSize} !important; }
    table { font-size: ${fontSize} !important; }
    .line { font-size: ${fontSize} !important; }
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
