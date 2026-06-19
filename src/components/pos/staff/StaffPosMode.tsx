import React from 'react';
import { Check, Minus, Plus, ScanLine, Search, ShoppingCart } from 'lucide-react';

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
  getGroupQty: (group: { items: any[] }) => number;
  increaseGroupQty: (group: { items: any[] }) => void;
  decreaseGroupQty: (group: { items: any[] }) => void;
  openProductPicker: (group: { base: string; items: any[] }) => void;
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
  const { businessName, tx, lang, onSync, isSyncingOffline, onClear, disableClear } = props;
  return (
    <header className="staff-pos-header">
      <div>
        <div className="staff-pos-kicker">{tx(lang, 'Staff POS', 'Staff POS', 'Staff POS')}</div>
        <div className="staff-pos-title">{businessName || 'IRONWAVES POS'}</div>
      </div>
      <div className="staff-pos-header-actions">
        <button className="staff-head-btn" onClick={() => void onSync()} disabled={isSyncingOffline}>
          {isSyncingOffline ? tx(lang, 'Sync...', 'Синк...', 'Sync...') : tx(lang, 'Sync', 'Синк', 'Sync')}
        </button>
        <button className="staff-head-btn" onClick={onClear} disabled={disableClear}>
          {tx(lang, 'Səbəti sil', 'Очистить корзину', 'Clear cart')}
        </button>
      </div>
    </header>
  );
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
    <article className={`staff-product-card ${qtyInCart > 0 ? 'staff-product-card-active' : ''}`}>
      <button className="staff-product-image-wrap" onClick={onPlus}>
        {group.image_url ? (
          <img src={group.image_url} alt={group.base} className="staff-product-image" />
        ) : (
          <div className="staff-product-fallback">
            <span className="staff-product-fallback-mark">{initials || fallbackLabel}</span>
          </div>
        )}
      </button>
      <div className="staff-product-body">
        <div className="staff-product-name">{group.base}</div>
        <div className="staff-product-sub">{group.description || group.category}</div>
        <div className="staff-product-price">{minPrice.toFixed(2)} ₼</div>
      </div>
      <div className="staff-qty-row">
        <button className="staff-qty-btn" onClick={onMinus} disabled={qtyInCart <= 0}>
          <Minus size={15} />
        </button>
        <div className="staff-qty-value">{qtyInCart}</div>
        <button className="staff-qty-btn" onClick={onPlus}>
          <Plus size={15} />
        </button>
        {hasVariants ? (
          <button className="staff-variant-btn" onClick={onOpenVariant}>
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
        <button className="staff-qty-btn" onClick={() => updateCartItem(item.line_id, item.qty - 1)}>
          <Minus size={13} />
        </button>
        <span className="staff-qty-value">{item.qty}</span>
        <button className="staff-qty-btn" onClick={() => updateCartItem(item.line_id, item.qty + 1)}>
          <Plus size={13} />
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
    feedbackCouponPreview, hasClaimCode, tables, selectedPayment, setSelectedPayment, isLoading, splitCashInput,
    setSplitCashInput, rawTotal, discountAmount, updateCartItem, shouldLockTableCheckoutInPos,
    handleSendToKitchen, handleCheckout,
  } = props;
  return (
    <aside className="staff-cart-panel">
      <div className="staff-cart-head">
        <h3 className="staff-cart-title"><ShoppingCart size={18} /> {t.cart.toUpperCase()} {activeCart.slice(1)}</h3>
        <div className="staff-cart-total-head">{checkoutBaseTotal.toFixed(2)} ₼</div>
      </div>

      <div className="staff-customer-controls">
        <div className="relative">
          <ScanLine className="staff-search-icon" size={16} />
          <input
            placeholder={tx(lang, 'Skan et...', 'Сканируйте...', 'Scan...')}
            className="staff-search-input pl-10"
            value={ctx.customerQR}
            onChange={(e) => patchCtx({ customerQR: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && handleFindCustomer()}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={handleFindCustomer} className="staff-head-btn">{tx(lang, 'Müştəri Tap', 'Найти клиента', 'Find Customer')}</button>
          <button onClick={() => patchCtx({ customer: null, customerQR: '', rewardClaimCode: '' })} className="staff-head-btn">{tx(lang, 'Təmizlə', 'Очистить', 'Clear')}</button>
        </div>
        <input
          placeholder={tx(lang, 'Reward/Feedback kodu', 'Код reward/feedback', 'Reward/Feedback code')}
          className="staff-search-input"
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
        <input
          type="number"
          min={0}
          max={100}
          value={ctx.discount}
          onChange={(e) => patchCtx({ discount: e.target.value })}
          disabled={hasClaimCode}
          className={`staff-search-input ${hasClaimCode ? 'cursor-not-allowed opacity-60' : ''}`}
          placeholder={tx(lang, 'Endirim %', 'Скидка %', 'Discount %')}
        />
      </div>

      {tables.length > 0 && (
        <div className="staff-mode-group">
          <select
            value={ctx.selectedTable}
            onChange={(e) => patchCtx({ selectedTable: e.target.value, orderType: e.target.value ? 'Dine In' : 'Take Away' })}
            className="staff-search-input"
          >
            <option value="">{tx(lang, 'Tez Satış (Masa yoxdur)', 'Быстрая продажа (Без стола)', 'Quick Sale (No table)')}</option>
            {tables.map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}
          </select>
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
