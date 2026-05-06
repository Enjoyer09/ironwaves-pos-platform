import { Decimal } from 'decimal.js';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { Settings } from '../types/pos';
import { get_sales_summary, get_product_stats, get_sales_list, get_staff_performance } from './analytics';
import { get_balance, get_finance_anomalies, get_finance_entries, get_investor_summary } from './finance';
import { get_inventory_items, get_low_stock_items } from './inventory';
import { getActiveTenantId } from '../lib/tenant';
import { readScopedStorage } from '../lib/storage_keys';
import { get_kitchen_orders } from './kds';
import { get_tables } from './tables';
import { DEFAULT_MODEL_BY_PROVIDER, detectAiConfigFromApiKey, type AiProvider } from '../lib/ai_config';

const defaultTenant = () => getActiveTenantId();

const resolveAiKey = (tenantId: string) => {
  const settings = getSettingsLocal(tenantId);
  return String(settings?.gemini_api_key || readScopedStorage('gemini_api_key') || '').trim();
};

export const resolveAiRuntimeConfig = (tenantId: string): { provider: AiProvider; model: string; key: string } => {
  const settings = getSettingsLocal(tenantId);
  const key = resolveAiKey(tenantId);
  const detected = detectAiConfigFromApiKey(key);
  const configuredProvider = String(settings?.ai_config?.provider || '').trim().toLowerCase() as AiProvider;
  const provider =
    (configuredProvider && configuredProvider !== 'unknown' ? configuredProvider : '')
    || detected.provider;
  const configuredModel = String(settings?.ai_config?.model || '').trim();
  const model = String(
    (configuredModel && configuredModel !== 'auto' ? configuredModel : '')
    || detected.model
    || DEFAULT_MODEL_BY_PROVIDER[provider]
    || 'auto',
  );
  return { provider, model, key };
};

const ensureAiKey = (tenantId: string) => {
  const runtime = resolveAiRuntimeConfig(tenantId);
  const key = runtime.key;
  if (runtime.provider === 'ollama_freeapi') {
    return key || '__ollama_freeapi__';
  }
  if (!key) {
    throw new Error('AI funksiyası üçün əvvəlcə API key daxil edilməlidir.');
  }
  return key;
};

export type AiInsightBlock = {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warning';
};

export type AiInsightResult = {
  kind: 'shift' | 'finance' | 'stock' | 'campaign' | 'security';
  title: string;
  summary: string;
  highlights: AiInsightBlock[];
  actions: string[];
  narrative: string;
};

export type AiDecisionPhase = 'manager' | 'anomaly' | 'finance' | 'inventory' | 'sales';
export type AiDecisionSeverity = 'critical' | 'warning' | 'opportunity' | 'info' | 'good';
export type AiDecisionModule = 'dashboard' | 'finance' | 'inventory' | 'tables' | 'crm' | 'ai' | 'analytics';

export type AiDecisionInsight = {
  id: string;
  phase: AiDecisionPhase;
  severity: AiDecisionSeverity;
  title: string;
  body: string;
  action_label: string;
  module: AiDecisionModule;
  score: number;
  metric?: string;
  evidence: string[];
};

const money = (value: Decimal.Value) => `${new Decimal(value || 0).toDecimalPlaces(2).toString()} ₼`;

const pct = (value: Decimal.Value) => `${new Decimal(value || 0).toDecimalPlaces(1).toString()}%`;

const getCustomersLocal = (tenantId: string) => {
  const tenantRows = getDB<any>(`${tenantId}_customers`) || [];
  if (tenantRows.length > 0) return tenantRows;
  return (getDB<any>('customers') || []).filter((row) => String(row?.tenant_id || '') === tenantId);
};

const getSettingsLocal = (tenantId: string) => {
  const settingsRows = getDB<Settings>('settings') || [];
  return settingsRows.find((row) => String(row.tenant_id || '') === tenantId) || null;
};

const lines = (items: string[]) => items.filter(Boolean).map((item) => `• ${item}`).join('\n');

const severityRank: Record<AiDecisionSeverity, number> = {
  critical: 5,
  warning: 4,
  opportunity: 3,
  info: 2,
  good: 1,
};

const normalizeAiText = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/[ə]/g, 'e')
    .replace(/[ı]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ü]/g, 'u')
    .replace(/[ç]/g, 'c')
    .replace(/[ş]/g, 's')
    .replace(/[ğ]/g, 'g');

const inRange = (createdAt: unknown, dateFrom: string, dateTo: string) => {
  const current = new Date(String(createdAt || '')).getTime();
  return Number.isFinite(current) && current >= new Date(dateFrom).getTime() && current <= new Date(dateTo).getTime();
};

