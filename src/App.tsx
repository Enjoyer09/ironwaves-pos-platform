import React, { Suspense, lazy, useState, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from './store';
import { i18n, tx } from './i18n';
import PinLogin from './components/PinLogin';
import { LogOut, Wifi, WifiOff, Languages, RotateCcw, Maximize2, Minimize2, MessageCircleQuestion } from 'lucide-react';
import VirtualKeyboard from './components/VirtualKeyboard';
import { seedDatabase } from './lib/seeder';
import ToastOverlay from './components/ToastOverlay';
import { get_business_profile, get_business_profile_live } from './api/settings';
import { get_settings, get_settings_live } from './api/settings';
import AppErrorBoundary from './components/AppErrorBoundary';
import { logUiError } from './lib/logger';
import { getPendingOfflineSalesCount, syncPendingOfflineSales } from './lib/offline';
import { probeInternet } from './lib/connectivity';
import { get_unread_staff_notifications_live, mark_staff_notification_read_live, mark_staff_notifications_read_live } from './api/reports';
import { getActiveTenantId, getResolvedTenantIdFromHost } from './lib/tenant';
import { get_low_stock_items } from './api/inventory';
import { list_tenants, type TenantRecord } from './api/tenants';
import { clearDBCache } from './lib/db_sim';
import { authApi } from './api/auth';
import { apiRequest, isBackendEnabled } from './api/client';
import { isPerfDebugEnabled, type PerfEvent } from './lib/perf';
import { syncPendingOfflineTableOps } from './api/tables';
import HelpAssistant from './components/HelpAssistant';

const POS = lazy(() => import('./components/POS'));
const KDS = lazy(() => import('./components/KDS'));
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const TablesPage = lazy(() => import('./components/TablesPage'));
const PublicReceipt = lazy(() => import('./components/PublicReceipt'));
const PublicMenu = lazy(() => import('./components/PublicMenu'));
const CustomerApp = lazy(() => import('./components/CustomerApp'));
const LandingPage = lazy(() => import('./components/LandingPage'));
const FeedbackPortal = lazy(() => import('./components/FeedbackPortal'));

type AdminView =
  | 'dashboard'
  | 'analytics'
  | 'menu'
  | 'finance'
  | 'inventory'
  | 'crm'
  | 'customerapp'
  | 'posbuilder'
  | 'recipes'
  | 'ai'
  | 'settings'
  | 'notes'
  | 'logs'
  | 'database'
  | 'zreport'
  | 'combos'
  | 'landing'
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
  | 'posbuilder'
  | 'ai'
  | 'menu'
  | 'recipes'
  | 'tenants'
  | 'notes'
  | 'settings'
  | 'landing'
  | 'database';

type DemoGuideBubble = {
  text: string;
  x: number;
  y: number;
};

const DEMO_MODULE_GUIDE_AZ: Record<ModuleKey, string> = {
  pos: 'Satışı bu bölmədə başlayırsınız: məhsul seçimi, səbət və ödəniş tamamlanır.',
  tables: 'Masa açma, sifarişin mətbəxə ötürülməsi və masa hesabının bağlanması buradan idarə olunur.',
  kds: 'Mətbəx komandasının iş ekranıdır: sifariş statusları burada yenilənir.',
  zreport: 'Gün sonu yekun hesabatı və kassa nəticələri bu bölmədə çıxarılır.',
  finance: 'Pul axını, transferlər, investor borcu və jurnal nəzarəti bu bölmədədir.',
  inventory: 'Anbar qalıqları, xammal hərəkətləri və kritik limitlər burada izlənir.',
  combos: 'Kampaniya və kombo məhsullar burada yaradılır və idarə olunur.',
  dashboard: 'Bütün əsas göstəricilər və kritik xəbərdarlıqlar bir baxışda göstərilir.',
  analytics: 'Satış trendi, performans və qərar üçün analitik göstəricilər burada toplanır.',
  logs: 'Sistem xətaları və texniki hadisələr bu bölmədə izlənir.',
  crm: 'Müştəri bazası, loyallıq və bonus axını bu bölmədə idarə edilir.',
  customerapp: 'Müştərinin özünəxidmət axını və tətbiq tərəfi bu bölmədən nəzarət olunur.',
  posbuilder: 'POS görünüşünü və iş axınını biznesinizə uyğunlaşdırmaq üçün istifadə olunur.',
  ai: 'AI tövsiyələri və əməliyyat optimallaşdırma siqnalları burada göstərilir.',
  menu: 'Menyu məhsulu yaratma, qiymətləmə və deaktiv/silmə əməliyyatları bu bölmədədir.',
  recipes: 'Menyu məhsullarını anbar xammalı ilə bağlayan reseptlər burada idarə olunur.',
  tenants: 'Tenant yaratma, domen nəzarəti və multi-tenant idarəetməsi bu bölmədədir.',
  notes: 'Daxili əməliyyat qeydləri və komanda üçün xatırlatmalar bu bölmədə saxlanılır.',
  settings: 'Sistem ayarları, icazələr və biznes konfiqurasiyası burada dəyişdirilir.',
  landing: 'Landing məzmunu və vizual təqdimat buradan redaktə olunur.',
  database: 'Backup/restore və texniki baza əməliyyatları bu bölmədə icra edilir.',
};

const LAZY_FALLBACK_RECOVERY_KEY = 'ui_lazy_fallback_recovery_once';

function LazyModuleFallback({ lang }: { lang: 'az' | 'ru' | 'en' }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (sessionStorage.getItem(LAZY_FALLBACK_RECOVERY_KEY) === 'done') return;
          sessionStorage.setItem(LAZY_FALLBACK_RECOVERY_KEY, 'done');
          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((registration) => registration.unregister()));
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
          }
          const url = new URL(window.location.href);
          url.searchParams.set('_app_reset', String(Date.now()));
          window.location.replace(url.toString());
        } catch {
          window.location.reload();
        }
      })();
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="metal-app flex min-h-screen items-center justify-center text-slate-300">
      <div className="metal-panel rounded-xl px-6 py-4 text-sm">
        {tx(lang, 'Bölmə yüklənir...', 'Раздел загружается...', 'Loading section...')}
      </div>
    </div>
  );
}

