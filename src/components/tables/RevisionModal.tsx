import React, { useState } from 'react';
import { tx } from '../../i18n';

interface RevisionModalProps {
  target: { tableId: string; itemName: string; nextItems: any[]; hasSentItems: boolean };
  lang: string;
  onClose: () => void;
  onConfirm: (reason: string, overridePassword: string) => Promise<void>;
}

export default function RevisionModal({ target, lang, onClose, onConfirm }: RevisionModalProps) {
  const [reason, setReason] = useState('');
  const [overridePassword, setOverridePassword] = useState('');

  return (
    <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/70 p-4">
      <div className="metal-panel w-full max-w-md p-5">
        <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Manager/Admin Təsdiqi', 'Подтверждение manager/admin', 'Manager/Admin Override')}</h3>
        <p className="mt-2 text-sm text-slate-300">
          {target.hasSentItems
            ? tx(lang, `"${target.itemName}" mətbəxə göndərilib. Dəyişiklik üçün manager/admin şifrəsi və səbəb lazımdır.`, `"${target.itemName}" уже отправлен на кухню. Для изменения нужны пароль manager/admin и причина.`, `"${target.itemName}" was already sent to the kitchen. Manager/admin password and reason are required.`)
            : tx(lang, `"${target.itemName}" hələ mətbəxə göndərilməyib. Bilavasitə silinir.`, `"${target.itemName}" еще не отправлялся на кухню. Будет удалено немедленно.`, `"${target.itemName}" has not been sent to the kitchen yet. It will be removed directly.`)}
        </p>
        {target.hasSentItems && (
          <>
            <input
              className="neon-input mt-3"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tx(lang, 'Səbəb', 'Причина', 'Reason')}
            />
            <input
              type="password"
              className="neon-input mt-3"
              value={overridePassword}
              onChange={(e) => setOverridePassword(e.target.value)}
              placeholder={tx(lang, 'Manager/Admin şifrəsi', 'Пароль manager/admin', 'Manager/Admin password')}
            />
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="neon-btn rounded-lg px-4 py-2" onClick={onClose}>
            {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
          </button>
          <button
            className="glossy-gold rounded-lg px-4 py-2 font-semibold"
            onClick={() => { void onConfirm(reason, overridePassword); }}
          >
            {tx(lang, 'Təsdiqlə', 'Подтвердить', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
