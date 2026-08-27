import React from 'react';
import { Clock, ChefHat, CheckCircle2, BellRing, UtensilsCrossed, User } from 'lucide-react';
import { tx } from '../../i18n';
import { formatServerUtcTime } from '../../lib/time';

interface RoundItem {
  item_name: string;
  qty: number;
  price?: string | number;
  seat_label?: string;
  action?: string | null;
  reason?: string;
  raw_status?: string;
}

interface Round {
  id: string;
  round_no: number;
  status: string;
  created_at: string;
  sent_by?: string;
  items: RoundItem[];
}

interface HistoryTabProps {
  rounds: Round[];
  lang: string;
}

function getRelativeTime(dateStr: string, lang: string): string {
  try {
    if (!dateStr) return '';
    const now = Date.now();
    const then = new Date(dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : `${dateStr}Z`).getTime();
    if (isNaN(then)) return '';
    const diffSec = Math.floor((now - then) / 1000);
    if (diffSec < 45) return tx(lang, 'indicə', 'только что', 'just now');
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return tx(lang, `${diffMin} dəq əvvəl`, `${diffMin} мин назад`, `${diffMin} min ago`);
    const diffHours = Math.floor(diffMin / 60);
    return tx(lang, `${diffHours} saat əvvəl`, `${diffHours} ч назад`, `${diffHours}h ago`);
  } catch {
    return '';
  }
}

export default function HistoryTab({ rounds, lang }: HistoryTabProps) {
  const getStatusBadge = (status: string) => {
    const s = String(status || '').toUpperCase();
    if (s === 'READY') {
      return {
        label: tx(lang, 'Servisə hazırdır', 'Готово к подаче', 'Ready to serve'),
        color: 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300',
        icon: <BellRing size={13} className="text-emerald-400 animate-bounce" />,
        dot: 'bg-emerald-400 ring-emerald-400/40',
      };
    }
    if (s === 'PREPARING') {
      return {
        label: tx(lang, 'Hazırlanır', 'Готовится', 'Preparing'),
        color: 'border-amber-400/50 bg-amber-500/20 text-amber-300',
        icon: <ChefHat size={13} className="text-amber-400" />,
        dot: 'bg-amber-400 ring-amber-400/40',
      };
    }
    if (s === 'SERVED' || s === 'DONE') {
      return {
        label: tx(lang, 'Süfrəyə verildi', 'Подано', 'Served'),
        color: 'border-cyan-400/40 bg-cyan-500/15 text-cyan-300',
        icon: <CheckCircle2 size={13} className="text-cyan-400" />,
        dot: 'bg-cyan-400 ring-cyan-400/40',
      };
    }
    return {
      label: tx(lang, 'Mətbəxə çatdı', 'Отправлено на кухню', 'Sent to kitchen'),
      color: 'border-blue-400/40 bg-blue-500/15 text-blue-300',
      icon: <Clock size={13} className="text-blue-400" />,
      dot: 'bg-blue-400 ring-blue-400/40',
    };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4 rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4 sm:p-5 overflow-hidden">
      {/* ═══ Header ═══ */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-black text-white sm:text-lg">
            {tx(lang, 'Mətbəx Göndərişləri', 'История отправок на кухню', 'Kitchen Dispatch History')}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {tx(
              lang,
              'Bu masadan mətbəxə göndərilən hər sifariş partiyası canlı statusu ilə qeyd olunur.',
              'Каждая отправка заказа на кухню фиксируется здесь с актуальным статусом.',
              'Every order batch sent to the kitchen is logged here with live status.'
            )}
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 self-start rounded-full border border-slate-700 bg-slate-900/80 px-3.5 py-1.5 text-xs font-bold text-slate-300 shadow-sm sm:self-auto">
          <span className="text-amber-400">⚡</span>
          <span>{tx(lang, 'Növbəti göndəriş', 'Следующая отправка', 'Next dispatch')}:</span>
          <span className="font-extrabold text-white">#{rounds.length + 1}</span>
        </div>
      </div>

      {/* ═══ Content: Timeline / List ═══ */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {rounds.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center">
            <UtensilsCrossed size={36} className="text-slate-600 mb-2" />
            <div className="text-sm font-bold text-slate-300">
              {tx(lang, 'Hələ mətbəxə göndərilmiş sifariş yoxdur', 'Пока нет заказов, отправленных на кухню', 'No dispatches sent to kitchen yet')}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {tx(
                lang,
                'Menyudan yeməkləri seçib "Mətbəxə Göndər" basdıqda burada 1-ci göndəriş kimi görünəcək.',
                'Выберите блюда и нажмите "Отправить на кухню" для создания первой отправки.',
                'Select items and tap "Send to Kitchen" to create the first dispatch.'
              )}
            </div>
          </div>
        ) : (
          <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-gradient-to-b before:from-blue-500 before:via-amber-500 before:to-emerald-500">
            {rounds.map((round, index) => {
              const badge = getStatusBadge(round.status);
              const isFirst = round.round_no === 1;
              const relativeTime = getRelativeTime(round.created_at, lang);

              return (
                <div key={round.id || `round_${index}`} className="relative group">
                  {/* Timeline node */}
                  <div
                    className={`absolute -left-6 top-3 flex h-5 w-5 items-center justify-center rounded-full border-2 border-slate-950 bg-slate-900 ring-4 ${badge.dot}`}
                    aria-hidden="true"
                  >
                    <div className="h-2 w-2 rounded-full bg-white" />
                  </div>

                  {/* Dispatch Card */}
                  <div className="rounded-2xl border border-slate-700/70 bg-slate-900/70 p-3.5 shadow-md backdrop-blur-sm transition-all hover:border-slate-600 sm:p-4">
                    {/* Card Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-white sm:text-base">
                          {isFirst
                            ? tx(lang, '1-ci Göndəriş (İlk Sifariş)', '1-я отправка (Основной заказ)', '1st Dispatch (Initial Order)')
                            : tx(lang, `${round.round_no}-ci Göndəriş (Əlavə)`, `${round.round_no}-я отправка (Дозаказ)`, `${round.round_no}th Dispatch (Add-on)`)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-black shadow-sm ${badge.color}`}>
                          {badge.icon}
                          <span>{badge.label}</span>
                        </span>
                      </div>
                    </div>

                    {/* Metadata Subheader */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                      <div className="flex items-center gap-1 font-semibold text-slate-300">
                        <Clock size={12} className="text-slate-500" />
                        <span>{formatServerUtcTime(round.created_at, lang)}</span>
                        {relativeTime && <span className="text-slate-500">({relativeTime})</span>}
                      </div>

                      {round.sent_by && (
                        <div className="flex items-center gap-1 text-slate-400">
                          <User size={12} className="text-slate-500" />
                          <span>{round.sent_by}</span>
                        </div>
                      )}
                    </div>

                    {/* Items Grid */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(Array.isArray(round.items) ? round.items : []).map((item, idx) => (
                        <div
                          key={`${round.id}_item_${idx}`}
                          className="flex items-center gap-2 rounded-xl border border-slate-700/60 bg-black/25 px-3 py-2 text-xs font-bold text-slate-100"
                        >
                          <span className="flex h-5 min-w-[20px] items-center justify-center rounded bg-amber-400/20 px-1 text-[11px] font-black text-amber-300">
                            {item.qty}x
                          </span>
                          <span>{item.item_name}</span>

                          {item.seat_label && (
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                              {item.seat_label}
                            </span>
                          )}

                          {item.reason && (
                            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] italic text-amber-300">
                              {item.reason}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
