import React, { memo, useMemo, useRef, useState } from 'react';
import { Users, Clock, Utensils, Sparkles } from 'lucide-react';
import { Decimal } from 'decimal.js';
import { tx } from '../../i18n';
import { playHapticTouch, playHapticHeavy, playHapticSuccess } from '../../lib/haptics';

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
  showMyTablesFilter,
}: TableGridProps) {
  const [quickActionsTableId, setQuickActionsTableId] = useState<string | null>(null);
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const longPressRef = useRef<number | null>(null);

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
    if (!showOnlyMine || !currentUsername) return floorTables;
    return floorTables.filter((table) => {
      const localTable = tablesById[String(table.id)] || null;
      const holder = String((table as any).locked_by || localTable?.assigned_to || '').trim().toLowerCase();
      return holder === currentUsername.toLowerCase();
    });
  }, [floorTables, tablesById, showOnlyMine, currentUsername]);

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
    <div className="space-y-4">
      {/* ═══ Header: Search + Filter + Stats ═══ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            type="text"
            className="neon-input w-full py-2.5 pl-10 pr-4 text-sm"
            placeholder={tx(lang, 'Masa axtar...', 'Поиск стола...', 'Search table...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Utensils size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        </div>

        <div className="flex items-center gap-2">
          {showMyTablesFilter && currentUsername && (
            <button
              type="button"
              onClick={() => { playHapticTouch(); setShowOnlyMine(!showOnlyMine); }}
              className={`shrink-0 rounded-full px-5 py-3 text-sm font-black transition-all active:scale-95 ${
                showOnlyMine
                  ? 'bg-gradient-to-r from-amber-400 to-yellow-400 text-slate-900 shadow-lg shadow-yellow-400/25'
                  : 'border-2 border-yellow-400/50 bg-yellow-500/10 text-yellow-200 shadow-md shadow-yellow-500/10'
              }`}
            >
              {showOnlyMine ? '★ ' : ''}{tx(lang, 'Mənim masalarım', 'Мои столы', 'My tables')}
            </button>
          )}

          {/* Live stats pills */}
          <div className="hidden items-center gap-1.5 sm:flex">
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold text-emerald-300">{stats.available} {tx(lang, 'boş', 'св.', 'free')}</span>
            <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-[10px] font-bold text-violet-300">{stats.occupied} {tx(lang, 'dolu', 'зан.', 'busy')}</span>
            {stats.reserved > 0 && <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold text-amber-300">{stats.reserved} {tx(lang, 'rezerv', 'бр.', 'res.')}</span>}
          </div>
        </div>
      </div>

      {/* ═══ Table Grid ═══ */}
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
          const displayedTotal = new Decimal(activeTableState.check_total || activeLocalTable?.total || 0);
          const readyCount = Number(readyCountsByLabel[String(table.label || '').trim()] || 0);
          const isSelected = viewTableId === table.id;
          const guestCount = Number(activeTableState.guest_count || 0);
          const capacity = Number(table.capacity || 4);

          // Premium status styling
          const statusConfig: Record<string, { bg: string; border: string; glow: string; dot: string; label: string }> = {
            AVAILABLE: { bg: 'from-emerald-500/8 to-emerald-600/4', border: 'border-emerald-400/25', glow: '', dot: 'bg-emerald-400', label: tx(lang, 'Boş', 'Свободен', 'Free') },
            RESERVED: { bg: 'from-amber-500/10 to-amber-600/5', border: 'border-amber-400/30', glow: 'shadow-[0_0_20px_rgba(245,158,11,0.08)]', dot: 'bg-amber-400', label: tx(lang, 'Rezerv', 'Забронирован', 'Reserved') },
            SEATED: { bg: 'from-rose-500/10 to-rose-600/5', border: 'border-rose-400/25', glow: '', dot: 'bg-rose-400', label: tx(lang, 'Oturan', 'Сидят', 'Seated') },
            ACTIVE_CHECK: { bg: 'from-violet-500/10 to-violet-600/5', border: 'border-violet-400/30', glow: 'shadow-[0_0_24px_rgba(139,92,246,0.1)]', dot: 'bg-violet-400', label: tx(lang, 'Aktiv', 'Активен', 'Active') },
            DIRTY: { bg: 'from-slate-500/8 to-slate-600/4', border: 'border-slate-400/20', glow: '', dot: 'bg-slate-400', label: tx(lang, 'Təmizlik', 'Уборка', 'Dirty') },
          };
          const cfg = statusConfig[status] || statusConfig.AVAILABLE;

          return (
            <div
              key={table.id}
              role="button"
              tabIndex={0}
              aria-label={`${table.label}, ${cfg.label}, ${guestCount}/${capacity} ${tx(lang, 'nəfər', 'гостей', 'guests')}${displayedTotal.greaterThan(0) ? `, ${displayedTotal.toFixed(2)} ₼` : ''}`}
              onClick={() => { playHapticTouch(); setQuickActionsTableId(null); onSelectTable(table); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playHapticTouch(); onSelectTable(table); } }}
              onTouchStart={() => { clearLongPress(); longPressRef.current = window.setTimeout(() => { playHapticHeavy(); setQuickActionsTableId(table.id); }, 450); }}
              onTouchEnd={clearLongPress}
              onMouseDown={() => { clearLongPress(); longPressRef.current = window.setTimeout(() => { playHapticHeavy(); setQuickActionsTableId(table.id); }, 450); }}
              onMouseUp={clearLongPress}
              onMouseLeave={clearLongPress}
              className={`group relative overflow-hidden rounded-[22px] border p-3.5 transition-all duration-200 active:scale-[0.97] ${cfg.border} ${cfg.glow} ${
                isSelected ? 'ring-2 ring-yellow-300/70 shadow-[0_0_30px_rgba(250,204,21,0.15)]' : ''
              } ${isMyTable && showMyTablesFilter ? 'ring-1 ring-yellow-400/40' : ''}`}
              style={{
                background: `linear-gradient(145deg, ${status === 'AVAILABLE' ? 'rgba(16,185,129,0.06)' : status === 'ACTIVE_CHECK' ? 'rgba(139,92,246,0.08)' : status === 'RESERVED' ? 'rgba(245,158,11,0.07)' : status === 'SEATED' ? 'rgba(244,63,94,0.07)' : 'rgba(100,116,139,0.06)'}, rgba(15,23,42,0.4))`,
                backdropFilter: 'blur(8px)',
              }}
            >
              {/* Glossy top edge */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px]" style={{ background: 'linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.08) 50%, transparent 90%)' }} />

              {/* Ready badge — pulsing */}
              {readyCount > 0 && (
                <div className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-black text-white shadow-lg shadow-emerald-500/30 animate-pulse">
                  <Sparkles size={9} />
                  {readyCount}
                </div>
              )}

              {/* Table label */}
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot}`} aria-hidden="true" />
                <h3 className="text-[15px] font-black text-white">{table.label}</h3>
                <span className="ml-auto text-[9px] font-bold uppercase tracking-wider" style={{ color: cfg.dot.replace('bg-', '').includes('emerald') ? '#6ee7b7' : cfg.dot.replace('bg-', '').includes('violet') ? '#c4b5fd' : cfg.dot.replace('bg-', '').includes('amber') ? '#fcd34d' : cfg.dot.replace('bg-', '').includes('rose') ? '#fda4af' : '#94a3b8' }}>
                  {cfg.label}
                </span>
              </div>

              {/* Guest + capacity */}
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                <Users size={11} />
                <span className={guestCount > 0 ? 'font-semibold text-slate-200' : ''}>{guestCount}/{capacity}</span>
              </div>

              {/* Total amount */}
              {displayedTotal.greaterThan(0) && (
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-[17px] font-black text-white">{displayedTotal.toFixed(2)}</span>
                  <span className="text-[11px] font-bold text-slate-400">₼</span>
                </div>
              )}

              {/* Waiter badge */}
              {tableLockHolder && (
                <div className={`mt-2 truncate rounded-lg px-2 py-1 text-[10px] font-bold ${isMyTable ? 'bg-yellow-400/10 text-yellow-300' : 'bg-slate-700/30 text-slate-400'}`}>
                  👤 {tableLockHolder}
                </div>
              )}

              {/* Group badge */}
              {mergedGroupId && (
                <div className="mt-1.5 rounded-lg bg-violet-500/10 px-2 py-0.5 text-[9px] font-bold text-violet-300">
                  ⚡ {tx(lang, 'Qrup', 'Группа', 'Group')}
                </div>
              )}

              {/* Dirty → Clean button */}
              {status === 'DIRTY' && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); playHapticSuccess(); setQuickActionsTableId(null); onMarkClean(table.id); }}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/8 px-3 py-2.5 text-[11px] font-black text-white backdrop-blur transition active:scale-[0.97]"
                >
                  ✨ {tx(lang, 'Təmizlə', 'Очистить', 'Mark clean')}
                </button>
              )}
            </div>
          );
        })}

        {searchedTables.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-700/40 py-12 text-center">
            <Utensils size={28} className="text-slate-600" />
            <p className="text-sm text-slate-500">{tx(lang, 'Masa tapılmadı', 'Столы не найдены', 'No tables found')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(TableGrid);
