import React from 'react';
import { Lang, tx } from '../i18n';

type Props = {
  open: boolean;
  title: string;
  message: string;
  lang: Lang;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When set, shows a text field (virtual-keyboard enabled) and passes its value to onConfirm. */
  reasonLabel?: string;
  defaultReason?: string;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
};

export default function ConfirmModal({
  open,
  title,
  message,
  lang,
  confirmLabel,
  cancelLabel,
  reasonLabel,
  defaultReason,
  onConfirm,
  onCancel,
}: Props) {
  const [reason, setReason] = React.useState(defaultReason || '');
  React.useEffect(() => {
    if (open) setReason(defaultReason || '');
  }, [open, defaultReason]);
  const reasonMissing = Boolean(reasonLabel) && !reason.trim();
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => cancelButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = panelRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => !node.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      // With a text field, pin the dialog to the top: the on-screen keyboard takes
      // the bottom ~55% of a 768px POS screen and covered the Confirm button.
      className={`fixed inset-0 z-[130] flex justify-center bg-black/65 p-4 ${reasonLabel ? 'items-start pt-6' : 'items-center'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div ref={panelRef} className="metal-panel w-full max-w-md p-5">
        <h3 id={titleId} className="text-lg font-bold text-slate-100">{title}</h3>
        <p id={descriptionId} className="mt-2 text-base text-slate-300">{message}</p>
        {reasonLabel && (
          <label className="mt-3 block">
            <span className="mb-1 block text-sm font-semibold text-slate-200">{reasonLabel}</span>
            <input
              className="neon-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
            />
          </label>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button ref={cancelButtonRef} onClick={onCancel} className="neon-btn min-h-11 rounded-lg px-4 py-2">
            {cancelLabel || tx(lang, 'Ləğv et', 'Отмена')}
          </button>
          <button
            onClick={() => onConfirm(reasonLabel ? reason.trim() : undefined)}
            disabled={reasonMissing}
            className="glossy-gold min-h-11 rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
          >
            {confirmLabel || tx(lang, 'Təsdiqlə', 'Подтвердить')}
          </button>
        </div>
      </div>
    </div>
  );
}
