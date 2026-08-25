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
    padding: 0 1mm !important;
    color: #000 !important;
    background: #fff !important;
    font-family: "Courier New", "Lucida Console", "Liberation Mono", monospace !important;
    font-size: 11.5px !important;
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
    align-items: baseline;
    gap: 4px;
    margin: 2px 0;
    font-size: 11.5px;
  }
  .line span:first-child {
    flex: 1 1 auto;
    min-width: max-content;
    padding-right: 4px;
    overflow-wrap: break-word;
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
    font-size: 12px;
    line-height: 1.25;
    font-weight: 900;
    text-transform: uppercase;
  }
  h1, h2, h3 { margin: 0 0 2px; font-weight: 900; line-height: 1.2; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px !important;
    line-height: 1.25 !important;
    table-layout: auto;
  }
  td {
    vertical-align: top;
    padding: 2.5px 0;
    font-weight: 700;
  }
  td:first-child {
    text-align: left;
    overflow-wrap: break-word;
    word-break: break-word;
    padding-right: 4px;
  }
  td:last-child {
    text-align: right;
    white-space: nowrap;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  hr {
    border: 0;
    border-top: 1px dashed #000;
    margin: 6px 0;
  }
  svg { max-width: 100%; }
  img { max-width: 100%; image-rendering: crisp-edges; }
`;

// Paper width override: 58mm printers fit ~48mm of printable content, 80mm ~72mm.
export function thermalPaperWidthOverride(paperWidth?: '58mm' | '80mm'): string {
  const contentWidth = paperWidth === '80mm' ? '72mm' : '48mm';
  const fontSize = paperWidth === '80mm' ? '13.5px' : '11.5px';
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
