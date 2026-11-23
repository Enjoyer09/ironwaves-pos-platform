import { sanitizeEscPosText } from './escpos_builder';

/** Turn the already saved Z receipt into a native thermal ticket. */
export function buildZReportEscPos(html: string, paperWidth: '58mm' | '80mm' = '80mm'): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const columns = paperWidth === '58mm' ? 40 : 48;
  const clean = (value: string | null | undefined) => sanitizeEscPosText(String(value || ''))
    .replace(/₼/g, ' M').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?').replace(/\s+/g, ' ').trim();
  const lines: string[] = [];
  const add = (value: string) => {
    const words = clean(value).split(' ');
    let line = '';
    for (let word of words) {
      if (!word) continue;
      if (line && line.length + word.length + 1 > columns) {
        lines.push(line);
        line = '';
      }
      while (word.length > columns) {
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, columns));
        word = word.slice(columns);
      }
      line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  };
  doc.body.querySelectorAll(':scope > div, :scope > hr').forEach((element) => {
    if (element.tagName === 'HR') {
      lines.push('-'.repeat(columns));
      return;
    }
    if (element.classList.contains('line')) {
      const cells = Array.from(element.children);
      const left = clean(cells[0]?.textContent);
      const right = clean(cells[1]?.textContent);
      if (right && left.length + right.length + 1 <= columns) {
        lines.push(left + ' '.repeat(columns - left.length - right.length) + right);
      } else {
        add(left);
        if (right) lines.push(right.padStart(columns));
      }
      return;
    }
    add(element.textContent || '');
  });
  if (!lines.some((line) => line.includes('Z-Hesabat'))) {
    throw new Error('Z-hesabat çekinin mətni oxunmadı');
  }
  return `\x1B@\x1Bt\x00${lines.join('\n')}\n\n\n\n\x1D\x56\x42\x00`;
}
