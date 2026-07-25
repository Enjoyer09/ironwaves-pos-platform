import React, { useState, useMemo } from 'react';
import { Search, UserRoundCog, Utensils, CheckCircle2, Clock, Plus, ChevronRight, Bell } from 'lucide-react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';
import { ImpactStyle } from '@capacitor/haptics';
import { nativeHapticImpact } from '../../lib/customer_utils';

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
}: MobileWaiterUIProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'free' | 'occupied' | 'ready'>('all');
  const [quickOpenTable, setQuickOpenTable] = useState<any | null>(null);
  const [quickGuestCount, setQuickGuestCount] = useState('2');
  const [openingLoading, setOpeningLoading] = useState(false);

  // Compute counts
  const readyTableIds = useMemo(() => {
    const ids = new Set<string>();
    kitchenOrders.forEach((order: any) => {
      if (String(order.status || '').toUpperCase() === 'READY') {
        const matchingTable = tables.find(t => t.label === order.table_label);
        if (matchingTable) ids.add(matchingTable.id);
      }
    });
    return ids;
  }, [kitchenOrders, tables]);

  const filteredTables = useMemo(() => {
    return tables.filter(t => {
      // Floor filter
      if (activeFloorId && t.floor_plan_id && t.floor_plan_id !== activeFloorId) {
        return false;
      }
      // Search
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        if (!t.label.toLowerCase().includes(query)) return false;
      }
      // Status filter
      if (statusFilter === 'free') return !t.is_occupied;
      if (statusFilter === 'occupied') return t.is_occupied;
      if (statusFilter === 'ready') return readyTableIds.has(t.id);

      return true;
    });
  }, [tables, activeFloorId, searchTerm, statusFilter, readyTableIds]);

  const freeCount = tables.filter(t => !t.is_occupied).length;
  const occupiedCount = tables.filter(t => t.is_occupied).length;
  const readyCount = readyTableIds.size;

  const handleTableTap = async (table: any) => {
    await nativeHapticImpact(ImpactStyle.Light);
    if (!table.is_occupied) {
      // Open quick guest picker
      setQuickOpenTable(table);
      setQuickGuestCount('2');
    } else {
      onSelectTable(table);
    }
  };

  const handleConfirmQuickOpen = async () => {
    if (!quickOpenTable) return;
    try {
      setOpeningLoading(true);
      await onOpenTable(quickOpenTable.id, quickGuestCount);
      const targetTable = quickOpenTable;
      setQuickOpenTable(null);
      onSelectTable(targetTable);
    } catch (e) {
      console.error(e);
    } finally {
      setOpeningLoading(false);
    }
  };

  return (
    <div className="flex flex-col space-y-4 pb-20 select-none">
      <style>{`
        @keyframes pulseGlowReady {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
          50% { box-shadow: 0 0 20px 4px rgba(59, 130, 246, 0.8); }
        }
        .animate-ready-glow { animation: pulseGlowReady 1.8s infinite ease-in-out; }
      `}</style>

      {/* Top Header Card */}
      <div className="flex items-center justify-between rounded-3xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur-xl shadow-lg">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center font-black text-slate-950 text-base shadow-md">
            {user?.username ? user.username.charAt(0).toUpperCase() : 'W'}
          </div>
          <div>
            <div className="text-sm font-black text-white flex items-center gap-1.5">
              <span>{user?.username || 'Ofisiant'}</span>
              <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-extrabold text-emerald-400">
                {tx(lang, 'Ofisiant Mode', 'Режим официанта', 'Waiter Mode')}
              </span>
            </div>
            <div className="text-[10px] font-semibold text-slate-400 mt-0.5">
              {tables.length} {tx(lang, 'Masa', 'Столов', 'Tables')} · {freeCount} {tx(lang, 'Boş', 'Свободно', 'Free')}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => { void nativeHapticImpact(ImpactStyle.Medium); onFastSwitch(); }}
          className="flex items-center gap-1.5 rounded-2xl border border-amber-400/40 bg-amber-500/15 px-3.5 py-2.5 text-xs font-black text-amber-300 active:scale-95 transition shadow-sm"
        >
          <UserRoundCog size={16} />
          <span>{tx(lang, 'Dəyiş (PIN)', 'Сменить (PIN)', 'Switch PIN')}</span>
        </button>
      </div>

      {/* Zone Floor Plan Tabs */}
      {floorPlans.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 pt-1 -mx-1 px-1 no-scrollbar">
          {floorPlans.map((fp) => {
            const active = fp.id === activeFloorId;
            return (
              <button
                key={fp.id}
                type="button"
                onClick={async () => { await nativeHapticImpact(ImpactStyle.Light); setActiveFloorId(fp.id); }}
                className={`flex-none rounded-2xl px-4 py-2.5 text-xs font-black transition-all ${
                  active
                    ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 shadow-md shadow-amber-500/20 scale-[1.02]'
                    : 'border border-slate-700/70 bg-slate-800/40 text-slate-300 active:scale-95'
                }`}
              >
                {fp.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={tx(lang, 'Masa nömrəsi axtarın...', 'Поиск по номеру стола...', 'Search table #...')}
            className="w-full rounded-2xl border border-slate-700/80 bg-slate-900/90 pl-10 pr-4 py-3 text-xs font-semibold text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-400/50 shadow-inner"
          />
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>

        {/* Status Filter Chips */}
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`rounded-xl py-2 px-1 text-[11px] font-black text-center transition ${
              statusFilter === 'all'
                ? 'bg-slate-700 text-white border border-slate-500'
                : 'bg-slate-900/60 text-slate-400 border border-slate-800'
            }`}
          >
            {tx(lang, 'Hamsı', 'Все', 'All')} ({tables.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('free')}
            className={`rounded-xl py-2 px-1 text-[11px] font-black text-center transition ${
              statusFilter === 'free'
                ? 'bg-emerald-500/25 border border-emerald-400/50 text-emerald-300'
                : 'bg-slate-900/60 text-slate-400 border border-slate-800'
            }`}
          >
            🟢 {tx(lang, 'Boş', 'Свободно', 'Free')} ({freeCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('occupied')}
            className={`rounded-xl py-2 px-1 text-[11px] font-black text-center transition ${
              statusFilter === 'occupied'
                ? 'bg-rose-500/25 border border-rose-400/50 text-rose-300'
                : 'bg-slate-900/60 text-slate-400 border border-slate-800'
            }`}
          >
            🔴 {tx(lang, 'Dolu', 'Занят', 'Busy')} ({occupiedCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('ready')}
            className={`rounded-xl py-2 px-1 text-[11px] font-black text-center transition ${
              statusFilter === 'ready'
                ? 'bg-cyan-500/25 border border-cyan-400/50 text-cyan-300 animate-pulse'
                : 'bg-slate-900/60 text-slate-400 border border-slate-800'
            }`}
          >
            🔵 {tx(lang, 'Hazır', 'Готово', 'Ready')} ({readyCount})
          </button>
        </div>
      </div>

      {/* Mobile Touch Table Cards Grid */}
      <div className="grid grid-cols-2 gap-3">
        {filteredTables.map((table) => {
          const isOccupied = Boolean(table.is_occupied);
          const isReady = readyTableIds.has(table.id);
          const totalVal = new Decimal(table.total || 0).toFixed(2);
          const guestNum = table.guest_count || 1;

          return (
            <div
              key={table.id}
              onClick={() => handleTableTap(table)}
              className={`relative flex flex-col justify-between rounded-3xl p-4 border transition-all duration-200 cursor-pointer active:scale-96 ${
                isReady
                  ? 'bg-gradient-to-br from-cyan-950/80 to-slate-900 border-cyan-400 animate-ready-glow'
                  : isOccupied
                  ? 'bg-gradient-to-br from-slate-900 to-rose-950/40 border-rose-500/40 shadow-lg shadow-rose-950/20'
                  : 'bg-gradient-to-br from-slate-900 to-emerald-950/20 border-emerald-500/30 hover:border-emerald-400/50'
              }`}
              style={{ minHeight: '135px' }}
            >
              {/* Card Top Row */}
              <div className="flex items-start justify-between">
                <span className="text-base font-black text-white tracking-tight leading-tight">
                  {table.label}
                </span>

                {isReady ? (
                  <span className="flex items-center gap-1 rounded-full bg-cyan-500/30 border border-cyan-400 px-2 py-0.5 text-[9px] font-black text-cyan-200 animate-pulse">
                    <Bell size={10} /> {tx(lang, 'Hazırdır!', 'Готово!', 'Ready!')}
                  </span>
                ) : isOccupied ? (
                  <span className="rounded-full bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 text-[9px] font-black text-rose-300">
                    🔴 Dolu
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-black text-emerald-300">
                    🟢 Boş
                  </span>
                )}
              </div>

              {/* Card Center Detail */}
              <div className="my-2">
                {isOccupied ? (
                  <div className="space-y-1">
                    <div className="text-xl font-black text-amber-400 tracking-tight">
                      {totalVal} <span className="text-xs font-bold text-amber-400/70">₼</span>
                    </div>
                    <div className="text-[10px] font-semibold text-slate-400 flex items-center gap-2">
                      <span>👥 {guestNum} {tx(lang, 'nəfər', 'чел.', 'guests')}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs font-bold text-emerald-400/80 flex items-center gap-1">
                    <Plus size={14} />
                    <span>{tx(lang, 'Sifariş başla', 'Открыть стол', 'Start Order')}</span>
                  </div>
                )}
              </div>

              {/* Card Bottom Row */}
              <div className="flex items-center justify-between text-[10px] font-semibold border-t border-white/5 pt-2 text-slate-400">
                <span>{table.assigned_to ? `👤 ${table.assigned_to}` : tx(lang, 'Sərbəst', 'Свободен', 'Free')}</span>
                <ChevronRight size={14} className={isOccupied ? 'text-amber-400' : 'text-emerald-400'} />
              </div>
            </div>
          );
        })}
      </div>

      {filteredTables.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-700 p-8 text-center text-slate-400 text-xs font-bold">
          {tx(lang, 'Axtarışa uyğun masa tapılmadı', 'Столы не найдены', 'No tables matched search')}
        </div>
      )}

      {/* Quick Open Table Modal (Fast 1-tap guest picker) */}
      {quickOpenTable && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-modalFadeIn">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl space-y-5 animate-scaleIn text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-lg font-black text-amber-400">{quickOpenTable.label}</h3>
                <p className="text-xs font-semibold text-slate-400">{tx(lang, 'Qonaq sayını seçin', 'Выберите кол-во гостей', 'Select guest count')}</p>
              </div>
              <button
                type="button"
                onClick={() => setQuickOpenTable(null)}
                className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-slate-400 font-bold"
              >
                ✕
              </button>
            </div>

            {/* Guest Number Pills */}
            <div className="grid grid-cols-4 gap-2.5">
              {['1', '2', '3', '4', '5', '6', '8', '10'].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setQuickGuestCount(num)}
                  className={`rounded-2xl py-3 text-base font-black transition-all ${
                    quickGuestCount === num
                      ? 'bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/25 scale-[1.04]'
                      : 'bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {num} 👤
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={openingLoading}
              onClick={handleConfirmQuickOpen}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 font-black text-sm text-white shadow-xl shadow-emerald-500/20 active:scale-95 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Utensils size={18} />
              {openingLoading
                ? tx(lang, 'Açılır...', 'Открываем...', 'Opening...')
                : tx(lang, 'Masanı Aç və Sifarişə Keç', 'Открыть и заказать', 'Open & Take Order')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
