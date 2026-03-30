import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from './store';
import { i18n, tx } from './i18n';
import PinLogin from './components/PinLogin';
import POS from './components/POS';
import KDS from './components/KDS';
import AdminPanel from './components/AdminPanel';
import TablesPage from './components/TablesPage';
import PublicReceipt from './components/PublicReceipt';
import CustomerApp from './components/CustomerApp';
import LandingPage from './components/LandingPage';
import { LogOut, Wifi, WifiOff, Languages, RotateCcw } from 'lucide-react';
import { seedDatabase } from './lib/seeder';
import ToastOverlay from './components/ToastOverlay';
import { get_business_profile, get_business_profile_live } from './api/settings';
import { get_settings, get_settings_live } from './api/settings';
import AppErrorBoundary from './components/AppErrorBoundary';
import { logUiError } from './lib/logger';
import { getPendingOfflineSalesCount, syncPendingOfflineSales } from './lib/offline';
import { probeInternet } from './lib/connectivity';
import { get_unread_staff_notifications_live, mark_staff_notifications_read_live } from './api/reports';
import { getActiveTenantId, getResolvedTenantIdFromHost } from './lib/tenant';
import { get_low_stock_items } from './api/inventory';
import { list_tenants, type TenantRecord } from './api/tenants';
import { clearDBCache } from './lib/db_sim';
import { authApi } from './api/auth';

type AdminView =
  | 'dashboard'
  | 'analytics'
  | 'menu'
  | 'finance'
  | 'inventory'
  | 'crm'
  | 'customerapp'
  | 'recipes'
  | 'ai'
  | 'settings'
  | 'notes'
  | 'logs'
  | 'database'
  | 'zreport'
  | 'combos'
  | 'tenants';

type ModuleKey =
  | 'pos'
  | 'tables'
  | 'kds'
  | 'zreport'
  | 'finance'
  | 'inventory'
  | 'combos'
  | 'dashboard'
  | 'analytics'
  | 'logs'
  | 'crm'
  | 'customerapp'
  | 'ai'
  | 'menu'
  | 'recipes'
  | 'tenants'
  | 'notes'
  | 'settings'
  | 'database';

