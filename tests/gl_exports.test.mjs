import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv } from '../src/components/admin/financev2/exporters.ts';
import { subledgerReport } from '../src/components/admin/financev2/reportExports.ts';

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

test('AP subledger export has a not-yet-due column and the aging basis', () => {
  const buckets = { current: '100.00', '0_30': '0.00', '31_60': '0.00', '61_90': '0.00', '90_plus': '70.00' };
  const report = subledgerReport('en', {
    ledger: 'ap', as_of: '2026-09-30', control_accounts: [{ id: 'a', code: '531', name: 'AP' }], control_balance: '170.00',
    partners: [{ partner_type: 'supplier', partner_id: 's1', name: 'Supplier A', balance: '170.00', open: '170.00', advance: '0.00',
      buckets, aging_basis: 'mixed', oldest_open_date: '2026-06-22' }],
    totals: { ...buckets, advance: '0.00', balance: '170.00' }, unassigned_balance: '0.00', reconciled: true,
  });
  const [section] = report.sections;
  assert.equal(section.columns[1], 'Not yet due');
  assert.equal(section.columns.length, section.rows[0].length);
  assert.equal(section.columns.length, section.footer.length);
  assert.deepEqual(section.rows[0], ['Supplier A', '100.00', '0.00', '0.00', '0.00', '70.00', '0.00', '170.00', 'Mixed: bills + posting date', '2026-06-22']);
  assert.deepEqual(section.footer.slice(0, 2), ['Total', '100.00']);
  const csv = buildCsv(report);
  assert.ok(csv.includes('Supplier A;100.00;0.00;0.00;0.00;70.00;0.00;170.00;Mixed: bills + posting date;2026-06-22'));
});
