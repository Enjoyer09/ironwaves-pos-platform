import React, { useState, useMemo } from 'react';
import { Search, Utensils } from 'lucide-react';
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
    <div className="fixed inset-0 z-[60] bg-[#0b0f19] flex flex-col h-[100dvh] max-h-[100dvh] overflow-y-auto p-4 space-y-3 pb-24 select-none">
      <style>{`
        @keyframes pulseGlowReady {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
          50% { box-shadow: 0 0 20px 4px rgba(59, 130, 246, 0.8); }
        }
        .animate-ready-glow { animation: pulseGlowReady 1.8s infinite ease-in-out; }
      `}</style>

      {/* Top Header Card - compact, no PIN switch (auto-lock handles it) */}
      <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-slate-900/80 p-4 backdrop-blur-xl shadow-lg">
        <div className="h-11 w-11 shrink-0 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center font-black text-slate-950 text-base shadow-md">
          {user?.username ? user.username.charAt(0).toUpperCase() : 'W'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-white flex items-center gap-1.5 flex-wrap">
            <span className="truncate">{user?.username || 'Ofisiant'}</span>
            <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-extrabold text-emerald-400 shrink-0">
              {tx(lang, 'Ofisiant Mode', 'Режим официанта', 'Waiter Mode')}
            </span>
          </div>
          <div className="text-[10px] font-semibold text-slate-400 mt-0.5">
            {tables.length} {tx(lang, 'Masa', 'Столов', 'Tables')} · {freeCount} {tx(lang, 'Boş', 'Свободно', 'Free')} · {occupiedCount} {tx(lang, 'Dolu', 'Занят', 'Busy')}
          </div>
        </div>
      </div>

      {/* Zone Floor Plan Tabs — only shown when there are 2+ floor plans */}
      {floorPlans.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
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

        {/* Status Filter — horizontal scroll pills */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {([
            ['all',      tx(lang, 'Hamısı',  'Все',     'All'),   `${tables.length}`       ],
            ['free',     tx(lang, 'Boş',     'Свободно','Free'),  `${freeCount}`           ],
            ['occupied', tx(lang, 'Dolu',    'Занят',   'Busy'),  `${occupiedCount}`       ],
            ['ready',    tx(lang, 'Hazır',   'Готово',  'Ready'), `${readyCount}`          ],
          ] as [typeof statusFilter, string, string][]).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={`flex-none flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black transition-all whitespace-nowrap ${
                statusFilter === key
                  ? key === 'all'      ? 'bg-slate-600 text-white'
                  : key === 'free'     ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                  : key === 'occupied' ? 'bg-rose-500 text-white shadow-md shadow-rose-500/30'
                                       : 'bg-cyan-500 text-white shadow-md shadow-cyan-500/30 animate-pulse'
                  : 'bg-slate-800/80 text-slate-400 border border-slate-700/60'
              }`}
            >
              {label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
                statusFilter === key ? 'bg-white/25 text-white' : 'bg-slate-700 text-slate-300'
              }`}>{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mobile Touch Table Cards — 3-column Menulux-style grid */}
      <div className="grid grid-cols-3 gap-2">
        {filteredTables.map((table) => {
          const isOccupied = Boolean(table.is_occupied);
          const isReady = readyTableIds.has(table.id);
          const totalVal = new Decimal(table.total || 0).toFixed(2);
          const guestNum = table.guest_count || 1;

          return (
            <div
              key={table.id}
              onClick={() => handleTableTap(table)}
              className={`relative flex flex-col rounded-2xl overflow-hidden cursor-pointer active:scale-95 transition-all duration-150 ${
                isReady
                  ? 'bg-gradient-to-b from-cyan-500 to-cyan-700 shadow-lg shadow-cyan-500/30'
                  : isOccupied
                  ? 'bg-gradient-to-b from-rose-500 to-rose-700 shadow-lg shadow-rose-500/25'
                  : 'bg-slate-800/70 border border-slate-700/60'
              }`}
              style={{ minHeight: '110px' }}
            >
              {/* Top drag-pill indicator */}
              <div className="flex justify-center pt-2 pb-1 shrink-0">
                <div className={`h-[3px] w-7 rounded-full ${
                  isOccupied || isReady ? 'bg-white/35' : 'bg-slate-600'
                }`} />
              </div>

              {/* Table label */}
              <div className={`px-2.5 text-sm font-black leading-tight tracking-tight flex-1 ${
                isOccupied || isReady ? 'text-white' : 'text-slate-100'
              }`}>
                {table.label}
              </div>

              {/* Amount or free indicator */}
              <div className="px-2.5 mt-1">
                {isOccupied ? (
                  <div className="text-base font-black text-white leading-none">
                    {totalVal} <span className="text-[10px] opacity-80">₼</span>
                  </div>
                ) : (
                  <div className="text-[10px] font-bold text-slate-500">
                    {tx(lang, 'Boş', 'Свободен', 'Free')}
                  </div>
                )}
              </div>

              {/* Bottom: guests + waiter */}
              <div className="px-2.5 pb-2 mt-1.5 shrink-0">
                {isOccupied ? (
                  <div className="text-[9px] font-semibold text-white/65 truncate">
                    👥 {guestNum} · {table.assigned_to || ''}
                  </div>
                ) : (
                  <div className="text-[9px] font-semibold text-slate-600">
                    {tx(lang, 'Sərbəst', 'Свободен', 'Free')}
                  </div>
                )}
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-modalFadeIn" onClick={() => setQuickOpenTable(null)}>
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl space-y-5 animate-scaleIn text-white" onClick={(e) => e.stopPropagation()}>
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