export default function App() {
  const user = useAppStore((state) => state.user);
  const access_token = useAppStore((state) => state.access_token);
  const logout = useAppStore((state) => state.logout);
  const lang = useAppStore((state) => state.lang);
  const setLang = useAppStore((state) => state.setLang);
  const hasHydrated = useAppStore((state) => state.hasHydrated);
  const notify = useAppStore((state) => state.notify);
  const switchTenantContext = useAppStore((state) => state.switchTenantContext);
  const applySessionUser = useAppStore((state) => state.applySessionUser);
  const restoreSession = useAppStore((state) => state.restoreSession);
  const activeTenant = getActiveTenantId();
  const safeLang = (lang === 'az' || lang === 'ru' || lang === 'en') ? lang : 'az';
  const backendMode = isBackendEnabled();

  useEffect(() => {
    try {
      sessionStorage.removeItem('ui_chunk_reload_once');
    } catch {
      // ignore
    }
  }, []);
  const t = i18n[safeLang];
  const lazyModuleFallback = <LazyModuleFallback lang={safeLang} />;
  const hasValidUser = Boolean(
    user &&
    typeof user.username === 'string' &&
    typeof user.role === 'string' &&
    typeof access_token === 'string' &&
    access_token.length > 8
  );

  useEffect(() => {
    if (isBackendEnabled()) return;
    try {
      seedDatabase();
    } catch (error) {
      console.error('Seed database failed:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const prepareField = (field: HTMLInputElement | HTMLTextAreaElement) => {
      if (!field.classList.contains('neon-input')) return;
      const inputType = field instanceof HTMLInputElement ? String(field.type || '').toLowerCase() : 'textarea';
      const inputMode = field instanceof HTMLInputElement ? String(field.inputMode || '').toLowerCase() : '';
      if (
        field instanceof HTMLInputElement &&
        !field.dataset.virtualKeyboardMode &&
        (inputType === 'number' || inputType === 'tel' || inputMode === 'numeric' || inputMode === 'decimal')
      ) {
        field.dataset.virtualKeyboardMode = 'numeric';
      }

      const originalPlaceholder = field.getAttribute('data-original-placeholder') || field.getAttribute('placeholder') || '';
      if (originalPlaceholder && !field.getAttribute('data-original-placeholder')) {
        field.setAttribute('data-original-placeholder', originalPlaceholder);
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        prepareField(target);
      }
    };

    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  useEffect(() => {
    if (!hasValidUser || !user?.tenant_id) return;
    void get_business_profile_live(user.tenant_id).catch(() => {});
    void get_settings_live(user.tenant_id).catch(() => {});
  }, [hasValidUser, user?.tenant_id]);

  useEffect(() => {
    if (!hasValidUser || !user?.tenant_id || !backendMode) return;
    const role = String(user?.role || '').toLowerCase();
    const isSuperAdmin = role === 'super_admin';
    // Super admin triggers many more requests (finance + list_tenants).
    // Stagger more aggressively to avoid overwhelming the DB connection pool.
    const initialDelay = isSuperAdmin ? 2000 : 500;
    const staggerMs = isSuperAdmin ? 400 : 180;
    const timerId = window.setTimeout(() => {
      const today = new Date().toISOString().slice(0, 10);
      const canUseFinance = ['manager', 'admin', 'finance_admin', 'super_admin'].includes(role);
      const hotPaths = [
        '/api/v1/ops/settings',
        '/api/v1/pos/menu',
        '/api/v1/ops/tables',
        '/api/v1/restaurant/tables-bootstrap',
        ...(canUseFinance
          ? [
              '/api/v1/finance/summary',
              '/api/v1/finance/balances',
              '/api/v1/finance/anomalies',
              `/api/v1/finance/reports/overview?date_from=${today}&date_to=${today}`,
              '/api/v1/reports/status',
            ]
          : []),
      ];
      hotPaths.forEach((path, index) => {
        window.setTimeout(() => {
          void apiRequest(path, {
            tenantId: null,
            timeoutMs: 8000,
            retryCount: 0,
          }).catch(() => null);
        }, index * staggerMs);
      });
    }, initialDelay);
    return () => window.clearTimeout(timerId);
  }, [backendMode, hasValidUser, user?.role, user?.tenant_id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleAuthExpired = () => {
      notify('info', tx(safeLang, 'Sessiya bitdi, yenidən giriş edin', 'Сессия истекла, войдите снова', 'Session expired, please sign in again'));
      logout();
    };
    window.addEventListener('ironwaves-auth-expired', handleAuthExpired as EventListener);
    return () => window.removeEventListener('ironwaves-auth-expired', handleAuthExpired as EventListener);
  }, [logout, notify, safeLang]);

  const hostMode = useMemo(() => {
    if (typeof window === 'undefined') return 'app';
    const host = String(window.location.host || '').toLowerCase().split(':')[0];
    if (
      host === 'www.ironwaves.store' ||
      host === 'ironwaves.store'
    ) {
      return 'landing';
    }
    return 'app';
  }, []);

  const currentHost = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return String(window.location.host || '').trim().toLowerCase().split(':')[0];
  }, []);

  const mappedTenantFromHost = useMemo(() => getResolvedTenantIdFromHost(currentHost), [currentHost]);
  const isDemoTourHost = currentHost === 'demo.ironwaves.store' || currentHost === 'demo.ironwaves';

  const [sessionChecking, setSessionChecking] = useState(false);
  const [sessionRestorePending, setSessionRestorePending] = useState(false);
  const [readyPopup, setReadyPopup] = useState<any | null>(null);
  const sessionRestoreTriedRef = useRef(false);
  const syncSessionRanRef = useRef(false);

  useEffect(() => {
    if (!hasHydrated) return;
    if (hasValidUser) return;
    if (!user?.username) return;
    if (sessionRestoreTriedRef.current) return;

    const hostTenant = String(mappedTenantFromHost || '').trim();
    const sessionTenant = String(user?.tenant_id || '').trim();
    // Prevent cross-tenant persisted sessions from entering a restore loop on another domain.
    // In backend mode, host->tenant resolution is authoritative on server side.
    // Do not force client-side logout based on potentially stale local host mapping.
    if (!backendMode && hostTenant && sessionTenant && hostTenant !== sessionTenant) {
      logout();
      return;
    }

    sessionRestoreTriedRef.current = true;
    let cancelled = false;
    setSessionRestorePending(true);
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      setSessionRestorePending(false);
      logout();
    }, 3000);
    const run = async () => {
      try {
        await restoreSession();
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) setSessionRestorePending(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [backendMode, hasHydrated, hasValidUser, user?.username, user?.tenant_id, restoreSession, mappedTenantFromHost, logout]);

  useEffect(() => {
    if (!hasValidUser) {
      syncSessionRanRef.current = false;
      return;
    }
    if (syncSessionRanRef.current) return;
    syncSessionRanRef.current = true;
    let cancelled = false;
    const shouldBlockForTenantMismatch =
      !backendMode &&
      Boolean(mappedTenantFromHost) &&
      String(mappedTenantFromHost || '') !== String(user?.tenant_id || '');
    if (shouldBlockForTenantMismatch) setSessionChecking(true);
    const syncSession = async () => {
      const extractErrorMessage = (error: unknown) =>
        String(error instanceof Error ? error.message : error || '').toLowerCase();
      const isTransientSessionError = (message: string) =>
        message.includes('tenant not configured') ||
        message.includes('backendə qoşulma alınmadı') ||
        message.includes('failed to fetch') ||
        message.includes('sorğu vaxt limiti keçdi');
      const isHardAuthFailure = (message: string) =>
        message.includes('invalid token') ||
        message.includes('unauthorized') ||
        message.includes('token revoked') ||
        message.includes('tenant mismatch') ||
        message.includes('user not found');
      try {
        let me: any = null;
        try {
          me = await authApi.me();
        } catch (firstError) {
          const message = extractErrorMessage(firstError);
          const transientTenantFailure = isTransientSessionError(message);
          if (!transientTenantFailure) throw firstError;
          await new Promise((resolve) => window.setTimeout(resolve, 700));
          me = await authApi.me();
        }
        if (!me || cancelled) return;
        const nextRole = String(me.role || '');
        const nextTenant = String(me.tenant_id || '');
        // If backend session tenant and host-mapped tenant disagree, stop session immediately.
        if (!backendMode && mappedTenantFromHost && nextTenant && String(mappedTenantFromHost) !== nextTenant) {
          if (!cancelled) logout();
          return;
        }
        if (nextRole !== String(user?.role || '') || nextTenant !== String(user?.tenant_id || '')) {
          applySessionUser({
            username: String(me.username || user?.username || ''),
            role: nextRole,
            tenant_id: nextTenant,
          });
        }
      } catch (error) {
        if (!cancelled) {
          const message = extractErrorMessage(error);
          if (isHardAuthFailure(message)) {
            logout();
          } else if (!isTransientSessionError(message)) {
            logout();
          }
        }
      } finally {
        if (!cancelled) setSessionChecking(false);
      }
    };
    void syncSession();
    return () => {
      cancelled = true;
    };
  }, [backendMode, hasValidUser, user?.role, user?.tenant_id, user?.username, applySessionUser, logout, mappedTenantFromHost]);

  const [currentModule, setCurrentModule] = useState<ModuleKey>('pos');
  const [mountedModules, setMountedModules] = useState<ModuleKey[]>(['pos']);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [lowStockModal, setLowStockModal] = useState<Array<{ name: string; stock_qty: string; min_limit: string; unit: string }> | null>(null);
  const [availableTenants, setAvailableTenants] = useState<TenantRecord[]>([]);
  const [tenantSwitching, setTenantSwitching] = useState(false);
  const [businessProfileVersion, setBusinessProfileVersion] = useState(0);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [perfEvents, setPerfEvents] = useState<PerfEvent[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [demoGuideBubble, setDemoGuideBubble] = useState<DemoGuideBubble | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const demoGuideShownModulesRef = useRef<Set<ModuleKey>>(new Set());
  const offlineCountRef = useRef(0);
  const pendingOfflineInFlightRef = useRef(false);
  const notificationInFlightRef = useRef(false);
  const softRefreshInFlightRef = useRef(false);
  const businessProfileUpdateTimerRef = useRef<number | null>(null);
  const settingsUpdateTimerRef = useRef<number | null>(null);

  const publicReceiptParams = useMemo(() => {
    if (typeof window === 'undefined') return { receiptId: '', token: '' };
    const params = new URLSearchParams(window.location.search);
    return {
      receiptId: params.get('r') || params.get('receipt') || params.get('sale_id') || '',
      token: params.get('t') || params.get('token') || '',
    };
  }, []);

  const publicPathname = useMemo(() => {
    if (typeof window === 'undefined') return '/';
    return String(window.location.pathname || '/');
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

  const feedbackParams = useMemo(() => {
    if (typeof window === 'undefined') return { tenantId: '', saleId: '', receiptId: '', receiptToken: '' };
    const params = new URLSearchParams(window.location.search);
    return {
      tenantId: params.get('tenant_id') || '',
      saleId: params.get('sale_id') || '',
      receiptId: params.get('receipt_id') || params.get('r') || '',
      receiptToken: params.get('t') || params.get('token') || '',
    };
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
  }, [hasValidUser, user?.tenant_id, businessProfileVersion, settingsVersion]);

  const profile = appConfig.profile;
  const settings = appConfig.settings;
  const profileWebsiteHost = useMemo(() => {
    const raw = String(profile?.website || '').trim().toLowerCase();
    if (!raw) return '';
    return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  }, [profile?.website]);

  const uiVisibility = settings?.ui_visibility || defaultUiVisibility;
  const idleLogoutMinutes = Math.max(0, Number(settings?.session_settings?.idle_logout_minutes || 0));
  const virtualKeyboardEnabled = settings?.session_settings?.virtual_keyboard_enabled !== false;
  const themeMode: 'dark' | 'light' = settings?.session_settings?.theme_mode === 'light' ? 'light' : 'dark';
  const roleModules = settings?.role_modules || null;
  const safeRoleModules = {
    staff: Array.isArray(roleModules?.staff) ? roleModules!.staff : defaultRoleModules.staff,
    manager: Array.isArray(roleModules?.manager)
      ? Array.from(new Set([...roleModules!.manager, 'dashboard']))
      : defaultRoleModules.manager,
    kitchen: Array.isArray(roleModules?.kitchen) ? roleModules!.kitchen : defaultRoleModules.kitchen,
  };

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', themeMode);
    root.style.colorScheme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-ui-mode', 'old');
  }, []);

  useEffect(() => {
    const handleOpenTableInPos = () => setCurrentModule('pos');
    window.addEventListener('open-table-in-pos', handleOpenTableInPos as EventListener);
    return () => {
      window.removeEventListener('open-table-in-pos', handleOpenTableInPos as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleTableOrderSent = () => setCurrentModule('tables');
    window.addEventListener('table-order-sent', handleTableOrderSent as EventListener);
    return () => {
      window.removeEventListener('table-order-sent', handleTableOrderSent as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleNavigateModule = (event: Event) => {
      const detail = (event as CustomEvent<{ module?: string }>).detail;
      const target = String(detail?.module || '').trim().toLowerCase() as ModuleKey;
      if (!target) return;
      const allowedTargets = new Set<ModuleKey>([
        'pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'dashboard', 'analytics',
        'logs', 'crm', 'customerapp', 'posbuilder', 'ai', 'menu', 'recipes', 'tenants', 'notes', 'settings', 'landing', 'database',
      ]);
      if (!allowedTargets.has(target)) return;
      setCurrentModule(target);
    };
    window.addEventListener('navigate-module', handleNavigateModule as EventListener);
    return () => {
      window.removeEventListener('navigate-module', handleNavigateModule as EventListener);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let timerId: number | null = null;

    const refreshConnectivity = async () => {
      const browserSignal = typeof navigator !== 'undefined' ? navigator.onLine : true;
      if (!browserSignal) {
        if (mounted) setIsOnline(false);
        return;
      }
      const realOnline = await probeInternet();
      if (mounted) setIsOnline(realOnline);
    };
    const scheduleNext = () => {
      if (!mounted) return;
      const intervalMs = document.visibilityState === 'visible' ? 60000 : 180000;
      timerId = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          void refreshConnectivity();
        }
        scheduleNext();
      }, intervalMs);
    };

    const handleOnline = () => {
      void refreshConnectivity();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (document.visibilityState === 'visible') {
      void refreshConnectivity();
    }
    scheduleNext();

    return () => {
      mounted = false;
      if (timerId) window.clearTimeout(timerId);
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
    syncPendingOfflineTableOps(user.tenant_id).then((result) => {
      if (result.synced > 0) {
        notify('success', tx(safeLang, `${result.synced} masa əməliyyatı sinxron olundu`, `${result.synced} операций по столам синхронизировано`, `${result.synced} table operations synced`));
      }
      if ((result.failed || 0) > 0) {
        notify('error', tx(safeLang, `${result.failed} masa əməliyyatı hələ gözləyir`, `${result.failed} операций по столам еще ожидают`, `${result.failed} table operations are still pending`));
      }
    });
  }, [isOnline, user?.tenant_id]);

  useEffect(() => {
    if (!user?.tenant_id) {
      setPendingOfflineCount(0);
      return;
    }

    let mounted = true;
    let timerId: number | null = null;
    const refreshPending = async () => {
      if (pendingOfflineInFlightRef.current) return;
      pendingOfflineInFlightRef.current = true;
      try {
        const count = await getPendingOfflineSalesCount(user.tenant_id as string);
        if (mounted && offlineCountRef.current !== count) {
          offlineCountRef.current = count;
          setPendingOfflineCount(count);
        }
      } finally {
        pendingOfflineInFlightRef.current = false;
      }
    };
    const scheduleNext = () => {
      if (!mounted) return;
      const intervalMs = document.visibilityState === 'visible' ? 45000 : 150000;
      timerId = window.setTimeout(() => {
        if (document.visibilityState === 'visible') void refreshPending();
        scheduleNext();
      }, intervalMs);
    };

    void refreshPending();
    scheduleNext();

    const onVisibility = () => {
      if (!document.hidden) void refreshPending();
    };
    window.addEventListener('focus', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mounted = false;
      if (timerId) window.clearTimeout(timerId);
      window.removeEventListener('focus', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.tenant_id]);

  useEffect(() => {
    if (!hasValidUser) return;
    if (!idleLogoutMinutes) return;

    let timeoutId: number | null = null;
    const timeoutMs = idleLogoutMinutes * 60 * 1000;

    const resetTimer = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        notify('info', tx(safeLang, 'İnaktivlik səbəbilə sistemdən çıxış edildi', 'Вы вышли из системы из-за неактивности', 'You were signed out due to inactivity'));
        logout();
      }, timeoutMs);
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer as EventListener));
    };
  }, [hasValidUser, idleLogoutMinutes, logout, notify, safeLang]);

  useEffect(() => {
    if (!hasValidUser || !user?.tenant_id || !user?.username) return;
    let cancelled = false;
    let timerId: number | null = null;
    const pollNotifications = async () => {
      if (notificationInFlightRef.current || document.visibilityState !== 'visible') return;
      notificationInFlightRef.current = true;
      try {
        const unread = await get_unread_staff_notifications_live(user.tenant_id, user.username);
        if (cancelled || unread.length === 0) return;
        const readyNotification = unread.find((n) => String(n.meta?.status || '') === 'READY');
        if (readyNotification) {
          setReadyPopup((prev: any) => prev || readyNotification);
        }
        const nonReady = unread.filter((n) => String(n.meta?.status || '') !== 'READY');
        nonReady.slice(0, 2).forEach((n) => {
          notify('info', `${n.title}: ${n.message}`);
        });
        if (nonReady.length > 0) {
          await mark_staff_notifications_read_live(user.tenant_id, user.username);
        }
      } catch (e: any) {
        logUiError(user?.tenant_id || activeTenant, 'app-shell', e?.message || 'Failed to load staff notifications');
      } finally {
        notificationInFlightRef.current = false;
      }
    };
    const scheduleNext = () => {
      if (cancelled) return;
      const intervalMs = document.visibilityState === 'visible' ? 45000 : 180000;
      timerId = window.setTimeout(() => {
        void pollNotifications();
        scheduleNext();
      }, intervalMs);
    };
    const onVisibility = () => {
      if (!document.hidden) void pollNotifications();
    };

    void pollNotifications();
    scheduleNext();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hasValidUser, user?.tenant_id, user?.username, notify, activeTenant]);

  useEffect(() => {
    const onKeyboardVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ visible?: boolean; height?: number }>).detail || {};
      const nextInset = detail.visible ? Math.max(0, Number(detail.height || 0)) : 0;
      setKeyboardInset(nextInset);
    };
    window.addEventListener('virtual-keyboard-visibility', onKeyboardVisibility as EventListener);
    return () => {
      window.removeEventListener('virtual-keyboard-visibility', onKeyboardVisibility as EventListener);
    };
  }, []);

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

  useEffect(() => {
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
    const tenant = user?.tenant_id || activeTenant || 'tenant_default';
    let lastReportedAt = 0;
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        const now = Date.now();
        if (now - lastReportedAt < 8000) return;
        const entries = list.getEntries() || [];
        const heavy = entries.find((entry: any) => Number(entry.duration || 0) >= 180);
        if (!heavy) return;
        lastReportedAt = now;
        logUiError(tenant, 'ui-freeze', 'Long task detected on main thread', {
          duration_ms: Math.round(Number((heavy as any).duration || 0)),
          name: String((heavy as any).name || 'longtask'),
        });
      });
      observer.observe({ entryTypes: ['longtask'] as any });
    } catch {
      // longtask observer might be unavailable on some browsers
    }
    return () => {
      try {
        observer?.disconnect();
      } catch {
        // no-op
      }
    };
  }, [user?.tenant_id, activeTenant]);

  const sessionRole = String(user?.role || '').toLowerCase();
  const selectedTenantId = String(user?.tenant_id || activeTenant || 'tenant_default');
  const moduleTenantKey = `${selectedTenantId}:${String(user?.username || 'guest')}`;

  useEffect(() => {
    if (!hasValidUser || sessionRole !== 'super_admin') {
      setAvailableTenants([]);
      return;
    }
    let cancelled = false;
    // Delay tenant list load to avoid overwhelming backend during login burst.
    const timerId = window.setTimeout(() => {
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
    }, 5000);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
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
    { key: 'posbuilder', label: t.modules.posbuilder, manager: true },
    { key: 'notes', label: t.modules.notes, adminOnly: true },
    { key: 'database', label: t.modules.database, adminOnly: true },
    { key: 'settings', label: t.modules.settings, adminOnly: true },
    { key: 'landing', label: (t.modules as any).landing || tx(safeLang, 'Landing Studio', 'Landing Studio', 'Landing Studio'), superAdminOnly: true },
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
  const demoGuideEnabled = isDemoTourHost && hostMode !== 'landing';
  const describeActionAz = (label: string): string => {
    const normalized = String(label || '').toLowerCase();
    if (normalized.includes('yenilə')) return 'Səhifəni yeniləyir və məlumatları təzələyir.';
    if (normalized.includes('tam ekran')) return 'Tətbiqi tam ekran rejiminə keçirir və ya çıxarır.';
    if (normalized.includes('çıxış') || normalized.includes('logout')) return 'Cari sessiyanı bağlayıb sistemdən çıxır.';
    if (normalized.includes('tenant')) return 'Aktiv tenant mühitini dəyişir.';
    if (normalized.includes('az') || normalized.includes('ru') || normalized.includes('en')) return 'İnterfeys dilini dəyişir.';
    if (normalized.includes('online') || normalized.includes('offline')) return 'Şəbəkə bağlantısının vəziyyətini göstərir.';
    return 'Bu düymə seçilmiş əməliyyatı açır.';
  };
  const summarizeElementGuideAz = (element: HTMLElement | null): string => {
    if (!element) return '';
    const directGuide = String(element.getAttribute('data-guide') || '').trim();
    if (directGuide) return directGuide;

    const titleGuide = String(element.getAttribute('title') || '').trim();
    if (titleGuide) return titleGuide;

    const aria = String(element.getAttribute('aria-label') || '').trim();
    if (aria) return `${aria} funksiyasını açır.`;

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const placeholder = String(element.getAttribute('placeholder') || '').trim();
      if (placeholder) return `Bu sahə: ${placeholder}`;
      return 'Bu sahə ilə məlumat daxil edilir.';
    }

    const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) {
      const trimmed = text.length > 64 ? `${text.slice(0, 64)}...` : text;
      return `“${trimmed}” əməliyyatını açır.`;
    }
    return '';
  };
  const handleDemoGuideHover = (text: string, event: React.MouseEvent<HTMLElement>) => {
    if (!demoGuideEnabled || typeof window === 'undefined') return;
    const width = 310;
    const height = 94;
    const nextX = Math.min(window.innerWidth - width - 12, event.clientX + 12);
    const nextY = Math.min(window.innerHeight - height - 12, event.clientY + 12);
    setDemoGuideBubble({
      text,
      x: Math.max(12, nextX),
      y: Math.max(12, nextY),
    });
  };

  const visibleModuleKeys = visibleModules.map((m) => m.key).join('|');
  const shouldHoldForTenantResolution = Boolean(
    hasValidUser &&
    currentHost &&
    currentHost !== 'localhost' &&
    currentHost !== '127.0.0.1' &&
    mappedTenantFromHost &&
    String(mappedTenantFromHost || '') !== String(user?.tenant_id || ''),
  );

  useEffect(() => {
    const onBusinessProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      const eventTenant = String(detail?.tenant_id || '');
      const currentTenant = String(user?.tenant_id || activeTenant || '');
      if (!eventTenant || !currentTenant || eventTenant === currentTenant) {
        if (businessProfileUpdateTimerRef.current) window.clearTimeout(businessProfileUpdateTimerRef.current);
        businessProfileUpdateTimerRef.current = window.setTimeout(() => {
          setBusinessProfileVersion((prev) => prev + 1);
        }, 180);
      }
    };
    window.addEventListener('business-profile-updated', onBusinessProfileUpdated as EventListener);
    return () => {
      if (businessProfileUpdateTimerRef.current) window.clearTimeout(businessProfileUpdateTimerRef.current);
      window.removeEventListener('business-profile-updated', onBusinessProfileUpdated as EventListener);
    };
  }, [user?.tenant_id, activeTenant]);

  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      const eventTenant = String(detail?.tenant_id || '');
      const currentTenant = String(user?.tenant_id || activeTenant || '');
      if (!eventTenant || !currentTenant || eventTenant === currentTenant) {
        if (settingsUpdateTimerRef.current) window.clearTimeout(settingsUpdateTimerRef.current);
        settingsUpdateTimerRef.current = window.setTimeout(() => {
          setSettingsVersion((prev) => prev + 1);
        }, 180);
      }
    };
    window.addEventListener('settings-updated', onSettingsUpdated as EventListener);
    return () => {
      if (settingsUpdateTimerRef.current) window.clearTimeout(settingsUpdateTimerRef.current);
      window.removeEventListener('settings-updated', onSettingsUpdated as EventListener);
    };
  }, [user?.tenant_id, activeTenant]);

  useEffect(() => {
    if (!isPerfDebugEnabled()) return;
    const onPerf = (event: Event) => {
      const detail = (event as CustomEvent<PerfEvent>).detail;
      if (!detail) return;
      setPerfEvents((prev) => [detail, ...prev].slice(0, 8));
    };
    window.addEventListener('app-perf', onPerf as EventListener);
    return () => {
      window.removeEventListener('app-perf', onPerf as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (hostMode === 'landing') {
      document.title = 'iRonWaves POS';
      return;
    }
    const companyName = String(profile?.company_name || '').trim();
    document.title = companyName
      ? `${companyName}${/ironwaves/i.test(companyName) ? '' : ' by IronWaves'}`
      : 'iRonWaves POS';
  }, [hostMode, profile?.company_name]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!visibleModules.find((m) => m.key === currentModule)) {
      setCurrentModule(visibleModules[0]?.key || 'pos');
    }
  }, [sessionRole, currentModule, visibleModuleKeys]);

  useEffect(() => {
    setMountedModules((prev) => (prev.includes(resolvedModule) ? prev : [...prev, resolvedModule]));
  }, [resolvedModule]);

  useEffect(() => {
    setMountedModules(['pos']);
  }, [moduleTenantKey]);

  useEffect(() => {
    if (safeLang !== lang) {
      setLang(safeLang);
    }
  }, [lang, safeLang, setLang]);

  useEffect(() => {
    if (!demoGuideEnabled) {
      setDemoGuideBubble(null);
    }
  }, [demoGuideEnabled]);

  useEffect(() => {
    if (!demoGuideEnabled) return;
    const moduleKey = resolvedModule;
    if (!moduleKey) return;
    if (demoGuideShownModulesRef.current.has(moduleKey)) return;
    demoGuideShownModulesRef.current.add(moduleKey);
    const message = DEMO_MODULE_GUIDE_AZ[moduleKey];
    if (message) {
      notify('info', message);
    }
  }, [demoGuideEnabled, resolvedModule, notify]);

  useEffect(() => {
    if (!demoGuideEnabled || typeof window === 'undefined' || typeof document === 'undefined') return;
    let rafId: number | null = null;
    let lastText = '';
    const updateFromEvent = (event: MouseEvent) => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
      const target = event.target as HTMLElement | null;
        const interactive = target?.closest?.('[data-guide], [title], button, [role="button"], a, input, textarea, select') as HTMLElement | null;
        const text = summarizeElementGuideAz(interactive);
      if (!text) {
          lastText = '';
        setDemoGuideBubble(null);
        return;
      }
        const shouldKeepLast = lastText === text;
        lastText = text;
      const width = 310;
      const height = 94;
      const x = Math.min(window.innerWidth - width - 12, event.clientX + 12);
      const y = Math.min(window.innerHeight - height - 12, event.clientY + 12);
      setDemoGuideBubble({
          text: shouldKeepLast ? lastText : text,
        x: Math.max(12, x),
        y: Math.max(12, y),
      });
      });
    };
    const clear = () => setDemoGuideBubble(null);
    document.addEventListener('mousemove', updateFromEvent, { passive: true });
    document.addEventListener('mouseleave', clear);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      document.removeEventListener('mousemove', updateFromEvent as EventListener);
      document.removeEventListener('mouseleave', clear as EventListener);
    };
  }, [demoGuideEnabled]);

  const runSoftRefresh = async (source: 'manual' | 'auto' = 'manual') => {
    if (softRefreshInFlightRef.current) return;
    softRefreshInFlightRef.current = true;
    if (source === 'manual') setManualRefreshing(true);
    const tenantForRefresh = String(user?.tenant_id || activeTenant || '').trim();

    try {
      // Best effort only: refresh action must not kick user out.
      if (isBackendEnabled() && user?.username) {
        try {
          await authApi.refresh_token(undefined, tenantForRefresh || activeTenant);
        } catch {
          // ignore on purpose; we still refresh local state/views
        }
      }

      if (tenantForRefresh) {
        await Promise.all([
          get_business_profile_live(tenantForRefresh).catch(() => null),
          get_settings_live(tenantForRefresh).catch(() => null),
        ]);
      }

      setBusinessProfileVersion((prev) => prev + 1);
      setSettingsVersion((prev) => prev + 1);
      const detail = { tenant_id: tenantForRefresh };
      window.dispatchEvent(new CustomEvent('business-profile-updated', { detail }));
      window.dispatchEvent(new CustomEvent('settings-updated', { detail }));
      window.dispatchEvent(new CustomEvent('catalog-updated', { detail: { ...detail, scope: 'menu' } }));

      if (source === 'manual') {
        notify('success', tx(safeLang, 'Məlumatlar yeniləndi', 'Данные обновлены', 'Data refreshed'));
      }
    } catch (error: any) {
      if (source === 'manual') {
        notify('error', String(error?.message || tx(safeLang, 'Yeniləmə alınmadı', 'Обновление не удалось', 'Refresh failed')));
      }
    } finally {
      if (source === 'manual') setManualRefreshing(false);
      softRefreshInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!hasValidUser) return;
    let timerId: number | null = null;
    const scheduleNext = () => {
      timerId = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') {
          const activeEl = document.activeElement as HTMLElement | null;
          const tag = String(activeEl?.tagName || '').toLowerCase();
          const typing = Boolean(activeEl?.isContentEditable) || tag === 'input' || tag === 'textarea' || tag === 'select';
          if (!typing) {
            await runSoftRefresh('auto');
          }
        }
        scheduleNext();
      }, 60000);
    };

    const onVisible = () => {
      if (!document.hidden) {
        void runSoftRefresh('auto');
      }
    };

    scheduleNext();
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timerId) window.clearTimeout(timerId);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasValidUser, user?.tenant_id, activeTenant]);

  const enterFullscreen = async () => {
    try {
      if (typeof document === 'undefined') return;
      const root = document.documentElement;
      if (!document.fullscreenElement) {
        await root.requestFullscreen();
      }
    } catch {
      notify('error', tx(safeLang, 'Tam ekran açıla bilmədi', 'Не удалось открыть полный экран', 'Failed to enter fullscreen'));
    }
  };

  const exitFullscreen = async () => {
    try {
      if (typeof document === 'undefined') return;
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      notify('error', tx(safeLang, 'Tam ekrandan çıxmaq alınmadı', 'Не удалось выйти из полного экрана', 'Failed to exit fullscreen'));
    }
  };

  if (!hasHydrated) {
    return (
      <div className="metal-app flex min-h-screen items-center justify-center text-slate-300">
        <div className="metal-panel rounded-xl px-6 py-4 text-sm">Sistem yüklənir...</div>
      </div>
    );
  }

  if (publicPathname === '/menu' || publicPathname === '/menu/') {
    return <Suspense fallback={lazyModuleFallback}><PublicMenu /></Suspense>;
  }

  if (publicPathname === '/landing' || publicPathname === '/landing/') {
    return <Suspense fallback={lazyModuleFallback}><LandingPage /></Suspense>;
  }

  if (publicPathname === '/feedback' || publicPathname === '/feedback/') {
    const resolvedFeedbackTenant =
      String(feedbackParams.tenantId || '').trim() ||
      String(mappedTenantFromHost || '').trim() ||
      String(activeTenant || '').trim();
    return (
      <Suspense fallback={lazyModuleFallback}>
        <FeedbackPortal
          tenantId={resolvedFeedbackTenant}
          saleId={feedbackParams.saleId}
          receiptId={feedbackParams.receiptId}
          receiptToken={feedbackParams.receiptToken}
          source="receipt"
        />
      </Suspense>
    );
  }

  // Public receipt route should not redirect to login even if token is missing/invalid.
  // Keep this check after explicit public path handlers (e.g. /feedback),
  // because feedback links also carry r/t query params.
  if (publicReceiptParams.receiptId) {
    return <Suspense fallback={lazyModuleFallback}><PublicReceipt receiptId={publicReceiptParams.receiptId} token={publicReceiptParams.token} /></Suspense>;
  }

  if (customerAppParams.join || (customerAppParams.cardId && customerAppParams.token)) {
    return <Suspense fallback={lazyModuleFallback}><CustomerApp cardId={customerAppParams.cardId} token={customerAppParams.token} joinMode={customerAppParams.join} /></Suspense>;
  }

  if (hostMode === 'landing') {
    return <Suspense fallback={lazyModuleFallback}><LandingPage /></Suspense>;
  }

  if (!hasValidUser) {
    return <PinLogin />;
  }

  if (sessionChecking || shouldHoldForTenantResolution) {
    return (
      <div className="metal-app flex min-h-screen items-center justify-center text-slate-300">
        <div className="metal-panel rounded-xl px-6 py-4 text-sm">{tx(safeLang, 'Tenant yoxlanır...', 'Проверка тенанта...', 'Checking tenant...')}</div>
      </div>
    );
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
              'Bu ünvanda aktiv restoran workspace tapılmadı. Əgər bu subdomain sizə məxsusdursa, tenant qurulmasının və ya domen yönləndirilməsinin yoxlanması üçün bizimlə əlaqə saxlayın.',
              'По этому адресу не найден активный ресторанный workspace. Если этот субдомен принадлежит вам, свяжитесь с нами для проверки tenant-а или маршрута домена.',
              'No active restaurant workspace was found for this address. If this subdomain belongs to you, contact us so we can verify tenant provisioning or domain routing.',
            )}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button onClick={() => void runSoftRefresh('manual')} disabled={manualRefreshing} className="neon-btn px-4 py-3 disabled:opacity-60">
              {manualRefreshing ? tx(safeLang, 'Yenilənir...', 'Обновляется...', 'Refreshing...') : tx(safeLang, 'Yenilə', 'Обновить', 'Refresh')}
            </button>
            <a
              href="mailto:abbas@laptopmarket.az"
              className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 font-semibold text-cyan-50"
            >
              {tx(safeLang, 'E-poçt: abbas@laptopmarket.az', 'E-mail: abbas@laptopmarket.az', 'Email: abbas@laptopmarket.az')}
            </a>
            <a
              href="tel:+994552999282"
              className="glossy-gold rounded-xl px-5 py-3 font-bold text-slate-900"
            >
              {tx(safeLang, 'Əlaqə: +99455 299-92-82', 'Контакт: +99455 299-92-82', 'Contact: +99455 299-92-82')}
            </a>
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
      {readyPopup && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-lg rounded-2xl p-5">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">{tx(safeLang, 'Hazır sifariş', 'Готовый заказ', 'Ready order')}</div>
            <h3 className="mt-2 text-2xl font-bold text-slate-100">{readyPopup.title}</h3>
            <p className="mt-2 text-sm text-slate-300">{readyPopup.message}</p>
            {Array.isArray(readyPopup.meta?.ready_items) && readyPopup.meta.ready_items.length > 0 ? (
              <div className="mt-4 rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-4">
                <div className="mb-2 text-sm font-semibold text-emerald-100">{tx(safeLang, 'Hazır olanlar', 'Готовые позиции', 'Ready items')}</div>
                <div className="space-y-2">
                  {readyPopup.meta.ready_items.map((item: string, idx: number) => (
                    <div key={`${item}_${idx}`} className="rounded-lg bg-black/15 px-3 py-2 text-sm text-emerald-50">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-5 flex justify-end">
              <button
                className="glossy-gold rounded-xl px-5 py-2 font-semibold"
                onClick={async () => {
                  try {
                    await mark_staff_notification_read_live(readyPopup.id);
                  } catch {
                    // ignore read failures for UI continuity
                  }
                  setReadyPopup(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className="flex-1 flex flex-col relative overflow-hidden"
        style={{ paddingBottom: keyboardInset > 0 ? `${keyboardInset}px` : undefined }}
      >
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
                <p className="font-semibold leading-tight">{profile?.company_name || 'iRonWaves POS'}</p>
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
                    onMouseEnter={(e) => handleDemoGuideHover('Tenant seçimi ilə demo mühitini dəyişə bilərsiniz.', e)}
                    onMouseMove={(e) => handleDemoGuideHover('Tenant seçimi ilə demo mühitini dəyişə bilərsiniz.', e)}
                    onMouseLeave={() => setDemoGuideBubble(null)}
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
              }`}
                onMouseEnter={(e) => handleDemoGuideHover(describeActionAz(isOnline ? 'online' : 'offline'), e)}
                onMouseMove={(e) => handleDemoGuideHover(describeActionAz(isOnline ? 'online' : 'offline'), e)}
                onMouseLeave={() => setDemoGuideBubble(null)}
              >
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
                onClick={() => void runSoftRefresh('manual')}
                disabled={manualRefreshing}
                className="neon-btn px-3 py-2 disabled:opacity-60"
                title={manualRefreshing ? tx(safeLang, 'Yenilənir...', 'Обновляется...', 'Refreshing...') : 'Yenilə'}
                onMouseEnter={(e) => handleDemoGuideHover(describeActionAz('yenilə'), e)}
                onMouseMove={(e) => handleDemoGuideHover(describeActionAz('yenilə'), e)}
                onMouseLeave={() => setDemoGuideBubble(null)}
              >
                <RotateCcw size={16} />
                <span className="hidden sm:inline">
                  {manualRefreshing ? tx(safeLang, 'Yenilənir...', 'Обновляется...', 'Refreshing...') : t.refresh}
                </span>
              </button>
              <button
                onClick={() => setLang(safeLang === 'az' ? 'ru' : safeLang === 'ru' ? 'en' : 'az')}
                className="neon-btn px-3 py-2"
                onMouseEnter={(e) => handleDemoGuideHover(describeActionAz('az/ru/en'), e)}
                onMouseMove={(e) => handleDemoGuideHover(describeActionAz('az/ru/en'), e)}
                onMouseLeave={() => setDemoGuideBubble(null)}
              >
                <Languages size={16} />
                <span>{safeLang.toUpperCase()}</span>
              </button>
              {!isFullscreen ? (
                <button
                  onClick={() => void enterFullscreen()}
                  className="neon-btn px-3 py-2"
                  title={tx(safeLang, 'Tam ekran', 'Полный экран', 'Fullscreen')}
                  onMouseEnter={(e) => handleDemoGuideHover(describeActionAz('tam ekran'), e)}
                  onMouseMove={(e) => handleDemoGuideHover(describeActionAz('tam ekran'), e)}
                  onMouseLeave={() => setDemoGuideBubble(null)}
                >
                  <Maximize2 size={16} />
                  <span className="hidden sm:inline">{tx(safeLang, 'Tam ekran', 'Полный экран', 'Fullscreen')}</span>
                </button>
              ) : (
                <button
                  onClick={() => void exitFullscreen()}
                  className="neon-btn-active px-3 py-2"
                  title={tx(safeLang, 'Tam ekrandan çıx', 'Выйти из полного экрана', 'Exit fullscreen')}
                  onMouseEnter={(e) => handleDemoGuideHover(describeActionAz('tam ekran'), e)}
                  onMouseMove={(e) => handleDemoGuideHover(describeActionAz('tam ekran'), e)}
                  onMouseLeave={() => setDemoGuideBubble(null)}
                >
                  <Minimize2 size={16} />
                  <span className="hidden sm:inline">{tx(safeLang, 'Tam ekrandan çıx', 'Выйти из полного экрана', 'Exit fullscreen')}</span>
                </button>
              )}
              <button
                onClick={() => setHelpOpen(true)}
                className="neon-btn px-3 py-2"
                title={tx(safeLang, 'Kömək', 'Помощь', 'Help')}
                onMouseEnter={(e) => handleDemoGuideHover(tx(safeLang, 'User manual və AI kömək paneli', 'Панель помощи по manual и AI', 'User manual + AI help panel'), e)}
                onMouseMove={(e) => handleDemoGuideHover(tx(safeLang, 'User manual və AI kömək paneli', 'Панель помощи по manual и AI', 'User manual + AI help panel'), e)}
                onMouseLeave={() => setDemoGuideBubble(null)}
              >
                <MessageCircleQuestion size={16} />
                <span>{tx(safeLang, 'Help', 'Помощь', 'Help')}</span>
              </button>
              <button
                onClick={logout}
                className="neon-btn-active px-3 py-2"
                onMouseEnter={(e) => handleDemoGuideHover(describeActionAz('çıxış'), e)}
                onMouseMove={(e) => handleDemoGuideHover(describeActionAz('çıxış'), e)}
                onMouseLeave={() => setDemoGuideBubble(null)}
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
                  title={item.label}
                  data-guide={DEMO_MODULE_GUIDE_AZ[item.key]}
                  onMouseEnter={(e) => handleDemoGuideHover(DEMO_MODULE_GUIDE_AZ[item.key], e)}
                  onMouseMove={(e) => handleDemoGuideHover(DEMO_MODULE_GUIDE_AZ[item.key], e)}
                  onMouseLeave={() => setDemoGuideBubble(null)}
                >
                  <span>{item.label}</span>
                </button>
              ))}
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <AppErrorBoundary>
            <Suspense fallback={lazyModuleFallback}>
              {mountedModules.includes('pos') && (
                <div className={`${resolvedModule === 'pos' ? 'flex h-full min-h-0 flex-col' : 'hidden'}`}>
                  <POS key={`pos:${moduleTenantKey}`} isActive={resolvedModule === 'pos'} />
                </div>
              )}
              {mountedModules.includes('kds') && (
                <div className={`${resolvedModule === 'kds' ? 'flex h-full min-h-0 flex-col' : 'hidden'}`}>
                  <KDS key={`kds:${moduleTenantKey}`} isActive={resolvedModule === 'kds'} />
                </div>
              )}
              {mountedModules.includes('tables') && (
                <div className={`${resolvedModule === 'tables' ? 'flex h-full min-h-0 flex-col' : 'hidden'}`}>
                  <TablesPage key={`tables:${moduleTenantKey}`} isActive={resolvedModule === 'tables'} />
                </div>
              )}
              {mountedModules.some((moduleKey) => !['pos', 'kds', 'tables'].includes(moduleKey)) && (
                <div className={`${!['pos', 'kds', 'tables'].includes(resolvedModule) ? 'flex h-full min-h-0 flex-col' : 'hidden'}`}>
                  <AdminPanel
                    key={`admin:${moduleTenantKey}`}
                    externalTab={resolvedModule as AdminView}
                    onTabChange={(tab) => setCurrentModule(tab as ModuleKey)}
                    isActive={!['pos', 'kds', 'tables'].includes(resolvedModule)}
                  />
                </div>
              )}
            </Suspense>
          </AppErrorBoundary>
        </div>

        <div className="shrink-0 border-t border-slate-700/40 bg-[#0e141d]/95 px-2 py-2 md:hidden">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {visibleModules.map((item) => (
              <button
                key={`mobile_${item.key}`}
                onClick={() => setCurrentModule(item.key)}
                className={`${resolvedModule === item.key ? 'neon-chip neon-chip-active' : 'neon-chip'} whitespace-nowrap`}
                title={item.label}
                data-guide={DEMO_MODULE_GUIDE_AZ[item.key]}
                onMouseEnter={(e) => handleDemoGuideHover(DEMO_MODULE_GUIDE_AZ[item.key], e)}
                onMouseMove={(e) => handleDemoGuideHover(DEMO_MODULE_GUIDE_AZ[item.key], e)}
                onMouseLeave={() => setDemoGuideBubble(null)}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hidden md:block shrink-0 border-t border-slate-700/40 px-4 py-2 text-center text-xs text-slate-400">
          iRonWaves POS
        </div>
      </div>
      {demoGuideEnabled && demoGuideBubble && (
        <div
          className="pointer-events-none fixed z-[88] w-[310px] rounded-2xl border border-cyan-300/35 bg-slate-950/92 p-3 shadow-[0_14px_42px_rgba(0,0,0,0.45)] backdrop-blur"
          style={{ left: demoGuideBubble.x, top: demoGuideBubble.y }}
        >
          <div className="text-[11px] uppercase tracking-[0.14em] text-cyan-200">Demo Bələdçisi</div>
          <div className="mt-1 text-xs text-slate-100">{demoGuideBubble.text}</div>
        </div>
      )}
      {isPerfDebugEnabled() && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[120] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-cyan-400/25 bg-slate-950/88 p-3 text-xs text-slate-100 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-bold text-cyan-200">Perf Debug</div>
            <div className="text-[10px] text-slate-400">?perf=1</div>
          </div>
          <div className="space-y-2">
            {perfEvents.length === 0 ? (
              <div className="text-slate-400">No request timings yet.</div>
            ) : perfEvents.map((row, idx) => (
              <div key={`${row.at}_${idx}`} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="truncate font-medium text-slate-200">{row.label}</div>
                  <div className={`${row.duration_ms > 1200 ? 'text-rose-300' : row.duration_ms > 500 ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {row.duration_ms} ms
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-slate-400">
                  <span>{row.status ? `HTTP ${row.status}` : row.ok ? 'OK' : 'ERR'}</span>
                  <span>{new Date(row.at).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <HelpAssistant
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        lang={safeLang}
        currentModule={resolvedModule}
      />
      <VirtualKeyboard lang={safeLang} enabled={virtualKeyboardEnabled} />
    </div>
  );
}
