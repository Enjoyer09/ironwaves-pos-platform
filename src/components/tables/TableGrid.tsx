import React, { memo, useMemo, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { Decimal } from 'decimal.js';
import { tx } from '../../i18n';

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
};

const tapFeedback = () => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(10);
  } catch {
    // ignore haptics errors
  }
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
}: TableGridProps) {
  const [quickActionsTableId, setQuickActionsTableId] = useState<string | null>(null);
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

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tableGridMinWidth}px, 1fr))` }}
    >
      {floorTables.map((table) => {
        const localTable = tablesById[String(table.id)] || null;
        const tableLockHolder = String((table as any).locked_by || localTable?.assigned_to || '').trim();
        const otherOwner = Boolean(localTable?.is_occupied && tableLockHolder && tableLockHolder !== currentUsername && !isManagerUser);
        const status = String(table.status || 'AVAILABLE').toUpperCase();
        const statusTone: Record<string, string> = {
          AVAILABLE: 'border-emerald-300/35 bg-emerald-500/12',
          RESERVED: 'border-amber-300/35 bg-amber-500/12',
          SEATED: 'border-rose-300/35 bg-rose-500/12',
          ACTIVE_CHECK: 'border-violet-300/35 bg-violet-500/12',
          DIRTY: 'border-slate-300/25 bg-slate-500/20',
        };
        const statusDot: Record<string, string> = {
          AVAILABLE: 'bg-emerald-400',
          RESERVED: 'bg-amber-400',
          SEATED: 'bg-rose-400',
          ACTIVE_CHECK: 'bg-violet-400',
          DIRTY: 'bg-slate-300',
        };
        const readyCount = Number(readyCountsByLabel[String(table.label || '').trim()] || 0);
        const showQuickActions = quickActionsTableId === table.id;

        return (
          <button
            key={table.id}
            type="button"
            onClick={() => {
              tapFeedback();
              setQuickActionsTableId(null);
              onSelectTable(table);
            }}
            onMouseDown={() => {
              clearLongPress();
              longPressRef.current = window.setTimeout(() => {
                tapFeedback();
                setQuickActionsTableId(table.id);
              }, 450);
            }}
            onMouseUp={clearLongPress}
            onMouseLeave={clearLongPress}
            onTouchStart={() => {
              clearLongPress();
              longPressRef.current = window.setTimeout(() => {
                tapFeedback();
                setQuickActionsTableId(table.id);
              }, 450);
            }}
            onTouchEnd={clearLongPress}
            className={`min-h-[120px] rounded-[26px] border p-4 text-left transition active:scale-[0.99] ${statusTone[status] || statusTone.AVAILABLE} ${viewTableId === table.id ? 'ring-2 ring-yellow-300/80' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-black text-slate-100">{table.label}</div>
                <div className="mt-2 flex items-center gap-2 text-sm text-slate-300">
                  <span className={`h-3.5 w-3.5 rounded-full ${statusDot[status] || statusDot.AVAILABLE}`} />
                  <span>
                    <Users size={13} className="mr-1 inline" />
                    {Number(table.guest_count || 0)} / {Number(table.capacity || 0)}
                  </span>
                </div>
              </div>
              {new Decimal(table.check_total || 0).greaterThan(0) ? (
                <div className="rounded-xl bg-black/20 px-3 py-2 text-sm font-bold text-slate-100">
                  {new Decimal(table.check_total || 0).toFixed(2)} ₼
                </div>
              ) : null}
            </div>

            {tableLockHolder ? (
              <div className={`mt-3 rounded-full border px-3 py-2 text-xs font-semibold ${otherOwner ? 'border-rose-300/25 bg-rose-500/10 text-rose-100' : 'border-cyan-300/20 bg-cyan-500/10 text-cyan-100'}`}>
                👤 {tableLockHolder} {tx(lang, 'istifadə edir', 'использует', 'is using')}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {readyCount > 0 ? (
                <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-100">
                  {readyCount} {tx(lang, 'hazır', 'готово', 'ready')}
                </span>
              ) : null}
              {String((table as any).merged_group_id || '').trim() ? (
                <span className="rounded-full bg-violet-500/15 px-3 py-1 text-[11px] font-semibold text-violet-100">
                  {tx(lang, 'qrup', 'группа', 'group')}
                </span>
              ) : null}
              {status === 'DIRTY' ? (
                <span className="rounded-full bg-slate-200/10 px-3 py-1 text-[11px] font-semibold text-slate-100">
                  {tx(lang, 'təmizlik', 'уборка', 'cleaning')}
                </span>
              ) : null}
            </div>

            {showQuickActions && (
              <div className="mt-3 flex flex-wrap gap-2">
                {status === 'DIRTY' ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      tapFeedback();
                      setQuickActionsTableId(null);
                      onMarkClean(table.id);
                    }}
                    className="rounded-2xl border border-slate-200/40 bg-slate-100/15 px-4 py-2 text-xs font-bold text-slate-100"
                  >
                    {tx(lang, 'Təmizlə', 'Очистить', 'Mark clean')}
                  </button>
                ) : localTable?.is_occupied ? (
                  <span className="rounded-2xl border border-yellow-300/20 bg-yellow-500/10 px-4 py-2 text-xs font-semibold text-yellow-100">
                    {tx(lang, 'Uzun toxunuş: sürətli giriş', 'Долгое нажатие: быстрый доступ', 'Long press: quick access')}
                  </span>
                ) : (
                  <span className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-100">
                    {tx(lang, 'Masanı aç', 'Открыть стол', 'Open table')}
                  </span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default memo(TableGrid);
