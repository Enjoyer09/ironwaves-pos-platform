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
import {
  hasActiveCampaign,
  campaignCountdown,
  formatCountdown,
} from '../src/lib/campaignTimer';
import {
  clampQty,
  updateCartItemQty,
  cartSubtotal,
  cartItemCount,
} from '../src/lib/cartMath';
import {
  buildReorderItem,
  mergeReorderItem,
} from '../src/lib/reorderItem';
import {
  haversineKm,
  sortStoresByDistance,
  get_nearest_branches_live,
} from '../src/api/crm';

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

// ── F4: campaign countdown — 1s ticker predicate + (exp−start) progress ──────
// Logic lives in src/lib/campaignTimer.ts (pure helpers used by OffersTab).

test('F4 ticker: runs only while at least one campaign is active', () => {
  const now = 1_700_000_000_000;
  // empty -> no tick
  assert.equal(hasActiveCampaign({}, now), false);
  // all expired -> no tick
  assert.equal(
    hasActiveCampaign({ a: { exp: now - 1000, start: now - 900000 } }, now),
    false,
  );
  // exp exactly == now -> expired (strict `>`), no tick
  assert.equal(hasActiveCampaign({ a: { exp: now, start: now - 1000 } }, now), false);
  // one live campaign -> tick
  assert.equal(
    hasActiveCampaign({ a: { exp: now + 5000, start: now - 1000 } }, now),
    true,
  );
  // mixed expired + live -> still ticks
  assert.equal(
    hasActiveCampaign({
      a: { exp: now - 5000, start: now - 900000 },
      b: { exp: now + 30_000, start: now - 1000 },
    }, now),
    true,
  );
});

test('F4 countdown: active mid-window is exactly 50% of the (exp−start) window', () => {
  const start = 1_000_000;
  const exp = start + 900000; // 15-min default window
  const now = start + 450000; // halfway
  const cd = campaignCountdown(exp, start, now);
  assert.equal(cd.isActive, true);
  assert.equal(cd.timeLeftMs, 450000);
  assert.equal(cd.secondsLeft, 450);
  assert.equal(cd.minutes, 7);
  assert.equal(cd.seconds, 30);
  assert.equal(cd.totalMs, 900000);
  assert.equal(cd.progressPct, 50);
  assert.equal(formatCountdown(cd.minutes, cd.seconds), '07:30');
});

test('F4 progress: uses the real (exp−start) window, not a hardcoded 900s', () => {
  // Admin-configured window (P1-2c campaign_activation_minutes), e.g. 5 min.
  const start = 5_000;
  const exp = start + 300000; // 5-min window
  const now = start + 60000;  // 60s in -> 240s left = 80%
  const cd = campaignCountdown(exp, start, now);
  assert.equal(cd.progressPct, 80); // (240000 / 300000) * 100
  assert.equal(cd.secondsLeft, 240);
  // If it wrongly used 900000 the percentage would be 26.67 — pin it.
  assert.notEqual(cd.progressPct, Math.round((240000 / 900000) * 100));
});

test('F4 countdown: missing start falls back to 900s window (legacy local activations)', () => {
  const now = 2_000_000;
  const exp = now + 180000; // 3 min left
  const cd = campaignCountdown(exp, undefined, now);
  assert.equal(cd.isActive, true);
  assert.equal(cd.totalMs, 900000);
  assert.equal(cd.progressPct, 20); // 180000 / 900000
  assert.equal(cd.minutes, 3);
  assert.equal(cd.seconds, 0);
});

test('F4 countdown: expired campaign shows inactive, 00:00 and 0% progress', () => {
  const now = 3_000_000;
  const start = now - 900000;
  const exp = now - 5000; // 5s past expiry
  const cd = campaignCountdown(exp, start, now);
  assert.equal(cd.isActive, false);
  assert.equal(cd.timeLeftMs, 0);
  assert.equal(cd.secondsLeft, 0);
  assert.equal(cd.minutes, 0);
  assert.equal(cd.seconds, 0);
  assert.equal(cd.progressPct, 0);
  assert.equal(formatCountdown(cd.minutes, cd.seconds), '00:00');
});

