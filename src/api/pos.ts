import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { logEvent } from '../lib/logger';
import { SalePayload, Sale, FinanceEntry, KitchenOrder, OfflineSale } from '../types/pos';
import { get_settings } from './settings';
import { apiRequest, isBackendEnabled } from './client';

import { getDB, setDB } from '../lib/db_sim';
import { getActiveTenantId } from '../lib/tenant';

const isCoffeeLike = (item: { is_coffee?: boolean; category?: string; item_name?: string }) => {
  if (item.is_coffee) return true;
  const category = (item.category || '').toLowerCase();
  const name = (item.item_name || '').toLowerCase();
  return (
    category.includes('kofe') ||
    category.includes('qəhvə') ||
    category.includes('qehve') ||
    category.includes('coffee') ||
    name.includes('kofe') ||
    name.includes('qəhvə') ||
    name.includes('qehve') ||
    name.includes('coffee')
  );
};

// FUNKSIYA: calculate_total
export const calculate_total = (
  cart_items: { price: Decimal; qty: number; is_coffee: boolean; category: string }[],
  customer_type: string = 'Normal',
  manual_discount_percent: number = 0,
  is_eco_cup: boolean = false,
  happy_hour: any = null,
  customer_stars: number | null = null
) => {
  const normalizedType = (customer_type || 'Normal').toLowerCase();
  let raw_total = new Decimal(0);
  let cogs_total = new Decimal(0);

  cart_items.forEach((item) => {
    const item_total = item.price.times(item.qty);
    raw_total = raw_total.plus(item_total);
    // Mock COGS as 30% of price for simulation
    cogs_total = cogs_total.plus(item.price.times(0.3).times(item.qty));
  });

  const manual_discount_rate = new Decimal(manual_discount_percent).dividedBy(100);
  let tier_discount_rate = new Decimal(0);

  // Customer tier discounts are applied only to coffee items
  if (normalizedType === 'golden') tier_discount_rate = new Decimal(0.05);
  else if (normalizedType === 'platinum') tier_discount_rate = new Decimal(0.10);
  else if (normalizedType === 'tələbə' || normalizedType === 'telebe') tier_discount_rate = new Decimal(0.15);
  else if (normalizedType === 'elite' || normalizedType === 'thermos') tier_discount_rate = new Decimal(0.20);
  else if (normalizedType === 'ikram') tier_discount_rate = new Decimal(1); // 100%

  // Eco-cup logic
  const eco_rate = is_eco_cup && customer_type !== 'Ikram' ? new Decimal(0.05) : new Decimal(0);

  // Stamps: each coffee gives 1 stamp. 10 stamps => 1 free coffee.
  const coffee_qty = cart_items.reduce((acc, item) => acc + (isCoffeeLike(item as any) ? item.qty : 0), 0);
  const loyaltyEnabled = customer_stars !== null && customer_stars !== undefined;
  const safeStars = loyaltyEnabled ? Math.max(0, Number(customer_stars) || 0) : 0;
  const free_coffees = loyaltyEnabled ? Math.floor((safeStars + coffee_qty) / 10) : 0;

  const discounted_coffee_units: Decimal[] = [];
  let discounted_subtotal = new Decimal(0);

  cart_items.forEach((item) => {
    const isCoffee = isCoffeeLike(item as any);
    const coffeeRate = Decimal.min(new Decimal(1), manual_discount_rate.plus(tier_discount_rate).plus(eco_rate));
    const nonCoffeeRate = Decimal.min(new Decimal(1), manual_discount_rate.plus(eco_rate));
    const appliedRate = isCoffee ? coffeeRate : nonCoffeeRate;
    const discounted_unit_price = item.price.times(new Decimal(1).minus(appliedRate)).toDecimalPlaces(2);
    discounted_subtotal = discounted_subtotal.plus(discounted_unit_price.times(item.qty));
      if (isCoffee) {
      for (let i = 0; i < item.qty; i += 1) {
        discounted_coffee_units.push(discounted_unit_price);
      }
    }
  });

  discounted_coffee_units.sort((a, b) => a.comparedTo(b));
  const free_discount = discounted_coffee_units
    .slice(0, free_coffees)
    .reduce((acc, price) => acc.plus(price), new Decimal(0));

  const final_total = Decimal.max(new Decimal(0), discounted_subtotal.minus(free_discount)).toDecimalPlaces(2);
  const discount_amount = raw_total.minus(final_total).toDecimalPlaces(2);
  const customer_stars_after = loyaltyEnabled
    ? (coffee_qty > 0 ? (safeStars + coffee_qty) % 10 : safeStars)
    : 0;

  return {
    raw_total,
    final_total,
    discount_amount,
    cogs_total,
    free_coffees,
    customer_stars_after,
    is_ikram: normalizedType === 'ikram'
  };
};

