import React from 'react';
import { useAppStore } from '../../store';
import { create_tenant, delete_tenant, list_tenants, suspend_tenant, get_landing_analytics, type TenantRecord, type LandingAnalytics } from '../../api/tenants';
import { tx } from '../../i18n';
import { Eye, Users as UsersIcon, RefreshCw } from 'lucide-react';

function slugify(value: string) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

function parseUserAgent(ua: string) {
  if (!ua || ua === 'unknown') return 'Unknown Device';
  const lower = ua.toLowerCase();
  
  let os = 'Unknown OS';
  if (lower.includes('windows')) os = 'Windows';
  else if (lower.includes('macintosh') || lower.includes('mac os')) os = 'macOS';
  else if (lower.includes('iphone')) os = 'iPhone';
  else if (lower.includes('ipad')) os = 'iPad';
  else if (lower.includes('android')) os = 'Android';
  else if (lower.includes('linux')) os = 'Linux';

  let browser = 'Unknown Browser';
  if (lower.includes('edg/')) browser = 'Edge';
  else if (lower.includes('chrome') && !lower.includes('chromium')) browser = 'Chrome';
  else if (lower.includes('safari') && !lower.includes('chrome')) browser = 'Safari';
  else if (lower.includes('firefox')) browser = 'Firefox';
  else if (lower.includes('opera') || lower.includes('opr/')) browser = 'Opera';

  return `${browser} on ${os}`;
}