test('F4 countdown: progress clamps to [0, 100] under clock skew', () => {
  const now = 4_000_000;
  // start in the future -> timeLeft > total -> would be >100% without clamp
  const start = now + 50000;
  const exp = start + 100000;
  const cd = campaignCountdown(exp, start, now);
  assert.equal(cd.isActive, true);
  assert.equal(cd.progressPct, 100); // clamped
  // secondsLeft still floors at 0 for a negative-ish remainder
  const early = campaignCountdown(exp, start, exp + 10_000);
  assert.equal(early.progressPct, 0);
});

test('F4 countdown: secondsLeft floors instead of rounding up', () => {
  const start = 1_000;
  const exp = start + 60000;
  // 999ms left -> 0s shown, never 1s
  assert.equal(campaignCountdown(exp, start, exp - 999).secondsLeft, 0);
  // 1499ms left -> 1s
  assert.equal(campaignCountdown(exp, start, exp - 1499).secondsLeft, 1);
  // 60_000ms left -> exactly 1:00
  const cd = campaignCountdown(exp, start, start);
  assert.equal(cd.minutes, 1);
  assert.equal(cd.seconds, 0);
  assert.equal(formatCountdown(cd.minutes, cd.seconds), '01:00');
});

test('F4 formatCountdown: pads both fields and rolls over minutes', () => {
  assert.equal(formatCountdown(0, 0), '00:00');
  assert.equal(formatCountdown(7, 5), '07:05');
  assert.equal(formatCountdown(12, 59), '12:59');
  assert.equal(formatCountdown(61, 30), '61:30');
});

// ── F5: cart qty stepper — quantity clamp + totals ───────────────────────────
// Logic lives in src/lib/cartMath.ts (pure helpers used by CustomerApp +
// OrderTab CartSheet).

test('F5 clampQty: never drops below 1 and applies the delta', () => {
  assert.equal(clampQty(3, +1), 4);
  assert.equal(clampQty(3, -1), 2);
  assert.equal(clampQty(1, -1), 1); // floor at 1, not 0
  assert.equal(clampQty(1, -5), 1);
  assert.equal(clampQty(0, +1), 2); // 0 treated as 1 base + delta
});

test('F5 clampQty: accepts numeric strings and guards NaN/negatives', () => {
  assert.equal(clampQty('2', +1), 3);
  assert.equal(clampQty(undefined, +1), 2); // missing -> 1 base
  assert.equal(clampQty(null, -1), 1);
  assert.equal(clampQty('abc', +1), 2);     // NaN -> 1 base (was NaN inline)
  assert.equal(clampQty(-3, +1), 2);        // negative -> 1 base
});

test('F5 updateCartItemQty: immutable, keeps other fields, clamps qty', () => {
  const item = { id: 'm1', name: 'Latte', price: 4.5, quantity: 2 };
  const updated = updateCartItemQty(item, +1);
  assert.equal(updated.quantity, 3);
  assert.equal(updated.id, 'm1');
  assert.equal(updated.name, 'Latte');
  assert.equal(updated.price, 4.5);
  assert.equal(item.quantity, 2); // original untouched (immutability)
  // last unit stays: decrement at 1 keeps 1
  assert.equal(updateCartItemQty({ ...item, quantity: 1 }, -1).quantity, 1);
});

test('F5 cartSubtotal: price × quantity summed, empty cart is 0', () => {
  assert.equal(cartSubtotal([
    { price: 4.5, quantity: 2 },
    { price: 3, quantity: 1 },
  ]), 12); // 9 + 3
  assert.equal(cartSubtotal([]), 0);
  // string prices and quantities coerce like the old inline code
  assert.equal(cartSubtotal([{ price: '4.5', quantity: '2' }]), 9);
  // missing price/quantity fall back to 0 / 1 (was NaN inline)
  assert.equal(cartSubtotal([{ name: 'x' }]), 0);
});

