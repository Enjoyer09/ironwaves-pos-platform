import React, { memo, useState, useEffect, useMemo } from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import MenuGrid from './MenuGrid';
import { playHapticSuccess, playHapticTouch, playKitchenReadyAlert } from '../../lib/haptics';
import OrderNoteModal from './OrderNoteModal';
import { useAppStore } from '../../store';
import { Trash2, LayoutGrid, Tag, Users, User, FileText, Send, Receipt, Banknote, CreditCard, QrCode, AlertTriangle, ChevronUp, ChevronDown, Check, Volume2, Plus, Minus, Edit3, Clock, ArrowLeft, Printer, ArrowRightLeft, Bell } from 'lucide-react';
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

  return (
    <div className="group relative flex items-center justify-between gap-2 rounded-xl border border-[#F6B100]/45 bg-[#1c2026] px-2.5 py-2 transition hover:border-[#F6B100]/80">
      {/* Left: Course badge + Clickable Item Name & Note */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
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
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[10px] font-black transition active:scale-90 ${
              courseNo === 1
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : courseNo === 2
                ? 'border-[#F6B100]/40 bg-[#F6B100]/15 text-[#F6B100]'
                : 'border-purple-500/40 bg-purple-500/15 text-purple-300'
            }`}
          >
            C{courseNo}
          </button>
        )}

        <button
          type="button"
          onClick={() => onEditNote(row)}
          className="min-w-0 flex-1 text-left"
          title={tx(lang, 'Qeyd əlavə etmək üçün toxunun', 'Нажмите, чтобы добавить примечание', 'Tap to add note')}
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs sm:text-[13px] font-bold text-white leading-tight">
              {row.item_name}
            </span>
            <span className="shrink-0 text-[11px] text-slate-400 hover:text-[#F6B100]">✎</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums">
            <span className="font-extrabold text-[#F6B100]">{itemTotal} ₼</span>
            {Number(row.qty || 1) > 1 && (
              <span className="text-[10px] text-slate-400">({Number(row.price || 0).toFixed(2)} ₼/əd)</span>
            )}
            {row.note && (
              <span className="truncate rounded bg-[#F6B100]/20 px-1.5 py-0.2 text-[10px] font-semibold text-amber-200">
                ✎ {row.note}
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Right: Compact Touch Stepper & Remove */}
      <div className="flex items-center gap-1 shrink-0">
        <div className="flex items-center gap-1 rounded-xl bg-[#121519] p-0.5 border border-white/10">
          <button
            type="button"
            aria-label={tx(lang, 'Azalt', 'Уменьшить', 'Decrease')}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#262b33] text-slate-200 text-sm font-black transition active:scale-90 hover:bg-slate-700"
            onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) - 1)}
          >
            −
          </button>
          <div className="w-6 text-center text-xs font-black text-white select-none tabular-nums">
            {row.qty}
          </div>
          <button
            type="button"
            aria-label={tx(lang, 'Artır', 'Увеличить', 'Increase')}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F6B100] text-slate-950 text-sm font-black transition active:scale-90 hover:brightness-105"
            onClick={() => onUpdateQty(String(row.id), Number(row.qty || 0) + 1)}
          >
            +
          </button>
        </div>
        <button
          type="button"
          aria-label={tx(lang, 'Sil', 'Удалить', 'Remove')}
          onClick={() => onUpdateQty(String(row.id), 0)}
          className="flex h-8 w-7 items-center justify-center rounded-lg border border-rose-500/25 bg-rose-500/10 text-xs font-bold text-rose-300 transition active:scale-90 hover:bg-rose-500/20"
          title={tx(lang, 'Sətiri sil', 'Удалить строку', 'Remove line')}
        >
          ✕
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
    sentItems, onVoidItem,
    readyCount, onTabChange,
    onBack, summerPromoEnabled, onUpdateNote,
    tableLabel, guestCount, waiterName,
    onPrintPreCheck, onOpenOperations, onUpdateGuestCount,
  } = props;

  const setLang = useAppStore((s) => s.setLang);
  const [sentSectionExpanded, setSentSectionExpanded] = useState(true);
  const [editingRowForNote, setEditingRowForNote] = useState<any>(null);
  const [currentNoteText, setCurrentNoteText] = useState('');
  const [mobileActiveTab, setMobileActiveTab] = useState<'menu' | 'cart'>('menu');

  const hasCartContent = draftRows.length > 0 || sentItems.length > 0;
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

  const draftItemCount = useMemo(() => {
    return draftRows.reduce((sum, r) => sum + Number(r.qty || 0), 0);
  }, [draftRows]);

  const activeSentCount = useMemo(() => {
    return sentItems.filter((it: any) => !['VOIDED', 'COMPED', 'WASTE'].includes(String(it.status || '').toUpperCase())).length;
  }, [sentItems]);

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
    defaultWidth: 400,
    minWidth: 320,
    maxWidth: 600,
  });

  return (
    <div
      ref={containerRef}
      style={{ '--cart-width': `${cartWidth}px` } as React.CSSProperties}
      className={`flex flex-col min-h-0 flex-1 gap-2 md:gap-0 overflow-hidden relative ${
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

        {/* Floating Mobile Bar */}
        {mobileActiveTab !== 'cart' && (draftRows.length > 0 || showCartPane) && (
          <div className="md:hidden shrink-0 mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setMobileActiveTab('cart')}
              className="flex-1 flex items-center justify-between bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 px-4 py-3.5 font-black text-sm rounded-2xl active:scale-[0.97] shadow-lg taktil-target"
            >
              {draftRows.length > 0 ? (
                <>
                  <span className="flex items-center gap-2">
                    🛒 {tx(lang, 'Çek', 'Чек', 'Check')}
                    <span className="rounded-full bg-slate-900/20 px-2 py-0.5 text-xs font-bold tabular-nums">{draftItemCount}</span>
                  </span>
                  <span className="text-base font-black tabular-nums">{grandTotal} ₼</span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-2">
                    🧾 {tx(lang, 'Cari Çek və Hesab', 'Чек и счёт', 'Check & Bill')}
                  </span>
                  <span className="text-base font-black tabular-nums">{sentTotal.toFixed(2)} ₼</span>
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
                className="shrink-0 flex items-center justify-center gap-1.5 bg-emerald-500 text-white px-4 py-3.5 font-black text-sm rounded-2xl active:scale-[0.97] shadow-lg taktil-target"
              >
                <Send size={15} />
                <span>{tx(lang, 'Göndər', 'Отправить', 'Send')}</span>
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

      {/* ─── RIGHT: Unified Live Check Panel (Cari Çek) ─── */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-xs transition-opacity duration-300 ${
          mobileActiveTab === 'cart' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileActiveTab('menu')}
      />

      <div
        className={`fixed bottom-0 left-0 right-0 z-50 h-[85dvh] rounded-t-[28px] border-t border-white/10 bg-[#14171b] shadow-[0_-20px_50px_rgba(0,0,0,0.65)] transition-transform duration-300 ease-out flex flex-col overflow-hidden md:relative md:bottom-auto md:left-auto md:right-auto md:z-auto md:h-full md:rounded-2xl md:border md:border-white/[0.08] md:bg-[#14171b] md:shadow-none md:translate-y-0 md:w-[var(--cart-width)] shrink-0 ${
          mobileActiveTab === 'cart' ? 'translate-y-0' : 'translate-y-full'
        } ${!showCartPane ? 'md:hidden' : ''}`}
      >
        {/* Mobile drag handle */}
        <div
          className="md:hidden shrink-0 w-full py-2.5 flex justify-center cursor-pointer bg-[#1a1d21] active:bg-slate-800/60 transition"
          onClick={() => setMobileActiveTab('menu')}
        >
          <div className="h-1.5 w-14 rounded-full bg-slate-600/80" />
        </div>

        {/* Behance 210280099 Order Details Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-white/[0.07] px-3.5 py-2.5 bg-[#1a1d21]">
          <div className="flex items-center gap-2 min-w-0">
            <Receipt size={15} className="text-[#F6B100] shrink-0" />
            <span className="text-xs font-black uppercase tracking-wider text-white truncate">
              {tx(lang, 'Sifariş Çeki', 'Детали заказа', 'Order Details')}
            </span>
            {(draftItemCount > 0 || activeSentCount > 0) && (
              <span className="rounded-md bg-[#262b33] px-1.5 py-0.5 text-[10px] font-bold text-slate-300 tabular-nums">
                {draftItemCount > 0
                  ? `+${draftItemCount} ${tx(lang, 'yeni', 'нов.', 'new')}`
                  : `${activeSentCount} ${tx(lang, 'məhsul', 'поз.', 'items')}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {draftRows.length > 0 && (
              <button
                type="button"
                onClick={onClearDrafts}
                className="text-[11px] font-bold text-rose-300 hover:text-rose-200 bg-rose-500/10 border border-rose-500/25 px-2 py-1 rounded-lg transition active:scale-95 flex items-center gap-1"
              >
                <Trash2 size={12} />
                <span>{tx(lang, 'Təmizlə', 'Очистить', 'Clear')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileActiveTab('menu')}
              className="md:hidden rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-bold text-slate-200 active:scale-95"
            >
              ← {tx(lang, 'Menyu', 'Меню', 'Menu')}
            </button>
          </div>
        </div>

        {/* ─── UNIFIED SCROLLABLE CHECK LIST (Both Draft & Sent Items Visible Together!) ─── */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2.5 space-y-2.5">
          {draftSendError && (
            <div className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-100">
              {draftSendError}
            </div>
          )}

          {/* 1. NEW DRAFTS SECTION (Yeni əlavələr) */}
          {draftRows.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                <span>{tx(lang, 'Yeni əlavələr (göndərilməyib)', 'Новые позиции (не отправлены)', 'New items (unsent)')}</span>
                <span className="tabular-nums">{draftTotal} ₼</span>
              </div>
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

          {/* 2. SENT KITCHEN ITEMS SECTION (Mətbəxə göndərilmişlər — Inline in the same receipt!) */}
          {sentItems.length > 0 && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setSentSectionExpanded((prev) => !prev)}
                className="flex w-full items-center justify-between rounded-lg bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 text-left transition hover:bg-slate-800/80"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300">
                    {tx(lang, 'Mətbəxə göndərilmişlər', 'Отправлено на кухню', 'Sent to kitchen')} ({sentItems.length})
                  </span>
                  {(() => {
                    const readyItemCount = sentItems.filter((it: any) => String(it.status || '').toUpperCase() === 'READY').length;
                    if (readyItemCount > 0) {
                      return (
                        <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.2 text-[9px] font-black text-emerald-300">
                          ✓ {readyItemCount} {tx(lang, 'Hazır', 'Готово', 'Ready')}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 tabular-nums">
                  <span>{sentTotal.toFixed(2)} ₼</span>
                  {sentSectionExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </button>

              {sentSectionExpanded && (
                <div className="space-y-1 pt-0.5">
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
                        status === 'VOID_REQUESTED' ? 'bg-yellow-400' :
                        status === 'SERVED' ? 'bg-violet-400' :
                        isTerminal ? 'bg-slate-600' :
                        'bg-sky-400';
                      const statusLabel =
                        status === 'READY' ? tx(lang, 'Hazır', 'Готово', 'Ready') :
                        status === 'PREPARING' ? tx(lang, 'Hazırlanır', 'Готовится', 'Prep') :
                        status === 'VOID_REQUESTED' ? tx(lang, 'Gözləyir', 'Ожидает', 'Pending') :
                        status === 'SERVED' ? tx(lang, 'Verilib', 'Подано', 'Served') :
                        status === 'VOIDED' ? tx(lang, 'Ləğv', 'Отменено', 'Void') :
                        status === 'COMPED' ? tx(lang, 'Silinib', 'Списано', 'Comp') :
                        status === 'WASTE' ? tx(lang, 'İsraf', 'Списано', 'Waste') :
                        tx(lang, 'Mətbəxdə', 'На кухне', 'Kitchen');
                      const canVoid = ['SENT', 'PREPARING', 'READY'].includes(status) && it.id;
                      const price = new Decimal(it.price || 0).times(it.qty || 0).toFixed(2);
                      return (
                        <div
                          key={`sent_${it.id || idx}`}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                            isTerminal
                              ? 'border-slate-800/40 bg-slate-900/20 opacity-40 line-through'
                              : 'border-slate-800/80 bg-slate-900/45'
                          }`}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} title={statusLabel} />
                            <span className="font-black text-slate-300 tabular-nums shrink-0">{it.qty}×</span>
                            <span className="truncate font-semibold text-slate-200">{it.item_name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-medium text-slate-400 hidden sm:inline">{statusLabel}</span>
                            <span className="font-bold text-slate-200 tabular-nums">{price} ₼</span>
                            {canVoid && onVoidItem && (
                              <button
                                type="button"
                                onClick={() => onVoidItem(it)}
                                className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-300 transition active:scale-90 hover:bg-rose-500/20"
                              >
                                {tx(lang, 'Ləğv', 'Отм.', 'Void')}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Empty Check State */}
          {draftRows.length === 0 && sentItems.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-xs font-semibold text-slate-500 flex flex-col items-center justify-center gap-2 my-auto">
              <Receipt size={24} className="text-slate-600" />
              <span>{tx(lang, 'Sifariş əlavə etmək üçün sol menyudan məhsula toxunun', 'Нажмите на блюдо слева, чтобы добавить в заказ', 'Tap an item on the left menu to add to the check')}</span>
            </div>
          )}
        </div>

        {/* ─── Behance 210280099 Receipt Summary & Primary Action Footer ─── */}
        <div className="shrink-0 border-t border-white/[0.08] p-3 bg-[#1a1d21] space-y-2.5">
          {/* Compact Financial Summary with Dashed Receipt Divider */}
          <div className="space-y-1.5 px-1">
            {sentItems.length > 0 && draftRows.length > 0 && (
              <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums pb-1 border-b border-dashed border-white/10">
                <span>{tx(lang, 'Cari hesab', 'Текущий счёт', 'Current bill')}: {sentTotal.toFixed(2)} ₼</span>
                <span className="text-[#F6B100] font-semibold">+{tx(lang, 'Yeni', 'Новые', 'New')}: {draftTotal} ₼</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm font-bold text-slate-100 tabular-nums">
              <span className="text-slate-300">{tx(lang, 'Yekun Cəm', 'Итого к оплате', 'Grand Total')}</span>
              <span className="text-lg font-black text-[#F6B100]">{grandTotal} ₼</span>
            </div>
          </div>

          {/* Primary Actions: 1. Mətbəxə Göndər (when drafts exist)  2. Aralıq Hesab & Hesabı Al */}
          <div className="flex flex-col gap-1.5">
            {draftRows.length > 0 && (
              <button
                type="button"
                disabled={!userCanEdit}
                onClick={() => { void onSend(); }}
                className="relative inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F6B100] px-4 text-sm font-black text-slate-950 shadow-md transition active:scale-[0.98] disabled:opacity-50 taktil-target hover:brightness-105"
              >
                <Send size={16} />
                <span>{tx(lang, 'Mətbəxə Göndər', 'Отправить на кухню', 'Send to Kitchen')}</span>
                <span className="rounded-md bg-slate-950/15 px-2 py-0.5 text-xs font-black tabular-nums">
                  {draftTotal} ₼
                </span>
              </button>
            )}

            {tableOccupied && (
              <div className="flex gap-2">
                {onPrintPreCheck && (
                  <button
                    type="button"
                    onClick={() => {
                      tapFeedback();
                      void onPrintPreCheck();
                    }}
                    className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 text-xs font-bold text-slate-200 transition active:scale-[0.98] taktil-target hover:bg-slate-700 hover:text-white"
                    title={tx(lang, 'Müştəri üçün aralıq hesab (pre-check) çap et', 'Печать предчека', 'Print interim pre-check')}
                  >
                    <Printer size={15} className="text-cyan-400" />
                    <span>{tx(lang, 'Aralıq hesab', 'Предчек', 'Pre-check')}</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={!userCanEdit || (sentItems.length === 0 && draftRows.length === 0)}
                  onClick={() => {
                    tapFeedback();
                    onSettle('Nəğd', 0);
                  }}
                  className={`inline-flex flex-[1.35] items-center justify-center gap-1.5 rounded-xl px-3 text-xs sm:text-sm font-black transition active:scale-[0.98] disabled:opacity-40 taktil-target ${
                    draftRows.length === 0
                      ? 'h-12 bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20'
                      : 'h-11 border border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                  }`}
                >
                  <Banknote size={16} />
                  <span>{tx(lang, 'Hesabı Al', 'Оплата / Счёт', 'Pay / Settle')}</span>
                  <span className="tabular-nums">({grandTotal} ₼)</span>
                </button>
              </div>
            )}

            {!tableOccupied && draftRows.length === 0 && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-800/70 px-3 text-xs font-bold text-slate-200 transition active:scale-[0.98]"
              >
                ← {tx(lang, 'Masalara qayıt', 'Назад к столам', 'Back to tables')}
              </button>
            )}
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
