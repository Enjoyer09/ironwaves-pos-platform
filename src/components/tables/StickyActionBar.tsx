import React, { memo } from 'react';
import { Send } from 'lucide-react';
import { tx } from '../../i18n';

type StickyActionBarProps = {
  lang: string;
  total: string;
  disabled?: boolean;
  onSend: () => void;
  onClear?: () => void | Promise<void>;
  draftCount?: number;
  onSettle?: () => void;
  settleDisabled?: boolean;
  showSettle?: boolean;
};

const tapFeedback = () => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([10, 20, 10]);
  } catch {
    // ignore
  }
};

function StickyActionBar({ lang, total, disabled, onSend, onClear, draftCount, onSettle, settleDisabled, showSettle }: StickyActionBarProps) {
  return (
    <div className="sticky bottom-0 mt-4 space-y-3 rounded-2xl border border-yellow-300/20 bg-slate-950/95 p-3 shadow-[0_-12px_30px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between text-sm text-slate-300">
        <span>
          {tx(lang, 'Yeni sifariş cəmi', 'Сумма нового заказа', 'New order total')}
          {draftCount ? <span className="ml-2 rounded-full bg-yellow-400/20 px-2 py-0.5 text-xs font-bold text-yellow-300">{draftCount}</span> : null}
        </span>
        <span className="text-lg font-black text-slate-100">{total} ₼</span>
      </div>
      <div className="flex gap-2">
        {onClear ? (
          <button
            type="button"
            onClick={() => { void onClear(); }}
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-sm font-bold text-slate-200"
          >
            {tx(lang, 'Təmizlə', 'Очистить', 'Clear')}
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            tapFeedback();
            onSend();
          }}
          className="glossy-gold inline-flex min-h-12 flex-[1.3] items-center justify-center gap-2 rounded-2xl px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={16} />
          {tx(lang, 'Mətbəxə göndər', 'Отправить на кухню', 'Send to kitchen')}
        </button>
        {showSettle && onSettle ? (
          <button
            type="button"
            disabled={settleDisabled}
            onClick={() => { tapFeedback(); onSettle(); }}
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-emerald-300/40 bg-emerald-500/15 px-3 py-2 text-sm font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {tx(lang, 'Hesabı Al', 'Закрыть счет', 'Settle')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default memo(StickyActionBar);
