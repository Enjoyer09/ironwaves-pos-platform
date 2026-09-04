import React from 'react';
import { Coffee, Gift, Home, Languages, MessageSquare, ShoppingBag, Sparkles, UserRound } from 'lucide-react';
import QRCode from 'qrcode';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { tx } from '../i18n';
import { useAppStore } from '../store';
import { activate_customer_campaign_live, claim_customer_reward_live, enroll_customer_app_live, get_customer_app_bootstrap_live, get_customer_app_session_live, mark_customer_notification_read_live, save_push_token_live, send_customer_otp_live, verify_customer_otp_live, analyze_customer_fortune_live, chat_customer_barista_live, get_customer_wallet_pass_url, create_customer_pre_order_live, get_customer_orders_live, update_customer_name_live, update_customer_birthday_live, sortStoresByDistance, get_nearest_branches_live } from '../api/crm';
import { get_public_menu_live } from '../api/menu';
import { clearCustomerSession, readCustomerPushToken, readCustomerPushTokenAsync, writeCustomerPushToken, writeCustomerSession } from '../lib/customer_session';
import HomeTab from './customer/HomeTab';
import OrderTab from './customer/OrderTab';
import ProfileTab from './customer/ProfileTab';
import BaristaTab from './customer/BaristaTab';
import FalciTab from './customer/FalciTab';
import OffersTab from './customer/OffersTab';
import FeedbackTab from './customer/FeedbackTab';
import { formatCardId, playTickSound, playShimmerSound, CustomerTab } from '../lib/customer_utils';
import { updateCartItemQty } from '../lib/cartMath';
import { buildReorderItem, mergeReorderItem } from '../lib/reorderItem';
import { syncOnAppOpen, registerWebBackgroundSync, registerCapacitorBackgroundTask } from '../lib/background_fetch';
import { startLiveActivity, updateLiveActivity, endLiveActivity } from '../lib/live_activity';

type Props = {
  cardId?: string;
  token?: string;
  joinMode?: boolean;
};

const CUSTOMER_DEBUG_TOOLS_ENABLED = Boolean((import.meta as any)?.env?.DEV) && !Capacitor.isNativePlatform();

type OneSignalRuntime = {
  push: (callback: () => void | Promise<void>) => void;
  init: (config: { appId: string; allowLocalhostAsSecureOrigin?: boolean }) => Promise<void>;
  User: {
    PushSubscription: {
      id: string | null;
    };
  };
};

function persistCustomerSession(cardId: string, token: string) {
  writeCustomerSession(cardId, token);
}

