import React, { useState } from 'react';
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
  onVoidItem: (item: any, batchItems?: any[]) => void;
  onCancelTable: () => void;
}

export default function FullOrderListModal(props: FullOrderListModalProps) {
  const { lang, tableLabel, items, tableNeedsSafeCancel, isManagerUser, userCanEditTable, onClose, onVoidItem, onCancelTable } = props;
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const statusOrder = ['READY', 'PREPARING', 'SENT', 'NEW', 'VOID_REQUESTED', 'SERVED', 'VOIDED', 'COMPED', 'WASTE'];
  const sorted = [...items].sort((a: any, b: any) => {
    const aIdx = statusOrder.indexOf(String(a.status || 'SENT').toUpperCase());
    const bIdx = statusOrder.indexOf(String(b.status || 'SENT').toUpperCase());
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  const voidableItems = sorted.filter((it: any) => {
    const st = String(it.status || 'SENT').toUpperCase();
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
    onVoidItem(null, selectedObjects);
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4">
      <div className="metal-panel flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black text-slate-100">{tx(lang, 'Göndərilmişlər', 'Отправленные', 'Sent Items')}</div>
            <div className="mt-1 text-sm text-slate-400">{tableLabel} · {items.length} {tx(lang, 'item', 'позиций', 'items')}</div>
          </div>
          <div className="flex items-center gap-2">
            {userCanEditTable && voidableItems.length > 0 && (
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
            <button type="button" onClick={onClose} className="neon-btn rounded-xl px-4 py-2 text-sm font-bold">
              {tx(lang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
        </div>

        {batchMode && voidableItems.length > 0 && (
          <div className="mt-3 flex items-center justify-between bg-amber-950/20 border border-amber-400/20 rounded-xl px-4 py-2">
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
                const isSelected = selectedIds.includes(String(row.id));
                const canSelect = !isTerminal && Boolean(row.id);
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
                  <div
                    key={`full_${row.id || row.item_name}_${idx}`}
                    onClick={() => {
                      if (batchMode && canSelect) toggleSelect(String(row.id));
                    }}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                      isTerminal
                        ? 'border-slate-800/60 bg-slate-900/30 opacity-50'
                        : isSelected
                        ? 'border-amber-400 bg-amber-500/15 ring-1 ring-amber-400/50'
                        : 'border-slate-700/60 bg-slate-900/50 hover:bg-slate-900/70'
                    }`}
                  >
                    {batchMode && canSelect ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(String(row.id))}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 focus:ring-offset-0 shrink-0"
                      />
                    ) : (
                      <span className={`h-3 w-3 shrink-0 rounded-full ${dotColor}`} aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-slate-100">{row.item_name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                        <span className="text-amber-300 font-bold">×{row.qty}</span>
                        <span>·</span>
                        <span>{new Decimal(row.price || 0).times(row.qty || 0).toFixed(2)} ₼</span>
                        <span>·</span>
                        <span className="font-semibold">{statusLabel}</span>
                      </div>
                    </div>
                    {!batchMode && canRequestVoid && row.id && (
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

        {/* Sticky bottom bar when items are selected in batch mode */}
        {batchMode && selectedIds.length > 0 && (
          <div className="mt-3 border-t border-slate-700/80 pt-3 flex items-center justify-between gap-3">
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
