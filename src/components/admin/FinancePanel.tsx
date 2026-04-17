import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import { useAppStore } from '../../store';
import {
  create_finance_entry_async,
  create_finance_ledger_transaction_async,
  create_finance_reconciliation_async,
  approve_finance_transaction_async,
  fetch_finance_anomalies,
  fetch_finance_alerts,
  fetch_finance_balances,
  fetch_finance_summary,
  fetch_finance_entries,
  fetch_finance_ledger_accounts,
  fetch_finance_ledger_entries,
  fetch_finance_ledger_transactions,
  fetch_finance_ledger_transactions_page,
  fetch_finance_pending_approvals,
  fetch_finance_reconciliations,
  fetch_finance_reports_overview,
  fetch_finance_transaction_detail,
  financeCategoryCodeFromValue,
  reject_finance_transaction_async,
  type FinanceAnomalies,
  type FinanceAlert,
  type FinanceReportsOverview,
  type FinanceTransactionDetail,
  type FinanceLedgerAccount,
  type FinanceLedgerEntry,
  type FinanceLedgerTransaction,
  type FinanceReconciliation,
  get_balance,
  get_finance_entries,
  request_finance_reversal_async,
  transfer_funds_async,
} from '../../api/finance';
import { get_settings_live } from '../../api/settings';
import { send_email } from '../../api/email';
import { tx } from '../../i18n';
import { formatServerUtcDateTime, localDateInputValue } from '../../lib/time';
import {
  FinanceAlertsBar,
  FinanceControlCard,
  FinanceDashboard,
  FinanceField,
  FinanceMiniMetric,
  FinanceQuickActions,
  FinanceStatusBadge,
  FinanceSummaryStrip,
  FinanceWorkspaceTabs,
  TransactionDetailDrawer,
  type FinanceQuickAction,
  type FinanceWorkspaceTab,
} from './finance/FinanceWorkspaceParts';
import {
  FinanceApprovalPreview,
  FinanceControlSummaryPanel,
  FinanceLedgerTab,
  FinanceOverviewInsightsCard,
  FinanceReconciliationWorkspace,
  FinanceWorkspaceShell,
} from './finance/FinanceWorkspaceSections';

type WalletSource = 'cash' | 'card' | 'investor' | 'safe' | 'debt';

type CategoryOption = {
  value: string;
  label: string;
  helper: string;
};

type SourceOption = {
  value: WalletSource;
  label: string;
  helper: string;
};

const defaultSubjectPresets = [
  'Təchizatçı',
  'İcarədar',
  'Azərişıq',
  'İnternet',
  'Barista',
  'Kassir',
  'Dövlət / Vergi',
  'Digər',
];

const normalizeFinanceText = (value: unknown) =>
  String(value || '')
    .replace(/ə/gi, 'e')
    .replace(/ı/gi, 'i')
    .replace(/ö/gi, 'o')
    .replace(/ü/gi, 'u')
    .replace(/ç/gi, 'c')
    .replace(/ş/gi, 's')
    .replace(/ğ/gi, 'g')
    .trim()
    .toLowerCase();

const isOperationalFinanceEntry = (entry: any) => {
  const categoryCode = financeCategoryCodeFromValue(String(entry?.category || '')) || '';
  const category = normalizeFinanceText(entry?.category);
  const source = normalizeFinanceText(entry?.source);
  const description = normalizeFinanceText(entry?.description);
  const isDeposit = category.includes('depozit') || description.includes('depozit') || description.includes('deposit');

  if (categoryCode === 'internal_transfer') return false;
  if (categoryCode === 'founder_investment') return false;
  if (categoryCode === 'investor_liability') return false;
  if (categoryCode === 'borrowed_to_cash_mirror') return false;
  if (categoryCode === 'borrowed_funds_in') return false;
  if (category.includes('kassa acilisi')) return false;
  if (isDeposit) return false;
  if (source === 'investor' || source === 'debt') return false;
  if (description.includes('auto liability mirror')) return false;
  if (description.includes('auto mirror')) return false;
  if (description.includes('shift opening cash')) return false;
  return true;
};

