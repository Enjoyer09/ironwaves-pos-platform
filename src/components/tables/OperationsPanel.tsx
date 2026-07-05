import React, { useState } from 'react';
import { tx } from '../../i18n';

interface OperationsPanelProps {
  table: any;
  otherTables: any[];
  isManagerUser: boolean;
  userCanEditTable: boolean;
  lang: string;
  onTransfer: (tableId: string, targetId: string) => Promise<void>;
  onCombine: (tableId: string, targetId: string) => Promise<void>;
  onSplit: (tableId: string, mergedGroupId: string | null) => Promise<void>;
  onCancel: (tableId: string, label: string) => void;
}

export default function OperationsPanel({
  table,
  otherTables,
  isManagerUser,
  userCanEditTable,
  lang,
  onTransfer,
  onCombine,
  onSplit,
  onCancel,
}: OperationsPanelProps) {
  const [transferTargetId, setTransferTargetId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');

  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="grid gap-3 rounded-lg border border-slate-700/70 bg-slate-900/40 p-3">
        <div className="grid gap-3 lg:grid-cols-4">
          {/* Transfer */}
          <div className="rounded-xl border border-blue-300/20 bg-blue-500/10 p-3 flex flex-col justify-between">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-blue-200">{tx(lang, 'Masanı köçür', 'Перенести стол', 'Transfer table')}</div>
              <div className="text-xs text-slate-300">{tx(lang, 'Açıq check-i başqa boş masaya keçir', 'Переносит открытый чек на другой свободный стол', 'Move the open check to another empty table')}</div>
              <div className="mt-3 flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto p-1 bg-black/15 rounded-lg scrollbar-none">
                {otherTables.filter((row) => !row.is_occupied).map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setTransferTargetId(transferTargetId === row.id ? '' : row.id)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition ${
                      transferTargetId === row.id
                        ? 'bg-blue-500 text-white border-blue-400'
                        : 'bg-slate-800/80 hover:bg-slate-700/80 border-slate-700/60 text-slate-200'
                    }`}
                  >
                    {row.label}
                  </button>
                ))}
                {otherTables.filter((row) => !row.is_occupied).length === 0 && (
                  <div className="text-[10px] text-slate-500 p-2 w-full text-center">{tx(lang, 'Boş masa yoxdur', 'Нет свободных столов', 'No empty tables')}</div>
                )}
              </div>
            </div>
            <button
              className="mt-3 w-full rounded-lg border border-blue-300/40 bg-blue-500/15 py-2 text-sm font-bold text-blue-100 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!transferTargetId}
              onClick={async () => {
                if (!transferTargetId) return;
                await onTransfer(table.id, transferTargetId);
                setTransferTargetId('');
              }}
            >
              {tx(lang, 'Masanı Köçür', 'Перенести', 'Transfer Table')}
            </button>
          </div>

          {/* Combine */}
          <div className="rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 flex flex-col justify-between">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">{tx(lang, 'Masaları birləşdir', 'Объединить столы', 'Combine tables')}</div>
              <div className="text-xs text-slate-300">{tx(lang, 'Yanaşı masaları bir check altında birləşdir', 'Объединяет соседние столы под одним чеком', 'Combine nearby tables under one check')}</div>
              <div className="mt-3 flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto p-1 bg-black/15 rounded-lg scrollbar-none">
                {otherTables.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setMergeTargetId(mergeTargetId === row.id ? '' : row.id)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition ${
                      mergeTargetId === row.id
                        ? 'bg-amber-500 text-slate-950 border-amber-400 font-extrabold'
                        : row.is_occupied
                          ? 'bg-rose-500/15 hover:bg-rose-500/25 border-rose-500/30 text-rose-200'
                          : 'bg-slate-800/80 hover:bg-slate-700/80 border-slate-700/60 text-slate-200'
                    }`}
                  >
                    {row.label}
                    {row.is_occupied && <span className="ml-1 text-[9px] opacity-75">({tx(lang, 'dolu', 'занят', 'occ')})</span>}
                  </button>
                ))}
                {otherTables.length === 0 && (
                  <div className="text-[10px] text-slate-500 p-2 w-full text-center">{tx(lang, 'Masa tapılmadı', 'Столы не найдены', 'No tables found')}</div>
                )}
              </div>
            </div>
            <button
              className="mt-3 w-full rounded-lg border border-amber-300/40 bg-amber-500/15 py-2 text-sm font-bold text-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!mergeTargetId}
              onClick={async () => {
                if (!mergeTargetId) return;
                await onCombine(table.id, mergeTargetId);
                setMergeTargetId('');
              }}
            >
              {tx(lang, 'Masaları Birləşdir', 'Объединить', 'Combine Tables')}
            </button>
          </div>

          {/* Split */}
          <div className="rounded-xl border border-violet-300/20 bg-violet-500/10 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">{tx(lang, 'Masanı ayır', 'Разделить столы', 'Split tables')}</div>
            <div className="text-xs text-slate-300">{table.merged_group_id ? tx(lang, 'Bu birləşmiş qrupu yenidən ayrıca masalara ayırır', 'Разделяет объединенную группу обратно на отдельные столы', 'Split the merged group back into separate tables') : tx(lang, 'Masa hələ birləşdirilməyib', 'Стол еще не объединен', 'This table is not merged yet')}</div>
            <button
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-violet-300/40 bg-violet-500/15 px-3 py-2 text-sm font-semibold text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!table.merged_group_id}
              onClick={() => { void onSplit(table.id, (table as any).merged_group_id || null); }}
            >
              {tx(lang, 'Ayır', 'Разделить', 'Split')}
            </button>
          </div>

          {/* Cancel */}
          <div className="rounded-xl border border-rose-300/20 bg-rose-500/10 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200">{tx(lang, 'Masanı ləğv et', 'Отменить стол', 'Cancel table')}</div>
            <div className="text-xs text-slate-300">{tx(lang, 'Satış yaratmadan açıq check-i ləğv edir və masanı boşaldır', 'Отменяет открытый чек без продажи и освобождает стол', 'Cancel the open check without a sale and release the table')}</div>
            <button
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-rose-300/40 bg-rose-500/15 px-3 py-2 text-sm font-semibold text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!isManagerUser || !userCanEditTable}
              onClick={() => { void onCancel(table.id, table.label); }}
            >
              {tx(lang, 'Satışsız ləğv et', 'Отменить без продажи', 'Cancel without sale')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
