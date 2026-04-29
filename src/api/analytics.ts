import { Decimal } from 'decimal.js';
import { logEvent } from '../lib/logger';
import { getDB, setDB } from '../lib/db_sim';
import { Sale } from '../types/pos';
import { Refund } from '../types/inventory';
import { create_finance_entry } from './finance';
import { v4 as uuidv4 } from 'uuid';
import { filterTenantRecords } from '../lib/tenant';
import { apiRequest, isBackendEnabled } from './client';

const tenantSalesKey = (tenant_id: string) => `${tenant_id}_sales`;
const tenantRefundsKey = (tenant_id: string) => `${tenant_id}_refunds`;
const tenantFinanceKey = (tenant_id: string) => `${tenant_id}_finance`;
const tenantLoyaltyLedgerKey = (tenant_id: string) => `${tenant_id}_loyalty_ledger`;

const getSalesLocal = (tenant_id: string) => {
  const scoped = getDB<Sale>(tenantSalesKey(tenant_id));
  if (scoped.length > 0) return scoped.filter((s) => s.tenant_id === tenant_id);
  return getDB<Sale>('sales').filter((s) => s.tenant_id === tenant_id);
};

const saveSalesLocal = (tenant_id: string, rows: Sale[]) => {
  const safeRows = (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    tenant_id,
  }));
  const all = getDB<Sale>('sales');
  const kept = all.filter((row) => row.tenant_id !== tenant_id);
  setDB('sales', [...kept, ...safeRows]);
  setDB(tenantSalesKey(tenant_id), safeRows);
};

const getRefundsLocal = (tenant_id: string) => {
  const scoped = getDB<any>(tenantRefundsKey(tenant_id));
  if (scoped.length > 0) return scoped.filter((r) => r.tenant_id === tenant_id);
  return getDB<any>('refunds').filter((r) => r.tenant_id === tenant_id);
};

const saveRefundsLocal = (tenant_id: string, rows: any[]) => {
  const safeRows = (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    tenant_id,
  }));
  const all = getDB<any>('refunds');
  const kept = all.filter((row) => row.tenant_id !== tenant_id);
  setDB('refunds', [...kept, ...safeRows]);
  setDB(tenantRefundsKey(tenant_id), safeRows);
};

const getFinanceLocal = (tenant_id: string) => {
  const scoped = getDB<any>(tenantFinanceKey(tenant_id));
  if (scoped.length > 0) return scoped.filter((f) => !f.is_deleted);
  return getDB<any>('finance').filter((f) => f.tenant_id === tenant_id && !f.is_deleted);
};

const inDateRange = (createdAt: string, date_from: string, date_to: string) => {
  const current = new Date(createdAt).getTime();
  return current >= new Date(date_from).getTime() && current <= new Date(date_to).getTime();
};

