import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Decimal } from 'decimal.js';
import {
  AlertTriangle,
  ArrowRight,
  ChefHat,
  CreditCard,
  PackageSearch,
  Receipt,
  RefreshCw,
  ShoppingBag,
  Users,
  Wallet,
  WifiOff,
  Bot,
} from 'lucide-react';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { get_sales_list, get_sales_list_live, get_sales_summary, get_sales_summary_live } from '../../api/analytics';
import { fetch_finance_anomalies, fetch_finance_balances, fetch_finance_entries, get_balance, type FinanceAnomalies } from '../../api/finance';
import { get_low_stock_items } from '../../api/inventory';
import { get_kitchen_orders, get_kitchen_orders_live } from '../../api/kds';
import { get_tables, get_tables_live, getPendingOfflineTableOps, getPendingOfflineTableOpsCount, type OfflineTableOpSummary } from '../../api/tables';
import { getPendingOfflineSalesCount } from '../../lib/offline';
import { get_logs_live } from '../../api/logs';
import { subscribeTenantRealtime } from '../../api/realtime';
import { formatServerUtcTime, localDateInputValue, localDateTimeNextStart, localDateTimeStart, parseServerUtcTimestamp } from '../../lib/time';
import { generate_ai_insight_engine, type AiDecisionInsight } from '../../api/ai_manager';

type DashboardTab = 'inventory' | 'finance' | 'analytics' | 'tables' | 'crm' | 'ai';
type AlertTone = 'critical' | 'warning' | 'info';
type RangePreset = 'daily' | 'weekly' | 'monthly' | 'custom';

type DashboardSnapshot = {
  summary: any;
  sales: any[];
  kitchenOrders: any[];
  tables: any[];
  balances: any;
  financeEntries: any[];
  lowStock: any[];
  pendingOffline: number;
  pendingOfflineTableOps: number;
  pendingOfflineTableOpItems: OfflineTableOpSummary[];
  auditLogs: any[];
  loading: boolean;
};

type DecisionAlert = {
  id: string;
  title: string;
  body: string;
  tone: AlertTone;
  actionLabel: string;
  action: () => void;
};

const emptyBalances = {
  cash_balance: '0',
  card_balance: '0',
  debt_balance: '0',
  investor_balance: '0',
  safe_balance: '0',
  deposit_balance: '0',
};

const money = (value: any) => `${new Decimal(value || 0).toFixed(2)} ₼`;

const normalizeStatus = (status: any) => String(status || '').toUpperCase();

const orderTypeLabel = (value: any, lang: string) => {
  const normalized = String(value || '').trim().toUpperCase();
  const labels: Record<string, string> = {
    DINE_IN: tx(lang, 'Zalda', 'В зале', 'Dine in'),
    DINEIN: tx(lang, 'Zalda', 'В зале', 'Dine in'),
    TAKEAWAY: tx(lang, 'Al-apar', 'На вынос', 'Takeaway'),
    TAKE_AWAY: tx(lang, 'Al-apar', 'На вынос', 'Takeaway'),
    DELIVERY: tx(lang, 'Çatdırılma', 'Доставка', 'Delivery'),
  };
  return labels[normalized] || String(value || '-');
};

const paymentMethodLabel = (value: any, lang: string) => {
  const normalized = String(value || '').trim().toUpperCase();
  const labels: Record<string, string> = {
    CASH: tx(lang, 'Nağd', 'Наличные', 'Cash'),
    CARD: tx(lang, 'Kart', 'Карта', 'Card'),
    SPLIT: tx(lang, 'Bölünmüş ödəniş', 'Раздельная оплата', 'Split'),
  };
  return labels[normalized] || String(value || '-');
};

const tableStatusLabel = (value: any, lang: string) => {
  const normalized = normalizeStatus(value);
  const labels: Record<string, string> = {
    AVAILABLE: tx(lang, 'Boş', 'Свободен', 'Available'),
    RESERVED: tx(lang, 'Rezerv', 'Резерв', 'Reserved'),
    SEATED: tx(lang, 'Oturub', 'Посажен', 'Seated'),
    ACTIVE_CHECK: tx(lang, 'Açıq hesab', 'Открытый чек', 'Active check'),
    DIRTY: tx(lang, 'Təmizlik', 'Грязный', 'Dirty'),
  };
  return labels[normalized] || normalized || tx(lang, 'Aktiv', 'Активно', 'Active');
};

