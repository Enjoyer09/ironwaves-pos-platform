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
import { get_customer_orders_live, create_customer_pre_order_live } from '../src/api/crm';

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
