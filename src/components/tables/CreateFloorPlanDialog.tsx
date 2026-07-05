import React from 'react';
import { tx } from '../../i18n';

interface CreateFloorPlanDialogProps {
  lang: string;
  name: string;
  width: number;
  height: number;
  onNameChange: (v: string) => void;
  onWidthChange: (v: number) => void;
  onHeightChange: (v: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CreateFloorPlanDialog({
  lang, name, width, height, onNameChange, onWidthChange, onHeightChange, onConfirm, onCancel,
}: CreateFloorPlanDialogProps) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div className="metal-panel w-full max-w-lg p-6 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-yellow-400">✨</span>
          {tx(lang, 'Yeni Zal / Zona Yarat', 'Создать новый зал / зону', 'Create New Zone')}
        </h3>
        <div className="mt-3 rounded-2xl bg-white/5 p-4 text-xs leading-5 text-slate-300 border border-white/5">
          <p className="font-bold text-white mb-1">💡 {tx(lang, 'Zonalar nədir?', 'Что такое зоны?', 'What are zones?')}</p>
          {tx(lang, 'Zonalar restoran və ya kafenizin müxtəlif fiziki sahələrini (məsələn: Daxili zal, Teras, VIP) təmsil edir. Hər bir zona üçün masaları yerləşdirə biləcəyiniz xüsusi ızqara (grid) ölçüləri təyin edə bilərsiniz.', 'Зоны представляют собой различные физические зоны вашего ресторана или кафе (например: внутренний зал, терраса, VIP). Для каждой зоны вы можете задать сетку для размещения столов.', 'Zones represent different physical areas of your restaurant or cafe (e.g. Indoor, Terrace, VIP). For each zone, you can define grid dimensions where tables will be positioned.')}
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              {tx(lang, 'Zalın Adı', 'Название зала', 'Zone Name')}
            </label>
            <input className="neon-input" placeholder={tx(lang, 'Məsələn: Teras, VIP Otaq', 'Например: Терраса, VIP комната', 'E.g. Terrace, VIP Room')} value={name} onChange={(e) => onNameChange(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">{tx(lang, 'En (Izqara vahidi)', 'Ширина (сетка)', 'Grid Width')}</label>
              <input type="number" min={6} max={24} className="neon-input" value={width} onChange={(e) => onWidthChange(Number(e.target.value))} />
              <span className="text-[10px] text-slate-500 mt-1 block">{tx(lang, 'Minimum 6, Default 12', 'Минимум 6, по умолчанию 12', 'Min 6, Default 12')}</span>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">{tx(lang, 'Hündürlük (Izqara vahidi)', 'Высота (сетка)', 'Grid Height')}</label>
              <input type="number" min={4} max={20} className="neon-input" value={height} onChange={(e) => onHeightChange(Number(e.target.value))} />
              <span className="text-[10px] text-slate-500 mt-1 block">{tx(lang, 'Minimum 4, Default 8', 'Минимум 4, по умолчанию 8', 'Min 4, Default 8')}</span>
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-white/5 pt-4">
          <button className="neon-btn rounded-xl px-5 py-2.5 text-sm font-semibold" onClick={onCancel}>{tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}</button>
          <button className="glossy-gold rounded-xl px-5 py-2.5 text-sm font-bold disabled:opacity-50" onClick={onConfirm} disabled={!name.trim()}>{tx(lang, 'Yarat', 'Создать', 'Create')}</button>
        </div>
      </div>
    </div>
  );
}
