import React from 'react';
import { backup_database, get_restore_preview, restore_database, type RestoreReport } from '../../api/database';
import { useAppStore } from '../../store';
import { Database, Download, Upload } from 'lucide-react';
import { tx } from '../../i18n';
import { useState } from 'react';
import { getDB } from '../../lib/db_sim';
import { verifyLocalCredential } from '../../lib/local_auth';

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

  const TABLE_OPTIONS = [
    'users','menu_items','sales','finance','tables','kitchen_orders','z_reports','inventory','ingredients','customers','recipes','happy_hours','refunds','settings','notifications','business_profile','logs'
  ];

  const handleBackup = () => {
    const data = backup_database(tenant_id);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ironwaves_pos_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runRestore = (file: File, selected: string[]) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const report = restore_database(tenant_id, content, selected);
        if (!report.success) throw new Error('restore failed');
        setLastRestoreReport(report);
        notify(
          'success',
          tx(
            lang,
            `Baza bərpa edildi. ${report.restored_rows} sətir yükləndi, ${report.rejected_rows} sətir rədd edildi.`,
            `База восстановлена. Загружено строк: ${report.restored_rows}, отклонено: ${report.rejected_rows}.`,
          ),
        );
        setTimeout(() => window.location.reload(), 500);
      } catch {
        notify('error', tx(lang, 'Restore uğursuz oldu. JSON backup faylını yoxlayın.', 'Восстановление не удалось. Проверьте JSON backup файл.'));
      }
    };
    reader.readAsText(file);
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
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const preview = get_restore_preview(tenant_id, String(event.target?.result || '{}'));
        const found = TABLE_OPTIONS.filter((k) => preview.available_tables.includes(k));
        setRestoreTables(found.length ? found : TABLE_OPTIONS);
        setRestoreWarnings(preview.warnings || []);
        setRestoreRowCounts(preview.row_counts || {});
      } catch {
        setRestoreTables(TABLE_OPTIONS);
        setRestoreWarnings([tx(lang, 'JSON parse alınmadı, default cədvəl siyahısı göstərildi.', 'Не удалось разобрать JSON, показан список по умолчанию.')]);
        setRestoreRowCounts({});
      }
      setPendingFile(file);
      setShowModuleSelection(true);
    };
    reader.readAsText(file);
  };

  const verifyAdminPassword = async () => {
    const users = getDB<any>('users');
    const currentAdmin = users.find(
      (u) =>
        String(u.username || '').toLowerCase() === String(user?.username || '').toLowerCase() &&
        ['admin', 'super_admin'].includes(String(u.role || '').toLowerCase()),
    );

    if (!currentAdmin) return false;
    return verifyLocalCredential(adminPassword, currentAdmin.password_hash || currentAdmin.password);
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
                  if (!(await verifyAdminPassword())) {
                    notify('error', tx(lang, 'Şifrə yanlışdır', 'Неверный пароль'));
                    return;
                  }
                  if (pendingFile) runRestore(pendingFile, restoreTables);
                  setPendingFile(null);
                  setShowModuleSelection(false);
                  setShowPasswordPrompt(false);
                  setAdminPassword('');
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
                onClick={async () => {
                  if (!(await verifyAdminPassword())) {
                    notify('error', tx(lang, 'Şifrə yanlışdır', 'Неверный пароль'));
                    return;
                  }
                  if (pendingFile) runRestore(pendingFile, restoreTables);
                  setPendingFile(null);
                  setShowModuleSelection(false);
                  setShowPasswordPrompt(false);
                  setAdminPassword('');
                }}
              >
                {tx(lang, 'Bərpanı Təsdiqlə', 'Подтвердить восстановление')}
              </button>
            </div>
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

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <button onClick={handleBackup} className="glossy-gold rounded-xl px-4 py-3 font-bold inline-flex items-center justify-center gap-2">
            <Download size={18} />
            {tx(lang, 'Backup Yüklə', 'Скачать backup')}
          </button>

          <label className="neon-btn rounded-xl px-4 py-3 cursor-pointer inline-flex items-center justify-center gap-2">
            <Upload size={18} />
            {tx(lang, 'Restore Et', 'Восстановить')}
            <input type="file" accept=".json" className="hidden" onChange={handleRestore} />
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
