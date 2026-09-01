import React, { memo, useMemo, useState, useRef } from 'react';
import { tx } from '../../i18n';
import { isPromoEligibleItem } from '../../api/pos';
import { playHapticTouch, playHapticHeavy, playHapticSuccess } from '../../lib/haptics';

type MenuGridProps = {
  items: any[];
  categories: string[];
  search: string;
  selectedCategory: string;
  lang: string;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSelectItem: (item: any, quantity?: number) => void | Promise<void>;
  draftItems?: Array<{ menu_item_id?: string; id?: string; qty?: number; item_name?: string; category?: string }>;
  modernMode?: boolean;
  summerPromoEnabled?: boolean;
  onLangChange?: (newLang: string) => void;
};

export type DietaryType = 'ALL' | 'HALAL' | 'SPICY' | 'VEGAN' | 'GLUTEN_FREE';

export function getItemDietaryInfo(item: any) {
  const name = String(item.item_name || '').toLowerCase();
  const desc = String(item.description || '').toLowerCase();
  const cat = String(item.category || '').toLowerCase();
  const combined = `${name} ${desc} ${cat}`;

  const isSpicy = Boolean(
    item.is_spicy ||
    item.spice_level > 0 ||
    combined.includes('acı') ||
    combined.includes('spicy') ||
    combined.includes('chili') ||
    combined.includes('jalapeno') ||
    combined.includes('istiot')
  );

  const isVegan = Boolean(
    item.is_vegan ||
    item.is_vegetarian ||
    cat.includes('salat') ||
    cat.includes('salad') ||
    combined.includes('vegan') ||
    combined.includes('vegetarian') ||
    combined.includes('tərəvəz') ||
    combined.includes('meyvə')
  );

  const isHalal = item.is_halal !== false && !combined.includes('donuz') && !combined.includes('pork') && !combined.includes('bacon');

  const isGlutenFree = Boolean(
    item.is_gluten_free ||
    cat.includes('salat') ||
    cat.includes('şorba') ||
    cat.includes('içki') ||
    combined.includes('glutensiz') ||
    combined.includes('gluten-free')
  );

  return { isSpicy, isVegan, isHalal, isGlutenFree };
}

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

