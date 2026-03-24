import React from 'react';
import { Lang, tx } from '../i18n';

type Props = {
  open: boolean;
  title: string;
  message: string;
  lang: Lang;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({
  open,
  title,
  message,
  lang,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4">
      <div className="metal-panel w-full max-w-md p-5">
        <h3 className="text-lg font-bold text-slate-100">{title}</h3>
        <p className="mt-2 text-sm text-slate-300">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="neon-btn rounded-lg px-4 py-2">
            {cancelLabel || tx(lang, 'Ləğv et', 'Отмена')}
          </button>
          <button onClick={onConfirm} className="glossy-gold rounded-lg px-4 py-2 font-semibold">
            {confirmLabel || tx(lang, 'Təsdiqlə', 'Подтвердить')}
          </button>
        </div>
      </div>
    </div>
  );
}