// Staff benefit rule:
// - Daily free limit: 6 AZN
// - Coffee items consume full sale price from benefit pool
// - Non-coffee items consume up to 2 AZN per unit from benefit pool
// - Non-coffee part above 2 AZN/unit is always payable
export const calculate_staff_payable = (
  cart_items: { price: Decimal; qty: number; is_coffee: boolean; category?: string; item_name?: string }[],
  tenant_id: string,
  cashier: string,
) => {
  const cfg = get_settings(tenant_id).staff_benefits || {
    daily_limit_azn: 6,
    allowed_scope: 'all',
    included_categories: [],
    included_items: [],
    item_unit_cap_azn: 6,
  };
  const DAILY_LIMIT = new Decimal(cfg.daily_limit_azn || 0);
  const ITEM_UNIT_BENEFIT_CAP = new Decimal(cfg.item_unit_cap_azn || 0);
  const allowedCategories = new Set((cfg.included_categories || []).map((v) => String(v || '').trim().toLowerCase()).filter(Boolean));
  const allowedItems = new Set((cfg.included_items || []).map((v) => String(v || '').trim().toLowerCase()).filter(Boolean));

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const sales = getDB<Sale>('sales').filter((s) => {
    if (s.tenant_id !== tenant_id) return false;
    if (s.cashier !== cashier) return false;
    if (s.payment_method !== 'Staff') return false;
    const ts = new Date(s.created_at).getTime();
    return ts >= dayStart && ts < dayEnd;
  });

  const usedToday = sales.reduce((acc, s: any) => {
    const used = new Decimal((s.staff_benefit_used ?? '0').toString());
    return acc.plus(used);
  }, new Decimal(0));

  let benefitUsedThisSale = new Decimal(0);
  let nonCoffeeExcess = new Decimal(0);

  cart_items.forEach((item) => {
    const unitPrice = new Decimal(item.price);
    const itemName = String(item.item_name || '').trim().toLowerCase();
    const categoryName = String(item.category || '').trim().toLowerCase();
    const eligible =
      cfg.allowed_scope === 'all' ||
      (cfg.allowed_scope === 'categories' && allowedCategories.has(categoryName)) ||
      (cfg.allowed_scope === 'items' && allowedItems.has(itemName));
    for (let i = 0; i < item.qty; i += 1) {
      if (!eligible) {
        nonCoffeeExcess = nonCoffeeExcess.plus(unitPrice);
      } else {
        const coveredForUnit = Decimal.min(unitPrice, ITEM_UNIT_BENEFIT_CAP);
        benefitUsedThisSale = benefitUsedThisSale.plus(coveredForUnit);
        if (unitPrice.greaterThan(ITEM_UNIT_BENEFIT_CAP)) {
          nonCoffeeExcess = nonCoffeeExcess.plus(unitPrice.minus(ITEM_UNIT_BENEFIT_CAP));
        }
      }
    }
  });

  const remainingBenefit = Decimal.max(new Decimal(0), DAILY_LIMIT.minus(usedToday));
  const coveredByBenefit = Decimal.min(benefitUsedThisSale, remainingBenefit);
  const overflowFromBenefit = Decimal.max(new Decimal(0), benefitUsedThisSale.minus(remainingBenefit));

  const final_due = overflowFromBenefit.plus(nonCoffeeExcess).toDecimalPlaces(2);

  return {
    daily_limit: DAILY_LIMIT,
    used_today: usedToday.toDecimalPlaces(2),
    remaining_before_sale: remainingBenefit.toDecimalPlaces(2),
    benefit_used_this_sale: benefitUsedThisSale.toDecimalPlaces(2),
    covered_by_benefit: coveredByBenefit.toDecimalPlaces(2),
    non_coffee_excess: nonCoffeeExcess.toDecimalPlaces(2),
    remaining_after_sale: Decimal.max(new Decimal(0), remainingBenefit.minus(coveredByBenefit)).toDecimalPlaces(2),
    final_due,
  };
};

