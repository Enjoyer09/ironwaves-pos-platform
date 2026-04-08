import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import { useAppStore } from '../../store';
import { AlertTriangle, ArrowRight, Banknote, BookOpen, CheckCircle2, GitCompareArrows, Landmark, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';
import {
  create_finance_entry_async,
  create_finance_ledger_transaction_async,
  create_finance_reconciliation_async,
  approve_finance_transaction_async,
  fetch_finance_anomalies,
  fetch_finance_balances,
  fetch_finance_entries,
  fetch_finance_ledger_accounts,
  fetch_finance_ledger_entries,
  fetch_finance_ledger_transactions,
  fetch_finance_pending_approvals,
  fetch_finance_reconciliations,
  fetch_finance_transaction_detail,
  reject_finance_transaction_async,
  type FinanceAnomalies,
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

type WalletSource = 'cash' | 'card' | 'investor' | 'safe' | 'debt';
type FinanceWorkspaceTab = 'overview' | 'transactions' | 'transfers' | 'reconciliation' | 'investor' | 'deposits' | 'ledger';
type FinanceQuickAction = 'income' | 'expense' | 'transfer' | 'investor_repayment' | 'deposit' | 'reconcile' | 'adjustment';

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

const APPROVAL_TRANSFER_THRESHOLD = new Decimal(500);

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
  const category = normalizeFinanceText(entry?.category);
  const source = normalizeFinanceText(entry?.source);
  const description = normalizeFinanceText(entry?.description);
  const isDeposit = category.includes('depozit') || description.includes('depozit') || description.includes('deposit');

  if (category.includes('daxili transfer')) return false;
  if (category.includes('tesisci investisiyasi')) return false;
  if (category.includes('investor borcu')) return false;
  if (category.includes('borcdan kassaya daxilolma')) return false;
  if (category.includes('borc alindi')) return false;
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
  const [category, setCategory] = useState('Xammal');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const incomeCategoryOptions: CategoryOption[] = [
    {
      value: 'Təsisçi İnvestisiyası',
      label: tx(lang, 'Təsisçi İnvestisiyası', 'Инвестиция учредителя', 'Founder Investment'),
      helper: tx(
        lang,
        'Kassa mənbəsi ilə giriş edilərsə, investor borcu ayrıca avtomatik qeyd olunur.',
        'Если приход в кассу, долг инвестору фиксируется автоматически.',
        'If incoming to cash, investor liability is auto-recorded.',
      ),
    },
    {
      value: 'Borc Alındı',
      label: tx(lang, 'Borc Alındı', 'Получен долг', 'Borrowed Funds In'),
      helper: tx(
        lang,
        'Mənbə=Borc seçilərsə sistem borcu və kassanı eyni vaxtda artırır.',
        'Если источник=долг, система увеличит и долг, и кассу.',
        'If source=debt, system increases both debt and cash.',
      ),
    },
    {
      value: 'Digər Giriş',
      label: tx(lang, 'Digər Giriş', 'Прочий приход', 'Other Income'),
      helper: tx(lang, 'Satışdankənar digər daxilolmalar.', 'Прочие несбытовые поступления.', 'Other non-sales income entries.'),
    },
  ];

  const expenseCategoryOptions: CategoryOption[] = [
    {
      value: 'Xammal',
      label: tx(lang, 'Xammal', 'Сырье', 'Raw Material'),
      helper: tx(lang, 'Məhsul/xammal alışı üçün istifadə edin.', 'Используйте для закупки сырья.', 'Use for stock/raw purchases.'),
    },
    {
      value: 'Kommunal',
      label: tx(lang, 'Kommunal', 'Коммунальные', 'Utilities'),
      helper: tx(lang, 'Su, işıq, internet və s. ödənişlər.', 'Вода, свет, интернет и т.д.', 'Electricity, water, internet, etc.'),
    },
    {
      value: 'Maaş',
      label: tx(lang, 'Maaş', 'Зарплата', 'Payroll'),
      helper: tx(lang, 'İşçi maaşı və avans ödənişləri.', 'Выплаты зарплаты и аванса.', 'Salary and advance payouts.'),
    },
    {
      value: 'İcarə',
      label: tx(lang, 'İcarə', 'Аренда', 'Rent'),
      helper: tx(lang, 'Obyekt icarə xərcləri.', 'Расходы на аренду помещения.', 'Premises rent expenses.'),
    },
    {
      value: 'Cərimə',
      label: tx(lang, 'Cərimə', 'Штраф', 'Penalty'),
      helper: tx(lang, 'Cərimə və digər məcburi ödənişlər.', 'Штрафы и обязательные платежи.', 'Penalties and mandatory charges.'),
    },
    {
      value: 'Digər Xərc',
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
      setCategory(categoryOptions[0]?.value || 'Digər Xərc');
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
  const [entries, setEntries] = useState<any[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<FinanceLedgerAccount[]>([]);
  const [ledgerTransactions, setLedgerTransactions] = useState<FinanceLedgerTransaction[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<FinanceLedgerEntry[]>([]);
  const [reconciliations, setReconciliations] = useState<FinanceReconciliation[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<FinanceLedgerTransaction[]>([]);
  const [selectedLedgerDetail, setSelectedLedgerDetail] = useState<FinanceTransactionDetail | null>(null);
  const [ledgerDetailLoading, setLedgerDetailLoading] = useState(false);
  const [ledgerPageSize, setLedgerPageSize] = useState(10);
  const [reconcileAccount, setReconcileAccount] = useState('cash');
  const [reconcileCounted, setReconcileCounted] = useState('');
  const [reconcileNotes, setReconcileNotes] = useState('');
  const [bankCommissionConfig, setBankCommissionConfig] = useState<{ card_sale_percent: number; card_transfer_percent: number }>({
    card_sale_percent: 2,
    card_transfer_percent: 0.5,
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
      const [b, e, settings, serverAnomalies] = await Promise.all([
        fetch_finance_balances(tenant_id),
        fetch_finance_entries(tenant_id),
        get_settings_live(tenant_id),
        fetch_finance_anomalies(tenant_id).catch(() => null),
      ]);
      const [accounts, transactions, ledgerRows, recRows, pendingRows] = await Promise.all([
        fetch_finance_ledger_accounts(tenant_id).catch(() => []),
        fetch_finance_ledger_transactions(tenant_id, 250).catch(() => []),
        fetch_finance_ledger_entries(tenant_id, 500).catch(() => []),
        fetch_finance_reconciliations(tenant_id, 100).catch(() => []),
        fetch_finance_pending_approvals(tenant_id).catch(() => []),
      ]);
      setBalance(b || {
        cash_balance: '0',
        card_balance: '0',
        debt_balance: '0',
        investor_balance: '0',
        safe_balance: '0',
        deposit_balance: '0',
      });
      setEntries(e || []);
      setAnomalies(serverAnomalies);
      setLedgerAccounts(accounts);
      setLedgerTransactions(transactions);
      setLedgerEntries(ledgerRows);
      setReconciliations(recRows);
      setPendingApprovals(pendingRows);
      setBankCommissionConfig({
        card_sale_percent: Number((settings.bank_commission as any)?.card_sale_percent ?? settings.bank_commission?.percent ?? 2),
        card_transfer_percent: Number((settings.bank_commission as any)?.card_transfer_percent ?? 0.5),
      });
    } catch (err: any) {
      notify('error', err?.message || tx(lang, 'Maliyyə məlumatları yüklənmədi', 'Не удалось загрузить финансы'));
    }
  }, [tenant_id, notify, lang]);

  useEffect(() => {
    void reloadFinance(true);
  }, [tenant_id, reloadFinance]);

  useEffect(() => {
    const handleFinanceUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      if (!detail?.tenant_id || detail.tenant_id === tenant_id) {
        setBalance(get_balance(tenant_id, 'all', false) as any);
        setEntries(get_finance_entries(tenant_id));
        setAnomalies(null);
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

  const investorSummary = useMemo(() => {
    const normalizeText = (value: string) =>
      (value || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[əƏ]/g, 'e')
        .replace(/[ıİ]/g, 'i')
        .replace(/[öÖ]/g, 'o')
        .replace(/[üÜ]/g, 'u')
        .replace(/[çÇ]/g, 'c')
        .replace(/[şŞ]/g, 's')
        .replace(/[ğĞ]/g, 'g')
        .trim()
        .toLowerCase();

    const isFounderInvestmentCategory = (category: string) => {
      const c = normalizeText(category);
      return (c.includes('tesisci') || c.includes('founder')) && (c.includes('investis') || c.includes('investment'));
    };

    const invested = entries.reduce((sum, e: any) => {
      if (e.type === 'in' && isFounderInvestmentCategory(e.category || '')) {
        return sum.plus(new Decimal(e.amount || 0));
      }
      return sum;
    }, new Decimal(0));

    const repaid = entries.reduce((sum, e: any) => {
      const c = normalizeText(e.category || '');
      const source = normalizeText(e.source || '');

      // IMPORTANT:
      // Repayment must be counted ONLY on investor liability ledger rows.
      // The cash/card/safe out row ("İnvestora Geri Ödəniş") is a payment movement
      // and must not reduce debt a second time.
      const isLiabilityReduction =
        c.includes('investor borcu azaldilmasi') ||
        c.includes('investor liability reduction') ||
        c.includes('dolg investoru umenshen');

      if (e.type === 'out' && isLiabilityReduction && source === 'investor') {
        return sum.plus(new Decimal(e.amount || 0));
      }
      return sum;
    }, new Decimal(0));

    const debt = Decimal.max(new Decimal(0), invested.minus(repaid));
    return {
      invested_total: invested.toString(),
      repaid_total: repaid.toString(),
      debt_remaining: debt.toString(),
    };
  }, [entries]);

  const effectiveInvestorDebt = useMemo(() => {
    const ledgerDebt = new Decimal(anomalies?.investor_ledger_balance || balance.investor_balance || 0);
    const derivedDebt = new Decimal(investorSummary.debt_remaining || 0);
    return Decimal.max(ledgerDebt, derivedDebt);
  }, [anomalies?.investor_ledger_balance, balance.investor_balance, investorSummary.debt_remaining]);

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
  const visibleLedgerTransactions = useMemo(
    () => ledgerTransactions.slice(0, ledgerPageSize),
    [ledgerTransactions, ledgerPageSize],
  );
  const ledgerAccountByCode = useMemo(() => {
    const map = new Map<string, FinanceLedgerAccount>();
    ledgerAccounts.forEach((account) => map.set(account.code, account));
    return map;
  }, [ledgerAccounts]);
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
    const obligations = effectiveInvestorDebt
      .plus(new Decimal(balance.debt_balance || 0));
    if (obligations.lte(0)) return 'N/A';
    return liquid.div(obligations).times(100).toFixed(0);
  }, [balance.cash_balance, balance.card_balance, balance.safe_balance, balance.debt_balance, effectiveInvestorDebt]);

  const financeExceptions = useMemo(() => {
    const items: Array<{ title: string; body: string; tone: 'rose' | 'amber' | 'sky' }> = [];
    const investorLedgerGap = anomalies
      ? new Decimal(anomalies.investor_ledger_gap || 0)
      : new Decimal(balance.investor_balance || 0).minus(effectiveInvestorDebt).abs();
    const depositLiability = new Decimal(anomalies?.deposit_balance || balance.deposit_balance || 0);
    const cashBalance = new Decimal(balance.cash_balance || 0);

    if (investorLedgerGap.greaterThan(0.01)) {
      items.push({
        title: tx(lang, 'Investor borcu uyğunsuzluğu', 'Несовпадение долга инвестору', 'Investor debt mismatch'),
        body: tx(
          lang,
          `Investor ledger balansı ilə hesablanan borc arasında ${investorLedgerGap.toFixed(2)} ₼ fərq var.`,
          `Есть расхождение ${investorLedgerGap.toFixed(2)} ₼ между investor ledger и расчетным долгом.`,
          `There is a ${investorLedgerGap.toFixed(2)} ₼ gap between investor ledger and calculated debt.`,
        ),
        tone: 'rose',
      });
    }

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
  }, [anomalies, balance.cash_balance, balance.deposit_balance, balance.investor_balance, effectiveInvestorDebt, financeSummary.net, lang]);

  const exportCsv = () => {
    if (!filteredEntries.length) {
      notify('error', tx(lang, 'Export üçün məlumat yoxdur', 'Нет данных для экспорта', 'No data to export'));
      return;
    }

    const esc = (value: unknown) => {
      const s = String(value ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };

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
      [esc('SUMMARY'), esc(tx(lang, 'İnvestor borcu', 'Долг инвестору', 'Investor Debt')), esc(''), esc(''), esc(effectiveInvestorDebt.toFixed(2)), esc('')],
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
      <p><b>${tx(lang, 'İnvestor borcu', 'Долг инвестору', 'Investor Debt')}:</b> ${effectiveInvestorDebt.toFixed(2)} ₼</p>
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
    if (!amount || new Decimal(amount).lte(0)) {
      notify('error', tx(lang, 'Məbləğ düzgün deyil', 'Неверная сумма'));
      return;
    }
    if (type === 'out' && !subject.trim()) {
      notify('error', tx(lang, 'Subyekt məcburidir', 'Поле субъекта обязательно', 'Subject is required'));
      return;
    }
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
    if (!transferAmount || new Decimal(transferAmount).lte(0)) {
      notify('error', tx(lang, 'Transfer məbləği düzgün deyil', 'Некорректная сумма перевода'));
      return;
    }
    try {
      const transferAmountDec = new Decimal(transferAmount || 0);
      const needsApproval = transferAmountDec.gte(APPROVAL_TRANSFER_THRESHOLD);
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
    }
  };

  const doRepayInvestor = async () => {
    if (!repayAmount || new Decimal(repayAmount).lte(0)) {
      notify('error', tx(lang, 'Məbləğ düzgün deyil', 'Некорректная сумма', 'Invalid amount'));
      return;
    }
    try {
      const repaymentAmount = new Decimal(repayAmount || 0);
      const available = new Decimal((balance as any)[`${repayFrom}_balance`] || 0);
      if (available.lt(repaymentAmount)) {
        notify('error', tx(lang, 'Seçilən mənbədə kifayət qədər vəsait yoxdur', 'В выбранном источнике недостаточно средств', 'Selected source has insufficient balance'));
        return;
      }
      if (effectiveInvestorDebt.lte(0)) {
        notify('error', tx(lang, 'İnvestora borc yoxdur', 'Нет долга инвестору', 'No investor debt'));
        return;
      }
      const payable = Decimal.min(repaymentAmount, effectiveInvestorDebt);
      const result = await create_finance_ledger_transaction_async(tenant_id, {
        transaction_type: 'investor_repayment',
        source_account_code: repayFrom,
        destination_account_code: 'investor',
        amount: payable.toString(),
        category: 'İnvestora Geri Ödəniş',
        note: repayNote || 'İnvestora ödəniş approval request',
        requires_approval: true,
      });
      setRepayAmount('');
      setRepayNote('');
      await reloadFinance(true);
      notify(
        'success',
        tx(
          lang,
          `İnvestor ödənişi təsdiqə göndərildi: ${new Decimal(payable).toFixed(2)} ₼`,
          `Выплата инвестору отправлена на approval: ${new Decimal(payable).toFixed(2)} ₼`,
          `Investor repayment sent for approval: ${new Decimal(payable).toFixed(2)} ₼`,
        ),
      );
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Ödəniş alınmadı', 'Платеж не выполнен', 'Repayment failed'));
    }
  };

  const doReconcile = async () => {
    if (!reconcileCounted || new Decimal(reconcileCounted).isNaN()) {
      notify('error', tx(lang, 'Sayılmış məbləği yazın', 'Введите посчитанную сумму', 'Enter counted amount'));
      return;
    }
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
  const pendingApprovalsCount = pendingApprovals.length;
  const financeAlerts = [
    ...(pendingApprovals.length > 0
      ? [{
          id: 'pending-approvals',
          title: tx(lang, 'Approval gözləyən əməliyyatlar', 'Операции ожидают approval', 'Pending approvals'),
          body: `${pendingApprovals.length} ${tx(lang, 'maliyyə əməliyyatı təsdiq gözləyir', 'финансовых операций ожидают подтверждения', 'finance transactions waiting for approval')}`,
          tone: 'amber' as const,
          action: tx(lang, 'Approve', 'Подтвердить', 'Approve'),
          tab: 'overview' as FinanceWorkspaceTab,
        }]
      : []),
    ...(anomalies?.has_shift_cash_mismatch
      ? [{
          id: 'unreconciled-till',
          title: tx(lang, 'Unreconciled till', 'Несверенная касса', 'Unreconciled till'),
          body: `${tx(lang, 'Kassa fərqi', 'Расхождение кассы', 'Cash gap')}: ${new Decimal(anomalies.shift_cash_gap || 0).toFixed(2)} ₼`,
          tone: 'rose' as const,
          action: tx(lang, 'Reconcile', 'Сверить', 'Reconcile'),
          tab: 'reconciliation' as FinanceWorkspaceTab,
        }]
      : []),
    ...(new Decimal(balance.cash_balance || 0).lessThan(0)
      ? [{
          id: 'negative-cash',
          title: tx(lang, 'Negative cash risk', 'Риск отрицательной кассы', 'Negative cash risk'),
          body: tx(lang, 'Nağd kassa mənfidir. Ledger və manual entry-ləri yoxlayın.', 'Касса отрицательная. Проверьте ledger и ручные записи.', 'Cash drawer is negative. Review ledger and manual entries.'),
          tone: 'rose' as const,
          action: tx(lang, 'Review', 'Проверить', 'Review'),
          tab: 'ledger' as FinanceWorkspaceTab,
        }]
      : []),
    ...(effectiveInvestorDebt.greaterThan(0)
      ? [{
          id: 'investor-balance',
          title: tx(lang, 'Investor balance open', 'Открыт долг инвестору', 'Investor balance open'),
          body: `${tx(lang, 'Qalan borc', 'Остаток долга', 'Remaining debt')}: ${effectiveInvestorDebt.toFixed(2)} ₼`,
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
          action: tx(lang, 'Review', 'Проверить', 'Review'),
          tab: 'overview' as FinanceWorkspaceTab,
        }]
      : []),
  ];

  const selectQuickAction = (action: FinanceQuickAction) => {
    setQuickAction(action);
    if (action === 'income') {
      setType('in');
      setWorkspaceTab('transactions');
      return;
    }
    if (action === 'expense') {
      setType('out');
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

  const transactionForm = (
    <div className="rounded-[28px] border border-slate-800 bg-slate-950 p-5">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">
            {quickAction === 'income' ? tx(lang, 'Mədaxil əməliyyatı', 'Операция прихода', 'Income transaction') : tx(lang, 'Xərc əməliyyatı', 'Операция расхода', 'Expense transaction')}
          </div>
          <h3 className="mt-2 text-xl font-black text-white">{tx(lang, 'Transaction Entry Form', 'Форма операции', 'Transaction Entry Form')}</h3>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setQuickAction('income'); setType('in'); }} className={`min-h-11 rounded-2xl px-4 text-sm font-black ${type === 'in' ? 'bg-emerald-400 text-slate-950' : 'border border-slate-700 text-slate-300'}`}>
            {tx(lang, 'Mədaxil', 'Приход', 'Income')}
          </button>
          <button onClick={() => { setQuickAction('expense'); setType('out'); }} className={`min-h-11 rounded-2xl px-4 text-sm font-black ${type === 'out' ? 'bg-rose-400 text-slate-950' : 'border border-slate-700 text-slate-300'}`}>
            {tx(lang, 'Xərc', 'Расход', 'Expense')}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <FinanceField label={tx(lang, 'Source account', 'Счет источник', 'Source account')} helper={selectedSource?.helper}>
          <select className="neon-input min-h-13" value={source} onChange={(e) => setSource(e.target.value as WalletSource)}>
            {sourceOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </FinanceField>
        <FinanceField label={tx(lang, 'Category', 'Категория', 'Category')} helper={selectedCategory.helper}>
          <select className="neon-input min-h-13" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categoryOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </FinanceField>
        <FinanceField label={tx(lang, 'Counterparty', 'Контрагент', 'Counterparty')} helper={type === 'out' ? tx(lang, 'Xərcdə məcburidir: pul kimə getdi?', 'Для расхода обязательно: кому ушли деньги?', 'Required for expense: who received money?') : tx(lang, 'Mədaxildə optionaldır.', 'Для прихода необязательно.', 'Optional for income.')}>
          <select className="neon-input min-h-13" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">{tx(lang, 'Subyekt seçin', 'Выберите субъект', 'Select subject')}</option>
            {subjectPresets.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
          </select>
        </FinanceField>
        <FinanceField label={tx(lang, 'Amount', 'Сумма', 'Amount')} helper={tx(lang, 'Məbləği AZN ilə yazın.', 'Введите сумму в AZN.', 'Enter amount in AZN.')}>
          <input className="neon-input min-h-16 text-2xl font-black" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FinanceField>
        <FinanceField label={tx(lang, 'Note', 'Комментарий', 'Note')} helper={tx(lang, 'Qısa izah yazın.', 'Краткое описание.', 'Add a short note.')}>
          <input className="neon-input min-h-13" value={description} onChange={(e) => setDescription(e.target.value)} />
        </FinanceField>
        <FinanceField label={tx(lang, 'Yeni counterparty preset', 'Новый preset контрагента', 'New counterparty preset')} helper={tx(lang, 'Təchizatçı və digər subyektləri tez seçmək üçün.', 'Чтобы быстро выбирать поставщиков и субъекты.', 'For quick supplier/counterparty selection.')}>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input className="neon-input min-h-13" value={newSubjectPreset} onChange={(e) => setNewSubjectPreset(e.target.value)} />
            <button type="button" onClick={addSubjectPreset} className="neon-btn rounded-2xl px-4 text-sm font-black">{tx(lang, 'Əlavə et', 'Добавить', 'Add')}</button>
          </div>
        </FinanceField>
      </div>
      <button onClick={() => void addEntry()} className="glossy-gold mt-5 min-h-14 rounded-2xl px-6 text-base font-black">
        {tx(lang, 'Post transaction', 'Провести операцию', 'Post transaction')}
      </button>
    </div>
  );

  const transferForm = (
    <div className="rounded-[28px] border border-slate-800 bg-slate-950 p-5">
      <div className="mb-5">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">{tx(lang, 'Internal transfer', 'Внутренний перевод', 'Internal transfer')}</div>
        <h3 className="mt-2 text-xl font-black text-white">{tx(lang, 'TransferForm', 'Форма перевода', 'TransferForm')}</h3>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FinanceField label={tx(lang, 'From → To', 'Откуда → куда', 'From → To')}>
          <select className="neon-input min-h-13" value={transferDirection} onChange={(e) => setTransferDirection(e.target.value as any)}>
            <option value="card_to_cash">{tx(lang, 'Kartdan Kassaya', 'С карты в кассу')}</option>
            <option value="cash_to_card">{tx(lang, 'Kassadan Karta', 'Из кассы на карту')}</option>
            <option value="cash_to_safe">{tx(lang, 'Kassadan Seyfə', 'Из кассы в сейф', 'Cash to Safe')}</option>
            <option value="safe_to_cash">{tx(lang, 'Seyfdən Kassaya', 'Из сейфа в кассу', 'Safe to Cash')}</option>
            <option value="cash_to_debt">{tx(lang, 'Kassadan Borca', 'Из кассы в долг')}</option>
            <option value="card_to_debt">{tx(lang, 'Kartdan Borca', 'С карты в долг')}</option>
          </select>
        </FinanceField>
        <FinanceField label={tx(lang, 'Amount', 'Сумма', 'Amount')}>
          <input className="neon-input min-h-16 text-2xl font-black" type="number" min={0} step="0.01" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} />
        </FinanceField>
        <FinanceField label={tx(lang, 'Fee', 'Комиссия', 'Fee')} helper={`${bankCommissionConfig.card_transfer_percent}% card-out policy`}>
          <input className="neon-input min-h-13" type="number" min={0} step="0.01" value={computedTransferCommission.toString()} onChange={(e) => setTransferCommission(e.target.value)} readOnly={transferDirection === 'card_to_cash'} />
        </FinanceField>
      </div>
      {new Decimal(transferAmount || 0).gte(APPROVAL_TRANSFER_THRESHOLD) && (
        <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-950/25 p-4 text-sm font-bold text-amber-100">
          {tx(lang, 'Bu məbləğ böyük transfer sayılır və birbaşa post olunmayacaq. Approval inbox-a göndəriləcək.', 'Эта сумма считается крупным переводом и не будет posted сразу. Она уйдет в approval inbox.', 'This is a large transfer and will not post immediately. It will be sent to the approval inbox.')}
        </div>
      )}
      <button onClick={() => void doTransfer()} className="neon-btn mt-5 min-h-14 rounded-2xl px-6 text-base font-black">
        {tx(lang, 'Post transfer', 'Провести перевод', 'Post transfer')}
      </button>
    </div>
  );

  const investorForm = (
    <div className="rounded-[28px] border border-slate-800 bg-slate-950 p-5">
      <div className="mb-5">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">{tx(lang, 'Investor liability', 'Обязательство инвестору', 'Investor liability')}</div>
        <h3 className="mt-2 text-xl font-black text-white">{tx(lang, 'InvestorRepaymentForm', 'Форма выплаты инвестору', 'InvestorRepaymentForm')}</h3>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <FinanceField label={tx(lang, 'Payment source', 'Источник оплаты', 'Payment source')}>
          <select className="neon-input min-h-13" value={repayFrom} onChange={(e) => setRepayFrom(e.target.value as any)}>
            <option value="cash">{tx(lang, 'Kassa', 'Касса', 'Cash')}</option>
            <option value="card">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
            <option value="safe">{tx(lang, 'Seyf', 'Сейф', 'Safe')}</option>
          </select>
        </FinanceField>
        <FinanceField label={tx(lang, 'Amount', 'Сумма', 'Amount')} helper={`${tx(lang, 'Qalan borc', 'Остаток долга', 'Remaining debt')}: ${effectiveInvestorDebt.toFixed(2)} ₼`}>
          <input className="neon-input min-h-16 text-2xl font-black" type="number" min={0} step="0.01" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} />
        </FinanceField>
        <FinanceField label={tx(lang, 'Approval note', 'Комментарий подтверждения', 'Approval note')}>
          <input className="neon-input min-h-13" value={repayNote} onChange={(e) => setRepayNote(e.target.value)} />
        </FinanceField>
      </div>
      <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-950/25 p-4 text-sm font-bold text-amber-100">
        {tx(lang, 'Investor ödənişi nəzarətli əməliyyatdır. Bu request əvvəl approval inbox-a düşəcək, təsdiqdən sonra kassa/kart/seyf və investor borcu yenilənəcək.', 'Выплата инвестору — контролируемая операция. Request попадет в approval inbox и только после подтверждения обновит кассу/карту/сейф и долг инвестору.', 'Investor repayment is a controlled operation. The request goes to approval inbox first; after approval it updates cash/card/safe and investor liability.')}
      </div>
      <button onClick={() => void doRepayInvestor()} className="glossy-gold mt-5 min-h-14 rounded-2xl px-6 text-base font-black">
        {tx(lang, 'Approval-a göndər', 'Отправить на approval', 'Send for approval')}
      </button>
    </div>
  );

  const accountName = (code?: string | null) =>
    ledgerAccountByCode.get(String(code || ''))?.name || code || '-';

  const transactionTypeLabel = (value?: string | null) => {
    const typeValue = String(value || '').replace(/_/g, ' ');
    if (!typeValue) return '-';
    return typeValue.replace(/\b\w/g, (letter) => letter.toUpperCase());
  };

  const approvalInbox = (
    <FinanceControlCard
      title={tx(lang, 'Approval inbox', 'Approval inbox', 'Approval inbox')}
      subtitle={tx(lang, 'Riskli maliyyə əməliyyatları posting-dən əvvəl təsdiq gözləyir', 'Рискованные финансовые операции ждут подтверждения перед posting', 'Risky finance transactions wait for approval before posting')}
    >
      <div className="space-y-3">
        {pendingApprovals.slice(0, 6).map((row) => (
          <div key={row.id} className="rounded-2xl border border-amber-400/25 bg-amber-950/20 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <button onClick={() => void openLedgerDetail(row)} className="min-w-0 text-left">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-200">{transactionTypeLabel(row.transaction_type)}</div>
                <div className="mt-1 text-lg font-black text-white">{new Decimal(row.amount || 0).toFixed(2)} ₼</div>
                <div className="mt-1 text-sm text-slate-400">
                  {accountName(row.source_account)} → {accountName(row.destination_account)} · {row.created_by || '-'}
                </div>
              </button>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void approveTransaction(row.id)} className="min-h-11 rounded-2xl bg-emerald-300 px-4 text-sm font-black text-slate-950">
                  {tx(lang, 'Təsdiqlə', 'Подтвердить', 'Approve')}
                </button>
                <button onClick={() => void rejectTransaction(row.id)} className="min-h-11 rounded-2xl border border-rose-400/40 px-4 text-sm font-black text-rose-100">
                  {tx(lang, 'Rədd et', 'Отклонить', 'Reject')}
                </button>
              </div>
            </div>
          </div>
        ))}
        {pendingApprovals.length === 0 && (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-950/20 p-4 text-sm font-bold text-emerald-100">
            {tx(lang, 'Approval gözləyən əməliyyat yoxdur.', 'Нет операций, ожидающих approval.', 'No transactions waiting for approval.')}
          </div>
        )}
      </div>
    </FinanceControlCard>
  );

  const ledgerTable = (
    <div className="rounded-[28px] border border-slate-800 bg-slate-950 p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">{tx(lang, 'Double-entry journal', 'Двойной ledger', 'Double-entry journal')}</div>
          <h3 className="mt-2 text-xl font-black text-white">{tx(lang, 'Ledger Transactions', 'Ledger операции', 'Ledger Transactions')}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {tx(lang, 'Hər posted transaction debit/credit entry-lərlə izlənir.', 'Каждая posted transaction отслеживается debit/credit записями.', 'Every posted transaction is tracked with debit/credit entries.')}
          </p>
        </div>
        <div className="flex gap-2">
          <select value={ledgerPageSize} onChange={(e) => setLedgerPageSize(Number(e.target.value))} className="neon-input min-h-12 w-28">
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <button className="neon-btn rounded-2xl px-4 text-sm font-black" onClick={exportCsv}>{tx(lang, 'Export', 'Экспорт', 'Export')}</button>
        </div>
      </div>
      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ledgerAccounts.slice(0, 6).map((account) => (
          <div key={account.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{account.code}</div>
            <div className="mt-1 text-sm font-black text-white">{account.name}</div>
            <div className="mt-2 text-lg font-black text-emerald-200">{new Decimal(account.ledger_balance || 0).toFixed(2)} ₼</div>
          </div>
        ))}
        {ledgerAccounts.length === 0 && (
          <div className="col-span-full rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
            {tx(lang, 'Ledger hesabları hələ yüklənməyib.', 'Ledger счета еще не загружены.', 'Ledger accounts are not loaded yet.')}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-slate-400">
            <tr>
              <th className="py-3">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
              <th className="py-3">{tx(lang, 'Status', 'Статус', 'Status')}</th>
              <th className="py-3">{tx(lang, 'Type', 'Тип', 'Type')}</th>
              <th className="py-3">{tx(lang, 'From → To', 'Откуда → куда', 'From → To')}</th>
              <th className="py-3">{tx(lang, 'Category', 'Категория', 'Category')}</th>
              <th className="py-3 text-right">{tx(lang, 'Amount', 'Сумма', 'Amount')}</th>
              <th className="py-3">{tx(lang, 'Note', 'Комментарий', 'Note')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleLedgerTransactions.map((entry) => (
              <tr
                key={entry.id}
                onClick={() => void openLedgerDetail(entry)}
                className="cursor-pointer border-b border-slate-900 transition hover:bg-slate-900/70"
              >
                <td className="py-3 text-slate-300">{formatServerUtcDateTime(entry.posted_at || entry.created_at || '', lang)}</td>
                <td className="py-3"><span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-200">{entry.status || 'posted'}</span></td>
                <td className="py-3 font-bold text-sky-200">{transactionTypeLabel(entry.transaction_type)}</td>
                <td className="py-3 text-slate-300">
                  <span className="font-bold text-slate-200">{accountName(entry.source_account)}</span>
                  <span className="px-2 text-slate-600">→</span>
                  <span className="font-bold text-slate-200">{accountName(entry.destination_account)}</span>
                </td>
                <td className="py-3 text-slate-200">{entry.category || '-'}</td>
                <td className="py-3 text-right font-black text-white">{new Decimal(entry.amount || 0).toFixed(2)} ₼</td>
                <td className="max-w-[280px] truncate py-3 text-slate-400">{entry.note || entry.reference || '-'}</td>
              </tr>
            ))}
            {visibleLedgerTransactions.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-slate-500">{tx(lang, 'Bu aralıqda ledger qeydi yoxdur', 'За период нет ledger записей', 'No ledger rows for this range')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
        {ledgerEntries.length} {tx(lang, 'debit/credit entry yüklənib. Transaction detail drawer növbəti mərhələdə bu entry-ləri ayrıca göstərəcək.', 'debit/credit записей загружено. Drawer деталей transaction покажет их на следующем этапе.', 'debit/credit entries loaded. The transaction detail drawer will expose them in the next phase.')}
      </div>
    </div>
  );

  return (
    <FinanceDashboard>
      <FinanceSummaryStrip
        lang={lang}
        balance={balance}
        netCashflow={financeSummary.net}
        reconciliationGap={unreconciledVariance}
        pendingApprovals={pendingApprovalsCount}
        onRefresh={() => void reloadFinance(true)}
      />

      <FinanceAlertsBar
        alerts={financeAlerts}
        onOpen={(tab) => setWorkspaceTab(tab)}
      />

      <FinanceQuickActions
        lang={lang}
        active={quickAction}
        onSelect={selectQuickAction}
      />

      <FinanceWorkspaceTabs
        lang={lang}
        active={workspaceTab}
        onChange={setWorkspaceTab}
      />

      {workspaceTab === 'overview' && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <FinanceControlCard title={tx(lang, 'Today flow', 'Поток сегодня', 'Today flow')} subtitle={tx(lang, 'Operativ cashflow, investor/depozit/transfer xaric', 'Операционный cashflow без инвестора/депозитов/transfer', 'Operational cashflow excluding investor/deposit/transfer')}>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <FinanceMiniMetric label={tx(lang, 'Inflow', 'Приход', 'Inflow')} value={`${todayInflow.toFixed(2)} ₼`} tone="emerald" />
                <FinanceMiniMetric label={tx(lang, 'Outflow', 'Расход', 'Outflow')} value={`${todayOutflow.toFixed(2)} ₼`} tone="rose" />
                <FinanceMiniMetric label={tx(lang, 'Net', 'Нетто', 'Net')} value={`${financeSummary.net.toFixed(2)} ₼`} tone={financeSummary.net.gte(0) ? 'emerald' : 'rose'} />
              </div>
            </FinanceControlCard>
            {transactionForm}
          </div>
          <div className="space-y-5">
            <FinanceControlCard title={tx(lang, 'Control summary', 'Сводка контроля', 'Control summary')} subtitle={tx(lang, 'Öhdəliklər və risklər', 'Обязательства и риски', 'Liabilities and risks')}>
              <div className="space-y-3">
                <FinanceMiniMetric label={tx(lang, 'Investor liability', 'Долг инвестору', 'Investor liability')} value={`${effectiveInvestorDebt.toFixed(2)} ₼`} tone="amber" />
                <FinanceMiniMetric label={tx(lang, 'Active deposits', 'Активные депозиты', 'Active deposits')} value={`${new Decimal(balance.deposit_balance || 0).toFixed(2)} ₼`} tone="sky" />
                <FinanceMiniMetric label={tx(lang, 'Liquidity', 'Ликвидность', 'Liquidity')} value={cashCoverage === 'N/A' ? cashCoverage : `${cashCoverage}%`} tone="violet" />
              </div>
            </FinanceControlCard>
            {approvalInbox}
            {ledgerTable}
          </div>
        </div>
      )}

      {workspaceTab === 'transactions' && transactionForm}
      {workspaceTab === 'transfers' && transferForm}
      {workspaceTab === 'investor' && investorForm}
      {workspaceTab === 'deposits' && (
        <FinanceControlCard title={tx(lang, 'Deposits', 'Депозиты', 'Deposits')} subtitle={tx(lang, 'Depozit ayrıca liability kimi izlənir', 'Депозиты учитываются как отдельное обязательство', 'Deposits are tracked as a separate liability')}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FinanceMiniMetric label={tx(lang, 'Active deposit liability', 'Активное депозитное обязательство', 'Active deposit liability')} value={`${new Decimal(balance.deposit_balance || 0).toFixed(2)} ₼`} tone="amber" />
            <FinanceMiniMetric label={tx(lang, 'Collected in range', 'Собрано за период', 'Collected in range')} value={`${depositsInRange.toFixed(2)} ₼`} tone="sky" />
          </div>
        </FinanceControlCard>
      )}
      {workspaceTab === 'reconciliation' && (
        <FinanceControlCard title={tx(lang, 'Reconciliation', 'Сверка', 'Reconciliation')} subtitle={tx(lang, 'Till count, expected və actual balans tutuşdurması', 'Till count, сверка expected и actual баланса', 'Till count, expected vs actual balance')}>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[24px] border border-slate-800 bg-slate-950 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <FinanceMiniMetric label="Expected" value={`${expectedReconcileBalance.toFixed(2)} ₼`} tone="sky" />
                <FinanceMiniMetric label="Counted" value={`${new Decimal(reconcileCounted || 0).toFixed(2)} ₼`} tone="emerald" />
                <FinanceMiniMetric label="Variance" value={`${reconcileVariance.toFixed(2)} ₼`} tone={reconcileVariance.abs().gt(0.01) ? 'rose' : 'emerald'} />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3">
                <FinanceField label={tx(lang, 'Account / till', 'Счет / касса', 'Account / till')}>
                  <select className="neon-input min-h-13" value={reconcileAccount} onChange={(e) => setReconcileAccount(e.target.value)}>
                    {(ledgerAccounts.length ? ledgerAccounts : [
                      { code: 'cash', name: 'Nağd Kassa' },
                      { code: 'card', name: 'Bank/Kart' },
                      { code: 'safe', name: 'Seyf' },
                    ] as any[]).map((account: any) => (
                      <option key={account.code} value={account.code}>{account.name}</option>
                    ))}
                  </select>
                </FinanceField>
                <FinanceField label={tx(lang, 'Sayılmış balans', 'Посчитанный баланс', 'Counted balance')} helper={tx(lang, 'Operator fiziki saydığı məbləği yazır.', 'Оператор вводит физически посчитанную сумму.', 'Operator enters the physically counted amount.')}>
                  <input className="neon-input min-h-16 text-2xl font-black" type="number" min={0} step="0.01" value={reconcileCounted} onChange={(e) => setReconcileCounted(e.target.value)} />
                </FinanceField>
                <FinanceField label={tx(lang, 'Qeyd', 'Комментарий', 'Note')}>
                  <input className="neon-input min-h-13" value={reconcileNotes} onChange={(e) => setReconcileNotes(e.target.value)} />
                </FinanceField>
                <button onClick={() => void doReconcile()} className="glossy-gold min-h-14 rounded-2xl px-6 text-base font-black">
                  {tx(lang, 'Reconcile et', 'Сверить', 'Reconcile')}
                </button>
              </div>
            </div>
            <div className="rounded-[24px] border border-slate-800 bg-slate-950 p-4">
              <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-yellow-300">{tx(lang, 'Son reconciliation-lar', 'Последние сверки', 'Recent reconciliations')}</div>
              <div className="space-y-3">
                {reconciliations.slice(0, 8).map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-black text-white">{row.account_name || row.account_code}</div>
                        <div className="text-xs text-slate-500">{formatServerUtcDateTime(row.reconciled_at || row.created_at || '', lang)} · {row.reconciled_by || row.created_by}</div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${new Decimal(row.variance || 0).abs().gt(0.01) ? 'bg-rose-400/10 text-rose-200' : 'bg-emerald-400/10 text-emerald-200'}`}>
                        {new Decimal(row.variance || 0).toFixed(2)} ₼
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      Expected {new Decimal(row.expected_balance || 0).toFixed(2)} ₼ · Counted {new Decimal(row.counted_balance || 0).toFixed(2)} ₼
                    </div>
                    {row.notes && <div className="mt-2 text-xs text-slate-500">{row.notes}</div>}
                  </div>
                ))}
                {reconciliations.length === 0 && (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
                    {tx(lang, 'Hələ reconciliation qeydi yoxdur.', 'Пока нет записей сверки.', 'No reconciliation records yet.')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </FinanceControlCard>
      )}
      {workspaceTab === 'ledger' && ledgerTable}

      <TransactionDetailDrawer
        lang={lang}
        detail={selectedLedgerDetail}
        loading={ledgerDetailLoading}
        accountName={accountName}
        onApprove={approveTransaction}
        onReject={rejectTransaction}
        onReverse={requestReversal}
        onClose={() => setSelectedLedgerDetail(null)}
      />
    </FinanceDashboard>
  );

  return (
    <div className="space-y-6 text-slate-100">
      <div className="overflow-hidden rounded-[28px] border border-slate-700/70 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_28%),linear-gradient(135deg,#1d2632,#0f1722)] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200/80">
              {tx(lang, 'Maliyyə İdarəetməsi', 'Финансовое управление', 'Finance Control')}
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-white">
              {tx(lang, 'Pul axınına bir baxışda nəzarət edin', 'Контролируйте денежный поток с одного экрана', 'Control cash flow from one screen')}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              {tx(
                lang,
                'Kassa, kart, seyf, investor borcu və gündəlik hərəkətlər eyni paneldə toplanır. Məqsəd sürətli qərar vermək və qarışıqlığı azaltmaqdır.',
                'Касса, карта, сейф, долг инвестору и ежедневные движения собраны в одной панели. Цель — быстро принимать решения и убрать хаос.',
                'Cash, card, safe, investor debt, and daily movements are collected in one panel so decisions are faster and cleaner.',
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:min-w-[460px]">
            <HighlightStat
              label={tx(lang, 'Net Cashflow', 'Нетто поток', 'Net Cashflow')}
              value={`${financeSummary.net.toFixed(2)} ₼`}
              tone={financeHealthTone}
              helper={tx(lang, 'İnvestor, açılış, depozit və daxili transfer xaric', 'Без инвестора, открытия, депозитов и внутренних переводов', 'Excluding investor, opening, deposits, and internal transfers')}
            />
            <HighlightStat
              label={tx(lang, 'Likvidlik', 'Ликвидность', 'Liquidity')}
              value={cashCoverage === 'N/A' ? cashCoverage : `${cashCoverage}%`}
              tone="text-sky-300"
              helper={cashCoverage === 'N/A' ? tx(lang, 'Öhdəlik yoxdur', 'Обязательств нет', 'No obligations') : tx(lang, 'Likvid vəsait / öhdəlik', 'Ликвидные средства / обязательства', 'Liquid cash / obligations')}
            />
            <HighlightStat
              label={tx(lang, 'Qeyd sayı', 'Кол-во записей', 'Entries')}
              value={String(financeSummary.entriesCount)}
              tone="text-violet-300"
              helper={tx(lang, 'Yalnız operativ maliyyə qeydləri', 'Только операционные записи', 'Operational finance rows only')}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <WalletCard title={tx(lang, 'Nağd Kassa', 'Наличная касса', 'Cash Drawer')} value={balance.cash_balance} helper={tx(lang, 'Birbaşa işlək nağd pul', 'Оперативная наличность', 'Operational cash on hand')} />
        <WalletCard title={tx(lang, 'Bank/Kart Hesabı', 'Банк/карта', 'Bank/Card Wallet')} value={balance.card_balance} helper={tx(lang, 'Kart və bank qalıqları', 'Остатки на карте и в банке', 'Card and bank holdings')} />
        <WalletCard
          title={tx(lang, 'İnvestora Borcumuz', 'Наш долг инвестору', 'Debt To Investor')}
          value={effectiveInvestorDebt.toFixed(2)}
          helper={tx(lang, 'Qalan investor öhdəliyi', 'Оставшееся обязательство перед инвестором', 'Remaining investor liability')}
          accent="rose"
        />
        <WalletCard title={tx(lang, 'Seyf', 'Сейф', 'Safe')} value={balance.safe_balance || '0'} helper={tx(lang, 'Rezerv vəsait', 'Резервные средства', 'Reserved funds')} accent="sky" />
        <WalletCard title={tx(lang, 'Aktiv Masa Depoziti', 'Активные депозиты столов', 'Active Table Deposits')} value={new Decimal(balance.deposit_balance || 0).toFixed(2)} helper={tx(lang, 'Hazırda açıq masalarda saxlanan depozit öhdəliyi', 'Текущие депозиты по открытым столам', 'Deposit liability currently held on open tables')} accent="amber" />
      </div>

      <div className="rounded-[24px] border border-slate-700/70 bg-slate-950/40 p-4 text-sm text-slate-300 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
        <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{tx(lang, 'Source Of Truth', 'Источник данных', 'Source Of Truth')}</div>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="font-semibold text-slate-100">{tx(lang, 'Nağd / Kart / Seyf', 'Касса / карта / сейф', 'Cash / Card / Safe')}</div>
            <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Finance ledger balanslarından hesablanır.', 'Считается по балансам finance ledger.', 'Calculated from finance ledger balances.')}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="font-semibold text-slate-100">{tx(lang, 'Investor Borcu', 'Долг инвестору', 'Investor Debt')}</div>
            <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Founder investment və investor repayment yazılarından çıxır.', 'Формируется из founder investment и investor repayment записей.', 'Derived from founder investment and investor repayment entries.')}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="font-semibold text-slate-100">{tx(lang, 'Aktiv Masa Depoziti', 'Активные депозиты столов', 'Active Table Deposits')}</div>
            <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Depozit liability ledger-dən oxunur, masa bağlandıqca azalır.', 'Читается из deposit liability ledger и уменьшается при закрытии стола.', 'Read from deposit liability ledger and reduced on table settlement.')}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="font-semibold text-slate-100">{tx(lang, 'Net Cashflow', 'Нетто поток', 'Net Cashflow')}</div>
            <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Operativ hərəkətlərdir; açılış, investor, depozit və daxili transfer xaricdir.', 'Только операционные движения; без открытия, инвестора, депозитов и внутренних переводов.', 'Operational only; excludes opening, investor, deposits, and transfers.')}</div>
          </div>
        </div>
      </div>

      {financeExceptions.length > 0 && (
        <div className="rounded-[24px] border border-rose-500/20 bg-rose-500/5 p-4 text-sm shadow-[0_10px_30px_rgba(0,0,0,0.15)]">
          <div className="text-xs font-black uppercase tracking-[0.22em] text-rose-300">{tx(lang, 'Audit Exceptions', 'Аудит-исключения', 'Audit Exceptions')}</div>
          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
            {financeExceptions.map((item) => (
              <div key={item.title} className={`rounded-2xl border p-3 ${item.tone === 'rose' ? 'border-rose-500/30 bg-rose-950/30' : item.tone === 'amber' ? 'border-amber-500/30 bg-amber-950/20' : 'border-sky-500/30 bg-sky-950/20'}`}>
                <div className="font-semibold text-slate-100">{item.title}</div>
                <div className="mt-1 text-xs text-slate-300">{item.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="metal-panel p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Hesabat Aralığı', 'Период отчета', 'Report Range')}</div>
            <div className="flex flex-wrap gap-2">
              {([
                ['daily', tx(lang, 'Günlük', 'Дневной', 'Daily')],
                ['weekly', tx(lang, 'Həftəlik', 'Недельный', 'Weekly')],
                ['monthly', tx(lang, 'Aylıq', 'Месячный', 'Monthly')],
                ['yearly', tx(lang, 'İllik', 'Годовой', 'Yearly')],
                ['custom', tx(lang, 'Tarix Aralığı', 'Диапазон дат', 'Date Range')],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  className={`rounded-xl px-4 py-3 text-sm font-semibold ${rangePreset === key ? 'bg-yellow-400 text-slate-900' : 'border border-slate-600 text-slate-200'}`}
                  onClick={() => applyRangePreset(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 md:flex-row">
              <input type="date" value={fromDate} onChange={(e) => { setRangePreset('custom'); setFromDate(e.target.value); }} className="neon-input min-h-13 md:w-44" />
              <input type="date" value={toDate} onChange={(e) => { setRangePreset('custom'); setToDate(e.target.value); }} className="neon-input min-h-13 md:w-44" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:min-w-[460px] xl:grid-cols-4">
            <MiniSummaryCard
              label={tx(lang, 'Girişlər', 'Поступления', 'Incoming')}
              value={`${financeSummary.incoming.toFixed(2)} ₼`}
              tone="emerald"
            />
            <MiniSummaryCard
              label={tx(lang, 'Çıxışlar', 'Расходы', 'Outgoing')}
              value={`${financeSummary.outgoing.toFixed(2)} ₼`}
              tone="rose"
            />
            <MiniSummaryCard
              label={tx(lang, 'Ən böyük xərc', 'Крупнейший расход', 'Largest Expense')}
              value={financeSummary.biggestExpense ? `${new Decimal(financeSummary.biggestExpense.amount || 0).toFixed(2)} ₼` : '0.00 ₼'}
              helper={financeSummary.biggestExpense?.category || tx(lang, 'Hələ yoxdur', 'Пока нет', 'None yet')}
              tone="amber"
            />
            <MiniSummaryCard
              label={tx(lang, 'Depozitlər', 'Депозиты', 'Deposits')}
              value={`${depositsInRange.toFixed(2)} ₼`}
              helper={tx(lang, 'Masa açılışlarında yığılan məbləğ', 'Собрано при открытии столов', 'Collected from table openings')}
              tone="sky"
            />
          </div>
          <div className="flex flex-col gap-2 md:flex-row">
            <button className="neon-btn min-h-13 rounded-xl px-4 py-3 text-sm" onClick={exportCsv}>
              {tx(lang, 'CSV Export', 'Экспорт CSV', 'CSV Export')}
            </button>
            <button className="glossy-gold min-h-13 rounded-xl px-4 py-3 text-sm font-semibold" onClick={() => { void sendFinanceSummary(); }}>
              {tx(lang, 'Email Göndər', 'Отправить email', 'Send Email')}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="metal-panel p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">{tx(lang, 'Smart Xərc / Mədaxil', 'Умный расход / приход', 'Smart Expense / Income')}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {tx(lang, 'Günlük əməliyyatları standart formda daxil edin.', 'Вносите ежедневные операции в стандартной форме.', 'Record daily finance moves in a standard format.')}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-700/70 bg-slate-950/30 px-4 py-3 text-right">
              <div className="text-xs text-slate-400">{tx(lang, 'Cari seçim', 'Текущий режим', 'Current mode')}</div>
              <div className="mt-1 text-sm font-semibold text-slate-100">{type === 'in' ? tx(lang, 'Giriş', 'Приход', 'Income') : tx(lang, 'Çıxış', 'Расход', 'Expense')}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="field-stack form-card">
              <label className="field-label">{tx(lang, 'Növ', 'Тип', 'Type')}</label>
              <select className="neon-input" value={type} onChange={(e) => setType(e.target.value as 'in' | 'out')}>
                <option value="out">{tx(lang, 'Məxaric (Çıxış)', 'Расход', 'Expense (Out)')}</option>
                <option value="in">{tx(lang, 'Mədaxil (Giriş)', 'Приход', 'Income (In)')}</option>
              </select>
              <p className="field-hint">
                {tx(lang, 'in = pul daxil olur, out = pul çıxır.', 'in = приход, out = расход.', 'in = money in, out = money out.')}
              </p>
            </div>

            <div className="field-stack form-card">
              <label className="field-label">{tx(lang, 'Mənbə', 'Источник', 'Source')}</label>
              <select className="neon-input" value={source} onChange={(e) => setSource(e.target.value as WalletSource)}>
                {sourceOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                {selectedSource?.helper}
              </p>
            </div>

            <div className="field-stack form-card md:col-span-2">
              <label className="field-label">{tx(lang, 'Kateqoriya', 'Категория', 'Category')}</label>
              <select className="neon-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categoryOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="field-hint">{selectedCategory.helper}</p>
            </div>

            <div className="field-stack form-card md:col-span-2">
              <label className="field-label">{tx(lang, 'Subyekt', 'Субъект', 'Subject')}</label>
              <select
                className="neon-input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">{tx(lang, 'Subyekt seçin', 'Выберите субъект', 'Select subject')}</option>
                {subjectPresets.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
                <input
                  className="neon-input"
                  value={newSubjectPreset}
                  onChange={(e) => setNewSubjectPreset(e.target.value)}
                  placeholder={tx(lang, 'Yeni preset əlavə et', 'Добавить новый пресет', 'Add new preset')}
                />
                <button type="button" onClick={addSubjectPreset} className="neon-btn rounded-lg px-3 py-2 text-sm">
                  {tx(lang, 'Preset əlavə et', 'Добавить пресет', 'Add Preset')}
                </button>
              </div>
              <p className="field-hint">
                {type === 'out'
                  ? tx(
                      lang,
                      'Məxaricdə məcburidir: pul kimə ödənib?',
                      'Для расхода обязательно: кому ушли деньги?',
                      'Required for expense: who received this payment?',
                    )
                  : tx(
                      lang,
                      'Mədaxildə optionaldır: pul kimdən gəlib (izah üçün).',
                      'Для прихода необязательно: от кого поступили деньги (для пояснения).',
                      'Optional for income: who sent the money (for clarity).',
                    )}
              </p>
            </div>

            <div className="field-stack form-card">
              <label className="field-label">{tx(lang, 'Məbləğ (AZN)', 'Сумма (AZN)', 'Amount (AZN)')}</label>
              <input
                className="neon-input"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="field-hint">{tx(lang, 'Məbləği AZN ilə yazın.', 'Введите сумму в AZN.', 'Enter the amount in AZN.')}</p>
            </div>

            <div className="field-stack form-card">
              <label className="field-label">{tx(lang, 'Açıqlama', 'Описание', 'Description')}</label>
              <input
                className="neon-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <p className="field-hint">{tx(lang, 'Əməliyyatın qısa səbəbini qeyd edin.', 'Кратко укажите причину операции.', 'Briefly describe the reason for this operation.')}</p>
            </div>
          </div>

          <button onClick={() => void addEntry()} className="glossy-gold mt-4 min-h-12 rounded-lg px-4 py-2 font-semibold">
            {tx(lang, 'Əməliyyatı Yaz', 'Сохранить операцию', 'Save Entry')}
          </button>
        </div>

        <div className="space-y-4">
          <div className="metal-panel p-4">
            <div className="mb-3">
              <h3 className="text-lg font-semibold">{tx(lang, 'Daxili Transfer', 'Внутренний перевод', 'Internal Transfer')}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {tx(lang, 'Cüzdanlar arası hərəkətləri nəzarətdə saxlayın.', 'Контролируйте переводы между кошельками.', 'Control movements between wallets.')}
              </p>
            </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="field-stack form-card">
              <label className="field-label">{tx(lang, 'Transfer istiqaməti', 'Направление перевода', 'Transfer direction')}</label>
              <select className="neon-input" value={transferDirection} onChange={(e) => setTransferDirection(e.target.value as any)}>
                <option value="card_to_cash">{tx(lang, 'Kartdan Kassaya', 'С карты в кассу')}</option>
                <option value="cash_to_card">{tx(lang, 'Kassadan Karta', 'Из кассы на карту')}</option>
                <option value="cash_to_safe">{tx(lang, 'Kassadan Seyfə', 'Из кассы в сейф', 'Cash to Safe')}</option>
                <option value="safe_to_cash">{tx(lang, 'Seyfdən Kassaya', 'Из сейфа в кассу', 'Safe to Cash')}</option>
                <option value="cash_to_debt">{tx(lang, 'Kassadan Borca', 'Из кассы в долг')}</option>
                <option value="card_to_debt">{tx(lang, 'Kartdan Borca', 'С карты в долг')}</option>
              </select>
            </div>
            <div className="field-stack form-card">
              <label className="field-label">{tx(lang, 'Məbləğ', 'Сумма', 'Amount')}</label>
              <input className="neon-input" type="number" min={0} step="0.01" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} />
            </div>
            <div className="field-stack form-card md:col-span-2">
              <label className="field-label">{tx(lang, 'Komissiya', 'Комиссия', 'Commission')}</label>
              <input
                className="neon-input"
                type="number"
                min={0}
                step="0.01"
                value={computedTransferCommission.toString()}
                onChange={(e) => setTransferCommission(e.target.value)}
                readOnly={transferDirection === 'card_to_cash'}
              />
              <p className="field-hint">{tx(lang, 'Kartdan çıxan hərəkətlərdə komissiya burada görünür.', 'Комиссия по карточным исходящим операциям отображается здесь.', 'Outgoing card transfer commission is shown here.')}</p>
            </div>
          </div>
          {(transferDirection === 'card_to_cash' || transferDirection === 'card_to_debt') && (
            <p className="mt-2 text-xs text-slate-300">
              {tx(
                lang,
                `Kartdan çıxan məbləğ üçün ${bankCommissionConfig.card_transfer_percent}% komissiya hesablanır.`,
                `Для суммы, выходящей с карты, применяется комиссия ${bankCommissionConfig.card_transfer_percent}%.`,
                `A ${bankCommissionConfig.card_transfer_percent}% fee is applied to funds moved out of card balance.`,
              )}
            </p>
          )}
          <button onClick={() => void doTransfer()} className="neon-btn mt-3 rounded-lg px-4 py-2">
            {tx(lang, 'Transfer Et', 'Выполнить перевод', 'Transfer')}
          </button>

          <div className="mt-5 border-t border-slate-700/50 pt-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-200">
              {tx(lang, 'İnvestora Geri Ödə', 'Погашение инвестору', 'Repay Investor')}
            </h4>
            <p className="mb-3 text-xs text-slate-400">
              {tx(
                lang,
                'Bu əməliyyat kassadan/kartdan/seyfdən pulu çıxır və investor borcunu azaldır.',
                'Операция списывает деньги из кассы/карты/сейфа и уменьшает долг инвестору.',
                'This subtracts money from cash/card/safe and reduces investor debt.',
              )}
            </p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div className="field-stack form-card">
                <label className="field-label">{tx(lang, 'Ödəniş mənbəyi', 'Источник оплаты', 'Repay from')}</label>
                <select className="neon-input" value={repayFrom} onChange={(e) => setRepayFrom(e.target.value as any)}>
                  <option value="cash">{tx(lang, 'Kassa', 'Касса', 'Cash')}</option>
                  <option value="card">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
                  <option value="safe">{tx(lang, 'Seyf', 'Сейф', 'Safe')}</option>
                </select>
              </div>
              <div className="field-stack form-card">
                <label className="field-label">{tx(lang, 'Məbləğ', 'Сумма', 'Amount')}</label>
                <input
                  className="neon-input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                />
              </div>
              <div className="field-stack form-card">
                <label className="field-label">{tx(lang, 'Qeyd', 'Комментарий', 'Note')}</label>
                <input
                  className="neon-input"
                  value={repayNote}
                  onChange={(e) => setRepayNote(e.target.value)}
                />
              </div>
            </div>
            <button onClick={() => void doRepayInvestor()} className="glossy-gold mt-3 rounded-lg px-4 py-2 font-semibold">
              {tx(lang, 'İnvestora Ödə', 'Оплатить инвестору', 'Pay Investor')}
            </button>
          </div>
        </div>

          <div className="metal-panel p-4">
            <h3 className="text-lg font-semibold text-slate-100">{tx(lang, 'Öhdəlik Xülasəsi', 'Сводка обязательств', 'Obligations Snapshot')}</h3>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MiniSummaryCard label={tx(lang, 'Investor yatırımı', 'Инвестиции инвестора', 'Investor Inflow')} value={`${new Decimal(investorSummary.invested_total || 0).toFixed(2)} ₼`} tone="sky" />
              <MiniSummaryCard label={tx(lang, 'Ödənən hissə', 'Погашено', 'Repaid')} value={`${new Decimal(investorSummary.repaid_total || 0).toFixed(2)} ₼`} tone="emerald" />
              <MiniSummaryCard label={tx(lang, 'Qalan investor borcu', 'Остаток долга инвестору', 'Remaining Investor Debt')} value={`${effectiveInvestorDebt.toFixed(2)} ₼`} tone="rose" />
              <MiniSummaryCard label={tx(lang, 'Nisyə borc balansı', 'Баланс долга', 'Debt Wallet Balance')} value={`${new Decimal(balance.debt_balance || 0).toFixed(2)} ₼`} tone="amber" />
            </div>
          </div>
        </div>
      </div>

      <div className="metal-panel p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">{tx(lang, 'Maliyyə Jurnalı', 'Финансовый журнал', 'Finance Ledger')}</h3>
            <p className="mt-1 text-sm text-slate-400">
              {tx(lang, 'Bütün maliyyə hərəkətləri burada tarixçələnir.', 'Здесь хранятся все финансовые движения.', 'Every finance movement is recorded here.')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 md:grid-cols-4">
            <div className="rounded-xl border border-slate-700/60 bg-slate-950/30 px-3 py-2">{tx(lang, 'Daxil olan', 'Вход', 'Incoming')}: <b>{financeSummary.incoming.toFixed(2)} ₼</b></div>
            <div className="rounded-xl border border-slate-700/60 bg-slate-950/30 px-3 py-2">{tx(lang, 'Çıxan', 'Выход', 'Outgoing')}: <b>{financeSummary.outgoing.toFixed(2)} ₼</b></div>
            <div className="rounded-xl border border-slate-700/60 bg-slate-950/30 px-3 py-2">{tx(lang, 'Net', 'Нетто', 'Net')}: <b>{financeSummary.net.toFixed(2)} ₼</b></div>
            <div className="rounded-xl border border-slate-700/60 bg-slate-950/30 px-3 py-2">{tx(lang, 'Qeyd sayı', 'Кол-во записей', 'Entries')}: <b>{financeSummary.entriesCount}</b></div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              {tx(lang, 'Ekranda görünən qeyd', 'Показано записей', 'Entries shown')}: <b>{visibleEntries.length}</b> / {filteredEntries.length}
            </div>
            <select value={ledgerPageSize} onChange={(e) => setLedgerPageSize(Number(e.target.value))} className="neon-input min-h-12 w-28">
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-700/60 text-slate-300">
              <tr>
                <th className="py-2">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
                <th className="py-2">{tx(lang, 'Növ', 'Тип', 'Type')}</th>
                <th className="py-2">{tx(lang, 'Kateqoriya', 'Категория', 'Category')}</th>
                <th className="py-2">{tx(lang, 'Mənbə', 'Источник', 'Source')}</th>
                <th className="py-2">{tx(lang, 'Məbləğ', 'Сумма', 'Amount')}</th>
                <th className="py-2">{tx(lang, 'Açıqlama', 'Описание', 'Description')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((e: any) => (
                <tr key={e.id} className="border-t border-slate-700/40">
                  <td className="py-2">{formatServerUtcDateTime(e.created_at, lang)}</td>
                  <td className={`py-2 ${e.type === 'in' ? 'text-emerald-300' : 'text-red-300'}`}>{e.type}</td>
                  <td className="py-2">{e.category}</td>
                  <td className="py-2">{e.source}</td>
                  <td className="py-2 font-semibold">{new Decimal(e.amount || 0).toFixed(2)} ₼</td>
                  <td className="py-2 text-slate-300">{e.description}</td>
                </tr>
              ))}
              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    {tx(lang, 'Bu tarix aralığında qeyd yoxdur', 'За этот период записей нет', 'No entries for this date range')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FinanceDashboard({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5 text-slate-100">
      {children}
    </div>
  );
}

function FinanceSummaryStrip({
  lang,
  balance,
  netCashflow,
  reconciliationGap,
  pendingApprovals,
  onRefresh,
}: {
  lang: string;
  balance: any;
  netCashflow: Decimal;
  reconciliationGap: string;
  pendingApprovals: number;
  onRefresh: () => void;
}) {
  const cards = [
    { label: tx(lang, 'Nağd Kassa', 'Касса', 'Cash on hand'), value: balance.cash_balance, tone: 'emerald' as const, icon: <Banknote size={20} /> },
    { label: tx(lang, 'Bank/Kart', 'Банк/карта', 'Bank/Card'), value: balance.card_balance, tone: 'sky' as const, icon: <Landmark size={20} /> },
    { label: tx(lang, 'Seyf', 'Сейф', 'Safe'), value: balance.safe_balance, tone: 'violet' as const, icon: <ShieldCheck size={20} /> },
    { label: tx(lang, 'Aktiv Depozitlər', 'Активные депозиты', 'Active deposits'), value: balance.deposit_balance, tone: 'amber' as const, icon: <WalletCards size={20} /> },
    { label: tx(lang, 'Bugünkü Net', 'Нетто сегодня', 'Today net'), value: netCashflow, tone: netCashflow.gte(0) ? 'emerald' as const : 'rose' as const, icon: <RefreshCw size={20} /> },
    { label: tx(lang, 'Reconciliation', 'Сверка', 'Reconciliation'), value: reconciliationGap, tone: new Decimal(reconciliationGap || 0).abs().gt(0.01) ? 'rose' as const : 'emerald' as const, icon: <GitCompareArrows size={20} /> },
  ];
  return (
    <section className="rounded-[30px] border border-slate-800 bg-slate-900 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.24em] text-yellow-300">FinanceDashboard</div>
          <h2 className="mt-2 text-2xl font-black text-white md:text-3xl">{tx(lang, 'Maliyyə nəzarət mərkəzi', 'Центр финансового контроля', 'Finance control center')}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            {tx(lang, 'Pul axını, öhdəliklər, reconciliation və ledger eyni iş sahəsindədir.', 'Денежный поток, обязательства, сверка и ledger в одном рабочем пространстве.', 'Cashflow, liabilities, reconciliation and ledger in one workspace.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-black text-amber-100">
            {tx(lang, 'Pending approvals', 'Ожидает approval', 'Pending approvals')}: {pendingApprovals}
          </span>
          <button onClick={onRefresh} className="min-h-12 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm font-black text-slate-100">
            {tx(lang, 'Yenilə', 'Обновить', 'Refresh')}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-6">
        {cards.map((card) => <FinanceKpiCard key={card.label} {...card} />)}
      </div>
    </section>
  );
}

function FinanceKpiCard({ label, value, tone, icon }: { label: string; value: any; tone: 'emerald' | 'sky' | 'violet' | 'amber' | 'rose'; icon: React.ReactNode }) {
  const toneMap = {
    emerald: 'border-emerald-400/25 bg-emerald-950/35 text-emerald-100',
    sky: 'border-sky-400/25 bg-sky-950/35 text-sky-100',
    violet: 'border-violet-400/25 bg-violet-950/35 text-violet-100',
    amber: 'border-amber-400/25 bg-amber-950/35 text-amber-100',
    rose: 'border-rose-400/25 bg-rose-950/35 text-rose-100',
  } as const;
  return (
    <div className={`rounded-[24px] border p-4 ${toneMap[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="rounded-2xl bg-white/10 p-3">{icon}</div>
        <div className="text-right text-xs font-black uppercase tracking-[0.16em] opacity-70">KPI</div>
      </div>
      <div className="mt-4 text-xs font-black uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{new Decimal(value || 0).toFixed(2)} ₼</div>
    </div>
  );
}

function FinanceAlertsBar({ alerts, onOpen }: { alerts: Array<{ id: string; title: string; body: string; tone: 'rose' | 'amber'; action: string; tab: FinanceWorkspaceTab }>; onOpen: (tab: FinanceWorkspaceTab) => void }) {
  if (!alerts.length) {
    return (
      <section className="rounded-[24px] border border-emerald-500/25 bg-emerald-950/25 p-4">
        <div className="flex items-center gap-3 text-emerald-100">
          <CheckCircle2 size={20} />
          <div className="font-black">Critical finance alert yoxdur</div>
        </div>
      </section>
    );
  }
  return (
    <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      {alerts.map((alert) => (
        <button
          key={alert.id}
          onClick={() => onOpen(alert.tab)}
          className={`rounded-[24px] border p-4 text-left ${alert.tone === 'rose' ? 'border-rose-400/30 bg-rose-950/35' : 'border-amber-400/30 bg-amber-950/30'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-black text-white">{alert.title}</div>
              <div className="mt-1 text-sm text-slate-300">{alert.body}</div>
            </div>
            <AlertTriangle size={20} className={alert.tone === 'rose' ? 'text-rose-200' : 'text-amber-200'} />
          </div>
          <div className="mt-3 inline-flex min-h-10 items-center rounded-2xl bg-white px-4 text-sm font-black text-slate-950">
            {alert.action}
          </div>
        </button>
      ))}
    </section>
  );
}

function FinanceQuickActions({ lang, active, onSelect }: { lang: string; active: FinanceQuickAction; onSelect: (action: FinanceQuickAction) => void }) {
  const actions: Array<{ id: FinanceQuickAction; label: string; helper: string; icon: React.ReactNode }> = [
    { id: 'income', label: tx(lang, 'Mədaxil yaz', 'Записать приход', 'Record income'), helper: 'income', icon: <Banknote size={18} /> },
    { id: 'expense', label: tx(lang, 'Xərc yaz', 'Записать расход', 'Record expense'), helper: 'expense', icon: <CreditCard size={18} /> },
    { id: 'transfer', label: tx(lang, 'Daxili transfer', 'Внутренний перевод', 'Internal transfer'), helper: 'transfer', icon: <ArrowRight size={18} /> },
    { id: 'investor_repayment', label: tx(lang, 'Investor ödə', 'Оплатить инвестору', 'Repay investor'), helper: 'approval', icon: <ShieldCheck size={18} /> },
    { id: 'deposit', label: tx(lang, 'Depozit əməliyyatı', 'Операция депозита', 'Deposit operation'), helper: 'liability', icon: <WalletCards size={18} /> },
    { id: 'reconcile', label: tx(lang, 'Reconcile başlat', 'Начать сверку', 'Start reconcile'), helper: 'till count', icon: <GitCompareArrows size={18} /> },
    { id: 'adjustment', label: tx(lang, 'Adjustment', 'Корректировка', 'Adjustment'), helper: 'audit', icon: <BookOpen size={18} /> },
  ];
  return (
    <section className="rounded-[28px] border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 text-xs font-black uppercase tracking-[0.24em] text-slate-500">FinanceQuickActions</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={() => onSelect(action.id)}
            className={`min-h-[110px] rounded-2xl border p-4 text-left ${active === action.id ? 'border-yellow-300 bg-yellow-400 text-slate-950' : 'border-slate-800 bg-slate-950 text-slate-200'}`}
          >
            <div className="flex items-center justify-between gap-3">
              {action.icon}
              <ArrowRight size={16} className="opacity-55" />
            </div>
            <div className="mt-4 text-sm font-black">{action.label}</div>
            <div className="mt-1 text-xs opacity-70">{action.helper}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function FinanceWorkspaceTabs({ lang, active, onChange }: { lang: string; active: FinanceWorkspaceTab; onChange: (tab: FinanceWorkspaceTab) => void }) {
  const tabs: Array<[FinanceWorkspaceTab, string]> = [
    ['overview', 'Overview'],
    ['transactions', 'Transactions'],
    ['transfers', 'Transfers'],
    ['reconciliation', 'Reconciliation'],
    ['investor', 'Investor'],
    ['deposits', 'Deposits'],
    ['ledger', 'Ledger'],
  ];
  return (
    <div className="flex gap-2 overflow-x-auto rounded-[24px] border border-slate-800 bg-slate-950 p-2">
      {tabs.map(([tab, label]) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`min-h-12 rounded-2xl px-5 text-sm font-black ${active === tab ? 'bg-white text-slate-950' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}
        >
          {tx(lang, label, label, label)}
        </button>
      ))}
    </div>
  );
}

function FinanceControlCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[28px] border border-slate-800 bg-slate-900 p-5">
      <div className="mb-5">
        <h3 className="text-xl font-black text-white">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function FinanceMiniMetric({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' | 'amber' | 'sky' | 'violet' }) {
  const tones = {
    emerald: 'border-emerald-400/25 bg-emerald-950/30 text-emerald-100',
    rose: 'border-rose-400/25 bg-rose-950/30 text-rose-100',
    amber: 'border-amber-400/25 bg-amber-950/30 text-amber-100',
    sky: 'border-sky-400/25 bg-sky-950/30 text-sky-100',
    violet: 'border-violet-400/25 bg-violet-950/30 text-violet-100',
  } as const;
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="text-xs font-black uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function FinanceField({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  return (
    <label className="field-stack form-card">
      <span className="field-label">{label}</span>
      {children}
      {helper ? <span className="field-hint">{helper}</span> : null}
    </label>
  );
}

function TransactionDetailDrawer({
  lang,
  detail,
  loading,
  accountName,
  onApprove,
  onReject,
  onReverse,
  onClose,
}: {
  lang: string;
  detail: FinanceTransactionDetail | null;
  loading: boolean;
  accountName: (code?: string | null) => string;
  onApprove: (transactionId: string) => void | Promise<void>;
  onReject: (transactionId: string) => void | Promise<void>;
  onReverse: (transactionId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  if (!detail) return null;
  const txRow = detail.transaction;
  const auditDetails = detail.audit_logs.map((row) => {
    try {
      return { ...row, parsed: JSON.parse(row.details || '{}') };
    } catch {
      return { ...row, parsed: null };
    }
  });
  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <button className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close transaction drawer" />
      <aside className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-5 shadow-[0_0_80px_rgba(0,0,0,0.55)]">
        <div className="sticky top-0 z-10 -mx-5 -mt-5 border-b border-slate-800 bg-slate-950/95 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.22em] text-yellow-300">Transaction Detail</div>
              <h3 className="mt-2 text-2xl font-black text-white">{txRow.transaction_type?.replace(/_/g, ' ') || 'Transaction'}</h3>
              <p className="mt-1 text-sm text-slate-400">{txRow.id}</p>
            </div>
            <button onClick={onClose} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-200">
              {tx(lang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
          {loading ? <div className="mt-3 text-xs font-bold text-sky-200">{tx(lang, 'Detallar yüklənir...', 'Детали загружаются...', 'Loading details...')}</div> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {txRow.status === 'pending_approval' ? (
              <>
                <button onClick={() => void onApprove(txRow.id)} className="min-h-11 rounded-2xl bg-emerald-300 px-4 text-sm font-black text-slate-950">
                  {tx(lang, 'Təsdiqlə və post et', 'Подтвердить и post', 'Approve and post')}
                </button>
                <button onClick={() => void onReject(txRow.id)} className="min-h-11 rounded-2xl border border-rose-400/40 px-4 text-sm font-black text-rose-100">
                  {tx(lang, 'Rədd et', 'Отклонить', 'Reject')}
                </button>
              </>
            ) : null}
            {txRow.status === 'posted' && txRow.transaction_type !== 'reversal' && detail.reversal_history.length === 0 ? (
              <button onClick={() => void onReverse(txRow.id)} className="min-h-11 rounded-2xl border border-amber-400/40 px-4 text-sm font-black text-amber-100">
                {tx(lang, 'Reversal istə', 'Запросить reversal', 'Request reversal')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <FinanceMiniMetric label={tx(lang, 'Status', 'Статус', 'Status')} value={txRow.status || 'posted'} tone={txRow.status === 'reversed' ? 'rose' : 'emerald'} />
          <FinanceMiniMetric label={tx(lang, 'Amount', 'Сумма', 'Amount')} value={`${new Decimal(txRow.amount || 0).toFixed(2)} ₼`} tone="sky" />
          <FinanceMiniMetric label={tx(lang, 'From', 'Откуда', 'From')} value={accountName(txRow.source_account)} tone="amber" />
          <FinanceMiniMetric label={tx(lang, 'To', 'Куда', 'To')} value={accountName(txRow.destination_account)} tone="violet" />
        </div>

        <section className="mt-5 rounded-[24px] border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500">{tx(lang, 'Lifecycle', 'Жизненный цикл', 'Lifecycle')}</div>
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div><span className="text-slate-500">Created:</span> <span className="font-bold text-slate-200">{formatServerUtcDateTime(txRow.created_at || '', lang)}</span></div>
            <div><span className="text-slate-500">Posted:</span> <span className="font-bold text-slate-200">{formatServerUtcDateTime(txRow.posted_at || txRow.created_at || '', lang)}</span></div>
            <div><span className="text-slate-500">Created by:</span> <span className="font-bold text-slate-200">{txRow.created_by || '-'}</span></div>
            <div><span className="text-slate-500">Posted by:</span> <span className="font-bold text-slate-200">{txRow.posted_by || '-'}</span></div>
            <div><span className="text-slate-500">Approved by:</span> <span className="font-bold text-slate-200">{txRow.approved_by || '-'}</span></div>
            <div><span className="text-slate-500">Reversed:</span> <span className="font-bold text-slate-200">{txRow.reversed_at ? formatServerUtcDateTime(txRow.reversed_at, lang) : '-'}</span></div>
          </div>
          {txRow.note || txRow.reference ? (
            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
              {txRow.note || txRow.reference}
            </div>
          ) : null}
        </section>

        <section className="mt-5 rounded-[24px] border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-yellow-300">{tx(lang, 'Debit / Credit entries', 'Debit / Credit записи', 'Debit / Credit entries')}</div>
          <div className="space-y-3">
            {detail.entries.map((entry) => (
              <div key={entry.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <div>
                  <div className="font-black text-white">{entry.account_name || entry.account_code}</div>
                  <div className="mt-1 text-xs text-slate-500">{entry.description || txRow.category || txRow.transaction_type}</div>
                </div>
                <div className={`rounded-full px-3 py-2 text-xs font-black ${entry.entry_side === 'debit' ? 'bg-sky-400/10 text-sky-200' : 'bg-amber-400/10 text-amber-200'}`}>
                  {entry.entry_side.toUpperCase()} · {new Decimal(entry.amount || 0).toFixed(2)} ₼
                </div>
              </div>
            ))}
            {detail.entries.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-500">
                {tx(lang, 'Debit/credit entry tapılmadı.', 'Debit/credit записи не найдены.', 'No debit/credit entries found.')}
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-5 rounded-[24px] border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-yellow-300">{tx(lang, 'Reversal history', 'История reversal', 'Reversal history')}</div>
          <div className="space-y-3">
            {detail.reversal_history.map((row) => (
              <div key={row.id} className="rounded-2xl border border-amber-400/25 bg-amber-950/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-black text-white">{row.transaction_type.replace(/_/g, ' ')}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {accountName(row.source_account)} → {accountName(row.destination_account)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`rounded-full px-3 py-1 text-xs font-black ${row.status === 'posted' ? 'bg-emerald-400/10 text-emerald-200' : row.status === 'pending_approval' ? 'bg-amber-400/10 text-amber-200' : 'bg-slate-400/10 text-slate-200'}`}>
                      {row.status}
                    </div>
                    <div className="mt-2 text-sm font-black text-white">{new Decimal(row.amount || 0).toFixed(2)} ₼</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {formatServerUtcDateTime(row.posted_at || row.created_at || '', lang)} · {row.created_by || '-'}
                </div>
              </div>
            ))}
            {detail.reversal_history.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-500">
                {tx(lang, 'Reversal history yoxdur.', 'Истории reversal нет.', 'No reversal history.')}
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-5 rounded-[24px] border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-yellow-300">{tx(lang, 'Audit trail', 'Audit trail', 'Audit trail')}</div>
          <div className="space-y-3">
            {auditDetails.map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-black text-white">{row.action}</div>
                  <div className="text-xs text-slate-500">{formatServerUtcDateTime(row.created_at || '', lang)}</div>
                </div>
                <div className="mt-1 text-xs text-slate-400">{row.user}</div>
                <pre className="mt-3 max-h-40 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] text-slate-400">
                  {JSON.stringify(row.parsed || row.details || {}, null, 2)}
                </pre>
              </div>
            ))}
            {auditDetails.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-500">
                {tx(lang, 'Audit log tapılmadı.', 'Audit log не найден.', 'No audit logs found.')}
              </div>
            ) : null}
          </div>
        </section>
      </aside>
    </div>
  );
}

function WalletCard({
  title,
  value,
  helper,
  accent = 'amber',
}: {
  title: string;
  value: string | number;
  helper?: string;
  accent?: 'amber' | 'rose' | 'sky';
}) {
  const accentMap = {
    amber: 'from-amber-300/18 to-transparent text-amber-200',
    rose: 'from-rose-300/18 to-transparent text-rose-200',
    sky: 'from-sky-300/18 to-transparent text-sky-200',
  } as const;
  return (
    <div className={`metal-panel bg-gradient-to-br ${accentMap[accent]} p-5`}>
      <div className="text-sm text-slate-300">{title}</div>
      <div className="mt-2 text-3xl font-bold text-slate-100">{new Decimal(value || 0).toFixed(2)} ₼</div>
      {helper ? <div className="mt-2 text-xs text-slate-400">{helper}</div> : null}
    </div>
  );
}

function HighlightStat({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string;
  helper?: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/25 px-4 py-4 backdrop-blur">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-black ${tone}`}>{value}</div>
      {helper ? <div className="mt-1 text-xs text-slate-400">{helper}</div> : null}
    </div>
  );
}

function MiniSummaryCard({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string;
  helper?: string;
  tone: 'emerald' | 'rose' | 'amber' | 'sky' | 'violet';
}) {
  const toneMap = {
    emerald: 'text-emerald-300 border-emerald-300/20 bg-emerald-400/5',
    rose: 'text-rose-300 border-rose-300/20 bg-rose-400/5',
    amber: 'text-amber-300 border-amber-300/20 bg-amber-400/5',
    sky: 'text-sky-300 border-sky-300/20 bg-sky-400/5',
    violet: 'text-violet-300 border-violet-300/20 bg-violet-400/5',
  } as const;

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneMap[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-xl font-bold text-slate-100">{value}</div>
      {helper ? <div className="mt-1 text-xs text-slate-400">{helper}</div> : null}
    </div>
  );
}
