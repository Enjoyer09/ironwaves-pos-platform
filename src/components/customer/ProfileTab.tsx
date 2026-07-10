import React from 'react';
import { Bell, Gift, Languages } from 'lucide-react';
import { tx } from '../../i18n';
import { Haptic } from '../../lib/customer_utils';
import SimpleAreaChart from './SimpleAreaChart';

type Props = {
  safeLang: string;
  customer: any;
  notifications: any[];
  history: any[];
  chartData: Array<{ date: string; amount: number }>;
  primaryColor: string;
  isLight?: boolean;
  setLang: (lang: string) => void;
  markRead: (id: string) => void | Promise<void>;
};

export default function ProfileTab({ safeLang, customer, notifications, history, chartData, primaryColor, setLang, markRead, isLight = false }: Props) {
  
  const textPrimary = isLight ? 'text-slate-900' : 'text-white';
  const textSecond  = isLight ? 'text-slate-500' : 'text-white/60';
  const textMuted   = isLight ? 'text-slate-400' : 'text-white/40';
  const bgCard      = isLight ? 'bg-white border-black/8 shadow-[0_4px_20px_rgba(0,0,0,0.06)]' : 'bg-white/6 border-white/10 backdrop-blur-xl';
  const innerBoxBg  = isLight ? 'bg-slate-50 border-black/5 text-slate-800' : 'bg-slate-950/35 p-4 text-slate-200';
  const itemBorder  = isLight ? 'border-black/5 bg-slate-50' : 'border-slate-700/60 bg-slate-950/30';
  const langBarCls  = isLight ? 'border-black/8 bg-black/5 text-slate-700' : 'border-white/10 bg-white/6 text-slate-200';

  return (
    <div className="space-y-4">
      <section className={`rounded-[28px] border p-4 ${bgCard}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className={`text-lg font-bold ${textPrimary}`}>{tx(safeLang, 'Müştəri Profili', 'Профиль клиента', 'Customer profile')}</div>
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${langBarCls}`}>
            <Languages size={14} />
            <button type="button" onClick={async () => { await Haptic.light(); setLang('az'); }} className={safeLang === 'az' ? 'font-bold underline' : ''}>AZ</button>
            <button type="button" onClick={async () => { await Haptic.light(); setLang('en'); }} className={safeLang === 'en' ? 'font-bold underline' : ''}>EN</button>
            <button type="button" onClick={async () => { await Haptic.light(); setLang('ru'); }} className={safeLang === 'ru' ? 'font-bold underline' : ''}>RU</button>
          </div>
        </div>
        <div className={`mt-4 space-y-3 rounded-[24px] p-4 text-sm ${innerBoxBg}`}>
          <div className="flex items-center justify-between gap-3"><span className={textMuted}>{tx(safeLang, 'Kart ID', 'ID карты', 'Card ID')}</span><span className={`font-semibold ${textPrimary}`}>{customer.card_id}</span></div>
          <div className="flex items-center justify-between gap-3"><span className={textMuted}>{tx(safeLang, 'Tip', 'Тип', 'Type')}</span><span className={`font-semibold ${textPrimary}`}>{customer.type || 'Member'}</span></div>
          <div className="flex items-center justify-between gap-3"><span className={textMuted}>{tx(safeLang, 'Endirim', 'Скидка', 'Discount')}</span><span className={`font-semibold ${textPrimary}`}>{Number(customer.discount_percent || 0).toFixed(0)}%</span></div>
          <div className="flex items-center justify-between gap-3"><span className={textMuted}>{tx(safeLang, 'Qoşulma tarixi', 'Дата подключения', 'Joined')}</span><span className={`font-semibold ${textPrimary}`}>{customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '-'}</span></div>
        </div>
      </section>

      <section className={`rounded-[28px] border p-4 ${bgCard}`}>
        <div className={`mb-4 flex items-center gap-2 text-lg font-bold ${textPrimary}`}><Bell size={18} /> {tx(safeLang, 'Bildirişlər', 'Уведомления', 'Notifications')}</div>
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className={`rounded-2xl border p-4 text-sm ${itemBorder} ${textMuted}`}>{tx(safeLang, 'Yeni bildiriş yoxdur', 'Нет новых уведомлений', 'No new notifications')}</div>
          ) : notifications.map((row: any) => (
            <button
              key={row.id}
              type="button"
              onClick={async () => { await Haptic.light(); if (!row.is_read) void markRead(row.id); }}
              className={`w-full rounded-2xl border p-4 text-left transition ${row.is_read ? itemBorder : 'border-cyan-300/25 bg-cyan-500/10'}`}
            >
              <div className={`text-sm ${textPrimary}`}>{row.message}</div>
              <div className={`mt-2 text-xs ${textSecond}`}>{new Date(row.created_at).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </section>

      {chartData.length > 1 && (
        <section className={`rounded-[28px] border p-4 ${bgCard}`}>
          <div className={`mb-3 text-[15px] font-bold flex items-center gap-2 ${textPrimary}`}>
            <span className="text-yellow-500">📊</span>
            {tx(safeLang, 'Alış dinamikası', 'Динамика покупок', 'Purchase dynamics')}
          </div>
          <div className="mt-2 pr-2">
            <SimpleAreaChart data={chartData} primaryColor={primaryColor} safeLang={safeLang} />
          </div>
        </section>
      )}

      <section className={`rounded-[28px] border p-4 ${bgCard}`}>
        <div className={`mb-4 flex items-center gap-2 text-lg font-bold ${textPrimary}`}><Gift size={18} /> {tx(safeLang, 'Son tarixçə', 'Последняя история', 'Recent history')}</div>
        <div className="space-y-3">
          {history.length === 0 ? (
            <div className={`rounded-2xl border p-4 text-sm ${itemBorder} ${textMuted}`}>{tx(safeLang, 'Hələ alış tarixçəsi yoxdur', 'История покупок пока пуста', 'No purchase history yet')}</div>
          ) : history.map((row: any) => (
            <div key={row.id} className={`rounded-2xl border p-4 ${itemBorder}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`font-semibold ${textPrimary}`}>{new Date(row.created_at).toLocaleString()}</div>
                  <div className={`mt-1 text-sm ${textSecond}`}>{(row.items || []).map((item: any) => `${item.item_name} x${item.qty}`).join(', ') || '-'}</div>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-bold ${textPrimary}`}>{Number(row.total || 0).toFixed(2)} ₼</div>
                  <div className={`text-xs ${textSecond}`}>{row.payment_method}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
