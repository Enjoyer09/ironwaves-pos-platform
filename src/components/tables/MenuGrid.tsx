import React, { memo, useMemo, useState } from 'react';
import { tx } from '../../i18n';

type MenuGridProps = {
  items: any[];
  categories: string[];
  search: string;
  selectedCategory: string;
  lang: string;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSelectItem: (item: any) => void | Promise<void>;
  draftItems?: Array<{ menu_item_id?: string; id?: string; qty?: number }>;
  modernMode?: boolean;
};

const SIZE_TOKENS = ['XS', 'S', 'M', 'L', 'XL', 'DOUBLE', 'SINGLE'];

function splitVariantName(name: string) {
  const trimmed = (name || '').trim();
  const parts = trimmed.split(/\s+/);
  const last = (parts[parts.length - 1] || '').toUpperCase();
  if (SIZE_TOKENS.includes(last) && parts.length > 1) {
    return { base: parts.slice(0, -1).join(' '), variant: parts[parts.length - 1] };
  }
  return { base: trimmed, variant: null as string | null };
}

const tapFeedback = () => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(8);
  } catch {
    // ignore
  }
};

// BahaY: detect super lab for new UI (module-level fallback, overridden by prop)
const isBahaYLabDefault = (() => {
  try {
    return String(window.location.hostname || '').toLowerCase() === 'super.ironwaves.store';
  } catch { return false; }
})();

function resolveItemImage(item: any): string {
  const candidates = [item?.image_url, item?.image, item?.photo_url, item?.thumbnail];
  const picked = candidates.find((v) => typeof v === 'string' && v.trim().length > 0);
  return picked ? String(picked).trim() : '';
}

