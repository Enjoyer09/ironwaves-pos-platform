/**
 * Pure utility functions for payment calculations.
 * No React, no side effects — fully unit-testable.
 */
import { Decimal } from 'decimal.js';
import { normalizeOrderItemStatus } from './tableUtils';

export interface SplitPart {
  amount: string;
  method: 'Nəğd' | 'Kart';
}

export interface BillBreakdown {
  itemsTotal: Decimal;
  discountPercent: Decimal;
  discountAmount: Decimal;
  discountedItemsTotal: Decimal;
  serviceFee: Decimal;
  deposit: Decimal;
  finalTotal: Decimal;
  dueNow: Decimal;
  splitBasis: Decimal;
  guestCount: number;
  depositPerGuestShare: Decimal;
}

/**
 * Builds equal split parts for a total amount.
 */
export function buildEqualSplitParts(count: number, total: Decimal): SplitPart[] {
  if (count <= 0) return [];
  const safeTotal = total.toDecimalPlaces(2);
  const base = safeTotal.div(count).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  let remainder = safeTotal.minus(base.times(count)).toDecimalPlaces(2);
  return Array.from({ length: count }, (_, idx) => {
    const extra = remainder.greaterThan(0) ? new Decimal('0.01') : new Decimal(0);
    remainder = Decimal.max(new Decimal(0), remainder.minus(extra));
    return {
      amount: base.plus(extra).toFixed(2),
      method: (idx === 0 ? 'Nəğd' : 'Kart') as 'Nəğd' | 'Kart',
    };
  });
}

/**
 * Returns the maximum number of split parts (based on guest count).
 */
export function getMaxSplitCount(table: { guest_count?: number }): number {
  return Math.max(2, Number(table?.guest_count || 2));
}

/**
 * Normalizes a split count within allowed range.
 */
export function normalizeSplitCount(table: { guest_count?: number }, requested: number | string | undefined, fallback: number | string = 2): number {
  const maxAllowed = getMaxSplitCount(table);
  const parsed = Number(requested || fallback || 2);
  return Math.min(maxAllowed, Math.max(2, Number.isFinite(parsed) ? parsed : 2));
}

/**
 * Normalizes a discount percentage (0-50, integer).
 */
export function normalizeTableDiscountPercent(value: unknown): number {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(50, Math.round(parsed)));
}

/**
 * Rebalances split parts after one part's amount is edited.
 */
export function rebalanceSplitParts(
  baseParts: SplitPart[],
  total: Decimal,
  editedIndex: number,
  editedAmountRaw: string,
): SplitPart[] {
  const parts = baseParts.map((row) => ({ ...row }));
  const safeTotal = total.toDecimalPlaces(2);
  const editedAmount = Decimal.max(new Decimal(0), new Decimal(editedAmountRaw || 0)).toDecimalPlaces(2);
  parts[editedIndex] = { ...parts[editedIndex], amount: editedAmount.toFixed(2) };
  const lockedTotal = parts
    .slice(0, editedIndex + 1)
    .reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0))
    .toDecimalPlaces(2);
  const tailCount = Math.max(0, parts.length - editedIndex - 1);
  const remaining = Decimal.max(new Decimal(0), safeTotal.minus(lockedTotal)).toDecimalPlaces(2);
  if (tailCount === 0) return parts;
  const redistributed = buildEqualSplitParts(tailCount, remaining);
  redistributed.forEach((row, idx) => {
    parts[editedIndex + 1 + idx] = { ...parts[editedIndex + 1 + idx], amount: row.amount };
  });
  return parts;
}

/**
 * Checks if an order item is billable (not voided, comped, wasted, etc.).
 */
export function isBillablePaymentItem(item: { status?: string; raw_status?: string; qty?: number; price?: number | string }): boolean {
  const status = normalizeOrderItemStatus(item?.status || (item as any)?.raw_status);
  const qty = new Decimal(item?.qty || 0);
  const price = new Decimal(item?.price || 0);
  return qty.greaterThan(0) && price.greaterThan(0) && !['VOID_REQUESTED', 'VOIDED', 'WASTE', 'REMAKE', 'COMPED'].includes(status);
}

/**
 * Calculates the full bill breakdown for a table.
 */
export function calculateBillBreakdown(params: {
  payItems: Array<{ price: number | string; qty: number }>;
  discountPercentRaw: number | string;
  serviceFeePercent: Decimal;
  depositAmount: string | number;
  guestCount: number;
}): BillBreakdown {
  const { payItems, discountPercentRaw, serviceFeePercent, depositAmount, guestCount } = params;
  const itemsTotal = payItems.reduce((acc, row) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0));
  const discountPercent = new Decimal(normalizeTableDiscountPercent(discountPercentRaw)).toDecimalPlaces(2);
  const preDiscountServiceFee = itemsTotal.times(serviceFeePercent).div(100).toDecimalPlaces(2);
  const deposit = new Decimal(depositAmount || 0);
  const preDiscountFinalTotal = Decimal.max(itemsTotal.plus(preDiscountServiceFee), deposit).toDecimalPlaces(2);
  const rawDiscountAmount = itemsTotal.times(discountPercent).div(100).toDecimalPlaces(2);
  const discountedItemsTotal = Decimal.max(new Decimal(0), itemsTotal.minus(rawDiscountAmount)).toDecimalPlaces(2);
  const serviceFee = discountedItemsTotal.times(serviceFeePercent).div(100).toDecimalPlaces(2);
  const finalTotal = Decimal.max(discountedItemsTotal.plus(serviceFee), deposit).toDecimalPlaces(2);
  const discountAmount = Decimal.max(new Decimal(0), preDiscountFinalTotal.minus(finalTotal)).toDecimalPlaces(2);
  const dueNow = Decimal.max(new Decimal(0), finalTotal.minus(deposit)).toDecimalPlaces(2);
  const splitBasis = dueNow.greaterThan(0) ? dueNow : finalTotal;
  const safeGuestCount = Math.max(1, guestCount);
  const depositPerGuestShare = safeGuestCount > 0 ? deposit.div(safeGuestCount).toDecimalPlaces(2) : new Decimal(0);
  return { itemsTotal, discountPercent, discountAmount, discountedItemsTotal, serviceFee, deposit, finalTotal, dueNow, splitBasis, guestCount: safeGuestCount, depositPerGuestShare };
}
