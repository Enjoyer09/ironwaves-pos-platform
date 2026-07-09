import React from 'react';
import { Gift, Home, Languages, MessageSquare, ShoppingBag, Sparkles, UserRound } from 'lucide-react';
import QRCode from 'qrcode';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { tx } from '../i18n';
import { useAppStore } from '../store';
import { claim_customer_reward_live, enroll_customer_app_live, get_customer_app_bootstrap_live, get_customer_app_session_live, mark_customer_notification_read_live, save_push_token_live, send_customer_otp_live, verify_customer_otp_live, analyze_customer_fortune_live, chat_customer_barista_live, get_customer_wallet_pass_url, create_customer_pre_order_live } from '../api/crm';
import { get_public_menu_live } from '../api/menu';
import { clearCustomerSession, readCustomerPushToken, readCustomerPushTokenAsync, writeCustomerPushToken, writeCustomerSession } from '../lib/customer_session';
import HomeTab from './customer/HomeTab';
import OrderTab from './customer/OrderTab';
import ProfileTab from './customer/ProfileTab';
import BaristaTab from './customer/BaristaTab';
import FalciTab from './customer/FalciTab';
import OffersTab from './customer/OffersTab';
import { formatCardId, playTickSound, playShimmerSound, CustomerTab } from '../lib/customer_utils';
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
  const [claiming, setClaiming] = React.useState(false);
  const [cardQr, setCardQr] = React.useState('');
  const [sessionCreds, setSessionCreds] = React.useState({ cardId, token });
  const [acceptingConsent, setAcceptingConsent] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<CustomerTab>('home');
  const [cardFlipped, setCardFlipped] = React.useState(false);
  const [menuItems, setMenuItems] = React.useState<any[]>([]);
  const [menuLoading, setMenuLoading] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState<string>('');
  const [customerCart, setCustomerCart] = React.useState<any[]>([]);
  const [modifierSheetItem, setModifierSheetItem] = React.useState<any | null>(null);
  const [selectedVariant, setSelectedVariant] = React.useState<any | null>(null);
  const [selectedModifiers, setSelectedModifiers] = React.useState<any[]>([]);
  const [preOrderSubmitting, setPreOrderSubmitting] = React.useState(false);
  const [preOrderSuccess, setPreOrderSuccess] = React.useState(false);
  const [preOrderSuccessId, setPreOrderSuccessId] = React.useState('');
  const [showCartSheet, setShowCartSheet] = React.useState(false);
  const [orderNotes, setOrderNotes] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [otpCode, setOtpCode] = React.useState('');
  const [otpSent, setOtpSent] = React.useState(false);
  const [otpSending, setOtpSending] = React.useState(false);
  const [otpVerifying, setOtpVerifying] = React.useState(false);
  const [otpError, setOtpError] = React.useState('');
  const [baristaMessages, setBaristaMessages] = React.useState<Array<{ role: 'assistant' | 'user'; text: string }>>([]);
  const [baristaInput, setBaristaInput] = React.useState('');
  const [fortuneText, setFortuneText] = React.useState('');
  const [fortuneImage, setFortuneImage] = React.useState('');
  const [fortuneLoading, setFortuneLoading] = React.useState(false);
  const [fortuneProgress, setFortuneProgress] = React.useState(0);
  const [fortuneStepText, setFortuneStepText] = React.useState('');
  const [showFullQr, setShowFullQr] = React.useState(false);
  const [activatedCampaigns, setActivatedCampaigns] = React.useState<Record<string, number>>({});
  const [campaignQrs, setCampaignQrs] = React.useState<Record<string, string>>({});
  const [tick, setTick] = React.useState(0);
  const [isListening, setIsListening] = React.useState(false);
  const [voiceEnabled, setVoiceEnabled] = React.useState(false);
  const recognitionRef = React.useRef<any>(null);
  const [particles, setParticles] = React.useState<Array<{ id: number; x: number; y: number; size: number; angle: number; speed: number; emoji?: string; color?: string }>>([]);
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
  const [simulatedTemp, setSimulatedTemp] = React.useState<number>(() => {
    const hr = new Date().getHours();
    return hr >= 10 && hr <= 17 ? 26 : 14;
  });
  const [simulatedCondition, setSimulatedCondition] = React.useState<'sunny' | 'rainy'>(() => {
    const hr = new Date().getHours();
    return hr >= 10 && hr <= 17 ? 'sunny' : 'rainy';
  });

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

  const handleCheckoutPreOrder = async () => {
    if (customerCart.length === 0) return;
    try {
      setPreOrderSubmitting(true);
      const res = await create_customer_pre_order_live({
        cardId: sessionCreds.cardId!,
        token: sessionCreds.token!,
        items: customerCart,
        notes: orderNotes,
        tenantId: data?.tenant_id
      });
      if (res.success) {
        setPreOrderSuccessId(res.orderId);
        setPreOrderSuccess(true);
        setCustomerCart([]);
        setOrderNotes('');
        setShowCartSheet(false);
        playShimmerSound();
      }
    } catch (err) {
      console.warn('Checkout failed:', err);
      setError(String(err instanceof Error ? err.message : 'Sifariş göndərilə bilmədi'));
    } finally {
      setPreOrderSubmitting(false);
    }
  };

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
    const counts: Record<string, { name: string; count: number; category: string }> = {};
    const historyList = Array.isArray(data?.history) ? data.history : [];
    
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
          counts[name] = { name, count: qty, category };
        }
      }
    }

    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [data?.history]);

  const branding = data?.branding || {};
  const wallet = data?.wallet || {};
  const notifications = Array.isArray(data?.notifications) ? data.notifications : [];
  const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
  const history = Array.isArray(data?.history) ? data.history : [];
  const customer = data?.customer || {};
  


  const spawnParticles = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Enhanced particles — more variety with stars and sparkles
    const emojis = ['✦', '✧', '★', '✨', '💫', '🔥', '☕', '🌟'];
    const newParticles = Array.from({ length: 14 }).map((_, i) => ({
      id: Math.random(),
      x,
      y,
      size: Math.random() * 10 + 6,
      angle: (i * 30 * Math.PI) / 180 + (Math.random() - 0.5) * 0.5,
      speed: Math.random() * 4 + 2.5,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      color: ['#F48C24', '#ffb366', '#ffd700', '#ff6b6b', '#48c6ef'][Math.floor(Math.random() * 5)],
    }));

    setParticles((prev) => [...prev, ...newParticles]);

    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.find((np) => np.id === p.id)));
    }, 1000);
  };




  const rewards = Array.isArray(wallet?.rewards) ? wallet.rewards : [];
  const pendingClaims = Array.isArray(data?.pending_claims) ? data.pending_claims : [];
  const progressPercent = wallet?.next_reward_at ? Math.min(100, Math.round((Number(wallet.progress_current || 0) / Number(wallet.next_reward_at || 1)) * 100)) : 0;
  const primaryColor = String(branding?.primary_color || '#F48C24');
  const accentColor = String(branding?.accent_color || '#1A4329');
  const programMode = String(wallet?.program_mode || 'points').toLowerCase();
  const showQrCard = branding?.show_qr_card !== false;
  const showWallet = branding?.show_wallet !== false;
  const balanceSuffix = programMode === 'cashback' ? ' ₼' : '';
  const heroImage = String(branding?.hero_image_url || '');
  const aiBaristaEnabled = branding?.ai_barista_enabled === true;

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
      
      if (session.onesignal_app_id) {
        initOneSignalSDK(session.onesignal_app_id, sessionCreds.cardId, sessionCreds.token);
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
    if (!joinMode) {
      setLoading(false);
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
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

  const acceptConsentAndCreateCard = async () => {
    try {
      setAcceptingConsent(true);
      const currentUrl = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const joinCustomerType = currentUrl?.searchParams.get('club') || bootstrapData?.join_customer_type || '';
      const joinDiscount = Number(currentUrl?.searchParams.get('discount') || bootstrapData?.join_discount_percent || 0);
      const created = await enroll_customer_app_live(true, undefined, joinCustomerType, joinDiscount);
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
      
      const res = await verify_customer_otp_live(phone, trimmedCode, joinCustomerType, joinDiscount);
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

    const CAFE_LAT = 40.37767;
    const CAFE_LNG = 49.84583;
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
        const dist = getDistance(
          position.coords.latitude,
          position.coords.longitude,
          CAFE_LAT,
          CAFE_LNG
        );

        if (dist <= GEOFENCE_RADIUS_METERS) {
          const now = Date.now();
          if (now - lastNotifiedAt > 3600000) {
            lastNotifiedAt = now;
            
            if ('Notification' in window) {
              if (Notification.permission === 'granted') {
                new Notification('iRonWaves-ə yaxınsan! ☕', {
                  body: 'İçəri keç, ulduzlarını qəhvəyə çevir! 🌟',
                  icon: branding.logo_url || '',
                });
              } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then((permission) => {
                  if (permission === 'granted') {
                    new Notification('iRonWaves-ə yaxınsan! ☕', {
                      body: 'İçəri keç, ulduzlarını qəhvəyə çevir! 🌟',
                      icon: branding.logo_url || '',
                    });
                  }
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
  }, [branding.logo_url]);

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
      <div className="flex min-h-dvh items-center justify-center" style={{ background: '#0b1220' }}>
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
    const joinPrimary = String(bootstrapBranding.primary_color || '#facc15');
    const joinAccent = String(bootstrapBranding.accent_color || '#22d3ee');
    const joinBg = String(bootstrapBranding.background_color || '#0b1220');
    return (
      <div className="min-h-screen px-4 py-8 text-slate-100" style={{ background: `linear-gradient(180deg, ${joinBg}, #020617)` }}>
        <div className="mx-auto max-w-md space-y-4">
          <section className="overflow-hidden rounded-[34px] border border-white/10 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]" style={{ background: `linear-gradient(180deg, ${joinAccent}, ${joinPrimary})` }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-white/70">{bootstrapBranding.app_name || 'Emalatkhana'}</div>
                <h1 className="mt-3 text-3xl font-black text-white">{bootstrapBranding.hero_title || tx(safeLang, 'Xoş gəldiniz', 'Добро пожаловать', 'Welcome')}</h1>
                <p className="mt-2 text-sm text-white/80">{bootstrapBranding.hero_subtitle || tx(safeLang, 'Loyalty klubuna bir toxunuşla qoşul', 'Присоединяйся к loyalty клубу одним касанием', 'Join the loyalty club in one tap')}</p>
              </div>
              <div className="flex flex-col items-end gap-3">
                <div className="flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs text-white backdrop-blur">
                  <Languages size={14} />
                  <button type="button" onClick={() => setLang('az')} className={safeLang === 'az' ? 'font-bold underline' : ''}>AZ</button>
                  <button type="button" onClick={() => setLang('en')} className={safeLang === 'en' ? 'font-bold underline' : ''}>EN</button>
                  <button type="button" onClick={() => setLang('ru')} className={safeLang === 'ru' ? 'font-bold underline' : ''}>RU</button>
                </div>
                {bootstrapBranding.logo_url ? <img src={bootstrapBranding.logo_url} alt="brand" className="h-12 w-12 rounded-2xl object-cover" /> : null}
              </div>
            </div>
          </section>
          <section className="rounded-[30px] border border-white/10 bg-slate-900/60 backdrop-blur-xl p-5 text-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            <div className="text-lg font-black text-white">{tx(safeLang, 'Giriş və Qeydiyyat', 'Вход и Регистрация', 'Sign in & Sign up')}</div>
            
            <div className="mt-3 rounded-2xl bg-white/5 p-4 text-xs leading-5 text-slate-300 border border-white/5">
              <span className="font-bold text-white block mb-1">{tx(safeLang, 'Müştəri razılaşması:', 'Согласие клиента:', 'Customer consent:')}</span>
              {bootstrapData?.consent_text || tx(safeLang, 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.', 'Я согласен на участие в программе лояльности.', 'I agree to join the loyalty program.')}
            </div>

            {!otpSent ? (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">{tx(safeLang, 'Telefon nömrəniz', 'Номер телефона', 'Phone number')}</label>
                <input
                  type="tel"
                  placeholder="+994 50 123 45 67"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
                />
                <button
                  type="button"
                  disabled={otpSending || otpVerifying}
                  onClick={handleSendOtp}
                  className="w-full rounded-2xl px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-60 transition active:scale-98 hover:brightness-110"
                  style={{ backgroundColor: joinPrimary }}
                >
                  {otpSending ? '...' : tx(safeLang, 'Razıyam və kod göndər', 'Согласен и отправить код', 'Accept and send code')}
                </button>

                {CUSTOMER_DEBUG_TOOLS_ENABLED ? (
                  <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-xs font-semibold text-white/50">
                    DEV mode: OTP test bypass removed from the customer-facing flow.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">{tx(safeLang, 'Təsdiq kodu', 'Код подтверждения', 'Verification code')}</label>
                <input
                  type="number"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  placeholder="1234"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-lg font-bold text-white placeholder-white/20 tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-white/20"
                />
                <button
                  type="button"
                  disabled={otpVerifying}
                  onClick={handleVerifyOtp}
                  className="w-full rounded-2xl px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-60 transition active:scale-98 hover:brightness-110"
                  style={{ backgroundColor: joinPrimary }}
                >
                  {otpVerifying ? '...' : tx(safeLang, 'Daxil ol / Təsdiq et', 'Войти / Подтвердить', 'Sign in / Verify')}
                </button>
                <button
                  type="button"
                  onClick={() => setOtpSent(false)}
                  className="w-full text-center text-xs font-semibold text-slate-400 hover:text-slate-200 underline mt-2"
                >
                  {tx(safeLang, 'Nömrəni dəyiş', 'Изменить номер', 'Change number')}
                </button>
              </div>
            )}

            {otpError && (
              <p className="mt-3 text-center text-xs font-medium text-red-200 bg-red-500/10 rounded-xl py-2 px-3 border border-red-500/20">
                {otpError}
              </p>
            )}
          </section>
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
    { key: 'order' as CustomerTab, label: tx(safeLang, 'Sifariş', 'Заказать', 'Order'), icon: <ShoppingBag size={18} /> },
    { key: 'offers' as CustomerTab, label: tx(safeLang, 'Kampaniyalar', 'Кампании', 'Offers'), icon: <Gift size={18} /> },
    ...(aiBaristaEnabled ? [{ key: 'barista' as CustomerTab, label: tx(safeLang, 'Barista', 'Бариста', 'Barista'), icon: <MessageSquare size={18} /> }] : []),
    ...(aiFalciEnabled ? [{ key: 'falci' as CustomerTab, label: tx(safeLang, 'Falçı', 'Фалчы', 'Fortune'), icon: <Sparkles size={18} /> }] : []),
    { key: 'profile', label: tx(safeLang, 'Profil', 'Профиль', 'Profile'), icon: <UserRound size={18} /> },
  ];

  const resolvedActiveTab: CustomerTab =
    (activeTab === 'barista' && !aiBaristaEnabled) || (activeTab === 'falci' && !aiFalciEnabled)
      ? 'home'
      : activeTab;

  return (
    <div
      className={`relative min-h-dvh overflow-x-hidden overflow-y-auto overscroll-contain ${isLight ? 'text-slate-900 bg-[#F8F6F4]' : 'text-white bg-[#0D0B0A]'}`}
      style={{
        background: isLight
          ? `linear-gradient(180deg, #FFFFFF 0%, #F3F1EF 100%)`
          : `linear-gradient(180deg, #181412 0%, #0D0B0A 100%)`,
      }}
    >
      {/* Background glowing light shapes for rich glassmorphism */}
      {!isLight && (
        <>
          <div className="absolute top-0 right-0 h-80 w-80 rounded-full bg-[#F48C24]/10 blur-[130px] pointer-events-none z-0" />
          <div className="absolute top-1/3 left-0 h-64 w-64 rounded-full bg-[#1A4329]/10 blur-[100px] pointer-events-none z-0" />
          <div className="absolute top-2/3 right-10 h-72 w-72 rounded-full bg-[#F48C24]/5 blur-[120px] pointer-events-none z-0" />
        </>
      )}
      {isLight && (
        <>
          <div className="absolute top-0 right-0 h-80 w-80 rounded-full bg-orange-200/30 blur-[130px] pointer-events-none z-0" />
          <div className="absolute top-1/3 left-0 h-64 w-64 rounded-full bg-emerald-100/30 blur-[100px] pointer-events-none z-0" />
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

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-28 pt-5">
        {/* Language switcher + Theme toggle */}
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setThemeMode(isLight ? 'dark' : 'light')}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold shadow-sm transition active:scale-95 ${
              isLight
                ? 'bg-slate-100 border border-slate-200 text-slate-600'
                : 'bg-white/10 border border-white/10 text-white/70'
            }`}
          >
            {isLight ? '🌙' : '☀️'}
          </button>
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
            spawnParticles={spawnParticles}
            claimReward={claimReward}
            claiming={claiming}
            rewards={rewards}
            progressPercent={progressPercent}
            notifications={notifications}
            favoriteItems={favoriteItems}
            pendingClaims={pendingClaims}
            geofenceAlert={geofenceAlert}
            setGeofenceAlert={setGeofenceAlert}
            simulatedTemp={simulatedTemp}
            simulatedCondition={simulatedCondition}
            setSimulatedTemp={setSimulatedTemp}
            setSimulatedCondition={setSimulatedCondition}
            setActiveTab={setActiveTab}
            tick={tick}
            openWalletPass={openWalletPass}
            get_customer_wallet_pass_url_fn={get_customer_wallet_pass_url}
            sessionCreds={sessionCreds}
            data={data}
          />
          </div>
        )}
        {resolvedActiveTab === 'order' && (
          <div key="order" className="animate-tabEnter">
          <OrderTab
            safeLang={safeLang}
            menuItems={menuItems}
            menuLoading={menuLoading}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            customerCart={customerCart}
            setShowCartSheet={setShowCartSheet}
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
            preOrderSubmitting={preOrderSubmitting}
            preOrderSuccess={preOrderSuccess}
            preOrderSuccessId={preOrderSuccessId}
            setPreOrderSuccess={setPreOrderSuccess}
            handleRemoveFromCart={handleRemoveFromCart}
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
          />
          </div>
        )}
        {resolvedActiveTab === 'barista' && aiBaristaEnabled && (
          <div key="barista" className="animate-tabEnter">
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
          />
          </div>
        )}
        {resolvedActiveTab === 'falci' && aiFalciEnabled && (
          <div key="falci" className="animate-tabEnter">
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
          />
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
          />
          </div>
        )}
      </div>

      {/* Bottom Navigation — compact glassmorphism capsule */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
      >
        <div className="mx-auto max-w-md px-4 pb-3">
          <div
            className={`flex items-center justify-around rounded-[32px] py-2 border shadow-2xl backdrop-blur-2xl ${
              isLight
                ? 'border-slate-200 bg-white/80 text-slate-800'
                : 'border-white/10 bg-white/5 text-white'
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
                    setActiveTab(tab.key);
                    if (Capacitor.isNativePlatform()) {
                      try {
                        await Haptics.impact({ style: ImpactStyle.Light });
                      } catch (hErr) {
                        console.warn('Haptics failed', hErr);
                      }
                    }
                  }}
                  className={`relative flex items-center justify-center transition-all duration-300 ${
                    active
                      ? 'rounded-full bg-[#F48C24] text-white px-4 py-2 shadow-[0_4px_12px_rgba(244,140,36,0.25)] gap-1.5'
                      : isLight
                        ? 'text-slate-400 hover:text-slate-700 p-2.5 rounded-full hover:bg-slate-100'
                        : 'text-white/40 hover:text-white/70 p-2.5 rounded-full hover:bg-white/5'
                  }`}
                >
                  {tab.icon}
                  {active && (
                    <span className="text-[10px] font-black uppercase tracking-wider animate-fadeIn">
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

    </div>
  );
}
