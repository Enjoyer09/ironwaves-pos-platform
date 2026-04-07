import React, { useEffect, useMemo, useState } from 'react';
import { Decimal } from 'decimal.js';
import { ArrowRight, ChefHat, CreditCard, PackageSearch, Receipt, SignalHigh, ShoppingBag, TriangleAlert, Wallet } from 'lucide-react';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { get_sales_list, get_sales_list_live, get_sales_summary, get_sales_summary_live } from '../../api/analytics';
import { fetch_finance_anomalies, fetch_finance_balances, fetch_finance_entries, get_balance, type FinanceAnomalies } from '../../api/finance';
import { get_low_stock_items } from '../../api/inventory';
import { get_kitchen_orders, get_kitchen_orders_live } from '../../api/kds';
import { get_tables, get_tables_live } from '../../api/tables';
import { getPendingOfflineSalesCount } from '../../lib/offline';
import { get_business_profile } from '../../api/settings';
import { generate_finance_insight, generate_shift_summary, generate_stock_forecast, type AiInsightResult } from '../../api/ai_manager';
import { hostScopedKey } from '../../lib/storage_keys';
import { get_logs_live } from '../../api/logs';
import { formatServerUtcTime, localDateInputValue, parseServerUtcTimestamp } from '../../lib/time';

type DashboardSnapshot = {
  summary: any;
  sales: any[];
  kitchenOrders: any[];
  tables: any[];
  balances: any;
  financeEntries: any[];
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
  deposit_balance: '0',
};

