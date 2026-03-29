import React from 'react';
import { useAppStore } from '../../store';
import { create_tenant, list_tenants, suspend_tenant, type TenantRecord } from '../../api/tenants';
import { tx } from '../../i18n';

function slugify(value: string) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

export default function TenantsPanel() {
  const { user, lang, notify } = useAppStore();
  const [rows, setRows] = React.useState<TenantRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{tx(lang, 'Tenant İdarəetməsi', 'Управление тенантами', 'Tenant Management')}</h1>
        <p className="mt-1 text-slate-300">
          {tx(lang, 'Buradan yeni şirkət/subdomain yarada bilərsiniz.', 'Отсюда можно создать новую компанию/субдомен.', 'Create new company/subdomain tenants from here.')}
        </p>
      </div>

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
            <button className="neon-btn px-4 py-2" onClick={() => void refresh()}>
              {tx(lang, 'Yenilə', 'Обновить', 'Refresh')}
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="text-left text-slate-300">
                <tr className="border-b border-slate-700/70">
                  <th className="px-3 py-3">{tx(lang, 'Şirkət', 'Компания', 'Company')}</th>
                  <th className="px-3 py-3">Slug</th>
                  <th className="px-3 py-3">Tenant ID</th>
                  <th className="px-3 py-3">{tx(lang, 'Status', 'Статус', 'Status')}</th>
                  <th className="px-3 py-3">{tx(lang, 'Əməliyyat', 'Действие', 'Action')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-slate-400">{tx(lang, 'Yüklənir...', 'Загрузка...', 'Loading...')}</td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-slate-400">{tx(lang, 'Hələ tenant yoxdur', 'Тенантов пока нет', 'No tenants yet')}</td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.tenant_id} className="border-b border-slate-800/80">
                    <td className="px-3 py-3 font-medium text-slate-100">{row.company_name}</td>
                    <td className="px-3 py-3 text-slate-300">{row.slug}</td>
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
                      {row.status === 'active' ? (
                        <button className="neon-btn px-3 py-2" onClick={() => void suspendRow(row.tenant_id)}>
                          {tx(lang, 'Dayandır', 'Приостановить', 'Suspend')}
                        </button>
                      ) : (
                        <span className="text-slate-500">{tx(lang, 'Hazırda aktiv deyil', 'Сейчас не активен', 'Currently inactive')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
