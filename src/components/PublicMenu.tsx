import React from 'react';
import { get_public_menu_live } from '../api/menu';
import { get_public_qr_menu_bootstrap_live } from '../api/settings';
import { Search, X } from 'lucide-react';

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
}

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
  const [activeCategory, setActiveCategory] = React.useState('ALL');
  const [search, setSearch] = React.useState('');
  const activeCategoryRef = React.useRef<HTMLButtonElement>(null);

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

  // Scroll active category into view
  React.useEffect(() => {
    activeCategoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeCategory]);

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
  const heroSubtitle = String(branding.hero_subtitle || 'Menyu');
  const logoShape = String(branding.logo_shape || 'rounded');

  // ─── Categories ──────────────────────────────────────────────────────────
  const categories = React.useMemo(() => {
    const unique = Array.from(
      new Set(menuItems.map((item) => String(item.category || '').trim()).filter(Boolean))
    );
    return ['ALL', ...unique];
  }, [menuItems]);

  // ─── Filtered Items ──────────────────────────────────────────────────────
  const filteredItems = React.useMemo(() => {
    return menuItems.filter((item) => {
      const categoryOk = activeCategory === 'ALL' || String(item.category || '') === activeCategory;
      const hay = `${String(item.item_name || '')} ${String(item.category || '')}`.toLowerCase();
      const searchOk = !search.trim() || hay.includes(search.trim().toLowerCase());
      return categoryOk && searchOk;
    });
  }, [menuItems, activeCategory, search]);

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

  const itemCount = filteredItems.length;

  return (
    <div
      className="relative min-h-dvh overflow-x-hidden overflow-y-auto overscroll-contain"
      style={{ background: backgroundColor, color: textColor, fontFamily: '"Geist Sans", "Inter", system-ui, -apple-system, sans-serif' }}
    >
      {/* ═══════════════════════════════════════════════════════════════════════
          HERO
          ═══════════════════════════════════════════════════════════════════════ */}
      <header className="relative overflow-hidden">
        {/* Background layer */}
        {heroImageUrl ? (
          <>
            <img
              src={heroImageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              aria-hidden="true"
            />
            <div
              className="absolute inset-0"
              style={{ background: `linear-gradient(to bottom, ${hexToRgba(backgroundColor, 0.3)} 0%, ${hexToRgba(backgroundColor, 0.85)} 70%, ${backgroundColor} 100%)` }}
            />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(160deg, ${hexToRgba(primaryColor, 0.06)} 0%, transparent 40%), linear-gradient(320deg, ${hexToRgba(accentColor, 0.04)} 0%, transparent 40%), ${backgroundColor}` }}
          />
        )}

        {/* Content */}
        <div className="relative z-10 mx-auto max-w-md px-6 pb-6 pt-14 sm:pt-16">
          {/* Brand row */}
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName}
                className={`h-14 w-14 object-cover ring-2 sm:h-16 sm:w-16 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-xl' : 'rounded-2xl'}`}
                style={{ ringColor: hexToRgba(primaryColor, 0.3) }}
              />
            ) : (
              <div
                className={`flex h-14 w-14 items-center justify-center text-base font-black sm:h-16 sm:w-16 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-xl' : 'rounded-2xl'}`}
                style={{ background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`, color: '#000' }}
              >
                {companyName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: primaryColor }}
              >
                {heroSubtitle}
              </p>
              <h1
                className="mt-1 truncate text-[22px] font-extrabold leading-tight sm:text-[26px]"
                style={{ color: textColor }}
              >
                {heroTitle}
              </h1>
            </div>
          </div>

          {/* Search */}
          <div className="mt-5">
            <label
              className="flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all focus-within:border-opacity-60"
              style={{
                backgroundColor: hexToRgba(surfaceColor, 0.8),
                borderColor: hexToRgba(textColor, 0.08),
                boxShadow: `0 2px 12px ${hexToRgba(backgroundColor, 0.5)}`,
                backdropFilter: 'blur(12px)',
              }}
            >
              <Search size={18} strokeWidth={2.2} style={{ color: hexToRgba(textColor, 0.35) }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Axtar..."
                className="w-full bg-transparent text-[14px] font-medium outline-none"
                style={{ color: textColor }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors"
                  style={{ backgroundColor: hexToRgba(textColor, 0.1) }}
                  aria-label="Təmizlə"
                >
                  <X size={13} style={{ color: textColor }} />
                </button>
              )}
            </label>
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════════
          CATEGORY NAVIGATION
          ═══════════════════════════════════════════════════════════════════════ */}
      <nav
        className="sticky top-0 z-40"
        style={{ backgroundColor: hexToRgba(backgroundColor, 0.92), backdropFilter: 'blur(16px) saturate(1.2)', WebkitBackdropFilter: 'blur(16px) saturate(1.2)' }}
      >
        <div className="mx-auto max-w-md">
          <div className="scrollbar-hide flex items-center gap-1.5 overflow-x-auto px-6 py-3">
            {categories.map((category) => {
              const isActive = activeCategory === category;
              const label = category === 'ALL' ? 'Hamısı' : category;
              return (
                <button
                  key={category}
                  ref={isActive ? activeCategoryRef : undefined}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className="relative shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-200"
                  style={
                    isActive
                      ? {
                          background: primaryColor,
                          color: '#000',
                          boxShadow: `0 2px 12px ${hexToRgba(primaryColor, 0.35)}`,
                        }
                      : {
                          background: 'transparent',
                          color: hexToRgba(textColor, 0.55),
                        }
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          {/* Subtle separator */}
          <div className="mx-6 h-px" style={{ background: hexToRgba(textColor, 0.06) }} />
        </div>
      </nav>

      {/* ═══════════════════════════════════════════════════════════════════════
          MENU GRID
          ═══════════════════════════════════════════════════════════════════════ */}
      <main className="mx-auto max-w-md px-6 pb-12 pt-5">
        {/* Results count */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[12px] font-medium" style={{ color: hexToRgba(textColor, 0.4) }}>
            {itemCount} {itemCount === 1 ? 'məhsul' : 'məhsul'}
          </p>
          {activeCategory !== 'ALL' && (
            <button
              type="button"
              onClick={() => setActiveCategory('ALL')}
              className="text-[12px] font-semibold"
              style={{ color: primaryColor }}
            >
              Hamısını göstər
            </button>
          )}
        </div>

        {itemCount === 0 ? (
          <div
            className="flex flex-col items-center gap-4 rounded-3xl py-16 text-center"
            style={{ backgroundColor: surfaceColor }}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(primaryColor, 0.1) }}>
              <Search size={24} style={{ color: hexToRgba(textColor, 0.3) }} />
            </div>
            <div>
              <p className="text-[15px] font-semibold" style={{ color: hexToRgba(textColor, 0.7) }}>
                Nəticə tapılmadı
              </p>
              <p className="mt-1 text-[13px]" style={{ color: hexToRgba(textColor, 0.4) }}>
                Başqa açar söz yoxlayın
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {filteredItems.map((item) => (
              <MenuCard
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

      {/* ═══════════════════════════════════════════════════════════════════════
          FOOTER
          ═══════════════════════════════════════════════════════════════════════ */}
      <footer className="pb-8 pt-4 text-center">
        <p className="text-[11px] font-medium" style={{ color: hexToRgba(textColor, 0.2) }}>
          Powered by iRonWaves
        </p>
      </footer>
    </div>
  );
}

// ─── Menu Card ───────────────────────────────────────────────────────────────
function MenuCard({
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
      className="group overflow-hidden rounded-[20px] transition-transform duration-200 active:scale-[0.985]"
      style={{
        backgroundColor: surfaceColor,
        boxShadow: `0 1px 2px ${hexToRgba(backgroundColor, 0.3)}, 0 8px 24px ${hexToRgba(backgroundColor, 0.4)}`,
      }}
    >
      {/* ── Image ── */}
      {hasImage && (
        <div className="relative aspect-[3/2] w-full overflow-hidden">
          <img
            src={String(item.image_url)}
            alt={String(item.item_name || '')}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
          {/* Bottom gradient */}
          <div
            className="absolute inset-x-0 bottom-0 h-20"
            style={{ background: `linear-gradient(to top, ${surfaceColor}, transparent)` }}
          />
          {/* Badges */}
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <span
              className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
              style={{
                backgroundColor: hexToRgba(backgroundColor, 0.75),
                color: primaryColor,
                backdropFilter: 'blur(8px)',
                border: `1px solid ${hexToRgba(primaryColor, 0.15)}`,
              }}
            >
              {item.category}
            </span>
            {item.is_coffee && (
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={{ backgroundColor: accentColor, color: '#000' }}
              >
                ☕
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className={`px-5 pb-5 ${hasImage ? 'pt-3' : 'pt-5'}`}>
        {/* Category (no-image variant) */}
        {!hasImage && (
          <div className="mb-3 flex items-center gap-2">
            <span
              className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
              style={{ backgroundColor: hexToRgba(primaryColor, 0.1), color: primaryColor }}
            >
              {item.category}
            </span>
            {item.is_coffee && (
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={{ backgroundColor: hexToRgba(accentColor, 0.15), color: accentColor }}
              >
                ☕ Coffee
              </span>
            )}
          </div>
        )}

        {/* Name */}
        <h3
          className="text-[17px] font-bold leading-snug sm:text-[19px]"
          style={{ color: textColor }}
        >
          {item.item_name}
        </h3>

        {/* Description */}
        {showDescriptions && item.description && (
          <p
            className="mt-2 line-clamp-2 text-[13px] leading-[1.6]"
            style={{ color: hexToRgba(textColor, 0.5) }}
          >
            {item.description}
          </p>
        )}

        {/* Price */}
        {showPrices && (
          <div className="mt-4 flex items-center">
            <span
              className="text-[18px] font-extrabold tracking-tight sm:text-[20px]"
              style={{ color: primaryColor }}
            >
              {Number(item.price || 0).toFixed(2)}
            </span>
            <span
              className="ml-1 text-[13px] font-semibold"
              style={{ color: hexToRgba(primaryColor, 0.7) }}
            >
              ₼
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
