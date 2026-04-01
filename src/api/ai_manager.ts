import { Decimal } from 'decimal.js';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { Settings } from '../types/pos';
import { get_sales_summary, get_product_stats, get_sales_list, get_staff_performance } from './analytics';
import { get_balance, get_finance_entries, get_investor_summary } from './finance';
import { get_inventory_items, get_low_stock_items } from './inventory';
import { getActiveTenantId } from '../lib/tenant';

const defaultTenant = () => getActiveTenantId();

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

export async function analyze_business(payload: { date_from: string; date_to: string; custom_question?: string; tenant_id?: string }) {
  const tenantId = payload.tenant_id || defaultTenant();
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
    } as Settings;
    settingsArr.push(tenantSettings);
  }

  tenantSettings.gemini_api_key = api_key;
  setDB('settings', settingsArr);

  logEvent('admin', 'API_KEY_UPDATED', { tenant_id: tenantId });
  return { success: true };
}