export default function App() {
  const { user, access_token, logout, lang, setLang, hasHydrated, notify, switchTenantContext, applySessionUser } = useAppStore();
  const activeTenant = getActiveTenantId();
  const safeLang = (lang === 'az' || lang === 'ru' || lang === 'en') ? lang : 'az';
  const t = i18n[safeLang];
  const hasValidUser = Boolean(
    user &&
    typeof user.username === 'string' &&
    typeof user.role === 'string' &&
    typeof access_token === 'string' &&
    access_token.length > 8
  );

  useEffect(() => {
    try {
      seedDatabase();
    } catch (error) {
      console.error('Seed database failed:', error);
    }
  }, []);

  useEffect(() => {
    if (!hasValidUser || !user?.tenant_id) return;
    void get_business_profile_live(user.tenant_id).catch(() => {});
    void get_settings_live(user.tenant_id).catch(() => {});
  }, [hasValidUser, user?.tenant_id]);

  useEffect(() => {
    if (!hasValidUser) return;
    let cancelled = false;
    const syncSession = async () => {
      try {
        const me = await authApi.me();
        if (!me || cancelled) return;
        const nextRole = String(me.role || '');
        const nextTenant = String(me.tenant_id || '');
        if (nextRole !== String(user?.role || '') || nextTenant !== String(user?.tenant_id || '')) {
          applySessionUser({
            username: String(me.username || user?.username || ''),
            role: nextRole,
            tenant_id: nextTenant,
          });
        }
      } catch {
        if (!cancelled) {
          logout();
        }
      }
    };
    void syncSession();
    return () => {
      cancelled = true;
    };
  }, [hasValidUser, user?.role, user?.tenant_id, user?.username, applySessionUser, logout]);

  const [currentModule, setCurrentModule] = useState<ModuleKey>('pos');
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [lowStockModal, setLowStockModal] = useState<Array<{ name: string; stock_qty: string; min_limit: string; unit: string }> | null>(null);
  const [availableTenants, setAvailableTenants] = useState<TenantRecord[]>([]);
  const [tenantSwitching, setTenantSwitching] = useState(false);

  const publicReceiptParams = useMemo(() => {
    if (typeof window === 'undefined') return { receiptId: '', token: '' };
    const params = new URLSearchParams(window.location.search);
    return {
      receiptId: params.get('r') || params.get('receipt') || params.get('sale_id') || '',
      token: params.get('t') || params.get('token') || '',
    };
  }, []);

  const customerAppParams = useMemo(() => {
    if (typeof window === 'undefined') return { cardId: '', token: '' };
    const params = new URLSearchParams(window.location.search);
    return {
      cardId: params.get('id') || '',
      token: params.get('t') || params.get('token') || '',
      join: params.get('join') === '1',
    };
  }, []);

  const hostMode = useMemo(() => {
    if (typeof window === 'undefined') return 'app';
    const host = window.location.host.toLowerCase();
    if (host === 'www.ironwaves.store' || host === 'ironwaves.store') return 'landing';
    return 'app';
  }, []);

  const currentHost = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return String(window.location.host || '').trim().toLowerCase().split(':')[0];
  }, []);

  const defaultUiVisibility = { staff_show_tables: true, manager_show_tables: true, staff_show_kitchen: true };
  const defaultInventorySettings = { default_critical_threshold: 5, unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'] };
  const defaultRoleModules = {
    staff: ['pos', 'tables', 'kds', 'zreport'],
    manager: ['pos', 'tables', 'kds', 'zreport', 'dashboard', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'ai', 'menu', 'recipes'],
    kitchen: ['kds'],
  };

  const appConfig = useMemo(() => {
    if (!hasValidUser) {
      return {
        profile: { logo_url: '' },
         settings: { ui_visibility: defaultUiVisibility, role_modules: defaultRoleModules, inventory_settings: defaultInventorySettings },
      };
    }
    try {
      return {
        profile: get_business_profile(user?.tenant_id || activeTenant) || { logo_url: '' },
          settings: get_settings(user?.tenant_id || activeTenant) || { ui_visibility: defaultUiVisibility, role_modules: defaultRoleModules, inventory_settings: defaultInventorySettings },
      };
    } catch (e) {
      console.error('App settings/profile init failed:', e);
      return {
        profile: { logo_url: '' },
          settings: { ui_visibility: defaultUiVisibility, role_modules: defaultRoleModules, inventory_settings: defaultInventorySettings },
      };
    }
  }, [hasValidUser, user?.tenant_id]);

  const profile = appConfig.profile;
  const settings = appConfig.settings;
  const mappedTenantFromHost = useMemo(() => getResolvedTenantIdFromHost(currentHost), [currentHost]);
  const profileWebsiteHost = useMemo(() => {
    const raw = String(profile?.website || '').trim().toLowerCase();
    if (!raw) return '';
    return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  }, [profile?.website]);

  const uiVisibility = settings?.ui_visibility || defaultUiVisibility;
  const roleModules = settings?.role_modules || null;
  const safeRoleModules = {
    staff: Array.isArray(roleModules?.staff) ? roleModules!.staff : defaultRoleModules.staff,
    manager: Array.isArray(roleModules?.manager)
      ? Array.from(new Set([...roleModules!.manager, 'dashboard']))
      : defaultRoleModules.manager,
    kitchen: Array.isArray(roleModules?.kitchen) ? roleModules!.kitchen : defaultRoleModules.kitchen,
  };

  useEffect(() => {
    let mounted = true;

    const refreshConnectivity = async () => {
      const browserSignal = typeof navigator !== 'undefined' ? navigator.onLine : true;
      if (!browserSignal) {
        if (mounted) setIsOnline(false);
        return;
      }
      const realOnline = await probeInternet();
      if (mounted) setIsOnline(realOnline);
    };

    const handleOnline = () => {
      void refreshConnectivity();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    void refreshConnectivity();
    const timer = window.setInterval(() => {
      void refreshConnectivity();
    }, 15000);

    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline || !user?.tenant_id) return;
    syncPendingOfflineSales(user.tenant_id).then((result) => {
      if (result.synced > 0) {
        notify('success', tx(safeLang, `${result.synced} offline satış sinxron olundu`, `${result.synced} офлайн продаж синхронизировано`, `${result.synced} offline sales synced`));
      }
      if ((result.failed || 0) > 0) {
        notify('error', tx(safeLang, `${result.failed} offline satış göndərilə bilmədi`, `${result.failed} офлайн продаж не удалось отправить`, `${result.failed} offline sales failed to sync`));
      }
    });
  }, [isOnline, user?.tenant_id]);

  useEffect(() => {
    if (!user?.tenant_id) {
      setPendingOfflineCount(0);
      return;
    }

    let mounted = true;
    const refreshPending = async () => {
      const count = await getPendingOfflineSalesCount(user.tenant_id as string);
      if (mounted) setPendingOfflineCount(count);
    };

    void refreshPending();
    const timer = window.setInterval(() => {
      void refreshPending();
    }, 15000);

    const onVisibility = () => {
      if (!document.hidden) void refreshPending();
    };
    window.addEventListener('focus', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener('focus', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.tenant_id]);

  useEffect(() => {
    if (!hasValidUser || !user?.tenant_id || !user?.username) return;
    let cancelled = false;
    const pollNotifications = async () => {
      try {
        const unread = await get_unread_staff_notifications_live(user.tenant_id, user.username);
        if (cancelled || unread.length === 0) return;
        unread.slice(0, 2).forEach((n) => {
          notify('info', `${n.title}: ${n.message}`);
        });
        await mark_staff_notifications_read_live(user.tenant_id, user.username);
      } catch (e: any) {
        logUiError(user?.tenant_id || activeTenant, 'app-shell', e?.message || 'Failed to load staff notifications');
      }
    };

    void pollNotifications();
    const timer = window.setInterval(() => {
      void pollNotifications();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasValidUser, user?.tenant_id, user?.username, notify, activeTenant]);

  useEffect(() => {
    if (!hasValidUser || !user?.tenant_id || !user?.username) return;
    const role = String(user.role || '').toLowerCase();
    if (role !== 'admin') return;
    const onceKey = `low_stock_popup_seen_${user.tenant_id}_${user.username}`;
    if (sessionStorage.getItem(onceKey) === '1') return;

    try {
      const threshold = Number(settings?.inventory_settings?.default_critical_threshold ?? 5);
      const lows = get_low_stock_items(user.tenant_id, threshold);
      if (lows.length > 0) {
        setLowStockModal(
          lows.map((l: any) => ({
            name: String(l.name || '-'),
            stock_qty: String(l.stock_qty ?? '0'),
            min_limit: String(l.min_limit ?? threshold),
            unit: String(l.unit || ''),
          }))
        );
      }
      sessionStorage.setItem(onceKey, '1');
    } catch {
      sessionStorage.setItem(onceKey, '1');
    }
  }, [hasValidUser, user?.tenant_id, user?.username, user?.role, settings?.inventory_settings?.default_critical_threshold]);

  useEffect(() => {
    const tenant = user?.tenant_id || activeTenant;
    const onWindowError = (event: ErrorEvent) => {
      logUiError(tenant, 'window-error', event.message || 'Unknown window error', {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      logUiError(tenant, 'unhandled-rejection', String(event.reason || 'Unhandled rejection'));
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandled);
    };
  }, [user?.tenant_id]);

  const sessionRole = String(user?.role || '').toLowerCase();
  const selectedTenantId = String(user?.tenant_id || activeTenant || 'tenant_default');
  const moduleTenantKey = `${selectedTenantId}:${String(user?.username || 'guest')}`;

  useEffect(() => {
    if (!hasValidUser || sessionRole !== 'super_admin') {
      setAvailableTenants([]);
      return;
    }
    let cancelled = false;
    const loadTenants = async () => {
      try {
        const rows = await list_tenants();
        if (cancelled) return;
        setAvailableTenants(
          (rows || [])
            .filter((row) => String(row?.tenant_id || '').trim())
            .sort((a, b) =>
              String(a.company_name || a.slug || a.tenant_id).localeCompare(
                String(b.company_name || b.slug || b.tenant_id),
              ),
            ),
        );
      } catch (error: any) {
        if (!cancelled) {
          setAvailableTenants([]);
          logUiError(selectedTenantId, 'tenant-switcher', error?.message || 'Failed to load tenants');
        }
      }
    };
    void loadTenants();
    return () => {
      cancelled = true;
    };
  }, [hasValidUser, sessionRole, selectedTenantId]);

  const handleTenantSwitch = (nextTenantId: string) => {
    const safeTenantId = String(nextTenantId || '').trim();
    if (!safeTenantId || safeTenantId === selectedTenantId) return;
    setTenantSwitching(true);
    try {
      clearDBCache();
      switchTenantContext(safeTenantId);
      sessionStorage.removeItem(`low_stock_popup_seen_${selectedTenantId}_${user?.username || ''}`);
      sessionStorage.removeItem(`low_stock_popup_seen_${safeTenantId}_${user?.username || ''}`);
    } catch (error: any) {
      setTenantSwitching(false);
      notify('error', error?.message || 'Tenant keçidi alınmadı');
      return;
    }
    window.setTimeout(() => {
      window.location.reload();
    }, 120);
  };

  const moduleButtons: Array<{ key: ModuleKey; label: string; manager?: boolean; adminOnly?: boolean; superAdminOnly?: boolean }> = [
    { key: 'pos', label: t.modules.pos },
    { key: 'tables', label: t.modules.tables },
    { key: 'kds', label: t.modules.kds },
    { key: 'dashboard', label: t.modules.dashboard, manager: true },
    { key: 'finance', label: t.modules.finance, manager: true },
    { key: 'analytics', label: t.modules.analytics, manager: true },
    { key: 'zreport', label: t.modules.zreport },
    { key: 'inventory', label: t.modules.inventory, manager: true },
    { key: 'menu', label: t.modules.menu, manager: true },
    { key: 'recipes', label: t.modules.recipes, manager: true },
    { key: 'logs', label: t.modules.logs, manager: true },
    { key: 'crm', label: t.modules.crm, manager: true },
    { key: 'customerapp', label: t.modules.customerapp, manager: true },
    { key: 'notes', label: t.modules.notes, adminOnly: true },
    { key: 'database', label: t.modules.database, adminOnly: true },
    { key: 'settings', label: t.modules.settings, adminOnly: true },
    { key: 'ai', label: t.modules.ai, manager: true },
    { key: 'tenants', label: t.modules.tenants, superAdminOnly: true },
  ];

  const canAccess = (key: ModuleKey) => {
    const role = sessionRole;
    const definition = moduleButtons.find((item) => item.key === key);
    if (definition?.superAdminOnly) return role === 'super_admin';
    if (role === 'super_admin') return true;
    if (role === 'admin') return true;

    if (safeRoleModules) {
      if (role === 'manager') return safeRoleModules.manager.includes(key);
      if (role === 'staff') return safeRoleModules.staff.includes(key);
      if (role === 'kitchen') return safeRoleModules.kitchen.includes(key);
    }

    if (role === 'kitchen') {
      return key === 'kds';
    }

    if (role === 'manager') {
      if (['settings', 'database', 'notes'].includes(key)) return false;
      if (key === 'tables') return uiVisibility.manager_show_tables;
      return true;
    }

    // staff/cashier default access
    if (role === 'staff') {
      if (key === 'pos') return true;
      if (key === 'tables') return uiVisibility.staff_show_tables;
      if (key === 'kds') return uiVisibility.staff_show_kitchen;
      if (key === 'zreport') return true;
      return false;
    }

    return key === 'pos';
  };

  const visibleModules = moduleButtons.filter((m) => canAccess(m.key));
  const resolvedModule = visibleModules.find((m) => m.key === currentModule)?.key || visibleModules[0]?.key || 'pos';

  const visibleModuleKeys = visibleModules.map((m) => m.key).join('|');

  useEffect(() => {
    if (!visibleModules.find((m) => m.key === currentModule)) {
      setCurrentModule(visibleModules[0]?.key || 'pos');
    }
  }, [sessionRole, currentModule, visibleModuleKeys]);

  useEffect(() => {
    if (safeLang !== lang) {
      setLang(safeLang);
    }
  }, [lang, safeLang, setLang]);

  if (!hasHydrated) {
    return (
      <div className="metal-app flex min-h-screen items-center justify-center text-slate-300">
        <div className="metal-panel rounded-xl px-6 py-4 text-sm">Sistem yüklənir...</div>
      </div>
    );
  }

  // Public receipt route should not redirect to login even if token is missing/invalid.
  if (publicReceiptParams.receiptId) {
    return <PublicReceipt receiptId={publicReceiptParams.receiptId} token={publicReceiptParams.token} />;
  }

  if (customerAppParams.join || (customerAppParams.cardId && customerAppParams.token)) {
    return <CustomerApp cardId={customerAppParams.cardId} token={customerAppParams.token} joinMode={customerAppParams.join} />;
  }

  if (hostMode === 'landing') {
    return <LandingPage />;
  }

  if (!hasValidUser) {
    return <PinLogin />;
  }

  const safeUser = user as NonNullable<typeof user>;
  const hostTenantMismatch = Boolean(
    currentHost &&
    currentHost !== 'localhost' &&
    currentHost !== '127.0.0.1' &&
    mappedTenantFromHost &&
    mappedTenantFromHost !== String(safeUser.tenant_id || ''),
  );
  const unknownForeignHost = Boolean(
    currentHost &&
    currentHost !== 'localhost' &&
    currentHost !== '127.0.0.1' &&
    !mappedTenantFromHost &&
    profileWebsiteHost &&
    currentHost !== profileWebsiteHost,
  );

  if (hostTenantMismatch || unknownForeignHost) {
    return (
      <div className="metal-app flex min-h-screen items-center justify-center px-4 text-slate-100">
        <div className="metal-panel w-full max-w-xl rounded-3xl p-8 text-center">
          <h1 className="text-2xl font-black">{tx(safeLang, 'Tenant tapılmadı', 'Тенант не найден', 'Tenant not found')}</h1>
          <p className="mt-3 text-sm text-slate-300">
            {tx(
              safeLang,
              'Bu subdomain üçün aktiv tenant yoxdur. Silinmiş və ya qurulmamış tenant heç vaxt başqa tenant-a açılmamalıdır.',
              'Для этого поддомена нет активного тенанта. Удаленный или не настроенный тенант не должен открываться как другой.',
              'There is no active tenant for this subdomain. A deleted or unconfigured tenant must never open as another tenant.',
            )}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button onClick={() => window.location.reload()} className="neon-btn px-4 py-3">
              {tx(safeLang, 'Yenilə', 'Обновить', 'Refresh')}
            </button>
            <button
              onClick={() => {
                const target = profileWebsiteHost ? `https://${profileWebsiteHost}` : 'https://super.ironwaves.store';
                window.location.href = target;
              }}
              className="glossy-gold rounded-xl px-5 py-3 font-bold text-slate-900"
            >
              {tx(safeLang, 'Platforma qayıt', 'Вернуться на платформу', 'Return to platform')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="metal-app flex h-[100dvh] min-h-[100dvh] overflow-hidden font-sans text-slate-100 selection:bg-yellow-300/30">
      <ToastOverlay />
      {lowStockModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="metal-panel w-full max-w-2xl rounded-2xl border border-amber-400/40 p-5">
            <h3 className="mb-2 text-xl font-bold text-amber-300">⚠️ Kritik Anbar Xəbərdarlığı</h3>
            <p className="mb-4 text-sm text-slate-300">Aşağıdakı mallar kritik stok həddindədir.</p>
            <div className="max-h-72 overflow-auto rounded-xl border border-slate-700/70">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/70 text-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left">Məhsul</th>
                    <th className="px-3 py-2 text-left">Qalıq</th>
                    <th className="px-3 py-2 text-left">Kritik Hədd</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockModal.map((row, idx) => (
                    <tr key={`${row.name}_${idx}`} className="border-t border-slate-700/70">
                      <td className="px-3 py-2 text-slate-100">{row.name}</td>
                      <td className="px-3 py-2 text-rose-300">{row.stock_qty} {row.unit}</td>
                      <td className="px-3 py-2 text-slate-300">{row.min_limit} {row.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end">
              <button className="glossy-gold rounded-xl px-5 py-2 font-semibold" onClick={() => setLowStockModal(null)}>
                Bağla
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        <div className="border-b border-slate-700/40 px-4 py-4 md:px-6 shrink-0 z-20 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-400 text-[#111827] rounded-xl flex items-center justify-center shrink-0 font-black overflow-hidden">
                {profile?.logo_url ? (
                  <img src={profile.logo_url} alt="logo" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-bold text-lg">SB</span>
                )}
              </div>
              <div>
                <p className="font-semibold leading-tight">iRonWaves POS RC</p>
                  <p className="text-xs text-slate-400">{safeUser.username} / {safeUser.role}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {sessionRole === 'super_admin' && availableTenants.length > 0 && (
                <label className="flex items-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-100">
                  <span className="hidden md:inline">{tx(safeLang, 'Tenant', 'Тенант', 'Tenant')}</span>
                  <select
                    value={selectedTenantId}
                    onChange={(event) => handleTenantSwitch(event.target.value)}
                    disabled={tenantSwitching}
                    className="min-w-[180px] bg-transparent text-sm font-medium text-cyan-50 outline-none"
                  >
                    {availableTenants.map((tenant) => (
                      <option key={tenant.tenant_id} value={tenant.tenant_id} className="bg-slate-900 text-slate-100">
                        {tenant.company_name || tenant.slug || tenant.tenant_id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isOnline ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-200 shadow-sm animate-pulse'
              }`}>
                {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
                <span>{isOnline ? t.online : t.offline}</span>
              </div>
              {pendingOfflineCount > 0 && (
                <div className="flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1.5 text-sm font-medium text-amber-200">
                  <span>{pendingOfflineCount}</span>
                  <span>{tx(safeLang, 'gözləyən sync', 'ожидает синхронизации', 'pending sync')}</span>
                </div>
              )}
              <button
                onClick={() => window.location.reload()}
                className="neon-btn px-3 py-2"
                title="Yenilə"
              >
                <RotateCcw size={16} />
                <span className="hidden sm:inline">{t.refresh}</span>
              </button>
              <button
                onClick={() => setLang(safeLang === 'az' ? 'ru' : safeLang === 'ru' ? 'en' : 'az')}
                className="neon-btn px-3 py-2"
              >
                <Languages size={16} />
                <span>{safeLang.toUpperCase()}</span>
              </button>
              <button
                onClick={logout}
                className="neon-btn-active px-3 py-2"
              >
                <LogOut size={16} />
                <span>{t.logout}</span>
              </button>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3 overflow-x-auto pb-2">
            {visibleModules.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setCurrentModule(item.key)}
                  className={`${resolvedModule === item.key ? 'neon-chip neon-chip-active' : 'neon-chip'} whitespace-nowrap px-4 py-3 text-sm`}
                >
                  <span>{item.label}</span>
                </button>
              ))}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AppErrorBoundary>
            {resolvedModule === 'pos' && <POS key={moduleTenantKey} />}
            {resolvedModule === 'kds' && <KDS key={moduleTenantKey} />}
            {resolvedModule === 'tables' && <TablesPage key={moduleTenantKey} />}
            {!['pos', 'kds', 'tables'].includes(resolvedModule) && <AdminPanel key={moduleTenantKey} externalTab={resolvedModule as AdminView} />}
          </AppErrorBoundary>
        </div>

        <div className="shrink-0 border-t border-slate-700/40 bg-[#0e141d]/95 px-2 py-2 md:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {visibleModules.map((item) => (
              <button
                key={`mobile_${item.key}`}
                onClick={() => setCurrentModule(item.key)}
                className={`${resolvedModule === item.key ? 'neon-chip neon-chip-active' : 'neon-chip'} whitespace-nowrap`}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hidden md:block shrink-0 border-t border-slate-700/40 px-4 py-2 text-center text-xs text-slate-400">
          iRonWaves POS RC
        </div>
      </div>
    </div>
  );
}
