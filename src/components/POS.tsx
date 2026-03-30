import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { Search, ShoppingCart, ClipboardList, Plus, Minus, Check, ScanLine, ChevronDown } from 'lucide-react';
import { useAppStore } from '../store';
import { get_menu_for_pos, create_sale, calculate_total, calculate_staff_payable } from '../api/pos';
import { get_tables_live, send_to_kitchen_live, pay_table_live } from '../api/tables';
import { get_shift_status, refresh_shift_status } from '../api/reports';
import { getDB } from '../lib/db_sim';
import { i18n, tx } from '../i18n';
import { get_business_profile, get_settings } from '../api/settings';
import { logUiError } from '../lib/logger';
import { qzPrintHtml } from '../lib/qz';
import {
  cacheMenuOffline,
  clearSyncedOfflineSales,
  enqueueOfflineSale,
  getCachedMenuOffline,
  getPendingOfflineSales,
  getPendingOfflineSalesCount,
  syncPendingOfflineSales,
  type OfflineSaleSummary,
} from '../lib/offline';
import { apiRequest, isBackendEnabled } from '../api/client';

type OrderType = 'Dine In' | 'Take Away' | 'Order Online';
type PaymentMethod = 'Nəğd' | 'Kart' | 'Split' | 'Staff';
type PosCartItem = {
  id: string;
  item_name: string;
  price: string;
  category: string;
  is_coffee: boolean;
  qty: number;
};

type CartContext = {
  customerQR: string;
  customer: any | null;
  discount: string;
  selectedTable: string;
  orderType: OrderType;
  cupMode: 'paper' | 'glass';
  kitchenSent?: boolean;
  rewardClaimCode?: string;
};

const SIZE_TOKENS = ['XS', 'S', 'M', 'L', 'XL', 'DOUBLE', 'SINGLE'];

const toDecimalSafe = (value: unknown, fallback: string = '0') => {
  try {
    const normalized = String(value ?? '').trim();
    if (!normalized) return new Decimal(fallback);
    return new Decimal(normalized);
  } catch {
    return new Decimal(fallback);
  }
};

function splitVariantName(name: string) {
  const trimmed = (name || '').trim();
  const parts = trimmed.split(/\s+/);
  const last = (parts[parts.length - 1] || '').toUpperCase();
  if (SIZE_TOKENS.includes(last) && parts.length > 1) {
    return {
      base: parts.slice(0, -1).join(' '),
      variant: parts[parts.length - 1],
    };
  }
  return { base: trimmed, variant: null as string | null };
}

const isCoffeeLike = (item: { is_coffee?: boolean; category?: string; item_name?: string }) => {
  if (item.is_coffee) return true;
  const category = (item.category || '').toLowerCase();
  const name = (item.item_name || '').toLowerCase();
  return (
    category.includes('kofe') ||
    category.includes('qəhvə') ||
    category.includes('qehve') ||
    category.includes('coffee') ||
    name.includes('kofe') ||
    name.includes('qəhvə') ||
    name.includes('qehve') ||
    name.includes('coffee')
  );
};

const defaultCtx: CartContext = {
  customerQR: '',
  customer: null,
  discount: '0',
  selectedTable: '',
  orderType: 'Take Away',
  cupMode: 'paper',
  kitchenSent: false,
  rewardClaimCode: '',
};

const formatDisplayId = (id: string) => {
  if (!id) return '-';
  return id.split('-')[0].toUpperCase();
};

const generateBarcodeSvg = (value: string) => {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, value, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      width: 1.2,
      height: 34,
    });
    return svg.outerHTML;
  } catch {
    return '';
  }
};

const isRecoverableNetworkFailure = (error: unknown) => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('backendə qoşulma alınmadı') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('network')
  );
};

const generateOfflineRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `offline_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export default function POS() {
  const { user, lang, notify } = useAppStore();
  const safeLang = (lang === 'az' || lang === 'ru' || lang === 'en') ? lang : 'az';
  const t = i18n[safeLang];
  const tenantId = user?.tenant_id || 'tenant_default';

  const [menu, setMenu] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [activeCart, setActiveCart] = useState<'S1' | 'S2' | 'S3'>('S1');
  const [carts, setCarts] = useState<Record<'S1' | 'S2' | 'S3', PosCartItem[]>>({ S1: [], S2: [], S3: [] });
  const [cartCtx, setCartCtx] = useState<Record<'S1' | 'S2' | 'S3', CartContext>>({
    S1: { ...defaultCtx },
    S2: { ...defaultCtx },
    S3: { ...defaultCtx },
  });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [isLoading, setIsLoading] = useState(false);
  const [receiptHtml, setReceiptHtml] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>('Nəğd');
  const [splitCashInput, setSplitCashInput] = useState<string>('0');
  const [variantPicker, setVariantPicker] = useState<{ base: string; items: any[] } | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [pendingOfflineSales, setPendingOfflineSales] = useState<OfflineSaleSummary[]>([]);
  const [showOfflineQueue, setShowOfflineQueue] = useState(false);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [mobilePane, setMobilePane] = useState<'menu' | 'cart'>('menu');
  const [showMobileCheckout, setShowMobileCheckout] = useState(false);
  const receiptIframeRef = useRef<HTMLIFrameElement | null>(null);
  const businessProfile = get_business_profile(tenantId);
  const printSettings = get_settings(tenantId).print_settings || { use_qz: false, printer_name: '' };

  useEffect(() => {
    const raw = localStorage.getItem(`${tenantId}_pos_carts`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const sanitizeCart = (rows: any[]) =>
          (Array.isArray(rows) ? rows : [])
            .filter((row) => row && typeof row === 'object' && typeof row.id === 'string')
            .map((row) => ({
              id: String(row.id),
              item_name: String(row.item_name || 'Məhsul'),
              price: toDecimalSafe(row.price).toFixed(2),
              category: String(row.category || 'Digər'),
              is_coffee: Boolean(row.is_coffee),
              qty: Math.max(1, Number(row.qty || 1)),
            }));

        setCarts({
          S1: sanitizeCart(parsed.S1),
          S2: sanitizeCart(parsed.S2),
          S3: sanitizeCart(parsed.S3),
        });
      } catch {
        // ignore invalid local cart data
      }
    }
  }, [tenantId]);

  useEffect(() => {
    const rawCtx = localStorage.getItem(`${tenantId}_pos_cart_ctx`);
    if (rawCtx) {
      try {
        const parsed = JSON.parse(rawCtx);
        setCartCtx({
          S1: { ...defaultCtx, ...(parsed.S1 || {}) },
          S2: { ...defaultCtx, ...(parsed.S2 || {}) },
          S3: { ...defaultCtx, ...(parsed.S3 || {}) },
        });
      } catch {
        // ignore invalid persisted context
      }
    }

    const rawActive = localStorage.getItem(`${tenantId}_pos_active_cart`);
    if (rawActive === 'S1' || rawActive === 'S2' || rawActive === 'S3') {
      setActiveCart(rawActive);
    }
  }, [tenantId]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      localStorage.setItem(`${tenantId}_pos_carts`, JSON.stringify(carts));
    }, 120);
    return () => window.clearTimeout(t);
  }, [tenantId, carts]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      localStorage.setItem(`${tenantId}_pos_cart_ctx`, JSON.stringify(cartCtx));
      localStorage.setItem(`${tenantId}_pos_active_cart`, activeCart);
    }, 120);
    return () => window.clearTimeout(t);
  }, [tenantId, cartCtx, activeCart]);

  const cart = carts[activeCart];
  const ctx = cartCtx[activeCart];

  const patchCtx = (patch: Partial<CartContext>) => {
    setCartCtx((prev) => ({
      ...prev,
      [activeCart]: {
        ...prev[activeCart],
        ...patch,
      },
    }));
  };

  const addToCart = (item: any) => {
    setCarts((prev) => {
      const existing = prev[activeCart].find((c) => c.id === item.id);
      if (existing) {
        return {
          ...prev,
          [activeCart]: prev[activeCart].map((c) => (c.id === item.id ? { ...c, qty: c.qty + 1 } : c)),
        };
      }
      return {
        ...prev,
        [activeCart]: [
          ...prev[activeCart],
          {
            id: item.id,
            item_name: item.item_name,
            price: item.price,
            category: item.category,
            is_coffee: isCoffeeLike(item),
            qty: 1,
          },
        ],
      };
    });
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      setMobilePane('cart');
    }
  };

  const updateCartItem = (id: string, qty: number) => {
    setCarts((prev) => ({
      ...prev,
      [activeCart]:
        qty <= 0 ? prev[activeCart].filter((c) => c.id !== id) : prev[activeCart].map((c) => (c.id === id ? { ...c, qty } : c)),
    }));
  };

  const clearCart = (key: 'S1' | 'S2' | 'S3' = activeCart) => {
    setCarts((prev) => ({ ...prev, [key]: [] }));
  };

  const refreshOfflineState = async () => {
    const [count, rows] = await Promise.all([
      getPendingOfflineSalesCount(tenantId),
      getPendingOfflineSales(tenantId),
    ]);
    setPendingSyncCount(count);
    setPendingOfflineSales(rows);
  };

  const refreshData = async () => {
    try {
      const nextMenu = isBackendEnabled()
        ? await apiRequest<any[]>('/api/v1/pos/menu')
        : get_menu_for_pos(tenantId);
      const nextTables = await get_tables_live(tenantId);
      setMenu(Array.isArray(nextMenu) ? nextMenu : []);
      setTables(Array.isArray(nextTables) ? nextTables : []);
      if (Array.isArray(nextMenu)) {
        void cacheMenuOffline(tenantId, nextMenu);
      }
      void refreshOfflineState();
    } catch (e) {
      console.error('POS refreshData failed:', e);
      logUiError(tenantId, 'pos', e instanceof Error ? e.message : String(e), { phase: 'refreshData' });
      void getCachedMenuOffline(tenantId).then((cached) => {
        setMenu(Array.isArray(cached) ? (cached as any[]) : []);
      });
      setTables([]);
      void refreshOfflineState();
      notify('error', tx(safeLang, 'POS məlumatları yüklənmədi', 'Не удалось загрузить данные POS', 'Failed to load POS data'));
    }
  };

  useEffect(() => {
    void refreshData();
  }, [tenantId]);

  useEffect(() => {
    const handleRefresh = () => {
      void refreshData();
      void refreshOfflineState();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshData();
      }
    };
    window.addEventListener('focus', handleRefresh);
    window.addEventListener('catalog-updated', handleRefresh as EventListener);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleRefresh);
      window.removeEventListener('catalog-updated', handleRefresh as EventListener);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [tenantId]);

  useEffect(() => {
    void refreshOfflineState();
    const timer = window.setInterval(() => {
      void refreshOfflineState();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [tenantId]);

  const categories = useMemo(() => ['ALL', ...Array.from(new Set(menu.map((m) => m.category)))], [menu]);

  const selectedTableData = useMemo(
    () => tables.find((t) => t.id === ctx.selectedTable),
    [tables, ctx.selectedTable],
  );

  const occupiedTables = useMemo(
    () => tables.filter((t) => t.is_occupied),
    [tables],
  );

  const tablePendingTotal = useMemo(() => {
    if (!selectedTableData?.is_occupied) return new Decimal(0);
    return toDecimalSafe(selectedTableData.total || 0);
  }, [selectedTableData]);

  const filteredMenu = useMemo(() => {
    return menu.filter((item) => {
      const matchesCategory = category === 'ALL' || item.category === category;
      const matchesSearch = item.item_name.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [menu, category, search]);

  const groupedMenu = useMemo(() => {
    const groups = new Map<string, any[]>();
    filteredMenu.forEach((item) => {
      const { base } = splitVariantName(item.item_name);
      const key = (base || item.item_name || '').toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });

    return Array.from(groups.values()).map((items) => {
      const first = items[0];
      const firstSplit = splitVariantName(first.item_name);
      return {
        base: firstSplit.base || first.item_name,
        items: [...items].sort((a, b) => toDecimalSafe(a.price).minus(toDecimalSafe(b.price)).toNumber()),
      };
    });
  }, [filteredMenu]);

  const totals = useMemo(() => {
    const converted = cart.map((item) => ({
      price: toDecimalSafe(item.price),
      qty: item.qty,
      is_coffee: item.is_coffee,
      category: item.category,
    }));

    return calculate_total(
      converted,
      ctx.customer?.type || 'Normal',
      Number(ctx.discount || 0),
      false,
      null,
      ctx.customer ? Number(ctx.customer?.stars || 0) : null,
    );
  }, [cart, ctx.customer, ctx.discount]);

  const rawTotal = totals.raw_total;
  const discountAmount = totals.discount_amount;
  const finalTotal = totals.final_total;

  const staffPreview = useMemo(() => {
    const converted = cart.map((item) => ({
      price: toDecimalSafe(item.price),
      qty: item.qty,
      is_coffee: item.is_coffee,
      category: item.category,
      item_name: item.item_name,
    }));
    return calculate_staff_payable(converted as any, tenantId, user?.username || 'staff');
  }, [cart, tenantId, user?.username]);

  const payableTotal = selectedPayment === 'Staff' ? staffPreview.final_due : finalTotal;
  const checkoutBaseTotal = cart.length > 0 ? payableTotal : tablePendingTotal;

  const handleCheckout = async (paymentMethod: PaymentMethod) => {
    if (!user) return;
    const shift = await refresh_shift_status(tenantId).catch(() => get_shift_status(tenantId));
    if (shift.status !== 'Open') {
      notify('error', tx(safeLang, 'Əvvəlcə günü açın', 'Сначала откройте смену', 'Open shift first'));
      return;
    }

    // Dine In sifarişi artıq masaya göndərilibsə və səbət boşdursa, masanın ödənişini bağlayırıq.
    if (ctx.orderType === 'Dine In' && cart.length === 0 && selectedTableData?.is_occupied) {
      const splitCash = paymentMethod === 'Split' ? toDecimalSafe(splitCashInput || 0) : null;
      const splitCard = paymentMethod === 'Split' ? tablePendingTotal.minus(splitCash || 0) : null;
      if (paymentMethod === 'Split') {
        if ((splitCash || new Decimal(0)).lessThan(0) || (splitCard || new Decimal(0)).lessThan(0)) {
          notify('error', tx(safeLang, 'Bölünmüş məbləğ yanlışdır', 'Неверная сумма разделения'));
          return;
        }
      }

      setIsLoading(true);
      try {
        await pay_table_live(
          selectedTableData.id,
          paymentMethod,
          user.username,
          splitCash,
          splitCard,
          { cup_mode: ctx.cupMode },
        );
        notify('success', tx(safeLang, 'Masa ödəndi və bağlandı', 'Стол оплачен и закрыт'));
        patchCtx({ ...defaultCtx });
        setSplitCashInput('0');
        void refreshData();
      } catch (error: any) {
        logUiError(tenantId, 'pos', error?.message || String(error), { phase: 'pay_table_checkout' });
        notify('error', error?.message || tx(safeLang, 'Masa ödənişində xəta', 'Ошибка оплаты стола'));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (cart.length === 0) return;

      const splitCash = paymentMethod === 'Split' ? toDecimalSafe(splitCashInput || 0) : null;
    const splitCard = paymentMethod === 'Split' ? payableTotal.minus(splitCash || 0) : null;
    if (paymentMethod === 'Split') {
      if ((splitCash || new Decimal(0)).lessThan(0) || (splitCard || new Decimal(0)).lessThan(0)) {
        notify('error', tx(safeLang, 'Bölünmüş məbləğ yanlışdır', 'Неверная сумма разделения'));
        return;
      }
    }
    setIsLoading(true);

    try {
      const backendPayload = {
        offline_request_id: generateOfflineRequestId(),
        cart_items: cart.map((item) => ({
          item_name: item.item_name,
          price: toDecimalSafe(item.price).toFixed(2),
          qty: item.qty,
          is_coffee: item.is_coffee,
          category: item.category,
        })),
        payment_method: paymentMethod,
        discount_percent: Number(ctx.discount || 0),
        order_type: ctx.orderType,
        customer_card_id: ctx.customer?.card_id || null,
        reward_claim_code: ctx.rewardClaimCode || null,
        split_cash: splitCash ? splitCash.toFixed(2) : null,
        split_card: splitCard ? splitCard.toFixed(2) : null,
      };
      const localPayload = {
        tenant_id: tenantId,
        cart_items: cart.map((item) => ({
          item_name: item.item_name,
          price: toDecimalSafe(item.price),
          qty: item.qty,
          is_coffee: item.is_coffee,
          category: item.category,
        })),
        payment_method: paymentMethod,
        cashier: user.username,
        customer_card_id: ctx.customer?.card_id || null,
        reward_claim_code: ctx.rewardClaimCode || null,
        discount_percent: Number(ctx.discount || 0),
        is_eco_cup: false,
        is_test: false,
        split_cash: splitCash,
        split_card: splitCard,
        card_tips: new Decimal(0),
        customer_type: ctx.customer?.type || 'Normal',
        order_type: ctx.orderType,
        cup_mode: ctx.cupMode,
      };
      const useBackendNow = isBackendEnabled() && navigator.onLine;
      let sale: any;
      let queuedOffline = false;

      if (useBackendNow) {
        try {
          sale = await apiRequest<any>('/api/v1/pos/sale', {
            method: 'POST',
            tenantId: null,
            body: backendPayload,
          });
        } catch (error: any) {
          if (!isRecoverableNetworkFailure(error)) {
            throw error;
          }
          sale = create_sale(localPayload);
          void enqueueOfflineSale(tenantId, sale.sale_id, backendPayload);
          queuedOffline = true;
        }
      } else {
        sale = create_sale(localPayload);
        if (isBackendEnabled()) {
          void enqueueOfflineSale(tenantId, sale.sale_id, backendPayload);
          queuedOffline = true;
        }
      }

      const saleRaw = toDecimalSafe((sale as any)?.totals?.raw_total ?? rawTotal);
      const saleDiscount = toDecimalSafe((sale as any)?.totals?.discount_amount ?? discountAmount);
      const saleFinal = toDecimalSafe((sale as any)?.totals?.final_total ?? payableTotal);
      const saleFreeCoffees = Number((sale as any)?.totals?.free_coffees ?? totals.free_coffees ?? 0);

      const lines = cart
        .map(
          (item) =>
            `<tr><td style="padding:3px 0">${item.qty}x ${item.item_name}</td><td style="text-align:right">${toDecimalSafe(item.price)
              .times(item.qty)
              .toFixed(2)} ₼</td></tr>`,
        )
        .join('');
      const configuredBase = String(get_settings(tenantId).qr_settings?.base_url || businessProfile?.website || '').trim();
      const baseUrl = (configuredBase || window.location.origin).replace(/\/+$/, '');
      const receiptRef = (sale as any).receipt_code || sale.sale_id;
      const receiptUrl = `${baseUrl}/?r=${encodeURIComponent(receiptRef)}&t=${encodeURIComponent((sale as any).receipt_token || '')}`;
      const barcodeSvg = generateBarcodeSvg(`SALE:${sale.sale_id}`);
      const receiptCustomerId = String((sale as any)?.customer_card_id || ctx.customer?.card_id || '').trim();
      const receiptStarsAfter = Number((sale as any)?.customer_stars_after ?? totals.customer_stars_after ?? 0);
      const qrDataUrl = await QRCode.toDataURL(receiptUrl, {
        width: 156,
        margin: 2,
        errorCorrectionLevel: 'L',
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      });

      setReceiptHtml(`
        <html>
          <head>
            <style>
              @page { size: 80mm auto; margin: 4mm; }
              body { font-family: Inter, Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
              .line { display:flex; justify-content:space-between; gap:8px; margin: 2px 0; }
              .muted { color:#555; font-size:11px; }
              .bold { font-weight: 700; }
              hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
            </style>
          </head>
          <body style="font-family:Arial;padding:16px;max-width:320px;margin:0 auto">
            ${businessProfile?.logo_url ? `<img src="${businessProfile.logo_url}" style="height:34px;max-width:180px;object-fit:contain;margin-bottom:6px" />` : ''}
            <div class="bold" style="font-size:15px">${businessProfile?.company_name || 'IRONWAVES POS'}</div>
            <div class="muted">VÖEN: ${businessProfile?.voen || '-'}</div>
            <div class="muted">Tel: ${businessProfile?.phone || '-'}</div>
            <div class="muted">${businessProfile?.address || '-'}</div>
            <hr />
            <div class="line"><span>${tx(lang, 'Satış ID', 'ID продажи', 'Sale ID')}</span><span>${formatDisplayId(sale.sale_id)}</span></div>
            <div class="line"><span>${tx(lang, 'Operator', 'Оператор', 'Operator')}</span><span>${user.username}</span></div>
            <div class="line"><span>${tx(lang, 'Tarix', 'Дата', 'Date')}</span><span>${new Date().toLocaleString()}</span></div>
            <div class="line"><span>${tx(lang, 'Tip', 'Тип', 'Type')}</span><span>${ctx.orderType}</span></div>
            <div style="margin-top:8px;text-align:center">${barcodeSvg || ''}</div>
            <div class="muted" style="text-align:center">SALE:${formatDisplayId(sale.sale_id)}</div>
            <hr />
            <table style="width:100%;font-size:13px">${lines}</table>
            <hr />
            <div class="line"><span>${tx(lang, 'Ara cəm', 'Промежуточный итог', 'Subtotal')}</span><span>${saleRaw.toFixed(2)} ₼</span></div>
            <div class="line"><span>${tx(lang, 'Endirim', 'Скидка', 'Discount')}</span><span>- ${saleDiscount.toFixed(2)} ₼</span></div>
            ${saleFreeCoffees > 0 ? `<div class="line"><span>${tx(lang, 'Pulsuz kofe', 'Бесплатный кофе', 'Free coffee')}</span><span>${saleFreeCoffees}</span></div>` : ''}
            ${receiptCustomerId ? `<div class="line"><span>${tx(lang, 'Müştəri ID', 'ID клиента', 'Customer ID')}</span><span>${receiptCustomerId}</span></div>` : ''}
            ${receiptCustomerId ? `<div class="line"><span>${tx(lang, 'Ulduz balansı', 'Баланс звезд', 'Star Balance')}</span><span>${receiptStarsAfter}</span></div>` : ''}
            <div class="line bold" style="font-size:13px"><span>${tx(lang, 'Yekun', 'Итого', 'Total')}</span><span>${saleFinal.toFixed(2)} ₼</span></div>
            <hr />
            <div style="display:flex;justify-content:center;margin:8px 0 6px 0">
              <img src="${qrDataUrl}" alt="receipt qr" style="width:108px;height:108px" />
            </div>
            <hr />
            <div class="muted">${businessProfile?.receipt_footer || tx(lang, 'Bizi seçdiyiniz üçün təşəkkür edirik!', 'Спасибо, что выбрали нас!', 'Thank you for choosing us!')}</div>
          </body>
        </html>
      `);

      if (queuedOffline) {
        void refreshOfflineState();
        notify('info', tx(safeLang, 'Satış offline yadda saxlandı, bağlantı gələndə sinxron olacaq', 'Продажа сохранена офлайн и синхронизируется при подключении', 'Sale saved offline and will sync when connection returns'));
      }

      clearCart(activeCart);
      patchCtx({ ...defaultCtx });
      setSplitCashInput('0');
      void refreshData();
    } catch (error: any) {
        logUiError(tenantId, 'pos', error?.message || String(error), { phase: 'checkout_create_sale' });
        notify('error', error?.message || tx(lang, 'Satış zamanı xəta baş verdi', 'Ошибка при продаже', 'An error occurred during the sale'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendToKitchen = async () => {
    if (!ctx.selectedTable || cart.length === 0 || !user) return;
    try {
      await send_to_kitchen_live(
        ctx.selectedTable,
        cart.map((c) => ({ ...c, price: toDecimalSafe(c.price) })) as any,
        user.username,
        { cup_mode: ctx.cupMode },
      );
      clearCart(activeCart);
      patchCtx({ kitchenSent: true });
      void refreshData();
      notify('success', tx(lang, 'Sifariş mətbəxə göndərildi. Ödəniş üçün masa seçimi saxlanıldı.', 'Заказ отправлен на кухню. Для оплаты стол сохранен.', 'Order sent to the kitchen. The table remains open for payment.'));
    } catch (error: any) {
      logUiError(tenantId, 'pos', error?.message || String(error), { phase: 'send_to_kitchen' });
      notify('error', error?.message || tx(lang, 'Mətbəxə göndərmə alınmadı', 'Не удалось отправить на кухню', 'Failed to send the order to the kitchen'));
    }
  };

  const handleFindCustomer = () => {
    const code = (ctx.customerQR || '').trim();
    if (!code) return;
    const extracted = code.includes('id=') ? code.split('id=')[1]?.split('&')[0] : code;
    const customers = getDB<any>(`${tenantId}_customers`) || [];
    const found = customers.find((c: any) => c.card_id === extracted);
    if (!found) {
      notify('error', tx(lang, 'Müştəri tapılmadı', 'Клиент не найден', 'Customer not found'));
      return;
    }
    patchCtx({ customer: found });
    notify('success', tx(lang, 'Müştəri tapıldı', 'Клиент найден', 'Customer found'));
  };

  const printReceiptOnly = async () => {
    if (printSettings.use_qz && receiptHtml) {
      try {
        await qzPrintHtml(receiptHtml, printSettings.printer_name);
        notify('success', tx(lang, 'QZ Tray ilə çap göndərildi', 'Печать отправлена через QZ Tray', 'Print job sent via QZ Tray'));
        return;
      } catch (e: any) {
        notify('error', tx(lang, `QZ çap alınmadı, brauzerə keçilir: ${e.message || e}`, `QZ печать не удалась, переход к печати браузера: ${e.message || e}`, `QZ printing failed, falling back to browser printing: ${e.message || e}`));
      }
    }
    const frame = receiptIframeRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  const handleSyncOfflineQueue = async () => {
    if (isSyncingOffline) return;
    setIsSyncingOffline(true);
    try {
      const result = await syncPendingOfflineSales(tenantId);
      await clearSyncedOfflineSales(tenantId);
      await refreshOfflineState();
      if (result.synced > 0) {
        notify('success', tx(safeLang, `${result.synced} offline satış göndərildi`, `${result.synced} офлайн продаж отправлено`, `${result.synced} offline sales sent`));
      }
      if ((result.failed || 0) > 0) {
        notify('error', tx(safeLang, `${result.failed} satış hələ də gözləyir`, `${result.failed} продаж все еще ожидают`, `${result.failed} sales are still pending`));
      }
      if (!result.synced && !result.failed) {
        notify('info', tx(safeLang, 'Gözləyən offline satış yoxdur', 'Ожидающих офлайн продаж нет', 'No pending offline sales'));
      }
    } finally {
      setIsSyncingOffline(false);
    }
  };

  if (receiptHtml) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#121922] p-6">
        <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-[#101722] p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-100">{tx(lang, 'Çek Hazırdır', 'Чек готов', 'Receipt Ready')}</h3>
            <div className="flex gap-2">
              <button
                onClick={printReceiptOnly}
                className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-slate-900"
              >
                {tx(lang, 'Çap Et', 'Печать', 'Print')}
              </button>
              <button
                onClick={() => setReceiptHtml(null)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200"
              >
                {tx(lang, 'Bağla', 'Закрыть', 'Close')}
              </button>
            </div>
          </div>
          <iframe ref={receiptIframeRef} title="receipt" srcDoc={receiptHtml} className="h-[70vh] w-full rounded-lg bg-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,#2a3342,#141b24_55%)] px-3 pb-24 pt-3 text-slate-200 md:px-4 md:pb-3 xl:px-6">

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <button onClick={() => setActiveCart('S1')} className={`neon-tab ${activeCart === 'S1' ? 'neon-tab-active' : ''}`}>
          <ShoppingCart size={14} /> {t.cart} 1 ({carts.S1.length})
        </button>
        <button onClick={() => setActiveCart('S2')} className={`neon-tab ${activeCart === 'S2' ? 'neon-tab-active' : ''}`}>
          <ShoppingCart size={14} /> {t.cart} 2 ({carts.S2.length})
        </button>
        <button onClick={() => setActiveCart('S3')} className={`neon-tab ${activeCart === 'S3' ? 'neon-tab-active' : ''}`}>
          <ShoppingCart size={14} /> {t.cart} 3 ({carts.S3.length})
        </button>
      </div>

      {pendingSyncCount > 0 && (
        <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-amber-100">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-semibold">
                {tx(safeLang, `${pendingSyncCount} satış sinxronizasiya gözləyir`, `${pendingSyncCount} продаж ожидают синхронизации`, `${pendingSyncCount} sales pending sync`)}
              </div>
              <div className="mt-1 text-xs text-amber-200/90">
                {tx(safeLang, 'Bağlantı gələndə göndərilir, istəsəniz əl ilə də sync edə bilərsiniz', 'При подключении отправится автоматически, но можно синхронизировать вручную', 'It syncs automatically when back online, or you can sync manually')}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowOfflineQueue((prev) => !prev)}
                className="rounded-lg border border-amber-300/40 px-3 py-2 text-xs font-semibold text-amber-50"
              >
                {showOfflineQueue
                  ? tx(safeLang, 'Siyahını gizlət', 'Скрыть список', 'Hide list')
                  : tx(safeLang, 'Siyahını göstər', 'Показать список', 'Show list')}
              </button>
              <button
                onClick={handleSyncOfflineQueue}
                disabled={isSyncingOffline}
                className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSyncingOffline
                  ? tx(safeLang, 'Göndərilir...', 'Отправка...', 'Syncing...')
                  : tx(safeLang, 'İndi sync et', 'Синхронизировать', 'Sync now')}
              </button>
            </div>
          </div>
          {showOfflineQueue && (
            <div className="mt-3 grid gap-2">
              {pendingOfflineSales.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-amber-300/20 bg-slate-950/20 px-3 py-3 text-xs text-amber-50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">{row.sale_id.slice(0, 8).toUpperCase()}</div>
                    <div className="text-amber-200/80">{new Date(row.created_at).toLocaleString()}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-amber-100/90">
                    <span>{row.item_count} {tx(safeLang, 'məhsul', 'товар', 'items')}</span>
                    <span>{row.payment_method}</span>
                    <span>{row.order_type}</span>
                    <span>{row.total} ₼</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 xl:hidden">
        <button onClick={() => setMobilePane('menu')} className={`neon-chip justify-center ${mobilePane === 'menu' ? 'neon-chip-active' : ''}`}>
          {tx(lang, 'Menyu', 'Меню', 'Menu')}
        </button>
        <button onClick={() => setMobilePane('cart')} className={`neon-chip justify-center ${mobilePane === 'cart' ? 'neon-chip-active' : ''}`}>
          {tx(lang, 'Səbət və Ödəniş', 'Корзина и оплата', 'Cart & Pay')}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[1fr_460px]">
        <section className={`flex min-h-0 flex-col ${mobilePane !== 'menu' ? 'hidden xl:flex' : ''}`}>
          <div className="mb-3 flex items-center gap-2 text-sm text-slate-300">
            <span className="text-yellow-300">•</span> {tx(lang, 'POS Menyu', 'POS меню', 'POS Menu')}
          </div>

          <div className="relative mb-3">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="neon-input pl-10"
              placeholder={t.search}
            />
          </div>

          <div className="mb-3 flex flex-wrap gap-2 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`neon-chip ${category === cat ? 'neon-chip-active' : ''}`}
              >
                {cat === 'ALL' ? t.all_categories : cat}
              </button>
            ))}
          </div>

          <div className="grid flex-1 auto-rows-max grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2 2xl:grid-cols-4">
            {groupedMenu.map((group) => {
              const hasVariants = group.items.length > 1;
              const minPrice = group.items.reduce(
                (acc, cur) => Decimal.min(acc, toDecimalSafe(cur.price)),
                toDecimalSafe(group.items[0].price),
              );

              return (
                <button
                  key={`${group.base}_${group.items.length}`}
                  onClick={() => {
                    if (hasVariants) {
                      setVariantPicker({ base: group.base, items: group.items });
                      return;
                    }
                    addToCart(group.items[0]);
                  }}
                  className="neon-item min-h-14 p-3 text-left"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span>{group.base}</span>
                    <span className="text-slate-300">
                      {minPrice.toFixed(2)} ₼ {hasVariants ? '▾' : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className={`flex h-full min-h-0 flex-col overflow-y-auto rounded-xl border border-slate-700/70 bg-[#101722]/80 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)] md:p-4 ${mobilePane !== 'cart' ? 'hidden xl:flex' : ''}`}>
          <div className="mb-3 flex items-center justify-between border-b border-slate-700/60 pb-3">
            <h3 className="flex items-center gap-2 text-2xl font-bold"><ShoppingCart size={22} /> {t.cart.toUpperCase()} {activeCart.slice(1)}</h3>
            <button className="rounded-lg border border-slate-600 p-2"><ClipboardList size={16} /></button>
          </div>

          <div className="relative mb-3">
            <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                placeholder={tx(lang, 'Skan et...', 'Сканируйте...')}
              className="neon-input pl-9"
              value={ctx.customerQR}
              onChange={(e) => patchCtx({ customerQR: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleFindCustomer()}
            />
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <button onClick={handleFindCustomer} className="pay-btn h-12 w-full">{tx(lang, 'Müştəri Tap', 'Найти клиента', 'Find Customer')}</button>
            <button onClick={() => patchCtx({ customer: null, customerQR: '', rewardClaimCode: '' })} className="pay-btn h-12 w-full">{tx(lang, 'Təmizlə', 'Очистить', 'Clear')}</button>
          </div>
          {ctx.customer && (
            <div className="mb-3 rounded-md border border-emerald-400/40 bg-emerald-500/10 p-2 text-xs text-emerald-200">
               QR: {ctx.customer.card_id} | {tx(lang, 'Ulduz', 'Звезды', 'Stars')}: {ctx.customer.stars} | {tx(lang, 'Tip', 'Тип', 'Type')}: {ctx.customer.type}
            </div>
          )}
          <input
            placeholder={tx(lang, 'Reward kodu (opsional)', 'Код награды (необязательно)', 'Reward code (optional)')}
            className="neon-input mb-2"
            value={ctx.rewardClaimCode || ''}
            onChange={(e) => patchCtx({ rewardClaimCode: e.target.value.toUpperCase() })}
          />

          <label className="mb-1 text-xs text-slate-400">{tx(lang, 'Endirim %', 'Скидка %', 'Discount %')}</label>
          <input
            type="number"
            min={0}
            max={100}
            value={ctx.discount}
            onChange={(e) => patchCtx({ discount: e.target.value })}
            className="neon-input mb-2"
          />

          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(['Take Away', 'Dine In', 'Order Online'] as OrderType[]).map((mode) => (
              <button
                key={mode}
                onClick={() => patchCtx({ orderType: mode })}
                className={`rounded-md border px-2 py-3 text-xs font-semibold ${
                  ctx.orderType === mode
                    ? 'border-yellow-300 bg-yellow-400 text-slate-900'
                    : 'border-slate-600 bg-slate-800/40 text-slate-200'
                }`}
              >
                {mode === 'Dine In'
                  ? tx(lang, 'Masada', 'В зале', 'Dine In')
                  : mode === 'Take Away'
                  ? tx(lang, 'Al-apar', 'С собой', 'Take Away')
                  : tx(lang, 'Onlayn', 'Онлайн', 'Online')}
              </button>
            ))}
          </div>

          {ctx.orderType === 'Dine In' && (
            <div className="mb-3 space-y-2">
              <div className="relative">
                <select
                  value={ctx.selectedTable}
                  onChange={(e) => patchCtx({ selectedTable: e.target.value })}
                  className="neon-input appearance-none"
                >
                   <option value="">{tx(lang, 'Masa seçin', 'Выберите стол', 'Select table')}</option>
                  {tables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  onClick={() => patchCtx({ cupMode: 'paper' })}
                  className={`rounded-md border px-2 py-2 text-xs font-semibold ${
                    ctx.cupMode === 'paper'
                      ? 'border-yellow-300 bg-yellow-400 text-slate-900'
                      : 'border-slate-600 bg-slate-800/40 text-slate-200'
                  }`}
                >
                  {tx(lang, 'Kağız stəkan', 'Бумажный стакан', 'Paper cup')}
                </button>
                <button
                  onClick={() => patchCtx({ cupMode: 'glass' })}
                  className={`rounded-md border px-2 py-2 text-xs font-semibold ${
                    ctx.cupMode === 'glass'
                      ? 'border-yellow-300 bg-yellow-400 text-slate-900'
                      : 'border-slate-600 bg-slate-800/40 text-slate-200'
                  }`}
                >
                  {tx(lang, 'Şüşə stəkan', 'Стеклянный стакан', 'Glass cup')}
                </button>
              </div>
            </div>
          )}

          {ctx.orderType === 'Dine In' && occupiedTables.length > 0 && (
            <div className="mb-3 rounded-lg border border-slate-700/70 bg-[#0e1520] p-3 text-xs text-slate-300">
              <div className="mb-2 font-semibold text-slate-200">{tx(lang, 'Açıq masa hesabları', 'Открытые счета столов')}</div>
              <div className="flex flex-wrap gap-2">
                {occupiedTables.map((t) => (
                  <button
                    key={`open_${t.id}`}
                    onClick={() => patchCtx({ selectedTable: t.id, orderType: 'Dine In' })}
                    className={`rounded-md border px-2 py-1 ${ctx.selectedTable === t.id ? 'border-yellow-300 bg-yellow-400 text-slate-900' : 'border-slate-600 bg-slate-800/40 text-slate-200'}`}
                  >
                    {t.label} - {toDecimalSafe(t.total || 0).toFixed(2)} ₼
                  </button>
                ))}
              </div>
            </div>
          )}

          {ctx.orderType === 'Dine In' && (
           <button
              disabled={isLoading || !ctx.selectedTable || cart.length === 0}
              onClick={() => { void handleSendToKitchen(); }}
              className="pay-btn mb-3 h-12 w-full"
            >
              {tx(lang, 'Mətbəxə Göndər', 'Отправить на кухню', 'Send To Kitchen')}
            </button>
          )}

          <div
            className="mb-3 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-slate-700/70 bg-[#0d141e] p-3"
            style={{ resize: 'vertical', minHeight: '220px' }}
          >
            {cart.length === 0 && <div className="pt-8 text-center text-sm text-slate-500">{t.cart_empty}</div>}
            {cart.map((item) => (
              <div key={item.id} className="rounded-md border border-slate-700 bg-slate-900/40 p-2">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-100">{item.item_name}</span>
                  <span className="font-semibold text-yellow-300">
                    {toDecimalSafe(item.price).times(item.qty).toFixed(2)} ₼
                  </span>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <button className="neon-mini-btn" onClick={() => updateCartItem(item.id, item.qty - 1)}>
                    <Minus size={13} />
                  </button>
                  <span className="w-6 text-center text-sm">{item.qty}</span>
                  <button className="neon-mini-btn" onClick={() => updateCartItem(item.id, item.qty + 1)}>
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="sticky bottom-0 mt-auto space-y-2 border-t border-slate-700/60 bg-[#101722] pt-3 text-sm">
            <div className="flex justify-between text-slate-300">
               <span>{tx(lang, 'Ara cəm', 'Промежуточный итог', 'Subtotal')}</span>
              <span>{rawTotal.toFixed(2)} ₼</span>
            </div>
            <div className="flex justify-between text-slate-300">
               <span>{tx(lang, 'Endirim', 'Скидка', 'Discount')}</span>
              <span>- {discountAmount.toFixed(2)} ₼</span>
            </div>
            {totals.free_coffees > 0 && (
              <div className="flex justify-between text-emerald-300">
                <span>{tx(lang, 'Pulsuz kofe', 'Бесплатный кофе', 'Free coffee')}</span>
                <span>{totals.free_coffees}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold text-white">
               <span>{tx(lang, 'Yekun', 'Итого', 'Total')}</span>
              <span>{checkoutBaseTotal.toFixed(2)} ₼</span>
            </div>
            {cart.length === 0 && selectedTableData?.is_occupied && (
              <div className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">
                {tx(lang, 'Masa sifarişi mətbəxə göndərilib. Bu məbləğ masanın açıq hesabıdır.', 'Заказ стола отправлен на кухню. Эта сумма — открытый счет стола.', 'The table order has been sent to the kitchen. This amount is the open table balance.')}
              </div>
            )}
            {ctx.customer && (
              <div className="flex justify-between text-xs text-slate-400">
                 <span>{tx(lang, 'Ulduz balansı (satışdan sonra)', 'Баланс звезд (после продажи)', 'Stars after sale')}</span>
                <span>{totals.customer_stars_after}</span>
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              disabled={isLoading}
              onClick={() => setSelectedPayment('Nəğd')}
               className={`pay-btn h-12 ${selectedPayment === 'Nəğd' ? 'pay-btn-active' : ''}`}
            >
              {tx(lang, 'Nəğd', 'Наличные', 'Cash')}
            </button>
            <button
              disabled={isLoading}
              onClick={() => setSelectedPayment('Kart')}
               className={`pay-btn h-12 ${selectedPayment === 'Kart' ? 'pay-btn-active' : ''}`}
            >
              {tx(lang, 'Kart', 'Карта', 'Card')}
            </button>
            <button
              disabled={isLoading}
              onClick={() => setSelectedPayment('Split')}
               className={`pay-btn h-12 ${selectedPayment === 'Split' ? 'pay-btn-active' : ''}`}
            >
              {tx(lang, 'Bölünmüş', 'Разделено', 'Split')}
            </button>
            <button
              disabled={isLoading}
              onClick={() => setSelectedPayment('Staff')}
               className={`pay-btn h-12 ${selectedPayment === 'Staff' ? 'pay-btn-active' : ''}`}
            >
              {tx(lang, 'Staff', 'Персонал', 'Staff')}
            </button>
          </div>

          {selectedPayment === 'Split' && (
            <div className="mt-3 rounded-lg border border-slate-700/70 bg-[#0e1520] p-3 text-sm">
              <label className="mb-1 block text-slate-300">{tx(lang, 'Nağd hissə', 'Наличная часть', 'Cash part')}</label>
              <input
                type="number"
                min={0}
                step="0.01"
                 max={checkoutBaseTotal.toNumber()}
                value={splitCashInput}
                onChange={(e) => setSplitCashInput(e.target.value)}
                className="neon-input"
              />
              <div className="mt-2 flex justify-between text-slate-300">
                <span>{tx(lang, 'Kart hissə', 'Карточная часть', 'Card part')}</span>
                 <span>{Decimal.max(new Decimal(0), checkoutBaseTotal.minus(toDecimalSafe(splitCashInput || 0))).toFixed(2)} ₼</span>
              </div>
            </div>
          )}

          {selectedPayment === 'Staff' && (
            <div className="mt-3 rounded-lg border border-slate-700/70 bg-[#0e1520] p-3 text-xs text-slate-300 space-y-1">
              <div className="flex justify-between"><span>{tx(lang, 'Günlük limit', 'Дневной лимит', 'Daily limit')}</span><span>{staffPreview.daily_limit.toFixed(2)} ₼</span></div>
              <div className="flex justify-between"><span>{tx(lang, 'Bu gün istifadə', 'Использовано сегодня', 'Used today')}</span><span>{staffPreview.used_today.toFixed(2)} ₼</span></div>
              <div className="flex justify-between"><span>{tx(lang, 'Bu satışda limitdən düşən', 'Списывается по лимиту', 'Consumed in this sale')}</span><span>{staffPreview.benefit_used_this_sale.toFixed(2)} ₼</span></div>
              <div className="flex justify-between"><span>{tx(lang, 'Qeyri-kofe artığı', 'Превышение некофе', 'Non-coffee excess')}</span><span>{staffPreview.non_coffee_excess.toFixed(2)} ₼</span></div>
              <div className="flex justify-between font-semibold text-yellow-300"><span>{tx(lang, 'Ödəniləcək', 'К оплате', 'To pay')}</span><span>{staffPreview.final_due.toFixed(2)} ₼</span></div>
            </div>
          )}

          <button
            disabled={
              isLoading ||
              (cart.length === 0 && !(ctx.orderType === 'Dine In' && selectedTableData?.is_occupied)) ||
              (ctx.orderType === 'Dine In' && !ctx.selectedTable)
            }
            onClick={() => handleCheckout(selectedPayment)}
            className="mt-3 flex h-14 items-center justify-center gap-2 rounded-lg border border-red-300/40 bg-red-600 px-4 text-base font-bold text-white shadow-[0_0_22px_rgba(239,68,68,0.35)] disabled:opacity-50"
          >
            <Check size={18} /> {tx(lang, 'Ödənişi Tamamla', 'Завершить оплату', 'Complete Payment')}
          </button>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-16 z-30 px-3 md:hidden">
        <button
          onClick={() => setShowMobileCheckout(true)}
          className="flex w-full items-center justify-between rounded-[24px] border border-yellow-300/30 bg-[#111821]/95 px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        >
          <div className="text-left">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{tx(lang, 'Checkout', 'Оплата', 'Checkout')}</div>
            <div className="mt-1 text-sm font-semibold text-slate-200">{tx(lang, 'Səbət və ödəniş seçimləri', 'Корзина и варианты оплаты', 'Cart and payment options')}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">{tx(lang, 'Yekun', 'Итого', 'Total')}</div>
            <div className="text-xl font-black text-white">{checkoutBaseTotal.toFixed(2)} ₼</div>
          </div>
        </button>
      </div>

      {showMobileCheckout && (
        <div className="fixed inset-0 z-[130] bg-black/65 md:hidden">
          <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[30px] border border-slate-700/70 bg-[#101722] p-4 shadow-[0_-20px_60px_rgba(0,0,0,0.45)]">
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600" />
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{tx(lang, 'Mobile Checkout', 'Мобильная оплата', 'Mobile Checkout')}</div>
                <div className="mt-1 text-lg font-bold text-white">{checkoutBaseTotal.toFixed(2)} ₼</div>
              </div>
              <button className="neon-btn rounded-xl px-4 py-2" onClick={() => setShowMobileCheckout(false)}>
                {tx(lang, 'Bağla', 'Закрыть', 'Close')}
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-700/70 bg-[#0d141e] p-3">
                <div className="mb-2 text-sm font-semibold text-slate-200">{tx(lang, 'Səbət', 'Корзина', 'Cart')}</div>
                <div className="space-y-2">
                  {cart.length === 0 && <div className="text-sm text-slate-500">{t.cart_empty}</div>}
                  {cart.map((item) => (
                    <div key={`mobile_${item.id}`} className="rounded-lg border border-slate-700 bg-slate-900/40 p-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-slate-100">{item.item_name}</span>
                        <span className="font-semibold text-yellow-300">{toDecimalSafe(item.price).times(item.qty).toFixed(2)} ₼</span>
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button className="neon-mini-btn" onClick={() => updateCartItem(item.id, item.qty - 1)}>
                          <Minus size={14} />
                        </button>
                        <span className="w-6 text-center">{item.qty}</span>
                        <button className="neon-mini-btn" onClick={() => updateCartItem(item.id, item.qty + 1)}>
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button disabled={isLoading} onClick={() => setSelectedPayment('Nəğd')} className={`pay-btn ${selectedPayment === 'Nəğd' ? 'pay-btn-active' : ''}`}>{tx(lang, 'Nəğd', 'Наличные', 'Cash')}</button>
                <button disabled={isLoading} onClick={() => setSelectedPayment('Kart')} className={`pay-btn ${selectedPayment === 'Kart' ? 'pay-btn-active' : ''}`}>{tx(lang, 'Kart', 'Карта', 'Card')}</button>
                <button disabled={isLoading} onClick={() => setSelectedPayment('Split')} className={`pay-btn ${selectedPayment === 'Split' ? 'pay-btn-active' : ''}`}>{tx(lang, 'Bölünmüş', 'Разделено', 'Split')}</button>
                <button disabled={isLoading} onClick={() => setSelectedPayment('Staff')} className={`pay-btn ${selectedPayment === 'Staff' ? 'pay-btn-active' : ''}`}>{tx(lang, 'Staff', 'Персонал', 'Staff')}</button>
              </div>

              {selectedPayment === 'Split' && (
                <div className="rounded-lg border border-slate-700/70 bg-[#0e1520] p-3 text-sm">
                  <label className="mb-1 block text-slate-300">{tx(lang, 'Nağd hissə', 'Наличная часть', 'Cash part')}</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    max={checkoutBaseTotal.toNumber()}
                    value={splitCashInput}
                    onChange={(e) => setSplitCashInput(e.target.value)}
                    className="neon-input"
                  />
                </div>
              )}

              <button
                disabled={
                  isLoading ||
                  (cart.length === 0 && !(ctx.orderType === 'Dine In' && selectedTableData?.is_occupied)) ||
                  (ctx.orderType === 'Dine In' && !ctx.selectedTable)
                }
                onClick={() => {
                  void handleCheckout(selectedPayment);
                  setShowMobileCheckout(false);
                }}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-red-300/40 bg-red-600 px-4 text-base font-bold text-white shadow-[0_0_22px_rgba(239,68,68,0.35)] disabled:opacity-50"
              >
                <Check size={18} /> {tx(lang, 'Ödənişi Tamamla', 'Завершить оплату', 'Complete Payment')}
              </button>
            </div>
          </div>
        </div>
      )}

      {variantPicker && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{variantPicker.base}</h3>
            <p className="mt-1 text-sm text-slate-300">{tx(lang, 'Ölçü seçin', 'Выберите размер', 'Choose a size')}</p>
            <div className="mt-4 space-y-2">
              {variantPicker.items.map((item) => {
                const { variant } = splitVariantName(item.item_name);
                return (
                  <button
                    key={item.id}
                    className="neon-btn flex h-12 w-full items-center justify-between rounded-lg px-3"
                    onClick={() => {
                      addToCart(item);
                      setVariantPicker(null);
                    }}
                  >
                    <span>{variant || item.item_name}</span>
                    <span>{toDecimalSafe(item.price).toFixed(2)} ₼</span>
                  </button>
                );
              })}
            </div>
            <button className="mt-4 w-full rounded-lg border border-slate-600 px-4 py-2 text-sm" onClick={() => setVariantPicker(null)}>
              {tx(lang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
