import { Decimal } from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { logEvent } from '../lib/logger';
import { FinanceEntry } from '../types/pos';
import { apiRequest, isBackendEnabled } from './client';

import { getDB, setDB } from '../lib/db_sim';

export const FINANCE_CATEGORY_DEFS = {
  founder_investment: 'Təsisçi İnvestisiyası',
  borrowed_funds_in: 'Borc Alındı',
  other_income: 'Digər Giriş',
  raw_material: 'Xammal',
  utilities: 'Kommunal',
  payroll: 'Maaş',
  rent: 'İcarə',
  penalty: 'Cərimə',
  other_expense: 'Digər Xərc',
  internal_transfer: 'Daxili Transfer',
  bank_commission: 'Bank Komissiyası',
  investor_liability_reduction: 'İnvestor Borcu Azaldılması',
  investor_repayment: 'İnvestora Geri Ödəniş',
  borrowed_to_cash_mirror: 'Borcdan Kassaya Daxilolma',
  investor_liability: 'İnvestor Borcu',
} as const;

type FinanceCategoryCode = keyof typeof FINANCE_CATEGORY_DEFS;

const tenantFinanceKey = (tenant_id: string) => `${tenant_id}_finance`;

const getFinanceLocal = (tenant_id: string): FinanceEntry[] => {
  const scoped = getDB<FinanceEntry>(tenantFinanceKey(tenant_id));
  if (scoped.length > 0) return scoped.filter((f) => !f.is_deleted);
  return getDB<FinanceEntry>('finance').filter((f) => f.tenant_id === tenant_id && !f.is_deleted);
};

const saveFinanceLocal = (tenant_id: string, rows: FinanceEntry[]) => {
  const safeRows = (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    tenant_id,
  }));
  const all = getDB<FinanceEntry>('finance');
  const kept = all.filter((f) => f.tenant_id !== tenant_id);
  setDB('finance', [...kept, ...safeRows]);
  setDB(tenantFinanceKey(tenant_id), safeRows);
};

const pushFinanceLocalEntries = (tenant_id: string, rows: FinanceEntry[]) => {
  const current = getFinanceLocal(tenant_id);
  saveFinanceLocal(tenant_id, [...current, ...(Array.isArray(rows) ? rows : [])]);
};

const mergeFinanceLocalWithServer = (tenant_id: string, serverRows: FinanceEntry[]) => {
  const merged = new Map<string, FinanceEntry>();
  for (const row of serverRows || []) {
    merged.set(String(row.id), row);
  }
  for (const local of getFinanceLocal(tenant_id)) {
    const key = String(local.id || '');
    if (!key) continue;
    if (!merged.has(key)) merged.set(key, local);
  }
  return Array.from(merged.values());
};

export const get_finance_entries = (tenant_id: string) => {
  return getFinanceLocal(tenant_id);
};

const normalizeText = (value: string) =>
  (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Azerbaijani/Russian letter normalization for stable matching.
    .replace(/[əƏ]/g, 'e')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[üÜ]/g, 'u')
    .replace(/[çÇ]/g, 'c')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export const financeCategoryCodeFromValue = (value: string): FinanceCategoryCode | null => {
  const normalizedValue = normalizeText(value || '').replace(/_/g, ' ');
  const defs = Object.entries(FINANCE_CATEGORY_DEFS) as Array<[FinanceCategoryCode, string]>;
  for (const [code, label] of defs) {
    if (normalizeText(code).replace(/_/g, ' ') === normalizedValue) return code;
    if (normalizeText(label) === normalizedValue) return code;
  }
  if (normalizedValue.includes('tesisci') && normalizedValue.includes('investis')) return 'founder_investment';
  if (normalizedValue.includes('borc alindi')) return 'borrowed_funds_in';
  if (normalizedValue.includes('investor borcu azaldilmasi')) return 'investor_liability_reduction';
  if (normalizedValue.includes('investora geri odenis')) return 'investor_repayment';
  if (normalizedValue.includes('daxili transfer')) return 'internal_transfer';
  if (normalizedValue.includes('bank komissiyasi')) return 'bank_commission';
  if (normalizedValue.includes('borcdan kassaya daxilolma')) return 'borrowed_to_cash_mirror';
  if (normalizedValue.includes('investor borcu')) return 'investor_liability';
  return null;
};

export const financeCategoryLabelFromValue = (value: string): string => {
  const code = financeCategoryCodeFromValue(value);
  return code ? FINANCE_CATEGORY_DEFS[code] : value;
};

const isFounderInvestmentCategory = (category: string) => {
  return financeCategoryCodeFromValue(category) === 'founder_investment';
};

const INCOME_CATEGORIES = new Set([
  normalizeText(FINANCE_CATEGORY_DEFS.founder_investment),
  normalizeText(FINANCE_CATEGORY_DEFS.borrowed_funds_in),
  normalizeText(FINANCE_CATEGORY_DEFS.other_income),
  normalizeText('Kassa Açılışı'),
  normalizeText('Satış (Nağd)'),
  normalizeText('Satış (Kart)'),
]);

const EXPENSE_CATEGORIES = new Set([
  normalizeText(FINANCE_CATEGORY_DEFS.raw_material),
  normalizeText(FINANCE_CATEGORY_DEFS.utilities),
  normalizeText(FINANCE_CATEGORY_DEFS.payroll),
  normalizeText(FINANCE_CATEGORY_DEFS.rent),
  normalizeText(FINANCE_CATEGORY_DEFS.penalty),
  normalizeText(FINANCE_CATEGORY_DEFS.other_expense),
  normalizeText(FINANCE_CATEGORY_DEFS.investor_repayment),
  normalizeText(FINANCE_CATEGORY_DEFS.investor_liability_reduction),
]);

const validateFinanceEntryMatrix = (
  type: 'in' | 'out',
  category: string,
  source: 'cash' | 'card' | 'debt' | 'investor' | 'safe',
) => {
  const normalizedCategory = normalizeText(category);
  const looksIncome = INCOME_CATEGORIES.has(normalizedCategory) || isFounderInvestmentCategory(category);
  const looksExpense = EXPENSE_CATEGORIES.has(normalizedCategory);

  if (type === 'in' && looksExpense) {
    throw new Error('Bu kateqoriya məxaric üçündür. Növü "Məxaric" edin.');
  }
  if (type === 'out' && looksIncome) {
    throw new Error('Bu kateqoriya mədaxil üçündür. Növü "Mədaxil" edin.');
  }

  if (type === 'out' && source === 'debt') {
    throw new Error('Nisyə/Borc mənbəsindən birbaşa məxaric olmaz. Əvvəl kassaya vəsait köçürün.');
  }
  if (source === 'investor') {
    throw new Error('İnvestor wallet yalnız xüsusi investor axınları ilə dəyişdirilə bilər.');
  }
};

