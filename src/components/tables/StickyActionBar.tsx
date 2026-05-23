import React, { memo } from 'react';
import { tx } from '../../i18n';

type StickyActionBarProps = {
  lang: string;
  total: string;
  draftCount?: number;
  disabled?: boolean;
  onSend: () => void;
  onClear?: () => void | Promise<void>;
};

const tapFeedback = () => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([10, 20, 10]);
  } catch {
    // ignore
  }
};

function StickyActionBar({ lang, total, draftCount, disabled, onSend, onClear }: StickyActionBarProps) {
  return (
    <div className="sticky bottom-0 mt-4 space-y-3 rounded-2xl border border-yellow-300/20 bg-slate-950/95 p-3 shadow-[0_-12px_30px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between text-sm text-slate-300">
        <span>
          {tx(lang, 'Yeni sifariş cəmi', 'Сумма нового заказа', 'New order total')}
          {draftCount && draftCount > 0 ? (
            <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-yellow-400/20 px-1.5 text-[11px] font-black text-yellow-200">
              {draftCount}
            </span>
          ) : null}
        </span>
        <span className="text-base font-black text-slate-100">{total} ₼</span>
      </div>
      <div className="flex gap-2">
        {onClear ? (
          <button
            type="button"
            onClick={() => { void onClear(); }}
            className="inline-flex min-h-14 flex-1 items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-900/60 px-4 py-3 text-sm font-bold text-slate-200"
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
          className="glossy-gold inline-flex min-h-14 flex-[1.35] items-center justify-center rounded-2xl px-4 py-3 text-base font-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {tx(lang, 'Mətbəxə göndər', 'Отправить на кухню', 'Send to kitchen')}
        </button>
      </div>
    </div>
  );
}

export default memo(StickyActionBar);
