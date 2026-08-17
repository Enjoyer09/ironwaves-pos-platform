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
