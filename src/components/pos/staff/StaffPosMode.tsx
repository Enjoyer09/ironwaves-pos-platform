import React, { useState } from 'react';
import { Check, Minus, Plus, ScanLine, Search, ShoppingCart, Trash2 } from 'lucide-react';

type PaymentMethod = 'Nəğd' | 'Kart' | 'Split' | 'Staff';
type OrderType = 'Dine In' | 'Take Away' | 'Order Online';

type StaffPosModeProps = {
  lang: 'az' | 'ru' | 'en';
  tx: (lang: 'az' | 'ru' | 'en', az: string, ru: string, en?: string) => string;
  t: Record<string, string>;
  businessName: string;
  activeCart: 'S1' | 'S2' | 'S3';
  search: string;
  setSearch: (value: string) => void;
  categories: string[];
  category: string;
  setCategory: (value: string) => void;
  groupedMenu: Array<{
    base: string;
    category: string;
    image_url: string;
    description: string;
    items: any[];
  }>;
  cart: any[];
  checkoutBaseTotal: any;
  getGroupQty: (group: any) => number;
  increaseGroupQty: (group: any) => void;
  decreaseGroupQty: (group: any) => void;
  openProductPicker: (group: any) => void;
  toDecimalSafe: (value: unknown, fallback?: string) => any;
  updateCartItem: (lineId: string, qty: number) => void;
  selectedPayment: PaymentMethod;
  setSelectedPayment: (method: PaymentMethod) => void;
  splitCashInput: string;
  setSplitCashInput: (value: string) => void;
  isLoading: boolean;
  ctx: any;
  patchCtx: (patch: any) => void;
  handleFindCustomer: () => void;
  handleRewardCodeEnter: () => void;
  feedbackCouponPreview: any;
  hasClaimCode: boolean;
  rawTotal: any;
  discountAmount: any;
  tables: any[];
  handleSendToKitchen: () => Promise<void>;
  handleCheckout: (payment: PaymentMethod) => Promise<void>;
  shouldLockTableCheckoutInPos: boolean;
  requestClearCart: (key?: 'S1' | 'S2' | 'S3') => void;
  handleSyncOfflineQueue: () => Promise<void>;
  isSyncingOffline: boolean;
};

export function StaffPosShell({ children }: { children: React.ReactNode }) {
  return <div className="staff-pos-shell">{children}</div>;
}

export function StaffPosHeader(props: {
  businessName: string;
  tx: StaffPosModeProps['tx'];
  lang: StaffPosModeProps['lang'];
  onSync: () => Promise<void>;
  isSyncingOffline: boolean;
  onClear: () => void;
  disableClear: boolean;
}) {
  return null;
}

export function StaffSearchBar(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="staff-search-wrap">
      <Search className="staff-search-icon" size={18} />
      <input className="staff-search-input" value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} />
    </div>
  );
}

export function StaffCategoryTabs(props: {
  categories: string[];
  category: string;
  setCategory: (value: string) => void;
  allLabel: string;
}) {
  return (
    <div className="staff-category-tabs">
      {props.categories.map((cat) => (
        <button key={cat} onClick={() => props.setCategory(cat)} className={`staff-category-chip ${props.category === cat ? 'staff-category-chip-active' : ''}`}>
          {cat === 'ALL' ? props.allLabel : cat}
        </button>
      ))}
    </div>
  );
}

