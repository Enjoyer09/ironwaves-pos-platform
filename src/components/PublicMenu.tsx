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

// ─── Component ───────────────────────────────────────────────────────────────
export default function PublicMenu() {
  const [loading, setLoading] = React.useState(true);
  const [menuItems, setMenuItems] = React.useState<MenuItem[]>([]);
  const [bootstrap, setBootstrap] = React.useState<any | null>(null);
  const [activeCategory, setActiveCategory] = React.useState('ALL');
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
  const backgroundColor = String(branding.background_color || '#0f0f0f');
  const surfaceColor = String(branding.surface_color || '#1a1a1a');
  const textColor = String(branding.text_color || '#ffffff');
  const heroImageUrl = String(branding.hero_image_url || '');
  const heroTitle = String(branding.hero_title || companyName);
  const heroSubtitle = String(branding.hero_subtitle || 'QR Menu');
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

  // ─── Loading State ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ background: backgroundColor }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-10 w-10 animate-spin rounded-full border-[3px] border-t-transparent"
            style={{ borderColor: `${primaryColor}40`, borderTopColor: primaryColor }}
          />
          <p className="text-sm font-medium" style={{ color: `${textColor}66` }}>
            Menu yüklənir...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-dvh overflow-x-hidden overflow-y-auto overscroll-contain"
      style={{ background: backgroundColor, color: textColor }}
    >
      {/* ═══════════════════════════════════════════════════════════════════
          HERO SECTION
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden">
        {/* Hero background image */}
        {heroImageUrl ? (
          <div className="absolute inset-0">
            <img
              src={heroImageUrl}
              alt={heroTitle}
              className="h-full w-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, ${backgroundColor}44 0%, ${backgroundColor}cc 60%, ${backgroundColor} 100%)`,
              }}
            />
          </div>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse at 30% 20%, ${primaryColor}18 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, ${accentColor}12 0%, transparent 50%), ${backgroundColor}`,
            }}
          />
        )}

        {/* Hero content */}
        <div className="relative z-10 mx-auto max-w-lg px-5 pb-8 pt-12 sm:pt-16">
          {/* Logo + brand */}
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName}
                className={`h-12 w-12 object-cover shadow-lg sm:h-14 sm:w-14 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-lg' : 'rounded-2xl'}`}
              />
            ) : (
              <div
                className={`flex h-12 w-12 items-center justify-center text-sm font-black shadow-lg sm:h-14 sm:w-14 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-lg' : 'rounded-2xl'}`}
                style={{ backgroundColor: primaryColor, color: '#000' }}
              >
                {companyName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p
                className="text-[10px] font-bold uppercase tracking-[0.2em]"
                style={{ color: primaryColor }}
              >
                {heroSubtitle}
              </p>
              <h1
                className="mt-0.5 text-2xl font-black leading-tight sm:text-3xl"
                style={{ color: textColor }}
              >
                {heroTitle}
              </h1>
            </div>
          </div>

          {/* Search bar */}
          <div className="mt-6">
            <div
              className="flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{
                backgroundColor: `${surfaceColor}`,
                border: `1px solid ${textColor}12`,
                boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
              }}
            >
              <Search size={18} style={{ color: `${textColor}44` }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchOpen(true)}
                placeholder="Məhsul axtar..."
                className="w-full bg-transparent text-sm font-medium outline-none placeholder:opacity-40"
                style={{ color: textColor }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setSearchOpen(false); }}
                  className="flex h-6 w-6 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${textColor}15` }}
                  aria-label="Təmizlə"
                >
                  <X size={12} style={{ color: textColor }} />
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          CATEGORY TABS
          ═══════════════════════════════════════════════════════════════════ */}
      <nav
        className="sticky top-0 z-30 backdrop-blur-xl"
        style={{ background: `${backgroundColor}e8` }}
      >
        <div className="scrollbar-hide mx-auto flex max-w-lg gap-2 overflow-x-auto px-5 py-3">
          {categories.map((category) => {
            const isActive = activeCategory === category;
            return (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className="shrink-0 rounded-xl px-5 py-2.5 text-[13px] font-bold transition-all"
                style={
                  isActive
                    ? {
                        backgroundColor: primaryColor,
                        color: '#000',
                        boxShadow: `0 4px 16px ${primaryColor}44`,
                      }
                    : {
                        backgroundColor: surfaceColor,
                        color: `${textColor}88`,
                        border: `1px solid ${textColor}10`,
                      }
                }
              >
                {category === 'ALL' ? 'Hamısı' : category}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ═══════════════════════════════════════════════════════════════════
          MENU ITEMS
          ═══════════════════════════════════════════════════════════════════ */}
      <main className="mx-auto max-w-lg px-5 pb-10 pt-4">
        {filteredItems.length === 0 ? (
          <div
            className="mt-12 flex flex-col items-center gap-4 rounded-3xl p-10 text-center"
            style={{ backgroundColor: surfaceColor }}
          >
            <div className="text-4xl">🍽️</div>
            <p className="text-sm font-medium" style={{ color: `${textColor}66` }}>
              Uyğun məhsul tapılmadı.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filteredItems.map((item) => (
              <MenuCard
                key={item.id}
                item={item}
                showPrices={showPrices}
                showImages={showImages}
                showDescriptions={showDescriptions}
                primaryColor={primaryColor}
                surfaceColor={surfaceColor}
                textColor={textColor}
                accentColor={accentColor}
                backgroundColor={backgroundColor}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Menu Card Component ─────────────────────────────────────────────────────
function MenuCard({
  item,
  showPrices,
  showImages,
  showDescriptions,
  primaryColor,
  surfaceColor,
  textColor,
  accentColor,
  backgroundColor,
}: {
  item: MenuItem;
  showPrices: boolean;
  showImages: boolean;
  showDescriptions: boolean;
  primaryColor: string;
  surfaceColor: string;
  textColor: string;
  accentColor: string;
  backgroundColor: string;
}) {
  const hasImage = showImages && item.image_url;

  return (
    <article
      className="overflow-hidden rounded-3xl transition-transform active:scale-[0.98]"
      style={{
        backgroundColor: surfaceColor,
        boxShadow: '0 8px 32px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {/* Card image — full width top */}
      {hasImage ? (
        <div className="relative aspect-[16/10] w-full overflow-hidden">
          <img
            src={String(item.image_url)}
            alt={String(item.item_name || '')}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {/* Gradient overlay at bottom for text readability */}
          <div
            className="absolute inset-x-0 bottom-0 h-16"
            style={{ background: `linear-gradient(transparent, ${surfaceColor}cc)` }}
          />
          {/* Category badge on image */}
          <div
            className="absolute left-3 top-3 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: `${backgroundColor}cc`, color: primaryColor, backdropFilter: 'blur(8px)' }}
          >
            {item.category}
          </div>
          {/* Coffee badge */}
          {item.is_coffee && (
            <div
              className="absolute right-3 top-3 rounded-lg px-2 py-1 text-[10px] font-bold"
              style={{ backgroundColor: accentColor, color: '#000' }}
            >
              ☕ Coffee
            </div>
          )}
        </div>
      ) : null}

      {/* Card body */}
      <div className="px-5 pb-5 pt-4">
        {/* Category tag (only when no image) */}
        {!hasImage && (
          <span
            className="mb-2 inline-block rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}
          >
            {item.category}
          </span>
        )}

        {/* Title + Price row */}
        <div className="flex items-start justify-between gap-3">
          <h3
            className="text-lg font-bold leading-snug sm:text-xl"
            style={{ color: textColor }}
          >
            {item.item_name}
          </h3>
          {showPrices && (
            <span
              className="shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-base font-black sm:text-lg"
              style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}
            >
              {Number(item.price || 0).toFixed(2)} ₼
            </span>
          )}
        </div>

        {/* Description */}
        {showDescriptions && item.description && (
          <p
            className="mt-2 line-clamp-2 text-[13px] leading-relaxed"
            style={{ color: `${textColor}66` }}
          >
            {item.description}
          </p>
        )}

        {/* Coffee badge inline (when no image) */}
        {!hasImage && item.is_coffee && (
          <div
            className="mt-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold"
            style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
          >
            ☕ Coffee Favorite
          </div>
        )}
      </div>
    </article>
  );
}