export const get_investor_summary = (tenant_id: string) => {
  const finances = get_finance_entries(tenant_id);
  const founder_invested_total = finances.reduce((sum, entry) => {
    if (entry.type === 'in' && isFounderInvestmentCategory(entry.category)) {
      return sum.plus(new Decimal(entry.amount || 0));
    }
    return sum;
  }, new Decimal(0));

  const investor_ledger_in_total = finances.reduce((sum, entry) => {
    const normalizedCategory = normalizeText(entry.category || '');
    const isInvestorDebtMirror =
      normalizedCategory === normalizeText('İnvestor Borcu') ||
      normalizedCategory === normalizeText('Investor Liability') ||
      normalizedCategory === normalizeText('Долг инвестору');
    if (entry.type === 'in' && isInvestorDebtMirror && normalizeSource(entry.source || '') === 'investor') {
      return sum.plus(new Decimal(entry.amount || 0));
    }
    return sum;
  }, new Decimal(0));

  // Prefer explicit founder-investment entries. If backup/import missed those rows,
  // fallback to investor liability mirror rows so debt card does not stay zero.
  const invested_total = founder_invested_total.gt(0) ? founder_invested_total : investor_ledger_in_total;

  // Track explicit investor repayment actions for reporting.
  const repaid_total = finances.reduce((sum, entry) => {
    const normalizedCategory = normalizeText(entry.category || '');
    // IMPORTANT:
    // We only reduce investor debt on liability-ledger entries.
    // Cash/card/safe out row is the payment movement itself and must not
    // be counted again, otherwise debt gets reduced 2x.
    const isLiabilityReduction =
      normalizedCategory === normalizeText('İnvestor Borcu Azaldılması') ||
      normalizedCategory === normalizeText('Investor Liability Reduction') ||
      normalizedCategory === normalizeText('Долг инвестору уменьшен');

    if (entry.type === 'out' && isLiabilityReduction && normalizeSource(entry.source || '') === 'investor') {
      return sum.plus(new Decimal(entry.amount || 0));
    }
    return sum;
  }, new Decimal(0));

  const investor_balance = finances.reduce((sum, entry) => {
    if (normalizeSource(entry.source || '') !== 'investor') return sum;
    const amount = new Decimal(entry.amount || 0);
    return entry.type === 'in' ? sum.plus(amount) : sum.minus(amount);
  }, new Decimal(0));
  const debt_remaining = Decimal.max(new Decimal(0), investor_balance);

  return {
    invested_total: invested_total.toString(),
    repaid_total: repaid_total.toString(),
    debt_remaining: debt_remaining.toString(),
  };
};

const normalizeSource = (source: string) => {
  if (source === 'Kassa') return 'cash';
  if (source === 'Bank Kartı') return 'card';
  if (source === 'Nisyə / Borc') return 'debt';
  if (source === 'Seyf' || source === 'safe') return 'safe';
  if (source === 'Investor' || source === 'investor' || source === 'İnvestor') return 'investor';
  return source as 'cash' | 'card' | 'debt' | 'investor' | 'safe';
};

// FUNKSIYA: get_balance
export const get_balance = (tenant_id: string, view_mode?: string, is_test_active: boolean = false) => {
  const finances = getFinanceLocal(tenant_id);
  
  let cash_balance = new Decimal(0);
  let card_balance = new Decimal(0);
  let debt_balance = new Decimal(0);
  let investor_balance = new Decimal(0);
  let safe_balance = new Decimal(0);
  let deposit_balance = new Decimal(0);

  finances.forEach(f => {
    const amount = new Decimal(f.amount);
    const source = normalizeSource(f.source);
    if (source === 'cash') cash_balance = f.type === 'in' ? cash_balance.plus(amount) : cash_balance.minus(amount);
    if (source === 'card') card_balance = f.type === 'in' ? card_balance.plus(amount) : card_balance.minus(amount);
    if (source === 'debt') debt_balance = f.type === 'in' ? debt_balance.plus(amount) : debt_balance.minus(amount);
    if (source === 'investor') investor_balance = f.type === 'in' ? investor_balance.plus(amount) : investor_balance.minus(amount);
    if (source === 'safe') safe_balance = f.type === 'in' ? safe_balance.plus(amount) : safe_balance.minus(amount);
    if (source === 'deposit') deposit_balance = f.type === 'in' ? deposit_balance.plus(amount) : deposit_balance.minus(amount);
  });

  return {
    cash_balance: cash_balance.toString(),
    card_balance: card_balance.toString(),
    debt_balance: debt_balance.toString(),
    investor_balance: investor_balance.toString(),
    safe_balance: safe_balance.toString(),
    deposit_balance: deposit_balance.toString(),
  };
};

// FUNKSIYA: open_cash_register
export const open_cash_register = (amount: string, opened_by: string, tenant_id: string) => {
  const finances = getFinanceLocal(tenant_id);
  
  finances.push({
    id: uuidv4(),
    tenant_id,
    type: 'in',
    category: 'Kassa Açılışı',
    amount: new Decimal(amount).toString(),
    source: 'cash',
    description: 'Günlük Kassa Açılışı',
    created_at: new Date().toISOString(),
    is_deleted: false
  });
  saveFinanceLocal(tenant_id, finances);

  logEvent(opened_by, 'CASH_REGISTER_OPENED', { tenant_id, amount });
  return { success: true };
};

// FUNKSIYA: create_finance_entry
export const create_finance_entry = (
  tenant_id: string,
  type: 'in' | 'out',
  category: string,
  amount: string,
  source: 'cash' | 'card' | 'debt' | 'investor' | 'safe',
  description: string,
  created_by: string,
  include_bank_commission?: boolean
) => {
  const finances = getFinanceLocal(tenant_id);
  const amountDec = new Decimal(amount);
  const now = new Date().toISOString();
  const categoryLabel = financeCategoryLabelFromValue(category);

  validateFinanceEntryMatrix(type, categoryLabel, source);

  let commission = new Decimal(0);
  if (type === 'out' && source === 'card' && include_bank_commission) {
    if (tenant_id === '6e2c0d4c-6fab-4e49-8f9d-2d675457c655') {
      if (amountDec.lessThanOrEqualTo(100)) {
        commission = new Decimal('0.60');
      } else {
        commission = amountDec.mul('0.005').toDecimalPlaces(2);
      }
    } else {
      commission = amountDec.mul('0.005').toDecimalPlaces(2);
    }
  }

  if (type === 'out') {
    const balance = get_balance(tenant_id, 'all', false) as any;
    const sourceBalanceMap: Record<string, Decimal> = {
      cash: new Decimal(balance.cash_balance || 0),
      card: new Decimal(balance.card_balance || 0),
      debt: new Decimal(balance.debt_balance || 0),
      investor: new Decimal(balance.investor_balance || 0),
      safe: new Decimal(balance.safe_balance || 0),
    };
    const available = sourceBalanceMap[source] || new Decimal(0);
    if (available.lessThan(amountDec.plus(commission))) {
      throw new Error('Balans kifayət etmir. Mənfi saldo əməliyyatı qadağandır.');
    }
  }
  
  const entry: FinanceEntry = {
    id: uuidv4(),
    tenant_id,
    type,
    category: categoryLabel,
    amount: amountDec.toString(),
    source,
    description,
    created_at: now,
    is_deleted: false
  };

  finances.push(entry);

  if (commission.gt(0)) {
    finances.push({
      id: uuidv4(),
      tenant_id,
      type: 'out',
      category: 'Bank Komissiyası',
      amount: commission.toString(),
      source: 'card',
      description: `Komissiya: Xərc ödənişi (${amount} AZN)`,
      created_at: now,
      is_deleted: false,
    });
  }

  // Borrowed money coming IN from debt should be reflected in cash wallet too,
  // so operators can spend it from cash without losing traceability.
  if (type === 'in' && source === 'debt') {
    finances.push({
      id: uuidv4(),
      tenant_id,
      type: 'in',
      category: 'Borcdan Kassaya Daxilolma',
      amount: amountDec.toString(),
      source: 'cash',
      description: `Auto mirror: ${description || category}`,
      created_at: now,
      is_deleted: false,
    });
  }

  // Investor cash injection: if investor adds money directly to cash,
  // keep a separate investor liability record so debt is trackable.
  if (
    type === 'in' &&
    source === 'cash' &&
    isFounderInvestmentCategory(categoryLabel)
  ) {
    finances.push({
      id: uuidv4(),
      tenant_id,
      type: 'in',
      category: 'İnvestor Borcu',
      amount: amountDec.toString(),
      source: 'investor',
      description: `Auto liability mirror: ${description || categoryLabel}`,
      created_at: now,
      is_deleted: false,
    });
  }

  saveFinanceLocal(tenant_id, finances);

  logEvent(created_by, 'FINANCE_ENTRY_CREATED', { tenant_id, type, category, amount, source });
  return entry;
};

