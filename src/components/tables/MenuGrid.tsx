import React, { memo } from 'react';
import { tx } from '../../i18n';

type MenuGridProps = {
  items: any[];
  categories: string[];
  search: string;
  selectedCategory: string;
  lang: string;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSelectItem: (item: any) => void;
};

const tapFeedback = () => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(8);
  } catch {
    // ignore
  }
};

function MenuGrid({
  items,
  categories,
  search,
  selectedCategory,
  lang,
  onSearchChange,
  onCategoryChange,
  onSelectItem,
}: MenuGridProps) {
  return (
    <div className="space-y-3">
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
      <div className="grid max-h-[48vh] grid-cols-2 gap-3 overflow-auto rounded-xl border border-slate-700/70 bg-slate-950/25 p-3 xl:grid-cols-3">
        {items.map((item: any) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              tapFeedback();
              onSelectItem(item);
            }}
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

export default memo(MenuGrid);