// FUNKSIYA: create_sale (Atomic Transaction Simulyasiyası)
export const create_sale = (payload: SalePayload) => {
  try {
    // Loyalty yoxlanışı
    let apply_discount_percent = payload.discount_percent;
    let apply_customer_type = payload.customer_type;
    const customers = getDB<any>(`${payload.tenant_id}_customers`) || [];
  const customer = customers.find((c: any) => c.card_id === payload.customer_card_id);
    
    const current_stars = customer ? Number(customer?.stars || 0) : null;

    if (customer) {
      if (customer.discount_percent && customer.discount_percent > apply_discount_percent) {
        apply_discount_percent = customer.discount_percent;
      }
      apply_customer_type = customer.type;

    }

    let { raw_total, final_total, discount_amount, cogs_total, free_coffees, customer_stars_after } = calculate_total(
      payload.cart_items,
      apply_customer_type,
      apply_discount_percent,
      payload.is_eco_cup,
      null,
      current_stars
    );

    let staffMeta: any = undefined;
    if (payload.payment_method === 'Staff') {
      const staffCalc = calculate_staff_payable(payload.cart_items as any, payload.tenant_id, payload.cashier);
      final_total = staffCalc.final_due;
      discount_amount = raw_total.minus(final_total).toDecimalPlaces(2);
      staffMeta = {
        staff_benefit_used: staffCalc.benefit_used_this_sale.toString(),
        staff_benefit_remaining: staffCalc.remaining_after_sale.toString(),
        staff_non_coffee_excess: staffCalc.non_coffee_excess.toString(),
      };
    }

    const sale_id = uuidv4();
    const now = new Date().toISOString();

    if (payload.reward_claim_code && customer) {
      const claims = (getDB<any>('reward_claims') || []).filter(
        (row) =>
          String(row.tenant_id || '') === payload.tenant_id &&
          row.card_id === customer.card_id &&
          String(row.claim_code || '').toUpperCase() === String(payload.reward_claim_code || '').trim().toUpperCase() &&
          row.status === 'PENDING',
      );
      const claim = claims[0];
      if (!claim) {
        throw new Error('Reward code etibarlı deyil');
      }
      const unitPrices: Decimal[] = [];
      payload.cart_items.forEach((item) => {
        for (let i = 0; i < item.qty; i += 1) {
          unitPrices.push(new Decimal(item.price));
        }
      });
      unitPrices.sort((a, b) => a.comparedTo(b));
      const rewardDiscount = unitPrices[0] || new Decimal(0);
      final_total = Decimal.max(new Decimal(0), final_total.minus(rewardDiscount)).toDecimalPlaces(2);
      discount_amount = raw_total.minus(final_total).toDecimalPlaces(2);
      claim.status = 'REDEEMED';
      claim.redeemed_sale_id = sale_id;
      claim.redeemed_at = now;
      setDB('reward_claims', getDB<any>('reward_claims'));
      customer_stars_after = Math.max(0, Number(customer_stars_after || customer.stars || 0) - Number(claim.points_cost || 0));
    }

    if (customer) {
      customer.stars = customer_stars_after;
      setDB(`${payload.tenant_id}_customers`, customers);
    }
    // Short receipt code/token keep QR payload compact while preserving lookup safety.
    const receipt_code = uuidv4().replace(/-/g, '').slice(0, 10).toUpperCase();
    const receipt_token = uuidv4().replace(/-/g, '').slice(0, 10);

    // Inventory + recipe cogs calculation (non-test)
    if (!payload.is_test) {
      const inventory = getDB<any>('inventory');
      const recipes = getDB<any>('recipes');
      const cupMode = payload.cup_mode || 'paper';
      const skipPackaging = cupMode === 'glass';
      const isPackagingIngredient = (name: string) => /st[əe]kan|stakan|qapaq|kapak|cup|lid/i.test(String(name || ''));

      let computedCogs = new Decimal(0);
      const stockOps: Array<{ inv: any; qty: Decimal }> = [];

      payload.cart_items.forEach((it) => {
        const recs = recipes.filter(
          (r: any) =>
            (!r.tenant_id || r.tenant_id === payload.tenant_id) &&
            String(r.menu_item_name || '').toLowerCase() === String(it.item_name || '').toLowerCase(),
        );

        if (!recs.length) {
          // fallback cogs if no recipe
          computedCogs = computedCogs.plus(new Decimal(it.price).times(0.3).times(it.qty));
          return;
        }

        recs.forEach((r: any) => {
          if (skipPackaging && isPackagingIngredient(r.ingredient_name)) return;
          const inv = inventory.find(
            (x: any) =>
              (!x.tenant_id || x.tenant_id === payload.tenant_id) &&
              String(x.name || '').toLowerCase() === String(r.ingredient_name || '').toLowerCase(),
          );
          if (!inv) return;
          const qtyReq = new Decimal(r.quantity_required || 0).times(it.qty);
          const unitCost = new Decimal(inv.unit_cost || 0);
          computedCogs = computedCogs.plus(qtyReq.times(unitCost));
          stockOps.push({ inv, qty: qtyReq });
        });
      });

      // strict stock check
      stockOps.forEach(({ inv, qty }) => {
        const current = new Decimal(inv.stock_qty || 0);
        if (current.lessThan(qty)) {
          throw new Error(`${inv.name} üçün anbarda kifayət qədər qalıq yoxdur`);
        }
      });

      // apply stock updates
      stockOps.forEach(({ inv, qty }) => {
        inv.stock_qty = new Decimal(inv.stock_qty || 0).minus(qty).toString();
      });
      setDB('inventory', inventory);
      setDB('ingredients', inventory);
      cogs_total = computedCogs.toDecimalPlaces(2);
    }

    const sale: Sale = {
      id: sale_id,
      receipt_code,
      receipt_token,
      tenant_id: payload.tenant_id,
      created_at: now,
      cashier: payload.cashier,
      customer_card_id: payload.customer_card_id,
      customer_type: apply_customer_type,
      reward_claim_code: payload.reward_claim_code || null,
      original_total: raw_total.toString(),
      discount_amount: discount_amount.toString(),
      total: final_total.toString(),
      cogs: cogs_total.toString(),
      payment_method: payload.payment_method,
      order_type: payload.order_type || 'Dine In',
      cup_mode: payload.cup_mode || 'paper',
      items: payload.cart_items,
      customer_stars_after: customer?.stars,
      free_coffees_applied: free_coffees,
      status: 'COMPLETED',
      is_test: payload.is_test
    };

    if (staffMeta) {
      (sale as any).staff_benefit_used = staffMeta.staff_benefit_used;
      (sale as any).staff_benefit_remaining = staffMeta.staff_benefit_remaining;
      (sale as any).staff_non_coffee_excess = staffMeta.staff_non_coffee_excess;
    }

    if (!payload.is_test) {
      // 1. Transaction: Save Sale
      const sales = getDB<Sale>('sales');
      sales.push(sale);
      setDB('sales', sales);

      // 2. Transaction: Save Finance
      const finances = getDB<FinanceEntry>('finance');
      
      if (
        payload.payment_method === 'Split' &&
        payload.split_cash !== null &&
        payload.split_cash !== undefined &&
        payload.split_card !== null &&
        payload.split_card !== undefined
      ) {
        finances.push({
          id: uuidv4(),
          tenant_id: payload.tenant_id,
          sale_id: sale_id,
          type: 'in',
          category: 'Satış (Nağd)',
          amount: payload.split_cash.toString(),
          source: 'cash',
            description: `Satış - Split Nağd (${apply_customer_type || 'Normal'})`,
          created_at: now,
          is_deleted: false
        });
        finances.push({
          id: uuidv4(),
          tenant_id: payload.tenant_id,
          sale_id: sale_id,
          type: 'in',
          category: 'Satış (Kart)',
          amount: payload.split_card.toString(),
          source: 'card',
            description: `Satış - Split Kart (${apply_customer_type || 'Normal'})`,
          created_at: now,
          is_deleted: false
        });
        // Kart əməliyyat komissiyası: 2%
        const splitCardFee = payload.split_card.times(0.02).toDecimalPlaces(2);
        finances.push({
          id: uuidv4(),
          tenant_id: payload.tenant_id,
          sale_id: sale_id,
          type: 'out',
          category: 'Bank Komissiyası',
          amount: splitCardFee.toString(),
          source: 'card',
          description: `Kart Komissiyası (Split)`,
          created_at: now,
          is_deleted: false
        });
      } else {
        if (payload.payment_method === 'Staff') {
          if (final_total.greaterThan(0)) {
            finances.push({
              id: uuidv4(),
              tenant_id: payload.tenant_id,
              sale_id: sale_id,
              type: 'in',
              category: 'Staff Ödənişi',
              amount: final_total.toString(),
              source: 'cash',
              description: 'Staff limitdən artıq ödəniş',
              created_at: now,
              is_deleted: false,
            });
          }
        } else {
          const source = payload.payment_method === 'Kart' ? 'card' : 'cash';
          const category = payload.payment_method === 'Kart' ? 'Satış (Kart)' : 'Satış (Nağd)';
          finances.push({
            id: uuidv4(),
            tenant_id: payload.tenant_id,
            sale_id: sale_id,
            type: 'in',
            category,
            amount: final_total.toString(),
            source,
              description: `Satış - ${payload.payment_method} (${apply_customer_type || 'Normal'})`,
            created_at: now,
            is_deleted: false
          });

          if (payload.payment_method === 'Kart') {
            // Kart əməliyyat komissiyası: 2%
            const fee = final_total.times(0.02).toDecimalPlaces(2);
            finances.push({
              id: uuidv4(),
              tenant_id: payload.tenant_id,
              sale_id: sale_id,
              type: 'out',
              category: 'Bank Komissiyası',
              amount: fee.toString(),
              source: 'card',
              description: 'Kart Satış Komissiyası',
              created_at: now,
              is_deleted: false
            });
          }
        }
      }
      setDB('finance', finances);
    }

      // 3. Transaction: Kitchen Order (Take Away sifarişləri KDS-ə düşmür)
    if ((payload.order_type || 'Dine In') !== 'Take Away') {
      const kitchen_orders = getDB<KitchenOrder>('kitchen_orders');
      kitchen_orders.push({
        id: uuidv4(),
        tenant_id: payload.tenant_id,
        sale_id: sale_id,
        table_label: null,
        order_type: payload.order_type || 'Dine In',
        status: 'NEW',
        priority: 'NORMAL',
        items: payload.cart_items,
        created_at: now
      });
      setDB('kitchen_orders', kitchen_orders);
    }

    // LOG_EVENT
    logEvent(
      payload.cashier,
      'SALE_CREATED',
      {
        sale_id,
        tenant_id: payload.tenant_id,
        total: final_total.toString(),
        payment_method: payload.payment_method,
        items_count: payload.cart_items.reduce((acc, curr) => acc + curr.qty, 0),
        cogs: cogs_total.toString(),
        is_test: payload.is_test
      }
    );

    return {
      sale_id,
      receipt_code,
      receipt_token,
      customer_card_id: payload.customer_card_id,
      customer_stars_after,
      free_coffees,
      success: true,
      totals: {
        raw_total: raw_total.toString(),
        discount_amount: discount_amount.toString(),
        final_total: final_total.toString(),
        free_coffees,
        customer_stars_after,
      }
    };
  } catch (error: any) {
    logEvent(
      payload.cashier,
      'SALE_FAILED',
      { tenant_id: payload.tenant_id, error: error.message }
    );
    throw error;
  }
};

