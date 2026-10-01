// Pure money helpers for AP bills (decimal.js only; money travels as 2-decimal strings, never floats).
import { Decimal } from 'decimal.js';

export type AmountCheck = 'ok' | 'invalid' | 'too_many_decimals';
export type PaymentCheck = AmountCheck | 'exceeds_open';

const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const SUB_CENT_RE = /^\d+\.\d{3,}$/;

function normalise(input: string | null | undefined): string {
  return String(input ?? '').trim().replace(',', '.');
}

function toDecimal(value: string | number | null | undefined): Decimal {
  try {
    const d = new Decimal(value === null || value === undefined || value === '' ? 0 : value);
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/** Exact sum of money values as a 2-decimal string (empty/invalid values count as 0). */
export function sumMoney(values: ReadonlyArray<string | number | null | undefined>): string {
  return values.reduce<Decimal>((sum, v) => sum.plus(toDecimal(v)), new Decimal(0)).toFixed(2);
}

/** User input ("5", "1,5", "100.05") → "5.00" / "1.50" / "100.05"; null for anything else (incl. sub-cent). */
export function toMoneyString(input: string | null | undefined): string | null {
  const text = normalise(input);
  if (!MONEY_RE.test(text)) return null;
  return new Decimal(text).toFixed(2);
}

/** A positive amount with at most 2 decimals. */
export function validateAmount(input: string | null | undefined): AmountCheck {
  const text = normalise(input);
  if (SUB_CENT_RE.test(text)) return 'too_many_decimals';
  const value = toMoneyString(text);
  if (value === null || new Decimal(value).lte(0)) return 'invalid';
  return 'ok';
}

/** Like validateAmount, and the amount may not exceed the bill's open balance (overpayments are rejected). */
export function validatePayment(amount: string | null | undefined, open: string | null | undefined): PaymentCheck {
  const check = validateAmount(amount);
  if (check !== 'ok') return check;
  if (new Decimal(toMoneyString(amount) as string).gt(toDecimal(open))) return 'exceeds_open';
  return 'ok';
}

/** One key per open dialog, so double clicks and retries replay instead of posting twice. */
export function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `k_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
