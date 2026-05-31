import React from 'react';
import { get_public_menu_live } from '../api/menu';
import { get_public_qr_menu_bootstrap_live } from '../api/settings';
import { Search, Home, Grid3X3, Heart, ShoppingBag } from 'lucide-react';

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
  const [activeNav, setActiveNav] = React.useState<'home' | 'menu' | 'favorites' | 'cart'>('home');
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
    '--qr-card-shadow': '0 8px 32px rgba(0,0,0,0.4)',
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
      className="relative min-h-dvh overflow-x-hidden overscroll-contain pb-24"
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
      <main className="mx-auto max-w-lg px-4 pt-4">
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
          <div className="flex flex-col gap-3">
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

        {/* Footer spacer for bottom nav */}
        <div className="h-8" />
      </main>

      {/* ─── Bottom Navigation ──────────────────────────────────────────── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl"
        style={{
          background: `${backgroundColor}f0`,
          borderColor: 'var(--qr-border)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="mx-auto flex max-w-lg items-center justify-around py-2">
          <NavItem
            icon={<Home size={20} />}
            label="Ana səhifə"
            active={activeNav === 'home'}
            primaryColor={primaryColor}
            textColor={textColor}
            onClick={() => setActiveNav('home')}
          />
          <NavItem
            icon={<Grid3X3 size={20} />}
            label="Menu"
            active={activeNav === 'menu'}
            primaryColor={primaryColor}
            textColor={textColor}
            onClick={() => { setActiveNav('menu'); }}
          />
          <NavItem
            icon={<Heart size={20} />}
            label="Sevimlilər"
            active={activeNav === 'favorites'}
            primaryColor={primaryColor}
            textColor={textColor}
            onClick={() => setActiveNav('favorites')}
          />
          <NavItem
            icon={<ShoppingBag size={20} />}
            label="Səbət"
            active={activeNav === 'cart'}
            primaryColor={primaryColor}
            textColor={textColor}
            onClick={() => setActiveNav('cart')}
          />
        </div>
      </nav>
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
      className="flex gap-3 rounded-2xl p-3 transition-transform active:scale-[0.98]"
      style={{
        backgroundColor: surfaceColor,
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
      }}
    >
      {/* Image */}
      {showImages && item.image_url ? (
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl">
          <img
            src={String(item.image_url)}
            alt={String(item.item_name || '')}
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {item.is_coffee && (
            <div
              className="absolute left-1 top-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase"
              style={{ backgroundColor: accentColor, color: '#000' }}
            >
              ☕
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl text-2xl"
          style={{ backgroundColor: `${textColor}08` }}
        >
          🍽️
        </div>
      )}

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3
              className="truncate text-sm font-bold leading-tight"
              style={{ color: textColor }}
            >
              {item.item_name}
            </h3>
          </div>
          <span
            className="mt-0.5 inline-block text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: `${primaryColor}cc` }}
          >
            {item.category}
          </span>
          {showDescriptions && item.description && (
            <p
              className="mt-1 line-clamp-2 text-xs leading-relaxed"
              style={{ color: `${textColor}77` }}
            >
              {item.description}
            </p>
          )}
        </div>

        {/* Price */}
        {showPrices && (
          <div className="mt-2 flex items-center justify-between">
            <span
              className="text-base font-black"
              style={{ color: primaryColor }}
            >
              {Number(item.price || 0).toFixed(2)} ₼
            </span>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
              style={{ backgroundColor: primaryColor, color: '#000' }}
              aria-label="Səbətə əlavə et"
            >
              +
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Bottom Nav Item ─────────────────────────────────────────────────────────
function NavItem({
  icon,
  label,
  active,
  primaryColor,
  textColor,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  primaryColor: string;
  textColor: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 px-3 py-1 transition-colors"
      style={{ color: active ? primaryColor : `${textColor}55` }}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
      {active && (
        <div
          className="mt-0.5 h-1 w-1 rounded-full"
          style={{ backgroundColor: primaryColor }}
        />
      )}
    </button>
  );
}