// FUNKSIYA: transfer_funds
export const transfer_funds = (
  tenant_id: string,
  direction:
    | 'card_to_cash'
    | 'cash_to_card'
    | 'cash_to_debt'
    | 'card_to_debt'
    | 'cash_to_safe'
    | 'safe_to_cash',
  amount: string,
  commission: string,
  transferred_by: string
) => {
  const finances = getFinanceLocal(tenant_id);
  const now = new Date().toISOString();
  const transfer_amount = new Decimal(amount);
  let comm_amount = new Decimal(commission || '0');
  const settings = get_settings(tenant_id);
  const cardTransferPercent = new Decimal(
    (settings.bank_commission as any)?.card_transfer_percent ?? 0.5,
  );

  if ((direction === 'card_to_cash' || direction === 'card_to_debt') && comm_amount.lte(0)) {
    comm_amount = transfer_amount.times(cardTransferPercent.div(100)).toDecimalPlaces(2);
  }

  const sources = {
    'card_to_cash': { from: 'card', to: 'cash' },
    'cash_to_card': { from: 'cash', to: 'card' },
    'cash_to_debt': { from: 'cash', to: 'debt' },
    'card_to_debt': { from: 'card', to: 'debt' },
    'cash_to_safe': { from: 'cash', to: 'safe' },
    'safe_to_cash': { from: 'safe', to: 'cash' },
  };
  const { from, to } = sources[direction];

  const balance = get_balance(tenant_id, 'all', false) as any;
  const sourceBalanceMap: Record<string, Decimal> = {
    cash: new Decimal(balance.cash_balance || 0),
    card: new Decimal(balance.card_balance || 0),
    debt: new Decimal(balance.debt_balance || 0),
    investor: new Decimal(balance.investor_balance || 0),
    safe: new Decimal(balance.safe_balance || 0),
  };
  const needed = transfer_amount.plus(comm_amount);
  const available = sourceBalanceMap[from] || new Decimal(0);
  if (available.lessThan(needed)) {
    throw new Error('Transfer üçün balans kifayət etmir. Mənfi saldo qadağandır.');
  }

  // Atomik olaraq 2 fərqli əməliyyat (out və in) yazırıq
  finances.push({
    id: uuidv4(), tenant_id, type: 'out', category: 'Daxili Transfer Çıxış',
    amount: transfer_amount.toString(), source: from as any,
    description: `Transfer: ${direction}`, created_at: now, is_deleted: false
  });

  finances.push({
    id: uuidv4(), tenant_id, type: 'in', category: 'Daxili Transfer Giriş',
    amount: transfer_amount.toString(), source: to as any,
    description: `Transfer: ${direction}`, created_at: now, is_deleted: false
  });

  if (comm_amount.greaterThan(0)) {
    finances.push({
      id: uuidv4(), tenant_id, type: 'out', category: 'Bank Komissiyası',
      amount: comm_amount.toString(), source: from as any,
      description: `Transfer Komissiyası`, created_at: now, is_deleted: false
    });
  }

  saveFinanceLocal(tenant_id, finances);
  logEvent(transferred_by, 'FINANCE_TRANSFER', { tenant_id, direction, amount, commission });
  return { success: true, applied_commission: comm_amount.toString() };
};

export const repay_investor = (
  tenant_id: string,
  amount: string,
  pay_from: 'cash' | 'card' | 'safe',
  created_by: string,
  description?: string,
) => {
  const amountDec = new Decimal(amount || '0');
  if (amountDec.lte(0)) throw new Error('Məbləğ düzgün deyil');

  const balances = get_balance(tenant_id, 'all', false) as any;
  const availableMap: Record<string, Decimal> = {
    cash: new Decimal(balances.cash_balance || 0),
    card: new Decimal(balances.card_balance || 0),
    safe: new Decimal(balances.safe_balance || 0),
  };
  const available = availableMap[pay_from] || new Decimal(0);
  if (available.lt(amountDec)) {
    throw new Error('Seçilən mənbədə kifayət qədər vəsait yoxdur');
  }

  const summary = get_investor_summary(tenant_id);
  const debt = new Decimal(summary.debt_remaining || 0);
  if (debt.lte(0)) {
    throw new Error('İnvestora borc yoxdur');
  }

  const payable = Decimal.min(amountDec, debt);
  const now = new Date().toISOString();
  const entries = getFinanceLocal(tenant_id);

  // 1) money leaves selected wallet
  entries.push({
    id: uuidv4(),
    tenant_id,
    type: 'out',
    category: 'İnvestora Geri Ödəniş',
    amount: payable.toString(),
    source: pay_from,
    description: description || 'İnvestora ödəniş',
    created_at: now,
    is_deleted: false,
  });

  // 2) liability decreases in investor ledger
  entries.push({
    id: uuidv4(),
    tenant_id,
    type: 'out',
    category: 'İnvestor Borcu Azaldılması',
    amount: payable.toString(),
    source: 'investor',
    description: `Liability reduced via ${pay_from}`,
    created_at: now,
    is_deleted: false,
  });

  saveFinanceLocal(tenant_id, entries);
  logEvent(created_by, 'INVESTOR_REPAYMENT', {
    tenant_id,
    amount: payable.toString(),
    pay_from,
    description: description || '',
  });

  return {
    success: true,
    paid: payable.toString(),
    remaining_debt: get_investor_summary(tenant_id).debt_remaining,
  };
};

export const repay_investor_async = async (
  tenant_id: string,
  amount: string,
  pay_from: 'cash' | 'card' | 'safe',
  created_by: string,
  description?: string,
) => {
  if (!isBackendEnabled()) {
    return repay_investor(tenant_id, amount, pay_from, created_by, description);
  }

  const amountDec = new Decimal(amount || '0');
  if (amountDec.lte(0)) throw new Error('Məbləğ düzgün deyil');

  const res = await apiRequest<any>('/api/v1/finance/repay-investor', {
    method: 'POST',
    tenantId: tenant_id,
    body: {
      amount: amountDec.toString(),
      pay_from,
      description: description || 'İnvestora ödəniş',
    },
  });

  const now = new Date().toISOString();
  const paid = new Decimal(String(res?.paid ?? amountDec.toString()));
  pushFinanceLocalEntries(tenant_id, [
    {
      id: String(res?.payment_entry_id || uuidv4()),
      tenant_id,
      type: 'out',
      category: 'İnvestora Geri Ödəniş',
      amount: paid.toString(),
      source: pay_from,
      description: description || 'İnvestora ödəniş',
      created_at: now,
      is_deleted: false,
    },
    {
      id: String(res?.liability_entry_id || uuidv4()),
      tenant_id,
      type: 'out',
      category: 'İnvestor Borcu Azaldılması',
      amount: paid.toString(),
      source: 'investor',
      description: `Liability reduced via ${pay_from}`,
      created_at: now,
      is_deleted: false,
    },
  ]);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finance-updated', { detail: { tenant_id, repayment: true, amount: paid.toString() } }));
  }

  return {
    success: true,
    paid: paid.toString(),
    remaining_debt: String(res?.remaining_debt ?? get_investor_summary(tenant_id).debt_remaining),
  };
};

