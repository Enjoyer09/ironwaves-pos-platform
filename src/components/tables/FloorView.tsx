import React, { memo } from 'react';
import { Users } from 'lucide-react';
import { tx, type Lang } from '../../i18n';
import { getWaiterColor } from '../../utils/tables/tableUtils';
import type { FloorSummary } from '../../utils/tables/floorUtils';
import type { FloorPlanRecord, FloorTableState } from '../../api/restaurant';
import FloorTableEditor from './FloorTableEditor';
import TableGrid from './TableGrid';

type MergedGroup = { id: string; tables: Array<{ id: string; label: string }> };
type MergedGroupOutline = { id: string; label: string; left: string; width: string; top: string; height: string };

export type FloorViewProps = {
  lang: Lang;
  floorPlans: FloorPlanRecord[];
  activeFloorId: string;
  floorTables: FloorTableState[];
  floorEditMode: boolean;
  floorViewMode: 'map' | 'list';
  floorMultiSelectMode: boolean;
  floorDropPreview: { x: number; y: number } | null;
  draggingTableId: string | null;
  draggingTableIds: string[];
  selectedFloorTableId: string | null;
  selectedFloorTableIds: string[];
  selectedFloorTableLabel: string;
  selectedFloorTable: FloorTableState | null;
  selectedFloorGroup: MergedGroup | null;
  selectedFloorGroupId: string | null;
  selectedFloorTables: FloorTableState[];
  mergedGroups: MergedGroup[];
  mergedGroupOutlines: MergedGroupOutline[];
  floorSummary: FloorSummary;
  tablesById: Record<string, any>;
  readyCountsByLabel: Record<string, number>;
  tableGridScale: number;
  tableGridMinWidth: number;
  copyLayoutSourceFloorId: string;
  viewTableId: string | null;
  userRole: string;
  currentUsername?: string;
  isBahaYLab: boolean;
  // Callbacks
  setFloorViewMode: (mode: 'map' | 'list') => void;
  setFloorEditMode: (fn: (prev: boolean) => boolean) => void;
  setFloorMultiSelectMode: (fn: (prev: boolean) => boolean) => void;
  setSelectedFloorTableIds: (fn: string[] | ((prev: string[]) => string[])) => void;
  setSelectedFloorTableId: (id: string | null) => void;
  setSelectedFloorGroupId: (id: string | null) => void;
  setSelectedFloorTableLabel: (label: string) => void;
  setTableGridScale: (scale: number) => void;
  setCopyLayoutSourceFloorId: (id: string) => void;
  setDraggingTableId: (id: string | null) => void;
  setDraggingTableIds: (ids: string[]) => void;
  setFloorDropPreview: (preview: { x: number; y: number } | null) => void;
  setDeleteTableId: (id: string | null) => void;
  onFloorGridDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onNudgeSelectedTables: (dx: number, dy: number) => void;
  onPersistFloorLayout: (tableId: string, payload: any) => void;
  onNudgeGroup: (groupId: string, dx: number, dy: number) => void;
  onSplitGroup: (tableId: string, groupId: string) => void;
  onCopyFloorLayout: (sourceFloorId: string) => void;
  onResetFloorLayout: () => void;
  onRenameFloorPlan: (floorId: string, newName: string) => void;
  onDeleteFloorPlan: (floorId: string) => void;
  onSelectWaiterTable: (table: any) => void;
  onMarkTableClean: (tableId: string) => void;
  notify: (type: 'success' | 'error' | 'info', msg: string) => void;
};