export function get_sales_summary(tenant_id: string, date_from: string, date_to: string, cashier_filter?: string) {
  const sales = getSalesLocal(tenant_id).filter(
    (s) => s.status === 'COMPLETED' && inDateRange(s.created_at, date_from, date_to)
  );
  
  let total_revenue = new Decimal(0);
  let cash_sales = new Decimal(0);
  let card_sales = new Decimal(0);
  let total_cogs = new Decimal(0);
  const void_count = getSalesLocal(tenant_id).filter(
    (s) => s.status === 'VOIDED' && inDateRange(s.created_at, date_from, date_to)
  ).length;

  sales.forEach(sale => {
    if (cashier_filter && sale.cashier !== cashier_filter) return;

    total_revenue = total_revenue.plus(new Decimal(sale.total));
    total_cogs = total_cogs.plus(new Decimal(sale.cogs));

    if (sale.payment_method === 'Nəğd') cash_sales = cash_sales.plus(new Decimal(sale.total));
    if (sale.payment_method === 'Kart') card_sales = card_sales.plus(new Decimal(sale.total));
  });

  // Split satışları finance cədvəlindən dəqiqləşdiririk
  const finance = getFinanceLocal(tenant_id).filter((f) => inDateRange(f.created_at, date_from, date_to));
  const splitCash = finance
    .filter((f) => f.type === 'in' && f.category === 'Satış (Nağd)')
    .reduce((acc, f) => acc.plus(new Decimal(f.amount || 0)), new Decimal(0));
  const splitCard = finance
    .filter((f) => f.type === 'in' && f.category === 'Satış (Kart)')
    .reduce((acc, f) => acc.plus(new Decimal(f.amount || 0)), new Decimal(0));

  if (splitCash.greaterThan(0) || splitCard.greaterThan(0)) {
    cash_sales = splitCash;
    card_sales = splitCard;
  }

  const gross_profit = total_revenue.minus(total_cogs);
  const ledger_sales_total = cash_sales.plus(card_sales);
  const reconciliation_gap = total_revenue.minus(ledger_sales_total).toDecimalPlaces(2);

  return {
    total_revenue: total_revenue.toString(),
    cash_sales: cash_sales.toString(),
    card_sales: card_sales.toString(),
    ledger_sales_total: ledger_sales_total.toString(),
    reconciliation_gap: reconciliation_gap.toString(),
    has_reconciliation_issue: reconciliation_gap.abs().greaterThan(new Decimal('0.01')),
    total_cogs: total_cogs.toString(),
    gross_profit: gross_profit.toString(),
    void_count
  };
}

