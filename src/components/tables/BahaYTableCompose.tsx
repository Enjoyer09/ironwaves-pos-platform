import React, { memo } from 'react';
import { tx } from '../../i18n';
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
    sentItems, onShowFullList,
    lockHolder, userCanEditTable,
    readyCount, roundsCount, activeTab, onTabChange,
    onBack,
  } = props;

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

      {/* ─── RIGHT: Draft + Actions only ─── */}
      <div className="flex min-h-0 w-[300px] shrink-0 flex-col overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950/40 p-3">
        {/* Draft error */}
        {draftSendError && (
          <div className="mb-2 rounded-lg border border-rose-300/35 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-100">{draftSendError}</div>
        )}

        {/* Draft items list */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          {draftRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700/60 px-3 py-4 text-center text-xs text-slate-500">
              {tx(lang, 'Məhsul seç →', 'Выберите товар →', 'Select item →')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {draftRows.map((row: any) => (
                <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/50 bg-slate-900/40 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-slate-100">{row.item_name}</div>
                    <div className="text-[11px] text-slate-400">{Number(row.price || 0).toFixed(2)} ₼</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="flex h-6 w-6 items-center justify-center rounded border border-slate-600 text-xs text-slate-200" onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) - 1)}>−</button>
                    <div className="min-w-5 text-center text-xs font-bold text-slate-100">{row.qty}</div>
                    <button type="button" className="flex h-6 w-6 items-center justify-center rounded border border-slate-600 text-xs text-slate-200" onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) + 1)}>+</button>
                    <button type="button" className="flex h-6 w-6 items-center justify-center rounded border border-rose-300/40 bg-rose-500/10 text-[10px] text-rose-200" onClick={() => onUpdateQty(String(row.id), 0)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sent items (compact) */}
        {sentItems.length > 0 && (
          <div className="mt-3 border-t border-slate-700/50 pt-2">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tx(lang, 'Göndərilmişlər', 'Отправленные', 'Sent')}</div>
              <button type="button" onClick={onShowFullList} className="text-[11px] text-cyan-300">{tx(lang, 'Tam', 'Все', 'All')}</button>
            </div>
            <div className="max-h-[80px] overflow-y-auto text-[11px] text-slate-400">
              {sentItems.slice(0, 5).map((it: any, idx: number) => (
                <div key={idx} className="truncate">{it.item_name} ×{it.qty}</div>
              ))}
              {sentItems.length > 5 && <div>+{sentItems.length - 5} {tx(lang, 'daha', 'ещё', 'more')}...</div>}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-3 space-y-2 border-t border-slate-700/50 pt-3">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>{tx(lang, 'Cəmi', 'Итого', 'Total')}</span>
            <span className="text-sm font-black text-slate-100">{draftTotal} ₼</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={draftRows.length === 0 || !userCanEdit}
              onClick={() => { void onSend(); }}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-yellow-400 to-amber-500 px-3 py-2 text-sm font-black text-slate-900 shadow-lg shadow-yellow-500/25 transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {tx(lang, 'Göndər', 'Отправить', 'Send')}
            </button>
            {tableOccupied && (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={onSettle}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-gradient-to-b from-emerald-400 to-emerald-600 px-3 py-2 text-sm font-black text-white shadow-lg shadow-emerald-500/25 transition active:scale-[0.97] disabled:opacity-50 disabled:shadow-none"
              >
                {tx(lang, 'Hesab', 'Счёт', 'Bill')}
              </button>
            )}
          </div>
          {/* Cancel table + Back */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl border border-slate-600/80 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow transition hover:bg-slate-700/80 active:scale-[0.97]"
            >
              ← {tx(lang, 'Geri', 'Назад', 'Back')}
            </button>
            {tableOccupied && (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={onCancelTable}
                className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl border border-rose-400/40 bg-gradient-to-b from-rose-500/20 to-rose-600/20 px-3 py-1.5 text-xs font-semibold text-rose-200 shadow transition hover:from-rose-500/30 hover:to-rose-600/30 active:scale-[0.97] disabled:opacity-50"
              >
                {tx(lang, 'Ləğv et', 'Отменить', 'Cancel')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(BahaYTableCompose);
