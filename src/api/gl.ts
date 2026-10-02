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

/** 'current' = not yet due (only partners aged by bill due date have it non-zero). */
export type AgingBucket = 'current' | '0_30' | '31_60' | '61_90' | '90_plus';

/** due_date: open bills by due date; posting_date: FIFO by posting date; mixed: bills + undocumented remainder. */
export type AgingBasis = 'due_date' | 'posting_date' | 'mixed';

export type SubledgerPartner = {
  partner_type: string | null;
  partner_id: string | null;
  name: string | null;
  balance: Money;
  open: Money;
  advance: Money;
  buckets: Record<AgingBucket, Money>;
  aging_basis: AgingBasis;
  oldest_open_date: string | null;
};

export type Subledger = {
  ledger: 'ap' | 'ar';
  as_of: string;
  control_accounts: Array<{ id: string; code: string; name: string }>;
  control_balance: Money;
  partners: SubledgerPartner[];
  totals: Record<AgingBucket | 'advance' | 'balance', Money>;
  unassigned_balance: Money;
  reconciled: boolean;
};

export type FiscalYearBlocker = 'year_not_ended' | 'pending_journals' | 'open_periods' | 'december_closed';

export type FiscalYearStatus = {
  year: number;
  closed: boolean;
  closing_journal: { id: string; journal_no: string | null; posted_at: string | null; posted_by: string | null } | null;
  pending_journals: number;
  periods: Array<{ month: number; status: GLPeriodStatus }>;
  net_result_to_close: Money;
  accounts_to_close: number;
  blockers: FiscalYearBlocker[];
  can_close: boolean;
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
  subledger: (ledger: 'ap' | 'ar', as_of?: string) => get<Subledger>(`/subledger/${ledger}`, { as_of }),
  fiscalYear: (year: number) => get<FiscalYearStatus>(`/years/${year}`),
  closeFiscalYear: (year: number) => post<GLJournal>(`/years/${year}/close`),
  reopenFiscalYear: (year: number, reason: string) => post<GLJournal>(`/years/${year}/reopen`, { reason }),
  shadowStatus: () => get<ShadowStatus>('/shadow/status'),
  integrity: () => get<GLIntegrity>('/integrity'),
  /** Supplier picker for bills / reclass (readable by every GL reader). */
  suppliers: () => get<GLSupplier[]>('/suppliers'),
  /** AP bills only (AR invoices are deferred); `summary` covers every page of the filtered set. */
  documents: (params: {
    kind?: 'ap_bill'; status?: string; partner_id?: string; due_before?: string; due_after?: string;
    overdue_only?: boolean; search?: string; limit?: number; offset?: number;
  } = {}) =>
    get<GLDocumentPage>('/documents', {
      ...params,
      overdue_only: params.overdue_only ? 'true' : undefined,
    }),
  document: (id: string) => get<GLDocument>(`/documents/${encodeURIComponent(id)}`),
  createBill: (payload: CreateBillInput) => post<GLDocument>('/documents/bills', payload),
  payBill: (id: string, payload: PayBillInput) => post<PayBillResult>(`/documents/${encodeURIComponent(id)}/pay`, payload),
  /** Requests the void: the storno waits for a second person (`pending_void_journal_id`); status stays open. */
  voidDocument: (id: string, reason: string) => post<GLDocument>(`/documents/${encodeURIComponent(id)}/void`, { reason }),
  /** Requests the reversal of a posted bill payment (pending storno; the bill reopens on approval). */
  reverseBillPayment: (id: string, journalId: string, reason: string) =>
    post<ReverseBillPaymentResult>(
      `/documents/${encodeURIComponent(id)}/payments/${encodeURIComponent(journalId)}/reverse`,
      { reason }
    ),
  /** Always pending owner approval by a second person. */
  reclassifyUnassignedAP: (payload: ReclassifyAPInput) => post<ReclassifyAPResult>(`/documents/reclassify-unassigned`, payload),
};