const previousRange = (dateFrom: string, dateTo: string) => {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const duration = Math.max(24 * 60 * 60 * 1000, to.getTime() - from.getTime());
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - duration);
  return {
    date_from: previousFrom.toISOString(),
    date_to: previousTo.toISOString(),
  };
};

export function generate_ai_insight_engine(payload: {
  tenant_id?: string;
  date_from: string;
  date_to: string;
  max_items?: number;
}): AiDecisionInsight[] {
  const tenantId = payload.tenant_id || defaultTenant();
  const maxItems = Math.max(1, Number(payload.max_items || 12));
  const summary = get_sales_summary(tenantId, payload.date_from, payload.date_to);
  const previous = previousRange(payload.date_from, payload.date_to);
  const previousSummary = get_sales_summary(tenantId, previous.date_from, previous.date_to);
  const sales = get_sales_list(tenantId, payload.date_from, payload.date_to);
  const staff = get_staff_performance(tenantId, payload.date_from, payload.date_to);
  const topProducts = get_product_stats(tenantId, payload.date_from, payload.date_to).slice(0, 5);
  const balances = get_balance(tenantId, 'all', false) as any;
  const investor = get_investor_summary(tenantId);
  const anomalies = get_finance_anomalies(tenantId);
  const financeEntries = get_finance_entries(tenantId).filter((row: any) => inRange(row.created_at, payload.date_from, payload.date_to));
  const inventory = get_inventory_items(tenantId);
  const lowStock = get_low_stock_items(tenantId, 5);
  const kitchenOrders = get_kitchen_orders(tenantId);
  const tables = get_tables(tenantId);
  const customers = getCustomersLocal(tenantId);
  const insights: AiDecisionInsight[] = [];

  const push = (item: AiDecisionInsight) => insights.push(item);
  const revenue = new Decimal(summary.total_revenue || 0);
  const prevRevenue = new Decimal(previousSummary.total_revenue || 0);
  const salesCount = sales.filter((sale: any) => String(sale.status || '').toUpperCase() !== 'VOIDED').length;
  const avgTicket = salesCount ? revenue.div(salesCount) : new Decimal(0);
  const trendPct = prevRevenue.gt(0) ? revenue.minus(prevRevenue).div(prevRevenue).mul(100) : new Decimal(0);
  const activeTables = tables.filter((table: any) => Boolean(table.is_occupied) || ['SEATED', 'ACTIVE_CHECK'].includes(String(table.status || '').toUpperCase()));
  const openChecks = activeTables.filter((table: any) => new Decimal(table.total || 0).gt(0));
  const now = Date.now();
  const delayedKitchen = kitchenOrders.filter((order: any) => {
    const status = String(order.status || '').toUpperCase();
    if (!['NEW', 'SENT', 'PREPARING', 'IN_PREP'].includes(status)) return false;
    const created = new Date(String(order.created_at || '')).getTime();
    return Number.isFinite(created) && now - created > 20 * 60 * 1000;
  });
  const voidCount = Number(summary.void_count || 0);
  const voidRate = salesCount ? new Decimal(voidCount).div(salesCount).mul(100) : new Decimal(0);

  push({
    id: 'manager-daily-pulse',
    phase: 'manager',
    severity: trendPct.lt(-15) ? 'warning' : trendPct.gt(10) ? 'good' : 'info',
    title: 'AI Menecer baxışı',
    body: `Satış ${money(revenue)}, orta çek ${money(avgTicket)}, aktiv masa ${activeTables.length}. Trend ${prevRevenue.gt(0) ? pct(trendPct) : 'müqayisə üçün data azdır'}.`,
    action_label: trendPct.lt(-15) ? 'Satış səbəbini yoxla' : 'Dashboard-da izləməyə davam et',
    module: trendPct.lt(-15) ? 'analytics' : 'dashboard',
    score: trendPct.lt(-15) ? 82 : 45,
    metric: money(revenue),
    evidence: [
      `Açıq check: ${openChecks.length}`,
      `Keçmiş period satış: ${money(prevRevenue)}`,
      `Top məhsul: ${topProducts[0]?.item_name || 'hələ yoxdur'}`,
    ],
  });

  if (delayedKitchen.length > 0) {
    push({
      id: 'anomaly-kitchen-delay',
      phase: 'anomaly',
      severity: 'critical',
      title: 'Mətbəx gecikməsi var',
      body: `${delayedKitchen.length} sifariş 20 dəqiqədən çox aktiv qalır. Müştəri narazılığı və remake riski artır.`,
      action_label: 'Mətbəxi yoxla',
      module: 'tables',
      score: 96,
      metric: `${delayedKitchen.length} sifariş`,
      evidence: delayedKitchen.slice(0, 3).map((order: any) => `${order.table_label || order.table || 'Masa'} · ${order.status || 'aktiv'}`),
    });
  }

  if (voidRate.gt(5) || voidCount >= 3) {
    push({
      id: 'anomaly-void-rate',
      phase: 'anomaly',
      severity: voidRate.gt(10) ? 'critical' : 'warning',
      title: 'VOID / ləğv nisbəti yüksəkdir',
      body: `${voidCount} VOID əməliyyatı var. Bu, səhv sifariş, təlim ehtiyacı və ya sui-istifadə siqnalı ola bilər.`,
      action_label: 'Auditə bax',
      module: 'analytics',
      score: voidRate.gt(10) ? 94 : 78,
      metric: pct(voidRate),
      evidence: [`Satış sayı: ${salesCount}`, `VOID sayı: ${voidCount}`, `VOID nisbəti: ${pct(voidRate)}`],
    });
  }

  const highDiscountStaff = staff
    .map((row: any) => ({
      cashier: row.cashier,
      discount: new Decimal(row.discount_total || 0),
      revenue: new Decimal(row.total_revenue || 0),
    }))
    .filter((row) => row.discount.gt(0) && row.revenue.gt(0) && row.discount.div(row.revenue).mul(100).gt(8))
    .sort((a, b) => b.discount.cmp(a.discount));
  if (highDiscountStaff.length > 0) {
    const first = highDiscountStaff[0];
    push({
      id: 'anomaly-discount-staff',
      phase: 'anomaly',
      severity: 'warning',
      title: 'Endirim davranışı yoxlanmalıdır',
      body: `${first.cashier} üzrə endirim/satış nisbəti normadan yüksək görünür.`,
      action_label: 'Staff performansına bax',
      module: 'analytics',
      score: 76,
      metric: money(first.discount),
      evidence: highDiscountStaff.slice(0, 3).map((row) => `${row.cashier}: ${money(row.discount)} endirim`),
    });
  }

  if (anomalies.has_reconciliation_issue || anomalies.has_shift_cash_mismatch) {
    push({
      id: 'finance-reconciliation-gap',
      phase: 'finance',
      severity: 'critical',
      title: 'Maliyyə uyğunlaşdırma fərqi',
      body: `Kassa/satış/maliyyə yazılışı tərəfində fərq görünür. Bu bağlanmadan gün sonu hesabatına keçmək risklidir.`,
      action_label: 'Maliyyəni aç',
      module: 'finance',
      score: 98,
      metric: money(anomalies.shift_cash_gap || anomalies.reconciliation_gap || 0),
      evidence: [
        `Kassa fərqi: ${money(anomalies.shift_cash_gap || 0)}`,
        `Satış-maliyyə yazılışı fərqi: ${money(anomalies.reconciliation_gap || 0)}`,
      ],
    });
  }

  if (new Decimal(investor.debt_remaining || 0).gt(0) || new Decimal(balances.investor_balance || 0).gt(0)) {
    push({
      id: 'finance-investor-debt',
      phase: 'finance',
      severity: 'warning',
      title: 'Investor borcu izlənməlidir',
      body: `Qalan investor borcu ${money(investor.debt_remaining || balances.investor_balance || 0)} görünür. Ödəniş planı və maliyyə yazılışı uyğunluğu yoxlanmalıdır.`,
      action_label: 'Investor tabına bax',
      module: 'finance',
      score: 74,
      metric: money(investor.debt_remaining || balances.investor_balance || 0),
      evidence: [
        `Maliyyə yazılışı investor balansı: ${money(balances.investor_balance || 0)}`,
        `Hesablanmış borc: ${money(investor.debt_remaining || 0)}`,
      ],
    });
  }

  if (new Decimal(balances.cash_balance || 0).lt(0)) {
    push({
      id: 'finance-negative-cash',
      phase: 'finance',
      severity: 'critical',
      title: 'Nağd kassa mənfidədir',
      body: 'Nağd balans mənfi görünür. Bu, səhv mənbə seçimi, transfer yazılmaması və ya kassa fərqi ola bilər.',
      action_label: 'Kassanı yoxla',
      module: 'finance',
      score: 99,
      metric: money(balances.cash_balance || 0),
      evidence: [`Nağd balans: ${money(balances.cash_balance || 0)}`, `Seyf: ${money(balances.safe_balance || 0)}`],
    });
  }

  const wrongFinanceRows = financeEntries.filter((row: any) => {
    const category = normalizeAiText(row.category);
    const type = String(row.type || '').toLowerCase();
    const looksExpense = ['xammal', 'maas', 'icar', 'kommunal', 'xer', 'cerime'].some((token) => category.includes(token));
    const looksIncome = ['satis', 'medaxil', 'giris', 'investis', 'borc al'].some((token) => category.includes(token));
    return (type === 'in' && looksExpense) || (type === 'out' && looksIncome);
  });
  if (wrongFinanceRows.length > 0) {
    push({
      id: 'finance-category-direction',
      phase: 'finance',
      severity: 'warning',
      title: 'Maliyyə kateqoriyası şübhəlidir',
      body: `${wrongFinanceRows.length} əməliyyatda kateqoriya ilə mədaxil/məxaric istiqaməti uyğun görünmür.`,
      action_label: 'Jurnalı aç',
      module: 'finance',
      score: 81,
      metric: `${wrongFinanceRows.length} sətir`,
      evidence: wrongFinanceRows.slice(0, 3).map((row: any) => `${row.category || '-'} · ${row.type || '-'}`),
    });
  }

  if (lowStock.length > 0) {
    push({
      id: 'inventory-low-stock',
      phase: 'inventory',
      severity: lowStock.length >= 3 ? 'critical' : 'warning',
      title: 'Kritik stok siyahısı var',
      body: `${lowStock.length} xammal minimum limitə çatıb və ya keçib. Satış tempinə görə öncəlik verilməlidir.`,
      action_label: 'Anbara keç',
      module: 'inventory',
      score: lowStock.length >= 3 ? 92 : 78,
      metric: `${lowStock.length} məhsul`,
      evidence: lowStock.slice(0, 4).map((row: any) => `${row.name}: ${row.stock_qty} ${row.unit}`),
    });
  }

  const topProductNames = new Set(topProducts.map((row: any) => normalizeAiText(row.item_name)));
  const inventoryNames = inventory.map((row: any) => normalizeAiText(row.name));
  const missingRecipeSignals = topProducts.filter((row: any) => {
    const normalized = normalizeAiText(row.item_name);
    return normalized && topProductNames.has(normalized) && !inventoryNames.some((name) => normalized.includes(name) || name.includes(normalized));
  });
  if (missingRecipeSignals.length > 0 && inventory.length > 0) {
    push({
      id: 'inventory-recipe-link',
      phase: 'inventory',
      severity: 'opportunity',
      title: 'Top məhsul üçün resept/stok bağlantısını yoxla',
      body: `${missingRecipeSignals[0].item_name} çox satılır, amma anbar bağlantısı aydın görünmür. Resept xərcini yoxlamaq faydalıdır.`,
      action_label: 'Reseptləri yoxla',
      module: 'inventory',
      score: 61,
      metric: `${missingRecipeSignals[0].total_qty} satış`,
      evidence: missingRecipeSignals.slice(0, 3).map((row: any) => `${row.item_name}: ${row.total_qty}`),
    });
  }

  if (avgTicket.gt(0) && avgTicket.lt(8)) {
    push({
      id: 'sales-low-avg-ticket',
      phase: 'sales',
      severity: 'opportunity',
      title: 'Orta çek artırıla bilər',
      body: `Orta çek ${money(avgTicket)} səviyyəsindədir. POS-da combo, əlavə içki və desert təklifi satışa tez təsir edə bilər.`,
      action_label: 'POS təkliflərini qur',
      module: 'ai',
      score: 66,
      metric: money(avgTicket),
      evidence: [
        `Satış sayı: ${salesCount}`,
        `Top məhsul: ${topProducts[0]?.item_name || 'yoxdur'}`,
        `Aktiv müştəri bazası: ${customers.length}`,
      ],
    });
  }

  if (customers.length > 0 && topProducts.length > 0) {
    push({
      id: 'sales-crm-campaign',
      phase: 'sales',
      severity: 'opportunity',
      title: 'CRM kampaniyası üçün hazır siqnal',
      body: `${topProducts[0].item_name} ən aktiv məhsuldur. Müştəri bazasına qısa kampaniya hazırlamaq olar.`,
      action_label: 'Kampaniya yaz',
      module: 'crm',
      score: 58,
      metric: `${customers.length} müştəri`,
      evidence: [`Fokus məhsul: ${topProducts[0].item_name}`, `Müştəri sayı: ${customers.length}`],
    });
  }

  if (insights.length === 1 && !delayedKitchen.length && !lowStock.length && !anomalies.has_reconciliation_issue) {
    push({
      id: 'manager-stable-system',
      phase: 'manager',
      severity: 'good',
      title: 'Sistem stabil görünür',
      body: 'Kritik kassa, mətbəx və stok siqnalı görünmür. Fokus satış artımı və staff performansında qala bilər.',
      action_label: 'Analitikaya bax',
      module: 'analytics',
      score: 30,
      metric: 'Stabil',
      evidence: [`Aktiv masa: ${activeTables.length}`, `Kritik stok: ${lowStock.length}`, `Gecikən mətbəx: ${delayedKitchen.length}`],
    });
  }

  return insights
    .sort((a, b) => (severityRank[b.severity] - severityRank[a.severity]) || b.score - a.score)
    .slice(0, maxItems);
}

