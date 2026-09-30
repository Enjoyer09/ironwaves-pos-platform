import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv } from '../src/components/admin/financev2/exporters.ts';

const report = (rows) => ({
  title: 'Sınaq balansı',
  fileBase: 'x',
  sections: [{ columns: ['Hesab', 'Ad', 'Məbləğ'], numeric: [2], rows, footer: ['', 'Cəmi', '10.00'] }],
});

test('csv starts with BOM and uses semicolons', () => {
  const csv = buildCsv(report([['221.1', 'Kassa', '10.00']]));
  assert.ok(csv.startsWith('\uFEFFSınaq balansı'));
  assert.ok(csv.includes('221.1;Kassa;10.00'));
  assert.ok(csv.trimEnd().endsWith(';Cəmi;10.00'));
});

test('csv quotes delimiters and quotes', () => {
  const csv = buildCsv(report([['1', 'A; "B"', '1.00']]));
  assert.ok(csv.includes('1;"A; ""B""";1.00'));
});

test('csv neutralises spreadsheet formulas but keeps negative numbers', () => {
  const csv = buildCsv(report([['=HYPERLINK("x")', '+cmd', '-12.50'], ['@SUM(A1)', '-x', '-3']]));
  assert.ok(csv.includes(`'=HYPERLINK`));
  assert.ok(csv.includes(`;'+cmd;-12.50`));
  assert.ok(csv.includes(`'@SUM(A1);'-x;-3`));
});
