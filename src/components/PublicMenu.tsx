import React from 'react';
import { get_public_menu_live } from '../api/menu';
import { get_public_qr_menu_bootstrap_live } from '../api/settings';
import { Search, X, ChevronLeft, Clock, MapPin, Phone } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────
interface MenuItem {
  id: string;
  item_name: string;
  category: string;
  price: number;
  description?: string;
  image_url?: string;
  is_coffee?: boolean;
  sort_order?: number;
}

interface Branding {
  company_name: string;
  logo_url: string;
  hero_title: string;
  hero_subtitle: string;
  background_color: string;
  surface_color: string;
  text_color: string;
  hero_image_url: string;
  poster_image_url: string;
  poster_background_color: string;
  logo_shape: string;
  primary_color: string;
  accent_color: string;
  font_family: string;
  custom_font_url: string;
  theme_preset: string;
  layout_preset: string;
  phone: string;
  address: string;
}

type View = 'home' | 'categories' | 'products';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Resolve relative image URLs (e.g. /uploads/...) to full backend URL */
function resolveImageUrl(url: string): string {
  if (!url) return '';
  // Already absolute or data URL
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  // Relative path — prepend API base
  try {
    const env = ((import.meta as any)?.env || {}) as Record<string, string | undefined>;
    const base = String(env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
    if (base) return `${base}${url}`;
  } catch { /* ignore */ }
  return url;
}

// Simple translation helper
function tx(lang: 'az' | 'ru' | 'en', az: string, ru: string, en: string): string {
  if (lang === 'ru') return ru;
  if (lang === 'en') return en;
  return az;
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function PublicMenu() {
  const [loading, setLoading] = React.useState(true);
  const [menuItems, setMenuItems] = React.useState<MenuItem[]>([]);
  const [bootstrap, setBootstrap] = React.useState<any | null>(null);
  
  // View states (for classic mode)
  const [view, setView] = React.useState<View>('home');
  const [activeCategory, setActiveCategory] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);

  // Interactive detail modal state
  const [selectedItem, setSelectedItem] = React.useState<MenuItem | null>(null);

  // Language state
  const [lang, setLang] = React.useState<'az' | 'ru' | 'en'>(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const initialLang = (searchParams.get('lang') || localStorage.getItem('lang') || 'az').toLowerCase();
      return ['az', 'ru', 'en'].includes(initialLang) ? (initialLang as any) : 'az';
    } catch {
      return 'az';
    }
  });

  const changeLanguage = (newLang: 'az' | 'ru' | 'en') => {
    setLang(newLang);
    try {
      localStorage.setItem('lang', newLang);
    } catch { /* ignore */ }
  };

  React.useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'auto';
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [menu, brand] = await Promise.all([
          get_public_menu_live(),
          get_public_qr_menu_bootstrap_live().catch(() => null),
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
  }, []);

  // ─── Branding & Customizations ─────────────────────────────────────────────
  const branding: Partial<Branding> = bootstrap?.branding || {};
  const showPrices = bootstrap?.show_prices !== false;
  const showImages = bootstrap?.show_images !== false;
  const showDescriptions = bootstrap?.show_descriptions !== false;

  const companyName = String(branding.company_name || 'iRonWaves Menu');
  const logoUrl = String(branding.logo_url || '');
  const logoShape = String(branding.logo_shape || 'rounded');
  const fontFamily = String(branding.font_family || '');
  const customFontUrl = String(branding.custom_font_url || '');
  const phone = String(branding.phone || '');
  const address = String(branding.address || '');

  // Presets
  const themePreset = String((branding as any).theme_preset || 'dark').toLowerCase();
  const layoutPreset = String((branding as any).layout_preset || 'classic').toLowerCase();

  // Curated preset palettes
  const primaryColor = React.useMemo(() => {
    if (themePreset === 'dark') return '#06b6d4'; // Cyan-500
    if (themePreset === 'light') return '#10b981'; // Emerald-500
    if (themePreset === 'emerald') return '#fbbf24'; // Gold
    return String(branding.primary_color || '#facc15');
  }, [themePreset, branding.primary_color]);

  const accentColor = React.useMemo(() => {
    if (themePreset === 'dark') return '#06b6d4';
    if (themePreset === 'light') return '#10b981';
    if (themePreset === 'emerald') return '#fbbf24';
    return String(branding.accent_color || '#facc15');
  }, [themePreset, branding.accent_color]);

  const backgroundColor = React.useMemo(() => {
    if (themePreset === 'dark') return '#090d16'; // Deep Slate
    if (themePreset === 'light') return '#f8fafc'; // White/Slate-50
    if (themePreset === 'emerald') return '#022c22'; // Deep Green
    return String(branding.background_color || '#0a0a0a');
  }, [themePreset, branding.background_color]);

  const surfaceColor = React.useMemo(() => {
    if (themePreset === 'dark') return '#151c2c'; // Card Slate
    if (themePreset === 'light') return '#ffffff'; // White Card
    if (themePreset === 'emerald') return '#064e3b'; // Forest Card
    return String(branding.surface_color || '#161616');
  }, [themePreset, branding.surface_color]);

  const textColor = React.useMemo(() => {
    if (themePreset === 'dark') return '#f8fafc';
    if (themePreset === 'light') return '#0f172a';
    if (themePreset === 'emerald') return '#f0fdf4';
    return String(branding.text_color || '#ffffff');
  }, [themePreset, branding.text_color]);

  const heroImageUrl = String(branding.hero_image_url || '');
  const heroTitle = String(branding.hero_title || companyName);
  const heroSubtitle = String(branding.hero_subtitle || '');

  // ─── Font Loading ────────────────────────────────────────────────────────
  const resolvedFontFamily = React.useMemo(() => {
    if (!fontFamily || fontFamily === 'custom') {
      return customFontUrl ? 'CustomQRFont, system-ui, sans-serif' : '"Geist Sans", "Inter", system-ui, -apple-system, sans-serif';
    }
    return `"${fontFamily}", system-ui, sans-serif`;
  }, [fontFamily, customFontUrl]);

  React.useEffect(() => {
    if (!fontFamily && !customFontUrl) return;
    const fontUrl = fontFamily === 'custom'
      ? customFontUrl
      : fontFamily
        ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@400;500;600;700;800;900&display=swap`
        : '';
    if (!fontUrl) return;
    const existing = document.querySelector(`link[href="${fontUrl}"]`);
    if (existing) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontUrl;
    link.setAttribute('data-qr-font', 'true');
    document.head.appendChild(link);
    return () => { if (link.parentNode) link.parentNode.removeChild(link); };
  }, [fontFamily, customFontUrl]);

  // ─── Categories ──────────────────────────────────────────────────────────
  const categories = React.useMemo(() => {
    const unique = Array.from(
      new Set(menuItems.map((item) => String(item.category || '').trim()).filter(Boolean))
    );
    return unique;
  }, [menuItems]);

  // Category image: use first item with image in that category
  const categoryImages = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of menuItems) {
      const cat = String(item.category || '').trim();
      if (cat && item.image_url && !map[cat]) {
        map[cat] = String(item.image_url);
      }
    }
    return map;
  }, [menuItems]);

  // ─── Scroll Spy Category Tracking (Bolt mode) ──────────────────────────────
  React.useEffect(() => {
    if (layoutPreset !== 'bolt' || search.trim() !== '') return;
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 140; // Offset for sticky header
      let active = categories[0] || '';
      for (const cat of categories) {
        const el = document.getElementById(`category-sec-${cat}`);
        if (el) {
          const top = el.offsetTop;
          const height = el.offsetHeight;
          if (scrollPosition >= top && scrollPosition < top + height) {
            active = cat;
            break;
          }
        }
      }
      if (active && active !== activeCategory) {
        setActiveCategory(active);
        const tabEl = document.getElementById(`tab-btn-${active}`);
        if (tabEl) {
          tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [layoutPreset, categories, search, activeCategory]);

  // ─── Filtered Items (Classic mode) ─────────────────────────────────────────
  const filteredItems = React.useMemo(() => {
    if (searchOpen && search.trim()) {
      const hay = search.trim().toLowerCase();
      return menuItems.filter((item) => {
        const text = `${String(item.item_name || '')} ${String(item.category || '')} ${String(item.description || '')}`.toLowerCase();
        return text.includes(hay);
      });
    }
    if (!activeCategory) return [];
    return menuItems.filter((item) => String(item.category || '').trim() === activeCategory);
  }, [menuItems, activeCategory, search, searchOpen]);

  // ─── Navigation ──────────────────────────────────────────────────────────
  const goHome = () => { setView('home'); setActiveCategory(''); setSearch(''); setSearchOpen(false); };
  const goCategories = () => { setView('categories'); setActiveCategory(''); setSearch(''); setSearchOpen(false); };
  const goCategory = (cat: string) => { setActiveCategory(cat); setView('products'); setSearch(''); setSearchOpen(false); };

  // ─── Shared wrapper ──────────────────────────────────────────────────────
  const shell = (children: React.ReactNode) => (
    <div
      className="relative min-h-dvh overflow-x-hidden overflow-y-auto overscroll-contain flex flex-col justify-between"
      style={{ background: backgroundColor, color: textColor, fontFamily: resolvedFontFamily }}
    >
      {/* Ambient liquid blobs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -left-20 -top-20 h-72 w-72 rounded-full opacity-35 blur-[100px]"
          style={{ background: primaryColor }}
        />
        <div
          className="absolute -bottom-32 -right-20 h-80 w-80 rounded-full opacity-20 blur-[120px]"
          style={{ background: accentColor }}
        />
      </div>
      <div className="relative z-10 flex flex-col min-h-dvh">
        {children}

        {/* Language switch controls */}
        <footer className="mt-auto px-6 py-8 text-center border-t border-white/5" style={{ background: hexToRgba(surfaceColor, 0.2) }}>
          <div className="flex justify-center items-center gap-4 mb-4">
            {(['az', 'ru', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => changeLanguage(l)}
                className={`text-[12px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border transition ${lang === l ? 'border-white/20 bg-white/10 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <p className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
            Powered by iRonWaves
          </p>
        </footer>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BOLT FOOD LAYOUT (Single page)
  // ═══════════════════════════════════════════════════════════════════════════
  if (layoutPreset === 'bolt') {
    return shell(
      <>
        {/* Top Cover Banner */}
        <div className="relative w-full h-[220px] sm:h-[300px] overflow-hidden bg-slate-950">
          {heroImageUrl ? (
            <img src={heroImageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div
              className="w-full h-full"
              style={{ background: `linear-gradient(135deg, ${hexToRgba(primaryColor, 0.35)} 0%, ${hexToRgba(accentColor, 0.15)} 100%)` }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        </div>

        {/* Brand Header Details */}
        <div className="relative px-4 sm:px-6 -mt-16 z-20">
          <div
            className="rounded-3xl border border-white/10 p-5 sm:p-6 shadow-2xl backdrop-blur-xl"
            style={{ backgroundColor: hexToRgba(surfaceColor, 0.85) }}
          >
            <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={companyName}
                  className={`h-20 w-20 shrink-0 object-cover shadow-lg border-2 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-2xl' : 'rounded-3xl'}`}
                  style={{ borderColor: hexToRgba(primaryColor, 0.4) }}
                />
              ) : (
                <div
                  className={`flex h-20 w-20 shrink-0 items-center justify-center text-xl font-black shadow-lg border-2 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-2xl' : 'rounded-3xl'}`}
                  style={{ background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`, color: '#000', borderColor: hexToRgba(primaryColor, 0.4) }}
                >
                  {companyName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex-1">
                <h1 className="text-2xl font-black tracking-tight" style={{ color: textColor }}>
                  {heroTitle}
                </h1>
                {heroSubtitle && (
                  <p className="mt-1 text-sm" style={{ color: hexToRgba(textColor, 0.6) }}>
                    {heroSubtitle}
                  </p>
                )}

                {/* Metadata icons */}
                <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4 text-xs font-medium text-slate-400">
                  {phone && (
                    <a href={`tel:${phone}`} className="flex items-center gap-1.5 hover:text-white transition">
                      <Phone size={13} className="text-slate-500" />
                      {phone}
                    </a>
                  )}
                  {address && (
                    <div className="flex items-center gap-1.5">
                      <MapPin size={13} className="text-slate-500" />
                      <span className="truncate max-w-[200px]">{address}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Clock size={13} className="text-slate-500" />
                    <span>{tx(lang, 'Aktivdir', 'Активно', 'Active')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Controls Panel (Search & Category Tabs) */}
        <div className="sticky top-0 z-30 mt-6 pt-2 backdrop-blur-xl border-y border-white/5" style={{ background: hexToRgba(backgroundColor, 0.9) }}>
          {/* Search Input */}
          <div className="px-4 pb-2 max-w-lg mx-auto">
            <div
              className="flex items-center gap-2 rounded-2xl px-4 py-3 border transition"
              style={{ backgroundColor: hexToRgba(surfaceColor, 0.6), borderColor: hexToRgba(textColor, 0.08) }}
            >
              <Search size={16} style={{ color: hexToRgba(textColor, 0.4) }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tx(lang, 'Yemək və ya kateqoriya axtar...', 'Поиск блюда или категории...', 'Search dish or category...')}
                className="w-full bg-transparent text-[14px] font-medium outline-none"
                style={{ color: textColor }}
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Təmizlə">
                  <X size={15} style={{ color: hexToRgba(textColor, 0.5) }} />
                </button>
              )}
            </div>
          </div>

          {/* Horizontal category tabs */}
          {search.trim() === '' && (
            <div className="flex overflow-x-auto gap-2 py-3 px-4 no-scrollbar max-w-2xl mx-auto">
              {categories.map((cat) => (
                <button
                  key={cat}
                  id={`tab-btn-${cat}`}
                  type="button"
                  onClick={() => {
                    setActiveCategory(cat);
                    const el = document.getElementById(`category-sec-${cat}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }}
                  className={`rounded-full px-4 py-2 text-xs font-extrabold uppercase tracking-wider transition-all whitespace-nowrap active:scale-95`}
                  style={{
                    backgroundColor: activeCategory === cat ? primaryColor : hexToRgba(surfaceColor, 0.6),
                    color: activeCategory === cat ? '#000' : textColor,
                    boxShadow: activeCategory === cat ? `0 4px 12px ${hexToRgba(primaryColor, 0.25)}` : 'none',
                    border: `1px solid ${activeCategory === cat ? 'transparent' : hexToRgba(textColor, 0.05)}`
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Continuous Products Feed */}
        <main className="mx-auto w-full max-w-2xl px-4 mt-6">
          {categories.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-24 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(primaryColor, 0.1) }}>
                <Search size={24} style={{ color: hexToRgba(textColor, 0.3) }} />
              </div>
              <p className="text-[14px] font-medium" style={{ color: hexToRgba(textColor, 0.5) }}>
                {tx(lang, 'Menyuda hələ ki məhsul yoxdur', 'В меню пока нет товаров', 'No items in the menu yet')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-10 mt-2 pb-16">
              {categories.map((cat) => {
                const catItems = menuItems.filter((item) => String(item.category || '').trim() === cat);
                let matched = catItems;
                if (search.trim()) {
                  const hay = search.trim().toLowerCase();
                  matched = catItems.filter((item) => {
                    return `${String(item.item_name || '')} ${String(item.category || '')} ${String(item.description || '')}`.toLowerCase().includes(hay);
                  });
                  if (matched.length === 0) return null;
                }

                return (
                  <section key={cat} id={`category-sec-${cat}`} className="scroll-mt-36">
                    {/* Category Title Header */}
                    <div className="flex items-center gap-3 mb-4">
                      <h2 className="text-[16px] sm:text-[18px] font-black uppercase tracking-widest" style={{ color: textColor }}>
                        {cat}
                      </h2>
                      <div className="h-[1px] flex-1 bg-white/5" />
                    </div>

                    {/* Products Grid */}
                    <div className="grid gap-3 md:grid-cols-2">
                      {matched.map((item) => (
                        <ProductCard
                          key={item.id}
                          item={item}
                          showPrices={showPrices}
                          showImages={showImages}
                          showDescriptions={showDescriptions}
                          primaryColor={primaryColor}
                          accentColor={accentColor}
                          surfaceColor={surfaceColor}
                          textColor={textColor}
                          backgroundColor={backgroundColor}
                          layoutPreset="bolt"
                          onClick={() => setSelectedItem(item)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </main>

        {/* Item Detail Modal */}
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => setSelectedItem(null)}
            />
            <div
              className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-white/10 shadow-2xl"
              style={{ backgroundColor: surfaceColor, color: textColor }}
            >
              <button
                type="button"
                className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition hover:bg-black/75"
                onClick={() => setSelectedItem(null)}
              >
                <X size={20} />
              </button>

              {selectedItem.image_url && showImages ? (
                <div className="aspect-[16/10] w-full overflow-hidden">
                  <img
                    src={resolveImageUrl(selectedItem.image_url)}
                    alt={selectedItem.item_name}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div
                  className="flex aspect-[16/10] w-full items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${hexToRgba(primaryColor, 0.1)}, ${hexToRgba(accentColor, 0.05)})` }}
                >
                  <span className="text-5xl">🍽️</span>
                </div>
              )}

              <div className="p-6">
                {selectedItem.category && (
                  <span
                    className="inline-block rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide mb-2"
                    style={{ backgroundColor: hexToRgba(primaryColor, 0.15), color: primaryColor }}
                  >
                    {selectedItem.category}
                  </span>
                )}
                <h2 className="text-xl font-bold leading-snug">{selectedItem.item_name}</h2>
                
                {selectedItem.description && showDescriptions && (
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: hexToRgba(textColor, 0.6) }}>
                    {selectedItem.description}
                  </p>
                )}

                <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {tx(lang, 'Qiymət', 'Цена', 'Price')}
                    </div>
                    <div className="text-2xl font-black mt-1" style={{ color: primaryColor }}>
                      {Number(selectedItem.price || 0).toFixed(2)} ₼
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedItem(null)}
                    className="rounded-xl px-5 py-2.5 text-sm font-bold shadow-md transition active:scale-95"
                    style={{ backgroundColor: primaryColor, color: '#000' }}
                  >
                    {tx(lang, 'Bağla', 'Закрыть', 'Close')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLASSIC VIEW (Original multi-step layout)
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'home') {
    return shell(
      <div className="relative flex min-h-dvh flex-col justify-center">
        {/* Background hero image banner */}
        {heroImageUrl ? (
          <>
            <img src={heroImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${hexToRgba(backgroundColor, 0.2)} 0%, ${hexToRgba(backgroundColor, 0.6)} 50%, ${hexToRgba(backgroundColor, 0.95)} 100%)` }} />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 30%, ${hexToRgba(primaryColor, 0.08)} 0%, transparent 60%), ${backgroundColor}` }} />
        )}

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          {/* Logo shape config */}
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={companyName}
              className={`h-24 w-24 object-cover shadow-2xl sm:h-28 sm:w-28 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-2xl' : 'rounded-3xl'}`}
              style={{ border: `3px solid ${hexToRgba(primaryColor, 0.3)}`, boxShadow: `0 12px 40px ${hexToRgba(primaryColor, 0.2)}` }}
            />
          ) : (
            <div
              className={`relative flex h-24 w-24 items-center justify-center overflow-hidden text-2xl font-black shadow-2xl sm:h-28 sm:w-28 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-2xl' : 'rounded-3xl'}`}
              style={{ background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`, color: '#000' }}
            >
              {companyName.slice(0, 2).toUpperCase()}
            </div>
          )}

          <h1 className="mt-6 text-3xl font-extrabold leading-tight sm:text-4xl" style={{ color: textColor }}>
            {heroTitle}
          </h1>

          {heroSubtitle && (
            <p className="mt-3 max-w-xs text-[15px] leading-relaxed" style={{ color: hexToRgba(textColor, 0.6) }}>
              {heroSubtitle}
            </p>
          )}

          <button
            type="button"
            onClick={goCategories}
            className="relative mt-8 overflow-hidden rounded-2xl px-10 py-4 text-[15px] font-bold tracking-wide transition-transform active:scale-95"
            style={{
              background: primaryColor,
              color: '#000',
              boxShadow: `0 8px 32px ${hexToRgba(primaryColor, 0.35)}`,
            }}
          >
            {tx(lang, 'Menyuya Bax', 'Смотреть меню', 'View Menu')}
          </button>
        </div>
      </div>
    );
  }

  if (view === 'categories') {
    return shell(
      <>
        <header
          className="sticky top-0 z-40 flex items-center gap-3 px-5 py-4"
          style={{ background: hexToRgba(backgroundColor, 0.92), backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
        >
          <button
            type="button"
            onClick={goHome}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ backgroundColor: hexToRgba(textColor, 0.08) }}
            aria-label="Geri"
          >
            <ChevronLeft size={20} style={{ color: textColor }} />
          </button>
          <h2 className="flex-1 text-lg font-bold" style={{ color: textColor }}>{tx(lang, 'Kateqoriyalar', 'Категории', 'Categories')}</h2>
          <button
            type="button"
            onClick={() => { setSearchOpen(true); setView('products'); }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ backgroundColor: hexToRgba(textColor, 0.08) }}
            aria-label="Axtar"
          >
            <Search size={18} style={{ color: textColor }} />
          </button>
        </header>

        <main className="mx-auto max-w-lg px-5 pb-10 pt-2">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => goCategory(cat)}
                className="group relative overflow-hidden rounded-2xl text-left transition-transform active:scale-[0.97]"
                style={{
                  backgroundColor: hexToRgba(surfaceColor, 0.7),
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: `1px solid ${hexToRgba(textColor, 0.06)}`,
                }}
              >
                <div className="aspect-[4/3] w-full overflow-hidden">
                  {categoryImages[cat] && showImages ? (
                    <img
                      src={resolveImageUrl(categoryImages[cat])}
                      alt={cat}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center"
                      style={{ background: `linear-gradient(135deg, ${hexToRgba(primaryColor, 0.1)}, ${hexToRgba(accentColor, 0.05)})` }}
                    >
                      <span className="text-3xl">🍽️</span>
                    </div>
                  )}
                </div>
                <div className="px-3 py-3">
                  <p className="text-[13px] font-bold uppercase tracking-wide" style={{ color: textColor }}>
                    {cat}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </main>
      </>
    );
  }

  // Classic Products view
  return shell(
    <>
      <header
        className="sticky top-0 z-40 px-5 py-3"
        style={{ background: hexToRgba(backgroundColor, 0.92), backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goCategories}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ backgroundColor: hexToRgba(textColor, 0.08) }}
            aria-label="Geri"
          >
            <ChevronLeft size={20} style={{ color: textColor }} />
          </button>

          {searchOpen ? (
            <div
              className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2"
              style={{ backgroundColor: hexToRgba(textColor, 0.06), border: `1px solid ${hexToRgba(textColor, 0.08)}` }}
            >
              <Search size={16} style={{ color: hexToRgba(textColor, 0.4) }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tx(lang, 'Axtar...', 'Поиск...', 'Search...')}
                className="w-full bg-transparent text-[14px] font-medium outline-none"
                style={{ color: textColor }}
                autoFocus
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Təmizlə">
                  <X size={14} style={{ color: hexToRgba(textColor, 0.5) }} />
                </button>
              )}
            </div>
          ) : (
            <>
              <h2 className="flex-1 truncate text-lg font-bold" style={{ color: textColor }}>
                {activeCategory || tx(lang, 'Axtarış', 'Поиск', 'Search')}
              </h2>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
                style={{ backgroundColor: hexToRgba(textColor, 0.08) }}
                aria-label="Axtar"
              >
                <Search size={18} style={{ color: textColor }} />
              </button>
            </>
          )}
        </div>
      </header>

      {!searchOpen && activeCategory && categoryImages[activeCategory] && showImages && (
        <div className="relative mx-5 mt-2 overflow-hidden rounded-2xl">
          <div className="aspect-[21/9] w-full overflow-hidden">
            <img
              src={resolveImageUrl(categoryImages[activeCategory])}
              alt={activeCategory}
              className="h-full w-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(to top, ${hexToRgba(backgroundColor, 0.8)} 0%, transparent 60%)` }}
            />
          </div>
          <div className="absolute inset-x-0 bottom-0 px-5 pb-4">
            <h3 className="text-xl font-extrabold uppercase tracking-wide" style={{ color: textColor }}>
              {activeCategory}
            </h3>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-lg px-5 pb-10 pt-4">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(primaryColor, 0.1) }}>
              <Search size={24} style={{ color: hexToRgba(textColor, 0.3) }} />
            </div>
            <p className="text-[14px] font-medium" style={{ color: hexToRgba(textColor, 0.5) }}>
              {tx(lang, 'Məhsul tapılmadı', 'Товары не найдены', 'No items found')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filteredItems.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                showPrices={showPrices}
                showImages={showImages}
                showDescriptions={showDescriptions}
                primaryColor={primaryColor}
                accentColor={accentColor}
                surfaceColor={surfaceColor}
                textColor={textColor}
                backgroundColor={backgroundColor}
                onClick={() => setSelectedItem(item)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Item Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            onClick={() => setSelectedItem(null)}
          />
          <div
            className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-white/10 shadow-2xl"
            style={{ backgroundColor: surfaceColor, color: textColor }}
          >
            <button
              type="button"
              className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition hover:bg-black/75"
              onClick={() => setSelectedItem(null)}
            >
              <X size={20} />
            </button>

            {selectedItem.image_url && showImages ? (
              <div className="aspect-[16/10] w-full overflow-hidden">
                <img
                  src={resolveImageUrl(selectedItem.image_url)}
                  alt={selectedItem.item_name}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div
                className="flex aspect-[16/10] w-full items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${hexToRgba(primaryColor, 0.15)}, ${hexToRgba(accentColor, 0.05)})` }}
              >
                <span className="text-5xl">🍽️</span>
              </div>
            )}

            <div className="p-6">
              {selectedItem.category && (
                <span
                  className="inline-block rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide mb-2"
                  style={{ backgroundColor: hexToRgba(primaryColor, 0.15), color: primaryColor }}
                >
                  {selectedItem.category}
                </span>
              )}
              <h2 className="text-xl font-bold leading-snug">{selectedItem.item_name}</h2>
              
              {selectedItem.description && showDescriptions && (
                <p className="mt-3 text-sm leading-relaxed" style={{ color: hexToRgba(textColor, 0.6) }}>
                  {selectedItem.description}
                </p>
              )}

              <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {tx(lang, 'Qiymət', 'Цена', 'Price')}
                  </div>
                  <div className="text-2xl font-black mt-1" style={{ color: primaryColor }}>
                    {Number(selectedItem.price || 0).toFixed(2)} ₼
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="rounded-xl px-5 py-2.5 text-sm font-bold shadow-md transition active:scale-95"
                  style={{ backgroundColor: primaryColor, color: '#000' }}
                >
                  {tx(lang, 'Bağla', 'Закрыть', 'Close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Product Card ────────────────────────────────────────────────────────────
function ProductCard({
  item,
  showPrices,
  showImages,
  showDescriptions,
  primaryColor,
  accentColor,
  surfaceColor,
  textColor,
  backgroundColor,
  layoutPreset,
  onClick,
}: {
  item: MenuItem;
  showPrices: boolean;
  showImages: boolean;
  showDescriptions: boolean;
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  textColor: string;
  backgroundColor: string;
  layoutPreset?: string;
  onClick?: () => void;
}) {
  const hasImage = showImages && Boolean(item.image_url);
  const isBolt = layoutPreset === 'bolt';

  const imagePart = hasImage ? (
    <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl sm:h-28 sm:w-28 shadow-sm">
      <img
        src={resolveImageUrl(String(item.image_url))}
        alt={String(item.item_name || '')}
        className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
        loading="lazy"
      />
      {item.is_coffee && (
        <div
          className="absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold"
          style={{ backgroundColor: accentColor, color: '#000' }}
        >
          ☕
        </div>
      )}
    </div>
  ) : null;

  const contentPart = (
    <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
      <div className="min-w-0">
        <h3
          className="text-[15px] font-bold leading-snug sm:text-[16px] group-hover:text-cyan-300 transition-colors"
          style={{ color: textColor }}
        >
          {item.item_name}
        </h3>
        {showDescriptions && item.description && (
          <p
            className="mt-1 line-clamp-2 text-[12px] leading-[1.5] sm:text-[13px]"
            style={{ color: hexToRgba(textColor, 0.5) }}
          >
            {item.description}
          </p>
        )}
      </div>
      {showPrices && (
        <div className="mt-2">
          <span
            className="text-[15px] font-extrabold sm:text-[16px]"
            style={{ color: primaryColor }}
          >
            {Number(item.price || 0).toFixed(2)} ₼
          </span>
        </div>
      )}
    </div>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex gap-3 text-left w-full overflow-hidden rounded-2xl p-3 transition-all hover:translate-y-[-2px] active:scale-[0.985]"
      style={{
        backgroundColor: hexToRgba(surfaceColor, 0.7),
        boxShadow: `0 4px 20px ${hexToRgba(backgroundColor, 0.3)}, inset 0 1px 0 ${hexToRgba(textColor, 0.05)}`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${hexToRgba(textColor, 0.06)}`,
      }}
    >
      {isBolt ? (
        <>
          {contentPart}
          {imagePart}
        </>
      ) : (
        <>
          {imagePart || (
            <div
              className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl sm:h-28 sm:w-28 shadow-inner"
              style={{ background: `linear-gradient(135deg, ${hexToRgba(primaryColor, 0.08)}, ${hexToRgba(accentColor, 0.04)})` }}
            >
              <span className="text-2xl">🍽️</span>
            </div>
          )}
          {contentPart}
        </>
      )}
    </button>
  );
}