// FUNKSIYA: soft_delete_finance
export const soft_delete_finance = (tenant_id: string, record_id: string, reason: string, deleted_by: string) => {
  const finances = getFinanceLocal(tenant_id);
  const record = finances.find((f) => f.id === record_id && f.tenant_id === tenant_id);
  
  if (!record) throw new Error('Qeyd tapılmadı');
  if (!reason) throw new Error('Silinmə səbəbi məcburidir');

  record.is_deleted = true;
  saveFinanceLocal(tenant_id, finances);

  logEvent(deleted_by, 'FINANCE_DELETE', { tenant_id, record_id, amount: record.amount, reason });
  return { success: true };
};

export const reset_finance_for_tenant = (tenant_id: string, reset_by: string) => {
  saveFinanceLocal(tenant_id, []);
  logEvent(reset_by, 'FINANCE_RESET', { tenant_id });
  return { success: true };
};

// ------------------------------
// Backend bridge (feature-flag)
// ------------------------------
export const fetch_finance_balances = async (tenant_id: string) => {
  if (!isBackendEnabled()) {
    return get_balance(tenant_id, 'all', false) as any;
  }

  const data = await apiRequest<any>('/api/v1/finance/balances', {
    method: 'GET',
    tenantId: tenant_id,
  });

  const balances = {
    cash_balance: String(data?.cash ?? '0'),
    card_balance: String(data?.card ?? '0'),
    debt_balance: String(data?.debt ?? '0'),
    investor_balance: String(data?.investor ?? '0'),
    safe_balance: String(data?.safe ?? '0'),
    deposit_balance: String(data?.deposit ?? '0'),
  };
  return balances;
};

export const fetch_finance_summary = async (tenant_id: string): Promise<FinanceSummary> => {
  if (!isBackendEnabled()) {
    const balances = get_balance(tenant_id, 'all', false) as any;
    return {
      balances: {
        cash: String(balances.cash_balance || '0'),
        card: String(balances.card_balance || '0'),
        safe: String(balances.safe_balance || '0'),
        investor: String(balances.investor_balance || '0'),
        debt: String(balances.debt_balance || '0'),
        deposit: String(balances.deposit_balance || '0'),
      },
      alerts: [],
      pending_approvals_count: 0,
      pending_approvals_preview: [],
      latest_reconciliation: null,
    };
  }
  const data = await apiRequest<any>('/api/v1/finance/summary', {
    method: 'GET',
    tenantId: tenant_id,
  });
  return {
    balances: {
      cash: String(data?.balances?.cash ?? '0'),
      card: String(data?.balances?.card ?? '0'),
      safe: String(data?.balances?.safe ?? '0'),
      investor: String(data?.balances?.investor ?? '0'),
      debt: String(data?.balances?.debt ?? '0'),
      deposit: String(data?.balances?.deposit ?? '0'),
    },
    alerts: (data?.alerts || []) as FinanceAlert[],
    pending_approvals_count: Number(data?.pending_approvals_count ?? 0),
    pending_approvals_preview: (data?.pending_approvals_preview || []).map(mapFinanceLedgerTransaction),
    latest_reconciliation: data?.latest_reconciliation
      ? {
          id: String(data.latest_reconciliation.id),
          account_code: data.latest_reconciliation.account_code ?? null,
          account_name: data.latest_reconciliation.account_name ?? null,
          expected_balance: String(data.latest_reconciliation.expected_balance ?? '0'),
          counted_balance: String(data.latest_reconciliation.counted_balance ?? '0'),
          variance: String(data.latest_reconciliation.variance ?? '0'),
          notes: data.latest_reconciliation.notes ?? null,
          reconciled_by: data.latest_reconciliation.reconciled_by ?? null,
          reconciled_at: data.latest_reconciliation.reconciled_at ?? null,
          created_by: String(data.latest_reconciliation.created_by || ''),
          created_at: data.latest_reconciliation.created_at ?? null,
        }
      : null,
  };
};

export const fetch_finance_entries = async (tenant_id: string): Promise<FinanceEntry[]> => {
  if (!isBackendEnabled()) {
    return get_finance_entries(tenant_id);
  }

  const rows = await apiRequest<any[]>('/api/v1/finance/entries', {
    method: 'GET',
    tenantId: tenant_id,
  });

  const mapped = (rows || []).map((r) => ({
    id: String(r.id),
    tenant_id,
    type: String(r.type) as 'in' | 'out',
    category: String(r.category || ''),
    amount: String(r.amount || '0'),
    source: normalizeSource(String(r.source || 'cash')),
    description: String(r.description || ''),
    created_at: String(r.created_at || new Date().toISOString()),
    is_deleted: false,
  }));
  const merged = mergeFinanceLocalWithServer(tenant_id, mapped);
  saveFinanceLocal(tenant_id, merged);
  return mapped;
};

export type FinanceAnomalies = {
  cash_balance: string;
  deposit_balance: string;
  investor_ledger_balance: string;
  investor_calculated_debt: string;
  investor_ledger_gap: string;
  has_investor_mismatch: boolean;
  total_revenue: string;
  ledger_sales_total: string;
  reconciliation_gap: string;
  has_reconciliation_issue: boolean;
  current_period_revenue: string;
  current_period_ledger_sales_total: string;
  current_period_reconciliation_gap: string;
  has_current_period_reconciliation_issue: boolean;
  current_period_start: string | null;
  expected_cash: string;
  shift_cash_gap: string;
  has_shift_cash_mismatch: boolean;
  has_deposit_risk: boolean;
  deposit_cash_gap: string;
  has_closed_shift_open_deposit: boolean;
  shift_open: boolean;
};

export type FinanceAlert = {
  id: string;
  title: string;
  body: string;
  tone: 'rose' | 'amber';
  action: string;
  tab: string;
  severity?: 'critical' | 'warning' | 'info' | string;
  count?: number;
};

export type FinanceSummary = {
  balances: {
    cash: string;
    card: string;
    safe: string;
    investor: string;
    debt: string;
    deposit: string;
  };
  alerts: FinanceAlert[];
  pending_approvals_count: number;
  pending_approvals_preview: FinanceLedgerTransaction[];
  latest_reconciliation: FinanceReconciliation | null;
};

export type FinanceReportsOverview = {
  period: {
    date_from?: string | null;
    date_to?: string | null;
  };
  balance_sheet: {
    assets: {
      cash: string;
      bank_card: string;
      safe: string;
      receivables: string;
      inventory: string;
      total: string;
    };
    liabilities: {
      deposits: string;
      investor: string;
      total: string;
    };
    equity: {
      estimated_equity: string;
      note?: string | null;
    };
    balanced: boolean;
  };
  profit_loss: {
    revenue: string;
    cogs: string;
    gross_profit: string;
    operating_expenses: string;
    net_profit: string;
    sales_count: number;
    expense_count: number;
    has_uncomputed_cogs?: boolean;
    cogs_uncomputed_sales_count?: number;
    cogs_uncomputed_revenue?: string;
    cogs_coverage_percent?: string;
    cogs_note?: string;
  };
  cash_flow: {
    operating_inflow: string;
    operating_outflow: string;
    financing_inflow: string;
    financing_outflow: string;
    deposit_inflow: string;
    deposit_outflow: string;
    adjustment_net: string;
    net_cash_flow: string;
    transaction_count: number;
  };
};