export function get_sales_list(tenant_id: string, date_from: string, date_to: string, cashier?: string) {
  const tenantCustomers = getDB<any>(`${tenant_id}_customers`);
  const sharedCustomers = filterTenantRecords(getDB<any>('customers'), tenant_id);
  const customers = tenantCustomers.length > 0 ? tenantCustomers : sharedCustomers;
  let sales = getSalesLocal(tenant_id).filter((s) => inDateRange(s.created_at, date_from, date_to));
  if (cashier) {
    sales = sales.filter(s => s.cashier === cashier);
  }
  const mapped = sales.map((sale) => {
    const customer = customers.find((c: any) => c.card_id === sale.customer_card_id);
    const items = Array.isArray((sale as any).items) ? (sale as any).items : [];
    return {
      ...sale,
      current_stars: sale.customer_stars_after ?? customer?.stars ?? 0,
      cust_type: sale.customer_type ?? customer?.type ?? 'Normal',
      items_display: items.map((i: any) => `${i.item_name} x${i.qty}`).join(', '),
      order_type: (sale as any).order_type || 'Dine In',
      discount_percent: new Decimal(sale.original_total || 0).greaterThan(0)
        ? new Decimal(sale.discount_amount || 0).div(new Decimal(sale.original_total)).mul(100).toDecimalPlaces(2).toString()
        : '0'
    };
  });
  return mapped.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function get_product_stats(tenant_id: string, date_from: string, date_to: string) {
  const sales = getSalesLocal(tenant_id).filter(
    (s) => s.status === 'COMPLETED' && inDateRange(s.created_at, date_from, date_to)
  );
  const product_counts: Record<string, number> = {};

  sales.forEach((sale: any) => {
    const items = Array.isArray(sale.items) ? sale.items : [];
    items.forEach((item: any) => {
      product_counts[item.item_name] = (product_counts[item.item_name] || 0) + Number(item.qty || 0);
    });
  });

  return Object.entries(product_counts)
    .map(([item_name, total_qty]) => ({ item_name, total_qty }))
    .sort((a, b) => b.total_qty - a.total_qty);
}

export function get_staff_performance(tenant_id: string, date_from: string, date_to: string) {
  const sales = getSalesLocal(tenant_id).filter(
    (s) => s.status === 'COMPLETED' && inDateRange(s.created_at, date_from, date_to)
  );
  const staff_stats: Record<string, { sale_count: number, total_revenue: Decimal; discount_total: Decimal }> = {};

  sales.forEach(sale => {
    if (!staff_stats[sale.cashier]) {
      staff_stats[sale.cashier] = { sale_count: 0, total_revenue: new Decimal(0), discount_total: new Decimal(0) };
    }
    staff_stats[sale.cashier].sale_count += 1;
    staff_stats[sale.cashier].total_revenue = staff_stats[sale.cashier].total_revenue.plus(sale.total);
    staff_stats[sale.cashier].discount_total = staff_stats[sale.cashier].discount_total.plus(sale.discount_amount || 0);
  });

  return Object.keys(staff_stats).map(cashier => ({
    cashier,
    sale_count: staff_stats[cashier].sale_count,
    total_revenue: staff_stats[cashier].total_revenue.toString(),
    avg_check: staff_stats[cashier].sale_count > 0
      ? staff_stats[cashier].total_revenue.div(staff_stats[cashier].sale_count).toDecimalPlaces(2).toString()
      : '0',
    discount_total: staff_stats[cashier].discount_total.toString()
  }));
}

export function create_refund(sale_id: string, refund_type: 'VOID' | 'PARTIAL', refund_amount: Decimal, reason: string, return_to_stock: boolean, performed_by: string) {
  try {
    const allSales = getDB<Sale>('sales');
    const sourceSale = allSales.find((s) => s.id === sale_id);
    if (!sourceSale?.tenant_id) throw new Error('Satış tenant-i tapılmadı.');
    const tenant_id = sourceSale.tenant_id;
    const sales = getSalesLocal(tenant_id);
    const saleIndex = sales.findIndex(s => s.id === sale_id);
    
    if (saleIndex === -1) throw new Error('Satış tapılmadı.');
    
    // Satış statusunu dəyiş
    sales[saleIndex].status = refund_type === 'VOID' ? 'VOIDED' : 'PARTIAL_REFUND';
    saveSalesLocal(tenant_id, sales);

    // Refund loga yaz
    const refunds = getRefundsLocal(tenant_id) as Refund[];
    refunds.push({
      id: uuidv4(),
      sale_id,
      tenant_id,
      refund_type,
      refund_amount,
      reason,
      return_to_stock,
      performed_by,
      created_at: new Date().toISOString()
    });
    saveRefundsLocal(tenant_id, refunds as any[]);

    // Maliyyəyə mənfi yazılır
    create_finance_entry(
      sales[saleIndex].tenant_id,
      'out',
      'Refund / Ləğv',
      refund_amount.toString(),
      sales[saleIndex].payment_method === 'Kart' ? 'card' : 'cash',
      `Ləğv Səbəbi: ${reason}`,
      performed_by
    );

    // Stok geri qaytarılması simulyasiyası
    // if(return_to_stock) {...}

    logEvent(performed_by, 'REFUND_CREATED', { sale_id, amount: refund_amount.toString(), type: refund_type, reason, stock_returned: return_to_stock });
    return true;
  } catch (error: any) {
    throw new Error(`Ləğv (Refund) xətası: ${error.message}`);
  }
}

export function analyze_sales_ai(date_from: string, date_to: string, custom_question: string) {
  return `AI Satış Analizi: Bu ay ən çox "Latte" satılıb. Cümə günləri gəlir artır. Sualınıza cavab olaraq: Bəli, endirim kampaniyaları effektiv olub.`;
}

export function void_sale_with_reason(
  tenant_id: string,
  sale_id: string,
  reason: string,
  actor: string,
  return_to_stock: boolean = true,
) {
  const sales = getSalesLocal(tenant_id);
  const idx = sales.findIndex((s) => s.id === sale_id && s.tenant_id === tenant_id);
  if (idx === -1) throw new Error('Satış tapılmadı');
  const sale: any = sales[idx];
  if (sale.status === 'VOIDED') throw new Error('Satış artıq VOID olunub');

  sale.status = 'VOIDED';
  sales[idx] = sale;
  saveSalesLocal(tenant_id, sales);

  // Refund entry
  const refunds = getRefundsLocal(tenant_id);
  refunds.push({
    id: uuidv4(),
    sale_id,
    tenant_id,
    refund_type: 'VOID',
    refund_amount: sale.total,
    reason,
    created_by: actor,
    created_at: new Date().toISOString(),
  });
  saveRefundsLocal(tenant_id, refunds);

  // Finance reversal
  create_finance_entry(
    tenant_id,
    'out',
    'Refund / Ləğv',
    String(sale.total || '0'),
    sale.payment_method === 'Kart' ? 'card' : 'cash',
    `VOID: ${reason}`,
    actor,
  );

  const customerSettings = (getDB<any>('settings').find((row) => row.tenant_id === tenant_id)?.customer_app_settings) || {};
  const programMode = String(customerSettings.program_mode || 'points').toLowerCase();
  const cashbackPercent = Number(customerSettings.cashback_percent || 0);
  if (sale.customer_card_id && programMode === 'cashback') {
    const ledger = getDB<any>('loyalty_ledger');
    const amount = new Decimal(sale.total || 0).times(cashbackPercent).dividedBy(100).toDecimalPlaces(2);
    if (amount.greaterThan(0)) {
      ledger.push({
        id: uuidv4(),
        tenant_id,
        card_id: sale.customer_card_id,
        unit: 'cashback',
        entry_type: 'reversal',
        amount: amount.negated().toString(),
        source_sale_id: sale_id,
        description: `VOID cashback reverse (${sale_id})`,
        created_at: new Date().toISOString(),
      });
      setDB('loyalty_ledger', ledger);
    }
    if (sale.reward_claim_code) {
      const claims = getDB<any>('reward_claims');
      const claim = claims.find((row: any) => row.tenant_id === tenant_id && row.claim_code === sale.reward_claim_code);
      if (claim) {
        claim.status = 'PENDING';
        claim.redeemed_sale_id = null;
        claim.redeemed_at = null;
        ledger.push({
          id: uuidv4(),
          tenant_id,
          card_id: sale.customer_card_id,
          unit: 'cashback',
          entry_type: 'reversal',
          amount: new Decimal(claim.points_cost || 0).toFixed(2),
          source_sale_id: sale_id,
          description: `VOID reward restore (${claim.claim_code})`,
          created_at: new Date().toISOString(),
        });
        setDB('reward_claims', claims);
        setDB('loyalty_ledger', ledger);
      }
    }
  }

  // Stock return if requested OR sale is test data
  if (return_to_stock || sale.is_test) {
    const inventory = getDB<any>('inventory');
    const recipes = getDB<any>('recipes');
    const items = Array.isArray(sale.items) ? sale.items : [];
    items.forEach((it: any) => {
      const recs = recipes.filter((r: any) => r.menu_item_name === it.item_name && (!r.tenant_id || r.tenant_id === tenant_id));
      recs.forEach((r: any) => {
        const inv = inventory.find((i: any) => i.name === r.ingredient_name && (!i.tenant_id || i.tenant_id === tenant_id));
        if (!inv) return;
        const addQty = new Decimal(r.quantity_required || 0).times(new Decimal(it.qty || 0));
        inv.stock_qty = new Decimal(inv.stock_qty || 0).plus(addQty).toString();
      });
    });
    setDB('inventory', inventory);
    setDB('ingredients', inventory);
  }

  logEvent(actor, 'SALE_VOIDED', { tenant_id, sale_id, reason, return_to_stock, is_test: Boolean(sale.is_test) });
  return { success: true };
}

export function update_sale_amount(
  tenant_id: string,
  sale_id: string,
  new_total: string,
  reason: string,
  actor: string,
  payment_method?: string,
  split_cash?: string,
  split_card?: string,
) {
  const sales = getSalesLocal(tenant_id);
  const idx = sales.findIndex((s) => s.id === sale_id && s.tenant_id === tenant_id);
  if (idx === -1) throw new Error('Satış tapılmadı');
  if (sales[idx].status === 'VOIDED') throw new Error('VOID satış düzəldilə bilməz');

  const oldTotal = new Decimal((sales[idx] as any).total || 0);
  const nextTotal = new Decimal(new_total || 0);
  if (nextTotal.lte(0)) throw new Error('Yeni məbləğ 0-dan böyük olmalıdır');

  const normalizedMethod = String(payment_method || sales[idx].payment_method || '').toLowerCase();
  const nextMethod =
    normalizedMethod.includes('split') ? 'Split' :
    (normalizedMethod.includes('kart') || normalizedMethod.includes('card')) ? 'Kart' :
    normalizedMethod.includes('staff') ? 'Staff' : 'Nəğd';

  (sales[idx] as any).total = nextTotal.toString();
  (sales[idx] as any).payment_method = nextMethod;
  saveSalesLocal(tenant_id, sales);

  const finances = getDB<any>('finance');
  const keptFinance = finances.filter((row: any) => {
    if (String(row?.tenant_id || '') !== tenant_id) return true;
    const description = String(row?.description || '');
    return !description.includes(sale_id);
  });
  setDB('finance', keptFinance);
  const scopedFinance = getDB<any>(`${tenant_id}_finance`).filter((row: any) => {
    const description = String(row?.description || '');
    return !description.includes(sale_id);
  });
  setDB(`${tenant_id}_finance`, scopedFinance);

  const addFinanceRow = (category: string, amount: Decimal, source: 'cash' | 'card') => {
    create_finance_entry(
      tenant_id,
      'in',
      category,
      amount.toFixed(2),
      source,
      `Sale correction ${sale_id}${reason ? `: ${reason}` : ''}`,
      actor,
    );
  };
  if (nextMethod === 'Split') {
    const splitCash = new Decimal(split_cash || 0);
    const splitCard = new Decimal(split_card || 0);
    if (splitCash.gt(0)) addFinanceRow('Satış (Nağd)', splitCash, 'cash');
    if (splitCard.gt(0)) addFinanceRow('Satış (Kart)', splitCard, 'card');
  } else if (nextMethod === 'Kart') {
    addFinanceRow('Satış (Kart)', nextTotal, 'card');
  } else {
    addFinanceRow(nextMethod === 'Staff' ? 'Staff Ödənişi' : 'Satış (Nağd)', nextTotal, 'cash');
  }

  logEvent(actor, 'SALE_EDITED', {
    tenant_id,
    sale_id,
    old_total: oldTotal.toString(),
    new_total: nextTotal.toString(),
    payment_method: nextMethod,
    reason,
  });
  return { success: true };
}

export async function get_sales_summary_live(
  tenant_id: string,
  date_from: string,
  date_to: string,
  cashier_filter?: string,
  options?: { signal?: AbortSignal },
) {
  if (!isBackendEnabled()) return get_sales_summary(tenant_id, date_from, date_to, cashier_filter);
  const qs = new URLSearchParams({ date_from, date_to });
  if (cashier_filter) qs.set('cashier', cashier_filter);
  return apiRequest<any>(`/api/v1/analytics/summary?${qs.toString()}`, { tenantId: null, signal: options?.signal });
}

export async function get_sales_list_live(
  tenant_id: string,
  date_from: string,
  date_to: string,
  cashier?: string,
  options?: { signal?: AbortSignal; limit?: number; offset?: number },
) {
  if (!isBackendEnabled()) return get_sales_list(tenant_id, date_from, date_to, cashier);
  const qs = new URLSearchParams({ date_from, date_to });
  if (cashier) qs.set('cashier', cashier);
  if (options?.limit) qs.set('limit', String(options.limit));
  if (options?.offset) qs.set('offset', String(options.offset));
  return apiRequest<any[]>(`/api/v1/analytics/sales?${qs.toString()}`, { tenantId: null, signal: options?.signal });
}

export async function void_sale_with_reason_live(
  tenant_id: string,
  sale_id: string,
  reason: string,
  actor: string,
  return_to_stock: boolean = true,
) {
  if (!isBackendEnabled()) return void_sale_with_reason(tenant_id, sale_id, reason, actor, return_to_stock);
  return apiRequest<{ success: boolean }>(`/api/v1/analytics/sales/${encodeURIComponent(sale_id)}/void`, {
    method: 'POST',
    tenantId: null,
    body: { reason, return_to_stock },
  });
}

export async function update_sale_amount_live(
  tenant_id: string,
  sale_id: string,
  new_total: string,
  reason: string,
  actor: string,
  payment_method?: string,
  split_cash?: string,
  split_card?: string,
) {
  if (!isBackendEnabled()) return update_sale_amount(tenant_id, sale_id, new_total, reason, actor, payment_method, split_cash, split_card);
  return apiRequest<{ success: boolean }>(`/api/v1/analytics/sales/${encodeURIComponent(sale_id)}/adjust`, {
    method: 'POST',
    tenantId: null,
    body: { new_total, reason, payment_method, split_cash, split_card },
  });
}

export function partial_refund_sale(
  tenant_id: string,
  sale_id: string,
  refund_amount: string,
  reason: string,
  actor: string,
) {
  const sales = getSalesLocal(tenant_id);
  const idx = sales.findIndex((s) => s.id === sale_id && s.tenant_id === tenant_id);
  if (idx === -1) throw new Error('Satış tapılmadı');
  if (sales[idx].status === 'VOIDED') throw new Error('VOID olunmuş satışa partial refund tətbiq edilə bilməz');

  const refund = new Decimal(refund_amount || 0);
  const currentTotal = new Decimal((sales[idx] as any).total || 0);
  if (refund.lte(0)) throw new Error('Refund məbləği 0-dan böyük olmalıdır');
  if (refund.greaterThanOrEqualTo(currentTotal)) throw new Error('Tam refund üçün VOID istifadə edin');

  const sale: any = sales[idx];
  (sales[idx] as any).total = currentTotal.minus(refund).toFixed(2);
  (sales[idx] as any).status = 'PARTIAL_REFUND';
  saveSalesLocal(tenant_id, sales);

  create_finance_entry(
    tenant_id,
    'out',
    'Partial Refund',
    refund.toFixed(2),
    sales[idx].payment_method === 'Kart' ? 'card' : 'cash',
    `PARTIAL REFUND: ${reason}`,
    actor,
  );

  const customerSettings = (getDB<any>('settings').find((row) => row.tenant_id === tenant_id)?.customer_app_settings) || {};
  const programMode = String(customerSettings.program_mode || 'points').toLowerCase();
  const cashbackPercent = Number(customerSettings.cashback_percent || 0);
  if (sale.customer_card_id && programMode === 'cashback') {
    const ledger = getDB<any>('loyalty_ledger');
    const amount = new Decimal(refund_amount || 0).times(cashbackPercent).dividedBy(100).toDecimalPlaces(2);
    if (amount.greaterThan(0)) {
      ledger.push({
        id: uuidv4(),
        tenant_id,
        card_id: sale.customer_card_id,
        unit: 'cashback',
        entry_type: 'reversal',
        amount: amount.negated().toString(),
        source_sale_id: sale_id,
        description: `Partial refund cashback reverse (${sale_id})`,
        created_at: new Date().toISOString(),
      });
      setDB('loyalty_ledger', ledger);
    }
  }
  logEvent(actor, 'SALE_PARTIAL_REFUND', { tenant_id, sale_id, refund_amount: refund.toFixed(2), reason });
  return { success: true, remaining_total: (sales[idx] as any).total };
}

export async function partial_refund_sale_live(
  tenant_id: string,
  sale_id: string,
  refund_amount: string,
  reason: string,
  actor: string,
) {
  if (!isBackendEnabled()) return partial_refund_sale(tenant_id, sale_id, refund_amount, reason, actor);
  return apiRequest<{ success: boolean; remaining_total: string }>(`/api/v1/analytics/sales/${encodeURIComponent(sale_id)}/partial-refund`, {
    method: 'POST',
    tenantId: null,
    body: { refund_amount, reason },
  });
}