function FloorView(props: FloorViewProps) {
  const {
    lang,
    floorPlans,
    activeFloorId,
    floorTables,
    floorEditMode,
    floorViewMode,
    floorMultiSelectMode,
    floorDropPreview,
    draggingTableId,
    draggingTableIds,
    selectedFloorTableId,
    selectedFloorTableIds,
    selectedFloorTableLabel,
    selectedFloorTable,
    selectedFloorGroup,
    selectedFloorGroupId,
    selectedFloorTables,
    mergedGroups,
    mergedGroupOutlines,
    floorSummary,
    tablesById,
    readyCountsByLabel,
    tableGridScale,
    tableGridMinWidth,
    copyLayoutSourceFloorId,
    viewTableId,
    userRole,
    currentUsername,
    isBahaYLab,
    setFloorViewMode,
    setFloorEditMode,
    setFloorMultiSelectMode,
    setSelectedFloorTableIds,
    setSelectedFloorTableId,
    setSelectedFloorGroupId,
    setSelectedFloorTableLabel,
    setTableGridScale,
    setCopyLayoutSourceFloorId,
    setDraggingTableId,
    setDraggingTableIds,
    setFloorDropPreview,
    setDeleteTableId,
    onFloorGridDrop,
    onNudgeSelectedTables,
    onPersistFloorLayout,
    onNudgeGroup,
    onSplitGroup,
    onCopyFloorLayout,
    onResetFloorLayout,
    onRenameFloorPlan,
    onDeleteFloorPlan,
    onSelectWaiterTable,
    onMarkTableClean,
    notify,
  } = props;

  const isManager = ['admin', 'manager', 'super_admin'].includes(userRole.toLowerCase());

  return (
    <>
      {/* Header: floor name + controls */}
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-bold text-slate-100">
            {floorPlans.find((row) => row.id === activeFloorId)?.name || tx(lang, 'Main Floor', 'Main Floor', 'Main Floor')}
          </div>
          {isManager && (
          <div className="mt-1 text-sm text-slate-400">
            {tx(lang, 'Floor plan görünüşü. Masaya toxunaraq seating və açıq check axınına keçin.', 'План зала. Нажмите на стол, чтобы перейти к seating и открытому чеку.', 'Floor plan view. Tap a table to continue into seating and open check flow.')}
          </div>
          )}
        </div>
        {isManager && (
        <div className="flex flex-wrap gap-2">
        {!floorEditMode && (
          <div className="flex rounded-full bg-slate-900/40 p-0.5 border border-slate-700/60">
            <button
              type="button"
              onClick={() => setFloorViewMode('map')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                floorViewMode === 'map' ? 'bg-cyan-300 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🗺️ {tx(lang, 'Xəritə', 'Карта', 'Map')}
            </button>
            <button
              type="button"
              onClick={() => setFloorViewMode('list')}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                floorViewMode === 'list' ? 'bg-cyan-300 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📋 {tx(lang, 'Siyahı', 'Список', 'List')}
            </button>
          </div>
        )}
        {!floorEditMode && floorViewMode === 'map' && (
          <label className="flex min-w-[210px] items-center gap-3 rounded-full border border-slate-700/70 bg-slate-900/40 px-4 py-2 text-xs font-semibold text-slate-200">
            <span>{tx(lang, 'Zoom', 'Зум', 'Zoom')}</span>
            <input
              type="range"
              min={85}
              max={115}
              step={5}
              value={tableGridScale}
              onChange={(e) => setTableGridScale(Number(e.target.value))}
              className="w-full accent-yellow-300"
            />
            <span className="min-w-10 text-right">{tableGridScale}%</span>
          </label>
        )}
        {isManager && (
          <>
            <button
              type="button"
              onClick={() => setFloorEditMode((prev) => !prev)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${floorEditMode ? 'bg-cyan-300 text-slate-950' : 'border border-slate-600 bg-slate-800/50 text-slate-200'}`}
            >
              {floorEditMode ? tx(lang, 'Editor açıqdır', 'Редактор включен', 'Editor on') : tx(lang, 'Floor editor', 'Редактор зала', 'Floor editor')}
            </button>
            {floorEditMode && (
              <button
                type="button"
                onClick={() => {
                  setFloorMultiSelectMode((prev) => !prev);
                  setSelectedFloorTableIds([]);
                }}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${floorMultiSelectMode ? 'bg-violet-300 text-slate-950' : 'border border-violet-300/30 bg-violet-500/10 text-violet-100'}`}
              >
                {floorMultiSelectMode ? tx(lang, 'Çoxlu seçim aktivdir', 'Множественный выбор активен', 'Multi-select on') : tx(lang, 'Çoxlu seçim', 'Множественный выбор', 'Multi-select')}
              </button>
            )}
          </>
        )}
      </div>
      )}
    </div>

      {/* Multi-select bar */}
      {floorEditMode && floorMultiSelectMode && selectedFloorTables.length > 0 && (
        <div className="mb-3 rounded-2xl border border-violet-300/20 bg-violet-500/10 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-bold text-violet-100">
                {tx(lang, 'Çoxlu seçim', 'Множественный выбор', 'Multi-select')} · {selectedFloorTables.length}
              </div>
              <div className="mt-1 text-xs text-violet-200/80">
                {selectedFloorTables.map((table) => table.label).join(', ')}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1 rounded-xl border border-violet-300/30 bg-slate-950/30 px-2 py-1 text-xs text-violet-100">
                <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void onNudgeSelectedTables(-1, 0); }}>←</button>
                <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void onNudgeSelectedTables(0, -1); }}>↑</button>
                <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void onNudgeSelectedTables(0, 1); }}>↓</button>
                <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void onNudgeSelectedTables(1, 0); }}>→</button>
              </div>
              <button
                type="button"
                className="rounded-xl border border-violet-300/30 bg-violet-500/15 px-4 py-2 text-sm font-semibold text-violet-100"
                onClick={() => setSelectedFloorTableIds([])}
              >
                {tx(lang, 'Seçimi təmizlə', 'Очистить выбор', 'Clear selection')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floor table editor */}
      {floorEditMode && selectedFloorTable && (
        <FloorTableEditor
          lang={lang}
          table={selectedFloorTable}
          tableLabel={selectedFloorTableLabel}
          group={selectedFloorGroup}
          onLabelChange={setSelectedFloorTableLabel}
          onSaveName={() => { void onPersistFloorLayout(selectedFloorTable.id, { label: selectedFloorTableLabel.trim() }); }}
          onPersistLayout={(tableId, payload) => { void onPersistFloorLayout(tableId, payload); }}
          onNudgeGroup={(groupId, dx, dy) => { void onNudgeGroup(groupId, dx, dy); }}
          onSplitGroup={(tableId, groupId) => { void onSplitGroup(tableId, groupId); }}
          onError={(msg) => notify('error', msg)}
        />
      )}

      {/* Status legend */}
      {isManager && (
      <div className="mb-3 flex flex-wrap gap-2">
        {[
          ['AVAILABLE', tx(lang, 'Boş', 'Свободно', 'Available'), 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100'],
          ['RESERVED', tx(lang, 'Rezerv', 'Резерв', 'Reserved'), 'border-amber-300/40 bg-amber-500/10 text-amber-100'],
          ['ACTIVE_CHECK', tx(lang, 'Aktiv çek', 'Активный чек', 'Active check'), 'border-rose-300/40 bg-rose-500/10 text-rose-100'],
          ['DIRTY', tx(lang, 'Təmizlik', 'Уборка', 'Dirty'), 'border-slate-300/30 bg-slate-500/20 text-slate-100'],
        ].map(([key, label, className]) => (
          <div key={String(key)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${className}`}>
            {label}: {floorSummary[String(key) as keyof FloorSummary] || 0}
          </div>
        ))}
      </div>
      )}

      {/* Merged group chips */}
      {isManager && mergedGroups.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {mergedGroups.map((group, index) => (
            <button
              key={group.id}
              type="button"
              onClick={() => {
                setSelectedFloorGroupId(group.id);
                setSelectedFloorTableId(group.tables[0]?.id || null);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${selectedFloorGroupId === group.id ? 'border-violet-200 bg-violet-500/25 text-violet-50' : 'border-violet-300/40 bg-violet-500/12 text-violet-100'}`}
            >
              {tx(lang, 'Birləşmiş qrup', 'Объединенная группа', 'Merged group')} {index + 1}: {group.tables.map((table) => table.label).join(' + ')}
            </button>
          ))}
        </div>
      )}

      {/* Floor edit toolbar */}
      {floorEditMode && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {floorPlans.length > 1 && (
            <select
              className="neon-input min-w-[220px]"
              value={copyLayoutSourceFloorId}
              onChange={(e) => setCopyLayoutSourceFloorId(e.target.value)}
            >
              <option value="">{tx(lang, 'Layout mənbəyi seçin', 'Выберите источник макета', 'Choose layout source')}</option>
              {floorPlans.filter((row) => row.id !== activeFloorId).map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100"
            onClick={() => { void onCopyFloorLayout(copyLayoutSourceFloorId); }}
            disabled={!copyLayoutSourceFloorId}
          >
            {tx(lang, 'Layout kopyala', 'Копировать макет', 'Copy layout')}
          </button>
          <button
            type="button"
            className="rounded-full border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100"
            onClick={() => { void onResetFloorLayout(); }}
          >
            {tx(lang, 'Layout sıfırla', 'Сбросить макет', 'Reset layout')}
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-600 bg-slate-800/50 text-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-700/60"
            onClick={() => {
              const currentFloor = floorPlans.find(f => f.id === activeFloorId);
              const newName = prompt(tx(lang, 'Yeni zal adı:', 'Новое название зала:', 'New floor plan name:'), currentFloor?.name);
              if (newName && newName.trim()) {
                void onRenameFloorPlan(activeFloorId, newName.trim());
              }
            }}
          >
            {tx(lang, 'Zalın adını dəyiş', 'Переименовать зал', 'Rename floor')}
          </button>
          {floorPlans.length > 1 && (
            <button
              type="button"
              className="rounded-full border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/20"
              onClick={() => {
                if (confirm(tx(lang, 'Bu zalı silmək istədiyinizdən əminsiniz? Bütün masalar digər zala keçiriləcək.', 'Вы уверены, что хотите удалить этот зал? Все столы будут перенесены в другой зал.', 'Are you sure you want to delete this floor plan? All tables will be moved to another floor.'))) {
                  void onDeleteFloorPlan(activeFloorId);
                }
              }}
            >
              {tx(lang, 'Zalı sil', 'Удалить зал', 'Delete floor')}
            </button>
          )}
          {selectedFloorTable && !tablesById[selectedFloorTable.id]?.is_occupied && (
            <button
              type="button"
              className="rounded-full border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100"
              onClick={() => setDeleteTableId(selectedFloorTable.id)}
            >
              {tx(lang, 'Seçilmiş masanı sil', 'Удалить выбранный стол', 'Delete selected table')}
            </button>
          )}
        </div>
      )}

      {/* Map grid or List view */}
      {floorEditMode || floorViewMode === 'map' ? (
        <div
          className="relative grid gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3"
          style={{
            gridTemplateColumns: `repeat(${Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12)}, minmax(0, 1fr))`,
            gridAutoRows: '70px',
          }}
          onDragOver={floorEditMode ? (e) => {
            e.preventDefault();
            if (!draggingTableId) return;
            const host = e.currentTarget;
            const rect = host.getBoundingClientRect();
            const maxCols = Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12);
            const columnWidth = rect.width / maxCols;
            const rowHeight = 70;
            const nextX = Math.max(0, Math.floor((e.clientX - rect.left) / columnWidth));
            const nextY = Math.max(0, Math.floor((e.clientY - rect.top) / rowHeight));
            setFloorDropPreview({ x: nextX, y: nextY });
          } : undefined}
          onDrop={floorEditMode ? (e) => { void onFloorGridDrop(e); } : undefined}
        >
          {/* Merged group outlines */}
          {mergedGroupOutlines.map((outline) => (
            <button
              key={outline.id}
              type="button"
              onClick={floorEditMode ? () => {
                const group = mergedGroups.find((row) => row.id === outline.id);
                setSelectedFloorGroupId(outline.id);
                setSelectedFloorTableId(group?.tables[0]?.id || null);
              } : undefined}
              className={`absolute rounded-[26px] border-2 border-dashed bg-violet-500/5 text-left ${selectedFloorGroupId === outline.id ? 'border-violet-100/90' : 'border-violet-300/45'} ${!floorEditMode ? 'pointer-events-none' : ''}`}
              style={{ left: outline.left, width: outline.width, top: outline.top, height: outline.height }}
            >
              <div className="absolute -top-5 left-2 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold text-violet-100">
                {outline.label}
              </div>
            </button>
          ))}

          {/* Drop preview crosshairs */}
          {floorEditMode && floorDropPreview && (
            <>
              <div className="pointer-events-none absolute inset-y-0 border-l border-cyan-300/60" style={{ left: `calc(${(floorDropPreview.x / Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12)) * 100}% + 12px)` }} />
              <div className="pointer-events-none absolute inset-x-0 border-t border-cyan-300/60" style={{ top: `${floorDropPreview.y * 70 + 12}px` }} />
            </>
          )}

          {/* Table cells */}
          {floorTables.map((table) => {
            const mergedGroupId = String((table as any).merged_group_id || '').trim();
            const groupTables = mergedGroupId
              ? floorTables.filter((r) => String((r as any).merged_group_id || '').trim() === mergedGroupId)
              : [];
            const occupiedTableInGroup = groupTables.find((r) => (r as any).is_occupied);
            const displayTable = occupiedTableInGroup || table;

            const statusColors: Record<string, string> = {
              AVAILABLE: 'bg-emerald-500/15 border-emerald-300/40 text-emerald-100 hover:bg-emerald-500/25',
              RESERVED: 'bg-amber-500/15 border-amber-300/40 text-amber-100 hover:bg-amber-500/25',
              SEATED: 'bg-sky-500/15 border-sky-300/40 text-sky-100 hover:bg-sky-500/25',
              ACTIVE_CHECK: 'bg-violet-500/15 border-violet-300/40 text-violet-100 hover:bg-violet-500/25',
              DIRTY: 'bg-slate-500/20 border-slate-300/30 text-slate-100 hover:bg-slate-500/30',
            };
            const waiterColor = (displayTable.status === 'SEATED' || displayTable.status === 'ACTIVE_CHECK') && (displayTable as any).assigned_to
              ? getWaiterColor((displayTable as any).assigned_to)
              : null;
            const statusColorClass = waiterColor
              ? `${waiterColor.bg} ${waiterColor.border} ${waiterColor.text} hover:bg-opacity-25`
              : (statusColors[String(displayTable.status || 'AVAILABLE').toUpperCase()] || statusColors.AVAILABLE);
            return (
              <button
                key={table.id}
                type="button"
                draggable={floorEditMode}
                onDragStart={floorEditMode ? () => {
                  const mgId = String((table as any).merged_group_id || '').trim();
                  const nextDragIds =
                    mgId && selectedFloorGroupId === mgId
                      ? (selectedFloorGroup?.tables.map((row) => row.id) || [table.id])
                      : (floorMultiSelectMode && selectedFloorTableIds.includes(table.id) ? selectedFloorTableIds : [table.id]);
                  setDraggingTableId(table.id);
                  setDraggingTableIds(nextDragIds);
                } : undefined}
                onDragEnd={floorEditMode ? () => {
                  setDraggingTableId(null);
                  setDraggingTableIds([]);
                  setFloorDropPreview(null);
                } : undefined}
                onClick={() => {
                  if (floorEditMode) {
                    if (floorMultiSelectMode) {
                      setSelectedFloorTableIds((prev: string[]) => (prev.includes(table.id) ? prev.filter((id: string) => id !== table.id) : [...prev, table.id]));
                    } else {
                      setSelectedFloorTableId(table.id);
                      setSelectedFloorGroupId(String((table as any).merged_group_id || '').trim() || null);
                    }
                  } else {
                    onSelectWaiterTable(table);
                  }
                }}
                className={`border p-3 text-left shadow-sm transition taktil-target ${String(table.shape || '').toLowerCase() === 'circle' ? 'rounded-[999px]' : String(table.shape || '').toLowerCase() === 'square' ? 'rounded-xl' : 'rounded-2xl'} ${draggingTableIds.includes(table.id) ? 'opacity-60' : ''} ${floorEditMode && selectedFloorTableId === table.id ? 'ring-2 ring-cyan-300/80' : ''} ${floorEditMode && selectedFloorTableIds.includes(table.id) ? 'ring-2 ring-violet-300/80' : ''} ${String((table as any).merged_group_id || '').trim() ? 'shadow-[0_0_0_2px_rgba(167,139,250,0.45)]' : ''} ${statusColorClass}`}
                style={{
                  gridColumn: `${Math.max(1, Number(table.x || 0) + 1)} / span ${Math.max(1, Number(table.w || 2))}`,
                  gridRow: `${Math.max(1, Number(table.y || 0) + 1)} / span ${Math.max(1, Number(table.h || 2))}`,
                }}
              >
                <div className="font-bold">{table.label}</div>
                <div className="mt-2 text-xs flex items-center justify-between gap-1 flex-wrap">
                  <span><Users size={12} className="mr-1 inline" />{Number(displayTable.guest_count || 0)} / {Number(table.capacity || 0)}</span>
                  {(displayTable as any).assigned_to && (
                    <span className="inline-flex items-center gap-1 text-[10px] opacity-90 px-1.5 py-0.5 rounded-full bg-black/40 border border-white/5 font-medium shrink-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${waiterColor?.dot || 'bg-slate-400'}`} />
                      {(displayTable as any).assigned_to}
                    </span>
                  )}
                </div>
                {(table as any).merged_group_id ? <div className="mt-2 rounded-full border border-violet-300/40 bg-violet-500/15 px-2 py-1 text-[11px] font-semibold text-violet-100">{tx(lang, 'Birləşmiş qrup', 'Объединенная группа', 'Merged group')}</div> : null}
                {floorEditMode && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button type="button" onClick={(e) => { e.stopPropagation(); void onPersistFloorLayout(table.id, { width_units: Math.max(1, Number(table.w || 1) - 1) }); }} className="rounded-md border border-slate-300/30 bg-black/20 px-2 py-1 text-[10px] font-semibold text-slate-100">W-</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); void onPersistFloorLayout(table.id, { width_units: Math.min(6, Number(table.w || 1) + 1) }); }} className="rounded-md border border-slate-300/30 bg-black/20 px-2 py-1 text-[10px] font-semibold text-slate-100">W+</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); void onPersistFloorLayout(table.id, { height_units: Math.max(1, Number(table.h || 1) - 1) }); }} className="rounded-md border border-slate-300/30 bg-black/20 px-2 py-1 text-[10px] font-semibold text-slate-100">H-</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); void onPersistFloorLayout(table.id, { height_units: Math.min(6, Number(table.h || 1) + 1) }); }} className="rounded-md border border-slate-300/30 bg-black/20 px-2 py-1 text-[10px] font-semibold text-slate-100">H+</button>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
          <div
            className={`rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3 ${viewTableId ? 'lg:pr-2' : ''}`}
            style={{ marginRight: viewTableId ? 'min(72vw, 1260px)' : '0' }}
          >
            <TableGrid
              floorTables={floorTables}
              tablesById={tablesById}
              readyCountsByLabel={readyCountsByLabel}
              viewTableId={viewTableId}
              tableGridMinWidth={tableGridMinWidth}
              lang={lang}
              currentUsername={currentUsername}
              currentUserRole={userRole}
              onSelectTable={onSelectWaiterTable}
              onMarkClean={(tableId) => { void onMarkTableClean(tableId); }}
              showMyTablesFilter={isBahaYLab}
            />
          </div>
          <div className="hidden lg:block" />
        </div>
      )}
    </>
  );
}

export default memo(FloorView);
