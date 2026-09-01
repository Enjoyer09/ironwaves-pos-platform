import React, { memo, useState, useEffect, useMemo } from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import MenuGrid from './MenuGrid';
import { playHapticSuccess, playHapticTouch } from '../../lib/haptics';
import OrderNoteModal from './OrderNoteModal';

type BahaYTableComposeProps = {
  lang: string;
  tenantId?: string;
  settingsPresets?: string[];
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
  onUpdateCourse?: (id: string, courseNo: number) => void | Promise<void>;
  tableLabel?: string;
  guestCount?: number;
  waiterName?: string;
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

const DraftRowItem = memo(({
  row,
  onUpdateQty,
  onEditNote,
  onUpdateCourse,
  lang,
}: {
  row: any;
  onUpdateQty: (id: string, qty: number) => void;
  onEditNote: (row: any) => void;
  onUpdateCourse?: (id: string, courseNo: number) => void;
  lang: string;
}) => {
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
      const newX = -88 + diffX;
      setCurrentX(Math.min(0, Math.max(-110, newX)));
    } else {
      setCurrentX(Math.min(0, Math.max(-110, diffX)));
    }
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);
    if (currentX < -40) {
      setCurrentX(-88);
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

  const itemTotal = new Decimal(row.price || 0).times(row.qty || 1).toFixed(2);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/90 shadow-sm cart-item-anim group hover:border-slate-600 transition-all">
      {/* Background Swipe Delete Button */}
      <button
        type="button"
        aria-label={tx(lang, 'Ləğv et', 'Удалить', 'Delete')}
        onClick={handleDelete}
        className="absolute right-0 top-0 bottom-0 w-[88px] bg-gradient-to-r from-rose-500 to-rose-700 text-white text-xs font-semibold uppercase tracking-wider flex flex-col items-center justify-center gap-0.5 z-0 taktil-target active:brightness-90"
      >
        <span className="text-sm">✕</span>
        <span>{tx(lang, 'Ləğv', 'Удалить', 'Delete')}</span>
      </button>

      {/* Foreground Item Card */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ transform: `translateX(${currentX}px)` }}
        className={`relative flex items-center justify-between gap-3 bg-slate-900/95 px-3.5 py-2.5 z-10 w-full h-full min-h-[56px] ${
          isSwiping ? 'transition-none' : 'transition-transform duration-200 ease-out'
        }`}
      >
        {/* Left item details */}
        <div
          role="button"
          onClick={() => onEditNote(row)}
          className="min-w-0 flex-1 select-none cursor-pointer"
        >
          <div className="truncate text-sm font-bold text-slate-100 flex items-center gap-1.5">
            <span className="truncate">{row.item_name}</span>
            {Number(row.qty || 1) > 1 && (
              <span className="text-[11px] font-semibold text-slate-400">×{row.qty}</span>
            )}
          </div>
          {row.note ? (
            <div className="text-[11px] text-amber-300 font-semibold truncate mt-0.5 flex items-center gap-1">
              <span>✎</span>
              <span className="truncate">{row.note}</span>
            </div>
          ) : (
            <div className="text-[10px] text-slate-500 font-medium hover:text-slate-400 mt-0.5 flex items-center gap-1">
              <span>+</span>
              <span>{tx(lang, 'Qeyd əlavə et', 'Добавить примечание', 'Add note')}</span>
            </div>
          )}
          <div className="text-xs font-bold text-amber-400/90 mt-0.5 flex items-center gap-2">
            <span>{itemTotal} ₼</span>
            {Number(row.qty || 1) > 1 && (
              <span className="text-[10px] font-normal text-slate-400">({Number(row.price || 0).toFixed(2)} ₼/ədəd)</span>
            )}
          </div>
        </div>

        {/* Right action controls */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Course indicator/toggle (Course 1, 2, 3) */}
          {onUpdateCourse && (
            <button
              type="button"
              title={
                Number(row.course_no || 1) === 1
                  ? tx(lang, '1-ci Mərhələ (İştahaçan/Salat) — Dəyişmək üçün klikləyin', '1-я Подача (Закуски)', 'Course 1 (Starters)')
                  : Number(row.course_no || 1) === 2
                  ? tx(lang, '2-ci Mərhələ (İsti Yemək) — Dəyişmək üçün klikləyin', '2-я Подача (Основное)', 'Course 2 (Mains)')
                  : tx(lang, '3-cü Mərhələ (Desert/Çay) — Dəyişmək üçün klikləyin', '3-я Подача (Десерты)', 'Course 3 (Desserts)')
              }
              onClick={() => {
                tapFeedback();
                const current = Number(row.course_no || 1);
                const next = current === 1 ? 2 : current === 2 ? 3 : 1;
                onUpdateCourse(String(row.id), next);
              }}
              className={`flex h-9 min-w-[32px] px-1.5 items-center justify-center rounded-xl border text-[10px] font-black transition taktil-target active:scale-90 ${
                Number(row.course_no || 1) === 1
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : Number(row.course_no || 1) === 2
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-purple-500/40 bg-purple-500/15 text-purple-300'
              }`}
            >
              C{row.course_no || 1}
            </button>
          )}

          {/* Note quick-edit button */}
          <button
            type="button"
            title={tx(lang, 'Qeyd', 'Примечание', 'Note')}
            onClick={() => onEditNote(row)}
            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition taktil-target active:scale-90 ${
              row.note
                ? 'border-amber-400/60 bg-amber-500/15 text-amber-300 shadow-sm'
                : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            ✎
          </button>
          {/* Stepper buttons */}
          <button
            type="button"
            aria-label={tx(lang, 'Azalt', 'Уменьшить', 'Decrease')}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-sm font-bold text-slate-200 taktil-target active:scale-90 hover:bg-slate-700"
            onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) - 1)}
          >
            −
          </button>
          <div className="min-w-6 text-center text-xs font-black text-slate-100 select-none">
            {row.qty}
          </div>
          <button
            type="button"
            aria-label={tx(lang, 'Artır', 'Увеличить', 'Increase')}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-sm font-bold text-slate-200 taktil-target active:scale-90 hover:bg-slate-700"
            onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) + 1)}
          >
            +
          </button>
          {/* Quick remove button */}
          <button
            type="button"
            aria-label={tx(lang, 'Sil', 'Удалить', 'Remove')}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300 taktil-target active:scale-90 hover:bg-rose-500/20"
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

  const sentTotal = useMemo(() => {
    return sentItems.reduce((sum: Decimal, it: any) => {
      const isVoided = ['VOIDED', 'COMPED', 'WASTE'].includes(String(it.status || '').toUpperCase());
      if (isVoided) return sum;
      return sum.plus(new Decimal(it.price || 0).times(it.qty || 1));
    }, new Decimal(0));
  }, [sentItems]);

  const grandTotal = useMemo(() => {
    return sentTotal.plus(new Decimal(draftTotal || 0)).toFixed(2);
  }, [sentTotal, draftTotal]);

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
                <span className="rounded-full bg-slate-900/20 px-2 py-0.5 text-xs font-semibold">{draftRows.reduce((acc, r) => acc + (r.qty || 0), 0)}</span>
              </span>
              <span className="text-base font-bold">{draftTotal} ₼</span>
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
            <span className="text-sm font-semibold text-white">{tx(lang, 'Sifariş', 'Заказ', 'Order')}</span>
            <span className="ml-2 text-sm font-semibold text-yellow-400">{draftTotal} ₼</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileActiveTab('menu')}
            className="rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-bold text-slate-200 active:scale-95 taktil-target"
          >
            ← {tx(lang, 'Menyu', 'Меню', 'Menu')}
          </button>
        </div>

        {/* Desktop & Tablet Cart Header (Screenshot 1 Style) */}
        <div className="hidden md:flex shrink-0 items-center justify-between border-b border-slate-700/60 p-3.5 bg-slate-900/80">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Table / Customer Avatar Badge */}
            <div className="h-10 w-10 shrink-0 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center font-black text-slate-950 text-sm shadow-md shadow-amber-400/20">
              {tableLabel ? tableLabel.replace(/[^0-9a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'M' : 'M'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-white truncate flex items-center gap-1.5">
                <span>{tableLabel || tx(lang, 'Masa Sifarişi', 'Заказ стола', 'Table Order')}</span>
                <span className="rounded-md bg-slate-800 border border-slate-700 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
                  {tx(lang, 'Zal', 'Зал', 'Dine-in')}
                </span>
              </div>
              <div className="text-[11px] font-semibold text-slate-400 truncate flex items-center gap-1 mt-0.5">
                {waiterName && <span>👤 {waiterName} · </span>}
                <span>👥 {guestCount || 2} {tx(lang, 'nəfər', 'гостей', 'guests')}</span>
              </div>
            </div>
          </div>
          {draftRows.length > 0 && (
            <button
              type="button"
              onClick={onClearDrafts}
              className="text-[11px] font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 border border-rose-500/25 px-2.5 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1"
            >
              <span>🗑️</span>
              <span>{tx(lang, 'Təmizlə', 'Очистить', 'Clear')}</span>
            </button>
          )}
        </div>

        {/* Scrollable draft items area */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 pb-1">
          {/* Draft error */}
          {draftSendError && (
            <div className="mb-2 rounded-lg border border-rose-300/35 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-100">{draftSendError}</div>
          )}

          {/* Draft items list */}
          {draftRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700/60 p-6 text-center text-xs font-bold text-slate-500 flex flex-col items-center justify-center gap-2 my-auto">
              <span className="text-2xl">🍽️</span>
              <span>{tx(lang, 'Sifariş üçün məhsul seçin', 'Выберите блюдо из меню', 'Select items from menu')}</span>
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
                  onUpdateCourse={props.onUpdateCourse}
                  lang={lang}
                />
              ))}
            </div>
          )}
        </div>

        {/* Fixed bottom: sent button + actions (never scrolls away) */}
        <div className="shrink-0 border-t border-slate-700/50 p-3 pt-2 bg-slate-900/40">
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

          {/* Total financial breakdown & action buttons */}
          <div className="space-y-1.5 py-1 px-0.5">
            {sentItems.length > 0 && (
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{tx(lang, 'Əvvəlki sifarişlər', 'Предыдущие заказы', 'Previous orders')}</span>
                <span className="font-semibold text-slate-300">{sentTotal.toFixed(2)} ₼</span>
              </div>
            )}
            {draftRows.length > 0 && (
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{tx(lang, 'Yeni əlavələr (Qaralama)', 'Новые добавления', 'New items')} ({draftRows.reduce((sum, r) => sum + (r.qty || 0), 0)})</span>
                <span className="font-semibold text-amber-300">{draftTotal} ₼</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-800/80 pt-1.5 text-sm font-bold text-slate-100">
              <span className="text-slate-300">{tx(lang, 'Yekun Cəm', 'Итоговая сумма', 'Grand Total')}</span>
              <span className="text-base font-black text-amber-400">{grandTotal} ₼</span>
            </div>
          </div>

          {/* Screenshot 1 Dual Action Buttons (Hesabı Al / Çek & Mətbəxə Göndər) */}
          <div className="mt-2.5 flex gap-2">
            {tableOccupied && (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={onSettle}
                className="relative inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-b from-blue-600 to-indigo-700 px-3 py-3 text-xs font-bold text-white shadow-[0_6px_20px_rgba(59,130,246,0.3)] transition active:scale-[0.97] disabled:opacity-50 taktil-target overflow-hidden hover:brightness-110"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 100%)' }} />
                🧾 {tx(lang, 'Hesabı Al', 'Счет', 'Print Receipt')}
              </button>
            )}

            {draftRows.length > 0 ? (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={() => { void onSend(); }}
                className="relative inline-flex min-h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-b from-yellow-400 to-amber-500 px-3 py-3 text-xs font-black text-slate-950 shadow-[0_6px_20px_rgba(250,204,21,0.3)] transition active:scale-[0.97] disabled:opacity-50 taktil-target overflow-hidden hover:brightness-105"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, transparent 100%)' }} />
                🚀 {tx(lang, 'Mətbəxə Göndər', 'В кухню', 'Place Order')}
              </button>
            ) : !tableOccupied ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-slate-600/60 bg-slate-800/70 px-3 py-3 text-xs font-bold text-slate-200 transition active:scale-[0.97] taktil-target"
              >
                ← {tx(lang, 'Masalar', 'Столы', 'Tables')}
              </button>
            ) : null}
          </div>

          {/* Secondary back button when both settle and send are shown */}
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={onBack}
              className="text-[11px] font-bold text-slate-400 hover:text-slate-200 transition"
            >
              ← {tx(lang, 'Masalara qayıt', 'Назад к столам', 'Back to Tables')}
            </button>
            {tableOccupied && (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={onCancelTable}
                className="text-[10px] font-semibold text-rose-400/60 hover:text-rose-400 transition"
              >
                ⚠️ {tx(lang, 'Masayanı ləğv et', 'Отменить', 'Cancel')}
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

        {/* ─── Slide-up Note Modifier Editor (OrderNoteModal) ─── */}
        {editingRowForNote && (
          <OrderNoteModal
            itemName={editingRowForNote.item_name}
            initialNote={editingRowForNote.note || currentNoteText}
            lang={lang}
            tenantId={props.tenantId}
            settingsPresets={props.settingsPresets}
            onSave={async (note) => {
              if (onUpdateNote && editingRowForNote) {
                const stillExists = draftRows.some((r: any) => String(r.id) === String(editingRowForNote.id));
                if (stillExists) {
                  await onUpdateNote(editingRowForNote.id, note);
                }
              }
              setEditingRowForNote(null);
            }}
            onClose={() => setEditingRowForNote(null)}
          />
        )}
      </div>
    </div>
  );
}

export default memo(BahaYTableCompose);
