import React from 'react';
import { Decimal } from 'decimal.js';
import { X } from 'lucide-react';
import { tx } from '../../../i18n';
import type { GLJournal, GLPeriodStatus } from '../../../api/gl';

// ─────────────────────────────── formatting ─────────────────────────────

export function money(value: string | number | null | undefined): string {
  let d: Decimal;
  try {
    d = new Decimal(value || 0);
  } catch {
    d = new Decimal(0);
  }
  const [int, frac] = d.abs().toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${d.isNeg() && !d.isZero() ? '−' : ''}${grouped}.${frac} ₼`;
}

export function isZero(value: string | number | null | undefined): boolean {
  try {
    return new Decimal(value || 0).isZero();
  } catch {
    return true;
  }
}

export function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 8)}01`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function journalStatusLabel(lang: string, status: string): string {
  const labels: Record<string, string> = {
    draft: tx(lang, 'Qaralama', 'Черновик', 'Draft'),
    pending_approval: tx(lang, 'Təsdiq gözləyir', 'Ожидает утверждения', 'Pending approval'),
    posted: tx(lang, 'Yazılıb', 'Проведено', 'Posted'),
    rejected: tx(lang, 'Rədd edilib', 'Отклонено', 'Rejected'),
    reversed: tx(lang, 'Storno edilib', 'Сторнировано', 'Reversed'),
  };
  return labels[status] || status;
}

export function journalTypeLabel(lang: string, type: string): string {
  const labels: Record<string, string> = {
    general: tx(lang, 'Ümumi', 'Общий', 'General'),
    adjustment: tx(lang, 'Düzəliş', 'Корректировка', 'Adjustment'),
    cash: tx(lang, 'Kassa', 'Касса', 'Cash'),
    bank: tx(lang, 'Bank', 'Банк', 'Bank'),
    opening: tx(lang, 'Açılış qalığı', 'Начальные остатки', 'Opening balance'),
    sales: tx(lang, 'Satış', 'Продажи', 'Sales'),
    purchase: tx(lang, 'Alış', 'Закупки', 'Purchase'),
    reversal: tx(lang, 'Storno', 'Сторно', 'Reversal'),
    tax: tx(lang, 'Vergi', 'Налог', 'Tax'),
    migration: tx(lang, 'Köçürmə', 'Миграция', 'Migration'),
    closing: tx(lang, 'Bağlanış', 'Закрытие', 'Closing'),
  };
  return labels[type] || type;
}

export function periodStatusLabel(lang: string, status: GLPeriodStatus | string): string {
  const labels: Record<string, string> = {
    open: tx(lang, 'Açıq', 'Открыт', 'Open'),
    soft_closed: tx(lang, 'Yumşaq bağlı', 'Мягко закрыт', 'Soft closed'),
    closed: tx(lang, 'Bağlı', 'Закрыт', 'Closed'),
  };
  return labels[status] || status;
}

// ─────────────────────────────── small UI parts ─────────────────────────

type Tone = 'emerald' | 'rose' | 'amber' | 'sky' | 'violet' | 'slate';

const badgeTone: Record<Tone, string> = {
  emerald: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100',
  rose: 'border-rose-300/30 bg-rose-400/10 text-rose-100',
  amber: 'border-amber-300/30 bg-amber-400/10 text-amber-100',
  sky: 'border-sky-300/30 bg-sky-400/10 text-sky-100',
  violet: 'border-violet-300/30 bg-violet-400/10 text-violet-100',
  slate: 'border-slate-600 bg-slate-800/70 text-slate-100',
};

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.08em] ${badgeTone[tone]}`}>
      {children}
    </span>
  );
}

export function JournalStatusBadge({ lang, status }: { lang: string; status: string }) {
  const tone: Tone = status === 'posted' ? 'emerald' : status === 'pending_approval' ? 'amber' : status === 'draft' ? 'sky' : 'rose';
  return <Badge tone={tone}>{journalStatusLabel(lang, status)}</Badge>;
}

export function Card({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[28px] border border-slate-800 bg-slate-900 p-4 md:p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-black text-white md:text-xl">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Metric({ label, value, tone }: { label: string; value: string; tone: Exclude<Tone, 'slate'> }) {
  const tones = {
    emerald: 'border-emerald-400/25 bg-emerald-950/30',
    rose: 'border-rose-400/25 bg-rose-950/30',
    amber: 'border-amber-400/25 bg-amber-950/30',
    sky: 'border-sky-400/25 bg-sky-950/30',
    violet: 'border-violet-400/25 bg-violet-950/30',
  } as const;
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-300">{label}</div>
      <div className="mt-2 text-xl font-black text-white md:text-2xl">{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">{children}</div>;
}

export function Loading({ lang }: { lang: string }) {
  return (
    <div role="status" aria-live="polite" className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm font-bold text-sky-200">
      {tx(lang, 'Yüklənir...', 'Загрузка...', 'Loading...')}
    </div>
  );
}

export const btn = {
  primary: 'min-h-11 rounded-2xl bg-yellow-400 px-4 text-sm font-black text-slate-950 hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60',
  ghost: 'min-h-11 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm font-black text-slate-100 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60',
  approve: 'min-h-11 rounded-2xl bg-emerald-300 px-4 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-60',
  danger: 'min-h-11 rounded-2xl border border-rose-400/40 px-4 text-sm font-black text-rose-100 hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-60',
  warn: 'min-h-11 rounded-2xl border border-amber-400/40 px-4 text-sm font-black text-amber-100 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-60',
};

export const inputCls = 'min-h-11 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 text-sm text-white focus:border-yellow-300 focus:outline-none';

export function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</label>
      {children}
    </div>
  );
}

export function DateRange({ lang, from, to, onFrom, onTo, idPrefix }: {
  lang: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; idPrefix: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field id={`${idPrefix}-from`} label={tx(lang, 'Başlanğıc', 'С', 'From')}>
        <input id={`${idPrefix}-from`} type="date" className={inputCls} value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} />
      </Field>
      <Field id={`${idPrefix}-to`} label={tx(lang, 'Son', 'По', 'To')}>
        <input id={`${idPrefix}-to`} type="date" className={inputCls} value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} />
      </Field>
    </div>
  );
}

// ─────────────────────────────── dialogs ────────────────────────────────

const dialogStack: object[] = [];

/** Accessible modal shell: focus is moved in on open, Escape closes, focus returns on close. */
export function Dialog({ title, onClose, children, wide = false, labelledBy }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; labelledBy: string;
}) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  React.useEffect(() => {
    const token = {};
    dialogStack.push(token);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
      (first || panelRef.current)?.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      // Only the topmost dialog reacts, so Escape in a nested dialog does not close its parent.
      if (event.key === 'Escape' && dialogStack[dialogStack.length - 1] === token) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      const index = dialogStack.indexOf(token);
      if (index >= 0) dialogStack.splice(index, 1);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/75 p-0 backdrop-blur-sm md:items-center md:p-6">
      <button type="button" data-close className="absolute inset-0 cursor-default" aria-label={title} tabIndex={-1} onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} className={`relative max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] border border-slate-800 bg-slate-950 p-5 shadow-[0_0_80px_rgba(0,0,0,0.55)] md:rounded-[28px] ${wide ? 'md:max-w-4xl' : 'md:max-w-lg'}`}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 id={labelledBy} className="text-xl font-black text-white">{title}</h3>
          <button type="button" data-close onClick={onClose} aria-label="Close" className="rounded-2xl border border-slate-700 p-2 text-slate-300 hover:text-white">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Asks for a reason (required unless `optional`) before running a sensitive action. */
export function ReasonDialog({ lang, title, confirmLabel, optional = false, onCancel, onConfirm }: {
  lang: string; title: string; confirmLabel: string; optional?: boolean;
  onCancel: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const valid = optional || reason.trim().length >= 3;
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={title} onClose={onCancel} labelledBy="gl-reason-title">
      <Field id="gl-reason" label={optional ? tx(lang, 'Səbəb (istəyə görə)', 'Причина (необязательно)', 'Reason (optional)') : tx(lang, 'Səbəb', 'Причина', 'Reason')}>
        <textarea id="gl-reason" rows={3} className={`${inputCls} py-2`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
      </Field>
      {!optional ? <p className="mt-2 text-xs text-slate-500">{tx(lang, 'Ən azı 3 simvol. Audit jurnalına yazılır.', 'Минимум 3 символа. Записывается в аудит.', 'At least 3 characters. Stored in the audit trail.')}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btn.ghost} onClick={onCancel}>{tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}</button>
        <button type="button" className={btn.primary} disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? tx(lang, 'Göndərilir...', 'Отправка...', 'Submitting...') : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function JournalSourceText({ lang, journal }: { lang: string; journal: Pick<GLJournal, 'source_module' | 'source_type' | 'source_id'> }) {
  if (!journal.source_type && !journal.source_module) return <span className="text-slate-500">—</span>;
  const label = journal.source_module === 'manual' ? tx(lang, 'Əl ilə', 'Вручную', 'Manual') : (journal.source_type || journal.source_module);
  return <span className="text-slate-300">{label}</span>;
}
