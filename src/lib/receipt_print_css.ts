export const THERMAL_RECEIPT_PRINT_CSS = `
  @page { size: auto; margin: 0; }
  * { box-sizing: border-box; }
  html,
  body {
    width: 100% !important;
    max-width: 48mm !important;
    margin: 0 auto !important;
    padding: 0 1mm !important;
    color: #000 !important;
    background: #fff !important;
    font-family: "Courier New", "Lucida Console", "Liberation Mono", monospace !important;
    font-size: 11px !important;
    line-height: 1.2 !important;
    font-weight: 700 !important;
    -webkit-font-smoothing: none;
    text-rendering: geometricPrecision;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
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
    margin: 2px 0;
    font-size: 11px;
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
    font-size: 10px;
    line-height: 1.2;
    font-weight: 600;
  }
  .bold { font-weight: 900; }
  .section-title {
    margin-top: 6px;
    font-size: 11px;
    line-height: 1.2;
    font-weight: 900;
    text-transform: uppercase;
  }
  h1, h2, h3 { margin: 0 0 2px; font-weight: 900; line-height: 1.15; }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 11px !important;
    line-height: 1.2 !important;
  }
  td {
    vertical-align: top;
    padding: 4px 0;
    font-weight: 700;
  }
  td:first-child { overflow-wrap: anywhere; padding-right: 6px; }
  td:last-child {
    width: 24mm;
    text-align: right;
    white-space: nowrap;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  hr {
    border: 0;
    border-top: 1.5px dashed #000;
    margin: 9px 0;
  }
  svg { max-width: 100%; }
  img { max-width: 100%; image-rendering: crisp-edges; }
`;

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
