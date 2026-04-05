import React from 'react';
import { get_public_menu_live } from '../api/menu';
import { get_public_qr_menu_bootstrap_live } from '../api/settings';

export default function PublicMenu() {
  const [loading, setLoading] = React.useState(true);
  const [menuItems, setMenuItems] = React.useState<any[]>([]);
  const [bootstrap, setBootstrap] = React.useState<any | null>(null);
  const [activeCategory, setActiveCategory] = React.useState('ALL');
  const [search, setSearch] = React.useState('');

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
    return () => {
      mounted = false;
    };
  }, []);

  const branding = bootstrap?.branding || {};
  const showPrices = bootstrap?.show_prices !== false;
  const showImages = bootstrap?.show_images !== false;
  const showDescriptions = bootstrap?.show_descriptions !== false;
  const companyName = String(branding.company_name || 'iRonWaves Menu');
  const logoUrl = String(branding.logo_url || '');
  const primaryColor = String(branding.primary_color || '#facc15');
  const accentColor = String(branding.accent_color || '#22d3ee');
  const backgroundColor = String(branding.background_color || '#efe2c1');
  const surfaceColor = String(branding.surface_color || '#fff7e8');
  const textColor = String(branding.text_color || '#2b1708');
  const heroImageUrl = String(branding.hero_image_url || '');
  const logoShape = String(branding.logo_shape || 'rounded');
  const heroTitle = String(branding.hero_title || companyName);
  const heroSubtitle = String(branding.hero_subtitle || 'QR Menu');

  const categories = React.useMemo(() => {
    const unique = Array.from(new Set(menuItems.map((item) => String(item.category || '').trim()).filter(Boolean)));
    return ['ALL', ...unique];
  }, [menuItems]);

  const filteredItems = React.useMemo(() => {
    return menuItems.filter((item) => {
      const categoryOk = activeCategory === 'ALL' || String(item.category || '') === activeCategory;
      const hay = `${String(item.item_name || '')} ${String(item.category || '')}`.toLowerCase();
      const searchOk = !search.trim() || hay.includes(search.trim().toLowerCase());
      return categoryOk && searchOk;
    });
  }, [menuItems, activeCategory, search]);

  if (loading) {
    return (
      <div className="min-h-screen px-4 py-10 text-slate-100" style={{ background: `linear-gradient(180deg, ${backgroundColor}, #09111d)` }}>
        <div className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur">
          <div className="text-xl font-semibold">Menu yüklənir...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6" style={{ background: `linear-gradient(180deg, ${backgroundColor}, #f7ecd2)` }}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="overflow-hidden rounded-[2rem] border shadow-[0_20px_60px_rgba(55,31,8,0.18)]" style={{ borderColor: `${textColor}22`, backgroundColor: surfaceColor }}>
          <div
            className="relative px-6 py-8 md:px-10"
            style={{
              background: `radial-gradient(circle at top right, ${accentColor}44 0%, transparent 38%), linear-gradient(135deg, ${primaryColor}30, transparent 60%)`,
            }}
          >
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[1.05fr_0.95fr] md:items-center">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={companyName}
                    className={`h-16 w-16 object-cover ring-1 ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-lg' : 'rounded-2xl'}`}
                    style={{ borderColor: `${textColor}25` }}
                  />
                ) : (
                  <div className={`flex h-16 w-16 items-center justify-center text-lg font-black ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-lg' : 'rounded-2xl'}`} style={{ backgroundColor: primaryColor, color: textColor }}>
                    QR
                  </div>
                )}
                <div>
                  <div className="text-xs uppercase tracking-[0.35em]" style={{ color: `${textColor}99` }}>QR MENU</div>
                  <h1 className="mt-2 text-4xl font-black leading-none md:text-6xl" style={{ color: textColor }}>{heroTitle}</h1>
                  <p className="mt-3 max-w-2xl text-sm md:text-base" style={{ color: `${textColor}CC` }}>{heroSubtitle}</p>
                </div>
              </div>
              <div className="w-full md:max-w-sm">
                <input
                  className="neon-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Məhsul axtar..."
                />
              </div>
            </div>
              <div className="flex justify-center md:justify-end">
                <div className="relative mt-2 w-full max-w-[320px] rounded-[2rem] p-4 shadow-[0_24px_50px_rgba(40,22,6,0.18)]" style={{ backgroundColor: String(branding.poster_background_color || primaryColor) }}>
                  <div className="rounded-[1.6rem] border px-4 pb-4 pt-5" style={{ backgroundColor: surfaceColor, borderColor: `${textColor}18` }}>
                    <div className="mb-3 flex items-center gap-3">
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt={companyName}
                          className={`h-12 w-12 object-cover ${logoShape === 'circle' ? 'rounded-full' : logoShape === 'square' ? 'rounded-lg' : 'rounded-2xl'}`}
                        />
                      ) : null}
                      <div>
                        <div className="text-xs uppercase tracking-[0.24em]" style={{ color: `${textColor}88` }}>MENU</div>
                        <div className="text-lg font-black" style={{ color: textColor }}>{companyName}</div>
                      </div>
                    </div>
                    {heroImageUrl ? (
                      <img src={heroImageUrl} alt={heroTitle} className="mb-3 h-36 w-full rounded-[1.25rem] object-cover" />
                    ) : null}
                    <div className="space-y-2">
                      {filteredItems.slice(0, 3).map((item) => (
                        <div key={item.id} className="flex items-center justify-between rounded-2xl px-3 py-2" style={{ backgroundColor: `${primaryColor}18` }}>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold" style={{ color: textColor }}>{item.item_name}</div>
                            <div className="text-[11px]" style={{ color: `${textColor}88` }}>{item.category}</div>
                          </div>
                          {showPrices ? <div className="text-sm font-black" style={{ color: textColor }}>{Number(item.price || 0).toFixed(2)} ₼</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                activeCategory === category
                  ? 'text-slate-900'
                  : 'hover:bg-white/60'
              }`}
              style={activeCategory === category ? { backgroundColor: primaryColor, borderColor: primaryColor } : { borderColor: `${textColor}18`, backgroundColor: surfaceColor, color: textColor }}
            >
              {category === 'ALL' ? 'Hamısı' : category}
            </button>
          ))}
        </div>

        {filteredItems.length === 0 ? (
          <div className="rounded-3xl border p-10 text-center" style={{ borderColor: `${textColor}18`, backgroundColor: surfaceColor, color: textColor }}>
            Uyğun məhsul tapılmadı.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <div key={item.id} className="rounded-[1.75rem] border p-5 shadow-[0_10px_30px_rgba(55,31,8,0.12)]" style={{ borderColor: `${textColor}18`, backgroundColor: surfaceColor }}>
                {showImages && item.image_url ? (
                  <img
                    src={String(item.image_url)}
                    alt={String(item.item_name || 'Menu item')}
                    className="mb-4 h-48 w-full rounded-[1.25rem] object-cover"
                  />
                ) : null}
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ backgroundColor: `${accentColor}22`, color: textColor }}>
                      {item.category}
                    </div>
                    <h3 className="mt-3 text-2xl font-bold" style={{ color: textColor }}>{item.item_name}</h3>
                    {showDescriptions && item.description ? (
                      <p className="mt-2 text-sm leading-6" style={{ color: `${textColor}CC` }}>{String(item.description)}</p>
                    ) : null}
                  </div>
                  {showPrices ? (
                    <div className="shrink-0 rounded-2xl px-3 py-2 text-lg font-black" style={{ backgroundColor: primaryColor, color: textColor }}>
                      {Number(item.price || 0).toFixed(2)} ₼
                    </div>
                  ) : null}
                </div>
                {item.is_coffee ? (
                  <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: accentColor }}>
                    Coffee Favorite
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
