import React from 'react';
import { Bell, Gift, Languages, TrendingUp } from 'lucide-react';
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

export default function ProfileTab({
  safeLang, customer, notifications, history, chartData, primaryColor,
  setLang, markRead, isLight = false
}: Props) {

  const textPrimary  = isLight ? 'text-slate-900' : 'text-white';
  const textSecond   = isLight ? 'text-slate-500' : 'text-white/60';
  const textMuted    = isLight ? 'text-slate-400' : 'text-white/40';
  const bgCard       = isLight ? 'cust-glass-light' : 'cust-glass premium-shadow';
  const innerBoxBg   = isLight ? 'bg-black/3 border-black/5 text-slate-800' : 'bg-black/25 border-white/5 text-slate-200';
  const itemBorder   = isLight ? 'border-black/5 bg-white/70 shadow-sm' : 'border-white/8 bg-white/4';
  const unreadBg     = isLight ? 'border-[#F48C24]/25 bg-[#F48C24]/5' : 'border-[#F48C24]/25 bg-[#F48C24]/8';
  const langBarCls   = isLight ? 'border-black/8 bg-white/80 text-slate-700 shadow-sm backdrop-blur-sm' : 'border-white/10 bg-white/6 text-slate-200 backdrop-blur-md';

  const unreadCount = notifications.filter((n: any) => !n.is_read).length;

  return (
    <div className="space-y-4">
      {/* Profile Header Card */}
      <section className={`rounded-[28px] border p-5 ${bgCard}`}>
        {/* Glossy highlight */}
        <div className="absolute inset-x-0 top-0 h-16 pointer-events-none rounded-t-[28px]"
          style={{ background: isLight ? 'linear-gradient(180deg, rgba(255,255,255,0.5), transparent)' : 'linear-gradient(180deg, rgba(255,255,255,0.04), transparent)' }} />

        <div className="flex items-center justify-between gap-3 mb-4 relative">
          {/* Avatar */}
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl flex items-center justify-center text-xl font-black text-white shimmer-btn"
              style={{ background: 'linear-gradient(135deg, #F48C24, #ffb366)', boxShadow: '0 6px 18px rgba(244,140,36,0.40)' }}>
              {customer.name ? customer.name.charAt(0).toUpperCase() : 'M'}
            </div>
            <div>
              <div className={`text-[15px] font-black ${textPrimary}`}>{customer.name || tx(safeLang, 'Müştəri', 'Клиент', 'Customer')}</div>
              <div className={`text-[10px] font-semibold ${textMuted}`}>{customer.card_id}</div>
            </div>
          </div>

          {/* Language switcher */}
          <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${langBarCls}`}>
            <Languages size={12} />
            {['az', 'en', 'ru'].map(lang => (
              <button key={lang} type="button"
                onClick={async () => { await Haptic.light(); setLang(lang); }}
                className={`px-1 font-bold transition-all rounded ${safeLang === lang
                  ? 'text-[#F48C24] scale-110'
                  : isLight ? 'text-slate-500 hover:text-slate-700' : 'text-white/50 hover:text-white/80'}`}>
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Profile details */}
        <div className={`space-y-2.5 rounded-[20px] border p-4 text-sm ${innerBoxBg}`}>
          {[
            { label: tx(safeLang, 'Kart ID', 'ID карты', 'Card ID'), value: customer.card_id },
            { label: tx(safeLang, 'Tip', 'Тип', 'Type'), value: customer.type || 'Member' },
            { label: tx(safeLang, 'Endirim', 'Скидка', 'Discount'), value: `${Number(customer.discount_percent || 0).toFixed(0)}%` },
            { label: tx(safeLang, 'Qoşulma tarixi', 'Дата подключения', 'Joined'), value: customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '-' },
          ].map(({ label, value }, i) => (
            <div key={i} className={`flex items-center justify-between gap-3 pb-2.5 ${i < 3 ? `border-b ${isLight ? 'border-black/5' : 'border-white/5'}` : ''}`}>
              <span className={`text-[11px] ${textMuted}`}>{label}</span>
              <span className={`text-[12px] font-bold ${textPrimary}`}>{value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Notifications */}
      <section className={`rounded-[28px] border p-5 ${bgCard}`}>
        <div className={`mb-4 flex items-center gap-2 text-[15px] font-bold ${textPrimary}`}>
          <Bell size={16} className={unreadCount > 0 ? 'text-[#F48C24] animate-bounce' : textMuted} />
          {tx(safeLang, 'Bildirişlər', 'Уведомления', 'Notifications')}
          {unreadCount > 0 && (
            <span className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-black text-white animate-pulse"
              style={{ background: 'linear-gradient(135deg, #F48C24, #ffb366)', boxShadow: '0 4px 12px rgba(244,140,36,0.35)' }}>
              {unreadCount}
            </span>
          )}
        </div>
        <div className="space-y-2.5">
          {notifications.length === 0 ? (
            <div className={`rounded-2xl border p-4 text-sm text-center ${itemBorder} ${textMuted}`}>
              {tx(safeLang, 'Yeni bildiriş yoxdur', 'Нет новых уведомлений', 'No new notifications')}
            </div>
          ) : notifications.map((row: any) => (
            <button
              key={row.id}
              type="button"
              onClick={async () => { await Haptic.light(); if (!row.is_read) void markRead(row.id); }}
              className={`w-full rounded-2xl border p-4 text-left transition-all active:scale-[0.98] ${row.is_read ? itemBorder : unreadBg}`}>
              {!row.is_read && (
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#F48C24] animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-wider text-[#F48C24]">
                    {tx(safeLang, 'Yeni', 'Новое', 'New')}
                  </span>
                </div>
              )}
              <div className={`text-sm leading-relaxed ${textPrimary}`}>{row.message}</div>
              <div className={`mt-1.5 text-xs ${textMuted}`}>{new Date(row.created_at).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Purchase Chart */}
      {chartData.length > 1 && (
        <section className={`rounded-[28px] border p-5 ${bgCard}`}>
          <div className={`mb-3 text-[15px] font-bold flex items-center gap-2 ${textPrimary}`}>
            <TrendingUp size={16} className="text-emerald-500" />
            {tx(safeLang, 'Alış dinamikası', 'Динамика покупок', 'Purchase dynamics')}
          </div>
          <div className="mt-2 pr-1">
            <SimpleAreaChart data={chartData} primaryColor={primaryColor} safeLang={safeLang} />
          </div>
        </section>
      )}

      {/* Purchase History */}
      <section className={`rounded-[28px] border p-5 ${bgCard}`}>
        <div className={`mb-4 flex items-center gap-2 text-[15px] font-bold ${textPrimary}`}>
          <Gift size={16} className="text-[#F48C24]" />
          {tx(safeLang, 'Son tarixçə', 'Последняя история', 'Recent history')}
        </div>
        <div className="space-y-2.5">
          {history.length === 0 ? (
            <div className={`rounded-2xl border p-4 text-sm text-center ${itemBorder} ${textMuted}`}>
              {tx(safeLang, 'Hələ alış tarixçəsi yoxdur', 'История покупок пока пуста', 'No purchase history yet')}
            </div>
          ) : history.map((row: any, idx: number) => (
            <div key={row.id}
              className={`rounded-2xl border p-4 transition-all stagger-fade-in stagger-${Math.min(idx + 1, 5)} ${itemBorder}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className={`font-bold text-[12px] ${textPrimary}`}>{new Date(row.created_at).toLocaleString()}</div>
                  <div className={`mt-1 text-[11px] leading-relaxed ${textSecond}`}>
                    {(row.items || []).map((item: any) => `${item.item_name} ×${item.qty}`).join(', ') || '-'}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-[16px] font-black ${textPrimary}`}>{Number(row.total || 0).toFixed(2)} ₼</div>
                  <div className={`text-[10px] mt-0.5 capitalize rounded-full px-2 py-0.5 font-semibold ${isLight ? 'bg-black/5 text-slate-500' : 'bg-white/5 text-white/50'}`}>
                    {row.payment_method}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
