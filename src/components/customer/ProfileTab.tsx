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
  designMode?: 'classic' | 'retro';
};

export default function ProfileTab({
  safeLang, customer, notifications, history, chartData, primaryColor,
  setLang, markRead, isLight = false, designMode = 'classic'
}: Props) {

  const isRetro     = designMode === 'retro';
  const textPrimary  = isLight ? 'text-slate-900' : 'text-white';
  const textSecond   = isLight ? 'text-slate-500' : 'text-white/60';
  const textMuted    = isLight ? 'text-slate-400' : 'text-white/40';
  const bgCard       = isRetro ? 'retro-card' : (isLight ? 'cust-glass-light' : 'cust-glass premium-shadow');
  const innerBoxBg   = isLight ? 'bg-black/3 border-black/5 text-slate-800' : 'bg-black/25 border-white/5 text-slate-200';
  const itemBorder   = isRetro
    ? (isLight ? 'border-[2px] border-[#1C2029] bg-white' : 'border-[2px] border-[#2F2622] bg-[#1E1714]')
    : (isLight ? 'border-black/5 bg-white/70 shadow-sm' : 'border-white/8 bg-white/4');
  const unreadBg     = isLight ? 'border-[#F48C24]/25 bg-[#F48C24]/5' : 'border-[#F48C24]/25 bg-[#F48C24]/8';
  const langBarCls   = isLight ? 'border-black/8 bg-white/80 text-slate-700 shadow-sm backdrop-blur-sm' : 'border-white/10 bg-white/6 text-slate-200 backdrop-blur-md';

  const unreadCount = notifications.filter((n: any) => !n.is_read).length;

  return (
    <div className="space-y-4">
      {/* Profile Header Card */}
      <section className={`rounded-[28px] border p-5 ${bgCard}`}>
        {/* Glossy highlight */}
        {!isRetro && (
          <div className="absolute inset-x-0 top-0 h-16 pointer-events-none rounded-t-[28px]"
            style={{ background: isLight ? 'linear-gradient(180deg, rgba(255,255,255,0.4), transparent)' : 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)' }} />
        )}

        <div className="flex items-center justify-between gap-3 mb-4 relative z-10">
          {/* Avatar */}
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl flex items-center justify-center text-xl font-black text-white shimmer-btn"
              style={{
                background: isRetro ? 'linear-gradient(135deg, #D47B5E, #E9A583)' : 'linear-gradient(135deg, #F48C24, #ffb366)',
                boxShadow: isRetro ? '2px 2px 0px 0px #2B1B1A' : '0 6px 18px rgba(244,140,36,0.40)'
              }}>
              {customer.name ? customer.name.charAt(0).toUpperCase() : 'M'}
            </div>
            <div>
              <div className={`text-[15px] font-black ${textPrimary}`}>{customer.name || tx(safeLang, 'Müştəri', 'Клиент', 'Customer')}</div>
              <div className={`text-[9px] font-mono tracking-widest mt-0.5 ${textMuted}`}>{customer.card_id}</div>
            </div>
          </div>

          {/* Premium Tag for Member level */}
          <span className={`text-[9px] font-black uppercase tracking-wider ${
            isRetro
              ? 'text-[#D47B5E] bg-[#FAF8F5] dark:bg-[#1E1714] px-3 py-1.5 rounded-lg border-2 border-[#2B1B1A] dark:border-[#3D2F2A] shadow-[1.5px_1.5px_0px_0px_#2B1B1A]'
              : 'text-[#F48C24] bg-[#F48C24]/10 px-3 py-1 rounded-full border border-[#F48C24]/20'
          } flex-shrink-0`}>
            {customer.type || 'Golden Member'}
          </span>
        </div>

        {/* Profile details - Redesigned into a premium grid layout */}
        <div className="grid grid-cols-2 gap-3.5 mt-4 relative z-10">
          {[
            { label: tx(safeLang, 'Endirim faizi', 'Скидка', 'Discount'), value: `${Number(customer.discount_percent || 0).toFixed(0)}%`, highlight: true },
            { label: tx(safeLang, 'Kart növü', 'Тип карты', 'Card Tier'), value: customer.type || 'Gold' },
            { label: tx(safeLang, 'Qoşulma tarixi', 'Дата подключения', 'Joined Since'), value: customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '-' },
            { label: tx(safeLang, 'Kart ID', 'ID карты', 'Card Identifier'), value: String(customer.card_id || '').slice(-8) }
          ].map(({ label, value, highlight }, i) => (
            <div key={i} 
              className={`rounded-2xl p-3.5 border flex flex-col justify-between transition-all ${
                isRetro
                  ? isLight
                    ? 'bg-white border-[2px] border-[#2B1B1A] shadow-[2px_2px_0px_0px_#2B1B1A]'
                    : 'bg-[#1E1714] border-[2px] border-[#3D2F2A] shadow-[2px_2px_0px_0px_#3D2F2A]'
                  : isLight 
                    ? 'bg-black/3 border-black/5 hover:bg-black/5' 
                    : 'bg-[#0C0F14] border-white/5 hover:bg-white/5'
              }`}>
              <span className={`text-[9px] font-semibold uppercase tracking-wider ${textMuted}`}>{label}</span>
              <span className={`text-[13px] font-black mt-2 ${highlight ? isRetro ? 'text-[#D47B5E] text-base' : 'text-[#F48C24] text-base' : textPrimary}`}>{value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Notifications */}
      <section className={`rounded-[28px] border p-5 ${bgCard}`}>
        <div className={`mb-4 flex items-center gap-2 text-[15px] font-bold ${textPrimary}`}>
          <Bell size={16} className={unreadCount > 0 ? isRetro ? 'text-[#D47B5E] animate-bounce' : 'text-[#F48C24] animate-bounce' : textMuted} />
          {tx(safeLang, 'Bildirişlər', 'Уведомления', 'Notifications')}
          {unreadCount > 0 && (
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-black text-white ${isRetro ? 'border-2 border-[#2B1B1A] dark:border-[#3D2F2A] shadow-[1.5px_1.5px_0px_0px_#2B1B1A]' : 'animate-pulse'}`}
              style={isRetro ? { background: '#D47B5E' } : { background: 'linear-gradient(135deg, #F48C24, #ffb366)', boxShadow: '0 4px 12px rgba(244,140,36,0.35)' }}>
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
          {tx(safeLang, 'Sifariş Tarixçəsi', 'История заказов', 'Order History')}
        </div>
        
        <div className="space-y-4">
          {history.length === 0 ? (
            <div className={`rounded-2xl border p-4 text-xs text-center ${itemBorder} ${textMuted}`}>
              {tx(safeLang, 'Hələ sifariş tarixçəsi yoxdur', 'История покупок пока пуста', 'No purchase history yet')}
            </div>
          ) : history.map((row: any, idx: number) => {
            const formattedDate = new Date(row.created_at).toLocaleDateString(safeLang === 'az' ? 'az-AZ' : safeLang === 'ru' ? 'ru-RU' : 'en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });

            return (
              <div key={row.id}
                className={`rounded-[22px] border p-4 space-y-3 transition-all stagger-fade-in stagger-${Math.min(idx + 1, 5)} ${isLight ? 'bg-white/90 border-black/5 shadow-sm' : 'bg-[#0C0F14] border-white/5'}`}>
                
                {/* Meta details */}
                <div className="flex items-center justify-between border-b border-white/5 pb-2 text-[9px] font-bold text-white/40 uppercase tracking-wider">
                  <div>
                    <span className="block text-white/30">{tx(safeLang, 'SİFARİŞ VAXTI', 'ВРЕМЯ ЗАКАЗА', 'ORDER TIME')}</span>
                    <span className={`mt-0.5 block ${isLight ? 'text-slate-600' : 'text-white/60'}`}>{formattedDate}</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-white/30">{tx(safeLang, 'ÜMUMİ MƏBLƏĞ', 'ОБЩАЯ СУММА', 'TOTAL AMOUNT')}</span>
                    <span className="mt-0.5 block text-[#F48C24] font-black text-[11px]">₼ {Number(row.total || 0).toFixed(2)}</span>
                  </div>
                </div>

                {/* Items layout */}
                <div className="space-y-2">
                  {(row.items || []).map((item: any, itemIdx: number) => {
                    const itemCategory = (item.category || '').toLowerCase();
                    const iconEmoji = itemCategory.includes('cay') || itemCategory.includes('tea') ? '🍵' : itemCategory.includes('sweet') || itemCategory.includes('pastry') ? '🍰' : '☕';
                    return (
                      <div key={itemIdx} className={`flex items-center gap-3 p-2.5 rounded-xl ${isLight ? 'bg-black/3' : 'bg-white/3 border border-white/5'}`}>
                        {/* Icon/Image placeholder container */}
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#1C2029] to-[#0C0F14] flex items-center justify-center text-lg border border-white/5 flex-shrink-0">
                          {iconEmoji}
                        </div>
                        
                        {/* Title and qty */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-[11px] font-black truncate ${textPrimary}`}>{item.item_name}</p>
                          <p className={`text-[9px] font-semibold mt-0.5 ${textMuted}`}>
                            {tx(safeLang, 'Standart Seçim', 'Стандартный выбор', 'Standard Brew')}
                          </p>
                        </div>

                        {/* Price rendering */}
                        <div className="text-right flex-shrink-0">
                          <p className={`text-[11px] font-black ${textPrimary}`}>
                            <span className="text-[#F48C24]">₼</span> {Number(item.price || 0).toFixed(2)}
                          </p>
                          <p className="text-[8px] font-extrabold text-[#F48C24]/80 mt-0.5 uppercase">
                            × {item.qty}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Payment Method Badge */}
                <div className="flex items-center justify-between pt-1">
                  <span className={`text-[9px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${isLight ? 'bg-black/5 text-slate-500' : 'bg-white/5 text-white/40'}`}>
                    {row.payment_method}
                  </span>
                  <span className="text-[9px] font-black text-emerald-500 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {tx(safeLang, 'Uğurla tamamlandı', 'Успешно завершено', 'Completed')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
