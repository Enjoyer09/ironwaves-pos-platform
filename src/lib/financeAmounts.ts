import Decimal from 'decimal.js';

/** Parse untrusted form values without throwing or allowing NaN/infinity. */
export function financeAmount(value: string, allowZero = false): Decimal | null {
  try {
    if (!value.trim()) return null;
    const amount = new Decimal(value);
    return amount.isFinite() && amount.decimalPlaces() <= 2 && (allowZero ? amount.gte(0) : amount.gte(0.01)) ? amount : null;
  } catch {
    return null;
  }
}