export type FinanceSalesLedgerReconciliationRow = {
  sale_id: string;
  receipt_code?: string | null;
  sale_total: string;
  ledger_total: string;
  gap: string;
  payment_method?: string | null;
  cashier?: string | null;
  created_at?: string | null;
  transaction_count?: number;
};

export type FinanceSalesLedgerReconciliationReport = {
  period: {
    date_from?: string | null;
    date_to?: string | null;
  };
  sales_count: number;
  sales_total: string;
  ledger_transaction_count: number;
  ledger_sales_total: string;
  reconciliation_gap: string;
  has_reconciliation_issue: boolean;
  missing_ledger_count: number;
  amount_mismatch_count: number;
  missing_ledger_sales: FinanceSalesLedgerReconciliationRow[];
  amount_mismatch_sales: FinanceSalesLedgerReconciliationRow[];
};

export const fetch_finance_reports_overview = async (
  tenant_id: string,
  filters: { date_from?: string; date_to?: string } = {},
): Promise<FinanceReportsOverview | null> => {
  if (!isBackendEnabled()) return null;
  const params = new URLSearchParams();
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest<any>(`/api/v1/finance/reports/overview${suffix}`, {
    method: 'GET',
    tenantId: tenant_id,
  });
  return data as FinanceReportsOverview;
};

export const fetch_sales_ledger_reconciliation_report = async (
  tenant_id: string,
  filters: { date_from?: string; date_to?: string; limit?: number } = {},
): Promise<FinanceSalesLedgerReconciliationReport | null> => {
  if (!isBackendEnabled()) return null;
  const params = new URLSearchParams();
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  if (filters.limit) params.set('limit', String(filters.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest<any>(`/api/v1/finance/reports/sales-ledger-reconciliation${suffix}`, {
    method: 'GET',
    tenantId: tenant_id,
  });
  const mapRow = (row: any): FinanceSalesLedgerReconciliationRow => ({
    sale_id: String(row?.sale_id || ''),
    receipt_code: row?.receipt_code ?? null,
    sale_total: String(row?.sale_total ?? '0'),
    ledger_total: String(row?.ledger_total ?? '0'),
    gap: String(row?.gap ?? '0'),
    payment_method: row?.payment_method ?? null,
    cashier: row?.cashier ?? null,
    created_at: row?.created_at ?? null,
    transaction_count: Number(row?.transaction_count ?? 0),
  });
  return {
    period: data?.period || {},
    sales_count: Number(data?.sales_count ?? 0),
    sales_total: String(data?.sales_total ?? '0'),
    ledger_transaction_count: Number(data?.ledger_transaction_count ?? 0),
    ledger_sales_total: String(data?.ledger_sales_total ?? '0'),
    reconciliation_gap: String(data?.reconciliation_gap ?? '0'),
    has_reconciliation_issue: Boolean(data?.has_reconciliation_issue),
    missing_ledger_count: Number(data?.missing_ledger_count ?? 0),
    amount_mismatch_count: Number(data?.amount_mismatch_count ?? 0),
    missing_ledger_sales: (data?.missing_ledger_sales || []).map(mapRow),
    amount_mismatch_sales: (data?.amount_mismatch_sales || []).map(mapRow),
  };
};

export type FinanceLedgerAccount = {
  id: string;
  code: string;
  name: string;
  account_type: string;
  currency: string;
  is_active: boolean;
  debit_total: string;
  credit_total: string;
  ledger_balance: string;
  created_at?: string | null;
};

export type FinanceLedgerTransaction = {
  id: string;
  transaction_type: string;
  status: string;
  source_account?: string | null;
  destination_account?: string | null;
  amount: string;
  currency: string;
  category?: string | null;
  counterparty?: string | null;
  reference?: string | null;
  note?: string | null;
  created_by: string;
  approved_by?: string | null;
  posted_by?: string | null;
  reversed_by?: string | null;
  created_at?: string | null;
  approved_at?: string | null;
  posted_at?: string | null;
  reversed_at?: string | null;
  legacy_finance_entry_id?: string | null;
  related_order_id?: string | null;
  discount_amount?: string | null;
  discount_reason?: string | null;
};

export type FinanceLedgerEntry = {
  id: string;
  transaction_id: string;
  account_code?: string | null;
  account_name?: string | null;
  entry_side: 'debit' | 'credit' | string;
  amount: string;
  currency: string;
  description?: string | null;
  created_at?: string | null;
};

export type FinanceAuditLog = {
  id: string;
  action: string;
  user: string;
  details?: string | null;
  created_at?: string | null;
};

export type FinanceTransactionDetail = {
  transaction: FinanceLedgerTransaction;
  entries: FinanceLedgerEntry[];
  audit_logs: FinanceAuditLog[];
  reversal_history: FinanceLedgerTransaction[];
};

export type FinanceReconciliation = {
  id: string;
  account_code?: string | null;
  account_name?: string | null;
  status: string;
  expected_balance: string;
  counted_balance: string;
  variance: string;
  notes?: string | null;
  reconciled_by?: string | null;
  reconciled_at?: string | null;
  created_by: string;
  created_at?: string | null;
};

const localLedgerAccounts = (tenant_id: string): FinanceLedgerAccount[] => {
  const balance = get_balance(tenant_id, 'all', false) as any;
  const specs = [
    ['cash', 'Nağd Kassa', 'cash_drawer', balance.cash_balance],
    ['card', 'Bank/Kart', 'bank_account', balance.card_balance],
    ['safe', 'Seyf', 'safe', balance.safe_balance],
    ['deposit', 'Depozit Öhdəliyi', 'deposit_liability', balance.deposit_balance],
    ['investor', 'Investor Borcu', 'investor_liability', balance.investor_balance],
    ['debt', 'Nisyə/Borc', 'receivable', balance.debt_balance],
  ] as const;
  return specs.map(([code, name, account_type, ledger_balance]) => ({
    id: `local-${code}`,
    code,
    name,
    account_type,
    currency: 'AZN',
    is_active: true,
    debit_total: '0',
    credit_total: '0',
    ledger_balance: String(ledger_balance || '0'),
    created_at: null,
  }));
};

const localLedgerTransactions = (tenant_id: string, limit = 200): FinanceLedgerTransaction[] =>
  get_finance_entries(tenant_id)
    .slice()
    .sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime())
    .slice(0, limit)
    .map((entry) => ({
      id: `legacy-${entry.id}`,
      transaction_type: entry.type === 'in' ? 'income' : 'expense',
      status: 'posted',
      source_account: entry.type === 'out' ? normalizeSource(String(entry.source || 'cash')) : 'revenue',
      destination_account: entry.type === 'in' ? normalizeSource(String(entry.source || 'cash')) : 'expense',
      amount: String(entry.amount || '0'),
      currency: 'AZN',
      category: entry.category,
      counterparty: undefined,
      reference: undefined,
      note: entry.description || '',
      created_by: 'local',
      posted_by: 'local',
      created_at: entry.created_at,
      posted_at: entry.created_at,
      reversed_at: null,
      legacy_finance_entry_id: entry.id,
      related_order_id: null,
      discount_amount: null,
      discount_reason: null,
    }));

export const fetch_finance_ledger_accounts = async (tenant_id: string): Promise<FinanceLedgerAccount[]> => {
  if (!isBackendEnabled()) return localLedgerAccounts(tenant_id);
  const rows = await apiRequest<any[]>('/api/v1/finance/ledger/accounts', {
    method: 'GET',
    tenantId: tenant_id,
  });
  return (rows || []).map((row) => ({
    id: String(row.id),
    code: String(row.code || ''),
    name: String(row.name || ''),
    account_type: String(row.account_type || ''),
    currency: String(row.currency || 'AZN'),
    is_active: Boolean(row.is_active ?? true),
    debit_total: String(row.debit_total ?? '0'),
    credit_total: String(row.credit_total ?? '0'),
    ledger_balance: String(row.ledger_balance ?? '0'),
    created_at: row.created_at ?? null,
  }));
};

export type FinanceLedgerTransactionFilters = {
  limit?: number;
  offset?: number;
  date_from?: string;
  date_to?: string;
  transaction_type?: string;
  status?: string;
  account?: string;
  counterparty?: string;
  min_amount?: string;
  max_amount?: string;
  search?: string;
};

export type FinanceLedgerTransactionPage = {
  rows: FinanceLedgerTransaction[];
  total: number;
  limit: number;
  offset: number;
};

const mapFinanceLedgerTransaction = (row: any): FinanceLedgerTransaction => ({
  id: String(row.id),
  transaction_type: String(row.transaction_type || ''),
  status: String(row.status || ''),
  source_account: row.source_account ?? null,
  destination_account: row.destination_account ?? null,
  amount: String(row.amount ?? '0'),
  currency: String(row.currency || 'AZN'),
  category: row.category ?? null,
  counterparty: row.counterparty ?? null,
  reference: row.reference ?? null,
  note: row.note ?? null,
  created_by: String(row.created_by || ''),
  approved_by: row.approved_by ?? null,
  posted_by: row.posted_by ?? null,
  reversed_by: row.reversed_by ?? null,
  created_at: row.created_at ?? null,
  approved_at: row.approved_at ?? null,
  posted_at: row.posted_at ?? null,
  reversed_at: row.reversed_at ?? null,
  legacy_finance_entry_id: row.legacy_finance_entry_id ?? null,
  related_order_id: row.related_order_id ?? null,
  discount_amount: row.discount_amount ?? null,
  discount_reason: row.discount_reason ?? null,
});

export const fetch_finance_ledger_transactions_page = async (
  tenant_id: string,
  filters: FinanceLedgerTransactionFilters = {},
): Promise<FinanceLedgerTransactionPage> => {
  const limit = filters.limit ?? 200;
  if (!isBackendEnabled()) {
    const allRows = localLedgerTransactions(tenant_id, 5000);
    const offset = filters.offset ?? 0;
    return {
      rows: allRows.slice(offset, offset + limit),
      total: allRows.length,
      limit,
      offset,
    };
  }
  const params = new URLSearchParams();
  Object.entries({ ...filters, limit, include_total: 'true' }).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') return;
    params.set(key, String(value));
  });
  const data = await apiRequest<any>(`/api/v1/finance/ledger/transactions?${params.toString()}`, {
    method: 'GET',
    tenantId: tenant_id,
  });
  const rows = Array.isArray(data) ? data : data?.rows || [];
  return {
    rows: (rows || []).map(mapFinanceLedgerTransaction),
    total: Number(Array.isArray(data) ? rows.length : data?.total ?? rows.length),
    limit: Number(Array.isArray(data) ? limit : data?.limit ?? limit),
    offset: Number(Array.isArray(data) ? filters.offset ?? 0 : data?.offset ?? filters.offset ?? 0),
  };
};

