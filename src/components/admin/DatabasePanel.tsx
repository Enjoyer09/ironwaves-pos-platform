import React from 'react';
import { backup_database_live, get_restore_preview, restore_database_live, type RestoreReport } from '../../api/database';
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
  const [forceLocalMode, setForceLocalModeState] = useState(() => isForceLocalMode());

  const TABLE_OPTIONS = [
    'users','menu_items','sales','finance','tables','kitchen_orders','z_reports','inventory','ingredients','customers','recipes','happy_hours','refunds','settings','notifications','business_profile','logs'
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

    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (
        exactKeys.has(key) ||
        key.startsWith('db_') ||
        key.startsWith(`${tenant_id}_`) ||
        key.includes(`db_${tenant_id}_`)
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

  const clearLocalRestoreCache = () => {
    if (!window.confirm(tx(
      lang,
      'Lokal restore/cache təmizlənsin? Bu yalnız brauzerdə qalmış lokal POS məlumatlarını silir, backend/NeonDB məlumatına toxunmur.',
      'Очистить локальный restore/cache? Это удалит только локальные данные POS в браузере и не затронет backend/NeonDB.',
    ))) {
      return;
    }

    const removedCount = clearLocalRestoreState();
    notify('success', tx(
      lang,
      `${removedCount} lokal cache açarı təmizləndi. Səhifə yenilənir...`,
      `Очищено локальных ключей cache: ${removedCount}. Страница обновляется...`,
    ));
    window.setTimeout(() => window.location.reload(), 500);
  };

  const yieldToUi = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  const getErrorMessage = (error: unknown, fallbackAz: string, fallbackRu: string) => {
    const message = error instanceof Error ? error.message : '';
    if (!message) return tx(lang, fallbackAz, fallbackRu);
    return tx(lang, `${fallbackAz}: ${message}`, `${fallbackRu}: ${message}`);
  };

  const normalizeRestoreSelection = (selected: string[], available: string[]) => {
    const availableSet = new Set(available);
    const selectedAvailable = selected.filter((table) => availableSet.has(table));
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
      if (!mergedReport.success) {
        throw new Error('restore failed');
      }

      setLastRestoreReport(mergedReport);
      const restoredUsers = selectedExisting.includes('users') || mergedReport.restored_tables.includes('users');
      clearLocalRestoreState({ clearSession: restoredUsers });
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
    }
  };

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
          tenantId: null,
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

        <div className="mt-4 rounded-xl border border-red-300/30 bg-red-950/20 p-4 text-sm text-red-50">
          <div className="font-semibold">
            {tx(lang, 'Donma varsa: lokal restore/cache təmizlə', 'Если система зависает: очистите локальный restore/cache')}
          </div>
          <p className="mt-1 text-xs text-red-50/85">
            {tx(
              lang,
              'Əvvəlki uğursuz restore brauzer yaddaşını şişirdibsə, bu düymə yalnız lokal POS cache-ni silir və sistemi yenidən backend rejiminə qaytarır.',
              'Если старый неудачный restore раздул память браузера, эта кнопка удалит только локальный POS cache и вернет систему в backend-режим.',
            )}
          </p>
          <button
            className="mt-3 rounded-lg border border-red-200/40 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-50 hover:bg-red-500/30"
            onClick={clearLocalRestoreCache}
          >
            {tx(lang, 'Lokal restore/cache təmizlə', 'Очистить локальный restore/cache')}
          </button>
        </div>

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
            {lastRestoreReport.rejected_rows > 0 && (
              <button onClick={downloadRejectedCsv} className="glossy-gold mt-3 rounded-lg px-3 py-2 text-xs font-semibold">
                {tx(lang, 'Rədd edilən sətirləri CSV yüklə', 'Скачать отклоненные строки (CSV)')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