export const get_public_receipt = (sale_ref: string, token: string) => {
  const sales = getDB<Sale>('sales');
  const ref = String(sale_ref || '').trim();
  const activeTenant = getActiveTenantId();
  const sale = sales.find(
    (s: any) =>
      s.tenant_id === activeTenant &&
      (s.id === ref || (s as any).receipt_code === ref),
  );
  if (!sale) return null;
  if (!token || sale.receipt_token !== token) return null;

  return {
    id: sale.id,
    tenant_id: sale.tenant_id,
    created_at: sale.created_at,
    cashier: sale.cashier,
    customer_card_id: sale.customer_card_id || null,
    customer_stars_after: (sale as any).customer_stars_after ?? null,
    free_coffees_applied: (sale as any).free_coffees_applied ?? 0,
    payment_method: sale.payment_method,
    order_type: sale.order_type,
    total: sale.total,
    original_total: sale.original_total,
    discount_amount: sale.discount_amount,
    items: Array.isArray((sale as any).items) ? (sale as any).items : [],
    status: sale.status,
  };
};

export const get_public_receipt_live = async (sale_ref: string, token: string) => {
  if (!isBackendEnabled()) return get_public_receipt(sale_ref, token);
  return apiRequest<any>(`/api/v1/pos/receipt/${encodeURIComponent(sale_ref)}?token=${encodeURIComponent(token || '')}`, {
    auth: false,
    tenantId: null,
  });
};

