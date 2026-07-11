import React from 'react';
import ReactDOM from 'react-dom';
import { ShoppingBag, ChevronLeft, X, Heart, Plus, Minus } from 'lucide-react';
import { ImpactStyle } from '@capacitor/haptics';
import { tx } from '../../i18n';
import { getProductImage, playTickSound, Haptic, nativeHapticImpact } from '../../lib/customer_utils';

/* ── Toast helper (re-used from HomeTab pattern) ───────────────────── */
function showAddedToast(name: string, lang: string) {
  const messages: Record<string, string> = {
    az: `🛒 ${name} əlavə edildi!`,
    ru: `🛒 ${name} добавлен!`,
    en: `🛒 ${name} added to cart!`,
  };
  const el = document.createElement('div');
  el.className = 'cust-toast';
  el.textContent = messages[lang] || messages.en;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

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
  designMode?: 'classic' | 'retro';
};

export function ModifierSheet({
  modifierSheetItem, setModifierSheetItem, selectedVariant, setSelectedVariant,
  selectedModifiers, handleToggleModifier, handleAddToCart, safeLang, isLight,
  designMode = 'classic'
}: ModifierSheetProps) {
  if (!modifierSheetItem) return null;

  const isRetro = designMode === 'retro';
  const basePrice      = selectedVariant ? Number(selectedVariant.price) : Number(modifierSheetItem.price || 0);
  const modifiersTotal = selectedModifiers.reduce((acc: number, m: any) => acc + m.price, 0);
  const finalPrice     = basePrice + modifiersTotal;
  const hasVariants    = modifierSheetItem.variants && modifierSheetItem.variants.length > 0;
  const hasModifiers   = modifierSheetItem.modifiers && modifierSheetItem.modifiers.length > 0;

  const sheetBg     = isRetro
    ? (isLight ? 'bg-[#FAF6F0]' : 'bg-[#15100E]')
    : (isLight ? 'bg-white/90 backdrop-blur-2xl' : 'bg-[#0D0B0A]/92 backdrop-blur-2xl');
  const sheetBorder = isRetro
    ? (isLight ? 'border-[2.5px] border-[#1C2029]' : 'border-[2.5px] border-[#2F2622]')
    : (isLight ? 'border-black/8' : 'border-white/12');
  const textPrimary = isLight ? 'text-slate-900' : 'text-white';
  const textSecond  = isLight ? 'text-slate-500' : 'text-white/50';
  const chipBase    = isRetro
    ? (isLight ? 'border-[2px] border-[#1C2029] bg-white text-slate-800 shadow-[1.5px_1.5px_0px_0px_#1C2029]' : 'border-[2px] border-[#2F2622] bg-[#1E1714] text-white shadow-[1.5px_1.5px_0px_0px_#2F2622]')
    : (isLight ? 'bg-black/5 border-black/10 text-slate-700 hover:bg-black/8' : 'bg-white/6 border-white/10 text-white/70 hover:bg-white/12');
  const btnBase     = isRetro
    ? (isLight ? 'border-[2px] border-[#1C2029] bg-white text-slate-800 shadow-[1.5px_1.5px_0px_0px_#1C2029]' : 'border-[2px] border-[#2F2622] bg-[#1E1714] text-white shadow-[1.5px_1.5px_0px_0px_#2F2622]')
    : (isLight ? 'bg-black/5 hover:bg-black/10 border-black/8 text-slate-800' : 'bg-white/6 hover:bg-white/12 border-white/10 text-white');
  const divider     = isRetro ? (isLight ? 'border-[#1C2029]' : 'border-[#2F2622]') : (isLight ? 'border-black/6' : 'border-white/8');

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ animation: 'modalFadeIn 0.25s ease forwards', backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
      <div className="absolute inset-0" onClick={() => setModifierSheetItem(null)} />
      <div className={`relative w-full max-w-sm rounded-[32px] ${sheetBg} border ${sheetBorder} overflow-y-auto max-h-[88vh] flex flex-col`}
        style={{
          animation: 'scaleIn 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          boxShadow: isRetro
            ? (isLight ? '6px 6px 0px 0px #1C2029' : '6px 6px 0px 0px #2F2622')
            : (isLight
              ? '0 24px 60px rgba(0,0,0,0.16), 0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)'
              : '0 24px 60px rgba(0,0,0,0.55), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.08)'),
        }}>

        {/* Glossy top highlight */}
        <div className="absolute inset-x-0 top-0 h-20 pointer-events-none rounded-t-[32px]"
          style={{ background: isLight ? 'linear-gradient(180deg, rgba(255,255,255,0.6), transparent)' : 'linear-gradient(180deg, rgba(255,255,255,0.06), transparent)' }} />

        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-3 relative z-10">
          <button onClick={async () => { await Haptic.light(); setModifierSheetItem(null); }}
            className={`h-8 w-8 rounded-full flex items-center justify-center border active:scale-95 transition ${btnBase}`}>
            <ChevronLeft size={16} />
          </button>
          <span className={`text-[10px] font-black uppercase tracking-widest ${textSecond}`}>
            {tx(safeLang, 'Məhsul Seçimi', 'Детали', 'Product Details')}
          </span>
          <button onClick={async () => { await Haptic.light(); setModifierSheetItem(null); }}
            className={`h-8 w-8 rounded-full flex items-center justify-center border active:scale-95 transition ${btnBase}`}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4 relative z-10">
          {/* Product Hero */}
          <div className="flex gap-4 items-start">
            <div className="h-24 w-24 rounded-2xl overflow-hidden flex-shrink-0 shadow-xl ring-1 ring-black/5">
              <img
                src={getProductImage(modifierSheetItem.item_name || modifierSheetItem.name || '', modifierSheetItem.image_url)}
                alt={modifierSheetItem.item_name || modifierSheetItem.name || ''}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <h2 className={`text-base font-black leading-tight ${textPrimary}`}>
                {modifierSheetItem.item_name || modifierSheetItem.name}
              </h2>
              <p className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 ${textSecond}`}>
                {modifierSheetItem.category || 'Craft Blend'}
              </p>
              <p className="text-xl font-black mt-1.5 gradient-text-animated">
                <span className="text-[#F48C24] font-black">₼ </span>
                <span>{finalPrice.toFixed(2)}</span>
              </p>
            </div>
          </div>

          {/* Description */}
          {modifierSheetItem.description && (
            <p className={`text-[10px] leading-relaxed rounded-xl p-3 ${isLight ? 'bg-black/3 text-slate-600' : 'bg-white/4 text-white/60'}`}>
              {modifierSheetItem.description}
            </p>
          )}

          {/* Variants */}
          {hasVariants && (
            <div>
              <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${textSecond}`}>
                {tx(safeLang, 'Ölçü / Variant', 'Размер', 'Size / Variant')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {modifierSheetItem.variants.map((v: any) => {
                  const active = selectedVariant?.name === v.name;
                  return (
                    <button key={v.name} type="button" onClick={() => setSelectedVariant(active ? null : v)}
                      className={`rounded-full px-3.5 py-1.5 text-[10px] font-bold border transition-all active:scale-95 ${active
                        ? 'border-[#F48C24] bg-[#F48C24]/10 text-[#F48C24] shadow-[0_0_12px_rgba(244,140,36,0.15)] scale-102'
                        : chipBase}`}>
                      {v.name} · {Number(v.price || 0).toFixed(2)} ₼
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Modifiers */}
          {hasModifiers && (
            <div>
              <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${textSecond}`}>
                {tx(safeLang, 'Əlavələr', 'Добавки', 'Add-ons')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {modifierSheetItem.modifiers.map((mod: any) => {
                  const active = selectedModifiers.find((m: any) => m.name === mod.name);
                  return (
                    <button key={mod.name} type="button" onClick={() => handleToggleModifier(mod)}
                      className={`rounded-full px-3 py-1.5 text-[9px] font-bold border transition-all active:scale-95 ${active
                        ? 'border-[#F48C24] bg-[#F48C24]/10 text-[#F48C24] shadow-[0_0_12px_rgba(244,140,36,0.15)]'
                        : chipBase}`}>
                      {mod.name} +{Number(mod.price || 0).toFixed(2)} ₼
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className={`border-t ${divider}`} />

          {/* Add to Cart Button */}
          <button type="button"
            onClick={async () => {
              await Haptic.medium();
              handleAddToCart();
              showAddedToast(modifierSheetItem.item_name || modifierSheetItem.name || '', safeLang);
            }}
            className={`w-full py-4 text-xs font-black uppercase tracking-widest transition-all ${
              isRetro ? 'retro-btn shadow-[3px_3px_0px_0px_#1C2029]' : 'rounded-2xl text-white active:scale-[0.97] shimmer-btn'
            }`}
            style={isRetro ? undefined : {
              background: 'linear-gradient(135deg, #F48C24 0%, #ffb366 100%)',
              boxShadow: '0 8px 28px rgba(244,140,36,0.40), 0 2px 8px rgba(244,140,36,0.20), inset 0 1px 0 rgba(255,255,255,0.18)',
            }}>
            {tx(safeLang, 'Səbətə at', 'В корзину', 'Add to Cart')} · {finalPrice.toFixed(2)} ₼
          </button>
        </div>
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
  designMode?: 'classic' | 'retro';
};

export function CartSheet({
  showCartSheet, setShowCartSheet, customerCart, handleRemoveFromCart,
  orderNotes, setOrderNotes, handleCheckoutPreOrder, preOrderSubmitting, safeLang, isLight,
  designMode = 'classic'
}: CartSheetProps) {
  if (!showCartSheet) return null;
  const subtotal = customerCart.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);

  const isRetro     = designMode === 'retro';
  const sheetBg     = isRetro
    ? (isLight ? 'bg-[#FAF6F0]' : 'bg-[#15100E]')
    : (isLight ? 'bg-white/92 backdrop-blur-2xl' : 'bg-[#0D0B0A]/92 backdrop-blur-2xl');
  const sheetBorder = isRetro
    ? (isLight ? 'border-[2.5px] border-[#1C2029]' : 'border-[2.5px] border-[#2F2622]')
    : (isLight ? 'border-black/8' : 'border-white/12');
  const textPrimary = isLight ? 'text-slate-900' : 'text-white';
  const textSecond  = isLight ? 'text-slate-500' : 'text-white/50';
  const itemBg      = isRetro
    ? 'retro-card p-3'
    : (isLight ? 'bg-white border-black/6 shadow-sm' : 'bg-white/5 border-white/6');
  const divider     = isRetro ? (isLight ? 'border-[#1C2029]' : 'border-[#2F2622]') : (isLight ? 'border-black/6' : 'border-white/8');
  const inputCls    = isRetro
    ? (isLight ? 'border-[2px] border-[#1C2029] bg-white text-slate-900 placeholder-slate-400 focus:ring-[#F48C24]' : 'border-[2px] border-[#2F2622] bg-[#1E1714] text-white placeholder-white/30 focus:ring-[#F48C24]')
    : (isLight ? 'border-black/10 bg-black/4 text-slate-900 placeholder-slate-400 focus:ring-[#F48C24]' : 'border-white/10 bg-white/5 text-white placeholder-white/30 focus:ring-[#F48C24]');

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ animation: 'modalFadeIn 0.25s ease forwards', backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
      <div className="absolute inset-0" onClick={() => setShowCartSheet(false)} />
      <div className={`relative w-full max-w-sm rounded-[32px] ${sheetBg} border ${sheetBorder} max-h-[88vh] p-5 flex flex-col`}
        style={{
          animation: 'scaleIn 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          boxShadow: isRetro
            ? (isLight ? '6px 6px 0px 0px #1C2029' : '6px 6px 0px 0px #2F2622')
            : (isLight
              ? '0 24px 60px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.04)'
              : '0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)'),
        }}>

        {/* Glossy highlight */}
        <div className="absolute inset-x-0 top-0 h-16 pointer-events-none rounded-t-[32px]"
          style={{ background: isLight ? 'linear-gradient(180deg, rgba(255,255,255,0.5), transparent)' : 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent)' }} />

        {/* Header */}
        <div className="flex items-center justify-between mb-4 relative z-10">
          <h2 className={`text-base font-black ${textPrimary}`}>{tx(safeLang, 'Səbətiniz', 'Ваша корзина', 'Your Cart')}</h2>
          <button onClick={async () => { await Haptic.light(); setShowCartSheet(false); }}
            className={`h-7 w-7 rounded-full flex items-center justify-center font-bold transition ${isLight ? 'bg-black/6 text-slate-600 hover:bg-black/10' : 'bg-white/6 text-white/60 hover:bg-white/12'}`}>
            <X size={14} />
          </button>
        </div>

        {/* Cart Items */}
        <div className="space-y-3 flex-1 overflow-y-auto pr-1 relative z-10">
          {customerCart.length === 0 ? (
            <div className={`py-12 text-center text-xs font-bold ${textSecond}`}>
              {tx(safeLang, 'Səbətiniz boşdur', 'Ваша корзина пуста', 'Your cart is empty')}
            </div>
          ) : customerCart.map((item: any, idx: number) => {
            // Determine dynamic subtitle ingredient list for card visual representation
            const itemNameLower = item.name.toLowerCase();
            const subTitle = itemNameLower.includes('latte') || itemNameLower.includes('cappuccino')
              ? tx(safeLang, 'Yumşaq süd ilə', 'С нежным молоком', 'With Steamed Milk')
              : itemNameLower.includes('espresso') || itemNameLower.includes('americano')
              ? tx(safeLang, 'Premium Arabica dənələri', 'Премиум зерна Арабика', 'Premium Arabica Beans')
              : tx(safeLang, 'Təbii dad dəm boyu', 'Натуральный настой', 'Natural Brew');

            const itemSize = item.variant_name || 'S';

            return (
              <div key={idx} 
                className={`flex gap-3 rounded-2xl p-3 border transition-all ${isLight ? 'bg-white border-black/5 shadow-sm' : 'bg-[#0C0F14] border-white/5'}`}>
                {/* Left Side: Thumbnail/Icon */}
                <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-[#1C2029] to-[#0C0F14] flex items-center justify-center text-xl border border-white/5 flex-shrink-0 relative overflow-hidden">
                  <span className="relative z-10">☕</span>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                </div>

                {/* Central: Details */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <p className={`text-[11px] font-black truncate ${textPrimary}`}>{item.name}</p>
                    <p className={`text-[8px] font-semibold mt-0.5 ${isLight ? 'text-slate-400' : 'text-white/35'}`}>{subTitle}</p>
                  </div>

                  {/* Size and price chip */}
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded bg-white/5 border border-white/5 uppercase ${textSecond}`}>
                      {itemSize}
                    </span>
                    <span className="text-[10px] font-black text-white/90">
                      <span className="text-[#F48C24] font-black">₼ </span>
                      {Number(item.price).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Right Side: Quantity indicator and Remove button */}
                <div className="flex flex-col items-end justify-between flex-shrink-0">
                  <button onClick={() => handleRemoveFromCart(idx)}
                    className="h-5 w-5 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center text-[10px] font-bold hover:bg-red-500/20 transition-all active:scale-90 border border-red-500/15">
                    <X size={10} />
                  </button>

                  <div className="flex items-center gap-1.5 bg-[#1C2029] px-2 py-0.5 rounded-lg border border-white/5 text-[9px] font-black text-[#F48C24] mt-2">
                    <span className="text-white/40 font-bold">Qty: </span>
                    <span>{item.quantity}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {customerCart.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 relative z-10">
            {/* Notes */}
            <div>
              <p className={`text-[9px] font-black uppercase tracking-wider mb-1.5 ${textSecond}`}>
                {tx(safeLang, 'Qeyd əlavə edin', 'Добавить заметку', 'Add a note')}
              </p>
              <textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)}
                placeholder={tx(safeLang, 'Məsələn: az şəkər...', 'Например: меньше сахара...', 'E.g. less sugar, oat milk...')}
                className={`w-full rounded-xl border p-3 text-[10px] focus:outline-none focus:ring-1 min-h-[50px] resize-none transition ${inputCls}`} />
            </div>

            {/* Total + Checkout */}
            <div className={`pt-3 border-t ${divider}`}>
              {/* Highlighted total box */}
              <div className={`flex items-center justify-between mb-3 rounded-2xl p-3 ${isLight ? 'bg-black/3 border border-black/5' : 'bg-white/4 border border-white/6'}`}>
                <div>
                  <p className={`text-[9px] font-black uppercase tracking-wider ${textSecond}`}>{tx(safeLang, 'Ümumi', 'Итого', 'Total')}</p>
                  <p className={`text-[8px] ${textSecond}`}>{customerCart.length} {tx(safeLang, 'məhsul', 'товаров', 'items')}</p>
                </div>
                <p className={`text-xl font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>{subtotal.toFixed(2)} ₼</p>
              </div>
              <button
                onClick={async () => { await Haptic.medium(); handleCheckoutPreOrder(); }}
                disabled={preOrderSubmitting}
                className={`w-full py-4 text-xs font-black uppercase tracking-widest transition flex items-center justify-center gap-2 disabled:opacity-50 ${
                  isRetro ? 'rounded-2xl active:translate-x-[1.5px] active:translate-y-[1.5px] active:shadow-none' : 'rounded-2xl text-white active:scale-95 shimmer-btn'
                }`}
                style={isRetro ? {
                  background: '#1A4329',
                  border: isLight ? '2.5px solid #1C2029' : '2.5px solid #2F2622',
                  color: '#FFFFFF',
                  boxShadow: isLight ? '3px 3px 0px 0px #1C2029' : '3px 3px 0px 0px #2F2622',
                } : {
                  background: 'linear-gradient(135deg, #1A4329 0%, #2E5E3D 100%)',
                  boxShadow: '0 8px 24px rgba(26,67,41,0.35), inset 0 1px 0 rgba(255,255,255,0.10)',
                }}>
                <ShoppingBag size={16} />
                {preOrderSubmitting
                  ? tx(safeLang, 'Göndərilir...', 'Отправляем...', 'Sending...')
                  : tx(safeLang, 'Sifarişi Təsdiqlə', 'Оформить предзаказ', 'Confirm Order')}
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
  const dlgBg = isLight ? 'bg-white/92 backdrop-blur-2xl' : 'bg-[#0D0B0A]/92 backdrop-blur-2xl';
  const textPrimary = isLight ? 'text-slate-900' : 'text-white';
  const textSecond  = isLight ? 'text-slate-500' : 'text-white/60';
  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
      <div className={`w-full max-w-sm rounded-[32px] ${dlgBg} border p-6 text-center space-y-5`}
        style={{
          animation: 'scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          borderColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.10)',
          boxShadow: isLight ? '0 24px 60px rgba(0,0,0,0.14)' : '0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)',
        }}>
        {/* Glossy top */}
        <div className="absolute inset-x-0 top-0 h-16 pointer-events-none rounded-t-[32px]"
          style={{ background: isLight ? 'linear-gradient(180deg, rgba(255,255,255,0.5), transparent)' : 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent)' }} />

        <div className="relative mx-auto h-20 w-20 rounded-full flex items-center justify-center text-4xl animate-bounce"
          style={{ background: 'linear-gradient(135deg, rgba(244,140,36,0.15), rgba(244,140,36,0.05))', border: '1px solid rgba(244,140,36,0.20)' }}>
          🎉
        </div>
        <div className="space-y-2">
          <h2 className={`text-lg font-black leading-tight ${textPrimary}`}>
            {tx(safeLang, 'Sifariş Qəbul Olundu!', 'Предзаказ оформлен!', 'Order Confirmed!')}
          </h2>
          <p className={`text-xs leading-relaxed font-semibold ${textSecond}`}>
            {tx(safeLang, 'Sifarişiniz baristaya ötürüldü. Tezliklə hazır olacaq! ☕', 'Ваш заказ передан бариста. Скоро будет готово! ☕', 'Your order has been sent to the barista. Coming right up! ☕')}
          </p>
          {preOrderSuccessId && <p className={`text-[10px] font-mono tracking-wider ${textSecond}`}>ID: {preOrderSuccessId.slice(0, 8)}</p>}
        </div>
        <button onClick={async () => { await Haptic.light(); setPreOrderSuccess(false); }}
          className="rounded-2xl px-8 py-3 text-xs font-black text-white transition active:scale-95 shimmer-btn"
          style={{ background: 'linear-gradient(135deg, #F48C24, #ffb366)', boxShadow: '0 6px 20px rgba(244,140,36,0.40)' }}>
          {tx(safeLang, 'Bağla', 'Закрыть', 'Close')}
        </button>
      </div>
    </div>,
    document.body
  );
}

// ─── OrderTab Main ──────────────────────────────────────────────────────────────
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
  designMode?: 'classic' | 'retro';
};

export default function OrderTab({
  safeLang, isLight, menuItems, menuLoading, selectedCategory, setSelectedCategory,
  customerCart, setShowCartSheet, localFavorites, setLocalFavorites,
  handleOpenModifiers, modifierSheetItem, setModifierSheetItem,
  selectedVariant, setSelectedVariant, selectedModifiers, handleToggleModifier,
  handleAddToCart, showCartSheet, orderNotes, setOrderNotes,
  handleCheckoutPreOrder, preOrderSubmitting, preOrderSuccess, preOrderSuccessId,
  setPreOrderSuccess, handleRemoveFromCart, designMode = 'classic'
}: OrderTabProps) {
  const cats     = Array.from(new Set(menuItems.map((it: any) => it.category).filter(Boolean))) as string[];
  const filtered = menuItems.filter((it: any) => it.category === selectedCategory);

  const isRetro = designMode === 'retro';
  const textPrimary = isLight ? 'text-slate-900'   : 'text-white';
  const textSecond  = isLight ? 'text-slate-500'   : 'text-white/60';
  const catInactive = isRetro
    ? (isLight ? 'border-[2px] border-[#1C2029] bg-white text-slate-800 shadow-[1.5px_1.5px_0px_0px_#1C2029]' : 'border-[2px] border-[#2F2622] bg-[#1E1714] text-white shadow-[1.5px_1.5px_0px_0px_#2F2622]')
    : (isLight ? 'bg-white/80 border-black/8 text-slate-700 hover:bg-white shadow-sm backdrop-blur-sm' : 'bg-white/6 border-white/10 text-white/70 hover:bg-white/12 backdrop-blur-sm');
  const cardBg      = isRetro
    ? 'retro-card'
    : (isLight
      ? 'bg-white border-black/8 shadow-[0_4px_20px_rgba(0,0,0,0.07)] hover:shadow-[0_8px_28px_rgba(0,0,0,0.10)]'
      : 'bg-white/5 border-white/10 backdrop-blur-xl hover:border-white/18 hover:bg-white/8');
  const loadingText = isLight ? 'text-slate-400'   : 'text-white/40';
  const emptyBorder = isLight ? 'border-black/8 bg-black/3' : 'border-white/10 bg-white/4';

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.88) translateY(24px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .card-tilt {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          transform-style: preserve-3d;
        }
        .card-tilt:active {
          transform: scale(0.96) rotateX(2deg);
        }
      `}</style>

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
            className="relative flex items-center justify-center h-11 w-11 rounded-full text-white active:scale-95 transition-all shimmer-btn"
            style={{ background: 'linear-gradient(135deg, #F48C24, #ffb366)', boxShadow: '0 6px 20px rgba(244,140,36,0.45)' }}>
            <ShoppingBag size={18} />
            <span className="absolute -top-1 -right-1 bg-white text-[#F48C24] text-[9px] font-black h-4.5 w-4.5 rounded-full flex items-center justify-center border-2 border-[#F48C24] shadow-sm">
              {customerCart.reduce((sum: number, item: any) => sum + item.quantity, 0)}
            </span>
          </button>
        )}
      </div>

      {/* Category Chips */}
      {cats.length > 0 && (
        <div className="flex gap-2.5 overflow-x-auto pb-2 pt-1 -mx-1 px-1">
          {cats.map(cat => {
            const firstItem = menuItems.find((it: any) => it.category === cat);
            const catImage  = getProductImage(firstItem?.item_name || firstItem?.name || cat, firstItem?.image_url);
            const isSelected = selectedCategory === cat;
            return (
              <button key={cat} onClick={async () => { await Haptic.light(); setSelectedCategory(cat); }}
                className={`flex-none w-[76px] flex flex-col items-center gap-1.5 rounded-[22px] p-2.5 transition-all border ${
                  isSelected
                    ? isRetro ? 'text-[#1C2029] dark:text-white retro-btn' : 'text-white shimmer-btn glow-orange'
                    : catInactive
                }`}
                style={isSelected ? {
                  background: 'linear-gradient(135deg, #F48C24, #ffb366)',
                  borderColor: isRetro ? (isLight ? '#1C2029' : '#2F2622') : 'rgba(244,140,36,0.4)',
                } : undefined}>
                <div className={`h-11 w-11 rounded-full overflow-hidden border-2 shadow-sm ${
                  isSelected 
                    ? isRetro ? 'border-[#1C2029] dark:border-white/40' : 'border-white/40' 
                    : isRetro ? (isLight ? 'border-[#1C2029]' : 'border-[#2F2622]') : (isLight ? 'border-black/8' : 'border-white/6')
                }`}>
                  <img src={catImage} alt={cat} className="h-full w-full object-cover" />
                </div>
                <span className={`text-[9px] font-black text-center truncate w-full uppercase tracking-wider leading-tight ${
                  isSelected 
                    ? isRetro ? 'text-[#1C2029] dark:text-white' : 'text-white' 
                    : isLight ? 'text-slate-700' : 'text-white/70'
                }`}>
                  {cat}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Menu Grid */}
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
          {filtered.map((item: any, itemIdx: number) => {
            const itemName  = (item.item_name || item.name || '').toLowerCase();
            const isHot     = itemName.includes('isti') || itemName.includes('hot') || (item.category || '').toLowerCase().includes('isti');
            const badgeText = isHot ? 'HOT' : itemName.includes('iced') || itemName.includes('soyuq') ? 'ICED' : 'NEW';
            const badgeColor = badgeText === 'HOT'
              ? 'bg-[#F48C24]/20 border border-[#F48C24]/40 text-[#F48C24]'
              : badgeText === 'ICED'
                ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-500'
                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-600';
            const isFav = localFavorites.includes(item.id);

            // Determine dynamic description subtitle based on name and category
            const subTitleText = itemName.includes('latte') || itemName.includes('cappuccino')
              ? tx(safeLang, 'Yumşaq süd ilə', 'С нежным молоком', 'With Steamed Milk')
              : itemName.includes('espresso') || itemName.includes('americano')
              ? tx(safeLang, 'Premium Arabica dənələri', 'Премиум зерна Арабика', 'Premium Arabica Beans')
              : itemName.includes('cay') || itemName.includes('tea')
              ? tx(safeLang, 'Təbii bitki dəmləməsi', 'Натуральный травяной настой', 'Natural Herbal Brew')
              : tx(safeLang, 'Özəl qəhvəxana resepti', 'Особый рецепт кофейни', 'Special House Recipe');

            // Generate fake/consistent rating based on product name length for dynamic visual look
            const ratingValue = (4.5 + ((itemName.length % 5) * 0.1)).toFixed(1);

            return (
              <div key={item.id}
                onClick={() => handleOpenModifiers(item)}
                className={`relative group flex flex-col items-center rounded-[28px] border overflow-hidden cursor-pointer card-tilt stagger-fade-in stagger-${Math.min(itemIdx % 5 + 1, 5)} ${cardBg}`}>
                {/* Product Image */}
                <div className={`relative w-full aspect-square overflow-hidden ${isRetro ? 'border-b-[2px] border-[#1C2029] dark:border-[#2F2622]' : ''}`}>
                  <img
                    src={getProductImage(item.item_name || item.name || '', item.image_url)}
                    alt={item.item_name || item.name || ''}
                    className="w-full h-full object-cover group-hover:scale-106 transition-transform duration-500"
                  />
                  {/* Gradient overlay */}
                  {!isRetro && (
                    <div className={`absolute inset-0 bg-gradient-to-b from-transparent via-transparent ${isLight ? 'to-white/80' : 'to-[#0D0B0A]/80'} pointer-events-none`} />
                  )}
                  {/* Shimmer on hover */}
                  {!isRetro && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/12 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 pointer-events-none" />
                  )}

                  {/* Badge (Bottom/Top Left) */}
                  <span className={`absolute bottom-2.5 left-2.5 z-10 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider backdrop-blur-md ${
                    isRetro
                      ? 'bg-[#FAF6F0] text-slate-800 border-2 border-[#1C2029] shadow-sm'
                      : badgeColor
                  }`}>
                    {badgeText}
                  </span>

                  {/* Floating Corner Rating Badge */}
                  <div className={
                    isRetro
                      ? "absolute top-0 right-0 flex items-center gap-0.5 bg-[#FAF6F0] px-2 py-0.5 rounded-bl-xl border-l-[2px] border-b-[2px] border-[#1C2029] dark:border-[#2F2622] text-[9px] font-black text-slate-800 z-10 shadow-sm"
                      : "absolute top-0 right-0 flex items-center gap-0.5 bg-[#0C0F14]/75 backdrop-blur-md px-2.5 py-1 rounded-bl-[18px] border-l border-b border-white/5 text-[9px] font-black text-white z-10"
                  }>
                    <span className="text-yellow-500">★</span>
                    <span>{ratingValue}</span>
                  </div>

                  {/* Favorite */}
                  <button type="button" onClick={async (e) => {
                    e.stopPropagation();
                    playTickSound();
                    await nativeHapticImpact(ImpactStyle.Light);
                    setLocalFavorites(prev => prev.includes(item.id) ? prev.filter((id: string) => id !== item.id) : [...prev, item.id]);
                  }}
                    className={`absolute top-10 right-2.5 z-10 h-7 w-7 rounded-full flex items-center justify-center border backdrop-blur-md transition-all active:scale-90 ${
                      isRetro
                        ? isFav
                          ? 'bg-[#F48C24] border-[2px] border-[#1C2029] dark:border-[#2F2622] text-[#1C2029]'
                          : 'bg-white border-[2px] border-[#1C2029] dark:border-[#2F2622] text-slate-500'
                        : isFav
                          ? 'bg-[#F48C24]/25 border-[#F48C24]/50 text-[#F48C24] glow-orange-sm'
                          : isLight ? 'bg-white/80 border-black/10 text-slate-500' : 'bg-black/40 border-white/10 text-white/60'
                    }`}>
                    <Heart size={11} fill={isFav ? (isRetro ? '#1C2029' : '#F48C24') : 'none'} />
                  </button>
                </div>

                {/* Info Row */}
                <div className="w-full px-3.5 pt-2.5 pb-3.5 flex flex-col gap-1">
                  <h3 className={`text-[11px] font-black leading-tight line-clamp-1 ${textPrimary}`}>
                    {item.item_name || item.name}
                  </h3>
                  
                  {/* Recipe Subtitle */}
                  <p className={`text-[9px] font-semibold leading-none truncate ${isLight ? 'text-slate-400' : 'text-white/35'}`}>
                    {subTitleText}
                  </p>

                  <div className="flex items-center justify-between mt-1.5">
                    <p className={`text-[12px] font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
                      <span className="text-[#F48C24] font-black">₼ </span>
                      <span>{Number(item.price || 0).toFixed(2)}</span>
                    </p>
                    {/* + button */}
                    {isRetro ? (
                      <div className="h-7 w-7 border-[2px] border-[#1C2029] dark:border-[#2F2622] bg-[#F48C24] flex items-center justify-center text-[#1C2029] font-black text-sm shadow-[1.5px_1.5px_0px_0px_#1C2029] rounded-lg active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all">
                        <Plus size={14} />
                      </div>
                    ) : (
                      <div className="relative glow-ring-pulse rounded-full">
                        <div className="h-7 w-7 rounded-full bg-[#F48C24] flex items-center justify-center text-white font-bold text-base shadow-[0_3px_10px_rgba(244,140,36,0.35)] active:scale-90 transition">
                          <Plus size={14} />
                        </div>
                      </div>
                    )}
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
        handleAddToCart={handleAddToCart} safeLang={safeLang} isLight={isLight} designMode={designMode} />

      <CartSheet showCartSheet={showCartSheet} setShowCartSheet={setShowCartSheet}
        customerCart={customerCart} handleRemoveFromCart={handleRemoveFromCart}
        orderNotes={orderNotes} setOrderNotes={setOrderNotes}
        handleCheckoutPreOrder={handleCheckoutPreOrder} preOrderSubmitting={preOrderSubmitting}
        safeLang={safeLang} isLight={isLight} designMode={designMode} />

      <PreOrderSuccess preOrderSuccess={preOrderSuccess} preOrderSuccessId={preOrderSuccessId}
        setPreOrderSuccess={setPreOrderSuccess} safeLang={safeLang} isLight={isLight} />
    </div>
  );
}
