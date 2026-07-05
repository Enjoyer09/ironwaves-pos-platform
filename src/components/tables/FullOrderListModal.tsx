import React from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';

interface FullOrderListModalProps {
  lang: string;
  tableLabel: string;
  items: any[];
  tableNeedsSafeCancel: boolean;
  isManagerUser: boolean;
  userCanEditTable: boolean;
  onClose: () => void;
  onVoidItem: (item: any) => void;
  onCancelTable: () => void;
}

export default function FullOrderListModal(props: FullOrderListModalProps) {
  const { lang, tableLabel, items, tableNeedsSafeCancel, isManagerUser, userCanEditTable, onClose, onVoidItem, onCancelTable } = props;

  const statusOrder = ['READY', 'PREPARING', 'SENT', 'NEW', 'VOID_REQUESTED', 'SERVED', 'VOIDED', 'COMPED', 'WASTE'];
  const sorted = [...items].sort((a: any, b: any) => {
    const aIdx = statusOrder.indexOf(String(a.status || 'SENT').toUpperCase());
    const bIdx = statusOrder.indexOf(String(b.status || 'SENT').toUpperCase());
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4">
      <div className="metal-panel flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black text-slate-100">{tx(lang, 'Göndərilmişlər', 'Отправленные', 'Sent Items')}</div>
            <div className="mt-1 text-sm text-slate-400">{tableLabel} · {items.length} {tx(lang, 'item', 'позиций', 'items')}</div>
          </div>
          <button type="button" onClick={onClose} className="neon-btn rounded-xl px-4 py-2 text-sm font-bold">
            {tx(lang, 'Bağla', 'Закрыть', 'Close')}
          </button>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-2xl border border-slate-700/70 bg-slate-950/35 p-3">
          {items.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              <div>{tx(lang, 'Sifariş yoxdur', 'Заказов нет', 'No order items')}</div>
              {tableNeedsSafeCancel && (
                <div className="mx-auto mt-4 max-w-md rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 text-left">
                  <div className="text-sm font-black text-rose-100">{tx(lang, 'Uyğunsuz masa məbləği', 'Несовпадающая сумма стола', 'Mismatched table total')}</div>
                  <div className="mt-1 text-xs text-rose-100/80">
                    {tx(lang, 'Bu masada məbləğ var, amma sifariş yoxdur. Kassaya səhv satış düşməsin deyə satışsız ləğv edin.', 'У стола есть сумма, но нет заказа. Отмените без продажи, чтобы не создать ошибочную кассу.', 'This table has a total but no order items. Cancel without sale to avoid a wrong cash entry.')}
                  </div>
                  <button
                    type="button"
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-rose-300/50 bg-rose-500/20 px-4 py-2 text-sm font-black text-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!isManagerUser || !userCanEditTable}
                    onClick={onCancelTable}
                  >
                    {tx(lang, 'Satışsız ləğv et', 'Отменить без продажи', 'Cancel without sale')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((row: any, idx: number) => {
                const status = String(row.status || 'SENT').toUpperCase();
                const isTerminal = ['VOIDED', 'COMPED', 'WASTE'].includes(status);
                const dotColor =
                  status === 'READY' ? 'bg-emerald-400' :
                  status === 'PREPARING' ? 'bg-orange-400' :
                  status === 'VOID_REQUESTED' ? 'bg-yellow-400 animate-pulse' :
                  status === 'SERVED' ? 'bg-violet-400' :
                  isTerminal ? 'bg-slate-500' : 'bg-blue-400';
                const statusLabel =
                  status === 'READY' ? tx(lang, 'Hazır', 'Готово', 'Ready') :
                  status === 'PREPARING' ? tx(lang, 'Hazırlanır', 'Готовится', 'Preparing') :
                  status === 'VOID_REQUESTED' ? tx(lang, 'Ləğv gözləyir', 'Ожидает отмены', 'Void pending') :
                  status === 'SERVED' ? tx(lang, 'Servis edilib', 'Подано', 'Served') :
                  status === 'VOIDED' ? tx(lang, 'Ləğv edilib', 'Отменено', 'Voided') :
                  status === 'COMPED' ? tx(lang, 'Hesabdan silinib', 'Списано', 'Comped') :
                  status === 'WASTE' ? tx(lang, 'İsraf', 'Списано', 'Waste') :
                  tx(lang, 'Göndərilib', 'Отправлено', 'Sent');
                const canRequestVoid = ['SENT', 'PREPARING', 'READY'].includes(status);
                return (
                  <div key={`full_${row.id || row.item_name}_${idx}`} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${isTerminal ? 'border-slate-800/60 bg-slate-900/30 opacity-50' : 'border-slate-700/60 bg-slate-900/50'}`}>
                    <span className={`h-3 w-3 shrink-0 rounded-full ${dotColor}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-slate-100">{row.item_name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                        <span>×{row.qty}</span>
                        <span>·</span>
                        <span>{new Decimal(row.price || 0).times(row.qty || 0).toFixed(2)} ₼</span>
                        <span>·</span>
                        <span className="font-semibold">{statusLabel}</span>
                      </div>
                    </div>
                    {canRequestVoid && row.id && (
                      <button
                        type="button"
                        className="shrink-0 rounded-lg border border-rose-300/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-bold text-rose-200 transition active:scale-95"
                        onClick={() => onVoidItem(row)}
                      >
                        {tx(lang, 'Ləğv', 'Отмена', 'Void')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
