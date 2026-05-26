export const THERMAL_RECEIPT_PRINT_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  html,
  body {
    width: 70mm;
    max-width: 70mm;
    margin: 0 !important;
    padding: 0 !important;
    color: #000 !important;
    background: #fff !important;
    font-family: "Courier New", "DejaVu Sans Mono", "Liberation Mono", monospace !important;
    font-size: 14px !important;
    line-height: 1.26 !important;
    font-weight: 600 !important;
    -webkit-font-smoothing: none;
    text-rendering: geometricPrecision;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { overflow-wrap: break-word; }
  .line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content;
    align-items: start;
    gap: 6px;
    margin: 3px 0;
  }
  .line span:first-child { min-width: 0; overflow-wrap: anywhere; }
  .line span:last-child {
    text-align: right;
    white-space: nowrap;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .muted {
    color: #111;
    font-size: 12px;
    line-height: 1.22;
    font-weight: 600;
  }
  .bold { font-weight: 900; }
  .section-title {
    margin-top: 9px;
    font-size: 13px;
    line-height: 1.25;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  h1, h2, h3 { margin: 0 0 4px; font-weight: 900; line-height: 1.15; }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 14px !important;
    line-height: 1.25 !important;
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
