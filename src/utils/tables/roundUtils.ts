/**
 * Pure utility functions for round/menu draft operations.
 * No React, no side effects — fully unit-testable.
 */

export interface MenuItem {
  id: string;
  item_name: string;
  price: string | number;
  category?: string;
  description?: string;
  is_coffee?: boolean;
  [key: string]: any;
}

export interface DraftItem {
  id: string;
  item_name: string;
  price: string | number;
  qty: number;
  category?: string;
  is_coffee?: boolean;
  note?: string;
  [key: string]: any;
}

/**
 * Filters menu items by category and search text.
 */
export function filterMenuByCategory(
  menuCatalog: MenuItem[],
  category: string,
  search: string,
): MenuItem[] {
  return menuCatalog.filter((item) => {
    const categoryOk = category === 'ALL' || String(item.category || '') === category;
    const hay = `${String(item.item_name || '')} ${String(item.description || '')} ${String(item.category || '')}`.toLowerCase();
    const searchOk = !search.trim() || hay.includes(search.trim().toLowerCase());
    return categoryOk && searchOk;
  });
}

/**
 * Extracts unique category list from menu items.
 */
export function extractCategories(menuCatalog: MenuItem[]): string[] {
  return ['ALL', ...Array.from(new Set(menuCatalog.map((row) => String(row.category || '').trim()).filter(Boolean)))];
}

/**
 * Calculates total for draft items as a formatted string.
 */
export function calculateDraftTotal(draftRows: DraftItem[]): string {
  let total = 0;
  for (const row of draftRows) {
    total += Number(row.price || 0) * Number(row.qty || 0);
  }
  return total.toFixed(2);
}

/**
 * Computes the number of items ready to be counted by label in kitchen orders.
 */
export function computeReadyCountsByLabel(kitchenOrders: any[]): Record<string, number> {
  const counts: Record<string, number> = {};
  kitchenOrders.forEach((row: any) => {
    if (String(row.status || '').toUpperCase() !== 'READY') return;
    const label = String(row.table_label || '').trim();
    if (!label) return;
    const qty = Array.isArray(row.items)
      ? row.items.filter((item: any) => String(item.action || '').toUpperCase() !== 'CANCEL').length
      : 0;
    counts[label] = Number(counts[label] || 0) + qty;
  });
  return counts;
}
