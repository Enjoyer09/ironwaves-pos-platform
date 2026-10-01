import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  newIdempotencyKey,
  sumMoney,
  toMoneyString,
  validateAmount,
  validatePayment,
} from '../src/components/admin/financev2/billsMath.ts';

test('sumMoney adds decimal strings exactly (0.1 + 0.2 = 0.30)', () => {
  assert.equal(sumMoney(['0.1', '0.2']), '0.30');
  assert.equal(sumMoney(Array(10).fill('0.10')), '1.00');
  assert.equal(sumMoney(['100.00', '-40.00', '-60.00']), '0.00');
  assert.equal(sumMoney([]), '0.00');
  assert.equal(sumMoney(['12.34', null, undefined, '']), '12.34');
});

test('toMoneyString normalises to exactly 2 decimals or null', () => {
  assert.equal(toMoneyString('5'), '5.00');
  assert.equal(toMoneyString(' 1,5 '), '1.50');
  assert.equal(toMoneyString('100.05'), '100.05');
  assert.equal(toMoneyString('100.005'), null);
  assert.equal(toMoneyString(''), null);
  assert.equal(toMoneyString('abc'), null);
  assert.equal(toMoneyString('-3'), null);
  assert.equal(toMoneyString('1e3'), null);
});

test('validateAmount rejects sub-cent, zero and garbage', () => {
  assert.equal(validateAmount('10.00'), 'ok');
  assert.equal(validateAmount('100.005'), 'too_many_decimals');
  assert.equal(validateAmount('0'), 'invalid');
  assert.equal(validateAmount('0.00'), 'invalid');
  assert.equal(validateAmount('-1'), 'invalid');
  assert.equal(validateAmount('NaN'), 'invalid');
  assert.equal(validateAmount(''), 'invalid');
});

test('validatePayment caps the amount at the open balance', () => {
  assert.equal(validatePayment('150.00', '150.00'), 'ok');
  assert.equal(validatePayment('0.30', sumMoney(['0.1', '0.2'])), 'ok');
  assert.equal(validatePayment('150.01', '150.00'), 'exceeds_open');
  assert.equal(validatePayment('100.005', '200.00'), 'too_many_decimals');
  assert.equal(validatePayment('0', '200.00'), 'invalid');
  assert.equal(validatePayment('x', '200.00'), 'invalid');
});

test('newIdempotencyKey is unique and accepted by the pay endpoint', () => {
  const keys = new Set(Array.from({ length: 1000 }, () => newIdempotencyKey()));
  assert.equal(keys.size, 1000);
  for (const key of keys) {
    // PayBillIn.idempotency_key: 8-80 chars, ^[A-Za-z0-9:_-]+$
    assert.match(key, /^[A-Za-z0-9:_-]{8,80}$/);
  }
});

// ── Static regression guards for the UI-only review findings (no browser harness in this repo) ──
const source = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const BILLS = 'src/components/admin/financev2/BillsTab.tsx';

test('F2: PayBillDialog keeps one idempotency key per open dialog and sends it', () => {
  const s = source(BILLS);
  assert.match(s, /useRef\(newIdempotencyKey\(\)\)/);
  assert.match(s, /idempotency_key:\s*idempotencyKey\.current/);
});

test('F10: BillsTab does no float money arithmetic', () => {
  assert.doesNotMatch(source(BILLS), /parseFloat\(|Number\(/);
});

test('F11: KPIs come from the server summary and the list is paged', () => {
  const s = source(BILLS);
  assert.match(s, /data\?\.summary/);
  assert.match(s, /setOffset\(offset \+ PAGE\)/);
});

test('F14: bill detail renders the source journal lines', () => {
  assert.match(source(BILLS), /doc\.lines\.map\(/);
});

test('F16: overdue bills tint the whole row', () => {
  assert.match(source(BILLS), /<tr key=\{doc\.id\} className=\{doc\.is_overdue \? 'bg-rose-950/);
});

test('F17: every BillsTab button uses a btn token or a 44px target', () => {
  const buttons = source(BILLS).match(/<button\b[\s\S]*?>/g) || [];
  assert.ok(buttons.length > 0);
  for (const b of buttons) assert.match(b, /btn\.|min-h-11/, b);
});

test('F18: the bills table has a screen-reader caption', () => {
  assert.match(source(BILLS), /<caption className="sr-only">/);
});

test('F19: suppliers are picked from GET /gl/suppliers, not typed as ids', () => {
  const s = source(BILLS);
  assert.match(s, /glApi\.suppliers\(\)/);
  assert.match(source('src/api/gl.ts'), /suppliers: \(\) => get<GLSupplier\[\]>\('\/suppliers'\)/);
});

test('F23: general expense option is labelled 721.9', () => {
  assert.match(source(BILLS), /value="general_expense">721\.9 /);
});

test('D4: JournalDrawer offers no generic storno for document journals', () => {
  const s = source('src/components/admin/financev2/JournalsTabs.tsx');
  assert.match(s, /source_type === 'document' \|\| j\.source_type === 'document_payment'/);
  assert.match(s, /glOwned = [^\n]*!documentOwned/);
});

test('F7: restock sends supplier_id and the panel requires a supplier in dual mode', () => {
  const api = source('src/api/inventory.ts');
  const restock = api.slice(api.indexOf('export async function restock_item_live'), api.indexOf('export async function update_inventory_item_live'));
  assert.match(restock, /supplier_id: String\(options\?\.supplier_id/);
  assert.match(source('src/components/admin/InventoryPanel.tsx'), /ledger_mode === 'dual'/);
});

test('F12: handoff keeps the unverified token purge flagged and drops the unverified reconcile claim', () => {
  const s = source('docs/FINANCE_V2_HANDOFF.md');
  assert.match(s, /\*\*Verify this\.\*\*/);
  assert.doesNotMatch(s, /Nightly reconciliation on 2026-10-01 passed/);
  assert.match(s, /In review \(PR #39\) — AP only; AR deferred/);
});