export async function analyze_business(payload: { date_from: string; date_to: string; custom_question?: string; tenant_id?: string }) {
  const tenantId = payload.tenant_id || defaultTenant();
  ensureAiKey(tenantId);
  const summary = get_sales_summary(tenantId, payload.date_from, payload.date_to);
  const staff = get_staff_performance(tenantId, payload.date_from, payload.date_to);
  const topProducts = get_product_stats(tenantId, payload.date_from, payload.date_to).slice(0, 3);
  const bestCashier = [...staff].sort((a, b) => new Decimal(b.total_revenue).cmp(new Decimal(a.total_revenue)))[0];
  const grossMargin = new Decimal(summary.total_revenue || 0).gt(0)
    ? new Decimal(summary.gross_profit || 0).div(summary.total_revenue).mul(100)
    : new Decimal(0);

  logEvent('system', 'AI_BUSINESS_ANALYSIS_REQUEST', { tenant_id: tenantId, date_from: payload.date_from, date_to: payload.date_to });

  return [
    `AI Shift Summary`,
    '',
    `Bu periodda satış ${money(summary.total_revenue)}, gross profit ${money(summary.gross_profit)}, gross margin isə ${pct(grossMargin)} olub.`,
    bestCashier ? `Ən güclü kassir: ${bestCashier.cashier} (${money(bestCashier.total_revenue)} / ${bestCashier.sale_count} satış).` : 'Bu periodda kassir performansı üçün kifayət qədər satış yoxdur.',
    topProducts.length ? `Ən çox hərəkət edən məhsullar: ${topProducts.map((row) => `${row.item_name} (${row.total_qty})`).join(', ')}.` : 'Hələ top məhsul məlumatı formalaşmayıb.',
    Number(summary.void_count || 0) > 0 ? `Diqqət: ${summary.void_count} VOID əməliyyatı var, növbə sonunda səbəbləri yoxlamaq lazımdır.` : 'VOID tərəfdə qeyri-adi hərəkət görünmür.',
    payload.custom_question?.trim() ? `Əlavə fokus: ${payload.custom_question.trim()}` : '',
  ].filter(Boolean).join('\n');
}

