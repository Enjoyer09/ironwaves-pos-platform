import React, { memo, useState, useEffect, useMemo } from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import MenuGrid from './MenuGrid';
import { playHapticSuccess, playHapticTouch, playKitchenReadyAlert } from '../../lib/haptics';
import OrderNoteModal from './OrderNoteModal';
import { useAppStore } from '../../store';
import { Trash2, LayoutGrid, Tag, Users, FileText, Send, Receipt, Banknote, CreditCard, QrCode, AlertTriangle, ChevronUp, ChevronDown, Check, Volume2, Plus, Minus, Edit3, Clock, ArrowLeft } from 'lucide-react';

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
  onUpdateCourse?: (id: string, courseNo: number) => void | Promise<void>;
  lang: string;
}) => {
  const itemTotal = new Decimal(row.price || 0).times(row.qty || 1).toFixed(2);
  const courseNo = Number(row.course_no || 1);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/90 p-3 shadow-sm transition-all duration-200 hover:border-slate-700/80">
      {/* Top row: Item Name, Total Price & Large Finger Stepper */}
      <div className="flex items-center justify-between gap-3">
        {/* Name and Price */}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white truncate leading-tight">
            {row.item_name}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs font-extrabold text-amber-400">
            <span>{itemTotal} ₼</span>
            {Number(row.qty || 1) > 1 && (
              <span className="text-[10px] font-medium text-slate-400">({Number(row.price || 0).toFixed(2)} ₼/ədəd)</span>
            )}
          </div>
        </div>

        {/* Large Finger-Friendly Stepper (44px min touch target) */}
        <div className="flex items-center gap-1.5 shrink-0 bg-slate-950/80 p-1 rounded-2xl border border-slate-800">
          <button
            type="button"
            aria-label={tx(lang, 'Azalt', 'Уменьшить', 'Decrease')}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-slate-200 border border-slate-700/80 text-lg font-black transition taktil-target active:scale-90 hover:bg-slate-700"
            onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) - 1)}
          >
            −
          </button>
          <div className="w-7 text-center text-sm font-black text-white select-none">
            {row.qty}
          </div>
          <button
            type="button"
            aria-label={tx(lang, 'Artır', 'Увеличить', 'Increase')}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 text-lg font-black transition taktil-target active:scale-90 shadow-md shadow-yellow-400/20 hover:brightness-105"
            onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) + 1)}
          >
            +
          </button>
        </div>
      </div>

      {/* Bottom Sub-row: Course Selector, Note Button & Delete Button */}
      <div className="mt-2.5 flex items-center gap-1.5 pt-2 border-t border-slate-800/60">
        {/* Course indicator/toggle */}
        {onUpdateCourse && (
          <button
            type="button"
            title={
              courseNo === 1
                ? tx(lang, '1-ci Mərhələ (İştahaçan/Salat)', '1-я Подача (Закуски)', 'Course 1 (Starters)')
                : courseNo === 2
                ? tx(lang, '2-ci Mərhələ (İsti Yemək)', '2-я Подача (Основное)', 'Course 2 (Mains)')
                : tx(lang, '3-cü Mərhələ (Desert/Çay)', '3-я Подача (Десерты)', 'Course 3 (Desserts)')
            }
            onClick={() => {
              tapFeedback();
              const next = courseNo === 1 ? 2 : courseNo === 2 ? 3 : 1;
              onUpdateCourse(String(row.id), next);
            }}
            className={`flex h-8 px-2.5 items-center justify-center rounded-xl border text-[11px] font-black transition taktil-target active:scale-90 shrink-0 ${
              courseNo === 1
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : courseNo === 2
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                : 'border-purple-500/40 bg-purple-500/15 text-purple-300'
            }`}
          >
            <span>C{courseNo}</span>
          </button>
        )}

        {/* Note trigger */}
        <button
          type="button"
          onClick={() => onEditNote(row)}
          className={`flex h-8 min-w-0 flex-1 items-center gap-1.5 px-2.5 rounded-xl border text-xs font-semibold transition taktil-target active:scale-95 truncate ${
            row.note
              ? 'border-amber-400/50 bg-amber-500/15 text-amber-300 shadow-xs'
              : 'border-slate-800 bg-slate-800/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          <span className="text-xs shrink-0">✎</span>
          <span className="truncate">{row.note || tx(lang, 'Qeyd əlavə et', 'Добавить примечание', 'Add note')}</span>
        </button>

        {/* Dedicated Delete Button */}
        <button
          type="button"
          aria-label={tx(lang, 'Sil', 'Удалить', 'Remove')}
          onClick={() => onUpdateQty(String(row.id), 0)}
          className="flex h-8 items-center gap-1 px-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs font-bold text-rose-300 taktil-target active:scale-90 hover:bg-rose-500/20 shrink-0"
        >
          <span>🗑️</span>
          <span>{tx(lang, 'Sil', 'Удалить', 'Delete')}</span>
        </button>
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
    tableLabel, guestCount, waiterName,
  } = props;

  const setLang = useAppStore((s) => s.setLang);
  const [sentPanelOpen, setSentPanelOpen] = useState(false);
  const [editingRowForNote, setEditingRowForNote] = useState<any>(null);
  const [currentNoteText, setCurrentNoteText] = useState('');
  const [mobileActiveTab, setMobileActiveTab] = useState<'menu' | 'cart'>('menu');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'cash' | 'card' | 'qr'>('cash');
  const [discountPercent, setDiscountPercent] = useState<number>(0);

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
          draftItems={draftRows.length > 0 ? draftRows : roundDraft}
          modernMode={true}
          summerPromoEnabled={summerPromoEnabled}
          onLangChange={setLang}
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
              <LayoutGrid size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black text-white truncate flex items-center gap-1.5">
                <span>{tableLabel || tx(lang, 'Masa Sifarişi', 'Заказ стола', 'Table Order')}</span>
                <span className="rounded-md bg-slate-800 border border-slate-700 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
                  {tx(lang, 'Zal', 'Зал', 'Dine-in')}
                </span>
              </div>
              <div className="text-[11px] font-semibold text-slate-400 truncate flex items-center gap-1 mt-0.5">
                {waiterName && <span><User size={10} /> {waiterName} · </span>}
                <span><Users size={10} /> {guestCount || 2} {tx(lang, 'nəfər', 'гостей', 'guests')}</span>
              </div>
            </div>
          </div>
          {draftRows.length > 0 && (
            <button
              type="button"
              onClick={onClearDrafts}
              className="text-[11px] font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 border border-rose-500/25 px-2.5 py-1.5 rounded-xl transition active:scale-95 flex items-center gap-1"
            >
              <Trash2 size={12} />
              <span>{tx(lang, 'Təmizlə', 'Очистить', 'Clear')}</span>
            </button>
          )}
        </div>

        {/* AeroTable Quick Action Bar */}
        <div className="grid grid-cols-4 gap-1.5 border-b border-slate-800/80 bg-slate-900/50 p-2 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="flex flex-col items-center justify-center py-1.5 px-1 rounded-xl bg-slate-800/70 hover:bg-slate-700/70 border border-slate-700/60 text-[10px] font-bold text-slate-300 transition taktil-target active:scale-95"
          >
            <ArrowLeft size={14} />
            <span className="truncate mt-0.5">{tx(lang, 'Masalar', 'Столы', 'Tables')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              tapFeedback();
              setDiscountPercent((prev) => (prev === 0 ? 5 : prev === 5 ? 10 : prev === 10 ? 15 : prev === 15 ? 20 : 0));
            }}
            className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl border text-[10px] font-bold transition taktil-target active:scale-95 ${
              discountPercent > 0
                ? 'bg-amber-500/20 border-amber-400/60 text-amber-300 shadow-sm'
                : 'bg-slate-800/70 hover:bg-slate-700/70 border-slate-700/60 text-slate-300'
            }`}
          >
            <Tag size={14} />
            <span className="truncate mt-0.5">{discountPercent > 0 ? `-${discountPercent}%` : tx(lang, 'Endirim', 'Скидка', 'Discount')}</span>
          </button>
          <div
            className="flex flex-col items-center justify-center py-1.5 px-1 rounded-xl bg-slate-800/70 border border-slate-700/60 text-[10px] font-bold text-slate-300 select-none"
          >
            <Users size={14} />
            <span className="truncate mt-0.5">{guestCount || 2} {tx(lang, 'Nəfər', 'Гостя', 'Guests')}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (draftRows.length > 0) {
                setEditingRowForNote(draftRows[0]);
                setCurrentNoteText(draftRows[0]?.note || '');
              }
            }}
            className="flex flex-col items-center justify-center py-1.5 px-1 rounded-xl bg-slate-800/70 hover:bg-slate-700/70 border border-slate-700/60 text-[10px] font-bold text-slate-300 transition taktil-target active:scale-95"
          >
            <FileText size={14} />
            <span className="truncate mt-0.5">{tx(lang, 'Qeyd', 'Заметка', 'Note')}</span>
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
                {(() => {
                  const readyItemCount = sentItems.filter((it: any) => String(it.status || '').toUpperCase() === 'READY').length;
                  if (readyItemCount > 0) {
                    return (
                      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.2 text-[10px] font-black text-emerald-300 animate-pulse">
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

          {/* AeroTable Payment Method Selector — finger-friendly 44px targets */}
          <div className="mb-2 grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-950/70 border border-slate-800/80">
            <button
              type="button"
              onClick={() => { tapFeedback(); setSelectedPaymentMethod('cash'); }}
              className={`flex items-center justify-center gap-1.5 h-11 px-2 rounded-xl text-xs font-bold transition taktil-target active:scale-95 ${
                selectedPaymentMethod === 'cash'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Banknote size={15} />
              <span>{tx(lang, 'Nəğd', 'Наличные', 'Cash')}</span>
            </button>
            <button
              type="button"
              onClick={() => { tapFeedback(); setSelectedPaymentMethod('card'); }}
              className={`flex items-center justify-center gap-1.5 h-11 px-2 rounded-xl text-xs font-bold transition taktil-target active:scale-95 ${
                selectedPaymentMethod === 'card'
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <CreditCard size={15} />
              <span>{tx(lang, 'Kart', 'Карта', 'Card')}</span>
            </button>
            <button
              type="button"
              onClick={() => { tapFeedback(); setSelectedPaymentMethod('qr'); }}
              className={`flex items-center justify-center gap-1.5 h-11 px-2 rounded-xl text-xs font-bold transition taktil-target active:scale-95 ${
                selectedPaymentMethod === 'qr'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <QrCode size={15} />
              <span>{tx(lang, 'QR / App', 'QR / Приложение', 'QR Pay')}</span>
            </button>
          </div>

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
            {discountPercent > 0 && (
              <div className="flex items-center justify-between text-xs text-amber-400 font-semibold">
                <span>{tx(lang, 'Endirim', 'Скидка', 'Discount')} (-{discountPercent}%)</span>
                <span>-{new Decimal(grandTotal).times(discountPercent).dividedBy(100).toFixed(2)} ₼</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-800/80 pt-1.5 text-sm font-bold text-slate-100">
              <span className="text-slate-300">{tx(lang, 'Yekun Cəm', 'Итоговая сумма', 'Grand Total')}</span>
              <span className="text-base font-black text-amber-400">{discountedGrandTotal} ₼</span>
            </div>
          </div>

          {/* ─── CTA Buttons — Clear Hierarchy: 1 Primary + 1 Secondary ─── */}
          <div className="mt-2.5 flex gap-2">
            {/* Secondary CTA: Hesabı Al (outline style) */}
            {tableOccupied && (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={onSettle}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl border-2 border-slate-600 bg-transparent px-3 py-3 text-xs font-bold text-slate-200 transition active:scale-[0.97] disabled:opacity-50 taktil-target hover:border-slate-500 hover:text-white"
              >
                <Receipt size={16} />
                <span>{tx(lang, 'Hesabı Al', 'Счет', 'Bill')}</span>
              </button>
            )}

            {/* Primary CTA: Mətbəxə Göndər */}
            {draftRows.length > 0 ? (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={() => { void onSend(); }}
                className="relative inline-flex min-h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-yellow-400 to-amber-500 px-3 py-3 text-xs font-black text-slate-950 shadow-[0_6px_20px_rgba(250,204,21,0.35)] transition active:scale-[0.97] disabled:opacity-50 taktil-target overflow-hidden hover:brightness-105"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, transparent 100%)' }} />
                <Send size={16} />
                <span>{tx(lang, 'Mətbəxə Göndər', 'В кухню', 'Place Order')}</span>
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

          {/* Secondary back + destructive actions — with confirm protection */}
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={onBack}
              className="text-[11px] font-bold text-slate-400 hover:text-slate-200 transition flex items-center gap-1"
            >
              <ArrowLeft size={12} />
              <span>{tx(lang, 'Masalara qayıt', 'Назад к столам', 'Back to Tables')}</span>
            </button>
            {tableOccupied && (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={() => {
                  if (window.confirm(tx(lang, 'Masanı ləğv etmək istədiyinizdən əminsiniz? Bu əməliyyat geri qaytarıla bilməz.', 'Вы уверены? Это действие необратимо.', 'Are you sure? This cannot be undone.'))) {
                    onCancelTable?.();
                  }
                }}
                className="text-[10px] font-semibold text-rose-400/60 hover:text-rose-400 transition"
              >
                {tx(lang, 'Masayanı ləğv et', 'Отменить', 'Cancel table')}
              </button>
            )}
          </div>

          {/* Cancel/Void table check — with mandatory confirm dialog */}
          {tableOccupied && (
            <div className="mt-4 flex justify-center border-t border-slate-800/50 pt-3">
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={() => {
                  if (window.confirm(tx(lang, '⚠️ Masanı boşaltmaq istədiyinizdən əminsiniz?\n\nBu əməliyyat bütün sifarişləri silir və geri qaytarıla bilməz!', '⚠️ Уверены, что хотите освободить стол?\n\nЭто действие необратимо!', '⚠️ Clear this table?\n\nThis will void all items and cannot be undone!'))) {
                    onCancelTable?.();
                  }
                }}
                className="text-[10px] font-semibold text-rose-400/70 transition active:text-rose-300 disabled:opacity-30 taktil-target"
              >
                {tx(lang, 'Masayı boşalt (satışsız)', 'Отменить стол', 'Cancel check')}
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { playKitchenReadyAlert(); }}
                title={tx(lang, 'Mətbəx zəngini səsləndir', 'Звуковой сигнал кухни', 'Test kitchen chime')}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-600/60 bg-slate-800/60 text-sm font-bold text-amber-300 transition hover:bg-slate-700/60 active:scale-90 taktil-target"
              >
                <Volume2 size={16} />
              </button>
              <button
                type="button"
                onClick={() => setSentPanelOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-600/60 bg-slate-800/60 text-sm font-bold text-slate-300 transition hover:bg-slate-700/60 taktil-target"
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
