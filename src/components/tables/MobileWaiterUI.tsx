import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, Utensils, Bell, BellOff, RefreshCw, Users, Clock, Star, 
  ChevronRight, X, Sparkles, SlidersHorizontal, Smartphone, Grid,
  Receipt, ArrowUpDown, Volume2, VolumeX, CheckCircle2, UserCheck
} from 'lucide-react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import { ImpactStyle } from '@capacitor/haptics';
import { nativeHapticImpact } from '../../lib/customer_utils';
import { playKitchenReadyAlert, playHapticTouch, playHapticSuccess } from '../../lib/haptics';

type MobileWaiterUIProps = {
  lang: string;
  user: any;
  tables: any[];
  floorPlans: any[];
  activeFloorId: string;
  setActiveFloorId: (id: string) => void;
  kitchenOrders: any[];
  onOpenTable: (tableId: string, guestCount: string) => Promise<void>;
  onSelectTable: (table: any) => void;
  onFastSwitch: () => void;
  refreshData: () => void;
  onPrintPreCheck?: (table: any) => void | Promise<void>;
};

export default function MobileWaiterUI({
  lang,
  user,
  tables,
  floorPlans,
  activeFloorId,
  setActiveFloorId,
  kitchenOrders,
  onOpenTable,
  onSelectTable,
  onFastSwitch,
  refreshData,
  onPrintPreCheck,
}: MobileWaiterUIProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'mine' | 'free' | 'occupied' | 'ready' | 'bill'>('all');
  const [quickOpenTable, setQuickOpenTable] = useState<any | null>(null);
  const [quickGuestCount, setQuickGuestCount] = useState('2');
  const [openingLoading, setOpeningLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [kitchenAlertToast, setKitchenAlertToast] = useState<{ tableLabel: string; count: number } | null>(null);

  // Sound preference for kitchen ready notifications
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('iw_waiter_sound_enabled');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  // Mobile layout density: 'comfort' (2-column large cards) vs 'compact' (3-column cards)
  const [mobileGridMode, setMobileGridMode] = useState<'comfort' | 'compact'>(() => {
    try {
      const saved = localStorage.getItem('iw_waiter_grid_mode');
      return (saved === 'compact' || saved === 'comfort') ? saved : 'comfort';
    } catch {
      return 'comfort';
    }
  });

  const currentUsername = String(user?.username || '').toLowerCase().trim();

  // Save sound setting
  const toggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('iw_waiter_sound_enabled', String(next)); } catch {}
      if (next) playKitchenReadyAlert();
      return next;
    });
  };

  // Save grid setting
  const toggleGridMode = () => {
    setMobileGridMode(prev => {
      const next = prev === 'comfort' ? 'compact' : 'comfort';
      try { localStorage.setItem('iw_waiter_grid_mode', next); } catch {}
      return next;
    });
  };

  // Kitchen Ready Tables calculation & ready item count per table
  const { readyTableIds, readyCountMap } = useMemo(() => {
    const ids = new Set<string>();
    const countMap = new Map<string, number>();

    kitchenOrders.forEach((order: any) => {
      if (String(order.status || '').toUpperCase() === 'READY') {
        const matchingTable = tables.find(t => String(t.label || '').trim().toLowerCase() === String(order.table_label || '').trim().toLowerCase());
        if (matchingTable) {
          ids.add(matchingTable.id);
          const currentCount = countMap.get(matchingTable.id) || 0;
          const orderItemsQty = Array.isArray(order.items) 
            ? order.items.reduce((sum: number, it: any) => sum + Number(it.qty || 1), 0)
            : 1;
          countMap.set(matchingTable.id, currentCount + orderItemsQty);
        }
      }
    });
    return { readyTableIds: ids, readyCountMap: countMap };
  }, [kitchenOrders, tables]);

  // Audio and Toast alert when a new table turns READY
  const prevReadyIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentReadyIds = readyTableIds;
    const newReadyTableId = Array.from(currentReadyIds).find(id => !prevReadyIdsRef.current.has(id));
    
    if (newReadyTableId && prevReadyIdsRef.current.size > 0) {
      const targetTable = tables.find(t => t.id === newReadyTableId);
      if (targetTable) {
        if (soundEnabled) {
          playKitchenReadyAlert();
        }
        nativeHapticImpact(ImpactStyle.Heavy);
        const count = readyCountMap.get(newReadyTableId) || 1;
        setKitchenAlertToast({ tableLabel: targetTable.label, count });
        const timer = window.setTimeout(() => {
          setKitchenAlertToast(null);
        }, 5000);
        return () => window.clearTimeout(timer);
      }
    }
    prevReadyIdsRef.current = new Set(currentReadyIds);
  }, [readyTableIds, soundEnabled, tables, readyCountMap]);

  // Count summaries
  const myTablesCount = useMemo(() => {
    if (!currentUsername) return 0;
    return tables.filter(t => {
      const assigned = String(t.assigned_to || t.locked_by || '').toLowerCase().trim();
      return assigned === currentUsername;
    }).length;
  }, [tables, currentUsername]);

  const freeCount = useMemo(() => tables.filter(t => !t.is_occupied).length, [tables]);
  const occupiedCount = useMemo(() => tables.filter(t => t.is_occupied).length, [tables]);
  const readyCount = readyTableIds.size;
  const billRequestedCount = useMemo(() => {
    return tables.filter(t => {
      const st = String(t.status || '').toUpperCase();
      return st === 'PRECHECK' || st === 'BILL' || Boolean((t as any).is_precheck);
    }).length;
  }, [tables]);

  // Floor plan table counts
  const floorCounts = useMemo(() => {
    const map = new Map<string, { total: number; occupied: number }>();
    tables.forEach(t => {
      const fpId = t.floor_plan_id || 'unassigned';
      const curr = map.get(fpId) || { total: 0, occupied: 0 };
      curr.total += 1;
      if (t.is_occupied) curr.occupied += 1;
      map.set(fpId, curr);
    });
    return map;
  }, [tables]);

  // Filtered tables
  const filteredTables = useMemo(() => {
    return tables.filter(t => {
      // Floor filter
      if (activeFloorId && t.floor_plan_id && t.floor_plan_id !== activeFloorId) {
        return false;
      }
      // Search term
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        if (!t.label.toLowerCase().includes(query)) return false;
      }
      // Status filter
      if (statusFilter === 'mine') {
        const assigned = String(t.assigned_to || t.locked_by || '').toLowerCase().trim();
        return assigned === currentUsername;
      }
      if (statusFilter === 'free') return !t.is_occupied;
      if (statusFilter === 'occupied') return t.is_occupied;
      if (statusFilter === 'ready') return readyTableIds.has(t.id);
      if (statusFilter === 'bill') {
        const st = String(t.status || '').toUpperCase();
        return st === 'PRECHECK' || st === 'BILL' || Boolean((t as any).is_precheck);
      }

      return true;
    });
  }, [tables, activeFloorId, searchTerm, statusFilter, readyTableIds, currentUsername]);

  const handleTableTap = async (table: any) => {
    await nativeHapticImpact(ImpactStyle.Light);
    if (!table.is_occupied) {
      setQuickOpenTable(table);
      setQuickGuestCount(String(table.capacity || 2));
    } else {
      onSelectTable(table);
    }
  };

  const handleQuickSelectAndOpen = async (guestCount: string) => {
    if (!quickOpenTable) return;
    try {
      setOpeningLoading(true);
      setQuickGuestCount(guestCount);
      playHapticSuccess();
      await onOpenTable(quickOpenTable.id, guestCount);
      setQuickOpenTable(null);
    } catch (e) {
      console.error(e);
    } finally {
      setOpeningLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await nativeHapticImpact(ImpactStyle.Light);
    refreshData();
    setTimeout(() => setIsRefreshing(false), 600);
  };

  return (
    <div className="tables-mobile-shell fixed inset-0 z-[60] bg-[#070b12] text-slate-100 flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden select-none">
      <style>{`
        @keyframes pulseGlowReady {
          0%, 100% { 
            box-shadow: 0 0 0 0 rgba(6, 182, 212, 0.4), inset 0 0 15px rgba(6, 182, 212, 0.2); 
            border-color: rgba(34, 211, 238, 0.9);
          }
          50% { 
            box-shadow: 0 0 25px 6px rgba(6, 182, 212, 0.7), inset 0 0 25px rgba(6, 182, 212, 0.35); 
            border-color: rgba(165, 243, 252, 1);
          }
        }
        .animate-ready-glow { animation: pulseGlowReady 1.5s infinite ease-in-out; }
      `}</style>

      {/* Floating Kitchen Ready Toast Alert */}
      {kitchenAlertToast && (
        <div 
          onClick={() => {
            const t = tables.find(tbl => tbl.label === kitchenAlertToast.tableLabel);
            if (t) onSelectTable(t);
            setKitchenAlertToast(null);
          }}
          className="fixed top-4 left-4 right-4 md:left-auto md:right-6 md:w-96 z-[120] flex items-center justify-between gap-3 rounded-2xl border border-cyan-400/60 bg-gradient-to-r from-cyan-950 via-slate-900 to-cyan-950 p-4 shadow-[0_10px_35px_rgba(6,182,212,0.4)] backdrop-blur-xl animate-bounce cursor-pointer active:scale-98"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-cyan-500 text-slate-950 flex items-center justify-center font-black text-lg shadow-md">
              🔔
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-black text-cyan-300 uppercase tracking-wider">
                {tx(lang, 'Mətbəx Hazırdır!', 'Заказ готов на кухне!', 'Kitchen Order Ready!')}
              </div>
              <div className="text-sm font-bold text-white truncate">
                {kitchenAlertToast.tableLabel} · {kitchenAlertToast.count} {tx(lang, 'porsiya hazır', 'порц. готово', 'items ready')}
              </div>
            </div>
          </div>
          <button 
            type="button" 
            onClick={(e) => { e.stopPropagation(); setKitchenAlertToast(null); }}
            className="h-8 w-8 shrink-0 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* ─── TOP APP BAR & WAITER PROFILE ─── */}
      <header className="shrink-0 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-2xl px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          {/* Waiter Avatar & Identity */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative">
              <div className="h-11 w-11 shrink-0 rounded-2xl bg-gradient-to-br from-amber-400 via-yellow-500 to-amber-600 flex items-center justify-center font-black text-slate-950 text-base shadow-lg shadow-amber-500/20">
                {user?.username ? user.username.charAt(0).toUpperCase() : 'W'}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-slate-900 animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm sm:text-base font-extrabold text-white truncate">
                  {user?.username || tx(lang, 'Ofisiant', 'Официант', 'Waiter')}
                </span>
                <span className="rounded-full bg-amber-400/15 border border-amber-400/30 px-2 py-0.5 text-[10px] font-black text-amber-300 shrink-0">
                  {tx(lang, 'Ofisiant', 'Официант', 'Waiter')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-400 mt-0.5">
                <span>{tables.length} {tx(lang, 'Masa', 'Столов', 'Tables')}</span>
                <span>•</span>
                <span className="text-emerald-400 font-bold">{freeCount} {tx(lang, 'Boş', 'Свободно', 'Free')}</span>
                <span>•</span>
                <span className="text-rose-400 font-bold">{occupiedCount} {tx(lang, 'Dolu', 'Занято', 'Busy')}</span>
              </div>
            </div>
          </div>

          {/* Quick Shift Actions Bar */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Sound alert toggle button */}
            <button
              type="button"
              onClick={toggleSound}
              className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all active:scale-95 ${
                soundEnabled 
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20' 
                  : 'border-slate-800 bg-slate-800/40 text-slate-500 hover:text-slate-400'
              }`}
              title={soundEnabled ? tx(lang, 'Mətbəx səsi: Aktiv', 'Звук кухни: Вкл', 'Kitchen sound: On') : tx(lang, 'Mətbəx səsi: Səssiz', 'Звук кухни: Выкл', 'Kitchen sound: Off')}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>

            {/* Mobile Layout Density Switcher (only on mobile screens) */}
            <button
              type="button"
              onClick={toggleGridMode}
              className="md:hidden flex h-10 w-10 items-center justify-center rounded-xl border border-slate-800 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 active:scale-95 transition"
              title={mobileGridMode === 'comfort' ? tx(lang, 'Yığcam rejim', 'Компактно', 'Compact') : tx(lang, 'Geniş kartlar', 'Крупно', 'Comfort')}
            >
              {mobileGridMode === 'comfort' ? <Grid size={18} /> : <Smartphone size={18} />}
            </button>

            {/* Manual Refresh Button */}
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className={`flex h-10 w-10 items-center justify-center rounded-xl border border-slate-800 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 active:scale-95 transition ${
                isRefreshing ? 'animate-spin text-amber-400' : ''
              }`}
              title={tx(lang, 'Yenilə', 'Обновить', 'Refresh')}
            >
              <RefreshCw size={17} />
            </button>

            {/* PIN Switch / Lock Button */}
            <button
              type="button"
              onClick={onFastSwitch}
              className="flex h-10 px-3 items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-800/80 text-xs font-bold text-slate-200 hover:bg-slate-700 hover:text-white active:scale-95 transition shadow-sm"
              title={tx(lang, 'İstifadəçini dəyiş / PIN kilidi', 'Сменить пользователя / PIN', 'Switch user / PIN')}
            >
              <UserCheck size={16} className="text-amber-400" />
              <span className="hidden sm:inline">{tx(lang, 'Dəyiş', 'Сменить', 'Switch')}</span>
            </button>
          </div>
        </div>

        {/* ─── FLOOR PLAN / ZONE TABS ─── */}
        <div className="flex items-center gap-2 overflow-x-auto pt-2.5 pb-0.5 no-scrollbar">
          <button
            type="button"
            onClick={async () => { await nativeHapticImpact(ImpactStyle.Light); setActiveFloorId(''); }}
            className={`flex-none flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
              !activeFloorId
                ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 shadow-md shadow-amber-500/20 scale-[1.02]'
                : 'border border-slate-800 bg-slate-800/50 text-slate-300 hover:border-slate-700 active:scale-95'
            }`}
          >
            <span>{tx(lang, 'Bütün Zallar', 'Все залы', 'All Zones')}</span>
            <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
              !activeFloorId ? 'bg-slate-950/25 text-slate-950' : 'bg-slate-700 text-slate-300'
            }`}>
              {tables.length}
            </span>
          </button>

          {floorPlans.map((fp) => {
            const active = fp.id === activeFloorId;
            const countInfo = floorCounts.get(fp.id) || { total: 0, occupied: 0 };
            return (
              <button
                key={fp.id}
                type="button"
                onClick={async () => { await nativeHapticImpact(ImpactStyle.Light); setActiveFloorId(fp.id); }}
                className={`flex-none flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                  active
                    ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 shadow-md shadow-amber-500/20 scale-[1.02]'
                    : 'border border-slate-800 bg-slate-800/50 text-slate-300 hover:border-slate-700 active:scale-95'
                }`}
              >
                <span>{fp.name}</span>
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                  active ? 'bg-slate-950/25 text-slate-950' : 'bg-slate-700 text-slate-300'
                }`}>
                  {countInfo.total}
                </span>
                {countInfo.occupied > 0 && (
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* ─── SEARCH & FILTER CHIPS ─── */}
      <div className="shrink-0 border-b border-slate-800/60 bg-[#0b101c]/80 backdrop-blur-md px-4 py-2.5 sm:px-6 space-y-2">
        {/* Search Bar with Instant Clear */}
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={tx(lang, 'Masa nömrəsi və ya ad ilə axtarın...', 'Поиск по номеру или названию стола...', 'Search table # or name...')}
            className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 pl-10 pr-9 py-2.5 text-xs sm:text-sm font-semibold text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400/60 transition shadow-inner"
          />
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Status Filter Chips (Scrollable Horizontal Bar) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {([
            ['all',      tx(lang, 'Hamısı',  'Все',     'All'),        tables.length,            ''],
            ...(currentUsername ? [['mine', tx(lang, 'Mənim', 'Мои', 'My'), myTablesCount, '★']] : []),
            ['free',     tx(lang, 'Boş',     'Свободно','Free'),       freeCount,                '🟢'],
            ['occupied', tx(lang, 'Dolu',    'Занято',  'Busy'),       occupiedCount,            '🔴'],
            ['ready',    tx(lang, 'Hazır',   'Готово',  'Ready'),      readyCount,               '🔔'],
            ...(billRequestedCount > 0 ? [['bill', tx(lang, 'Hesab', 'Счет', 'Bill'), billRequestedCount, '🧾']] : []),
          ] as [typeof statusFilter, string, number, string][]).map(([key, label, count, icon]) => {
            const isSelected = statusFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={async () => { await nativeHapticImpact(ImpactStyle.Light); setStatusFilter(key); }}
                className={`flex-none flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap ${
                  isSelected
                    ? key === 'all'      ? 'bg-slate-200 text-slate-950 font-black shadow-md'
                    : key === 'mine'     ? 'bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black shadow-md shadow-amber-400/30'
                    : key === 'free'     ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                    : key === 'occupied' ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30'
                    : key === 'ready'    ? 'bg-cyan-500 text-slate-950 font-black shadow-md shadow-cyan-500/35 animate-ready-glow'
                    : 'bg-purple-500 text-white shadow-md shadow-purple-500/30'
                    : 'bg-slate-900/80 text-slate-400 border border-slate-800 hover:border-slate-700 hover:text-slate-300'
                }`}
              >
                {icon && <span>{icon}</span>}
                <span>{label}</span>
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                  isSelected 
                    ? (key === 'all' || key === 'mine' || key === 'ready' ? 'bg-slate-950/20 text-slate-950' : 'bg-white/25 text-white') 
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── MAIN TABLE MATRIX (RESPONSIVE PHONE & IPAD GRID) ─── */}
      <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 pb-28 md:pb-8">
        <div 
          className={`grid gap-2.5 sm:gap-3.5 ${
            mobileGridMode === 'comfort'
              ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
              : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7'
          }`}
        >
          {filteredTables.map((table) => {
            const isOccupied = Boolean(table.is_occupied);
            const isReady = readyTableIds.has(table.id);
            const readyItemsCount = readyCountMap.get(table.id) || 0;
            const totalVal = new Decimal(table.total || 0).toFixed(2);
            const guestNum = table.guest_count || 1;
            const assigned = String(table.assigned_to || table.locked_by || '').trim();
            const isMyTable = Boolean(currentUsername && assigned.toLowerCase() === currentUsername);
            const isBillRequested = String(table.status || '').toUpperCase() === 'PRECHECK' || String(table.status || '').toUpperCase() === 'BILL' || Boolean((table as any).is_precheck);

            // Elapsed seating timer
            const openedAt = (table as any).opened_at || (table as any).locked_at || (table as any).seated_at || (table as any).updated_at || null;
            let elapsedMin = 0;
            if (isOccupied && openedAt) {
              elapsedMin = Math.max(1, Math.floor((Date.now() - new Date(openedAt).getTime()) / 60000));
            }

            return (
              <div
                key={table.id}
                onClick={() => handleTableTap(table)}
                className={`group relative flex flex-col justify-between rounded-2xl sm:rounded-3xl p-3 sm:p-4 cursor-pointer transition-all duration-150 active:scale-[0.96] border ${
                  isReady
                    ? 'bg-gradient-to-b from-cyan-950/60 via-slate-900 to-cyan-950/80 border-cyan-400 ring-2 ring-cyan-400 animate-ready-glow'
                    : isOccupied
                    ? isBillRequested
                      ? 'bg-gradient-to-b from-purple-950/40 via-slate-900 to-slate-950 border-purple-500/50 shadow-lg shadow-purple-950/40'
                      : isMyTable
                      ? 'bg-gradient-to-b from-amber-950/30 via-slate-900 to-slate-950 border-amber-400/70 ring-2 ring-amber-400/60 shadow-lg shadow-amber-950/30'
                      : 'bg-gradient-to-b from-rose-950/25 via-slate-900 to-slate-950 border-rose-500/35 hover:border-rose-500/60 shadow-md'
                    : 'bg-gradient-to-b from-emerald-950/15 via-slate-900/90 to-slate-950/90 border-emerald-500/25 hover:border-emerald-400/50 shadow-sm'
                }`}
                style={{ minHeight: mobileGridMode === 'comfort' ? '145px' : '125px' }}
              >
                {/* ── Ready Alert Pulsing Badge ── */}
                {isReady && (
                  <div className="absolute -top-2 -right-2 z-30 flex items-center gap-1 rounded-full bg-cyan-400 px-2 py-0.5 text-[10px] font-black text-slate-950 shadow-lg animate-bounce">
                    <span>🔔</span>
                    <span>{readyItemsCount > 0 ? `${readyItemsCount} ` : ''}{tx(lang, 'Hazır!', 'Готово!', 'Ready!')}</span>
                  </div>
                )}

                {/* ── Bill Requested Badge ── */}
                {isBillRequested && !isReady && (
                  <div className="absolute -top-2 -right-2 z-20 flex items-center gap-1 rounded-full bg-purple-500 px-2 py-0.5 text-[9px] font-black text-white shadow-md">
                    <span>🧾</span>
                    <span>{tx(lang, 'Hesab', 'Счет', 'Bill')}</span>
                  </div>
                )}

                {/* ── TOP: Table Header + Status Chip ── */}
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className={`text-base sm:text-lg font-black truncate tracking-tight ${
                        isReady ? 'text-cyan-200' : isOccupied ? 'text-white' : 'text-slate-200'
                      }`}>
                        {table.label}
                      </span>
                      {isMyTable && isOccupied && (
                        <span className="text-amber-400 text-xs shrink-0" title={tx(lang, 'Mənim Masam', 'Мой стол', 'My Table')}>
                          ★
                        </span>
                      )}
                    </div>
                    {/* Zone name sub-caption if viewing all zones */}
                    {!activeFloorId && table.floor_plan_id && (
                      <div className="text-[10px] font-bold text-slate-400 truncate">
                        {floorPlans.find(f => f.id === table.floor_plan_id)?.name || ''}
                      </div>
                    )}
                  </div>

                  {/* Top Status Pill */}
                  <div>
                    {isOccupied ? (
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-black shrink-0 ${
                        isReady 
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
                          : isBillRequested
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      }`}>
                        {isBillRequested ? tx(lang, 'Çek Çıxıb', 'Предчек', 'Pre-check') : tx(lang, 'Dolu', 'Занят', 'Busy')}
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-extrabold text-emerald-400 shrink-0">
                        {tx(lang, 'Boş', 'Свободен', 'Free')}
                      </span>
                    )}
                  </div>
                </div>

                {/* ── CENTER: Primary Metric (Amount vs Free Prompt) ── */}
                <div className="my-2">
                  {isOccupied ? (
                    <div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-lg sm:text-2xl font-black text-white tracking-tight leading-none">
                          {totalVal}
                        </span>
                        <span className="text-xs font-bold text-amber-400">₼</span>
                      </div>

                      {/* Elapsed Seating Timer with Smart Colors */}
                      {elapsedMin > 0 && (
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-bold">
                          <Clock size={11} className={elapsedMin >= 45 ? 'text-amber-400' : 'text-slate-400'} />
                          <span className={
                            elapsedMin >= 90
                              ? 'text-rose-400 font-black animate-pulse'
                              : elapsedMin >= 45
                              ? 'text-amber-300 font-extrabold'
                              : 'text-slate-300'
                          }>
                            {elapsedMin >= 60 
                              ? `${Math.floor(elapsedMin / 60)}s ${elapsedMin % 60}d` 
                              : `${elapsedMin} dəq`}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-slate-400 flex items-center gap-1">
                        <Users size={12} className="text-slate-400" />
                        <span>{tx(lang, 'Maks:', 'Макс:', 'Max:')} {table.capacity || 4}</span>
                      </div>
                      <div className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                        <span>+</span>
                        <span>{tx(lang, 'Masa Aç', 'Открыть', 'Open')}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── BOTTOM: Waiter / Guest Footer ── */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-semibold text-slate-400">
                  {isOccupied ? (
                    <>
                      <div className="flex items-center gap-1 text-slate-300 truncate">
                        <Users size={12} className="shrink-0 text-slate-400" />
                        <span>{guestNum}</span>
                      </div>
                      <div className="truncate max-w-[90px] text-right text-[10px] font-bold text-slate-300">
                        {assigned ? (isMyTable ? '★ ' + assigned : assigned) : '—'}
                      </div>
                    </>
                  ) : (
                    <div className="w-full text-center text-[10px] font-bold text-emerald-400/80">
                      {tx(lang, 'Toxun və dərhal aç', 'Нажмите чтобы открыть', 'Tap to open')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty State */}
        {filteredTables.length === 0 && (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center text-slate-400 max-w-md mx-auto my-8 space-y-3">
            <div className="h-14 w-14 rounded-2xl bg-slate-800 flex items-center justify-center text-2xl mx-auto text-slate-400">
              🔍
            </div>
            <div className="text-sm font-bold text-slate-200">
              {tx(lang, 'Axtarışa və ya filtrə uyğun masa tapılmadı', 'Столы не найдены по выбранному фильтру', 'No tables match search or filter')}
            </div>
            <button
              type="button"
              onClick={() => { setSearchTerm(''); setStatusFilter('all'); setActiveFloorId(''); }}
              className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-amber-400 hover:bg-slate-700 transition"
            >
              {tx(lang, 'Filtrləri sıfırla', 'Сбросить фильтры', 'Reset filters')}
            </button>
          </div>
        )}
      </main>

      {/* ─── STICKY MOBILE BOTTOM SHIFT SUMMARY DOCK ─── */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-800/90 bg-[#0b101c]/95 backdrop-blur-xl px-4 py-2.5 sm:px-6 flex items-center justify-between shadow-[0_-8px_30px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-3">
          <div className="text-xs font-bold text-slate-300">
            <span className="text-rose-400 font-extrabold">{occupiedCount}</span> {tx(lang, 'dolu', 'занято', 'busy')}
            <span className="mx-1.5 text-slate-400">•</span>
            <span className="text-amber-400 font-extrabold">{myTablesCount}</span> {tx(lang, 'mənim', 'моих', 'mine')}
            {readyCount > 0 && (
              <>
                <span className="mx-1.5 text-slate-400">•</span>
                <span className="text-cyan-400 font-black animate-pulse">🔔 {readyCount} {tx(lang, 'hazır', 'готово', 'ready')}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Refresh trigger */}
          <button
            type="button"
            onClick={handleManualRefresh}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 active:scale-95 transition hover:bg-slate-700"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-amber-400' : ''} />
            <span>{tx(lang, 'Yenilə', 'Обновить', 'Refresh')}</span>
          </button>
        </div>
      </footer>

      {/* ─── 1-TAP FAST GUEST PICKER (BOTTOM SHEET ON MOBILE, MODAL ON IPAD) ─── */}
      {quickOpenTable && (
        <div 
          className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md p-0 sm:p-4 animate-modalFadeIn"
          onClick={() => setQuickOpenTable(null)}
        >
          <div 
            className="w-full sm:max-w-md rounded-t-[32px] sm:rounded-3xl border-t sm:border border-white/10 bg-slate-900 p-5 sm:p-6 shadow-2xl space-y-4 animate-scaleIn text-white overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet drag indicator on mobile */}
            <div className="sm:hidden -mt-1 mb-2 flex justify-center">
              <div className="h-1.5 w-12 rounded-full bg-slate-600" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black text-amber-400">{quickOpenTable.label}</span>
                  <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                    {tx(lang, 'Yeni Masa Açılır', 'Открытие стола', 'Opening Table')}
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-400 mt-1">
                  {tx(lang, 'Qonaq sayını seçin (1 toxunuşla dərhal açılır)', 'Выберите число гостей (1 касание)', 'Select guest count (opens in 1-tap)')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuickOpenTable(null)}
                className="h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 font-bold transition active:scale-90"
              >
                ✕
              </button>
            </div>

            {/* Instant 1-Tap Guest Selection Matrix */}
            <div className="grid grid-cols-4 gap-2.5 pt-1">
              {['1', '2', '3', '4', '5', '6', '7', '8', '10', '12', '16', '20+'].map((num) => (
                <button
                  key={num}
                  type="button"
                  disabled={openingLoading}
                  onClick={() => handleQuickSelectAndOpen(num.replace('+', ''))}
                  className="rounded-2xl py-3 text-base font-black transition-all bg-gradient-to-b from-slate-800 to-slate-900/90 border border-slate-700/80 text-slate-100 hover:border-amber-400 hover:text-amber-300 active:scale-95 shadow-md flex flex-col items-center justify-center gap-0.5 disabled:opacity-50 taktil-target"
                >
                  <span className="text-xl leading-none font-black">{num}</span>
                  <span className="text-[10px] text-slate-400 font-semibold">
                    👤 {tx(lang, 'qonaq', 'гост.', 'guests')}
                  </span>
                </button>
              ))}
            </div>

            {openingLoading && (
              <div className="py-3 text-center text-xs font-black text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-2xl animate-pulse">
                ⏳ {tx(lang, 'Masa açılır və menyuya keçilir...', 'Открываем стол и переходим в меню...', 'Opening table & transitioning to menu...')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
