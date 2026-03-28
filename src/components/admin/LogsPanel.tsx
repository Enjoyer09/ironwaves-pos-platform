import React, { useMemo, useState } from 'react';
import { clear_ui_errors, get_logs_live, get_ui_errors } from '../../api/logs';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';

export default function LogsPanel() {
  const { user, lang } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [limit, setLimit] = useState(250);
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logs, setLogs] = useState<any[]>([]);
  const uiErrors = useMemo(() => get_ui_errors(tenant_id, 20), [tenant_id, logs.length]);

  React.useEffect(() => {
    void get_logs_live(tenant_id, limit, fromDate, toDate).then(setLogs).catch(() => setLogs([]));
  }, [tenant_id, limit, fromDate, toDate]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l: any) => {
      const row = `${l.user} ${l.action} ${JSON.stringify(l.details || {})}`.toLowerCase();
      return row.includes(q);
    });
  }, [logs, query]);

  const renderDetails = (details: any) => {
    let parsed = details;
    if (typeof details === 'string') {
      try {
        parsed = JSON.parse(details);
      } catch {
        parsed = { message: details };
      }
    }
    if (!parsed || Object.keys(parsed).length === 0) return '-';
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
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="neon-input" />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="neon-input" />
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
        </div>
      </div>

      <div className="metal-panel overflow-x-auto">
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
                      <span className="text-slate-400">{new Date(e.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</span>
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
              <th className="px-4 py-3">{tx(lang, 'Action', 'Действие')}</th>
              <th className="px-4 py-3">{tx(lang, 'Details', 'Детали')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((log: any) => (
              <tr key={log.id} className="border-t border-slate-700/60 align-top">
                <td className="px-4 py-3">{new Date(log.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</td>
                <td className="px-4 py-3 font-medium">{log.user}</td>
                <td className="px-4 py-3">
                  <span className="rounded-md border border-yellow-300/40 bg-yellow-400/10 px-2 py-1 text-xs font-semibold text-yellow-200">
                    {log.action}
                  </span>
                </td>
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
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  {tx(lang, 'Loq tapılmadı', 'Логи не найдены')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
