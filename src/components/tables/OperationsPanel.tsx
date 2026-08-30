import React, { useState } from 'react';
import { ArrowRightLeft, Layers, Scissors, XCircle, Search, Check, Users } from 'lucide-react';
import { tx } from '../../i18n';
import { playHapticTouch, playHapticSuccess } from '../../lib/haptics';

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

type OperationTab = 'transfer' | 'combine' | 'split' | 'cancel';

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
  const [activeTab, setActiveTab] = useState<OperationTab>('transfer');
  const [transferTargetId, setTransferTargetId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [searchTarget, setSearchTarget] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const filteredOtherTables = otherTables.filter((row) =>
    !searchTarget.trim() || String(row.label || '').toLowerCase().includes(searchTarget.trim().toLowerCase())
  );

  const selectedTransferTable = otherTables.find((r) => r.id === transferTargetId);
  const selectedMergeTable = otherTables.find((r) => r.id === mergeTargetId);

  return (
    <div className="flex flex-col space-y-4">
      {/* ═══ 1. Segmented Action Tabs (Large 52px Touch Targets) ═══ */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Transfer Tab */}
        <button
          type="button"
          onClick={() => { playHapticTouch(); setActiveTab('transfer'); }}
          className={`flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-semibold transition-all active:scale-[0.97] sm:text-sm ${
            activeTab === 'transfer'
              ? 'border-blue-400 bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'border-slate-700/80 bg-slate-900/60 text-slate-300 hover:bg-slate-800/80 hover:text-white'
          }`}
        >
          <ArrowRightLeft size={17} className={activeTab === 'transfer' ? 'text-white' : 'text-blue-400'} />
          <span>{tx(lang, 'Masanı Köçür', 'Перенести', 'Transfer')}</span>
        </button>

        {/* Combine Tab */}
        <button
          type="button"
          onClick={() => { playHapticTouch(); setActiveTab('combine'); }}
          className={`flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-semibold transition-all active:scale-[0.97] sm:text-sm ${
            activeTab === 'combine'
              ? 'border-amber-300 bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30'
              : 'border-slate-700/80 bg-slate-900/60 text-slate-300 hover:bg-slate-800/80 hover:text-white'
          }`}
        >
          <Layers size={17} className={activeTab === 'combine' ? 'text-slate-950' : 'text-amber-400'} />
          <span>{tx(lang, 'Birləşdir', 'Объединить', 'Combine')}</span>
        </button>

        {/* Split Tab */}
        <button
          type="button"
          onClick={() => { playHapticTouch(); setActiveTab('split'); }}
          className={`flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-semibold transition-all active:scale-[0.97] sm:text-sm ${
            activeTab === 'split'
              ? 'border-violet-400 bg-violet-600 text-white shadow-lg shadow-violet-600/30'
              : 'border-slate-700/80 bg-slate-900/60 text-slate-300 hover:bg-slate-800/80 hover:text-white'
          }`}
        >
          <Scissors size={17} className={activeTab === 'split' ? 'text-white' : 'text-violet-400'} />
          <span>{tx(lang, 'Ayır', 'Разделить', 'Split')}</span>
        </button>

        {/* Cancel Tab */}
        <button
          type="button"
          onClick={() => { playHapticTouch(); setActiveTab('cancel'); }}
          className={`flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-semibold transition-all active:scale-[0.97] sm:text-sm ${
            activeTab === 'cancel'
              ? 'border-rose-400 bg-rose-600 text-white shadow-lg shadow-rose-600/30'
              : 'border-slate-700/80 bg-slate-900/60 text-slate-300 hover:bg-slate-800/80 hover:text-white'
          }`}
        >
          <XCircle size={17} className={activeTab === 'cancel' ? 'text-white' : 'text-rose-400'} />
          <span>{tx(lang, 'Ləğv Et', 'Отменить', 'Cancel')}</span>
        </button>
      </div>

      {/* ═══ 2. Main Content Area per Tab ═══ */}
      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4 sm:p-5">
        {/* ─── TAB 1: TRANSFER ─── */}
        {activeTab === 'transfer' && (
          <div className="space-y-4">
            <div>
              <h4 className="text-base font-bold text-white sm:text-lg">{tx(lang, 'Açıq Çeki Başqa Masaya Köçür', 'Перенос открытого чека', 'Transfer open check')}</h4>
              <p className="mt-1 text-xs text-slate-300 sm:text-sm">
                {tx(
                  lang,
                  `${table.label} masasının bütün sifarişlərini seçilmiş boş masaya keçirir.`,
                  `Переносит все позиции стола ${table.label} на выбранный свободный стол.`,
                  `Transfers all orders from table ${table.label} to the selected empty table.`
                )}
              </p>
            </div>

            {/* Search if many tables */}
            {filteredOtherTables.filter((row) => !row.is_occupied).length > 3 && (
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTarget}
                  onChange={(e) => setSearchTarget(e.target.value)}
                  placeholder={tx(lang, 'Boş masa axtar...', 'Поиск свободного стола...', 'Search empty table...')}
                  className="neon-input h-12 w-full pl-10 pr-4 text-sm font-semibold"
                />
              </div>
            )}

            {/* Tables Touch Grid */}
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {tx(lang, 'Hədəf Boş Masa Seçin:', 'Выберите свободный стол:', 'Select Target Empty Table:')}
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 max-h-[320px] overflow-y-auto p-1 scrollbar-thin">
                {filteredOtherTables.filter((row) => !row.is_occupied).map((row) => {
                  const isSelected = transferTargetId === row.id;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => { playHapticTouch(); setTransferTargetId(isSelected ? '' : row.id); }}
                      className={`flex min-h-[58px] flex-col justify-center rounded-2xl border p-3 text-left transition-all active:scale-[0.97] ${
                        isSelected
                          ? 'border-blue-400 bg-blue-600/30 text-white ring-2 ring-blue-400 shadow-lg shadow-blue-500/20'
                          : 'border-slate-700/70 bg-slate-900/80 text-slate-200 hover:border-slate-500 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white sm:text-base">{row.label}</span>
                        {isSelected && <Check size={16} className="text-blue-400" />}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                        <Users size={11} />
                        <span>{Number(row.capacity || 4)} {tx(lang, 'yer', 'мест', 'seats')}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {filteredOtherTables.filter((row) => !row.is_occupied).length === 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm font-bold text-slate-400">
                  {tx(lang, 'Hazırda köçürmək üçün boş masa yoxdur.', 'Нет свободных столов для переноса.', 'No empty tables available for transfer.')}
                </div>
              )}
            </div>

            {/* Primary Action CTA */}
            <button
              type="button"
              disabled={!transferTargetId || isProcessing}
              onClick={async () => {
                if (!transferTargetId) return;
                setIsProcessing(true);
                playHapticSuccess();
                try {
                  await onTransfer(table.id, transferTargetId);
                  setTransferTargetId('');
                } finally {
                  setIsProcessing(false);
                }
              }}
              className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-blue-400/50 bg-gradient-to-r from-blue-600 to-blue-500 px-5 text-base font-bold text-white shadow-xl shadow-blue-600/25 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowRightLeft size={19} />
              <span>
                {selectedTransferTable
                  ? `${table.label} ➔ ${selectedTransferTable.label} ${tx(lang, 'Masanı Köçür', 'Перенести', 'Transfer')}`
                  : tx(lang, 'Masanı Köçür', 'Перенести стол', 'Transfer Table')}
              </span>
            </button>
          </div>
        )}

        {/* ─── TAB 2: COMBINE / MERGE ─── */}
        {activeTab === 'combine' && (
          <div className="space-y-4">
            <div>
              <h4 className="text-base font-bold text-white sm:text-lg">{tx(lang, 'Masaları Bir Check Altında Birləşdir', 'Объединение столов', 'Combine tables under one check')}</h4>
              <p className="mt-1 text-xs text-slate-300 sm:text-sm">
                {tx(
                  lang,
                  `Seçilmiş masanın sifarişlərini ${table.label} masası ilə birləşdirir və ümumi hesaba çevirir.`,
                  `Объединяет заказы выбранного стола со столом ${table.label} в единый счет.`,
                  `Combines orders from the selected table with table ${table.label} into a single bill.`
                )}
              </p>
            </div>

            {/* Search */}
            {otherTables.length > 6 && (
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTarget}
                  onChange={(e) => setSearchTarget(e.target.value)}
                  placeholder={tx(lang, 'Birləşdiriləcək masanı axtar...', 'Поиск стола...', 'Search table to combine...')}
                  className="neon-input h-12 w-full pl-10 pr-4 text-sm font-semibold"
                />
              </div>
            )}

            {/* Tables Touch Grid */}
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {tx(lang, 'Birləşdiriləcək Masanı Seçin:', 'Выберите стол для объединения:', 'Select Table to Combine:')}
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 max-h-[320px] overflow-y-auto p-1 scrollbar-thin">
                {filteredOtherTables.map((row) => {
                  const isSelected = mergeTargetId === row.id;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => { playHapticTouch(); setMergeTargetId(isSelected ? '' : row.id); }}
                      className={`flex min-h-[58px] flex-col justify-center rounded-2xl border p-3 text-left transition-all active:scale-[0.97] ${
                        isSelected
                          ? 'border-amber-300 bg-amber-500/30 text-white ring-2 ring-amber-400 shadow-lg shadow-amber-500/20'
                          : row.is_occupied
                            ? 'border-rose-500/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20'
                            : 'border-slate-700/70 bg-slate-900/80 text-slate-200 hover:border-slate-500 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white sm:text-base">{row.label}</span>
                        {isSelected && <Check size={16} className="text-amber-400" />}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                        <span>{Number(row.capacity || 4)} {tx(lang, 'yer', 'мест', 'seats')}</span>
                        {row.is_occupied && (
                          <span className="rounded-full bg-rose-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-rose-300">
                            {tx(lang, 'Dolu', 'Занят', 'Occ')}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {filteredOtherTables.length === 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-sm font-bold text-slate-400">
                  {tx(lang, 'Masa tapılmadı.', 'Столы не найдены.', 'No tables found.')}
                </div>
              )}
            </div>

            {/* Primary Action CTA */}
            <button
              type="button"
              disabled={!mergeTargetId || isProcessing}
              onClick={async () => {
                if (!mergeTargetId) return;
                setIsProcessing(true);
                playHapticSuccess();
                try {
                  await onCombine(table.id, mergeTargetId);
                  setMergeTargetId('');
                } finally {
                  setIsProcessing(false);
                }
              }}
              className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-400 to-yellow-400 px-5 text-base font-black text-slate-950 shadow-xl shadow-amber-500/25 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Layers size={19} />
              <span>
                {selectedMergeTable
                  ? `${table.label} + ${selectedMergeTable.label} ${tx(lang, 'Masaları Birləşdir', 'Объединить', 'Combine')}`
                  : tx(lang, 'Masaları Birləşdir', 'Объединить столы', 'Combine Tables')}
              </span>
            </button>
          </div>
        )}

        {/* ─── TAB 3: SPLIT ─── */}
        {activeTab === 'split' && (
          <div className="space-y-5">
            <div>
              <h4 className="text-base font-bold text-white sm:text-lg">{tx(lang, 'Birləşmiş Masanı Ayır', 'Разделение объединенного стола', 'Split merged table')}</h4>
              <p className="mt-1 text-xs text-slate-300 sm:text-sm">
                {table.merged_group_id
                  ? tx(
                      lang,
                      'Bu masa birləşmiş qrupdadır. Düyməyə basaraq masanı yenidən ayrıca müstəqil masalara ayıra bilərsiniz.',
                      'Этот стол находится в группе. Нажмите кнопку, чтобы разделить обратно на отдельные столы.',
                      'This table is in a merged group. Click below to split it back into independent tables.'
                    )
                  : tx(lang, 'Bu masa hələ heç bir başqa masa ilə birləşdirilməyib.', 'Этот стол еще не объединен с другими.', 'This table is not merged with any other table yet.')}
              </p>
            </div>

            <div className={`rounded-2xl border p-4 ${table.merged_group_id ? 'border-violet-400/50 bg-violet-500/15' : 'border-slate-800 bg-slate-900/50'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-slate-400">{tx(lang, 'Masa Statusu', 'Статус стола', 'Table Status')}</div>
                  <div className="mt-1 text-base font-bold text-white">
                    {table.merged_group_id ? tx(lang, '⚡ Birləşmiş Qrup Masası', '⚡ Объединенная группа', '⚡ Merged Group Table') : tx(lang, 'Ayrıca Tək Masa', 'Отдельный стол', 'Single Table')}
                  </div>
                </div>
                {table.merged_group_id && (
                  <span className="rounded-full border border-violet-400/40 bg-violet-500/30 px-3 py-1 text-xs font-semibold text-violet-200">
                    {tx(lang, 'Aktiv Qrup', 'Активная группа', 'Active Group')}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={!table.merged_group_id || isProcessing}
              onClick={async () => {
                setIsProcessing(true);
                playHapticSuccess();
                try {
                  await onSplit(table.id, (table as any).merged_group_id || null);
                } finally {
                  setIsProcessing(false);
                }
              }}
              className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-violet-400/50 bg-gradient-to-r from-violet-600 to-indigo-600 px-5 text-base font-bold text-white shadow-xl shadow-violet-600/25 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Scissors size={19} />
              <span>{tx(lang, 'Masanı Qrupdan Ayır', 'Разделить столы', 'Split From Group')}</span>
            </button>
          </div>
        )}

        {/* ─── TAB 4: CANCEL ─── */}
        {activeTab === 'cancel' && (
          <div className="space-y-5">
            <div>
              <h4 className="text-base font-semibold text-rose-100 sm:text-lg">{tx(lang, 'Masanı Satışsız Ləğv Et', 'Отмена стола без продажи', 'Cancel Table Without Sale')}</h4>
              <p className="mt-1 text-xs text-slate-300 sm:text-sm">
                {tx(
                  lang,
                  'Bu əməliyyat açıq çeki kassaya satış düşmədən tam ləğv edir və masanı boş (Available) vəziyyətinə qaytarır.',
                  'Это действие полностью отменяет открытый чек без создания продажи в кассе и освобождает стол.',
                  'This action cancels the open check without creating a cash sale and releases the table to available.'
                )}
              </p>
            </div>

            <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-xs text-rose-200 sm:text-sm">
              ⚠️ {tx(
                lang,
                'Diqqət: Bu əməliyyat yalnız masada səhv sifariş açıldıqda və ya qonaq heç bir xidmət almadan getdikdə istifadə olunmalıdır.',
                'Внимание: Используйте это действие только если заказ был открыт по ошибке.',
                'Warning: Only use this action if the order was opened by mistake or guest left without service.'
              )}
            </div>

            <button
              type="button"
              disabled={(!isManagerUser && !userCanEditTable) || isProcessing}
              onClick={() => {
                playHapticSuccess();
                onCancel(table.id, table.label);
              }}
              className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-rose-400/50 bg-gradient-to-r from-rose-600 to-red-600 px-5 text-base font-bold text-white shadow-xl shadow-rose-600/30 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <XCircle size={19} />
              <span>{tx(lang, 'Masanı Satışsız Ləğv Et', 'Отменить без продажи', 'Cancel Without Sale')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