export function StaffProductCard(props: {
  group: StaffPosModeProps['groupedMenu'][number];
  qtyInCart: number;
  minPrice: any;
  onMinus: () => void;
  onPlus: () => void;
  onOpenVariant: () => void;
  hasVariants: boolean;
  fallbackLabel: string;
}) {
  const { group, qtyInCart, minPrice, onMinus, onPlus, onOpenVariant, hasVariants, fallbackLabel } = props;
  const initials = String(group.base || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((token) => token.slice(0, 1).toUpperCase())
    .join('');

  return (
    <article
      onClick={() => {
        if (hasVariants) onOpenVariant();
        else onPlus();
      }}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-2 text-left transition cursor-pointer select-none active:scale-[0.98] ${
        qtyInCart > 0
          ? 'border-amber-400/80 bg-slate-900/90 ring-1 ring-amber-400/35'
          : 'border-slate-700/75 bg-slate-900/65 hover:border-slate-600'
      }`}
    >
      <div className="relative h-20 w-full overflow-hidden rounded-xl bg-slate-950/80 shrink-0">
        {group.image_url ? (
          <img src={group.image_url} alt={group.base} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800/90 to-slate-950 text-lg font-black text-slate-400">
            {initials || fallbackLabel}
          </div>
        )}
        <div className="absolute bottom-1.5 left-1.5 rounded-lg bg-slate-950/90 backdrop-blur-xs border border-amber-400/40 px-2 py-0.5 text-xs font-extrabold text-amber-300 tabular-nums shadow-md">
          {minPrice.toFixed(2)} ₼
        </div>
        {qtyInCart > 0 && (
          <div className="absolute top-1.5 right-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-400 px-1.5 text-xs font-black text-slate-950 shadow-md tabular-nums">
            {qtyInCart}
          </div>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-1.5 min-h-[34px]">
        <div className="line-clamp-2 text-xs sm:text-[13px] font-bold leading-tight text-slate-100 flex-1 min-w-0">
          {group.base}
        </div>
        {qtyInCart > 0 && !hasVariants ? (
          <div
            className="flex items-center gap-1 shrink-0 bg-slate-950/90 border border-slate-700/80 rounded-lg p-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label={`${group.base} - 1`}
              onClick={onMinus}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-800 text-xs font-black text-slate-200 active:scale-90"
            >
              −
            </button>
            <span className="min-w-[16px] text-center text-xs font-black text-amber-300 tabular-nums">{qtyInCart}</span>
            <button
              type="button"
              aria-label={`${group.base} + 1`}
              onClick={onPlus}
              className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-400 text-xs font-black text-slate-950 active:scale-90"
            >
              +
            </button>
          </div>
        ) : hasVariants ? (
          <button
            type="button"
            aria-label={`${group.base} variant seçimi`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenVariant();
            }}
            className="shrink-0 rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-200"
          >
            Variant
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function StaffProductGrid(props: {
  groups: StaffPosModeProps['groupedMenu'];
  getGroupQty: StaffPosModeProps['getGroupQty'];
  increaseGroupQty: StaffPosModeProps['increaseGroupQty'];
  decreaseGroupQty: StaffPosModeProps['decreaseGroupQty'];
  openProductPicker: StaffPosModeProps['openProductPicker'];
  toDecimalSafe: StaffPosModeProps['toDecimalSafe'];
}) {
  return (
    <div className="staff-product-grid">
      {props.groups.map((group) => {
        const hasVariants = group.items.length > 1;
        const minPrice = group.items.reduce(
          (acc, cur) => (props.toDecimalSafe(acc).lessThan(props.toDecimalSafe(cur.price)) ? props.toDecimalSafe(acc) : props.toDecimalSafe(cur.price)),
          props.toDecimalSafe(group.items[0].price),
        );
        const qtyInCart = props.getGroupQty(group);
        return (
          <StaffProductCard
            key={`${group.base}_${group.items.length}`}
            group={group}
            qtyInCart={qtyInCart}
            minPrice={minPrice}
            onMinus={() => props.decreaseGroupQty(group)}
            onPlus={() => props.increaseGroupQty(group)}
            onOpenVariant={() => props.openProductPicker(group)}
            hasVariants={hasVariants}
            fallbackLabel="M"
          />
        );
      })}
    </div>
  );
}

export function StaffCartItem(props: {
  item: any;
  updateCartItem: StaffPosModeProps['updateCartItem'];
  toDecimalSafe: StaffPosModeProps['toDecimalSafe'];
}) {
  const { item, updateCartItem, toDecimalSafe } = props;
  return (
    <div className="staff-cart-item">
      <div className="staff-cart-item-top">
        <span className="staff-cart-item-name">{item.item_name}</span>
        <span className="staff-cart-item-price">{toDecimalSafe(item.price).times(item.qty).toFixed(2)} ₼</span>
      </div>
      <div className="staff-cart-item-actions">
        <button type="button" aria-label={`${item.item_name} - 1`} className="staff-qty-btn" onClick={() => updateCartItem(item.line_id, item.qty - 1)}>
          <Minus size={15} />
        </button>
        <span className="staff-qty-value">{item.qty}</span>
        <button type="button" aria-label={`${item.item_name} + 1`} className="staff-qty-btn" onClick={() => updateCartItem(item.line_id, item.qty + 1)}>
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}

export function StaffPaymentSelector(props: {
  selectedPayment: PaymentMethod;
  setSelectedPayment: (method: PaymentMethod) => void;
  isLoading: boolean;
  tx: StaffPosModeProps['tx'];
  lang: StaffPosModeProps['lang'];
}) {
  const methods: PaymentMethod[] = ['Nəğd', 'Kart', 'Split', 'Staff'];
  return (
    <div className="staff-payment-grid">
      {methods.map((method) => (
        <button
          key={method}
          disabled={props.isLoading}
          onClick={() => props.setSelectedPayment(method)}
          className={`staff-payment-btn ${props.selectedPayment === method ? 'staff-payment-btn-active' : ''}`}
        >
          {method === 'Nəğd'
            ? props.tx(props.lang, 'Nəğd', 'Наличные', 'Cash')
            : method === 'Kart'
              ? props.tx(props.lang, 'Kart', 'Карта', 'Card')
              : method === 'Split'
                ? props.tx(props.lang, 'Bölünmüş', 'Разделено', 'Split')
                : props.tx(props.lang, 'Staff', 'Персонал', 'Staff')}
        </button>
      ))}
    </div>
  );
}

export function StaffCheckoutButton(props: { disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button disabled={props.disabled} onClick={props.onClick} className="staff-checkout-btn">
      <Check size={18} /> {props.label}
    </button>
  );
}

export function StaffCartPanel(props: StaffPosModeProps) {
  const {
    tx, lang, t, activeCart, checkoutBaseTotal, cart, ctx, patchCtx, handleFindCustomer, handleRewardCodeEnter,
    feedbackCouponPreview, hasClaimCode, selectedPayment, setSelectedPayment, isLoading, splitCashInput,
    setSplitCashInput, rawTotal, discountAmount, updateCartItem, shouldLockTableCheckoutInPos,
    handleSendToKitchen, handleCheckout,
  } = props;
  const [showCustomerBox, setShowCustomerBox] = useState(false);
  const [showDiscountBox, setShowDiscountBox] = useState(false);
  const hasActiveCustomer = Boolean(ctx.customer || ctx.customerQR || ctx.rewardClaimCode);
  const hasActiveDiscount = parseFloat(ctx.discount || '0') > 0 || Boolean(feedbackCouponPreview);

  return (
    <aside className="staff-cart-panel">
      <div className="staff-cart-head">
        <h3 className="staff-cart-title"><ShoppingCart size={18} /> {t.cart.toUpperCase()} {activeCart.slice(1)}</h3>
        <div className="flex items-center gap-2">
          <div className="staff-cart-total-head">{checkoutBaseTotal.toFixed(2)} ₼</div>
          <button
            type="button"
            onClick={() => props.requestClearCart(activeCart)}
            disabled={!cart.length || isLoading}
            title={tx(lang, 'Səbəti sil', 'Очистить корзину', 'Clear cart')}
            className="rounded-lg border border-slate-700/80 bg-slate-800/80 p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-20 transition"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {(!showCustomerBox && !hasActiveCustomer && !showDiscountBox && !hasActiveDiscount) ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowCustomerBox(true)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/60 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition"
          >
            <ScanLine size={13} className="text-cyan-400" />
            <span>{tx(lang, 'Müştəri / Bonus', 'Клиент / Бонус', 'Customer / Bonus')}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowDiscountBox(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/60 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition"
          >
            <span>🏷️ {tx(lang, 'Endirim %', 'Скидка %', 'Discount %')}</span>
          </button>
        </div>
      ) : null}

      {(showCustomerBox || hasActiveCustomer) && (
        <div className="staff-customer-controls">
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1 min-w-0">
              <ScanLine className="staff-search-icon" size={14} />
              <input
                placeholder={tx(lang, 'Skan et...', 'Сканируйте...', 'Scan...')}
                className="staff-search-input !min-h-8 h-8 pl-9 pr-2 text-xs"
                value={ctx.customerQR}
                onChange={(e) => patchCtx({ customerQR: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleFindCustomer()}
              />
            </div>
            <button onClick={handleFindCustomer} className="staff-head-btn !min-h-8 h-8 px-2.5 py-1 text-xs shrink-0">{tx(lang, 'Oxu', 'ОК', 'Read')}</button>
            <button
              onClick={() => {
                patchCtx({ customer: null, customerQR: '', rewardClaimCode: '' });
                setShowCustomerBox(false);
              }}
              className="staff-head-btn !min-h-8 h-8 px-2 py-1 text-xs shrink-0"
            >
              ✕
            </button>
          </div>
          <input
            placeholder={tx(lang, 'Reward/Feedback kodu', 'Код reward/feedback', 'Reward/Feedback code')}
            className="staff-search-input !min-h-8 h-8 text-xs"
            value={ctx.rewardClaimCode || ''}
            onChange={(e) => patchCtx({ rewardClaimCode: e.target.value.toUpperCase() })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleRewardCodeEnter();
              }
            }}
          />
          {feedbackCouponPreview ? (
            <div className={`rounded-md border px-2 py-1 text-xs ${feedbackCouponPreview.status === 'PENDING' ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200' : 'border-slate-600/60 bg-slate-700/30 text-slate-300'}`}>
              {feedbackCouponPreview.status === 'PENDING'
                ? tx(lang, `Feedback kuponu aktivdir: -${feedbackCouponPreview.percent}%`, `Купон feedback активен: -${feedbackCouponPreview.percent}%`, `Feedback coupon active: -${feedbackCouponPreview.percent}%`)
                : tx(lang, 'Bu feedback kuponu artıq istifadə olunub', 'Этот feedback купон уже использован', 'This feedback coupon is already used')}
            </div>
          ) : null}
        </div>
      )}

      {(showDiscountBox || hasActiveDiscount) && (
        <div className="staff-mode-group">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-400 shrink-0">{tx(lang, 'Endirim', 'Скидка', 'Disc.')}</span>
            {!hasClaimCode && (
              <div className="grid grid-cols-5 gap-1 flex-1">
                {['0', '5', '10', '15', '20'].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      patchCtx({ discount: val });
                      if (val === '0') setShowDiscountBox(false);
                    }}
                    className={`!min-h-7 h-7 rounded-lg border text-xs font-semibold transition ${
                      (ctx.discount || '0') === val ? 'staff-payment-btn-active' : 'border-slate-700 bg-slate-800/40 text-slate-300'
                    }`}
                  >
                    {val}%
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                patchCtx({ discount: '0', discountReason: '' });
                setShowDiscountBox(false);
              }}
              className="text-xs text-slate-400 hover:text-white px-1"
            >
              ✕
            </button>
          </div>
          {parseFloat(ctx.discount || '0') > 0 && (
            <div className="mt-1">
              <input
                type="text"
                value={ctx.discountReason}
                onChange={(e) => patchCtx({ discountReason: e.target.value })}
                placeholder={tx(lang, 'Endirim səbəbi (məs. Müştəri məmnuniyyəti)', 'Причина скидки', 'Discount reason')}
                className="staff-search-input !min-h-8 h-8 text-xs"
                required
              />
            </div>
          )}
        </div>
      )}



      <div className="staff-cart-items">
        {cart.length === 0 && <div className="pt-8 text-center text-sm text-slate-500">{t.cart_empty}</div>}
        {cart.map((item) => (
          <StaffCartItem key={item.line_id} item={item} updateCartItem={updateCartItem} toDecimalSafe={props.toDecimalSafe} />
        ))}
      </div>

      <div className="staff-summary">
        <div className="mb-1 flex justify-between text-slate-300"><span>{tx(lang, 'Ara cəm', 'Промежуточный итог', 'Subtotal')}</span><span>{rawTotal.toFixed(2)} ₼</span></div>
        <div className="mb-1 flex justify-between text-slate-300"><span>{tx(lang, 'Endirim', 'Скидка', 'Discount')}</span><span>- {discountAmount.toFixed(2)} ₼</span></div>
        <div className="flex justify-between border-t border-slate-700/60 pt-2 text-2xl font-bold text-slate-100"><span>{tx(lang, 'Yekun', 'Итого', 'Total')}</span><span>{checkoutBaseTotal.toFixed(2)} ₼</span></div>
      </div>

      <div className="staff-mode-group">
        <div className="staff-group-label">{tx(lang, 'Ödəniş üsulu', 'Способ оплаты', 'Payment method')}</div>
        <StaffPaymentSelector selectedPayment={selectedPayment} setSelectedPayment={setSelectedPayment} isLoading={isLoading} tx={tx} lang={lang} />
      </div>

      {selectedPayment === 'Split' && (
        <div className="staff-mode-group">
          <label className="mb-1 block text-slate-300 text-sm">{tx(lang, 'Nağd hissə', 'Наличная часть', 'Cash part')}</label>
          <input type="number" min={0} step="0.01" max={checkoutBaseTotal.toNumber()} value={splitCashInput} onChange={(e) => setSplitCashInput(e.target.value)} className="staff-search-input" />
        </div>
      )}

      {shouldLockTableCheckoutInPos && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {tx(
            lang,
            'Bu masa hesabı POS səbətindən bağlanmır. Ödəniş üçün Masalar moduluna keçin.',
            'Этот счет стола не закрывается из POS корзины. Для оплаты перейдите в модуль Столы.',
            'This table bill cannot be closed from the POS cart. Use the Tables module to collect payment.',
          )}
        </div>
      )}

      {ctx.orderType === 'Dine In' && ctx.selectedTable ? (
        <StaffCheckoutButton disabled={isLoading || !ctx.selectedTable || cart.length === 0} onClick={() => { void handleSendToKitchen(); }} label={tx(lang, 'Masaya Göndər', 'Отправить на стол', 'Send To Table')} />
      ) : (
        <StaffCheckoutButton
          disabled={isLoading || shouldLockTableCheckoutInPos || (cart.length === 0 && !shouldLockTableCheckoutInPos) || (ctx.orderType === 'Dine In' && !ctx.selectedTable)}
          onClick={() => { void handleCheckout(selectedPayment); }}
          label={tx(lang, 'Ödənişi Tamamla', 'Завершить оплату', 'Complete Payment')}
        />
      )}
    </aside>
  );
}

export default function StaffPosMode(props: StaffPosModeProps) {
  const { tx, lang, t } = props;
  return (
    <StaffPosShell>
      <StaffPosHeader
        businessName={props.businessName}
        tx={tx}
        lang={lang}
        onSync={props.handleSyncOfflineQueue}
        isSyncingOffline={props.isSyncingOffline}
        onClear={() => props.requestClearCart(props.activeCart)}
        disableClear={!props.cart.length || props.isLoading}
      />

      <div className="staff-pos-workspace">
        <section className="staff-pos-main">
          <StaffSearchBar value={props.search} onChange={props.setSearch} placeholder={t.search} />
          <StaffCategoryTabs categories={props.categories} category={props.category} setCategory={props.setCategory} allLabel={t.all_categories} />
          <StaffProductGrid
            groups={props.groupedMenu}
            getGroupQty={props.getGroupQty}
            increaseGroupQty={props.increaseGroupQty}
            decreaseGroupQty={props.decreaseGroupQty}
            openProductPicker={props.openProductPicker}
            toDecimalSafe={props.toDecimalSafe}
          />
        </section>

        <StaffCartPanel {...props} />
      </div>
    </StaffPosShell>
  );
}
