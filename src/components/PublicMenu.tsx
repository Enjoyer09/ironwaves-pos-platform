import React from 'react';
import { get_public_menu_live } from '../api/menu';
import { get_public_qr_menu_bootstrap_live } from '../api/settings';
import { Search } from 'lucide-react';

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
  const categoryScrollRef = React.useRef<HTMLDivElement>(null);

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

  // ─── Branding / CSS Variables ────────────────────────────────────────────
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
  const logoShape = String(branding.logo_shape || 'rounded');

  // CSS custom properties for tenant branding
  const cssVars = {
    '--qr-bg': backgroundColor,
    '--qr-surface': surfaceColor,
    '--qr-text': textColor,
    '--qr-primary': primaryColor,
    '--qr-accent': accentColor,
    '--qr-text-muted': `${textColor}99`,
    '--qr-border': `${textColor}15`,
  } as React.CSSProperties;

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
      <div
        className="flex min-h-dvh items-center justify-center"
        style={{ ...cssVars, background: 'var(--qr-bg)' }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-12 w-12 animate-spin rounded-full border-4 border-t-transparent"
            style={{ borderColor: `${primaryColor}33`, borderTopColor: primaryColor }}
          />
          <p className="text-sm font-medium" style={{ color: `${textColor}88` }}>
            Menu yüklənir...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-dvh overflow-x-hidden overflow-y-auto overscroll-contain"
      style={{ ...cssVars, background: 'var(--qr-bg)', color: 'var(--qr-text)' }}
    >
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 backdrop-blur-xl" style={{ background: `${backgroundColor}ee` }}>
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={companyName}
                className={`h-10 w-10 object-cover ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-md' : 'rounded-xl'}`}
              />
            ) : (
              <div
                className={`flex h-10 w-10 items-center justify-center text-xs font-black ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-md' : 'rounded-xl'}`}
                style={{ backgroundColor: primaryColor, color: '#000' }}
              >
                {companyName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold" style={{ color: textColor }}>
                {companyName}
              </h1>
              <p className="text-[11px] font-medium" style={{ color: `${textColor}66` }}>
                QR Menu
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSearchOpen(!searchOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
            style={{ backgroundColor: `${textColor}10` }}
            aria-label="Axtar"
          >
            <Search size={18} style={{ color: primaryColor }} />
          </button>
        </div>

        {/* Search bar (collapsible) */}
        {searchOpen && (
          <div className="border-b px-4 pb-3" style={{ borderColor: 'var(--qr-border)' }}>
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2.5"
              style={{ backgroundColor: `${textColor}08`, border: `1px solid ${textColor}15` }}
            >
              <Search size={16} style={{ color: `${textColor}55` }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Məhsul axtar..."
                className="w-full bg-transparent text-sm outline-none placeholder:opacity-50"
                style={{ color: textColor }}
                autoFocus
              />
            </div>
          </div>
        )}

        {/* Category Tabs */}
        <div
          ref={categoryScrollRef}
          className="scrollbar-hide flex gap-2 overflow-x-auto border-b px-4 py-2.5"
          style={{ borderColor: 'var(--qr-border)' }}
        >
          {categories.map((category) => {
            const isActive = activeCategory === category;
            return (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className="shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-all"
                style={
                  isActive
                    ? { backgroundColor: primaryColor, color: '#000' }
                    : { backgroundColor: `${textColor}08`, color: `${textColor}88` }
                }
              >
                {category === 'ALL' ? 'Hamısı' : category}
              </button>
            );
          })}
        </div>
      </header>

      {/* ─── Content ────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-lg px-4 pt-4 pb-6">
        {filteredItems.length === 0 ? (
          <div
            className="mt-16 flex flex-col items-center gap-3 rounded-2xl p-8 text-center"
            style={{ backgroundColor: surfaceColor }}
          >
            <div className="text-3xl">🍽️</div>
            <p className="text-sm font-medium" style={{ color: `${textColor}88` }}>
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
}: {
  item: MenuItem;
  showPrices: boolean;
  showImages: boolean;
  showDescriptions: boolean;
  primaryColor: string;
  surfaceColor: string;
  textColor: string;
  accentColor: string;
}) {
  return (
    <article
      className="flex gap-4 rounded-2xl p-3.5"
      style={{
        backgroundColor: surfaceColor,
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      {/* Image */}
      {showImages && item.image_url ? (
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl sm:h-32 sm:w-32">
          <img
            src={String(item.image_url)}
            alt={String(item.item_name || '')}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {item.is_coffee && (
            <div
              className="absolute left-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: accentColor, color: '#000' }}
            >
              ☕
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl text-3xl sm:h-32 sm:w-32"
          style={{ backgroundColor: `${textColor}08` }}
        >
          🍽️
        </div>
      )}

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
        <div className="min-w-0">
          <h3
            className="text-base font-bold leading-snug sm:text-lg"
            style={{ color: textColor }}
          >
            {item.item_name}
          </h3>
          <span
            className="mt-1 inline-block text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: `${primaryColor}cc` }}
          >
            {item.category}
          </span>
          {showDescriptions && item.description && (
            <p
              className="mt-1.5 line-clamp-2 text-sm leading-relaxed"
              style={{ color: `${textColor}77` }}
            >
              {item.description}
            </p>
          )}
        </div>

        {/* Price */}
        {showPrices && (
          <div className="mt-2">
            <span
              className="text-lg font-black sm:text-xl"
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
