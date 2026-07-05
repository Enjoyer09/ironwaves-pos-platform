import React from 'react';
import { tx } from '../../i18n';
import { normalizeOrderItemStatus, sentItemActions as getSentItemActions, itemActionLabel } from '../../utils/tables/tableUtils';

interface SentItemsSlideUpProps {
  lang: string;
  items: any[];
  userCanEdit: boolean;
  onClose: () => void;
  onAction: (item: any, action: string) => void;
}

export default function SentItemsSlideUp({ lang, items, userCanEdit, onClose, onAction }: SentItemsSlideUpProps) {
  const labels = {
    decrease: tx(lang, 'Azalt', 'Уменьшить', 'Reduce'),
    void_: tx(lang, 'Ləğv et', 'Отменить', 'Cancel'),
    comp: tx(lang, 'Hesabdan sil', 'Списать из счета', 'Comp'),
    waste: tx(lang, 'İsraf', 'Списание', 'Waste'),
    remake: tx(lang, 'Yenidən düzəlt', 'Переделать', 'Correct'),
  };

  const statusOrder = ['READY', 'PREPARING', 'SENT', 'NEW', 'VOID_REQUESTED', 'SERVED', 'VOIDED', 'COMPED', 'WASTE'];
  const sorted = [...items].sort((a: any, b: any) => {
    const aIdx = statusOrder.indexOf(normalizeOrderItemStatus(a.status || 'SENT'));
    const bIdx = statusOrder.indexOf(normalizeOrderItemStatus(b.status || 'SENT'));
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  return (
    <div className="fixed inset-0 z-[140] flex items-end bg-black/50 transition-opacity duration-300" onClick={onClose}>
      <div
        className="flex w-full flex-col overflow-hidden rounded-t-2xl border-t border-slate-700/60 bg-slate-950 shadow-2xl animate-[slideUp_300ms_ease-out]"
        style={{ height: 'calc(100vh - 60px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700/60 px-5 py-4">
          <div>
            <div className="text-base font-bold text-slate-100">{tx(lang, 'Göndərilmişlər', 'Отправленные', 'Sent Items')}</div>
            <div className="text-xs text-slate-400">{items.length} {tx(lang, 'item', 'позиций', 'items')}</div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-600/60 bg-slate-800/60 text-lg font-bold text-slate-300 transition hover:bg-slate-700/60">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4">
          <div className="space-y-2">
            {sorted.map((it: any, idx: number) => {
              const status = normalizeOrderItemStatus(it.status || it.raw_status);
              const isTerminal = ['VOIDED', 'COMPED', 'WASTE'].includes(status);
              const actions = it.id && userCanEdit ? getSentItemActions({ ...it, status }) : [];
              const dotColor =
                status === 'READY' ? 'bg-emerald-400' :
                status === 'PREPARING' ? 'bg-orange-400' :
                status === 'VOID_REQUESTED' ? 'bg-yellow-400 animate-pulse' :
                status === 'SERVED' ? 'bg-violet-400' :
                isTerminal ? 'bg-slate-600' : 'bg-blue-400';
              const statusLabel =
                status === 'READY' ? tx(lang, 'Hazır', 'Готово', 'Ready') :
                status === 'PREPARING' ? tx(lang, 'Hazırlanır', 'Готовится', 'Preparing') :
                status === 'VOID_REQUESTED' ? tx(lang, 'Ləğv gözləyir', 'Ожидает', 'Pending') :
                status === 'SERVED' ? tx(lang, 'Servis', 'Подано', 'Served') :
                status === 'VOIDED' ? tx(lang, 'Ləğv edilib', 'Отменено', 'Voided') :
                tx(lang, 'Göndərilib', 'Отправлено', 'Sent');
              return (
                <div key={`slide_${it.id || it.item_name}_${idx}`} className={`rounded-xl border px-4 py-3 ${isTerminal ? 'border-slate-800/50 opacity-40' : 'border-slate-700/50 bg-slate-900/40'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${dotColor}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-slate-100">{it.item_name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                        <span>×{it.qty}</span><span>·</span><span className="font-medium">{statusLabel}</span>
                        {it.round_no ? <><span>·</span><span className="text-violet-300">R{it.round_no}</span></> : null}
                      </div>
                    </div>
                  </div>
                  {actions.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2 pl-6">
                      {actions.map((action) => (
                        <button
                          key={`${it.id}_${action}`}
                          type="button"
                          className={`rounded-lg border px-3 py-2 text-xs font-bold transition active:scale-95 ${
                            action === 'DECREASE' ? 'border-amber-300/40 bg-amber-500/10 text-amber-100' :
                            action === 'VOID' ? 'border-yellow-300/40 bg-yellow-500/10 text-yellow-100' :
                            action === 'COMP' ? 'border-sky-300/40 bg-sky-500/10 text-sky-100' :
                            action === 'WASTE' ? 'border-slate-300/30 bg-slate-500/15 text-slate-100' :
                            'border-orange-300/40 bg-orange-500/10 text-orange-100'
                          }`}
                          onClick={() => onAction({ ...it, status }, action)}
                        >
                          {itemActionLabel(action, labels)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
