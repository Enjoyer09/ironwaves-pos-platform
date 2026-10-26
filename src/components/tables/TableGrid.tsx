import React, { memo, useMemo, useRef, useState } from 'react';
import { Users, Clock, Utensils, Sparkles, Plus } from 'lucide-react';
import { Decimal } from 'decimal.js';
import { tx } from '../../i18n';
import { playHapticTouch, playHapticHeavy, playHapticSuccess } from '../../lib/haptics';
import { TABLE_STATUS_LABELS, TABLE_STATUS_THEME } from '../../utils/tables/floorUtils';

type TableGridProps = {
  floorTables: any[];
  tablesById: Record<string, any>;
  readyCountsByLabel: Record<string, number>;
  viewTableId: string | null;
  tableGridMinWidth: number;
  lang: string;
  currentUsername?: string;
  currentUserRole?: string;
  onSelectTable: (table: any) => void;
  onMarkClean: (tableId: string) => void;
  onQuickPay?: (tableId: string, method: 'Nəğd' | 'Kart') => void;
  showMyTablesFilter?: boolean;
};

const tapFeedback = () => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(10);
  } catch {}
};

function TableGrid({
  floorTables,
  tablesById,
  readyCountsByLabel,
  viewTableId,
  tableGridMinWidth,
  lang,
  currentUsername,
  currentUserRole,
  onSelectTable,
  onMarkClean,
  onQuickPay,
  showMyTablesFilter,
}: TableGridProps) {
  const [quickActionsTableId, setQuickActionsTableId] = useState<string | null>(null);
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const longPressRef = useRef<number | null>(null);

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'AVAILABLE' | 'OCCUPIED'>('ALL');

  const isManagerUser = useMemo(
    () => ['admin', 'manager', 'super_admin'].includes(String(currentUserRole || '').toLowerCase()),
    [currentUserRole],
  );

  const clearLongPress = () => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const visibleTables = useMemo(() => {
    let list = floorTables;
    if (showOnlyMine && currentUsername) {
      list = list.filter((table) => {
        const localTable = tablesById[String(table.id)] || null;
        const holder = String((table as any).locked_by || localTable?.assigned_to || '').trim().toLowerCase();
        return holder === currentUsername.toLowerCase();
      });
    }
    if (statusFilter !== 'ALL') {
      list = list.filter((table) => {
        const localTable = tablesById[String(table.id)] || null;
        const s = String(table.status || '').toUpperCase();
        const hasCheck = Boolean(localTable?.is_occupied || new Decimal(localTable?.total || 0).greaterThan(0) || s === 'ACTIVE_CHECK' || s === 'SEATED');
        return statusFilter === 'OCCUPIED' ? hasCheck : !hasCheck;
      });
    }
    return list;
  }, [floorTables, tablesById, showOnlyMine, currentUsername, statusFilter]);

  const searchedTables = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return visibleTables;
    return visibleTables.filter((table) =>
      String(table.label || '').toLowerCase().includes(query)
    );
  }, [visibleTables, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    let available = 0, occupied = 0, reserved = 0;
    floorTables.forEach((table) => {
      const localTable = tablesById[String(table.id)] || null;
      const s = String(table.status || '').toUpperCase();
      const hasCheck = Boolean(localTable?.is_occupied || new Decimal(localTable?.total || 0).greaterThan(0));
      if (hasCheck || s === 'ACTIVE_CHECK' || s === 'SEATED') occupied++;
      else if (s === 'RESERVED') reserved++;
      else available++;
    });
    return { available, occupied, reserved, total: floorTables.length };
  }, [floorTables, tablesById]);

  return (
    <div className="space-y-3.5">
      {/* ═══ Behance 210280099 Style Top Filter Bar: Search + Status Tabs (All / Available / Booked) ═══ */}
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            className="h-10 w-full rounded-xl border border-white/10 bg-[#1a1d21] pl-9 pr-4 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-[#F6B100] focus:outline-none"
            placeholder={tx(lang, 'Masa axtar...', 'Поиск стола...', 'Search table...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Utensils size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        </div>

        {/* Status Segmented Tabs (Behance 210280099 Tables Filter) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-xl bg-[#1a1d21] p-1 border border-white/[0.08]">
            <button
              type="button"
              onClick={() => { playHapticTouch(); setStatusFilter('ALL'); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition whitespace-nowrap shrink-0 tabular-nums ${
                statusFilter === 'ALL'
                  ? 'bg-[#2a2f37] text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tx(lang, 'Hamısı', 'Все', 'All')} ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => { playHapticTouch(); setStatusFilter('AVAILABLE'); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition whitespace-nowrap shrink-0 tabular-nums ${
                statusFilter === 'AVAILABLE'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-emerald-300'
              }`}
            >
              {tx(lang, 'Boş', 'Свободно', 'Available')} ({stats.available})
            </button>
            <button
              type="button"
              onClick={() => { playHapticTouch(); setStatusFilter('OCCUPIED'); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition whitespace-nowrap shrink-0 tabular-nums ${
                statusFilter === 'OCCUPIED'
                  ? 'bg-[#F6B100] text-slate-950'
                  : 'text-slate-400 hover:text-amber-300'
              }`}
            >
              {tx(lang, 'Dolu', 'Занято', 'Occupied')} ({stats.occupied})
            </button>
          </div>

          {showMyTablesFilter && currentUsername && (
            <button
              type="button"
              onClick={() => { playHapticTouch(); setShowOnlyMine(!showOnlyMine); }}
              className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold transition-all active:scale-95 whitespace-nowrap border ${
                showOnlyMine
                  ? 'bg-[#F6B100] text-slate-950 border-[#F6B100] shadow-sm'
                  : 'border-white/10 bg-[#1a1d21] text-slate-300 hover:text-white'
              }`}
            >
              {showOnlyMine ? '★ ' : ''}{tx(lang, 'Mənim masalarım', 'Мои столы', 'My tables')}
            </button>
          )}
        </div>
      </div>

      {/* ═══ Behance 210280099 High-Density Table Cards Grid ═══ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {searchedTables.map((table) => {
          const localTable = tablesById[String(table.id)] || null;

          // Merged group resolution
          const mergedGroupId = String((localTable as any)?.merged_group_id || '').trim();
          const groupTables = mergedGroupId
            ? floorTables.filter((r) => String(r.merged_group_id || '').trim() === mergedGroupId)
            : [];
          const occupiedTableInGroup = groupTables.find((r) => tablesById[String(r.id)]?.is_occupied);
          const activeLocalTable = occupiedTableInGroup ? tablesById[String(occupiedTableInGroup.id)] : localTable;
          const activeTableState = occupiedTableInGroup || table;

          const tableLockHolder = String((activeTableState as any).locked_by || activeLocalTable?.assigned_to || '').trim();
          const isMyTable = Boolean(currentUsername && tableLockHolder.toLowerCase() === currentUsername.toLowerCase());
          const floorStatus = String(activeTableState.status || '').toUpperCase();
          const hasLocalActiveCheck = Boolean(activeLocalTable?.is_occupied || new Decimal(activeLocalTable?.total || 0).greaterThan(0));
          const status = hasLocalActiveCheck && (!floorStatus || floorStatus === 'AVAILABLE')
            ? 'ACTIVE_CHECK'
            : (floorStatus || 'AVAILABLE');
          const isOccupiedState = hasLocalActiveCheck || status === 'ACTIVE_CHECK' || status === 'OCCUPIED' || status === 'SEATED';
          const displayedTotal = new Decimal(activeTableState.check_total || activeLocalTable?.total || 0);
          const readyCount = Number(readyCountsByLabel[String(table.label || '').trim()] || 0);
          const isSelected = viewTableId === table.id;
          const guestCount = Number(activeTableState.guest_count || 0);
          const capacity = Number(table.capacity || 4);

          const labelRow = TABLE_STATUS_LABELS[status] || TABLE_STATUS_LABELS.AVAILABLE;
          const statusText = tx(lang, labelRow.az, labelRow.ru, labelRow.en);
          const waiterInitials = tableLockHolder
            ? tableLockHolder.slice(0, 2).toUpperCase()
            : String(table.label || 'M').replace(/[^0-9A-Za-z]/g, '').slice(-2).toUpperCase() || 'M';

          return (
            <div
              key={table.id}
              role="button"
              tabIndex={0}
              aria-label={`${table.label}, ${statusText}, ${guestCount}/${capacity} ${tx(lang, 'nəfər', 'гостей', 'guests')}${displayedTotal.greaterThan(0) ? `, ${displayedTotal.toFixed(2)} ₼` : ''}`}
              onClick={() => { playHapticTouch(); setQuickActionsTableId(null); onSelectTable(table); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playHapticTouch(); onSelectTable(table); } }}
              onTouchStart={() => { clearLongPress(); longPressRef.current = window.setTimeout(() => { playHapticHeavy(); setQuickActionsTableId(table.id); }, 450); }}
              onTouchEnd={clearLongPress}
              onMouseDown={() => { clearLongPress(); longPressRef.current = window.setTimeout(() => { playHapticHeavy(); setQuickActionsTableId(table.id); }, 450); }}
              onMouseUp={clearLongPress}
              onMouseLeave={clearLongPress}
              className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-4 transition-all duration-150 active:scale-[0.98] cursor-pointer select-none shadow-sm ${
                isOccupiedState
                  ? 'border-amber-500/40 bg-gradient-to-br from-[#241a0d]/90 to-[#141822]/95 hover:border-amber-400/80 shadow-md shadow-amber-500/10'
                  : status === 'DIRTY'
                  ? 'border-rose-500/40 bg-gradient-to-br from-[#240e14]/90 to-[#141822]/95 hover:border-rose-400/70'
                  : 'border-emerald-500/25 bg-gradient-to-br from-[#0c221a]/60 to-[#121824]/90 hover:border-emerald-500/60 hover:bg-[#142324]'
              } ${isSelected ? 'ring-2 ring-amber-400' : ''}`}
            >
              {/* Row 1: Table Name + Status Badge (Behance 210280099 Header) */}
              <div className="flex items-center justify-between gap-1.5">
                <h3 className="text-base font-extrabold text-white tracking-tight truncate">
                  {table.label}
                </h3>
                {readyCount > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-xs font-black text-slate-950 shadow-sm">
                    <Sparkles size={11} />
                    {readyCount} {tx(lang, 'Hazır', 'Готово', 'Ready')}
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-black whitespace-nowrap tracking-wide ${
                      isOccupiedState
                        ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
                        : status === 'DIRTY'
                        ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
                        : 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {statusText}
                  </span>
                )}
              </div>

              {/* Row 2: Center Avatar / Waiter & Guest Info (Behance 210280099 Center Block) */}
              <div className="my-3 flex items-center gap-2.5">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-black tracking-wider ${
                    isOccupiedState
                      ? 'bg-[#F6B100] text-slate-950 shadow-sm'
                      : 'bg-[#262b33] text-slate-300 border border-white/10'
                  }`}
                >
                  {waiterInitials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-slate-200">
                    {tableLockHolder || tx(lang, 'Ofisiant yoxdur', 'Без официанта', 'Unassigned')}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400 tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <Users size={11} />
                      <span>{guestCount}/{capacity}</span>
                    </span>
                    {(() => {
                      const lockedAt = (activeTableState as any).locked_at || (table as any).locked_at || null;
                      if (!isOccupiedState || !lockedAt) return null;
                      const elapsed = Math.max(1, Math.floor((Date.now() - new Date(lockedAt).getTime()) / 60000));
                      if (elapsed <= 0 || elapsed > 1440) return null;
                      return (
                        <span className={`inline-flex items-center gap-0.5 font-semibold ${elapsed >= 60 ? 'text-amber-300' : 'text-slate-400'}`}>
                          · <Clock size={10} />
                          {elapsed >= 60 ? `${Math.floor(elapsed / 60)}s ${elapsed % 60}d` : `${elapsed}d`}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Row 3: Bill Total + Quick Pay or Open Table */}
              {displayedTotal.greaterThan(0) ? (
                <div className="border-t border-white/[0.07] pt-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">{tx(lang, 'Cari hesab', 'Счёт', 'Total')}</span>
                    <span className="text-base font-black text-[#F6B100] tabular-nums">{displayedTotal.toFixed(2)} ₼</span>
                  </div>
                  {onQuickPay && (!tableLockHolder || isMyTable || isManagerUser) && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playHapticTouch();
                          onQuickPay(String(activeLocalTable?.id || table.id), 'Nəğd');
                        }}
                        title={tx(lang, 'Nağd ödəniş pəncərəsini birbaşa aç', 'Открыть оплату наличными', 'Quick pay with Cash')}
                        className="flex items-center justify-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2 py-1.5 text-[11px] font-extrabold text-emerald-300 transition hover:bg-emerald-500/25 active:scale-95 whitespace-nowrap"
                      >
                        <span>{tx(lang, 'Nağd', 'Нал', 'Cash')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playHapticTouch();
                          onQuickPay(String(activeLocalTable?.id || table.id), 'Kart');
                        }}
                        title={tx(lang, 'Kart ödəniş pəncərəsini birbaşa aç', 'Открыть оплату картой', 'Quick pay with Card')}
                        className="flex items-center justify-center gap-1 rounded-lg border border-sky-500/35 bg-sky-500/15 px-2 py-1.5 text-[11px] font-extrabold text-sky-300 transition hover:bg-sky-500/25 active:scale-95 whitespace-nowrap"
                      >
                        <span>{tx(lang, 'Kart', 'Карта', 'Card')}</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : status === 'DIRTY' ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); playHapticSuccess(); setQuickActionsTableId(null); onMarkClean(table.id); }}
                  className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white transition active:scale-[0.97]"
                >
                  {tx(lang, 'Təmizlə', 'Очистить', 'Mark clean')}
                </button>
              ) : (
                <div className="border-t border-emerald-500/20 pt-2.5 flex items-center justify-between text-xs font-black text-emerald-300 group-hover:text-emerald-200">
                  <span className="flex items-center gap-1.5"><Plus size={14} className="stroke-[3]" />{tx(lang, 'Sifariş aç', 'Открыть стол', 'Open table')}</span>
                  <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-black">→</span>
                </div>
              )}
            </div>
          );
        })}

        {searchedTables.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-[#1a1d21]/50 py-12 px-4 text-center">
            <Utensils size={28} className="text-slate-500" />
            <p className="text-sm font-semibold text-slate-300">
              {searchQuery.trim().length > 0 || showOnlyMine || statusFilter !== 'ALL'
                ? tx(lang, 'Seçilmiş filtr üzrə masa tapılmadı', 'По выбранному фильтру столы не найдены', 'No tables match your current filter')
                : tx(lang, 'Bu zalda masa yoxdur', 'В этом зале нет столов', 'No tables in this hall')}
            </p>
            {(searchQuery.trim().length > 0 || showOnlyMine || statusFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  playHapticTouch();
                  setSearchQuery('');
                  setShowOnlyMine(false);
                  setStatusFilter('ALL');
                }}
                className="mt-1 rounded-xl border border-[#F6B100]/50 bg-[#F6B100]/15 px-4 py-2 text-xs font-bold text-[#F6B100] hover:bg-[#F6B100]/25 transition active:scale-95"
              >
                {tx(lang, 'Filtrləri sıfırla', 'Сбросить фильтры', 'Reset filters')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(TableGrid);
