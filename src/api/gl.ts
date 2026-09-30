// Finance v2 — double-entry general ledger (AMHP) API client.
// The backend answers 404 for tenants where the GL API is not enabled; callers treat that as "feature off".
import { apiRequest } from './client';

const BASE = '/api/v1/gl';

/** Money values are serialized by the backend as decimal strings ("123.45"). */
export type Money = string;

export type GLCapabilities = {
  enabled: boolean;
  ledger_mode: 'legacy' | 'dual';
  reports_source: 'legacy' | 'gl';
  chart_ready: boolean;
  role: string;
  can_read: boolean;
  can_write: boolean;
  can_approve: boolean;
  can_control: boolean;
  can_audit: boolean;
  business_today: string;
};

export type GLAccount = {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  account_class: number | string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | string;
  normal_side: 'debit' | 'credit';
  is_postable: boolean;
  system_role: string | null;
  allow_negative: boolean;
  is_system: boolean;
  is_active: boolean;
};

export type GLJournalStatus = 'draft' | 'pending_approval' | 'posted' | 'rejected' | 'reversed' | string;

export type GLJournalLine = {
  line_no: number;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: Money;
  credit: Money;
  memo: string | null;
  partner_type: string | null;
  partner_id: string | null;
  tax_code: string | null;
  branch_id: string | null;
};

export type GLJournal = {
  id: string;
  journal_no: string | null;
  journal_type: string;
  status: GLJournalStatus;
  posting_date: string;
  description: string;
  total: Money;
  currency: string;
  branch_id: string | null;
  source_module: string | null;
  source_type: string | null;
  source_id: string | null;
  reversal_of_id: string | null;
  reversed_by_id: string | null;
  created_by: string | null;
  created_at: string | null;
  approved_by: string | null;
  posted_by: string | null;
  posted_at: string | null;
  rejected_by: string | null;
  reject_reason: string | null;
  lines?: GLJournalLine[];
};

export type GLJournalPage = { total: number; limit: number; offset: number; items: GLJournal[] };

export type GLJournalLineInput = { account: string; debit?: string; credit?: string; memo?: string | null };

export type GLJournalInput = {
  journal_type: 'general' | 'adjustment' | 'cash' | 'bank' | 'opening';
  posting_date?: string;
  description: string;
  lines: GLJournalLineInput[];
  idempotency_key?: string;
};

export type TBRow = {
  account_id: string;
  code: string;
  name: string;
  account_type: string;
  opening_debit: Money;
  opening_credit: Money;
  period_debit: Money;
  period_credit: Money;
  closing_debit: Money;
  closing_credit: Money;
};

export type TrialBalance = {
  date_from: string | null;
  date_to: string | null;
  rows: TBRow[];
  totals: Omit<TBRow, 'account_id' | 'code' | 'name' | 'account_type'>;
  balanced: boolean;
};

export type StatementLine = { code: string; name: string; amount: Money };
export type StatementSection = { lines: StatementLine[]; total: Money };

export type BalanceSheet = {
  as_of: string;
  assets: StatementSection;
  liabilities: StatementSection;
  equity: StatementSection;
  liabilities_and_equity_total: Money;
  difference: Money;
  balanced: boolean;
};

export type ProfitLoss = {
  date_from: string;
  date_to: string;
  revenue: StatementSection;
  cogs: StatementSection;
  operating_expenses: StatementSection;
  other_income: StatementSection;
  finance_costs: StatementSection;
  taxes: StatementSection;
  gross_profit: Money;
  operating_profit: Money;
  profit_before_tax: Money;
  net_profit: Money;
};

export type AccountLedgerEntry = {
  journal_id: string;
  journal_no: string | null;
  posting_date: string;
  journal_type: string;
  description: string;
  memo: string | null;
  debit: Money;
  credit: Money;
  balance: Money;
  source_type: string | null;
  source_id: string | null;
};

export type AccountLedger = {
  account: { id: string; code: string; name: string; normal_side: 'debit' | 'credit' };
  opening_balance: Money;
  entries: AccountLedgerEntry[];
  closing_balance: Money;
  limit: number;
  offset: number;
};

export type GLPeriodStatus = 'open' | 'soft_closed' | 'closed';

export type GLPeriod = {
  id: string;
  year: number;
  month: number;
  start_date: string;
  end_date: string;
  status: GLPeriodStatus;
  closed_by: string | null;
  closed_at: string | null;
};

export type TaxRegime = 'simplified' | 'vat' | 'exempt';