export type GLSupplier = { id: string; name: string };

export type GLDocumentStatus = 'pending_approval' | 'open' | 'partially_paid' | 'paid' | 'rejected' | 'void' | string;

export type GLDocumentAllocation = {
  id: string;
  journal_id: string;
  journal_no: string | null;
  posting_date: string;
  journal_line_no: number;
  /** Negative rows cancel a reversed payment. */
  amount: Money;
  /** 'document_payment' (paid from Bills) | 'supplier_payment' (legacy supplier payment) | ... */
  source_type: string | null;
  /** True once the payment journal has a posted storno. */
  reversed: boolean;
  created_at: string | null;
};

export type GLDocumentLine = {
  line_no: number;
  account_code: string;
  account_name: string;
  debit: Money;
  credit: Money;
  memo: string | null;
};

export type GLPendingBillPayment = {
  journal_id: string;
  amount: Money;
  posting_date: string;
  created_by: string | null;
  created_at: string | null;
};

export type GLPendingPaymentReversal = { journal_id: string; reversal_of_id: string; created_by: string | null };

export type GLDocument = {
  id: string;
  kind: 'ap_bill' | 'ar_invoice' | string;
  partner_type: string;
  partner_id: string;
  partner_name: string;
  number: string;
  issue_date: string;
  due_date: string;
  currency: string;
  total: Money;
  open: Money;
  status: GLDocumentStatus;
  is_overdue: boolean;
  days_overdue: number;
  journal_id: string | null;
  note: string | null;
  created_at: string | null;
  // Detail-only fields (GET /documents/{id}, create and void responses):
  created_by?: string;
  /** Status of the bill's own journal (pending_approval while the bill waits for approval). */
  journal_status?: GLJournalStatus | null;
  /** Source journal lines of the bill. */
  lines?: GLDocumentLine[];
  allocations?: GLDocumentAllocation[];
  /** Pending storno of the bill journal (void requested, waiting for a second person). */
  pending_void_journal_id?: string | null;
  pending_payments?: GLPendingBillPayment[];
  pending_payment_reversals?: GLPendingPaymentReversal[];
};

export type GLDocumentSummary = {
  /** Excludes void and rejected bills. */
  total_billed: Money;
  total_open: Money;
  overdue_open: Money;
  overdue_count: number;
};

export type GLDocumentPage = { total: number; items: GLDocument[]; summary: GLDocumentSummary };

export type CreateBillInput = {
  partner_id: string;
  number: string;
  issue_date: string;
  due_date: string;
  total: Money;
  expense_account?: string | null;
  note?: string | null;
  branch_id?: string | null;
};

export type PayBillInput = {
  amount: Money;
  /** Bank or safe only: the backend rejects the POS drawer (400 wallet_not_allowed), Z-close would miss it. */
  paid_from: 'bank_main' | 'safe';
  posting_date?: string;
  bank_fee?: Money;
  note?: string | null;
  /** Required: one key per open payment dialog; a retry with the same key replays the payment. */
  idempotency_key: string;
};

export type PayBillResult = {
  document_id: string;
  number: string;
  status: GLDocumentStatus;
  paid_amount: Money;
  remaining_open: Money;
  journal_no: string | null;
  journal_id: string;
  journal_status: GLJournalStatus;
  allocations_count: number;
  replayed: boolean;
};

export type ReverseBillPaymentResult = {
  document_id: string;
  journal_id: string;
  journal_no: string | null;
  journal_status: GLJournalStatus;
  reversal_of_id: string;
};

export type ReclassifyAPInput = {
  amount: Money;
  to_supplier_id: string;
  reason?: string;
  posting_date?: string;
};

export type ReclassifyAPResult = {
  journal_id: string;
  journal_no: string | null;
  status: GLJournalStatus;
  amount: Money;
  to_supplier_id: string;
  posting_date: string;
};