test('F5 cartItemCount: sums quantities across lines', () => {
  assert.equal(cartItemCount([
    { quantity: 2 },
    { quantity: 3 },
    { quantity: 1 },
  ]), 6);
  assert.equal(cartItemCount([]), 0);
  assert.equal(cartItemCount([{ quantity: '2' }, { quantity: undefined }]), 3); // 2 + 1
});

test('F5 stepper roundtrip: decrement then increment restores quantity', () => {
  let item = { id: 'm2', price: 2.5, quantity: 4 };
  item = updateCartItemQty(item, -1);
  assert.equal(item.quantity, 3);
  item = updateCartItemQty(item, -1);
  assert.equal(item.quantity, 2);
  item = updateCartItemQty(item, +1);
  assert.equal(item.quantity, 3);
  item = updateCartItemQty(item, +1);
  assert.equal(item.quantity, 4);
  // subtotal tracks the stepper
  assert.equal(cartSubtotal([item]), 10); // 4 × 2.5
});

test('reorder: builds a cart item from history, preferring the live menu price', () => {
  const menuItem = { id: 'm9', item_name: 'Flat White', price: 6 };
  const item = buildReorderItem(
    { id: 'm9', item_name: 'Old Name', qty: 2, price: 4, variant_name: 'Large', selected_modifiers: ['+extra shot'], notes: 'no sugar' },
    menuItem,
  );
  assert.deepEqual(item, {
    id: 'm9',
    name: 'Old Name', // history name wins over menu name (as the component did)
    quantity: 2,
    price: 6, // live menu price preferred over the historical 4
    variant_name: 'Large',
    selected_modifiers: ['+extra shot'],
    notes: 'no sugar',
  });
});

test('reorder: falls back to the price at the time of order when menu is gone', () => {
  // id present but no matching menu entry — item is still reorderable with
  // the historical price (only id-less + menu-less items are rejected).
  const item = buildReorderItem({ id: 'gone-1', name: 'Seasonal Latte', qty: 1, price: 5.5 }, undefined);
  assert.equal(item.id, 'gone-1');
  assert.equal(item.name, 'Seasonal Latte');
  assert.equal(item.price, 5.5);
});

test('reorder: rejects id-less items with no menu match (no longer on the menu)', () => {
  assert.equal(buildReorderItem({ name: 'Ghost Item', qty: 1, price: 3 }, undefined), null);
  assert.equal(buildReorderItem({}, undefined), null);
});

test('reorder: quantity clamps to at least 1 and defaults safely', () => {
  const zero = buildReorderItem({ id: 'm1', qty: 0 }, { id: 'm1', price: 2 });
  assert.equal(zero.quantity, 1);
  const missing = buildReorderItem({ id: 'm1' }, { id: 'm1', price: 2 });
  assert.equal(missing.quantity, 1);
  const stringQty = buildReorderItem({ id: 'm1', qty: '3' }, { id: 'm1', price: 2 });
  assert.equal(stringQty.quantity, 3);
});

test('reorder: merge sums quantity on an identical line (same key)', () => {
  const cart = [
    { id: 'm9', name: 'Flat White', quantity: 2, price: 6, variant_name: 'Large', selected_modifiers: [], notes: '' },
  ];
  const item = { id: 'm9', name: 'Flat White', quantity: 1, price: 6, variant_name: 'Large', selected_modifiers: [], notes: '' };
  const next = mergeReorderItem(cart, item);
  assert.equal(next.length, 1);
  assert.equal(next[0].quantity, 3);
  // original cart untouched (immutable)
  assert.equal(cart[0].quantity, 2);
});

test('reorder: merge appends when variant or modifiers differ', () => {
  const cart = [
    { id: 'm9', name: 'Flat White', quantity: 2, price: 6, variant_name: 'Large', selected_modifiers: [], notes: '' },
  ];
  const diffVariant = { id: 'm9', name: 'Flat White', quantity: 1, price: 6, variant_name: 'Small', selected_modifiers: [], notes: '' };
  const diffMods = { id: 'm9', name: 'Flat White', quantity: 1, price: 6, variant_name: 'Large', selected_modifiers: ['+extra shot'], notes: '' };
  assert.equal(mergeReorderItem(cart, diffVariant).length, 2);
  assert.equal(mergeReorderItem(cart, diffMods).length, 2);
});

