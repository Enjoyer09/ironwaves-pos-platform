import React from 'react';
import { tx } from '../../i18n';

interface CreateReservationDialogProps {
  lang: string;
  statusDraft: 'BOOKED' | 'WAITLIST';
  guestName: string;
  phone: string;
  time: string;
  partySize: string;
  assignedTableId: string;
  note: string;
  candidateTables: Array<{ id: string; label: string; capacity: number }>;
  suggestedTables: Array<{ id: string; label: string; capacity: number }>;
  onStatusDraftChange: (status: 'BOOKED' | 'WAITLIST') => void;
  onGuestNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onTimeChange: (v: string) => void;
  onPartySizeChange: (v: string) => void;
  onAssignedTableChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CreateReservationDialog(props: CreateReservationDialogProps) {
  const {
    lang, statusDraft, guestName, phone, time, partySize, assignedTableId, note,
    candidateTables, suggestedTables,
    onStatusDraftChange, onGuestNameChange, onPhoneChange, onTimeChange,
    onPartySizeChange, onAssignedTableChange, onNoteChange, onConfirm, onCancel,
  } = props;

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
      <div className="metal-panel w-full max-w-xl rounded-t-[28px] p-5 md:rounded-2xl">
        <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600 md:hidden" />
        <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Yeni rezervasiya', 'Новая бронь', 'New reservation')}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => onStatusDraftChange('BOOKED')} className={`rounded-full px-3 py-1 text-xs font-semibold ${statusDraft === 'BOOKED' ? 'bg-amber-300 text-slate-950' : 'border border-amber-300/30 bg-amber-500/10 text-amber-100'}`}>
            {tx(lang, 'Rezerv', 'Бронь', 'Booked')}
          </button>
          <button type="button" onClick={() => { onStatusDraftChange('WAITLIST'); onAssignedTableChange(''); }} className={`rounded-full px-3 py-1 text-xs font-semibold ${statusDraft === 'WAITLIST' ? 'bg-violet-300 text-slate-950' : 'border border-violet-300/30 bg-violet-500/10 text-violet-100'}`}>
            {tx(lang, 'Gözləmə siyahısı', 'Лист ожидания', 'Waitlist')}
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            {tx(lang, 'Qonaq adı', 'Имя гостя', 'Guest name')}
            <input className="neon-input mt-1" value={guestName} onChange={(e) => onGuestNameChange(e.target.value)} />
          </label>
          <label className="text-sm text-slate-300">
            {tx(lang, 'Telefon', 'Телефон', 'Phone')}
            <input className="neon-input mt-1" value={phone} onChange={(e) => onPhoneChange(e.target.value)} />
          </label>
          <label className="text-sm text-slate-300">
            {tx(lang, 'Vaxt', 'Время', 'Time')}
            <input className="neon-input mt-1" type="time" value={time} onChange={(e) => onTimeChange(e.target.value)} />
          </label>
          <label className="text-sm text-slate-300">
            {tx(lang, 'Nəfər sayı', 'Количество гостей', 'Party size')}
            <input className="neon-input mt-1" type="number" min={1} max={20} value={partySize} onChange={(e) => onPartySizeChange(e.target.value)} />
          </label>
          <label className="text-sm text-slate-300">
            {tx(lang, 'Masa seçimi', 'Выбор стола', 'Table selection')}
            <select className="neon-input mt-1" value={assignedTableId} onChange={(e) => onAssignedTableChange(e.target.value)} disabled={statusDraft === 'WAITLIST'}>
              <option value="">{tx(lang, 'Sonra təyin et', 'Назначить позже', 'Assign later')}</option>
              {candidateTables.map((table) => (
                <option key={table.id} value={table.id}>{table.label} · {tx(lang, 'Tutum', 'Вместимость', 'Capacity')} {table.capacity}</option>
              ))}
            </select>
          </label>
        </div>
        {statusDraft !== 'WAITLIST' && suggestedTables.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">{tx(lang, 'Təklif olunan masalar', 'Рекомендуемые столы', 'Suggested tables')}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestedTables.map((table) => (
                <button key={table.id} type="button" onClick={() => onAssignedTableChange(table.id)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${assignedTableId === table.id ? 'border-cyan-200 bg-cyan-300 text-slate-950' : 'border-cyan-300/30 bg-cyan-500/10 text-cyan-100'}`}>
                  {table.label} · {tx(lang, 'Tutum', 'Вместимость', 'Capacity')} {table.capacity}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="mt-3 block text-sm text-slate-300">
          {tx(lang, 'Qeyd', 'Примечание', 'Note')}
          <textarea className="neon-input mt-1 min-h-[88px]" value={note} onChange={(e) => onNoteChange(e.target.value)} />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="neon-btn rounded-lg px-4 py-2" onClick={onCancel}>{tx(lang, 'Bağla', 'Закрыть', 'Close')}</button>
          <button type="button" className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={onConfirm}>{tx(lang, 'Yarat', 'Создать', 'Create')}</button>
        </div>
      </div>
    </div>
  );
}
