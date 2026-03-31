import React, { useEffect, useMemo, useState } from 'react';
import { Decimal } from 'decimal.js';
import { useAppStore } from '../../store';
import {
  create_finance_entry_async,
  fetch_finance_balances,
  fetch_finance_entries,
  repay_investor_async,
  transfer_funds_async,
} from '../../api/finance';
import { get_settings_live } from '../../api/settings';
import { send_email } from '../../api/email';
import { tx } from '../../i18n';
import { isBackendEnabled } from '../../api/client';

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

export default function FinancePanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';

  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rangePreset, setRangePreset] = useState<'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'>('daily');

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
        {
          value: 'investor',
          label: tx(lang, 'İnvestor', 'Инвестор', 'Investor'),
          helper: tx(lang, 'İnvestor vəsaiti ilə birbaşa ödəniş.', 'Прямая оплата средствами инвестора.', 'Direct payment by investor funds.'),
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
  });
  const [entries, setEntries] = useState<any[]>([]);
  const [ledgerPageSize, setLedgerPageSize] = useState(10);
  const [bankCommissionConfig, setBankCommissionConfig] = useState<{ card_sale_percent: number; card_transfer_percent: number }>({
    card_sale_percent: 2,
    card_transfer_percent: 0.5,
  });

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

  const reloadFinance = async () => {
    try {
      const [b, e, settings] = await Promise.all([
        fetch_finance_balances(tenant_id),
        fetch_finance_entries(tenant_id),
        get_settings_live(tenant_id),
      ]);
      setBalance(b || {
        cash_balance: '0',
        card_balance: '0',
        debt_balance: '0',
        investor_balance: '0',
        safe_balance: '0',
      });
      setEntries(e || []);
      setBankCommissionConfig({
        card_sale_percent: Number((settings.bank_commission as any)?.card_sale_percent ?? settings.bank_commission?.percent ?? 2),
        card_transfer_percent: Number((settings.bank_commission as any)?.card_transfer_percent ?? 0.5),
      });
    } catch (err: any) {
      notify('error', err?.message || tx(lang, 'Maliyyə məlumatları yüklənmədi', 'Не удалось загрузить финансы'));
    }
  };

  useEffect(() => {
    void reloadFinance();
  }, [tenant_id]);

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

  const financeSummary = useMemo(() => {
    const incoming = filteredEntries
      .filter((e: any) => e.type === 'in')
      .reduce((sum: Decimal, e: any) => sum.plus(new Decimal(e.amount || 0)), new Decimal(0));
    const outgoing = filteredEntries
      .filter((e: any) => e.type === 'out')
      .reduce((sum: Decimal, e: any) => sum.plus(new Decimal(e.amount || 0)), new Decimal(0));
    const net = incoming.minus(outgoing);
    const biggestExpense = filteredEntries
      .filter((e: any) => e.type === 'out')
      .reduce((max: any, row: any) => {
        if (!max) return row;
        return new Decimal(row.amount || 0).gt(new Decimal(max.amount || 0)) ? row : max;
      }, null);
    return {
      incoming,
      outgoing,
      net,
      entriesCount: filteredEntries.length,
      biggestExpense,
    };
  }, [filteredEntries]);

  const financeHealthTone = useMemo(() => {
    if (financeSummary.net.gte(0)) return 'text-emerald-300';
    if (financeSummary.net.gte(new Decimal('-50'))) return 'text-amber-300';
    return 'text-rose-300';
  }, [financeSummary.net]);

  const cashCoverage = useMemo(() => {
    const liquid = new Decimal(balance.cash_balance || 0)
      .plus(new Decimal(balance.card_balance || 0))
      .plus(new Decimal(balance.safe_balance || 0));
    const obligations = new Decimal(investorSummary.debt_remaining || 0)
      .plus(new Decimal(balance.debt_balance || 0));
    if (obligations.lte(0)) return '100';
    return Decimal.min(new Decimal(100), liquid.div(obligations).times(100)).toFixed(0);
  }, [balance.cash_balance, balance.card_balance, balance.safe_balance, balance.debt_balance, investorSummary.debt_remaining]);

  const exportCsv = () => {
    if (!filteredEntries.length) {
      notify('error', tx(lang, 'Export üçün məlumat yoxdur', 'Нет данных для экспорта', 'No data to export'));
      return;
    }

    const esc = (value: unknown) => {
      const s = String(value ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };

    const incomingTotal = filteredEntries
      .filter((e: any) => e.type === 'in')
      .reduce((sum: Decimal, e: any) => sum.plus(new Decimal(e.amount || 0)), new Decimal(0));
    const outgoingTotal = filteredEntries
      .filter((e: any) => e.type === 'out')
      .reduce((sum: Decimal, e: any) => sum.plus(new Decimal(e.amount || 0)), new Decimal(0));
    const netTotal = incomingTotal.minus(outgoingTotal);

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
      [esc('SUMMARY'), esc('in_total'), esc(''), esc(''), esc(incomingTotal.toFixed(2)), esc('')],
      [esc('SUMMARY'), esc('out_total'), esc(''), esc(''), esc(outgoingTotal.toFixed(2)), esc('')],
      [esc('SUMMARY'), esc('net_total'), esc(''), esc(''), esc(netTotal.toFixed(2)), esc('')],
      [esc('SUMMARY'), esc('cash_balance'), esc(''), esc(''), esc(new Decimal(balance.cash_balance || 0).toFixed(2)), esc('')],
      [esc('SUMMARY'), esc('card_balance'), esc(''), esc(''), esc(new Decimal(balance.card_balance || 0).toFixed(2)), esc('')],
      [esc('SUMMARY'), esc('safe_balance'), esc(''), esc(''), esc(new Decimal(balance.safe_balance || 0).toFixed(2)), esc('')],
      [esc('SUMMARY'), esc('debt_balance'), esc(''), esc(''), esc(new Decimal(balance.debt_balance || 0).toFixed(2)), esc('')],
      [esc('SUMMARY'), esc('investor_balance'), esc(''), esc(''), esc(new Decimal(balance.investor_balance || 0).toFixed(2)), esc('')],
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
      <h2>Finance Summary</h2>
      <p><b>Period:</b> ${fromDate} - ${toDate}</p>
      <p><b>Incoming:</b> ${filteredEntries.filter((e: any) => e.type === 'in').reduce((sum: Decimal, e: any) => sum.plus(new Decimal(e.amount || 0)), new Decimal(0)).toFixed(2)} ₼</p>
      <p><b>Outgoing:</b> ${filteredEntries.filter((e: any) => e.type === 'out').reduce((sum: Decimal, e: any) => sum.plus(new Decimal(e.amount || 0)), new Decimal(0)).toFixed(2)} ₼</p>
      <p><b>Net:</b> ${filteredEntries.reduce((sum: Decimal, e: any) => sum.plus(new Decimal(e.type === 'in' ? e.amount || 0 : new Decimal(0).minus(new Decimal(e.amount || 0)))), new Decimal(0)).toFixed(2)} ₼</p>
      <p><b>Cash Balance:</b> ${new Decimal(balance.cash_balance || 0).toFixed(2)} ₼</p>
      <p><b>Card Balance:</b> ${new Decimal(balance.card_balance || 0).toFixed(2)} ₼</p>
      <p><b>Investor Debt:</b> ${new Decimal(investorSummary.debt_remaining || 0).toFixed(2)} ₼</p>
      <p><b>Entries:</b> ${filteredEntries.length}</p>
    `;
    try {
      const sent = await send_email({
        tenant_id,
        subject: `Finance Summary ${fromDate} - ${toDate}`,
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
      const result = await repay_investor_async(
        tenant_id,
        repayAmount,
        repayFrom,
        user?.username || 'admin',
        repayNote,
      );
      setRepayAmount('');
      setRepayNote('');
      await reloadFinance();
      notify(
        'success',
        tx(
          lang,
          `İnvestora ${new Decimal(result.paid).toFixed(2)} ₼ ödəndi. Qalan borc: ${new Decimal(result.remaining_debt).toFixed(2)} ₼`,
          `Инвестору выплачено ${new Decimal(result.paid).toFixed(2)} ₼. Остаток долга: ${new Decimal(result.remaining_debt).toFixed(2)} ₼`,
          `Paid ${new Decimal(result.paid).toFixed(2)} ₼ to investor. Remaining debt: ${new Decimal(result.remaining_debt).toFixed(2)} ₼`,
        ),
      );
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Ödəniş alınmadı', 'Платеж не выполнен', 'Repayment failed'));
    }
  };

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
              helper={tx(lang, 'Seçilmiş aralıq üçün', 'За выбранный период', 'For selected range')}
            />
            <HighlightStat
              label={tx(lang, 'Likvidlik', 'Ликвидность', 'Liquidity')}
              value={`${cashCoverage}%`}
              tone="text-sky-300"
              helper={tx(lang, 'Likvid vəsait / öhdəlik', 'Ликвидные средства / обязательства', 'Liquid cash / obligations')}
            />
            <HighlightStat
              label={tx(lang, 'Qeyd sayı', 'Кол-во записей', 'Entries')}
              value={String(financeSummary.entriesCount)}
              tone="text-violet-300"
              helper={tx(lang, 'Bu period üzrə', 'За этот период', 'In this period')}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <WalletCard title={tx(lang, 'Nağd Kassa', 'Наличная касса', 'Cash Drawer')} value={balance.cash_balance} helper={tx(lang, 'Birbaşa işlək nağd pul', 'Оперативная наличность', 'Operational cash on hand')} />
        <WalletCard title={tx(lang, 'Bank/Kart Hesabı', 'Банк/карта', 'Bank/Card Wallet')} value={balance.card_balance} helper={tx(lang, 'Kart və bank qalıqları', 'Остатки на карте и в банке', 'Card and bank holdings')} />
        <WalletCard
          title={tx(lang, 'İnvestora Borcumuz', 'Наш долг инвестору', 'Debt To Investor')}
          value={investorSummary.debt_remaining || '0'}
          helper={tx(lang, 'Qalan investor öhdəliyi', 'Оставшееся обязательство перед инвестором', 'Remaining investor liability')}
          accent="rose"
        />
        <WalletCard title={tx(lang, 'Seyf', 'Сейф', 'Safe')} value={balance.safe_balance || '0'} helper={tx(lang, 'Rezerv vəsait', 'Резервные средства', 'Reserved funds')} accent="sky" />
      </div>

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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:min-w-[460px]">
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
            <div className="space-y-1">
              <label className="text-xs text-slate-300">{tx(lang, 'Növ', 'Тип', 'Type')}</label>
              <select className="neon-input" value={type} onChange={(e) => setType(e.target.value as 'in' | 'out')}>
                <option value="out">{tx(lang, 'Məxaric (Çıxış)', 'Расход', 'Expense (Out)')}</option>
                <option value="in">{tx(lang, 'Mədaxil (Giriş)', 'Приход', 'Income (In)')}</option>
              </select>
              <p className="text-xs text-slate-400">
                {tx(lang, 'in = pul daxil olur, out = pul çıxır.', 'in = приход, out = расход.', 'in = money in, out = money out.')}
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-300">{tx(lang, 'Mənbə', 'Источник', 'Source')}</label>
              <select className="neon-input" value={source} onChange={(e) => setSource(e.target.value as WalletSource)}>
                {sourceOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">
                {selectedSource?.helper}
              </p>
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="text-xs text-slate-300">{tx(lang, 'Kateqoriya', 'Категория', 'Category')}</label>
              <select className="neon-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categoryOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">{selectedCategory.helper}</p>
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="text-xs text-slate-300">{tx(lang, 'Subyekt', 'Субъект', 'Subject')}</label>
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
              <p className="text-xs text-slate-400">
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

            <div className="space-y-1">
              <label className="text-xs text-slate-300">{tx(lang, 'Məbləğ (AZN)', 'Сумма (AZN)', 'Amount (AZN)')}</label>
              <input
                className="neon-input"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-300">{tx(lang, 'Açıqlama', 'Описание', 'Description')}</label>
              <input
                className="neon-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={tx(lang, 'Qısa qeyd', 'Краткая заметка', 'Short note')}
              />
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
            <select className="neon-input" value={transferDirection} onChange={(e) => setTransferDirection(e.target.value as any)}>
              <option value="card_to_cash">{tx(lang, 'Kartdan Kassaya', 'С карты в кассу')}</option>
              <option value="cash_to_card">{tx(lang, 'Kassadan Karta', 'Из кассы на карту')}</option>
              <option value="cash_to_safe">{tx(lang, 'Kassadan Seyfə', 'Из кассы в сейф', 'Cash to Safe')}</option>
              <option value="safe_to_cash">{tx(lang, 'Seyfdən Kassaya', 'Из сейфа в кассу', 'Safe to Cash')}</option>
              <option value="cash_to_debt">{tx(lang, 'Kassadan Borca', 'Из кассы в долг')}</option>
              <option value="card_to_debt">{tx(lang, 'Kartdan Borca', 'С карты в долг')}</option>
            </select>
            <input className="neon-input" type="number" min={0} step="0.01" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} placeholder={tx(lang, 'Məbləğ', 'Сумма')} />
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={computedTransferCommission.toString()}
              onChange={(e) => setTransferCommission(e.target.value)}
              placeholder={tx(lang, 'Komissiya', 'Комиссия')}
              readOnly={transferDirection === 'card_to_cash'}
            />
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
              <select className="neon-input" value={repayFrom} onChange={(e) => setRepayFrom(e.target.value as any)}>
                <option value="cash">{tx(lang, 'Kassa', 'Касса', 'Cash')}</option>
                <option value="card">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
                <option value="safe">{tx(lang, 'Seyf', 'Сейф', 'Safe')}</option>
              </select>
              <input
                className="neon-input"
                type="number"
                min={0}
                step="0.01"
                value={repayAmount}
                onChange={(e) => setRepayAmount(e.target.value)}
                placeholder={tx(lang, 'Məbləğ', 'Сумма', 'Amount')}
              />
              <input
                className="neon-input"
                value={repayNote}
                onChange={(e) => setRepayNote(e.target.value)}
                placeholder={tx(lang, 'Qeyd', 'Комментарий', 'Note')}
              />
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
              <MiniSummaryCard label={tx(lang, 'Qalan investor borcu', 'Остаток долга инвестору', 'Remaining Investor Debt')} value={`${new Decimal(investorSummary.debt_remaining || 0).toFixed(2)} ₼`} tone="rose" />
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
                  <td className="py-2">{new Date(e.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</td>
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
