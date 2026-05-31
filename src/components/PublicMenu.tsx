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

// ─── Component ───────────────────────────────────────────────────────────────
export default function PublicMenu() {
  const [loading, setLoading] = React.useState(true);
  const [menuItems, setMenuItems] = React.useState<MenuItem[]>([]);
  const [bootstrap, setBootstrap] = React.useState<any | null>(null);
  const [view, setView] = React.useState<View>('home');
  const [activeCategory, setActiveCategory] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);

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

  // ─── Branding ────────────────────────────────────────────────────────────
  const branding: Partial<Branding> = bootstrap?.branding || {};
  const showPrices = bootstrap?.show_prices !== false;
  const showImages = bootstrap?.show_images !== false;
  const showDescriptions = bootstrap?.show_descriptions !== false;

  const companyName = String(branding.company_name || 'iRonWaves Menu');
  const logoUrl = String(branding.logo_url || '');
  const primaryColor = String(branding.primary_color || '#facc15');
  const accentColor = String(branding.accent_color || '#facc15');
  const backgroundColor = String(branding.background_color || '#0a0a0a');
  const surfaceColor = String(branding.surface_color || '#161616');
  const textColor = String(branding.text_color || '#ffffff');
  const heroImageUrl = String(branding.hero_image_url || '');
  const heroTitle = String(branding.hero_title || companyName);
  const heroSubtitle = String(branding.hero_subtitle || '');
  const logoShape = String(branding.logo_shape || 'rounded');
  const fontFamily = String(branding.font_family || '');
  const customFontUrl = String(branding.custom_font_url || '');

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

  // ─── Filtered Items ──────────────────────────────────────────────────────
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

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ background: backgroundColor }}>
        <div className="flex flex-col items-center gap-5">
          <div className="relative h-12 w-12">
            <div
              className="absolute inset-0 animate-spin rounded-full border-[3px] border-t-transparent"
              style={{ borderColor: hexToRgba(primaryColor, 0.2), borderTopColor: primaryColor }}
            />
          </div>
          <p className="text-[13px] font-medium tracking-wide" style={{ color: hexToRgba(textColor, 0.4) }}>
            Menyu yüklənir...
          </p>
        </div>
      </div>
    );
  }

  // ─── Shared wrapper ──────────────────────────────────────────────────────
  const shell = (children: React.ReactNode) => (
    <div
      className="relative min-h-dvh overflow-x-hidden overflow-y-auto overscroll-contain"
      style={{ background: backgroundColor, color: textColor, fontFamily: resolvedFontFamily }}
    >
      {children}
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // HOME VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'home') {
    return shell(
      <>
        {/* Full-screen hero */}
        <div className="relative flex min-h-dvh flex-col">
          {/* Background */}
          {heroImageUrl ? (
            <>
              <img src={heroImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${hexToRgba(backgroundColor, 0.2)} 0%, ${hexToRgba(backgroundColor, 0.6)} 50%, ${hexToRgba(backgroundColor, 0.95)} 100%)` }} />
            </>
          ) : (
            <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 30%, ${hexToRgba(primaryColor, 0.08)} 0%, transparent 60%), ${backgroundColor}` }} />
          )}

          {/* Content */}
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
            {/* Logo */}
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName}
                className={`h-24 w-24 object-cover shadow-2xl sm:h-28 sm:w-28 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-2xl' : 'rounded-3xl'}`}
                style={{ border: `3px solid ${hexToRgba(primaryColor, 0.3)}` }}
              />
            ) : (
              <div
                className={`flex h-24 w-24 items-center justify-center text-2xl font-black shadow-2xl sm:h-28 sm:w-28 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-2xl' : 'rounded-3xl'}`}
                style={{ background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`, color: '#000' }}
              >
                {companyName.slice(0, 2).toUpperCase()}
              </div>
            )}

            {/* Title */}
            <h1
              className="mt-6 text-3xl font-extrabold leading-tight sm:text-4xl"
              style={{ color: textColor }}
            >
              {heroTitle}
            </h1>

            {/* Subtitle */}
            {heroSubtitle && (
              <p
                className="mt-3 max-w-xs text-[15px] leading-relaxed"
                style={{ color: hexToRgba(textColor, 0.6) }}
              >
                {heroSubtitle}
              </p>
            )}

            {/* CTA Button */}
            <button
              type="button"
              onClick={goCategories}
              className="mt-8 rounded-2xl px-10 py-4 text-[15px] font-bold tracking-wide transition-transform active:scale-95"
              style={{
                background: primaryColor,
                color: '#000',
                boxShadow: `0 8px 32px ${hexToRgba(primaryColor, 0.35)}`,
              }}
            >
              Menyu
            </button>
          </div>

          {/* Footer info */}
          <div className="relative z-10 px-6 pb-8 pt-4 text-center">
            <p className="text-[11px] font-medium" style={{ color: hexToRgba(textColor, 0.25) }}>
              Powered by iRonWaves
            </p>
          </div>
        </div>
      </>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIES VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (view === 'categories') {
    return shell(
      <>
        {/* Header */}
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
          <h2 className="flex-1 text-lg font-bold" style={{ color: textColor }}>Kateqoriyalar</h2>
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

        {/* Category Grid */}
        <main className="mx-auto max-w-lg px-5 pb-10 pt-2">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => goCategory(cat)}
                className="group relative overflow-hidden rounded-2xl text-left transition-transform active:scale-[0.97]"
                style={{ backgroundColor: surfaceColor }}
              >
                {/* Category image */}
                <div className="aspect-[4/3] w-full overflow-hidden">
                  {categoryImages[cat] && showImages ? (
                    <img
                      src={categoryImages[cat]}
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
                {/* Category name */}
                <div className="px-3 py-3">
                  <p
                    className="text-[13px] font-bold uppercase tracking-wide"
                    style={{ color: textColor }}
                  >
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

  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUCTS VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  return shell(
    <>
      {/* Header */}
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
                placeholder="Axtar..."
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
                {activeCategory || 'Axtarış'}
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

        {/* Category tabs (horizontal scroll) */}
        {!searchOpen && (
          <div className="scrollbar-hide -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
            {categories.map((cat) => {
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className="shrink-0 rounded-full px-4 py-2 text-[12px] font-bold uppercase tracking-wide transition-all"
                  style={
                    isActive
                      ? { background: primaryColor, color: '#000', boxShadow: `0 2px 12px ${hexToRgba(primaryColor, 0.3)}` }
                      : { background: hexToRgba(textColor, 0.06), color: hexToRgba(textColor, 0.5) }
                  }
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Category banner */}
      {!searchOpen && activeCategory && categoryImages[activeCategory] && showImages && (
        <div className="relative mx-5 mt-2 overflow-hidden rounded-2xl">
          <div className="aspect-[21/9] w-full overflow-hidden">
            <img
              src={categoryImages[activeCategory]}
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

      {/* Products list */}
      <main className="mx-auto max-w-lg px-5 pb-10 pt-4">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(primaryColor, 0.1) }}>
              <Search size={24} style={{ color: hexToRgba(textColor, 0.3) }} />
            </div>
            <p className="text-[14px] font-medium" style={{ color: hexToRgba(textColor, 0.5) }}>
              Nəticə tapılmadı
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
              />
            ))}
          </div>
        )}
      </main>
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
}) {
  const hasImage = showImages && Boolean(item.image_url);

  return (
    <article
      className="flex gap-3 overflow-hidden rounded-2xl p-3 transition-transform active:scale-[0.985]"
      style={{ backgroundColor: surfaceColor, boxShadow: `0 2px 16px ${hexToRgba(backgroundColor, 0.4)}` }}
    >
      {/* Image — left side, square/3:2 */}
      {hasImage ? (
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl sm:h-32 sm:w-32">
          <img
            src={String(item.image_url)}
            alt={String(item.item_name || '')}
            className="h-full w-full object-cover"
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
      ) : (
        <div
          className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl sm:h-32 sm:w-32"
          style={{ background: `linear-gradient(135deg, ${hexToRgba(primaryColor, 0.08)}, ${hexToRgba(accentColor, 0.04)})` }}
        >
          <span className="text-2xl">🍽️</span>
        </div>
      )}

      {/* Content — right side */}
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          {/* Name */}
          <h3
            className="text-[15px] font-bold leading-snug sm:text-[16px]"
            style={{ color: textColor }}
          >
            {item.item_name}
          </h3>

          {/* Description */}
          {showDescriptions && item.description && (
            <p
              className="mt-1 line-clamp-3 text-[12px] leading-[1.5] sm:text-[13px]"
              style={{ color: hexToRgba(textColor, 0.5) }}
            >
              {item.description}
            </p>
          )}
        </div>

        {/* Price */}
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
    </article>
  );
}
