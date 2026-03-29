import React, { useEffect, useMemo, useState } from 'react';
import { Decimal } from 'decimal.js';
import { ArrowRight, ChefHat, CreditCard, PackageSearch, Receipt, SignalHigh, ShoppingBag, TriangleAlert, Wallet } from 'lucide-react';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { get_sales_list, get_sales_list_live, get_sales_summary, get_sales_summary_live } from '../../api/analytics';
import { fetch_finance_balances } from '../../api/finance';
import { get_balance } from '../../api/finance';
import { get_low_stock_items } from '../../api/inventory';
import { get_kitchen_orders, get_kitchen_orders_live } from '../../api/kds';
import { get_tables, get_tables_live } from '../../api/tables';
import { getPendingOfflineSalesCount } from '../../lib/offline';
import { isBackendEnabled } from '../../api/client';

type DashboardSnapshot = {
  summary: any;
  sales: any[];
  kitchenOrders: any[];
  tables: any[];
  balances: any;
  lowStock: any[];
  pendingOffline: number;
};

type RangePreset = 'daily' | 'weekly' | 'monthly' | 'custom';

const emptyBalances = {
  cash_balance: '0',
  card_balance: '0',
  debt_balance: '0',
  investor_balance: '0',
  safe_balance: '0',
};

