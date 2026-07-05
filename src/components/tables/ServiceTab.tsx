import React from 'react';
import { tx } from '../../i18n';

interface ServiceTabProps {
  lang: string;
  waitingItems: Array<{ item_name: string; qty: number }>;
  readyItems: Array<{ item_name: string; qty: number }>;
  servedItems: Array<{ item_name: string; qty: number }>;
  revisionItems: Array<{ item_name: string; qty: number; reason?: string }>;
  onMarkServed: (itemName: string, qty: number) => void;
}

export default function ServiceTab({ lang, waitingItems, readyItems, servedItems, revisionItems, onMarkServed }: ServiceTabProps) {
  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-4">
        <div className="rounded-lg border border-blue-300/30 bg-blue-500/10 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-blue-200">{tx(lang, 'Mətbəxdə gözləyənlər', 'Ожидают на кухне', 'Waiting in kitchen')}</div>
          <div className="space-y-2 text-sm text-slate-100">
            {waitingItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Aktiv gözləyən item yoxdur', 'Нет ожидающих позиций', 'No waiting items')}</div> : waitingItems.map((row, idx) => (
              <div key={`wait_${idx}`} className="rounded-md bg-black/15 px-3 py-2">{row.qty}x {row.item_name}</div>
            ))}
          </div>
        </div>
        <div className={`rounded-lg border p-3 ${readyItems.length > 0 ? 'border-emerald-200/60 bg-emerald-400/15 shadow-[0_0_26px_rgba(74,222,128,0.18)] ring-1 ring-emerald-300/30' : 'border-emerald-300/30 bg-emerald-500/10'}`}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">{tx(lang, 'Servisə hazır', 'Готово к подаче', 'Ready to serve')}</div>
          <div className="space-y-2 text-sm text-slate-100">
            {readyItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Servisə hazır item yoxdur', 'Нет готовых к подаче позиций', 'No ready-to-serve items')}</div> : readyItems.map((row, idx) => (
              <div key={`ready_${idx}`} className="flex items-center justify-between gap-2 rounded-md bg-black/15 px-3 py-2">
                <div>{row.qty}x {row.item_name}</div>
                <button type="button" className="rounded-md border border-emerald-300/40 bg-emerald-400/15 px-2 py-1 text-[11px] font-semibold text-emerald-100" onClick={() => onMarkServed(String(row.item_name || ''), Number(row.qty || 0))}>
                  {tx(lang, 'Servis edildi', 'Подано', 'Served')}
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-violet-300/30 bg-violet-500/10 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">{tx(lang, 'Servis edilənlər', 'Поданные позиции', 'Served items')}</div>
          <div className="space-y-2 text-sm text-slate-100">
            {servedItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Hələ servis edilən item yoxdur', 'Пока нет поданных позиций', 'No served items yet')}</div> : servedItems.map((row, idx) => (
              <div key={`served_${idx}`} className="rounded-md bg-black/15 px-3 py-2">{row.qty}x {row.item_name}</div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-rose-300/30 bg-rose-500/10 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200">{tx(lang, 'Dəyişikliklər', 'Изменения', 'Revisions')}</div>
          <div className="space-y-2 text-sm text-slate-100">
            {revisionItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Düzəliş yoxdur', 'Нет изменений', 'No revisions')}</div> : revisionItems.map((row, idx) => (
              <div key={`rev_${idx}`} className="rounded-md bg-black/15 px-3 py-2">{row.qty}x {row.item_name}{row.reason ? ` · ${row.reason}` : ''}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
