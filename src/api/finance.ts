import { Decimal } from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { logEvent } from '../lib/logger';
import { FinanceEntry } from '../types/pos';
import { apiRequest, isBackendEnabled } from './client';

import { getDB, setDB } from '../lib/db_sim';

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

const isFounderInvestmentCategory = (category: string) => {
  const normalizedCategory = normalizeText(category);

  // Accept common spelling variants used by operators while avoiding
  // unrelated investor categories like "investor borcu azaldilmasi".
  const hasFounderToken =
    normalizedCategory.includes('tesisci') ||
    normalizedCategory.includes('founder') ||
    normalizedCategory.includes('учред');

  const hasInvestmentToken =
    normalizedCategory.includes('investis') ||
    normalizedCategory.includes('investi') ||
    normalizedCategory.includes('investment') ||
    normalizedCategory.includes('инвест');

  return hasFounderToken && hasInvestmentToken;
};

const INCOME_CATEGORIES = new Set([
  normalizeText('Təsisçi İnvestisiyası'),
  normalizeText('Borc Alındı'),
  normalizeText('Digər Giriş'),
  normalizeText('Kassa Açılışı'),
  normalizeText('Satış (Nağd)'),
  normalizeText('Satış (Kart)'),
]);

const EXPENSE_CATEGORIES = new Set([
  normalizeText('Xammal'),
  normalizeText('Kommunal'),
  normalizeText('Maaş'),
  normalizeText('İcarə'),
  normalizeText('Cərimə'),
  normalizeText('Digər Xərc'),
  normalizeText('İnvestora Geri Ödəniş'),
  normalizeText('İnvestor Borcu Azaldılması'),
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

  // Remaining investor liability = total founder investments - explicit repayments.
  // This prevents unrelated investor-source expense rows from erasing debt visibility.
  const debt_remaining = Decimal.max(new Decimal(0), invested_total.minus(repaid_total));

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
  created_by: string
) => {
  const finances = getFinanceLocal(tenant_id);
  const amountDec = new Decimal(amount);
  const now = new Date().toISOString();

  validateFinanceEntryMatrix(type, category, source);

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
    if (available.lessThan(amountDec)) {
      throw new Error('Balans kifayət etmir. Mənfi saldo əməliyyatı qadağandır.');
    }
  }
  
  const entry: FinanceEntry = {
    id: uuidv4(),
    tenant_id,
    type,
    category,
    amount: amountDec.toString(),
    source,
    description,
    created_at: now,
    is_deleted: false
  };

  finances.push(entry);

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
    isFounderInvestmentCategory(category)
  ) {
    finances.push({
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
  saveFinanceLocal(tenant_id, mapped);
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
  expected_cash: string;
  shift_cash_gap: string;
  has_shift_cash_mismatch: boolean;
  has_deposit_risk: boolean;
  deposit_cash_gap: string;
  has_closed_shift_open_deposit: boolean;
  shift_open: boolean;
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

export const fetch_finance_ledger_transactions = async (tenant_id: string, limit = 200): Promise<FinanceLedgerTransaction[]> => {
  if (!isBackendEnabled()) return localLedgerTransactions(tenant_id, limit);
  const rows = await apiRequest<any[]>(`/api/v1/finance/ledger/transactions?limit=${encodeURIComponent(String(limit))}`, {
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
  return apiRequest<any>('/api/v1/finance/ledger/transactions', {
    method: 'POST',
    tenantId: tenant_id,
    body: payload,
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
  const investorSummary = get_investor_summary(tenant_id);
  const investorLedgerBalance = new Decimal(balances.investor_balance || 0);
  const investorCalculatedDebt = new Decimal(investorSummary.debt_remaining || 0);
  const investorLedgerGap = investorLedgerBalance.minus(investorCalculatedDebt).abs();
  const cashBalance = new Decimal(balances.cash_balance || 0);
  const depositBalance = new Decimal(balances.deposit_balance || 0);
  return {
    cash_balance: cashBalance.toFixed(2),
    deposit_balance: depositBalance.toFixed(2),
    investor_ledger_balance: investorLedgerBalance.toFixed(2),
    investor_calculated_debt: investorCalculatedDebt.toFixed(2),
    investor_ledger_gap: investorLedgerGap.toFixed(2),
    has_investor_mismatch: investorLedgerGap.greaterThan(0.01),
    total_revenue: '0.00',
    ledger_sales_total: '0.00',
    reconciliation_gap: '0.00',
    has_reconciliation_issue: false,
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
    expected_cash: String(data?.expected_cash ?? '0'),
    shift_cash_gap: String(data?.shift_cash_gap ?? '0'),
    has_shift_cash_mismatch: Boolean(data?.has_shift_cash_mismatch),
    has_deposit_risk: Boolean(data?.has_deposit_risk),
    deposit_cash_gap: String(data?.deposit_cash_gap ?? '0'),
    has_closed_shift_open_deposit: Boolean(data?.has_closed_shift_open_deposit),
    shift_open: Boolean(data?.shift_open),
  };
};

export const create_finance_entry_async = async (
  tenant_id: string,
  type: 'in' | 'out',
  category: string,
  amount: string,
  source: 'cash' | 'card' | 'debt' | 'investor' | 'safe',
  description: string,
  created_by: string,
) => {
  if (!isBackendEnabled()) {
    return create_finance_entry(tenant_id, type, category, amount, source, description, created_by);
  }

  const data = await apiRequest<any>('/api/v1/finance/entry', {
    method: 'POST',
    tenantId: tenant_id,
    body: {
      type,
      category,
      source,
      amount,
      description,
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
