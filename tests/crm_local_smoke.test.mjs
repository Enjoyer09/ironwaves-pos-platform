// Smoke test: get_customer_orders_live local fallback path (backend OFF).
//
// Verifies the offline branch of src/api/crm.ts: tenant + card filtering,
// case-insensitive match, newest-first sort, 10-order limit, field mapping,
// and the local pre-order -> get-orders roundtrip.
//
// The project has no test runner installed, so this uses Node's built-in
// `node --test` and is bundled with esbuild (already present via vite):
//
//   npm run test:smoke
//
// (bundle -> tests/.build/crm_local_smoke.test.mjs -> node --test)
import test from 'node:test';
import assert from 'node:assert/strict';

import { clearDBCache, setDB, getDB } from '../src/lib/db_sim';
import {
  get_customer_orders_live,
  create_customer_pre_order_live,
  get_customer_app_session_live,
  update_customer_name_live,
  update_customer_birthday_live,
  writeCustomerSessionCache,
  readCustomerSessionCache,
  clearCustomerSessionCache,
} from '../src/api/crm';
import { computeVirtualWindow } from '../src/lib/virtualGrid';

function seed(rows) {
  clearDBCache('kitchen_orders');
  setDB('kitchen_orders', rows);
}

test('throws when cardId or token is missing', async () => {
  await assert.rejects(() => get_customer_orders_live('', 'tok', 't1'), /invalid/i);
  await assert.rejects(() => get_customer_orders_live('QR-1', '', 't1'), /invalid/i);
  await assert.rejects(() => get_customer_orders_live('   ', 'tok', 't1'), /invalid/i);
  await assert.rejects(() => get_customer_orders_live('QR-1', '  ', 't1'), /invalid/i);
});

test('filters by tenant + card (case-insensitive) and maps fields', async () => {
  seed([
    {
      id: 'o1', tenant_id: 't1', card_id: 'QR-AAA1111', status: 'NEW',
      order_type: 'Order Online',
      items: [{ id: 'i1', name: 'Iced Latte', quantity: 1, price: 4.5 }],
      created_at: '2026-08-16T10:00:00Z', completed_at: null,
    },
    // same card, different case -> must match (case-insensitive)
    { id: 'o2', tenant_id: 't1', card_id: 'qr-aaa1111', status: 'PREPARING', items: [], created_at: '2026-08-16T09:00:00Z' },
    // same tenant, other card -> excluded
    { id: 'o3', tenant_id: 't1', card_id: 'QR-OTHER', status: 'NEW', items: [], created_at: '2026-08-16T08:00:00Z' },
    // same card, other tenant -> excluded
    { id: 'o4', tenant_id: 't2', card_id: 'QR-AAA1111', status: 'NEW', items: [], created_at: '2026-08-16T07:00:00Z' },
    // no tenant_id at all -> excluded
    { id: 'o5', card_id: 'QR-AAA1111', status: 'NEW', items: [], created_at: '2026-08-16T06:00:00Z' },
  ]);

  const orders = await get_customer_orders_live('QR-AAA1111', 'tok', 't1');
  assert.equal(orders.length, 2);
  assert.deepEqual(orders.map((o) => o.id), ['o1', 'o2']);

  // field mapping on the first order
  assert.equal(orders[0].status, 'NEW');
  assert.equal(orders[0].order_type, 'Order Online');
  assert.equal(orders[0].items.length, 1);
  assert.equal(orders[0].items[0].name, 'Iced Latte');
  assert.equal(orders[0].created_at, '2026-08-16T10:00:00Z');
  assert.equal(orders[0].completed_at, null);

  // defaults for missing fields (order_type -> 'Online')
  assert.equal(orders[1].status, 'PREPARING');
  assert.equal(orders[1].order_type, 'Online');
});