export const fetch_finance_ledger_transactions = async (
  tenant_id: string,
  limitOrFilters: number | FinanceLedgerTransactionFilters = 200,
): Promise<FinanceLedgerTransaction[]> => {
  const filters: FinanceLedgerTransactionFilters =
    typeof limitOrFilters === 'number' ? { limit: limitOrFilters } : limitOrFilters;
  const limit = filters.limit ?? 200;
  if (!isBackendEnabled()) return localLedgerTransactions(tenant_id, limit);
  const params = new URLSearchParams();
  Object.entries({ ...filters, limit }).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') return;
    params.set(key, String(value));
  });
  const rows = await apiRequest<any[]>(`/api/v1/finance/ledger/transactions?${params.toString()}`, {
    method: 'GET',
    tenantId: tenant_id,
  });
  return (rows || []).map(mapFinanceLedgerTransaction);
};

export const fetch_finance_ledger_entries = async (tenant_id: string, limit = 300): Promise<FinanceLedgerEntry[]> => {
  if (!isBackendEnabled()) return [];
  const rows = await apiRequest<any[]>(`/api/v1/finance/ledger/entries?limit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    tenantId: tenant_id,
  });
  return (rows || []).map((row) => ({
    id: String(row.id),
    transaction_id: String(row.transaction_id || ''),
    account_code: row.account_code ?? null,
    account_name: row.account_name ?? null,
    entry_side: String(row.entry_side || ''),
    amount: String(row.amount ?? '0'),
    currency: String(row.currency || 'AZN'),
    description: row.description ?? null,
    created_at: row.created_at ?? null,
  }));
};

export const fetch_finance_transaction_detail = async (tenant_id: string, transaction_id: string): Promise<FinanceTransactionDetail> => {
  const localTransaction = localLedgerTransactions(tenant_id, 500).find((row) => row.id === transaction_id);
  if (!isBackendEnabled()) {
    return {
      transaction: localTransaction || localLedgerTransactions(tenant_id, 1)[0],
      entries: [],
      audit_logs: [],
      reversal_history: [],
    };
  }
  const data = await apiRequest<any>(`/api/v1/finance/ledger/transactions/${encodeURIComponent(transaction_id)}`, {
    method: 'GET',
    tenantId: tenant_id,
  });
  return {
    transaction: {
      id: String(data?.transaction?.id || ''),
      transaction_type: String(data?.transaction?.transaction_type || ''),
      status: String(data?.transaction?.status || ''),
      source_account: data?.transaction?.source_account ?? null,
      destination_account: data?.transaction?.destination_account ?? null,
      amount: String(data?.transaction?.amount ?? '0'),
      currency: String(data?.transaction?.currency || 'AZN'),
      category: data?.transaction?.category ?? null,
      counterparty: data?.transaction?.counterparty ?? null,
      reference: data?.transaction?.reference ?? null,
      note: data?.transaction?.note ?? null,
      created_by: String(data?.transaction?.created_by || ''),
      approved_by: data?.transaction?.approved_by ?? null,
      posted_by: data?.transaction?.posted_by ?? null,
      reversed_by: data?.transaction?.reversed_by ?? null,
      created_at: data?.transaction?.created_at ?? null,
      approved_at: data?.transaction?.approved_at ?? null,
      posted_at: data?.transaction?.posted_at ?? null,
      reversed_at: data?.transaction?.reversed_at ?? null,
      legacy_finance_entry_id: data?.transaction?.legacy_finance_entry_id ?? null,
    },
    entries: (data?.entries || []).map((row: any) => ({
      id: String(row.id),
      transaction_id: String(row.transaction_id || ''),
      account_code: row.account_code ?? null,
      account_name: row.account_name ?? null,
      entry_side: String(row.entry_side || ''),
      amount: String(row.amount ?? '0'),
      currency: String(row.currency || 'AZN'),
      description: row.description ?? null,
      created_at: row.created_at ?? null,
    })),
    audit_logs: (data?.audit_logs || []).map((row: any) => ({
      id: String(row.id),
      action: String(row.action || ''),
      user: String(row.user || ''),
      details: row.details ?? null,
      created_at: row.created_at ?? null,
    })),
    reversal_history: (data?.reversal_history || []).map((row: any) => ({
      id: String(row.id),
      transaction_type: String(row.transaction_type || ''),
      status: String(row.status || ''),
      source_account: row.source_account ?? null,
      destination_account: row.destination_account ?? null,
      amount: String(row.amount ?? '0'),
      currency: String(row.currency || 'AZN'),
      category: row.category ?? null,
      counterparty: row.counterparty ?? null,
      reference: row.reference ?? null,
      note: row.note ?? null,
      created_by: String(row.created_by || ''),
      approved_by: row.approved_by ?? null,
      posted_by: row.posted_by ?? null,
      reversed_by: row.reversed_by ?? null,
      created_at: row.created_at ?? null,
      approved_at: row.approved_at ?? null,
      posted_at: row.posted_at ?? null,
      reversed_at: row.reversed_at ?? null,
      legacy_finance_entry_id: row.legacy_finance_entry_id ?? null,
    })),
  };
};

export const fetch_finance_pending_approvals = async (tenant_id: string): Promise<FinanceLedgerTransaction[]> => {
  if (!isBackendEnabled()) return [];
  const rows = await apiRequest<any[]>('/api/v1/finance/approvals/pending', {
    method: 'GET',
    tenantId: tenant_id,
  });
  return (rows || []).map((row) => ({
    id: String(row.id),
    transaction_type: String(row.transaction_type || ''),
    status: String(row.status || ''),
    source_account: row.source_account ?? null,
    destination_account: row.destination_account ?? null,
    amount: String(row.amount ?? '0'),
    currency: String(row.currency || 'AZN'),
    category: row.category ?? null,
    counterparty: row.counterparty ?? null,
    reference: row.reference ?? null,
    note: row.note ?? null,
    created_by: String(row.created_by || ''),
    approved_by: row.approved_by ?? null,
    posted_by: row.posted_by ?? null,
    reversed_by: row.reversed_by ?? null,
    created_at: row.created_at ?? null,
    approved_at: row.approved_at ?? null,
    posted_at: row.posted_at ?? null,
    reversed_at: row.reversed_at ?? null,
    legacy_finance_entry_id: row.legacy_finance_entry_id ?? null,
  }));
};

export const approve_finance_transaction_async = async (tenant_id: string, transaction_id: string) => {
  if (!isBackendEnabled()) return { success: true, transaction_id, status: 'posted' };
  return apiRequest<any>(`/api/v1/finance/ledger/transactions/${encodeURIComponent(transaction_id)}/approve`, {
    method: 'POST',
    tenantId: tenant_id,
  });
};

export const reject_finance_transaction_async = async (tenant_id: string, transaction_id: string) => {
  if (!isBackendEnabled()) return { success: true, transaction_id, status: 'rejected' };
  return apiRequest<any>(`/api/v1/finance/ledger/transactions/${encodeURIComponent(transaction_id)}/reject`, {
    method: 'POST',
    tenantId: tenant_id,
  });
};

export const request_finance_reversal_async = async (tenant_id: string, transaction_id: string) => {
  if (!isBackendEnabled()) return { success: true, transaction_id: uuidv4(), status: 'pending_approval' };
  return apiRequest<any>(`/api/v1/finance/ledger/transactions/${encodeURIComponent(transaction_id)}/reverse`, {
    method: 'POST',
    tenantId: tenant_id,
  });
};

export const create_finance_ledger_transaction_async = async (
  tenant_id: string,
  payload: {
    transaction_type: string;
    source_account_code?: string;
    destination_account_code?: string;
    amount: string;
    category?: string;
    category_code?: string;
    counterparty?: string;
    reference?: string;
    note?: string;
    requires_approval?: boolean;
  },
) => {
  if (!isBackendEnabled()) {
    return {
      success: true,
      transaction_id: uuidv4(),
      status: payload.requires_approval ? 'pending_approval' : 'posted',
    };
  }
  const categoryLabel = payload.category ? financeCategoryLabelFromValue(payload.category) : payload.category;
  const categoryCode = payload.category_code || (payload.category ? financeCategoryCodeFromValue(payload.category) || undefined : undefined);
  return apiRequest<any>('/api/v1/finance/ledger/transactions', {
    method: 'POST',
    tenantId: tenant_id,
    body: {
      ...payload,
      category: categoryLabel,
      category_code: categoryCode,
    },
  });
};

export const fetch_finance_reconciliations = async (tenant_id: string, limit = 100): Promise<FinanceReconciliation[]> => {
  if (!isBackendEnabled()) return [];
  const rows = await apiRequest<any[]>(`/api/v1/finance/reconciliations?limit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    tenantId: tenant_id,
  });
  return (rows || []).map((row) => ({
    id: String(row.id),
    account_code: row.account_code ?? null,
    account_name: row.account_name ?? null,
    status: String(row.status || ''),
    expected_balance: String(row.expected_balance ?? '0'),
    counted_balance: String(row.counted_balance ?? '0'),
    variance: String(row.variance ?? '0'),
    notes: row.notes ?? null,
    reconciled_by: row.reconciled_by ?? null,
    reconciled_at: row.reconciled_at ?? null,
    created_by: String(row.created_by || ''),
    created_at: row.created_at ?? null,
  }));
};

