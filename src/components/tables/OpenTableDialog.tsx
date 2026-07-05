import React from 'react';
import { tx } from '../../i18n';
import { Decimal } from 'decimal.js';

interface OpenTableDialogProps {
  lang: string;
  guestCount: string;
  depositGuestCount: string;
  depositPerGuest: Decimal;
  onGuestCountChange: (value: string) => void;
  onDepositGuestCountChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function OpenTableDialog({
  lang,
  guestCount,
  depositGuestCount,
  depositPerGuest,
  onGuestCountChange,
  onDepositGuestCountChange,
  onConfirm,
  onCancel,
}: OpenTableDialogProps) {
  const maxGuests = Math.max(1, Number(guestCount || 1));

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
      <div className="metal-panel w-full max-w-md rounded-t-[28px] p-5 md:rounded-2xl">
        <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600 md:hidden" />
        <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Masa Açılışı', 'Открытие стола', 'Open Table')}</h3>
        <p className="mt-2 text-sm text-slate-300">
          {tx(lang, 'Masada neçə nəfər əyləşib və hansıları üçün depozit alındığını seçin.', 'Выберите, сколько гостей сидит за столом и за кого взят депозит.', 'Choose how many guests are seated and who has paid the deposit.')}
        </p>
        <div className="mt-4">
          <label className="text-sm text-slate-300">
            {tx(lang, 'Qonaq sayı', 'Количество гостей', 'Guest count')}
            <input
              className="neon-input mt-1"
              type="number"
              min={1}
              max={20}
              value={guestCount}
              onChange={(e) => onGuestCountChange(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
          <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Depozit qaydası', 'Правило депозита', 'Deposit rule')}</div>
          <div className="mt-2 text-xs text-slate-400">
            {tx(lang, 'Masa bir açıq check kimi qalır. Sadəcə neçə qonaq üçün depozit alındığını yazın.', 'Стол остается одним открытым чеком. Просто укажите, за скольких гостей взят депозит.', 'The table stays as one open check. Just enter how many guests paid a deposit.')}
          </div>
          <label className="mt-3 block text-sm text-slate-300">
            {tx(lang, 'Depozitli qonaq sayı', 'Количество гостей с депозитом', 'Deposited guest count')}
            <input
              className="neon-input mt-1"
              type="number"
              min={0}
              max={maxGuests}
              value={depositGuestCount}
              onChange={(e) => onDepositGuestCountChange(String(Math.max(0, Math.min(maxGuests, Number(e.target.value || 0)))))}
            />
          </label>
          <div className="mt-3 text-xs text-slate-400">
            {tx(lang, 'Nəfər başı depozit', 'Депозит с человека', 'Deposit per guest')}: {depositPerGuest.toFixed(2)} ₼
          </div>
          <div className="mt-1 text-sm font-semibold text-emerald-200">
            {tx(lang, 'Toplam depozit', 'Итоговый депозит', 'Total deposit')}: {depositPerGuest.times(Math.max(0, Number(depositGuestCount || 0))).toFixed(2)} ₼
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="neon-btn rounded-lg px-4 py-2" onClick={onCancel}>
            {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
          </button>
          <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={onConfirm}>
            {tx(lang, 'Masanı Aç', 'Открыть стол', 'Open Table')}
          </button>
        </div>
      </div>
    </div>
  );
}