export default function DashboardPanel({ onOpenTab }: { onOpenTab: (tab: DashboardTab) => void }) {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [rangePreset, setRangePreset] = useState<RangePreset>('daily');
  const [fromDate, setFromDate] = useState(() => localDateInputValue());
  const [toDate, setToDate] = useState(() => localDateInputValue());
  const [dismissedAlerts, setDismissedAlerts] = useState<Record<string, boolean>>({});
  const [financeAnomalies, setFinanceAnomalies] = useState<FinanceAnomalies | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>({
    summary: null,
    sales: [],
    kitchenOrders: [],
    tables: [],
    balances: emptyBalances,
    financeEntries: [],
    lowStock: [],
    pendingOffline: 0,
    pendingOfflineTableOps: 0,
    pendingOfflineTableOpItems: [],
    auditLogs: [],
    loading: true,
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
      setFromDate(localDateInputValue(start));
      setToDate(localDateInputValue(now));
    }
  }, [rangePreset]);

  const activeRange = useMemo(() => {
    return {
      fromIso: localDateTimeStart(fromDate),
      toIso: localDateTimeNextStart(toDate),
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

  const loadDashboard = useCallback(async () => {
    try {
      const [
        summary,
        sales,
        kitchenOrders,
        tables,
        balances,
        financeEntries,
        pendingOffline,
        pendingOfflineTableOps,
        pendingOfflineTableOpItems,
        anomalies,
        auditLogs,
      ] = await Promise.all([
        get_sales_summary_live(tenant_id, activeRange.fromIso, activeRange.toIso).catch(() =>
          get_sales_summary(tenant_id, activeRange.fromIso, activeRange.toIso),
        ),
        get_sales_list_live(tenant_id, activeRange.fromIso, activeRange.toIso, undefined, { limit: 200 }).catch(() =>
          get_sales_list(tenant_id, activeRange.fromIso, activeRange.toIso),
        ),
        get_kitchen_orders_live(tenant_id).catch(() => get_kitchen_orders(tenant_id)),
        get_tables_live(tenant_id).catch(() => get_tables(tenant_id)),
        fetch_finance_balances(tenant_id).catch(() => get_balance(tenant_id, 'all', false) as any),
        fetch_finance_entries(tenant_id).catch(() => []),
        getPendingOfflineSalesCount(tenant_id),
        Promise.resolve(getPendingOfflineTableOpsCount(tenant_id)),
        Promise.resolve(getPendingOfflineTableOps(tenant_id, 10)),
        fetch_finance_anomalies(tenant_id).catch(() => null),
        get_logs_live(tenant_id, 80).catch(() => []),
      ]);

      setSnapshot({
        summary,
        sales,
        kitchenOrders,
        tables,
        balances,
        financeEntries,
        lowStock: get_low_stock_items(tenant_id, 5),
        pendingOffline,
        pendingOfflineTableOps,
        pendingOfflineTableOpItems,
        auditLogs,
        loading: false,
      });
      setFinanceAnomalies(anomalies);
    } catch (error: any) {
      setSnapshot((prev) => ({ ...prev, loading: false }));
      notify('error', error?.message || tx(lang, 'Dashboard yüklənmədi', 'Dashboard не загрузился', 'Dashboard failed to load'));
    }
  }, [tenant_id, activeRange.fromIso, activeRange.toIso, lang, notify]);

  useEffect(() => {
    void loadDashboard();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadDashboard();
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadDashboard]);

  useEffect(() => {
    return subscribeTenantRealtime(tenant_id, (message) => {
      const event = String(message.event || '');
      if (
        event.includes('table') ||
        event.includes('check') ||
        event.includes('kitchen') ||
        event.includes('payment') ||
        event.includes('reservation') ||
        event.includes('finance')
      ) {
        void loadDashboard();
      }
    });
  }, [tenant_id, loadDashboard]);

  useEffect(() => {
    const onFinanceUpdated = () => void loadDashboard();
    window.addEventListener('finance-updated', onFinanceUpdated);
    return () => window.removeEventListener('finance-updated', onFinanceUpdated);
  }, [loadDashboard]);

  const activeTables = useMemo(
    () => snapshot.tables.filter((table: any) => Boolean(table.is_occupied) || ['SEATED', 'ACTIVE_CHECK'].includes(normalizeStatus(table.status))),
    [snapshot.tables],
  );

  const openChecks = useMemo(
    () => activeTables.filter((table: any) => new Decimal(table.total || 0).greaterThan(0)),
    [activeTables],
  );

  const kitchenActive = useMemo(
    () => snapshot.kitchenOrders.filter((order: any) => ['NEW', 'SENT', 'PREPARING'].includes(normalizeStatus(order.status))),
    [snapshot.kitchenOrders],
  );

  const readyOrders = useMemo(
    () => snapshot.kitchenOrders.filter((order: any) => normalizeStatus(order.status) === 'READY'),
    [snapshot.kitchenOrders],
  );

  const kitchenDelayed = useMemo(() => {
    const now = Date.now();
    return kitchenActive.filter((order: any) => {
      const created = parseServerUtcTimestamp(order.created_at) || new Date(order.created_at);
      return now - created.getTime() > 20 * 60 * 1000;
    });
  }, [kitchenActive]);

  const averageTicket = useMemo(() => {
    if (!snapshot.sales.length) return new Decimal(0);
    const total = snapshot.sales.reduce((sum: Decimal, sale: any) => sum.plus(new Decimal(sale.total || 0)), new Decimal(0));
    return total.div(snapshot.sales.length);
  }, [snapshot.sales]);

  const kitchenLoad = useMemo(() => {
    const load = kitchenActive.length + readyOrders.length;
    return Math.min(100, Math.round((load / 20) * 100));
  }, [kitchenActive.length, readyOrders.length]);

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
      .slice(0, 6);
  }, [snapshot.sales]);

  const staffStats = useMemo(() => {
    const staffMap = new Map<string, { sales: number; revenue: Decimal }>();
    snapshot.sales.forEach((sale: any) => {
      const cashier = String(sale.cashier || '-');
      const row = staffMap.get(cashier) || { sales: 0, revenue: new Decimal(0) };
      row.sales += 1;
      row.revenue = row.revenue.plus(new Decimal(sale.total || 0));
      staffMap.set(cashier, row);
    });
    return Array.from(staffMap.entries())
      .map(([cashier, row]) => ({
        cashier,
        sales: row.sales,
        revenue: row.revenue,
        avg: row.sales > 0 ? row.revenue.div(row.sales) : new Decimal(0),
      }))
      .sort((a, b) => b.revenue.minus(a.revenue).toNumber())
      .slice(0, 5);
  }, [snapshot.sales]);

  const voidWasteCount = useMemo(() => {
    const statusCount = snapshot.kitchenOrders.reduce((count: number, order: any) => {
      const items = Array.isArray(order.items) ? order.items : [];
      return count + items.filter((item: any) => ['VOID_REQUESTED', 'VOIDED', 'WASTE', 'REMAKE', 'COMPED'].includes(normalizeStatus(item.status || item.action))).length;
    }, 0);
    return statusCount + Number(snapshot.summary?.void_count || 0);
  }, [snapshot.kitchenOrders, snapshot.summary?.void_count]);

  const criticalAlerts = useMemo<DecisionAlert[]>(() => {
    const alerts: DecisionAlert[] = [];
    if (financeAnomalies?.has_shift_cash_mismatch) {
      alerts.push({
        id: 'cash-mismatch',
        title: tx(lang, 'Kassa fərqi var', 'Есть расхождение кассы', 'Cash mismatch'),
        body: `${tx(lang, 'Fərq', 'Разница', 'Gap')}: ${money(financeAnomalies.shift_cash_gap)}`,
        tone: 'critical',
        actionLabel: tx(lang, 'Bax', 'Проверить', 'Review'),
        action: () => onOpenTab('finance'),
      });
    }
    if (snapshot.pendingOffline > 0) {
      alerts.push({
        id: 'offline-orders',
        title: tx(lang, 'Offline satışlar gözləyir', 'Оффлайн продажи ждут', 'Offline orders pending'),
        body: `${snapshot.pendingOffline} ${tx(lang, 'əməliyyat sync gözləyir', 'операций ждут синхронизации', 'operations wait for sync')}`,
        tone: 'warning',
        actionLabel: tx(lang, 'Düzəlt', 'Исправить', 'Fix'),
        action: () => onOpenTab('analytics'),
      });
    }
    if (snapshot.pendingOfflineTableOps > 0) {
      const firstOp = snapshot.pendingOfflineTableOpItems[0];
      const opLabel = firstOp?.op_type === 'open'
        ? tx(lang, 'masa açma', 'открытие стола', 'table open')
        : firstOp?.op_type === 'send_to_kitchen'
          ? tx(lang, 'mətbəx göndərişi', 'отправка на кухню', 'kitchen send')
          : tx(lang, 'masa ödənişi', 'оплата стола', 'table payment');
      alerts.push({
        id: 'offline-table-ops',
        title: tx(lang, 'Offline masa əməliyyatları gözləyir', 'Оффлайн операции по столам ожидают', 'Offline table operations pending'),
        body: `${snapshot.pendingOfflineTableOps} ${tx(lang, 'əməliyyat növbədədir', 'операций в очереди', 'operations in queue')} · ${opLabel}`,
        tone: 'warning',
        actionLabel: tx(lang, 'Masalara keç', 'Открыть столы', 'Open tables'),
        action: () => onOpenTab('tables'),
      });
    }
    if (kitchenDelayed.length > 0) {
      alerts.push({
        id: 'kitchen-delay',
        title: tx(lang, 'Mətbəxdə gecikmə var', 'Есть задержка кухни', 'Kitchen delay'),
        body: `${kitchenDelayed.length} ${tx(lang, 'sifariş 20 dəqiqədən çox gözləyir', 'заказов ждут больше 20 минут', 'orders are older than 20 minutes')}`,
        tone: 'critical',
        actionLabel: tx(lang, 'Mətbəxi aç', 'Открыть кухню', 'Open kitchen'),
        action: () => onOpenTab('tables'),
      });
    }
    if (voidWasteCount > 0) {
      alerts.push({
        id: 'void-waste',
        title: tx(lang, 'Void / israf nəzarəti', 'Контроль void / списания', 'Void / waste control'),
        body: `${voidWasteCount} ${tx(lang, 'nəzarətli item əməliyyatı var', 'контролируемых действий по позициям', 'controlled item actions')}`,
        tone: 'warning',
        actionLabel: tx(lang, 'Auditə bax', 'Аудит', 'Audit'),
        action: () => onOpenTab('analytics'),
      });
    }
    if (financeAnomalies?.has_current_period_reconciliation_issue) {
      alerts.push({
        id: 'sales-ledger-gap',
        title: tx(lang, 'Satış və maliyyə yazılışı fərqi', 'Расхождение продаж и финансовых проводок', 'Sales vs ledger gap'),
        body: `${tx(lang, 'Cari dövr fərqi', 'Разница текущего периода', 'Current period gap')}: ${money(financeAnomalies.current_period_reconciliation_gap)}`,
        tone: 'critical',
        actionLabel: tx(lang, 'Maliyyəyə keç', 'Открыть финансы', 'Open finance'),
        action: () => onOpenTab('finance'),
      });
    }
    if (snapshot.lowStock.length > 0) {
      alerts.push({
        id: 'low-stock',
        title: tx(lang, 'Kritik stok', 'Критический склад', 'Critical stock'),
        body: `${snapshot.lowStock[0]?.name || ''} ${snapshot.lowStock.length > 1 ? `+${snapshot.lowStock.length - 1}` : ''}`,
        tone: 'warning',
        actionLabel: tx(lang, 'Anbara keç', 'Открыть склад', 'Open inventory'),
        action: () => onOpenTab('inventory'),
      });
    }
    return alerts.filter((alert) => !dismissedAlerts[alert.id]).slice(0, 5);
  }, [dismissedAlerts, financeAnomalies, kitchenDelayed.length, lang, onOpenTab, snapshot.lowStock, snapshot.pendingOffline, snapshot.pendingOfflineTableOps, snapshot.pendingOfflineTableOpItems, voidWasteCount]);

  const alertBreakdown = useMemo(() => {
    const critical = criticalAlerts.filter((alert) => alert.tone === 'critical').length;
    const warning = criticalAlerts.filter((alert) => alert.tone === 'warning').length;
    const info = criticalAlerts.filter((alert) => alert.tone === 'info').length;
    return { critical, warning, info };
  }, [criticalAlerts]);

  const financeAuditLogs = useMemo(() => {
    return snapshot.auditLogs
      .filter((log: any) => normalizeStatus(log.action) === 'FINANCE_ANOMALY_SNAPSHOT')
      .slice(0, 3);
  }, [snapshot.auditLogs]);

  const aiManagerInsights = useMemo(() => {
    if (snapshot.loading) return [];
    return generate_ai_insight_engine({
      tenant_id,
      date_from: activeRange.fromIso,
      date_to: activeRange.toIso,
      max_items: 4,
    });
  }, [activeRange.fromIso, activeRange.toIso, snapshot.loading, tenant_id]);

  const openInsightModule = (module: AiDecisionInsight['module']) => {
    if (module === 'finance') return onOpenTab('finance');
    if (module === 'inventory') return onOpenTab('inventory');
    if (module === 'tables') return onOpenTab('tables');
    if (module === 'crm') return onOpenTab('crm');
    if (module === 'analytics') return onOpenTab('analytics');
    return onOpenTab('ai');
  };

  return (
    <DashboardLayout>
      <div className="sticky top-0 z-20 -mx-1 rounded-b-[28px] bg-slate-950/92 px-1 pb-3 pt-1 backdrop-blur-xl">
        <AlertBar
          alerts={criticalAlerts}
          lang={lang}
          onDismiss={(id) => setDismissedAlerts((prev) => ({ ...prev, [id]: true }))}
          onRefresh={() => void loadDashboard()}
          loading={snapshot.loading}
        />
      </div>

      <section className="rounded-[28px] border border-slate-800 bg-slate-900 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-yellow-300">
              {tx(lang, 'Canlı idarəetmə paneli', 'Живая панель управления', 'Live command center')}
            </div>
            <h2 className="mt-2 text-2xl font-black text-white md:text-3xl">
              {tx(lang, 'Restoran bu dəqiqə nə vəziyyətdədir?', 'Что сейчас происходит в ресторане?', 'What is happening right now?')}
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              {tx(
                lang,
                'Satış, masa, mətbəx və kassa nəzarəti bir ekranda. Hər riskin yanında birbaşa əməliyyat düyməsi var.',
                'Продажи, столы, кухня и контроль кассы на одном экране. У каждого риска есть действие.',
                'Sales, tables, kitchen and cash control on one screen. Every risk has an action.',
              )}
            </p>
          </div>
          <RangeControls
            lang={lang}
            rangePreset={rangePreset}
            fromDate={fromDate}
            toDate={toDate}
            setRangePreset={setRangePreset}
            setFromDate={setFromDate}
            setToDate={setToDate}
          />
        </div>
      </section>

      <KPISection
        lang={lang}
        revenue={money(snapshot.summary?.total_revenue)}
        activeTables={activeTables.length}
        openChecks={openChecks.length}
        avgTicket={money(averageTicket)}
        kitchenLoad={kitchenLoad}
        cashGap={money(financeAnomalies?.shift_cash_gap || 0)}
        onOpenTab={onOpenTab}
      />

      <AIManagerStrip
        insights={aiManagerInsights}
        lang={lang}
        onOpen={(module) => openInsightModule(module)}
      />

      <main className="grid grid-cols-1 gap-5 2xl:grid-cols-[1.25fr_0.85fr]">
        <section className="space-y-5">
          <PanelCard
            title={tx(lang, 'Canlı satışlar', 'Live продажи', 'Live Sales')}
            subtitle={tx(lang, 'Son əməliyyatlar, real-time yenilənir', 'Последние операции, обновляется real-time', 'Recent operations, realtime refreshed')}
            actionLabel={tx(lang, 'Analitikaya keç', 'Открыть аналитику', 'Open analytics')}
            onAction={() => onOpenTab('analytics')}
          >
            <LiveFeed sales={snapshot.sales.slice(0, 8)} lang={lang} />
          </PanelCard>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <PanelCard title={tx(lang, 'Top məhsullar', 'Топ продукты', 'Top products')} subtitle={activeRange.label}>
              <TopProducts products={topProducts} lang={lang} />
            </PanelCard>

            <PanelCard
              title={tx(lang, 'Open checks', 'Открытые чеки', 'Open checks')}
              subtitle={tx(lang, 'Hazırda masalarda açıq hesablar', 'Открытые счета по столам', 'Currently open table checks')}
              actionLabel={tx(lang, 'Masalara keç', 'Открыть столы', 'Go to tables')}
              onAction={() => onOpenTab('tables')}
            >
              <OpenChecksPreview tables={openChecks.slice(0, 8)} lang={lang} />
            </PanelCard>
          </div>
        </section>

        <section className="space-y-5">
          <ControlPanel
            lang={lang}
            balances={snapshot.balances}
            anomalies={financeAnomalies}
            onOpenFinance={() => onOpenTab('finance')}
          />

          <PanelCard title={tx(lang, 'Heyət performansı', 'Эффективность персонала', 'Staff performance')} subtitle={activeRange.label}>
            <StaffStats rows={staffStats} lang={lang} />
          </PanelCard>

          <PanelCard
            title={tx(lang, 'Xəbərdarlıq bölgüsü', 'Разбор предупреждений', 'Alerts breakdown')}
            subtitle={tx(lang, 'Kritik / xəbərdarlıq / məlumat bölgüsü', 'Критические / warning / info', 'Critical / warning / info split')}
          >
            <AlertsBreakdown breakdown={alertBreakdown} financeAuditLogs={financeAuditLogs} lang={lang} onOpenFinance={() => onOpenTab('finance')} />
          </PanelCard>
        </section>
      </main>
    </DashboardLayout>
  );
}