export default function TenantsPanel() {
  const { user, lang, notify } = useAppStore();
  const [rows, setRows] = React.useState<TenantRecord[]>([]);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [deletingTenantId, setDeletingTenantId] = React.useState('');
  const [form, setForm] = React.useState({
    company_name: '',
    slug: '',
    domain: '',
    admin_username: '',
    admin_password: '',
  });
  const [createdInfo, setCreatedInfo] = React.useState<null | {
    domain: string;
    admin_username: string;
    admin_password: string;
    tenant_id: string;
  }>(null);

  const [activeTab, setActiveTab] = React.useState<'tenants' | 'analytics'>('tenants');
  const [analytics, setAnalytics] = React.useState<LandingAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = React.useState(false);

  const loadAnalytics = React.useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const data = await get_landing_analytics();
      setAnalytics(data);
    } catch (error: any) {
      notify('error', error?.message || 'Analitika yüklənmədi');
    } finally {
      setAnalyticsLoading(false);
    }
  }, [notify]);

  React.useEffect(() => {
    if (activeTab === 'analytics') {
      void loadAnalytics();
    }
  }, [activeTab, loadAnalytics]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await list_tenants();
      setRows(data || []);
    } catch (error: any) {
      notify('error', error?.message || 'Tenant siyahısı yüklənmədi');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredRows = React.useMemo(() => {
    const needle = String(search || '').trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => (
      String(row.company_name || '').toLowerCase().includes(needle) ||
      String(row.slug || '').toLowerCase().includes(needle) ||
      String(row.domain || '').toLowerCase().includes(needle) ||
      String(row.tenant_id || '').toLowerCase().includes(needle)
    ));
  }, [rows, search]);

  const onCompanyChange = (company_name: string) => {
    const nextSlug = slugify(company_name);
    setForm((prev) => ({
      ...prev,
      company_name,
      slug: prev.slug || nextSlug,
      domain: prev.domain || (nextSlug ? `${nextSlug}.ironwaves.store` : ''),
    }));
  };

  const onSlugChange = (value: string) => {
    const slug = slugify(value);
    setForm((prev) => ({
      ...prev,
      slug,
      domain: slug ? `${slug}.ironwaves.store` : '',
    }));
  };

  const submit = async () => {
    if (!user) return;
    if (!form.company_name.trim() || !form.slug.trim() || !form.domain.trim() || !form.admin_username.trim() || !form.admin_password.trim()) {
      notify('error', tx(lang, 'Bütün sahələri doldurun', 'Заполните все поля', 'Fill all fields'));
      return;
    }

    setSaving(true);
    try {
      const result = await create_tenant({
        company_name: form.company_name,
        slug: form.slug,
        domain: form.domain,
        admin_username: form.admin_username,
        admin_password: form.admin_password,
        created_by: user.username,
        created_by_role: user.role,
      });
      setCreatedInfo({
        domain: String(result.domain || form.domain),
        admin_username: String(result.admin_username || form.admin_username),
        admin_password: String(result.admin_password || form.admin_password),
        tenant_id: String(result.tenant_id || ''),
      });
      setForm({
        company_name: '',
        slug: '',
        domain: '',
        admin_username: '',
        admin_password: '',
      });
      notify('success', tx(lang, 'Tenant yaradıldı', 'Тенант создан', 'Tenant created'));
      await refresh();
    } catch (error: any) {
      notify('error', error?.message || 'Tenant yaradılmadı');
    } finally {
      setSaving(false);
    }
  };

  const suspendRow = async (tenant_id: string) => {
    if (!user) return;
    try {
      await suspend_tenant({
        tenant_id,
        suspended_by: user.username,
        suspended_by_role: user.role,
      });
      notify('success', tx(lang, 'Tenant dayandırıldı', 'Тенант приостановлен', 'Tenant suspended'));
      await refresh();
    } catch (error: any) {
      notify('error', error?.message || 'Tenant dayandırılmadı');
    }
  };

  const deleteRow = async (tenant_id: string) => {
    if (!user) return;
    const confirmed = window.confirm(tx(
      lang,
      `"${tenant_id}" tenant silinsin? Bu əməliyyat həmin tenantın bütün əməliyyat məlumatlarını siləcək.`,
      `Удалить тенант "${tenant_id}"? Это удалит все операционные данные этого тенанта.`,
      `Delete tenant "${tenant_id}"? This will remove all operational data for that tenant.`,
    ));
    if (!confirmed) return;
    setDeletingTenantId(tenant_id);
    try {
      await delete_tenant({
        tenant_id,
        deleted_by: user.username,
        deleted_by_role: user.role,
      });
      notify('success', tx(lang, 'Tenant silindi', 'Тенант удален', 'Tenant deleted'));
      await refresh();
    } catch (error: any) {
      notify('error', error?.message || 'Tenant silinmədi');
    } finally {
      setDeletingTenantId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{tx(lang, 'Tenant İdarəetməsi', 'Управление тенантами', 'Tenant Management')}</h1>
          <p className="mt-1 text-slate-300">
            {tx(lang, 'Yeni şirkətlər yaradın, idarə edin və veb-sayt analitikasını izləyin.', 'Создавайте новые компании, управляйте ими и отслеживайте веб-аналитику.', 'Create and manage new company tenants, and track website analytics.')}
          </p>
        </div>

        {/* Dynamic Tab Buttons */}
        <div className="flex rounded-2xl bg-slate-900/60 p-1 border border-slate-800/40">
          <button
            onClick={() => setActiveTab('tenants')}
            className={`rounded-xl px-5 py-2 text-sm font-semibold transition-all duration-300 ${
              activeTab === 'tenants'
                ? 'glossy-gold text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tx(lang, 'Şirkətlər', 'Компании', 'Tenants')}
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`rounded-xl px-5 py-2 text-sm font-semibold transition-all duration-300 ${
              activeTab === 'analytics'
                ? 'glossy-gold text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tx(lang, 'Veb-sayt Analitikası', 'Веб-аналитика', 'Website Analytics')}
          </button>
        </div>
      </div>

      {activeTab === 'tenants' ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
          <div className="metal-panel rounded-3xl p-5">
            <h2 className="text-xl font-semibold">{tx(lang, 'Yeni Tenant', 'Новый тенант', 'New Tenant')}</h2>
            <div className="mt-4 grid gap-3">
              <input
                className="neon-input min-h-13"
                placeholder={tx(lang, 'Şirkət adı', 'Название компании', 'Company name')}
                value={form.company_name}
                onChange={(e) => onCompanyChange(e.target.value)}
              />
              <input
                className="neon-input min-h-13"
                placeholder="slug"
                value={form.slug}
                onChange={(e) => onSlugChange(e.target.value)}
              />
              <input
                className="neon-input min-h-13"
                placeholder="domain"
                value={form.domain}
                onChange={(e) => setForm((prev) => ({ ...prev, domain: e.target.value.trim().toLowerCase() }))}
              />
              <input
                className="neon-input min-h-13"
                placeholder={tx(lang, 'Admin username', 'Admin username', 'Admin username')}
                value={form.admin_username}
                onChange={(e) => setForm((prev) => ({ ...prev, admin_username: e.target.value }))}
              />
              <input
                type="password"
                className="neon-input min-h-13"
                placeholder={tx(lang, 'Admin şifrəsi', 'Пароль админа', 'Admin password')}
                value={form.admin_password}
                onChange={(e) => setForm((prev) => ({ ...prev, admin_password: e.target.value }))}
              />
              <button
                onClick={() => void submit()}
                disabled={saving}
                className="glossy-gold rounded-2xl px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? tx(lang, 'Yaradılır...', 'Создается...', 'Creating...') : tx(lang, 'Tenant Yarat', 'Создать тенант', 'Create Tenant')}
              </button>
            </div>

            {createdInfo && (
              <div className="mt-5 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                <div className="font-semibold">{tx(lang, 'Tenant hazırdır', 'Тенант готов', 'Tenant is ready')}</div>
                <div className="mt-2">{createdInfo.domain}</div>
                <div>{tx(lang, 'Admin', 'Админ', 'Admin')}: {createdInfo.admin_username}</div>
                <div>{tx(lang, 'Şifrə', 'Пароль', 'Password')}: {createdInfo.admin_password}</div>
              </div>
            )}
          </div>

          <div className="metal-panel rounded-3xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">{tx(lang, 'Mövcud Tenantlər', 'Существующие тенанты', 'Existing Tenants')}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="neon-input min-h-11 w-full min-w-[220px] md:w-72"
                  placeholder={tx(lang, 'Şirkət, slug, domen və ya tenant ID ilə axtar', 'Поиск по компании, slug, домену или tenant ID', 'Search by company, slug, domain, or tenant ID')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button className="neon-btn px-4 py-2" onClick={() => void refresh()}>
                  {tx(lang, 'Yenilə', 'Обновить', 'Refresh')}
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3 text-xs text-slate-300">
              {tx(
                lang,
                'Əgər tenant domeni artıq super panelə düşürsə, tenant yenə burada qalır. Onu şirkət adı, slug, domen və ya tenant ID ilə tapın; əsas qeyd tenantın özüdür, domen route ayrıca problem ola bilər.',
                'Если домен tenant-а уже уходит на super-панель, сам tenant все равно остается здесь. Ищите его по компании, slug, домену или tenant ID; запись tenant-а первична, а маршрут домена — отдельная проблема.',
                'If a tenant domain now routes to the super panel, the tenant still remains here. Find it by company, slug, domain, or tenant ID; the tenant record is primary, and domain routing is a separate issue.',
              )}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="text-left text-slate-300">
                  <tr className="border-b border-slate-700/70">
                    <th className="px-3 py-3">{tx(lang, 'Şirkət', 'Компания', 'Company')}</th>
                    <th className="px-3 py-3">Slug</th>
                    <th className="px-3 py-3">{tx(lang, 'Domen', 'Домен', 'Domain')}</th>
                    <th className="px-3 py-3">Tenant ID</th>
                    <th className="px-3 py-3">{tx(lang, 'Status', 'Статус', 'Status')}</th>
                    <th className="px-3 py-3">{tx(lang, 'Əməliyyat', 'Действие', 'Action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={6} className="px-3 py-5 text-slate-400">{tx(lang, 'Yüklənir...', 'Загрузка...', 'Loading...')}</td>
                    </tr>
                  )}
                  {!loading && filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-5 text-slate-400">
                        {search.trim()
                          ? tx(lang, 'Axtarışa uyğun tenant tapılmadı', 'По вашему запросу tenant не найден', 'No tenant matched your search')
                          : tx(lang, 'Hələ tenant yoxdur', 'Тенантов пока нет', 'No tenants yet')}
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((row) => (
                    <tr key={row.tenant_id} className="border-b border-slate-800/80">
                      <td className="px-3 py-3 font-medium text-slate-100">{row.company_name}</td>
                      <td className="px-3 py-3 text-slate-300">{row.slug}</td>
                      <td className="px-3 py-3 text-slate-300">{row.domain || '-'}</td>
                      <td className="px-3 py-3 text-slate-400">{row.tenant_id}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          row.status === 'active'
                            ? 'bg-emerald-400/15 text-emerald-300'
                            : row.status === 'suspended'
                              ? 'bg-rose-400/15 text-rose-300'
                              : 'bg-amber-400/15 text-amber-300'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          {row.status === 'active' ? (
                            <button className="neon-btn px-3 py-2" onClick={() => void suspendRow(row.tenant_id)}>
                              {tx(lang, 'Dayandır', 'Приостановить', 'Suspend')}
                            </button>
                          ) : (
                            <span className="self-center text-slate-500">{tx(lang, 'Hazırda aktiv deyil', 'Сейчас не активен', 'Currently inactive')}</span>
                          )}
                          <button
                            className="rounded-xl border border-rose-400/40 px-3 py-2 text-rose-300 hover:bg-rose-500/10 disabled:cursor-wait disabled:opacity-60"
                            disabled={Boolean(deletingTenantId)}
                            onClick={() => void deleteRow(row.tenant_id)}
                          >
                            {deletingTenantId === row.tenant_id
                              ? tx(lang, 'Silinir...', 'Удаляется...', 'Deleting...')
                              : tx(lang, 'Sil', 'Удалить', 'Delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Metric Card 1: Total Views */}
            <div className="metal-panel relative overflow-hidden rounded-3xl p-6 border border-slate-700/40 bg-gradient-to-br from-slate-950/80 to-slate-900/50 shadow-2xl transition duration-300 hover:border-amber-500/20">
              <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-amber-500/10 blur-2xl"></div>
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
                  <Eye className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-400">{tx(lang, 'Ümumi Baxış Sayı', 'Всего просмотров', 'Total Pageviews')}</p>
                  <h3 className="mt-1 text-3xl font-extrabold text-white tracking-tight">
                    {analyticsLoading ? '...' : (analytics?.total_pageviews || 0)}
                  </h3>
                </div>
              </div>
              <div className="mt-4 text-xs text-slate-400">
                {tx(lang, 'Veb-sayta edilən ümumi daxilolmalar', 'Общее количество переходов на сайт', 'Total hits made to the website')}
              </div>
            </div>

            {/* Metric Card 2: Unique Visitors */}
            <div className="metal-panel relative overflow-hidden rounded-3xl p-6 border border-slate-700/40 bg-gradient-to-br from-slate-950/80 to-slate-900/50 shadow-2xl transition duration-300 hover:border-violet-500/20">
              <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-violet-500/10 blur-2xl"></div>
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-400">
                  <UsersIcon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-400">{tx(lang, 'Unikal Ziyarətçilər', 'Уникальные посетители', 'Unique Visitors')}</p>
                  <h3 className="mt-1 text-3xl font-extrabold text-white tracking-tight">
                    {analyticsLoading ? '...' : (analytics?.unique_visitors || 0)}
                  </h3>
                </div>
              </div>
              <div className="mt-4 text-xs text-slate-400">
                {tx(lang, 'Fərqli IP ünvanlarına əsaslanan statistika', 'Статистика на основе уникальных IP', 'Statistics based on unique IP addresses')}
              </div>
            </div>
          </div>

          {/* Visitors Log Table */}
          <div className="metal-panel rounded-3xl p-6 shadow-2xl border border-slate-800/60 bg-slate-900/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{tx(lang, 'Son Daxilolmalar', 'Последние посещения', 'Recent Views')}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {tx(lang, 'Landing page-ə daxil olan son 100 ziyarətçi qeydi', 'Последние 100 записей о посещениях сайта', 'Last 100 recorded website visitor views')}
                </p>
              </div>
              <button
                onClick={() => void loadAnalytics()}
                disabled={analyticsLoading}
                className="neon-btn flex items-center gap-2 px-4 py-2 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${analyticsLoading ? 'animate-spin' : ''}`} />
                {tx(lang, 'Yenilə', 'Обновить', 'Refresh')}
              </button>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="text-left text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="pb-3 pr-4 font-semibold">{tx(lang, 'IP Ünvanı', 'IP Адрес', 'IP Address')}</th>
                    <th className="pb-3 pr-4 font-semibold">{tx(lang, 'Tarix & Saat', 'Дата и Время', 'Date & Time')}</th>
                    <th className="pb-3 pr-4 font-semibold">{tx(lang, 'Cihaz & OS', 'Устройство и ОС', 'Device & OS')}</th>
                    <th className="pb-3 pr-4 font-semibold">{tx(lang, 'Keçid (Referrer)', 'Источник (Referrer)', 'Referrer')}</th>
                    <th className="pb-3 font-semibold">{tx(lang, 'Səhifə (Path)', 'Страница (Path)', 'Page (Path)')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {analyticsLoading && !analytics && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        {tx(lang, 'Məlumatlar yüklənir...', 'Загрузка данных...', 'Loading data...')}
                      </td>
                    </tr>
                  )}
                  {!analyticsLoading && (!analytics || analytics.recent_views.length === 0) && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        {tx(lang, 'Hələ daxilolma qeydə alınmayıb', 'Записей о посещениях пока нет', 'No pageview records logged yet')}
                      </td>
                    </tr>
                  )}
                  {analytics?.recent_views.map((view, i) => (
                    <tr key={i} className="hover:bg-slate-800/20 transition-colors duration-150 border-b border-slate-800/40">
                      <td className="py-3 pr-4 font-mono text-slate-300">{view.ip}</td>
                      <td className="py-3 pr-4 text-slate-400">
                        {new Date(view.created_at).toLocaleString(lang === 'az' ? 'az-AZ' : lang === 'ru' ? 'ru-RU' : 'en-US')}
                      </td>
                      <td className="py-3 pr-4 text-slate-300">
                        <span className="inline-flex items-center rounded-lg bg-slate-800/40 px-2.5 py-0.5 text-xs text-slate-300 border border-slate-700/20">
                          {parseUserAgent(view.user_agent)}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-slate-400 truncate max-w-[180px]" title={view.referrer}>
                        {view.referrer ? (
                          <a
                            href={view.referrer}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-400/80 hover:text-amber-300 hover:underline"
                          >
                            {view.referrer.replace(/^https?:\/\/(www\.)?/, '')}
                          </a>
                        ) : (
                          <span className="text-slate-600 font-light">—</span>
                        )}
                      </td>
                      <td className="py-3 text-slate-400 font-mono text-xs">{view.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