export default function DashboardPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [rangePreset, setRangePreset] = useState<RangePreset>('daily');
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>({
    summary: null,
    sales: [],
    kitchenOrders: [],
    tables: [],
    balances: emptyBalances,
    lowStock: [],
    pendingOffline: 0,
  });

  useEffect(() => {
    const now = new Date();
    const start = new Date(now);
    if (rangePreset === 'weekly') {
      const weekday = start.getDay();
      const diff = weekday === 0 ? 6 : weekday - 1;
      start.setDate(start.getDate() - diff);
    } else if (rangePreset === 'monthly') {
      start.setDate(1);
    }

    if (rangePreset !== 'custom') {
      setFromDate(start.toISOString().slice(0, 10));
      setToDate(now.toISOString().slice(0, 10));
    }
  }, [rangePreset]);

  const activeRange = useMemo(() => {
    const from = new Date(fromDate || new Date().toISOString().slice(0, 10));
    from.setHours(0, 0, 0, 0);
    const to = new Date(toDate || new Date().toISOString().slice(0, 10));
    to.setHours(23, 59, 59, 999);
    return {
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      label:
        rangePreset === 'daily'
          ? tx(lang, 'Bu gün', 'Сегодня', 'Today')
          : rangePreset === 'weekly'
            ? tx(lang, 'Bu həftə', 'На этой неделе', 'This week')
            : rangePreset === 'monthly'
              ? tx(lang, 'Bu ay', 'В этом месяце', 'This month')
              : `${fromDate} - ${toDate}`,
    };
  }, [fromDate, toDate, rangePreset, lang]);

  useEffect(() => {
    let mounted = true;

    const loadDashboard = async () => {
      try {
        const [
          summary,
          sales,
          kitchenOrders,
          tables,
          pendingOffline,
        ] = await Promise.all([
          getSalesSummarySafe(),
          getSalesListSafe(),
          getKitchenOrdersSafe(),
          getTablesSafe(),
          getPendingOfflineSalesCount(tenant_id),
        ]);

        const lowStock = get_low_stock_items(tenant_id, 5);
        const balances = await getBalancesSafe();

        if (!mounted) return;
        setSnapshot({
          summary,
          sales,
          kitchenOrders,
          tables,
          balances,
          lowStock,
          pendingOffline,
        });
      } catch (error: any) {
        if (!mounted) return;
        notify('error', error?.message || tx(lang, 'Dashboard yüklənmədi', 'Не удалось загрузить dashboard', 'Failed to load dashboard'));
      }
    };

    const getSalesSummarySafe = async () => {
      try {
        return await get_sales_summary_live(tenant_id, activeRange.fromIso, activeRange.toIso);
      } catch {
        return get_sales_summary(tenant_id, activeRange.fromIso, activeRange.toIso);
      }
    };

    const getSalesListSafe = async () => {
      try {
        return await get_sales_list_live(tenant_id, activeRange.fromIso, activeRange.toIso);
      } catch {
        return get_sales_list(tenant_id, activeRange.fromIso, activeRange.toIso);
      }
    };

    const getKitchenOrdersSafe = async () => {
      try {
        return await get_kitchen_orders_live(tenant_id);
      } catch {
        return get_kitchen_orders(tenant_id);
      }
    };

    const getTablesSafe = async () => {
      try {
        return await get_tables_live(tenant_id);
      } catch {
        return get_tables(tenant_id);
      }
    };

    const getBalancesSafe = async () => {
      try {
        return await fetch_finance_balances(tenant_id);
      } catch {
        return get_balance(tenant_id, 'all', false) as any;
      }
    };

    void loadDashboard();
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 20000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [tenant_id, activeRange.fromIso, activeRange.toIso, lang, notify]);

  const openTables = snapshot.tables.filter((table: any) => table.is_occupied).length;
  const readyOrders = snapshot.kitchenOrders.filter((order: any) => String(order.status || '').toUpperCase() === 'READY').length;
  const preparingOrders = snapshot.kitchenOrders.filter((order: any) => String(order.status || '').toUpperCase() === 'PREPARING').length;

  const topProducts = useMemo(() => {
    const counts = new Map<string, number>();
    snapshot.sales.forEach((sale: any) => {
      const items = Array.isArray(sale.items) ? sale.items : [];
      items.forEach((item: any) => {
        const key = String(item.item_name || '-');
        counts.set(key, (counts.get(key) || 0) + Number(item.qty || 0));
      });
    });
    return Array.from(counts.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [snapshot.sales]);

  const cashierPerformance = useMemo(() => {
    const staffMap = new Map<string, { sales: number; revenue: Decimal }>();
    snapshot.sales.forEach((sale: any) => {
      const key = String(sale.cashier || '-');
      const current = staffMap.get(key) || { sales: 0, revenue: new Decimal(0) };
      current.sales += 1;
      current.revenue = current.revenue.plus(new Decimal(sale.total || 0));
      staffMap.set(key, current);
    });
    return Array.from(staffMap.entries())
      .map(([cashier, stats]) => ({
        cashier,
        sales: stats.sales,
        revenue: stats.revenue,
        avgCheck: stats.sales > 0 ? stats.revenue.div(stats.sales) : new Decimal(0),
      }))
      .sort((a, b) => b.revenue.minus(a.revenue).toNumber())
      .slice(0, 4);
  }, [snapshot.sales]);

  const averageCheck = useMemo(() => {
    if (!snapshot.sales.length) return new Decimal(0);
    const total = snapshot.sales.reduce((sum: Decimal, sale: any) => sum.plus(new Decimal(sale.total || 0)), new Decimal(0));
    return total.div(snapshot.sales.length);
  }, [snapshot.sales]);

  const hourlyTrend = useMemo(() => {
    const buckets = Array.from({ length: 6 }).map((_, idx) => {
      const hour = Math.max(0, new Date().getHours() - (5 - idx));
      return { label: `${String(hour).padStart(2, '0')}:00`, total: new Decimal(0) };
    });
    snapshot.sales.forEach((sale: any) => {
      const saleDate = new Date(sale.created_at);
      const bucket = buckets.find((row) => row.label === `${String(saleDate.getHours()).padStart(2, '0')}:00`);
      if (bucket) bucket.total = bucket.total.plus(new Decimal(sale.total || 0));
    });
    const max = buckets.reduce((peak, row) => Decimal.max(peak, row.total), new Decimal(1));
    return buckets.map((row) => ({
      ...row,
      height: Number(row.total.div(max).times(100).toFixed(0)),
    }));
  }, [snapshot.sales]);

  return (
    <div className="space-y-5 text-slate-100">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr]">
        <aside className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(245,247,250,0.82))] p-4 text-slate-900 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur">
          <div className="rounded-2xl bg-white/70 p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {tx(lang, 'Bu Gün', 'Сегодня', 'Today')}
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900">
              {new Date().toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ', {
                day: '2-digit',
                month: 'short',
              })}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {activeRange.label}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <NavInsight icon={<Receipt size={18} />} label={tx(lang, 'Bu gün satış', 'Продажи сегодня', 'Today sales')} value={String(snapshot.sales.length)} />
            <NavInsight icon={<ChefHat size={18} />} label={tx(lang, 'Mətbəx növbəsi', 'Очередь кухни', 'Kitchen queue')} value={String(snapshot.kitchenOrders.length)} />
            <NavInsight icon={<PackageSearch size={18} />} label={tx(lang, 'Kritik stok', 'Критический остаток', 'Critical stock')} value={String(snapshot.lowStock.length)} />
            <NavInsight icon={<SignalHigh size={18} />} label={tx(lang, 'Offline sync', 'Оффлайн sync', 'Offline sync')} value={String(snapshot.pendingOffline)} accent="amber" />
          </div>
        </aside>

        <div className="space-y-4">
          <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-4 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h3 className="text-lg font-bold">{tx(lang, 'Dashboard Aralığı', 'Период dashboard', 'Dashboard Range')}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {tx(lang, 'Default olaraq bu gün açılır, amma daha geniş analiz üçün aralığı dəyişə bilərsiniz.', 'По умолчанию открыт сегодняшний день, но диапазон можно расширить для анализа.', 'It opens on today by default, but you can expand the range for analysis.')}
                </p>
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex flex-wrap gap-2">
                  {([
                    ['daily', tx(lang, 'Günlük', 'День', 'Daily')],
                    ['weekly', tx(lang, 'Həftəlik', 'Неделя', 'Weekly')],
                    ['monthly', tx(lang, 'Aylıq', 'Месяц', 'Monthly')],
                    ['custom', tx(lang, 'Tarix Aralığı', 'Диапазон дат', 'Date Range')],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setRangePreset(key)}
                      className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
                        rangePreset === key
                          ? 'bg-slate-900 text-white'
                          : 'border border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => {
                      setRangePreset('custom');
                      setFromDate(e.target.value);
                    }}
                    className="neon-input min-h-12 bg-white"
                  />
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => {
                      setRangePreset('custom');
                      setToDate(e.target.value);
                    }}
                    className="neon-input min-h-12 bg-white"
                  />
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <DashboardStatCard
              title={tx(lang, 'Gəlir', 'Выручка', 'Revenue')}
              value={`${new Decimal(snapshot.summary?.total_revenue || 0).toFixed(2)} ₼`}
              helper={`${tx(lang, 'Satış sayı', 'Продажи', 'Sales')}: ${snapshot.sales.length}`}
              tone="emerald"
            />
            <DashboardStatCard
              title={tx(lang, 'Açıq Masalar', 'Открытые столы', 'Open Tables')}
              value={String(openTables)}
              helper={`${tx(lang, 'Hazır sifariş', 'Готовые заказы', 'Ready orders')}: ${readyOrders}`}
              tone="sky"
            />
            <DashboardStatCard
              title={tx(lang, 'Kassa + Kart', 'Касса + карта', 'Cash + Card')}
              value={`${new Decimal(snapshot.balances.cash_balance || 0).plus(new Decimal(snapshot.balances.card_balance || 0)).toFixed(2)} ₼`}
              helper={`${tx(lang, 'Seyf', 'Сейф', 'Safe')}: ${new Decimal(snapshot.balances.safe_balance || 0).toFixed(2)} ₼`}
              tone="violet"
            />
            <DashboardStatCard
              title={tx(lang, 'Investor Borcu', 'Долг инвестору', 'Investor Debt')}
              value={`${new Decimal(snapshot.balances.investor_balance || 0).toFixed(2)} ₼`}
              helper={`${tx(lang, 'Nisyə borc', 'Долговой баланс', 'Debt balance')}: ${new Decimal(snapshot.balances.debt_balance || 0).toFixed(2)} ₼`}
              tone="rose"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SoftTile
              title={tx(lang, 'Orta Çek', 'Средний чек', 'Average Check')}
              value={`${averageCheck.toFixed(2)} ₼`}
              helper={activeRange.label}
              icon={<Receipt size={18} />}
            />
            <SoftTile
              title={tx(lang, 'Ən güclü kassir', 'Лучший кассир', 'Top Cashier')}
              value={cashierPerformance[0]?.cashier || '-'}
              helper={cashierPerformance[0] ? `${cashierPerformance[0].revenue.toFixed(2)} ₼ / ${cashierPerformance[0].sales} ${tx(lang, 'satış', 'продаж', 'sales')}` : tx(lang, 'Hələ məlumat yoxdur', 'Пока нет данных', 'No data yet')}
              icon={<ShoppingBag size={18} />}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-5 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{tx(lang, 'Günlük Əsas Metriklər', 'Ключевые показатели дня', 'Today Overview')}</h3>
                  <p className="mt-1 text-sm text-slate-500">{tx(lang, 'Ən vacib operativ göstəricilər', 'Самые важные оперативные показатели', 'The most important operational signals')}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SoftTile
                  title={tx(lang, 'Mətbəxdə hazırlananlar', 'Готовятся на кухне', 'Preparing in kitchen')}
                  value={String(preparingOrders)}
                  helper={tx(lang, 'Canlı növbə', 'Живая очередь', 'Live queue')}
                  icon={<ChefHat size={18} />}
                />
                <SoftTile
                  title={tx(lang, 'Pending Offline Sync', 'Ожидает офлайн sync', 'Pending Offline Sync')}
                  value={String(snapshot.pendingOffline)}
                  helper={snapshot.pendingOffline > 0 ? tx(lang, 'İnternet gələndə göndəriləcək', 'Будет отправлено при подключении', 'Will sync when online') : tx(lang, 'Hər şey sinxdədir', 'Все синхронизировано', 'Everything is synced')}
                  icon={<SignalHigh size={18} />}
                />
                <SoftTile
                  title={tx(lang, 'Cash Sales', 'Наличные продажи', 'Cash Sales')}
                  value={`${new Decimal(snapshot.summary?.cash_sales || 0).toFixed(2)} ₼`}
                  helper={tx(lang, 'Bu gün', 'Сегодня', 'Today')}
                  icon={<Wallet size={18} />}
                />
                <SoftTile
                  title={tx(lang, 'Card Sales', 'Продажи по карте', 'Card Sales')}
                  value={`${new Decimal(snapshot.summary?.card_sales || 0).toFixed(2)} ₼`}
                  helper={tx(lang, 'Bu gün', 'Сегодня', 'Today')}
                  icon={<CreditCard size={18} />}
                />
              </div>
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-5 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{tx(lang, 'Satış Trend', 'Тренд продаж', 'Sales Trend')}</h3>
                  <p className="mt-1 text-sm text-slate-500">{tx(lang, 'Son saatlar üzrə', 'По последним часам', 'Last hours')}</p>
                </div>
              </div>
              <div className="flex h-52 items-end gap-3 rounded-2xl bg-slate-100/80 p-4">
                {hourlyTrend.map((point) => (
                  <div key={point.label} className="flex flex-1 flex-col items-center justify-end gap-2">
                    <div className="flex w-full items-end justify-center rounded-t-2xl bg-gradient-to-t from-sky-500 to-cyan-300" style={{ height: `${Math.max(8, point.height)}%` }} />
                    <div className="text-[11px] font-semibold text-slate-500">{point.label}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-5 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{tx(lang, 'Top Məhsullar', 'Топ продукты', 'Top Products')}</h3>
                  <p className="mt-1 text-sm text-slate-500">{tx(lang, 'Seçilmiş aralıqda ən çox satılanlar', 'Самые продаваемые за выбранный период', 'Best sellers in selected range')}</p>
                </div>
                <ArrowRight size={18} className="text-slate-400" />
              </div>
              <div className="space-y-3">
                {topProducts.map((product, index) => (
                  <div key={product.name} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 font-bold text-slate-700">{index + 1}</div>
                      <div>
                        <div className="font-semibold text-slate-900">{product.name}</div>
                        <div className="text-xs text-slate-500">{tx(lang, 'Satılan ədəd', 'Продано шт.', 'Qty sold')}</div>
                      </div>
                    </div>
                    <div className="text-lg font-bold text-slate-900">{product.qty}</div>
                  </div>
                ))}
                {topProducts.length === 0 && (
                  <EmptyDash text={tx(lang, 'Bu gün hələ satış yoxdur', 'Сегодня еще нет продаж', 'No sales yet today')} />
                )}
              </div>
            </section>

            <section className="space-y-4">
              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-5 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
                <h3 className="text-lg font-bold">{tx(lang, 'Kassir Performansı', 'Эффективность кассиров', 'Cashier Performance')}</h3>
                <div className="mt-4 space-y-3">
                  {cashierPerformance.map((row) => (
                    <div key={row.cashier} className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{row.cashier}</div>
                          <div className="text-xs text-slate-500">{row.sales} {tx(lang, 'satış', 'продаж', 'sales')} / {tx(lang, 'orta çek', 'средний чек', 'avg check')} {row.avgCheck.toFixed(2)} ₼</div>
                        </div>
                        <div className="text-lg font-black text-slate-900">{row.revenue.toFixed(2)} ₼</div>
                      </div>
                    </div>
                  ))}
                  {cashierPerformance.length === 0 && (
                    <EmptyDash text={tx(lang, 'Bu aralıqda kassir məlumatı yoxdur', 'За этот период нет данных по кассирам', 'No cashier data in this range')} />
                  )}
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-5 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
                <h3 className="text-lg font-bold">{tx(lang, 'Kritik Siqnallar', 'Критические сигналы', 'Critical Signals')}</h3>
                <div className="mt-4 space-y-3">
                  <AlertRow
                    icon={<TriangleAlert size={18} />}
                    tone="rose"
                    title={tx(lang, 'Kritik stok', 'Критический остаток', 'Critical stock')}
                    value={String(snapshot.lowStock.length)}
                    helper={snapshot.lowStock[0]?.name || tx(lang, 'Hazırda kritik məhsul yoxdur', 'Пока нет критических позиций', 'No critical item right now')}
                  />
                  <AlertRow
                    icon={<ShoppingBag size={18} />}
                    tone="sky"
                    title={tx(lang, 'Açıq masalar', 'Открытые столы', 'Open tables')}
                    value={String(openTables)}
                    helper={tx(lang, 'Ödəniş gözləyən masalar', 'Столы в ожидании оплаты', 'Tables waiting for payment')}
                  />
                  <AlertRow
                    icon={<ChefHat size={18} />}
                    tone="amber"
                    title={tx(lang, 'Hazır sifarişlər', 'Готовые заказы', 'Ready orders')}
                    value={String(readyOrders)}
                    helper={tx(lang, 'Servisə çağırılmalıdır', 'Нужно выдать в зал', 'Needs front-of-house action')}
                  />
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-5 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
                <h3 className="text-lg font-bold">{tx(lang, 'Son Satışlar', 'Последние продажи', 'Recent Sales')}</h3>
                <div className="mt-4 space-y-3">
                  {snapshot.sales.slice(0, 4).map((sale: any) => (
                    <div key={sale.id} className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{sale.cashier || '-'}</div>
                          <div className="text-xs text-slate-500">{new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-slate-900">{new Decimal(sale.total || 0).toFixed(2)} ₼</div>
                          <div className="text-xs text-slate-500">{sale.payment_method || '-'}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {snapshot.sales.length === 0 && (
                    <EmptyDash text={tx(lang, 'Hələ satış qeydi yoxdur', 'Пока нет продаж', 'No sales recorded yet')} />
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardStatCard({
  title,
  value,
  helper,
  tone,
}: {
  title: string;
  value: string;
  helper: string;
  tone: 'emerald' | 'sky' | 'violet' | 'rose';
}) {
  const toneMap = {
    emerald: 'from-emerald-400/12 to-transparent',
    sky: 'from-sky-400/12 to-transparent',
    violet: 'from-violet-400/12 to-transparent',
    rose: 'from-rose-400/12 to-transparent',
  } as const;

  return (
    <div className={`rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,248,252,0.88)),radial-gradient(circle_at_top_left,var(--tw-gradient-from),var(--tw-gradient-to))] ${toneMap[tone]} p-5 text-slate-900 shadow-[0_16px_40px_rgba(0,0,0,0.2)]`}>
      <div className="text-sm font-medium text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
      <div className="mt-2 text-xs text-slate-500">{helper}</div>
    </div>
  );
}

function SoftTile({ title, value, helper, icon }: { title: string; value: string; helper: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white/80 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">{title}</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{helper}</div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
      </div>
    </div>
  );
}

function NavInsight({ icon, label, value, accent = 'slate' }: { icon: React.ReactNode; label: string; value: string; accent?: 'slate' | 'amber' }) {
  const accentClass = accent === 'amber' ? 'border-amber-200/60 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white/70 text-slate-900';
  return (
    <div className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${accentClass}`}>
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-white/70 p-2">{icon}</div>
        <div className="text-sm font-medium">{label}</div>
      </div>
      <div className="text-lg font-black">{value}</div>
    </div>
  );
}

function AlertRow({
  icon,
  title,
  value,
  helper,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  helper: string;
  tone: 'rose' | 'sky' | 'amber';
}) {
  const toneMap = {
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    sky: 'border-sky-200 bg-sky-50 text-sky-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  } as const;
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneMap[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-white/70 p-2">{icon}</div>
          <div>
            <div className="font-semibold">{title}</div>
            <div className="mt-1 text-xs opacity-75">{helper}</div>
          </div>
        </div>
        <div className="text-xl font-black">{value}</div>
      </div>
    </div>
  );
}

function EmptyDash({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}
