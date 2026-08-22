import React, { useEffect, useMemo, useRef, useState } from 'react';
import { get_public_menu_live } from '../api/menu';
import { get_public_qr_menu_bootstrap_live, send_public_table_service } from '../api/settings';
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

  const categoryScrollRef = useRef<HTMLDivElement>(null);

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
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#07090e] text-[#d4af37]">
        <div className="relative mb-5 flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full bg-[#d4af37]/20" />
          <UtensilsCrossed className="h-10 w-10 animate-pulse text-[#d4af37]" />
        </div>
        <p className="text-base font-bold tracking-widest uppercase text-slate-200">Menyu Yüklənir...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#07090e] text-slate-100 antialiased selection:bg-[#d4af37]/30 selection:text-[#d4af37] pb-32">
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

      {/* ─── Hero / Restaurant Header ─────────────────────────────────────────── */}
      <header className="relative w-full overflow-hidden bg-gradient-to-b from-[#0f1526] to-[#07090e] pb-8">
        {/* Cover Background / Hero Image */}
        <div className="relative h-52 sm:h-64 md:h-80 w-full overflow-hidden bg-[#111728]">
          {heroImageUrl ? (
            <img
              src={heroImageUrl}
              alt={companyName}
              className="h-full w-full object-cover opacity-65 filter brightness-95"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-tr from-[#0a0d16] via-[#161f34] to-[#07090e] opacity-90" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-[#07090e]/50 to-transparent" />

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

        {/* Restaurant Identity Container */}
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 -mt-16 sm:-mt-20">
          <div className="flex flex-col items-center text-center">
            {/* Circular Glowing Logo */}
            <div className="relative mb-4 flex h-28 w-28 sm:h-36 sm:w-36 items-center justify-center rounded-full border-3 border-[#d4af37] bg-[#0c111d] shadow-[0_0_35px_rgba(212,175,55,0.35)] p-1.5">
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
              <p className="mt-2 text-sm sm:text-base md:text-lg text-[#d4af37] font-semibold tracking-wide max-w-xl">
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

      {/* ─── Sticky Search & Category Carousel ────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#07090e]/95 backdrop-blur-2xl shadow-2xl">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-4">
          {/* Search Input */}
          <div className="relative mb-3.5">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={TX.searchPlaceholder[lang]}
              className="w-full rounded-2xl border border-slate-800 bg-[#111728] py-3.5 pl-12 pr-11 text-sm sm:text-base text-slate-100 placeholder-slate-500 transition-all focus:border-[#d4af37] focus:outline-none focus:ring-2 focus:ring-[#d4af37]/30 shadow-inner"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:text-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* Horizontal Category Carousel */}
          <div
            ref={categoryScrollRef}
            className="flex items-center gap-2.5 overflow-x-auto pb-1.5 scrollbar-none"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {/* 'ALL' Button */}
            <button
              type="button"
              onClick={() => setActiveCategory('ALL')}
              className={`flex shrink-0 items-center gap-2 rounded-2xl px-5 py-2.5 text-sm sm:text-base font-bold tracking-wide transition-all ${
                activeCategory === 'ALL'
                  ? 'border border-[#d4af37] bg-gradient-to-r from-[#d4af37] to-[#b89528] text-slate-950 shadow-lg scale-105 font-black'
                  : 'border border-slate-800 bg-[#111728] text-slate-300 hover:border-slate-700 hover:text-white'
              }`}
            >
              <span className="text-base">✨</span>
              <span>{TX.all[lang]}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-black ${activeCategory === 'ALL' ? 'bg-slate-950/25 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                {menuItems.length}
              </span>
            </button>

            {/* Dynamic Categories */}
            {categories.map((cat) => {
              const count = menuItems.filter((i) => String(i.category || '').trim() === cat).length;
              const isSelected = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`flex shrink-0 items-center gap-2 rounded-2xl px-5 py-2.5 text-sm sm:text-base font-bold tracking-wide transition-all ${
                    isSelected
                      ? 'border border-[#d4af37] bg-gradient-to-r from-[#d4af37] to-[#b89528] text-slate-950 shadow-lg scale-105 font-black'
                      : 'border border-slate-800 bg-[#111728] text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <span className="text-base">{getCategoryIcon(cat)}</span>
                  <span>{cat}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-black ${isSelected ? 'bg-slate-950/25 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── Menu Grid ───────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500">
            <UtensilsCrossed className="mb-4 h-14 w-14 stroke-1 text-slate-600" />
            <p className="text-base font-semibold">{TX.noResults[lang]}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
            {filteredItems.map((item) => {
              const img = resolveImageUrl(item.image_url);
              const priceFormatted = Number(item.price || 0).toFixed(2);
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="group relative flex cursor-pointer overflow-hidden rounded-3xl border border-slate-800/80 bg-[#0d1322] p-4 sm:p-5 shadow-xl transition-all duration-300 hover:border-[#d4af37]/50 hover:bg-[#12192d] hover:shadow-[0_8px_30px_rgba(212,175,55,0.12)] active:scale-[0.99]"
                >
                  {/* Food Image with Hover Zoom */}
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
                      <span className="absolute bottom-2 left-2 rounded-lg bg-[#0a0d16]/90 px-2 py-1 text-xs font-bold text-[#d4af37] backdrop-blur-md">
                        ☕ Coffee
                      </span>
                    )}
                  </div>

                  {/* Info Column */}
                  <div className="ml-4 sm:ml-5 flex flex-1 flex-col justify-between">
                    <div>
                      <h3 className="font-serif text-lg sm:text-xl font-bold text-slate-50 line-clamp-2 leading-snug group-hover:text-[#d4af37] transition-colors">
                        {item.item_name}
                      </h3>
                      {item.description && (
                        <p className="mt-1.5 text-xs sm:text-sm text-slate-300 line-clamp-2 leading-relaxed">
                          {item.description}
                        </p>
                      )}
                    </div>

                    {/* Price & Action */}
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-baseline gap-1">
                        <span className="text-xl sm:text-2xl font-black text-[#d4af37]">{priceFormatted}</span>
                        <span className="text-sm sm:text-base font-bold text-[#d4af37]">₼</span>
                      </div>
                      <button
                        type="button"
                        className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-[#1b2438] text-slate-300 transition-colors group-hover:bg-[#d4af37] group-hover:text-slate-950 shadow-md"
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
                  : 'bg-gradient-to-r from-[#d4af37] to-[#b89528] text-slate-950 shadow-xl hover:brightness-110 active:scale-95'
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

      {/* ─── Dish Detail Modal (Popup) ────────────────────────────────────────── */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 p-0 sm:p-4 backdrop-blur-lg animate-fade-in">
          <div
            className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-slate-800 bg-[#0e1424] p-6 sm:p-8 shadow-2xl animate-slide-up text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setSelectedItem(null)}
              className="absolute right-5 top-5 z-10 rounded-full bg-black/70 p-2.5 text-slate-300 hover:text-white backdrop-blur-md shadow-lg"
            >
              <X className="h-6 w-6" />
            </button>

            {/* Modal Image */}
            <div className="relative mb-6 h-64 sm:h-80 w-full overflow-hidden rounded-2xl bg-[#161e32]">
              {selectedItem.image_url ? (
                <img
                  src={resolveImageUrl(selectedItem.image_url)}
                  alt={selectedItem.item_name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-7xl opacity-30">
                  {getCategoryIcon(selectedItem.category)}
                </div>
              )}
            </div>

            {/* Title & Category Badge */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-block rounded-xl bg-[#d4af37]/20 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-[#d4af37]">
                  {selectedItem.category}
                </span>
                <h2 className="mt-2.5 font-serif text-2xl sm:text-3xl font-extrabold text-slate-50 leading-tight">
                  {selectedItem.item_name}
                </h2>
              </div>
              <div className="text-right">
                <span className="text-3xl sm:text-4xl font-black text-[#d4af37]">
                  {Number(selectedItem.price || 0).toFixed(2)}
                </span>
                <span className="text-lg font-bold text-[#d4af37]"> ₼</span>
              </div>
            </div>

            {/* Description & Ingredients */}
            {selectedItem.description && (
              <div className="mt-5 rounded-2xl border border-slate-800 bg-[#141b2e] p-5 text-sm sm:text-base text-slate-200 leading-relaxed">
                <div className="mb-2 text-xs sm:text-sm font-bold uppercase tracking-wider text-[#d4af37]">
                  {TX.ingredients[lang]}
                </div>
                <p>{selectedItem.description}</p>
              </div>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={() => setSelectedItem(null)}
              className="mt-6 w-full rounded-2xl bg-gradient-to-r from-[#d4af37] to-[#b89528] py-4 text-base font-extrabold uppercase tracking-wider text-slate-950 shadow-xl hover:brightness-110 transition-transform active:scale-98"
            >
              {TX.close[lang]}
            </button>
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
                className="flex-1 rounded-2xl bg-gradient-to-r from-[#d4af37] to-[#b89528] py-3.5 text-xs sm:text-sm font-black uppercase tracking-wider text-slate-950 shadow-xl hover:brightness-110"
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
