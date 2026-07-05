import React, { useState } from 'react';
import { tx } from '../../i18n';
import { getDB } from '../../lib/db_sim';
import { verifyLocalCredential } from '../../lib/local_auth';

interface DeleteAuthDialogProps {
  lang: string;
  onConfirm: () => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}

export default function DeleteAuthDialog({ lang, onConfirm, onCancel, onError }: DeleteAuthDialogProps) {
  const [password, setPassword] = useState('');

  const handleVerify = async () => {
    const users = getDB<any>('users');
    const candidates = users.filter((u: any) => ['admin', 'super_admin', 'manager'].includes(String(u.role || '').toLowerCase()));
    let valid = false;
    for (const candidate of candidates) {
      const matches = await verifyLocalCredential(password, candidate.password_hash || candidate.password);
      if (matches) { valid = true; break; }
    }
    if (!valid) {
      onError(tx(lang, 'Admin şifrəsi yanlışdır', 'Неверный пароль администратора', 'Admin password is incorrect'));
      return;
    }
    setPassword('');
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
      <div className="metal-panel w-full max-w-md p-5">
        <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Admin Təsdiqi', 'Подтверждение админа', 'Admin Confirmation')}</h3>
        <p className="mt-2 text-sm text-slate-300">{tx(lang, 'Masa silmək üçün admin şifrəsini daxil edin', 'Введите пароль администратора для удаления стола', 'Enter admin password to delete table')}</p>
        <input type="password" className="neon-input mt-3" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tx(lang, 'Admin şifrəsi', 'Пароль администратора', 'Admin password')} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="neon-btn rounded-lg px-4 py-2" onClick={() => { setPassword(''); onCancel(); }}>{tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}</button>
          <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={() => { void handleVerify(); }}>{tx(lang, 'Silməni Təsdiqlə', 'Подтвердить удаление', 'Confirm Delete')}</button>
        </div>
      </div>
    </div>
  );
}
