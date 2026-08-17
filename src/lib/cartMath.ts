// Cart math (F5 qty stepper), extracted into pure helpers so the quantity
// clamp and total calculations can be unit-tested like campaignTimer.ts.
//
// Behavior mirrors what CustomerApp/OrderTab previously computed inline:
//   - quantity never drops below 1 (stepper delta is clamped)
//   - subtotal = sum(price × quantity), item count = sum(quantity)
// One hardening vs the old inline code: non-numeric/negative quantities and
// prices fall back to 1 / 0 instead of producing NaN.

export type CartItem = {
  quantity?: number | string;
  price?: number | string;
  [key: string]: unknown;
};

// Clamp a quantity after applying a stepper delta. Minimum is 1 (removing the
// last unit is done via the delete button, not the stepper).
export function clampQty(qty: unknown, delta: number): number {
  const base = Number(qty);
  const safe = Number.isFinite(base) && base > 0 ? base : 1;
  return Math.max(1, safe + delta);
}

// Immutable quantity update for a single cart line (used by the +/− stepper).
export function updateCartItemQty(item: CartItem, delta: number): CartItem {
  return { ...item, quantity: clampQty(item.quantity, delta) };
}

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0,
  );
}

export function cartItemCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
}