export async function security_audit(payload: { date_from: string; date_to: string; question?: string; tenant_id?: string }) {
  const tenantId = payload.tenant_id || defaultTenant();
  ensureAiKey(tenantId);
  const sales = get_sales_list(tenantId, payload.date_from, payload.date_to);
  const voided = sales.filter((sale: any) => String(sale.status || '').toUpperCase() === 'VOIDED');
  const bigDiscounts = sales.filter((sale: any) => new Decimal(sale.discount_amount || 0).gt(10));

  logEvent('system', 'AI_SECURITY_AUDIT_REQUEST', { tenant_id: tenantId, date_from: payload.date_from, date_to: payload.date_to });

  return [
    `AI Security Audit`,
    '',
    voided.length > 0
      ? `${voided.length} VOID əməliyyatı tapıldı. Ən azı ilk 3 əməliyyatı səbəb və staff adına görə yoxlayın.`
      : 'VOID tərəfdə qeyri-adi yük görünmür.',
    bigDiscounts.length > 0
      ? `${bigDiscounts.length} yüksək endirimli satış var. Manual override axınını yoxlamaq məsləhətdir.`
      : 'Yüksək endirimli şübhəli satış görünmür.',
    payload.question?.trim() ? `Əlavə fokus: ${payload.question.trim()}` : '',
  ].filter(Boolean).join('\n');
}