test('reorder: empty cart merge returns the single item', () => {
  const item = { id: 'm1', name: 'Espresso', quantity: 2, price: 3, variant_name: null, selected_modifiers: [], notes: '' };
  const next = mergeReorderItem([], item);
  assert.equal(next.length, 1);
  assert.deepEqual(next[0], item);
});

test('store selection: local session exposes a stores array with the tenant default', async () => {
  clearDBCache();
  setDB('business_profile', [
    { id: 'bp-1', tenant_id: 't1', company_name: 'BahaY Coffee', address: 'Nizami küç. 55', phone: '+994 12 555' },
  ]);
  setDB('customers', [
    {
      id: 'cust-1', tenant_id: 't1', card_id: 'QR-STORE1', secret_token: 'tok-1',
      type: 'golden', stars: 0, discount_percent: 0,
      created_at: '2026-08-16T10:00:00Z',
    },
  ]);
  const session = await get_customer_app_session_live('QR-STORE1', 'tok-1', 't1');
  assert.equal(Array.isArray(session.stores), true);
  assert.equal(session.stores.length, 1);
  assert.equal(session.stores[0].id, 't1');
  assert.equal(session.stores[0].name, 'BahaY Coffee');
  assert.equal(session.stores[0].address, 'Nizami küç. 55');
  assert.equal(session.stores[0].phone, '+994 12 555');
  assert.equal(session.stores[0].is_default, true);
  // branding also carries address/phone for the default fallback
  assert.equal(session.branding.address, 'Nizami küç. 55');
  assert.equal(session.branding.phone, '+994 12 555');
});

test('store selection: local pre-order carries the store name into the order', async () => {
  clearDBCache();
  setDB('business_profile', [
    { id: 'bp-1', tenant_id: 't1', company_name: 'BahaY Coffee', address: 'Nizami küç. 55', phone: '+994 12 555' },
  ]);
  setDB('customers', [
    {
      id: 'cust-1', tenant_id: 't1', card_id: 'QR-STORE2', secret_token: 'tok-1',
      type: 'golden', stars: 0, discount_percent: 0,
      created_at: '2026-08-16T10:00:00Z',
    },
  ]);
  const res = await create_customer_pre_order_live({
    cardId: 'QR-STORE2', token: 'tok-1', tenantId: 't1',
    storeId: 't1', storeName: 'BahaY Coffee',
    items: [{ id: 'm1', name: 'Espresso', quantity: 1, price: 3 }],
  });
  assert.equal(res.success, true);
  const orders = getDB('kitchen_orders');
  assert.equal(orders.length, 1);
  assert.equal(orders[0].table_label, 'Online Order · BahaY Coffee');
});

test('store selection: pre-order without a store falls back to plain Online Order', async () => {
  clearDBCache();
  setDB('customers', [
    {
      id: 'cust-1', tenant_id: 't1', card_id: 'QR-STORE3', secret_token: 'tok-1',
      type: 'golden', stars: 0, discount_percent: 0,
      created_at: '2026-08-16T10:00:00Z',
    },
  ]);
  const res = await create_customer_pre_order_live({
    cardId: 'QR-STORE3', token: 'tok-1', tenantId: 't1',
    items: [{ id: 'm1', name: 'Espresso', quantity: 1, price: 3 }],
  });
  assert.equal(res.success, true);
  const orders = getDB('kitchen_orders');
  assert.equal(orders[0].table_label, 'Online Order');
});

test('reorder: full reorder roundtrip — build, merge twice, verify totals', () => {
  // Same item ordered twice from history ends up as one cart line with the
  // summed quantity, and the live price is what lands in the cart.
  const menuItem = { id: 'm9', item_name: 'Flat White', price: 6 };
  const first = buildReorderItem({ id: 'm9', item_name: 'Flat White', qty: 2, price: 4 }, menuItem);
  const second = buildReorderItem({ id: 'm9', item_name: 'Flat White', qty: 1, price: 4 }, menuItem);
  let cart = mergeReorderItem([], first);
  cart = mergeReorderItem(cart, second);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 3);
  assert.equal(cart[0].price, 6);
});

