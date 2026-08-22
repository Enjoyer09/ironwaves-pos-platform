import React, { useEffect, useMemo, useRef, useState } from 'react';
import { get_public_menu_live } from '../api/menu';
import { get_public_qr_menu_bootstrap_live, get_settings, send_public_table_service } from '../api/settings';
import { extractMenuTenantSlug } from '../lib/navigation';
import {
  Search,
  X,
  MapPin,
  Phone,
  Instagram,
  Wifi,
  BellRing,
  Receipt,
  Check,
  Copy,
  ChevronRight,
  UtensilsCrossed,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────
interface MenuItem {
  id: string;
  item_name: string;
  category: string;
  price: number | string;
  description?: string;
  image_url?: string;
  is_coffee?: boolean;
  sort_order?: number;
  badge?: string;
  calories?: string | number;
  weight?: string;
  allergens?: string[];
}

interface Branding {
  company_name?: string;
  logo_url?: string;
  hero_title?: string;
  hero_subtitle?: string;
  background_color?: string;
  surface_color?: string;
  text_color?: string;
  primary_color?: string;
  accent_color?: string;
  hero_image_url?: string;
  font_family?: string;
  custom_font_url?: string;
  theme_preset?: string;
  layout_preset?: string;
  phone?: string;
  address?: string;
  instagram?: string;
  wifi_ssid?: string;
  wifi_password?: string;
  working_hours?: string;
}

// ─── Category Icon Resolver ──────────────────────────────────────────────────
function getCategoryIcon(catName: string) {
  const norm = catName.toLowerCase();
  if (norm.includes('isti') || norm.includes('ət') || norm.includes('qril') || norm.includes('kabab') || norm.includes('hot') || norm.includes('meat')) return '🥩';
  if (norm.includes('qəlyanaltı') || norm.includes('snack') || norm.includes('starter') || norm.includes('məzə')) return '🥗';
  if (norm.includes('şorba') || norm.includes('soup')) return '🍲';
  if (norm.includes('salat') || norm.includes('salad')) return '🥗';
  if (norm.includes('burger') || norm.includes('fast') || norm.includes('pizza') || norm.includes('sendviç')) return '🍔';
  if (norm.includes('çay') || norm.includes('tea') || norm.includes('qəhvə') || norm.includes('coffee') || norm.includes('kofe')) return '☕';
  if (norm.includes('içki') || norm.includes('drink') || norm.includes('kokteyl') || norm.includes('şirə') || norm.includes('beverage')) return '🥤';
  if (norm.includes('şirniyyat') || norm.includes('desert') || norm.includes('dessert') || norm.includes('tort') || norm.includes('cake')) return '🍰';
  if (norm.includes('qarnir') || norm.includes('side') || norm.includes('fri')) return '🍟';
  if (norm.includes('səhər') || norm.includes('breakfast')) return '🍳';
  if (norm.includes('şef') || norm.includes('special') || norm.includes('populyar')) return '🔥';
  return '🍽️';
}

function resolveImageUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  try {
    const env = ((import.meta as any)?.env || {}) as Record<string, string | undefined>;
    const base = String(env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
    if (base) return `${base}${url}`;
  } catch { /* ignore */ }
  return url;
}

const TX = {
  searchPlaceholder: { az: 'Menyuda yemək və ya içki axtar...', ru: 'Поиск блюд и напитков в меню...', en: 'Search dishes or drinks in menu...' },
  all: { az: 'Hamısı', ru: 'Все', en: 'All' },
  callWaiter: { az: 'Ofisiantı Çağır', ru: 'Позвать официанта', en: 'Call Waiter' },
  requestBill: { az: 'Hesabı İstə', ru: 'Попросить счет', en: 'Request Bill' },
  waiterCalledMsg: { az: 'Ofisianta məlumat verildi. Zəhmət olmasa gözləyin.', ru: 'Официант вызван. Пожалуйста, подождите.', en: 'Waiter has been notified. Please wait.' },
  billRequestedMsg: { az: 'Hesab tələbi kassaya göndərildi.', ru: 'Запрос счета отправлен.', en: 'Bill request sent.' },
  tableLabel: { az: 'Masa', ru: 'Стол', en: 'Table' },
  wifiInfo: { az: 'Wi-Fi Məlumatı', ru: 'Информация о Wi-Fi', en: 'Wi-Fi Information' },
  wifiNetwork: { az: 'Şəbəkə adı:', ru: 'Имя сети:', en: 'Network Name:' },
  wifiPass: { az: 'Şifrə:', ru: 'Пароль:', en: 'Password:' },
  copied: { az: 'Kopyalandı!', ru: 'Скопировано!', en: 'Copied!' },
  copy: { az: 'Kopyala', ru: 'Копировать', en: 'Copy' },
  close: { az: 'Bağla', ru: 'Закрыть', en: 'Close' },
  ingredients: { az: 'Tərkibi və Təsviri', ru: 'Состав и описание', en: 'Ingredients & Description' },
  choosePayment: { az: 'Ödəniş üsulunu seçin:', ru: 'Выберите способ оплаты:', en: 'Choose payment method:' },
  cash: { az: 'Nağd Ödəniş', ru: 'Наличные', en: 'Cash Payment' },
  card: { az: 'Bank Kartı', ru: 'Банковская Карта', en: 'Bank Card' },
  send: { az: 'Göndər', ru: 'Отправить', en: 'Send' },
  noResults: { az: 'Axtarışa uyğun heç bir məhsul tapılmadı.', ru: 'Ничего не найдено.', en: 'No items found.' },
};

export default function PublicMenu() {
  const [loading, setLoading] = useState(true);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [bootstrap, setBootstrap] = useState<any | null>(null);

  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  const [wifiModalOpen, setWifiModalOpen] = useState(false);
  const [billModalOpen, setBillModalOpen] = useState(false);
  const [billPaymentMethod, setBillPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copiedWifi, setCopiedWifi] = useState(false);
  const [waiterCooldown, setWaiterCooldown] = useState(0);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showSplash, setShowSplash] = useState(true);
  const [menuTheme, setMenuTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('qr_menu_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return 'dark';
  });
  const isMenuLight = menuTheme === 'light';

  // Scroll progress tracking
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(docHeight > 0 ? Math.min(1, scrollTop / docHeight) : 0);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Persist menu theme
  useEffect(() => {
    try { localStorage.setItem('qr_menu_theme', menuTheme); } catch {}
  }, [menuTheme]);

  // Enable native body & HTML scrolling on Desktop and Mobile
  useEffect(() => {
    document.documentElement.classList.add('public-menu-mode');
    document.body.classList.add('public-menu-mode');
    const rootEl = document.getElementById('root');
    if (rootEl) rootEl.classList.add('public-menu-mode');

    return () => {
      document.documentElement.classList.remove('public-menu-mode');
      document.body.classList.remove('public-menu-mode');
      if (rootEl) rootEl.classList.remove('public-menu-mode');
    };
  }, []);

  // Language state
  const [lang, setLang] = useState<'az' | 'ru' | 'en'>(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const initialLang = (searchParams.get('lang') || localStorage.getItem('qr_lang') || 'az').toLowerCase();
      return ['az', 'ru', 'en'].includes(initialLang) ? (initialLang as any) : 'az';
    } catch {
      return 'az';
    }
  });

  const changeLang = (l: 'az' | 'ru' | 'en') => {
    setLang(l);
    try { localStorage.setItem('qr_lang', l); } catch { /* ignore */ }
  };

  // Extract tenant and table from URL
  const { tenantSlug, tableNum } = useMemo(() => {
    if (typeof window === 'undefined') return { tenantSlug: null, tableNum: null };
    const pathname = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);

    const fromPath = extractMenuTenantSlug(pathname);
    const fromParam = searchParams.get('tenant') || searchParams.get('slug');

    let fromHost: string | null = null;
    const host = window.location.host.toLowerCase();
    if (host.includes('.ironwaves.store') && !host.startsWith('menu.') && !host.startsWith('api.')) {
      fromHost = host.split('.')[0];
    }

    const tSlug = fromPath || fromParam || fromHost || null;
    const tTable = searchParams.get('table') || searchParams.get('masa') || searchParams.get('t') || null;

    return { tenantSlug: tSlug, tableNum: tTable };
  }, []);

  // Fetch menu and branding
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [menu, brand] = await Promise.all([
          get_public_menu_live(tenantSlug || undefined),
          get_public_qr_menu_bootstrap_live(tenantSlug || undefined).catch(() => null),
        ]);
        if (!mounted) return;
        setMenuItems(Array.isArray(menu) ? menu : []);
        setBootstrap(brand);
      } catch {
        if (!mounted) return;
        setMenuItems([]);
        setBootstrap(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [tenantSlug]);

  // Splash screen timer — dismiss after duration (mobile only)
  useEffect(() => {
    if (loading || !showSplash) return;
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const brnd = bootstrap?.branding || {};
    const localQr = (() => { try { return (get_settings() as any)?.qr_menu_settings || {}; } catch { return {}; } })();
    const sUrl = String(brnd.splash_url || localQr.splash_url || '').trim();

    // Desktop or no splash URL → dismiss immediately
    if (!isMobile || !sUrl) {
      setShowSplash(false);
      return;
    }

    const duration = Number(brnd.splash_duration_ms || localQr.splash_duration_ms || 3000);
    const timer = setTimeout(() => setShowSplash(false), duration);
    return () => clearTimeout(timer);
  }, [loading, showSplash, bootstrap]);

  // Cooldown countdown timer
  useEffect(() => {
    if (waiterCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setWaiterCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [waiterCooldown]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Table Service: Call Waiter
  const handleCallWaiter = async () => {
    if (waiterCooldown > 0) return;
    try {
      await send_public_table_service(
        {
          action: 'call_waiter',
          table_label: tableNum ? `${TX.tableLabel[lang]} ${tableNum}` : 'Masa (QR)',
        },
        tenantSlug || undefined
      );
      setWaiterCooldown(60);
      showToast(TX.waiterCalledMsg[lang]);
    } catch {
      showToast(TX.waiterCalledMsg[lang]);
      setWaiterCooldown(60);
    }
  };

  // Table Service: Request Bill
  const handleRequestBill = async () => {
    try {
      await send_public_table_service(
        {
          action: 'request_bill',
          table_label: tableNum ? `${TX.tableLabel[lang]} ${tableNum}` : 'Masa (QR)',
          payment_method: billPaymentMethod,
        },
        tenantSlug || undefined
      );
      setBillModalOpen(false);
      showToast(TX.billRequestedMsg[lang]);
    } catch {
      setBillModalOpen(false);
      showToast(TX.billRequestedMsg[lang]);
    }
  };

  // Branding properties
  const branding: Branding = bootstrap?.branding || {};
  const companyName = branding.company_name || 'Restoran Menyu';
  const logoUrl = resolveImageUrl(branding.logo_url);
  const heroImageUrl = resolveImageUrl(branding.hero_image_url);
  const phone = branding.phone || '';
  const address = branding.address || '';
  const instagram = branding.instagram || '';
  const wifiSsid = branding.wifi_ssid || '';
  const wifiPassword = branding.wifi_password || '';

  // Dynamic theming from tenant settings
  const bgColor = branding.background_color || '#07090e';
  const surfaceColor = branding.surface_color || '#0d1322';
  const textColor = branding.text_color || '#ffffff';
  const primaryColor = branding.primary_color || '#d4af37';
  const accentColor = branding.accent_color || '#d4af37';
  const fontFamily = branding.font_family || '';
  const customFontUrl = branding.custom_font_url || '';
  const showPrices = bootstrap?.show_prices !== false;
  const showImages = bootstrap?.show_images !== false;
  const showDescriptions = bootstrap?.show_descriptions !== false;

  // Categories calculation
  const categories = useMemo(() => {
    const unique = Array.from(
      new Set(menuItems.map((item) => String(item.category || '').trim()).filter(Boolean))
    );
    return unique;
  }, [menuItems]);

  // Filtered menu items
  const filteredItems = useMemo(() => {
    let list = menuItems;
    if (activeCategory !== 'ALL') {
      list = list.filter((item) => String(item.category || '').trim() === activeCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((item) => {
        const text = `${item.item_name} ${item.category} ${item.description || ''}`.toLowerCase();
        return text.includes(q);
      });
    }
    return list;
  }, [menuItems, activeCategory, search]);

  const copyWifiPassword = () => {
    if (!wifiPassword) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(wifiPassword);
      setCopiedWifi(true);
      setTimeout(() => setCopiedWifi(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-[#07090e] pb-32">
        <style>{`
          @keyframes shimmerMove {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }
          .skeleton-shimmer {
            background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
            background-size: 200% 100%;
            animation: shimmerMove 1.5s ease-in-out infinite;
          }
        `}</style>
        {/* Skeleton hero */}
        <div className="h-52 sm:h-64 w-full skeleton-shimmer rounded-b-3xl" />
        {/* Skeleton story row */}
        <div className="flex gap-4 px-6 mt-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="shrink-0 space-y-2">
              <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-[22px] skeleton-shimmer" />
              <div className="h-3 w-16 rounded-full skeleton-shimmer mx-auto" />
            </div>
          ))}
        </div>
        {/* Skeleton search */}
        <div className="mx-6 mt-6 h-12 rounded-2xl skeleton-shimmer" />
        {/* Skeleton cards */}
        <div className="mx-6 mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex gap-4 rounded-3xl border border-white/[0.05] p-4">
              <div className="h-32 w-32 shrink-0 rounded-2xl skeleton-shimmer" />
              <div className="flex-1 space-y-3 py-2">
                <div className="h-5 w-3/4 rounded-lg skeleton-shimmer" />
                <div className="h-3 w-full rounded-lg skeleton-shimmer" />
                <div className="h-3 w-2/3 rounded-lg skeleton-shimmer" />
                <div className="h-7 w-20 rounded-xl skeleton-shimmer mt-4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Splash Screen (mobile only) ──────────────────────────────────────────
  const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 768;
  const splashBranding = bootstrap?.branding || {};
  const localSplashSettings = (() => { try { return (get_settings() as any)?.qr_menu_settings || {}; } catch { return {}; } })();
  // Resolve splash URL from any available source
  const splashUrl = String(splashBranding.splash_url || localSplashSettings.splash_url || 'https://res.cloudinary.com/dtjh5e3nm/video/upload/v1787398802/WhatsApp_Video_2026-08-22_at_2.22.01_PM.mp4').trim();
  // Auto-detect type from URL extension if splash_type not set
  const splashTypeRaw = String(splashBranding.splash_type || localSplashSettings.splash_type || '').trim();
  const splashType = splashTypeRaw && splashTypeRaw !== 'none'
    ? splashTypeRaw
    : splashUrl.match(/\.(mp4|mov|webm)(\?|$)/i) ? 'video'
    : splashUrl.match(/\.gif(\?|$)/i) ? 'gif'
    : splashUrl ? 'image'
    : 'none';
  const splashEnabled = isMobileDevice && showSplash && splashType !== 'none' && splashUrl.length > 0;

  // Debug: log splash state (remove after confirming it works)
  if (typeof window !== 'undefined' && !loading) {
    (window as any).__splashDebug = { isMobileDevice, showSplash, splashType, splashTypeRaw, splashUrl: splashUrl.slice(0, 60), splashEnabled, brandingSplashUrl: splashBranding.splash_url, localSplashUrl: localSplashSettings.splash_url, bootstrapKeys: Object.keys(splashBranding) };
  }

  if (splashEnabled) {
    const splashText = String(splashBranding.splash_overlay_text || localSplashSettings.splash_overlay_text || '').trim();
    const splashBg = String(splashBranding.splash_bg_color || localSplashSettings.splash_bg_color || '#000000').trim();
    const splashLogo = resolveImageUrl(splashBranding.logo_url || bootstrap?.branding?.logo_url);
    const splashCompany = String(splashBranding.company_name || bootstrap?.branding?.company_name || '').trim();
    const splashDuration = Number(splashBranding.splash_duration_ms || localSplashSettings.splash_duration_ms || 3000);

    return (
      <div
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden"
        style={{ backgroundColor: splashBg }}
        onClick={() => setShowSplash(false)}
      >
        <style>{`
          @keyframes splashFadeIn { from { opacity: 0; transform: scale(1.05); } to { opacity: 1; transform: scale(1); } }
          @keyframes splashTextIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes splashProgress { from { width: 0%; } to { width: 100%; } }
        `}</style>

        {/* Media */}
        {splashType === 'video' ? (
          <video
            src={splashUrl}
            autoPlay
            muted
            playsInline
            loop
            className="absolute inset-0 h-full w-full object-cover"
            style={{ animation: 'splashFadeIn 0.8s ease-out forwards' }}
          />
        ) : (
          <img
            src={splashUrl}
            alt="splash"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ animation: 'splashFadeIn 0.8s ease-out forwards' }}
          />
        )}

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-black/40" />

        {/* Content overlay */}
        <div className="relative z-10 flex flex-col items-center gap-4 text-center px-6" style={{ animation: 'splashTextIn 0.6s 0.3s cubic-bezier(0.16, 1, 0.3, 1) both' }}>
          {splashLogo && (
            <img src={splashLogo} alt="logo" className="h-20 w-20 rounded-2xl object-cover shadow-2xl border-2 border-white/20" />
          )}
          {splashCompany && (
            <h1 className="text-3xl sm:text-4xl font-black text-white drop-shadow-lg">{splashCompany}</h1>
          )}
          {splashText && (
            <p className="text-base sm:text-lg text-white/80 font-medium max-w-sm">{splashText}</p>
          )}
        </div>

        {/* Progress bar */}
        <div className="absolute bottom-8 left-8 right-8 h-1 rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full bg-white/80 rounded-full"
            style={{ animation: `splashProgress ${splashDuration}ms linear forwards` }}
          />
        </div>

        {/* Skip hint */}
        <div className="absolute bottom-14 left-0 right-0 text-center">
          <span className="text-xs text-white/40 font-medium">tap to skip</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen w-full antialiased selection:bg-[#d4af37]/30 selection:text-[#d4af37] pb-32 transition-colors duration-500 ${
      isMenuLight ? 'bg-[#F8F6F3] text-slate-900' : 'bg-[#07090e] text-slate-100'
    }`}
      style={{
        ...(fontFamily ? { fontFamily } : {}),
        ...(isMenuLight ? {} : { backgroundColor: bgColor, color: textColor }),
        ['--menu-primary' as string]: primaryColor,
        ['--menu-accent' as string]: accentColor,
        ['--menu-surface' as string]: surfaceColor,
      }}
    >
      {/* Custom font import */}
      {customFontUrl && <link rel="stylesheet" href={customFontUrl} />}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes heroZoom {
          from { transform: scale(1.05); }
          to { transform: scale(1.15); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(212,175,55,0.15); }
          50% { box-shadow: 0 0 40px rgba(212,175,55,0.3); }
        }
        @keyframes sheetSlideUp {
          from { opacity: 0; transform: translateY(100%); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes priceBounce {
          0% { transform: scale(1); }
          40% { transform: scale(1.15); }
          70% { transform: scale(0.95); }
          100% { transform: scale(1); }
        }
        .menu-primary-bg { background: var(--menu-primary); }
        .menu-primary-text { color: var(--menu-primary); }
        .menu-primary-border { border-color: var(--menu-primary); }
        .menu-primary-gradient { background: linear-gradient(135deg, var(--menu-primary), var(--menu-accent)); }
        .animate-float { animation: float 6s ease-in-out infinite; }
        .animate-glow-pulse { animation: glowPulse 3s ease-in-out infinite; }
      `}</style>
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-6 left-1/2 z-50 -translate-x-1/2 transform animate-fade-in w-[90%] max-w-md">
          <div className="flex items-center gap-3 rounded-2xl border border-[#d4af37]/50 bg-[#121622]/98 px-5 py-4 shadow-2xl backdrop-blur-2xl">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d4af37]/20 text-[#d4af37]">
              <Check className="h-5 w-5" />
            </div>
            <span className="text-sm sm:text-base font-semibold text-slate-100">{toastMsg}</span>
          </div>
        </div>
      )}

      {/* Scroll Progress Indicator */}
      <div className="fixed top-0 left-0 right-0 z-[60] h-[3px]">
        <div
          className="h-full bg-gradient-to-r from-[#d4af37] to-[#f5d060] shadow-[0_0_8px_rgba(212,175,55,0.6)] transition-all duration-150"
          style={{ width: `${scrollProgress * 100}%`, opacity: scrollProgress > 0.01 ? 1 : 0 }}
        />
      </div>

      {/* ─── Hero / Restaurant Header ─────────────────────────────────────────── */}
      <header className="relative w-full overflow-hidden bg-gradient-to-b from-[#0f1526] to-[#07090e] pb-8">
        {/* Cover Background / Hero Image */}
        <div className="relative h-52 sm:h-64 md:h-80 w-full overflow-hidden bg-[#111728]">
          {heroImageUrl ? (
            <img
              src={heroImageUrl}
              alt={companyName}
              className="h-full w-full object-cover opacity-65 filter brightness-95 scale-105 transition-transform duration-[2s] ease-out"
              style={{ animation: 'heroZoom 20s ease-in-out infinite alternate' }}
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-tr from-[#0a0d16] via-[#161f34] to-[#07090e] opacity-90" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-[#07090e]/50 to-transparent" />
          {/* Floating glass orbs */}
          <div className="absolute top-10 right-10 h-32 w-32 rounded-full bg-[#d4af37]/10 blur-[60px] animate-pulse" />
          <div className="absolute bottom-10 left-10 h-24 w-24 rounded-full bg-[#d4af37]/5 blur-[40px] animate-pulse" style={{ animationDelay: '1s' }} />

          {/* Top Bar with Language Selector & Table Indicator */}
          <div className="absolute top-5 inset-x-4 sm:inset-x-8 flex items-center justify-between z-10">
            {tableNum ? (
              <div className="flex items-center gap-2 rounded-full border border-[#d4af37]/60 bg-[#0a0e1a]/90 px-4 py-2 shadow-2xl backdrop-blur-xl">
                <span className="h-2.5 w-2.5 rounded-full bg-[#d4af37] animate-pulse" />
                <span className="text-sm font-extrabold text-[#d4af37] uppercase tracking-wider">
                  {TX.tableLabel[lang]}: {tableNum}
                </span>
              </div>
            ) : <div />}

            <div className="flex items-center gap-2">
              {/* Theme toggle */}
              <button
                type="button"
                onClick={() => setMenuTheme(isMenuLight ? 'dark' : 'light')}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[#0a0e1a]/90 shadow-2xl backdrop-blur-xl text-base transition-transform active:scale-90"
              >
                {isMenuLight ? '🌙' : '☀️'}
              </button>
              {/* Language selector */}
              <div className="flex items-center gap-1.5 rounded-full border border-slate-700/70 bg-[#0a0e1a]/90 p-1.5 shadow-2xl backdrop-blur-xl">
              {(['az', 'ru', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => changeLang(l)}
                  className={`rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-black uppercase transition-all ${
                    lang === l
                      ? 'bg-[#d4af37] text-slate-950 shadow-md scale-105'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            </div>
          </div>
        </div>

        {/* Restaurant Identity Container */}
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 -mt-16 sm:-mt-20">
          <div className="flex flex-col items-center text-center">
            {/* Circular Glowing Logo */}
            <div className="relative mb-4 flex h-28 w-28 sm:h-36 sm:w-36 items-center justify-center rounded-full bg-[#0c111d] shadow-[0_0_35px_rgba(212,175,55,0.35)] p-1.5 animate-glow-pulse" style={{ borderWidth: '3px', borderStyle: 'solid', borderColor: primaryColor }}>
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={companyName}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <UtensilsCrossed className="h-12 w-12 text-[#d4af37]" />
              )}
            </div>

            {/* Restaurant Title & Subtitle */}
            <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-slate-50">
              {companyName}
            </h1>
            {branding.hero_subtitle && (
              <p className="mt-2 text-sm sm:text-base md:text-lg font-semibold tracking-wide max-w-xl" style={{ color: primaryColor }}>
                {branding.hero_subtitle}
              </p>
            )}

            {/* Quick Action Badges (Phone, Address, Wi-Fi, Instagram) */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5 text-sm sm:text-base">
              {phone && (
                <a
                  href={`tel:${phone}`}
                  className="flex items-center gap-2 rounded-2xl border border-slate-700/80 bg-[#121828]/95 px-4 py-2 text-slate-200 font-medium transition-all hover:border-[#d4af37] hover:text-[#d4af37] shadow-md"
                >
                  <Phone className="h-4 w-4 text-[#d4af37]" />
                  <span>{phone}</span>
                </a>
              )}
              {instagram && (
                <a
                  href={instagram.startsWith('http') ? instagram : `https://instagram.com/${instagram.replace('@', '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-2xl border border-slate-700/80 bg-[#121828]/95 px-4 py-2 text-slate-200 font-medium transition-all hover:border-pink-500 hover:text-pink-400 shadow-md"
                >
                  <Instagram className="h-4 w-4 text-pink-400" />
                  <span>Instagram</span>
                </a>
              )}
              {(wifiSsid || wifiPassword) && (
                <button
                  type="button"
                  onClick={() => setWifiModalOpen(true)}
                  className="flex items-center gap-2 rounded-2xl border border-[#d4af37]/60 bg-[#121828]/95 px-4 py-2 text-[#d4af37] font-semibold transition-all hover:bg-[#d4af37]/15 shadow-md"
                >
                  <Wifi className="h-4 w-4 text-[#d4af37]" />
                  <span>Wi-Fi</span>
                </button>
              )}
              {address && (
                <div className="flex items-center gap-2 rounded-2xl border border-slate-700/80 bg-[#121828]/95 px-4 py-2 text-slate-300 font-medium shadow-md">
                  <MapPin className="h-4 w-4 text-emerald-400" />
                  <span className="truncate max-w-[240px] sm:max-w-xs">{address}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ─── Instagram-style Story Slider ─────────────────────────────────────── */}
      {categories.length > 0 && (
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 -mt-4 mb-6">
          <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-none" style={{ WebkitOverflowScrolling: 'touch' }}>
            {/* All button — with restaurant logo */}
            <button
              type="button"
              onClick={() => setActiveCategory('ALL')}
              className="flex flex-col items-center gap-2 shrink-0 group"
              style={{ animation: 'fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0s both' }}
            >
              <div className={`relative h-20 w-20 sm:h-24 sm:w-24 rounded-[22px] overflow-hidden border-2 transition-all duration-300 flex items-center justify-center ${
                activeCategory === 'ALL'
                  ? 'border-[#d4af37] shadow-[0_0_20px_rgba(212,175,55,0.4)] scale-105 bg-[#d4af37]/10'
                  : 'border-white/10 group-hover:border-white/30 group-hover:scale-105 bg-white/[0.03]'
              }`}>
                {logoUrl ? (
                  <img src={logoUrl} alt={companyName} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-3xl">✨</span>
                )}
              </div>
              <span className={`text-[11px] sm:text-xs font-bold transition-colors ${
                activeCategory === 'ALL' ? 'text-[#d4af37]' : 'text-slate-400 group-hover:text-slate-200'
              }`}>
                {TX.all[lang]}
              </span>
            </button>
            {categories.map((cat, idx) => {
              const catItems = menuItems.filter((i) => String(i.category || '').trim() === cat);
              const coverImg = resolveImageUrl(catItems.find((i) => i.image_url)?.image_url);
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className="flex flex-col items-center gap-2 shrink-0 group"
                  style={{ animation: `fadeInUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${(idx + 1) * 0.06}s both` }}
                >
                  <div className={`relative h-20 w-20 sm:h-24 sm:w-24 rounded-[22px] overflow-hidden border-2 transition-all duration-300 ${
                    isActive
                      ? 'border-[#d4af37] shadow-[0_0_20px_rgba(212,175,55,0.4)] scale-105'
                      : 'border-white/10 group-hover:border-white/30 group-hover:scale-105'
                  }`}>
                    {coverImg ? (
                      <img src={coverImg} alt={cat} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center bg-white/[0.05] text-2xl">
                        {getCategoryIcon(cat)}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  </div>
                  <span className={`text-[11px] sm:text-xs font-bold truncate max-w-[80px] sm:max-w-[96px] transition-colors ${
                    isActive ? 'text-[#d4af37]' : 'text-slate-400 group-hover:text-slate-200'
                  }`}>
                    {cat}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Search Bar (inline, below story slider) ────────────────────────── */}
      <div className="mx-auto max-w-4xl px-4 sm:px-6 mb-6">
        <div className="relative">
          {!searchExpanded && !search ? (
            <button
              type="button"
              onClick={() => setSearchExpanded(true)}
              className={`flex items-center gap-3 w-full rounded-2xl border py-3 px-5 text-sm transition-all duration-300 ${
                isMenuLight
                  ? 'border-slate-200 bg-white/60 text-slate-400 hover:border-slate-300'
                  : 'border-white/10 bg-white/[0.05] text-slate-500 hover:border-white/20'
              }`}
            >
              <Search className="h-4 w-4 text-slate-400" />
              <span>{TX.searchPlaceholder[lang]}</span>
            </button>
          ) : (
            <div style={{ animation: 'fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}>
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#d4af37]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => { if (!search) setSearchExpanded(false); }}
                autoFocus
                placeholder={TX.searchPlaceholder[lang]}
                className={`w-full rounded-2xl border py-3 pl-11 pr-10 text-sm transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-[#d4af37]/20 ${
                  isMenuLight
                    ? 'border-[#d4af37]/40 bg-white text-slate-900 placeholder-slate-400'
                    : 'border-[#d4af37]/40 bg-white/[0.06] text-slate-100 placeholder-slate-500'
                }`}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setSearchExpanded(false); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Menu Grid ───────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500" style={{ animation: 'fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}>
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-full bg-[#d4af37]/5 blur-xl animate-pulse" />
              <UtensilsCrossed className="relative h-16 w-16 stroke-1 text-slate-600 animate-float" />
            </div>
            <p className="text-lg font-bold text-slate-400">{TX.noResults[lang]}</p>
            <p className="mt-2 text-sm text-slate-600">{lang === 'az' ? 'Başqa açar söz yoxlayın' : lang === 'ru' ? 'Попробуйте другой запрос' : 'Try a different keyword'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
            {filteredItems.map((item, idx) => {
              const img = resolveImageUrl(item.image_url);
              const priceFormatted = Number(item.price || 0).toFixed(2);
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`group relative flex cursor-pointer overflow-hidden rounded-3xl border p-4 sm:p-5 shadow-xl backdrop-blur-xl transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-1 active:scale-[0.98] active:duration-150 ${
                    isMenuLight
                      ? 'border-slate-200/80 bg-white/70 hover:border-[#d4af37]/40 hover:bg-white/90 hover:shadow-[0_8px_40px_rgba(212,175,55,0.1)]'
                      : 'border-white/[0.08] bg-white/[0.04] hover:border-[#d4af37]/40 hover:bg-white/[0.08] hover:shadow-[0_8px_40px_rgba(212,175,55,0.15)]'
                  }`}
                  style={{
                    animation: `fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${idx * 0.06}s both`,
                  }}
                >
                  {/* Food Image with Hover Zoom */}
                  {showImages && (
                  <div className="relative h-32 w-32 sm:h-36 sm:w-36 md:h-40 md:w-40 shrink-0 overflow-hidden rounded-2xl bg-[#161e32]">
                    {img ? (
                      <img
                        src={img}
                        alt={item.item_name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-4xl opacity-40">
                        {getCategoryIcon(item.category)}
                      </div>
                    )}
                    {item.is_coffee && (
                      <span className="absolute bottom-2 left-2 rounded-lg bg-[#0a0d16]/90 px-2 py-1 text-xs font-bold backdrop-blur-md" style={{ color: primaryColor }}>
                        ☕ Coffee
                      </span>
                    )}
                  </div>
                  )}

                  {/* Info Column */}
                  <div className="ml-4 sm:ml-5 flex flex-1 flex-col justify-between">
                    <div>
                      <h3 className={`font-serif text-lg sm:text-xl font-bold line-clamp-2 leading-snug group-hover:text-[#d4af37] transition-colors ${
                        isMenuLight ? 'text-slate-900' : 'text-slate-50'
                      }`}>
                        {item.item_name}
                      </h3>
                      {showDescriptions && item.description && (
                        <p className="mt-1.5 text-xs sm:text-sm text-slate-300 line-clamp-2 leading-relaxed">
                          {item.description}
                        </p>
                      )}
                    </div>

                    {/* Price & Action */}
                    <div className="mt-4 flex items-center justify-between">
                      {showPrices && (
                        <div className="flex items-baseline gap-1 group-hover:animate-[priceBounce_0.4s_ease-out]">
                          <span className="text-xl sm:text-2xl font-black" style={{ color: primaryColor }}>{priceFormatted}</span>
                          <span className="text-sm sm:text-base font-bold" style={{ color: primaryColor }}>₼</span>
                        </div>
                      )}
                      <button
                        type="button"
                        className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-white/[0.06] text-slate-300 transition-all duration-300 group-hover:scale-110 group-hover:shadow-[0_4px_15px_rgba(212,175,55,0.4)] active:scale-90"
                        style={{ '--tw-shadow-color': `${primaryColor}40` } as React.CSSProperties}
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ─── Floating Table Service Bar (If Table Present) ───────────────────── */}
      {tableNum && (
        <div className="fixed bottom-6 inset-x-4 z-40 mx-auto max-w-md animate-slide-up">
          <div className="flex items-center justify-between gap-3.5 rounded-3xl border border-[#d4af37]/50 bg-[#0d1322]/98 p-2.5 shadow-2xl backdrop-blur-2xl">
            {/* Call Waiter Button */}
            <button
              type="button"
              onClick={handleCallWaiter}
              disabled={waiterCooldown > 0}
              className={`flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-xs sm:text-sm font-extrabold uppercase tracking-wider transition-all ${
                waiterCooldown > 0
                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'menu-primary-gradient text-slate-950 shadow-xl hover:brightness-110 active:scale-95'
              }`}
            >
              <BellRing className="h-5 w-5" />
              <span>{waiterCooldown > 0 ? `${waiterCooldown}s` : TX.callWaiter[lang]}</span>
            </button>

            {/* Request Bill Button */}
            <button
              type="button"
              onClick={() => setBillModalOpen(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-[#161f34] py-3.5 text-xs sm:text-sm font-extrabold uppercase tracking-wider text-slate-100 transition-all hover:border-[#d4af37] hover:text-[#d4af37] active:scale-95 shadow-xl"
            >
              <Receipt className="h-5 w-5 text-[#d4af37]" />
              <span>{TX.requestBill[lang]}</span>
            </button>
          </div>
        </div>
      )}

      {/* ─── Dish Detail Sheet (iOS-style bottom sheet) ─────────────────────── */}
      {selectedItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-[32px] border-t border-white/10 bg-[#0e1424]/95 shadow-[0_-10px_60px_rgba(0,0,0,0.5)] backdrop-blur-2xl backdrop-saturate-150 text-slate-100"
            style={{ animation: 'sheetSlideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag Indicator */}
            <div className="sticky top-0 z-10 flex justify-center pt-3 pb-2">
              <div className="h-1.5 w-12 rounded-full bg-white/20" />
            </div>

            {/* Sheet Image — full-width, no padding */}
            <div className="relative h-64 sm:h-80 w-full overflow-hidden">
              {selectedItem.image_url ? (
                <img
                  src={resolveImageUrl(selectedItem.image_url)}
                  alt={selectedItem.item_name}
                  className="h-full w-full object-cover"
                  style={{ animation: 'heroZoom 15s ease-in-out infinite alternate' }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-white/[0.03] text-7xl opacity-30">
                  {getCategoryIcon(selectedItem.category)}
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0e1424] via-transparent to-transparent" />
              {/* Floating close button */}
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-lg border border-white/10 transition-transform active:scale-90"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 pb-8 pt-4 space-y-5">
              {/* Category Badge + Price row */}
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <span className="inline-block rounded-xl bg-[#d4af37]/15 border border-[#d4af37]/30 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-[#d4af37]">
                    {getCategoryIcon(selectedItem.category)} {selectedItem.category}
                  </span>
                  <h2 className="font-serif text-2xl sm:text-3xl font-extrabold text-slate-50 leading-tight">
                    {selectedItem.item_name}
                  </h2>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-3xl sm:text-4xl font-black text-[#d4af37]" style={{ animation: 'fadeInUp 0.4s 0.2s both' }}>
                    {Number(selectedItem.price || 0).toFixed(2)}
                  </div>
                  <span className="text-sm font-bold text-[#d4af37]/70">₼</span>
                </div>
              </div>

              {/* Description */}
              {selectedItem.description && (
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-lg p-5 text-sm sm:text-base text-slate-200 leading-relaxed" style={{ animation: 'fadeInUp 0.4s 0.3s both' }}>
                  <div className="mb-2 text-xs sm:text-sm font-bold uppercase tracking-wider text-[#d4af37]/80">
                    {TX.ingredients[lang]}
                  </div>
                  <p>{selectedItem.description}</p>
                </div>
              )}

              {/* Close action */}
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="w-full rounded-2xl menu-primary-gradient py-4 text-base font-extrabold uppercase tracking-wider text-slate-950 shadow-[0_4px_20px_rgba(212,175,55,0.3)] hover:brightness-110 transition-all active:scale-[0.98]"
              >
                {TX.close[lang]}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Wi-Fi Info Modal ─────────────────────────────────────────────────── */}
      {wifiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-lg animate-fade-in">
          <div className="w-full max-w-sm rounded-3xl border border-[#d4af37]/50 bg-[#0e1424] p-7 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#d4af37]/15 text-[#d4af37]">
              <Wifi className="h-8 w-8" />
            </div>
            <h3 className="font-serif text-xl font-bold text-slate-50">{TX.wifiInfo[lang]}</h3>

            <div className="mt-5 space-y-4 rounded-2xl border border-slate-800 bg-[#131a2c] p-4 text-left text-sm sm:text-base">
              {wifiSsid && (
                <div>
                  <span className="text-xs sm:text-sm text-slate-400">{TX.wifiNetwork[lang]}</span>
                  <div className="font-mono text-base sm:text-lg font-bold text-slate-100">{wifiSsid}</div>
                </div>
              )}
              {wifiPassword && (
                <div>
                  <span className="text-xs sm:text-sm text-slate-400">{TX.wifiPass[lang]}</span>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <span className="font-mono text-base sm:text-lg font-bold text-[#d4af37]">{wifiPassword}</span>
                    <button
                      type="button"
                      onClick={copyWifiPassword}
                      className="flex items-center gap-1.5 rounded-xl bg-[#1e273e] px-3.5 py-1.5 text-xs sm:text-sm font-bold text-slate-100 hover:bg-[#d4af37] hover:text-slate-950 transition-all shadow-md"
                    >
                      {copiedWifi ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                      <span>{copiedWifi ? TX.copied[lang] : TX.copy[lang]}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setWifiModalOpen(false)}
              className="mt-6 w-full rounded-2xl bg-slate-800 py-3 text-sm sm:text-base font-bold text-slate-200 hover:bg-slate-700"
            >
              {TX.close[lang]}
            </button>
          </div>
        </div>
      )}

      {/* ─── Bill Request Modal ──────────────────────────────────────────────── */}
      {billModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-lg animate-fade-in">
          <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-[#0e1424] p-7 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#d4af37]/15 text-[#d4af37]">
              <Receipt className="h-8 w-8" />
            </div>
            <h3 className="font-serif text-xl font-bold text-slate-50">{TX.requestBill[lang]}</h3>
            <p className="mt-1.5 text-xs sm:text-sm text-slate-400">{TX.choosePayment[lang]}</p>

            <div className="mt-5 grid grid-cols-2 gap-3.5">
              <button
                type="button"
                onClick={() => setBillPaymentMethod('cash')}
                className={`rounded-2xl border p-5 text-center transition-all ${
                  billPaymentMethod === 'cash'
                    ? 'border-[#d4af37] bg-[#d4af37]/15 text-[#d4af37] font-bold shadow-xl scale-105'
                    : 'border-slate-800 bg-[#131a2c] text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="text-3xl mb-1.5">💵</div>
                <div className="text-xs sm:text-sm font-bold">{TX.cash[lang]}</div>
              </button>

              <button
                type="button"
                onClick={() => setBillPaymentMethod('card')}
                className={`rounded-2xl border p-5 text-center transition-all ${
                  billPaymentMethod === 'card'
                    ? 'border-[#d4af37] bg-[#d4af37]/15 text-[#d4af37] font-bold shadow-xl scale-105'
                    : 'border-slate-800 bg-[#131a2c] text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="text-3xl mb-1.5">💳</div>
                <div className="text-xs sm:text-sm font-bold">{TX.card[lang]}</div>
              </button>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setBillModalOpen(false)}
                className="flex-1 rounded-2xl bg-slate-800 py-3.5 text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-300 hover:bg-slate-700"
              >
                {TX.close[lang]}
              </button>
              <button
                type="button"
                onClick={handleRequestBill}
                className="flex-1 rounded-2xl menu-primary-gradient py-3.5 text-xs sm:text-sm font-black uppercase tracking-wider text-slate-950 shadow-xl hover:brightness-110"
              >
                {TX.send[lang]}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