export const create_finance_reconciliation_async = async (
  tenant_id: string,
  account_code: string,
  expected_balance: string,
  counted_balance: string,
  notes?: string,
) => {
  if (!isBackendEnabled()) {
    const variance = new Decimal(counted_balance || '0').minus(new Decimal(expected_balance || '0'));
    return { success: true, id: uuidv4(), variance: variance.toString() };
  }
  return apiRequest<any>('/api/v1/finance/reconciliations', {
    method: 'POST',
    tenantId: tenant_id,
    body: {
      account_code,
      expected_balance,
      counted_balance,
      notes: notes || '',
    },
  });
};

export const get_finance_anomalies = (tenant_id: string): FinanceAnomalies => {
  const balances = get_balance(tenant_id, 'all', false) as any;
  const investorLedgerBalance = new Decimal(balances.investor_balance || 0);
  const investorCalculatedDebt = investorLedgerBalance;
  const investorLedgerGap = new Decimal(0);
  const cashBalance = new Decimal(balances.cash_balance || 0);
  const depositBalance = new Decimal(balances.deposit_balance || 0);
  return {
    cash_balance: cashBalance.toFixed(2),
    deposit_balance: depositBalance.toFixed(2),
    investor_ledger_balance: investorLedgerBalance.toFixed(2),
    investor_calculated_debt: investorCalculatedDebt.toFixed(2),
    investor_ledger_gap: investorLedgerGap.toFixed(2),
    has_investor_mismatch: false,
    total_revenue: '0.00',
    ledger_sales_total: '0.00',
    reconciliation_gap: '0.00',
    has_reconciliation_issue: false,
    current_period_revenue: '0.00',
    current_period_ledger_sales_total: '0.00',
    current_period_reconciliation_gap: '0.00',
    has_current_period_reconciliation_issue: false,
    current_period_start: null,
    expected_cash: cashBalance.toFixed(2),
    shift_cash_gap: '0.00',
    has_shift_cash_mismatch: false,
    has_deposit_risk: depositBalance.greaterThan(cashBalance),
    deposit_cash_gap: Decimal.max(new Decimal(0), depositBalance.minus(cashBalance)).toFixed(2),
    has_closed_shift_open_deposit: depositBalance.greaterThan(0.01),
    shift_open: false,
  };
};

