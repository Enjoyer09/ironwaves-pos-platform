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

export default function ProfileTab({ safeLang, customer, notifications, history, chartData, primaryColor, setLang, markRead }: Props) {
  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-lg font-bold text-white">{tx(safeLang, 'Müştəri Profili', 'Профиль клиента', 'Customer profile')}</div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs text-slate-200">
            <Languages size={14} />
            <button type="button" onClick={async () => { await Haptic.light(); setLang('az'); }} className={safeLang === 'az' ? 'font-bold underline' : ''}>AZ</button>
            <button type="button" onClick={async () => { await Haptic.light(); setLang('en'); }} className={safeLang === 'en' ? 'font-bold underline' : ''}>EN</button>
            <button type="button" onClick={async () => { await Haptic.light(); setLang('ru'); }} className={safeLang === 'ru' ? 'font-bold underline' : ''}>RU</button>
          </div>
        </div>
        <div className="mt-4 space-y-3 rounded-[24px] bg-slate-950/35 p-4 text-sm text-slate-200">
          <div className="flex items-center justify-between gap-3"><span className="text-slate-400">{tx(safeLang, 'Kart ID', 'ID карты', 'Card ID')}</span><span className="font-semibold text-white">{customer.card_id}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-400">{tx(safeLang, 'Tip', 'Тип', 'Type')}</span><span className="font-semibold text-white">{customer.type || 'Member'}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-400">{tx(safeLang, 'Endirim', 'Скидка', 'Discount')}</span><span className="font-semibold text-white">{Number(customer.discount_percent || 0).toFixed(0)}%</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-400">{tx(safeLang, 'Qoşulma tarixi', 'Дата подключения', 'Joined')}</span><span className="font-semibold text-white">{customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '-'}</span></div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-2 text-lg font-bold text-white"><Bell size={18} /> {tx(safeLang, 'Bildirişlər', 'Уведомления', 'Notifications')}</div>
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">{tx(safeLang, 'Yeni bildiriş yoxdur', 'Нет новых уведомлений', 'No new notifications')}</div>
          ) : notifications.map((row: any) => (
            <button
              key={row.id}
              type="button"
              onClick={async () => { await Haptic.light(); if (!row.is_read) void markRead(row.id); }}
              className={`w-full rounded-2xl border p-4 text-left ${row.is_read ? 'border-slate-700/60 bg-slate-950/20' : 'border-cyan-300/20 bg-cyan-400/10'}`}
            >
              <div className="text-sm text-white">{row.message}</div>
              <div className="mt-2 text-xs text-slate-400">{new Date(row.created_at).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </section>

      {chartData.length > 1 && (
        <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
          <div className="mb-3 text-[15px] font-bold text-white flex items-center gap-2">
            <span className="text-yellow-400">📊</span>
            {tx(safeLang, 'Alış dinamikası', 'Динамика покупок', 'Purchase dynamics')}
          </div>
          <div className="mt-2 pr-2">
            <SimpleAreaChart data={chartData} primaryColor={primaryColor} safeLang={safeLang} />
          </div>
        </section>
      )}

      <section className="rounded-[28px] border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
        <div className="mb-4 flex items-center gap-2 text-lg font-bold text-white"><Gift size={18} /> {tx(safeLang, 'Son tarixçə', 'Последняя история', 'Recent history')}</div>
        <div className="space-y-3">
          {history.length === 0 ? (
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">{tx(safeLang, 'Hələ alış tarixçəsi yoxdur', 'История покупок пока пуста', 'No purchase history yet')}</div>
          ) : history.map((row: any) => (
            <div key={row.id} className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">{new Date(row.created_at).toLocaleString()}</div>
                  <div className="mt-1 text-sm text-slate-400">{(row.items || []).map((item: any) => `${item.item_name} x${item.qty}`).join(', ') || '-'}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-white">{Number(row.total || 0).toFixed(2)} ₼</div>
                  <div className="text-xs text-slate-400">{row.payment_method}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
