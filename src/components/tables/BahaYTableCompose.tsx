import React, { memo, useState, useEffect } from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import MenuGrid from './MenuGrid';
import { playHapticSuccess, playHapticTouch } from '../../lib/haptics';

type BahaYTableComposeProps = {
  lang: string;
  // Menu
  filteredRoundMenu: any[];
  roundCategories: string[];
  roundSearch: string;
  roundCategory: string;
  onSearchChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onSelectItem: (item: any, quantity?: number) => void | Promise<void>;
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
  summerPromoEnabled?: boolean;
  onUpdateNote?: (id: string, note: string) => void | Promise<void>;
};

const tapFeedback = () => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.(8);
    }
  } catch {
    // ignore
  }
};

const DraftRowItem = memo(({ row, onUpdateQty, onEditNote, lang }: { row: any; onUpdateQty: (id: string, qty: number) => void; onEditNote: (row: any) => void; lang: string }) => {
  const [startX, setStartX] = useState(0);
  const [currentX, setCurrentX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipedLeft, setSwipedLeft] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    setStartX(e.touches[0].clientX);
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return;
    const diffX = e.touches[0].clientX - startX;
    if (swipedLeft) {
      const newX = -70 + diffX;
      setCurrentX(Math.min(0, Math.max(-95, newX)));
    } else {
      setCurrentX(Math.min(0, Math.max(-95, diffX)));
    }
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);
    if (currentX < -32) {
      setCurrentX(-70);
      setSwipedLeft(true);
    } else {
      setCurrentX(0);
      setSwipedLeft(false);
    }
  };

  const handleDelete = () => {
    tapFeedback();
    onUpdateQty(String(row.id), 0);
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-700/50 bg-slate-950/40 min-h-[48px] cart-item-anim">
      {/* Background Swipe Delete Button */}
      <button
        type="button"
        onClick={handleDelete}
        className="absolute right-0 top-0 bottom-0 w-[70px] bg-gradient-to-r from-rose-500 to-rose-700 text-white text-[10px] font-black uppercase tracking-wider flex flex-col items-center justify-center gap-0.5 z-0 taktil-target active:brightness-90"
      >
        <span>✕</span>
        <span>{tx(lang, 'Ləğv', 'Удалить', 'Delete')}</span>
      </button>

      {/* Foreground Swipeable Item */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ transform: `translateX(${currentX}px)` }}
        className={`relative flex items-center justify-between gap-2 bg-slate-900/90 px-2 py-1.5 z-10 w-full h-full min-h-[46px] ${
          isSwiping ? 'transition-none' : 'transition-transform duration-200 ease-out'
        }`}
      >
        <div
          role="button"
          onClick={() => onEditNote(row)}
          className="min-w-0 flex-1 select-none cursor-pointer"
        >
          <div className="truncate text-xs font-semibold text-slate-100">{row.item_name}</div>
          {row.note && (
            <div className="text-[10px] text-yellow-400/95 font-medium truncate mt-0.5">✎ {row.note}</div>
          )}
          <div className="text-[11px] text-slate-400 mt-0.5">{Number(row.price || 0).toFixed(2)} ₼</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-600 text-sm text-slate-200 taktil-target active:scale-90 active:bg-slate-700"
            onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) - 1)}
          >
            −
          </button>
          <div className="min-w-7 text-center text-sm font-bold text-slate-100 select-none">{row.qty}</div>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-600 text-sm text-slate-200 taktil-target active:scale-90 active:bg-slate-700"
            onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) + 1)}
          >
            +
          </button>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-300/40 bg-rose-500/10 text-xs text-rose-200 taktil-target active:scale-90"
            onClick={() => onUpdateQty(String(row.id), 0)}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
});

DraftRowItem.displayName = 'DraftRowItem';