export default function FinancePanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';

  const [fromDate, setFromDate] = useState(() => localDateInputValue());
  const [toDate, setToDate] = useState(() => localDateInputValue());
  const [rangePreset, setRangePreset] = useState<'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'>('daily');
  const [workspaceTab, setWorkspaceTab] = useState<FinanceWorkspaceTab>('overview');
  const [quickAction, setQuickAction] = useState<FinanceQuickAction>('expense');

  const [type, setType] = useState<'in' | 'out'>('out');
  const [source, setSource] = useState<WalletSource>('cash');
  const [subject, setSubject] = useState('');
  const [subjectPresets, setSubjectPresets] = useState<string[]>(defaultSubjectPresets);
  const [newSubjectPreset, setNewSubjectPreset] = useState('');
  const [category, setCategory] = useState('raw_material');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const incomeCategoryOptions: CategoryOption[] = [
    {
      value: 'founder_investment',
      label: tx(lang, 'Təsisçi İnvestisiyası', 'Инвестиция учредителя', 'Founder Investment'),
      helper: tx(
        lang,
        'Kassa mənbəsi ilə giriş edilərsə, investor borcu ayrıca avtomatik qeyd olunur.',
        'Если приход в кассу, долг инвестору фиксируется автоматически.',
        'If incoming to cash, investor liability is auto-recorded.',
      ),
    },
    {
      value: 'borrowed_funds_in',
      label: tx(lang, 'Borc Alındı', 'Получен долг', 'Borrowed Funds In'),
      helper: tx(
        lang,
        'Mənbə=Borc seçilərsə sistem borcu və kassanı eyni vaxtda artırır.',
        'Если источник=долг, система увеличит и долг, и кассу.',
        'If source=debt, system increases both debt and cash.',
      ),
    },
    {
      value: 'other_income',
      label: tx(lang, 'Digər Giriş', 'Прочий приход', 'Other Income'),
      helper: tx(lang, 'Satışdankənar digər daxilolmalar.', 'Прочие несбытовые поступления.', 'Other non-sales income entries.'),
    },
  ];

  const expenseCategoryOptions: CategoryOption[] = [
    {
      value: 'raw_material',
      label: tx(lang, 'Xammal', 'Сырье', 'Raw Material'),
      helper: tx(lang, 'Məhsul/xammal alışı üçün istifadə edin.', 'Используйте для закупки сырья.', 'Use for stock/raw purchases.'),
    },
    {
      value: 'utilities',
      label: tx(lang, 'Kommunal', 'Коммунальные', 'Utilities'),
      helper: tx(lang, 'Su, işıq, internet və s. ödənişlər.', 'Вода, свет, интернет и т.д.', 'Electricity, water, internet, etc.'),
    },
    {
      value: 'payroll',
      label: tx(lang, 'Maaş', 'Зарплата', 'Payroll'),
      helper: tx(lang, 'İşçi maaşı və avans ödənişləri.', 'Выплаты зарплаты и аванса.', 'Salary and advance payouts.'),
    },
    {
      value: 'rent',
      label: tx(lang, 'İcarə', 'Аренда', 'Rent'),
      helper: tx(lang, 'Obyekt icarə xərcləri.', 'Расходы на аренду помещения.', 'Premises rent expenses.'),
    },
    {
      value: 'penalty',
      label: tx(lang, 'Cərimə', 'Штраф', 'Penalty'),
      helper: tx(lang, 'Cərimə və digər məcburi ödənişlər.', 'Штрафы и обязательные платежи.', 'Penalties and mandatory charges.'),
    },
    {
      value: 'other_expense',
      label: tx(lang, 'Digər Xərc', 'Прочий расход', 'Other Expense'),
      helper: tx(lang, 'Standart kateqoriyaya düşməyən xərclər.', 'Расходы вне стандартных категорий.', 'Expenses outside standard categories.'),
    },
  ];

  const categoryOptions = type === 'in' ? incomeCategoryOptions : expenseCategoryOptions;

  const sourceOptions: SourceOption[] = type === 'in'
    ? [
        {
          value: 'cash',
          label: tx(lang, 'Kassa', 'Касса', 'Cash'),
          helper: tx(lang, 'Pul fiziki kassaya daxil olur.', 'Деньги поступают в кассу.', 'Money enters physical cash drawer.'),
        },
        {
          value: 'card',
          label: tx(lang, 'Bank Kartı', 'Банковская карта', 'Bank Card'),
          helper: tx(lang, 'Pul bank hesabına daxil olur.', 'Деньги поступают на банковскую карту.', 'Money enters bank card wallet.'),
        },
        {
          value: 'safe',
          label: tx(lang, 'Seyf', 'Сейф', 'Safe'),
          helper: tx(lang, 'Pul seyfdə saxlanılır.', 'Деньги поступают в сейф.', 'Money enters safe wallet.'),
        },
        {
          value: 'debt',
          label: tx(lang, 'Nisyə Borcu', 'Долговой счет', 'Debt Wallet'),
          helper: tx(
            lang,
            'Bu investor deyil. Nisyə/borc hesabıdır. Borc Alındı seçilərsə, borc və kassa birlikdə artır.',
            'Это не инвестор. Это долговой счет. При выборе "Получен долг" увеличиваются и долг, и касса.',
            'This is not investor. Debt wallet only. With Borrowed Funds In, both debt and cash increase.',
          ),
        },
      ]
    : [
        {
          value: 'cash',
          label: tx(lang, 'Kassa', 'Касса', 'Cash'),
          helper: tx(lang, 'Xərc kassadan ödənilir.', 'Расход оплачивается из кассы.', 'Expense is paid from cash.'),
        },
        {
          value: 'card',
          label: tx(lang, 'Bank Kartı', 'Банковская карта', 'Bank Card'),
          helper: tx(lang, 'Xərc kartdan ödənilir.', 'Расход оплачивается с карты.', 'Expense is paid from card.'),
        },
        {
          value: 'safe',
          label: tx(lang, 'Seyf', 'Сейф', 'Safe'),
          helper: tx(lang, 'Xərc seyfdən ödənilir.', 'Расход оплачивается из сейфа.', 'Expense is paid from safe.'),
        },
      ];

  const selectedCategory = categoryOptions.find((c) => c.value === category) || categoryOptions[0];
  const selectedSource = sourceOptions.find((s) => s.value === source) || sourceOptions[0];

  useEffect(() => {
    if (!categoryOptions.some((opt) => opt.value === category)) {
      setCategory(categoryOptions[0]?.value || 'other_expense');
    }
    if (!sourceOptions.some((opt) => opt.value === source)) {
      setSource(sourceOptions[0]?.value || 'cash');
    }
  }, [type]);

  const [transferDirection, setTransferDirection] = useState<
    'card_to_cash' | 'cash_to_card' | 'cash_to_debt' | 'card_to_debt' | 'cash_to_safe' | 'safe_to_cash'
  >('card_to_cash');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferCommission, setTransferCommission] = useState('0');
  const [repayAmount, setRepayAmount] = useState('');
  const [repayFrom, setRepayFrom] = useState<'cash' | 'card' | 'safe'>('cash');
  const [repayNote, setRepayNote] = useState('');
  const [balance, setBalance] = useState<any>({
    cash_balance: '0',
    card_balance: '0',
    debt_balance: '0',
    investor_balance: '0',
    safe_balance: '0',
    deposit_balance: '0',
  });
  const [anomalies, setAnomalies] = useState<FinanceAnomalies | null>(null);
  const [serverFinanceAlerts, setServerFinanceAlerts] = useState<FinanceAlert[] | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<FinanceLedgerAccount[]>([]);
  const [ledgerTransactions, setLedgerTransactions] = useState<FinanceLedgerTransaction[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<FinanceLedgerEntry[]>([]);
  const [reconciliations, setReconciliations] = useState<FinanceReconciliation[]>([]);
  const [enterpriseReports, setEnterpriseReports] = useState<FinanceReportsOverview | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<FinanceLedgerTransaction[]>([]);
  const [pendingApprovalsTotal, setPendingApprovalsTotal] = useState(0);
  const [selectedLedgerDetail, setSelectedLedgerDetail] = useState<FinanceTransactionDetail | null>(null);
  const [ledgerDetailLoading, setLedgerDetailLoading] = useState(false);
  const [ledgerPageSize, setLedgerPageSize] = useState(10);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('all');
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState('all');
  const [ledgerAccountFilter, setLedgerAccountFilter] = useState('all');
  const [ledgerCounterpartyFilter, setLedgerCounterpartyFilter] = useState('');
  const [ledgerMinAmount, setLedgerMinAmount] = useState('');
  const [ledgerMaxAmount, setLedgerMaxAmount] = useState('');
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const [ledgerTotalCount, setLedgerTotalCount] = useState(0);
  const [ledgerPageLoading, setLedgerPageLoading] = useState(false);
  const [focusedMode, setFocusedMode] = useState(false);
  const [showAdvancedTxFields, setShowAdvancedTxFields] = useState(false);
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [investorSubmitting, setInvestorSubmitting] = useState(false);
  const [reconcileSubmitting, setReconcileSubmitting] = useState(false);
  const [reconcileAccount, setReconcileAccount] = useState('cash');
  const [reconcileCounted, setReconcileCounted] = useState('');
  const [reconcileNotes, setReconcileNotes] = useState('');
  const [bankCommissionConfig, setBankCommissionConfig] = useState<{ card_sale_percent: number; card_transfer_percent: number }>({
    card_sale_percent: 2,
    card_transfer_percent: 0.5,
  });
  const [financePolicyConfig, setFinancePolicyConfig] = useState({
    large_transfer_threshold_azn: 500,
    investor_repayment_requires_approval: true,
    cash_adjustment_requires_approval: true,
    reversal_requires_approval: true,
    reconciliation_adjustment_requires_approval: true,
    reconciliation_variance_alert_azn: 0.01,
    negative_balance_alert_azn: 0,
    approver_roles: ['manager', 'admin', 'finance_admin', 'super_admin'],
  });
  const lastReloadAtRef = useRef(0);
  const reloadTimerRef = useRef<number | null>(null);

  const applyRangePreset = (preset: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom') => {
    setRangePreset(preset);
    const today = new Date();
    const start = new Date(today);
    const end = new Date(today);
    if (preset === 'weekly') {
      const weekday = start.getDay();
      const diff = weekday === 0 ? 6 : weekday - 1;
      start.setDate(start.getDate() - diff);
    } else if (preset === 'monthly') {
      start.setDate(1);
    } else if (preset === 'yearly') {
      start.setMonth(0, 1);
    }
    if (preset !== 'custom') {
      setFromDate(start.toISOString().slice(0, 10));
      setToDate(end.toISOString().slice(0, 10));
    }
  };

  const computedTransferCommission = useMemo(() => {
    const amount = new Decimal(transferAmount || '0');
    if (transferDirection !== 'card_to_cash' && transferDirection !== 'card_to_debt') {
      return new Decimal(transferCommission || '0');
    }
    if (amount.lte(0)) return new Decimal(0);
    return amount.times(new Decimal(bankCommissionConfig.card_transfer_percent || 0).div(100)).toDecimalPlaces(2);
  }, [transferAmount, transferCommission, transferDirection, bankCommissionConfig.card_transfer_percent]);
  const largeTransferThreshold = useMemo(
    () => new Decimal(financePolicyConfig.large_transfer_threshold_azn || 0),
    [financePolicyConfig.large_transfer_threshold_azn],
  );

  const ledgerServerFilters = useMemo(() => ({
    limit: ledgerPageSize,
    offset: ledgerOffset,
    date_from: fromDate,
    date_to: toDate,
    transaction_type: ledgerTypeFilter === 'all' ? undefined : ledgerTypeFilter,
    status: ledgerStatusFilter === 'all' ? undefined : ledgerStatusFilter,
    account: ledgerAccountFilter === 'all' ? undefined : ledgerAccountFilter,
    counterparty: ledgerCounterpartyFilter.trim() || undefined,
    min_amount: ledgerMinAmount.trim() || undefined,
    max_amount: ledgerMaxAmount.trim() || undefined,
    search: ledgerSearch.trim() || undefined,
  }), [
    fromDate,
    ledgerAccountFilter,
    ledgerCounterpartyFilter,
    ledgerMaxAmount,
    ledgerMinAmount,
    ledgerOffset,
    ledgerPageSize,
    ledgerSearch,
    ledgerStatusFilter,
    ledgerTypeFilter,
    toDate,
  ]);

  useEffect(() => {
    const key = `finance_subject_presets_${tenant_id}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
        if (normalized.length > 0) {
          setSubjectPresets(Array.from(new Set(normalized)));
        }
      }
    } catch {
      // Ignore corrupted local preset data.
    }
  }, [tenant_id]);

  const saveSubjectPresets = (next: string[]) => {
    setSubjectPresets(next);
    localStorage.setItem(`finance_subject_presets_${tenant_id}`, JSON.stringify(next));
  };

  const reloadFinance = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastReloadAtRef.current < 1500) {
      return;
    }
    lastReloadAtRef.current = now;
    try {
      const [summary, b, serverAnomalies] = await Promise.all([
        fetch_finance_summary(tenant_id).catch(() => null),
        fetch_finance_balances(tenant_id),
        fetch_finance_anomalies(tenant_id).catch(() => null),
      ]);
      const summaryBalances = summary?.balances
        ? {
            cash_balance: String(summary.balances.cash || '0'),
            card_balance: String(summary.balances.card || '0'),
            debt_balance: String(summary.balances.debt || '0'),
            investor_balance: String(summary.balances.investor || '0'),
            safe_balance: String(summary.balances.safe || '0'),
            deposit_balance: String(summary.balances.deposit || '0'),
          }
        : null;
      setBalance(summaryBalances || b || {
        cash_balance: '0',
        card_balance: '0',
        debt_balance: '0',
        investor_balance: '0',
        safe_balance: '0',
        deposit_balance: '0',
      });
      setAnomalies(serverAnomalies);
      setPendingApprovals((summary?.pending_approvals_preview || []) as any[]);
      setPendingApprovalsTotal(Number(summary?.pending_approvals_count ?? 0));
      setServerFinanceAlerts((summary?.alerts || null) as any);

      if (!force) return;

      const [e, settings, accounts, transactions, ledgerRows, recRows, pendingRows, alertRows, reportOverview] = await Promise.all([
        fetch_finance_entries(tenant_id).catch(() => []),
        get_settings_live(tenant_id),
        fetch_finance_ledger_accounts(tenant_id).catch(() => []),
        fetch_finance_ledger_transactions(tenant_id, 250).catch(() => []),
        fetch_finance_ledger_entries(tenant_id, 500).catch(() => []),
        fetch_finance_reconciliations(tenant_id, 100).catch(() => []),
        fetch_finance_pending_approvals(tenant_id).catch(() => []),
        fetch_finance_alerts(tenant_id).catch(() => null),
        fetch_finance_reports_overview(tenant_id, { date_from: fromDate, date_to: toDate }).catch(() => null),
      ]);
      setEntries(e || []);
      setLedgerAccounts(accounts);
      setLedgerTransactions(transactions);
      setLedgerEntries(ledgerRows);
      setReconciliations(recRows);
      setEnterpriseReports(reportOverview);
      setPendingApprovals((summary?.pending_approvals_preview?.length ? summary.pending_approvals_preview : pendingRows) || []);
      setPendingApprovalsTotal(Number(summary?.pending_approvals_count ?? pendingRows.length ?? 0));
      setServerFinanceAlerts((summary?.alerts?.length ? summary.alerts : alertRows) || null);
      setBankCommissionConfig({
        card_sale_percent: Number((settings.bank_commission as any)?.card_sale_percent ?? settings.bank_commission?.percent ?? 2),
        card_transfer_percent: Number((settings.bank_commission as any)?.card_transfer_percent ?? 0.5),
      });
      setFinancePolicyConfig({
        large_transfer_threshold_azn: Number(settings.finance_policy?.large_transfer_threshold_azn ?? 500),
        investor_repayment_requires_approval: settings.finance_policy?.investor_repayment_requires_approval !== false,
        cash_adjustment_requires_approval: settings.finance_policy?.cash_adjustment_requires_approval !== false,
        reversal_requires_approval: settings.finance_policy?.reversal_requires_approval !== false,
        reconciliation_adjustment_requires_approval: settings.finance_policy?.reconciliation_adjustment_requires_approval !== false,
        reconciliation_variance_alert_azn: Number(settings.finance_policy?.reconciliation_variance_alert_azn ?? 0.01),
        negative_balance_alert_azn: Number(settings.finance_policy?.negative_balance_alert_azn ?? 0),
        approver_roles: Array.isArray(settings.finance_policy?.approver_roles) ? settings.finance_policy!.approver_roles : ['manager', 'admin', 'finance_admin', 'super_admin'],
      });
    } catch (err: any) {
      notify('error', err?.message || tx(lang, 'Maliyyə məlumatları yüklənmədi', 'Не удалось загрузить финансы'));
    }
  }, [tenant_id, notify, lang, fromDate, toDate]);

  useEffect(() => {
    void reloadFinance(true);
  }, [tenant_id, reloadFinance]);

  useEffect(() => {
    setLedgerOffset(0);
  }, [
    fromDate,
    ledgerAccountFilter,
    ledgerCounterpartyFilter,
    ledgerMaxAmount,
    ledgerMinAmount,
    ledgerPageSize,
    ledgerSearch,
    ledgerStatusFilter,
    ledgerTypeFilter,
    tenant_id,
    toDate,
  ]);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        setLedgerPageLoading(true);
        const page = await fetch_finance_ledger_transactions_page(tenant_id, ledgerServerFilters);
        if (!alive) return;
        setLedgerTransactions(page.rows || []);
        setLedgerTotalCount(page.total || 0);
      } catch {
        // Keep the last loaded ledger snapshot if server-side filtering fails.
      } finally {
        if (alive) setLedgerPageLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [ledgerServerFilters, tenant_id]);

  useEffect(() => {
    const handleFinanceUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      if (!detail?.tenant_id || detail.tenant_id === tenant_id) {
        setBalance(get_balance(tenant_id, 'all', false) as any);
        setEntries(get_finance_entries(tenant_id));
        setAnomalies(null);
        setServerFinanceAlerts(null);
        if (reloadTimerRef.current) {
          window.clearTimeout(reloadTimerRef.current);
        }
        reloadTimerRef.current = window.setTimeout(() => {
          void reloadFinance();
        }, 350);
      }
    };
    window.addEventListener('finance-updated', handleFinanceUpdated as EventListener);
    return () => {
      window.removeEventListener('finance-updated', handleFinanceUpdated as EventListener);
      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current);
      }
    };
  }, [tenant_id, reloadFinance]);

  useEffect(() => {
    applyRangePreset('daily');
  }, [tenant_id]);

  const ledgerInvestorDebt = useMemo(
    () => Decimal.max(new Decimal(0), new Decimal(anomalies?.investor_ledger_balance || balance.investor_balance || 0)),
    [anomalies?.investor_ledger_balance, balance.investor_balance],
  );

  const filteredEntries = useMemo(() => {
    const start = new Date(fromDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    return entries
      .filter((e: any) => {
      const t = new Date(e.created_at).getTime();
      return t >= start.getTime() && t <= end.getTime();
      })
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [entries, fromDate, toDate]);

  const visibleEntries = useMemo(() => filteredEntries.slice(0, ledgerPageSize), [filteredEntries, ledgerPageSize]);
  const ledgerAccountByCode = useMemo(() => {
    const map = new Map<string, FinanceLedgerAccount>();
    ledgerAccounts.forEach((account) => map.set(account.code, account));
    return map;
  }, [ledgerAccounts]);
  const ledgerTransactionTypes = useMemo(
    () =>
      Array.from(new Set([
        'income',
        'expense',
        'internal_transfer',
        'investor_repayment',
        'deposit_hold',
        'deposit_apply_to_bill',
        'deposit_release',
        'deposit_refund',
        'cash_adjustment',
        'reconciliation_adjustment',
        'reversal',
        ...ledgerTransactions.map((row) => row.transaction_type).filter(Boolean),
      ])).sort(),
    [ledgerTransactions],
  );
  const ledgerTransactionStatuses = useMemo(
    () =>
      Array.from(new Set([
        'pending_approval',
        'approved',
        'posted',
        'rejected',
        'reversed',
        ...ledgerTransactions.map((row) => row.status || 'posted').filter(Boolean),
      ])).sort(),
    [ledgerTransactions],
  );
  const filteredLedgerTransactions = useMemo(() => {
    const decimalOrNull = (value: string) => {
      if (!value.trim()) return null;
      try {
        return new Decimal(value);
      } catch {
        return null;
      }
    };
    const start = new Date(fromDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    const startTime = start.getTime();
    const endTime = end.getTime();
    const search = normalizeFinanceText(ledgerSearch);
    const counterparty = normalizeFinanceText(ledgerCounterpartyFilter);
    const minAmount = decimalOrNull(ledgerMinAmount);
    const maxAmount = decimalOrNull(ledgerMaxAmount);

    return ledgerTransactions
      .filter((row) => {
        const dateValue = row.posted_at || row.created_at || '';
        const rowTime = new Date(dateValue).getTime();
        if (Number.isFinite(rowTime) && (rowTime < startTime || rowTime > endTime)) return false;
        if (ledgerTypeFilter !== 'all' && row.transaction_type !== ledgerTypeFilter) return false;
        if (ledgerStatusFilter !== 'all' && (row.status || 'posted') !== ledgerStatusFilter) return false;
        if (
          ledgerAccountFilter !== 'all' &&
          row.source_account !== ledgerAccountFilter &&
          row.destination_account !== ledgerAccountFilter
        ) {
          return false;
        }
        if (counterparty && !normalizeFinanceText(row.counterparty || '').includes(counterparty)) return false;
        const amountValue = new Decimal(row.amount || 0);
        if (minAmount && amountValue.lt(minAmount)) return false;
        if (maxAmount && amountValue.gt(maxAmount)) return false;
        if (search) {
          const haystack = normalizeFinanceText([
            row.id,
            row.transaction_type,
            row.status,
            row.source_account,
            row.destination_account,
            row.category,
            row.counterparty,
            row.reference,
            row.note,
            row.created_by,
            row.posted_by,
          ].join(' '));
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aTime = new Date(a.posted_at || a.created_at || '').getTime();
        const bTime = new Date(b.posted_at || b.created_at || '').getTime();
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      });
  }, [
    fromDate,
    toDate,
    ledgerAccountFilter,
    ledgerCounterpartyFilter,
    ledgerMaxAmount,
    ledgerMinAmount,
    ledgerSearch,
    ledgerStatusFilter,
    ledgerTransactions,
    ledgerTypeFilter,
  ]);
  const visibleLedgerTransactions = useMemo(
    () => filteredLedgerTransactions,
    [filteredLedgerTransactions],
  );
  const ledgerPageStart = ledgerTotalCount === 0 ? 0 : ledgerOffset + 1;
  const ledgerPageEnd = ledgerTotalCount === 0 ? 0 : Math.min(ledgerOffset + ledgerPageSize, ledgerTotalCount);
  const ledgerCurrentPage = Math.floor(ledgerOffset / ledgerPageSize) + 1;
  const ledgerTotalPages = Math.max(1, Math.ceil((ledgerTotalCount || 0) / ledgerPageSize));
  const canGoPreviousLedgerPage = ledgerOffset > 0;
  const canGoNextLedgerPage = ledgerOffset + ledgerPageSize < ledgerTotalCount;
  const clearLedgerFilters = () => {
    setLedgerSearch('');
    setLedgerTypeFilter('all');
    setLedgerStatusFilter('all');
    setLedgerAccountFilter('all');
    setLedgerCounterpartyFilter('');
    setLedgerMinAmount('');
    setLedgerMaxAmount('');
    setLedgerOffset(0);
  };
  const selectedReconcileAccount = ledgerAccountByCode.get(reconcileAccount);
  const expectedReconcileBalance = useMemo(() => {
    if (selectedReconcileAccount) return new Decimal(selectedReconcileAccount.ledger_balance || 0);
    const balanceMap: Record<string, string> = {
      cash: balance.cash_balance || '0',
      card: balance.card_balance || '0',
      safe: balance.safe_balance || '0',
      deposit: balance.deposit_balance || '0',
      investor: balance.investor_balance || '0',
      debt: balance.debt_balance || '0',
    };
    return new Decimal(balanceMap[reconcileAccount] || '0');
  }, [balance, reconcileAccount, selectedReconcileAccount]);
  const reconcileVariance = useMemo(
    () => new Decimal(reconcileCounted || '0').minus(expectedReconcileBalance),
    [reconcileCounted, expectedReconcileBalance],
  );

  const operationalEntries = useMemo(
    () => filteredEntries.filter((entry: any) => isOperationalFinanceEntry(entry)),
    [filteredEntries],
  );

  const depositsInRange = useMemo(
    () =>
      filteredEntries.reduce((sum: Decimal, entry: any) => {
        const category = normalizeFinanceText(entry?.category);
        const description = normalizeFinanceText(entry?.description);
        const isDeposit = category.includes('depozit') || description.includes('depozit') || description.includes('deposit');
        if (entry?.type === 'in' && isDeposit) {
          return sum.plus(new Decimal(entry.amount || 0));
        }
        return sum;
      }, new Decimal(0)),
    [filteredEntries],
  );

  const financeSummary = useMemo(() => {
    const incoming = operationalEntries
      .filter((e: any) => e.type === 'in')
      .reduce((sum: Decimal, e: any) => sum.plus(new Decimal(e.amount || 0)), new Decimal(0));
    const outgoing = operationalEntries
      .filter((e: any) => e.type === 'out')
      .reduce((sum: Decimal, e: any) => sum.plus(new Decimal(e.amount || 0)), new Decimal(0));
    const net = incoming.minus(outgoing);
    const biggestExpense = operationalEntries
      .filter((e: any) => e.type === 'out')
      .reduce((max: any, row: any) => {
        if (!max) return row;
        return new Decimal(row.amount || 0).gt(new Decimal(max.amount || 0)) ? row : max;
      }, null);
    return {
      incoming,
      outgoing,
      net,
      entriesCount: operationalEntries.length,
      biggestExpense,
    };
  }, [operationalEntries]);

  const financeHealthTone = useMemo(() => {
    if (financeSummary.net.gte(0)) return 'text-emerald-300';
    if (financeSummary.net.gte(new Decimal('-50'))) return 'text-amber-300';
    return 'text-rose-300';
  }, [financeSummary.net]);

  const cashCoverage = useMemo(() => {
    const liquid = new Decimal(balance.cash_balance || 0)
      .plus(new Decimal(balance.card_balance || 0))
      .plus(new Decimal(balance.safe_balance || 0));
    const obligations = ledgerInvestorDebt
      .plus(new Decimal(balance.debt_balance || 0));
    if (obligations.lte(0)) return 'N/A';
    return liquid.div(obligations).times(100).toFixed(0);
  }, [balance.cash_balance, balance.card_balance, balance.safe_balance, balance.debt_balance, ledgerInvestorDebt]);

  const financeExceptions = useMemo(() => {
    const items: Array<{ title: string; body: string; tone: 'rose' | 'amber' | 'sky' }> = [];
    const depositLiability = new Decimal(anomalies?.deposit_balance || balance.deposit_balance || 0);
    const cashBalance = new Decimal(balance.cash_balance || 0);

    if (depositLiability.greaterThan(cashBalance)) {
      items.push({
        title: tx(lang, 'Depozit riski', 'Риск депозитов', 'Deposit risk'),
        body: tx(
          lang,
          `Aktiv depozit öhdəliyi kassadakı nağddan ${depositLiability.minus(cashBalance).toFixed(2)} ₼ çoxdur.`,
          `Активное обязательство по депозитам на ${depositLiability.minus(cashBalance).toFixed(2)} ₼ выше наличности в кассе.`,
          `Active deposit liability exceeds cash drawer by ${depositLiability.minus(cashBalance).toFixed(2)} ₼.`,
        ),
        tone: 'amber',
      });
    }

    if (financeSummary.net.lessThan(0)) {
      items.push({
        title: tx(lang, 'Mənfi operativ nəticə', 'Отрицательный операционный итог', 'Negative operational net'),
        body: tx(
          lang,
          `Seçilmiş dövrdə operativ net nəticə ${financeSummary.net.toFixed(2)} ₼-dir.`,
          `Операционный нетто итог за период составляет ${financeSummary.net.toFixed(2)} ₼.`,
          `Operational net for the selected period is ${financeSummary.net.toFixed(2)} ₼.`,
        ),
        tone: 'sky',
      });
    }

    if (anomalies?.has_reconciliation_issue) {
      items.push({
        title: tx(lang, 'Satış və ledger fərqi', 'Расхождение продаж и ledger', 'Sales vs ledger gap'),
        body: tx(
          lang,
          `Backend audit satış gəliri ilə ledger satış daxilolması arasında ${new Decimal(anomalies.reconciliation_gap || 0).toFixed(2)} ₼ fərq göstərir.`,
          `Backend audit показывает расхождение ${new Decimal(anomalies.reconciliation_gap || 0).toFixed(2)} ₼ между выручкой и ledger.`,
          `Backend audit shows a ${new Decimal(anomalies.reconciliation_gap || 0).toFixed(2)} ₼ gap between revenue and ledger.`,
        ),
        tone: 'rose',
      });
    }

    if (anomalies?.has_shift_cash_mismatch) {
      items.push({
        title: tx(lang, 'Shift kassa uyğunsuzluğu', 'Несовпадение кассы смены', 'Shift cash mismatch'),
        body: tx(
          lang,
          `Backend audit aktiv növbə üçün ${new Decimal(anomalies.shift_cash_gap || 0).toFixed(2)} ₼ kassa fərqi göstərir.`,
          `Backend audit показывает расхождение кассы смены ${new Decimal(anomalies.shift_cash_gap || 0).toFixed(2)} ₼.`,
          `Backend audit shows a ${new Decimal(anomalies.shift_cash_gap || 0).toFixed(2)} ₼ shift cash gap.`,
        ),
        tone: 'rose',
      });
    }

    if (anomalies?.has_closed_shift_open_deposit) {
      items.push({
        title: tx(lang, 'Bağlı növbədə açıq depozit var', 'При закрытой смене есть активный депозит', 'Closed shift has active deposits'),
        body: tx(
          lang,
          `Backend audit bağlı növbədə ${new Decimal(anomalies.deposit_balance || 0).toFixed(2)} ₼ aktiv depozit öhdəliyi göstərir.`,
          `Backend audit показывает ${new Decimal(anomalies.deposit_balance || 0).toFixed(2)} ₼ активного депозитного обязательства при закрытой смене.`,
          `Backend audit shows ${new Decimal(anomalies.deposit_balance || 0).toFixed(2)} ₼ of active deposit liability while shift is closed.`,
        ),
        tone: 'amber',
      });
    }

    return items;
  }, [anomalies, balance.cash_balance, balance.deposit_balance, financeSummary.net, lang]);

  const exportCsv = async () => {
    const esc = (value: unknown) => {
      const s = String(value ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };

    if (workspaceTab === 'ledger') {
      const exportPage = await fetch_finance_ledger_transactions_page(tenant_id, {
        ...ledgerServerFilters,
        limit: 1000,
        offset: 0,
      }).catch(() => ({
        rows: filteredLedgerTransactions,
        total: filteredLedgerTransactions.length,
        limit: 1000,
        offset: 0,
      }));
      const ledgerRowsForExport = exportPage.rows || filteredLedgerTransactions;
      if (!ledgerRowsForExport.length) {
        notify('error', tx(lang, 'Export üçün ledger məlumatı yoxdur', 'Нет ledger данных для экспорта', 'No ledger data to export'));
        return;
      }
      const header = [
        'created_at',
        'posted_at',
        'status',
        'type',
        'source_account',
        'destination_account',
        'amount',
        'currency',
        'category',
        'counterparty',
        'reference',
        'note',
        'created_by',
        'approved_by',
        'posted_by',
        'reversed_by',
      ];
      const rows = ledgerRowsForExport.map((row) => [
        esc(row.created_at),
        esc(row.posted_at),
        esc(row.status || 'posted'),
        esc(row.transaction_type),
        esc(accountName(row.source_account)),
        esc(accountName(row.destination_account)),
        esc(new Decimal(row.amount || 0).toFixed(2)),
        esc(row.currency || 'AZN'),
        esc(row.category || ''),
        esc(row.counterparty || ''),
        esc(row.reference || ''),
        esc(row.note || ''),
        esc(row.created_by || ''),
        esc(row.approved_by || ''),
        esc(row.posted_by || ''),
        esc(row.reversed_by || ''),
      ]);
      const csv = [header.map(esc).join(';'), ...rows.map((r) => r.join(';'))].join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finance_ledger_${fromDate}_${toDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (!filteredEntries.length) {
      notify('error', tx(lang, 'Export üçün məlumat yoxdur', 'Нет данных для экспорта', 'No data to export'));
      return;
    }

    const header = ['created_at', 'direction', 'category', 'source', 'amount', 'counterparty', 'description'];
    const rows = filteredEntries.map((e: any) => [
      esc(e.created_at),
      esc(e.type === 'in' ? tx(lang, 'Giriş', 'Приход', 'Incoming') : tx(lang, 'Çıxış', 'Расход', 'Outgoing')),
      esc(e.category),
      esc(e.source),
      esc(e.amount),
      esc(String(e.description || '').split('|').find((part: string) => part.includes('Subyekt:'))?.replace('Subyekt:', '').trim() || ''),
      esc(e.description),
    ]);
    const summaryRows = [
      [esc('SUMMARY'), esc(tx(lang, 'Operativ girişlər', 'Операционные поступления', 'Operational Incoming')), esc(''), esc(''), esc(financeSummary.incoming.toFixed(2)), esc('')],
      [esc('SUMMARY'), esc(tx(lang, 'Operativ çıxışlar', 'Операционные расходы', 'Operational Outgoing')), esc(''), esc(''), esc(financeSummary.outgoing.toFixed(2)), esc('')],
      [esc('SUMMARY'), esc(tx(lang, 'Operativ net nəticə', 'Операционный нетто итог', 'Operational Net')), esc(''), esc(''), esc(financeSummary.net.toFixed(2)), esc('')],
      [esc('SUMMARY'), esc(tx(lang, 'Toplanan depozit', 'Собранные депозиты', 'Collected Deposits')), esc(''), esc(''), esc(depositsInRange.toFixed(2)), esc('')],
      [esc('SUMMARY'), esc(tx(lang, 'Nağd kassa qalığı', 'Остаток кассы', 'Cash Balance')), esc(''), esc(''), esc(new Decimal(balance.cash_balance || 0).toFixed(2)), esc('')],
      [esc('SUMMARY'), esc(tx(lang, 'Kart qalığı', 'Остаток карты', 'Card Balance')), esc(''), esc(''), esc(new Decimal(balance.card_balance || 0).toFixed(2)), esc('')],
      [esc('SUMMARY'), esc(tx(lang, 'Seyf qalığı', 'Остаток сейфа', 'Safe Balance')), esc(''), esc(''), esc(new Decimal(balance.safe_balance || 0).toFixed(2)), esc('')],
      [esc('SUMMARY'), esc(tx(lang, 'Digər borc öhdəliyi', 'Прочие долговые обязательства', 'Other Debt Liability')), esc(''), esc(''), esc(new Decimal(balance.debt_balance || 0).toFixed(2)), esc('')],
      [esc('SUMMARY'), esc(tx(lang, 'İnvestor borcu', 'Долг инвестору', 'Investor Debt')), esc(''), esc(''), esc(ledgerInvestorDebt.toFixed(2)), esc('')],
      [esc('SUMMARY'), esc(tx(lang, 'Aktiv masa depozit öhdəliyi', 'Активное обязательство по депозитам столов', 'Active Table Deposit Liability')), esc(''), esc(''), esc(new Decimal(balance.deposit_balance || 0).toFixed(2)), esc('')],
    ];
    // Use semicolon delimiter + UTF-8 BOM for Excel locale compatibility.
    const csv = [header.map(esc).join(';'), ...rows.map((r) => r.join(';')), ...summaryRows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendFinanceSummary = async () => {
    const html = `
      <h2>${tx(lang, 'Maliyyə Xülasəsi', 'Финансовая сводка', 'Finance Summary')}</h2>
      <p><b>${tx(lang, 'Dövr', 'Период', 'Period')}:</b> ${fromDate} - ${toDate}</p>
      <p><b>${tx(lang, 'Operativ girişlər', 'Операционные поступления', 'Operational Incoming')}:</b> ${financeSummary.incoming.toFixed(2)} ₼</p>
      <p><b>${tx(lang, 'Operativ çıxışlar', 'Операционные расходы', 'Operational Outgoing')}:</b> ${financeSummary.outgoing.toFixed(2)} ₼</p>
      <p><b>${tx(lang, 'Operativ net nəticə', 'Операционный нетто итог', 'Operational Net')}:</b> ${financeSummary.net.toFixed(2)} ₼</p>
      <p><b>${tx(lang, 'Toplanan depozit', 'Собранные депозиты', 'Collected Deposits')}:</b> ${depositsInRange.toFixed(2)} ₼</p>
      <p><b>${tx(lang, 'Nağd kassa qalığı', 'Остаток кассы', 'Cash Balance')}:</b> ${new Decimal(balance.cash_balance || 0).toFixed(2)} ₼</p>
      <p><b>${tx(lang, 'Kart qalığı', 'Остаток карты', 'Card Balance')}:</b> ${new Decimal(balance.card_balance || 0).toFixed(2)} ₼</p>
      <p><b>${tx(lang, 'Aktiv masa depozit öhdəliyi', 'Активное обязательство по депозитам столов', 'Active Table Deposit Liability')}:</b> ${new Decimal(balance.deposit_balance || 0).toFixed(2)} ₼</p>
      <p><b>${tx(lang, 'İnvestor borcu', 'Долг инвестору', 'Investor Debt')}:</b> ${ledgerInvestorDebt.toFixed(2)} ₼</p>
      <p><b>${tx(lang, 'Operativ qeyd sayı', 'Количество операционных записей', 'Operational Entries')}:</b> ${financeSummary.entriesCount}</p>
      <p style="color:#64748b;font-size:12px">${tx(lang, 'Qeyd: operativ net nəticəyə açılış, investor, depozit və daxili transferlər daxil deyil.', 'Примечание: в операционный нетто итог не входят открытие смены, инвестор, депозиты и внутренние переводы.', 'Note: operational net excludes opening, investor, deposits, and internal transfers.')}</p>
    `;
    try {
      const sent = await send_email({
        tenant_id,
        subject: tx(lang, 'Maliyyə Xülasəsi', 'Финансовая сводка', 'Finance Summary') + ` ${fromDate} - ${toDate}`,
        html,
      });
      notify(sent.success ? 'success' : 'error', sent.message);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Maliyyə email göndərilmədi', 'Финансовый email не отправлен', 'Finance email was not sent'));
    }
  };

  const addEntry = async () => {
    if (entrySubmitting) return;
    if (!amount || new Decimal(amount).lte(0)) {
      notify('error', tx(lang, 'Məbləğ düzgün deyil', 'Неверная сумма'));
      return;
    }
    if (type === 'out' && !subject.trim()) {
      notify('error', tx(lang, 'Subyekt məcburidir', 'Поле субъекта обязательно', 'Subject is required'));
      return;
    }
    setEntrySubmitting(true);
    try {
      await create_finance_entry_async(
        tenant_id,
        type,
        category,
        new Decimal(amount).toString(),
        source,
        `${description}${subject ? ` | Subyekt: ${subject}` : ''}`,
        user?.username || 'admin',
      );
      setAmount('');
      setDescription('');
      setSubject('');
      await reloadFinance();
      notify('success', tx(lang, 'Əməliyyat yazıldı', 'Операция сохранена', 'Entry saved'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Əməliyyat alınmadı', 'Операция не выполнена'));
    } finally {
      setEntrySubmitting(false);
    }
  };

  const addSubjectPreset = () => {
    const nextVal = newSubjectPreset.trim();
    if (!nextVal) return;
    if (subjectPresets.some((p) => p.toLowerCase() === nextVal.toLowerCase())) {
      setSubject(nextVal);
      setNewSubjectPreset('');
      return;
    }
    const next = [...subjectPresets, nextVal];
    saveSubjectPresets(next);
    setSubject(nextVal);
    setNewSubjectPreset('');
    notify('success', tx(lang, 'Yeni subyekt preset əlavə olundu', 'Добавлен новый пресет субъекта', 'Subject preset added'));
  };

  const doTransfer = async () => {
    if (transferSubmitting) return;
    if (!transferAmount || new Decimal(transferAmount).lte(0)) {
      notify('error', tx(lang, 'Transfer məbləği düzgün deyil', 'Некорректная сумма перевода'));
      return;
    }
    setTransferSubmitting(true);
    try {
      const transferAmountDec = new Decimal(transferAmount || 0);
      const needsApproval = largeTransferThreshold.gt(0) && transferAmountDec.gte(largeTransferThreshold);
      if (needsApproval) {
        const sources = {
          card_to_cash: { from: 'card', to: 'cash' },
          cash_to_card: { from: 'cash', to: 'card' },
          cash_to_debt: { from: 'cash', to: 'debt' },
          card_to_debt: { from: 'card', to: 'debt' },
          cash_to_safe: { from: 'cash', to: 'safe' },
          safe_to_cash: { from: 'safe', to: 'cash' },
        } as const;
        const pair = sources[transferDirection];
        await create_finance_ledger_transaction_async(tenant_id, {
          transaction_type: 'internal_transfer',
          source_account_code: pair.from,
          destination_account_code: pair.to,
          amount: transferAmountDec.toString(),
          category: 'Daxili Transfer',
          note: `Approval transfer: ${transferDirection}`,
          requires_approval: true,
        });
        if (computedTransferCommission.gt(0)) {
          await create_finance_ledger_transaction_async(tenant_id, {
            transaction_type: 'expense',
            source_account_code: pair.from,
            destination_account_code: 'expense',
            amount: computedTransferCommission.toString(),
            category: 'Bank Komissiyası',
            note: `Approval transfer komissiyası: ${transferDirection}`,
            requires_approval: true,
          });
        }
        setTransferAmount('');
        setTransferCommission('0');
        await reloadFinance(true);
        notify('success', tx(lang, 'Transfer təsdiqə göndərildi', 'Перевод отправлен на approval', 'Transfer sent for approval'));
        return;
      }
      await transfer_funds_async(
        tenant_id,
        transferDirection,
        transferAmount,
        computedTransferCommission.toString(),
        user?.username || 'admin',
      );
      setTransferAmount('');
      setTransferCommission('0');
      await reloadFinance();
      notify('success', tx(lang, 'Transfer tamamlandı', 'Перевод выполнен'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Transfer alınmadı', 'Перевод не выполнен'));
    } finally {
      setTransferSubmitting(false);
    }
  };

  const doRepayInvestor = async () => {
    if (investorSubmitting) return;
    if (!repayAmount || new Decimal(repayAmount).lte(0)) {
      notify('error', tx(lang, 'Məbləğ düzgün deyil', 'Некорректная сумма', 'Invalid amount'));
      return;
    }
    setInvestorSubmitting(true);
    try {
      const repaymentAmount = new Decimal(repayAmount || 0);
      const available = new Decimal((balance as any)[`${repayFrom}_balance`] || 0);
      if (available.lt(repaymentAmount)) {
        notify('error', tx(lang, 'Seçilən mənbədə kifayət qədər vəsait yoxdur', 'В выбранном источнике недостаточно средств', 'Selected source has insufficient balance'));
        return;
      }
      if (ledgerInvestorDebt.lte(0)) {
        notify('error', tx(lang, 'İnvestora borc yoxdur', 'Нет долга инвестору', 'No investor debt'));
        return;
      }
      const payable = Decimal.min(repaymentAmount, ledgerInvestorDebt);
      const result = await create_finance_ledger_transaction_async(tenant_id, {
        transaction_type: 'investor_repayment',
        source_account_code: repayFrom,
        destination_account_code: 'investor',
        amount: payable.toString(),
        category: 'İnvestora Geri Ödəniş',
          note: repayNote || 'İnvestora ödəniş approval request',
        requires_approval: financePolicyConfig.investor_repayment_requires_approval,
      });
      setRepayAmount('');
      setRepayNote('');
      await reloadFinance(true);
      notify(
        'success',
        tx(
          lang,
          financePolicyConfig.investor_repayment_requires_approval
            ? `İnvestor ödənişi təsdiqə göndərildi: ${new Decimal(payable).toFixed(2)} ₼`
            : `İnvestor ödənişi post edildi: ${new Decimal(payable).toFixed(2)} ₼`,
          financePolicyConfig.investor_repayment_requires_approval
            ? `Выплата инвестору отправлена на approval: ${new Decimal(payable).toFixed(2)} ₼`
            : `Выплата инвестору проведена: ${new Decimal(payable).toFixed(2)} ₼`,
          financePolicyConfig.investor_repayment_requires_approval
            ? `Investor repayment sent for approval: ${new Decimal(payable).toFixed(2)} ₼`
            : `Investor repayment posted: ${new Decimal(payable).toFixed(2)} ₼`,
        ),
      );
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Ödəniş alınmadı', 'Платеж не выполнен', 'Repayment failed'));
    } finally {
      setInvestorSubmitting(false);
    }
  };

  const doReconcile = async () => {
    if (reconcileSubmitting) return;
    if (!reconcileCounted || new Decimal(reconcileCounted).isNaN()) {
      notify('error', tx(lang, 'Sayılmış məbləği yazın', 'Введите посчитанную сумму', 'Enter counted amount'));
      return;
    }
    setReconcileSubmitting(true);
    try {
      const result = await create_finance_reconciliation_async(
        tenant_id,
        reconcileAccount,
        expectedReconcileBalance.toString(),
        new Decimal(reconcileCounted).toString(),
        reconcileNotes,
      );
      setReconcileCounted('');
      setReconcileNotes('');
      await reloadFinance(true);
      notify(
        'success',
        tx(
          lang,
          `Reconciliation yazıldı. Fərq: ${new Decimal(result?.variance || 0).toFixed(2)} ₼`,
          `Сверка записана. Разница: ${new Decimal(result?.variance || 0).toFixed(2)} ₼`,
          `Reconciliation recorded. Variance: ${new Decimal(result?.variance || 0).toFixed(2)} ₼`,
        ),
      );
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Reconciliation alınmadı', 'Сверка не выполнена', 'Reconciliation failed'));
    } finally {
      setReconcileSubmitting(false);
    }
  };

  const openLedgerDetail = async (transaction: FinanceLedgerTransaction) => {
    const localEntries = ledgerEntries.filter((entry) => entry.transaction_id === transaction.id);
    setSelectedLedgerDetail({
      transaction,
      entries: localEntries,
      audit_logs: [],
    });
    setLedgerDetailLoading(true);
    try {
      const detail = await fetch_finance_transaction_detail(tenant_id, transaction.id);
      setSelectedLedgerDetail(detail);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Transaction detail yüklənmədi', 'Детали transaction не загружены', 'Transaction detail failed to load'));
    } finally {
      setLedgerDetailLoading(false);
    }
  };

  const approveTransaction = async (transactionId: string) => {
    try {
      await approve_finance_transaction_async(tenant_id, transactionId);
      await reloadFinance(true);
      if (selectedLedgerDetail?.transaction.id === transactionId) {
        const detail = await fetch_finance_transaction_detail(tenant_id, transactionId);
        setSelectedLedgerDetail(detail);
      }
      notify('success', tx(lang, 'Transaction təsdiqləndi və post edildi', 'Transaction подтвержден и posted', 'Transaction approved and posted'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Approval alınmadı', 'Approval не выполнен', 'Approval failed'));
    }
  };

  const rejectTransaction = async (transactionId: string) => {
    try {
      await reject_finance_transaction_async(tenant_id, transactionId);
      await reloadFinance(true);
      if (selectedLedgerDetail?.transaction.id === transactionId) {
        setSelectedLedgerDetail(null);
      }
      notify('success', tx(lang, 'Transaction rədd edildi', 'Transaction отклонен', 'Transaction rejected'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Reject alınmadı', 'Reject не выполнен', 'Reject failed'));
    }
  };

  const requestReversal = async (transactionId: string) => {
    try {
      const result = await request_finance_reversal_async(tenant_id, transactionId);
      await reloadFinance(true);
      notify(
        'success',
        tx(
          lang,
          `Reversal təsdiqə göndərildi: ${result?.transaction_id || ''}`,
          `Reversal отправлен на approval: ${result?.transaction_id || ''}`,
          `Reversal sent for approval: ${result?.transaction_id || ''}`,
        ),
      );
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Reversal request alınmadı', 'Reversal request не выполнен', 'Reversal request failed'));
    }
  };

  const todayInflow = financeSummary.incoming;
  const todayOutflow = financeSummary.outgoing;
  const unreconciledVariance = anomalies?.shift_cash_gap || '0';
  const pendingApprovalsCount = pendingApprovalsTotal;
  const fallbackFinanceAlerts = [
    ...(pendingApprovals.length > 0
      ? [{
          id: 'pending-approvals',
          title: tx(lang, 'Təsdiq gözləyən əməliyyatlar', 'Операции ожидают approval', 'Pending approvals'),
          body: `${pendingApprovals.length} ${tx(lang, 'maliyyə əməliyyatı təsdiq gözləyir', 'финансовых операций ожидают подтверждения', 'finance transactions waiting for approval')}`,
          tone: 'amber' as const,
          action: tx(lang, 'Təsdiqlə', 'Подтвердить', 'Approve'),
          tab: 'overview' as FinanceWorkspaceTab,
        }]
      : []),
    ...(anomalies?.has_shift_cash_mismatch
      ? [{
          id: 'unreconciled-till',
          title: tx(lang, 'Uyğunlaşdırılmamış kassa', 'Несверенная касса', 'Unreconciled till'),
          body: `${tx(lang, 'Kassa fərqi', 'Расхождение кассы', 'Cash gap')}: ${new Decimal(anomalies.shift_cash_gap || 0).toFixed(2)} ₼`,
          tone: 'rose' as const,
          action: tx(lang, 'Uyğunlaşdır', 'Сверить', 'Reconcile'),
          tab: 'reconciliation' as FinanceWorkspaceTab,
        }]
      : []),
    ...(new Decimal(balance.cash_balance || 0).lessThan(0)
      ? [{
          id: 'negative-cash',
          title: tx(lang, 'Mənfi kassa riski', 'Риск отрицательной кассы', 'Negative cash risk'),
          body: tx(lang, 'Nağd kassa mənfidir. Ledger və manual entry-ləri yoxlayın.', 'Касса отрицательная. Проверьте ledger и ручные записи.', 'Cash drawer is negative. Review ledger and manual entries.'),
          tone: 'rose' as const,
          action: tx(lang, 'Bax', 'Проверить', 'Review'),
          tab: 'ledger' as FinanceWorkspaceTab,
        }]
      : []),
    ...(ledgerInvestorDebt.greaterThan(0)
      ? [{
          id: 'investor-balance',
          title: tx(lang, 'Açıq investor borcu', 'Открыт долг инвестору', 'Investor balance open'),
          body: `${tx(lang, 'Qalan borc', 'Остаток долга', 'Remaining debt')}: ${ledgerInvestorDebt.toFixed(2)} ₼`,
          tone: 'amber' as const,
          action: tx(lang, 'Investor', 'Инвестор', 'Investor'),
          tab: 'investor' as FinanceWorkspaceTab,
        }]
      : []),
    ...(financeExceptions.length > 0
      ? [{
          id: 'audit-exceptions',
          title: tx(lang, 'Audit warning var', 'Есть audit warning', 'Audit warning'),
          body: `${financeExceptions.length} ${tx(lang, 'maliyyə nəzarət siqnalı var', 'финансовых сигналов контроля', 'finance control signals')}`,
          tone: 'amber' as const,
          action: tx(lang, 'Bax', 'Проверить', 'Review'),
          tab: 'overview' as FinanceWorkspaceTab,
        }]
      : []),
  ];
  const financeAlerts = (serverFinanceAlerts ?? fallbackFinanceAlerts)
    .filter((alert) => ['overview', 'transactions', 'transfers', 'reconciliation', 'investor', 'deposits', 'ledger'].includes(alert.tab))
    .map((alert) => ({
      id: alert.id,
      title: alert.title,
      body: alert.body,
      tone: alert.tone === 'rose' ? 'rose' as const : 'amber' as const,
      action: alert.action,
      tab: alert.tab as FinanceWorkspaceTab,
    }));

  const openFinanceAlert = (alert: { id: string; tab: FinanceWorkspaceTab }) => {
    setWorkspaceTab(alert.tab);
    if (alert.id === 'pending-approvals') {
      setLedgerStatusFilter('pending_approval');
      setLedgerTypeFilter('all');
      setLedgerAccountFilter('all');
      setLedgerSearch('');
      setLedgerOffset(0);
      return;
    }
    if (alert.id === 'failed-postings') {
      setWorkspaceTab('ledger');
      setLedgerStatusFilter('rejected');
      setLedgerTypeFilter('all');
      setLedgerAccountFilter('all');
      setLedgerSearch('');
      setLedgerOffset(0);
      return;
    }
    if (alert.id === 'negative-balance-risk' || alert.id === 'negative-cash') {
      setWorkspaceTab('ledger');
      setLedgerStatusFilter('all');
      setLedgerTypeFilter('all');
      setLedgerAccountFilter(alert.id === 'negative-cash' ? 'cash' : 'all');
      setLedgerSearch('');
      setLedgerOffset(0);
      return;
    }
    if (alert.id === 'unreconciled-till' || alert.id === 'unreconciled-variance') {
      setWorkspaceTab('reconciliation');
      return;
    }
    if (alert.id === 'investor-liability-open' || alert.id === 'investor-balance') {
      setWorkspaceTab('investor');
      return;
    }
    if (alert.id === 'audit-exceptions') {
      setWorkspaceTab('overview');
    }
  };

  const selectQuickAction = (action: FinanceQuickAction) => {
    setQuickAction(action);
    if (action === 'income') {
      setType('in');
      setShowAdvancedTxFields(false);
      setWorkspaceTab('transactions');
      return;
    }
    if (action === 'expense') {
      setType('out');
      setShowAdvancedTxFields(false);
      setWorkspaceTab('transactions');
      return;
    }
    if (action === 'transfer') {
      setWorkspaceTab('transfers');
      return;
    }
    if (action === 'investor_repayment') {
      setWorkspaceTab('investor');
      return;
    }
    if (action === 'deposit') {
      setWorkspaceTab('deposits');
      return;
    }
    if (action === 'reconcile') {
      setWorkspaceTab('reconciliation');
      return;
    }
    setWorkspaceTab('ledger');
  };

  const closeActionWorkspace = () => {
    setWorkspaceTab('overview');
  };

  useEffect(() => {
    if (!focusedMode) return;
    if (workspaceTab === 'overview') {
      setWorkspaceTab('transactions');
      setQuickAction('expense');
      setType('out');
    }
  }, [focusedMode, workspaceTab]);

  const isIncomeAction = type === 'in';
  const isCardBasedTransfer = transferDirection === 'card_to_cash' || transferDirection === 'card_to_debt';

  const transactionForm = (
    <div className="rounded-[28px] border border-slate-800 bg-slate-950 p-4 md:p-5">
      <div className="mb-4 md:mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">
            {isIncomeAction ? tx(lang, 'Mədaxil əməliyyatı', 'Операция прихода', 'Income transaction') : tx(lang, 'Xərc əməliyyatı', 'Операция расхода', 'Expense transaction')}
          </div>
          <h3 className="mt-2 text-xl font-black text-white">{tx(lang, 'Əməliyyat formu', 'Форма операции', 'Transaction form')}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {isIncomeAction
              ? tx(lang, 'Pul daxilolmasını qısa və aydın şəkildə qeyd edin.', 'Кратко и ясно внесите поступление.', 'Record incoming money briefly and clearly.')
              : tx(lang, 'Xərci mənbə, kateqoriya və subyektlə birlikdə yazın.', 'Запишите расход вместе с источником, категорией и контрагентом.', 'Record the expense with source, category, and counterparty.')}
          </p>
        </div>
        <div className="flex gap-2">
	          <button onClick={() => { setQuickAction('income'); setType('in'); }} aria-pressed={type === 'in'} className={`min-h-11 rounded-2xl px-4 text-sm font-black ${type === 'in' ? 'bg-emerald-400 text-slate-950' : 'border border-slate-700 text-slate-300'}`}>
	            {tx(lang, 'Mədaxil', 'Приход', 'Income')}
	          </button>
	          <button onClick={() => { setQuickAction('expense'); setType('out'); }} aria-pressed={type === 'out'} className={`min-h-11 rounded-2xl px-4 text-sm font-black ${type === 'out' ? 'bg-rose-400 text-slate-950' : 'border border-slate-700 text-slate-300'}`}>
	            {tx(lang, 'Xərc', 'Расход', 'Expense')}
	          </button>
            <button
              type="button"
              aria-pressed={showAdvancedTxFields}
              onClick={() => setShowAdvancedTxFields((prev) => !prev)}
              className={`min-h-11 rounded-2xl px-4 text-sm font-black ${showAdvancedTxFields ? 'bg-slate-200 text-slate-950' : 'border border-slate-700 text-slate-300'}`}
            >
              {showAdvancedTxFields
                ? tx(lang, 'Sadə sahələr', 'Простые поля', 'Simple fields')
                : tx(lang, 'Ətraflı sahələr', 'Расширенные поля', 'Advanced fields')}
            </button>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-2.5 md:gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Növ', 'Тип', 'Type')}</div>
          <div className="mt-2 text-lg font-black text-white">{isIncomeAction ? tx(lang, 'Mədaxil', 'Приход', 'Income') : tx(lang, 'Xərc', 'Расход', 'Expense')}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Mənbə', 'Источник', 'Source')}</div>
          <div className="mt-2 text-lg font-black text-white">{selectedSource?.label}</div>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Kateqoriya', 'Категория', 'Category')}</div>
          <div className="mt-2 text-lg font-black text-white">{selectedCategory?.label}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <FinanceField htmlForId="finance-entry-source" label={tx(lang, 'Mənbə hesabı', 'Счет источник', 'Source account')} helper={selectedSource?.helper}>
          <select id="finance-entry-source" className="neon-input min-h-13" value={source} onChange={(e) => setSource(e.target.value as WalletSource)}>
            {sourceOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </FinanceField>
        <FinanceField htmlForId="finance-entry-category" label={tx(lang, 'Kateqoriya', 'Категория', 'Category')} helper={selectedCategory.helper}>
          <select id="finance-entry-category" className="neon-input min-h-13" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categoryOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </FinanceField>
        {(!isIncomeAction || showAdvancedTxFields) && (
          <FinanceField htmlForId="finance-entry-subject" label={isIncomeAction ? tx(lang, 'Kimdən gəlib? (istəyə bağlı)', 'Контрагент (необязательно)', 'Counterparty (optional)') : tx(lang, 'Subyekt', 'Контрагент', 'Counterparty')} helper={isIncomeAction ? tx(lang, 'İzahat üçün doldura bilərsiniz.', 'Можно заполнить для ясности.', 'Optional, for clarity.') : tx(lang, 'Xərcdə məcburidir: pul kimə getdi?', 'Для расхода обязательно: кому ушли деньги?', 'Required for expense: who received money?')}>
            <select id="finance-entry-subject" className="neon-input min-h-13" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">{isIncomeAction ? tx(lang, 'Seçmədən keç', 'Пропустить', 'Skip') : tx(lang, 'Subyekt seçin', 'Выберите субъект', 'Select subject')}</option>
              {subjectPresets.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
            </select>
          </FinanceField>
        )}
        <FinanceField htmlForId="finance-entry-amount" label={tx(lang, 'Məbləğ', 'Сумма', 'Amount')} helper={tx(lang, 'Məbləği AZN ilə yazın.', 'Введите сумму в AZN.', 'Enter amount in AZN.')}>
          <input id="finance-entry-amount" className="neon-input min-h-16 text-2xl font-black" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FinanceField>
        {(!isIncomeAction || showAdvancedTxFields) && (
          <FinanceField htmlForId="finance-entry-note" label={tx(lang, 'Qeyd', 'Комментарий', 'Note')} helper={isIncomeAction ? tx(lang, 'Pulun mənşəyini qısa izah edin.', 'Кратко поясните источник денег.', 'Briefly explain the source of funds.') : tx(lang, 'Xərcin qısa səbəbini yazın.', 'Кратко укажите причину расхода.', 'Briefly describe the expense.')}>
            <input id="finance-entry-note" className="neon-input min-h-13" value={description} onChange={(e) => setDescription(e.target.value)} />
          </FinanceField>
        )}
        {!isIncomeAction && (
          <FinanceField label={tx(lang, 'Yeni subyekt əlavə et', 'Новый preset контрагента', 'New counterparty preset')} helper={tx(lang, 'Təchizatçı və digər subyektləri tez seçmək üçün.', 'Чтобы быстро выбирать поставщиков и субъекты.', 'For quick supplier/counterparty selection.')}>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input className="neon-input min-h-13" value={newSubjectPreset} onChange={(e) => setNewSubjectPreset(e.target.value)} />
              <button type="button" onClick={addSubjectPreset} className="neon-btn rounded-2xl px-4 text-sm font-black">{tx(lang, 'Əlavə et', 'Добавить', 'Add')}</button>
            </div>
          </FinanceField>
        )}
      </div>
        <div className="sticky bottom-2 z-10 mt-5 rounded-2xl bg-slate-950/90 p-2 backdrop-blur md:static md:bg-transparent md:p-0">
	        <button
            disabled={entrySubmitting}
            onClick={() => void addEntry()}
            className="glossy-gold min-h-14 w-full rounded-2xl px-6 text-base font-black disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
          >
	          {entrySubmitting
              ? tx(lang, 'Yazılır...', 'Сохранение...', 'Posting...')
              : tx(lang, 'Əməliyyatı yaz', 'Провести операцию', 'Post transaction')}
	        </button>
        </div>
    </div>
  );

  const transferForm = (
    <div className="rounded-[28px] border border-slate-800 bg-slate-950 p-4 md:p-5">
      <div className="mb-5">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">{tx(lang, 'Daxili transfer', 'Внутренний перевод', 'Internal transfer')}</div>
        <h3 className="mt-2 text-xl font-black text-white">{tx(lang, 'Transfer formu', 'Форма перевода', 'Transfer form')}</h3>
        <p className="mt-1 text-sm text-slate-400">
          {tx(lang, 'Pulun hansı hesabdan çıxıb hara keçdiyini dəqiq yazın.', 'Укажите, откуда и куда движутся средства.', 'Specify exactly where funds move from and to.')}
        </p>
      </div>
      <div className={`grid grid-cols-1 gap-4 ${isCardBasedTransfer ? 'xl:grid-cols-3' : 'xl:grid-cols-2'}`}>
        <FinanceField htmlForId="finance-transfer-direction" label={tx(lang, 'Haradan → Hara', 'Откуда → куда', 'From → To')}>
          <select id="finance-transfer-direction" className="neon-input min-h-13" value={transferDirection} onChange={(e) => setTransferDirection(e.target.value as any)}>
            <option value="card_to_cash">{tx(lang, 'Kartdan Kassaya', 'С карты в кассу')}</option>
            <option value="cash_to_card">{tx(lang, 'Kassadan Karta', 'Из кассы на карту')}</option>
            <option value="cash_to_safe">{tx(lang, 'Kassadan Seyfə', 'Из кассы в сейф', 'Cash to Safe')}</option>
            <option value="safe_to_cash">{tx(lang, 'Seyfdən Kassaya', 'Из сейфа в кассу', 'Safe to Cash')}</option>
            <option value="cash_to_debt">{tx(lang, 'Kassadan Borca', 'Из кассы в долг')}</option>
            <option value="card_to_debt">{tx(lang, 'Kartdan Borca', 'С карты в долг')}</option>
          </select>
        </FinanceField>
        <FinanceField htmlForId="finance-transfer-amount" label={tx(lang, 'Məbləğ', 'Сумма', 'Amount')}>
          <input id="finance-transfer-amount" className="neon-input min-h-16 text-2xl font-black" type="number" min={0} step="0.01" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} />
        </FinanceField>
        {isCardBasedTransfer && (
          <FinanceField htmlForId="finance-transfer-fee" label={tx(lang, 'Komissiya', 'Комиссия', 'Fee')} helper={`${bankCommissionConfig.card_transfer_percent}% ${tx(lang, 'kart çıxış qaydası', 'карточное правило выхода', 'card-out policy')}`}>
            <input id="finance-transfer-fee" className="neon-input min-h-13" type="number" min={0} step="0.01" value={computedTransferCommission.toString()} onChange={(e) => setTransferCommission(e.target.value)} readOnly={transferDirection === 'card_to_cash'} />
          </FinanceField>
        )}
      </div>
      {largeTransferThreshold.gt(0) && new Decimal(transferAmount || 0).gte(largeTransferThreshold) && (
        <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-950/25 p-4 text-sm font-bold text-amber-100">
          {tx(
            lang,
            `Bu məbləğ böyük transfer sayılır (${largeTransferThreshold.toFixed(2)} ₼+) və birbaşa post olunmayacaq. Təsdiq qutusuna göndəriləcək.`,
            `Эта сумма считается крупным переводом (${largeTransferThreshold.toFixed(2)} ₼+) и не будет posted сразу. Она уйдет в approval inbox.`,
            `This is a large transfer (${largeTransferThreshold.toFixed(2)} ₼+) and will not post immediately. It will be sent to the approval inbox.`,
          )}
        </div>
      )}
        <div className="sticky bottom-2 z-10 mt-5 rounded-2xl bg-slate-950/90 p-2 backdrop-blur md:static md:bg-transparent md:p-0">
	        <button
            disabled={transferSubmitting}
            onClick={() => void doTransfer()}
            className="neon-btn min-h-14 w-full rounded-2xl px-6 text-base font-black disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
          >
	          {transferSubmitting
              ? tx(lang, 'Göndərilir...', 'Отправка...', 'Submitting...')
              : tx(lang, 'Transferi yaz', 'Провести перевод', 'Post transfer')}
	        </button>
        </div>
    </div>
  );

  const investorForm = (
    <div className="rounded-[28px] border border-slate-800 bg-slate-950 p-4 md:p-5">
      <div className="mb-5">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">{tx(lang, 'Investor borcu', 'Обязательство инвестору', 'Investor liability')}</div>
        <h3 className="mt-2 text-xl font-black text-white">{tx(lang, 'Investor ödəniş formu', 'Форма выплаты инвестору', 'Investor repayment form')}</h3>
        <p className="mt-1 text-sm text-slate-400">
          {tx(lang, 'Bu əməliyyat investor borcunu azaldır və mənbə hesabdan vəsait çıxır.', 'Эта операция уменьшает долг инвестору и списывает деньги с выбранного счета.', 'This operation reduces investor liability and deducts money from the selected account.')}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FinanceField htmlForId="finance-investor-source" label={tx(lang, 'Ödəniş mənbəyi', 'Источник оплаты', 'Payment source')}>
          <select id="finance-investor-source" className="neon-input min-h-13" value={repayFrom} onChange={(e) => setRepayFrom(e.target.value as any)}>
            <option value="cash">{tx(lang, 'Kassa', 'Касса', 'Cash')}</option>
            <option value="card">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
            <option value="safe">{tx(lang, 'Seyf', 'Сейф', 'Safe')}</option>
          </select>
        </FinanceField>
        <FinanceField htmlForId="finance-investor-amount" label={tx(lang, 'Məbləğ', 'Сумма', 'Amount')} helper={`${tx(lang, 'Qalan borc', 'Остаток долга', 'Remaining debt')}: ${ledgerInvestorDebt.toFixed(2)} ₼`}>
          <input id="finance-investor-amount" className="neon-input min-h-16 text-2xl font-black" type="number" min={0} step="0.01" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} />
        </FinanceField>
        <FinanceField htmlForId="finance-investor-note" label={tx(lang, 'Qeyd', 'Комментарий подтверждения', 'Approval note')}>
          <input id="finance-investor-note" className="neon-input min-h-13" value={repayNote} onChange={(e) => setRepayNote(e.target.value)} />
        </FinanceField>
      </div>
      {financePolicyConfig.investor_repayment_requires_approval ? (
        <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-950/25 p-4 text-sm font-bold text-amber-100">
          {tx(lang, 'Investor ödənişi nəzarətli əməliyyatdır. Əvvəl təsdiq qutusuna düşəcək, sonra balanslar yenilənəcək.', 'Выплата инвестору — контролируемая операция. Request попадет в approval inbox и только после подтверждения обновит балансы.', 'Investor repayment is a controlled operation. The request goes to approval inbox first; balances update after approval.')}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-950/25 p-4 text-sm font-bold text-emerald-100">
          {tx(lang, 'Policy-yə görə bu ödəniş birbaşa ledger-ə post olunacaq.', 'По policy выплата будет posted сразу.', 'Per policy, this repayment will post directly to the ledger.')}
        </div>
      )}
        <div className="sticky bottom-2 z-10 mt-5 rounded-2xl bg-slate-950/90 p-2 backdrop-blur md:static md:bg-transparent md:p-0">
	        <button
            disabled={investorSubmitting}
            onClick={() => void doRepayInvestor()}
            className="glossy-gold min-h-14 w-full rounded-2xl px-6 text-base font-black disabled:cursor-not-allowed disabled:opacity-60 md:w-auto"
          >
	          {investorSubmitting
              ? tx(lang, 'Göndərilir...', 'Отправка...', 'Submitting...')
              : financePolicyConfig.investor_repayment_requires_approval
                ? tx(lang, 'Təsdiqə göndər', 'Отправить на approval', 'Send for approval')
                : tx(lang, 'Ödənişi yaz', 'Провести выплату', 'Post repayment')}
	        </button>
        </div>
    </div>
  );

  const accountName = (code?: string | null) =>
    ledgerAccountByCode.get(String(code || ''))?.name || code || '-';

  const transactionTypeLabel = (value?: string | null) => {
    const normalized = String(value || '').toLowerCase();
    const labels: Record<string, string> = {
      income: tx(lang, 'Mədaxil', 'Приход', 'Income'),
      expense: tx(lang, 'Xərc', 'Расход', 'Expense'),
      internal_transfer: tx(lang, 'Daxili transfer', 'Внутренний перевод', 'Internal transfer'),
      investor_repayment: tx(lang, 'Investor ödənişi', 'Выплата инвестору', 'Investor repayment'),
      deposit_hold: tx(lang, 'Depozit saxlama', 'Удержание депозита', 'Deposit hold'),
      deposit_apply_to_bill: tx(lang, 'Depozit hesaba tətbiq edildi', 'Депозит применён к счёту', 'Deposit applied to bill'),
      deposit_release: tx(lang, 'Depozit buraxılışı', 'Освобождение депозита', 'Deposit release'),
      deposit_refund: tx(lang, 'Depozit qaytarıldı', 'Возврат депозита', 'Deposit refund'),
      cash_adjustment: tx(lang, 'Kassa düzəlişi', 'Корректировка кассы', 'Cash adjustment'),
      reconciliation_adjustment: tx(lang, 'Uyğunlaşdırma düzəlişi', 'Корректировка сверки', 'Reconciliation adjustment'),
      reversal: tx(lang, 'Əks yazılış', 'Сторно', 'Reversal'),
    };
    if (!normalized) return '-';
    return labels[normalized] || String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  };

  const approvalPreview = (
    <FinanceApprovalPreview
      lang={lang}
      pendingApprovals={pendingApprovals}
      accountName={accountName}
      transactionTypeLabel={transactionTypeLabel}
      onOpenLedgerDetail={(row) => void openLedgerDetail(row)}
      onOpenAll={() => {
        setWorkspaceTab('ledger');
        setLedgerStatusFilter('pending_approval');
        setLedgerOffset(0);
      }}
    />
  );

  const ledgerTable = (
    <FinanceLedgerTab
      lang={lang}
      ledgerPageSize={ledgerPageSize}
      onPageSizeChange={setLedgerPageSize}
      onExport={exportCsv}
      ledgerPageStart={ledgerPageStart}
      ledgerPageEnd={ledgerPageEnd}
      ledgerTotalCount={ledgerTotalCount}
      ledgerPageLoading={ledgerPageLoading}
      onClearFilters={clearLedgerFilters}
      ledgerSearch={ledgerSearch}
      onLedgerSearchChange={setLedgerSearch}
      ledgerTypeFilter={ledgerTypeFilter}
      onLedgerTypeFilterChange={setLedgerTypeFilter}
      ledgerStatusFilter={ledgerStatusFilter}
      onLedgerStatusFilterChange={setLedgerStatusFilter}
      ledgerAccountFilter={ledgerAccountFilter}
      onLedgerAccountFilterChange={setLedgerAccountFilter}
      ledgerCounterpartyFilter={ledgerCounterpartyFilter}
      onLedgerCounterpartyFilterChange={setLedgerCounterpartyFilter}
      ledgerMinAmount={ledgerMinAmount}
      onLedgerMinAmountChange={setLedgerMinAmount}
      ledgerMaxAmount={ledgerMaxAmount}
      onLedgerMaxAmountChange={setLedgerMaxAmount}
      ledgerTransactionTypes={ledgerTransactionTypes}
      ledgerTransactionStatuses={ledgerTransactionStatuses}
      ledgerAccounts={ledgerAccounts}
      fromDate={fromDate}
      toDate={toDate}
      visibleLedgerTransactions={visibleLedgerTransactions}
      onOpenLedgerDetail={(entry) => void openLedgerDetail(entry)}
      transactionTypeLabel={transactionTypeLabel}
      accountName={accountName}
      ledgerCurrentPage={ledgerCurrentPage}
      ledgerTotalPages={ledgerTotalPages}
      canGoPreviousLedgerPage={canGoPreviousLedgerPage}
      canGoNextLedgerPage={canGoNextLedgerPage}
      onPreviousPage={() => setLedgerOffset((value) => Math.max(0, value - ledgerPageSize))}
      onNextPage={() => setLedgerOffset((value) => value + ledgerPageSize)}
      ledgerEntries={ledgerEntries}
    />
  );

  const overviewInsights = (
    <FinanceOverviewInsightsCard
      lang={lang}
      incoming={`${financeSummary.incoming.toFixed(2)} ₼`}
      outgoing={`${financeSummary.outgoing.toFixed(2)} ₼`}
      biggestExpenseAmount={financeSummary.biggestExpense ? `${new Decimal(financeSummary.biggestExpense.amount || 0).toFixed(2)} ₼` : '0.00 ₼'}
      pendingApprovalsCount={pendingApprovalsCount}
      onExpense={() => selectQuickAction('expense')}
      onTransfer={() => selectQuickAction('transfer')}
      onOpenLedger={() => setWorkspaceTab('ledger')}
    />
  );

  const enterpriseReportsCard = (
    <FinanceControlCard
      title={tx(lang, 'Enterprise maliyyə hesabatları', 'Enterprise финансовые отчеты', 'Enterprise finance reports')}
      subtitle={tx(lang, 'Balans, mənfəət-zərər və pul axını seçilmiş tarix aralığı üzrə ayrılır.', 'Баланс, P&L и cash flow за выбранный период.', 'Balance sheet, P&L and cash flow for the selected period.')}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <FinanceMiniMetric
          label={tx(lang, 'Aktivlər', 'Активы', 'Assets')}
          value={`${new Decimal(enterpriseReports?.balance_sheet?.assets?.total || 0).toFixed(2)} ₼`}
          tone="sky"
        />
        <FinanceMiniMetric
          label={tx(lang, 'Öhdəliklər', 'Обязательства', 'Liabilities')}
          value={`${new Decimal(enterpriseReports?.balance_sheet?.liabilities?.total || 0).toFixed(2)} ₼`}
          tone="amber"
        />
        <FinanceMiniMetric
          label={tx(lang, 'Xalis mənfəət', 'Чистая прибыль', 'Net profit')}
          value={`${new Decimal(enterpriseReports?.profit_loss?.net_profit || 0).toFixed(2)} ₼`}
          tone={new Decimal(enterpriseReports?.profit_loss?.net_profit || 0).gte(0) ? 'emerald' : 'rose'}
        />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <FinanceMiniMetric
          label={tx(lang, 'Pul axını', 'Денежный поток', 'Cash flow')}
          value={`${new Decimal(enterpriseReports?.cash_flow?.net_cash_flow || 0).toFixed(2)} ₼`}
          tone={new Decimal(enterpriseReports?.cash_flow?.net_cash_flow || 0).gte(0) ? 'emerald' : 'rose'}
        />
        <FinanceMiniMetric
          label={tx(lang, 'Satış gəliri', 'Выручка', 'Revenue')}
          value={`${new Decimal(enterpriseReports?.profit_loss?.revenue || 0).toFixed(2)} ₼`}
          tone="emerald"
        />
        <FinanceMiniMetric
          label={tx(lang, 'Maya dəyəri', 'Себестоимость', 'COGS')}
          value={`${new Decimal(enterpriseReports?.profit_loss?.cogs || 0).toFixed(2)} ₼`}
          tone="amber"
        />
      </div>
      <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
        {tx(
          lang,
          enterpriseReports?.balance_sheet?.equity?.note || 'Kapital hazırda aktivlər minus öhdəliklər prinsipi ilə təxmini göstərilir.',
          enterpriseReports?.balance_sheet?.equity?.note || 'Капитал пока показывается оценочно: активы минус обязательства.',
          enterpriseReports?.balance_sheet?.equity?.note || 'Equity is currently estimated as assets minus liabilities.',
        )}
      </div>
    </FinanceControlCard>
  );

  const controlSummaryPanel = (
    <FinanceControlSummaryPanel
      lang={lang}
      investorDebt={`${ledgerInvestorDebt.toFixed(2)} ₼`}
      activeDeposits={`${new Decimal(balance.deposit_balance || 0).toFixed(2)} ₼`}
      liquidity={cashCoverage === 'N/A' ? cashCoverage : `${cashCoverage}%`}
      reconciliationGap={`${new Decimal(unreconciledVariance || 0).toFixed(2)} ₼`}
      hasVariance={new Decimal(unreconciledVariance || 0).abs().gt(0.01)}
      onOpenReconciliation={() => setWorkspaceTab('reconciliation')}
      onOpenInvestor={() => setWorkspaceTab('investor')}
    />
  );

  const workspaceTitleMap: Record<Exclude<FinanceWorkspaceTab, 'overview'>, { title: string; subtitle: string }> = {
    transactions: {
      title: tx(lang, 'Əməliyyat yaz', 'Əməliyyat yaz', 'Əməliyyat yaz'),
      subtitle: tx(lang, 'Seçilmiş əməliyyat üçün yalnız lazım olan sahələr göstərilir.', 'Seçilmiş əməliyyat üçün yalnız lazım olan sahələr göstərilir.', 'Seçilmiş əməliyyat üçün yalnız lazım olan sahələr göstərilir.'),
    },
    transfers: {
      title: tx(lang, 'Daxili transfer', 'Daxili transfer', 'Daxili transfer'),
      subtitle: tx(lang, 'Hesablar arasında hərəkəti nəzarətli şəkildə yazın.', 'Hesablar arasında hərəkəti nəzarətli şəkildə yazın.', 'Hesablar arasında hərəkəti nəzarətli şəkildə yazın.'),
    },
    reconciliation: {
      title: tx(lang, 'Uyğunlaşdırma', 'Uyğunlaşdırma', 'Uyğunlaşdırma'),
      subtitle: tx(lang, 'Gözlənilən və sayılmış qalığı tutuşdurun.', 'Gözlənilən və sayılmış qalığı tutuşdurun.', 'Gözlənilən və sayılmış qalığı tutuşdurun.'),
    },
    investor: {
      title: tx(lang, 'Investor ödənişi', 'Investor ödənişi', 'Investor ödənişi'),
      subtitle: tx(lang, 'Investor borcu ilə bağlı nəzarətli ödəniş axını.', 'Investor borcu ilə bağlı nəzarətli ödəniş axını.', 'Investor borcu ilə bağlı nəzarətli ödəniş axını.'),
    },
    deposits: {
      title: tx(lang, 'Depozit əməliyyatları', 'Depozit əməliyyatları', 'Depozit əməliyyatları'),
      subtitle: tx(lang, 'Açıq masa depozitləri ayrıca öhdəlik kimi izlənir.', 'Açıq masa depozitləri ayrıca öhdəlik kimi izlənir.', 'Açıq masa depozitləri ayrıca öhdəlik kimi izlənir.'),
    },
    ledger: {
      title: tx(lang, 'Maliyyə jurnalı', 'Maliyyə jurnalı', 'Maliyyə jurnalı'),
      subtitle: tx(lang, 'Audit, approval və reversal tarixçəsi ayrıca iş sahəsindədir.', 'Audit, approval və reversal tarixçəsi ayrıca iş sahəsindədir.', 'Audit, approval və reversal tarixçəsi ayrıca iş sahəsindədir.'),
    },
  };

  const actionWorkspace =
    workspaceTab === 'overview'
      ? null
      : (
        <FinanceWorkspaceShell
          workspaceTab={workspaceTab}
          titleMap={workspaceTitleMap}
          lang={lang}
          onClose={closeActionWorkspace}
        >
          {workspaceTab === 'transactions' && transactionForm}
          {workspaceTab === 'transfers' && transferForm}
          {workspaceTab === 'investor' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <FinanceMiniMetric
                  label={tx(lang, 'Mövcud investor borcu', 'Текущий долг инвестору', 'Current investor debt')}
                  value={`${ledgerInvestorDebt.toFixed(2)} ₼`}
                  tone={ledgerInvestorDebt.gt(0.01) ? 'rose' : 'emerald'}
                />
                <FinanceMiniMetric
                  label={tx(lang, 'Ödəniş mənbəyi', 'Источник оплаты', 'Payment source')}
                  value={repayFrom === 'cash' ? tx(lang, 'Kassa', 'Касса', 'Cash') : repayFrom === 'card' ? tx(lang, 'Kart', 'Карта', 'Card') : tx(lang, 'Seyf', 'Сейф', 'Safe')}
                  tone="sky"
                />
                <FinanceMiniMetric
                  label={tx(lang, 'Qeyd', 'Комментарий', 'Note')}
                  value={repayNote?.trim() || tx(lang, 'Qeyd yoxdur', 'Комментария нет', 'No note')}
                  tone="amber"
                />
              </div>
              {investorForm}
            </div>
          )}
          {workspaceTab === 'deposits' && (
            <FinanceControlCard title={tx(lang, 'Depozitlər', 'Depozitlər', 'Depozitlər')} subtitle={tx(lang, 'Depozit ayrıca öhdəlik kimi izlənir', 'Depozit ayrıca öhdəlik kimi izlənir', 'Depozit ayrıca öhdəlik kimi izlənir')}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FinanceMiniMetric label={tx(lang, 'Aktiv depozit öhdəliyi', 'Aktiv depozit öhdəliyi', 'Aktiv depozit öhdəliyi')} value={`${new Decimal(balance.deposit_balance || 0).toFixed(2)} ₼`} tone="amber" />
                <FinanceMiniMetric label={tx(lang, 'Seçilən aralıqda toplanıb', 'Seçilən aralıqda toplanıb', 'Seçilən aralıqda toplanıb')} value={`${depositsInRange.toFixed(2)} ₼`} tone="sky" />
              </div>
            </FinanceControlCard>
          )}
          {workspaceTab === 'reconciliation' && (
            <FinanceReconciliationWorkspace
              lang={lang}
              expectedReconcileBalance={expectedReconcileBalance}
              reconcileCounted={reconcileCounted}
              reconcileVariance={reconcileVariance}
              reconcileAccount={reconcileAccount}
              setReconcileAccount={setReconcileAccount}
              setReconcileCounted={setReconcileCounted}
              reconcileNotes={reconcileNotes}
              setReconcileNotes={setReconcileNotes}
              ledgerAccounts={ledgerAccounts}
              onSubmit={() => void doReconcile()}
              submitting={reconcileSubmitting}
              reconciliations={reconciliations}
            />
          )}
          {workspaceTab === 'ledger' && ledgerTable}
        </FinanceWorkspaceShell>
      );

  return (
    <FinanceDashboard>
      {!focusedMode && (
        <FinanceSummaryStrip
          lang={lang}
          balance={balance}
          netCashflow={financeSummary.net}
          reconciliationGap={unreconciledVariance}
          investorDebt={ledgerInvestorDebt.toFixed(2)}
          pendingApprovals={pendingApprovalsCount}
          onRefresh={() => void reloadFinance(true)}
        />
      )}

      <div className="rounded-[28px] border border-slate-800 bg-slate-900 p-4 md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-sky-300">{tx(lang, 'Dövr seçimi', 'Выбор периода', 'Period selection')}</div>
            <h3 className="mt-2 text-xl font-black text-white">{tx(lang, 'Maliyyə tarix aralığı', 'Финансовый диапазон дат', 'Finance date range')}</h3>
            <p className="mt-1 text-sm text-slate-400">
              {tx(lang, 'Baxış, uyğunlaşdırma və jurnal bu tarix aralığına görə hesablanır.', 'Обзор, сверка и журнал считаются по этому периоду.', 'Overview, reconciliation and journal are calculated for this date range.')}
            </p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-5 md:overflow-visible md:pb-0">
            {([
              ['daily', tx(lang, 'Bu gün', 'Сегодня', 'Today')],
              ['weekly', tx(lang, 'Həftə', 'Неделя', 'Week')],
              ['monthly', tx(lang, 'Ay', 'Месяц', 'Month')],
              ['yearly', tx(lang, 'İl', 'Год', 'Year')],
              ['custom', tx(lang, 'Xüsusi', 'Произвольно', 'Custom')],
            ] as const).map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyRangePreset(preset)}
                className={`min-h-11 shrink-0 rounded-2xl px-4 text-sm font-black transition md:shrink ${rangePreset === preset ? 'bg-white text-slate-950' : 'border border-slate-700 bg-slate-950 text-slate-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            aria-pressed={focusedMode}
            onClick={() => setFocusedMode((prev) => !prev)}
            className={`min-h-11 rounded-2xl px-4 text-sm font-black transition ${focusedMode ? 'bg-emerald-300 text-slate-950' : 'border border-slate-700 bg-slate-950 text-slate-200'}`}
          >
            {focusedMode
              ? tx(lang, 'Fokus rejimi: aktiv', 'Режим фокуса: включен', 'Focus mode: on')
              : tx(lang, 'Fokus rejimi: söndürülüb', 'Режим фокуса: выключен', 'Focus mode: off')}
          </button>
        </div>

        {focusedMode && (
          <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-200">
              {tx(lang, 'Sadə iş rejimi', 'Упрощенный режим', 'Simple workflow mode')}
            </div>
            <div className="mt-2 text-sm font-bold text-emerald-100">
              {tx(lang, 'Bir əməliyyat seçin və birbaşa formu doldurun.', 'Выберите операцию и сразу заполните форму.', 'Choose an operation and fill the form directly.')}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <button
                type="button"
                onClick={() => {
                  setQuickAction('expense');
                  setType('out');
                  setWorkspaceTab('transactions');
                }}
                className="min-h-11 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm font-black text-slate-100"
              >
                {tx(lang, 'Xərc yaz', 'Записать расход', 'Record expense')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuickAction('income');
                  setType('in');
                  setWorkspaceTab('transactions');
                }}
                className="min-h-11 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm font-black text-slate-100"
              >
                {tx(lang, 'Mədaxil yaz', 'Записать приход', 'Record income')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuickAction('transfer');
                  setWorkspaceTab('transfers');
                }}
                className="min-h-11 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm font-black text-slate-100"
              >
                {tx(lang, 'Transfer', 'Перевод', 'Transfer')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuickAction('investor_repayment');
                  setWorkspaceTab('investor');
                }}
                className="min-h-11 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm font-black text-slate-100"
              >
                {tx(lang, 'Investor ödə', 'Оплата инвестору', 'Investor repayment')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setQuickAction('reconcile');
                  setWorkspaceTab('reconciliation');
                }}
                className="min-h-11 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm font-black text-slate-100"
              >
                {tx(lang, 'Uyğunlaşdırma', 'Сверка', 'Reconciliation')}
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="space-y-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Başlanğıc tarix', 'Дата начала', 'Start date')}</span>
            <input
              className="neon-input min-h-12"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setRangePreset('custom');
                setFromDate(e.target.value);
              }}
            />
          </label>
          <label className="space-y-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Bitiş tarixi', 'Дата окончания', 'End date')}</span>
            <input
              className="neon-input min-h-12"
              type="date"
              value={toDate}
              onChange={(e) => {
                setRangePreset('custom');
                setToDate(e.target.value);
              }}
            />
          </label>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Aktiv dövr', 'Активный период', 'Active period')}</div>
            <div className="mt-2 text-sm font-black text-white">{fromDate} → {toDate}</div>
          </div>
        </div>
      </div>

      {!focusedMode && (
        <FinanceAlertsBar
          alerts={financeAlerts}
          onOpen={openFinanceAlert}
        />
      )}

      {!focusedMode && (
        <FinanceQuickActions
          lang={lang}
          active={quickAction}
          onSelect={selectQuickAction}
        />
      )}

      {!focusedMode && (
        <FinanceWorkspaceTabs
          lang={lang}
          active={workspaceTab}
          onChange={setWorkspaceTab}
        />
      )}

      {workspaceTab === 'overview' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <FinanceControlCard title={tx(lang, 'Bugünkü pul axını', 'Поток сегодня', 'Today flow')} subtitle={tx(lang, 'Operativ cashflow, investor/depozit/transfer xaric', 'Операционный cashflow без инвестора/депозитов/transfer', 'Operational cashflow excluding investor/deposit/transfer')}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <FinanceMiniMetric label={tx(lang, 'Mədaxil', 'Приход', 'Inflow')} value={`${todayInflow.toFixed(2)} ₼`} tone="emerald" />
                <FinanceMiniMetric label={tx(lang, 'Xərc', 'Расход', 'Outflow')} value={`${todayOutflow.toFixed(2)} ₼`} tone="rose" />
                <FinanceMiniMetric label={tx(lang, 'Net nəticə', 'Нетто', 'Net')} value={`${financeSummary.net.toFixed(2)} ₼`} tone={financeSummary.net.gte(0) ? 'emerald' : 'rose'} />
              </div>
            </FinanceControlCard>
            {enterpriseReportsCard}
            {overviewInsights}
          </div>
          <div className="space-y-5">
            {controlSummaryPanel}
            {approvalPreview}
          </div>
        </div>
      )}

      {actionWorkspace}

      <TransactionDetailDrawer
        lang={lang}
        detail={selectedLedgerDetail}
        loading={ledgerDetailLoading}
        accountName={accountName}
        transactionTypeLabel={transactionTypeLabel}
        onApprove={approveTransaction}
        onReject={rejectTransaction}
        onReverse={requestReversal}
        onClose={() => setSelectedLedgerDetail(null)}
      />
    </FinanceDashboard>
  );
}
