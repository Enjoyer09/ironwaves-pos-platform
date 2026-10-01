import React, { memo, useState, useEffect, useMemo } from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import MenuGrid from './MenuGrid';
import { playHapticSuccess, playHapticTouch, playKitchenReadyAlert } from '../../lib/haptics';
import OrderNoteModal from './OrderNoteModal';
import { useAppStore } from '../../store';
import { Trash2, Tag, Users, User, FileText, Send, Receipt, AlertTriangle, ChevronUp, ChevronDown, Check, Volume2, Plus, Minus, Edit3, Clock, ArrowLeft, Printer, ArrowRightLeft, Bell } from 'lucide-react';
import { useResizableSplitPane } from '../../hooks/useResizableSplitPane';
import SplitterDivider from '../common/SplitterDivider';

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
  /** True while a kitchen send is in flight: shows a spinner and blocks re-taps. */
  sending?: boolean;
  // Settle
  tableOccupied: boolean;
  userCanEdit: boolean;
  onSettle: (paymentMethod?: 'Nəğd' | 'Kart' | 'Split', discountPercent?: number) => void;
  onPrintPreCheck?: () => void | Promise<void>;
  onOpenOperations?: () => void;
  onUpdateGuestCount?: (newCount: number) => void | Promise<void>;
  onCancelTable: () => void;
  // Sent items
  sentItems: any[];
  onVoidItem?: (item: any) => void;
  // Tabs
  readyCount: number;
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
  onUpdateCourse?: (id: string, courseNo: number) => void | Promise<void>;
  lang: string;
}) => {
  const itemTotal = new Decimal(row.price || 0).times(row.qty || 1).toFixed(2);
  const courseNo = Number(row.course_no || 1);

  const courseTitle =
    courseNo === 1
      ? tx(lang, '1-ci Mərhələ (İştahaçan/Salat)', '1-я Подача (Закуски)', 'Course 1 (Starters)')
      : courseNo === 2
      ? tx(lang, '2-ci Mərhələ (İsti Yemək)', '2-я Подача (Основное)', 'Course 2 (Mains)')
      : tx(lang, '3-cü Mərhələ (Desert/Çay)', '3-я Подача (Десерты)', 'Course 3 (Desserts)');

  // 15" POS: one compact line per item (ticket style, ~60px) instead of a two-row
  // card (~100px), so 5-6 items fit in the cart at 768px height. Every control is
  // still a 44x44 target. The note, when present, shows under the name.
  return (
    <div className="relative flex items-center gap-2 overflow-hidden rounded-xl border-2 border-amber-500/70 bg-amber-500/15 px-2 py-1.5 transition-colors duration-200">
      {/* P2-4: amber = not yet sent; sent items live in the "Göndərilmişlər" panel. */}
      {onUpdateCourse && (
        <button
          type="button"
          aria-label={courseTitle}
          onClick={() => {
            tapFeedback();
            const next = courseNo === 1 ? 2 : courseNo === 2 ? 3 : 1;
            onUpdateCourse(String(row.id), next);
          }}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-sm font-black transition taktil-target active:scale-90 ${
            courseNo === 1
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : courseNo === 2
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
              : 'border-purple-500/40 bg-purple-500/15 text-purple-300'
          }`}
        >
          C{courseNo}
        </button>
      )}

      {/* Name / price / note: tapping opens the note editor */}
      <button
        type="button"
        onClick={() => onEditNote(row)}
        aria-label={`${row.item_name}. ${tx(lang, 'Qeyd əlavə et', 'Добавить примечание', 'Add note')}`}
        className="min-h-11 min-w-0 flex-1 text-left taktil-target"
      >
        <div className="truncate text-base font-bold leading-tight text-white">{row.item_name}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-sm font-extrabold text-amber-300">
          <span className="shrink-0">{itemTotal} ₼</span>
          {row.note ? (
            <span className="truncate text-xs font-semibold text-amber-200">✎ {row.note}</span>
          ) : (
            <span className="truncate text-xs font-semibold text-slate-400">✎ {tx(lang, 'Qeyd', 'Заметка', 'Note')}</span>
          )}
        </div>
      </button>

      {/* Stepper */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={tx(lang, 'Azalt', 'Уменьшить', 'Decrease')}
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-800 text-xl font-black text-slate-100 transition taktil-target active:scale-90"
          onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) - 1)}
        >
          −
        </button>
        <div className="w-7 select-none text-center text-base font-black text-white">{row.qty}</div>
        <button
          type="button"
          aria-label={tx(lang, 'Artır', 'Увеличить', 'Increase')}
          className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-r from-yellow-400 to-amber-500 text-xl font-black text-slate-950 transition taktil-target active:scale-90"
          onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) + 1)}
        >
          +
        </button>
      </div>

      <button
        type="button"
        aria-label={tx(lang, 'Sil', 'Удалить', 'Remove')}
        onClick={() => onUpdateQty(String(row.id), 0)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 taktil-target active:scale-90"
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
});

DraftRowItem.displayName = 'DraftRowItem';

function BahaYTableCompose(props: BahaYTableComposeProps) {
  const {
    lang, filteredRoundMenu, roundCategories, roundSearch, roundCategory,
    onSearchChange, onCategoryChange, onSelectItem, roundDraft,
    draftRows, draftTotal, draftSendError, onClearDrafts, onUpdateQty, onSend, sending = false,
    tableOccupied, userCanEdit, onSettle, onCancelTable,
    sentItems, onVoidItem,
    readyCount, onTabChange,
    onBack, summerPromoEnabled, onUpdateNote,
    tableLabel, guestCount, waiterName,
    onPrintPreCheck, onOpenOperations, onUpdateGuestCount,
  } = props;

  const setLang = useAppStore((s) => s.setLang);
  const notify = useAppStore((s) => s.notify);
  const currentRole = useAppStore((s) => String(s.user?.role || '').toLowerCase());
  // P1-6: discounts are a manager decision. Waiters could freely cycle 0-20% with
  // no check; now the button is disabled for staff/kitchen and explains why.
  const canApplyDiscount = ['admin', 'manager', 'super_admin'].includes(currentRole);
  const [sentPanelOpen, setSentPanelOpen] = useState(false);
  const [editingRowForNote, setEditingRowForNote] = useState<any>(null);
  const [currentNoteText, setCurrentNoteText] = useState('');
  const [mobileActiveTab, setMobileActiveTab] = useState<'menu' | 'cart'>('menu');
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [showGuestPicker, setShowGuestPicker] = useState(false);

  const hasCartContent = draftRows.length > 0 || sentItems.length > 0;
  // P1-2/P1-3: on an occupied table the cart/actions pane must always be reachable,
  // even with zero drafts and zero sent items, so Pre-Check / Hesabı Al / Köçür /
  // guest count / Masanı ləğv et are never hidden. Draft-only used to gate it.
  const showCartPane = hasCartContent || tableOccupied;

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

  const discountedGrandTotal = useMemo(() => {
    const raw = new Decimal(grandTotal);
    if (discountPercent > 0) {
      return raw.times(100 - discountPercent).dividedBy(100).toFixed(2);
    }
    return raw.toFixed(2);
  }, [grandTotal, discountPercent]);

  // Close note editor if the edited item was removed from draft
  useEffect(() => {
    if (editingRowForNote && !draftRows.some((r: any) => String(r.id) === String(editingRowForNote.id))) {
      setEditingRowForNote(null);
    }
  }, [draftRows, editingRowForNote]);

  const {
    cartWidth,
    isDragging,
    containerRef,
    onPointerDown,
    resetToDefault,
  } = useResizableSplitPane({
    storageKey: 'iw_tables_compose_cart_width',
    defaultWidth: 460,
    minWidth: 320,
    maxWidth: 680,
  });

  return (
    <div
      ref={containerRef}
      style={{ '--cart-width': `${cartWidth}px` } as React.CSSProperties}
      className={`flex flex-col min-h-0 flex-1 gap-3 md:gap-0 overflow-hidden relative ${
        showCartPane ? 'md:flex md:flex-row' : ''
      }`}
    >
      {/* ─── LEFT: Menu Grid ─── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <MenuGrid
          items={filteredRoundMenu}
          categories={roundCategories}
          search={roundSearch}
          selectedCategory={roundCategory}
          lang={lang}
          onSearchChange={onSearchChange}
          onCategoryChange={onCategoryChange}
          onSelectItem={onSelectItem}
          draftItems={draftRows.length > 0 ? draftRows : roundDraft}
          modernMode={true}
          summerPromoEnabled={summerPromoEnabled}
          onLangChange={setLang}
        />

        {/* Floating Mobile Bar. P1-2: with drafts it's a cart+send bar; with none it
            still opens the cart pane so Pre-Check / Hesab / Köçür / Servis stay reachable
            on a phone (previously this bar only rendered when draftRows>0, trapping the
            waiter with only the header back button once everything was sent). */}
        {mobileActiveTab !== 'cart' && (draftRows.length > 0 || showCartPane) && (
          <div className="md:hidden shrink-0 mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setMobileActiveTab('cart')}
              className="flex-1 flex items-center justify-between bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 px-5 py-4 font-black text-sm rounded-2xl active:scale-[0.97] shadow-[0_8px_24px_rgba(250,204,21,0.25)] taktil-target"
            >
              {draftRows.length > 0 ? (
                <>
                  <span className="flex items-center gap-2">
                    🛒 {tx(lang, 'Səbət', 'Корзина', 'Cart')}
                    <span className="rounded-full bg-slate-900/20 px-2 py-0.5 text-xs font-semibold">{draftRows.reduce((acc, r) => acc + (r.qty || 0), 0)}</span>
                  </span>
                  <span className="text-base font-bold">{draftTotal} ₼</span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-2">
                    🧾 {tx(lang, 'Sifariş və Hesab', 'Заказ и счёт', 'Order & Bill')}
                  </span>
                  <span className="text-base font-bold">{sentTotal.toFixed(2)} ₼</span>
                </>
              )}
            </button>
            {draftRows.length > 0 && (
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
            )}
          </div>
        )}
      </div>

      {/* ─── SPLITTER DIVIDER (Drag to resize) ─── */}
      {showCartPane && (
        <SplitterDivider
          isDragging={isDragging}
          onPointerDown={onPointerDown}
          onDoubleClick={resetToDefault}
        />
      )}

      {/* ─── RIGHT: Draft + Actions + Slide-up Sent Panel (iOS-style Bottom Sheet on mobile) ─── */}
      {/* Backdrop overlay for mobile bottom sheet */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs transition-opacity duration-300 ${
          mobileActiveTab === 'cart' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileActiveTab('menu')}
      />

      <div
        className={`fixed bottom-0 left-0 right-0 z-50 h-[85dvh] rounded-t-[30px] border-t border-slate-800 bg-[#070b12] shadow-[0_-20px_50px_rgba(0,0,0,0.65)] transition-transform duration-300 ease-out flex flex-col overflow-hidden md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto md:h-full md:rounded-2xl md:border md:border-slate-700/60 md:bg-slate-950/50 md:shadow-none md:translate-y-0 md:w-[var(--cart-width)] shrink-0 ${
          mobileActiveTab === 'cart' ? 'translate-y-0' : 'translate-y-full'
        } ${!showCartPane ? 'md:hidden' : ''}`}
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
        <div className="hidden md:flex shrink-0 items-center justify-between gap-2 border-b border-slate-700/60 px-3 py-2 bg-slate-900/80">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 truncate text-base font-black text-white">
              <span className="truncate">{tableLabel || tx(lang, 'Masa Sifarişi', 'Заказ стола', 'Table Order')}</span>
              <span className="shrink-0 rounded-md border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs font-bold text-amber-300">
                {tx(lang, 'Zal', 'Зал', 'Dine-in')}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 truncate text-sm font-semibold text-slate-300">
              {waiterName && <><User size={14} className="shrink-0" /><span className="truncate">{waiterName}</span><span>·</span></>}
              <Users size={14} className="shrink-0" />
              <span className="shrink-0">{guestCount || 2} {tx(lang, 'nəfər', 'гостей', 'guests')}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {draftRows.length > 0 && (
              <button
                type="button"
                onClick={onClearDrafts}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-600 bg-slate-800/80 px-3 text-sm font-bold text-slate-200 transition taktil-target active:scale-95"
              >
                <Trash2 size={16} />
                <span>{tx(lang, 'Təmizlə', 'Очистить', 'Clear')}</span>
              </button>
            )}
            {/* Destructive whole-table cancel. Moved up from the bottom action block to
                free vertical space for order lines; the app's own confirm modal (with a
                reason field) follows, so no native window.confirm here. */}
            {tableOccupied && (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={() => onCancelTable?.()}
                // Kept apart from "Təmizlə" (gap-3): this voids the whole table.
                aria-label={tx(lang, 'Masanı ləğv et', 'Отменить стол', 'Cancel table')}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 text-sm font-bold text-rose-300 transition taktil-target active:scale-95 disabled:opacity-40"
              >
                <AlertTriangle size={16} />
                <span className="hidden lg:inline">{tx(lang, 'Masanı ləğv et', 'Отменить стол', 'Cancel table')}</span>
              </button>
            )}
          </div>
        </div>

        {/* AeroTable Quick Action Bar */}
        <div className="grid grid-cols-5 gap-1.5 border-b border-slate-800/80 bg-slate-900/50 p-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              tapFeedback();
              onTabChange('service');
            }}
            className={`relative flex flex-col items-center justify-center min-h-12 px-1 rounded-xl border text-xs font-bold transition taktil-target active:scale-95 ${
              readyCount > 0
                ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300 shadow-sm shadow-emerald-500/10'
                : 'bg-slate-800/70 hover:bg-slate-700/70 border-slate-700/60 text-slate-300'
            }`}
            title={tx(lang, 'Mətbəx Servis Statusu', 'Сервис кухни', 'Kitchen Service')}
          >
            <Bell size={14} className={readyCount > 0 ? 'animate-bounce text-emerald-400' : ''} />
            <span className="truncate mt-0.5">{tx(lang, 'Servis', 'Сервис', 'Service')}</span>
            {readyCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-emerald-500 text-xs font-black text-slate-950 shadow-md">
                {readyCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              tapFeedback();
              onOpenOperations?.();
            }}
            className="flex flex-col items-center justify-center min-h-12 px-1 rounded-xl bg-slate-800/70 hover:bg-blue-600/20 border border-blue-500/40 text-xs font-bold text-blue-300 transition taktil-target active:scale-95"
            title={tx(lang, 'Masanı köçür və ya birləşdir', 'Перенести или объединить стол', 'Transfer or combine table')}
          >
            <ArrowRightLeft size={16} />
            <span className="truncate mt-0.5">{tx(lang, 'Köçür', 'Перенос', 'Transfer')}</span>
          </button>
          {/* Not `disabled`: a disabled button swallows the tap, and the only
              explanation was a `title` tooltip that never shows on touch. Stay tappable
              so staff get the "manager only" toast. */}
          <button
            type="button"
            aria-disabled={!canApplyDiscount}
            onClick={() => {
              tapFeedback();
              if (!canApplyDiscount) {
                notify('error', tx(lang, 'Endirim yalnız menecer icazəsi ilə tətbiq olunur', 'Скидку применяет только менеджер', 'Discounts require a manager'));
                return;
              }
              setDiscountPercent((prev) => (prev === 0 ? 5 : prev === 5 ? 10 : prev === 10 ? 15 : prev === 15 ? 20 : 0));
            }}
            className={`flex flex-col items-center justify-center min-h-12 px-1 rounded-xl border text-xs font-bold transition taktil-target active:scale-95 ${
              !canApplyDiscount
                ? 'bg-slate-900/50 border-slate-800/60 text-slate-600 cursor-not-allowed'
                : discountPercent > 0
                ? 'bg-amber-500/20 border-amber-400/60 text-amber-300 shadow-sm'
                : 'bg-slate-800/70 hover:bg-slate-700/70 border-slate-700/60 text-slate-300'
            }`}
            title={canApplyDiscount ? tx(lang, 'Endirim tətbiq et', 'Применить скидку', 'Apply discount') : tx(lang, 'Menecer icazəsi tələb olunur', 'Требуется менеджер', 'Manager approval required')}
          >
            <Tag size={16} />
            <span className="truncate mt-0.5">{discountPercent > 0 ? `-${discountPercent}%` : tx(lang, 'Endirim', 'Скидка', 'Discount')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              tapFeedback();
              setShowGuestPicker((prev) => !prev);
            }}
            className="flex flex-col items-center justify-center min-h-12 px-1 rounded-xl bg-slate-800/70 hover:bg-slate-700/70 border border-slate-700/60 text-xs font-bold text-slate-300 transition taktil-target active:scale-95"
            title={tx(lang, 'Qonaq sayını dəyiş', 'Изменить кол-во гостей', 'Change guest count')}
          >
            <Users size={16} />
            <span className="truncate mt-0.5">{guestCount || 2} {tx(lang, 'Nəfər', 'Гостя', 'Guests')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (draftRows.length > 0) {
                setEditingRowForNote(draftRows[0]);
                setCurrentNoteText(draftRows[0]?.note || '');
              }
            }}
            className="flex flex-col items-center justify-center min-h-12 px-1 rounded-xl bg-slate-800/70 hover:bg-slate-700/70 border border-slate-700/60 text-xs font-bold text-slate-300 transition taktil-target active:scale-95"
          >
            <FileText size={16} />
            <span className="truncate mt-0.5">{tx(lang, 'Qeyd', 'Заметка', 'Note')}</span>
          </button>
        </div>

        {/* Quick Guest Count Selector popup */}
        {showGuestPicker && (
          <div className="border-b border-slate-800/80 bg-slate-900 p-2 animate-scaleIn">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-sm font-bold text-slate-300">{tx(lang, 'Qonaq sayı', 'Гости', 'Guests')}</span>
              <button
                type="button"
                onClick={() => setShowGuestPicker(false)}
                aria-label={tx(lang, 'Bağla', 'Закрыть', 'Close')}
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-800 text-base font-bold text-slate-300 taktil-target"
              >
                ✕
              </button>
            </div>
            {/* 1-12 as a grid of 44px keys (was 1-6, 8, 10 at 28px, so 7, 9, 11+ were
                impossible to pick). */}
            <div className="grid grid-cols-6 gap-1.5">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    tapFeedback();
                    onUpdateGuestCount?.(num);
                    setShowGuestPicker(false);
                  }}
                  className={`h-11 rounded-lg text-base font-black transition taktil-target active:scale-90 ${
                    Number(guestCount || 2) === num
                      ? 'bg-amber-400 text-slate-950 shadow-sm'
                      : 'border border-slate-700/70 bg-slate-800 text-slate-100'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Scrollable draft items area */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2 pb-1">
          {/* Draft error */}
          {draftSendError && (
            <div role="alert" className="mb-2 rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100">{draftSendError}</div>
          )}

          {/* Draft items list */}
          {draftRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700/60 p-6 text-center text-sm font-bold text-slate-400 flex flex-col items-center justify-center gap-2 my-auto">
              <span className="text-2xl">🍽️</span>
              {sentItems.length > 0 ? (
                // P1-1 follow-up: don't imply the order is empty when items were already sent.
                <span>{tx(lang, 'Yeni məhsul əlavə edin — göndərilənlər aşağıdadır', 'Добавьте новые позиции — отправленные ниже', 'Add new items — sent items are below')}</span>
              ) : (
                <span>{tx(lang, 'Sifariş üçün məhsul seçin', 'Выберите блюдо из меню', 'Select items from menu')}</span>
              )}
            </div>
          ) : (
            <div className="space-y-1">
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
        <div className="shrink-0 border-t border-slate-700/50 px-3 py-2 bg-slate-900/40">
          {/* Sent items toggle button */}
          {sentItems.length > 0 && (
            <button
              type="button"
              onClick={() => setSentPanelOpen(true)}
              className="mb-2 flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-600/50 bg-slate-800/50 px-3 py-1.5 text-left taktil-target transition hover:bg-slate-700/50 active:scale-[0.98]"
            >
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1">
                  {sentItems.some((it: any) => String(it.status || '').toUpperCase() === 'READY') && <span className="h-2.5 w-2.5 rounded-full border border-slate-900 bg-emerald-400" />}
                  {sentItems.some((it: any) => String(it.status || '').toUpperCase() === 'PREPARING') && <span className="h-2.5 w-2.5 rounded-full border border-slate-900 bg-orange-400" />}
                  {sentItems.some((it: any) => ['SENT', 'NEW'].includes(String(it.status || '').toUpperCase())) && <span className="h-2.5 w-2.5 rounded-full border border-slate-900 bg-blue-400" />}
                  {sentItems.some((it: any) => String(it.status || '').toUpperCase() === 'VOID_REQUESTED') && <span className="h-2.5 w-2.5 rounded-full border border-slate-900 bg-yellow-400" />}
                </div>
                <span className="text-sm font-bold text-slate-100">{tx(lang, 'Göndərilmişlər', 'Отправленные', 'Sent')}</span>
                {(() => {
                  const readyItemCount = sentItems.filter((it: any) => String(it.status || '').toUpperCase() === 'READY').length;
                  if (readyItemCount > 0) {
                    return (
                      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-xs font-black text-emerald-300 animate-pulse">
                        ✓ {readyItemCount}/{sentItems.length} {tx(lang, 'Hazır', 'Готово', 'Ready')}
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-slate-700/80 px-2 py-0.5 text-xs font-bold text-slate-200">{sentItems.length}</span>
                <span className="text-slate-400">↑</span>
              </div>
            </button>
          )}

          {/* Payment method is chosen in the payment modal (industry-standard flow).
              The pre-selector that used to sit here took ~80px of the 768px-tall POS
              screen, and waiters read it as "pay now". Totals + CTAs only. */}
          <div className="space-y-0.5 px-0.5 py-1">
            {sentItems.length > 0 && draftRows.length > 0 && (
              <div className="flex items-center justify-between text-sm text-slate-300">
                <span>{tx(lang, 'Göndərilib', 'Отправлено', 'Sent')} {sentTotal.toFixed(2)} ₼ · {tx(lang, 'Yeni', 'Новые', 'New')} ({draftRows.reduce((sum, r) => sum + (r.qty || 0), 0)})</span>
                <span className="font-bold text-amber-300">+{draftTotal} ₼</span>
              </div>
            )}
            {discountPercent > 0 && (
              <div className="flex items-center justify-between text-sm font-semibold text-amber-300">
                <span>{tx(lang, 'Endirim', 'Скидка', 'Discount')} (-{discountPercent}%)</span>
                <span>-{new Decimal(grandTotal).times(discountPercent).dividedBy(100).toFixed(2)} ₼</span>
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <span className="text-base font-bold text-slate-200">{tx(lang, 'Yekun Cəm', 'Итоговая сумма', 'Grand Total')}</span>
              <span className="text-2xl font-black text-amber-400">{discountedGrandTotal} ₼</span>
            </div>
          </div>

          {/* ─── CTA Buttons — Clear Hierarchy ─── */}
          <div className="mt-1.5 flex flex-col gap-2">
            {/* Primary CTA: Mətbəxə Göndər (if drafts exist) */}
            {draftRows.length > 0 && (
              <button
                type="button"
                disabled={!userCanEdit || sending}
                aria-busy={sending}
                onClick={() => { if (!sending) void onSend(); }}
                className="relative inline-flex min-h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-b from-yellow-400 to-amber-500 px-3 text-lg font-black text-slate-950 shadow-[0_6px_20px_rgba(250,204,21,0.35)] transition active:scale-[0.97] disabled:opacity-60 taktil-target"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, transparent 100%)' }} />
                {sending ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-[3px] border-slate-950/30 border-t-slate-950" aria-hidden="true" />
                ) : (
                  <Send size={20} />
                )}
                <span>
                  {sending
                    ? tx(lang, 'Göndərilir…', 'Отправка…', 'Sending…')
                    : tx(lang, 'Mətbəxə Göndər', 'В кухню', 'Send to kitchen')}
                </span>
              </button>
            )}

            {/* Settle & Pre-Check Row */}
            {tableOccupied && (
              <div className="flex gap-2">
                {onPrintPreCheck && (
                  <button
                    type="button"
                    onClick={() => {
                      tapFeedback();
                      void onPrintPreCheck();
                    }}
                    className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-cyan-400/40 bg-cyan-500/15 px-3 text-base font-bold text-cyan-100 transition active:scale-[0.97] taktil-target"
                  >
                    <Printer size={18} />
                    <span>{tx(lang, 'Aralıq hesab', 'Предчек', 'Pre-check')}</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={!userCanEdit}
                  onClick={() => onSettle('Nəğd', discountPercent)}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-slate-500 bg-slate-800/80 px-3 text-base font-bold text-slate-100 transition active:scale-[0.97] disabled:opacity-50 taktil-target"
                >
                  <Receipt size={18} />
                  <span>{tx(lang, 'Hesabı Al', 'Счет', 'Bill')}</span>
                </button>
              </div>
            )}

            {!tableOccupied && draftRows.length === 0 && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-slate-600/60 bg-slate-800/70 px-3 text-base font-bold text-slate-200 transition active:scale-[0.97] taktil-target"
              >
                ← {tx(lang, 'Masalar', 'Столы', 'Tables')}
              </button>
            )}
          </div>
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
              <div className="text-sm text-slate-300">{sentItems.length} {tx(lang, 'məhsul', 'позиций', 'items')}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { playKitchenReadyAlert(); }}
                title={tx(lang, 'Mətbəx zəngini səsləndir', 'Звуковой сигнал кухни', 'Test kitchen chime')}
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-600/60 bg-slate-800/60 text-sm font-bold text-amber-300 transition hover:bg-slate-700/60 active:scale-90 taktil-target"
              >
                <Volume2 size={16} />
              </button>
              <button
                type="button"
                onClick={() => setSentPanelOpen(false)}
                aria-label={tx(lang, 'Bağla', 'Закрыть', 'Close')}
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-600/60 bg-slate-800/60 text-sm font-bold text-slate-300 transition hover:bg-slate-700/60 active:scale-90 taktil-target"
              >
                <ChevronDown size={18} />
              </button>
            </div>
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
                    status === 'SERVED' ? tx(lang, 'Verilib', 'Подано', 'Served') :
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
                        <div className="truncate text-sm font-semibold text-slate-100">{it.item_name}</div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
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
              ↓ {tx(lang, 'Qapat', 'Закрыть', 'Close')}
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