// FUNKSIYA: get_menu_for_pos
export const get_menu_for_pos = (tenant_id: string) => {
  // Gələcəkdə real DB və Redis Cache 60s
  const items = getDB<any>('menu_items');
  
  // Əgər items boşdursa default menuyu qaytaraq (testing üçün)
  if (items.length === 0) {
    return [
      { id: uuidv4(), item_name: 'Espresso', price: '3.00', category: 'Qəhvə', is_coffee: true, is_active: true, image_url: '' },
      { id: uuidv4(), item_name: 'Cappuccino', price: '4.50', category: 'Qəhvə', is_coffee: true, is_active: true, image_url: '' },
      { id: uuidv4(), item_name: 'Cheesecake', price: '6.00', category: 'Şirniyyat', is_coffee: false, is_active: true, image_url: '' }
    ];
  }
  
  // Yalnız aktiv məhsullar, kateqoriyaya görə sıralanmış
  return items
    .filter(item => item.is_active && (!item.tenant_id || item.tenant_id === tenant_id))
    .sort((a, b) => a.category.localeCompare(b.category));
};

// FUNKSIYA: sync_offline_sales
export const sync_offline_sales = (offline_sales: OfflineSale[]) => {
  let synced_count = 0;
  let failed_count = 0;
  const results: any[] = [];

  for (const os of offline_sales) {
    try {
      // Create sale handles the DB atomicity simulation
      const result = create_sale({ ...os });
      results.push({ offline_id: os.offline_id, sale_id: result.sale_id, status: 'SYNCED' });
      synced_count++;
    } catch (e: any) {
      results.push({ offline_id: os.offline_id, error: e.message, status: 'FAILED' });
      failed_count++;
    }
  }

  if (offline_sales.length > 0) {
    logEvent(
      'SYSTEM',
      'OFFLINE_SALES_SYNCED',
      {
        tenant_id: offline_sales[0].tenant_id,
        synced_count,
        failed_count
      }
    );
  }

  return results;
};
