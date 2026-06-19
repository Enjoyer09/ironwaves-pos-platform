import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { Search, ShoppingCart, ClipboardList, Plus, Minus, Check, ScanLine, ChevronDown, WifiOff } from 'lucide-react';
import { useAppStore } from '../store';
import { get_menu_for_pos, create_sale, calculate_total, calculate_staff_payable, save_sale_receipt_html_live } from '../api/pos';
import { get_tables_live, send_to_kitchen_live, pay_table_live } from '../api/tables';
import { get_shift_status, refresh_shift_status } from '../api/reports';
import { getDB, setDB } from '../lib/db_sim';
import { i18n, tx } from '../i18n';
import { get_business_profile, get_settings, get_settings_live } from '../api/settings';
import { find_feedback_coupon_live, isFeedbackCouponCode, redeem_feedback_coupon_live } from '../api/feedback';
import { logUiError } from '../lib/logger';
import { qzPrintHtml } from '../lib/qz';
import { hostScopedKey } from '../lib/storage_keys';
import { sanitizeHtmlForIframe } from '../lib/html_sanitize';
import { THERMAL_RECEIPT_PRINT_CSS } from '../lib/receipt_print_css';
import { printViaLocalAgent } from '../lib/local_print_agent';
import {
  cacheMenuOffline,
  clearSyncedOfflineSales,
  enqueueOfflineSale,
  getCachedMenuOffline,
  getPendingOfflineSales,
  getPendingOfflineSalesCount,
  scheduleOfflineSaleRetryNow,
  syncPendingOfflineSales,
  type OfflineSaleSummary,
} from '../lib/offline';
import { reorder_menu_items_live } from '../api/menu';
import { apiRequest, isBackendEnabled } from '../api/client';
import ConfirmModal from './ConfirmModal';
import { getTenantDomains } from '../lib/tenant';
import StaffPosMode from './pos/staff/StaffPosMode';

type OrderType = 'Dine In' | 'Take Away' | 'Order Online';
type PaymentMethod = 'Nəğd' | 'Kart' | 'Split' | 'Staff';
type PosCartItem = {
  line_id: string;
  id: string;
  item_name: string;
  price: string;
  category: string;
  is_coffee: boolean;
  qty: number;
  seat_label?: string;
  cup_mode?: 'paper' | 'glass';
};

type VariantPickerState = {
  base: string;
  items: any[];
  requiresServiceChoice: boolean;
  selectedItemId: string | null;
  selectedCupMode: 'paper' | 'glass' | null;
};

type CartContext = {
  customerQR: string;
  customer: any | null;
  discount: string;
  discountReason: string;
  selectedTable: string;
  orderType: OrderType;
  cupMode: 'paper' | 'glass';
  kitchenSent?: boolean;
  rewardClaimCode?: string;
};

type MenuGroup = {
  group_key: string;
  base: string;
  category: string;
  image_url: string;
  description: string;
  items: any[];
  minPrice: Decimal;
  hasVariants: boolean;
  initials: string;
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

function resolveMenuImage(item: any): string {
  const candidates = [
    item?.image_url,
    item?.image,
    item?.photo_url,
    item?.thumbnail,
    item?.cover_image,
  ];
  const picked = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return picked ? String(picked).trim() : '';
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
  discountReason: '',
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

const formatOfflineError = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('Sessiya vaxtı bitib')) return raw;
  const firstLine = raw.split(/\s+(?=Backendə qoşulma alınmadı \(|Unauthorized\b|Invalid token\b)/i)[0]?.trim() || raw;
  const normalized = firstLine.replace(/\s*\(request_id:[^)]+\)\s*/gi, '').trim();
  const compact = normalized || raw;
  if (compact.length <= 180) return compact;
  return `${compact.slice(0, 177)}...`;
};

