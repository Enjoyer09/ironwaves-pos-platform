import React from 'react';
import ReactDOM from 'react-dom';
import { ShoppingBag, ChevronLeft, X, Heart } from 'lucide-react';
import { ImpactStyle } from '@capacitor/haptics';
import { tx } from '../../i18n';
import { getProductImage, playTickSound, Haptic, nativeHapticImpact } from '../../lib/customer_utils';

// ─── ModifierSheet ─────────────────────────────────────────────────────────────
type ModifierSheetProps = {
  modifierSheetItem: any;
  setModifierSheetItem: (item: any) => void;
  selectedVariant: any;
  setSelectedVariant: (v: any) => void;
  selectedModifiers: any[];
  handleToggleModifier: (mod: { name: string; price: number }) => void;
  handleAddToCart: () => void;
  safeLang: string;
  isLight: boolean;
};

export function ModifierSheet({
  modifierSheetItem, setModifierSheetItem, selectedVariant, setSelectedVariant,
  selectedModifiers, handleToggleModifier, handleAddToCart, safeLang, isLight
}: ModifierSheetProps) {
  if (!modifierSheetItem) return null;

  const basePrice = selectedVariant ? Number(selectedVariant.price) : Number(modifierSheetItem.price || 0);
  const modifiersTotal = selectedModifiers.reduce((acc: number, m: any) => acc + m.price, 0);
  const finalPrice = basePrice + modifiersTotal;
  const hasVariants = modifierSheetItem.variants && modifierSheetItem.variants.length > 0;
  const hasModifiers = modifierSheetItem.modifiers && modifierSheetItem.modifiers.length > 0;

  const sheetBg     = isLight ? 'bg-white'                  : 'bg-[#0D0B0A]/98';
  const sheetBorder = isLight ? 'border-black/8'             : 'border-white/10';
  const textPrimary = isLight ? 'text-slate-900'             : 'text-white';
  const textSecond  = isLight ? 'text-slate-500'             : 'text-white/50';
  const chipBase    = isLight ? 'bg-black/5 border-black/10 text-slate-700' : 'bg-white/5 border-white/10 text-white/70';
  const btnBase     = isLight ? 'bg-black/5 hover:bg-black/10 border-black/8 text-slate-800' : 'bg-white/5 hover:bg-white/10 border-white/10 text-white';

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-modalFadeIn">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModifierSheetItem(null)} />
      <div className={`relative w-full max-w-sm rounded-[32px] ${sheetBg} border ${sheetBorder} shadow-2xl overflow-y-auto max-h-[85vh] p-5 animate-scaleIn`}>
        <div className="flex items-center justify-between mb-4">
          <button onClick={async () => { await Haptic.light(); setModifierSheetItem(null); }}
            className={`h-8 w-8 rounded-full flex items-center justify-center border shadow-sm active:scale-95 transition ${btnBase}`}>
            <ChevronLeft size={16} />
          </button>
          <span className={`text-[10px] font-black uppercase tracking-widest ${textSecond}`}>
            {tx(safeLang, 'Məhsul Seçimi', 'Детали', 'Product Details')}
          </span>
          <button onClick={async () => { await Haptic.light(); setModifierSheetItem(null); }}
            className={`h-8 w-8 rounded-full flex items-center justify-center border shadow-sm active:scale-95 transition ${btnBase}`}>
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-3.5 items-start mb-4">
          <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0 shadow-md">
            <img
              src={getProductImage(modifierSheetItem.item_name || modifierSheetItem.name || '', modifierSheetItem.image_url)}
              alt={modifierSheetItem.item_name || modifierSheetItem.name || ''}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h2 className={`text-base font-black ${textPrimary} leading-tight`}>
              {modifierSheetItem.item_name || modifierSheetItem.name}
            </h2>
            <p className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 ${textSecond}`}>
              {modifierSheetItem.category || 'Craft Blend'}
            </p>
            <p className={`text-lg font-black text-[#F48C24] mt-1.5`}>{finalPrice.toFixed(2)} ₼</p>
          </div>
        </div>
        {modifierSheetItem.description && (
          <p className={`text-[10px] leading-relaxed mb-4 ${textSecond}`}>{modifierSheetItem.description}</p>
        )}
        {hasVariants && (
          <div className="mb-4">
            <p className={`text-[9px] font-black uppercase tracking-widest mb-1.5 ${textSecond}`}>
              {tx(safeLang, 'Ölçü / Variant', 'Размер', 'Size / Variant')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {modifierSheetItem.variants.map((v: any) => {
                const active = selectedVariant?.name === v.name;
                return (
                  <button key={v.name} type="button" onClick={() => setSelectedVariant(active ? null : v)}
                    className={`rounded-full px-3 py-1.5 text-[10px] font-bold border transition active:scale-95 ${active ? 'bg-[#F48C24] border-[#F48C24] text-white' : chipBase}`}>
                    {v.name} · {Number(v.price || 0).toFixed(2)} ₼
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {hasModifiers && (
          <div className="mb-4">
            <p className={`text-[9px] font-black uppercase tracking-widest mb-1.5 ${textSecond}`}>
              {tx(safeLang, 'Əlavələr', 'Добавки', 'Add-ons')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {modifierSheetItem.modifiers.map((mod: any) => {
                const active = selectedModifiers.find((m: any) => m.name === mod.name);
                return (
                  <button key={mod.name} type="button" onClick={() => handleToggleModifier(mod)}
                    className={`rounded-full px-2.5 py-1.5 text-[9px] font-bold border transition active:scale-95 ${active ? 'bg-[#F48C24] border-[#F48C24] text-white' : chipBase}`}>
                    {mod.name} +{Number(mod.price || 0).toFixed(2)} ₼
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <button type="button" onClick={async () => { await Haptic.medium(); handleAddToCart(); }}
          className="mt-1 w-full rounded-xl py-3.5 text-xs font-black text-white transition-all active:scale-[0.97] shadow-lg"
          style={{ background: 'linear-gradient(135deg, #F48C24, #ffb366)' }}>
          {tx(safeLang, 'Səbətə at', 'В корзину', 'Add to Cart')} · {finalPrice.toFixed(2)} ₼
        </button>
      </div>
    </div>,
    document.body
  );
}

// ─── CartSheet ──────────────────────────────────────────────────────────────────
type CartSheetProps = {
  showCartSheet: boolean;
  setShowCartSheet: (v: boolean) => void;
  customerCart: any[];
  handleRemoveFromCart: (index: number) => void;
  orderNotes: string;
  setOrderNotes: (v: string) => void;
  handleCheckoutPreOrder: () => void;
  preOrderSubmitting: boolean;
  safeLang: string;
  isLight: boolean;
};

export function CartSheet({
  showCartSheet, setShowCartSheet, customerCart, handleRemoveFromCart,
  orderNotes, setOrderNotes, handleCheckoutPreOrder, preOrderSubmitting, safeLang, isLight
}: CartSheetProps) {
  if (!showCartSheet) return null;
  const subtotal = customerCart.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);

  const sheetBg     = isLight ? 'bg-white'                  : 'bg-[#0D0B0A]/98';
  const sheetBorder = isLight ? 'border-black/8'             : 'border-white/10';
  const textPrimary = isLight ? 'text-slate-900'             : 'text-white';
  const textSecond  = isLight ? 'text-slate-500'             : 'text-white/50';
  const itemBg      = isLight ? 'bg-black/4 border-black/8' : 'bg-white/5 border-white/5';
  const divider     = isLight ? 'border-black/8'             : 'border-white/10';
  const inputCls    = isLight
    ? 'border-black/10 bg-black/4 text-slate-900 placeholder-slate-400 focus:ring-[#F48C24]'
    : 'border-white/10 bg-white/5 text-white placeholder-white/30 focus:ring-[#F48C24]';

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-modalFadeIn">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCartSheet(false)} />
      <div className={`relative w-full max-w-sm rounded-[32px] ${sheetBg} border ${sheetBorder} shadow-2xl overflow-y-auto max-h-[85vh] p-5 flex flex-col animate-scaleIn`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-base font-black ${textPrimary}`}>{tx(safeLang, 'Səbətiniz', 'Ваша корзина', 'Your Cart')}</h2>
          <button onClick={async () => { await Haptic.light(); setShowCartSheet(false); }}
            className={`h-7 w-7 rounded-full flex items-center justify-center font-bold transition ${isLight ? 'bg-black/5 text-slate-600 hover:bg-black/10' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
            <X size={14} />
          </button>
        </div>
        <div className="space-y-2 flex-1 overflow-y-auto pr-1">
          {customerCart.length === 0 ? (
            <div className={`py-12 text-center text-xs font-bold ${textSecond}`}>
              {tx(safeLang, 'Səbətiniz boşdur', 'Ваша корзина пуста', 'Your cart is empty')}
            </div>
          ) : customerCart.map((item: any, idx: number) => (
            <div key={idx} className={`flex items-center justify-between rounded-xl ${itemBg} border p-3`}>
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-black ${textPrimary}`}>{item.name}</p>
                {item.variant_name && <p className={`text-[8px] font-semibold mt-0.5 ${textSecond}`}>{item.variant_name}</p>}
                {item.selected_modifiers?.length > 0 && (
                  <p className={`text-[8px] font-semibold mt-0.5 ${textSecond}`}>
                    +{item.selected_modifiers.map((m: any) => m.name).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 ml-2">
                <span className={`text-[10px] font-bold ${textSecond}`}>x{item.quantity}</span>
                <span className="text-[10px] font-black text-[#F48C24]">{(item.price * item.quantity).toFixed(2)} ₼</span>
                <button onClick={() => handleRemoveFromCart(idx)}
                  className="h-5.5 w-5.5 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center text-[8px] font-bold hover:bg-red-500/20">✕</button>
              </div>
            </div>
          ))}
        </div>
        {customerCart.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            <div>
              <p className={`text-[9px] font-black uppercase tracking-wider mb-1 ${textSecond}`}>
                {tx(safeLang, 'Qeyd əlavə edin', 'Добавить заметку', 'Add a note')}
              </p>
              <textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)}
                placeholder={tx(safeLang, 'Məsələn: az şəkər...', 'Например: меньше сахара...', 'E.g. less sugar, oat milk...')}
                className={`w-full rounded-xl border p-3 text-[10px] focus:outline-none focus:ring-1 min-h-[50px] resize-none ${inputCls}`} />
            </div>
            <div className={`pt-3 border-t ${divider}`}>
              <div className="flex items-center justify-between mb-3">
                <p className={`text-[9px] font-black uppercase tracking-wider ${textSecond}`}>{tx(safeLang, 'Ümumi', 'Итого', 'Total')}</p>
                <p className={`text-lg font-black ${textPrimary}`}>{subtotal.toFixed(2)} ₼</p>
              </div>
              <button onClick={async () => { await Haptic.medium(); handleCheckoutPreOrder(); }} disabled={preOrderSubmitting}
                className="w-full rounded-xl bg-[#1A4329] hover:bg-[#153621] disabled:opacity-50 text-white py-3.5 text-xs font-black transition active:scale-95 flex items-center justify-center gap-1.5 shadow-lg">
                {preOrderSubmitting ? tx(safeLang, 'Göndərilir...', 'Отправляем...', 'Sending...') : tx(safeLang, 'Sifarişi Təsdiqlə', 'Оформить предзаказ', 'Confirm Order')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── PreOrderSuccess ────────────────────────────────────────────────────────────
type PreOrderSuccessProps = {
  preOrderSuccess: boolean;
  preOrderSuccessId: string;
  setPreOrderSuccess: (v: boolean) => void;
  safeLang: string;
  isLight: boolean;
};

export function PreOrderSuccess({ preOrderSuccess, preOrderSuccessId, setPreOrderSuccess, safeLang, isLight }: PreOrderSuccessProps) {
  if (!preOrderSuccess) return null;
  const dlgBg = isLight ? 'bg-white border-black/8' : 'bg-[#0D0B0A]/95 border-white/10';
  const textPrimary = isLight ? 'text-slate-900' : 'text-white';
  const textSecond  = isLight ? 'text-slate-500' : 'text-white/60';
  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`w-full max-w-sm rounded-[32px] ${dlgBg} border p-6 shadow-2xl text-center space-y-5`}>
        <div className="mx-auto h-16 w-16 rounded-full bg-[#F48C24]/10 text-[#F48C24] flex items-center justify-center text-3xl">🎉</div>
        <div className="space-y-2">
          <h2 className={`text-lg font-black ${textPrimary} leading-tight`}>
            {tx(safeLang, 'Sifariş Qəbul Olundu!', 'Предзаказ оформлен!', 'Order Confirmed!')}
          </h2>
          <p className={`text-xs leading-relaxed font-semibold ${textSecond}`}>
            {tx(safeLang, 'Sifarişiniz baristaya ötürüldü.', 'Ваш заказ передан бариста.', 'Your order has been sent to the barista.')}
          </p>
          {preOrderSuccessId && <p className={`text-[10px] font-mono tracking-wider ${textSecond}`}>ID: {preOrderSuccessId.slice(0, 8)}</p>}
        </div>
        <button onClick={async () => { await Haptic.light(); setPreOrderSuccess(false); }}
          className="rounded-2xl bg-[#F48C24] px-8 py-3 text-xs font-black text-white transition active:scale-95 shadow-lg">
          {tx(safeLang, 'Bağla', 'Закрыть', 'Close')}
        </button>
      </div>
    </div>,
    document.body
  );
}

// ─── OrderTab Main ──────────────────────────────────────────────────────────────
type OrderTabProps = {
  safeLang: string;
  isLight: boolean;
  menuItems: any[];
  menuLoading: boolean;
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
  customerCart: any[];
  setShowCartSheet: (v: boolean) => void;
  localFavorites: string[];
  setLocalFavorites: React.Dispatch<React.SetStateAction<string[]>>;
  handleOpenModifiers: (item: any) => void;
  modifierSheetItem: any;
  setModifierSheetItem: (item: any) => void;
  selectedVariant: any;
  setSelectedVariant: (v: any) => void;
  selectedModifiers: any[];
  handleToggleModifier: (mod: { name: string; price: number }) => void;
  handleAddToCart: () => void;
  showCartSheet: boolean;
  orderNotes: string;
  setOrderNotes: (v: string) => void;
  handleCheckoutPreOrder: () => void;
  preOrderSubmitting: boolean;
  preOrderSuccess: boolean;
  preOrderSuccessId: string;
  setPreOrderSuccess: (v: boolean) => void;
  handleRemoveFromCart: (index: number) => void;
};

export default function OrderTab({
  safeLang, isLight, menuItems, menuLoading, selectedCategory, setSelectedCategory,
  customerCart, setShowCartSheet, localFavorites, setLocalFavorites,
  handleOpenModifiers, modifierSheetItem, setModifierSheetItem,
  selectedVariant, setSelectedVariant, selectedModifiers, handleToggleModifier,
  handleAddToCart, showCartSheet, orderNotes, setOrderNotes,
  handleCheckoutPreOrder, preOrderSubmitting, preOrderSuccess, preOrderSuccessId,
  setPreOrderSuccess, handleRemoveFromCart
}: OrderTabProps) {
  const cats = Array.from(new Set(menuItems.map((it: any) => it.category).filter(Boolean))) as string[];
  const filtered = menuItems.filter((it: any) => it.category === selectedCategory);

  const textPrimary = isLight ? 'text-slate-900'   : 'text-white';
  const textSecond  = isLight ? 'text-slate-500'   : 'text-white/60';
  const catInactive = isLight
    ? 'bg-black/5 border-black/8 text-slate-700 hover:bg-black/8'
    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10';
  const cardBg      = isLight
    ? 'bg-white border-black/8 shadow-[0_4px_20px_rgba(0,0,0,0.07)]'
    : 'bg-white/5 border-white/10 shadow-2xl backdrop-blur-xl';
  const loadingText = isLight ? 'text-slate-400'   : 'text-white/40';
  const emptyBorder = isLight ? 'border-black/8 bg-black/3' : 'border-white/10 bg-white/5';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className={`text-2xl font-black tracking-tight ${textPrimary}`}>
            {tx(safeLang, 'Sifariş Et', 'Заказать', 'Pre-Order')}
          </h2>
          <p className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 ${textSecond}`}>
            {tx(safeLang, 'Növbə gözləmədən qəhvəni al', 'Кофе без очереди', 'Skip the line, order ahead')}
          </p>
        </div>
        {customerCart.length > 0 && (
          <button onClick={() => setShowCartSheet(true)}
            className="relative flex items-center justify-center h-10 w-10 rounded-full bg-[#F48C24] text-white shadow-lg active:scale-95 transition">
            <ShoppingBag size={18} />
            <span className="absolute -top-1 -right-1 bg-white text-[#F48C24] text-[9px] font-black h-4 w-4 rounded-full flex items-center justify-center border border-[#F48C24]">
              {customerCart.reduce((sum: number, item: any) => sum + item.quantity, 0)}
            </span>
          </button>
        )}
      </div>

      {/* Category chips */}
      {cats.length > 0 && (
        <div className="flex gap-2.5 overflow-x-auto pb-2 pt-1 -mx-1 px-1">
          {cats.map(cat => {
            const firstItem = menuItems.find((it: any) => it.category === cat);
            const catImage = getProductImage(firstItem?.item_name || firstItem?.name || cat, firstItem?.image_url);
            const isSelected = selectedCategory === cat;
            return (
              <button key={cat} onClick={() => setSelectedCategory(cat)}
                className={`flex-none w-[72px] flex flex-col items-center gap-1.5 rounded-[20px] p-2.5 transition border ${
                  isSelected
                    ? 'bg-[#F48C24] border-[#F48C24] text-white shadow-[0_4px_14px_rgba(244,140,36,0.3)]'
                    : catInactive
                }`}>
                <div className={`h-10 w-10 rounded-full overflow-hidden border ${isSelected ? 'border-white/30' : isLight ? 'border-black/8' : 'border-white/5'}`}>
                  <img src={catImage} alt={cat} className="h-full w-full object-cover" />
                </div>
                <span className={`text-[9px] font-black text-center truncate w-full uppercase tracking-wider leading-tight ${isSelected ? 'text-white' : isLight ? 'text-slate-700' : 'text-white/70'}`}>
                  {cat}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Menu grid */}
      {menuLoading ? (
        <div className={`py-20 text-center text-xs font-bold ${loadingText}`}>
          {tx(safeLang, 'Menyu yüklənir...', 'Меню загружается...', 'Loading menu...')}
        </div>
      ) : filtered.length === 0 ? (
        <div className={`py-20 text-center text-xs font-bold border border-dashed rounded-3xl ${emptyBorder} ${loadingText}`}>
          {tx(safeLang, 'Bu kateqoriyada məhsul tapılmadı', 'Нет товаров в этой категории', 'No products in this category')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3.5">
          {filtered.map((item: any) => {
            const itemName = (item.item_name || item.name || '').toLowerCase();
            const isHot = itemName.includes('isti') || itemName.includes('hot') || (item.category || '').toLowerCase().includes('isti');
            const badgeText = isHot ? 'HOT' : itemName.includes('iced') || itemName.includes('soyuq') ? 'ICED' : 'NEW';
            const badgeColor = badgeText === 'HOT'
              ? 'bg-[#F48C24]/20 border border-[#F48C24]/40 text-[#F48C24]'
              : badgeText === 'ICED'
                ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-500'
                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-600';
            const isFav = localFavorites.includes(item.id);

            return (
              <div key={item.id} onClick={() => handleOpenModifiers(item)}
                className={`relative group flex flex-col items-center rounded-[28px] border overflow-hidden cursor-pointer transition active:scale-[0.96] ${cardBg}`}>
                <div className="relative w-full aspect-square">
                  <img
                    src={getProductImage(item.item_name || item.name || '', item.image_url)}
                    alt={item.item_name || item.name || ''}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className={`absolute inset-0 bg-gradient-to-b from-transparent via-transparent ${isLight ? 'to-white/70' : 'to-[#0D0B0A]/75'} pointer-events-none`} />
                  <span className={`absolute top-2.5 left-2.5 z-10 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider backdrop-blur-md ${badgeColor}`}>
                    {badgeText}
                  </span>
                  <button type="button" onClick={async (e) => {
                    e.stopPropagation();
                    playTickSound();
                    await nativeHapticImpact(ImpactStyle.Light);
                    setLocalFavorites(prev => prev.includes(item.id) ? prev.filter((id: string) => id !== item.id) : [...prev, item.id]);
                  }}
                    className={`absolute top-2.5 right-2.5 z-10 h-7 w-7 rounded-full flex items-center justify-center border backdrop-blur-md transition active:scale-90 ${
                      isFav ? 'bg-[#F48C24]/25 border-[#F48C24]/50 text-[#F48C24]' : isLight ? 'bg-white/70 border-black/10 text-slate-500' : 'bg-black/40 border-white/10 text-white/60'
                    }`}>
                    <Heart size={11} fill={isFav ? '#F48C24' : 'none'} />
                  </button>
                </div>
                <div className="w-full px-3 pt-2.5 pb-3 flex flex-col gap-1">
                  <h3 className={`text-[11px] font-black leading-tight line-clamp-2 ${textPrimary}`}>
                    {item.item_name || item.name}
                  </h3>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[12px] font-black text-[#F48C24]">{Number(item.price || 0).toFixed(2)} ₼</span>
                    <div className="h-7 w-7 rounded-full bg-[#F48C24] flex items-center justify-center text-white font-bold text-base shadow-[0_3px_10px_rgba(244,140,36,0.3)] active:scale-90 transition">+</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ModifierSheet modifierSheetItem={modifierSheetItem} setModifierSheetItem={setModifierSheetItem}
        selectedVariant={selectedVariant} setSelectedVariant={setSelectedVariant}
        selectedModifiers={selectedModifiers} handleToggleModifier={handleToggleModifier}
        handleAddToCart={handleAddToCart} safeLang={safeLang} isLight={isLight} />

      <CartSheet showCartSheet={showCartSheet} setShowCartSheet={setShowCartSheet}
        customerCart={customerCart} handleRemoveFromCart={handleRemoveFromCart}
        orderNotes={orderNotes} setOrderNotes={setOrderNotes}
        handleCheckoutPreOrder={handleCheckoutPreOrder} preOrderSubmitting={preOrderSubmitting}
        safeLang={safeLang} isLight={isLight} />

      <PreOrderSuccess preOrderSuccess={preOrderSuccess} preOrderSuccessId={preOrderSuccessId}
        setPreOrderSuccess={setPreOrderSuccess} safeLang={safeLang} isLight={isLight} />
    </div>
  );
}
