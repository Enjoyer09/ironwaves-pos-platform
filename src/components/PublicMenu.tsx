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
  Clock,
  BellRing,
  Receipt,
  Flame,
  Sparkles,
  Award,
  Leaf,
  Check,
  Copy,
  ChevronRight,
  Info,
  UtensilsCrossed,
  Share2,
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
  if (norm.includes('isti') || norm.includes('ət') || norm.includes('qril') || norm.includes('kabab') || norm.includes('hot')) return '🥩';
  if (norm.includes('qəlyanaltı') || norm.includes('snack') || norm.includes('starter') || norm.includes('məzə')) return '🥗';
  if (norm.includes('şorba') || norm.includes('soup')) return '🍲';
  if (norm.includes('salat') || norm.includes('salad')) return '🥗';
  if (norm.includes('burger') || norm.includes('fast') || norm.includes('pizza') || norm.includes('sendviç')) return '🍔';
  if (norm.includes('çay') || norm.includes('tea') || norm.includes('qəhvə') || norm.includes('coffee') || norm.includes('kofe')) return '☕';
  if (norm.includes('içki') || norm.includes('drink') || norm.includes('kokteyl') || norm.includes('şirə')) return '🥤';
  if (norm.includes('şirniyyat') || norm.includes('desert') || norm.includes('dessert') || norm.includes('tort')) return '🍰';
  if (norm.includes('qarnir') || norm.includes('side')) return '🍟';
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
  searchPlaceholder: { az: 'Menyuda axtar...', ru: 'Поиск по меню...', en: 'Search in menu...' },
  all: { az: 'Hamısı', ru: 'Все', en: 'All' },
  callWaiter: { az: 'Ofisiantı Çağır', ru: 'Позвать официанта', en: 'Call Waiter' },
  requestBill: { az: 'Hesabı İstə', ru: 'Попросить счет', en: 'Request Bill' },
  waiterCalledMsg: { az: 'Ofisianta məlumat verildi. Zəhmət olmasa gözləyin.', ru: 'Официант вызван. Пожалуйста, подождите.', en: 'Waiter has been notified. Please wait.' },
  billRequestedMsg: { az: 'Hesab tələbi göndərildi.', ru: 'Запрос счета отправлен.', en: 'Bill request sent.' },
  tableLabel: { az: 'Masa', ru: 'Стол', en: 'Table' },
  wifiInfo: { az: 'Wi-Fi Məlumatı', ru: 'Информация о Wi-Fi', en: 'Wi-Fi Information' },
  wifiNetwork: { az: 'Şəbəkə adı:', ru: 'Имя сети:', en: 'Network Name:' },
  wifiPass: { az: 'Şifrə:', ru: 'Пароль:', en: 'Password:' },
  copied: { az: 'Kopyalandı!', ru: 'Скопировано!', en: 'Copied!' },
  copy: { az: 'Kopyala', ru: 'Копировать', en: 'Copy' },
  close: { az: 'Bağla', ru: 'Закрыть', en: 'Close' },
  popularBadge: { az: 'Populyar', ru: 'Популярное', en: 'Popular' },
  ingredients: { az: 'Tərkibi və Hazırlanma', ru: 'Состав и описание', en: 'Ingredients & Details' },
  allergensTitle: { az: 'Allergenlər', ru: 'Аллергены', en: 'Allergens' },
  portion: { az: 'Porsiya / Çəki', ru: 'Порция / Вес', en: 'Portion / Weight' },
  calories: { az: 'Kalori', ru: 'Калории', en: 'Calories' },
  choosePayment: { az: 'Ödəniş üsulunu seçin:', ru: 'Выберите способ оплаты:', en: 'Choose payment method:' },
  cash: { az: 'Nağd', ru: 'Наличные', en: 'Cash' },
  card: { az: 'Bank Kartı', ru: 'Карта', en: 'Card' },
  send: { az: 'Göndər', ru: 'Отправить', en: 'Send' },
  noResults: { az: 'Axtarışa uyğun məhsul tapılmadı.', ru: 'Ничего не найдено.', en: 'No items found.' },
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

    // Subdomain check e.g. gyrospos.ironwaves.store -> gyrospos
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
  const workingHours = branding.working_hours || '10:00 - 23:00';

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
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#07090e] text-[#d4af37]">
        <div className="relative mb-4 flex h-16 w-16 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full bg-[#d4af37]/20" />
          <UtensilsCrossed className="h-8 w-8 animate-pulse text-[#d4af37]" />
        </div>
        <p className="text-sm font-semibold tracking-widest uppercase text-slate-300">Menyu Yüklənir...</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#07090e] text-slate-100 antialiased selection:bg-[#d4af37]/30 selection:text-[#d4af37]">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-5 left-1/2 z-50 -translate-x-1/2 transform animate-fade-in">
          <div className="flex items-center gap-2.5 rounded-2xl border border-[#d4af37]/40 bg-[#121620]/95 px-5 py-3 shadow-2xl backdrop-blur-xl">
            <Check className="h-5 w-5 text-[#d4af37]" />
            <span className="text-sm font-medium text-slate-100">{toastMsg}</span>
          </div>
        </div>
      )}

      {/* ─── Hero / Restaurant Header ─────────────────────────────────────────── */}
      <header className="relative w-full overflow-hidden bg-gradient-to-b from-[#0f1422] to-[#07090e] pb-6">
        {/* Cover Background / Hero Image */}
        <div className="relative h-44 w-full overflow-hidden bg-[#111625] md:h-64">
          {heroImageUrl ? (
            <img
              src={heroImageUrl}
              alt={companyName}
              className="h-full w-full object-cover opacity-60 filter brightness-90"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-tr from-[#0a0d14] via-[#161d2e] to-[#07090e] opacity-80" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-[#07090e]/40 to-transparent" />

          {/* Top Bar with Language Selector */}
          <div className="absolute top-4 inset-x-4 flex items-center justify-between z-10">
            {tableNum && (
              <div className="flex items-center gap-1.5 rounded-full border border-[#d4af37]/50 bg-[#0a0d14]/80 px-3.5 py-1.5 shadow-lg backdrop-blur-md">
                <span className="h-2 w-2 rounded-full bg-[#d4af37] animate-pulse" />
                <span className="text-xs font-bold text-[#d4af37] uppercase tracking-wider">
                  {TX.tableLabel[lang]}: {tableNum}
                </span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-1 rounded-full border border-slate-700/60 bg-[#0a0d14]/80 p-1 shadow-lg backdrop-blur-md">
              {(['az', 'ru', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => changeLang(l)}
                  className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase transition-all ${
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
        <div className="relative mx-auto max-w-4xl px-4 -mt-14">
          <div className="flex flex-col items-center text-center">
            {/* Circular Glowing Logo */}
            <div className="relative mb-3 flex h-24 w-24 items-center justify-center rounded-full border-2 border-[#d4af37] bg-[#0d121d] shadow-[0_0_25px_rgba(212,175,55,0.25)] p-1 md:h-28 md:w-28">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={companyName}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <UtensilsCrossed className="h-10 w-10 text-[#d4af37]" />
              )}
            </div>

            {/* Restaurant Title & Subtitle */}
            <h1 className="font-serif text-2xl font-bold tracking-wide text-slate-50 md:text-3xl">
              {companyName}
            </h1>
            {branding.hero_subtitle && (
              <p className="mt-1 text-xs text-[#d4af37]/90 md:text-sm font-medium tracking-wide">
                {branding.hero_subtitle}
              </p>
            )}

            {/* Quick Action Badges (Phone, Address, Wi-Fi, Instagram) */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
              {phone && (
                <a
                  href={`tel:${phone}`}
                  className="flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-[#121724]/90 px-3 py-1.5 text-slate-300 transition-all hover:border-[#d4af37]/60 hover:text-[#d4af37]"
                >
                  <Phone className="h-3.5 w-3.5 text-[#d4af37]" />
                  <span>{phone}</span>
                </a>
              )}
              {instagram && (
                <a
                  href={instagram.startsWith('http') ? instagram : `https://instagram.com/${instagram.replace('@', '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-[#121724]/90 px-3 py-1.5 text-slate-300 transition-all hover:border-[#d4af37]/60 hover:text-[#d4af37]"
                >
                  <Instagram className="h-3.5 w-3.5 text-pink-400" />
                  <span>Instagram</span>
                </a>
              )}
              {(wifiSsid || wifiPassword) && (
                <button
                  type="button"
                  onClick={() => setWifiModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-full border border-[#d4af37]/40 bg-[#121724]/90 px-3 py-1.5 text-[#d4af37] transition-all hover:bg-[#d4af37]/10"
                >
                  <Wifi className="h-3.5 w-3.5 text-[#d4af37]" />
                  <span>Wi-Fi</span>
                </button>
              )}
              {address && (
                <div className="flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-[#121724]/90 px-3 py-1.5 text-slate-400">
                  <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="truncate max-w-[200px]">{address}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ─── Sticky Search & Category Carousel ────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#07090e]/95 backdrop-blur-xl shadow-xl">
        <div className="mx-auto max-w-4xl px-4 py-3">
          {/* Search Input */}
          <div className="relative mb-3">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={TX.searchPlaceholder[lang]}
              className="w-full rounded-xl border border-slate-800 bg-[#111624] py-2.5 pl-10 pr-9 text-sm text-slate-100 placeholder-slate-500 transition-all focus:border-[#d4af37] focus:outline-none focus:ring-1 focus:ring-[#d4af37]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Horizontal Category Carousel */}
          <div
            ref={categoryScrollRef}
            className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {/* 'ALL' Button */}
            <button
              type="button"
              onClick={() => setActiveCategory('ALL')}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition-all ${
                activeCategory === 'ALL'
                  ? 'border border-[#d4af37] bg-gradient-to-r from-[#d4af37] to-[#b89528] text-slate-950 shadow-md font-bold'
                  : 'border border-slate-800 bg-[#111624] text-slate-300 hover:border-slate-700 hover:text-white'
              }`}
            >
              <span>✨</span>
              <span>{TX.all[lang]}</span>
              <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${activeCategory === 'ALL' ? 'bg-slate-950/20 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-400'}`}>
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
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition-all ${
                    isSelected
                      ? 'border border-[#d4af37] bg-gradient-to-r from-[#d4af37] to-[#b89528] text-slate-950 shadow-md font-bold'
                      : 'border border-slate-800 bg-[#111624] text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <span>{getCategoryIcon(cat)}</span>
                  <span>{cat}</span>
                  <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${isSelected ? 'bg-slate-950/20 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-400'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── Menu Grid ───────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-4xl px-4 py-6 pb-28">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500">
            <UtensilsCrossed className="mb-3 h-12 w-12 stroke-1 text-slate-600" />
            <p className="text-sm">{TX.noResults[lang]}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2">
            {filteredItems.map((item) => {
              const img = resolveImageUrl(item.image_url);
              const priceFormatted = Number(item.price || 0).toFixed(2);
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="group relative flex cursor-pointer overflow-hidden rounded-2xl border border-slate-800/80 bg-[#0d121e] p-3 shadow-lg transition-all duration-300 hover:border-[#d4af37]/40 hover:bg-[#121827] hover:shadow-[0_4px_20px_rgba(212,175,55,0.08)] active:scale-[0.99]"
                >
                  {/* Food Image with Hover Zoom */}
                  <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-[#151c2e]">
                    {img ? (
                      <img
                        src={img}
                        alt={item.item_name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-3xl opacity-40">
                        {getCategoryIcon(item.category)}
                      </div>
                    )}
                    {/* Badge if Popular/Special */}
                    {item.is_coffee && (
                      <span className="absolute bottom-1.5 left-1.5 rounded-md bg-[#0a0d14]/80 px-1.5 py-0.5 text-[10px] font-bold text-[#d4af37] backdrop-blur-sm">
                        ☕ Coffee
                      </span>
                    )}
                  </div>

                  {/* Info Column */}
                  <div className="ml-3 flex flex-1 flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-slate-100 line-clamp-2 leading-snug group-hover:text-[#d4af37] transition-colors">
                          {item.item_name}
                        </h3>
                      </div>
                      {item.description && (
                        <p className="mt-1 text-xs text-slate-400 line-clamp-2 leading-relaxed">
                          {item.description}
                        </p>
                      )}
                    </div>

                    {/* Price & Action */}
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-baseline gap-0.5">
                        <span className="text-base font-bold text-[#d4af37]">{priceFormatted}</span>
                        <span className="text-xs font-semibold text-[#d4af37]">₼</span>
                      </div>
                      <button
                        type="button"
                        className="rounded-full bg-[#1b2234] p-1.5 text-slate-300 transition-colors group-hover:bg-[#d4af37] group-hover:text-slate-950"
                      >
                        <ChevronRight className="h-4 w-4" />
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
        <div className="fixed bottom-4 inset-x-4 z-40 mx-auto max-w-md animate-slide-up">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#d4af37]/40 bg-[#0d121e]/95 p-2 shadow-2xl backdrop-blur-xl">
            {/* Call Waiter Button */}
            <button
              type="button"
              onClick={handleCallWaiter}
              disabled={waiterCooldown > 0}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold uppercase tracking-wider transition-all ${
                waiterCooldown > 0
                  ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-[#d4af37] to-[#b89528] text-slate-950 shadow-lg hover:brightness-110 active:scale-95'
              }`}
            >
              <BellRing className="h-4 w-4" />
              <span>{waiterCooldown > 0 ? `${waiterCooldown}s` : TX.callWaiter[lang]}</span>
            </button>

            {/* Request Bill Button */}
            <button
              type="button"
              onClick={() => setBillModalOpen(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-[#161c2c] py-3 text-xs font-bold uppercase tracking-wider text-slate-100 transition-all hover:border-[#d4af37]/60 hover:text-[#d4af37] active:scale-95"
            >
              <Receipt className="h-4 w-4 text-[#d4af37]" />
              <span>{TX.requestBill[lang]}</span>
            </button>
          </div>
        </div>
      )}

      {/* ─── Dish Detail Modal (Popup) ────────────────────────────────────────── */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-0 sm:p-4 backdrop-blur-md animate-fade-in">
          <div
            className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-slate-800 bg-[#0e1320] p-6 shadow-2xl animate-slide-up text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setSelectedItem(null)}
              className="absolute right-4 top-4 z-10 rounded-full bg-black/60 p-2 text-slate-300 hover:text-white backdrop-blur-sm"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Modal Image */}
            <div className="relative mb-5 h-64 w-full overflow-hidden rounded-2xl bg-[#161d2f]">
              {selectedItem.image_url ? (
                <img
                  src={resolveImageUrl(selectedItem.image_url)}
                  alt={selectedItem.item_name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-6xl opacity-30">
                  {getCategoryIcon(selectedItem.category)}
                </div>
              )}
            </div>

            {/* Title & Category Badge */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-block rounded-md bg-[#d4af37]/15 px-2.5 py-1 text-xs font-bold text-[#d4af37]">
                  {selectedItem.category}
                </span>
                <h2 className="mt-2 font-serif text-2xl font-bold text-slate-50">
                  {selectedItem.item_name}
                </h2>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-[#d4af37]">
                  {Number(selectedItem.price || 0).toFixed(2)}
                </span>
                <span className="text-sm font-bold text-[#d4af37]"> ₼</span>
              </div>
            </div>

            {/* Description & Ingredients */}
            {selectedItem.description && (
              <div className="mt-4 rounded-xl border border-slate-800 bg-[#141a2a] p-4 text-sm text-slate-300 leading-relaxed">
                <div className="mb-1 text-xs font-bold uppercase tracking-wider text-[#d4af37]">
                  {TX.ingredients[lang]}
                </div>
                <p>{selectedItem.description}</p>
              </div>
            )}

            {/* Close Button */}
            <button
              type="button"
              onClick={() => setSelectedItem(null)}
              className="mt-6 w-full rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b89528] py-3 text-sm font-bold uppercase tracking-wider text-slate-950 shadow-lg hover:brightness-110"
            >
              {TX.close[lang]}
            </button>
          </div>
        </div>
      )}

      {/* ─── Wi-Fi Info Modal ─────────────────────────────────────────────────── */}
      {wifiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-sm rounded-3xl border border-[#d4af37]/40 bg-[#0e1320] p-6 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#d4af37]/10 text-[#d4af37]">
              <Wifi className="h-7 w-7" />
            </div>
            <h3 className="font-serif text-lg font-bold text-slate-50">{TX.wifiInfo[lang]}</h3>

            <div className="mt-4 space-y-3 rounded-2xl border border-slate-800 bg-[#131929] p-4 text-left text-sm">
              {wifiSsid && (
                <div>
                  <span className="text-xs text-slate-400">{TX.wifiNetwork[lang]}</span>
                  <div className="font-mono font-semibold text-slate-100">{wifiSsid}</div>
                </div>
              )}
              {wifiPassword && (
                <div>
                  <span className="text-xs text-slate-400">{TX.wifiPass[lang]}</span>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="font-mono font-bold text-[#d4af37]">{wifiPassword}</span>
                    <button
                      type="button"
                      onClick={copyWifiPassword}
                      className="flex items-center gap-1 rounded-lg bg-[#1e263d] px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-[#d4af37] hover:text-slate-950 transition-colors"
                    >
                      {copiedWifi ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedWifi ? TX.copied[lang] : TX.copy[lang]}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setWifiModalOpen(false)}
              className="mt-5 w-full rounded-xl bg-slate-800 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700"
            >
              {TX.close[lang]}
            </button>
          </div>
        </div>
      )}

      {/* ─── Bill Request Modal ──────────────────────────────────────────────── */}
      {billModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-[#0e1320] p-6 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#d4af37]/10 text-[#d4af37]">
              <Receipt className="h-7 w-7" />
            </div>
            <h3 className="font-serif text-lg font-bold text-slate-50">{TX.requestBill[lang]}</h3>
            <p className="mt-1 text-xs text-slate-400">{TX.choosePayment[lang]}</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setBillPaymentMethod('cash')}
                className={`rounded-2xl border p-4 text-center transition-all ${
                  billPaymentMethod === 'cash'
                    ? 'border-[#d4af37] bg-[#d4af37]/10 text-[#d4af37] font-bold shadow-lg'
                    : 'border-slate-800 bg-[#131929] text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="text-2xl mb-1">💵</div>
                <div className="text-xs font-semibold">{TX.cash[lang]}</div>
              </button>

              <button
                type="button"
                onClick={() => setBillPaymentMethod('card')}
                className={`rounded-2xl border p-4 text-center transition-all ${
                  billPaymentMethod === 'card'
                    ? 'border-[#d4af37] bg-[#d4af37]/10 text-[#d4af37] font-bold shadow-lg'
                    : 'border-slate-800 bg-[#131929] text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="text-2xl mb-1">💳</div>
                <div className="text-xs font-semibold">{TX.card[lang]}</div>
              </button>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setBillModalOpen(false)}
                className="flex-1 rounded-xl bg-slate-800 py-3 text-xs font-bold uppercase tracking-wider text-slate-300 hover:bg-slate-700"
              >
                {TX.close[lang]}
              </button>
              <button
                type="button"
                onClick={handleRequestBill}
                className="flex-1 rounded-xl bg-gradient-to-r from-[#d4af37] to-[#b89528] py-3 text-xs font-bold uppercase tracking-wider text-slate-950 shadow-lg hover:brightness-110"
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