test('sorts newest first by created_at', async () => {
  seed([
    { id: 'a', tenant_id: 't1', card_id: 'QR-1', created_at: '2026-08-16T10:00:00Z' },
    { id: 'b', tenant_id: 't1', card_id: 'QR-1', created_at: '2026-08-16T12:00:00Z' },
    { id: 'c', tenant_id: 't1', card_id: 'QR-1', created_at: '2026-08-16T11:00:00Z' },
  ]);
  const orders = await get_customer_orders_live('qr-1', 'tok', 't1');
  assert.deepEqual(orders.map((o) => o.id), ['b', 'c', 'a']);
});

test('limits result to the 10 most recent orders', async () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    id: `o${i}`,
    tenant_id: 't1',
    card_id: 'QR-1',
    items: [],
    created_at: new Date(Date.UTC(2026, 7, 16, 10, i)).toISOString(),
  }));
  seed(rows);
  const orders = await get_customer_orders_live('QR-1', 'tok', 't1');
  assert.equal(orders.length, 10);
  assert.equal(orders[0].id, 'o13'); // newest first
  assert.equal(orders[9].id, 'o4'); // oldest of the kept window
});

test('empty store returns empty list', async () => {
  seed([]);
  const orders = await get_customer_orders_live('QR-1', 'tok', 't1');
  assert.deepEqual(orders, []);
});

test('local session exposes tier + lifetime_stars', async () => {
  clearDBCache();
  setDB('customers', [
    {
      id: 'cust-1', tenant_id: 't1', card_id: 'QR-TIER1', secret_token: 'tok-1',
      type: 'golden', stars: 3, lifetime_stars: 150, discount_percent: 0,
      created_at: '2026-08-16T10:00:00Z',
    },
  ]);
  const session = await get_customer_app_session_live('QR-TIER1', 'tok-1', 't1');
  assert.equal(session.customer.lifetime_stars, 150);
  assert.equal(session.customer.tier.key, 'silver');
  assert.equal(session.customer.tier.label.az, 'Gümüş');
  assert.equal(session.customer.tier.progress_pct, 25);
  assert.equal(session.customer.tier.next_threshold, 300);
});

