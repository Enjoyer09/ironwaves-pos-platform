import React, { useState } from 'react';
import { tx } from '../../i18n';
import { normalizeOrderItemStatus, sentItemActions as getSentItemActions, itemActionLabel, ORDER_STATUS_THEME, ORDER_STATUS_THEME_DEFAULT } from '../../utils/tables/tableUtils';

interface SentItemsSlideUpProps {
  lang: string;
  items: any[];
  userCanEdit: boolean;
  onClose: () => void;
  onAction: (item: any, action: string, batchItems?: any[]) => void;
}

export default function SentItemsSlideUp({ lang, items, userCanEdit, onClose, onAction }: SentItemsSlideUpProps) {
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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

  const voidableItems = sorted.filter((it: any) => {
    const st = normalizeOrderItemStatus(it.status || it.raw_status);
    return !['VOIDED', 'COMPED', 'WASTE'].includes(st) && Boolean(it.id);
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAll = () => {
    if (selectedIds.length === voidableItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(voidableItems.map((it: any) => String(it.id)));
    }
  };

  const handleConfirmBatchVoid = () => {
    const selectedObjects = voidableItems.filter((it: any) => selectedIds.includes(String(it.id)));
    if (selectedObjects.length === 0) return;
    onAction(null, 'VOID', selectedObjects);
  };

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
          <div className="flex items-center gap-2">
            {userCanEdit && voidableItems.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setBatchMode(!batchMode);
                  if (!batchMode) setSelectedIds([]);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition border active:scale-95 ${
                  batchMode
                    ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                    : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:text-white'
                }`}
              >
                {batchMode ? tx(lang, 'Fərdi seçim', 'Поштучно', 'Single Select') : tx(lang, '☑️ Toplu Ləğv', '☑️ Групповая отмена', '☑️ Batch Void')}
              </button>
            )}
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-600/60 bg-slate-800/60 text-lg font-bold text-slate-300 transition hover:bg-slate-700/60">✕</button>
          </div>
        </div>

        {batchMode && voidableItems.length > 0 && (
          <div className="flex items-center justify-between bg-amber-950/20 border-b border-amber-400/20 px-5 py-2">
            <span className="text-xs font-semibold text-amber-200">
              {tx(lang, 'Ləğv ediləcək məhsulları seçin:', 'Выберите позиции для отмены:', 'Select items to void:')}
            </span>
            <button
              type="button"
              onClick={selectAll}
              className="text-xs font-bold text-amber-300 underline"
            >
              {selectedIds.length === voidableItems.length
                ? tx(lang, 'Seçimi təmizlə', 'Снять выделение', 'Clear selection')
                : tx(lang, 'Hamısını seç', 'Выбрать все', 'Select all')}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4">
          <div className="space-y-2">
            {sorted.map((it: any, idx: number) => {
              const status = normalizeOrderItemStatus(it.status || it.raw_status);
              const isTerminal = ['VOIDED', 'COMPED', 'WASTE'].includes(status);
              const isSelected = selectedIds.includes(String(it.id));
              const canSelect = !isTerminal && Boolean(it.id);
              const actions = it.id && userCanEdit ? getSentItemActions({ ...it, status }) : [];
              const dotColor =
                status === 'VOID_REQUESTED' ? `${ORDER_STATUS_THEME.VOID_REQUESTED.dot} animate-pulse` :
                (ORDER_STATUS_THEME[status]?.dot || ORDER_STATUS_THEME_DEFAULT.dot);
              const statusLabel =
                status === 'READY' ? tx(lang, 'Hazır', 'Готово', 'Ready') :
                status === 'PREPARING' ? tx(lang, 'Hazırlanır', 'Готовится', 'Preparing') :
                status === 'VOID_REQUESTED' ? tx(lang, 'Ləğv gözləyir', 'Ожидает', 'Pending') :
                status === 'SERVED' ? tx(lang, 'Servis', 'Подано', 'Served') :
                status === 'VOIDED' ? tx(lang, 'Ləğv edilib', 'Отменено', 'Voided') :
                tx(lang, 'Göndərilib', 'Отправлено', 'Sent');

              return (
                <div
                  key={`slide_${it.id || it.item_name}_${idx}`}
                  onClick={() => {
                    if (batchMode && canSelect) toggleSelect(String(it.id));
                  }}
                  className={`rounded-xl border px-4 py-3 transition ${
                    isTerminal
                      ? 'border-slate-800/50 opacity-40'
                      : isSelected
                      ? 'border-amber-400 bg-amber-500/15 ring-1 ring-amber-400/50'
                      : 'border-slate-700/50 bg-slate-900/40 hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {batchMode && canSelect ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(String(it.id))}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 focus:ring-offset-0 shrink-0"
                      />
                    ) : (
                      <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${dotColor}`} aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-slate-100">{it.item_name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                        <span className="text-amber-300 font-bold">×{it.qty}</span>
                        <span>·</span>
                        <span className="font-medium">{statusLabel}</span>
                        {it.round_no ? <><span>·</span><span className="text-violet-300">R{it.round_no}</span></> : null}
                      </div>
                    </div>
                  </div>
                  {!batchMode && actions.length > 0 && (
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

        {/* Sticky bottom bar when items are selected in batch mode */}
        {batchMode && selectedIds.length > 0 && (
          <div className="border-t border-slate-700/80 bg-slate-900/95 p-4 flex items-center justify-between gap-3 shadow-xl">
            <div className="text-sm font-bold text-slate-200">
              {tx(lang, 'Seçildi:', 'Выбрано:', 'Selected:')}{' '}
              <span className="text-amber-300 font-extrabold">{selectedIds.length} {tx(lang, 'məhsul', 'поз.', 'items')}</span>
            </div>
            <button
              type="button"
              onClick={handleConfirmBatchVoid}
              className="flex items-center gap-2 rounded-xl border border-rose-400 bg-rose-600 hover:bg-rose-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg transition active:scale-95"
            >
              <span>❌</span>
              <span>{tx(lang, 'Seçilənləri Ləğv Et (Tək Çek)', 'Отменить выбранные (Единый чек)', 'Void Selected (1 Ticket)')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