const generateOfflineRequestId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `offline_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const generateLineId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const readSnapshot = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
};

const writeSnapshot = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Snapshot cache is best-effort only.
  }
};

const normalizeRewardClaimCode = (value: string) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.startsWith('IWPOS:FB:')) return raw.split(':').slice(2).join(':').trim().toUpperCase();
  if (raw.startsWith('IWPOS:CLAIM:')) return raw.split(':').slice(2).join(':').trim().toUpperCase();
  if (raw.startsWith('FB:')) return raw.slice(3).trim().toUpperCase();
  return raw.replace(/\s+/g, '');
};

export default function POS({ isActive = true }: { isActive?: boolean }) {
  const user = useAppStore((state) => state.user);
  const lang = useAppStore((state) => state.lang);
  const notify = useAppStore((state) => state.notify);
  const safeLang = (lang === 'az' || lang === 'ru' || lang === 'en') ? lang : 'az';
  const t = i18n[safeLang];
  const tenantId = user?.tenant_id || 'tenant_default';
  const openTableStorageKey = hostScopedKey(`${tenantId}_open_table_in_pos`);
  const posCartsStorageKey = hostScopedKey(`${tenantId}_pos_carts`);
  const posCartCtxStorageKey = hostScopedKey(`${tenantId}_pos_cart_ctx`);
  const posActiveCartStorageKey = hostScopedKey(`${tenantId}_pos_active_cart`);
  const posMenuSnapshotKey = hostScopedKey(`${tenantId}_pos_menu_snapshot`);
  const posTablesSnapshotKey = hostScopedKey(`${tenantId}_pos_tables_snapshot`);

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
  const [variantPicker, setVariantPicker] = useState<VariantPickerState | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [pendingOfflineSales, setPendingOfflineSales] = useState<OfflineSaleSummary[]>([]);
  const [showOfflineQueue, setShowOfflineQueue] = useState(false);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [isPosOnline, setIsPosOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [mobilePane, setMobilePane] = useState<'menu' | 'cart'>('menu');
  const [showMobileCheckout, setShowMobileCheckout] = useState(false);
  const [isPosMenuEditMode, setIsPosMenuEditMode] = useState(false);
  const [isReorderingPosMenu, setIsReorderingPosMenu] = useState(false);
  const [draggingMenuGroupKey, setDraggingMenuGroupKey] = useState<string | null>(null);
  const [dropMenuGroupKey, setDropMenuGroupKey] = useState<string | null>(null);
  const [layoutRefreshKey, setLayoutRefreshKey] = useState(0);
  const [isTabletViewport, setIsTabletViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    return window.innerWidth < 1366 || (window.innerWidth < 1600 && isTouchDevice);
  });
  const [tableRoutingBanner, setTableRoutingBanner] = useState<{ tableId: string; tableLabel: string } | null>(null);
  const [feedbackCouponPreview, setFeedbackCouponPreview] = useState<{ code: string; percent: number; status: string } | null>(null);
  const [showOpenShiftModal, setShowOpenShiftModal] = useState(false);
  const [pendingClearCartKey, setPendingClearCartKey] = useState<'S1' | 'S2' | 'S3' | null>(null);
  const [tenantSettings, setTenantSettings] = useState<any>({});
  const safeReceiptHtml = useMemo(() => sanitizeHtmlForIframe(receiptHtml), [receiptHtml]);
  const receiptIframeRef = useRef<HTMLIFrameElement | null>(null);
  const refreshInFlightRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const lastMenuRefreshAtRef = useRef(0);
  const lastTablesRefreshAtRef = useRef(0);
  const lastMenuImagesAtRef = useRef(0);
  const menuImagesRef = useRef<Map<string, { image_url: string; description: string }>>(new Map());
  const pendingRefreshTimerRef = useRef<number | null>(null);
  const lastPersistedCartsRef = useRef('');
  const lastPersistedCtxRef = useRef('');
  const lastCartAddRef = useRef<{ key: string; at: number } | null>(null);
  const businessProfile = get_business_profile(tenantId);
  const printSettings = tenantSettings.print_settings || { use_qz: false, printer_name: '' };
  const beverageServiceSettings = tenantSettings.beverage_service_settings || {
    coffee_selection_mode: 'size_and_service',
    remove_paper_packaging_for_table: true,
  };
  const basePosLayout = tenantSettings.pos_layout || {
    preset: 'classic',
    density: 'comfortable',
    product_columns: 3,
    show_cart_tabs: true,
    accent_color: '#facc15',
    hidden_widgets: [],
    widget_order: ['customer', 'discount', 'orderType', 'table', 'cartItems', 'cartSummary', 'payments'],
    left_hidden_widgets: [],
    left_widget_order: ['menuHeader', 'search', 'categories', 'productGrid'],
    widget_sizes: {},
    left_widget_sizes: {},
    device_layouts: {
      desktop: {},
      tablet: {
        preset: 'touch',
        density: 'large',
        product_columns: 2,
        left_hidden_widgets: [],
        left_widget_order: ['search', 'categories', 'productGrid'],
        widget_sizes: {},
        left_widget_sizes: {},
      },
    },
  };
  const posLayout = useMemo(() => {
    const stripNestedLayoutMeta = (patch: any) => {
      if (!patch || typeof patch !== 'object') return {};
      const { device_layouts, role_overrides, ...rest } = patch;
      return rest;
    };
    const activeDeviceKey = isTabletViewport ? 'tablet' : 'desktop';
    const devicePatch = basePosLayout.device_layouts?.[activeDeviceKey];
    const roleKey = user?.role === 'manager' ? 'manager' : user?.role === 'staff' ? 'staff' : null;
    const rolePatch = roleKey ? basePosLayout.role_overrides?.[roleKey] : null;
    const roleDevicePatch = rolePatch?.device_layouts?.[activeDeviceKey];
    return {
      ...basePosLayout,
      ...stripNestedLayoutMeta(devicePatch),
      ...stripNestedLayoutMeta(rolePatch),
      ...stripNestedLayoutMeta(roleDevicePatch),
    };
  }, [basePosLayout, isTabletViewport, user?.role]);

  const cart = carts[activeCart];
  const ctx = cartCtx[activeCart];
  const enteredClaimCode = normalizeRewardClaimCode(ctx.rewardClaimCode || '');
  const feedbackCouponPercent = feedbackCouponPreview?.status === 'PENDING' ? Number(feedbackCouponPreview.percent || 0) : 0;
  const typedDiscountPercent = Number(ctx.discount || 0);
  const hasClaimCode = Boolean(enteredClaimCode);
  const effectiveDiscountPercent =
    feedbackCouponPercent > 0
      ? feedbackCouponPercent
      : hasClaimCode
        ? 0
        : typedDiscountPercent;
  const rewardClaimCodeForSale = isFeedbackCouponCode(enteredClaimCode) ? null : (enteredClaimCode || null);

  const patchCtx = (patch: Partial<CartContext>) => {
    setCartCtx((prev) => ({
      ...prev,
      [activeCart]: {
        ...prev[activeCart],
        ...patch,
      },
    }));
  };

  const mergeMenuWithImages = useCallback((items: any[]) => {
    const imageMeta = menuImagesRef.current;
    return (Array.isArray(items) ? items : []).map((item) => {
      const meta = imageMeta.get(String(item?.id || ''));
      return meta
        ? {
            ...item,
            image_url: meta.image_url,
            description: meta.description,
          }
        : item;
    });
  }, []);

  const refreshMenuImages = useCallback(async (force: boolean = false) => {
    if (!isBackendEnabled()) return;
    const now = Date.now();
    if (!force && now - lastMenuImagesAtRef.current < 5 * 60_000) return;
    try {
      const images = await apiRequest<Array<{ id: string; image_url: string; description: string }>>('/api/v1/pos/menu/images', {
        timeoutMs: 7000,
        retryCount: 0,
      });
      const nextMap = new Map<string, { image_url: string; description: string }>();
      (images || []).forEach((row) => {
        nextMap.set(String(row?.id || ''), {
          image_url: String(row?.image_url || ''),
          description: String(row?.description || ''),
        });
      });
      menuImagesRef.current = nextMap;
      lastMenuImagesAtRef.current = now;
      setMenu((prev) => mergeMenuWithImages(prev));
    } catch {
      // Non-fatal: menu tiles can render without images.
    }
  }, [mergeMenuWithImages]);


  const clearCart = (key: 'S1' | 'S2' | 'S3' = activeCart) => {
    setCarts((prev) => ({ ...prev, [key]: [] }));
  };

  const requestClearCart = (key: 'S1' | 'S2' | 'S3' = activeCart) => {
    if ((carts[key] || []).length === 0) return;
    setPendingClearCartKey(key);
  };

  const resolveCartTabLabel = (key: 'S1' | 'S2' | 'S3') => {
    const count = carts[key]?.length || 0;
    const selectedTable = String(cartCtx[key]?.selectedTable || '').trim();
    if (selectedTable) return `${tx(lang, 'Masa', 'Стол', 'Table')} ${selectedTable} (${count})`;
    return `${t.cart} ${key.slice(1)} (${count})`;
  };

  useEffect(() => {
    let mounted = true;
    try {
      const localSettings = get_settings(tenantId);
      if (mounted) {
        setTenantSettings(localSettings || {});
      }
      (async () => {
        try {
          const settings = await get_settings_live(tenantId);
          if (!mounted) return;
          setTenantSettings(settings || {});
        } catch {
          // ignore
        }
      })();
    } catch {
      if (mounted) {
        setTenantSettings({});
      }
    }
    return () => {
      mounted = false;
    };
  }, [tenantId, layoutRefreshKey]);

  useEffect(() => {
    const onLayoutUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      if (!detail?.tenant_id || detail.tenant_id === tenantId) {
        setLayoutRefreshKey((prev) => prev + 1);
      }
    };
    window.addEventListener('pos-layout-updated', onLayoutUpdate as EventListener);
    window.addEventListener('settings-updated', onLayoutUpdate as EventListener);
    return () => {
      window.removeEventListener('pos-layout-updated', onLayoutUpdate as EventListener);
      window.removeEventListener('settings-updated', onLayoutUpdate as EventListener);
    };
  }, [tenantId]);

  useEffect(() => {
    const handleTablePaid = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string; table_id?: string }>).detail;
      if (!detail?.tenant_id || detail.tenant_id !== tenantId) return;
      if (!detail.table_id || detail.table_id !== ctx.selectedTable) return;
      clearCart(activeCart);
      patchCtx({ ...defaultCtx });
      setTableRoutingBanner(null);
    };
    window.addEventListener('table-paid', handleTablePaid as EventListener);
    return () => {
      window.removeEventListener('table-paid', handleTablePaid as EventListener);
    };
  }, [tenantId, ctx.selectedTable, activeCart]);

  // Fast user switch: clear all carts when user changes
  useEffect(() => {
    const handleUserSwitched = () => {
      setCarts({ S1: [], S2: [], S3: [] });
      setCartCtx({ S1: { ...defaultCtx }, S2: { ...defaultCtx }, S3: { ...defaultCtx } });
      setActiveCart('S1');
      setTableRoutingBanner(null);
      setReceiptHtml(null);
      setVariantPicker(null);
    };
    window.addEventListener('user-switched', handleUserSwitched);
    return () => {
      window.removeEventListener('user-switched', handleUserSwitched);
    };
  }, []);

  useEffect(() => {
    let resizeTimer: number | null = null;
    const onResize = () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const next = window.innerWidth < 1366 || (window.innerWidth < 1600 && isTouchDevice);
        setIsTabletViewport((prev) => (prev === next ? prev : next));
      }, 120);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const applyOpenTablePayload = (detail?: { table_id?: string; table_label?: string }) => {
    const tableId = String(detail?.table_id || '').trim();
    if (!tableId) return false;
    const targetCart: 'S1' | 'S2' | 'S3' = 'S1';
    setActiveCart(targetCart);
    setCartCtx((prev) => ({
      ...prev,
      [targetCart]: {
        ...prev[targetCart],
        orderType: 'Dine In',
        selectedTable: tableId,
        kitchenSent: false,
      },
    }));
    setTableRoutingBanner({
      tableId,
      tableLabel: String(detail?.table_label || tx(lang, 'Seçilmiş Masa', 'Выбранный стол', 'Selected table')),
    });
    setMobilePane('menu');
    setShowMobileCheckout(false);
    window.setTimeout(() => document.getElementById('pos-menu-search')?.focus(), 80);
    return true;
  };

  useEffect(() => {
    const handleOpenTableInPos = (event: Event) => {
      applyOpenTablePayload((event as CustomEvent<{ table_id?: string; table_label?: string }>).detail);
    };
    const persisted = sessionStorage.getItem(openTableStorageKey) ?? sessionStorage.getItem(`${tenantId}_open_table_in_pos`);
    if (persisted) {
      try {
        applyOpenTablePayload(JSON.parse(persisted));
      } catch {
        // ignore invalid persisted context
      }
    }
    window.addEventListener('open-table-in-pos', handleOpenTableInPos as EventListener);
    return () => {
      window.removeEventListener('open-table-in-pos', handleOpenTableInPos as EventListener);
    };
  }, [lang, tenantId, openTableStorageKey]);

  useEffect(() => {
    const legacyKey = `${tenantId}_pos_carts`;
    const raw = localStorage.getItem(posCartsStorageKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const sanitizeCart = (rows: any[]) =>
          (Array.isArray(rows) ? rows : [])
            .filter((row) => row && typeof row === 'object' && typeof row.id === 'string')
            .map((row) => ({
              line_id: String(row.line_id || generateLineId()),
              id: String(row.id),
              item_name: String(row.item_name || 'Məhsul'),
              price: toDecimalSafe(row.price).toFixed(2),
              category: String(row.category || 'Digər'),
              is_coffee: Boolean(row.is_coffee),
              qty: Math.max(1, Number(row.qty || 1)),
              seat_label: row.seat_label ? String(row.seat_label) : undefined,
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
    localStorage.removeItem(legacyKey);
  }, [tenantId, posCartsStorageKey]);

  useEffect(() => {
    const legacyCtxKey = `${tenantId}_pos_cart_ctx`;
    const legacyActiveKey = `${tenantId}_pos_active_cart`;
    const rawCtx = localStorage.getItem(posCartCtxStorageKey);
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

    const rawActive = localStorage.getItem(posActiveCartStorageKey);
    if (rawActive === 'S1' || rawActive === 'S2' || rawActive === 'S3') {
      setActiveCart(rawActive);
    }

    const persisted = sessionStorage.getItem(openTableStorageKey);
    if (persisted) {
      try {
        const applied = applyOpenTablePayload(JSON.parse(persisted));
        if (applied) {
          sessionStorage.removeItem(openTableStorageKey);
        }
      } catch {
        sessionStorage.removeItem(openTableStorageKey);
      }
    }
    localStorage.removeItem(legacyCtxKey);
    localStorage.removeItem(legacyActiveKey);
    sessionStorage.removeItem(`${tenantId}_open_table_in_pos`);
  }, [tenantId, openTableStorageKey, posCartCtxStorageKey, posActiveCartStorageKey]);

  useEffect(() => {
    const persist = () => {
      try {
        const serialized = JSON.stringify(carts);
        if (serialized !== lastPersistedCartsRef.current) {
          localStorage.setItem(posCartsStorageKey, serialized);
          lastPersistedCartsRef.current = serialized;
        }
      } catch {
        // POS should never freeze because a browser storage write failed.
      }
    };
    const idle = (window as any).requestIdleCallback;
    const id = idle ? idle(persist, { timeout: 900 }) : window.setTimeout(persist, 450);
    return () => {
      const cancelIdle = (window as any).cancelIdleCallback;
      if (idle && cancelIdle) cancelIdle(id);
      else window.clearTimeout(id);
    };
  }, [carts, posCartsStorageKey]);

  useEffect(() => {
    const persist = () => {
      try {
        const serialized = JSON.stringify({ cartCtx, activeCart });
        if (serialized !== lastPersistedCtxRef.current) {
          localStorage.setItem(posCartCtxStorageKey, JSON.stringify(cartCtx));
          localStorage.setItem(posActiveCartStorageKey, activeCart);
          lastPersistedCtxRef.current = serialized;
        }
      } catch {
        // Keep touch flow responsive even if storage quota is reached.
      }
    };
    const idle = (window as any).requestIdleCallback;
    const id = idle ? idle(persist, { timeout: 900 }) : window.setTimeout(persist, 450);
    return () => {
      const cancelIdle = (window as any).cancelIdleCallback;
      if (idle && cancelIdle) cancelIdle(id);
      else window.clearTimeout(id);
    };
  }, [cartCtx, activeCart, posCartCtxStorageKey, posActiveCartStorageKey]);

  const addToCart = (item: any, options?: { cup_mode?: 'paper' | 'glass' }) => {
    const defaultSeatLabel = undefined;
    const nextCupMode = options?.cup_mode;
    const addKey = `${activeCart}:${String(item?.id || '')}:${String(nextCupMode || '')}`;
    const now = Date.now();
    if (lastCartAddRef.current?.key === addKey && now - lastCartAddRef.current.at < 180) {
      return;
    }
    lastCartAddRef.current = { key: addKey, at: now };
    setCarts((prev) => {
      const existing = prev[activeCart].find(
        (c) =>
          c.id === item.id &&
          (c.seat_label || '') === (defaultSeatLabel || '') &&
          String(c.cup_mode || '') === String(nextCupMode || ''),
      );
      if (existing) {
        return {
          ...prev,
          [activeCart]: prev[activeCart].map((c) => (c.line_id === existing.line_id ? { ...c, qty: c.qty + 1 } : c)),
        };
      }
      return {
        ...prev,
        [activeCart]: [
          ...prev[activeCart],
          {
            line_id: generateLineId(),
            id: item.id,
            item_name: item.item_name,
            price: item.price,
            category: item.category,
            is_coffee: isCoffeeLike(item),
            qty: 1,
            seat_label: defaultSeatLabel,
            cup_mode: nextCupMode,
          },
        ],
      };
    });
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      setMobilePane('cart');
    }
  };

  const openProductPicker = (group: { base: string; items: any[] }) => {
    const requiresServiceChoice =
      beverageServiceSettings.coffee_selection_mode === 'size_and_service' && group.items.some((item) => isCoffeeLike(item));
    if (group.items.length === 1 && !requiresServiceChoice) {
      addToCart(group.items[0]);
      return;
    }
    setVariantPicker({
      base: group.base,
      items: group.items,
      requiresServiceChoice,
      selectedItemId: group.items.length === 1 ? group.items[0].id : null,
      selectedCupMode: null,
    });
  };

  const updateCartItem = (lineId: string, qty: number) => {
    setCarts((prev) => ({
      ...prev,
      [activeCart]:
        qty <= 0 ? prev[activeCart].filter((c) => c.line_id !== lineId) : prev[activeCart].map((c) => (c.line_id === lineId ? { ...c, qty } : c)),
    }));
  };

  const refreshOfflineState = async () => {
    const [count, rows] = await Promise.all([
      getPendingOfflineSalesCount(tenantId),
      getPendingOfflineSales(tenantId),
    ]);
    setPendingSyncCount((prev) => (prev === count ? prev : count));
    if (count === 0) {
      setPendingOfflineSales([]);
      return;
    }
    setPendingOfflineSales((prev) => {
      const prevKey = `${prev.length}:${prev[0]?.sale_id || ''}:${prev[prev.length - 1]?.sale_id || ''}`;
      const nextKey = `${rows.length}:${rows[0]?.sale_id || ''}:${rows[rows.length - 1]?.sale_id || ''}`;
      return prevKey === nextKey ? prev : rows;
    });
  };

  const refreshData = async (options: { force?: boolean; menu?: boolean; tables?: boolean } = {}) => {
    const force = options.force === true;
    const shouldRefreshMenu = options.menu !== false;
    const shouldRefreshTables = options.tables !== false;
    const now = Date.now();
    if (!force && (refreshInFlightRef.current || now - lastRefreshAtRef.current < 2500)) return;
    refreshInFlightRef.current = true;
    lastRefreshAtRef.current = now;
    try {
      const tasks: Promise<void>[] = [];
      if (shouldRefreshMenu && (force || now - lastMenuRefreshAtRef.current >= 15000)) {
        tasks.push((async () => {
          const liteMenu = isBackendEnabled()
            ? await apiRequest<any[]>('/api/v1/pos/menu', {
              timeoutMs: 5000,
              retryCount: 0,
            })
            : get_menu_for_pos(tenantId);
          const nextMenu = mergeMenuWithImages(Array.isArray(liteMenu) ? liteMenu : []);
          setMenu(nextMenu);
          if (Array.isArray(liteMenu)) {
            lastMenuRefreshAtRef.current = Date.now();
            writeSnapshot(posMenuSnapshotKey, liteMenu);
            void cacheMenuOffline(tenantId, liteMenu);
          }
        })());
      }
      if (shouldRefreshTables && (force || now - lastTablesRefreshAtRef.current >= 1200)) {
        tasks.push((async () => {
          const nextTables = await get_tables_live(tenantId);
          setTables(Array.isArray(nextTables) ? nextTables : []);
          lastTablesRefreshAtRef.current = Date.now();
          if (Array.isArray(nextTables)) {
            writeSnapshot(posTablesSnapshotKey, nextTables);
          }
        })());
      }
      await Promise.all(tasks);
      void refreshOfflineState();
    } catch (e) {
      console.error('POS refreshData failed:', e);
      logUiError(tenantId, 'pos', e instanceof Error ? e.message : String(e), { phase: 'refreshData' });
      if (shouldRefreshMenu) {
        void getCachedMenuOffline(tenantId).then((cached) => {
          if (Array.isArray(cached) && cached.length > 0) {
            setMenu(mergeMenuWithImages(cached as any[]));
            writeSnapshot(posMenuSnapshotKey, cached);
            return;
          }
          setMenu(mergeMenuWithImages(readSnapshot<any[]>(posMenuSnapshotKey, [])));
        });
      }
      if (shouldRefreshTables) {
        setTables(readSnapshot<any[]>(posTablesSnapshotKey, []));
      }
      void refreshOfflineState();
      notify('error', tx(safeLang, 'POS məlumatları yüklənmədi', 'Не удалось загрузить данные POS', 'Failed to load POS data'));
    } finally {
      refreshInFlightRef.current = false;
    }
  };

  const persistPosMenuOrder = useCallback(async (nextMenu: any[]) => {
    setMenu(nextMenu);
    const liteMenu = nextMenu.map((item) => ({
      ...item,
      image_url: '',
      description: '',
    }));
    writeSnapshot(posMenuSnapshotKey, liteMenu);
    void cacheMenuOffline(tenantId, liteMenu);
    setIsReorderingPosMenu(true);
    try {
      await reorder_menu_items_live(tenantId, nextMenu.map((item) => String(item.id)));
      window.dispatchEvent(new CustomEvent('catalog-updated', { detail: { scope: 'menu' } }));
    } catch (error: any) {
      notify('error', error?.message || tx(safeLang, 'POS menyu sırası yenilənmədi', 'Порядок POS меню не обновился', 'POS menu order update failed'));
      void refreshData({ force: true, menu: true, tables: false });
    } finally {
      setIsReorderingPosMenu(false);
    }
  }, [notify, posMenuSnapshotKey, refreshData, safeLang, tenantId]);

  const handlePosMenuDrop = useCallback(async (targetGroupKey: string) => {
    if (!draggingMenuGroupKey || draggingMenuGroupKey === targetGroupKey || isReorderingPosMenu) {
      setDraggingMenuGroupKey(null);
      setDropMenuGroupKey(null);
      return;
    }
    const nextMenu = moveGroupedMenu(draggingMenuGroupKey, targetGroupKey);
    setDraggingMenuGroupKey(null);
    setDropMenuGroupKey(null);
    if (nextMenu === menu) return;
    await persistPosMenuOrder(nextMenu);
  }, [draggingMenuGroupKey, isReorderingPosMenu, menu, moveGroupedMenu, persistPosMenuOrder]);

  useEffect(() => {
    if (!isPosMenuEditMode) {
      setDraggingMenuGroupKey(null);
      setDropMenuGroupKey(null);
    }
  }, [isPosMenuEditMode]);

  const scheduleRefreshData = (options: { force?: boolean; menu?: boolean; tables?: boolean } = {}) => {
    if (pendingRefreshTimerRef.current) window.clearTimeout(pendingRefreshTimerRef.current);
    pendingRefreshTimerRef.current = window.setTimeout(() => {
      void refreshData(options);
    }, options.force ? 0 : 350);
  };

  useEffect(() => {
    const cachedMenu = readSnapshot<any[]>(posMenuSnapshotKey, []);
    const cachedTables = readSnapshot<any[]>(posTablesSnapshotKey, []);
    if (Array.isArray(cachedMenu) && cachedMenu.length > 0) {
      setMenu(mergeMenuWithImages(cachedMenu));
    }
    if (Array.isArray(cachedTables) && cachedTables.length > 0) {
      setTables(cachedTables);
    }
  }, [mergeMenuWithImages, posMenuSnapshotKey, posTablesSnapshotKey]);

  useEffect(() => {
    if (!isActive) return;
    void refreshMenuImages(true);
    void refreshData({ force: true, menu: true, tables: true });
  }, [tenantId, isActive, refreshMenuImages]);

  useEffect(() => {
    if (!isActive) return;
    void refreshData({ force: true, menu: menu.length === 0, tables: true });
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    const handleFocus = () => {
      scheduleRefreshData({ tables: true, menu: false });
      void refreshOfflineState();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshMenuImages();
        scheduleRefreshData({ tables: true, menu: false });
      }
    };
    const handleCatalogUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; tenant_id?: string }>).detail;
      if (detail?.tenant_id && detail.tenant_id !== tenantId) return;
      const scope = String(detail?.scope || 'all').toLowerCase();
      if (scope === 'menu' || scope === 'all') {
        void refreshMenuImages(true);
        scheduleRefreshData({ force: true, menu: true, tables: false });
      } else if (scope === 'tables') {
        scheduleRefreshData({ tables: true, menu: false });
      }
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('catalog-updated', handleCatalogUpdated as EventListener);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('catalog-updated', handleCatalogUpdated as EventListener);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (pendingRefreshTimerRef.current) window.clearTimeout(pendingRefreshTimerRef.current);
    };
  }, [tenantId, isActive, refreshMenuImages]);



  // ── Lightweight online/offline tracking for POS status badge ──────────────
  useEffect(() => {
    const onOnline = () => setIsPosOnline(true);
    const onOffline = () => setIsPosOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void refreshOfflineState();
    const handleOfflineSalesReset = () => {
      setPendingSyncCount(0);
      setPendingOfflineSales([]);
      void refreshOfflineState();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshOfflineState();
    }, 60000);
    window.addEventListener('offline-sales-reset', handleOfflineSalesReset as EventListener);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('offline-sales-reset', handleOfflineSalesReset as EventListener);
    };
  }, [tenantId, isActive]);

  const categories = useMemo(() => ['ALL', ...Array.from(new Set(menu.map((m) => m.category)))], [menu]);

  const selectedTableData = useMemo(
    () => tables.find((t) => t.id === ctx.selectedTable),
    [tables, ctx.selectedTable],
  );
  const currentRole = String(user?.role || '').toLowerCase();
  const canEditPosMenuOrder = ['admin', 'manager', 'super_admin'].includes(currentRole);

  const occupiedTables = useMemo(
    () => tables.filter((t) => t.is_occupied),
    [tables],
  );

  const seatOptions = useMemo(() => [] as string[], []);

  useEffect(() => {
    if (!ctx.selectedTable) return;
    if (!selectedTableData || !selectedTableData.is_occupied) {
      clearCart(activeCart);
      patchCtx({ ...defaultCtx });
      setTableRoutingBanner(null);
    }
  }, [ctx.selectedTable, selectedTableData, activeCart]);

  useEffect(() => {
    if (tableRoutingBanner && ctx.selectedTable !== tableRoutingBanner.tableId) {
      setTableRoutingBanner(null);
    }
  }, [ctx.selectedTable, tableRoutingBanner]);

  const tablePendingTotal = useMemo(() => {
    if (!selectedTableData?.is_occupied) return new Decimal(0);
    return toDecimalSafe(selectedTableData.total || 0);
  }, [selectedTableData]);

  const filteredMenu = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return menu.filter((item) => {
      const matchesCategory = category === 'ALL' || item.category === category;
      const matchesSearch = normalizedSearch.length === 0 || item.item_name.toLowerCase().includes(normalizedSearch);
      return matchesCategory && matchesSearch;
    });
  }, [menu, category, search]);

  const groupedMenu = useMemo<MenuGroup[]>(() => {
    const groups = new Map<string, any[]>();
    filteredMenu.forEach((item) => {
      const { base } = splitVariantName(item.item_name);
      const key = (base || item.item_name || '').toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });

    return Array.from(groups.entries()).map(([groupKey, items]) => {
      const first = items[0];
      const firstSplit = splitVariantName(first.item_name);
      const resolvedBase = firstSplit.base || first.item_name;
      return {
        group_key: `${groupKey}:${items.length}`,
        base: firstSplit.base || first.item_name,
        category: first.category || '',
        image_url: resolveMenuImage(first),
        description: String(first.description || ''),
        items: [...items].sort((a, b) => toDecimalSafe(a.price).minus(toDecimalSafe(b.price)).toNumber()),
        minPrice: items.reduce(
          (acc, cur) => Decimal.min(acc, toDecimalSafe(cur.price)),
          toDecimalSafe(items[0]?.price),
        ),
        hasVariants: items.length > 1,
        initials: String(resolvedBase || '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((token) => token.slice(0, 1).toUpperCase())
          .join(''),
      };
    });
  }, [filteredMenu]);

  function moveGroupedMenu(sourceKey: string, targetKey: string) {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return menu;
    const visibleGroups = [...groupedMenu];
    const sourceIndex = visibleGroups.findIndex((group) => group.group_key === sourceKey);
    const targetIndex = visibleGroups.findIndex((group) => group.group_key === targetKey);
    if (sourceIndex < 0 || targetIndex < 0) return menu;
    const [movedGroup] = visibleGroups.splice(sourceIndex, 1);
    visibleGroups.splice(targetIndex, 0, movedGroup);

    const visibleItemById = new Map<string, any>();
    const reorderedVisibleItems = visibleGroups.flatMap((group) => group.items);
    reorderedVisibleItems.forEach((item) => visibleItemById.set(String(item.id), item));
    let cursor = 0;
    return menu
      .map((item) => {
        const replacement = visibleItemById.get(String(item.id));
        if (!replacement) return item;
        const next = reorderedVisibleItems[cursor++];
        return next || item;
      })
      .map((item, index) => ({ ...item, sort_order: index }));
  }


  const cartQtyByItemId = useMemo(() => {
    const quantities = new Map<string, number>();
    cart.forEach((item) => {
      const current = quantities.get(item.id) || 0;
      quantities.set(item.id, current + Number(item.qty || 0));
    });
    return quantities;
  }, [cart]);

  const groupQtyByKey = useMemo(() => {
    const quantities = new Map<string, number>();
    groupedMenu.forEach((group) => {
      let total = 0;
      group.items.forEach((item) => {
        total += cartQtyByItemId.get(item.id) || 0;
      });
      quantities.set(group.group_key, total);
    });
    return quantities;
  }, [groupedMenu, cartQtyByItemId]);

  const totals = useMemo(() => {
    const converted = cart.map((item) => ({
      price: toDecimalSafe(item.price),
      qty: item.qty,
      is_coffee: item.is_coffee,
      category: item.category,
      item_name: item.item_name,
    }));

    return calculate_total(
      converted,
      tenantId,
      ctx.customer?.type || 'Normal',
      effectiveDiscountPercent,
      false,
      null,
      ctx.customer ? Number(ctx.customer?.stars || 0) : null,
      beverageServiceSettings,
    );
  }, [cart, ctx.customer, effectiveDiscountPercent, tenantId, beverageServiceSettings]);

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
    const staffBenefits = tenantSettings.staff_benefits || undefined;
    return calculate_staff_payable(converted as any, tenantId, user?.username || 'staff', staffBenefits);
  }, [cart, tenantId, user?.username, tenantSettings.staff_benefits]);

  const payableTotal = selectedPayment === 'Staff' ? staffPreview.final_due : finalTotal;
  const checkoutBaseTotal = cart.length > 0 ? payableTotal : tablePendingTotal;
  const shouldLockTableCheckoutInPos = ctx.orderType === 'Dine In' && cart.length === 0 && Boolean(selectedTableData?.is_occupied);

  const handleCheckout = async (paymentMethod: PaymentMethod) => {
    if (!user) return;
    const isSuperTenantHost = (() => {
      try {
        const host = String(window.location.hostname || '').toLowerCase();
        return host === 'super.ironwaves.store' || host === 'baha.ironwaves.store';
      } catch { return false; }
    })();
    // BahaY: skip shift check for staff on super lab (shift managed by manager)
    if (!isSuperTenantHost) {
      const shift = await refresh_shift_status(tenantId).catch(() => get_shift_status(tenantId));
      if (shift.status !== 'Open') {
        setShowOpenShiftModal(true);
        return;
      }
    }

    if (shouldLockTableCheckoutInPos) {
      notify(
        'info',
        tx(
          safeLang,
          'Masaya göndərilmiş hesabı POS səbətindən yox, Masalar modulundan bağlayın',
          'Счет отправленного на стол заказа нужно закрывать из модуля Столы, а не из POS корзины',
          'Close sent table orders from the Tables module, not from the POS cart',
        ),
      );
      return;
    }

    if (cart.length === 0) return;

    if (parseFloat(ctx.discount || '0') > 0 && !ctx.discountReason?.trim()) {
      notify(
        'error',
        tx(
          safeLang,
          'Maliyyə hesabatlığı üçün endirim səbəbini qeyd edin!',
          'Укажите причину скидки для финансовой отчетности!',
          'Please specify a discount reason for financial reporting!'
        )
      );
      return;
    }

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
        cart_items: cart.map((item, idx) => {
          const promoD = totals.item_promo_discounts ? totals.item_promo_discounts[idx] : undefined;
          return {
            item_name: item.item_name,
            price: toDecimalSafe(item.price).toFixed(2),
            qty: item.qty,
            is_coffee: item.is_coffee,
            category: item.category,
            seat_label: item.seat_label || null,
            cup_mode: item.cup_mode || null,
            promo_discount: promoD && promoD.gt(0) ? promoD.toFixed(2) : undefined,
          };
        }),
        payment_method: paymentMethod,
        discount_percent: effectiveDiscountPercent,
        discount_reason: ctx.discountReason || null,
        order_type: ctx.orderType,
        customer_card_id: ctx.customer?.card_id || null,
        reward_claim_code: rewardClaimCodeForSale,
        split_cash: splitCash ? splitCash.toFixed(2) : null,
        split_card: splitCard ? splitCard.toFixed(2) : null,
      };
      const localPayload = {
        tenant_id: tenantId,
        cart_items: cart.map((item, idx) => {
          const promoD = totals.item_promo_discounts ? totals.item_promo_discounts[idx] : undefined;
          return {
            item_name: item.item_name,
            price: toDecimalSafe(item.price),
            qty: item.qty,
            is_coffee: item.is_coffee,
            category: item.category,
            seat_label: item.seat_label,
            cup_mode: item.cup_mode,
            promo_discount: promoD && promoD.gt(0) ? promoD.toString() : undefined,
          };
        }),
        payment_method: paymentMethod,
        cashier: user.username,
        customer_card_id: ctx.customer?.card_id || null,
        reward_claim_code: rewardClaimCodeForSale,
        discount_percent: effectiveDiscountPercent,
        discount_reason: ctx.discountReason || null,
        is_eco_cup: false,
        is_test: false,
        split_cash: splitCash,
        split_card: splitCard,
        card_tips: new Decimal(0),
        customer_type: ctx.customer?.type || 'Normal',
        order_type: ctx.orderType,
        cup_mode: ctx.cupMode,
      };
      const useBackendNow = isBackendEnabled();
      let sale: any;
      let queuedOffline = false;

      if (useBackendNow) {
        try {
          sale = await apiRequest<any>('/api/v1/pos/sale', {
            method: 'POST',
            tenantId: null,
            body: backendPayload,
          });
          if (sale && ctx.customer) {
            const customerStarsAfter = sale.customer_stars_after;
            if (customerStarsAfter !== undefined && customerStarsAfter !== null) {
              const localCustomers = getDB<any>(`${tenantId}_customers`) || [];
              const updatedCustomers = localCustomers.map((c: any) => {
                if (String(c.card_id || '') === String(ctx.customer?.card_id || '')) {
                  return { ...c, stars: customerStarsAfter };
                }
                return c;
              });
              setDB(`${tenantId}_customers`, updatedCustomers);
            }
          }
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

      const receiptCart = cart.map((item) => ({ ...item }));
      const receiptCustomer = ctx.customer;
      const receiptOrderType = ctx.orderType;
      const settingsSnapshot = tenantSettings && Object.keys(tenantSettings).length > 0
        ? tenantSettings
        : (get_settings(tenantId) || {});
      const renderReceipt = async () => {
        const lines = receiptCart
          .map(
            (item) =>
              `<tr><td>${item.qty}x ${item.item_name}</td><td>${toDecimalSafe(item.price)
                .times(item.qty)
                .toFixed(2)} ₼</td></tr>`,
          )
          .join('');
        const configuredBase = String(settingsSnapshot?.qr_settings?.base_url || businessProfile?.website || '').trim();
        const baseUrl = (configuredBase || window.location.origin).replace(/\/+$/, '');
        const tenantDomainRows = getTenantDomains();
        const tenantDomain =
          tenantDomainRows.find((row) => String(row?.tenant_id || '') === tenantId && Boolean(row?.is_primary))?.domain ||
          tenantDomainRows.find((row) => String(row?.tenant_id || '') === tenantId)?.domain ||
          '';
        const tenantBaseUrl = tenantDomain ? `https://${String(tenantDomain).trim().replace(/^https?:\/\//, '')}` : baseUrl;
        const receiptRef = (sale as any).receipt_code || sale.sale_id;
        const receiptUrl = `${baseUrl}/?r=${encodeURIComponent(receiptRef)}&t=${encodeURIComponent((sale as any).receipt_token || '')}`;
        const feedbackSettings = settingsSnapshot?.feedback_settings || {};
        const feedbackPromptText =
          safeLang === 'ru'
            ? String(
                feedbackSettings?.receipt_qr_prompt_ru ||
                  'Ваше мнение очень важно для нас. Пожалуйста, отсканируйте QR и оставьте отзыв.',
              )
            : safeLang === 'en'
              ? String(
                  feedbackSettings?.receipt_qr_prompt_en ||
                    'Your feedback matters to us. Please scan the QR code and share your review.',
                )
              : String(
                  feedbackSettings?.receipt_qr_prompt_az ||
                    'Rəyiniz bizim üçün çox önəmlidir, lütfən QR skan edib rəyinizi bildirin.',
                );
        const defaultFeedbackPortalUrl = `${tenantBaseUrl.replace(/\/+$/, '')}/feedback`;
        const feedbackBaseUrl = String(feedbackSettings?.portal_url || defaultFeedbackPortalUrl || '').trim();
        const feedbackEnabled = feedbackSettings?.enabled !== false && Boolean(feedbackBaseUrl);
        let feedbackUrl = '';
        if (feedbackBaseUrl) {
          try {
            const u = new URL(feedbackBaseUrl, tenantBaseUrl);
            if (tenantDomain && u.hostname === 'super.ironwaves.store') {
              u.hostname = String(tenantDomain).trim().replace(/^https?:\/\//, '');
            }
            u.pathname = '/feedback';
            u.searchParams.set('tenant_id', tenantId);
            u.searchParams.set('sale_id', String(sale.sale_id || ''));
            u.searchParams.set('receipt_id', String(receiptRef || ''));
            u.searchParams.set('r', String(receiptRef || ''));
            u.searchParams.set('t', String((sale as any).receipt_token || ''));
            feedbackUrl = u.toString();
          } catch {
            feedbackUrl = feedbackBaseUrl;
          }
        }
        const barcodeSvg = generateBarcodeSvg(`SALE:${sale.sale_id}`);
        const receiptCustomerId = String((sale as any)?.customer_card_id || receiptCustomer?.card_id || '').trim();
        const receiptStarsAfter = Number((sale as any)?.customer_stars_after ?? totals.customer_stars_after ?? 0);
        const qrDataUrl = await QRCode.toDataURL(feedbackUrl || receiptUrl, {
          width: 156,
          margin: 2,
          errorCorrectionLevel: 'L',
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });

        const receiptMarkup = `
          <html>
            <head>
              <style>
                ${THERMAL_RECEIPT_PRINT_CSS}
              </style>
            </head>
            <body>
              ${businessProfile?.logo_url ? `<img src="${businessProfile.logo_url}" style="height:34px;max-width:180px;object-fit:contain;margin-bottom:6px" />` : ''}
              <div class="bold" style="font-size:15px">${businessProfile?.company_name || 'IRONWAVES POS'}</div>
              <div class="muted">VÖEN: ${businessProfile?.voen || '-'}</div>
              <div class="muted">Tel: ${businessProfile?.phone || '-'}</div>
              <div class="muted">${businessProfile?.address || '-'}</div>
              <hr />
              <div class="line"><span>${tx(lang, 'Satış ID', 'ID продажи', 'Sale ID')}</span><span>${formatDisplayId(sale.sale_id)}</span></div>
              <div class="line"><span>${tx(lang, 'Operator', 'Оператор', 'Operator')}</span><span>${user.username}</span></div>
              <div class="line"><span>${tx(lang, 'Tarix', 'Дата', 'Date')}</span><span>${new Date().toLocaleString()}</span></div>
              <div class="line"><span>${tx(lang, 'Tip', 'Тип', 'Type')}</span><span>${receiptOrderType}</span></div>
              <div style="margin-top:8px;text-align:center">${barcodeSvg || ''}</div>
              <div class="muted" style="text-align:center">SALE:${formatDisplayId(sale.sale_id)}</div>
              <hr />
              <table>${lines}</table>
              <hr />
              <div class="line"><span>${tx(lang, 'Ara cəm', 'Промежуточный итог', 'Subtotal')}</span><span>${saleRaw.toFixed(2)} ₼</span></div>
              <div class="line"><span>${tx(lang, 'Endirim', 'Скидка', 'Discount')}</span><span>- ${saleDiscount.toFixed(2)} ₼</span></div>
              ${saleFreeCoffees > 0 ? `<div class="line"><span>${tx(lang, 'Pulsuz kofe', 'Бесплатный кофе', 'Free coffee')}</span><span>${saleFreeCoffees}</span></div>` : ''}
              ${receiptCustomerId ? `<div class="line"><span>${tx(lang, 'Müştəri ID', 'ID клиента', 'Customer ID')}</span><span>${receiptCustomerId}</span></div>` : ''}
              ${receiptCustomerId ? `<div class="line"><span>${tx(lang, 'Ulduz balansı', 'Баланс звезд', 'Star Balance')}</span><span>${receiptStarsAfter}</span></div>` : ''}
              <div class="line bold"><span>${tx(lang, 'Yekun', 'Итого', 'Total')}</span><span>${saleFinal.toFixed(2)} ₼</span></div>
              <div class="line"><span>${tx(lang, 'Ödəniş', 'Оплата', 'Payment')}</span><span>${paymentMethod === 'Nəğd' ? 'Nağd' : paymentMethod}</span></div>
              ${paymentMethod === 'Split' ? `<div class="line"><span>${tx(lang, 'Split nağd', 'Split наличные', 'Split cash')}</span><span>${(splitCash || new Decimal(0)).toFixed(2)} ₼</span></div>` : ''}
              ${paymentMethod === 'Split' ? `<div class="line"><span>${tx(lang, 'Split kart', 'Split карта', 'Split card')}</span><span>${(splitCard || new Decimal(0)).toFixed(2)} ₼</span></div>` : ''}
              <hr />
              <div style="display:flex;justify-content:center;margin:8px 0 6px 0">
                <img src="${qrDataUrl}" alt="receipt qr" style="width:108px;height:108px" />
              </div>
              ${feedbackEnabled ? `<div class="muted" style="font-size:10px;text-align:center">${feedbackPromptText}</div>` : ''}
              <hr />
              <div class="muted">${businessProfile?.receipt_footer || tx(lang, 'Bizi seçdiyiniz üçün təşəkkür edirik!', 'Спасибо, что выбрали нас!', 'Thank you for choosing us!')}</div>
            </body>
          </html>
        `;
        setReceiptHtml(receiptMarkup);
        if (isBackendEnabled() && !queuedOffline && String(sale.sale_id || '').trim()) {
          void save_sale_receipt_html_live(String(sale.sale_id), receiptMarkup).catch(() => undefined);
        }
      };

      if (queuedOffline) {
        void refreshOfflineState();
        notify('info', tx(safeLang, 'Satış offline yadda saxlandı, bağlantı gələndə sinxron olacaq', 'Продажа сохранена офлайн и синхронизируется при подключении', 'Sale saved offline and will sync when connection returns'));
      }

      window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { tenant_id: tenantId, sale_id: sale.sale_id, source: 'pos' } }));
      window.dispatchEvent(new CustomEvent('logs-updated', { detail: { tenant_id: tenantId, sale_id: sale.sale_id, source: 'pos' } }));
      if (feedbackCouponPreview?.status === 'PENDING' && isFeedbackCouponCode(enteredClaimCode)) {
        void redeem_feedback_coupon_live(tenantId, enteredClaimCode, String(sale.sale_id || ''));
      }
      clearCart(activeCart);
      patchCtx({ ...defaultCtx });
      setSplitCashInput('0');
      window.setTimeout(() => {
        void renderReceipt().catch((error) => {
          logUiError(tenantId, 'pos', error instanceof Error ? error.message : String(error), { phase: 'receipt_render' });
        });
      }, 0);
      void refreshData({ tables: true, menu: false });
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
      const sentTable = ctx.selectedTable;
      await send_to_kitchen_live(
        sentTable,
        cart.map((c) => ({ ...c, price: toDecimalSafe(c.price), seat_label: c.seat_label })) as any,
        user.username,
        { cup_mode: ctx.cupMode },
      );
      clearCart(activeCart);
      patchCtx({ kitchenSent: true });
      window.dispatchEvent(new CustomEvent('table-order-sent', { detail: { tenant_id: tenantId, table_id: sentTable } }));
      void refreshData({ tables: true, menu: false });
      notify('success', tx(lang, 'Sifariş mətbəxə göndərildi. Ödəniş üçün masa seçimi saxlanıldı.', 'Заказ отправлен на кухню. Для оплаты стол сохранен.', 'Order sent to the kitchen. The table remains open for payment.'));
    } catch (error: any) {
      logUiError(tenantId, 'pos', error?.message || String(error), { phase: 'send_to_kitchen' });
      notify('error', error?.message || tx(lang, 'Mətbəxə göndərmə alınmadı', 'Не удалось отправить на кухню', 'Failed to send the order to the kitchen'));
    }
  };

  const applyRewardCode = (rawCode: string, mode: 'reward' | 'feedback' = 'reward') => {
    const normalized = normalizeRewardClaimCode(rawCode);
    if (!normalized) return;
    patchCtx({ rewardClaimCode: normalized, customerQR: '' });
    if (isFeedbackCouponCode(normalized)) {
      void (async () => {
        const found = await find_feedback_coupon_live(tenantId, normalized);
        if (!found) {
          notify('error', tx(lang, 'Kupon tapılmadı', 'Купон не найден', 'Coupon not found'));
          setFeedbackCouponPreview(null);
          patchCtx({ rewardClaimCode: '', customerQR: '' });
          return;
        }
        if (found.status !== 'PENDING') {
          notify('error', tx(lang, 'Bu feedback kuponu artıq istifadə olunub', 'Этот feedback купон уже использован', 'This feedback coupon is already used'));
          setFeedbackCouponPreview(null);
          patchCtx({ rewardClaimCode: '', customerQR: '' });
          return;
        }
        setFeedbackCouponPreview({
          code: found.code,
          percent: Number(found.percent || 5),
          status: String(found.status || 'PENDING'),
        });
        notify(
          'success',
          tx(lang, `Feedback kuponu aktivdir: -${Number(found.percent || 5)}%`, `Купон feedback активен: -${Number(found.percent || 5)}%`, `Feedback coupon active: -${Number(found.percent || 5)}%`)
        );
      })();
      return;
    }
    notify(
      'success',
      mode === 'feedback'
        ? tx(lang, 'Feedback kuponu oxundu', 'Купон feedback считан', 'Feedback coupon scanned')
        : tx(lang, 'Reward kodu oxundu', 'Код награды считан', 'Reward code scanned'),
    );
  };

  const handleFindCustomer = async () => {
    const code = (ctx.customerQR || '').trim();
    if (!code) return;
    const upper = code.toUpperCase();
    let extracted = code;
    if (code.includes('id=')) {
      extracted = code.split('id=')[1]?.split('&')[0] || code;
    } else if (upper.startsWith('IWPOS:CARD:')) {
      extracted = code.split(':').slice(2).join(':') || code;
    } else if (upper.startsWith('CARD:')) {
      extracted = code.split(':').slice(1).join(':') || code;
    } else if (upper.startsWith('IWPOS:CLAIM:')) {
      applyRewardCode(code, 'reward');
      return;
    } else if (upper.startsWith('IWPOS:FB:')) {
      applyRewardCode(code, 'feedback');
      return;
    }
    const normalizedCode = normalizeRewardClaimCode(code);
    if (isFeedbackCouponCode(normalizedCode)) {
      applyRewardCode(normalizedCode, 'feedback');
      return;
    }
    // Try local cache first
    const customers = getDB<any>(`${tenantId}_customers`) || [];
    const found = customers.find((c: any) => String(c.card_id || '') === extracted);
    if (found) {
      patchCtx({ customer: found, customerQR: '', discount: String(Number(found.discount_percent || 0)) });
      notify('success', tx(lang, 'Müştəri tapıldı', 'Клиент найден', 'Customer found'));
      return;
    }
    // Try backend lookup
    if (isBackendEnabled()) {
      try {
        const result = await apiRequest<any>(`/api/v1/ops/customers?search=${encodeURIComponent(extracted)}`, { tenantId: null, timeoutMs: 5000, retryCount: 0 });
        const rows = Array.isArray(result) ? result : (Array.isArray(result?.customers) ? result.customers : []);
        const backendFound = rows.find((c: any) => String(c.card_id || '') === extracted);
        if (backendFound) {
          patchCtx({ customer: backendFound, customerQR: '', discount: String(Number(backendFound.discount_percent || 0)) });
          notify('success', tx(lang, 'Müştəri tapıldı', 'Клиент найден', 'Customer found'));
          return;
        }
      } catch {
        // Backend lookup failed, continue to not-found
      }
    }
    notify('error', tx(lang, 'Müştəri tapılmadı', 'Клиент не найден', 'Customer not found'));
  };

  const handleRewardCodeEnter = () => {
    const normalized = normalizeRewardClaimCode(ctx.rewardClaimCode || '');
    patchCtx({ rewardClaimCode: normalized });
    if (!normalized) {
      setFeedbackCouponPreview(null);
      return;
    }
    if (!isFeedbackCouponCode(normalized)) {
      notify(
        'error',
        tx(
          lang,
          'Kod formatı yanlışdır. FB-XXXXXX formatından istifadə edin.',
          'Неверный формат кода. Используйте формат FB-XXXXXX.',
          'Invalid code format. Use FB-XXXXXX format.',
        ),
      );
      setFeedbackCouponPreview(null);
      return;
    }
    void (async () => {
      const found = await find_feedback_coupon_live(tenantId, normalized);
      if (!found) {
        notify(
          'error',
          tx(lang, 'Kupon tapılmadı', 'Купон не найден', 'Coupon not found'),
        );
        setFeedbackCouponPreview(null);
        patchCtx({ rewardClaimCode: '' });
        return;
      }
      if (found.status !== 'PENDING') {
        notify(
          'error',
          tx(lang, 'Bu feedback kuponu artıq istifadə olunub', 'Этот feedback купон уже использован', 'This feedback coupon is already used'),
        );
        setFeedbackCouponPreview(null);
        patchCtx({ rewardClaimCode: '' });
        return;
      }
      setFeedbackCouponPreview({
        code: found.code,
        percent: Number(found.percent || 5),
        status: String(found.status || 'PENDING'),
      });
      notify(
        'success',
        tx(
          lang,
          `Feedback kuponu aktivdir: -${Number(found.percent || 5)}%`,
          `Купон feedback активен: -${Number(found.percent || 5)}%`,
          `Feedback coupon active: -${Number(found.percent || 5)}%`,
        ),
      );
    })();
  };

  useEffect(() => {
    let cancelled = false;
    const raw = String(ctx.rewardClaimCode || '').trim().toUpperCase();
    if (!raw || !isFeedbackCouponCode(raw)) {
      setFeedbackCouponPreview(null);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const found = await find_feedback_coupon_live(tenantId, raw);
      if (cancelled || !found) {
        if (!cancelled) {
          setFeedbackCouponPreview(null);
          patchCtx({ rewardClaimCode: '' });
        }
        return;
      }
      if (found.status !== 'PENDING') {
        if (!cancelled) {
          setFeedbackCouponPreview(null);
          patchCtx({ rewardClaimCode: '' });
          notify('error', tx(lang, 'Bu feedback kuponu artıq istifadə olunub', 'Этот feedback купон уже использован', 'This feedback coupon is already used'));
        }
        return;
      }
      setFeedbackCouponPreview({
        code: found.code,
        percent: Number(found.percent || 5),
        status: String(found.status || 'PENDING'),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, ctx.rewardClaimCode]);

  const printReceiptOnly = async () => {
    if (safeReceiptHtml) {
      try {
        await printViaLocalAgent(safeReceiptHtml, printSettings.printer_name);
        notify('success', tx(lang, 'iRonWaves Print Agent ilə çap göndərildi', 'Печать отправлена через iRonWaves Print Agent', 'Print job sent via iRonWaves Print Agent'));
        return;
      } catch {
        // Local agent is optional; fall back to QZ/browser print.
      }
    }
    if (printSettings.use_qz && safeReceiptHtml) {
      try {
        await qzPrintHtml(safeReceiptHtml, printSettings.printer_name);
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

  const handleRetrySingleOffline = async (queueId: string) => {
    await scheduleOfflineSaleRetryNow(tenantId, queueId);
    await refreshOfflineState();
    notify('info', tx(safeLang, 'Satış yenidən cəhd növbəsinə alındı', 'Продажа снова поставлена в очередь повтора', 'Sale was queued for retry'));
  };

  const isWidgetVisible = (widget: string) => !posLayout.hidden_widgets?.includes(widget);
  const isLeftWidgetVisible = (widget: string) => !posLayout.left_hidden_widgets?.includes(widget);
  const getWidgetSize = (widget: string) => posLayout.widget_sizes?.[widget] || 'comfortable';
  const getLeftWidgetSize = (widget: string) => posLayout.left_widget_sizes?.[widget] || 'comfortable';
  const productGridClass =
    posLayout.product_columns === 2
      ? 'md:grid-cols-2 2xl:grid-cols-2'
      : posLayout.product_columns === 4
        ? 'md:grid-cols-2 2xl:grid-cols-4'
        : 'md:grid-cols-2 2xl:grid-cols-3';
  const productItemClass =
    getLeftWidgetSize('productGrid') === 'compact'
      ? 'min-h-12 p-2'
      : getLeftWidgetSize('productGrid') === 'expanded'
        ? 'min-h-20 p-4'
        : 'min-h-14 p-3';
  const densityClass =
    posLayout.density === 'compact'
      ? 'text-[13px]'
      : posLayout.density === 'large'
        ? 'text-[15px]'
        : 'text-sm';
  const shellClass =
    posLayout.preset === 'touch'
      ? 'bg-[radial-gradient(circle_at_top,#314155,#161f2a_58%)]'
      : posLayout.preset === 'fast'
        ? 'bg-[radial-gradient(circle_at_top,#22303d,#121922_58%)]'
        : posLayout.preset === 'tables'
          ? 'bg-[radial-gradient(circle_at_top,#2e3247,#151b26_58%)]'
          : 'bg-[radial-gradient(circle_at_top,#2a3342,#141b24_55%)]';
  // BahaY: Aelia-style new POS UI — controlled by tenant setting with local override fallback
  const isNewUiMode = (() => {
    try {
      const local = localStorage.getItem('iw_pos_ui_mode');
      if (local === 'modern') return true;
      if (local === 'classic') return false;
    } catch {}
    try {
      const host = String(window.location.hostname || '').toLowerCase();
      if (host === 'super.ironwaves.store') return true;
    } catch {}
    const fromSettings = String(tenantSettings.session_settings?.tables_ui_mode || tenantSettings.tables_ui_mode || '').toLowerCase();
    return fromSettings === 'modern';
  })();
  const orderTypeBlockVisible = isWidgetVisible('orderType');
  const tableBlockVisible = isWidgetVisible('table');
  const sidebarWidgetOrder = posLayout.widget_order || [];
  const pinnedCheckoutWidgets = ['cartSummary', 'payments'];
  const floatingSidebarWidgets = sidebarWidgetOrder.filter((widget) => !pinnedCheckoutWidgets.includes(widget));
  const footerSidebarWidgets = sidebarWidgetOrder.filter((widget) => pinnedCheckoutWidgets.includes(widget));
  const renderSidebarWidget = (widget: string) => {
    if (!isWidgetVisible(widget)) return null;
    if (widget === 'customer') {
      const size = getWidgetSize(widget);
      return (
        <React.Fragment key={widget}>
          <div className={`relative ${size === 'expanded' ? 'mb-1' : ''}`}>
            <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              placeholder={tx(lang, 'Kart / reward / feedback kodunu skan et...', 'Сканируйте карту / reward / feedback код...', 'Scan member / reward / feedback code...')}
              className={`neon-input pl-9 ${size === 'compact' ? 'h-10' : size === 'expanded' ? 'h-14' : 'h-12'}`}
              value={ctx.customerQR}
              onChange={(e) => patchCtx({ customerQR: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleFindCustomer()}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleFindCustomer}
              className="pay-btn h-12 w-full"
              title={tx(lang, 'Kodu oxuyub müştəri və ya kupon kimi özü tətbiq edir.', 'Считывает код и сам применяет как клиента или купон.', 'Reads the code and auto-applies it as customer or coupon.')}
              data-guide={tx(lang, 'Kodu oxuyub müştəri və ya kupon kimi özü tətbiq edir.', 'Считывает код и сам применяет как клиента или купон.', 'Reads the code and auto-applies it as customer or coupon.')}
            >
              {tx(lang, 'Kodu Oxu', 'Считать код', 'Read Code')}
            </button>
            <button
              onClick={() => patchCtx({ customer: null, customerQR: '', rewardClaimCode: '' })}
              className="pay-btn h-12 w-full"
              title={tx(lang, 'Müştəri və reward sahələrini sıfırlayır.', 'Сбрасывает клиента и поля reward.', 'Resets customer and reward fields.')}
              data-guide={tx(lang, 'Müştəri və reward sahələrini sıfırlayır.', 'Сбрасывает клиента и поля reward.', 'Resets customer and reward fields.')}
            >
              {tx(lang, 'Təmizlə', 'Очистить', 'Clear')}
            </button>
          </div>
          {ctx.customer && (
            <div className="rounded-md border border-emerald-400/40 bg-emerald-500/10 p-2 text-xs text-emerald-200">
              QR: {ctx.customer.card_id} | {tx(lang, 'Ulduz', 'Звезды', 'Stars')}: {ctx.customer.stars} | {tx(lang, 'Tip', 'Тип', 'Type')}: {ctx.customer.type} | {tx(lang, 'Endirim', 'Скидка', 'Discount')}: {Number(ctx.customer.discount_percent || 0)}%
            </div>
          )}
        </React.Fragment>
      );
    }
    if (widget === 'discount') {
      const size = getWidgetSize(widget);
      return (
        <React.Fragment key={widget}>
          {feedbackCouponPreview ? (
            <div
              className={`rounded-md border px-2 py-1 text-xs ${
                feedbackCouponPreview.status === 'PENDING'
                  ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-600/60 bg-slate-700/30 text-slate-300'
              }`}
            >
              {feedbackCouponPreview.status === 'PENDING'
                ? tx(
                    lang,
                    `Feedback kuponu aktivdir: -${feedbackCouponPreview.percent}%`,
                    `Купон feedback активен: -${feedbackCouponPreview.percent}%`,
                    `Feedback coupon active: -${feedbackCouponPreview.percent}%`,
                  )
                : tx(lang, 'Bu feedback kuponu artıq istifadə olunub', 'Этот feedback купон уже использован', 'This feedback coupon is already used')}
            </div>
          ) : null}
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-400">{tx(lang, 'Endirim %', 'Скидка %', 'Discount %')}</span>
            {ctx.discount && parseFloat(ctx.discount) > 0 && (
              <span className="text-[11px] text-amber-300 font-bold bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">
                {ctx.discount}%
              </span>
            )}
          </div>
          {!hasClaimCode && (
            <div className="grid grid-cols-5 gap-1 mt-1.5">
              {['0', '5', '10', '15', '20'].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => patchCtx({ discount: val })}
                  className={`rounded-lg border py-1.5 text-[11px] font-semibold transition ${
                    (ctx.discount || '0') === val ? 'border-amber-300 bg-amber-500/20 text-amber-100 font-bold' : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-700/50'
                  }`}
                >
                  {val}%
                </button>
              ))}
            </div>
          )}
          {parseFloat(ctx.discount || '0') > 0 && (
            <div className="mt-2 space-y-1">
              <input
                type="text"
                value={ctx.discountReason}
                onChange={(e) => patchCtx({ discountReason: e.target.value })}
                placeholder={tx(lang, 'Endirim səbəbi (məs. Müştəri məmnuniyyəti)', 'Причина скидки', 'Discount reason')}
                className={`neon-input ${size === 'compact' ? 'h-10' : size === 'expanded' ? 'h-14' : 'h-12'}`}
                required
              />
            </div>
          )}
          {hasClaimCode ? (
            <div className="text-[11px] text-amber-300">
              {tx(
                lang,
                'Bu çekdə endirim kodu aktivdir: əlavə manual endirim bağlanıb.',
                'В этом чеке активен код скидки: ручная скидка отключена.',
                'A discount code is active for this check: manual discount is disabled.',
              )}
            </div>
          ) : null}
        </React.Fragment>
      );
    }
    if (widget === 'orderType' && orderTypeBlockVisible) {
      const size = getWidgetSize(widget);
      if (!(ctx.orderType === 'Dine In' && ctx.selectedTable)) {
        return null;
      }
      return (
        <div key={widget} className={`grid grid-cols-1 gap-2 ${size === 'expanded' ? 'text-sm' : 'text-xs'}`}>
          <div className="rounded-md border border-cyan-300/40 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            {tx(lang, 'Masa rejimi aktivdir. Bu POS sessiyası yalnız seçilmiş masa üçündür.', 'Режим стола активен. Эта POS-сессия только для выбранного стола.', 'Table mode is active. This POS session is for the selected table only.')}
          </div>
        </div>
      );
    }
    if (widget === 'table' && tableBlockVisible) {
      const size = getWidgetSize(widget);
      return (
        <React.Fragment key={widget}>
          {ctx.selectedTable && (
            <div className={`space-y-2 ${size === 'expanded' ? 'text-sm' : 'text-xs'}`}>
              {tableRoutingBanner && ctx.selectedTable === tableRoutingBanner.tableId && (
                <div className="rounded-lg border border-cyan-300/40 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
                  {tx(lang, 'Bu sifariş', 'Этот заказ', 'This order is for')} <span className="font-bold">{tableRoutingBanner.tableLabel}</span>.
                </div>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button onClick={() => patchCtx({ cupMode: 'paper' })} className={`rounded-md border px-2 py-2 text-xs font-semibold ${ctx.cupMode === 'paper' ? 'text-slate-900' : 'border-slate-600 bg-slate-800/40 text-slate-200'}`} style={ctx.cupMode === 'paper' ? { borderColor: posLayout.accent_color, backgroundColor: posLayout.accent_color } : undefined}>
                  {tx(lang, 'Kağız stəkan', 'Бумажный стакан', 'Paper cup')}
                </button>
                <button onClick={() => patchCtx({ cupMode: 'glass' })} className={`rounded-md border px-2 py-2 text-xs font-semibold ${ctx.cupMode === 'glass' ? 'text-slate-900' : 'border-slate-600 bg-slate-800/40 text-slate-200'}`} style={ctx.cupMode === 'glass' ? { borderColor: posLayout.accent_color, backgroundColor: posLayout.accent_color } : undefined}>
                  {tx(lang, 'Şüşə stəkan', 'Стеклянный стакан', 'Glass cup')}
                </button>
              </div>
              {occupiedTables.length > 0 && (
                <div className="rounded-lg border border-slate-700/70 bg-[#0e1520] p-3 text-xs text-slate-300">
                  <div className="mb-2 font-semibold text-slate-200">{tx(lang, 'Açıq masa hesabları', 'Открытые счета столов')}</div>
                  <div className="flex flex-wrap gap-2">
                    {occupiedTables.map((t) => (
                      <button
                        key={`open_${t.id}`}
                        disabled={Boolean(t.assigned_to && t.assigned_to !== user?.username)}
                        onClick={() => patchCtx({ selectedTable: t.id, orderType: 'Dine In' })}
                        className={`rounded-md border px-2 py-1 ${ctx.selectedTable === t.id ? 'text-slate-900' : 'border-slate-600 bg-slate-800/40 text-slate-200'} disabled:cursor-not-allowed disabled:opacity-45`}
                        style={ctx.selectedTable === t.id ? { borderColor: posLayout.accent_color, backgroundColor: posLayout.accent_color } : undefined}
                      >
                        {t.label} - {toDecimalSafe(t.total || 0).toFixed(2)} ₼ {t.assigned_to ? `· ${t.assigned_to}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                disabled={isLoading || !ctx.selectedTable || cart.length === 0}
                onClick={() => { void handleSendToKitchen(); }}
                className="pay-btn h-12 w-full"
                title={tx(lang, 'Cari səbəti seçilmiş masa üçün mətbəxə göndərir.', 'Отправляет текущую корзину на кухню для выбранного стола.', 'Sends current cart to kitchen for selected table.')}
                data-guide={tx(lang, 'Cari səbəti seçilmiş masa üçün mətbəxə göndərir.', 'Отправляет текущую корзину на кухню для выбранного стола.', 'Sends current cart to kitchen for selected table.')}
              >
                {tx(lang, 'Mətbəxə Göndər', 'Отправить на кухню', 'Send To Kitchen')}
              </button>
            </div>
          )}
        </React.Fragment>
      );
    }
    if (widget === 'cartItems') {
      const size = getWidgetSize(widget);
      return (
        <div
          key={widget}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-slate-700/70 bg-[#0d141e] p-3"
          style={{ resize: 'vertical', minHeight: size === 'compact' ? '120px' : size === 'expanded' ? '220px' : posLayout.density === 'large' ? '180px' : '150px' }}
        >
          {cart.length === 0 && <div className="pt-8 text-center text-sm text-slate-500">{t.cart_empty}</div>}
          {cart.map((item, idx) => {
            const promoD = totals.item_promo_discounts ? totals.item_promo_discounts[idx] : undefined;
            return (
              <div key={item.line_id} className="rounded-md border border-slate-700 bg-slate-900/40 p-2">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-semibold text-slate-100">{item.item_name}</div>
                    {item.cup_mode && (
                      <div className="text-[11px] text-slate-400">
                        {item.cup_mode === 'glass'
                          ? tx(lang, 'Stəkan (masa)', 'Стакан (table)', 'Glass (table)')
                          : tx(lang, 'Kağız stəkan (to go)', 'Бумажный стакан (to go)', 'Paper cup (to go)')}
                      </div>
                    )}
                  </div>
                  <span className="font-semibold text-yellow-300">{toDecimalSafe(item.price).times(item.qty).toFixed(2)} ₼</span>
                </div>
                {promoD && promoD.gt(0) && (
                  <div className="mb-2 text-xs text-yellow-400/90 italic pl-1">
                    [Promo] 2nd Item 50% Off: -{promoD.toFixed(2)} ₼
                  </div>
                )}
                <div className="flex items-center justify-end gap-1">
                  <button className="neon-mini-btn" onClick={() => updateCartItem(item.line_id, item.qty - 1)}><Minus size={13} /></button>
                  <span className="w-6 text-center text-sm">{item.qty}</span>
                  <button className="neon-mini-btn" onClick={() => updateCartItem(item.line_id, item.qty + 1)}><Plus size={13} /></button>
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    if (widget === 'cartSummary') {
      const size = getWidgetSize(widget);
      return (
        <div key={widget} className={`space-y-2 border-t border-slate-700/60 bg-[#101722] pt-3 ${size === 'compact' ? 'text-xs' : size === 'expanded' ? 'text-base' : 'text-sm'}`}>
          <div className="flex justify-between text-slate-300"><span>{tx(lang, 'Ara cəm', 'Промежуточный итог', 'Subtotal')}</span><span>{rawTotal.toFixed(2)} ₼</span></div>
          <div className="flex justify-between text-slate-300"><span>{tx(lang, 'Endirim', 'Скидка', 'Discount')}</span><span>- {discountAmount.toFixed(2)} ₼</span></div>
          {totals.free_coffees > 0 && <div className="flex justify-between text-emerald-300"><span>{tx(lang, 'Pulsuz kofe', 'Бесплатный кофе', 'Free coffee')}</span><span>{totals.free_coffees}</span></div>}
          <div className="flex justify-between text-xl font-bold text-white"><span>{tx(lang, 'Yekun', 'Итого', 'Total')}</span><span>{checkoutBaseTotal.toFixed(2)} ₼</span></div>
        </div>
      );
    }
    if (widget === 'payments') {
      const size = getWidgetSize(widget);
      if (ctx.orderType === 'Dine In' && ctx.selectedTable) {
        return (
          <React.Fragment key={widget}>
            <div className="rounded-lg border border-cyan-300/35 bg-cyan-500/10 px-3 py-3 text-sm text-cyan-100">
              <div className="font-semibold">
                {tx(lang, 'Bu POS səbəti masa sifarişi üçündür.', 'Эта корзина POS предназначена для заказа на стол.', 'This POS cart is for a table order.')}
              </div>
              <div className="mt-1 text-xs text-cyan-200/90">
                {tx(lang, 'Məhsulları seçib birbaşa masaya göndərin.', 'Выберите товары и отправьте их прямо на стол.', 'Select items and send them directly to the table.')}
              </div>
            </div>
            <button
              disabled={isLoading || !ctx.selectedTable || cart.length === 0}
              onClick={() => { void handleSendToKitchen(); }}
              className={`flex ${size === 'compact' ? 'h-12 text-sm' : size === 'expanded' ? 'h-16 text-lg' : 'h-14 text-base'} items-center justify-center gap-2 rounded-lg border px-4 font-bold text-white shadow-[0_0_22px_rgba(34,197,94,0.28)] disabled:opacity-50`}
              style={{ backgroundColor: posLayout.accent_color, borderColor: posLayout.accent_color, color: '#111827' }}
              title={tx(lang, 'Səbəti birbaşa seçilmiş masaya göndərir.', 'Отправляет корзину напрямую к выбранному столу.', 'Sends cart directly to selected table.')}
              data-guide={tx(lang, 'Səbəti birbaşa seçilmiş masaya göndərir.', 'Отправляет корзину напрямую к выбранному столу.', 'Sends cart directly to selected table.')}
            >
              <Check size={18} /> {tx(lang, 'Masaya Göndər', 'Отправить на стол', 'Send To Table')}
            </button>
          </React.Fragment>
        );
      }
      return (
        <React.Fragment key={widget}>
          <div className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${size === 'expanded' ? 'text-sm' : 'text-xs'}`}>
            {(['Nəğd', 'Kart', 'Split', 'Staff'] as PaymentMethod[]).map((method) => (
              <button key={method} disabled={isLoading} onClick={() => setSelectedPayment(method)} className={`pay-btn ${size === 'compact' ? 'h-10' : size === 'expanded' ? 'h-14' : 'h-12'} ${selectedPayment === method ? 'pay-btn-active' : ''}`}>{method === 'Nəğd' ? tx(lang, 'Nəğd', 'Наличные', 'Cash') : method === 'Kart' ? tx(lang, 'Kart', 'Карта', 'Card') : method === 'Split' ? tx(lang, 'Bölünmüş', 'Разделено', 'Split') : tx(lang, 'Staff', 'Персонал', 'Staff')}</button>
            ))}
          </div>
          {selectedPayment === 'Split' && (
            <div className="rounded-lg border border-slate-700/70 bg-[#0e1520] p-3 text-sm">
              <label className="mb-1 block text-slate-300">{tx(lang, 'Nağd hissə', 'Наличная часть', 'Cash part')}</label>
              <input type="number" min={0} step="0.01" max={checkoutBaseTotal.toNumber()} value={splitCashInput} onChange={(e) => setSplitCashInput(e.target.value)} className="neon-input" />
            </div>
          )}
          {selectedPayment === 'Staff' && (
            <div className="rounded-lg border border-slate-700/70 bg-[#0e1520] p-3 text-xs text-slate-300 space-y-1">
              <div className="flex justify-between"><span>{tx(lang, 'Günlük limit', 'Дневной лимит', 'Daily limit')}</span><span>{staffPreview.daily_limit.toFixed(2)} ₼</span></div>
              <div className="flex justify-between"><span>{tx(lang, 'Bu gün istifadə', 'Использовано сегодня', 'Used today')}</span><span>{staffPreview.used_today.toFixed(2)} ₼</span></div>
              <div className="flex justify-between font-semibold text-yellow-300"><span>{tx(lang, 'Ödəniləcək', 'К оплате', 'To pay')}</span><span>{staffPreview.final_due.toFixed(2)} ₼</span></div>
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
          <button
            disabled={isLoading || shouldLockTableCheckoutInPos || (cart.length === 0 && !shouldLockTableCheckoutInPos) || (ctx.orderType === 'Dine In' && !ctx.selectedTable)}
            onClick={() => handleCheckout(selectedPayment)}
            className={`flex ${size === 'compact' ? 'h-12 text-sm' : size === 'expanded' ? 'h-16 text-lg' : 'h-14 text-base'} items-center justify-center gap-2 rounded-lg border px-4 font-bold text-white shadow-[0_0_22px_rgba(239,68,68,0.35)] disabled:opacity-50`}
            style={{ backgroundColor: posLayout.accent_color, borderColor: posLayout.accent_color, color: '#111827' }}
            title={tx(lang, 'Ödənişi seçilmiş üsulla tamamlayır və satışı bağlayır.', 'Завершает оплату выбранным методом и закрывает продажу.', 'Completes payment with selected method and closes sale.')}
            data-guide={tx(lang, 'Ödənişi seçilmiş üsulla tamamlayır və satışı bağlayır.', 'Завершает оплату выбранным методом и закрывает продажу.', 'Completes payment with selected method and closes sale.')}
          >
            <Check size={18} /> {tx(lang, 'Ödənişi Tamamla', 'Завершить оплату', 'Complete Payment')}
          </button>
        </React.Fragment>
      );
    }
    return null;
  };

  const renderLeftWidget = (widget: string) => {
    if (!isLeftWidgetVisible(widget)) return null;
    if (widget === 'menuHeader') {
      const size = getLeftWidgetSize(widget);
      return (
        <div key={widget} className={`mb-3 flex items-center gap-2 ${size === 'compact' ? 'text-xs' : size === 'expanded' ? 'text-base' : 'text-sm'} text-slate-300`}>
          <span style={{ color: posLayout.accent_color }}>•</span> {tx(lang, 'POS Menyu', 'POS меню', 'POS Menu')}
        </div>
      );
    }
    if (widget === 'search') {
      const size = getLeftWidgetSize(widget);
      return (
        <div key={widget} className="relative mb-3">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            id="pos-menu-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`neon-input pl-10 ${size === 'compact' ? 'h-10' : size === 'expanded' ? 'h-14' : 'h-12'}`}
            placeholder={t.search}
          />
        </div>
      );
    }
    if (widget === 'categories') {
      const size = getLeftWidgetSize(widget);
      return (
        <div key={widget} className="mb-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className={`flex flex-wrap overflow-x-auto pb-1 ${size === 'compact' ? 'gap-1' : size === 'expanded' ? 'gap-3' : 'gap-2'}`}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  disabled={isPosMenuEditMode}
                  className={`neon-chip pos-category-btn ${category === cat ? 'neon-chip-active' : ''} ${isPosMenuEditMode ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                  {cat === 'ALL' ? t.all_categories : cat}
                </button>
              ))}
            </div>
            {canEditPosMenuOrder && (
              <button
                type="button"
                disabled={isReorderingPosMenu}
                onClick={() => setIsPosMenuEditMode((prev) => !prev)}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${isPosMenuEditMode ? 'border-amber-300/70 bg-amber-300/15 text-amber-100' : 'border-slate-600 bg-slate-900/60 text-slate-200'} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {isReorderingPosMenu
                  ? tx(lang, 'Yazılır...', 'Сохраняется...', 'Saving...')
                  : isPosMenuEditMode
                    ? tx(lang, 'Bağla', 'Закрыть', 'Close')
                    : tx(lang, 'Düzənlə', 'Редактировать', 'Edit')}
              </button>
            )}
          </div>
          {isPosMenuEditMode && (
            <div className="text-[11px] text-amber-200/90">
              {tx(lang, 'Kartı tutub başqa yerə sürüşdürün.', 'Перетащите карточку на новое место.', 'Drag a card to a new position.')}
            </div>
          )}
        </div>
      );
    }
    if (widget === 'productGrid') {
      const size = getLeftWidgetSize(widget);
      if (isNewUiMode) {
        return (
          <div key={widget} className="pos2-product-grid grid flex-1 auto-rows-max grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-3 2xl:grid-cols-4">
            {groupedMenu.map((group) => {
              const preview = group.items[0];
              const qtyInCart = getGroupQty(group);
              return (
                <div
                  key={group.group_key}
                  draggable={isPosMenuEditMode && canEditPosMenuOrder && !isReorderingPosMenu}
                  onDragStart={() => {
                    if (!isPosMenuEditMode) return;
                    setDraggingMenuGroupKey(group.group_key);
                    setDropMenuGroupKey(group.group_key);
                  }}
                  onDragOver={(e) => {
                    if (!isPosMenuEditMode || !draggingMenuGroupKey || draggingMenuGroupKey === group.group_key) return;
                    e.preventDefault();
                    setDropMenuGroupKey(group.group_key);
                  }}
                  onDrop={(e) => {
                    if (!isPosMenuEditMode) return;
                    e.preventDefault();
                    void handlePosMenuDrop(group.group_key);
                  }}
                  onDragEnd={() => {
                    setDraggingMenuGroupKey(null);
                    setDropMenuGroupKey(null);
                  }}
                  className={`pos2-product-card pos-product-card ${dropMenuGroupKey === group.group_key && draggingMenuGroupKey !== group.group_key ? 'ring-2 ring-cyan-300/70' : ''} ${draggingMenuGroupKey === group.group_key ? 'opacity-60' : ''}`}
                >
                  <button onClick={() => { if (!isPosMenuEditMode) openProductPicker(group); }} className="w-full text-left">
                    {posLayout.widget_options?.productGrid?.show_images !== false && (
                      <div className="pos2-product-media">
                        {group.image_url ? (
                          <img src={group.image_url} alt={group.base} className="h-full w-full object-cover" />
                        ) : (
                          <div className="pos2-product-fallback">
                            <ImageOff size={16} />
                            <span>{group.base.slice(0, 1).toUpperCase()}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-3">
                      <div className="line-clamp-1 text-sm font-semibold text-slate-100">{group.base}</div>
                      <div className="line-clamp-1 text-xs text-slate-400">{group.description || group.category || tx(lang, 'Menyu məhsulu', 'Позиция меню', 'Menu item')}</div>
                      <div className="mt-1 text-sm font-bold text-amber-300">
                        {group.minPrice.toFixed(2)} ₼ {group.hasVariants ? `• ${tx(lang, 'variant', 'вариант', 'variant')}` : ''}
                      </div>
                    </div>
                  </button>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    {group.hasVariants ? (
                      <>
                        <span className="rounded-lg border border-slate-600/80 bg-slate-900/50 px-2 py-1 text-xs text-slate-300">{qtyInCart} {tx(lang, 'ədəd', 'шт', 'pcs')}</span>
                        <button onClick={() => openProductPicker(group)} className="rounded-xl border border-amber-300/50 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100">
                          {tx(lang, 'Seç + Əlavə et', 'Выбрать + Добавить', 'Pick + Add')}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => addToCart(preview)}
                        className="w-full rounded-xl border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100"
                      >
                        {tx(lang, 'Səbətə əlavə et', 'Добавить в корзину', 'Add to cart')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }
      return (
        <div key={widget} className={`grid flex-1 auto-rows-max grid-cols-1 gap-2 overflow-y-auto pr-1 ${productGridClass}`}>
          {groupedMenu.map((group) => {
            return (
              <button
                key={group.group_key}
                draggable={isPosMenuEditMode && canEditPosMenuOrder && !isReorderingPosMenu}
                onDragStart={() => {
                  if (!isPosMenuEditMode) return;
                  setDraggingMenuGroupKey(group.group_key);
                  setDropMenuGroupKey(group.group_key);
                }}
                onDragOver={(e) => {
                  if (!isPosMenuEditMode || !draggingMenuGroupKey || draggingMenuGroupKey === group.group_key) return;
                  e.preventDefault();
                  setDropMenuGroupKey(group.group_key);
                }}
                onDrop={(e) => {
                  if (!isPosMenuEditMode) return;
                  e.preventDefault();
                  void handlePosMenuDrop(group.group_key);
                }}
                onDragEnd={() => {
                  setDraggingMenuGroupKey(null);
                  setDropMenuGroupKey(null);
                }}
                onClick={() => {
                  if (!isPosMenuEditMode) openProductPicker(group);
                }}
                className={`neon-item ${size === 'compact' ? 'text-xs' : size === 'expanded' ? 'text-base' : 'text-sm'} ${productItemClass} text-left ${dropMenuGroupKey === group.group_key && draggingMenuGroupKey !== group.group_key ? 'ring-2 ring-cyan-300/70' : ''} ${draggingMenuGroupKey === group.group_key ? 'opacity-60' : ''}`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span>{group.base}</span>
                  <span className="text-slate-300">
                    {group.minPrice.toFixed(2)} ₼ {group.hasVariants ? '▾' : ''}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      );
    }
    return null;
  };

  const getGroupQty = useCallback((group: MenuGroup) => groupQtyByKey.get(group.group_key) || 0, [groupQtyByKey]);

  const increaseGroupQty = useCallback((group: MenuGroup) => {
    // For multi-variant groups: if user already has one variant in cart, add same one.
    // Otherwise add the first (cheapest). Variant picker opens via the card click in classic mode.
    const preferred = group.items.find((row) => {
      return (cartQtyByItemId.get(row.id) || 0) > 0;
    });
    addToCart(preferred || group.items[0]);
  }, [addToCart, cartQtyByItemId]);

  const decreaseGroupQty = useCallback((group: MenuGroup) => {
    const target = [...cart]
      .reverse()
      .find((c) => group.items.some((row) => row.id === c.id));
    if (!target) return;
    updateCartItem(target.line_id, target.qty - 1);
  }, [cart]);

  // ── IMPORTANT: useMemo hooks must come BEFORE any early returns ──────────────
  // This must stay here to avoid React error #300 (fewer hooks than expected)
  const panelRatioClass = useMemo(() => {
    const r = posLayout.panel_ratio || '50:50';
    if (r === '50:50') return 'lg:grid-cols-[minmax(0,1fr)_minmax(380px,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]';
    if (r === '55:45') return 'lg:grid-cols-[minmax(0,1.2fr)_minmax(380px,1fr)] xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,1fr)]';
    if (r === '60:40') return 'lg:grid-cols-[minmax(0,1.5fr)_minmax(380px,1fr)] xl:grid-cols-[minmax(0,1.5fr)_minmax(420px,1fr)]';
    if (r === '65:35') return 'lg:grid-cols-[minmax(0,1.85fr)_minmax(380px,1fr)] xl:grid-cols-[minmax(0,1.85fr)_minmax(420px,1fr)]';
    if (r === '70:30') return 'lg:grid-cols-[minmax(0,2.33fr)_minmax(380px,1fr)] xl:grid-cols-[minmax(0,2.33fr)_minmax(420px,1fr)]';
    return 'lg:grid-cols-[minmax(0,1.5fr)_minmax(380px,1fr)] xl:grid-cols-[minmax(0,1.5fr)_minmax(420px,1fr)]';
  }, [posLayout.panel_ratio]);
  const isDashboardAmberTheme = useMemo(() => {
    const accent = String(posLayout.accent_color || '').toLowerCase();
    const isWarmAccent =
      accent === '#f97316' ||
      accent === '#f59e0b' ||
      accent === '#fb923c' ||
      accent === '#ea580c';
    return isNewUiMode && isWarmAccent;
  }, [isNewUiMode, posLayout.accent_color]);
  // ─────────────────────────────────────────────────────────────────────────────

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
          <iframe
            ref={receiptIframeRef}
            title="receipt"
            srcDoc={safeReceiptHtml}
            sandbox="allow-same-origin allow-modals allow-popups"
            className="h-[70vh] w-full rounded-lg bg-white"
          />
        </div>
      </div>
    );
  }

  const isStaffRole = currentRole === 'staff' || currentRole === 'cashier';

  if (isNewUiMode && isStaffRole) {
    return (
      <StaffPosMode
        lang={safeLang}
        tx={tx}
        t={t as any}
        businessName={String(businessProfile?.company_name || 'IRONWAVES POS')}
        activeCart={activeCart}
        search={search}
        setSearch={setSearch}
        categories={categories}
        category={category}
        setCategory={setCategory}
        groupedMenu={groupedMenu}
        cart={cart}
        checkoutBaseTotal={checkoutBaseTotal}
        getGroupQty={getGroupQty}
        increaseGroupQty={increaseGroupQty}
        decreaseGroupQty={decreaseGroupQty}
        openProductPicker={openProductPicker}
        toDecimalSafe={toDecimalSafe}
        updateCartItem={updateCartItem}
        selectedPayment={selectedPayment}
        setSelectedPayment={setSelectedPayment}
        splitCashInput={splitCashInput}
        setSplitCashInput={setSplitCashInput}
        isLoading={isLoading}
        ctx={ctx}
        patchCtx={patchCtx}
        handleFindCustomer={handleFindCustomer}
        handleRewardCodeEnter={handleRewardCodeEnter}
        feedbackCouponPreview={feedbackCouponPreview}
        hasClaimCode={hasClaimCode}
        rawTotal={rawTotal}
        discountAmount={discountAmount}
        tables={tables}
        handleSendToKitchen={handleSendToKitchen}
        handleCheckout={handleCheckout}
        shouldLockTableCheckoutInPos={shouldLockTableCheckoutInPos}
        requestClearCart={requestClearCart}
        handleSyncOfflineQueue={handleSyncOfflineQueue}
        isSyncingOffline={isSyncingOffline}
      />
    );
  }

  if (isNewUiMode) {
    return (
      <div className="pos3-shell">
        {posLayout.show_cart_tabs && (
          <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <button onClick={() => setActiveCart('S1')} className={`pos3-cart-tab ${activeCart === 'S1' ? 'pos3-cart-tab-active' : ''}`}>
              <ShoppingCart size={14} /> {resolveCartTabLabel('S1')}
            </button>
            <button onClick={() => setActiveCart('S2')} className={`pos3-cart-tab ${activeCart === 'S2' ? 'pos3-cart-tab-active' : ''}`}>
              <ShoppingCart size={14} /> {resolveCartTabLabel('S2')}
            </button>
            <button onClick={() => setActiveCart('S3')} className={`pos3-cart-tab ${activeCart === 'S3' ? 'pos3-cart-tab-active' : ''}`}>
              <ShoppingCart size={14} /> {resolveCartTabLabel('S3')}
            </button>
          </div>
        )}

        <div className="pos3-workspace">
          <section className="pos3-menu">
            <div className="mb-3">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  id="pos-menu-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="neon-input pl-10"
                  placeholder={t.search}
                />
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              <div className="flex flex-1 flex-wrap gap-1.5">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    disabled={isPosMenuEditMode}
                    className={`pos3-chip pos-category-btn ${category === cat ? 'pos3-chip-active' : ''} ${isPosMenuEditMode ? 'cursor-not-allowed opacity-70' : ''}`}
                  >
                    {cat === 'ALL' ? t.all_categories : cat}
                  </button>
                ))}
              </div>
              {canEditPosMenuOrder && (
                <button
                  type="button"
                  disabled={isReorderingPosMenu}
                  onClick={() => setIsPosMenuEditMode((prev) => !prev)}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${isPosMenuEditMode ? 'border-amber-300/70 bg-amber-300/15 text-amber-100' : 'border-slate-600 bg-slate-900/60 text-slate-200'} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {isReorderingPosMenu
                    ? tx(lang, 'Yazılır...', 'Сохраняется...', 'Saving...')
                    : isPosMenuEditMode
                      ? tx(lang, 'Bağla', 'Закрыть', 'Close')
                      : tx(lang, 'Düzənlə', 'Редактировать', 'Edit')}
                </button>
              )}
            </div>
            {isPosMenuEditMode && (
              <div className="mb-3 text-[11px] text-amber-200/90">
                {tx(lang, 'Kartı tutub başqa yerə sürüşdürün.', 'Перетащите карточку на новое место.', 'Drag a card to a new position.')}
              </div>
            )}
            <div className="pos3-product-grid">
              {groupedMenu.map((group) => {
                const qtyInCart = getGroupQty(group);
                return (
                  <div
                    key={group.group_key}
                    draggable={isPosMenuEditMode && canEditPosMenuOrder && !isReorderingPosMenu}
                    onDragStart={() => {
                      if (!isPosMenuEditMode) return;
                      setDraggingMenuGroupKey(group.group_key);
                      setDropMenuGroupKey(group.group_key);
                    }}
                    onDragOver={(e) => {
                      if (!isPosMenuEditMode || !draggingMenuGroupKey || draggingMenuGroupKey === group.group_key) return;
                      e.preventDefault();
                      setDropMenuGroupKey(group.group_key);
                    }}
                    onDrop={(e) => {
                      if (!isPosMenuEditMode) return;
                      e.preventDefault();
                      void handlePosMenuDrop(group.group_key);
                    }}
                    onDragEnd={() => {
                      setDraggingMenuGroupKey(null);
                      setDropMenuGroupKey(null);
                    }}
                    className={`pos3-card pos-product-card ${qtyInCart > 0 ? 'pos3-card-active' : ''} ${dropMenuGroupKey === group.group_key && draggingMenuGroupKey !== group.group_key ? 'ring-2 ring-cyan-300/70' : ''} ${draggingMenuGroupKey === group.group_key ? 'opacity-60' : ''}`}
                  >
                    <button className="w-full text-left" onClick={() => { if (!isPosMenuEditMode) openProductPicker(group); }}>
                      {posLayout.widget_options?.productGrid?.show_images !== false && (
                        <div className="pos3-card-image">
                          {group.image_url ? (
                            <img src={group.image_url} alt={group.base} className="h-full w-full object-cover" />
                          ) : (
                            <div className="pos3-card-fallback">
                              <span className="pos3-card-fallback-mark">{group.initials || 'M'}</span>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-2">
                        <div className="line-clamp-1 text-[13px] font-semibold leading-5 text-slate-100">{group.base}</div>
                        <div className="line-clamp-1 text-[11px] leading-4 text-slate-400">{group.description || group.category || tx(lang, 'Menyu məhsulu', 'Позиция меню', 'Menu item')}</div>
                        <div className="mt-1 text-[15px] font-bold leading-5 text-amber-300">{group.minPrice.toFixed(2)} ₼</div>
                      </div>
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <button
                        className="pos3-qty-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPosMenuEditMode) return;
                          decreaseGroupQty(group);
                        }}
                        disabled={qtyInCart <= 0}
                      >
                        <Minus size={14} />
                      </button>
                      <div className="pos3-qty-value">{qtyInCart}</div>
                      <button
                        className="pos3-qty-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPosMenuEditMode) return;
                          increaseGroupQty(group);
                        }}
                      >
                        <Plus size={14} />
                      </button>
                      {group.hasVariants && (
                        <button
                          className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-2 py-1 text-[10px] font-semibold text-amber-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isPosMenuEditMode) return;
                            openProductPicker(group);
                          }}
                        >
                          {tx(lang, 'Variant', 'Вариант', 'Variant')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="pos3-checkout">
            <div className="pos3-checkout-head">
              <h3 className="flex items-center gap-2 text-lg font-bold text-slate-100">
                <ShoppingCart size={18} /> {t.cart.toUpperCase()} {activeCart.slice(1)}
              </h3>
              <div className="text-sm font-bold text-slate-100">{checkoutBaseTotal.toFixed(2)} ₼</div>
            </div>

            <div className="pos3-control-stack">
              <div className="relative">
                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  placeholder={tx(lang, 'Kart / reward / feedback kodunu skan et...', 'Сканируйте карту / reward / feedback код...', 'Scan member / reward / feedback code...')}
                  className="neon-input pl-9"
                  value={ctx.customerQR}
                  onChange={(e) => patchCtx({ customerQR: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && handleFindCustomer()}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleFindCustomer} className="pay-btn h-10">{tx(lang, 'Kodu Oxu', 'Считать код', 'Read Code')}</button>
                <button onClick={() => patchCtx({ customer: null, customerQR: '', rewardClaimCode: '' })} className="pay-btn h-10">{tx(lang, 'Təmizlə', 'Очистить', 'Clear')}</button>
              </div>
              {feedbackCouponPreview ? (
                <div className={`rounded-md border px-2 py-1 text-xs ${feedbackCouponPreview.status === 'PENDING' ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200' : 'border-slate-600/60 bg-slate-700/30 text-slate-300'}`}>
                  {feedbackCouponPreview.status === 'PENDING'
                    ? tx(lang, `Feedback kuponu aktivdir: -${feedbackCouponPreview.percent}%`, `Купон feedback активен: -${feedbackCouponPreview.percent}%`, `Feedback coupon active: -${feedbackCouponPreview.percent}%`)
                    : tx(lang, 'Bu feedback kuponu artıq istifadə olunub', 'Этот feedback купон уже использован', 'This feedback coupon is already used')}
                </div>
              ) : null}
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-slate-400">{tx(lang, 'Endirim %', 'Скидка %', 'Discount %')}</span>
                {ctx.discount && parseFloat(ctx.discount) > 0 && (
                  <span className="text-[11px] text-amber-300 font-bold bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">
                    {ctx.discount}%
                  </span>
                )}
              </div>
              {!hasClaimCode && (
                <div className="grid grid-cols-5 gap-1 mt-1.5">
                  {['0', '5', '10', '15', '20'].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => patchCtx({ discount: val })}
                      className={`rounded-lg border py-1.5 text-xs font-semibold transition ${
                        (ctx.discount || '0') === val ? 'border-amber-200/80 bg-amber-300 text-slate-900 font-bold' : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-700/55'
                      }`}
                    >
                      {val}%
                    </button>
                  ))}
                </div>
              )}
              {parseFloat(ctx.discount || '0') > 0 && (
                <div className="mt-2">
                  <input
                    type="text"
                    value={ctx.discountReason}
                    onChange={(e) => patchCtx({ discountReason: e.target.value })}
                    placeholder={tx(lang, 'Endirim səbəbi (məs. Müştəri məmnuniyyəti)', 'Причина скидки', 'Discount reason')}
                    className="neon-input h-10"
                    required
                  />
                </div>
              )}
            </div>

            {ctx.selectedTable && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => patchCtx({ cupMode: 'paper' })} className={`rounded-lg border px-2 py-2 text-xs font-semibold ${ctx.cupMode === 'paper' ? 'border-amber-200/80 bg-amber-300 text-slate-900' : 'border-slate-600 bg-slate-800/50 text-slate-200'}`}>
                  {tx(lang, 'Kağız stəkan', 'Бумажный стакан', 'Paper cup')}
                </button>
                <button onClick={() => patchCtx({ cupMode: 'glass' })} className={`rounded-lg border px-2 py-2 text-xs font-semibold ${ctx.cupMode === 'glass' ? 'border-amber-200/80 bg-amber-300 text-slate-900' : 'border-slate-600 bg-slate-800/50 text-slate-200'}`}>
                  {tx(lang, 'Şüşə stəkan', 'Стеклянный стакан', 'Glass cup')}
                </button>
              </div>
            )}

            <div className="pos3-order-list">
              {cart.length === 0 && <div className="pt-8 text-center text-sm text-slate-500">{t.cart_empty}</div>}
              {cart.map((item, idx) => {
                const promoD = totals.item_promo_discounts ? totals.item_promo_discounts[idx] : undefined;
                return (
                  <div key={item.line_id} className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-2.5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="line-clamp-1 text-sm font-semibold text-slate-100">{item.item_name}</span>
                      <span className="text-sm font-semibold text-amber-300">{toDecimalSafe(item.price).times(item.qty).toFixed(2)} ₼</span>
                    </div>
                    {promoD && promoD.gt(0) && (
                      <div className="mb-2 text-[11px] text-yellow-400/90 italic pl-1">
                        [Promo] 2nd Item 50% Off: -{promoD.toFixed(2)} ₼
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-2">
                      <button className="neon-mini-btn" onClick={() => updateCartItem(item.line_id, item.qty - 1)}><Minus size={13} /></button>
                      <span className="w-5 text-center text-sm text-slate-200">{item.qty}</span>
                      <button className="neon-mini-btn" onClick={() => updateCartItem(item.line_id, item.qty + 1)}><Plus size={13} /></button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 rounded-xl border border-slate-700/70 bg-slate-950/50 p-3 text-sm">
              <div className="mb-1 flex justify-between text-slate-300"><span>{tx(lang, 'Ara cəm', 'Промежуточный итог', 'Subtotal')}</span><span>{rawTotal.toFixed(2)} ₼</span></div>
              <div className="mb-1 flex justify-between text-slate-300"><span>{tx(lang, 'Endirim', 'Скидка', 'Discount')}</span><span>- {discountAmount.toFixed(2)} ₼</span></div>
              <div className="flex justify-between border-t border-slate-700/60 pt-2 text-xl font-bold text-slate-100"><span>{tx(lang, 'Yekun', 'Итого', 'Total')}</span><span>{checkoutBaseTotal.toFixed(2)} ₼</span></div>
            </div>

            <div className="pos3-action-group">
              <div className="pos3-action-label">{tx(lang, 'Ödəniş üsulu', 'Способ оплаты', 'Payment method')}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
              {(['Nəğd', 'Kart', 'Split', 'Staff'] as PaymentMethod[]).map((method) => (
                <button key={method} disabled={isLoading} onClick={() => setSelectedPayment(method)} className={`pay-btn h-10 ${selectedPayment === method ? 'pay-btn-active' : ''}`}>
                  {method === 'Nəğd' ? tx(lang, 'Nəğd', 'Наличные', 'Cash') : method === 'Kart' ? tx(lang, 'Kart', 'Карта', 'Card') : method === 'Split' ? tx(lang, 'Bölünmüş', 'Разделено', 'Split') : tx(lang, 'Staff', 'Персонал', 'Staff')}
                </button>
              ))}
              </div>
            </div>
            {selectedPayment === 'Split' && (
              <div className="mt-2 rounded-lg border border-slate-700/70 bg-[#0e1520] p-3 text-sm">
                <label className="mb-1 block text-slate-300">{tx(lang, 'Nağd hissə', 'Наличная часть', 'Cash part')}</label>
                <input type="number" min={0} step="0.01" max={checkoutBaseTotal.toNumber()} value={splitCashInput} onChange={(e) => setSplitCashInput(e.target.value)} className="neon-input" />
              </div>
            )}

            {ctx.orderType === 'Dine In' && ctx.selectedTable ? (
              <button disabled={isLoading || !ctx.selectedTable || cart.length === 0} onClick={() => { void handleSendToKitchen(); }} className="pos3-primary-btn">
                <Check size={18} /> {tx(lang, 'Masaya Göndər', 'Отправить на стол', 'Send To Table')}
              </button>
            ) : (
              <button
                disabled={isLoading || shouldLockTableCheckoutInPos || (cart.length === 0 && !shouldLockTableCheckoutInPos) || (ctx.orderType === 'Dine In' && !ctx.selectedTable)}
                onClick={() => handleCheckout(selectedPayment)}
                className="pos3-primary-btn"
              >
                <Check size={18} /> {tx(lang, 'Ödənişi Tamamla', 'Завершить оплату', 'Complete Payment')}
              </button>
            )}
          </aside>
        </div>

        {variantPicker && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
            <div className="metal-panel w-full max-w-md p-5">
              <h3 className="text-lg font-bold text-slate-100">{variantPicker.base}</h3>
              <p className="mt-1 text-sm text-slate-300">
                {variantPicker.requiresServiceChoice
                  ? tx(lang, 'Əvvəl ölçünü, sonra servis növünü seçin', 'Сначала выберите размер, затем подачу', 'Choose size, then service')
                  : tx(lang, 'Ölçü seçin', 'Выберите размер', 'Choose a size')}
              </p>
              <div className="mt-4 space-y-2">
                {variantPicker.items.map((item) => {
                  const { variant } = splitVariantName(item.item_name);
                  return (
                    <button
                      key={item.id}
                      className={`neon-btn flex h-12 w-full items-center justify-between rounded-lg px-3 ${variantPicker.requiresServiceChoice && variantPicker.selectedItemId === item.id ? 'border-cyan-300 bg-cyan-500/15 text-cyan-50' : ''}`}
                      onClick={() => {
                        if (!variantPicker.requiresServiceChoice) {
                          addToCart(item);
                          setVariantPicker(null);
                          return;
                        }
                        setVariantPicker((prev) => (prev ? { ...prev, selectedItemId: item.id } : prev));
                      }}
                    >
                      <span>{variant || item.item_name}</span>
                      <span>{toDecimalSafe(item.price).toFixed(2)} ₼</span>
                    </button>
                  );
                })}
              </div>
              {variantPicker.requiresServiceChoice && (
                <div className="mt-4 space-y-3">
                  <div className="text-sm font-semibold text-slate-200">{tx(lang, 'Servis növü', 'Тип подачи', 'Service type')}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`neon-btn h-14 rounded-xl px-3 text-sm ${variantPicker.selectedCupMode === 'paper' ? 'border-amber-300 bg-amber-500/15 text-amber-50' : ''}`}
                      onClick={() => setVariantPicker((prev) => (prev ? { ...prev, selectedCupMode: 'paper' } : prev))}
                    >
                      {tx(lang, 'Kağız stəkan', 'Бумажный стакан', 'Paper cup')}
                    </button>
                    <button
                      className={`neon-btn h-14 rounded-xl px-3 text-sm ${variantPicker.selectedCupMode === 'glass' ? 'border-cyan-300 bg-cyan-500/15 text-cyan-50' : ''}`}
                      onClick={() => setVariantPicker((prev) => (prev ? { ...prev, selectedCupMode: 'glass' } : prev))}
                    >
                      {tx(lang, 'Şüşə stəkan', 'Стакан', 'Glass')}
                    </button>
                  </div>
                  <button
                    className="glossy-gold h-12 w-full rounded-xl px-4 text-sm font-bold disabled:opacity-50"
                    disabled={!variantPicker.selectedItemId || !variantPicker.selectedCupMode}
                    onClick={() => {
                      const selectedItem = variantPicker.items.find((item) => item.id === variantPicker.selectedItemId);
                      if (!selectedItem || !variantPicker.selectedCupMode) return;
                      addToCart(selectedItem, { cup_mode: variantPicker.selectedCupMode });
                      setVariantPicker(null);
                    }}
                  >
                    {tx(lang, 'Əlavə et', 'Добавить', 'Add')}
                  </button>
                </div>
              )}
              <button className="mt-4 w-full rounded-lg border border-slate-600 px-4 py-2 text-sm" onClick={() => setVariantPicker(null)}>
                {tx(lang, 'Bağla', 'Закрыть', 'Close')}
              </button>
            </div>
          </div>
        )}

        {showOpenShiftModal && (
          <div className="fixed inset-0 z-[121] flex items-center justify-center bg-black/70 p-4">
            <div className="metal-panel w-full max-w-md rounded-2xl p-5">
              <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Əvvəlcə günü açın', 'Сначала откройте смену', 'Open shift first')}</h3>
              <p className="mt-2 text-sm text-slate-300">
                {tx(lang, 'Satış üçün əvvəl günü Z-Hesabat bölməsində açın.', 'Перед продажей откройте смену в разделе Z-Отчет.', 'Open the shift in Z-Report before making sales.')}
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button className="neon-btn rounded-xl px-4 py-2" onClick={() => setShowOpenShiftModal(false)}>{tx(lang, 'Bağla', 'Закрыть', 'Close')}</button>
                <button
                  className="glossy-gold rounded-xl px-4 py-2 font-semibold"
                  onClick={() => {
                    setShowOpenShiftModal(false);
                    window.dispatchEvent(new CustomEvent('navigate-module', { detail: { module: 'zreport' } }));
                  }}
                >
                  {tx(lang, 'Z-Hesabata keçin', 'Перейти в Z-Отчет', 'Go to Z-Report')}
                </button>
              </div>
            </div>
          </div>
        )}

        <ConfirmModal
          open={Boolean(pendingClearCartKey)}
          title={tx(lang, 'Səbəti təmizlə?', 'Очистить корзину?', 'Clear cart?')}
          message={tx(lang, 'Bu səbətdəki bütün məhsullar silinəcək. Davam etmək istəyirsiniz?', 'Все позиции в этой корзине будут удалены. Продолжить?', 'All items in this cart will be removed. Continue?')}
          lang={safeLang}
          confirmLabel={tx(lang, 'Səbəti sil', 'Очистить', 'Clear cart')}
          cancelLabel={tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
          onCancel={() => setPendingClearCartKey(null)}
          onConfirm={() => {
            if (pendingClearCartKey) clearCart(pendingClearCartKey);
            setPendingClearCartKey(null);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`compact-pos-shell ${isNewUiMode ? 'pos2-shell' : ''} ${isDashboardAmberTheme ? 'pos-dashboard-amber' : ''} flex h-full min-h-0 flex-col px-3 pb-24 pt-3 text-slate-200 md:px-4 md:pb-3 xl:px-6 ${shellClass} ${densityClass}`}
      style={{ ['--pos-accent' as any]: posLayout.accent_color }}
    >

      {posLayout.show_cart_tabs && (
        <div className="compact-pos-tabs mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <button onClick={() => setActiveCart('S1')} className={`neon-tab ${activeCart === 'S1' ? 'neon-tab-active' : ''}`}>
            <ShoppingCart size={14} /> {resolveCartTabLabel('S1')}
          </button>
          <button onClick={() => setActiveCart('S2')} className={`neon-tab ${activeCart === 'S2' ? 'neon-tab-active' : ''}`}>
            <ShoppingCart size={14} /> {resolveCartTabLabel('S2')}
          </button>
          <button onClick={() => setActiveCart('S3')} className={`neon-tab ${activeCart === 'S3' ? 'neon-tab-active' : ''}`}>
            <ShoppingCart size={14} /> {resolveCartTabLabel('S3')}
          </button>
        </div>
      )}

      {/* ── Offline status indicator ─────────────────────────────────────── */}
      {!isPosOnline && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-amber-100 animate-pulse">
          <WifiOff size={16} className="shrink-0 text-amber-300" />
          <span className="text-sm font-medium">
            {tx(safeLang, 'Oflayn rejim — satışlar yerli yaddaşda saxlanır', 'Офлайн-режим — продажи сохраняются локально', 'Offline mode — sales are stored locally')}
          </span>
        </div>
      )}

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
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-amber-200/85">
                    <span>
                      {tx(safeLang, 'Cəhd', 'Попыток', 'Retries')}: {row.retry_count}
                    </span>
                    {row.next_attempt_at && (
                      <span>
                        {tx(safeLang, 'Növbəti cəhd', 'Следующая попытка', 'Next attempt')}: {new Date(row.next_attempt_at).toLocaleTimeString()}
                      </span>
                    )}
                    {row.last_attempt_at && (
                      <span>
                        {tx(safeLang, 'Son cəhd', 'Последняя попытка', 'Last attempt')}: {new Date(row.last_attempt_at).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  {row.last_error && (
                    <div className="mt-2 rounded-md border border-rose-300/30 bg-rose-500/10 px-2 py-2 text-[11px] text-rose-100">
                      <div className="font-semibold">
                        {tx(safeLang, 'Göndərilmə səbəbi', 'Причина ошибки', 'Sync error')}
                      </div>
                      <div className="mt-1 break-words">{formatOfflineError(row.last_error)}</div>
                    </div>
                  )}
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => { void handleRetrySingleOffline(row.id); }}
                      className="rounded-md border border-amber-300/35 px-2 py-1 text-[11px] font-semibold text-amber-50 hover:bg-amber-400/10"
                    >
                      {tx(safeLang, 'Bu satışı yenidən yoxla', 'Повторить эту продажу', 'Retry this sale')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {ctx.orderType === 'Dine In' && ctx.selectedTable && (
        <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-cyan-300/35 bg-cyan-500/10 px-4 py-3 text-cyan-100 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">{tx(lang, 'Masa rejimi', 'Режим стола', 'Table mode')}</div>
            <div className="mt-1 text-sm font-semibold">
              {tableRoutingBanner && ctx.selectedTable === tableRoutingBanner.tableId
                ? `${tableRoutingBanner.tableLabel} ${tx(lang, 'üçün sifariş yazırsınız', 'для этого стола', 'order is for this table')}`
                : `${tx(lang, 'Bu seçim masa üçündür', 'Этот выбор для стола', 'This selection is for table')} · ${selectedTableData?.label || ctx.selectedTable}`}
            </div>
          </div>
          <button
            disabled={isLoading || cart.length === 0}
            onClick={() => { void handleSendToKitchen(); }}
            className="glossy-gold inline-flex min-h-14 items-center justify-center rounded-2xl px-5 py-3 text-sm font-bold disabled:opacity-50"
          >
            {tx(lang, 'Masaya Göndər', 'Отправить на стол', 'Send To Table')}
          </button>
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

      <div className={`compact-pos-grid grid min-h-0 flex-1 grid-cols-1 gap-4 ${panelRatioClass} ${isNewUiMode ? 'pos2-workspace' : ''}`}>
        <section className={`flex h-full min-h-0 flex-col ${isNewUiMode ? 'pos2-menu-pane rounded-3xl border border-slate-700/70 bg-slate-950/30 p-4' : ''} ${mobilePane !== 'menu' ? 'hidden xl:flex' : ''}`}>
          {(posLayout.left_widget_order || ['menuHeader', 'search', 'categories', 'productGrid']).map((widget: string) => renderLeftWidget(widget))}
        </section>

        <aside className={`compact-pos-sidebar ${isNewUiMode ? 'pos2-checkout-pane rounded-3xl' : ''} flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700/70 bg-[#101722]/80 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)] md:p-4 ${mobilePane !== 'cart' ? 'hidden xl:flex' : ''}`}>
          <div className="compact-pos-header mb-3 flex items-center justify-between border-b border-slate-700/60 pb-3">
            <h3 className="compact-pos-title flex items-center gap-2 text-2xl font-bold"><ShoppingCart size={22} /> {t.cart.toUpperCase()} {activeCart.slice(1)}</h3>
            <button
              onClick={() => requestClearCart(activeCart)}
              disabled={cart.length === 0 || isLoading}
              aria-label={tx(lang, 'Səbəti təmizlə', 'Очистить корзину', 'Clear cart')}
              className="rounded-lg border border-slate-600 p-2 disabled:opacity-40"
            >
              <ClipboardList size={16} />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pr-1">
              {floatingSidebarWidgets.map((widget: string) => renderSidebarWidget(widget))}
              {ctx.customer && (
                <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
                  <div className="flex justify-between">
                    <span>{tx(lang, 'Ulduz balansı (satışdan sonra)', 'Баланс звезд (после продажи)', 'Stars after sale')}</span>
                    <span>{totals.customer_stars_after}</span>
                  </div>
                </div>
              )}
              {cart.length === 0 && selectedTableData?.is_occupied && (
                <div className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">
                  {tx(lang, 'Masa sifarişi mətbəxə göndərilib. Bu məbləğ masanın açıq hesabıdır.', 'Заказ стола отправлен на кухню. Эта сумма — открытый счет стола.', 'The table order has been sent to the kitchen. This amount is the open table balance.')}
                </div>
              )}
            </div>
            <div className="mt-2 space-y-2 border-t border-slate-700/60 pt-2">
              {footerSidebarWidgets.map((widget: string) => renderSidebarWidget(widget))}
            </div>
          </div>
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
                  {cart.map((item, idx) => {
                    const promoD = totals.item_promo_discounts ? totals.item_promo_discounts[idx] : undefined;
                    return (
                      <div key={`mobile_${item.line_id}`} className="rounded-lg border border-slate-700 bg-slate-900/40 p-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold text-slate-100">
                            {item.item_name}
                            {item.cup_mode ? ` · ${item.cup_mode === 'glass' ? tx(lang, 'Stəkan', 'Стакан', 'Glass') : tx(lang, 'To go', 'To go', 'To go')}` : ''}
                          </span>
                          <span className="font-semibold text-yellow-300">{toDecimalSafe(item.price).times(item.qty).toFixed(2)} ₼</span>
                        </div>
                        {promoD && promoD.gt(0) && (
                          <div className="mt-1 text-xs text-yellow-400/90 italic pl-1">
                            [Promo] 2nd Item 50% Off: -{promoD.toFixed(2)} ₼
                          </div>
                        )}
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button className="neon-mini-btn" onClick={() => updateCartItem(item.line_id, item.qty - 1)}>
                            <Minus size={14} />
                          </button>
                          <span className="w-6 text-center">{item.qty}</span>
                          <button className="neon-mini-btn" onClick={() => updateCartItem(item.line_id, item.qty + 1)}>
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
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
              {shouldLockTableCheckoutInPos && (
                <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  {tx(
                    lang,
                    'Bu masa hesabını bağlamaq üçün Masalar modulundan istifadə edin.',
                    'Для закрытия этого счета используйте модуль Столы.',
                    'Use the Tables module to close this table bill.',
                  )}
                </div>
              )}
              {ctx.orderType === 'Dine In' && ctx.selectedTable ? (
                <button
                  disabled={isLoading || !ctx.selectedTable || cart.length === 0}
                  onClick={() => {
                    void handleSendToKitchen();
                    setShowMobileCheckout(false);
                  }}
                  className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/40 bg-emerald-500 px-4 text-base font-bold text-slate-900 shadow-[0_0_22px_rgba(16,185,129,0.35)] disabled:opacity-50"
                >
                  <Check size={18} /> {tx(lang, 'Masaya Göndər', 'Отправить на стол', 'Send To Table')}
                </button>
              ) : (
                <button
                  disabled={
                    isLoading ||
                    shouldLockTableCheckoutInPos ||
                    (cart.length === 0 && !shouldLockTableCheckoutInPos) ||
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
              )}
            </div>
          </div>
        </div>
      )}

      {variantPicker && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{variantPicker.base}</h3>
            <p className="mt-1 text-sm text-slate-300">
              {variantPicker.requiresServiceChoice
                ? tx(lang, 'Əvvəl ölçünü, sonra servis növünü seçin', 'Сначала выберите размер, затем подачу', 'Choose size, then service')
                : tx(lang, 'Ölçü seçin', 'Выберите размер', 'Choose a size')}
            </p>
            <div className="mt-4 space-y-2">
              {variantPicker.items.map((item) => {
                const { variant } = splitVariantName(item.item_name);
                return (
                  <button
                    key={item.id}
                    className={`neon-btn flex h-12 w-full items-center justify-between rounded-lg px-3 ${
                      variantPicker.requiresServiceChoice && variantPicker.selectedItemId === item.id ? 'border-cyan-300 bg-cyan-500/15 text-cyan-50' : ''
                    }`}
                    onClick={() => {
                      if (!variantPicker.requiresServiceChoice) {
                        addToCart(item);
                        setVariantPicker(null);
                        return;
                      }
                      setVariantPicker((prev) => (prev ? { ...prev, selectedItemId: item.id } : prev));
                    }}
                  >
                    <span>{variant || item.item_name}</span>
                    <span>{toDecimalSafe(item.price).toFixed(2)} ₼</span>
                  </button>
                );
              })}
            </div>
            {variantPicker.requiresServiceChoice && (
              <div className="mt-4 space-y-3">
                <div className="text-sm font-semibold text-slate-200">{tx(lang, 'Servis növü', 'Тип подачи', 'Service type')}</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`neon-btn h-14 rounded-xl px-3 text-sm ${variantPicker.selectedCupMode === 'paper' ? 'border-amber-300 bg-amber-500/15 text-amber-50' : ''}`}
                    onClick={() => setVariantPicker((prev) => (prev ? { ...prev, selectedCupMode: 'paper' } : prev))}
                  >
                    {tx(lang, 'Kağız stəkan (to go)', 'Бумажный стакан (to go)', 'Paper cup (to go)')}
                  </button>
                  <button
                    className={`neon-btn h-14 rounded-xl px-3 text-sm ${variantPicker.selectedCupMode === 'glass' ? 'border-cyan-300 bg-cyan-500/15 text-cyan-50' : ''}`}
                    onClick={() => setVariantPicker((prev) => (prev ? { ...prev, selectedCupMode: 'glass' } : prev))}
                  >
                    {tx(lang, 'Stəkan (masa)', 'Стакан (table)', 'Glass (table)')}
                  </button>
                </div>
                <button
                  className="glossy-gold h-12 w-full rounded-xl px-4 text-sm font-bold disabled:opacity-50"
                  disabled={!variantPicker.selectedItemId || !variantPicker.selectedCupMode}
                  onClick={() => {
                    const selectedItem = variantPicker.items.find((item) => item.id === variantPicker.selectedItemId);
                    if (!selectedItem || !variantPicker.selectedCupMode) return;
                    addToCart(selectedItem, { cup_mode: variantPicker.selectedCupMode });
                    setVariantPicker(null);
                  }}
                >
                  {tx(lang, 'Səbətə əlavə et', 'Добавить в корзину', 'Add to cart')}
                </button>
              </div>
            )}
            <button className="mt-4 w-full rounded-lg border border-slate-600 px-4 py-2 text-sm" onClick={() => setVariantPicker(null)}>
              {tx(lang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
        </div>
      )}

      {showOpenShiftModal && (
        <div className="fixed inset-0 z-[121] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-md rounded-2xl p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Əvvəlcə günü açın', 'Сначала откройте смену', 'Open shift first')}</h3>
            <p className="mt-2 text-sm text-slate-300">
              {tx(
                lang,
                'Satış üçün əvvəl günü Z-Hesabat bölməsində açın.',
                'Перед продажей откройте смену в разделе Z-Отчет.',
                'Open the shift in Z-Report before making sales.',
              )}
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="neon-btn rounded-xl px-4 py-2" onClick={() => setShowOpenShiftModal(false)}>
                {tx(lang, 'Bağla', 'Закрыть', 'Close')}
              </button>
              <button
                className="glossy-gold rounded-xl px-4 py-2 font-semibold"
                onClick={() => {
                  setShowOpenShiftModal(false);
                  window.dispatchEvent(new CustomEvent('navigate-module', { detail: { module: 'zreport' } }));
                }}
              >
                {tx(lang, 'Z-Hesabata keçin', 'Перейти в Z-Отчет', 'Go to Z-Report')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(pendingClearCartKey)}
        title={tx(lang, 'Səbəti təmizlə?', 'Очистить корзину?', 'Clear cart?')}
        message={tx(
          lang,
          'Bu səbətdəki bütün məhsullar silinəcək. Davam etmək istəyirsiniz?',
          'Все позиции в этой корзине будут удалены. Продолжить?',
          'All items in this cart will be removed. Continue?',
        )}
        lang={safeLang}
        confirmLabel={tx(lang, 'Səbəti sil', 'Очистить', 'Clear cart')}
        cancelLabel={tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
        onCancel={() => setPendingClearCartKey(null)}
        onConfirm={() => {
          if (pendingClearCartKey) clearCart(pendingClearCartKey);
          setPendingClearCartKey(null);
        }}
      />
    </div>
  );
}