test('local name + birth date update roundtrip', async () => {
  clearDBCache();
  setDB('customers', [
    {
      id: 'cust-1', tenant_id: 't1', card_id: 'QR-NAME1', secret_token: 'tok-1',
      type: 'golden', stars: 0, discount_percent: 0,
      created_at: '2026-08-16T10:00:00Z',
    },
  ]);

  await update_customer_name_live('QR-NAME1', 'tok-1', '  Leyla  ', 't1');
  await update_customer_birthday_live('QR-NAME1', 'tok-1', '1995-05-10', 't1');

  const session = await get_customer_app_session_live('QR-NAME1', 'tok-1', 't1');
  assert.equal(session.customer.name, 'Leyla');
  assert.equal(session.customer.birth_date, '1995-05-10');

  // clearing birth date is allowed (empty -> removed, mirrors backend None)
  await update_customer_birthday_live('QR-NAME1', 'tok-1', '', 't1');
  const cleared = await get_customer_app_session_live('QR-NAME1', 'tok-1', 't1');
  assert.equal(cleared.customer.birth_date, null);

  // invalid session rejected
  await assert.rejects(() => update_customer_name_live('QR-NAME1', 'wrong-token', 'Leyla', 't1'), /invalid/i);
  await assert.rejects(() => update_customer_birthday_live('QR-NAME1', 'wrong-token', '1995-05-10', 't1'), /invalid/i);
  // empty name rejected
  await assert.rejects(() => update_customer_name_live('QR-NAME1', 'tok-1', '   ', 't1'), /invalid/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-3 offline session cache: the last fetched session survives a network outage.
// The local fallback path of get_customer_app_session_live never hits the cache,
// so these tests exercise the cache helpers directly (write -> read roundtrip,
// token separation, clear) plus the `_from_cache` marker shape.
// ─────────────────────────────────────────────────────────────────────────────

test('session cache roundtrip: write then read returns the same session', () => {
  clearCustomerSessionCache();
  const session = {
    tenant_id: 't1',
    customer: { card_id: 'QR-CACHE1', name: 'Aysel', stars: 12 },
    wallet: { stars_balance: 12, available_rewards: 1 },
  };
  writeCustomerSessionCache('QR-CACHE1', 'tok-cache', session);
  const cached = readCustomerSessionCache('QR-CACHE1', 'tok-cache');
  assert.ok(cached, 'cached session found');
  assert.equal(cached.session.customer.card_id, 'QR-CACHE1');
  assert.equal(cached.session.customer.stars, 12);
  assert.equal(cached.session.wallet.stars_balance, 12);
  assert.ok(cached.ts > 0, 'timestamp recorded');
  clearCustomerSessionCache('QR-CACHE1', 'tok-cache');
  assert.equal(readCustomerSessionCache('QR-CACHE1', 'tok-cache'), null, 'cleared per-card');
});

test('session cache is separated by card AND token', () => {
  clearCustomerSessionCache();
  writeCustomerSessionCache('QR-CACHE2', 'tok-a', { customer: { card_id: 'QR-CACHE2', stars: 5 } });
  // same card, different token -> no access
  assert.equal(readCustomerSessionCache('QR-CACHE2', 'tok-b'), null, 'wrong token -> miss');
  // same token, different card -> no access
  assert.equal(readCustomerSessionCache('QR-OTHER', 'tok-a'), null, 'wrong card -> miss');
  // exact match still works
  assert.ok(readCustomerSessionCache('QR-CACHE2', 'tok-a'), 'exact match found');
  clearCustomerSessionCache();
});

test('session cache rejects empty/invalid sessions on write and read', () => {
  clearCustomerSessionCache();
  writeCustomerSessionCache('QR-CACHE3', 'tok-x', null);
  assert.equal(readCustomerSessionCache('QR-CACHE3', 'tok-x'), null, 'null session not cached');
  // card id is case-insensitive on read
  writeCustomerSessionCache('QR-CACHE3', 'tok-x', { customer: { card_id: 'QR-CACHE3', stars: 1 } });
  assert.ok(readCustomerSessionCache('qr-cache3', 'tok-x'), 'case-insensitive card id');
  clearCustomerSessionCache();
});

test('local roundtrip: pre-order becomes visible via get_customer_orders_live', async () => {
  clearDBCache();

  const res = await create_customer_pre_order_live({
    cardId: 'QR-AAA1111',
    token: 'tok-1',
    items: [
      { id: 'm1', name: 'Iced Latte', quantity: 2, price: 4.5 },
      { id: 'm2', name: 'Cinnamon Roll', quantity: 1, price: 3.2 },
    ],
    notes: 'No ice',
    tenantId: 't1',
  });
  assert.equal(res.success, true);
  assert.ok(res.orderId, 'orderId returned');

  const orders = await get_customer_orders_live('QR-AAA1111', 'tok-1', 't1');
  assert.equal(orders.length, 1);
  assert.equal(orders[0].id, res.orderId);
  assert.equal(orders[0].status, 'NEW');
  // NOTE: the local path stores 'Order Online' while the backend stores 'Online' —
  // a known cosmetic inconsistency between fallback and server paths.
  assert.equal(orders[0].order_type, 'Order Online');
  assert.equal(orders[0].items.length, 2);
  assert.equal(orders[0].items[0].name, 'Iced Latte');
  assert.equal(orders[0].items[0].quantity, 2);

  // a confirmation Notification is seeded for the customer app inbox
  const notifs = getDB('notifications') || [];
  assert.ok(
    notifs.some((n) => n.card_id === 'QR-AAA1111' && String(n.message).includes('qəbul edildi')),
    'confirmation notification seeded',
  );

  // other tenants must not see it
  const foreign = await get_customer_orders_live('QR-AAA1111', 'tok-1', 't2');
  assert.deepEqual(foreign, []);
});

// P1-4: campaign server validation — separate import so the P1-3 commit stays independent
import { activate_customer_campaign_live, validate_pos_campaign_live } from '../src/api/crm';

// ─────────────────────────────────────────────────────────────────────────────
// P1-4 campaign server validation — local fallback roundtrip: activate persists
// in the local store, the session exposes it, POS validates it. Since P1-4b,
// validate does NOT consume — consumption moved to create_sale, so scans stay
// valid until the sale commit; USED rows disappear from the session.
// ─────────────────────────────────────────────────────────────────────────────

function seedCampaignSetup() {
  clearDBCache();
  const customer = {
    id: 'cust-1', tenant_id: 't1', card_id: 'QR-CAMP1', secret_token: 'tok-1',
    type: 'golden', stars: 0, discount_percent: 0, created_at: '2026-08-16T10:00:00Z',
  };
  setDB('customers', [customer]);
  setDB('t1_customers', [customer]); // key used by the local create_sale
  // Wide window on today's weekday so the time check always passes.
  const now = new Date();
  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  setDB('happy_hours', [
    {
      id: 'hh-1', tenant_id: 't1', name: 'Happy Hour Test', is_active: true,
      start_time: '00:00', end_time: '23:59', discount_percent: 20,
      days_of_week_json: JSON.stringify([weekday]), categories: 'ALL',
    },
  ]);
}

test('campaign activate + session + POS validate local roundtrip', async () => {
  seedCampaignSetup();

  const act = await activate_customer_campaign_live('hh-1', 'QR-CAMP1', 'tok-1', 't1');
  assert.equal(act.success, true);
  assert.ok(act.expires_at, 'expires_at returned');

  // Session exposes the activation (server-style shape).
  const session = await get_customer_app_session_live('QR-CAMP1', 'tok-1', 't1');
  assert.equal(session.campaign_activations.length, 1);
  assert.equal(session.campaign_activations[0].campaign_id, 'hh-1');
  assert.equal(session.campaign_activations[0].name, 'Happy Hour Test');
  assert.equal(session.campaign_activations[0].discount_percent, 20);
  assert.equal(session.campaign_activations[0].expires_at, act.expires_at);

  // POS validates it — scan does NOT consume (P1-4b).
  const first = await validate_pos_campaign_live('hh-1', 'QR-CAMP1', 't1');
  assert.equal(first.valid, true);
  assert.equal(first.discount_percent, 20);
  assert.equal(first.name, 'Happy Hour Test');
  assert.ok(first.activation_id, 'activation_id returned for sale-level consumption');

  // Second scan stays valid — single-use lives at the sale, not the scan.
  const second = await validate_pos_campaign_live('hh-1', 'QR-CAMP1', 't1');
  assert.equal(second.valid, true);
  assert.equal(second.activation_id, first.activation_id);

  // Session still exposes the ACTIVE activation after scans.
  const mid = await get_customer_app_session_live('QR-CAMP1', 'tok-1', 't1');
  assert.equal(mid.campaign_activations.length, 1);

  // Simulate the sale committing: mark USED -> row disappears from the session.
  const row = (getDB('campaign_activations') || []).find(
    (r) => r.tenant_id === 't1' && r.campaign_id === 'hh-1' && r.card_id === 'QR-CAMP1',
  );
  row.status = 'USED';
  const after = await get_customer_app_session_live('QR-CAMP1', 'tok-1', 't1');
  assert.deepEqual(after.campaign_activations, []);
});

test('campaign re-activation refreshes expiry locally (no duplicates)', async () => {
  seedCampaignSetup();

  const first = await activate_customer_campaign_live('hh-1', 'QR-CAMP1', 'tok-1', 't1');
  // Force the stored expiry into the past, then re-activate -> must refresh.
  const stored = (getDB('campaign_activations') || []).find(
    (r) => r.tenant_id === 't1' && r.campaign_id === 'hh-1' && r.card_id === 'QR-CAMP1',
  );
  const pastExpiry = new Date(Date.now() - 60 * 1000).toISOString();
  stored.expires_at = pastExpiry;

  const second = await activate_customer_campaign_live('hh-1', 'QR-CAMP1', 'tok-1', 't1');
  assert.equal(second.success, true);

  const rows = (getDB('campaign_activations') || []).filter(
    (r) => r.tenant_id === 't1' && r.campaign_id === 'hh-1' && r.card_id === 'QR-CAMP1',
  );
  assert.equal(rows.length, 1, 'exactly one activation row');
  assert.equal(rows[0].status, 'ACTIVE');
  assert.ok(Date.parse(rows[0].expires_at) > Date.parse(pastExpiry), 'expiry refreshed from the past');
  assert.ok(Date.parse(rows[0].expires_at) > Date.now(), 'expiry moved to the future');
});

test('campaign activate rejects used / missing / invalid locally', async () => {
  seedCampaignSetup();

  // Used campaign -> 409-equivalent rejection (mark USED directly — validate
  // no longer consumes since P1-4b).
  await activate_customer_campaign_live('hh-1', 'QR-CAMP1', 'tok-1', 't1');
  const usedRow = (getDB('campaign_activations') || []).find(
    (r) => r.tenant_id === 't1' && r.campaign_id === 'hh-1' && r.card_id === 'QR-CAMP1',
  );
  usedRow.status = 'USED';
  await assert.rejects(
    () => activate_customer_campaign_live('hh-1', 'QR-CAMP1', 'tok-1', 't1'),
    /used/i,
  );

  // Missing campaign -> not found.
  await assert.rejects(
    () => activate_customer_campaign_live('no-such', 'QR-CAMP1', 'tok-1', 't1'),
    /not found/i,
  );

  // Bad session -> invalid.
  await assert.rejects(
    () => activate_customer_campaign_live('hh-1', 'QR-CAMP1', 'wrong-token', 't1'),
    /invalid/i,
  );

  // Empty payload -> invalid, not a crash.
  const res = await validate_pos_campaign_live('', '', 't1');
  assert.equal(res.valid, false);
});

test('campaign is consumed at sale locally (P1-4b), not at scan', async () => {
  seedCampaignSetup();

  const { create_sale } = await import('../src/api/pos');
  const { Decimal } = await import('decimal.js');

  await activate_customer_campaign_live('hh-1', 'QR-CAMP1', 'tok-1', 't1');
  const row = (getDB('campaign_activations') || []).find(
    (r) => r.tenant_id === 't1' && r.campaign_id === 'hh-1' && r.card_id === 'QR-CAMP1',
  );
  assert.equal(row.status, 'ACTIVE');

  const scan = await validate_pos_campaign_live('hh-1', 'QR-CAMP1', 't1');
  assert.equal(scan.valid, true);
  assert.equal(row.status, 'ACTIVE', 'scan must not consume (P1-4b)');

  const salePayload = () => ({
    tenant_id: 't1',
    cart_items: [
      { item_name: 'Espresso', price: new Decimal(4), qty: 2, is_coffee: true, category: 'Qəhvə', cup_mode: 'paper' },
    ],
    payment_method: 'Cash',
    cashier: 'cashier-1',
    customer_card_id: 'QR-CAMP1',
    discount_percent: 0,
    discount_reason: `Kampaniya: ${scan.name}`,
    campaign_id: 'hh-1',
    activation_id: scan.activation_id,
    is_eco_cup: false,
    is_test: true,
    split_cash: null,
    split_card: null,
    card_tips: new Decimal(0),
    customer_type: 'golden',
    order_type: 'Take Away',
    cup_mode: 'paper',
  });

  // First sale consumes the activation atomically.
  const first = create_sale(salePayload());
  assert.ok(first.success);
  assert.equal(row.status, 'USED', 'sale consumes the activation');

  // Same activation on a second sale -> rejected (single-use at sale).
  assert.throws(() => create_sale(salePayload()), /Kampaniya etibarsızdır/);
});

// ── Virtualized grid windowing (POS menu) ─────────────────────────────────

test('vgrid: empty list renders nothing with a stable spacer', () => {
  const w = computeVirtualWindow({ itemCount: 0, cols: 4, scrollTop: 0, viewportH: 800, rowH: 200 });
  assert.equal(w.visibleCount, 0);
  assert.equal(w.startIndex, 0);
  assert.equal(w.endIndex, 0);
  assert.equal(w.totalRows, 1);
  assert.ok(w.totalH > 0);
});

test('vgrid: list smaller than a viewport renders everything', () => {
  const w = computeVirtualWindow({ itemCount: 10, cols: 3, scrollTop: 0, viewportH: 1000, rowH: 100 });
  assert.equal(w.visibleCount, 10);
  assert.equal(w.startRow, 0);
  assert.equal(w.totalRows, 4);
});

test('vgrid: scrolled mid-list slices only visible rows plus overscan', () => {
  const w = computeVirtualWindow({ itemCount: 1000, cols: 4, scrollTop: 2500, viewportH: 800, rowH: 100 });
  assert.equal(w.startRow, 22);
  assert.equal(w.endRow, 36);
  assert.equal(w.startIndex, 22 * 4);
  assert.equal(w.endIndex, 36 * 4);
  assert.equal(w.offsetY, 22 * 100);
  assert.equal(w.totalRows, 250);
  assert.equal(w.totalH, 250 * 100);
});

test('vgrid: overscan clamps at the top', () => {
  const w = computeVirtualWindow({ itemCount: 500, cols: 5, scrollTop: 40, viewportH: 600, rowH: 120 });
  assert.equal(w.startRow, 0);
  assert.equal(w.startIndex, 0);
});

test('vgrid: over-scrolled bottom shows the last page, not an empty window', () => {
  const w = computeVirtualWindow({ itemCount: 997, cols: 4, scrollTop: 1_000_000, viewportH: 800, rowH: 100 });
  assert.equal(w.totalRows, 250);
  assert.equal(w.endRow, 250);
  assert.equal(w.endIndex, 997);
  assert.equal(w.startRow, 247); // scrollRow clamped to totalRows, overscan 3 back
  assert.equal(w.startIndex, 247 * 4);
  assert.equal(w.visibleCount, 997 - 247 * 4);
});

test('vgrid: invalid cols and rowH fall back safely', () => {
  const w1 = computeVirtualWindow({ itemCount: 100, cols: 0, scrollTop: 0, viewportH: 800, rowH: 200 });
  assert.equal(w1.startIndex, 0); // single-column fallback, no crash
  assert.ok(w1.visibleCount > 0 && w1.visibleCount <= 100);
  const w2 = computeVirtualWindow({ itemCount: 100, cols: 4, scrollTop: 0, viewportH: 0, rowH: 0 });
  assert.ok(w2.totalH > 0);
  assert.ok(w2.visibleCount >= 1);
});

test('vgrid: custom overscan shrinks the rendered slice', () => {
  const withDefault = computeVirtualWindow({ itemCount: 1000, cols: 4, scrollTop: 2500, viewportH: 800, rowH: 100 });
  const withOne = computeVirtualWindow({ itemCount: 1000, cols: 4, scrollTop: 2500, viewportH: 800, rowH: 100, overscan: 1 });
  assert.ok(withOne.visibleCount < withDefault.visibleCount);
  assert.equal(withOne.startRow, 24);
  assert.equal(withOne.endRow, 34);
});

test('vgrid: every scroll position is covered by its rendered window', () => {
  for (const scrollTop of [0, 100, 250, 600, 1200, 2400, 5000]) {
    const row = Math.floor(scrollTop / 140);
    const w = computeVirtualWindow({ itemCount: 2000, cols: 6, scrollTop, viewportH: 700, rowH: 140 });
    assert.ok(w.startRow <= row, `window starts before row ${row} (start=${w.startRow})`);
    assert.ok(row < w.endRow, `window reaches row ${row} (end=${w.endRow})`);
    assert.ok(w.startIndex >= 0 && w.endIndex <= 2000 && w.endIndex >= w.startIndex);
  }
});