export type TaxProfile = {
  regime: TaxRegime;
  simplified_rate: Money;
  vat_rate: Money;
  prices_include_vat: boolean;
  effective_from: string | null;
  configured: boolean;
};

export type TaxProfileInput = {
  regime: TaxRegime;
  effective_from: string;
  simplified_rate?: string;
  vat_rate?: string;
  prices_include_vat?: boolean;
  note?: string;
};

export type TaxSummary = {
  period: string;
  profile: TaxProfile;
  base?: Money;
  tax_due?: Money;
  accrued?: Money;
  up_to_date?: boolean;
  output_vat?: Money;
  input_vat?: Money;
  vat_payable?: Money;
};

export type ShadowRun = {
  type: 'sync' | 'reconcile' | string;
  started_at: string;
  ok: boolean;
  imported: number;
  error: string | null;
  details: unknown;
};

export type ShadowStatus = {
  enabled: boolean;
  clean_reconciliation_streak: number;
  last_sync: { at: string; imported: number; ok: boolean } | null;
  runs: ShadowRun[];
};

export type GLIntegrity = {
  audit_chain: { valid: boolean; [key: string]: unknown };
  balances: { valid: boolean; mismatches: unknown[] };
  trial_balance_balanced: boolean;
};

type Params = Record<string, string | number | null | undefined>;

function withQuery(path: string, params?: Params): string {
  if (!params) return path;
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') qs.set(key, String(value));
  });
  const text = qs.toString();
  return text ? `${path}?${text}` : path;
}

const get = <T>(path: string, params?: Params) => apiRequest<T>(withQuery(`${BASE}${path}`, params), { method: 'GET' });
const post = <T>(path: string, body?: unknown) => apiRequest<T>(`${BASE}${path}`, { method: 'POST', body: body ?? {} });

/** Returns null when the GL API is not enabled for this tenant or the user has no finance access. */
export async function getGLCapabilities(): Promise<GLCapabilities | null> {
  try {
    return await get<GLCapabilities>('/capabilities');
  } catch {
    return null;
  }
}

export const glApi = {
  setup: () => post<{ success: boolean; accounts: number }>('/setup'),
  accounts: () => get<GLAccount[]>('/accounts'),
  journals: (params: { status?: string; journal_type?: string; date_from?: string; date_to?: string; limit?: number; offset?: number } = {}) =>
    get<GLJournalPage>('/journals', params),
  journal: (id: string) => get<GLJournal>(`/journals/${encodeURIComponent(id)}`),
  createJournal: (payload: GLJournalInput) => post<GLJournal>('/journals', payload),
  approve: (id: string) => post<GLJournal>(`/journals/${encodeURIComponent(id)}/approve`),
  reject: (id: string, reason: string) => post<GLJournal>(`/journals/${encodeURIComponent(id)}/reject`, { reason }),
  reverse: (id: string, reason: string, posting_date?: string) =>
    post<GLJournal>(`/journals/${encodeURIComponent(id)}/reverse`, { reason, posting_date: posting_date || undefined }),
  periods: () => get<GLPeriod[]>('/periods'),
  setPeriodStatus: (year: number, month: number, status: GLPeriodStatus, reason?: string) =>
    post<{ year: number; month: number; status: GLPeriodStatus }>(`/periods/${year}/${month}/status`, { status, reason: reason || undefined }),
  taxProfile: (on?: string) => get<TaxProfile>('/tax-profile', { on }),
  setTaxProfile: (payload: TaxProfileInput) => post<TaxProfile>('/tax-profile', payload),
  accrueSimplifiedTax: (year: number, month: number) => post<Record<string, unknown>>('/tax/simplified/accrue', { year, month }),
  taxSummary: (year: number, month: number) => get<TaxSummary>('/tax/summary', { year, month }),
  trialBalance: (params: { date_from?: string; date_to?: string } = {}) => get<TrialBalance>('/reports/trial-balance', params),
  balanceSheet: (as_of?: string) => get<BalanceSheet>('/reports/balance-sheet', { as_of }),
  profitLoss: (date_from: string, date_to: string) => get<ProfitLoss>('/reports/profit-loss', { date_from, date_to }),
  accountLedger: (accountId: string, params: { date_from?: string; date_to?: string; limit?: number; offset?: number } = {}) =>
    get<AccountLedger>(`/reports/account-ledger/${encodeURIComponent(accountId)}`, params),
  shadowStatus: () => get<ShadowStatus>('/shadow/status'),
  integrity: () => get<GLIntegrity>('/integrity'),
};