function MenuGrid({
  items,
  categories,
  search,
  selectedCategory,
  lang,
  onSearchChange,
  onCategoryChange,
  onSelectItem,
  draftItems,
  modernMode,
}: MenuGridProps) {
  const isBahaYLab = modernMode ?? isBahaYLabDefault;
  // Count how many times each item is in draft
  const draftQtyMap = new Map<string, number>();
  if (draftItems) {
    draftItems.forEach((d) => {
      const key = d.menu_item_id || d.id || '';
      if (key) draftQtyMap.set(key, (draftQtyMap.get(key) || 0) + (d.qty || 1));
    });
  }

  if (!isBahaYLab) {
    // Legacy UI for other tenants
    return (
      <div className="flex min-h-0 flex-1 flex-col space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            className="neon-input"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={tx(lang, 'Məhsul axtar...', 'Поиск товара...', 'Search item...')}
          />
          <select className="neon-input min-w-[180px]" value={selectedCategory} onChange={(e) => onCategoryChange(e.target.value)}>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category === 'ALL' ? tx(lang, 'Bütün kateqoriyalar', 'Все категории', 'All categories') : category}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-h-[220px] flex-1 grid-cols-2 gap-3 overflow-y-auto overscroll-y-contain rounded-xl border border-slate-700/70 bg-slate-950/25 p-3 xl:grid-cols-3">
          {items.map((item: any) => (
            <button
              key={item.id}
              type="button"
              onClick={() => { tapFeedback(); void onSelectItem(item); }}
              className="min-h-[108px] rounded-2xl border border-slate-700/60 bg-slate-900/55 p-4 text-left transition hover:border-yellow-300/30 hover:bg-slate-900/80 active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="line-clamp-2 text-base font-bold text-slate-100">{item.item_name}</div>
                  <div className="mt-2 text-xs text-slate-400">{item.category}</div>
                </div>
                <div className="rounded-xl bg-yellow-400/15 px-3 py-2 text-base font-black text-yellow-200">
                  {Number(item.price || 0).toFixed(2)} ₼
                </div>
              </div>
            </button>
          ))}
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700/60 px-4 py-6 text-center text-sm text-slate-400 md:col-span-2 xl:col-span-3">
              {tx(lang, 'Bu filtrlə məhsul tapılmadı', 'По этому фильтру товары не найдены', 'No items found for this filter')}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ─── BahaY: Aelia-style menu grid with variant grouping ─────────────────────
  const [sizePickerGroup, setSizePickerGroup] = useState<string | null>(null);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, any[]>();
    items.forEach((item: any) => {
      const { base } = splitVariantName(item.item_name);
      const key = (base || item.item_name || '').toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });
    return Array.from(groups.entries()).map(([key, groupItems]) => {
      const first = groupItems[0];
      const { base } = splitVariantName(first.item_name);
      return {
        key,
        base: base || first.item_name,
        items: groupItems,
        hasVariants: groupItems.length > 1,
        minPrice: Math.min(...groupItems.map((i: any) => Number(i.price || 0))),
        image_url: resolveItemImage(first),
      };
    });
  }, [items]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Search */}
      <input
        className="neon-input w-full"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={tx(lang, 'Məhsul axtar...', 'Поиск товара...', 'Search item...')}
      />

      {/* Category tabs - horizontal scroll, touch-friendly */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => onCategoryChange(cat)}
            className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold transition ${
              selectedCategory === cat
                ? 'bg-yellow-400 text-slate-900 shadow-lg shadow-yellow-400/20'
                : 'border border-slate-600/60 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60'
            }`}
          >
            {cat === 'ALL' ? tx(lang, 'Hamısı', 'Все', 'All') : cat}
          </button>
        ))}
      </div>

      {/* Product grid - grouped by variant */}
      <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-3 gap-2 overflow-y-auto overscroll-y-contain rounded-2xl border border-slate-700/50 bg-slate-950/30 p-2 md:grid-cols-4 xl:grid-cols-5">
        {groupedItems.map((group) => {
          const totalQtyInDraft = group.items.reduce((sum: number, it: any) => sum + (draftQtyMap.get(it.id) || 0), 0);
          const isPickerOpen = sizePickerGroup === group.key;
          return (
            <div key={group.key} className="relative">
              <button
                type="button"
                onClick={() => {
                  tapFeedback();
                  if (group.hasVariants) {
                    setSizePickerGroup(isPickerOpen ? null : group.key);
                  } else {
                    void onSelectItem(group.items[0]);
                  }
                }}
                className={`relative flex w-full flex-col overflow-hidden rounded-xl border transition active:scale-[0.97] ${
                  totalQtyInDraft > 0
                    ? 'border-yellow-400/60 bg-slate-900/80 shadow-lg shadow-yellow-400/10'
                    : 'border-slate-700/50 bg-slate-900/50 hover:border-yellow-300/30 hover:bg-slate-900/70'
                }`}
              >
                {group.image_url ? (
                  <div className="aspect-[3/2] w-full overflow-hidden bg-slate-800">
                    <img src={group.image_url} alt={group.base} className="h-full w-full object-cover" loading="lazy" />
                  </div>
                ) : (
                  <div className="flex h-12 w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                    <span className="text-lg font-black text-slate-600">
                      {String(group.base || '').slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex flex-1 flex-col justify-between p-2">
                  <div className="line-clamp-2 text-xs font-bold leading-tight text-slate-100">
                    {group.base}
                  </div>
                  <div className="mt-1 text-sm font-black text-yellow-300">
                    {group.minPrice.toFixed(2)} ₼
                    {group.hasVariants && <span className="ml-1 text-[10px] font-medium text-slate-400">({group.items.length})</span>}
                  </div>
                </div>
                {totalQtyInDraft > 0 && (
                  <div className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400 text-xs font-black text-slate-900 shadow-lg">
                    {totalQtyInDraft}
                  </div>
                )}
              </button>

              {/* Inline size picker */}
              {isPickerOpen && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-yellow-400/40 bg-slate-900 p-2 shadow-xl">
                  {group.items.map((item: any) => {
                    const { variant } = splitVariantName(item.item_name);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => { tapFeedback(); void onSelectItem(item); setSizePickerGroup(null); }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition hover:bg-slate-800 active:scale-[0.97]"
                      >
                        <span className="text-xs font-bold text-slate-100">{variant || item.item_name}</span>
                        <span className="text-xs font-black text-yellow-300">{Number(item.price || 0).toFixed(2)} ₼</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {groupedItems.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-700/60 px-4 py-8 text-center text-sm text-slate-400">
            {tx(lang, 'Bu filtrlə məhsul tapılmadı', 'По этому фильтру товары не найдены', 'No items found for this filter')}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MenuGrid);
