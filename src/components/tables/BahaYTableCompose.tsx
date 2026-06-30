import React, { memo, useState } from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import MenuGrid from './MenuGrid';

type BahaYTableComposeProps = {
  lang: string;
  // Menu
  filteredRoundMenu: any[];
  roundCategories: string[];
  roundSearch: string;
  roundCategory: string;
  onSearchChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onSelectItem: (item: any) => void | Promise<void>;
  roundDraft: any[];
  // Draft
  draftRows: any[];
  draftTotal: string;
  draftSendError: string | null;
  onClearDrafts: () => void | Promise<void>;
  onUpdateQty: (id: string, qty: number) => void;
  onSend: () => void | Promise<void>;
  // Settle
  tableOccupied: boolean;
  userCanEdit: boolean;
  onSettle: () => void;
  onCancelTable: () => void;
  // Sent items
  sentItems: any[];
  onShowFullList: () => void;
  onVoidItem?: (item: any) => void;
  // Lock
  lockHolder: string;
  userCanEditTable: boolean;
  // Tabs
  readyCount: number;
  roundsCount: number;
  activeTab: string;
  onTabChange: (tab: string) => void;
  // Back
  onBack: () => void;
};

function BahaYTableCompose(props: BahaYTableComposeProps) {
  const {
    lang, filteredRoundMenu, roundCategories, roundSearch, roundCategory,
    onSearchChange, onCategoryChange, onSelectItem, roundDraft,
    draftRows, draftTotal, draftSendError, onClearDrafts, onUpdateQty, onSend,
    tableOccupied, userCanEdit, onSettle, onCancelTable,
    sentItems, onShowFullList, onVoidItem,
    lockHolder, userCanEditTable,
    readyCount, roundsCount, activeTab, onTabChange,
    onBack,
  } = props;

  const [sentPanelOpen, setSentPanelOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
      {/* ─── LEFT: Menu Grid ─── */}
      <div className="flex min-h-0 flex-[1.6] flex-col overflow-hidden">
        <MenuGrid
          items={filteredRoundMenu}
          categories={roundCategories}
          search={roundSearch}
          selectedCategory={roundCategory}
          lang={lang}
          onSearchChange={onSearchChange}
          onCategoryChange={onCategoryChange}
          onSelectItem={onSelectItem}
          draftItems={roundDraft}
          modernMode={true}
        />
      </div>

      {/* ─── RIGHT: Draft + Actions + Slide-up Sent Panel ─── */}
      <div className="relative flex h-full min-h-0 w-[300px] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-950/40">

        {/* Scrollable draft items area */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 pb-1">
          {/* Draft error */}
          {draftSendError && (
            <div className="mb-2 rounded-lg border border-rose-300/35 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-100">{draftSendError}</div>
          )}

          {/* Draft items list */}
          {draftRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700/60 px-3 py-4 text-center text-xs text-slate-500">
              {tx(lang, 'Məhsul seç →', 'Выберите товар →', 'Select item →')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {draftRows.map((row: any) => (
                <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/50 bg-slate-900/40 px-2 py-1.5 cart-item-anim">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-slate-100">{row.item_name}</div>
                    <div className="text-[11px] text-slate-400">{Number(row.price || 0).toFixed(2)} ₼</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="flex h-6 w-6 items-center justify-center rounded border border-slate-600 text-xs text-slate-200 taktil-target" onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) - 1)}>−</button>
                    <div className="min-w-5 text-center text-xs font-bold text-slate-100">{row.qty}</div>
                    <button type="button" className="flex h-6 w-6 items-center justify-center rounded border border-slate-600 text-xs text-slate-200 taktil-target" onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) + 1)}>+</button>
                    <button type="button" className="flex h-6 w-6 items-center justify-center rounded border border-rose-300/40 bg-rose-500/10 text-[10px] text-rose-200 taktil-target" onClick={() => onUpdateQty(String(row.id), 0)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fixed bottom: sent button + actions (never scrolls away) */}
        <div className="shrink-0 border-t border-slate-700/50 p-3 pt-2">
          {/* Sent items toggle button */}
          {sentItems.length > 0 && (
            <button
              type="button"
              onClick={() => setSentPanelOpen(true)}
              className="mb-2 flex w-full items-center justify-between rounded-xl border border-slate-600/50 bg-slate-800/50 px-3 py-2 text-left transition hover:bg-slate-700/50 active:scale-[0.98]"
            >
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1">
                  {sentItems.some((it: any) => String(it.status || '').toUpperCase() === 'READY') && <span className="h-2.5 w-2.5 rounded-full border border-slate-900 bg-emerald-400" />}
                  {sentItems.some((it: any) => String(it.status || '').toUpperCase() === 'PREPARING') && <span className="h-2.5 w-2.5 rounded-full border border-slate-900 bg-orange-400" />}
                  {sentItems.some((it: any) => ['SENT', 'NEW'].includes(String(it.status || '').toUpperCase())) && <span className="h-2.5 w-2.5 rounded-full border border-slate-900 bg-blue-400" />}
                  {sentItems.some((it: any) => String(it.status || '').toUpperCase() === 'VOID_REQUESTED') && <span className="h-2.5 w-2.5 rounded-full border border-slate-900 bg-yellow-400" />}
                </div>
                <span className="text-xs font-bold text-slate-200">{tx(lang, 'Göndərilmişlər', 'Отправленные', 'Sent')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-slate-700/80 px-2 py-0.5 text-xs font-bold text-slate-200">{sentItems.length}</span>
                <span className="text-slate-400">↑</span>
              </div>
            </button>
          )}

          {/* Total + action buttons */}
          <div className="flex items-center justify-between text-xs text-slate-300 px-0.5">
            <span>{tx(lang, 'Cəmi', 'Итого', 'Total')}</span>
            <span className="text-sm font-black text-slate-100">{draftTotal} ₼</span>
          </div>

          {/* Primary Action: Send to Kitchen (appears when draft is not empty) */}
          {draftRows.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={() => { void onSend(); }}
                className="w-full min-h-12 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-yellow-400 to-amber-500 px-3 py-2.5 text-sm font-black text-slate-900 shadow-lg shadow-yellow-500/25 transition taktil-target"
              >
                🚀 {tx(lang, 'Mətbəxə Göndər', 'Отправить в кухню', 'Send to Kitchen')}
              </button>
            </div>
          )}

          {/* Secondary Actions: Back & Settle/Bill */}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl border border-slate-600/70 bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-700/80 taktil-target"
            >
              ← {tx(lang, 'Geri', 'Назад', 'Back')}
            </button>
            {tableOccupied && (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={onSettle}
                className="inline-flex min-h-10 flex-[1.2] items-center justify-center gap-1 rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-600 px-3 py-2 text-xs font-black text-white shadow-lg shadow-emerald-500/20 transition disabled:opacity-50 disabled:shadow-none taktil-target"
              >
                💵 {tx(lang, 'Hesab / Ödəniş', 'Счёт / Оплата', 'Bill / Settle')}
              </button>
            )}
          </div>

          {/* Cancel/Void table check (reorganized to avoid accidental clicks) */}
          {tableOccupied && (
            <div className="mt-2.5 flex justify-center">
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={onCancelTable}
                className="text-[10px] font-bold text-rose-400/85 hover:text-rose-300 transition duration-150 flex items-center gap-1 disabled:opacity-40 taktil-target"
              >
                ⚠️ {tx(lang, 'Masayı boşalt (satışsız)', 'Отменить стол', 'Cancel check')}
              </button>
            </div>
          )}
        </div>

        {/* ─── Slide-up Sent Items Panel ─── */}
        <div
          className={`absolute bottom-0 left-0 right-0 top-0 z-10 flex flex-col rounded-2xl bg-slate-950 transition-transform duration-300 ease-out ${
            sentPanelOpen ? 'translate-y-0' : 'translate-y-full pointer-events-none'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
            <div>
              <div className="text-sm font-bold text-slate-100">{tx(lang, 'Göndərilmişlər', 'Отправленные', 'Sent Items')}</div>
              <div className="text-[11px] text-slate-400">{sentItems.length} {tx(lang, 'item', 'позиций', 'items')}</div>
            </div>
            <button
              type="button"
              onClick={() => setSentPanelOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-600/60 bg-slate-800/60 text-sm font-bold text-slate-300 transition hover:bg-slate-700/60"
            >
              ↓
            </button>
          </div>

          {/* Items list */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3">
            <div className="space-y-1.5">
              {(() => {
                const statusOrder = ['READY', 'PREPARING', 'SENT', 'NEW', 'VOID_REQUESTED', 'SERVED', 'VOIDED', 'COMPED', 'WASTE'];
                const sorted = [...sentItems].sort((a: any, b: any) => {
                  const aIdx = statusOrder.indexOf(String(a.status || 'SENT').toUpperCase());
                  const bIdx = statusOrder.indexOf(String(b.status || 'SENT').toUpperCase());
                  return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
                });
                return sorted.map((it: any, idx: number) => {
                  const status = String(it.status || 'SENT').toUpperCase();
                  const isTerminal = ['VOIDED', 'COMPED', 'WASTE'].includes(status);
                  const dotColor =
                    status === 'READY' ? 'bg-emerald-400' :
                    status === 'PREPARING' ? 'bg-orange-400' :
                    status === 'VOID_REQUESTED' ? 'bg-yellow-400 animate-pulse' :
                    status === 'SERVED' ? 'bg-violet-400' :
                    isTerminal ? 'bg-slate-600' :
                    'bg-blue-400';
                  const statusLabel =
                    status === 'READY' ? tx(lang, 'Hazır', 'Готово', 'Ready') :
                    status === 'PREPARING' ? tx(lang, 'Hazırlanır', 'Готовится', 'Preparing') :
                    status === 'VOID_REQUESTED' ? tx(lang, 'Ləğv gözləyir', 'Ожидает', 'Pending') :
                    status === 'SERVED' ? tx(lang, 'Servis', 'Подано', 'Served') :
                    status === 'VOIDED' ? tx(lang, 'Ləğv', 'Отменено', 'Voided') :
                    status === 'COMPED' ? tx(lang, 'Silinib', 'Списано', 'Comped') :
                    status === 'WASTE' ? tx(lang, 'İsraf', 'Списано', 'Waste') :
                    tx(lang, 'Göndərilib', 'Отправлено', 'Sent');
                  const canVoid = ['SENT', 'PREPARING', 'READY'].includes(status) && it.id;
                  const price = new Decimal(it.price || 0).times(it.qty || 0).toFixed(2);
                  return (
                    <div
                      key={`sent_${it.id || idx}`}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                        isTerminal ? 'border-slate-800/50 bg-slate-900/20 opacity-40' : 'border-slate-700/50 bg-slate-900/40'
                      }`}
                    >
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColor}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-slate-100">{it.item_name}</div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                          <span>×{it.qty}</span>
                          <span>·</span>
                          <span>{price} ₼</span>
                          <span>·</span>
                          <span className="font-medium">{statusLabel}</span>
                        </div>
                      </div>
                      {canVoid && onVoidItem && (
                        <button
                          type="button"
                          onClick={() => onVoidItem(it)}
                          className="shrink-0 rounded-lg border border-rose-300/30 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-200 transition active:scale-95"
                        >
                          {tx(lang, 'Ləğv', 'Отмена', 'Void')}
                        </button>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Footer - close */}
          <div className="border-t border-slate-700/60 px-4 py-2.5">
            <button
              type="button"
              onClick={() => setSentPanelOpen(false)}
              className="w-full rounded-xl border border-slate-600/60 bg-slate-800/60 px-3 py-2.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700/60 active:scale-[0.98]"
            >
              ↓ {tx(lang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(BahaYTableCompose);
