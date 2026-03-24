import { Decimal } from 'decimal.js';
import { logEvent } from '../lib/logger';
import { getDB, setDB } from '../lib/db_sim';
import { Sale } from '../types/pos';
import { Refund } from '../types/inventory';
import { create_finance_entry } from './finance';
import { v4 as uuidv4 } from 'uuid';
import { filterTenantRecords } from '../lib/tenant';

const inDateRange = (createdAt: string, date_from: string, date_to: string) => {
  const current = new Date(createdAt).getTime();
  return current >= new Date(date_from).getTime() && current <= new Date(date_to).getTime();
};

export function get_sales_summary(tenant_id: string, date_from: string, date_to: string, cashier_filter?: string) {
  const sales = getDB<Sale>('sales').filter(
    (s) => s.tenant_id === tenant_id && s.status === 'COMPLETED' && inDateRange(s.created_at, date_from, date_to)
  );
  
  let total_revenue = new Decimal(0);
  let cash_sales = new Decimal(0);
  let card_sales = new Decimal(0);
  let total_cogs = new Decimal(0);
  const void_count = getDB<Sale>('sales').filter(
    (s) => s.tenant_id === tenant_id && s.status === 'VOIDED' && inDateRange(s.created_at, date_from, date_to)
  ).length;

  sales.forEach(sale => {
    if (cashier_filter && sale.cashier !== cashier_filter) return;

    total_revenue = total_revenue.plus(new Decimal(sale.total));
    total_cogs = total_cogs.plus(new Decimal(sale.cogs));

    if (sale.payment_method === 'Nəğd') cash_sales = cash_sales.plus(new Decimal(sale.total));
    if (sale.payment_method === 'Kart') card_sales = card_sales.plus(new Decimal(sale.total));
  });

  // Split satışları finance cədvəlindən dəqiqləşdiririk
  const finance = getDB<any>('finance').filter(
    (f) => f.tenant_id === tenant_id && !f.is_deleted && inDateRange(f.created_at, date_from, date_to)
  );
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

  return {
    total_revenue: total_revenue.toString(),
    cash_sales: cash_sales.toString(),
    card_sales: card_sales.toString(),
    total_cogs: total_cogs.toString(),
    gross_profit: gross_profit.toString(),
    void_count
  };
}

export function get_sales_list(tenant_id: string, date_from: string, date_to: string, cashier?: string) {
  const tenantCustomers = getDB<any>(`${tenant_id}_customers`);
  const sharedCustomers = filterTenantRecords(getDB<any>('customers'), tenant_id);
  const customers = tenantCustomers.length > 0 ? tenantCustomers : sharedCustomers;
  let sales = getDB<Sale>('sales').filter(
    (s) => s.tenant_id === tenant_id && inDateRange(s.created_at, date_from, date_to)
  );
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
  const sales = getDB<Sale>('sales').filter(
    (s) => s.tenant_id === tenant_id && s.status === 'COMPLETED' && inDateRange(s.created_at, date_from, date_to)
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
  const sales = getDB<Sale>('sales').filter(
    (s) => s.tenant_id === tenant_id && s.status === 'COMPLETED' && inDateRange(s.created_at, date_from, date_to)
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
    const sales = getDB<Sale>('sales');
    const saleIndex = sales.findIndex(s => s.id === sale_id);
    
    if (saleIndex === -1) throw new Error('Satış tapılmadı.');
    
    // Satış statusunu dəyiş
    sales[saleIndex].status = refund_type === 'VOID' ? 'VOIDED' : 'PARTIAL_REFUND';
    setDB('sales', sales);

    // Refund loga yaz
    const refunds = getDB<Refund>('refunds');
    refunds.push({
      id: uuidv4(),
      sale_id,
      refund_type,
      refund_amount,
      reason,
      return_to_stock,
      performed_by,
      created_at: new Date().toISOString()
    });
    setDB('refunds', refunds);

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
  const sales = getDB<Sale>('sales');
  const idx = sales.findIndex((s) => s.id === sale_id && s.tenant_id === tenant_id);
  if (idx === -1) throw new Error('Satış tapılmadı');
  const sale: any = sales[idx];
  if (sale.status === 'VOIDED') throw new Error('Satış artıq VOID olunub');

  sale.status = 'VOIDED';
  sales[idx] = sale;
  setDB('sales', sales);

  // Refund entry
  const refunds = getDB<any>('refunds');
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
  setDB('refunds', refunds);

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
) {
  const sales = getDB<Sale>('sales');
  const idx = sales.findIndex((s) => s.id === sale_id && s.tenant_id === tenant_id);
  if (idx === -1) throw new Error('Satış tapılmadı');
  if (sales[idx].status === 'VOIDED') throw new Error('VOID satış düzəldilə bilməz');

  const oldTotal = new Decimal((sales[idx] as any).total || 0);
  const nextTotal = new Decimal(new_total || 0);
  if (nextTotal.lte(0)) throw new Error('Yeni məbləğ 0-dan böyük olmalıdır');

  (sales[idx] as any).total = nextTotal.toString();
  setDB('sales', sales);

  logEvent(actor, 'SALE_EDITED', {
    tenant_id,
    sale_id,
    old_total: oldTotal.toString(),
    new_total: nextTotal.toString(),
    reason,
  });
  return { success: true };
}