function showStatusToast(message: string) {
  const el = document.createElement('div');
  el.className = 'cust-toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

function scrubCustomerSessionFromUrl() {
  if (typeof window === 'undefined') return;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete('id');
  nextUrl.searchParams.delete('t');
  nextUrl.searchParams.delete('token');
  nextUrl.searchParams.delete('join');
  nextUrl.searchParams.delete('club');
  nextUrl.searchParams.delete('discount');
  nextUrl.searchParams.set('customer', '1');
  window.history.replaceState({}, '', nextUrl.toString());
}

// C11: first-launch onboarding slides (trilingual). Indexed by safeLang.
type TriLang = { az: string; ru: string; en: string };
const ONBOARD_SLIDES: Array<{ icon: string; title: TriLang; body: TriLang }> = [
  {
    icon: '☕',
    title: { az: 'Öncədən sifariş verin', ru: 'Закажите заранее', en: 'Order ahead' },
    body: {
      az: 'Sevdiyiniz qəhvəni seçin, növbədə gözləmədən hazır olanadək götürün.',
      ru: 'Выберите любимый кофе и заберите готовым, не стоя в очереди.',
      en: 'Pick your favourite drink and skip the queue — we prep it before you arrive.',
    },
  },
  {
    icon: '✨',
    title: { az: 'AI Barista və Falçı', ru: 'AI Бариста и Фалчы', en: 'AI Barista & Fortune' },
    body: {
      az: 'İçki tövsiyəsi üçün AI Barista ilə söhbət edin və ya Falçı ilə gələcəyə nəzər salın.',
      ru: 'Поговорите с AI Бариста за советом по напитку или загляните в будущее с Фалчы.',
      en: 'Chat with the AI Barista for drink tips, or peek into the future with the Fortune teller.',
    },
  },
  {
    icon: '📱',
    title: { az: 'Kasada sadəcə skan edin', ru: 'Просто отсканируйте на кассе', en: 'Just scan at the counter' },
    body: {
      az: 'Üzvlük QR-kodunuzu kassada skan edərək ödəyin və mükafat ulduzları toplayın.',
      ru: 'Отсканируйте QR членства на кассе, чтобы оплатить и копить звёзды.',
      en: 'Scan your membership QR at the counter to pay and collect reward stars.',
    },
  },
];

export default function CustomerApp({ cardId = '', token = '', joinMode = false }: Props) {
  const { lang, setLang } = useAppStore();
  const [loading, setLoading] = React.useState(true);

  // Theme: system default, with manual toggle
  const [themeMode, setThemeMode] = React.useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('customer_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
  });
  const isLight = themeMode === 'light';

  React.useEffect(() => {
    try { localStorage.setItem('customer_theme', themeMode); } catch {}
    // Update meta theme-color for status bar
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isLight ? '#FFFFFF' : '#0f172a');
  }, [themeMode, isLight]);
  const [data, setData] = React.useState<any | null>(null);
  const [bootstrapData, setBootstrapData] = React.useState<any | null>(null);
  const [error, setError] = React.useState('');
  // P1-3: true when the card opened from the offline session cache (network down)
  const [offlineMode, setOfflineMode] = React.useState(false);
  const [claiming, setClaiming] = React.useState(false);
  const [cardQr, setCardQr] = React.useState('');
  const [sessionCreds, setSessionCreds] = React.useState({ cardId, token });
  const [acceptingConsent, setAcceptingConsent] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<CustomerTab>('home');
  // C2: which AI experience is shown inside the combined "AI" hub tab
  const [aiSubTab, setAiSubTab] = React.useState<'barista' | 'falci'>('barista');
  // C9: explicit payment-method step before checkout
  const [paymentMethod, setPaymentMethod] = React.useState<'counter' | 'card' | 'wallet'>('counter');
  // C11: first-launch 3-slide onboarding
  const [showOnboarding, setShowOnboarding] = React.useState(() => {
    try { return !localStorage.getItem('ironwaves_customer_onboarded'); } catch { return false; }
  });
  const [onboardStep, setOnboardStep] = React.useState(0);
  const finishOnboarding = () => {
    try { localStorage.setItem('ironwaves_customer_onboarded', '1'); } catch {}
    setShowOnboarding(false);
  };
  const [cardFlipped, setCardFlipped] = React.useState(false);
  const [menuItems, setMenuItems] = React.useState<any[]>([]);
  const [menuLoading, setMenuLoading] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState<string>('ALL');
  const [customerCart, setCustomerCart] = React.useState<any[]>([]);
  const [modifierSheetItem, setModifierSheetItem] = React.useState<any | null>(null);
  const [selectedVariant, setSelectedVariant] = React.useState<any | null>(null);
  const [selectedModifiers, setSelectedModifiers] = React.useState<any[]>([]);
  const [preOrderSubmitting, setPreOrderSubmitting] = React.useState(false);
  const [preOrderSuccess, setPreOrderSuccess] = React.useState(false);
  const [preOrderSuccessId, setPreOrderSuccessId] = React.useState('');
  const [activeOrders, setActiveOrders] = React.useState<any[]>([]);
  const [showCartSheet, setShowCartSheet] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [orderNotes, setOrderNotes] = React.useState('');
  // Starbucks-style store selection: the branch the customer picks for pickup.
  // Persisted in localStorage so the choice survives app restarts; falls back
  // to the tenant's default store when the session has no stores list.
  const [selectedStoreId, setSelectedStoreId] = React.useState<string>(() => {
    try {
      return localStorage.getItem('customer_store_id') || '';
    } catch {
      return '';
    }
  });
  // Geolocation: resolved once per app open; stores are re-sorted by distance
  // when the location arrives. Denied/unsupported falls back to server order.
  const [locCoords, setLocCoords] = React.useState<{ lat: number; lng: number } | null>(null);
  const [remoteNearest, setRemoteNearest] = React.useState<any[] | null>(null);
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation?.getCurrentPosition(
      (pos) => setLocCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* permission denied — keep original store order */ },
      { timeout: 8000, maximumAge: 300000, enableHighAccuracy: false }
    );
  }, []);
  const baseStores = Array.isArray((data as any)?.stores) && (data as any).stores.length > 0
    ? (data as any).stores
    : [{ id: (data as any)?.tenant_id || '', name: (data as any)?.branding?.company_name || '', address: (data as any)?.branding?.address || '', phone: (data as any)?.branding?.phone || '', is_default: true }];
  React.useEffect(() => {
    if (!locCoords) return;
    let cancelled = false;
    (async () => {
      try {
        const nearest = await get_nearest_branches_live((data as any)?.tenant_id, locCoords.lat, locCoords.lng, 20);
        if (!cancelled && Array.isArray(nearest) && nearest.length > 0) {
          setRemoteNearest(nearest);
          setSelectedStoreId((prev) => prev || String(nearest[0]?.id) || '');
        }
      } catch {
        if (!cancelled) setRemoteNearest(null); // offline — local sort below
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locCoords, data]);
  const stores = React.useMemo(() => {
    if (remoteNearest && remoteNearest.length > 0) return remoteNearest;
    if (locCoords) return sortStoresByDistance(baseStores, locCoords.lat, locCoords.lng);
    return baseStores;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteNearest, locCoords, baseStores]);
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [otpCode, setOtpCode] = React.useState('');
  const [otpSent, setOtpSent] = React.useState(false);
  const [otpSending, setOtpSending] = React.useState(false);
  const [otpVerifying, setOtpVerifying] = React.useState(false);
  const [otpError, setOtpError] = React.useState('');
  const [customerName, setCustomerName] = React.useState('');
  const [birthDate, setBirthDate] = React.useState('');
  const [consentChecked, setConsentChecked] = React.useState(true);

  const isBootstrapMode = React.useMemo(() => {
    return !!(data?.tenant_id && !sessionCreds.cardId);
  }, [data, sessionCreds.cardId]);

  const registrationMode: 'simple' | 'lightweight' | 'full' =
    (bootstrapData?.registration_mode as any) ||
    (bootstrapData?.customer_app_settings?.registration_mode as any) ||
    (data?.customer_app_settings?.registration_mode as any) ||
    'full';
  const selectedStore = stores.find((s: any) => String(s.id) === String(selectedStoreId)) || stores[0] || null;
  const setSelectedStore = React.useCallback((id: string) => {
    setSelectedStoreId(id);
    try {
      localStorage.setItem('customer_store_id', id);
    } catch {}
  }, []);
  const [baristaMessages, setBaristaMessages] = React.useState<Array<{ role: 'assistant' | 'user'; text: string }>>([]);
  const [baristaInput, setBaristaInput] = React.useState('');
  const [fortuneText, setFortuneText] = React.useState('');
  const [fortuneImage, setFortuneImage] = React.useState('');
  const [fortuneLoading, setFortuneLoading] = React.useState(false);
  const [fortuneProgress, setFortuneProgress] = React.useState(0);
  const [fortuneStepText, setFortuneStepText] = React.useState('');
  const [showFullQr, setShowFullQr] = React.useState(false);
  const [activatedCampaigns, setActivatedCampaigns] = React.useState<Record<string, { exp: number; start: number }>>({});
  // U3 decision: Premium is the single design language. The retro/comic variant
  // and its toggle are no longer exposed to users; designMode is pinned to
  // 'classic' so everyone sees the same premium UI (stale localStorage values
  // are ignored because we no longer read customer_design_mode).
  const designMode: 'classic' | 'retro' = 'classic';
  const [campaignQrs, setCampaignQrs] = React.useState<Record<string, string>>({});
  const [isListening, setIsListening] = React.useState(false);
  const [voiceEnabled, setVoiceEnabled] = React.useState(false);
  const recognitionRef = React.useRef<any>(null);
  const [geofenceAlert, setGeofenceAlert] = React.useState(false);
  const [showDevSettings, setShowDevSettings] = React.useState(false);
  const [localFavorites, setLocalFavorites] = React.useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('ironwaves_customer_favorites');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [customApiUrl, setCustomApiUrl] = React.useState(() => {
    return localStorage.getItem('ironwaves_custom_api_base_url') || '';
  });
  const [customTenantDomain, setCustomTenantDomain] = React.useState(() => {
    return localStorage.getItem('mobile_tenant_domain') || 'super.ironwaves.store';
  });
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const safeLang = lang === 'ru' || lang === 'en' ? lang : 'az';

  React.useEffect(() => {
    if (!cardId || !token) return;
    persistCustomerSession(cardId, token);
    scrubCustomerSessionFromUrl();
  }, [cardId, token]);

  const openWalletPass = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (Capacitor.isNativePlatform()) {
      window.open(url, '_system');
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenModifiers = (item: any) => {
    const hasVariants = item.variants && item.variants.length > 0;
    const hasModifiers = item.modifiers && item.modifiers.length > 0;
    // C4: one-tap quick-add — skip the full ModifierSheet when there is
    // nothing to configure. This removes the biggest source of tap friction
    // for simple products (espresso, sparkling water, a single-size pastry).
    if (!hasVariants && !hasModifiers) {
      setCustomerCart(prev => {
        const existingIdx = prev.findIndex(ci =>
          ci.id === item.id &&
          ci.variant_name === null &&
          JSON.stringify(ci.selected_modifiers) === '[]'
        );
        if (existingIdx > -1) {
          const next = [...prev];
          next[existingIdx].quantity += 1;
          return next;
        }
        return [...prev, {
          id: item.id,
          name: item.item_name || item.name || '',
          quantity: 1,
          price: Number(item.price || 0),
          variant_name: null,
          selected_modifiers: [],
          notes: ''
        }];
      });
      playTickSound();
      if (Capacitor.isNativePlatform()) {
        try {
          Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
        } catch {}
      }
      showStatusToast(tx(safeLang, 'Səbətə əlavə edildi 🛒', 'Добавлено в корзину 🛒', 'Added to cart 🛒'));
      return;
    }
    setModifierSheetItem(item);
    setSelectedVariant(item.variants && item.variants.length > 0 ? item.variants[0] : null);
    setSelectedModifiers([]);
  };

  const handleToggleModifier = (mod: { name: string; price: number }) => {
    setSelectedModifiers(prev => {
      const exists = prev.find(m => m.name === mod.name);
      if (exists) {
        return prev.filter(m => m.name !== mod.name);
      } else {
        return [...prev, mod];
      }
    });
  };

  const handleAddToCart = () => {
    if (!modifierSheetItem) return;
    const basePrice = selectedVariant ? Number(selectedVariant.price) : Number(modifierSheetItem.price || 0);
    const modifiersTotal = selectedModifiers.reduce((acc, m) => acc + m.price, 0);
    const finalPrice = basePrice + modifiersTotal;

    const cartItem = {
      id: modifierSheetItem.id,
      name: modifierSheetItem.item_name || modifierSheetItem.name || '',
      quantity: 1,
      price: finalPrice,
      variant_name: selectedVariant ? selectedVariant.name : null,
      selected_modifiers: selectedModifiers,
      notes: ''
    };

    setCustomerCart(prev => {
      const existingIdx = prev.findIndex(item => 
        item.id === cartItem.id && 
        item.variant_name === cartItem.variant_name &&
        JSON.stringify(item.selected_modifiers) === JSON.stringify(cartItem.selected_modifiers)
      );
      if (existingIdx > -1) {
        const next = [...prev];
        next[existingIdx].quantity += 1;
        return next;
      }
      return [...prev, cartItem];
    });

    setModifierSheetItem(null);
    playTickSound();
    if (Capacitor.isNativePlatform()) {
      try {
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      } catch {}
    }
  };

  const handleRemoveFromCart = (index: number) => {
    setCustomerCart(prev => prev.filter((_, idx) => idx !== index));
    playTickSound();
  };

  const handleUpdateCartQty = (index: number, delta: number) => {
    setCustomerCart(prev => prev.map((item, idx) =>
      idx === index ? updateCartItemQty(item, delta) : item
    ));
    playTickSound();
  };

  // Starbucks-style one-tap reorder: rebuild a cart item from an order-history
  // payload (menu item id + saved variant/modifiers are preserved) and merge it
  // into the cart, then jump to the Order tab. The pure math lives in
  // src/lib/reorderItem.ts (buildReorderItem + mergeReorderItem) — unit-tested.
  const handleReorderItem = React.useCallback((historyItem: any) => {
    if (!historyItem) return;
    const menuItem = menuItems.find((m: any) => String(m.id) === String(historyItem.id));
    const cartItem = buildReorderItem(historyItem, menuItem);
    if (!cartItem) {
      showStatusToast(tx(safeLang, 'Bu məhsul artıq menyuda yoxdur', 'Этого товара больше нет в меню', 'This item is no longer on the menu'));
      return;
    }
    setCustomerCart(prev => mergeReorderItem(prev, cartItem));
    playTickSound();
    showStatusToast(tx(safeLang, 'Səbətə əlavə edildi 🛒', 'Добавлено в корзину 🛒', 'Added to cart 🛒'));
    switchTabWithTransition('order');
  }, [menuItems, safeLang]);

  const handleCheckoutPreOrder = async () => {
    if (customerCart.length === 0) return;
    try {
      setPreOrderSubmitting(true);
      const res = await create_customer_pre_order_live({
        cardId: sessionCreds.cardId!,
        token: sessionCreds.token!,
        items: customerCart,
        notes: orderNotes,
        tenantId: data?.tenant_id,
        storeId: selectedStore?.id || undefined,
        storeName: selectedStore?.name || undefined,
        paymentMethod
      });
      if (res.success) {
        setPreOrderSuccessId(res.orderId);
        setPreOrderSuccess(true);
        setCustomerCart([]);
        setOrderNotes('');
        setShowCartSheet(false);
        playShimmerSound();
        void refreshOrders();
      }
    } catch (err) {
      console.warn('Checkout failed:', err);
      setError(String(err instanceof Error ? err.message : 'Sifariş göndərilə bilmədi'));
    } finally {
      setPreOrderSubmitting(false);
    }
  };

  const activeOrdersRef = React.useRef<any[]>([]);
  activeOrdersRef.current = activeOrders;

  const refreshOrders = React.useCallback(async () => {
    if (!sessionCreds.cardId || !sessionCreds.token) return;
    try {
      const orders = await get_customer_orders_live(sessionCreds.cardId, sessionCreds.token, data?.tenant_id);
      const prevByStatus = new Map(activeOrdersRef.current.map((o: any) => [o.id, o.status]));
      setActiveOrders(orders);
      // Once the just-placed order reaches a terminal state, stop tracking it
      setPreOrderSuccessId((prev) => {
        if (prev && orders.some((o: any) => o.id === prev && (o.status === 'READY' || o.status === 'VOIDED'))) {
          return '';
        }
        return prev;
      });
      // Web fallback toast for status transitions (native gets real push)
      for (const o of orders) {
        const prevStatus = prevByStatus.get(o.id);
        if (!prevStatus || prevStatus === o.status) continue;
        if (o.status === 'PREPARING') {
          showStatusToast('Sifarişiniz hazırlanır ☕');
        } else if (o.status === 'READY') {
          showStatusToast('Sifarişiniz hazırdır! 🎉');
          playShimmerSound();
          if (Capacitor.isNativePlatform()) {
            try {
              Haptics.notification({ type: NotificationType.Success }).catch(() => {});
            } catch {}
          }
        }
      }
    } catch (e) {
      console.warn('Order status fetch failed:', e);
    }
  }, [sessionCreds.cardId, sessionCreds.token, data?.tenant_id]);

  // Poll order status while there is an active (non-terminal) order
  React.useEffect(() => {
    const hasActiveOrder = activeOrdersRef.current.some((o: any) => o.status === 'NEW' || o.status === 'PREPARING');
    if (!preOrderSuccessId && !hasActiveOrder) return;
    void refreshOrders();
    const timer = window.setInterval(() => void refreshOrders(), 8000);
    return () => window.clearInterval(timer);
  }, [preOrderSuccessId, refreshOrders]);

  // Load existing active orders on session start
  React.useEffect(() => {
    if (!sessionCreds.cardId || !sessionCreds.token) return;
    void refreshOrders();
  }, [refreshOrders]);

  const chartData = React.useMemo(() => {
    const historyList = Array.isArray(data?.history) ? data.history : [];
    if (historyList.length === 0) return [];
    const groups: Record<string, number> = {};
    const locale = safeLang === 'az' ? 'az-AZ' : safeLang === 'ru' ? 'ru-RU' : 'en-US';
    const sorted = [...historyList].sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    for (const item of sorted) {
      if (!item.created_at) continue;
      const dateStr = new Date(item.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
      groups[dateStr] = (groups[dateStr] || 0) + Number(item.total || 0);
    }
    return Object.keys(groups).map((date) => ({
      date,
      amount: parseFloat(groups[date].toFixed(2)),
    }));
  }, [data?.history, safeLang]);

  const favoriteItems = React.useMemo(() => {
    const counts: Record<string, { name: string; count: number; category: string; lastItem?: any }> = {};
    // Oldest → newest; lastItem overwritten so the most recent payload wins.
    const historyList = [...(Array.isArray(data?.history) ? data.history : [])]
      .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    
    for (const sale of historyList) {
      const itemsList = Array.isArray(sale.items) ? sale.items : [];
      for (const item of itemsList) {
        if (!item.item_name) continue;
        const name = String(item.item_name).trim();
        const qty = Number(item.qty || 1);
        
        let category = 'coffee';
        const lowerName = name.toLowerCase();
        if (lowerName.includes('çay') || lowerName.includes('tea') || lowerName.includes('matcha')) {
          category = 'tea';
        } else if (lowerName.includes('keks') || lowerName.includes('tart') || lowerName.includes('tort') || lowerName.includes('cake') || lowerName.includes('kurabiye') || lowerName.includes('cookie') || lowerName.includes('biscuit') || lowerName.includes('şirniyyat') || lowerName.includes('desert') || lowerName.includes('dessert')) {
          category = 'sweet';
        } else if (lowerName.includes('sendviç') || lowerName.includes('sandviç') || lowerName.includes('sandwich') || lowerName.includes('tost') || lowerName.includes('toast') || lowerName.includes('burger')) {
          category = 'food';
        } else if (lowerName.includes('limonad') || lowerName.includes('lemonade') || lowerName.includes('su') || lowerName.includes('water') || lowerName.includes('sok') || lowerName.includes('juice') || lowerName.includes('cola') || lowerName.includes('fanta') || lowerName.includes('sprite')) {
          category = 'cold';
        }

        if (counts[name]) {
          counts[name].count += qty;
        } else {
          counts[name] = { name, count: qty, category, lastItem: item };
        }
        counts[name].lastItem = item;
      }
    }

    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [data?.history]);

  // F1: real, data-driven "Picked for you" — items from the customer's most recent order.
  const recentItems = React.useMemo(() => {
    const historyList = Array.isArray(data?.history) ? data.history : [];
    if (historyList.length === 0) return [];
    const sorted = [...historyList].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
    const latest = sorted[0];
    const itemsList = Array.isArray(latest?.items) ? latest.items : [];
    return itemsList
      .map((item: any) => {
        const name = String(item.item_name || '').trim();
        if (!name) return null;
        let category = 'coffee';
        const lower = name.toLowerCase();
        if (lower.includes('çay') || lower.includes('tea') || lower.includes('matcha')) category = 'tea';
        else if (lower.includes('keks') || lower.includes('tort') || lower.includes('cake') || lower.includes('kurabiye') || lower.includes('cookie') || lower.includes('şirniyyat') || lower.includes('desert')) category = 'sweet';
        else if (lower.includes('sendviç') || lower.includes('sandwich') || lower.includes('tost') || lower.includes('burger')) category = 'food';
        else if (lower.includes('limonad') || lower.includes('su') || lower.includes('sok') || lower.includes('juice') || lower.includes('cola')) category = 'cold';
        // Keep the full history payload so one-tap reorder can rebuild the cart item.
        return { ...item, name, category };
      })
      .filter(Boolean)
      .slice(0, 4);
  }, [data?.history]);

  const branding = data?.branding || {};
  const wallet = data?.wallet || {};
  const notifications = Array.isArray(data?.notifications) ? data.notifications : [];
  const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
  const history = Array.isArray(data?.history) ? data.history : [];
  const customer = data?.customer || {};
  



  const rewards = Array.isArray(wallet?.rewards) ? wallet.rewards : [];
  const pendingClaims = Array.isArray(data?.pending_claims) ? data.pending_claims : [];
  // Starbucks-style activated rewards: all-status claim history (PENDING + REDEEMED).
  const claims = Array.isArray(data?.claims) ? data.claims : [];

  // P1-4: server-validated campaign activations survive restarts and cross-device
  // — seed the local timer state from the session (expired rows are already filtered).
  React.useEffect(() => {
    const acts = Array.isArray((data as any)?.campaign_activations) ? (data as any).campaign_activations : [];
    if (acts.length === 0) return;
    setActivatedCampaigns((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const a of acts) {
        const exp = Date.parse(a.expires_at);
        if (Number.isFinite(exp) && exp > Date.now()) {
          const start = Number.isFinite(Date.parse(a.activated_at)) ? Date.parse(a.activated_at) : exp - 900000;
          if (!next[a.campaign_id] || next[a.campaign_id].exp !== exp) {
            next[a.campaign_id] = { exp, start };
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [data]);

  const handleActivateCampaign = React.useCallback(async (campaignId: string) => {
    if (!sessionCreds.cardId || !sessionCreds.token) return null;
    try {
      const res = await activate_customer_campaign_live(campaignId, sessionCreds.cardId, sessionCreds.token);
      if (res?.success && res.expires_at) {
        const expMs = Date.parse(res.expires_at);
        if (Number.isFinite(expMs) && expMs > Date.now()) {
          setActivatedCampaigns((prev) => ({ ...prev, [campaignId]: { exp: expMs, start: Date.now() } }));
        }
        return res.expires_at;
      }
      return null;
    } catch (e: any) {
      console.error('Campaign activation failed:', e?.message || e);
      return null;
    }
  }, [sessionCreds.cardId, sessionCreds.token]);
  const progressPercent = wallet?.next_reward_at ? Math.min(100, Math.round((Number(wallet.progress_current || 0) / Number(wallet.next_reward_at || 1)) * 100)) : 0;
  const primaryColor = String(branding?.primary_color || '#F48C24');
  const accentColor = String(branding?.accent_color || '#1A4329');
  const programMode = String(wallet?.program_mode || 'points').toLowerCase();
  const showQrCard = branding?.show_qr_card !== false;
  const showWallet = branding?.show_wallet !== false;
  const balanceSuffix = programMode === 'cashback' ? ' ₼' : '';
  const heroImage = String(branding?.hero_image_url || '');
  const aiBaristaEnabled = branding?.ai_barista_enabled === true;

  // ── P0.3 — tenant fonu (`background_color` / `background_image_url`) ──────
  // Bu iki ayar paneldə var, backend `branding`-də göndərir, amma indiyə qədər
  // heç yerdə oxunmurdu. Diqqət edilən iki nüans:
  //   1. `#0b1220` backend-in "heç nə seçilməmiş" default-udur (operations.py).
  //      Onu tətbiq etsək fon seçməyən BÜTÜN tenant-ların isti qradienti tünd
  //      göy rəngə dönərdi — ona görə default sentinel kimi sayılır.
  //   2. Yalnız tünd temada tətbiq olunur. İşıqlı temada mətn `text-slate-900`-dır;
  //      tenant tünd rəng seçsə mətn oxunmaz olardı. İşıqlı tema neytral qalır.
  const LEGACY_DEFAULT_BG = '#0b1220';
  const isHexColor = (v: string) => /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
  const tenantBgColorRaw = String(branding?.background_color || '').trim();
  const tenantBgColor = isHexColor(tenantBgColorRaw) && tenantBgColorRaw.toLowerCase() !== LEGACY_DEFAULT_BG
    ? tenantBgColorRaw
    : '';
  // Şəkil URL-i inline `url(...)` içinə düşür — mötərizə/sitat qırılması olmasın.
  const tenantBgImageRaw = String(branding?.background_image_url || '').trim();
  const tenantBgImage = tenantBgImageRaw && !/["'()\\]|\s/.test(tenantBgImageRaw) ? tenantBgImageRaw : '';
  const hasTenantBg = !isLight && Boolean(tenantBgColor || tenantBgImage);
  const tenantBgStyle: React.CSSProperties | null = hasTenantBg
    ? {
        // Şəklin üstündə tünd pərdə: ağ mətnin kontrastı hər şəkildə qalsın.
        backgroundColor: tenantBgColor || '#160D07',
        backgroundImage: tenantBgImage
          ? `linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.78)), url(${tenantBgImage})`
          : undefined,
        backgroundSize: tenantBgImage ? 'cover' : undefined,
        backgroundPosition: tenantBgImage ? 'center' : undefined,
        backgroundAttachment: tenantBgImage ? 'fixed' : undefined,
      }
    : null;

  // ── P0.5 — tenant kimliyi (əvvəl "iRonWaves" hardcoded idi) ───────────────
  // Müştəri tətbiqi tenant-ın öz brendini göstərməlidir; platformanın adı
  // müştəriyə görünən mətnlərdə olmamalıdır.
  const brandDisplayName = String(
    branding?.company_name || branding?.app_name
    || bootstrapData?.branding?.company_name || bootstrapData?.branding?.app_name || ''
  ).trim();
  const brandLogoUrl = String(branding?.logo_url || bootstrapData?.branding?.logo_url || '').trim();

  // `customer.html`-də statik `<title>Emalathhana</title>` vardı — bütün tenant-lar
  // brauzer tabında başqa kafənin adını görürdü. Başlıq (və favicon) artıq
  // branding yüklənəndə tenant-a görə yazılır.
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (brandDisplayName) document.title = brandDisplayName;
    if (!brandLogoUrl) return;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = brandLogoUrl;
    const touchIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (touchIcon) touchIcon.href = brandLogoUrl;
  }, [brandDisplayName, brandLogoUrl]);

  // ── P0.5 — geofence artıq tenant filiallarından oxunur ────────────────────
  // Əvvəl `CAFE_LAT/CAFE_LNG = 40.37767, 49.84583` hardcoded idi — yəni HƏR
  // tenant-ın müştərisi Bakıdakı bir konkret kafənin yanından keçəndə bildiriş
  // alırdı. Filialın koordinatı yoxdursa geofence heç işə salınmır (səhv yerdə
  // bildiriş göndərməkdənsə heç göndərməmək düzgündür).
  const geofenceTargets = React.useMemo(() => {
    const rows = Array.isArray((data as any)?.stores) ? (data as any).stores : [];
    return rows
      .map((row: any) => ({
        name: String(row?.name || '').trim(),
        lat: Number(row?.latitude),
        lng: Number(row?.longitude),
      }))
      .filter((row: { lat: number; lng: number }) =>
        Number.isFinite(row.lat) && Number.isFinite(row.lng) && (row.lat !== 0 || row.lng !== 0));
  }, [(data as any)?.stores]);
  // `baseStores` hər render-də yeni massiv qurur, ona görə effekt asılılığı üçün
  // sabit açar lazımdır — yoxsa `watchPosition` hər render-də yenidən qurulardı.
  const geofenceKey = geofenceTargets.map((row: { lat: number; lng: number }) => `${row.lat},${row.lng}`).join('|');

  // Live Activity — start on data load, update on wallet change
  const hasStartedLiveActivityRef = React.useRef(false);
  React.useEffect(() => {
    if (!data?.customer?.name || !wallet) return;
    const starsBalance = Number(wallet.stars_balance ?? 0);
    const isCashback = programMode === 'cashback';
    const cashbackPct = Number(wallet.cashback_percent || 0);

    if (!hasStartedLiveActivityRef.current) {
      hasStartedLiveActivityRef.current = true;
      void startLiveActivity({
        customerName: data.customer.name,
        programMode,
        starsBalance,
        progressPercent,
        rewardName: wallet.reward_name || 'Reward',
        isCashback,
        cashbackPercent: cashbackPct,
      });
    }
  }, [data?.customer?.name, wallet]);

  // Update Live Activity when wallet balance changes
  const prevWalletRef = React.useRef<string>('');
  React.useEffect(() => {
    if (!hasStartedLiveActivityRef.current) return;
    const walletKey = JSON.stringify({
      starsBalance: wallet.stars_balance,
      progressCurrent: wallet.progress_current,
      rewardName: wallet.reward_name,
      cashbackPercent: wallet.cashback_percent,
    });
    if (walletKey === prevWalletRef.current) return;
    prevWalletRef.current = walletKey;

    void updateLiveActivity({
      starsBalance: Number(wallet.stars_balance ?? 0),
      progressPercent,
      rewardName: wallet.reward_name || 'Reward',
      isCashback: programMode === 'cashback',
      cashbackPercent: Number(wallet.cashback_percent || 0),
    });
  }, [wallet.stars_balance, wallet.progress_current, wallet.reward_name, wallet.cashback_percent, wallet.next_reward_at]);

  // End Live Activity on unmount
  React.useEffect(() => {
    return () => {
      if (hasStartedLiveActivityRef.current) {
        void endLiveActivity();
      }
    };
  }, []);

  const onesignalScriptRef = React.useRef<HTMLScriptElement | null>(null);

  const initOneSignalSDK = React.useCallback((appId: string, cardId: string, token: string) => {
    if (!appId) return;
    try {
      const oneSignal = ((window as any).OneSignal || []) as OneSignalRuntime;
      (window as any).OneSignal = oneSignal;
      oneSignal.push(async () => {
        await oneSignal.init({
          appId: appId,
          allowLocalhostAsSecureOrigin: true,
        });
        const userId = await oneSignal.User.PushSubscription.id;
        if (userId) {
          writeCustomerPushToken(userId);
          try {
            await save_push_token_live(cardId, userId, token);
            console.log('OneSignal Push token synced with backend:', userId);
          } catch (pErr) {
            console.warn('Failed to sync OneSignal push token:', pErr);
          }
        }
      });

      if (!document.getElementById('onesignal-sdk')) {
        const script = document.createElement('script');
        script.id = 'onesignal-sdk';
        script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
        script.defer = true;
        document.head.appendChild(script);
        onesignalScriptRef.current = script;
      }
    } catch (e) {
      console.warn('Failed to load OneSignal SDK:', e);
    }
  }, []);

  const load = React.useCallback(async () => {
    if (!sessionCreds.cardId || !sessionCreds.token) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const session = await get_customer_app_session_live(sessionCreds.cardId, sessionCreds.token);
      setData(session);
      setOfflineMode(Boolean((session as any)?._from_cache));
      
      if (session.onesignal_app_id) {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(() => {
            initOneSignalSDK(session.onesignal_app_id, sessionCreds.cardId, sessionCreds.token);
          }, { timeout: 2000 });
        } else {
          setTimeout(() => {
            initOneSignalSDK(session.onesignal_app_id, sessionCreds.cardId, sessionCreds.token);
          }, 1500);
        }
      }

      if (Capacitor.isNativePlatform()) {
        const cachedPushToken = await readCustomerPushTokenAsync();
        if (cachedPushToken) {
          try {
            await save_push_token_live(sessionCreds.cardId, cachedPushToken, sessionCreds.token);
          } catch (pErr) {
            console.warn('Failed to sync push token in load', pErr);
          }
        }
      }
    } catch (e: any) {
      console.error('CustomerApp: session load failed:', e?.message || e, e?.stack);
      setError(String(e?.message || 'Customer app failed to load'));
    } finally {
      setLoading(false);
    }
  }, [sessionCreds.cardId, sessionCreds.token, initOneSignalSDK]);

  React.useEffect(() => {
    if (sessionCreds.cardId && sessionCreds.token) {
      void load();
      // Background sync on app open
      void syncOnAppOpen(sessionCreds.cardId, sessionCreds.token).then(session => {
        if (session) setData(session);
      });
      // Register background sync mechanisms
      void registerWebBackgroundSync({ cardId: sessionCreds.cardId, token: sessionCreds.token });
      void registerCapacitorBackgroundTask({ cardId: sessionCreds.cardId, token: sessionCreds.token });
      return;
    }
    void (async () => {
      try {
        setLoading(true);
        setError('');
        const bootstrap = await get_customer_app_bootstrap_live();
        setBootstrapData(bootstrap);
      } catch (e: any) {
        console.error('CustomerApp: bootstrap failed:', e?.message || e, e?.stack);
        setError(String(e?.message || 'Customer app onboarding failed to load'));
      } finally {
        setLoading(false);
      }
    })();
  }, [joinMode, load, sessionCreds.cardId, sessionCreds.token]);

  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!sessionCreds.cardId || !sessionCreds.token) return;

    const setupNativePush = async () => {
      try {
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive !== 'granted') {
          permStatus = await PushNotifications.requestPermissions();
        }
        if (permStatus.receive === 'granted') {
          await PushNotifications.register();
        }

        await PushNotifications.addListener('registration', async (token) => {
          const pushToken = token.value;
          if (pushToken) {
            writeCustomerPushToken(pushToken);
            try {
              await save_push_token_live(sessionCreds.cardId, pushToken, sessionCreds.token);
              console.log('Native Push token registered and synced with CRM:', pushToken);
            } catch (err) {
              console.warn('Failed to sync native push token:', err);
            }
          }
        });

        await PushNotifications.addListener('registrationError', (error) => {
          console.error('Push registration error:', error);
        });
      } catch (err) {
        console.warn('Native push registration setup failed:', err);
      }
    };

    void setupNativePush();

    return () => {
      try {
        void PushNotifications.removeAllListeners();
      } catch {}
    };
  }, [sessionCreds.cardId, sessionCreds.token]);

  React.useEffect(() => {
    if (activeTab !== 'order') return;
    let mounted = true;
    void (async () => {
      try {
        setMenuLoading(true);
        const menu = await get_public_menu_live();
        if (mounted) {
          const items = Array.isArray(menu) ? menu : [];
          setMenuItems(items);
          if (items.length > 0) {
            const cats = Array.from(new Set(items.map(it => it.category).filter(Boolean))) as string[];
            if (cats.length > 0 && !selectedCategory) {
              setSelectedCategory(cats[0]);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch public menu items:', err);
      } finally {
        if (mounted) setMenuLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [activeTab]);

  React.useEffect(() => {
    let cancelled = false;
    const payload = `IWPOS:CARD:${sessionCreds.cardId || ''}`;
    if (!payload) {
      setCardQr('');
      return;
    }
    void QRCode.toDataURL(payload, {
      width: 240,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setCardQr(url);
      })
      .catch(() => {
        if (!cancelled) setCardQr('');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionCreds.cardId]);

  React.useEffect(() => {
    setBaristaMessages([
      {
        role: 'assistant',
        text: tx(
          lang,
          'Salam, mən AI Barista. İçki zövqünə, bonusuna və mood-una görə sənə seçim tövsiyə edə bilərəm.',
          'Привет, я AI Barista. Подскажу напиток по твоему настроению и бонусам.',
          'Hi, I am AI Barista. I can recommend drinks based on your mood and rewards.',
        ),
      },
    ]);
  }, [lang]);


  React.useEffect(() => {
    const SpeechLib = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechLib) {
      const rec = new SpeechLib();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = safeLang === 'az' ? 'az-AZ' : safeLang === 'ru' ? 'ru-RU' : 'en-US';
      rec.onstart = () => setIsListening(true);
      rec.onend = () => setIsListening(false);
      rec.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        setBaristaInput(text);
      };
      recognitionRef.current = rec;
    }
  }, [safeLang]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      if (Capacitor.isNativePlatform()) {
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      }
      recognitionRef.current.start();
    }
  };

  const markRead = async (notificationId: string) => {
    try {
      await mark_customer_notification_read_live(notificationId, sessionCreds.cardId, sessionCreds.token);
      setData((prev: any) => ({
        ...prev,
        notifications: Array.isArray(prev?.notifications)
          ? prev.notifications.map((row: any) => (row.id === notificationId ? { ...row, is_read: true } : row))
          : [],
      }));
    } catch {}
  };

  const claimReward = async () => {
    try {
      setClaiming(true);
      await claim_customer_reward_live(sessionCreds.cardId, sessionCreds.token);
      await load();
      if (Capacitor.isNativePlatform()) {
        try {
          await Haptics.notification({ type: NotificationType.Success });
        } catch (hErr) {
          console.warn('Haptics failed', hErr);
        }
      }
    } catch (e: any) {
      setError(String(e?.message || 'Reward claim failed'));
    } finally {
      setClaiming(false);
    }
  };

  const handleRegistrationSubmit = async () => {
    if (registrationMode !== 'simple' && !customerName.trim()) {
      setError(tx(safeLang, 'Adınızı daxil edin', 'Введите ваше имя', 'Please enter your name'));
      return;
    }
    if (registrationMode === 'full' && !/.+@.+\..+/.test(email)) {
      setError(tx(safeLang, 'Düzgün email daxil edin', 'Введите корректный email', 'Please enter a valid email'));
      return;
    }
    try {
      setAcceptingConsent(true);
      setError('');
      const currentUrl = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const joinCustomerType = currentUrl?.searchParams.get('club') || bootstrapData?.join_customer_type || '';
      const joinDiscount = Number(currentUrl?.searchParams.get('discount') || bootstrapData?.join_discount_percent || 0);
      const created = await enroll_customer_app_live({ consent: true, club: joinCustomerType, discount: joinDiscount, registration_mode: registrationMode, name: customerName, email, birth_date: birthDate });
      const next = { cardId: created.card_id, token: created.token };
      setSessionCreds(next);
      if (typeof window !== 'undefined') {
        persistCustomerSession(created.card_id, created.token);
        scrubCustomerSessionFromUrl();

        if (Capacitor.isNativePlatform()) {
          const cachedPushToken = readCustomerPushToken();
          if (cachedPushToken) {
            try {
              await save_push_token_live(created.card_id, cachedPushToken, created.token);
            } catch (pErr) {
              console.warn('Failed to sync push token in enroll', pErr);
            }
          }
        }
      }
    } catch (e: any) {
      setError(String(e?.message || 'Customer enrollment failed'));
    } finally {
      setAcceptingConsent(false);
    }
  };

  const handleSendOtp = async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone || trimmedPhone.length < 7) {
      setOtpError(tx(safeLang, 'Düzgün telefon nömrəsi daxil edin', 'Введите корректный номер телефона', 'Please enter a valid phone number'));
      return;
    }
    try {
      setOtpSending(true);
      setOtpError('');
      await send_customer_otp_live(trimmedPhone);
      setOtpSent(true);
    } catch (e: any) {
      setOtpError(String(e?.message || 'OTP send failed'));
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    const trimmedCode = otpCode.trim();
    if (trimmedCode.length < 4) {
      setOtpError(tx(safeLang, 'Təsdiq kodu 4 rəqəmli olmalıdır', 'Код должен быть 4-значным', 'OTP must be 4 digits'));
      return;
    }
    try {
      setOtpVerifying(true);
      setOtpError('');
      const currentUrl = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const joinCustomerType = currentUrl?.searchParams.get('club') || bootstrapData?.join_customer_type || 'golden';
      const joinDiscount = Number(currentUrl?.searchParams.get('discount') || bootstrapData?.join_discount_percent || 0);
      
      const res = await verify_customer_otp_live(phone, trimmedCode, joinCustomerType, joinDiscount, customerName.trim(), birthDate);
      const next = { cardId: res.card_id, token: res.token };
      setSessionCreds(next);
      
      if (typeof window !== 'undefined') {
        persistCustomerSession(res.card_id, res.token);
        scrubCustomerSessionFromUrl();

        if (Capacitor.isNativePlatform()) {
          const cachedPushToken = readCustomerPushToken();
          if (cachedPushToken) {
            try {
              await save_push_token_live(res.card_id, cachedPushToken, res.token);
            } catch (pErr) {
              console.warn('Failed to sync push token in enroll', pErr);
            }
          }
        }
      }
    } catch (e: any) {
      setOtpError(String(e?.message || 'OTP verification failed'));
    } finally {
      setOtpVerifying(false);
    }
  };

  const handleSaveProfile = async (updates: { name?: string; birth_date?: string }) => {
    const { cardId, token } = sessionCreds;
    if (!cardId || !token) return;
    if (updates.name) await update_customer_name_live(cardId, token, updates.name);
    // birth_date boş ola bilər — backend onu silmə (None) kimi qəbul edir
    if (updates.birth_date !== undefined) await update_customer_birthday_live(cardId, token, updates.birth_date);
    await load();
  };

  const sendBaristaMessage = async () => {
    const prompt = baristaInput.trim();
    if (!prompt) return;

    setBaristaMessages((prev) => [...prev, { role: 'user', text: prompt }]);
    setBaristaInput('');

    setBaristaMessages((prev) => [...prev, { role: 'assistant', text: '...' }]);

    try {
      const history = baristaMessages
        .filter(m => m.text !== '...')
        .map(m => ({ role: m.role, content: m.text }));
      const apiMessages = [...history, { role: 'user', content: prompt }];

      const res = await chat_customer_barista_live(apiMessages, sessionCreds.cardId, sessionCreds.token, lang);
      
      if (voiceEnabled && window.speechSynthesis && res.message) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(res.message);
        utterance.lang = safeLang === 'az' ? 'az-AZ' : safeLang === 'ru' ? 'ru-RU' : 'en-US';
        window.speechSynthesis.speak(utterance);
      }

      setBaristaMessages((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].text === '...') {
          next[next.length - 1] = { role: 'assistant', text: res.message || 'Error occurred' };
        } else {
          next.push({ role: 'assistant', text: res.message || 'Error occurred' });
        }
        return next;
      });
    } catch (e: any) {
      setBaristaMessages((prev) => {
        const next = [...prev];
        if (next.length > 0 && next[next.length - 1].text === '...') {
          next[next.length - 1] = { role: 'assistant', text: tx(lang, 'Bağlantı xətası baş verdi.', 'Ошибка подключения.', 'Connection error occurred.') };
        }
        return next;
      });
    }
  };

  const analyzeImageUrl = async (src: string) => {
    setFortuneImage(src);
    setFortuneText('');
    setFortuneLoading(true);
    setFortuneProgress(0);
    setFortuneStepText(tx(safeLang, 'Qəhvə köpükləri təhlil edilir...', 'Анализ кофейной пенки...', 'Analyzing coffee bubbles...'));

    let apiResult: string | null = null;
    let apiError: string | null = null;

    // Start API request in background
    const apiPromise = analyze_customer_fortune_live(src, sessionCreds.cardId, sessionCreds.token, lang)
      .then(res => {
        apiResult = res.fortune || '';
      })
      .catch(e => {
        apiError = tx(safeLang, 'Şəkil analiz edilə bilmədi.', 'Не удалось проанализировать изображение.', 'Failed to analyze the image.');
      });

    let currentProgress = 0;
    const interval = setInterval(async () => {
      currentProgress += Math.floor(Math.random() * 5) + 3; // increment by 3-7%
      if (currentProgress >= 100) {
        currentProgress = 100;
        clearInterval(interval);
        
        // Wait for API to resolve
        await apiPromise;

        setFortuneProgress(100);
        setFortuneText(apiResult || apiError || 'Fortune not available');
        setFortuneLoading(false);
        playShimmerSound();

        // Haptic feedback when loading finishes
        if (Capacitor.isNativePlatform()) {
          try {
            await Haptics.notification({ type: NotificationType.Success });
          } catch {}
        }
      } else {
        setFortuneProgress(currentProgress);
        
        // Update step text based on progress
        if (currentProgress < 30) {
          setFortuneStepText(tx(safeLang, 'Qəhvə köpükləri təhlil edilir...', 'Анализ кофейной пенки...', 'Analyzing coffee bubbles...'));
        } else if (currentProgress < 65) {
          setFortuneStepText(tx(safeLang, 'Ulduz xəritəniz oxunur...', 'Чтение звездной карты...', 'Reading star map...'));
        } else if (currentProgress < 90) {
          setFortuneStepText(tx(safeLang, 'AI Falçı qeydlər yazır...', 'AI предсказатель делает записи...', 'AI fortune teller writing notes...'));
        } else {
          setFortuneStepText(tx(safeLang, 'Nəticə hazırlanır...', 'Подготовка результата...', 'Preparing results...'));
        }

        // Haptic tick for progress animation
        if (currentProgress % 15 === 0 && Capacitor.isNativePlatform()) {
          try {
            await Haptics.impact({ style: ImpactStyle.Light });
          } catch {}
        }
      }
    }, 150);
  };

  const analyzeImageFortune = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || '');
      analyzeImageUrl(src);
    };
    reader.readAsDataURL(file);
  };

  const takePhotoWithCamera = async () => {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        quality: 90,
      });
      if (photo.base64String) {
        const src = `data:image/jpeg;base64,${photo.base64String}`;
        analyzeImageUrl(src);
        if (Capacitor.isNativePlatform()) {
          try {
            await Haptics.notification({ type: NotificationType.Success });
          } catch (hErr) {
            console.warn('Haptics failed', hErr);
          }
        }
      }
    } catch (e: any) {
      console.warn('Camera photo failed or cancelled', e);
    }
  };

  React.useEffect(() => {
    if (!('geolocation' in navigator)) return;
    // P0.5 — filial koordinatı yoxdursa geofence söndürülür. Əvvəl burada
    // hardcoded bir kafənin koordinatı vardı və bütün tenant-lara aid idi.
    if (geofenceTargets.length === 0) return;

    const GEOFENCE_RADIUS_METERS = 100;

    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371e3;
      const phi1 = (lat1 * Math.PI) / 180;
      const phi2 = (lat2 * Math.PI) / 180;
      const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
      const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

      const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return R * c;
    };

    let lastNotifiedAt = 0;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        // Ən yaxın filialı seç — çox filiallı tenant-da hansına yaxın olduğunu
        // bildirişdə adla demək lazımdır.
        let nearest: { name: string; dist: number } | null = null;
        for (const target of geofenceTargets) {
          const dist = getDistance(position.coords.latitude, position.coords.longitude, target.lat, target.lng);
          if (!nearest || dist < nearest.dist) nearest = { name: target.name, dist };
        }
        if (!nearest) return;

        if (nearest.dist <= GEOFENCE_RADIUS_METERS) {
          const now = Date.now();
          if (now - lastNotifiedAt > 3600000) {
            lastNotifiedAt = now;

            // Ad şəkilçisi (-ə/-a) tenant adına görə dəyişir, ona görə başlıq
            // şəkilçisiz saxlanılır və ad mətnin içində verilir.
            const placeName = nearest.name || brandDisplayName;
            const title = tx(safeLang, 'Yaxınlıqdasan! ☕', 'Вы рядом! ☕', "You're nearby! ☕");
            const body = placeName
              ? tx(safeLang,
                  `${placeName} — içəri keç, ulduzlarını qəhvəyə çevir! 🌟`,
                  `${placeName} — заходите и обменяйте звёзды на кофе! 🌟`,
                  `${placeName} — come in and turn your stars into coffee! 🌟`)
              : tx(safeLang,
                  'İçəri keç, ulduzlarını qəhvəyə çevir! 🌟',
                  'Заходите и обменяйте звёзды на кофе! 🌟',
                  'Come in and turn your stars into coffee! 🌟');

            if ('Notification' in window) {
              const show = () => new Notification(title, { body, icon: brandLogoUrl || undefined });
              if (Notification.permission === 'granted') {
                show();
              } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then((permission) => {
                  if (permission === 'granted') show();
                });
              }
            }

            setGeofenceAlert(true);
          }
        }
      },
      (err) => {
        console.warn('Geolocation watching failed', err);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
    // `geofenceKey` koordinatları tam kodlayır; `geofenceTargets` referansı hər
    // render-də dəyişir, ona görə asılılıq açardır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofenceKey, brandDisplayName, brandLogoUrl, safeLang]);

  // Persist localFavorites to localStorage
  React.useEffect(() => {
    try {
      localStorage.setItem('ironwaves_customer_favorites', JSON.stringify(localFavorites));
    } catch { /* ignore */ }
  }, [localFavorites]);

  // Cleanup OneSignal SDK script on unmount
  React.useEffect(() => {
    return () => {
      if (onesignalScriptRef.current && document.getElementById('onesignal-sdk')) {
        const script = document.getElementById('onesignal-sdk');
        if (script && script.parentNode) {
          script.parentNode.removeChild(script);
        }
        onesignalScriptRef.current = null;
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="customer-app-wrapper flex min-h-dvh items-center justify-center" style={{ background: '#0b1220' }}>
        <div className="flex flex-col items-center gap-6">
          {/* Premium shimmer spinner */}
          <div className="relative h-16 w-16">
            <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-t-transparent opacity-30"
              style={{ borderColor: 'rgba(244,140,36,0.15)', borderTopColor: '#F48C24' }} />
            <div className="absolute inset-2 animate-spin rounded-full border-[2px] border-t-transparent opacity-50"
              style={{ borderColor: 'rgba(255,179,102,0.1)', borderTopColor: '#ffb366', animationDirection: 'reverse', animationDuration: '1.2s' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg animate-bounce-subtle">☕</span>
            </div>
          </div>
          {/* Shimmer text */}
          <div className="space-y-2 text-center">
            <div className="h-3 w-32 animate-shimmer rounded-full mx-auto" />
            <div className="h-2.5 w-24 animate-shimmer rounded-full mx-auto" style={{ animationDelay: '0.3s' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!sessionCreds.cardId || !sessionCreds.token) {
    const bootstrapBranding = bootstrapData?.branding || {};
    const joinPrimary = '#F48C24';
    const joinBg = '#0D0B0A';
    return (
      <div className="customer-app-wrapper customer-app-shell min-h-screen px-5 pt-[calc(env(safe-area-inset-top,47px)+12px)] pb-8 text-slate-100 flex flex-col justify-between relative overflow-hidden">
        {/* Dynamic Aurora & Real-world Noise Layers */}
        <div className="customer-app-aurora" />
        <div className="customer-app-noise" />

        {/* Top Header bar with Lang switch */}
        <div className="flex justify-between items-center relative z-10 w-full max-w-md mx-auto">
          <div className="flex items-center gap-2">
            {bootstrapBranding.logo_url ? (
              <img src={bootstrapBranding.logo_url} alt="brand" className="h-9 w-9 rounded-xl object-cover ring-1 ring-white/10" />
            ) : (
              <span className="text-xl">☕</span>
            )}
            <span className="text-sm font-bold tracking-wider text-white/90">
              {bootstrapBranding.app_name || 'iRonWaves'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 backdrop-blur-md">
            <Languages size={13} />
            {(['az', 'en', 'ru'] as const).map(l => (
              <button key={l} type="button" onClick={() => setLang(l)} 
                className={`px-1 transition-all ${safeLang === l ? 'text-[#F48C24] font-bold scale-105' : 'text-white/40 hover:text-white/70'}`}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Main Hero & Input container */}
        <div className="w-full max-w-md mx-auto my-auto space-y-6 relative z-10 pt-6 pb-10">
          {/* Welcome Slogan */}
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-white leading-tight">
              {tx(safeLang, 'Sizin üçün ən yaxşı qəhvə', 'Лучший кофе для вас', 'Find the best coffee for you')}
            </h1>
            <p className="text-xs text-white/60 leading-relaxed max-w-[300px]">
              {bootstrapBranding.hero_subtitle || tx(safeLang, 'Loyallıq klubuna qoşulun, növbə gözləmədən sifariş edin və qazanın.', 'Присоединяйтесь к клубу лояльности и заказывайте без очереди.', 'Join the loyalty club, order ahead, and earn rewards.')}
            </p>
          </div>

          {/* Input Glass Card */}
          <section className="rounded-[28px] cust-glass p-6 text-slate-100 space-y-5">
            <div className="text-base font-bold text-white">
              {tx(safeLang, 'Giriş və Qeydiyyat', 'Вход и Регистрация', 'Sign in & Sign up')}
            </div>

            <div className="space-y-4">
              {registrationMode === 'simple' && (
                <div className="text-sm text-white/70 mb-4">
                  {tx(safeLang, 'Sadəcə razılaşmanı təsdiq edib başlaya bilərsiniz.', 'Просто подтвердите согласие и начните.', 'Just confirm consent and start.')}
                </div>
              )}

              {registrationMode !== 'simple' && (
                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5">
                    {tx(safeLang, 'Adınız', 'Ваше имя', 'Your name')} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={60}
                    placeholder={tx(safeLang, 'Məs. Aysel', 'Напр. Айсель', 'e.g. Aysel')}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-[#F48C24]/30"
                  />
                </div>
              )}

              {registrationMode === 'full' && (
                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5">
                    {tx(safeLang, 'Email adresiniz', 'Ваш email', 'Your email')} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    placeholder="example@mail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-[#F48C24]/30"
                  />
                </div>
              )}

              {registrationMode !== 'simple' && (
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-white/40 mb-1.5">
                    {tx(safeLang, 'Doğum tarixi (istəyə bağlı — doğum günü bonusu üçün 🎂)', 'Дата рождения (необязательно — для бонуса ко дню рождения 🎂)', 'Birth date (optional — for a birthday bonus 🎂)')}
                  </label>
                  <input
                    type="date"
                    value={birthDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setBirthDate(e.target.value)}
                    style={{ colorScheme: 'dark' }}
                    className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-[#F48C24]/30"
                  />
                </div>
              )}

              <label className="flex items-start gap-2.5 cursor-pointer rounded-2xl bg-white/3 p-3 border border-white/5">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-[#F48C24] flex-shrink-0"
                />
                <span className="text-[10px] leading-relaxed text-white/55">
                  <span className="font-bold text-white block mb-0.5">
                    {tx(safeLang, 'Müştəri razılaşması:', 'Согласие клиента:', 'Customer consent:')}
                  </span>
                  {bootstrapData?.consent_text || tx(safeLang, 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.', 'Я согласен на участие в программе лояльности.', 'I agree to join the loyalty program.')}
                </span>
              </label>

              <button
                type="button"
                disabled={!consentChecked || acceptingConsent}
                onClick={handleRegistrationSubmit}
                className="w-full rounded-2xl py-3.5 text-xs font-black text-slate-950 disabled:opacity-60 transition active:scale-98 hover:brightness-110 shadow-lg shadow-orange-500/15 shimmer-btn"
                style={{ background: 'linear-gradient(135deg, #F48C24 0%, #ffb366 100%)' }}
              >
                {acceptingConsent ? '...' : registrationMode === 'simple' ? tx(safeLang, 'Başla', 'Начать', 'Start') : tx(safeLang, 'Qeydiyyatdan keç', 'Зарегистрироваться', 'Sign up')}
              </button>
            </div>

            {/* Legacy phone OTP flow — kept for backward compatibility */}
            {false && !otpSent ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5">
                    {tx(safeLang, 'Telefon nömrəniz', 'Номер телефона', 'Phone number')}
                  </label>
                  <input
                    type="tel"
                    placeholder="+994 50 123 45 67"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-[#F48C24]/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-white/60 mb-1.5">
                    {tx(safeLang, 'Adınız (istəyə bağlı)', 'Ваше имя (необязательно)', 'Your name (optional)')}
                  </label>
                  <input
                    type="text"
                    maxLength={60}
                    placeholder={tx(safeLang, 'Məs. Aysel', 'Напр. Айсель', 'e.g. Aysel')}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-[#F48C24]/30"
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-white/40 mb-1.5">
                    {tx(safeLang, 'Doğum tarixi (istəyə bağlı — doğum günü bonusu üçün 🎂)', 'Дата рождения (необязательно — для бонуса ко дню рождения 🎂)', 'Birth date (optional — for a birthday bonus 🎂)')}
                  </label>
                  <input
                    type="date"
                    value={birthDate}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setBirthDate(e.target.value)}
                    style={{ colorScheme: 'dark' }}
                    className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3.5 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-[#F48C24]/30"
                  />
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer rounded-2xl bg-white/3 p-3 border border-white/5">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded accent-[#F48C24] flex-shrink-0"
                  />
                  <span className="text-[10px] leading-relaxed text-white/55">
                    <span className="font-bold text-white block mb-0.5">
                      {tx(safeLang, 'Müştəri razılaşması:', 'Согласие клиента:', 'Customer consent:')}
                    </span>
                    {bootstrapData?.consent_text || tx(safeLang, 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.', 'Я согласен на участие в программе лояльности.', 'I agree to join the loyalty program.')}
                  </span>
                </label>

                <button
                  type="button"
                  disabled={!consentChecked || otpSending || otpVerifying}
                  onClick={handleSendOtp}
                  className="w-full rounded-2xl py-3.5 text-xs font-black text-slate-950 disabled:opacity-60 transition active:scale-98 hover:brightness-110 shadow-lg shadow-orange-500/15 shimmer-btn"
                  style={{ background: 'linear-gradient(135deg, #F48C24 0%, #ffb366 100%)' }}
                >
                  {otpSending ? '...' : tx(safeLang, 'Razıyam və kod göndər', 'Согласен и отправить код', 'Accept & Send Code')}
                </button>
              </div>
            ) : false && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[9px] font-black uppercase tracking-widest text-white/40 mb-1.5">
                    {tx(safeLang, 'Təsdiq kodu', 'Код подтверждения', 'Verification code')}
                  </label>
                  <input
                    type="number"
                    pattern="[0-9]*"
                    inputMode="numeric"
                    placeholder="1234"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    className="w-full rounded-2xl border border-white/8 bg-white/5 px-4 py-3.5 text-center text-lg font-black text-white placeholder-white/10 tracking-[0.4em] focus:outline-none focus:ring-1 focus:ring-[#F48C24]/30"
                  />
                </div>

                <button
                  type="button"
                  disabled={otpVerifying}
                  onClick={handleVerifyOtp}
                  className="w-full rounded-2xl py-3.5 text-xs font-black text-slate-950 disabled:opacity-60 transition active:scale-98 hover:brightness-110 shadow-lg shadow-orange-500/15 shimmer-btn"
                  style={{ background: 'linear-gradient(135deg, #F48C24 0%, #ffb366 100%)' }}
                >
                  {otpVerifying ? '...' : tx(safeLang, 'Təsdiq et & Giriş et', 'Подтвердить и войти', 'Verify & Sign in')}
                </button>

                <button
                  type="button"
                  onClick={() => setOtpSent(false)}
                  className="w-full text-center text-[10px] font-black text-white/45 hover:text-white/70 transition uppercase tracking-wider"
                >
                  {tx(safeLang, 'Nömrəni dəyiş', 'Изменить номер', 'Change number')}
                </button>
              </div>
            )}

            {otpError && (
              <p className="text-center text-[10px] font-bold text-red-300 bg-red-500/8 rounded-xl py-2 px-3 border border-red-500/20">
                {otpError}
              </p>
            )}
          </section>
        </div>

        {/* Footer info text */}
        <div className="text-center text-[9px] font-semibold text-white/20 mt-auto relative z-10 w-full max-w-md mx-auto">
          {bootstrapBranding.app_name || 'iRonWaves'} App v1.2.0 · {tx(safeLang, 'Bütün hüquqlar qorunur', 'Все права защищены', 'All rights reserved')}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6" style={{ background: '#0b1220' }}>
        <div className="w-full max-w-sm rounded-3xl border p-6 text-center" style={{ borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.06)' }}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(239,68,68,0.1)' }}>
            <span className="text-2xl">⚠️</span>
          </div>
          <h1 className="text-lg font-bold text-white">{tx(safeLang, 'Tətbiq açıla bilmədi', 'Приложение не открылось', 'App could not be opened')}</h1>
          <p className="mt-2 text-[13px] text-red-200/70">{error || 'Invalid customer link'}</p>

          <button
            type="button"
            onClick={() => {
              clearCustomerSession();
              setSessionCreds({ cardId: '', token: '' });
              setError('');
            }}
            className="mt-6 w-full rounded-2xl bg-white/10 py-3 text-sm font-semibold text-white transition hover:bg-white/15 active:scale-[0.98]"
          >
            {tx(safeLang, 'Sessiyanı Sıfırla & Geri Dön', 'Сбросить сессию и вернуться', 'Reset Session & Go Back')}
          </button>

          {CUSTOMER_DEBUG_TOOLS_ENABLED ? (
            <button
              type="button"
              onClick={() => setShowDevSettings(!showDevSettings)}
              className="mt-4 block w-full text-center text-xs text-white/40 underline hover:text-white/60"
            >
              {showDevSettings 
                ? tx(safeLang, 'Ayarları gizlə', 'Скрыть настройки', 'Hide settings')
                : tx(safeLang, 'İnkişaf etdirici ayarları', 'Настройки разработчика', 'Developer settings')}
            </button>
          ) : null}

          {CUSTOMER_DEBUG_TOOLS_ENABLED && showDevSettings && (
            <div className="mt-4 text-left border-t border-white/10 pt-4 space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1">
                  API Base URL
                </label>
                <input
                  type="text"
                  placeholder="https://api.example.com"
                  value={customApiUrl}
                  onChange={(e) => setCustomApiUrl(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/30"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-white/50 mb-1">
                  Tenant Domain
                </label>
                <input
                  type="text"
                  placeholder="super.ironwaves.store"
                  value={customTenantDomain}
                  onChange={(e) => setCustomTenantDomain(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/30"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (customApiUrl.trim()) {
                      localStorage.setItem('ironwaves_custom_api_base_url', customApiUrl.trim());
                    } else {
                      localStorage.removeItem('ironwaves_custom_api_base_url');
                    }
                    if (customTenantDomain.trim()) {
                      localStorage.setItem('mobile_tenant_domain', customTenantDomain.trim());
                    } else {
                      localStorage.removeItem('mobile_tenant_domain');
                    }
                    window.location.reload();
                  }}
                  className="flex-1 rounded-xl bg-white/20 py-2 text-xs font-bold text-white hover:bg-white/25 transition active:scale-[0.95]"
                >
                  {tx(safeLang, 'Yadda saxla', 'Сохранить', 'Save')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('ironwaves_custom_api_base_url');
                    localStorage.removeItem('mobile_tenant_domain');
                    window.location.reload();
                  }}
                  className="rounded-xl bg-red-500/20 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/25 transition active:scale-[0.95]"
                >
                  {tx(safeLang, 'Sıfırla', 'Сбросить', 'Reset')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }


  const aiFalciEnabled = branding.ai_falci_enabled === true;

  const bottomTabs: Array<{ key: CustomerTab; label: string; icon: React.ReactNode }> = [
    { key: 'home' as CustomerTab, label: tx(safeLang, 'Ana Səhifə', 'Главная', 'Home'), icon: <Home size={18} /> },
    { key: 'order' as CustomerTab, label: tx(safeLang, 'Menyu', 'Меню', 'Menu'), icon: <Coffee size={18} /> },
    { key: 'offers' as CustomerTab, label: tx(safeLang, 'Kampaniyalar', 'Кампании', 'Offers'), icon: <Gift size={18} /> },
    { key: 'feedback' as CustomerTab, label: tx(safeLang, 'Rəy', 'Отзыв', 'Feedback'), icon: <MessageSquare size={18} /> },
    // C2: collapse Barista + Falçı into one "AI" hub tab so the bar never
    // exceeds 5 tabs (Apple HIG). The hub switches between the two inside.
    ...(aiBaristaEnabled || aiFalciEnabled
      ? [{ key: 'ai' as CustomerTab, label: tx(safeLang, 'AI', 'AI', 'AI'), icon: <Sparkles size={18} /> }]
      : []),
    { key: 'profile', label: tx(safeLang, 'Profil', 'Профиль', 'Profile'), icon: <UserRound size={18} /> },
  ];

  const resolvedActiveTab: CustomerTab =
    (activeTab === 'barista' || activeTab === 'falci')
      ? (aiBaristaEnabled || aiFalciEnabled ? 'ai' : 'home')
      : activeTab;

  const switchTabWithTransition = (newTab: CustomerTab) => {
    if (newTab === resolvedActiveTab) return;

    const tabKeys = bottomTabs.map(t => t.key);
    const oldIdx = tabKeys.indexOf(resolvedActiveTab);
    const newIdx = tabKeys.indexOf(newTab);
    const direction = newIdx > oldIdx ? 'forward' : 'backward';

    if (!(document as any).startViewTransition) {
      setActiveTab(newTab);
      return;
    }

    try {
      (document as any).startViewTransition({
        update: () => {
          setActiveTab(newTab);
        },
        types: [direction]
      });
    } catch (e) {
      (document as any).startViewTransition(() => {
        setActiveTab(newTab);
      });
    }
  };

  return (
    <div
      className={`relative min-h-dvh overflow-x-hidden overflow-y-auto overscroll-contain customer-app-wrapper transition-colors duration-300 ${
        isLight ? 'text-slate-900 bg-[#F8F6F4]' : 'text-white bg-[#0D0B0A]'
      }`}
      style={
        // P0.3 — tenant fonu varsa onu istifadə et, yoxsa köhnə qradient qalır.
        tenantBgStyle || {
          background: isLight
            ? `linear-gradient(180deg, #FCF4EA 0%, #F2E4D2 100%)`
            : `linear-gradient(180deg, #2A1A10 0%, #160D07 100%)`,
        }
      }
    >
      {/* Dynamic Aurora and Real-world Noise Background Layers */}
      {!isLight && !hasTenantBg && (
        <>
          <div className="customer-app-aurora" />
          <div className="customer-app-noise" />
        </>
      )}
      {isLight && (
        <>
          <div className="absolute top-0 right-0 h-80 w-80 rounded-full bg-orange-200/25 blur-[130px] pointer-events-none z-0" />
          <div className="absolute top-1/3 left-0 h-64 w-64 rounded-full bg-emerald-100/25 blur-[100px] pointer-events-none z-0" />
        </>
      )}
      <style>{`
        @keyframes wave {
          0% { transform: translateX(0); }
          50% { transform: translateX(-25%); }
          100% { transform: translateX(-50%); }
        }
        .animate-wave {
          animation: wave 12s linear infinite;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out forwards;
        }
        .perspective-1000 {
          perspective: 1000px;
        }
        .backface-hidden {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .preserve-3d {
          transform-style: preserve-3d;
        }
        .rotate-y-180 {
          transform: rotateY(180deg);
        }

        /* Tab content transition */
        @keyframes tabEnter {
          0% {
            opacity: 0;
            transform: translateY(12px) scale(0.97);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .animate-tabEnter {
          animation: tabEnter 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        /* Bottom nav bounce */
        @keyframes navDotPulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.4;
          }
          50% {
            transform: scale(1.8);
            opacity: 0.15;
          }
        }
        .animate-navDotPulse {
          animation: navDotPulse 2.5s infinite ease-in-out;
        }
      `}</style>

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col px-3.5 sm:px-4 pb-36 pt-[max(env(safe-area-inset-top,0px)+16px,54px)]">
        {offlineMode && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2.5 backdrop-blur-md">
            <div className="flex items-center gap-2.5">
              <span className="text-base">📡</span>
              <div>
                <div className="text-[11px] font-extrabold text-amber-200">
                  {tx(safeLang, 'Offline rejim', 'Офлайн режим', 'Offline mode')}
                </div>
                <div className="text-[10px] font-medium text-amber-200/60">
                  {tx(safeLang, 'Son sinxronlaşdırılmış məlumatlar göstərilir', 'Показаны последние синхронизированные данные', 'Showing last synced data')}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="shrink-0 rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-200 transition active:scale-95"
            >
              {tx(safeLang, 'Yenidən cəhd', 'Повторить', 'Retry')}
            </button>
          </div>
        )}

        {/* Language switcher + Theme/Design toggle */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={isLight ? tx(safeLang, 'Tünd tema', 'Тёмная тема', 'Dark theme') : tx(safeLang, 'Açıq tema', 'Светлая тема', 'Light theme')}
              onClick={() => setThemeMode(isLight ? 'dark' : 'light')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold shadow-sm transition active:scale-95 ${
                isLight
                  ? 'bg-slate-100 border border-slate-200 text-slate-600'
                  : 'bg-white/10 border border-white/10 text-white/70'
              }`}
            >
              {isLight ? '🌙' : '☀️'}
            </button>
          </div>
          <div
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-extrabold shadow-sm ${
              isLight
                ? 'text-slate-600 bg-white border border-slate-200'
                : 'text-[#1A4329]/70 bg-white border border-[#1A4329]/10'
            }`}
          >
            <Languages size={13} />
            <button type="button" onClick={() => setLang('az')} className={`transition ${safeLang === 'az' ? 'font-black text-[#F48C24]' : ''}`}>AZ</button>
            <button type="button" onClick={() => setLang('en')} className={`transition ${safeLang === 'en' ? 'font-black text-[#F48C24]' : ''}`}>EN</button>
            <button type="button" onClick={() => setLang('ru')} className={`transition ${safeLang === 'ru' ? 'font-black text-[#F48C24]' : ''}`}>RU</button>
          </div>
        </div>

        {/* Tab content */}
        <div className="tab-content-wrapper flex-1 flex flex-col">
        {resolvedActiveTab === 'home' && (
          <div key="home" className="animate-tabEnter">
          <HomeTab
            safeLang={safeLang}
            customer={customer}
            customer_card_id={customer.card_id}
            branding={branding}
            wallet={wallet}
            primaryColor={primaryColor}
            accentColor={accentColor}
            programMode={programMode}
            cardQr={cardQr}
            showQrCard={showQrCard}
            showWallet={showWallet}
            balanceSuffix={balanceSuffix}
            heroImage={heroImage}
            cardFlipped={cardFlipped}
            setCardFlipped={setCardFlipped}
            claimReward={claimReward}
            claiming={claiming}
            rewards={rewards}
            progressPercent={progressPercent}
            notifications={notifications}
            favoriteItems={favoriteItems}
            pendingClaims={pendingClaims}
            claims={claims}
            geofenceAlert={geofenceAlert}
            setGeofenceAlert={setGeofenceAlert}
            recentItems={recentItems}
            onReorderItem={handleReorderItem}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            setActiveTab={switchTabWithTransition}
            openWalletPass={openWalletPass}
            get_customer_wallet_pass_url_fn={get_customer_wallet_pass_url}
            sessionCreds={sessionCreds}
            data={data}
            activeOrders={activeOrders}
            isLight={isLight}
            designMode={designMode}
          />
          </div>
        )}
        {resolvedActiveTab === 'order' && (
          <div key="order" className="animate-tabEnter">
          <OrderTab
            safeLang={safeLang}
            isLight={isLight}
            menuItems={menuItems}
            menuLoading={menuLoading}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            customerCart={customerCart}
            setShowCartSheet={setShowCartSheet}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            localFavorites={localFavorites}
            setLocalFavorites={setLocalFavorites}
            handleOpenModifiers={handleOpenModifiers}
            modifierSheetItem={modifierSheetItem}
            setModifierSheetItem={setModifierSheetItem}
            selectedVariant={selectedVariant}
            setSelectedVariant={setSelectedVariant}
            selectedModifiers={selectedModifiers}
            handleToggleModifier={handleToggleModifier}
            handleAddToCart={handleAddToCart}
            showCartSheet={showCartSheet}
            orderNotes={orderNotes}
            setOrderNotes={setOrderNotes}
            handleCheckoutPreOrder={handleCheckoutPreOrder}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            preOrderSubmitting={preOrderSubmitting}
            preOrderSuccess={preOrderSuccess}
            preOrderSuccessId={preOrderSuccessId}
            setPreOrderSuccess={setPreOrderSuccess}
            handleRemoveFromCart={handleRemoveFromCart}
            handleUpdateCartQty={handleUpdateCartQty}
            activeOrders={activeOrders}
            designMode={designMode}
            stores={stores}
            selectedStoreId={selectedStore?.id || ''}
            setSelectedStore={setSelectedStore}
            brandLogoUrl={brandLogoUrl}
            brandName={brandDisplayName}
          />
          </div>
        )}
        {resolvedActiveTab === 'offers' && (
          <div key="offers" className="animate-tabEnter">
          <OffersTab
            safeLang={safeLang}
            campaigns={campaigns}
            pendingClaims={pendingClaims}
            customer={customer}
            activatedCampaigns={activatedCampaigns}
            setActivatedCampaigns={setActivatedCampaigns}
            campaignQrs={campaignQrs}
            setCampaignQrs={setCampaignQrs}
            primaryColor={primaryColor}
            accentColor={accentColor}
            isLight={isLight}
            onActivateCampaign={handleActivateCampaign}
          />
          </div>
        )}
        {resolvedActiveTab === 'feedback' && (
          <div key="feedback" className="animate-tabEnter">
            <FeedbackTab
              safeLang={safeLang}
              customer={customer}
              sessionCreds={{ cardId: customer?.card_id || '', token: '' }}
              primaryColor={primaryColor}
              accentColor={accentColor}
              isLight={isLight}
            />
          </div>
        )}
        {resolvedActiveTab === 'ai' && (aiBaristaEnabled || aiFalciEnabled) && (
          <div key="ai" className="animate-tabEnter">
            {/* C2: AI hub sub-switcher — pick Barista or Fortune inside one tab */}
            <div className="px-4 pt-3 pb-1">
              <div className={`flex rounded-2xl p-1 ${isLight ? 'bg-black/[0.04]' : 'bg-white/[0.06]'}`}>
                {aiBaristaEnabled && (
                  <button onClick={() => setAiSubTab('barista')} aria-pressed={aiSubTab === 'barista'}
                    className={`flex-1 rounded-xl py-2.5 text-[12px] font-black transition ${aiSubTab === 'barista' ? 'bg-[#F48C24] text-white shadow-sm' : (isLight ? 'text-slate-600' : 'text-white/60')}`}>
                    {tx(safeLang, 'AI Barista', 'AI Бариста', 'AI Barista')}
                  </button>
                )}
                {aiFalciEnabled && (
                  <button onClick={() => setAiSubTab('falci')} aria-pressed={aiSubTab === 'falci'}
                    className={`flex-1 rounded-xl py-2.5 text-[12px] font-black transition ${aiSubTab === 'falci' ? 'bg-[#F48C24] text-white shadow-sm' : (isLight ? 'text-slate-600' : 'text-white/60')}`}>
                    {tx(safeLang, 'Falçı', 'Фалчы', 'Fortune')}
                  </button>
                )}
              </div>
            </div>
            {aiBaristaEnabled && (aiSubTab === 'barista' || !aiFalciEnabled) && (
              <BaristaTab
                safeLang={safeLang}
                baristaMessages={baristaMessages}
                baristaInput={baristaInput}
                setBaristaInput={setBaristaInput}
                voiceEnabled={voiceEnabled}
                setVoiceEnabled={setVoiceEnabled}
                isListening={isListening}
                toggleListening={toggleListening}
                sendBaristaMessage={sendBaristaMessage}
                primaryColor={primaryColor}
                accentColor={accentColor}
                isLight={isLight}
                designMode={designMode}
              />
            )}
            {aiFalciEnabled && (aiSubTab === 'falci' || !aiBaristaEnabled) && (
              <FalciTab
                safeLang={safeLang}
                fortuneText={fortuneText}
                fortuneImage={fortuneImage}
                fortuneLoading={fortuneLoading}
                fortuneProgress={fortuneProgress}
                fortuneStepText={fortuneStepText}
                fileRef={fileRef}
                analyzeImageFortune={analyzeImageFortune}
                takePhotoWithCamera={takePhotoWithCamera}
                primaryColor={primaryColor}
                accentColor={accentColor}
                isLight={isLight}
              />
            )}
          </div>
        )}
        {resolvedActiveTab === 'profile' && (
          <div key="profile" className="animate-tabEnter">
          <ProfileTab
            safeLang={safeLang}
            customer={customer}
            notifications={notifications}
            history={history}
            chartData={chartData}
            primaryColor={primaryColor}
            setLang={setLang}
            markRead={markRead}
            isLight={isLight}
            designMode={designMode}
            onSaveProfile={handleSaveProfile}
          />
          </div>
        )}
        </div>
      </div>

      {/* Bottom Navigation — compact glassmorphism capsule */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
      >
        <div className="mx-auto max-w-lg px-3.5 sm:px-4 pb-2.5">
          <div
            className={`flex items-center justify-around rounded-[28px] py-2 px-2 border ${
              isLight
                ? 'border-black/8 bg-white/90 text-slate-800 shadow-[0_12px_36px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-2xl'
                : 'glass-nav-capsule bg-white/5 text-white shadow-2xl'
            }`}
          >
            {bottomTabs.map((tab) => {
              const active = tab.key === resolvedActiveTab;
              const unreadCount = tab.key === 'profile' ? notifications.filter((n: any) => !n.is_read).length : 0;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={async () => {
                    switchTabWithTransition(tab.key);
                    if (Capacitor.isNativePlatform()) {
                      try {
                        await Haptics.impact({ style: ImpactStyle.Medium });
                      } catch (hErr) {
                        console.warn('Haptics failed', hErr);
                      }
                    }
                  }}
                  className={`relative flex items-center justify-center transition-all duration-200 active:scale-[0.96] ${
                    active
                      ? 'rounded-full bg-[#FF8B26] text-white px-4 py-2 shadow-[0_2px_12px_rgba(255,139,38,0.35)] gap-1.5'
                      : isLight
                        ? 'text-slate-400 hover:text-slate-700 p-2.5 rounded-full hover:bg-slate-100'
                        : 'text-white/40 hover:text-white/70 p-2.5 rounded-full hover:bg-white/5'
                  }`}
                >
                  {tab.icon}
                  {active && (
                    <span className="text-[11px] font-bold tracking-wide animate-fadeIn">
                      {tab.label}
                    </span>
                  )}
                  {unreadCount > 0 && (
                    <span className={`absolute ${active ? '-top-1 -right-1' : 'top-1.5 right-1.5'} flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white bg-red-500`}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Full-screen QR code modal */}
      {showFullQr && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4 animate-modalFadeIn"
          onClick={async () => {
            setShowFullQr(false);
            if (Capacitor.isNativePlatform()) {
              try {
                await Haptics.impact({ style: ImpactStyle.Light });
              } catch {}
            }
          }}
        >
          {/* Card container */}
          <div
            className={`w-full max-w-md rounded-t-[32px] border-t p-6 space-y-6 shadow-2xl animate-scaleIn backdrop-blur-2xl ${
              isLight
                ? 'bg-white/95 border-slate-200 text-slate-900'
                : 'bg-[#0D0B0A]/95 border-white/10 text-white'
            }`}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxHeight: '85vh',
            }}
          >
            {/* Modal Header/Handle */}
            <div className="flex flex-col items-center gap-2">
              <div className="h-1.5 w-12 rounded-full bg-white/10" />
              <h3 className="text-md font-black text-white mt-2">
                {tx(safeLang, 'Skan Et və Qazan', 'Сканируй и Получай', 'Scan & Earn')}
              </h3>
            </div>

            {/* QR Scanner Container */}
            <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-white border border-white/10 shadow-sm">
              {cardQr ? (
                <div className="p-1 bg-white rounded-xl">
                  <img src={cardQr} alt="qr" className="h-56 w-56 object-contain" />
                </div>
              ) : (
                <div className="h-56 w-56 flex items-center justify-center text-slate-800 font-mono text-sm">
                  {customer.card_id}
                </div>
              )}
              <div className="mt-4 text-center">
                <p className="text-slate-900 font-mono text-sm tracking-wider font-bold">
                  {formatCardId(customer.card_id)}
                </p>
                <p className="text-[#F48C24] text-[10px] mt-1 font-semibold uppercase tracking-wider">
                  {tx(safeLang, 'KASSAYA TƏQDİM EDİN', 'ПРЕДЪЯВИТЕ НА КАССЕ', 'PRESENT TO CASHIER')}
                </p>
              </div>
            </div>

            {/* Quick Tips */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 flex gap-3 items-center text-white">
              <span className="text-lg">💡</span>
              <p className="text-[11px] text-white/60 leading-relaxed font-semibold">
                {tx(
                  safeLang,
                  'Skaner oxuya bilsin deyə ekran parlaqlığını artırmağınız tövsiyə olunur.',
                  'Рекомендуется увеличить яркость экрана для облегчения сканирования.',
                  'We recommend increasing screen brightness to make scanning easier.'
                )}
              </p>
            </div>

            {/* Close Button */}
            <button
              onClick={async () => {
                setShowFullQr(false);
                if (Capacitor.isNativePlatform()) {
                  try {
                    await Haptics.impact({ style: ImpactStyle.Light });
                  } catch {}
                }
              }}
              className="w-full py-3.5 rounded-2xl bg-[#1A4329] text-white font-black text-[13px] active:scale-95 transition-transform shadow-md"
            >
              {tx(safeLang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
        </div>
      )}

      {/* C11: First-launch 3-slide onboarding */}
      {showOnboarding && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-5"
          style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          role="dialog" aria-modal="true" aria-label={tx(safeLang, 'Xoş gəlmisiniz', 'Добро пожаловать', 'Welcome')}
        >
          <div
            className={`relative w-full max-w-sm rounded-[32px] overflow-hidden border p-7 text-center space-y-6 ${
              isLight ? 'bg-white/95 border-black/6 text-slate-900 shadow-2xl' : 'bg-[#0D0B0A]/95 border-white/10 text-white shadow-2xl'
            }`}
            style={{ animation: 'scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}
          >
            <div className="absolute inset-x-0 top-0 h-16 pointer-events-none rounded-t-[32px]"
              style={{ background: isLight ? 'linear-gradient(180deg, rgba(255,255,255,0.5), transparent)' : 'linear-gradient(180deg, rgba(255,255,255,0.05), transparent)' }} />
            <button onClick={finishOnboarding}
              className={`absolute top-4 right-4 z-10 text-[11px] font-bold uppercase tracking-wider ${isLight ? 'text-slate-400' : 'text-white/40'}`}
              aria-label={tx(safeLang, 'Keç', 'Пропустить', 'Skip')}>
              {tx(safeLang, 'Keç', 'Пропустить', 'Skip')}
            </button>

            {/* P0.5 — əvvəl hardcoded `/logo.jpg` + alt="Emalathhana" idi. */}
            {brandLogoUrl ? (
              <img src={brandLogoUrl} alt={brandDisplayName || 'brand'} width={56} height={56}
                className="relative mx-auto mt-1 h-14 w-14 rounded-2xl object-cover border border-white/10 shadow-md" />
            ) : null}
            <div className="relative text-6xl mt-2">{ONBOARD_SLIDES[onboardStep].icon}</div>
            <div className="relative space-y-2">
              <h2 className="text-xl font-black leading-tight">{ONBOARD_SLIDES[onboardStep].title[safeLang as 'az' | 'ru' | 'en']}</h2>
              <p className={`text-xs leading-relaxed font-semibold ${isLight ? 'text-slate-500' : 'text-white/60'}`}>{ONBOARD_SLIDES[onboardStep].body[safeLang as 'az' | 'ru' | 'en']}</p>
            </div>

            <div className="relative flex items-center justify-center gap-2">
              {ONBOARD_SLIDES.map((_, i) => (
                <span key={i} className={`h-2 rounded-full transition-all duration-300 ${i === onboardStep ? 'w-6 bg-[#F48C24]' : (isLight ? 'w-2 bg-slate-300' : 'w-2 bg-white/20')}`} />
              ))}
            </div>

            <button onClick={() => (onboardStep < ONBOARD_SLIDES.length - 1 ? setOnboardStep(onboardStep + 1) : finishOnboarding())}
              className="relative w-full py-3.5 rounded-2xl text-[13px] font-black text-white active:scale-95 transition-transform shadow-md"
              style={{ background: 'linear-gradient(135deg, #F48C24, #ffb366)', boxShadow: '0 6px 20px rgba(244,140,36,0.40)' }}>
              {onboardStep < ONBOARD_SLIDES.length - 1
                ? tx(safeLang, 'Davam et', 'Далее', 'Next')
                : tx(safeLang, 'Başlayaq', 'Начать', 'Get Started')}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
