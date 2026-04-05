import React from 'react';
import { get_public_menu_live } from '../api/menu';
import { get_customer_app_bootstrap_live } from '../api/crm';

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
          get_customer_app_bootstrap_live().catch(() => null),
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
  const companyName = String(branding.company_name || 'iRonWaves Menu');
  const logoUrl = String(branding.logo_url || '');
  const primaryColor = String(branding.primary_color || '#facc15');
  const accentColor = String(branding.accent_color || '#22d3ee');
  const backgroundColor = String(branding.background_color || '#0b1220');
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
    <div className="min-h-screen px-4 py-6 text-slate-100" style={{ background: `linear-gradient(180deg, ${backgroundColor}, #09111d)` }}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur">
          <div
            className="relative px-6 py-8 md:px-10"
            style={{
              background: `radial-gradient(circle at top right, ${accentColor}55 0%, transparent 38%), linear-gradient(135deg, ${primaryColor}22, transparent 60%)`,
            }}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <img src={logoUrl} alt={companyName} className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/20" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-black text-slate-900" style={{ backgroundColor: primaryColor }}>
                    QR
                  </div>
                )}
                <div>
                  <div className="text-xs uppercase tracking-[0.35em] text-white/70">QR MENU</div>
                  <h1 className="mt-2 text-3xl font-black text-white md:text-4xl">{heroTitle}</h1>
                  <p className="mt-2 max-w-2xl text-sm text-white/80 md:text-base">{heroSubtitle}</p>
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
                  : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
              }`}
              style={activeCategory === category ? { backgroundColor: primaryColor, borderColor: primaryColor } : undefined}
            >
              {category === 'ALL' ? 'Hamısı' : category}
            </button>
          ))}
        </div>

        {filteredItems.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-10 text-center text-slate-300">
            Uyğun məhsul tapılmadı.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <div key={item.id} className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.22)] backdrop-blur">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/75" style={{ backgroundColor: `${accentColor}33` }}>
                      {item.category}
                    </div>
                    <h3 className="mt-3 text-2xl font-bold text-white">{item.item_name}</h3>
                  </div>
                  <div className="rounded-2xl px-3 py-2 text-lg font-black text-slate-900" style={{ backgroundColor: primaryColor }}>
                    {Number(item.price || 0).toFixed(2)} ₼
                  </div>
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