export const fetch_finance_anomalies = async (tenant_id: string): Promise<FinanceAnomalies> => {
  if (!isBackendEnabled()) {
    return get_finance_anomalies(tenant_id);
  }
  const data = await apiRequest<any>('/api/v1/finance/anomalies', {
    method: 'GET',
    tenantId: tenant_id,
  });
  return {
    cash_balance: String(data?.cash_balance ?? '0'),
    deposit_balance: String(data?.deposit_balance ?? '0'),
    investor_ledger_balance: String(data?.investor_ledger_balance ?? '0'),
    investor_calculated_debt: String(data?.investor_calculated_debt ?? '0'),
    investor_ledger_gap: String(data?.investor_ledger_gap ?? '0'),
    has_investor_mismatch: Boolean(data?.has_investor_mismatch),
    total_revenue: String(data?.total_revenue ?? '0'),
    ledger_sales_total: String(data?.ledger_sales_total ?? '0'),
    reconciliation_gap: String(data?.reconciliation_gap ?? '0'),
    has_reconciliation_issue: Boolean(data?.has_reconciliation_issue),
    current_period_revenue: String(data?.current_period_revenue ?? data?.total_revenue ?? '0'),
    current_period_ledger_sales_total: String(data?.current_period_ledger_sales_total ?? data?.ledger_sales_total ?? '0'),
    current_period_reconciliation_gap: String(data?.current_period_reconciliation_gap ?? data?.reconciliation_gap ?? '0'),
    has_current_period_reconciliation_issue: Boolean(data?.has_current_period_reconciliation_issue ?? data?.has_reconciliation_issue),
    current_period_start: data?.current_period_start ? String(data.current_period_start) : null,
    expected_cash: String(data?.expected_cash ?? '0'),
    shift_cash_gap: String(data?.shift_cash_gap ?? '0'),
    has_shift_cash_mismatch: Boolean(data?.has_shift_cash_mismatch),
    has_deposit_risk: Boolean(data?.has_deposit_risk),
    deposit_cash_gap: String(data?.deposit_cash_gap ?? '0'),
    has_closed_shift_open_deposit: Boolean(data?.has_closed_shift_open_deposit),
    shift_open: Boolean(data?.shift_open),
  };
};

export const fetch_finance_alerts = async (tenant_id: string): Promise<FinanceAlert[]> => {
  if (!isBackendEnabled()) return [];
  const rows = await apiRequest<any[]>('/api/v1/finance/alerts', {
    method: 'GET',
    tenantId: tenant_id,
  });
  return (rows || []).map((row) => ({
    id: String(row.id || ''),
    title: String(row.title || ''),
    body: String(row.body || ''),
    tone: row.tone === 'rose' ? 'rose' : 'amber',
    action: String(row.action || 'Bax'),
    tab: String(row.tab || 'overview'),
    severity: row.severity ? String(row.severity) : undefined,
    count: row.count === undefined || row.count === null ? undefined : Number(row.count),
  }));
};

export const create_finance_entry_async = async (
  tenant_id: string,
  type: 'in' | 'out',
  category: string,
  amount: string,
  source: 'cash' | 'card' | 'debt' | 'investor' | 'safe',
  description: string,
  created_by: string,
  include_bank_commission?: boolean,
) => {
  const categoryLabel = financeCategoryLabelFromValue(category);
  const categoryCode = financeCategoryCodeFromValue(category);
  if (!isBackendEnabled()) {
    return create_finance_entry(tenant_id, type, categoryLabel, amount, source, description, created_by, include_bank_commission);
  }

  const data = await apiRequest<any>('/api/v1/finance/entry', {
    method: 'POST',
    tenantId: tenant_id,
    body: {
      type,
      category: categoryLabel,
      category_code: categoryCode,
      source,
      amount,
      description,
      include_bank_commission,
    },
  });

  const now = new Date().toISOString();
  const amountDec = new Decimal(amount || '0');
  const mirroredRows: FinanceEntry[] = [
    {
      id: String(data?.id || uuidv4()),
      tenant_id,
      type,
      category,
      amount: amountDec.toString(),
      source,
      description,
      created_at: now,
      is_deleted: false,
    },
  ];
  if (type === 'in' && source === 'debt') {
    mirroredRows.push({
      id: uuidv4(),
      tenant_id,
      type: 'in',
      category: 'Borcdan Kassaya Daxilolma',
      amount: amountDec.toString(),
      source: 'cash',
      description: `Auto mirror: ${description || category}`,
      created_at: now,
      is_deleted: false,
    });
  }
  if (type === 'in' && source === 'cash' && isFounderInvestmentCategory(category)) {
    mirroredRows.push({
      id: uuidv4(),
      tenant_id,
      type: 'in',
      category: 'İnvestor Borcu',
      amount: amountDec.toString(),
      source: 'investor',
      description: `Auto liability mirror: ${description || category}`,
      created_at: now,
      is_deleted: false,
    });
  }
  pushFinanceLocalEntries(tenant_id, mirroredRows);

  logEvent(created_by, 'FINANCE_ENTRY_CREATED', { tenant_id, type, category, amount, source, via: 'backend' });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finance-updated', { detail: { tenant_id, type, category, amount, source } }));
  }
  return data;
};

export const transfer_funds_async = async (
  tenant_id: string,
  direction:
    | 'card_to_cash'
    | 'cash_to_card'
    | 'cash_to_debt'
    | 'card_to_debt'
    | 'cash_to_safe'
    | 'safe_to_cash',
  amount: string,
  commission: string,
  transferred_by: string,
) => {
  if (!isBackendEnabled()) {
    return transfer_funds(tenant_id, direction, amount, commission, transferred_by);
  }

  const data = await apiRequest<any>('/api/v1/finance/transfer', {
    method: 'POST',
    tenantId: tenant_id,
    body: {
      direction,
      amount,
      description: `Transfer: ${direction}`,
    },
  });

  const now = new Date().toISOString();
  const transferAmountDec = new Decimal(amount || '0');
  const appliedCommission = String(data?.commission ?? commission ?? '0');
  const commissionDec = new Decimal(appliedCommission || '0');
  const sources = {
    card_to_cash: { from: 'card', to: 'cash' },
    cash_to_card: { from: 'cash', to: 'card' },
    cash_to_debt: { from: 'cash', to: 'debt' },
    card_to_debt: { from: 'card', to: 'debt' },
    cash_to_safe: { from: 'cash', to: 'safe' },
    safe_to_cash: { from: 'safe', to: 'cash' },
  } as const;
  const walletPair = sources[direction];
  const transferRows: FinanceEntry[] = [
    {
      id: uuidv4(),
      tenant_id,
      type: 'out',
      category: 'Daxili Transfer',
      amount: transferAmountDec.toString(),
      source: walletPair.from,
      description: `Transfer: ${direction}`,
      created_at: now,
      is_deleted: false,
    },
    {
      id: uuidv4(),
      tenant_id,
      type: 'in',
      category: 'Daxili Transfer',
      amount: transferAmountDec.toString(),
      source: walletPair.to,
      description: `Transfer: ${direction}`,
      created_at: now,
      is_deleted: false,
    },
  ];
  if (commissionDec.greaterThan(0)) {
    transferRows.push({
      id: uuidv4(),
      tenant_id,
      type: 'out',
      category: 'Bank Komissiyası',
      amount: commissionDec.toString(),
      source: walletPair.from,
      description: `Transfer komissiyası: ${direction}`,
      created_at: now,
      is_deleted: false,
    });
  }
  pushFinanceLocalEntries(tenant_id, transferRows);

  logEvent(transferred_by, 'FINANCE_TRANSFER', {
    tenant_id,
    direction,
    amount,
    commission: data?.commission || commission,
    via: 'backend',
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finance-updated', { detail: { tenant_id, direction, amount, commission: data?.commission || commission } }));
  }

  return {
    success: true,
    applied_commission: String(data?.commission ?? commission ?? '0'),
  };
};
