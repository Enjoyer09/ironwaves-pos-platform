import React from 'react';
import { tx } from '../../i18n';
import { formatServerUtcTime } from '../../lib/time';
import { kitchenBadge } from '../../utils/tables/tableUtils';

interface Round {
  id: string;
  round_no: number;
  status: string;
  created_at: string;
  items: Array<{ item_name: string; qty: number }>;
}

interface HistoryTabProps {
  rounds: Round[];
  lang: string;
}

export default function HistoryTab({ rounds, lang }: HistoryTabProps) {
  const labels = {
    sent: tx(lang, 'Mətbəxə göndərildi', 'Отправлено на кухню', 'Sent to kitchen'),
    preparing: tx(lang, 'Hazırlanır', 'Готовится', 'Preparing'),
    ready: tx(lang, 'Servisə hazırdır', 'Готово к подаче', 'Ready to serve'),
  };

  return (
    <div className="min-h-0 overflow-y-auto rounded-xl border border-slate-700/70 bg-slate-900/35 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Raund tarixçəsi', 'История раундов', 'Round history')}</div>
          <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Mətbəxə göndərilən hər əlavə sifariş ayrıca raund kimi görünür.', 'Каждая дополнительная отправка на кухню показывается отдельным раундом.', 'Each additional send to kitchen appears as a separate round.')}</div>
        </div>
        <div className="rounded-full border border-slate-700/70 bg-slate-950/40 px-3 py-1 text-xs font-semibold text-slate-200">
          {tx(lang, 'Növbəti raund', 'Следующий раунд', 'Next round')}: {rounds.length + 1}
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {rounds.length === 0 ? (
          <div className="rounded-lg bg-slate-950/30 px-3 py-3 text-sm text-slate-400">{tx(lang, 'Hələ mətbəxə göndərilmiş raund yoxdur', 'Пока нет отправленных на кухню раундов', 'No rounds have been sent to the kitchen yet')}</div>
        ) : (
          rounds.map((round) => {
            const badge = kitchenBadge(round.status, labels);
            return (
              <div key={round.id} className="rounded-xl border border-slate-700/60 bg-slate-950/30 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-100">
                    {tx(lang, 'Raund', 'Раунд', 'Round')} {round.round_no}
                  </div>
                  <div className="flex items-center gap-2">
                    {badge ? <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${badge.className}`}>{badge.label}</span> : null}
                    <span className="text-[11px] text-slate-400">{formatServerUtcTime(round.created_at, lang)}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(Array.isArray(round.items) ? round.items : []).map((row, idx) => (
                    <div key={`${round.id}_${idx}`} className="rounded-lg bg-black/20 px-3 py-2 text-xs text-slate-200">
                      {row.qty}x {row.item_name}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
