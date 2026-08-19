// One-tap reorder (Starbucks-style, HomeTab "Sizin üçün"/"Sevimlilər"), extracted
// into pure helpers so the cart merge, price fallback, and "no longer on the
// menu" rejection can be unit-tested like campaignTimer.ts / cartMath.ts.
//
// Behavior mirrors what CustomerApp.handleReorderItem previously did inline:
//   - an item without an id AND without a matching menu entry is rejected
//     (shows "This item is no longer on the menu" in the UI)
//   - the live menu price is preferred; the price at the time of the order
//     is the fallback
//   - merging keys on id + variant + modifiers (same key the add-to-cart
//     flow uses), summing quantities on a match

export type HistoryItem = {
  id?: string | number | null;
  item_name?: string;
  name?: string;
  qty?: number | string;
  price?: number | string;
  variant_name?: string | null;
  selected_modifiers?: unknown;
  notes?: string;
};

export type MenuItemLike = {
  id?: string | number;
  item_name?: string;
  price?: number | string;
};

export type ReorderCartItem = {
  id: string | number;
  name: string;
  quantity: number;
  price: number;
  variant_name: string | null;
  selected_modifiers: unknown;
  notes: string;
};

// Build the cart item from a history payload. Returns null when the item is
// neither identifiable by id nor present in the live menu — the caller then
// shows the "no longer on the menu" rejection.
export function buildReorderItem(
  historyItem: HistoryItem,
  menuItem?: MenuItemLike,
): ReorderCartItem | null {
  if (!historyItem.id && !menuItem) return null;
  const name = historyItem.item_name || historyItem.name || menuItem?.item_name || '';
  return {
    id: historyItem.id || menuItem?.id || '',
    name,
    quantity: Math.max(1, Number(historyItem.qty || 1)),
    // Prefer the live menu price; fall back to the price at the time of order.
    price: menuItem ? Number(menuItem.price ?? 0) : Number(historyItem.price ?? 0),
    variant_name: historyItem.variant_name ?? null,
    selected_modifiers: historyItem.selected_modifiers || [],
    notes: historyItem.notes || '',
  };
}

// Merge a reorder item into the cart, keyed on id + variant + modifiers.
// Immutable: returns a new array, summing quantity on an existing line.
export function mergeReorderItem(
  cart: ReorderCartItem[],
  item: ReorderCartItem,
): ReorderCartItem[] {
  const existingIdx = cart.findIndex(
    (c) =>
      c.id === item.id &&
      c.variant_name === item.variant_name &&
      JSON.stringify(c.selected_modifiers) === JSON.stringify(item.selected_modifiers),
  );
  if (existingIdx > -1) {
    const next = [...cart];
    next[existingIdx] = {
      ...next[existingIdx],
      quantity: next[existingIdx].quantity + item.quantity,
    };
    return next;
  }
  return [...cart, item];
}
