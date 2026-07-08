import React from 'react';
import { ShoppingBag, ChevronLeft, X, Heart } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { tx } from '../../i18n';
import { getProductImage, playTickSound, Haptic, nativeHapticImpact } from '../../lib/customer_utils';

// --- ModifierSheet ---
type ModifierSheetProps = {
  modifierSheetItem: any;
  setModifierSheetItem: (item: any) => void;
  selectedVariant: any;
  setSelectedVariant: (v: any) => void;
  selectedModifiers: any[];
  handleToggleModifier: (mod: { name: string; price: number }) => void;
  handleAddToCart: () => void;
  safeLang: string;
};

export function ModifierSheet({ modifierSheetItem, setModifierSheetItem, selectedVariant, setSelectedVariant, selectedModifiers, handleToggleModifier, handleAddToCart, safeLang }: ModifierSheetProps) {
  if (!modifierSheetItem) return null;
  const basePrice = selectedVariant ? Number(selectedVariant.price) : Number(modifierSheetItem.price || 0);
  const modifiersTotal = selectedModifiers.reduce((acc: number, m: any) => acc + m.price, 0);
  const finalPrice = basePrice + modifiersTotal;
  const hasVariants = modifierSheetItem.variants && modifierSheetItem.variants.length > 0;
  const hasModifiers = modifierSheetItem.modifiers && modifierSheetItem.modifiers.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={() => setModifierSheetItem(null)} />
      <div className="relative w-full max-w-md rounded-t-[36px] bg-[#0D0B0A]/95 border-t border-white/10 p-6 shadow-2xl max-h-[90vh] overflow-y-auto flex flex-col justify-between text-white backdrop-blur-2xl">
        <div className="overflow-x-hidden">
          <div className="flex items-center justify-between mb-4">
            <button onClick={async () => { await Haptic.light(); setModifierSheetItem(null); }} className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 shadow-lg text-white active:scale-95 transition">
              <ChevronLeft size={18} />
            </button>
            <span className="text-[11px] font-black text-white uppercase tracking-wider">
              {tx(safeLang, 'Məhsul Təfərrüatı', 'Детали продукта', 'Product Details')}
            </span>
            <button onClick={async () => { await Haptic.light(); setModifierSheetItem(null); }} className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 shadow-lg text-white active:scale-95 transition">
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-12 gap-3 items-start my-2">
            <div className="col-span-7 space-y-3">
              <div>
                <h2 className="text-xl font-black text-white leading-tight">{modifierSheetItem.name}</h2>
                <p className="text-[9px] text-white/50 font-bold uppercase tracking-wider mt-0.5">
                  {modifierSheetItem.category || 'Craft Blend'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-amber-400 text-xs">★★★★★</span>
                <span className="text-[10px] text-white/50 font-bold">(4.8)</span>
              </div>
              <div>
                <span className="text-xl font-black text-[#F48C24]">{finalPrice.toFixed(2)} ₼</span>
              </div>
              <div className="pt-2 space-y-1.5 border-t border-white/10">
                {modifierSheetItem.description && <p className="text-[10px] text-white/40 leading-relaxed">{modifierSheetItem.description}</p>}
                <div className="flex items-center gap-1 text-[9px] text-white/30">
                  <span>☕ {modifierSheetItem.caffeine || 'Medium'} caffeine</span>
                  <span>•</span>
                  <span>🔥 {modifierSheetItem.calories || '~150'} cal</span>
                </div>
              </div>
            </div>
            <div className="col-span-5">
              <div className="rounded-2xl overflow-hidden border border-white/5 shadow-2xl">
                <img src={getProductImage(modifierSheetItem.name, modifierSheetItem.image_url)} alt={modifierSheetItem.name} className="h-full w-full object-cover" />
              </div>
            </div>
          </div>

          {hasVariants && (
            <div className="mt-5 space-y-2.5">
              <p className="text-[9px] font-black text-white/50 uppercase tracking-wider">{tx(safeLang, 'Ölçü seçimi', 'Выбор размера', 'Size selection')}</p>
              <div className="flex gap-2">
                {modifierSheetItem.variants.map((v: any) => (
                  <button key={v.name} type="button" onClick={() => setSelectedVariant(v)}
                    className={`flex-1 rounded-2xl border p-3 text-center text-[11px] font-bold transition active:scale-95 ${
                      selectedVariant?.name === v.name
                        ? 'bg-[#F48C24] border-[#F48C24] text-white shadow-[0_4px_12px_rgba(244,140,36,0.25)]'
                        : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                    }`}>
                    <span className="block font-black">{v.name}</span>
                    <span className="block text-[9px] opacity-80">{Number(v.price || 0).toFixed(2)} ₼</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasModifiers && (
            <div className="mt-5 space-y-2.5">
              <p className="text-[9px] font-black text-white/50 uppercase tracking-wider">{tx(safeLang, 'Əlavələr', 'Добавки', 'Add-ons')}</p>
              <div className="flex flex-wrap gap-2">
                {modifierSheetItem.modifiers.map((mod: any) => {
                  const active = selectedModifiers.find((m: any) => m.name === mod.name);
                  return (
                    <button key={mod.name} type="button" onClick={() => handleToggleModifier(mod)}
                      className={`rounded-full px-3 py-1.5 text-[10px] font-bold border transition active:scale-95 ${
                        active
                          ? 'bg-[#F48C24] border-[#F48C24] text-white'
                          : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                      }`}>
                      {mod.name} +{Number(mod.price || 0).toFixed(2)} ₼
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <button type="button" onClick={async () => { await Haptic.medium(); handleAddToCart(); }}
          className="mt-6 w-full rounded-2xl py-3 text-sm font-black text-white transition-all active:scale-[0.97] shadow-lg"
          style={{ background: `linear-gradient(135deg, #F48C24, #ffb366)` }}>
          {tx(safeLang, 'Səbətə at', 'В корзину', 'Add to Cart')} · {finalPrice.toFixed(2)} ₼
        </button>
      </div>
    </div>
  );
}

// --- CartSheet ---
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
};

export function CartSheet({ showCartSheet, setShowCartSheet, customerCart, handleRemoveFromCart, orderNotes, setOrderNotes, handleCheckoutPreOrder, preOrderSubmitting, safeLang }: CartSheetProps) {
  if (!showCartSheet) return null;
  const subtotal = customerCart.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={() => setShowCartSheet(false)} />
      <div className="relative w-full max-w-md rounded-t-[36px] bg-[#0D0B0A]/95 border-t border-white/10 p-6 shadow-2xl max-h-[85vh] overflow-y-auto flex flex-col backdrop-blur-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-black text-white">{tx(safeLang, 'Səbətiniz', 'Ваша корзина', 'Your Cart')}</h2>
          <button onClick={async () => { await Haptic.light(); setShowCartSheet(false); }} className="h-8 w-8 rounded-full bg-white/5 text-white/60 flex items-center justify-center font-bold hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 flex-1 overflow-y-auto">
          {customerCart.length === 0 ? (
            <div className="py-12 text-center text-xs text-white/30">
              {tx(safeLang, 'Səbətiniz boşdur', 'Ваша корзина пуста', 'Your cart is empty')}
            </div>
          ) : customerCart.map((item: any, idx: number) => (
            <div key={idx} className="flex items-center justify-between rounded-2xl bg-white/5 p-3.5 border border-white/5">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-white">{item.name}</p>
                {item.variant_name && <p className="text-[9px] text-white/60 font-semibold mt-0.5">{item.variant_name}</p>}
                {item.selected_modifiers?.length > 0 && (
                  <p className="text-[9px] text-white/40 font-semibold mt-0.5">+{item.selected_modifiers.map((m: any) => m.name).join(', ')}</p>
                )}
              </div>
              <div className="flex items-center gap-3 ml-3">
                <span className="text-xs font-bold text-white">x{item.quantity}</span>
                <span className="text-xs font-black text-[#F48C24]">{(item.price * item.quantity).toFixed(2)} ₼</span>
                <button onClick={() => handleRemoveFromCart(idx)} className="h-6 w-6 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center text-[9px] font-bold hover:bg-red-500/20">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        {customerCart.length > 0 && (
          <>
            <div className="mt-4">
              <p className="text-[10px] font-black uppercase tracking-wider text-white/50 mb-1">
                {tx(safeLang, 'Qeyd əlavə edin', 'Добавить заметку', 'Add a note')}
              </p>
              <textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)}
                placeholder={tx(safeLang, 'Məsələn: az şəkər, soyuq süd...', 'Например: меньше сахара...', 'E.g. less sugar, oat milk...')}
                className="w-full rounded-2xl border border-white/10 bg-white/5 p-3.5 text-xs text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-[#F48C24] min-h-[70px] resize-none" />
            </div>

            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-bold uppercase tracking-wider text-white/40">{tx(safeLang, 'Ümumi', 'Итого', 'Total')}</p>
                <p className="text-xl font-black text-white tracking-tight">{subtotal.toFixed(2)} ₼</p>
              </div>
            </div>

            <button onClick={async () => { await Haptic.medium(); handleCheckoutPreOrder(); }} disabled={preOrderSubmitting}
              className="mt-4 w-full rounded-2xl bg-[#1A4329] hover:bg-[#153621] disabled:opacity-50 text-white py-3 text-xs font-black transition active:scale-95 flex items-center justify-center gap-1.5 shadow-md">
              {preOrderSubmitting ? '...' : tx(safeLang, 'Sifarişi Təsdiqlə', 'Оформить предзаказ', 'Confirm Order')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// --- PreOrderSuccess ---
type PreOrderSuccessProps = {
  preOrderSuccess: boolean;
  preOrderSuccessId: string;
  setPreOrderSuccess: (v: boolean) => void;
  safeLang: string;
};

export function PreOrderSuccess({ preOrderSuccess, preOrderSuccessId, setPreOrderSuccess, safeLang }: PreOrderSuccessProps) {
  if (!preOrderSuccess) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-[32px] bg-[#0D0B0A]/95 border border-white/10 p-6 shadow-2xl text-center space-y-5 backdrop-blur-2xl">
        <div className="mx-auto h-16 w-16 rounded-full bg-[#F48C24]/10 text-[#F48C24] flex items-center justify-center text-3xl">
          🎉
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-black text-white leading-tight">
            {tx(safeLang, 'Sifariş Qəbul Olundu!', 'Предзаказ оформлен!', 'Order Confirmed!')}
          </h2>
          <p className="text-xs text-white/60 leading-relaxed font-semibold">
            {tx(safeLang, 'Sifarişiniz baristaya ötürüldü. Hazır olan kimi bildiriş alacaqsınız.', 'Ваш заказ передан бариста.', 'Your order has been sent to the barista.')}
          </p>
          {preOrderSuccessId && (
            <p className="text-[10px] font-mono text-white/30 tracking-wider">ID: {preOrderSuccessId.slice(0, 8)}</p>
          )}
        </div>
        <button onClick={async () => { await Haptic.light(); setPreOrderSuccess(false); }}
          className="rounded-2xl bg-[#F48C24] px-8 py-3 text-xs font-black text-white transition active:scale-95 shadow-lg">
          {tx(safeLang, 'Bağla', 'Закрыть', 'Close')}
        </button>
      </div>
    </div>
  );
}

// --- OrderTab Main ---
type OrderTabProps = {
  safeLang: string;
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
  safeLang, menuItems, menuLoading, selectedCategory, setSelectedCategory,
  customerCart, setShowCartSheet, localFavorites, setLocalFavorites,
  handleOpenModifiers, modifierSheetItem, setModifierSheetItem,
  selectedVariant, setSelectedVariant, selectedModifiers, handleToggleModifier,
  handleAddToCart, showCartSheet, orderNotes, setOrderNotes,
  handleCheckoutPreOrder, preOrderSubmitting, preOrderSuccess, preOrderSuccessId,
  setPreOrderSuccess, handleRemoveFromCart
}: OrderTabProps) {
  const cats = Array.from(new Set(menuItems.map((it: any) => it.category).filter(Boolean))) as string[];
  const filtered = menuItems.filter((it: any) => it.category === selectedCategory);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-2xl font-black text-white tracking-tight">
            {tx(safeLang, 'Sifariş Et', 'Заказать', 'Pre-Order')}
          </h2>
          <p className="text-[10px] text-white/60 font-bold uppercase tracking-wider mt-0.5">
            {tx(safeLang, 'Növbə gözləmədən qəhvəni al', 'Кофе без очереди', 'Skip the line, order ahead')}
          </p>
        </div>
        {customerCart.length > 0 && (
          <button onClick={() => setShowCartSheet(true)}
            className="relative flex items-center justify-center h-10 w-10 rounded-full bg-[#F48C24] text-white shadow-lg active:scale-95 transition">
            <ShoppingBag size={18} />
            <span className="absolute -top-1 -right-1 bg-[#F48C24] text-white text-[9px] font-black h-4.5 w-4.5 rounded-full flex items-center justify-center border border-white">
              {customerCart.reduce((sum: number, item: any) => sum + item.quantity, 0)}
            </span>
          </button>
        )}
      </div>

      {cats.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2 pt-1">
          {cats.map(cat => {
            const firstItem = menuItems.find((it: any) => it.category === cat);
            const catImage = getProductImage(firstItem?.name || cat, firstItem?.image_url);
            const isSelected = selectedCategory === cat;
            return (
              <button key={cat} onClick={() => setSelectedCategory(cat)}
                className={`flex-none w-20 flex flex-col items-center gap-2 rounded-[22px] p-3 transition border ${
                  isSelected
                    ? 'bg-[#F48C24] border-[#F48C24] text-white shadow-[0_6px_16px_rgba(244,140,36,0.35)]'
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                }`}>
                <div className={`h-11 w-11 rounded-full flex items-center justify-center overflow-hidden bg-white/10 border ${isSelected ? 'border-white/20' : 'border-white/5'}`}>
                  <img src={catImage} alt={cat} className="h-full w-full object-cover" />
                </div>
                <span className="text-[10px] font-black text-center truncate w-full uppercase tracking-wider">{cat}</span>
              </button>
            );
          })}
        </div>
      )}

      {menuLoading ? (
        <div className="py-20 text-center text-xs text-white/40 font-bold">
          {tx(safeLang, 'Menyu yüklənir...', 'Меню загружается...', 'Loading menu...')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-xs text-white/40 font-bold border border-dashed border-white/10 rounded-3xl bg-white/5">
          {tx(safeLang, 'Bu kateqoriyada məhsul tapılmadı', 'Нет товаров в этой категории', 'No products in this category')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3.5">
          {filtered.map((item: any) => {
            const isHot = item.name.toLowerCase().includes('isti') || item.name.toLowerCase().includes('hot') || item.category?.toLowerCase().includes('isti');
            const badgeText = isHot ? 'HOT' : item.name.toLowerCase().includes('iced') || item.name.toLowerCase().includes('soyuq') ? 'ICED' : 'NEW';
            const badgeColor = badgeText === 'HOT'
              ? 'bg-[#F48C24]/10 border border-[#F48C24]/20 text-[#F48C24]'
              : badgeText === 'ICED'
                ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400'
                : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400';
            const isFav = localFavorites.includes(item.id);
            return (
              <div key={item.id} onClick={() => handleOpenModifiers(item)}
                className="relative group flex flex-col justify-between rounded-[28px] border border-white/10 bg-white/5 p-3.5 transition active:scale-[0.98] shadow-2xl backdrop-blur-xl cursor-pointer text-white">
                <span className={`absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${badgeColor}`}>
                  {badgeText}
                </span>
                <button type="button" onClick={async (e) => {
                  e.stopPropagation();
                  playTickSound();
                  await nativeHapticImpact(ImpactStyle.Light);
                  setLocalFavorites(prev => prev.includes(item.id) ? prev.filter((id: string) => id !== item.id) : [...prev, item.id]);
                }}
                  className={`absolute top-2 right-2 z-10 h-7 w-7 rounded-full flex items-center justify-center border transition active:scale-90 ${
                    isFav ? 'bg-[#F48C24]/20 border-[#F48C24]/30 text-[#F48C24]' : 'bg-black/40 border-white/10 text-white/80 hover:bg-black/60 backdrop-blur-md'
                  }`}>
                  <Heart size={12} fill={isFav ? '#F48C24' : 'none'} />
                </button>
                <div>
                  <img src={getProductImage(item.name, item.image_url)} alt={item.name}
                    className="h-28 w-full rounded-2xl object-cover border border-white/5 group-hover:scale-[1.02] transition duration-300" />
                  <h3 className="mt-3 text-xs font-black text-white leading-tight line-clamp-1">{item.name}</h3>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <span className="block text-[11px] font-bold text-white/40 uppercase tracking-wider">{tx(safeLang, 'QİYMƏT', 'ЦЕНА', 'PRICE')}</span>
                    <span className="text-xs font-black text-white">{Number(item.price || 0).toFixed(2)} ₼</span>
                  </div>
                  <div className="h-7 w-7 rounded-full bg-[#F48C24] flex items-center justify-center text-white font-bold text-lg shadow-[0_4px_10px_rgba(244,140,36,0.2)] hover:scale-105 active:scale-95 transition">+</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ModifierSheet
        modifierSheetItem={modifierSheetItem}
        setModifierSheetItem={setModifierSheetItem}
        selectedVariant={selectedVariant}
        setSelectedVariant={setSelectedVariant}
        selectedModifiers={selectedModifiers}
        handleToggleModifier={handleToggleModifier}
        handleAddToCart={handleAddToCart}
        safeLang={safeLang}
      />

      <CartSheet
        showCartSheet={showCartSheet}
        setShowCartSheet={setShowCartSheet}
        customerCart={customerCart}
        handleRemoveFromCart={handleRemoveFromCart}
        orderNotes={orderNotes}
        setOrderNotes={setOrderNotes}
        handleCheckoutPreOrder={handleCheckoutPreOrder}
        preOrderSubmitting={preOrderSubmitting}
        safeLang={safeLang}
      />

      <PreOrderSuccess
        preOrderSuccess={preOrderSuccess}
        preOrderSuccessId={preOrderSuccessId}
        setPreOrderSuccess={setPreOrderSuccess}
        safeLang={safeLang}
      />
    </div>
  );
}