function BahaYTableCompose(props: BahaYTableComposeProps) {
  const {
    lang, filteredRoundMenu, roundCategories, roundSearch, roundCategory,
    onSearchChange, onCategoryChange, onSelectItem, roundDraft,
    draftRows, draftTotal, draftSendError, onClearDrafts, onUpdateQty, onSend,
    tableOccupied, userCanEdit, onSettle, onCancelTable,
    sentItems, onShowFullList, onVoidItem,
    lockHolder, userCanEditTable,
    readyCount, roundsCount, activeTab, onTabChange,
    onBack, summerPromoEnabled, onUpdateNote,
  } = props;

  const [sentPanelOpen, setSentPanelOpen] = useState(false);
  const [editingRowForNote, setEditingRowForNote] = useState<any>(null);
  const [currentNoteText, setCurrentNoteText] = useState('');
  const [mobileActiveTab, setMobileActiveTab] = useState<'menu' | 'cart'>('menu');

  const hasCartContent = draftRows.length > 0 || sentItems.length > 0;

  // Close note editor if the edited item was removed from draft
  useEffect(() => {
    if (editingRowForNote && !draftRows.some((r: any) => String(r.id) === String(editingRowForNote.id))) {
      setEditingRowForNote(null);
    }
  }, [draftRows, editingRowForNote]);

  return (
    <div className={`flex flex-col min-h-0 flex-1 gap-3 overflow-hidden relative ${hasCartContent ? 'md:grid md:grid-cols-[1fr_440px] lg:grid-cols-[1fr_500px]' : ''}`}>
      {/* ─── LEFT: Menu Grid ─── */}
      <div className="flex min-h-0 flex-col overflow-hidden">
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
          summerPromoEnabled={summerPromoEnabled}
        />

        {/* Floating Mobile Cart Bar with Quick Send */}
        {draftRows.length > 0 && mobileActiveTab !== 'cart' && (
          <div className="md:hidden shrink-0 mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setMobileActiveTab('cart')}
              className="flex-1 flex items-center justify-between bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 px-5 py-4 font-black text-sm rounded-2xl active:scale-[0.97] shadow-[0_8px_24px_rgba(250,204,21,0.25)] taktil-target"
            >
              <span className="flex items-center gap-2">
                🛒 {tx(lang, 'Səbət', 'Корзина', 'Cart')}
                <span className="rounded-full bg-slate-900/20 px-2 py-0.5 text-xs font-black">{draftRows.reduce((acc, r) => acc + (r.qty || 0), 0)}</span>
              </span>
              <span className="text-base font-black">{draftTotal} ₼</span>
            </button>
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                playHapticSuccess();
                await onSend();
              }}
              className="shrink-0 flex items-center justify-center gap-1.5 bg-emerald-500 text-white px-5 py-4 font-black text-sm rounded-2xl active:scale-[0.97] shadow-[0_8px_24px_rgba(16,185,129,0.25)] taktil-target"
            >
              🍳 {tx(lang, 'Göndər', 'Отправить', 'Send')}
            </button>
          </div>
        )}
      </div>

      {/* ─── RIGHT: Draft + Actions + Slide-up Sent Panel (iOS-style Bottom Sheet on mobile) ─── */}
      {/* Backdrop overlay for mobile bottom sheet */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs transition-opacity duration-300 ${
          mobileActiveTab === 'cart' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileActiveTab('menu')}
      />

      <div
        className={`fixed bottom-0 left-0 right-0 z-50 h-[85dvh] rounded-t-[30px] border-t border-slate-800 bg-[#070b12] shadow-[0_-20px_50px_rgba(0,0,0,0.65)] transition-transform duration-300 ease-out flex flex-col overflow-hidden md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto md:h-full md:rounded-2xl md:border md:border-slate-700/60 md:bg-slate-950/50 md:shadow-none md:translate-y-0 ${
          mobileActiveTab === 'cart' ? 'translate-y-0' : 'translate-y-full'
        } ${!hasCartContent ? 'md:hidden' : ''}`}
      >
        {/* Mobile drag handle */}
        <div 
          className="md:hidden shrink-0 w-full py-3 flex justify-center cursor-pointer bg-slate-900/50 active:bg-slate-800/60 transition"
          onClick={() => setMobileActiveTab('menu')}
        >
          <div className="h-1.5 w-14 rounded-full bg-slate-600/80" />
        </div>

        {/* Mobile Cart Header */}
        <div className="md:hidden shrink-0 flex items-center justify-between border-b border-slate-800/80 px-5 py-3.5 bg-slate-900/70">
          <div>
            <span className="text-sm font-black text-white">{tx(lang, 'Sifariş', 'Заказ', 'Order')}</span>
            <span className="ml-2 text-sm font-black text-yellow-400">{draftTotal} ₼</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileActiveTab('menu')}
            className="rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-bold text-slate-200 active:scale-95 taktil-target"
          >
            ← {tx(lang, 'Menyu', 'Меню', 'Menu')}
          </button>
        </div>

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
                <DraftRowItem
                  key={row.id}
                  row={row}
                  onUpdateQty={onUpdateQty}
                  onEditNote={(r) => {
                    setEditingRowForNote(r);
                    setCurrentNoteText(r.note || '');
                  }}
                  lang={lang}
                />
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
                className="relative w-full min-h-14 inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-yellow-400 to-amber-500 px-4 py-4 text-[15px] font-black text-slate-900 shadow-[0_8px_24px_rgba(250,204,21,0.3)] transition active:scale-[0.97] disabled:opacity-50 taktil-target overflow-hidden"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, transparent 100%)' }} />
                🚀 {tx(lang, 'Mətbəxə Göndər', 'Отправить в кухню', 'Send to Kitchen')}
              </button>
            </div>
          )}

          {/* Secondary Actions: Back & Settle/Bill */}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => setMobileActiveTab('menu')}
              className="md:hidden inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-slate-600/60 bg-slate-800/70 px-3 py-3 text-xs font-bold text-slate-200 transition active:scale-[0.97] taktil-target"
            >
              🍳 {tx(lang, 'Menyuya qayıt', 'В меню', 'Back to Menu')}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-slate-600/60 bg-slate-800/70 px-3 py-3 text-xs font-bold text-slate-200 transition active:scale-[0.97] taktil-target"
            >
              ← {tx(lang, 'Masalar', 'Столы', 'Tables')}
            </button>
            {tableOccupied && (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={onSettle}
                className="relative inline-flex min-h-12 flex-[1.3] items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-b from-emerald-400 to-emerald-600 px-3 py-3 text-xs font-black text-white shadow-[0_6px_20px_rgba(16,185,129,0.25)] transition active:scale-[0.97] disabled:opacity-50 taktil-target overflow-hidden"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 100%)' }} />
                💵 {tx(lang, 'Hesab', 'Счет', 'Settle')}
              </button>
            )}
          </div>

          {/* Cancel/Void table check — intentionally small and separated to prevent accidental taps */}
          {tableOccupied && (
            <div className="mt-4 flex justify-center border-t border-slate-800/50 pt-3">
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={onCancelTable}
                className="text-[10px] font-semibold text-rose-400/70 transition active:text-rose-300 disabled:opacity-30 taktil-target"
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
                          className="shrink-0 rounded-xl border border-rose-300/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-bold text-rose-200 transition active:scale-90 taktil-target"
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

        {/* ─── Slide-up Note Modifier Editor (Seçim 1) ─── */}
        {editingRowForNote && (
          <div className="absolute inset-0 z-20 flex flex-col rounded-2xl bg-slate-950/95 p-4 border border-slate-700/60 backdrop-blur-md transition-all duration-200">
            <div className="flex items-center justify-between border-b border-slate-850 pb-2.5">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-450">{tx(lang, 'Qeyd Əlavə Et', 'Добавить примечание', 'Add Comment')}</h4>
                <div className="text-sm font-black text-slate-100 mt-0.5 truncate max-w-[200px]">{editingRowForNote.item_name}</div>
              </div>
              <button
                type="button"
                onClick={() => setEditingRowForNote(null)}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-xs text-slate-350 hover:bg-slate-700 taktil-target"
              >
                ✕
              </button>
            </div>

            {/* Note text field */}
            <div className="mt-3 flex-1 min-h-0 overflow-y-auto space-y-3 pr-0.5 scrollbar-none">
              <input
                type="text"
                value={currentNoteText}
                onChange={(e) => setCurrentNoteText(e.target.value)}
                placeholder={tx(lang, 'Sifariş qeydi daxil edin...', 'Введите примечание...', 'Type order note...')}
                className="neon-input h-10 w-full text-xs font-semibold focus:ring-yellow-300/20"
                autoFocus
              />

              {/* Quick Modifier Grid */}
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">{tx(lang, 'Sürətli Seçimlər', 'Быстрый выбор', 'Quick Modifiers')}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {['Şəkərsiz', 'Az şirin', 'Buzlu', 'Badam südü', 'Sert', 'Soya südü', 'Ekstra İsti', 'Paket'].map((mod) => {
                    const selectedMods = currentNoteText.split(',').map(s => s.trim()).filter(Boolean);
                    const isSelected = selectedMods.includes(mod);
                    return (
                      <button
                        key={mod}
                        type="button"
                        onClick={() => {
                          tapFeedback();
                          let nextText = '';
                          if (isSelected) {
                            nextText = selectedMods.filter(s => s !== mod).join(', ');
                          } else {
                            nextText = [...selectedMods, mod].join(', ');
                          }
                          setCurrentNoteText(nextText);
                        }}
                        className={`rounded-lg border py-2 px-1 text-center text-xs font-black transition taktil-target ${
                          isSelected
                            ? 'border-yellow-450 bg-yellow-400/10 text-yellow-300'
                            : 'border-slate-800 bg-slate-900/60 text-slate-350 hover:border-slate-700/60'
                        }`}
                      >
                        {mod}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="mt-3 border-t border-slate-800 pt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setEditingRowForNote(null)}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-800/80 py-2.5 text-xs font-bold text-slate-300 taktil-target"
              >
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (onUpdateNote && editingRowForNote) {
                    // Guard: verify the item still exists in draftRows before saving
                    const stillExists = draftRows.some((r: any) => String(r.id) === String(editingRowForNote.id));
                    if (stillExists) {
                      await onUpdateNote(editingRowForNote.id, currentNoteText);
                    }
                  }
                  setEditingRowForNote(null);
                }}
                className="flex-1 rounded-xl bg-gradient-to-b from-yellow-400 to-amber-500 py-2.5 text-xs font-black text-slate-950 shadow-md shadow-yellow-500/10 taktil-target"
              >
                {tx(lang, 'Yadda Saxla', 'Сохранить', 'Save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(BahaYTableCompose);
