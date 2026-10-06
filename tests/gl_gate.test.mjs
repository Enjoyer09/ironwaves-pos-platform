// Finance v2 WP-A: the per-tenant UI gate (R1) and the supplier policy (R2) on the frontend.
// Playwright-free: the gate is a pure function (src/lib/financeV2Gate.ts) plus static source checks, same style as gl_bills.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isFinanceV2Available } from '../src/lib/financeV2Gate.ts';

const source = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const HIDDEN = { enabled: true, ui_visible: false };
const VISIBLE = { enabled: true, ui_visible: true };

test('a hidden dual tenant: admin, manager, accountant, finance_admin and auditor do NOT get the financev2 module', () => {
  for (const role of ['admin', 'manager', 'accountant', 'finance_admin', 'auditor', 'staff']) {
    assert.equal(isFinanceV2Available(HIDDEN, role), false, role);
  }
});

test('a hidden dual tenant: super_admin DOES get the module', () => {
  assert.equal(isFinanceV2Available(HIDDEN, 'super_admin'), true);
  assert.equal(isFinanceV2Available(HIDDEN, ' Super_Admin '), true); // same normalisation as the session role
});

test('a visible dual tenant serves every finance role', () => {
  for (const role of ['admin', 'manager', 'accountant', 'finance_admin', 'auditor', 'super_admin']) {
    assert.equal(isFinanceV2Available(VISIBLE, role), true, role);
  }
});

test('fail closed: no capabilities (404, non-dual tenant, offline) means no module, even for super_admin', () => {
  assert.equal(isFinanceV2Available(null, 'admin'), false);
  assert.equal(isFinanceV2Available(undefined, 'super_admin'), false);
  assert.equal(isFinanceV2Available({ enabled: false, ui_visible: true }, 'admin'), false);
  assert.equal(isFinanceV2Available({ enabled: false, ui_visible: true }, 'super_admin'), false);
});

test('fail closed: an old backend without ui_visible only serves super_admin', () => {
  assert.equal(isFinanceV2Available({ enabled: true }, 'admin'), false);
  assert.equal(isFinanceV2Available({ enabled: true }, 'super_admin'), true);
  assert.equal(isFinanceV2Available({ enabled: true, ui_visible: 'true' }, 'admin'), false); // only a real boolean counts
});

test('App.tsx uses the pure gate and no longer trusts caps.enabled alone', () => {
  const app = source('src/App.tsx');
  assert.match(app, /from '\.\/lib\/financeV2Gate'/);
  assert.match(app, /setGlAvailable\(isFinanceV2Available\(caps, sessionRole\)\)/);
  assert.doesNotMatch(app, /setGlAvailable\(Boolean\(caps\?\.enabled\)\)/);
});

test('GLCapabilities declares ui_visible', () => {
  assert.match(source('src/api/gl.ts'), /ui_visible: boolean;/);
});

test('InventoryPanel follows the supplier policy endpoint, not the GL capabilities or the ledger mode', () => {
  const panel = source('src/components/admin/InventoryPanel.tsx');
  assert.match(panel, /get_inventory_policy_live/);
  assert.doesNotMatch(panel, /getGLCapabilities/);
  assert.doesNotMatch(panel, /ledger_mode/);
  assert.doesNotMatch(panel, /ledgerDual|dual ledger mode/i);
  const api = source('src/api/inventory.ts');
  assert.match(api, /'\/api\/v1\/catalog\/inventory\/policy'/);
  const from = api.indexOf('export async function get_inventory_policy_live');
  const policy = api.slice(from, api.indexOf('export async function add_inventory_item_live'));
  assert.match(policy, /require_supplier: false/); // backend off or any error: today's optional supplier
  assert.doesNotMatch(policy, /\/api\/v1\/gl/);
});

test('the supplier message is a tx(lang, az, ru, en) string that no longer talks about dual mode', () => {
  const panel = source('src/components/admin/InventoryPanel.tsx');
  const start = panel.indexOf('const supplierRequiredMessage');
  const message = panel.slice(start, panel.indexOf(';', panel.indexOf("'", panel.indexOf("'", panel.indexOf("'", start) + 1) + 1)) + 1);
  assert.match(message, /tx\(lang,/);
  assert.match(message, /təchizatçı/);
  assert.doesNotMatch(message, /ikili|двойном|dual/i);
});
