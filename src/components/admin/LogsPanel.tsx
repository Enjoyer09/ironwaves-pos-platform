import React, { useMemo, useState } from 'react';
import { clear_ui_errors, get_diagnostics_overview_live, get_logs_live, get_super_error_logs_live, get_ui_errors } from '../../api/logs';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { formatServerUtcDateTime, localDateInputValue } from '../../lib/time';

export default function LogsPanel() {
  const { user, lang } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [limit, setLimit] = useState(100);
  const [pageSize, setPageSize] = useState(10);
  const [quickFilter, setQuickFilter] = useState<'all' | 'finance_audit'>('all');
  const [query, setQuery] = useState('');
  const [superErrorMode, setSuperErrorMode] = useState(false);
  const [tenantFilter, setTenantFilter] = useState('');
  const [superIncludeAll, setSuperIncludeAll] = useState(false);
  const [diagnosticMinutes, setDiagnosticMinutes] = useState(120);
  const [diagnostics, setDiagnostics] = useState<any | null>(null);
  const [fromDate, setFromDate] = useState(() => localDateInputValue());
  const [toDate, setToDate] = useState(() => localDateInputValue());
  const [logs, setLogs] = useState<any[]>([]);
  const uiErrors = useMemo(() => get_ui_errors(tenant_id, 20), [tenant_id, logs.length]);

  React.useEffect(() => {
    if (String(user?.role || '').toLowerCase() !== 'super_admin') {
      setSuperErrorMode(false);
      setTenantFilter('');
      setSuperIncludeAll(false);
    }
  }, [user?.role]);

  React.useEffect(() => {
    const load = () => {
      if (superErrorMode && String(user?.role || '').toLowerCase() === 'super_admin') {
        void get_super_error_logs_live(limit, fromDate, toDate, tenantFilter, query, superIncludeAll)
          .then(setLogs)
          .catch(() => setLogs([]));
        return;
      }
      void get_logs_live(tenant_id, limit, fromDate, toDate).then(setLogs).catch(() => setLogs([]));
    };
    load();
    const handleRefresh = () => load();
    const handleVisibility = () => {
      if (!document.hidden) load();
    };
    window.addEventListener('focus', handleRefresh);
    window.addEventListener('logs-updated', handleRefresh as EventListener);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleRefresh);
      window.removeEventListener('logs-updated', handleRefresh as EventListener);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [tenant_id, limit, fromDate, toDate, superErrorMode, tenantFilter, query, user?.role, superIncludeAll]);

  React.useEffect(() => {
    if (String(user?.role || '').toLowerCase() !== 'super_admin') {
      setDiagnostics(null);
      return;
    }
    const loadDiagnostics = () => {
      void get_diagnostics_overview_live(diagnosticMinutes, tenantFilter).then(setDiagnostics).catch(() => setDiagnostics(null));
    };
    loadDiagnostics();
    const t = window.setInterval(loadDiagnostics, 20000);
    return () => window.clearInterval(t);
  }, [user?.role, diagnosticMinutes, tenantFilter]);

  const downloadJson = () => {
    try {
      const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `logs_${tenant_id}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  const downloadCsv = () => {
    try {
      const header = ['created_at', 'tenant_id', 'user', 'action', 'details'];
      const escapeCell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [header.join(',')];
      filtered.forEach((row: any) => {
        lines.push([
          row?.created_at || '',
          row?.tenant_id || '',
          row?.user || '',
          row?.action || '',
          JSON.stringify(parseDetails(row?.details || {})),
        ].map(escapeCell).join(','));
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `logs_${tenant_id}_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l: any) => {
      if (quickFilter === 'finance_audit' && String(l.action || '').toUpperCase() !== 'FINANCE_ANOMALY_SNAPSHOT') {
        return false;
      }
      if (!q) return true;
      const row = `${l.user} ${l.action} ${JSON.stringify(l.details || {})}`.toLowerCase();
      return row.includes(q);
    });
  }, [logs, query, quickFilter]);

  const visibleLogs = useMemo(() => filtered.slice(0, pageSize), [filtered, pageSize]);

  const parseDetails = (details: any) => {
    if (typeof details === 'string') {
      try {
        return JSON.parse(details);
      } catch {
        return { message: details };
      }
    }
    return details || {};
  };

  const humanizeAction = (actionRaw: string) => {
    const action = String(actionRaw || '').toUpperCase();
    const labels: Record<string, string> = {
      MENU_ADD: tx(lang, 'Menyuya yeni məhsul əlavə edildi', 'В меню добавлен новый товар', 'New menu item added'),
      MENU_EDIT: tx(lang, 'Menyu məhsulu yeniləndi', 'Позиция меню обновлена', 'Menu item updated'),
      MENU_SOFT_DELETE: tx(lang, 'Menyu məhsulu deaktiv edildi', 'Позиция меню деактивирована', 'Menu item deactivated'),
      INVENTORY_ADD: tx(lang, 'Anbara yeni məhsul əlavə edildi', 'На склад добавлен товар', 'Inventory item added'),
      INVENTORY_RESTOCK: tx(lang, 'Anbara əlavə mədaxil yazıldı', 'Склад пополнен', 'Inventory restocked'),
      INVENTORY_LOSS: tx(lang, 'Anbardan itki/zay yazıldı', 'Со склада списана потеря', 'Inventory loss recorded'),
      INVENTORY_DELETE: tx(lang, 'Anbar məhsulu silindi', 'Товар на складе удален', 'Inventory item deleted'),
      INVENTORY_CONSUMED: tx(lang, 'Satış üçün xammal sərf olundu', 'Сырье списано на продажу', 'Inventory consumed by sale'),
      SALE_VOIDED: tx(lang, 'Satış ləğv edildi', 'Продажа аннулирована', 'Sale voided'),
      SALE_PARTIAL_REFUND: tx(lang, 'Qismən refund edildi', 'Сделан частичный возврат', 'Partial refund applied'),
      REFUND_CREATED: tx(lang, 'Refund yaradıldı', 'Возврат создан', 'Refund created'),
      TABLE_CREATED: tx(lang, 'Yeni masa yaradıldı', 'Создан новый стол', 'Table created'),
      TABLE_DELETED: tx(lang, 'Masa silindi', 'Стол удален', 'Table deleted'),
      TABLE_TRANSFERRED: tx(lang, 'Sifariş başqa masaya köçürüldü', 'Заказ перенесен на другой стол', 'Order transferred to another table'),
      TABLE_MERGED: tx(lang, 'Masalar birləşdirildi', 'Столы объединены', 'Tables merged'),
      TABLE_SENT_TO_KITCHEN: tx(lang, 'Sifariş mətbəxə göndərildi', 'Заказ отправлен на кухню', 'Order sent to kitchen'),
      KITCHEN_ACCEPTED: tx(lang, 'Mətbəx sifarişi qəbul etdi', 'Кухня приняла заказ', 'Kitchen accepted the order'),
      KITCHEN_COMPLETED: tx(lang, 'Mətbəx sifarişi hazır etdi', 'Кухня завершила заказ', 'Kitchen marked order ready'),
      X_REPORT_CREATED: tx(lang, 'X-hesabat yaradıldı', 'Создан X-отчет', 'X report created'),
      Z_REPORT_CREATED: tx(lang, 'Z-hesabat yaradıldı', 'Создан Z-отчет', 'Z report created'),
      SHIFT_OPENED: tx(lang, 'Gün/növbə açıldı', 'Смена открыта', 'Shift opened'),
      SHIFT_CLOSED: tx(lang, 'Gün/növbə bağlandı', 'Смена закрыта', 'Shift closed'),
      SHIFT_HANDOVER: tx(lang, 'Növbə təhvil verildi', 'Смена передана', 'Shift handed over'),
      SHIFT_HANDOVER_ACCEPTED: tx(lang, 'Növbə qəbul edildi', 'Смена принята', 'Shift handover accepted'),
      USER_UPSERT: tx(lang, 'İstifadəçi yaradıldı və ya yeniləndi', 'Пользователь создан или обновлен', 'User created or updated'),
      USER_DELETE: tx(lang, 'İstifadəçi silindi', 'Пользователь удален', 'User deleted'),
      USER_CREDENTIALS_UPDATED: tx(lang, 'İstifadəçi şifrəsi və ya PIN-i yeniləndi', 'Пароль или PIN пользователя обновлен', 'User password or PIN updated'),
      BUSINESS_PROFILE_UPDATED: tx(lang, 'Biznes profili yeniləndi', 'Профиль бизнеса обновлен', 'Business profile updated'),
      PRINT_SETTINGS_UPDATED: tx(lang, 'Çap ayarları yeniləndi', 'Настройки печати обновлены', 'Print settings updated'),
      QR_SETTINGS_UPDATED: tx(lang, 'QR ayarları yeniləndi', 'Настройки QR обновлены', 'QR settings updated'),
      CRM_SEND: tx(lang, 'CRM email göndərişi edildi', 'CRM-рассылка отправлена', 'CRM email sent'),
      QR_GENERATED: tx(lang, 'Yeni QR yaradıldı', 'Создан новый QR', 'New QR generated'),
      OFFLINE_SALES_SYNCED: tx(lang, 'Offline satışlar serverə göndərildi', 'Оффлайн продажи синхронизированы', 'Offline sales synced'),
      FINANCE_ANOMALY_SNAPSHOT: tx(lang, 'Maliyyə audit snapshot-u', 'Снимок финансового аудита', 'Finance audit snapshot'),
    };
    return labels[action] || action.replace(/_/g, ' ').toLowerCase();
  };

  const summarizeDetails = (actionRaw: string, detailsRaw: any) => {
    const action = String(actionRaw || '').toUpperCase();
    const details = parseDetails(detailsRaw);
    const itemName = String(details.item_name || details.name || details.item || '').trim();
    const qty = details.qty ?? details.qty_added ?? details.qty_removed;
    const unit = details.unit ? ` ${details.unit}` : '';
    const amount = details.amount || details.total || details.value;
    const targetUser = details.received_by || details.username || details.target_user;
    if (action === 'INVENTORY_ADD' && itemName) return `${itemName} • ${qty || 0}${unit}`;
    if (action === 'INVENTORY_RESTOCK' && itemName) return `${itemName} • +${qty || 0}${unit}`;
    if (action === 'INVENTORY_LOSS' && itemName) return `${itemName} • -${qty || 0}${unit}`;
    if (action === 'SALE_VOIDED' && details.sale_id) return `sale_id: ${details.sale_id}`;
    if (action === 'SALE_PARTIAL_REFUND' && amount) return `${tx(lang, 'Refund məbləği', 'Сумма возврата', 'Refund amount')}: ${amount}`;
    if ((action === 'SHIFT_HANDOVER' || action === 'SHIFT_HANDOVER_ACCEPTED') && targetUser) return `${tx(lang, 'İşçi', 'Сотрудник', 'Staff')}: ${targetUser}`;
    if (action === 'FINANCE_ANOMALY_SNAPSHOT') {
      const bits: string[] = [];
      if (details.has_reconciliation_issue) bits.push(tx(lang, 'satış və maliyyə yazılışı fərqi', 'разница продаж и финансовых проводок', 'sales vs ledger gap'));
      if (details.has_investor_mismatch) bits.push(tx(lang, 'investor uyğunsuzluğu', 'несовпадение инвестора', 'investor mismatch'));
      if (details.has_shift_cash_mismatch) bits.push(tx(lang, 'shift kassa fərqi', 'разница кассы смены', 'shift cash gap'));
      if (details.has_deposit_risk) bits.push(tx(lang, 'depozit riski', 'риск депозитов', 'deposit risk'));
      if (details.has_closed_shift_open_deposit) bits.push(tx(lang, 'bağlı növbədə depozit', 'депозит при закрытой смене', 'deposit on closed shift'));
      return bits.length > 0 ? bits.join(' • ') : tx(lang, 'Audit warning yoxdur', 'Нет audit warning', 'No audit warning');
    }
    if (amount) return `${tx(lang, 'Məbləğ', 'Сумма', 'Amount')}: ${amount}`;
    if (itemName) return itemName;
    return details.message || '-';
  };

  const renderDetails = (details: any) => {
    const parsed = parseDetails(details);
    if (!parsed || Object.keys(parsed).length === 0) return '-';
    if (parsed.has_reconciliation_issue !== undefined || parsed.has_investor_mismatch !== undefined || parsed.has_shift_cash_mismatch !== undefined) {
      const riskRows = [
        {
          label: tx(lang, 'Satış və maliyyə yazılışı fərqi', 'Разница продаж и финансовых проводок', 'Sales vs ledger gap'),
          active: Boolean(parsed.has_reconciliation_issue),
          value: parsed.reconciliation_gap,
        },
        {
          label: tx(lang, 'Investor maliyyə yazılışı fərqi', 'Разница инвесторских финансовых проводок', 'Investor ledger gap'),
          active: Boolean(parsed.has_investor_mismatch),
          value: parsed.investor_ledger_gap,
        },
        {
          label: tx(lang, 'Shift kassa fərqi', 'Разница кассы смены', 'Shift cash gap'),
          active: Boolean(parsed.has_shift_cash_mismatch),
          value: parsed.shift_cash_gap,
        },
        {
          label: tx(lang, 'Depozit və kassa fərqi', 'Разница депозита и кассы', 'Deposit vs cash gap'),
          active: Boolean(parsed.has_deposit_risk),
          value: parsed.deposit_cash_gap,
        },
      ];
      return (
        <div className="space-y-2 rounded-md border border-rose-400/30 bg-rose-950/20 p-2">
          <div className="text-[11px] font-semibold text-rose-200">{tx(lang, 'Maliyyə audit nəticəsi', 'Результат финансового аудита', 'Finance audit result')}</div>
          {riskRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-[11px]">
              <span className={row.active ? 'text-rose-100' : 'text-slate-400'}>{row.label}</span>
              <span className={row.active ? 'font-mono text-rose-200' : 'font-mono text-slate-500'}>
                {row.active ? `${String(row.value || '0')} ₼` : tx(lang, 'yoxdur', 'нет', 'none')}
              </span>
            </div>
          ))}
          <div className="border-t border-rose-300/20 pt-2 text-[11px] text-slate-300">
            <div>{tx(lang, 'Nağd kassa', 'Касса', 'Cash')}: <span className="font-mono">{String(parsed.cash_balance || '0')} ₼</span></div>
            <div>{tx(lang, 'Aktiv depozit öhdəliyi', 'Активное депозитное обязательство', 'Active deposit liability')}: <span className="font-mono">{String(parsed.deposit_balance || '0')} ₼</span></div>
            <div>{tx(lang, 'İnvestor borcu', 'Долг инвестору', 'Investor debt')}: <span className="font-mono">{String(parsed.investor_calculated_debt || parsed.investor_ledger_balance || '0')} ₼</span></div>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-1 rounded-md border border-slate-700/70 bg-slate-900/40 p-2">
        {Object.entries(parsed).map(([k, v]) => (
          <div key={k} className="flex items-start gap-2 text-[11px] leading-4 text-slate-200">
            <span className="min-w-[120px] text-slate-400">{k}</span>
            <span className="font-mono break-all text-slate-100">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
          </div>
        ))}
      </div>
    );
  };

  const copySaleId = async (details: any) => {
    let parsed = details;
    if (typeof details === 'string') {
      try {
        parsed = JSON.parse(details);
      } catch {
        parsed = null;
      }
    }
    const saleId = parsed?.sale_id;
    if (!saleId) return;
    try {
      await navigator.clipboard.writeText(String(saleId));
    } catch {
      // ignore clipboard errors silently
    }
  };

  return (
    <div className="space-y-4 text-slate-100">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{tx(lang, 'Sistem Loqları', 'Системные логи')}</h2>
        <div className="flex items-center gap-2">
          <select value={quickFilter} onChange={(e) => setQuickFilter(e.target.value as 'all' | 'finance_audit')} className="neon-input">
            <option value="all">{tx(lang, 'Bütün loqlar', 'Все логи', 'All logs')}</option>
            <option value="finance_audit">{tx(lang, 'Maliyyə auditləri', 'Финансовые аудиты', 'Finance audits')}</option>
          </select>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="neon-input" />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="neon-input" />
          {String(user?.role || '').toLowerCase() === 'super_admin' && (
            <label className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              <input
                type="checkbox"
                checked={superErrorMode}
                onChange={(e) => setSuperErrorMode(e.target.checked)}
              />
              {tx(lang, 'Platforma Xəta Rejimi', 'Режим ошибок платформы', 'Platform Error Mode')}
            </label>
          )}
          {superErrorMode && String(user?.role || '').toLowerCase() === 'super_admin' && (
            <input
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              placeholder={tx(lang, 'Tenant ID filtr (opsional)', 'Фильтр Tenant ID (опц.)', 'Tenant ID filter (optional)')}
              className="neon-input min-w-[220px]"
            />
          )}
          {superErrorMode && String(user?.role || '').toLowerCase() === 'super_admin' && (
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-500/40 bg-slate-800/40 px-3 py-2 text-xs text-slate-100">
              <input
                type="checkbox"
                checked={superIncludeAll}
                onChange={(e) => setSuperIncludeAll(e.target.checked)}
              />
              {tx(lang, 'Yalnız xətalar yox, hamısını göstər', 'Показывать не только ошибки, но и все', 'Show all logs, not only errors')}
            </label>
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tx(lang, 'Action və ya user ilə axtar...', 'Поиск по действию или пользователю...')}
            className="neon-input"
          />
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="neon-input"
          >
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="neon-input">
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
          </select>
          <button className="neon-btn" onClick={downloadJson}>
            {tx(lang, 'JSON yüklə', 'Скачать JSON', 'Download JSON')}
          </button>
          <button className="neon-btn" onClick={downloadCsv}>
            {tx(lang, 'CSV yüklə', 'Скачать CSV', 'Download CSV')}
          </button>
        </div>
      </div>

      <div className="metal-panel overflow-x-auto">
        {String(user?.role || '').toLowerCase() === 'super_admin' && diagnostics && (
          <div className="border-b border-cyan-400/20 bg-cyan-500/10 px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-cyan-100">
              <span className="font-bold">{tx(lang, 'Diaqnostika', 'Диагностика', 'Diagnostics')}</span>
              <select
                value={diagnosticMinutes}
                onChange={(e) => setDiagnosticMinutes(Number(e.target.value))}
                className="neon-input h-8 py-0 text-xs"
              >
                <option value={30}>30 dəq</option>
                <option value={60}>60 dəq</option>
                <option value={120}>120 dəq</option>
                <option value={360}>360 dəq</option>
              </select>
              <span>{tx(lang, 'DB aktiv bağlantı', 'Активные DB подключения', 'Active DB connections')}: <b>{diagnostics?.db_health?.active_conn ?? '-'}</b></span>
              <span>{tx(lang, 'Maks aktiv query (ms)', 'Макс активный запрос (мс)', 'Max active query (ms)')}: <b>{Math.round(Number(diagnostics?.db_health?.max_active_query_ms || 0))}</b></span>
            </div>
            <div className="grid gap-2 md:grid-cols-3 text-[11px] text-cyan-50">
              {['BACKEND_UNHANDLED_EXCEPTION', 'API_NETWORK_ERROR', 'UI_ERROR'].map((key) => (
                <div key={key} className="rounded-lg border border-cyan-300/25 bg-slate-900/40 px-2 py-1">
                  {key}: <b>{Number(diagnostics?.action_counts?.[key] || 0)}</b>
                </div>
              ))}
            </div>
          </div>
        )}
        {superErrorMode && String(user?.role || '').toLowerCase() === 'super_admin' && (
          <div className="border-b border-rose-400/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
            {tx(
              lang,
              'Super admin xəta görünüşü aktivdir: bütün tenant-lar üzrə error/fail/reject hadisələri göstərilir.',
              'Активен super admin режим ошибок: показываются error/fail/reject события по всем tenant-ам.',
              'Super admin error view is active: error/fail/reject events are shown across all tenants.',
            )}
          </div>
        )}
        {user?.role === 'admin' && (
          <div className="border-b border-slate-700/60 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-red-200">{tx(lang, 'UI Telemetri (POS/KDS)', 'UI телеметрия (POS/KDS)')}</h3>
              <button
                className="neon-btn rounded-lg px-2 py-1 text-xs"
                onClick={() => {
                  clear_ui_errors(tenant_id);
                  window.location.reload();
                }}
              >
                {tx(lang, 'Telemetri təmizlə', 'Очистить телеметрию')}
              </button>
            </div>
            {uiErrors.length === 0 ? (
              <div className="text-xs text-slate-400">{tx(lang, 'UI xətası qeydi yoxdur', 'Записей UI-ошибок нет')}</div>
            ) : (
              <div className="max-h-40 space-y-2 overflow-y-auto pr-1 text-xs">
                {uiErrors.map((e: any) => (
                  <div key={e.id} className="rounded-md border border-red-300/30 bg-red-900/10 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-red-200">{e.module}</span>
                      <span className="text-slate-400">{formatServerUtcDateTime(e.created_at, lang)}</span>
                    </div>
                    <div className="mt-1 break-all text-slate-200">{e.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/50 text-slate-300">
            <tr>
              <th className="px-4 py-3">{tx(lang, 'Tarix', 'Дата')}</th>
              <th className="px-4 py-3">{tx(lang, 'İstifadəçi', 'Пользователь')}</th>
              <th className="px-4 py-3">{tx(lang, 'Əməliyyat', 'Действие', 'Action')}</th>
              <th className="px-4 py-3">{tx(lang, 'Qısa izah', 'Краткое описание', 'Human summary')}</th>
              <th className="px-4 py-3">{tx(lang, 'Texniki detallar', 'Технические детали', 'Technical details')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleLogs.map((log: any) => (
              <tr key={log.id} className="border-t border-slate-700/60 align-top">
                <td className="px-4 py-3">{formatServerUtcDateTime(log.created_at, lang)}</td>
                <td className="px-4 py-3 font-medium">{log.user}</td>
                <td className="px-4 py-3">
                  <span className="rounded-md border border-yellow-300/40 bg-yellow-400/10 px-2 py-1 text-xs font-semibold text-yellow-200">
                    {humanizeAction(log.action)}
                  </span>
                  <div className="mt-2 text-[11px] text-slate-500">{log.action}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-200">{summarizeDetails(log.action, log.details)}</td>
                <td className="px-4 py-3 text-xs text-slate-300">
                  {renderDetails(log.details)}
                  {(String(log.action || '').includes('SALE') || String(log.action || '').includes('REFUND')) && (
                    <button
                      className="mt-2 rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700/40"
                      onClick={() => copySaleId(log.details)}
                    >
                      {tx(lang, 'sale_id kopyala', 'копировать sale_id')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {tx(lang, 'Loq tapılmadı', 'Логи не найдены')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="border-t border-slate-700/60 px-4 py-3 text-xs text-slate-400">
          {tx(lang, 'Ekranda görünən', 'На экране', 'Showing')}: <b>{visibleLogs.length}</b> / {filtered.length}
        </div>
      </div>
    </div>
  );
}
