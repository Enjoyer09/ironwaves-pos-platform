import React from 'react';
import { backup_database_live, get_restore_preview, get_restore_status_live, restore_database, restore_database_live, type RestoreLiveStatus, type RestoreReport } from '../../api/database';
import {
  get_settings_live,
  get_backup_settings_live,
  update_backup_settings_live,
  test_backup_webhook_live,
  get_central_backup_tenants_live,
  update_central_backup_tenants_live,
  get_central_backup_logs_live,
} from '../../api/settings';
import { useAppStore } from '../../store';
import { Database, Download, Upload } from 'lucide-react';
import { tx } from '../../i18n';
import { useState } from 'react';
import { clearDBCache, getDB } from '../../lib/db_sim';
import { verifyLocalCredential } from '../../lib/local_auth';
import { apiRequest, getApiBaseUrl, isForceLocalMode, setForceLocalMode } from '../../api/client';
import { removeScopedStorage } from '../../lib/storage_keys';

export default function DatabasePanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [restoreTables, setRestoreTables] = useState<string[]>([]);
  const [showModuleSelection, setShowModuleSelection] = useState(false);
  const [restoreWarnings, setRestoreWarnings] = useState<string[]>([]);
  const [restoreRowCounts, setRestoreRowCounts] = useState<Record<string, number>>({});
  const [lastRestoreReport, setLastRestoreReport] = useState<RestoreReport | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');
  const [liveRestoreStatus, setLiveRestoreStatus] = useState<RestoreLiveStatus | null>(null);
  const [forceLocalMode, setForceLocalModeState] = useState(() => isForceLocalMode());

  const [isSuperTenant, setIsSuperTenant] = useState(false);
  const [backupSettings, setBackupSettings] = useState({
    backup_enabled: false,
    backup_webhook_url: '',
    backup_webhook_secret: '',
    backup_hour: 3,
    backup_target: 'webhook' as 'webhook' | 'disk' | 'both',
    backup_local_path: '',
    last_backup_status: null as string | null,
    last_backup_at: null as string | null,
  });
  const [centralBackupTenants, setCentralBackupTenants] = useState<Array<{ id: string; name: string; slug: string; domain: string; central_backup_enabled: boolean }>>([]);
  const [centralBackupLogs, setCentralBackupLogs] = useState<Array<{ id: string; tenant_id: string; tenant_slug: string; status: string; detail: string; backup_size_bytes: number; created_at: string }>>([]);
  const [testingWebhook, setTestingWebhook] = useState(false);

  const TABLE_OPTIONS = [
    'users','menu_items','sales','finance','tables','kitchen_orders','z_reports','inventory','ingredients','customers','recipes','customer_coupons','admin_notes','happy_hours','refunds','settings','notifications','business_profile','logs'
  ];
  const DEFAULT_RESTORE_EXCLUDED_TABLES = new Set(['users']);

  const clearLocalRestoreState = (options?: { clearSession?: boolean }) => {
    const exactKeys = new Set([
      'ironwaves_force_local_mode',
      'ironwaves_backend_suspended_until',
      ...TABLE_OPTIONS,
      'menu',
      'system_logs',
      'tenant_customers',
      'business_profile',
    ]);
    const preservedBaseKeys = [
      'active_tenant_id',
      'tenant_domains',
      'emalatkhana-pos-session',
      'trusted_admin_contexts',
      'trusted_admin_2fa_token',
    ];
    const tenantScopedCacheKeys = new Set([
      `${tenant_id}_customers`,
      `${tenant_id}_sales`,
      `${tenant_id}_refunds`,
      `${tenant_id}_finance`,
      `${tenant_id}_loyalty_ledger`,
      `${tenant_id}_logs`,
      `${tenant_id}_ui_errors`,
      `${tenant_id}_admin_notes`,
      `${tenant_id}_customer_coupons`,
    ]);

    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      const isPreserved = preservedBaseKeys.some((baseKey) => key === baseKey || key.startsWith(`${baseKey}__`));
      if (isPreserved) continue;
      if (
        exactKeys.has(key) ||
        key.startsWith('db_') ||
        tenantScopedCacheKeys.has(key)
      ) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
    if (options?.clearSession) {
      removeScopedStorage('emalatkhana-pos-session');
    }
    clearDBCache();
    setForceLocalMode(false);
    setForceLocalModeState(false);
    return keysToRemove.length;
  };

  const yieldToUi = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  const getErrorMessage = (error: unknown, fallbackAz: string, fallbackRu: string) => {
    const message = error instanceof Error ? error.message : '';
    if (!message) return tx(lang, fallbackAz, fallbackRu);
    return tx(lang, `${fallbackAz}: ${message}`, `${fallbackRu}: ${message}`);
  };

  const normalizeRestoreSelection = (selected: string[], available: string[]) => {
    const availableSet = new Set(available);
    const canonicalTable = (table: string) => ({
      menu: 'menu_items',
      ingredients: 'inventory',
      recipe: 'recipes',
      system_logs: 'logs',
      expenses: 'finance',
    } as Record<string, string>)[table] || table;
    const selectedAvailable = Array.from(
      new Set(selected.map(canonicalTable).filter((table) => availableSet.has(table))),
    );
    const selectedSet = new Set(selectedAvailable);
    return selectedAvailable.filter((table) => {
      // Bu cütlər eyni backend modelinə yazılır. İkisini də göndərmək
      // eyni datanı iki dəfə silib-yazır və restore-u ləngidir.
      if (table === 'ingredients' && selectedSet.has('inventory')) return false;
      if (table === 'menu' && selectedSet.has('menu_items')) return false;
      if (table === 'system_logs' && selectedSet.has('logs')) return false;
      return true;
    });
  };

  const handleBackup = async () => {
    const data = await backup_database_live(tenant_id);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ironwaves_pos_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runRestore = async (file: File, selected: string[]) => {
    setIsRestoring(true);
    setBusyMessage(tx(lang, 'Backup bərpa olunur. Səhifəni bağlamayın...', 'Backup восстанавливается. Не закрывайте страницу...'));
    try {
      await yieldToUi();
      const content = await file.text();
      const preview = get_restore_preview(tenant_id, content);
      const selectedExisting = normalizeRestoreSelection(selected, preview.available_tables);
      if (selectedExisting.length === 0) {
        throw new Error(tx(lang, 'Bərpa üçün uyğun bölmə tapılmadı', 'Не найден подходящий раздел для восстановления'));
      }

      setBusyMessage(tx(
        lang,
        `Backendə göndərilir: ${selectedExisting.length} bölmə bir əməliyyat kimi bərpa olunur...`,
        `Отправляется на backend: ${selectedExisting.length} разделов восстанавливаются одной операцией...`,
      ));
      await yieldToUi();
      const mergedReport = await restore_database_live(tenant_id, content, selectedExisting);
      setLastRestoreReport(mergedReport);
      const verificationFailures = Object.entries(mergedReport.verification || {})
        .filter(([, result]) => result?.ok === false);
      if (!mergedReport.success || verificationFailures.length > 0) {
        const failedTables = verificationFailures.map(([table]) => table).join(', ');
        throw new Error(
          failedTables
            ? tx(lang, `Backend bərpa yoxlaması uğursuz oldu: ${failedTables}`, `Проверка восстановления на backend не прошла: ${failedTables}`)
            : tx(lang, 'Backend bərpanı təsdiqləmədi', 'Backend не подтвердил восстановление'),
        );
      }

      const restoredUsers = selectedExisting.includes('users') || mergedReport.restored_tables.includes('users');
      const usingBackendRestore = Boolean(getApiBaseUrl()) && !isForceLocalMode();
      if (usingBackendRestore) {
        // Backend restore-dan sonra böyük JSON-u yenidən localStorage-ə yazmırıq.
        // Səhifə reload olanda məlumatlar birbaşa backend/NeonDB-dən gələcək.
        clearLocalRestoreState({ clearSession: restoredUsers });
      } else {
        restore_database(tenant_id, content, selectedExisting);
      }
      notify(
        'success',
        tx(
          lang,
          `Baza bərpa edildi. ${mergedReport.restored_rows} sətir yükləndi, ${mergedReport.rejected_rows} sətir rədd edildi.${restoredUsers ? ' İstifadəçilər də bərpa olunduğu üçün təkrar giriş tələb olunacaq.' : ''}`,
          `База восстановлена. Загружено строк: ${mergedReport.restored_rows}, отклонено: ${mergedReport.rejected_rows}.${restoredUsers ? ' Так как пользователи восстановлены, потребуется повторный вход.' : ''}`,
        ),
      );
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      notify('error', getErrorMessage(error, 'Restore uğursuz oldu', 'Восстановление не удалось'));
    } finally {
      setIsRestoring(false);
      setBusyMessage('');
      setLiveRestoreStatus(null);
    }
  };

  React.useEffect(() => {
    if (!isRestoring || !getApiBaseUrl()) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const status = await get_restore_status_live(tenant_id);
        if (cancelled) return;
        setLiveRestoreStatus(status);
        if (status?.message) {
          const processed = Number(status.processed_tables || 0);
          const total = Number(status.total_tables || 0);
          const suffix = total > 0 ? ` (${processed}/${total})` : '';
          setBusyMessage(`${status.message}${suffix}`);
        }
      } catch {
        if (!cancelled) {
          setLiveRestoreStatus((prev) => prev || { active: true, message: tx(lang, 'Status yenilənmədi', 'Статус не обновился') });
        }
      }
    };
    void pull();
    const timer = window.setInterval(() => {
      void pull();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isRestoring, tenant_id, lang]);

  const loadBackupSettings = async () => {
    try {
      const settingsRes = await get_settings_live();
      const isSuper = Boolean(settingsRes?.is_super_tenant);
      setIsSuperTenant(isSuper);

      if (isSuper) {
        const res = await get_backup_settings_live();
        if (res) {
          setBackupSettings({
            backup_enabled: Boolean(res.backup_enabled),
            backup_webhook_url: String(res.backup_webhook_url || ''),
            backup_webhook_secret: String(res.backup_webhook_secret || ''),
            backup_hour: Number(res.backup_hour ?? 3),
            backup_target: (res.backup_target || 'webhook') as 'webhook' | 'disk' | 'both',
            backup_local_path: String(res.backup_local_path || ''),
            last_backup_status: res.last_backup_status || null,
            last_backup_at: res.last_backup_at || null,
          });
        }
        const tenants = await get_central_backup_tenants_live();
        setCentralBackupTenants(tenants);
        const logs = await get_central_backup_logs_live();
        setCentralBackupLogs(logs);
      }
    } catch (error) {
      console.error('Failed to load backup settings', error);
    }
  };

  const saveBackupSettings = async () => {
    try {
      await update_backup_settings_live({
        backup_enabled: backupSettings.backup_enabled,
        backup_webhook_url: backupSettings.backup_webhook_url,
        backup_webhook_secret: backupSettings.backup_webhook_secret,
        backup_hour: Number(backupSettings.backup_hour),
        backup_target: backupSettings.backup_target,
        backup_local_path: backupSettings.backup_local_path,
      });
      if (isSuperTenant) {
        const enabledTenantIds = centralBackupTenants
          .filter((t) => t.central_backup_enabled)
          .map((t) => t.id);
        await update_central_backup_tenants_live(enabledTenantIds);
      }
      notify('success', tx(lang, 'Backup ayarları yadda saxlanıldı', 'Настройки бэкапа сохранены', 'Backup settings saved'));
      void loadBackupSettings();
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Backup ayarları saxlanmadı', 'Настройки бэкапа не сохранены', 'Backup settings were not saved'));
    }
  };

  const handleTenantCheckboxChange = (tenantId: string, checked: boolean) => {
    setCentralBackupTenants((prev) =>
      prev.map((t) => (t.id === tenantId ? { ...t, central_backup_enabled: checked } : t))
    );
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleTestWebhook = async () => {
    setTestingWebhook(true);
    try {
      const res = await test_backup_webhook_live();
      if (res && res.ok) {
        notify('success', tx(lang, 'Test webhook uğurla göndərildi', 'Тестовый вебхук успешно отправлен', 'Test webhook sent successfully'));
      } else {
        notify('error', res?.message || tx(lang, 'Webhook göndərilməsi alınmadı', 'Не удалось отправить вебхук', 'Failed to send webhook'));
      }
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Webhook test xətası', 'Ошибка теста вебхука', 'Webhook test error'));
    } finally {
      setTestingWebhook(false);
    }
  };

  React.useEffect(() => {
    void loadBackupSettings();
  }, [tenant_id]);

  const downloadRejectedCsv = () => {
    if (!lastRestoreReport?.rejected_samples?.length) {
      notify('error', tx(lang, 'Rədd edilən sətir yoxdur', 'Отклоненных строк нет'));
      return;
    }
    const header = ['table', 'row_index', 'reason', 'row'];
    const rows = lastRestoreReport.rejected_samples.map((r) => [
      `"${String(r.table).replace(/"/g, '""')}"`,
      String((r as any).row_index ?? ''),
      `"${String(r.reason).replace(/"/g, '""')}"`,
      `"${JSON.stringify(r.row).replace(/"/g, '""')}"`,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `restore_rejected_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void (async () => {
      setIsPreviewing(true);
      setBusyMessage(tx(lang, 'Backup yoxlanılır...', 'Backup проверяется...'));
      try {
        await yieldToUi();
        const content = await file.text();
        try {
          const preview = get_restore_preview(tenant_id, content);
          const found = TABLE_OPTIONS.filter((k) => preview.available_tables.includes(k));
          const safeDefaultSelection = found.filter((k) => !DEFAULT_RESTORE_EXCLUDED_TABLES.has(k));
          setRestoreTables(safeDefaultSelection.length ? safeDefaultSelection : found);
          setRestoreWarnings([
            ...(preview.warnings || []),
            ...(found.includes('users')
              ? [tx(
                lang,
                'Təhlükəsizlik üçün users bölməsi default seçilmədi. Users seçilsə, admin şifrələri backup-dakı vəziyyətə qayıda bilər və təkrar login tələb olunacaq.',
                'Для безопасности users не выбран по умолчанию. Если выбрать users, пароли админов вернутся к состоянию backup и потребуется повторный вход.',
              )]
              : []),
          ]);
          setRestoreRowCounts(preview.row_counts || {});
        } catch {
          setRestoreTables(TABLE_OPTIONS.filter((k) => !DEFAULT_RESTORE_EXCLUDED_TABLES.has(k)));
          setRestoreWarnings([tx(lang, 'JSON parse alınmadı, default cədvəl siyahısı göstərildi.', 'Не удалось разобрать JSON, показан список по умолчанию.')]);
          setRestoreRowCounts({});
        }
        setPendingFile(file);
        setShowModuleSelection(true);
      } finally {
        setIsPreviewing(false);
        setBusyMessage('');
      }
    })();
  };

  const verifyAdminPassword = async () => {
    const normalized = String(adminPassword || '').trim();
    if (!normalized) return false;

    if (getApiBaseUrl()) {
      try {
        const result = await apiRequest<{ success: boolean }>('/api/v1/ops/database/verify-admin-password', {
          method: 'POST',
          tenantId: tenant_id,
          timeoutMs: 30000,
          suspendOnNetworkError: false,
          body: { password: normalized },
        });
        if (result?.success) return true;
        return false;
      } catch (error) {
        throw new Error(getErrorMessage(error, 'Admin şifrəsi backenddə yoxlanmadı', 'Пароль администратора не проверен на backend'));
      }
    }

    const users = getDB<any>('users');
    const tenantAdmins = users.filter(
      (u) =>
        String(u.tenant_id || tenant_id) === String(tenant_id) &&
        Boolean(u.is_active ?? true) &&
        ['admin', 'super_admin'].includes(String(u.role || '').toLowerCase()),
    );

    const currentAdminFirst = tenantAdmins.sort((a, b) => {
      const aCurrent = String(a.username || '').toLowerCase() === String(user?.username || '').toLowerCase() ? 1 : 0;
      const bCurrent = String(b.username || '').toLowerCase() === String(user?.username || '').toLowerCase() ? 1 : 0;
      return bCurrent - aCurrent;
    });

    for (const candidate of currentAdminFirst) {
      const isMatch = await verifyLocalCredential(normalized, candidate.password_hash || candidate.password);
      if (isMatch) return true;
    }
    return false;
  };

  const confirmRestoreWithPassword = async () => {
    try {
      if (!(await verifyAdminPassword())) {
        notify('error', tx(lang, 'Şifrə yanlışdır', 'Неверный пароль'));
        return;
      }
      if (pendingFile) void runRestore(pendingFile, restoreTables);
      setPendingFile(null);
      setShowModuleSelection(false);
      setShowPasswordPrompt(false);
      setAdminPassword('');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : tx(lang, 'Admin şifrəsi yoxlanmadı', 'Пароль администратора не проверен'));
    }
  };

  return (
    <div className="space-y-6 text-slate-100">
      {pendingFile && showModuleSelection && !showPasswordPrompt && (
        <div className="metal-panel p-4">
          <div className="mb-2 text-sm text-slate-300">
            {tx(lang, 'Hansı bölmələr bərpa olunsun?', 'Какие разделы восстановить?')}
          </div>
          <div className="mb-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3 text-xs text-cyan-100">
            {tx(
              lang,
              `Bərpa hədəfi: ${tenant_id}. Backend bu tenant ilə sessiya tokenini uyğunlaşdıracaq; uyğun deyilsə əməliyyat dayandırılacaq.`,
              `Цель восстановления: ${tenant_id}. Backend сверит этот тенант с токеном сессии; при несовпадении операция будет остановлена.`,
            )}
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <button className="neon-btn rounded-lg px-3 py-1.5 text-xs" onClick={() => setRestoreTables(TABLE_OPTIONS)}>
              {tx(lang, 'Hamısını seç', 'Выбрать все')}
            </button>
            <button className="neon-btn rounded-lg px-3 py-1.5 text-xs" onClick={() => setRestoreTables([])}>
              {tx(lang, 'Seçimi təmizlə', 'Снять выбор')}
            </button>
          </div>
          {restoreWarnings.length > 0 && (
            <div className="mb-3 rounded-lg border border-yellow-300/40 bg-yellow-900/20 p-3 text-xs text-yellow-100">
              {restoreWarnings.map((w, idx) => (
                <div key={`${w}_${idx}`}>- {w}</div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {TABLE_OPTIONS.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={restoreTables.includes(t)}
                  onChange={(e) => {
                    setRestoreTables((prev) =>
                      e.target.checked ? [...prev, t] : prev.filter((x) => x !== t),
                    );
                  }}
                />
                <span>
                  {t}
                  <span className="ml-1 text-xs text-slate-400">({restoreRowCounts[t] || 0})</span>
                  {t === 'users' && (
                    <span className="ml-2 rounded-full border border-rose-300/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-100">
                      {tx(lang, 'şifrə/login dəyişə bilər', 'может изменить пароли/login')}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              className="neon-btn rounded-lg px-4 py-2"
              onClick={() => {
                setPendingFile(null);
                setShowModuleSelection(false);
                setRestoreTables([]);
              }}
            >
              {tx(lang, 'Ləğv et', 'Отмена')}
            </button>
            <button
              className="glossy-gold rounded-lg px-4 py-2 font-semibold"
              onClick={() => {
                if (restoreTables.length === 0) {
                  notify('error', tx(lang, 'Ən azı bir bölmə seçin', 'Выберите хотя бы один раздел'));
                  return;
                }
                setShowPasswordPrompt(true);
              }}
            >
              {tx(lang, 'Davam et', 'Продолжить')}
            </button>
          </div>
        </div>
      )}

      {showPasswordPrompt && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Admin Təsdiqi', 'Подтверждение админа')}</h3>
            <p className="mt-2 text-sm text-slate-300">
              {tx(lang, 'Bərpa üçün admin şifrəsini daxil edin', 'Введите пароль администратора для восстановления')}
            </p>
            <input
              type="password"
              className="neon-input mt-3"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  await confirmRestoreWithPassword();
                }
              }}
              placeholder={tx(lang, 'Admin şifrəsi', 'Пароль администратора')}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="neon-btn rounded-lg px-4 py-2"
                onClick={() => {
                  setShowPasswordPrompt(false);
                  setAdminPassword('');
                }}
              >
                {tx(lang, 'Ləğv et', 'Отмена')}
              </button>
              <button
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={confirmRestoreWithPassword}
              >
                {tx(lang, 'Bərpanı Təsdiqlə', 'Подтвердить восстановление')}
              </button>
            </div>
          </div>
        </div>
      )}
      {(isPreviewing || isRestoring) && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="metal-panel w-full max-w-md p-6 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-600 border-t-amber-300" />
            <h3 className="text-lg font-semibold text-slate-100">
              {isRestoring
                ? tx(lang, 'Bərpa davam edir', 'Восстановление выполняется')
                : tx(lang, 'Backup yoxlanılır', 'Backup проверяется')}
            </h3>
            <p className="mt-2 text-sm text-slate-300">{busyMessage}</p>
            {isRestoring && liveRestoreStatus && Number(liveRestoreStatus.total_tables || 0) > 0 && (
              <div className="mt-4 text-left">
                <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Run: {liveRestoreStatus.restore_run_id || '-'}</span>
                  <span>{String(liveRestoreStatus.phase || 'restoring')}</span>
                </div>
                <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
                  <span>
                    {tx(lang, 'Mərhələ', 'Этап')}: {liveRestoreStatus.current_table || tx(lang, 'yoxlanır', 'проверка')}
                  </span>
                  <span>
                    {Math.min(
                      100,
                      Math.round(
                        (Number(liveRestoreStatus.processed_tables || 0) / Number(liveRestoreStatus.total_tables || 1)) * 100,
                      ),
                    )}
                    %
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-700/70">
                  <div
                    className="h-full rounded-full bg-amber-300 transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (Number(liveRestoreStatus.processed_tables || 0) / Number(liveRestoreStatus.total_tables || 1)) * 100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    {tx(lang, 'Xəbərdarlıq', 'Предупреждения')}: {Number(liveRestoreStatus.warnings_count || 0)}
                  </span>
                  <span>
                    {tx(lang, 'Yeniləndi', 'Обновлено')}: {liveRestoreStatus.updated_at ? new Date(liveRestoreStatus.updated_at).toLocaleTimeString() : '-'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="metal-panel p-6">
        <h2 className="text-2xl font-bold flex items-center gap-3">
          <Database size={24} />
          {tx(lang, 'Baza İdarəetməsi', 'Управление базой')}
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          {tx(lang, 'Bu panel yalnız backup/restore üçündür. Ayarlar panelindən ayrıdır.', 'Эта панель только для backup/restore. Она отделена от панели настроек.')}
        </p>
        <div className="mt-4 rounded-xl border border-sky-400/30 bg-sky-950/30 p-4 text-sm text-sky-100">
          {tx(
            lang,
            'Canlı restoran rejimində restore yalnız backend/NeonDB uğurla yazanda tamamlanır. Backend xətası olarsa bərpa lokala düşməyəcək.',
            'В live-режиме restore завершается только после успешной записи в backend/NeonDB. При ошибке backend восстановление не будет записано локально.',
          )}
        </div>

        {forceLocalMode && (
          <div className="mt-4 rounded-xl border border-yellow-300/40 bg-yellow-900/20 p-4 text-sm text-yellow-100">
            <div className="font-semibold">{tx(lang, 'Sistem lokal rejimdə işləyir', 'Система работает в локальном режиме')}</div>
            <p className="mt-1 text-xs text-yellow-50/90">
              {tx(
                lang,
                'Backend əlçatan olmadığı üçün son restore lokal yaddaşa edildi. Canlı backend yenidən işləyirsə, bu rejimi söndürüb səhifəni yeniləyə bilərsiniz.',
                'Последнее восстановление было выполнено в локальную память, потому что backend был недоступен. Если backend снова работает, выключите этот режим и обновите страницу.',
              )}
            </p>
            <button
              className="neon-btn mt-3 rounded-lg px-3 py-2 text-xs font-semibold"
              onClick={() => {
                setForceLocalMode(false);
                setForceLocalModeState(false);
                window.location.reload();
              }}
            >
              {tx(lang, 'Canlı backend rejiminə qayıt', 'Вернуться к live backend')}
            </button>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <button onClick={handleBackup} className="glossy-gold rounded-xl px-4 py-3 font-bold inline-flex items-center justify-center gap-2">
            <Download size={18} />
            {tx(lang, 'Backup Yüklə', 'Скачать backup')}
          </button>

          <label className={`neon-btn rounded-xl px-4 py-3 inline-flex items-center justify-center gap-2 ${isPreviewing || isRestoring ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
            <Upload size={18} />
            {tx(lang, 'Restore Et', 'Восстановить')}
            <input type="file" accept=".json" className="hidden" onChange={handleRestore} disabled={isPreviewing || isRestoring} />
          </label>
        </div>

        {lastRestoreReport && (
          <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-900/30 p-4 text-sm text-slate-200">
            <div>
              {tx(lang, 'Son bərpa nəticəsi', 'Результат последнего восстановления')}:
              <span className="ml-2 font-semibold text-slate-100">
                {tx(lang, `Yükləndi ${lastRestoreReport.restored_rows}, rədd ${lastRestoreReport.rejected_rows}`, `Загружено ${lastRestoreReport.restored_rows}, отклонено ${lastRestoreReport.rejected_rows}`)}
              </span>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-3">
              <div>Run ID: <span className="text-slate-200">{lastRestoreReport.restore_run_id || '-'}</span></div>
              <div>
                {tx(lang, 'Müddət', 'Длительность')}: <span className="text-slate-200">{Number(lastRestoreReport.duration_ms || 0)} ms</span>
              </div>
              <div>
                {tx(lang, 'Xəbərdarlıq', 'Предупреждения')}: <span className="text-slate-200">{(lastRestoreReport.warnings || []).length}</span>
              </div>
            </div>
            {lastRestoreReport.rejected_rows > 0 && (
              <button onClick={downloadRejectedCsv} className="glossy-gold mt-3 rounded-lg px-3 py-2 text-xs font-semibold">
                {tx(lang, 'Rədd edilən sətirləri CSV yüklə', 'Скачать отклоненные строки (CSV)')}
              </button>
            )}
            {lastRestoreReport.verification && Object.keys(lastRestoreReport.verification).length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-950/30 p-3">
                <div className="font-semibold text-slate-100">
                  {tx(lang, 'Backend yoxlaması', 'Проверка backend')}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {Object.entries(lastRestoreReport.verification).map(([table, result]) => (
                    <div
                      key={table}
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        result.ok
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                          : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
                      }`}
                    >
                      <span className="font-semibold">{table}</span>
                      <span className="ml-2">
                        {tx(
                          lang,
                          `gözlənilən ${result.expected}, bazada ${result.actual}`,
                          `ожидалось ${result.expected}, в базе ${result.actual}`,
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {lastRestoreReport.dependency_verification && Object.keys(lastRestoreReport.dependency_verification).length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-950/30 p-3">
                <div className="font-semibold text-slate-100">
                  {tx(lang, 'Asılılıq yoxlaması', 'Проверка зависимостей')}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-1">
                  {Object.entries(lastRestoreReport.dependency_verification).map(([name, result]) => (
                    <div
                      key={name}
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        result.ok
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                          : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
                      }`}
                    >
                      <div className="font-semibold">{name}</div>
                      <div className="mt-1">
                        {tx(
                          lang,
                          `Uyğunlaşmayan referens: ${Number((result as any).missing_refs || 0)}`,
                          `Несовпадающих ссылок: ${Number((result as any).missing_refs || 0)}`,
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(lastRestoreReport.warnings) && lastRestoreReport.warnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-yellow-300/40 bg-yellow-900/20 p-3 text-xs text-yellow-100">
                <div className="mb-1 font-semibold">{tx(lang, 'Xəbərdarlıqlar', 'Предупреждения')}</div>
                {lastRestoreReport.warnings.slice(0, 12).map((warning, idx) => (
                  <div key={`${warning}_${idx}`}>- {warning}</div>
                ))}
                {lastRestoreReport.warnings.length > 12 && (
                  <div className="mt-1 text-yellow-200/90">
                    {tx(
                      lang,
                      `Daha ${lastRestoreReport.warnings.length - 12} xəbərdarlıq gizlədildi`,
                      `Еще ${lastRestoreReport.warnings.length - 12} предупреждений скрыто`,
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {isSuperTenant && (
        <div className="metal-panel p-6 space-y-6">
          <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Avtomatik Mərkəzi Backup Parametrləri', 'Настройки центрального бэкапа', 'Automated Central Backup Settings')}</h2>
          <p className="text-sm text-slate-400">
            {tx(
              lang,
              'Sistem məlumatlarının avtomatik ehtiyat nüsxəsini (backup) yaratmaq üçün hədəfi və vaxtı tənzimləyin.',
              'Настройте цель и время для автоматического резервного копирования системных данных.',
              'Configure target and time for automatic system data backups.',
            )}
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Backup enabled toggle */}
            <label className="flex items-center gap-3 rounded-xl border border-slate-700/70 bg-slate-900/20 p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={backupSettings.backup_enabled}
                onChange={(e) => setBackupSettings((prev) => ({ ...prev, backup_enabled: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-yellow-500 focus:ring-yellow-500"
              />
              <div>
                <div className="font-semibold text-slate-200">{tx(lang, 'Avtomatik Backup Aktivdir', 'Автоматический бэкап активен', 'Automatic Backup Enabled')}</div>
                <div className="text-xs text-slate-400">{tx(lang, 'Hər gün müəyyən olunmuş saatda backup alınır', 'Резервная копия создается каждый день в указанное время', 'Backup is taken daily at the configured hour')}</div>
              </div>
            </label>

            {/* Backup Hour */}
            <div className="flex flex-col gap-1 rounded-xl border border-slate-700/70 bg-slate-900/20 p-4">
              <label className="field-label font-semibold text-slate-200">{tx(lang, 'Backup Saatı (Baku UTC+4)', 'Час бэкапа (Баку UTC+4)', 'Backup Hour (Baku UTC+4)')}</label>
              <select
                value={backupSettings.backup_hour}
                onChange={(e) => setBackupSettings((prev) => ({ ...prev, backup_hour: Number(e.target.value) }))}
                className="neon-input mt-1"
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>

            {/* Backup Target */}
            <div className="flex flex-col gap-1 rounded-xl border border-slate-700/70 bg-slate-900/20 p-4">
              <label className="field-label font-semibold text-slate-200">{tx(lang, 'Backup Hədəfi', 'Цель резервного копирования', 'Backup Target')}</label>
              <select
                value={backupSettings.backup_target}
                onChange={(e) => setBackupSettings((prev) => ({ ...prev, backup_target: e.target.value as any }))}
                className="neon-input mt-1"
              >
                <option value="webhook">Webhook URL</option>
                <option value="disk">{tx(lang, 'Lokal Server Diski', 'Локальный диск сервера', 'Local Server Disk')}</option>
                <option value="both">{tx(lang, 'Hər İkisi (Webhook & Disk)', 'И то и другое (Webhook и Диск)', 'Both (Webhook & Disk)')}</option>
              </select>
            </div>

            {/* Local Disk Path */}
            {['disk', 'both'].includes(backupSettings.backup_target) && (
              <div className="flex flex-col gap-1 rounded-xl border border-slate-700/70 bg-slate-900/20 p-4">
                <label className="field-label font-semibold text-slate-200">{tx(lang, 'Lokal Disk Qovluğu (İstəyə bağlı)', 'Путь локального диска (Опционально)', 'Local Disk Directory (Optional)')}</label>
                <input
                  type="text"
                  placeholder="/app/backups/custom"
                  value={backupSettings.backup_local_path}
                  onChange={(e) => setBackupSettings((prev) => ({ ...prev, backup_local_path: e.target.value }))}
                  className="neon-input mt-1"
                />
                <div className="text-2xs text-slate-400 mt-1">{tx(lang, 'Boş buraxılsa, default olaraq /app/backups qovluğuna yazılacaq', 'Если пусто, по умолчанию запишется в /app/backups', 'If empty, defaults to /app/backups')}</div>
              </div>
            )}

            {/* Webhook URL & Secret */}
            {['webhook', 'both'].includes(backupSettings.backup_target) && (
              <div className="col-span-1 md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-slate-700/70 bg-slate-900/20 p-4">
                <div className="flex flex-col gap-1">
                  <label className="field-label font-semibold text-slate-200">Webhook URL</label>
                  <input
                    type="text"
                    placeholder="https://your-domain.com/backup-receiver"
                    value={backupSettings.backup_webhook_url}
                    onChange={(e) => setBackupSettings((prev) => ({ ...prev, backup_webhook_url: e.target.value }))}
                    className="neon-input mt-1"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="field-label font-semibold text-slate-200">{tx(lang, 'Webhook Gizli Açarı (Secret)', 'Секретный ключ вебхука (Secret)', 'Webhook Secret')}</label>
                  <input
                    type="password"
                    placeholder={backupSettings.backup_webhook_secret === '***' ? '••••••••' : tx(lang, 'İmzalanma üçün şifrə', 'Секрет для подписи', 'Secret for signature')}
                    value={backupSettings.backup_webhook_secret === '***' ? '' : backupSettings.backup_webhook_secret}
                    onChange={(e) => setBackupSettings((prev) => ({ ...prev, backup_webhook_secret: e.target.value }))}
                    className="neon-input mt-1"
                  />
                </div>
              </div>
            )}

            {/* Tenant Checklist */}
            <div className="col-span-1 md:col-span-2 rounded-xl border border-slate-700/70 bg-slate-900/20 p-4 space-y-3">
              <h3 className="font-semibold text-slate-200">
                {tx(lang, 'Yedəklənəcək Restoranlar (Tenant-lar)', 'Резервируемые рестораны (Теннанты)', 'Restaurants to Backup (Tenants)')}
              </h3>
              <p className="text-xs text-slate-400">
                {tx(lang, 'Siyahıdan avtomatik backup olunmasını istədiyiniz restoranları seçin. Platforma (super) həmişə yedəklənir.', 'Выберите рестораны для автоматического бэкапа. Платформа (super) всегда резервируется.', 'Select restaurants for automatic backup. Platform (super) is always backed up.')}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                {centralBackupTenants.map((t) => (
                  <label
                    key={t.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition ${
                      t.central_backup_enabled
                        ? 'border-yellow-500/40 bg-yellow-500/5'
                        : 'border-slate-800 bg-slate-950/20 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={t.central_backup_enabled}
                      disabled={t.slug === 'super'} // Super cannot be disabled
                      onChange={(e) => handleTenantCheckboxChange(t.id, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-yellow-500 focus:ring-yellow-500 disabled:opacity-50"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-200 truncate">{t.name}</div>
                      <div className="text-2xs text-slate-400 truncate">{t.slug} • {t.domain}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Status indicator if backup has run */}
          {(backupSettings.last_backup_at || backupSettings.last_backup_status) && (
            <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-4 text-xs text-slate-300 space-y-1">
              <div>
                <span className="text-slate-400">{tx(lang, 'Son Backup Tarixi', 'Дата последнего бэкапа', 'Last Backup At')}:</span>{' '}
                <span className="font-semibold text-slate-200">
                  {backupSettings.last_backup_at ? new Date(backupSettings.last_backup_at).toLocaleString() : '-'}
                </span>
              </div>
              <div>
                <span className="text-slate-400">{tx(lang, 'Son Backup Statusu', 'Статус последнего бэкапа', 'Last Backup Status')}:</span>{' '}
                <span className={`font-bold ${backupSettings.last_backup_status === 'success' || backupSettings.last_backup_status?.includes('✅') || backupSettings.last_backup_status?.toLowerCase().includes('http 200') || backupSettings.last_backup_status?.toLowerCase().includes('yazıldı') ? 'text-emerald-400' : 'text-red-400'}`}>
                  {backupSettings.last_backup_status || '-'}
                </span>
              </div>
            </div>
          )}

          {/* Backup Logs */}
          <div className="rounded-xl border border-slate-700 bg-slate-950/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-200">
                {tx(lang, 'Son 100 Backup Loqu', 'Последние 100 бэкап логов', 'Last 100 Backup Logs')}
              </h3>
              <button
                type="button"
                onClick={() => {
                  void get_central_backup_logs_live().then(setCentralBackupLogs).catch(() => {});
                }}
                className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-1 text-2xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                {tx(lang, 'Yenilə', 'Обновить', 'Refresh')}
              </button>
            </div>

            <div className="overflow-x-auto max-h-[300px] rounded-lg border border-slate-800">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-bold">
                    <th className="p-3">{tx(lang, 'Restoran (Slug)', 'Ресторан (Slug)', 'Restaurant (Slug)')}</th>
                    <th className="p-3">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
                    <th className="p-3">{tx(lang, 'Status', 'Статус', 'Status')}</th>
                    <th className="p-3">{tx(lang, 'Fayl Ölçüsü', 'Размер файла', 'File Size')}</th>
                    <th className="p-3">{tx(lang, 'Detallar', 'Детали', 'Details')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-900/10">
                  {centralBackupLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500 italic">
                        {tx(lang, 'Heç bir backup loqu tapılmadı.', 'Логов бэкапа не найдено.', 'No backup logs found.')}
                      </td>
                    </tr>
                  ) : (
                    centralBackupLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-800/20 transition">
                        <td className="p-3 font-semibold text-slate-300">{log.tenant_slug}</td>
                        <td className="p-3 text-slate-400">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-3xs font-bold uppercase ${
                              log.status === 'success'
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : 'bg-rose-500/10 text-rose-400'
                            }`}
                          >
                            {log.status === 'success' ? 'SUCCESS' : 'FAILED'}
                          </span>
                        </td>
                        <td className="p-3 text-slate-300 font-mono">
                          {log.backup_size_bytes ? formatBytes(log.backup_size_bytes) : '-'}
                        </td>
                        <td className="p-3 text-slate-400 max-w-[240px] truncate" title={log.detail || ''}>
                          {log.detail || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-700/70 pt-4">
            <div>
              {['webhook', 'both'].includes(backupSettings.backup_target) && backupSettings.backup_webhook_url && (
                <button
                  type="button"
                  disabled={testingWebhook}
                  onClick={() => { void handleTestWebhook(); }}
                  className="rounded-xl border border-cyan-400/50 bg-cyan-500/10 px-4 py-2 font-semibold text-cyan-200 hover:bg-cyan-500/20 active:scale-98 disabled:opacity-50"
                >
                  {testingWebhook ? tx(lang, 'Göndərilir...', 'Отправка...', 'Sending...') : tx(lang, 'Webhook Test Et', 'Тестировать вебхук', 'Test Webhook')}
                </button>
              )}
            </div>
            <button
              onClick={() => { void saveBackupSettings(); }}
              className="glossy-gold rounded-xl px-6 py-2 font-bold transition-transform duration-100 active:translate-y-px active:scale-[0.98]"
            >
              {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
