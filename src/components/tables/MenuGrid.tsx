import React, { memo, useMemo, useState } from 'react';
import { tx } from '../../i18n';
import { isPromoEligibleItem } from '../../api/pos';

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
  summerPromoEnabled?: boolean;
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
  summerPromoEnabled,
}: MenuGridProps) {
  const isBahaYLab = modernMode ?? isBahaYLabDefault;
  const [hideImages, setHideImages] = useState(() => localStorage.getItem('pos_hide_images') === 'true');
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
      {/* Search and Density Toggle */}
      <div className="flex gap-2 items-center">
        <input
          className="neon-input flex-1 min-w-0"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={tx(lang, 'Məhsul axtar...', 'Поиск товара...', 'Search item...')}
        />
        <button
          type="button"
          onClick={() => {
            const next = !hideImages;
            setHideImages(next);
            localStorage.setItem('pos_hide_images', String(next));
          }}
          className={`flex h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-black transition shrink-0 ${
            hideImages
              ? 'border-yellow-400/50 bg-yellow-400/10 text-yellow-300'
              : 'border-slate-700/60 bg-slate-800/40 text-slate-400 hover:bg-slate-800/80'
          }`}
        >
          <span>⚡ {tx(lang, 'Sürətli', 'Быстрый', 'Fast')}</span>
        </button>
      </div>

      {/* Category tabs - horizontal scroll, touch-friendly */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => onCategoryChange(cat)}
            className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold transition pos-category-btn taktil-target ${
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
      <div className={`grid min-h-0 flex-1 auto-rows-max gap-2 md:gap-2.5 overflow-y-auto overscroll-y-contain rounded-2xl border border-slate-700/50 bg-slate-950/30 p-2.5 ${
        hideImages
          ? 'grid-cols-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-7'
          : 'grid-cols-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6'
      }`}>
        {groupedItems.map((group) => {
          const totalQtyInDraft = group.items.reduce((sum: number, it: any) => sum + (draftQtyMap.get(it.id) || 0), 0);
          const isPromo = summerPromoEnabled && group.items.some((it: any) => isPromoEligibleItem({ category: it.category || '', item_name: it.item_name }));
          return (
            <div key={group.key} className="relative">
              <div
                className={`relative flex w-full flex-col overflow-hidden rounded-2xl border transition-all duration-200 pos-product-card ${
                  totalQtyInDraft > 0
                    ? 'border-yellow-400/80 bg-slate-900/75 shadow-lg shadow-yellow-400/15 scale-[1.01] card-pulsing-glow'
                    : 'border-slate-800/80 bg-slate-900/60 hover:border-yellow-400/30 hover:bg-slate-900/75 backdrop-blur-sm'
                }`}
              >
                {isPromo && (
                  <div className="absolute left-1 top-1 z-20 rounded bg-gradient-to-r from-amber-500 to-amber-600 px-1 py-0.5 text-[8px] font-black uppercase tracking-wider text-slate-950 shadow shadow-amber-500/10 animate-pulse">
                    ⚡ {tx(lang, 'Kampaniya', 'Промо', 'Promo')}
                  </div>
                )}
                {/* Main clickable area: adds default/first variant */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    tapFeedback();
                    void onSelectItem(group.items[0]);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      tapFeedback();
                      void onSelectItem(group.items[0]);
                    }
                  }}
                  className="flex flex-1 flex-col cursor-pointer transition taktil-target"
                >
                  {!hideImages && (
                    group.image_url ? (
                      <div className="aspect-[3/2] w-full overflow-hidden bg-slate-800">
                        <img src={group.image_url} alt={group.base} className="h-full w-full object-cover" loading="lazy" />
                      </div>
                    ) : (
                      <div className="flex h-12 w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
                        <span className="text-lg font-black text-slate-600">
                          {String(group.base || '').slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                    )
                  )}
                  <div className={`flex flex-1 flex-col justify-between ${hideImages ? 'p-2 pb-2.5' : 'p-2 pb-1.5'}`}>
                    <div className={`line-clamp-2 font-black leading-tight text-white ${hideImages ? 'text-[11px]' : 'text-xs'}`}>
                      {group.base}
                    </div>
                    <div className={`mt-1 font-semibold text-yellow-400/80 ${hideImages ? 'text-[10px]' : 'text-[11px]'}`}>
                      {group.minPrice.toFixed(2)} ₼
                      {group.hasVariants && <span className="ml-1 text-[9px] font-medium text-slate-400/70">({group.items.length})</span>}
                    </div>
                  </div>
                </div>

                {totalQtyInDraft > 0 && (
                  <div className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400 text-xs font-black text-slate-900 shadow-lg pointer-events-none">
                    {totalQtyInDraft}
                  </div>
                )}

                {/* Inline variant/size selection pills */}
                {group.hasVariants && (
                  <div className={`flex flex-wrap gap-1 border-t border-slate-800/40 ${hideImages ? 'p-1.5' : 'p-2 pt-0'}`}>
                    {group.items.map((item: any) => {
                      const { variant } = splitVariantName(item.item_name);
                      const qtyInDraft = draftQtyMap.get(item.id) || 0;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            tapFeedback();
                            void onSelectItem(item);
                          }}
                          className={`flex-1 min-w-[32px] min-h-[34px] rounded-lg py-1 px-0.5 text-[9.5px] font-black border transition taktil-target ${
                            qtyInDraft > 0
                              ? 'bg-yellow-400 text-slate-950 border-yellow-400 shadow-sm shadow-yellow-400/20'
                              : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700/50'
                          }`}
                        >
                          <div className="flex flex-col items-center justify-center leading-none">
                            <span>{variant || item.item_name}</span>
                            <span className="text-[7.5px] opacity-75 mt-0.5">{Number(item.price || 0).toFixed(2)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
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