test('store selection: local session exposes a stores array with the tenant default', async () => {
  clearDBCache();
  setDB('business_profile', [
    { id: 'bp-1', tenant_id: 't1', company_name: 'BahaY Coffee', address: 'Nizami küç. 55', phone: '+994 12 555' },
  ]);
  setDB('customers', [
    {
      id: 'cust-1', tenant_id: 't1', card_id: 'QR-STORE1', secret_token: 'tok-1',
      type: 'golden', stars: 0, discount_percent: 0,
      created_at: '2026-08-16T10:00:00Z',
    },
  ]);
  const session = await get_customer_app_session_live('QR-STORE1', 'tok-1', 't1');
  assert.equal(Array.isArray(session.stores), true);
  assert.equal(session.stores.length, 1);
  assert.equal(session.stores[0].id, 't1');
  assert.equal(session.stores[0].name, 'BahaY Coffee');
  assert.equal(session.stores[0].address, 'Nizami küç. 55');
  assert.equal(session.stores[0].phone, '+994 12 555');
  assert.equal(session.stores[0].is_default, true);
  assert.equal(session.branding.address, 'Nizami küç. 55');
  assert.equal(session.branding.phone, '+994 12 555');
});

test('store selection: local pre-order carries the store name into the order', async () => {
  clearDBCache();
  setDB('business_profile', [
    { id: 'bp-1', tenant_id: 't1', company_name: 'BahaY Coffee', address: 'Nizami küç. 55', phone: '+994 12 555' },
  ]);
  setDB('customers', [
    {
      id: 'cust-1', tenant_id: 't1', card_id: 'QR-STORE2', secret_token: 'tok-1',
      type: 'golden', stars: 0, discount_percent: 0,
      created_at: '2026-08-16T10:00:00Z',
    },
  ]);
  const res = await create_customer_pre_order_live({
    cardId: 'QR-STORE2', token: 'tok-1', tenantId: 't1',
    storeId: 't1', storeName: 'BahaY Coffee',
    items: [{ id: 'm1', name: 'Espresso', quantity: 1, price: 3 }],
  });
  assert.equal(res.success, true);
  const orders = getDB('kitchen_orders');
  assert.equal(orders.length, 1);
  assert.equal(orders[0].table_label, 'Online Order · BahaY Coffee');
});

test('store selection: pre-order without a store falls back to plain Online Order', async () => {
  clearDBCache();
  setDB('customers', [
    {
      id: 'cust-1', tenant_id: 't1', card_id: 'QR-STORE3', secret_token: 'tok-1',
      type: 'golden', stars: 0, discount_percent: 0,
      created_at: '2026-08-16T10:00:00Z',
    },
  ]);
  const res = await create_customer_pre_order_live({
    cardId: 'QR-STORE3', token: 'tok-1', tenantId: 't1',
    items: [{ id: 'm1', name: 'Espresso', quantity: 1, price: 3 }],
  });
  assert.equal(res.success, true);
  const orders = getDB('kitchen_orders');
  assert.equal(orders[0].table_label, 'Online Order');
});

test('order status: get_customer_orders_live returns table_label for store-aware orders', async () => {
  clearDBCache();
  setDB('customers', [
    {
      id: 'cust-1', tenant_id: 't1', card_id: 'QR-ORDER1', secret_token: 'tok-1',
      type: 'golden', stars: 0, discount_percent: 0,
      created_at: '2026-08-16T10:00:00Z',
    },
  ]);
  // Pre-order with store name → table_label = 'Online Order · BahaY Coffee'
  await create_customer_pre_order_live({
    cardId: 'QR-ORDER1', token: 'tok-1', tenantId: 't1',
    storeId: 't1', storeName: 'BahaY Coffee',
    items: [{ id: 'm1', name: 'Espresso', quantity: 1, price: 3 }],
  });
  const orders = await get_customer_orders_live('QR-ORDER1', 'tok-1', 't1');
  assert.equal(orders.length, 1);
  assert.equal(orders[0].table_label, 'Online Order · BahaY Coffee');
});

