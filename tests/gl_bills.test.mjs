import test from 'node:test';
import assert from 'node:assert/strict';
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