export default function DashboardPanel({ onOpenTab }: { onOpenTab: (tab: 'inventory' | 'finance' | 'analytics' | 'tables' | 'crm' | 'ai') => void }) {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [rangePreset, setRangePreset] = useState<RangePreset>('daily');
  const [fromDate, setFromDate] = useState(() => localDateInputValue());
  const [toDate, setToDate] = useState(() => localDateInputValue());
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [hoveredTrend, setHoveredTrend] = useState<{ label: string; value: string } | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>({
    summary: null,
    sales: [],
    kitchenOrders: [],
    tables: [],
    balances: emptyBalances,
    financeEntries: [],
    lowStock: [],
    pendingOffline: 0,
  });
  const [financeAnomalies, setFinanceAnomalies] = useState<FinanceAnomalies | null>(null);
  const [recentFinanceAuditLogs, setRecentFinanceAuditLogs] = useState<any[]>([]);
  const [aiInsights, setAiInsights] = useState<{
    shift: AiInsightResult | null;
    finance: AiInsightResult | null;
    stock: AiInsightResult | null;
  }>({ shift: null, finance: null, stock: null });
  const [stockReminderDismissed, setStockReminderDismissed] = useState(false);
  const branding = useMemo(() => get_business_profile(tenant_id), [tenant_id]);

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
      setFromDate(localDateInputValue(start));
      setToDate(localDateInputValue(now));
    }
  }, [rangePreset]);

  const activeRange = useMemo(() => {
    const from = new Date(fromDate || localDateInputValue());
    from.setHours(0, 0, 0, 0);
    const to = new Date(toDate || localDateInputValue());
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
          financeEntries,
          pendingOffline,
          logs,
        ] = await Promise.all([
          getSalesSummarySafe(),
          getSalesListSafe(),
          getKitchenOrdersSafe(),
          getTablesSafe(),
          getFinanceEntriesSafe(),
          getPendingOfflineSalesCount(tenant_id),
          get_logs_live(tenant_id, 50).catch(() => []),
        ]);

        const lowStock = get_low_stock_items(tenant_id, 5);
        const [balances, anomalies] = await Promise.all([
          getBalancesSafe(),
          fetch_finance_anomalies(tenant_id).catch(() => null),
        ]);

        if (!mounted) return;
        setSnapshot({
          summary,
          sales,
          kitchenOrders,
          tables,
          balances,
          financeEntries,
          lowStock,
          pendingOffline,
        });
        setFinanceAnomalies(anomalies);
        setRecentFinanceAuditLogs(
          (logs || []).filter((row: any) => String(row.action || '').toUpperCase() === 'FINANCE_ANOMALY_SNAPSHOT').slice(0, 3),
        );
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

    const getFinanceEntriesSafe = async () => {
      try {
        return await fetch_finance_entries(tenant_id);
      } catch {
        return [];
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

  useEffect(() => {
    let mounted = true;
    const loadAi = async () => {
      try {
        const [shift, finance, stock] = await Promise.all([
          generate_shift_summary({ tenant_id, date_from: activeRange.fromIso, date_to: activeRange.toIso }),
          generate_finance_insight({ tenant_id, date_from: activeRange.fromIso, date_to: activeRange.toIso }),
          generate_stock_forecast({ tenant_id, date_from: activeRange.fromIso, date_to: activeRange.toIso }),
        ]);
        if (!mounted) return;
        setAiInsights({ shift, finance, stock });
      } catch {
        if (!mounted) return;
        setAiInsights({ shift: null, finance: null, stock: null });
      }
    };
    void loadAi();
    return () => {
      mounted = false;
    };
  }, [tenant_id, activeRange.fromIso, activeRange.toIso]);

  useEffect(() => {
    const dayKey = localDateInputValue();
    const dismissedKey = hostScopedKey(`ai_stock_banner_dismissed_${tenant_id}_${dayKey}`);
    try {
      setStockReminderDismissed(localStorage.getItem(dismissedKey) === '1');
    } catch {
      setStockReminderDismissed(false);
    }
  }, [tenant_id]);

  const dismissStockReminder = () => {
    const dayKey = localDateInputValue();
    const dismissedKey = hostScopedKey(`ai_stock_banner_dismissed_${tenant_id}_${dayKey}`);
    try {
      localStorage.setItem(dismissedKey, '1');
    } catch {
      // ignore
    }
    setStockReminderDismissed(true);
  };

  useEffect(() => {
    const handleFinanceUpdated = async (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      if (!detail?.tenant_id || detail.tenant_id === tenant_id) {
        try {
          const [balances, financeEntries, anomalies, logs] = await Promise.all([
            fetch_finance_balances(tenant_id).catch(() => get_balance(tenant_id, 'all', false) as any),
            fetch_finance_entries(tenant_id).catch(() => []),
            fetch_finance_anomalies(tenant_id).catch(() => null),
            get_logs_live(tenant_id, 50).catch(() => []),
          ]);
          setSnapshot((prev) => ({ ...prev, balances, financeEntries }));
          setFinanceAnomalies(anomalies);
          setRecentFinanceAuditLogs(
            (logs || []).filter((row: any) => String(row.action || '').toUpperCase() === 'FINANCE_ANOMALY_SNAPSHOT').slice(0, 3),
          );
        } catch {
          // Finance ping should never break dashboard rendering.
        }
      }
    };
    window.addEventListener('finance-updated', handleFinanceUpdated as EventListener);
    return () => {
      window.removeEventListener('finance-updated', handleFinanceUpdated as EventListener);
    };
  }, [tenant_id]);

  const openTables = snapshot.tables.filter((table: any) => table.is_occupied).length;
  const readyOrders = snapshot.kitchenOrders.filter((order: any) => String(order.status || '').toUpperCase() === 'READY').length;
  const preparingOrders = snapshot.kitchenOrders.filter((order: any) => String(order.status || '').toUpperCase() === 'PREPARING').length;
  const [lastReadyOrders, setLastReadyOrders] = useState(0);

  useEffect(() => {
    if (!audioEnabled) {
      setLastReadyOrders(readyOrders);
      return;
    }
    if (readyOrders > lastReadyOrders) {
      try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = 880;
          gain.gain.value = 0.035;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.18);
        }
      } catch {
        // Audio alert should never break dashboard.
      }
    }
    setLastReadyOrders(readyOrders);
  }, [readyOrders, lastReadyOrders, audioEnabled]);

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

  const depositsCollected = useMemo(() => {
    return snapshot.financeEntries.reduce((sum: Decimal, entry: any) => {
      const category = String(entry?.category || '').toLowerCase();
      const description = String(entry?.description || '').toLowerCase();
      const isDeposit = category.includes('depozit') || description.includes('depozit') || description.includes('deposit');
      if (entry?.type === 'in' && isDeposit) {
        return sum.plus(new Decimal(entry.amount || 0));
      }
      return sum;
    }, new Decimal(0));
  }, [snapshot.financeEntries]);

  const reconciliationGap = useMemo(
    () => new Decimal(snapshot.summary?.reconciliation_gap || 0),
    [snapshot.summary?.reconciliation_gap],
  );
  const hasReconciliationIssue = Boolean(snapshot.summary?.has_reconciliation_issue) || reconciliationGap.abs().greaterThan(new Decimal(0.01));
  const dashboardExceptions = useMemo(() => {
    const items: Array<{ title: string; body: string; tone: 'rose' | 'amber' | 'sky' }> = [];
    const depositLiability = new Decimal(financeAnomalies?.deposit_balance || snapshot.balances.deposit_balance || 0);
    const cashBalance = new Decimal(snapshot.balances.cash_balance || 0);
    const investorBalance = new Decimal(financeAnomalies?.investor_ledger_balance || snapshot.balances.investor_balance || 0);

    if (Boolean(financeAnomalies?.has_reconciliation_issue) || hasReconciliationIssue) {
      items.push({
        title: tx(lang, 'Satış və ledger fərqi', 'Расхождение продаж и ledger', 'Sales vs ledger gap'),
        body: tx(
          lang,
          `Satış gəliri ilə ledger satış daxilolması arasında ${new Decimal(financeAnomalies?.reconciliation_gap || reconciliationGap).toFixed(2)} ₼ fərq var.`,
          `Между выручкой и поступлением по ledger есть расхождение ${new Decimal(financeAnomalies?.reconciliation_gap || reconciliationGap).toFixed(2)} ₼.`,
          `There is a ${new Decimal(financeAnomalies?.reconciliation_gap || reconciliationGap).toFixed(2)} ₼ gap between revenue and ledger sales inflow.`,
        ),
        tone: 'rose',
      });
    }
    if (depositLiability.greaterThan(cashBalance)) {
      items.push({
        title: tx(lang, 'Depozit öhdəliyi yüksəkdir', 'Высокое обязательство по депозитам', 'Deposit liability is high'),
        body: tx(
          lang,
          `Aktiv depozit öhdəliyi kassadakı nağddan ${depositLiability.minus(cashBalance).toFixed(2)} ₼ çoxdur.`,
          `Активное обязательство по депозитам на ${depositLiability.minus(cashBalance).toFixed(2)} ₼ выше наличности в кассе.`,
          `Active deposit liability exceeds cash drawer by ${depositLiability.minus(cashBalance).toFixed(2)} ₼.`,
        ),
        tone: 'amber',
      });
    }
    if (investorBalance.greaterThan(0)) {
      items.push({
        title: tx(lang, 'İnvestor borcu açıqdır', 'Открыт долг инвестору', 'Investor debt is open'),
        body: tx(
          lang,
          `Cari investor öhdəliyi ${investorBalance.toFixed(2)} ₼-dir.`,
          `Текущее обязательство перед инвестором составляет ${investorBalance.toFixed(2)} ₼.`,
          `Current investor liability is ${investorBalance.toFixed(2)} ₼.`,
        ),
        tone: 'sky',
      });
    }
    return items;
    if (financeAnomalies?.has_shift_cash_mismatch) {
      items.push({
        title: tx(lang, 'Shift kassa uyğunsuzluğu', 'Несовпадение кассы смены', 'Shift cash mismatch'),
        body: tx(
          lang,
          `Backend audit aktiv növbə üçün ${new Decimal(financeAnomalies.shift_cash_gap || 0).toFixed(2)} ₼ kassa fərqi göstərir.`,
          `Backend audit показывает расхождение кассы смены ${new Decimal(financeAnomalies.shift_cash_gap || 0).toFixed(2)} ₼.`,
          `Backend audit shows a ${new Decimal(financeAnomalies.shift_cash_gap || 0).toFixed(2)} ₼ shift cash gap.`,
        ),
        tone: 'rose',
      });
    }
    if (financeAnomalies?.has_closed_shift_open_deposit) {
      items.push({
        title: tx(lang, 'Bağlı növbədə açıq depozit var', 'При закрытой смене есть активный депозит', 'Closed shift has active deposits'),
        body: tx(
          lang,
          `Backend audit bağlı növbədə ${new Decimal(financeAnomalies.deposit_balance || 0).toFixed(2)} ₼ aktiv depozit öhdəliyi göstərir.`,
          `Backend audit показывает ${new Decimal(financeAnomalies.deposit_balance || 0).toFixed(2)} ₼ активного депозитного обязательства при закрытой смене.`,
          `Backend audit shows ${new Decimal(financeAnomalies.deposit_balance || 0).toFixed(2)} ₼ of active deposit liability while shift is closed.`,
        ),
        tone: 'amber',
      });
    }
    return items;
  }, [financeAnomalies, hasReconciliationIssue, lang, reconciliationGap, snapshot.balances.cash_balance, snapshot.balances.deposit_balance, snapshot.balances.investor_balance]);

  const recentFinanceAlerts = useMemo(() => {
    return recentFinanceAuditLogs.map((log: any) => {
      let parsed: any = {};
      try {
        parsed = typeof log.details === 'string' ? JSON.parse(log.details) : (log.details || {});
      } catch {
        parsed = {};
      }
      const flags: string[] = [];
      if (parsed.has_reconciliation_issue) flags.push(tx(lang, 'sales vs ledger', 'sales vs ledger', 'sales vs ledger'));
      if (parsed.has_investor_mismatch) flags.push(tx(lang, 'investor', 'investor', 'investor'));
      if (parsed.has_shift_cash_mismatch) flags.push(tx(lang, 'shift cash', 'shift cash', 'shift cash'));
      if (parsed.has_deposit_risk) flags.push(tx(lang, 'deposit', 'deposit', 'deposit'));
      if (parsed.has_closed_shift_open_deposit) flags.push(tx(lang, 'closed shift deposit', 'closed shift deposit', 'closed shift deposit'));
      return {
        id: log.id,
        created_at: log.created_at,
        flags: flags.length > 0 ? flags.join(' • ') : tx(lang, 'warning yoxdur', 'нет warning', 'no warning'),
      };
    });
  }, [lang, recentFinanceAuditLogs]);

  const financeTrend = useMemo(() => {
    const start = new Date(activeRange.fromIso);
    const end = new Date(activeRange.toIso);
    const days: Array<{ label: string; net: Decimal }> = [];
    const cursor = new Date(start);
    while (cursor <= end && days.length < 8) {
      days.push({
        label: `${String(cursor.getDate()).padStart(2, '0')}/${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        net: new Decimal(0),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    if (!days.length) {
      days.push({ label: tx(lang, 'Bu gün', 'Сегодня', 'Today'), net: new Decimal(0) });
    }
    snapshot.financeEntries.forEach((entry: any) => {
      const date = new Date(entry.created_at);
      const label = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
      const bucket = days.find((row) => row.label === label);
      if (!bucket) return;
      const amount = new Decimal(entry.amount || 0);
      bucket.net = bucket.net.plus(entry.type === 'in' ? amount : amount.negated());
    });
    return days;
  }, [snapshot.financeEntries, activeRange.fromIso, activeRange.toIso, lang]);

  const financeSparkline = useMemo(() => {
    const points = financeTrend.map((row) => row.net);
    const max = points.reduce((peak, value) => Decimal.max(peak, value.abs()), new Decimal(1));
    return financeTrend.map((row, index) => ({
      label: row.label,
      value: row.net,
      x: financeTrend.length === 1 ? 0 : (index / (financeTrend.length - 1)) * 100,
      y: 50 - row.net.div(max).times(38).toNumber(),
    }));
  }, [financeTrend]);

  const trendPath = useMemo(() => {
    if (!financeSparkline.length) return '';
    return financeSparkline.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  }, [financeSparkline]);

  const hourlyTrend = useMemo(() => {
    const buckets = Array.from({ length: 6 }).map((_, idx) => {
      const hour = Math.max(0, new Date().getHours() - (5 - idx));
      return { label: `${String(hour).padStart(2, '0')}:00`, total: new Decimal(0) };
    });
    snapshot.sales.forEach((sale: any) => {
      const saleDate = parseServerUtcTimestamp(sale.created_at) || new Date(sale.created_at);
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
    <div className="compact-dashboard space-y-5 text-slate-100">
      <div className="dashboard-grid-gap grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr]">
        <aside className="dashboard-card rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(245,247,250,0.82))] p-4 text-slate-900 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur">
          <div className="dashboard-card-soft rounded-2xl bg-white/70 p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              {branding?.logo_url ? (
                <img src={branding.logo_url} alt="brand logo" className="h-12 w-12 rounded-2xl object-cover shadow-sm" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-black text-white">
                  {(branding?.company_name || 'I').trim().slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <div className="text-sm font-bold text-slate-900">{branding?.company_name || 'iRonWaves POS'}</div>
                <div className="text-xs text-slate-500">{branding?.website || (typeof window !== 'undefined' ? window.location.host : '')}</div>
              </div>
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              {tx(lang, 'Bu Gün', 'Сегодня', 'Today')}
            </div>
            <div className="dashboard-title-xl mt-2 text-2xl font-black text-slate-900">
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
          <section className="dashboard-card rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-4 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h3 className="dashboard-title-lg text-lg font-bold">{tx(lang, 'Dashboard Aralığı', 'Период dashboard', 'Dashboard Range')}</h3>
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
                <button
                  onClick={() => setAudioEnabled((prev) => !prev)}
                  className={`rounded-2xl px-4 py-3 text-sm font-semibold ${audioEnabled ? 'bg-amber-400 text-slate-900' : 'border border-slate-200 bg-white text-slate-700'}`}
                >
                  {audioEnabled
                    ? tx(lang, 'Kitchen səsi aktiv', 'Звук кухни активен', 'Kitchen sound on')
                    : tx(lang, 'Kitchen səsi passiv', 'Звук кухни выкл', 'Kitchen sound off')}
                </button>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <DashboardStatCard
              title={tx(lang, 'Gəlir', 'Выручка', 'Revenue')}
              value={`${new Decimal(snapshot.summary?.total_revenue || 0).toFixed(2)} ₼`}
              helper={`${tx(lang, 'Satış sayı', 'Продажи', 'Sales')}: ${snapshot.sales.length}`}
              tone="emerald"
              onClick={() => onOpenTab('analytics')}
            />
            <DashboardStatCard
              title={tx(lang, 'Açıq Masalar', 'Открытые столы', 'Open Tables')}
              value={String(openTables)}
              helper={`${tx(lang, 'Hazır sifariş', 'Готовые заказы', 'Ready orders')}: ${readyOrders}`}
              tone="sky"
              onClick={() => onOpenTab('tables')}
            />
            <DashboardStatCard
              title={tx(lang, 'Kassa + Kart', 'Касса + карта', 'Cash + Card')}
              value={`${new Decimal(snapshot.balances.cash_balance || 0).plus(new Decimal(snapshot.balances.card_balance || 0)).toFixed(2)} ₼`}
              helper={`${tx(lang, 'Seyf', 'Сейф', 'Safe')}: ${new Decimal(snapshot.balances.safe_balance || 0).toFixed(2)} ₼`}
              tone="violet"
              onClick={() => onOpenTab('finance')}
            />
            <DashboardStatCard
              title={tx(lang, 'Investor Borcu', 'Долг инвестору', 'Investor Debt')}
              value={`${new Decimal(snapshot.balances.investor_balance || 0).toFixed(2)} ₼`}
              helper={`${tx(lang, 'Nisyə borc', 'Долговой баланс', 'Debt balance')}: ${new Decimal(snapshot.balances.debt_balance || 0).toFixed(2)} ₼`}
              tone="rose"
              onClick={() => onOpenTab('finance')}
            />
          </div>

          <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(246,248,252,0.82))] p-4 text-slate-900 shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
            <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{tx(lang, 'Source Of Truth', 'Источник данных', 'Source Of Truth')}</div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
                <div className="font-semibold">{tx(lang, 'Gəlir', 'Выручка', 'Revenue')}</div>
                <div className="mt-1 text-xs text-slate-500">{tx(lang, 'Sale cədvəlindən gəlir. Ledger warning varsa ayrıca göstərilir.', 'Берется из таблицы Sale. Если ledger не совпадает, показывается warning.', 'Comes from Sale table. If ledger differs, a warning is shown.')}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
                <div className="font-semibold">{tx(lang, 'Kassa + Kart', 'Касса + карта', 'Cash + Card')}</div>
                <div className="mt-1 text-xs text-slate-500">{tx(lang, 'Finance ledger balanslarından gəlir.', 'Берется из балансов finance ledger.', 'Comes from finance ledger balances.')}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
                <div className="font-semibold">{tx(lang, 'Investor Borcu', 'Долг инвестору', 'Investor Debt')}</div>
                <div className="mt-1 text-xs text-slate-500">{tx(lang, 'Investor liability ledger-dən oxunur.', 'Читается из investor liability ledger.', 'Read from investor liability ledger.')}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
                <div className="font-semibold">{tx(lang, 'Depozitlər', 'Депозиты', 'Deposits')}</div>
                <div className="mt-1 text-xs text-slate-500">{tx(lang, 'Dashboard kartı yığılmış depoziti, Finance isə aktiv depozit öhdəliyini göstərir.', 'Карточка dashboard показывает собранные депозиты, Finance — активное обязательство.', 'Dashboard card shows collected deposits; Finance shows active deposit liability.')}</div>
              </div>
            </div>
          </div>

          {dashboardExceptions.length > 0 && (
            <div className="rounded-[24px] border border-rose-500/15 bg-slate-950/50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.22em] text-rose-300">{tx(lang, 'Audit Exceptions', 'Аудит-исключения', 'Audit Exceptions')}</div>
              <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
                {dashboardExceptions.map((item) => (
                  <div key={item.title} className={`rounded-2xl border p-3 ${item.tone === 'rose' ? 'border-rose-500/30 bg-rose-950/30' : item.tone === 'amber' ? 'border-amber-500/30 bg-amber-950/20' : 'border-sky-500/30 bg-sky-950/20'}`}>
                    <div className="font-semibold text-slate-100">{item.title}</div>
                    <div className="mt-1 text-xs text-slate-300">{item.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasReconciliationIssue && (
            <div className="rounded-[28px] border border-rose-300/50 bg-[linear-gradient(135deg,#fff1f2,#ffe4e6)] p-5 text-rose-950 shadow-[0_16px_40px_rgba(244,63,94,0.18)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.22em] text-rose-700">
                    {tx(lang, 'Satış Uzlaşma Xəbərdarlığı', 'Предупреждение сверки продаж', 'Sales Reconciliation Warning')}
                  </div>
                  <div className="mt-2 text-2xl font-black">
                    {tx(lang, 'Satış gəliri ilə maliyyə daxilolmaları üst-üstə düşmür', 'Выручка и финансовые поступления не совпадают', 'Revenue and finance inflow do not match')}
                  </div>
                  <div className="mt-2 text-sm text-rose-900/80">
                    {tx(lang, 'Fərq', 'Разница', 'Gap')}: {reconciliationGap.toFixed(2)} ₼ · {tx(lang, 'Satış gəliri', 'Выручка', 'Revenue')}: {new Decimal(snapshot.summary?.total_revenue || 0).toFixed(2)} ₼ · {tx(lang, 'Ledger satış daxilolması', 'Поступление по ledger', 'Ledger sales inflow')}: {new Decimal(snapshot.summary?.ledger_sales_total || 0).toFixed(2)} ₼
                  </div>
                </div>
                <button
                  onClick={() => onOpenTab('analytics')}
                  className="rounded-2xl bg-rose-950 px-4 py-3 text-sm font-semibold text-white"
                >
                  {tx(lang, 'Analitikaya keç', 'Открыть аналитику', 'Open analytics')}
                </button>
              </div>
            </div>
          )}

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

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <AiInsightTile
              title={tx(lang, 'AI Shift', 'AI смена', 'AI Shift')}
              summary={aiInsights.shift?.summary}
              action={aiInsights.shift?.actions?.[0]}
              tone={aiInsights.shift?.highlights?.find((item) => item.tone === 'warning') ? 'warning' : 'neutral'}
              ctaLabel={tx(lang, 'AI modulunu aç', 'Открыть AI модуль', 'Open AI module')}
              onClick={() => onOpenTab('ai')}
            />
            <AiInsightTile
              title={tx(lang, 'AI Finance', 'AI финансы', 'AI Finance')}
              summary={aiInsights.finance?.summary}
              action={aiInsights.finance?.actions?.[0]}
              tone={aiInsights.finance?.highlights?.find((item) => item.tone === 'warning') ? 'warning' : 'good'}
              ctaLabel={tx(lang, 'Maliyyəyə keç', 'Открыть финансы', 'Open finance')}
              onClick={() => onOpenTab('finance')}
            />
            <AiInsightTile
              title={tx(lang, 'AI Stock Alert', 'AI склад alert', 'AI Stock Alert')}
              summary={aiInsights.stock?.summary}
              action={aiInsights.stock?.actions?.[0]}
              tone={snapshot.lowStock.length > 0 ? 'warning' : 'good'}
              ctaLabel={snapshot.lowStock.length > 0 ? tx(lang, 'Anbara keç', 'Открыть склад', 'Open inventory') : tx(lang, 'AI modulunu aç', 'Открыть AI модуль', 'Open AI module')}
              onClick={() => onOpenTab(snapshot.lowStock.length > 0 ? 'inventory' : 'ai')}
            />
          </div>

          {!stockReminderDismissed && snapshot.lowStock.length > 0 && aiInsights.stock?.actions?.[0] && (
            <div className="rounded-[28px] border border-amber-300/50 bg-[linear-gradient(135deg,#fff7d6,#ffefb0)] p-5 text-amber-950 shadow-[0_16px_40px_rgba(245,158,11,0.2)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.22em] text-amber-700">{tx(lang, 'AI Günlük Reminder', 'AI дневной reminder', 'AI Daily Reminder')}</div>
                  <div className="mt-2 text-2xl font-black">{tx(lang, 'Kritik stok üçün bu gün tədbir görmək lazımdır', 'По критическому складу нужно действовать сегодня', 'Critical stock needs action today')}</div>
                  <div className="mt-2 text-sm text-amber-900/80">{aiInsights.stock.actions[0]}</div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => onOpenTab('inventory')}
                    className="rounded-2xl bg-amber-950 px-4 py-3 text-sm font-semibold text-white"
                  >
                    {tx(lang, 'Anbara keç', 'Открыть склад', 'Open inventory')}
                  </button>
                  <button
                    onClick={dismissStockReminder}
                    className="rounded-2xl border border-amber-900/20 bg-white/50 px-4 py-3 text-sm font-semibold text-amber-950"
                  >
                    {tx(lang, 'Bu gün bağla', 'Скрыть на сегодня', 'Dismiss for today')}
                  </button>
                </div>
              </div>
            </div>
          )}

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
              <SoftTile
                title={tx(lang, 'Depozitlər', 'Депозиты', 'Deposits')}
                value={`${depositsCollected.toFixed(2)} ₼`}
                helper={tx(lang, 'Masa açılışlarında toplanan məbləğ', 'Сумма собранных депозитов по столам', 'Collected table deposits')}
                icon={<Wallet size={18} />}
              />
            </div>
          </section>

            <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-5 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{tx(lang, 'Satış Trend', 'Тренд продаж', 'Sales Trend')}</h3>
                  <p className="mt-1 text-sm text-slate-500">{tx(lang, 'Son saatlar üzrə', 'По последним часам', 'Last hours')}</p>
                </div>
                {hoveredTrend ? (
                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right shadow-sm">
                    <div className="text-xs text-slate-500">{hoveredTrend.label}</div>
                    <div className="text-sm font-bold text-slate-900">{hoveredTrend.value}</div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl bg-slate-100/80 p-4">
                <svg viewBox="0 0 100 60" className="h-44 w-full overflow-visible">
                  <path d="M 0 52 L 100 52" stroke="#cbd5e1" strokeWidth="0.6" strokeDasharray="2 2" fill="none" />
                  <path d={hourlyTrend.map((point, index) => `${index === 0 ? 'M' : 'L'} ${hourlyTrend.length === 1 ? 0 : (index / (hourlyTrend.length - 1)) * 100} ${52 - point.height * 0.42}`).join(' ')} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
                  {hourlyTrend.map((point, index) => (
                    <circle
                      key={point.label}
                      cx={hourlyTrend.length === 1 ? 0 : (index / (hourlyTrend.length - 1)) * 100}
                      cy={52 - point.height * 0.42}
                      r="2.2"
                      fill="#0ea5e9"
                      onMouseEnter={() => setHoveredTrend({ label: point.label, value: `${point.total.toFixed(2)} ₼` })}
                      onMouseLeave={() => setHoveredTrend(null)}
                    />
                  ))}
                </svg>
                <div className="mt-3 grid grid-cols-6 gap-2 text-center">
                  {hourlyTrend.map((point) => (
                    <div key={point.label} className="text-[11px] font-semibold text-slate-500">{point.label}</div>
                  ))}
                </div>
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
              <div className="mt-4">
                <button
                  onClick={() => onOpenTab('analytics')}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
                >
                  {tx(lang, 'Ətraflı analitikaya keç', 'Открыть аналитику', 'Open analytics')}
                </button>
              </div>
            </section>

            <section className="space-y-4">
              {readyOrders > 0 && (
                <div className="rounded-[28px] border border-amber-200 bg-[linear-gradient(135deg,#fff8e7,#fff1c7)] p-5 text-amber-950 shadow-[0_16px_40px_rgba(245,158,11,0.18)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                        {tx(lang, 'Canlı Xəbərdarlıq', 'Живое уведомление', 'Live Alert')}
                      </div>
                      <div className="mt-2 text-2xl font-black">
                        {readyOrders} {tx(lang, 'sifariş servisə hazırdır', 'заказов готовы к выдаче', 'orders are ready to serve')}
                      </div>
                      <div className="mt-2 text-sm text-amber-800/80">
                        {tx(lang, 'Ofisiant və ya zal komandası bu sifarişləri masalara çıxarmalıdır.', 'Официант или команда зала должны выдать эти заказы.', 'Front-of-house should serve these ready orders now.')}
                      </div>
                    </div>
                    <button
                      onClick={() => onOpenTab('tables')}
                      className="rounded-2xl bg-amber-950 px-4 py-3 text-sm font-semibold text-white shadow-sm"
                    >
                      {tx(lang, 'Masalara bax', 'Открыть столы', 'Open tables')}
                    </button>
                  </div>
                </div>
              )}

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
                    action={snapshot.lowStock.length > 0 ? (
                      <button
                        onClick={() => onOpenTab('inventory')}
                        className="rounded-xl bg-rose-950 px-3 py-2 text-xs font-semibold text-white"
                      >
                        {tx(lang, 'Anbara keç', 'Открыть склад', 'Open inventory')}
                      </button>
                    ) : undefined}
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
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">{tx(lang, 'Son Maliyyə Auditləri', 'Последние финансовые аудиты', 'Recent Finance Audits')}</h3>
                    <p className="mt-1 text-sm text-slate-500">{tx(lang, 'Backend anomaly snapshot tarixçəsi', 'История backend anomaly snapshot', 'Backend anomaly snapshot history')}</p>
                  </div>
                  <button
                    onClick={() => onOpenTab('finance')}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
                  >
                    {tx(lang, 'Maliyyəyə keç', 'Открыть финансы', 'Open finance')}
                  </button>
                </div>
                <div className="space-y-3">
                  {recentFinanceAlerts.map((row) => (
                    <div key={row.id} className="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-rose-950">{row.flags}</div>
                        <div className="text-xs text-rose-700">{new Date(row.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</div>
                      </div>
                    </div>
                  ))}
                  {recentFinanceAlerts.length === 0 && (
                    <EmptyDash text={tx(lang, 'Hələ maliyyə audit warning tarixçəsi yoxdur', 'Пока нет истории финансовых audit warning', 'No finance audit warning history yet')} />
                  )}
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-5 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">{tx(lang, 'Maliyyə Snapshot', 'Финансовый снимок', 'Finance Snapshot')}</h3>
                    <p className="mt-1 text-sm text-slate-500">{tx(lang, 'Seçilmiş aralıqda net trend', 'Нетто тренд за выбранный период', 'Net trend for selected range')}</p>
                  </div>
                  <button
                    onClick={() => onOpenTab('finance')}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm"
                  >
                    {tx(lang, 'Maliyyəyə keç', 'Открыть финансы', 'Open finance')}
                  </button>
                </div>
                <div className="mt-4 rounded-2xl bg-slate-100/80 p-4">
                  <svg viewBox="0 0 100 60" className="h-24 w-full overflow-visible">
                    <path d="M 0 30 L 100 30" stroke="#cbd5e1" strokeWidth="0.6" strokeDasharray="2 2" fill="none" />
                    {trendPath ? <path d={trendPath} fill="none" stroke="#111827" strokeWidth="2.4" strokeLinecap="round" /> : null}
                    {financeSparkline.map((point) => (
                      <circle key={point.label} cx={point.x} cy={point.y} r="1.6" fill={point.value.gte(0) ? '#10b981' : '#ef4444'} />
                    ))}
                  </svg>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] font-semibold text-slate-500">
                    {financeSparkline.slice(-4).map((point) => (
                      <div key={point.label}>{point.label}</div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.93),rgba(246,248,252,0.88))] p-5 text-slate-900 shadow-[0_16px_45px_rgba(0,0,0,0.22)]">
                <h3 className="text-lg font-bold">{tx(lang, 'Son Satışlar', 'Последние продажи', 'Recent Sales')}</h3>
                <div className="mt-4 space-y-3">
                  {snapshot.sales.slice(0, 5).map((sale: any) => (
                    <div key={sale.id} className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">{sale.cashier || '-'}</div>
                          <div className="text-xs text-slate-500">{formatServerUtcTime(sale.created_at, lang)}</div>
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

function AiInsightTile({
  title,
  summary,
  action,
  tone = 'neutral',
  onClick,
  ctaLabel,
}: {
  title: string;
  summary?: string | null;
  action?: string | null;
  tone?: 'neutral' | 'good' | 'warning';
  onClick?: () => void;
  ctaLabel?: string;
}) {
  const palette =
    tone === 'warning'
      ? 'border-amber-400/35 bg-amber-500/10 text-amber-50'
      : tone === 'good'
        ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-50'
        : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-50';
  return (
    <section className={`dashboard-card rounded-[24px] border p-5 shadow-[0_14px_40px_rgba(0,0,0,0.18)] ${palette}`}>
      <div className="text-xs font-bold uppercase tracking-[0.2em] opacity-80">{title}</div>
      <div className="mt-3 text-sm leading-6 text-white/90">
        {summary || 'AI insight hazırlanır...'}
      </div>
      {action ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-sm font-semibold text-white/90">
          {action}
        </div>
      ) : null}
      {onClick ? (
        <button
          onClick={onClick}
          className="mt-4 rounded-xl border border-white/15 bg-black/15 px-4 py-3 text-sm font-semibold text-white/95"
        >
          {ctaLabel || 'Open'}
        </button>
      ) : null}
    </section>
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
    <div className={`dashboard-card rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,248,252,0.88)),radial-gradient(circle_at_top_left,var(--tw-gradient-from),var(--tw-gradient-to))] ${toneMap[tone]} p-5 text-slate-900 shadow-[0_16px_40px_rgba(0,0,0,0.2)]`}>
      <div className="text-sm font-medium text-slate-500">{title}</div>
      <div className="dashboard-stat-value mt-2 text-3xl font-black text-slate-950">{value}</div>
      <div className="mt-2 text-xs text-slate-500">{helper}</div>
    </div>
  );
}

function SoftTile({ title, value, helper, icon }: { title: string; value: string; helper: string; icon: React.ReactNode }) {
  return (
    <div className="dashboard-card-soft rounded-[24px] border border-slate-200 bg-white/80 p-4 shadow-sm">
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
    <div className={`dashboard-card-soft flex items-center justify-between rounded-2xl border px-4 py-3 ${accentClass}`}>
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
  action,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  helper: string;
  tone: 'rose' | 'sky' | 'amber';
  action?: React.ReactNode;
}) {
  const toneMap = {
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    sky: 'border-sky-200 bg-sky-50 text-sky-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  } as const;
  return (
    <div className={`dashboard-card-soft rounded-2xl border px-4 py-3 ${toneMap[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-white/70 p-2">{icon}</div>
          <div>
            <div className="font-semibold">{title}</div>
            <div className="mt-1 text-xs opacity-75">{helper}</div>
            {action ? <div className="mt-3">{action}</div> : null}
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
