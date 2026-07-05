import React from 'react';
import { tx } from '../../i18n';
import { formatServerUtcDateTime } from '../../lib/time';

interface StatusLogModalProps {
  target: { item_name: string };
  rows: any[];
  lang: string;
  onClose: () => void;
}

export default function StatusLogModal({ target, rows, lang, onClose }: StatusLogModalProps) {
  return (
    <div className="fixed inset-0 z-[136] flex items-center justify-center bg-black/70 p-4">
      <div className="metal-panel flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-100">{tx(lang, 'Status tarixçəsi', 'История статуса', 'Status history')}</h3>
            <div className="mt-1 text-sm text-slate-400">{target.item_name}</div>
          </div>
          <button type="button" className="neon-btn rounded-xl px-4 py-2 text-sm font-bold" onClick={onClose}>
            {tx(lang, 'Bağla', 'Закрыть', 'Close')}
          </button>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-2xl border border-slate-700/70 bg-slate-950/35 p-3">
          {rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">{tx(lang, 'Status tarixçəsi yoxdur', 'Истории статуса нет', 'No status history')}</div>
          ) : (
            <div className="space-y-2">
              {rows.map((row: any) => (
                <div key={row.id} className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-black text-slate-100">{row.old_status || '-'} → {row.new_status}</div>
                    <div className="text-xs text-slate-500">{formatServerUtcDateTime(row.changed_at, lang)}</div>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{tx(lang, 'İstifadəçi', 'Пользователь', 'User')}: {row.changed_by || '-'}</div>
                  {row.reason ? <div className="mt-1 text-xs text-slate-500">{row.reason}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