function getCategoryMeta(cat: string, lang: string) {
  const lower = (cat || '').toLowerCase();
  if (cat === 'ALL') {
    return {
      icon: '🍽️',
      label: tx(lang, 'Hamısı', 'Все', 'All'),
      bgActive: 'bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 shadow-lg shadow-amber-500/25',
      bgNormal: 'border-slate-700/70 bg-slate-900/80 text-slate-200 hover:border-slate-600',
      dotColor: 'bg-amber-400',
    };
  }
  if (lower.includes('kofe') || lower.includes('coffee') || lower.includes('isti') || lower.includes('çay') || lower.includes('tea') || lower.includes('hot')) {
    return {
      icon: '☕',
      label: cat,
      bgActive: 'bg-gradient-to-r from-amber-600 to-amber-700 text-white shadow-lg shadow-amber-600/30',
      bgNormal: 'border-amber-800/40 bg-amber-950/30 text-amber-200 hover:border-amber-700/60',
      dotColor: 'bg-amber-400',
    };
  }
  if (lower.includes('soyuq') || lower.includes('cold') || lower.includes('içki') || lower.includes('drink') || lower.includes('limonad') || lower.includes('juice') || lower.includes('kokteyl') || lower.includes('beverage')) {
    return {
      icon: '🍹',
      label: cat,
      bgActive: 'bg-gradient-to-r from-pink-600 to-rose-600 text-white shadow-lg shadow-pink-600/30',
      bgNormal: 'border-pink-800/40 bg-pink-950/30 text-pink-200 hover:border-pink-700/60',
      dotColor: 'bg-pink-400',
    };
  }
  if (lower.includes('şirniyyat') || lower.includes('desert') || lower.includes('tort') || lower.includes('cake') || lower.includes('dessert') || lower.includes('sweet') || lower.includes('dondurma')) {
    return {
      icon: '🍰',
      label: cat,
      bgActive: 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30',
      bgNormal: 'border-blue-800/40 bg-blue-950/30 text-blue-200 hover:border-blue-700/60',
      dotColor: 'bg-blue-400',
    };
  }
  if (lower.includes('pizza') || lower.includes('pide') || lower.includes('pizzas')) {
    return {
      icon: '🍕',
      label: cat,
      bgActive: 'bg-gradient-to-r from-emerald-600 to-green-700 text-white shadow-lg shadow-emerald-600/30',
      bgNormal: 'border-emerald-800/40 bg-emerald-950/30 text-emerald-200 hover:border-emerald-700/60',
      dotColor: 'bg-emerald-400',
    };
  }
  if (lower.includes('burger') || lower.includes('dönər') || lower.includes('kabab') || lower.includes('ət') || lower.includes('meat') || lower.includes('food') || lower.includes('əsas') || lower.includes('main')) {
    return {
      icon: '🥩',
      label: cat,
      bgActive: 'bg-gradient-to-r from-purple-600 to-indigo-700 text-white shadow-lg shadow-purple-600/30',
      bgNormal: 'border-purple-800/40 bg-purple-950/30 text-purple-200 hover:border-purple-700/60',
      dotColor: 'bg-purple-400',
    };
  }
  if (lower.includes('salat') || lower.includes('salad') || lower.includes('fit') || lower.includes('diet')) {
    return {
      icon: '🥗',
      label: cat,
      bgActive: 'bg-gradient-to-r from-teal-600 to-cyan-700 text-white shadow-lg shadow-teal-600/30',
      bgNormal: 'border-teal-800/40 bg-teal-950/30 text-teal-200 hover:border-teal-700/60',
      dotColor: 'bg-teal-400',
    };
  }
  if (lower.includes('qəlyanaltı') || lower.includes('snack') || lower.includes('starters') || lower.includes('başlanğıc') || lower.includes('fries') || lower.includes('kartof') || lower.includes('nugget')) {
    return {
      icon: '🍟',
      label: cat,
      bgActive: 'bg-gradient-to-r from-rose-600 to-red-700 text-white shadow-lg shadow-rose-600/30',
      bgNormal: 'border-rose-800/40 bg-rose-950/30 text-rose-200 hover:border-rose-700/60',
      dotColor: 'bg-rose-400',
    };
  }
  if (lower.includes('şorba') || lower.includes('soup')) {
    return {
      icon: '🥣',
      label: cat,
      bgActive: 'bg-gradient-to-r from-yellow-600 to-amber-700 text-white shadow-lg shadow-yellow-600/30',
      bgNormal: 'border-yellow-800/40 bg-yellow-950/30 text-yellow-200 hover:border-yellow-700/60',
      dotColor: 'bg-yellow-400',
    };
  }
  if (lower.includes('qəlyan') || lower.includes('hookah') || lower.includes('shisha')) {
    return {
      icon: '💨',
      label: cat,
      bgActive: 'bg-gradient-to-r from-slate-600 to-slate-700 text-white shadow-lg shadow-slate-600/30',
      bgNormal: 'border-slate-700/40 bg-slate-900/40 text-slate-300 hover:border-slate-600',
      dotColor: 'bg-slate-400',
    };
  }
  return {
    icon: '🍴',
    label: cat,
    bgActive: 'bg-gradient-to-r from-amber-500 to-yellow-600 text-slate-950 shadow-lg shadow-amber-500/25',
    bgNormal: 'border-slate-700/70 bg-slate-900/80 text-slate-200 hover:border-slate-600',
    dotColor: 'bg-amber-400',
  };
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
  onLangChange,
}: MenuGridProps) {
  const isBahaYLab = modernMode ?? isBahaYLabDefault;
  const [hideImages, setHideImages] = useState(() => {
    // BahaY mode: always show images by default
    if (isBahaYLab) return false;
    const stored = localStorage.getItem('pos_hide_images');
    if (stored !== null) return stored === 'true';
    const isTouchDevice = typeof window !== 'undefined' &&
      window.matchMedia?.('(pointer: coarse)').matches;
    return !isTouchDevice;
  });
  const [dietaryFilter, setDietaryFilter] = useState<DietaryType>('ALL');
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [longPressItem, setLongPressItem] = useState<any>(null);
  const [customQtyText, setCustomQtyText] = useState('');
  const pressTimer = useRef<number | null>(null);

  // Swipe detection for categories
  const swipeStartX = useRef<number>(0);
  const swipeStartY = useRef<number>(0);

  const handleTouchStart = (item: any) => {
    pressTimer.current = window.setTimeout(() => {
      playHapticHeavy();
      setLongPressItem(item);
      setCustomQtyText('');
    }, 380);
  };

  const handleTouchEnd = () => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handleSwipeStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      swipeStartX.current = touch.clientX;
      swipeStartY.current = touch.clientY;
    }
  };

  const handleSwipeEnd = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    const diffX = touch.clientX - swipeStartX.current;
    const diffY = touch.clientY - swipeStartY.current;

    // Only switch categories on a clear, deliberate horizontal flick (not vertical scrolling)
    if (Math.abs(diffX) > 80 && Math.abs(diffX) > Math.abs(diffY) * 2.5 && Math.abs(diffY) < 35) {
      const idx = categories.indexOf(selectedCategory);
      if (idx !== -1) {
        if (diffX < 0) {
          const nextIdx = (idx + 1) % categories.length;
          playHapticTouch();
          onCategoryChange(categories[nextIdx]!);
        } else {
          const prevIdx = (idx - 1 + categories.length) % categories.length;
          playHapticTouch();
          onCategoryChange(categories[prevIdx]!);
        }
      }
    }
  };

  // Count how many times each item is in draft
  const draftQtyMap = new Map<string, number>();
  if (draftItems) {
    draftItems.forEach((d) => {
      const key = d.menu_item_id || d.id || '';
      if (key) draftQtyMap.set(key, (draftQtyMap.get(key) || 0) + (d.qty || 1));
    });
  }

  const toggleImageVisibility = () => {
    tapFeedback();
    const next = !hideImages;
    setHideImages(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('pos_hide_images', String(next));
    }
  };

  // AI Pairing Engine based on current cart
  const aiPairingSuggestions = useMemo(() => {
    const pairings: Array<{ triggerItem: string; suggestedItem: any; reason: string }> = [];
    if (!draftItems || draftItems.length === 0) {
      // Suggest top specials when cart is empty
      const specials = items.filter((i: any) => i.is_popular || i.is_chef_special || i.rating >= 4.5).slice(0, 4);
      return specials.map((sp: any) => ({
        triggerItem: '✨ Şefin Tövsiyəsi',
        suggestedItem: sp,
        reason: tx(lang, 'Günün ən çox sifariş olunan xüsusi təamı', 'Популярное блюдо дня', "Today's top chef special recommendation"),
      }));
    }

    // Has items in draft: analyze categories
    const draftCats = draftItems.map((d: any) => (d.category || '').toLowerCase());
    const hasMeat = draftCats.some((c) => c.includes('əsas') || c.includes('kabab') || c.includes('meat') || c.includes('burger') || c.includes('dönər'));
    const hasPizza = draftCats.some((c) => c.includes('pizza') || c.includes('pide'));
    const hasDessert = draftCats.some((c) => c.includes('şirniyyat') || c.includes('desert') || c.includes('tort') || c.includes('cake') || c.includes('dessert'));
    const hasDrink = draftCats.some((c) => c.includes('içki') || c.includes('drink') || c.includes('çay') || c.includes('kofe') || c.includes('coffee'));

    if (hasMeat && !hasDrink) {
      const drink = items.find((i: any) => (i.category || '').toLowerCase().includes('içki') || (i.item_name || '').toLowerCase().includes('ayran') || (i.item_name || '').toLowerCase().includes('cola'));
      if (drink) {
        pairings.push({
          triggerItem: '🥩 Əsas Yemək',
          suggestedItem: drink,
          reason: tx(lang, 'Ət və burgerlərin yanında təravətləndirici içki ideal seçimdir', 'К мясу отлично подойдет напиток', 'Pairs perfectly with meat and burgers'),
        });
      }
    }

    if (hasPizza && !hasDrink) {
      const coldDrink = items.find((i: any) => (i.category || '').toLowerCase().includes('soyuq') || (i.item_name || '').toLowerCase().includes('cola') || (i.item_name || '').toLowerCase().includes('limonad'));
      if (coldDrink) {
        pairings.push({
          triggerItem: '🍕 Pizza & Fast Food',
          suggestedItem: coldDrink,
          reason: tx(lang, 'Buzlu limonad və ya qazlı içki pizzanın dadını tamamlayır', 'Идеально сочетается с пиццей', 'Crisp cold drink completes the pizza experience'),
        });
      }
    }

    if (hasDessert && !hasDrink) {
      const hotDrink = items.find((i: any) => (i.category || '').toLowerCase().includes('kofe') || (i.category || '').toLowerCase().includes('çay') || (i.item_name || '').toLowerCase().includes('kofe') || (i.item_name || '').toLowerCase().includes('tea'));
      if (hotDrink) {
        pairings.push({
          triggerItem: '🍰 Desert',
          suggestedItem: hotDrink,
          reason: tx(lang, 'Şirniyyatın yanında isti qəhvə və ya ətirli çay tövsiyə edilir', 'К десерту рекомендуем ароматный кофе или чай', 'Recommended with hot coffee or tea'),
        });
      }
    }

    // Default upsells if empty
    if (pairings.length === 0) {
      const dessertsOrDrinks = items.filter((i: any) => (i.category || '').toLowerCase().includes('şirniyyat') || (i.category || '').toLowerCase().includes('içki')).slice(0, 3);
      dessertsOrDrinks.forEach((it: any) => {
        pairings.push({
          triggerItem: '💡 Sifariş Yanı Təklif',
          suggestedItem: it,
          reason: tx(lang, 'Qonaqlar üçün ən sevilən əlavə təklif', 'Отличное дополнение к заказу', 'Great complement to the order'),
        });
      });
    }

    return pairings.slice(0, 4);
  }, [draftItems, items, lang]);

  if (!isBahaYLab) {
    // Legacy UI for other tenants
    return (
      <div className="flex min-h-0 flex-1 flex-col space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <input
            className="neon-input"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={tx(lang, 'Məhsul axtar...', 'Поиск товара...', 'Search item...')}
          />
          <button
            type="button"
            onClick={toggleImageVisibility}
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition active:scale-95 ${
              hideImages
                ? 'border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                : 'border-amber-300/40 bg-amber-500/10 text-amber-200'
            }`}
            title={tx(lang, 'Şəkilləri göstər/gizlə', 'Показать/скрыть фото', 'Show/hide images')}
          >
            {hideImages ? '🖼️ OFF' : '🖼️ ON'}
          </button>
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
                <div className="rounded-xl bg-yellow-400/15 px-3 py-2 text-base font-bold text-yellow-200">
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

  const filteredByDietaryItems = useMemo(() => {
    if (dietaryFilter === 'ALL') return items;
    return items.filter((item: any) => {
      const meta = getItemDietaryInfo(item);
      if (dietaryFilter === 'HALAL') return meta.isHalal;
      if (dietaryFilter === 'SPICY') return meta.isSpicy;
      if (dietaryFilter === 'VEGAN') return meta.isVegan;
      if (dietaryFilter === 'GLUTEN_FREE') return meta.isGlutenFree;
      return true;
    });
  }, [items, dietaryFilter]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, any[]>();
    filteredByDietaryItems.forEach((item: any) => {
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
        dietary: getItemDietaryInfo(first),
      };
    });
  }, [filteredByDietaryItems]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: filteredByDietaryItems.length };
    filteredByDietaryItems.forEach((it: any) => {
      const c = it.category || 'Other';
      counts[c] = (counts[c] || 0) + 1;
    });
    return counts;
  }, [filteredByDietaryItems]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2.5"
      onTouchStart={handleSwipeStart}
      onTouchEnd={handleSwipeEnd}
    >
      {/* Search, AI Button, Multilingual & Fast Toggle Bar */}
      <div className="flex gap-2 items-center">
        <input
          className="neon-input flex-1 min-w-0"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={tx(lang, 'Məhsul axtar...', 'Поиск товара...', 'Search item...')}
        />

        {/* 🤖 AI WaitAssistant Sparkle Button */}
        <button
          type="button"
          onClick={() => { playHapticSuccess(); setAiAssistantOpen(true); }}
          className="flex h-11 items-center gap-1.5 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-500/20 via-yellow-500/15 to-amber-500/20 px-3 text-xs font-bold text-amber-300 shadow-sm shadow-amber-500/10 transition active:scale-95 shrink-0 hover:border-amber-400/70"
          title={tx(lang, 'AI Ofisiant Köməkçisi və Təkliflər', 'ИИ Ассистент', 'AI WaitAssistant')}
        >
          <span className="text-sm">✨</span>
          <span className="hidden sm:inline">{tx(lang, 'AI Köməkçi', 'ИИ Советник', 'AI Waiter')}</span>
          {draftItems && draftItems.length > 0 && (
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
          )}
        </button>

        {/* 🌐 Multilingual Quick Switcher */}
        {onLangChange && (
          <div className="hidden sm:flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-900/80 border border-slate-700/60 shrink-0">
            {[
              { code: 'az', flag: '🇦🇿' },
              { code: 'en', flag: '🇬🇧' },
              { code: 'ru', flag: '🇷🇺' },
              { code: 'tr', flag: '🇹🇷' },
              { code: 'ar', flag: '🇦🇪' },
            ].map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => { playHapticTouch(); onLangChange(l.code); }}
                className={`px-1.5 py-1 rounded-lg text-xs font-bold transition active:scale-95 ${
                  lang === l.code
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={l.code.toUpperCase()}
              >
                <span>{l.flag}</span>
              </button>
            ))}
          </div>
        )}

        {/* ⚡ Fast mode toggle */}
        <button
          type="button"
          onClick={() => {
            const next = !hideImages;
            setHideImages(next);
            localStorage.setItem('pos_hide_images', String(next));
          }}
          className={`hidden sm:flex h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition shrink-0 ${
            hideImages
              ? 'border-yellow-400/50 bg-yellow-400/10 text-yellow-300'
              : 'border-slate-700/60 bg-slate-800/40 text-slate-400 hover:bg-slate-800/80'
          }`}
        >
          <span>⚡ {tx(lang, 'Sürətli', 'Быстрый', 'Fast')}</span>
        </button>
      </div>

      {/* 🏷️ Smart Dietary / Allergen Filter Bar */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none -mx-0.5 px-0.5">
        {[
          { key: 'ALL', icon: '✨', label: tx(lang, 'Hamısı', 'Все', 'All') },
          { key: 'HALAL', icon: '🥩', label: tx(lang, 'Halal', 'Халяль', 'Halal') },
          { key: 'SPICY', icon: '🌶️', label: tx(lang, 'Acılı', 'Острое', 'Spicy') },
          { key: 'VEGAN', icon: '🌿', label: tx(lang, 'Vegan', 'Веган', 'Vegan') },
          { key: 'GLUTEN_FREE', icon: '🌾', label: tx(lang, 'Glutensiz', 'Без глютена', 'Gluten-Free') },
        ].map((df) => {
          const isSelected = dietaryFilter === df.key;
          return (
            <button
              key={df.key}
              type="button"
              onClick={() => {
                playHapticTouch();
                setDietaryFilter(df.key as DietaryType);
              }}
              className={`flex items-center gap-1.5 py-1.5 px-2.5 rounded-xl text-[11px] font-bold transition taktil-target active:scale-95 border ${
                isSelected
                  ? 'bg-amber-400/20 text-amber-300 border-amber-400/60 shadow-sm shadow-amber-500/10'
                  : 'bg-slate-900/60 hover:bg-slate-800/80 text-slate-400 border-slate-800/80 backdrop-blur-md'
              }`}
            >
              <span className="text-xs">{df.icon}</span>
              <span className="whitespace-nowrap">{df.label}</span>
            </button>
          );
        })}
      </div>

      {/* Category tabs — Frosted Glass modern pill scroll */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-0.5 px-0.5">
        {categories.map((cat) => {
          const meta = getCategoryMeta(cat, lang);
          const isSelected = selectedCategory === cat;
          const count = categoryCounts[cat] ?? (cat === 'ALL' ? filteredByDietaryItems.length : 0);
          return (
            <button
              key={cat}
              type="button"
              onClick={() => {
                playHapticTouch();
                onCategoryChange(cat);
              }}
              className={`group flex shrink-0 items-center gap-2 rounded-2xl px-3.5 py-2 transition-all pos-category-btn taktil-target active:scale-95 border backdrop-blur-md ${
                isSelected
                  ? `${meta.bgActive} font-black scale-[1.02] ring-2 ring-white/30 shadow-lg`
                  : `${meta.bgNormal} font-bold`
              }`}
            >
              <span className="text-base leading-none">{meta.icon}</span>
              <span className="text-xs sm:text-sm tracking-wide whitespace-nowrap">{meta.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                isSelected ? 'bg-white/25 text-white' : 'bg-slate-800/90 text-slate-400 border border-slate-700/50'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Product grid - Frosted Glass cards with Dietary Badges */}
      <div className={`grid min-h-0 flex-1 auto-rows-max gap-2 md:gap-2.5 overflow-y-auto overscroll-y-contain rounded-2xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-xl p-2 sm:p-2.5 touch-pan-y ${
        hideImages
          ? 'grid-cols-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7'
          : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
      }`} style={{ WebkitOverflowScrolling: 'touch' }}>
        {groupedItems.map((group) => {
          const totalQtyInDraft = group.items.reduce((sum: number, it: any) => sum + (draftQtyMap.get(it.id) || 0), 0);
          const isPromo = summerPromoEnabled && group.items.some((it: any) => isPromoEligibleItem({ category: it.category || '', item_name: it.item_name }));
          const isPopular = group.items.some((it: any) => it.is_popular || it.is_chef_special || it.is_featured || (it.rating && it.rating >= 4.5));
          const { isSpicy, isVegan, isGlutenFree } = group.dietary;

          return (
            <div key={group.key} className="relative">
              <div
                className={`relative flex w-full flex-col overflow-hidden rounded-2xl transition-all duration-300 pos-product-card backdrop-blur-md ${
                  totalQtyInDraft > 0
                    ? 'ring-2 ring-yellow-400 shadow-xl shadow-yellow-400/20 scale-[1.02] card-pulsing-glow bg-slate-900/90 border border-yellow-400/50'
                    : 'bg-slate-900/70 hover:bg-slate-800/90 hover:border-amber-400/40 hover:shadow-lg hover:shadow-amber-500/10 border border-slate-800/80 hover:-translate-y-0.5'
                }`}
              >
                {/* Dietary & Promo / Popular Badges */}
                <div className="absolute left-1.5 top-1.5 z-20 flex flex-wrap gap-1 items-center pointer-events-none">
                  {isPromo && (
                    <span className="rounded bg-gradient-to-r from-amber-500 to-amber-600 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-slate-950 shadow shadow-amber-500/10 animate-pulse">
                      ⚡ {tx(lang, 'Kampaniya', 'Промо', 'Promo')}
                    </span>
                  )}
                  {isPopular && !isPromo && (
                    <span className="rounded bg-gradient-to-r from-rose-500 to-amber-500 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-white shadow shadow-rose-500/20">
                      🔥 {tx(lang, 'Populyar', 'Хит', 'Best')}
                    </span>
                  )}
                  {isSpicy && (
                    <span className="rounded bg-red-950/80 border border-red-500/40 px-1 py-0.2 text-[9px] font-black text-red-400 backdrop-blur-xs" title={tx(lang, 'Acılı', 'Острое', 'Spicy')}>
                      🌶️
                    </span>
                  )}
                  {isVegan && (
                    <span className="rounded bg-emerald-950/80 border border-emerald-500/40 px-1 py-0.2 text-[9px] font-black text-emerald-400 backdrop-blur-xs" title={tx(lang, 'Vegan', 'Веган', 'Vegan')}>
                      🌿
                    </span>
                  )}
                  {isGlutenFree && (
                    <span className="rounded bg-amber-950/80 border border-amber-500/40 px-1 py-0.2 text-[9px] font-black text-amber-400 backdrop-blur-xs" title={tx(lang, 'Glutensiz', 'Без глютена', 'Gluten-Free')}>
                      🌾
                    </span>
                  )}
                </div>

                {/* Top-Right Quick Add Cart Badge */}
                {totalQtyInDraft === 0 && isBahaYLab && (
                  <div className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs pointer-events-none backdrop-blur-xs">
                    🛒
                  </div>
                )}
                {/* Main clickable area: adds default/first variant */}
                <div
                  role="button"
                  tabIndex={0}
                  onTouchStart={() => handleTouchStart(group.items[0])}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchEnd}
                  onMouseDown={() => {
                    pressTimer.current = window.setTimeout(() => {
                      playHapticHeavy();
                      setLongPressItem(group.items[0]);
                      setCustomQtyText('');
                    }, 600);
                  }}
                  onMouseUp={handleTouchEnd}
                  onMouseLeave={handleTouchEnd}
                  onClick={() => {
                    handleTouchEnd();
                    playHapticTouch();
                    void onSelectItem(group.items[0]);
                  }}
                  onKeyDown={(e) => {
                    if (e.shiftKey && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      playHapticHeavy();
                      setLongPressItem(group.items[0]);
                      setCustomQtyText('');
                    } else if (e.key === 'Enter' || e.key === ' ') {
                      playHapticTouch();
                      void onSelectItem(group.items[0]);
                    }
                  }}
                  aria-label={`${group.base}, ${group.minPrice.toFixed(2)} AZN${group.hasVariants ? ', ' + group.items.length + ' variant' : ''}`}
                  className={`flex flex-1 flex-col cursor-pointer transition taktil-target`}
                >
                  {!hideImages ? (
                    group.image_url ? (
                      // Real image — square crop like Menulux
                      <div className="aspect-square w-full min-h-[140px] overflow-hidden bg-slate-800 relative">
                        <img src={group.image_url} alt={group.base} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" decoding="async" />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent pointer-events-none" />
                      </div>
                    ) : (
                      // No image placeholder — square, gradient bg, large initial
                      <div className="aspect-square w-full min-h-[140px] flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 border-b border-slate-800/60">
                        <span className="text-3xl font-bold text-slate-500 select-none">
                          {String(group.base || '').charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )
                  ) : null}
                  {/* Text info — centered for image mode, left for fast mode */}
                  <div className={`flex flex-col ${hideImages ? 'p-2.5 pb-3 sm:p-2 sm:pb-2.5' : 'p-2 pt-1.5'} ${!hideImages ? 'items-center text-center' : ''}`}>
                    <div className={`line-clamp-3 font-semibold leading-tight text-white ${hideImages ? 'text-sm sm:text-[11px]' : 'text-[11px] sm:text-[10px]'}`}>
                      {group.base}
                    </div>
                    <div className={`font-bold text-amber-400 ${hideImages ? 'text-xs sm:text-[10px] mt-1.5' : 'text-xs mt-1'}`}>
                      {group.minPrice.toFixed(2)} ₼
                      {group.hasVariants && <span className="ml-1 text-[9px] font-medium text-slate-400/70">({group.items.length})</span>}
                    </div>
                  </div>
                </div>

                {totalQtyInDraft > 0 && (
                  <div className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400 text-xs font-bold text-slate-900 shadow-lg pointer-events-none">
                    {totalQtyInDraft}
                  </div>
                )}

                {/* Inline variant/size selection pills */}
                {group.hasVariants ? (
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
                          className={`flex-1 min-w-[44px] min-h-[44px] rounded-xl py-2 px-1 text-[11px] font-semibold border transition taktil-target active:scale-90 ${
                            qtyInDraft > 0
                              ? 'bg-yellow-400 text-slate-950 border-yellow-400 shadow-sm shadow-yellow-400/20'
                              : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700/50'
                          }`}
                        >
                          <div className="flex flex-col items-center justify-center leading-none">
                            <span>{variant || item.item_name}</span>
                            <span className="text-[11px] font-medium opacity-85 mt-0.5">{Number(item.price || 0).toFixed(2)} ₼</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  totalQtyInDraft > 0 && (
                    <div className={`flex items-center justify-between gap-1.5 border-t border-slate-800/50 bg-slate-950/60 ${hideImages ? 'p-1' : 'p-1.5'}`}>
                      <button
                        type="button"
                        aria-label={tx(lang, 'Azalt', 'Уменьшить', 'Decrease')}
                        onClick={(e) => {
                          e.stopPropagation();
                          playHapticTouch();
                          void onSelectItem(group.items[0], -1);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-200 border border-slate-700 font-bold text-sm active:scale-90 hover:bg-slate-700"
                      >
                        −
                      </button>
                      <span className="font-extrabold text-xs text-yellow-300">
                        {totalQtyInDraft}
                      </span>
                      <button
                        type="button"
                        aria-label={tx(lang, 'Artır', 'Увеличить', 'Increase')}
                        onClick={(e) => {
                          e.stopPropagation();
                          playHapticTouch();
                          void onSelectItem(group.items[0], 1);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-400 text-slate-950 font-bold text-sm active:scale-90 shadow-sm shadow-yellow-400/20"
                      >
                        +
                      </button>
                    </div>
                  )
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

      {/* ─── 🤖 AI WaitAssistant Pairing & Upsell Drawer ─── */}
      {aiAssistantOpen && (
        <div
          className="fixed inset-0 z-[160] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-0 sm:p-4"
          onClick={() => setAiAssistantOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-[32px] sm:rounded-[32px] border border-amber-400/30 bg-[#0c121e] p-5 sm:p-6 shadow-[0_24px_60px_rgba(0,0,0,0.8)] relative max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-yellow-600 text-slate-950 font-black text-lg shadow-md shadow-amber-500/25">
                  ✨
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-100 flex items-center gap-1.5">
                    <span>{tx(lang, 'AI Ofisiant Köməkçisi', 'ИИ Ассистент Официанта', 'AI WaitAssistant')}</span>
                    <span className="rounded-full bg-amber-400/20 border border-amber-400/40 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
                      LIVE AI
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {tx(lang, 'Sifarişə uyğun ağıllı yemək/içki cütləşdirməsi (Pairing & Upsell)', 'Умные рекомендации и сочетания', 'Smart pairings & upsell recommendations')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAiAssistantOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-800/80 border border-slate-700/60 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Content list */}
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto space-y-3 pr-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400/80">
                🎯 {tx(lang, 'Qonaqlara təklif üçün AI tövsiyələri:', 'Рекомендации для гостей:', 'Recommended suggestions for guests:')}
              </div>

              {aiPairingSuggestions.map((rec, idx) => (
                <div
                  key={`ai_rec_${idx}`}
                  className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5 flex items-center justify-between gap-3 transition hover:border-amber-400/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-300">
                      <span>{rec.triggerItem}</span>
                    </div>
                    <div className="text-sm font-bold text-white mt-0.5 truncate">
                      {rec.suggestedItem.item_name}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                      {rec.reason}
                    </div>
                    <div className="text-xs font-black text-amber-400 mt-1">
                      {Number(rec.suggestedItem.price || 0).toFixed(2)} ₼
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      playHapticSuccess();
                      void onSelectItem(rec.suggestedItem, 1);
                      setAiAssistantOpen(false);
                    }}
                    className="shrink-0 flex items-center gap-1 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-2 text-xs font-black text-slate-950 shadow-md shadow-amber-500/20 active:scale-95 transition"
                  >
                    <span>+</span>
                    <span>{tx(lang, 'Əlavə et', 'Добавить', 'Add')}</span>
                  </button>
                </div>
              ))}
            </div>

            {/* Footer tips */}
            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>💡 {tx(lang, 'Müştəri məmnuniyyətini və orta çeki artırır', 'Увеличивает средний чек', 'Increases guest satisfaction & ticket size')}</span>
              <button
                type="button"
                onClick={() => setAiAssistantOpen(false)}
                className="text-amber-400 hover:underline font-semibold"
              >
                {tx(lang, 'Bağla', 'Закрыть', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Long-press Quantity Selector Popover Overlay */}
      {longPressItem && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4" onClick={() => setLongPressItem(null)}>
          <div 
            className="w-full max-w-sm p-6 rounded-[28px] border border-white/10 bg-[#0c121e] shadow-[0_24px_60px_rgba(0,0,0,0.65)] relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <h4 className="text-base font-bold text-slate-100">{longPressItem.item_name}</h4>
              <p className="mt-1 text-xs text-slate-400">{tx(lang, 'Sürətli miqdar seçin', 'Выберите количество', 'Select quantity')}</p>
            </div>
            
            {/* Presets */}
            <div className="mt-5 grid grid-cols-4 gap-2">
              {[2, 3, 5, 10].map((qty) => (
                <button
                  key={qty}
                  type="button"
                  onClick={() => {
                    playHapticSuccess();
                    void onSelectItem(longPressItem, qty);
                    setLongPressItem(null);
                  }}
                  className="flex min-h-[50px] items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-800/30 text-sm font-semibold text-slate-200 active:scale-95 active:bg-yellow-400 active:text-slate-950 transition-all"
                >
                  +{qty}
                </button>
              ))}
            </div>

            {/* Custom Input */}
            <div className="mt-5 flex gap-2">
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                className="neon-input flex-1 text-center font-bold text-lg py-2.5"
                placeholder={tx(lang, 'Digər...', 'Другое...', 'Custom...')}
                value={customQtyText}
                onChange={(e) => setCustomQtyText(e.target.value)}
              />
              <button
                type="button"
                onClick={() => {
                  const qty = parseInt(customQtyText, 10);
                  if (qty > 0) {
                    playHapticSuccess();
                    void onSelectItem(longPressItem, qty);
                    setLongPressItem(null);
                  }
                }}
                className="rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 font-black px-5 py-2.5 text-xs active:scale-95 transition"
              >
                {tx(lang, 'Əlavə et', 'Добавить', 'Add')}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setLongPressItem(null)}
              className="mt-4 w-full rounded-xl border border-slate-700/60 bg-slate-800/20 py-3.5 text-xs font-bold text-slate-300 active:bg-slate-900/50"
            >
              {tx(lang, 'İmtina', 'Отмена', 'Cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(MenuGrid);
