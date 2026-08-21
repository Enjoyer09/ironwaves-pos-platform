// Extracted from DashboardPanel.tsx (Priority 1 — UI_COMPETITIVE_AUDIT §6.1):
// recharts lives only here so the dashboard shell chunk stays small and
// this chart code loads lazily on demand.
import React, { useMemo } from 'react';
import { Decimal } from 'decimal.js';
import { tx } from '../../i18n';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

export default function AnalyticsCenter({
  lang,
  summary,
}: {
  lang: string;
  summary: any;
}) {
  const hourlyData = useMemo(() => {
    if (!summary || !summary.hourly_trend) {
      return Array.from({ length: 24 }, (_, i) => ({
        hour: `${String(i).padStart(2, '0')}:00`,
        sales: 0,
      }));
    }
    return summary.hourly_trend;
  }, [summary]);

  const paymentData = useMemo(() => {
    if (!summary) return [];
    let items: Array<{ name: string; value: number; count?: number }> = [];
    if (summary.payment_breakdown && Array.isArray(summary.payment_breakdown) && summary.payment_breakdown.length > 0) {
      items = summary.payment_breakdown.map((it: any) => ({
        name: String(it.name || ''),
        value: Number(it.value ?? it.amount ?? 0),
        count: it.count,
      }));
    } else {
      const cashVal = Number(summary.cash_sales || 0);
      const cardVal = Number(summary.card_sales || 0);
      items = [
        { name: 'cash', value: cashVal },
        { name: 'card', value: cardVal },
      ];
    }

    const total = items.reduce((acc, it) => acc + (it.value || 0), 0);

    return items.map((item) => {
      let displayName = item.name;
      let color = '#64748b';
      if (item.name === 'cash') {
        displayName = tx(lang, 'Nağd', 'Наличные', 'Cash');
        color = '#10b981'; // emerald
      } else if (item.name === 'card') {
        displayName = tx(lang, 'Kart', 'Карта', 'Card');
        color = '#0ea5e9'; // sky
      } else if (item.name === 'split') {
        displayName = tx(lang, 'Split', 'Раздельно', 'Split');
        color = '#8b5cf6'; // violet
      } else if (item.name === 'staff') {
        displayName = tx(lang, 'Staff', 'Staff', 'Staff');
        color = '#f59e0b'; // amber
      }

      const share = total > 0 ? Math.round((item.value / total) * 100) : 0;
      return {
        ...item,
        displayName,
        color,
        share,
        formattedValue: item.value.toFixed(2),
      };
    });
  }, [summary, lang]);

  const totalPaymentSum = useMemo(() => {
    return paymentData.reduce((acc, it) => acc + (it.value || 0), 0);
  }, [paymentData]);

  const cashItem = paymentData.find((p) => p.name === 'cash');
  const cardItem = paymentData.find((p) => p.name === 'card');

  const PIE_COLORS = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#64748b'];

  const channels = summary?.channels || {
    bolt: { count: 0, revenue: '0.00', enabled: false },
    wolt: { count: 0, revenue: '0.00', enabled: false },
    dine_in: { count: 0, revenue: '0.00' },
    takeaway: { count: 0, revenue: '0.00' },
  };

  const boltRev = new Decimal(channels.bolt?.revenue || 0);
  const woltRev = new Decimal(channels.wolt?.revenue || 0);
  const dineInRev = new Decimal(channels.dine_in?.revenue || 0);
  const takeawayRev = new Decimal(channels.takeaway?.revenue || 0);
  const sumRev = boltRev.plus(woltRev).plus(dineInRev).plus(takeawayRev);

  const getShare = (val: Decimal) => {
    if (sumRev.isZero()) return 0;
    return Math.round(val.div(sumRev).times(100).toNumber());
  };

  const channelBreakdown = [
    {
      key: 'dine_in',
      name: tx(lang, 'Zalda', 'В зале', 'Dine-In'),
      count: channels.dine_in?.count || 0,
      revenue: dineInRev,
      share: getShare(dineInRev),
      color: 'bg-sky-500',
      textColor: 'text-sky-400',
    },
    {
      key: 'takeaway',
      name: tx(lang, 'Al-apar', 'На вынос', 'Takeaway'),
      count: channels.takeaway?.count || 0,
      revenue: takeawayRev,
      share: getShare(takeawayRev),
      color: 'bg-violet-500',
      textColor: 'text-violet-400',
    },
    {
      key: 'bolt',
      name: 'Bolt Food',
      count: channels.bolt?.count || 0,
      revenue: boltRev,
      share: getShare(boltRev),
      color: 'bg-emerald-500',
      textColor: 'text-emerald-400',
      enabled: channels.bolt?.enabled,
      hasWebhook: true,
    },
    {
      key: 'wolt',
      name: 'Wolt',
      count: channels.wolt?.count || 0,
      revenue: woltRev,
      share: getShare(woltRev),
      color: 'bg-blue-500',
      textColor: 'text-blue-400',
      enabled: channels.wolt?.enabled,
      hasWebhook: true,
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {/* Hourly Sales Chart */}
      <div className="rounded-[28px] border border-slate-800 bg-slate-900/60 p-5 shadow-[0_18px_55px_rgba(0,0,0,0.24)] backdrop-blur-md">
        <h3 className="text-base font-black text-white">
          {tx(lang, 'Saatlıq Satışlar', 'Почасовые продажи', 'Hourly Sales')}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {tx(lang, 'Gün ərzində satış dinamikası', 'Динамика продаж в течение дня', 'Sales dynamic during the day')}
        </p>
        <div className="mt-5 h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
              <XAxis dataKey="hour" stroke="#94a3b8" fontSize={10} tickLine={false} />
              <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px' }}
                labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                itemStyle={{ color: '#fff' }}
                formatter={(value) => [`${value} ₼`, tx(lang, 'Satış', 'Продажа', 'Sales')]}
              />
              <Area type="monotone" dataKey="sales" stroke="#fbbf24" strokeWidth={2} fillOpacity={1} fill="url(#colorSales)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Payment Methods Chart */}
      <div className="rounded-[28px] border border-slate-800 bg-slate-900/60 p-5 shadow-[0_18px_55px_rgba(0,0,0,0.24)] backdrop-blur-md flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-white">
              {tx(lang, 'Ödəniş Üsulları', 'Способы оплаты', 'Payment Methods')}
            </h3>
            <span className="text-xs font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-xl">
              {totalPaymentSum.toFixed(2)} ₼
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {tx(lang, 'Məbləğ və faiz bölgüsü', 'Распределение по суммам и процентам', 'Breakdown by monetary amounts & percent')}
          </p>

          {/* Quick Cash vs Card Amount Badges */}
          <div className="grid grid-cols-2 gap-2 mt-3.5">
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/40 p-2.5 flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  {tx(lang, 'Nağd Satış', 'Наличные', 'Cash Sales')}
                </span>
                <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded-lg">
                  {cashItem?.share || 0}%
                </span>
              </div>
              <span className="text-base font-black text-white tracking-tight mt-0.5">
                {cashItem?.formattedValue || '0.00'} ₼
              </span>
            </div>

            <div className="rounded-2xl border border-sky-500/25 bg-sky-950/40 p-2.5 flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-sky-300 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-sky-400" />
                  {tx(lang, 'Kart Satışı', 'Карта', 'Card Sales')}
                </span>
                <span className="text-[10px] font-black text-sky-400 bg-sky-500/15 px-1.5 py-0.5 rounded-lg">
                  {cardItem?.share || 0}%
                </span>
              </div>
              <span className="text-base font-black text-white tracking-tight mt-0.5">
                {cardItem?.formattedValue || '0.00'} ₼
              </span>
            </div>
          </div>
        </div>

        <div className="relative mt-2 flex h-[190px] items-center justify-center">
          {paymentData.length === 0 || totalPaymentSum === 0 ? (
            <div className="text-sm font-semibold text-slate-500">
              {tx(lang, 'Ödəniş məlumatı tapılmadı', 'Нет данных об оплате', 'No payment data found')}
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentData.filter((item: any) => item.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={68}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {paymentData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color || PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(value: any, name: any, item: any) => [
                      `${Number(value).toFixed(2)} ₼ (${item?.payload?.share || 0}%)`,
                      item?.payload?.displayName || name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Center Donut Label */}
              <div className="pointer-events-none absolute flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {tx(lang, 'Dövriyyə', 'Оборот', 'Revenue')}
                </span>
                <span className="text-sm font-black text-white">
                  {totalPaymentSum.toFixed(2)} ₼
                </span>
              </div>
            </>
          )}
        </div>

        {/* Legend with exact amounts and percentages */}
        {paymentData.length > 0 && totalPaymentSum > 0 && (
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 pt-2 border-t border-slate-800/80 text-xs">
            {paymentData.map((item: any, index: number) => {
              if (item.value === 0) return null;
              return (
                <div key={item.name} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color || PIE_COLORS[index % PIE_COLORS.length] }} />
                  <span className="font-bold text-slate-300">{item.displayName}:</span>
                  <span className="font-black text-white">{item.formattedValue} ₼</span>
                  <span className="text-[11px] font-semibold text-slate-500">({item.share}%)</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delivery Channels Widget */}
      <div className="rounded-[28px] border border-slate-800 bg-slate-900/60 p-5 shadow-[0_18px_55px_rgba(0,0,0,0.24)] backdrop-blur-md">
        <h3 className="text-base font-black text-white">
          {tx(lang, 'Çatdırılma Kanalları', 'Каналы доставки', 'Delivery Channels')}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {tx(lang, 'İnteqrasiya və POS üzrə bölgü', 'Разделение по интеграциям и POS', 'Breakdown by integrations and POS')}
        </p>
        <div className="mt-5 space-y-4">
          {channelBreakdown.map((ch) => (
            <div key={ch.key} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-black text-white`}>{ch.name}</span>
                  {ch.hasWebhook && (
                    <div className="flex items-center gap-1 rounded-full bg-slate-950 px-2 py-0.5 text-[10px]">
                      <span className={`h-1.5 w-1.5 rounded-full ${ch.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                      <span className="text-slate-400">
                        {ch.enabled
                          ? tx(lang, 'Aktiv', 'Активно', 'Active')
                          : tx(lang, 'Deaktiv', 'Отключено', 'Disabled')}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-slate-300">
                  <span className="font-black text-white">{ch.revenue.toFixed(2)} ₼</span>
                  <span className="mx-1.5 text-slate-600">·</span>
                  <span>{ch.count} {tx(lang, 'sifariş', 'зак.', 'orders')}</span>
                  <span className="mx-1.5 text-slate-600">·</span>
                  <span className={`font-black ${ch.textColor}`}>{ch.share}%</span>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-950">
                <div className={`h-full rounded-full transition-all duration-500 ${ch.color}`} style={{ width: `${ch.share}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
