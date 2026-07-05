import React from 'react';
import { tx } from '../../i18n';

interface FloorTableEditorProps {
  lang: string;
  table: { id: string; label: string; shape?: string; w: number; h: number; capacity: number };
  tableLabel: string;
  group: { id: string; tables: Array<{ id: string; label: string }> } | null;
  onLabelChange: (v: string) => void;
  onSaveName: () => void;
  onPersistLayout: (tableId: string, payload: any) => void;
  onNudgeGroup: (groupId: string, dx: number, dy: number) => void;
  onSplitGroup: (tableId: string, groupId: string) => void;
  onError: (msg: string) => void;
}

export default function FloorTableEditor(props: FloorTableEditorProps) {
  const { lang, table, tableLabel, group, onLabelChange, onSaveName, onPersistLayout, onNudgeGroup, onSplitGroup, onError } = props;

  return (
    <div className="mb-3 rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-bold text-cyan-100">
            {tx(lang, 'Floor editor: seçilmiş masa', 'Редактор зала: выбранный стол', 'Floor editor: selected table')} · {table.label}
          </div>
          <div className="mt-1 text-xs text-cyan-200/80">
            {tx(lang, 'Ölçü, forma və tutumu buradan dəyişin.', 'Меняйте размер, форму и вместимость здесь.', 'Change size, shape, and capacity here.')}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[240px] items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-2 py-2 text-xs text-cyan-100">
            <input className="neon-input h-9 min-w-[150px] flex-1" value={tableLabel} onChange={(e) => onLabelChange(e.target.value)} placeholder={tx(lang, 'Masa adı', 'Название стола', 'Table name')} />
            <button type="button" className="rounded-md border border-cyan-300/30 px-3 py-2 text-xs font-semibold" onClick={() => {
              if (!tableLabel.trim()) { onError(tx(lang, 'Masa adı boş ola bilməz', 'Название стола не может быть пустым', 'Table name cannot be empty')); return; }
              onSaveName();
            }}>{tx(lang, 'Adı saxla', 'Сохранить имя', 'Save name')}</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-600 bg-slate-900/40 px-2 py-2 text-xs text-slate-200">
            <span className="font-semibold text-slate-300">{tx(lang, 'Preset', 'Пресет', 'Preset')}</span>
            <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => onPersistLayout(table.id, { shape: 'circle', width_units: 2, height_units: 2, capacity: 2 })}>{tx(lang, '2-seat round', 'Круглый на 2', '2-seat round')}</button>
            <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => onPersistLayout(table.id, { shape: 'square', width_units: 2, height_units: 2, capacity: 4 })}>{tx(lang, '4-seat square', 'Квадрат на 4', '4-seat square')}</button>
            <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => onPersistLayout(table.id, { shape: 'rectangle', width_units: 3, height_units: 2, capacity: 6 })}>{tx(lang, '6-seat banquette', 'Банкетка на 6', '6-seat banquette')}</button>
          </div>
          <select className="neon-input min-w-[150px]" value={String(table.shape || 'rectangle')} onChange={(e) => onPersistLayout(table.id, { shape: e.target.value })}>
            <option value="rectangle">{tx(lang, 'Düzbucaqlı', 'Прямоугольник', 'Rectangle')}</option>
            <option value="square">{tx(lang, 'Kvadrat', 'Квадрат', 'Square')}</option>
            <option value="circle">{tx(lang, 'Dairəvi', 'Круглый', 'Circle')}</option>
          </select>
          <button type="button" className="rounded-xl border border-slate-600 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-100" onClick={() => onPersistLayout(table.id, { width_units: Math.max(1, table.h), height_units: Math.max(1, table.w) })}>{tx(lang, '90° döndər', 'Повернуть на 90°', 'Rotate 90°')}</button>
          <div className="flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-900/40 px-2 py-1 text-xs text-slate-200">
            <span>{tx(lang, 'En', 'Ширина', 'Width')}</span>
            <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => onPersistLayout(table.id, { width_units: Math.max(1, table.w - 1) })}>-</button>
            <span className="min-w-6 text-center font-semibold">{table.w}</span>
            <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => onPersistLayout(table.id, { width_units: Math.min(6, table.w + 1) })}>+</button>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-900/40 px-2 py-1 text-xs text-slate-200">
            <span>{tx(lang, 'Hündürlük', 'Высота', 'Height')}</span>
            <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => onPersistLayout(table.id, { height_units: Math.max(1, table.h - 1) })}>-</button>
            <span className="min-w-6 text-center font-semibold">{table.h}</span>
            <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => onPersistLayout(table.id, { height_units: Math.min(6, table.h + 1) })}>+</button>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-900/40 px-2 py-1 text-xs text-slate-200">
            <span>{tx(lang, 'Tutum', 'Вместимость', 'Capacity')}</span>
            <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => onPersistLayout(table.id, { capacity: Math.max(1, table.capacity - 1) })}>-</button>
            <span className="min-w-6 text-center font-semibold">{table.capacity}</span>
            <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => onPersistLayout(table.id, { capacity: Math.min(20, table.capacity + 1) })}>+</button>
          </div>
        </div>
      </div>
      {group && (
        <div className="mt-3 rounded-2xl border border-violet-300/25 bg-violet-500/10 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-bold text-violet-100">{tx(lang, 'Seçilmiş birləşmiş qrup', 'Выбранная объединенная группа', 'Selected merged group')}</div>
              <div className="mt-1 text-xs text-violet-200/80">{group.tables.map((t) => t.label).join(' + ')}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1 rounded-xl border border-violet-300/30 bg-slate-950/30 px-2 py-1 text-xs text-violet-100">
                <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => onNudgeGroup(group.id, -1, 0)}>←</button>
                <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => onNudgeGroup(group.id, 0, -1)}>↑</button>
                <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => onNudgeGroup(group.id, 0, 1)}>↓</button>
                <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => onNudgeGroup(group.id, 1, 0)}>→</button>
              </div>
              <button type="button" className="rounded-xl border border-violet-300/40 bg-violet-500/15 px-4 py-2 text-sm font-semibold text-violet-100" onClick={() => onSplitGroup(table.id, group.id)}>{tx(lang, 'Qrupu ayır', 'Разделить группу', 'Split group')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