test('haversine: same point is 0 km, central Baku pair is 1.5-4 km', () => {
  assert.equal(haversineKm(40.4093, 49.8671, 40.4093, 49.8671), 0);
  const d = haversineKm(40.4093, 49.8671, 40.3958, 49.8822);
  assert.ok(d > 1.5 && d < 4.0, `distance ${d} out of range`);
});

test('sortStoresByDistance: nearest first, coords-less last, input untouched', () => {
  const stores = [
    { id: 'far', name: 'Uzaq', latitude: 40.5, longitude: 49.9 },
    { id: 'near', name: 'Yaxın', latitude: 40.4093, longitude: 49.8671 },
    { id: 'nocoords', name: 'Koordinatsız' },
  ];
  const sorted = sortStoresByDistance(stores, 40.4093, 49.8671);
  assert.deepEqual(sorted.map((s) => s.id), ['near', 'far', 'nocoords']);
  assert.equal(sorted[0].distance_km, 0);
  assert.equal(sorted[2].distance_km, null);
  // original array must not be mutated (no in-place reorder)
  assert.deepEqual(stores.map((s) => s.id), ['far', 'near', 'nocoords']);
});

test('sortStoresByDistance: distance rendering values', () => {
  const sorted = sortStoresByDistance(
    [{ id: 'a', latitude: 40.4093, longitude: 49.8671 }],
    40.4093, 49.8671
  );
  assert.equal(sorted[0].distance_km, 0);
  assert.ok(Number.isFinite(sorted[0].distance_km));
});

test('sortStoresByDistance: stable for equal distances and flat fallback', () => {
  const flat = sortStoresByDistance([{ id: 'x' }, { id: 'y' }], 40.4, 49.8);
  assert.deepEqual(flat.map((s) => s.id), ['x', 'y']);
  assert.equal(flat[0].distance_km, null);
});

test('get_nearest_branches_live: offline rejects (frontend falls back to local sort)', async () => {
  // In the smoke environment the backend is disabled, so the nearest
  // endpoint throws and CustomerApp falls back to sortStoresByDistance.
  await assert.rejects(
    () => get_nearest_branches_live('t1', 40.4093, 49.8671, 20),
    /Backend aktiv deyil/
  );
});

test('local fallback session exposes stores list usable by sort helper', async () => {
  // Mimic: get_customer_app_session_live local payload shape (crm.ts ~462)
  // with two branches so ordering by distance is meaningful.
  const sessionStores = [
    { id: 't1', name: 'BahaY Coffee', address: 'Nizami 1', phone: '+99450', is_default: true },
    { id: 'b2', name: 'BahaY Mall', address: 'Ganjlik Mall', phone: '+99451', latitude: 40.4093, longitude: 49.8671 },
  ];
  const sorted = sortStoresByDistance(sessionStores, 40.4093, 49.8671);
  assert.equal(sorted.length, 2);
  // branch with coords (b2) now first; coord-less default stays last
  assert.equal(sorted[0].id, 'b2');
  assert.equal(sorted[0].distance_km, 0);
  assert.equal(sorted[1].id, 't1');
  assert.equal(sorted[1].distance_km, null);
});

test('local fallback session store without coords stays last even when default', () => {
  const stores = [
    { id: 'far', latitude: 40.5, longitude: 49.9 },
    { id: 'defaultNoCoords', is_default: true },
  ];
  const sorted = sortStoresByDistance(stores, 40.4093, 49.8671);
  assert.deepEqual(sorted.map((s) => s.id), ['far', 'defaultNoCoords']);
});

test('readCustomerSessionCache roundtrip keeps stores array for offline retry', () => {
  writeCustomerSessionCache('QR-X', 'tok', { stores: [{ id: 's1', name: 'X' }] });
  const cached = readCustomerSessionCache('QR-X', 'tok');
  assert.ok(cached && Array.isArray(cached.session.stores));
  assert.equal(cached.session.stores.length, 1);
  assert.equal(cached.session.stores[0].id, 's1');
  clearCustomerSessionCache('QR-X', 'tok');
});
