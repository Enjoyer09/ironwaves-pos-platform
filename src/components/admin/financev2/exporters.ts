// Report export without extra dependencies:
// - Excel: CSV with UTF-8 BOM and ';' delimiter (same convention as the legacy finance export).
// - PDF: a print-ready document opened in a new window; the browser's "Save as PDF" produces the file.
// Every cell is escaped for its target format (CSV formula injection, HTML injection).

export type ExportCell = string | number | null | undefined;

export type ExportSection = {
  heading?: string;
  columns: string[];
  /** Index of columns holding money/numbers: right-aligned in PDF, raw numbers in CSV. */
  numeric?: number[];
  rows: ExportCell[][];
  footer?: ExportCell[];
};

export type ExportReport = {
  title: string;
  subtitle?: string;
  meta?: string[];
  sections: ExportSection[];
  fileBase: string;
};

const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

function csvCell(value: ExportCell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Spreadsheet formula injection guard; plain numbers (incl. negatives) stay numeric.
  if (/^[=+\-@\t\r]/.test(text) && !NUMERIC_TEXT.test(text)) text = `'${text}`;
  if (/[";\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(report: ExportReport) {
  download(`${report.fileBase}.csv`, buildCsv(report), 'text/csv;charset=utf-8;');
}

export function buildCsv(report: ExportReport): string {
  const lines: string[] = [csvCell(report.title)];
  if (report.subtitle) lines.push(csvCell(report.subtitle));
  (report.meta || []).forEach((m) => lines.push(csvCell(m)));
  report.sections.forEach((section) => {
    lines.push('');
    if (section.heading) lines.push(csvCell(section.heading));
    lines.push(section.columns.map(csvCell).join(';'));
    section.rows.forEach((row) => lines.push(row.map(csvCell).join(';')));
    if (section.footer) lines.push(section.footer.map(csvCell).join(';'));
  });
  return `\uFEFF${lines.join('\r\n')}`;
}

function html(value: ExportCell): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value: ExportCell): string {
  const text = String(value ?? '');
  if (!NUMERIC_TEXT.test(text)) return text;
  const negative = text.startsWith('-');
  const [int, frac = '00'] = text.replace('-', '').split('.');
  return `${negative ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac.padEnd(2, '0').slice(0, 2)}`;
}

/** Returns false when the browser blocked the pop-up. */
export function exportPdf(report: ExportReport, lang: string): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  const sections = report.sections.map((section) => {
    const numeric = new Set(section.numeric || []);
    const cell = (value: ExportCell, index: number, tag: 'td' | 'th') =>
      `<${tag}${numeric.has(index) ? ' class="num"' : ''}>${html(numeric.has(index) ? formatNumber(value) : value)}</${tag}>`;
    return `
      <section>
        ${section.heading ? `<h2>${html(section.heading)}</h2>` : ''}
        <table>
          <thead><tr>${section.columns.map((c, i) => cell(c, i, 'th')).join('')}</tr></thead>
          <tbody>${section.rows.map((row) => `<tr>${row.map((v, i) => cell(v, i, 'td')).join('')}</tr>`).join('')}</tbody>
          ${section.footer ? `<tfoot><tr>${section.footer.map((v, i) => cell(v, i, 'td')).join('')}</tr></tfoot>` : ''}
        </table>
      </section>`;
  }).join('');
  win.document.open();
  win.document.write(`<!doctype html>
<html lang="${html(lang)}">
<head>
<meta charset="utf-8">
<title>${html(report.title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; font-size: 11px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 18px 0 6px; }
  .sub { color: #475569; margin: 0 0 2px; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th, td { border-bottom: 1px solid #e2e8f0; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 700; }
  tfoot td { font-weight: 700; border-top: 2px solid #0f172a; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  footer { margin-top: 18px; color: #64748b; font-size: 10px; }
</style>
</head>
<body>
  <h1>${html(report.title)}</h1>
  ${report.subtitle ? `<p class="sub">${html(report.subtitle)}</p>` : ''}
  ${(report.meta || []).map((m) => `<p class="sub">${html(m)}</p>`).join('')}
  ${sections}
  <footer>iRonWaves · ${html(new Date().toLocaleString())}</footer>
</body>
</html>`);
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 300);
  return true;
}