function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5 bg-slate-950/20 text-slate-100">
      {children}
    </div>
  );
}

function AIManagerStrip({
  insights,
  lang,
  onOpen,
}: {
  insights: AiDecisionInsight[];
  lang: string;
  onOpen: (module: AiDecisionInsight['module']) => void;
}) {
  const tone = (severity: AiDecisionInsight['severity']) => {
    if (severity === 'critical') return 'border-rose-400/40 bg-rose-950/45';
    if (severity === 'warning') return 'border-amber-400/40 bg-amber-950/35';
    if (severity === 'opportunity') return 'border-cyan-400/40 bg-cyan-950/35';
    if (severity === 'good') return 'border-emerald-400/40 bg-emerald-950/35';
    return 'border-slate-700 bg-slate-900/60';
  };

  if (!insights.length) return null;

  return (
    <section className="rounded-[28px] border border-cyan-400/25 bg-slate-950 p-4 shadow-[0_24px_80px_rgba(8,47,73,0.18)]">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/12 text-cyan-200">
            <Bot size={22} />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200">
              {tx(lang, 'AI menecer tövsiyələri', 'AI рекомендации менеджера', 'AI manager recommendations')}
            </div>
            <p className="mt-1 text-sm text-slate-400">
              {tx(lang, 'Risklər və fürsətlər prioritet sırası ilə göstərilir.', 'Риски и возможности показаны по приоритету.', 'Risks and opportunities are shown by priority.')}
            </p>
          </div>
        </div>
        <button onClick={() => onOpen('ai')} className="min-h-11 rounded-2xl border border-cyan-400/35 bg-cyan-500/10 px-4 text-sm font-black text-cyan-100">
          {tx(lang, 'AI paneli aç', 'Открыть AI панель', 'Open AI panel')}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        {insights.map((insight) => (
          <button
            key={insight.id}
            onClick={() => onOpen(insight.module)}
            className={`min-h-[150px] rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${tone(insight.severity)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-slate-200">
                {insight.metric || insight.phase}
              </div>
              <div className="text-xl font-black text-white">{insight.score}</div>
            </div>
            <h3 className="mt-3 text-base font-black text-white">{insight.title}</h3>
            <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-300">{insight.body}</p>
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-black text-cyan-100">
              {insight.action_label}
              <ArrowRight size={14} />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function AlertBar({
  alerts,
  lang,
  loading,
  onDismiss,
  onRefresh,
}: {
  alerts: DecisionAlert[];
  lang: string;
  loading: boolean;
  onDismiss: (id: string) => void;
  onRefresh: () => void;
}) {
  const empty = alerts.length === 0;
  return (
    <section className={`rounded-[24px] border px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.3)] ${empty ? 'border-emerald-500/25 bg-emerald-950/35' : 'border-rose-500/30 bg-slate-950'}`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${empty ? 'bg-emerald-400/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200'}`}>
            {empty ? <RefreshCw size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div>
            <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">
              {empty ? tx(lang, 'Kritik xəbərdarlıq yoxdur', 'Критических alert нет', 'No critical alerts') : tx(lang, 'Kritik xəbərdarlıq zolağı', 'Critical alert bar', 'Critical alert bar')}
            </div>
            <div className="text-xs text-slate-500">
              {loading ? tx(lang, 'Yenilənir...', 'Обновляется...', 'Refreshing...') : tx(lang, 'Avto-yeniləmə və real-time hadisələr aktivdir', 'Auto-refresh + real-time активны', 'Auto-refresh + realtime events are active')}
            </div>
          </div>
        </div>

        <button onClick={onRefresh} className="min-h-11 rounded-2xl border border-slate-700 bg-slate-900 px-4 text-sm font-bold text-slate-100">
          {tx(lang, 'Yenilə', 'Обновить', 'Refresh')}
        </button>
      </div>

      {!empty && (
        <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`rounded-2xl border p-3 ${
                alert.tone === 'critical'
                  ? 'border-rose-400/35 bg-rose-950/55'
                  : alert.tone === 'warning'
                    ? 'border-amber-400/35 bg-amber-950/40'
                    : 'border-sky-400/35 bg-sky-950/35'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-white">{alert.title}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-300">{alert.body}</div>
                </div>
                <button onClick={() => onDismiss(alert.id)} className="rounded-xl px-2 py-1 text-xs font-black text-slate-400 hover:bg-white/10">
                  ×
                </button>
              </div>
              <button onClick={alert.action} className="mt-3 min-h-11 rounded-2xl bg-white px-4 text-sm font-black text-slate-950">
                {alert.actionLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RangeControls({
  lang,
  rangePreset,
  fromDate,
  toDate,
  setRangePreset,
  setFromDate,
  setToDate,
}: {
  lang: string;
  rangePreset: RangePreset;
  fromDate: string;
  toDate: string;
  setRangePreset: (value: RangePreset) => void;
  setFromDate: (value: string) => void;
  setToDate: (value: string) => void;
}) {
  const buttons: Array<[RangePreset, string]> = [
    ['daily', tx(lang, 'Gün', 'День', 'Day')],
    ['weekly', tx(lang, 'Həftə', 'Неделя', 'Week')],
    ['monthly', tx(lang, 'Ay', 'Месяц', 'Month')],
    ['custom', tx(lang, 'Aralıq', 'Диапазон', 'Range')],
  ];
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="flex flex-wrap gap-2">
        {buttons.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setRangePreset(key)}
            className={`min-h-11 rounded-2xl px-4 text-sm font-black ${rangePreset === key ? 'bg-yellow-400 text-slate-950' : 'border border-slate-700 bg-slate-950 text-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="date"
          value={fromDate}
          onChange={(event) => {
            setRangePreset('custom');
            setFromDate(event.target.value);
          }}
          className="neon-input min-h-11 bg-slate-950 text-slate-100"
        />
        <input
          type="date"
          value={toDate}
          onChange={(event) => {
            setRangePreset('custom');
            setToDate(event.target.value);
          }}
          className="neon-input min-h-11 bg-slate-950 text-slate-100"
        />
      </div>
    </div>
  );
}

function KPISection({
  lang,
  revenue,
  activeTables,
  openChecks,
  avgTicket,
  kitchenLoad,
  cashGap,
  onOpenTab,
}: {
  lang: string;
  revenue: string;
  activeTables: number;
  openChecks: number;
  avgTicket: string;
  kitchenLoad: number;
  cashGap: string;
  onOpenTab: (tab: DashboardTab) => void;
}) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-6">
      <KpiCard title={tx(lang, 'Bu gün satış', 'Продажи сегодня', 'Today sales')} value={revenue} helper={tx(lang, 'canlı yenilənir', 'live', 'live')} icon={<Receipt size={22} />} tone="emerald" onClick={() => onOpenTab('analytics')} />
      <KpiCard title={tx(lang, 'Aktiv masalar', 'Активные столы', 'Active tables')} value={String(activeTables)} helper={tx(lang, 'zal vəziyyəti', 'зал', 'floor')} icon={<Users size={22} />} tone="sky" onClick={() => onOpenTab('tables')} />
      <KpiCard title={tx(lang, 'Açıq hesablar', 'Открытые чеки', 'Open checks')} value={String(openChecks)} helper={tx(lang, 'ödəniş gözləyir', 'ждет оплаты', 'awaiting payment')} icon={<ShoppingBag size={22} />} tone="violet" onClick={() => onOpenTab('tables')} />
      <KpiCard title={tx(lang, 'Orta çek', 'Средний чек', 'Avg ticket')} value={avgTicket} helper={tx(lang, 'çek başına', 'на чек', 'per check')} icon={<CreditCard size={22} />} tone="slate" onClick={() => onOpenTab('analytics')} />
      <KpiCard title={tx(lang, 'Mətbəx yüklənməsi', 'Загрузка кухни', 'Kitchen load')} value={`${kitchenLoad}%`} helper={kitchenLoad >= 70 ? tx(lang, 'yüklənmə yüksəkdir', 'нагрузка высокая', 'high load') : tx(lang, 'normaldır', 'норма', 'normal')} icon={<ChefHat size={22} />} tone={kitchenLoad >= 70 ? 'amber' : 'emerald'} onClick={() => onOpenTab('tables')} />
      <KpiCard title={tx(lang, 'Kassa fərqi', 'Разница кассы', 'Cash gap')} value={cashGap} helper={tx(lang, 'növbə auditi', 'shift audit', 'shift audit')} icon={<Wallet size={22} />} tone={cashGap.startsWith('0.00') ? 'emerald' : 'rose'} onClick={() => onOpenTab('finance')} />
    </section>
  );
}

function KpiCard({
  title,
  value,
  helper,
  icon,
  tone,
  onClick,
}: {
  title: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
  tone: 'emerald' | 'sky' | 'violet' | 'slate' | 'amber' | 'rose';
  onClick: () => void;
}) {
  const palette = {
    emerald: 'border-emerald-400/20 bg-emerald-950/35 text-emerald-100',
    sky: 'border-sky-400/20 bg-sky-950/35 text-sky-100',
    violet: 'border-violet-400/20 bg-violet-950/35 text-violet-100',
    slate: 'border-slate-700 bg-slate-900 text-slate-100',
    amber: 'border-amber-400/25 bg-amber-950/35 text-amber-100',
    rose: 'border-rose-400/25 bg-rose-950/35 text-rose-100',
  } as const;
  return (
    <button onClick={onClick} className={`min-h-[150px] rounded-[28px] border p-5 text-left shadow-[0_18px_55px_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5 ${palette[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="rounded-2xl bg-white/10 p-3">{icon}</div>
        <ArrowRight size={18} className="opacity-50" />
      </div>
      <div className="mt-5 text-xs font-black uppercase tracking-[0.18em] opacity-70">{title}</div>
      <div className="mt-2 text-3xl font-black leading-none">{value}</div>
      <div className="mt-3 text-xs font-semibold opacity-75">{helper}</div>
    </button>
  );
}

function PanelCard({
  title,
  subtitle,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-slate-800 bg-slate-900 p-5 shadow-[0_18px_55px_rgba(0,0,0,0.24)]">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-white">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {onAction && actionLabel ? (
          <button onClick={onAction} className="min-h-11 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm font-black text-slate-200">
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function LiveFeed({ sales, lang }: { sales: any[]; lang: string }) {
  if (!sales.length) return <EmptyState text={tx(lang, 'Hələ satış yoxdur', 'Пока нет продаж', 'No sales yet')} />;
  return (
    <div className="space-y-3">
      {sales.map((sale) => (
        <div key={sale.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3">
          <div>
            <div className="font-bold text-white">{sale.cashier || '-'}</div>
            <div className="mt-1 text-xs text-slate-500">{formatServerUtcTime(sale.created_at, lang)} · {orderTypeLabel(sale.order_type || 'DINE_IN', lang)}</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-black text-white">{money(sale.total)}</div>
            <div className="text-xs text-slate-500">{paymentMethodLabel(sale.payment_method, lang)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TopProducts({ products, lang }: { products: Array<{ name: string; qty: number }>; lang: string }) {
  if (!products.length) return <EmptyState text={tx(lang, 'Top məhsul üçün satış yoxdur', 'Нет продаж для топ продуктов', 'No product sales yet')} />;
  const max = Math.max(...products.map((row) => row.qty), 1);
  return (
    <div className="space-y-3">
      {products.map((product, index) => (
        <div key={product.name} className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-bold text-white">{index + 1}. {product.name}</div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-yellow-400" style={{ width: `${Math.max(8, (product.qty / max) * 100)}%` }} />
              </div>
            </div>
            <div className="text-xl font-black text-white">{product.qty}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OpenChecksPreview({ tables, lang }: { tables: any[]; lang: string }) {
  if (!tables.length) return <EmptyState text={tx(lang, 'Açıq check yoxdur', 'Нет открытых чеков', 'No open checks')} />;
  return (
    <div className="space-y-3">
      {tables.map((table) => (
        <div key={table.id || table.label} className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-bold text-white">{table.label || table.name || '-'}</div>
              <div className="mt-1 text-xs text-slate-500">{Number(table.guest_count || table.guests || 0)} {tx(lang, 'nəfər', 'гостей', 'guests')}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-black text-white">{money(table.total)}</div>
              <div className="text-xs text-violet-300">{tableStatusLabel(table.status, lang)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ControlPanel({
  lang,
  balances,
  anomalies,
  onOpenFinance,
}: {
  lang: string;
  balances: any;
  anomalies: FinanceAnomalies | null;
  onOpenFinance: () => void;
}) {
  const cash = new Decimal(balances.cash_balance || 0);
  const expected = new Decimal(anomalies?.expected_cash || balances.cash_balance || 0);
  const gap = new Decimal(anomalies?.shift_cash_gap || cash.minus(expected));
  return (
    <PanelCard
      title={tx(lang, 'Kassa nəzarəti', 'Контроль кассы', 'Cash Control')}
      subtitle={tx(lang, 'Gözlənilən və faktiki kassa vəziyyəti', 'Expected vs actual статус кассы', 'Expected vs actual till status')}
      actionLabel={tx(lang, 'Bax', 'Проверить', 'Review')}
      onAction={onOpenFinance}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniMetric label={tx(lang, 'Gözlənilən', 'Expected', 'Expected')} value={money(expected)} />
        <MiniMetric label={tx(lang, 'Faktiki kassa', 'Actual cash', 'Actual cash')} value={money(cash)} />
        <MiniMetric label={tx(lang, 'Fərq', 'Разница', 'Gap')} value={money(gap)} danger={gap.abs().greaterThan(0.01)} />
      </div>
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">{tx(lang, 'Kart', 'Карта', 'Card')}</span>
          <span className="font-black text-white">{money(balances.card_balance)}</span>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-slate-400">{tx(lang, 'Depozit öhdəliyi', 'Депозитное обязательство', 'Deposit liability')}</span>
          <span className="font-black text-white">{money(balances.deposit_balance)}</span>
        </div>
      </div>
    </PanelCard>
  );
}

function MiniMetric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${danger ? 'border-rose-400/35 bg-rose-950/40' : 'border-slate-800 bg-slate-950'}`}>
      <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-2 text-xl font-black ${danger ? 'text-rose-100' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function StaffStats({ rows, lang }: { rows: Array<{ cashier: string; sales: number; revenue: Decimal; avg: Decimal }>; lang: string }) {
  if (!rows.length) return <EmptyState text={tx(lang, 'Staff statistikası üçün satış yoxdur', 'Нет продаж для статистики персонала', 'No staff sales yet')} />;
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.cashier} className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-bold text-white">{row.cashier}</div>
              <div className="mt-1 text-xs text-slate-500">{row.sales} {tx(lang, 'satış', 'продаж', 'sales')} · {tx(lang, 'orta çek', 'средний чек', 'avg')} {money(row.avg)}</div>
            </div>
            <div className="text-lg font-black text-white">{money(row.revenue)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AlertsBreakdown({
  breakdown,
  financeAuditLogs,
  lang,
  onOpenFinance,
}: {
  breakdown: { critical: number; warning: number; info: number };
  financeAuditLogs: any[];
  lang: string;
  onOpenFinance: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <MiniMetric label={tx(lang, 'Kritik', 'Критик', 'Critical')} value={String(breakdown.critical)} danger={breakdown.critical > 0} />
        <MiniMetric label={tx(lang, 'Xəbərdarlıq', 'Предупреждение', 'Warning')} value={String(breakdown.warning)} danger={false} />
        <MiniMetric label={tx(lang, 'Məlumat', 'Инфо', 'Info')} value={String(breakdown.info)} danger={false} />
      </div>
      <div className="space-y-3">
        {financeAuditLogs.map((log: any) => (
          <div key={log.id} className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3">
            <div className="font-bold text-white">{tx(lang, 'Maliyyə anomaliyası', 'Финансовая аномалия', 'Finance anomaly')}</div>
            <div className="mt-1 text-xs text-slate-500">{formatServerUtcTime(log.created_at, lang)}</div>
          </div>
        ))}
        {!financeAuditLogs.length ? <EmptyState text={tx(lang, 'Audit snapshot yoxdur', 'Нет audit snapshot', 'No audit snapshots')} /> : null}
      </div>
      <button onClick={onOpenFinance} className="min-h-11 w-full rounded-2xl bg-yellow-400 px-4 text-sm font-black text-slate-950">
        {tx(lang, 'Maliyyə nəzarətinə keç', 'Открыть финансовый контроль', 'Open finance control')}
      </button>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950 px-4 py-8 text-center text-sm font-semibold text-slate-500">
      {text}
    </div>
  );
}