export async function inventory_audit(tenant_id: string = defaultTenant()) {
  ensureAiKey(tenant_id);
  const lowStock = get_low_stock_items(tenant_id, 5);
  const productStats = get_product_stats(
    tenant_id,
    new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
    new Date().toISOString(),
  ).slice(0, 5);

  logEvent('system', 'AI_INVENTORY_AUDIT_REQUEST', { tenant_id });

  return [
    `AI Inventory Audit`,
    '',
    lowStock.length
      ? `Kritik stoklar: ${lowStock.map((row) => `${row.name} (${row.stock_qty} ${row.unit})`).join(', ')}.`
      : 'Kritik stok görünmür.',
    productStats.length
      ? `Son 30 günün sürətli hərəkətli məhsulları: ${productStats.map((row) => `${row.item_name} (${row.total_qty})`).join(', ')}.`
      : 'Satış statistikasına əsaslanan hərəkətli məhsul siyahısı hələ boşdur.',
  ].join('\n');
}

export async function generate_shift_summary(payload: { tenant_id?: string; date_from: string; date_to: string; focus?: string }): Promise<AiInsightResult> {
  const tenantId = payload.tenant_id || defaultTenant();
  ensureAiKey(tenantId);
  const summary = get_sales_summary(tenantId, payload.date_from, payload.date_to);
  const staff = get_staff_performance(tenantId, payload.date_from, payload.date_to);
  const topProducts = get_product_stats(tenantId, payload.date_from, payload.date_to).slice(0, 4);
  const sales = get_sales_list(tenantId, payload.date_from, payload.date_to);
  const completedSales = sales.filter((sale: any) => String(sale.status || '').toUpperCase() === 'COMPLETED');
  const avgCheck = completedSales.length
    ? new Decimal(summary.total_revenue || 0).div(completedSales.length)
    : new Decimal(0);
  const bestCashier = [...staff].sort((a, b) => new Decimal(b.total_revenue).cmp(new Decimal(a.total_revenue)))[0];
  const voidCount = Number(summary.void_count || 0);

  const actions = [
    avgCheck.lt(8) ? 'Kassada 1 klik upsell məhsulu əlavə edin və staff-a günün təklifini göstərin.' : 'Orta çek yaxşıdır, premium əlavələr üçün kampaniya overlay-i qoruyun.',
    voidCount > 0 ? 'VOID əməliyyatlarını staff adı ilə yoxlayın və səbəbi standartlaşdırın.' : 'VOID tərəfi sabitdir, diqqəti sürətli saatların kapasitesinə yönəldin.',
    topProducts.length > 0 ? `${topProducts[0].item_name} üçün stok və prep sürətini ayrıca izləyin.` : 'Top məhsul davranışı üçün daha çox satış məlumatı toplayın.',
  ];

  return {
    kind: 'shift',
    title: 'AI Shift Summary',
    summary: `Bu periodda satış ritmi ${money(summary.total_revenue)} gəlir və ${money(summary.gross_profit)} gross profit ilə stabil görünür.`,
    highlights: [
      { label: 'Toplam satış', value: money(summary.total_revenue), tone: 'good' },
      { label: 'Gross profit', value: money(summary.gross_profit), tone: new Decimal(summary.gross_profit || 0).gt(0) ? 'good' : 'warning' },
      { label: 'Orta çek', value: money(avgCheck), tone: avgCheck.gte(8) ? 'good' : 'warning' },
      { label: 'VOID sayı', value: String(voidCount), tone: voidCount > 0 ? 'warning' : 'neutral' },
    ],
    actions,
    narrative: [
      bestCashier
        ? `Növbənin ən güclü kassiri ${bestCashier.cashier}-dır: ${money(bestCashier.total_revenue)} satış, ${bestCashier.sale_count} çek.`
        : 'Bu period üçün staff performans breakdown-ı hələ formalaşmayıb.',
      topProducts.length
        ? `Ən sürətli hərəkət edən məhsullar: ${topProducts.map((row) => `${row.item_name} (${row.total_qty})`).join(', ')}.`
        : 'Top məhsul məlumatı hələ boşdur.',
      payload.focus?.trim() ? `Fokus qeydi: ${payload.focus.trim()}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export async function generate_finance_insight(payload: { tenant_id?: string; date_from: string; date_to: string; focus?: string }): Promise<AiInsightResult> {
  const tenantId = payload.tenant_id || defaultTenant();
  ensureAiKey(tenantId);
  const summary = get_sales_summary(tenantId, payload.date_from, payload.date_to);
  const balances = get_balance(tenantId);
  const investor = get_investor_summary(tenantId);
  const entries = get_finance_entries(tenantId).filter((row) => {
    const current = new Date(String(row.created_at || '')).getTime();
    return current >= new Date(payload.date_from).getTime() && current <= new Date(payload.date_to).getTime();
  });
  const totalExpenses = entries
    .filter((row) => row.type === 'out')
    .reduce((sum, row) => sum.plus(new Decimal(row.amount || 0)), new Decimal(0));
  const totalIncome = entries
    .filter((row) => row.type === 'in')
    .reduce((sum, row) => sum.plus(new Decimal(row.amount || 0)), new Decimal(0));
  const netFlow = totalIncome.minus(totalExpenses);

  return {
    kind: 'finance',
    title: 'AI Finance Insight',
    summary: `Nağd, kart və seyf axını bir yerdə baxanda dövrün xalis pul hərəkəti ${money(netFlow)} görünür.`,
    highlights: [
      { label: 'Nağd balans', value: money(balances.cash_balance), tone: new Decimal(balances.cash_balance || 0).gte(0) ? 'good' : 'warning' },
      { label: 'Kart balans', value: money(balances.card_balance), tone: 'neutral' },
      { label: 'Seyf', value: money(balances.safe_balance), tone: 'neutral' },
      { label: 'İnvestor borcu', value: money(investor.debt_remaining), tone: new Decimal(investor.debt_remaining || 0).gt(0) ? 'warning' : 'good' },
    ],
    actions: [
      new Decimal(balances.cash_balance || 0).lt(50) ? 'Nağd balansı zəifdirsə kartdan kassaya transfer planı qurun.' : 'Nağd balans təhlükəsiz zonadadır.',
      totalExpenses.gt(new Decimal(summary.total_revenue || 0).mul(0.45))
        ? 'Xərc/satış nisbəti yüksəlib. Xammal və maaş kateqoriyalarını ayrıca yoxlayın.'
        : 'Xərc nisbəti nəzarətdədir.',
      new Decimal(investor.debt_remaining || 0).gt(0) ? 'İnvestor borcu üçün aylıq repayment planı çıxarın.' : 'İnvestor borcu görünmür.',
    ],
    narrative: [
      `Dövr üzrə mədaxil ${money(totalIncome)}, məxaric ${money(totalExpenses)}, xalis axın ${money(netFlow)} təşkil edir.`,
      `Satışların gross profit göstəricisi ${money(summary.gross_profit)} səviyyəsindədir.`,
      payload.focus?.trim() ? `Fokus qeydi: ${payload.focus.trim()}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export async function generate_stock_forecast(payload: { tenant_id?: string; date_from: string; date_to: string; focus?: string }): Promise<AiInsightResult> {
  const tenantId = payload.tenant_id || defaultTenant();
  ensureAiKey(tenantId);
  const inventory = get_inventory_items(tenantId);
  const lowStock = get_low_stock_items(tenantId, 5);
  const topProducts = get_product_stats(tenantId, payload.date_from, payload.date_to).slice(0, 5);
  const criticalCoverage = lowStock.slice(0, 4).map((row) => {
    const item = inventory.find((inv: any) => String(inv.name || '').toLowerCase() === String(row.name || '').toLowerCase());
    const minLimit = new Decimal(row.min_limit || 0);
    const stock = new Decimal(item?.stock_qty || row.stock_qty || 0);
    const ratio = minLimit.gt(0) ? stock.div(minLimit) : new Decimal(0);
    return {
      label: row.name,
      value: `${stock.toDecimalPlaces(2).toString()} ${row.unit}`,
      tone: ratio.lte(1) ? 'warning' as const : 'neutral' as const,
    };
  });

  return {
    kind: 'stock',
    title: 'AI Stock Forecast',
    summary: lowStock.length
      ? `Kritik stok siqnalları var. Ən aşağı stoklu məhsullar üçün yaxın mədaxil planı qurmaq lazımdır.`
      : 'Hazırkı stok görünüşü sabitdir, amma top məhsullara görə preventiv sifariş planı saxlamaq məsləhətdir.',
    highlights: criticalCoverage.length > 0 ? criticalCoverage : [
      { label: 'Kritik stok', value: 'Yoxdur', tone: 'good' },
      { label: 'İzlənən məhsul', value: String(topProducts[0]?.item_name || '—'), tone: 'neutral' },
    ],
    actions: [
      lowStock.length ? `Bu gün mədaxil siyahısına ${lowStock.slice(0, 3).map((row) => row.name).join(', ')} əlavə edin.` : 'Kritik stok yoxdur, safety stock limitlərini yenə də saxlayın.',
      topProducts.length ? `${topProducts[0].item_name} üçün resept xərcini və istehlak ritmini ayrıca izləyin.` : 'Satış ritmi formalaşdıqca forecast daha dəqiq olacaq.',
      'Anbar əlavə edəndə minimum limitləri hər məhsul üçün ayrıca təyin edin.',
    ],
    narrative: [
      lowStock.length
        ? `Aşağı stoklar: ${lowStock.map((row) => `${row.name} (${row.stock_qty} ${row.unit})`).join(', ')}.`
        : 'Minimum limitdən aşağı düşən stok görünmür.',
      topProducts.length
        ? `Son dövrün hərəkətli məhsulları: ${topProducts.map((row) => `${row.item_name} (${row.total_qty})`).join(', ')}.`
        : 'Forecast üçün kifayət qədər satış məlumatı hələ azdır.',
      payload.focus?.trim() ? `Fokus qeydi: ${payload.focus.trim()}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export async function generate_campaign_writer(payload: { tenant_id?: string; goal: string; focus?: string }): Promise<AiInsightResult> {
  const tenantId = payload.tenant_id || defaultTenant();
  ensureAiKey(tenantId);
  const customers = getCustomersLocal(tenantId);
  const settings = getSettingsLocal(tenantId);
  const rewardName = String(settings?.customer_app_settings?.reward_name || 'reward');
  const topProducts = get_product_stats(
    tenantId,
    new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
    new Date().toISOString(),
  ).slice(0, 3);
  const primaryProduct = topProducts[0]?.item_name || 'seçilmiş məhsul';
  const loyaltyMode = settings?.customer_app_settings?.program_mode === 'cashback' ? 'cashback' : 'points';
  const subject = loyaltyMode === 'cashback'
    ? `${primaryProduct} ilə cashback kampaniyası`
    : `${primaryProduct} ilə bonus ${rewardName} kampaniyası`;
  const body = loyaltyMode === 'cashback'
    ? `Bu həftə ${primaryProduct} sifarişlərində əlavə cashback qazanın. Kampaniya qısa müddət üçündür və ən aktiv müştərilər üçün güclü geri dönüş verir.`
    : `Bu həftə ${primaryProduct} sifarişlərində əlavə ${rewardName} qazanın. Müştərini geri gətirmək və orta çeki artırmaq üçün ideal qısa kampaniyadır.`;

  return {
    kind: 'campaign',
    title: 'AI CRM Campaign Writer',
    summary: `CRM kampaniyası hazırdır və hazırkı loyalty modelinizə uyğun qurulub.`,
    highlights: [
      { label: 'Müştəri sayı', value: String(customers.length), tone: customers.length > 0 ? 'good' : 'warning' },
      { label: 'Fokus məhsul', value: primaryProduct, tone: 'neutral' },
      { label: 'Loyalty modeli', value: loyaltyMode === 'cashback' ? 'Cashback' : 'Points', tone: 'neutral' },
    ],
    actions: [
      'CRM modulunda bu mətni kampaniya subject/body kimi istifadə edin.',
      'Kampaniyanı 48-72 saatlıq qısa pəncərə ilə göndərin.',
      customers.length < 50 ? 'Müştəri bazası azdır, QR onboarding və kassada join CTA-nı gücləndirin.' : 'Müştəri bazası kifayət qədərdir, seqmentli kampaniya sınaqdan keçirilə bilər.',
    ],
    narrative: [
      `Subject: ${subject}`,
      `Body: ${body}`,
      payload.goal?.trim() ? `Biznes məqsədi: ${payload.goal.trim()}` : '',
      payload.focus?.trim() ? `Əlavə fokus: ${payload.focus.trim()}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export async function generate_campaign_ai(goal: string) {
  const result = await generate_campaign_writer({ goal, tenant_id: defaultTenant() });
  return [result.summary, '', result.narrative, '', lines(result.actions)].join('\n');
}

export function update_api_key(api_key: string) {
  const tenantId = defaultTenant();
  let settingsArr = getDB<Settings>('settings');
  let tenantSettings = settingsArr.find((s) => s.tenant_id === tenantId);

  if (!tenantSettings) {
    tenantSettings = {
      tenant_id: tenantId,
      service_fee_percent: 0,
      ui_visibility: { staff_show_tables: true, manager_show_tables: true, staff_show_kitchen: true },
      time_settings: { shift_start_time: '08:00', shift_end_time: '23:00', utc_offset: 4, timezone: 'Asia/Baku' },
      email_settings: { resend_api_key: '', sender_email: '', recipient_emails: [] },
      bank_commission: { min_amount: 0.10, percent: 1.5 },
      ai_config: { provider: 'unknown', model: 'auto', autodetected: true, ollama_freeapi_enabled: false },
    } as Settings;
    settingsArr.push(tenantSettings);
  }

  tenantSettings.gemini_api_key = api_key;
  setDB('settings', settingsArr);

  logEvent('admin', 'API_KEY_UPDATED', { tenant_id: tenantId });
  return { success: true };
}
