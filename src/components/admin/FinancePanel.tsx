import React, { useEffect, useMemo, useState } from 'react';
import { Decimal } from 'decimal.js';
import { useAppStore } from '../../store';
import {
  create_finance_entry,
  get_balance,
  get_finance_entries,
  get_investor_summary,
  repay_investor,
  transfer_funds,
} from '../../api/finance';
import { tx } from '../../i18n';

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

  const computedTransferCommission = useMemo(() => {
    const amount = new Decimal(transferAmount || '0');
    if (transferDirection !== 'card_to_cash') {
      return new Decimal(transferCommission || '0');
    }
    if (amount.lte(0)) return new Decimal(0);
    return amount.lte(120) ? new Decimal(0.6) : amount.times(0.005).toDecimalPlaces(2);
  }, [transferAmount, transferCommission, transferDirection]);

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

  const balance = get_balance(tenant_id, 'all', false);
  const investorSummary = get_investor_summary(tenant_id);
  const entries = get_finance_entries(tenant_id);

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

  const exportCsv = () => {
    if (!filteredEntries.length) {
      notify('error', tx(lang, 'Export üçün məlumat yoxdur', 'Нет данных для экспорта', 'No data to export'));
      return;
    }
    const header = ['created_at', 'type', 'category', 'source', 'amount', 'description'];
    const rows = filteredEntries.map((e: any) => [
      e.created_at,
      e.type,
      `"${String(e.category || '').replace(/"/g, '""')}"`,
      e.source,
      e.amount,
      `"${String(e.description || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addEntry = () => {
    if (!amount || new Decimal(amount).lte(0)) {
      notify('error', tx(lang, 'Məbləğ düzgün deyil', 'Неверная сумма'));
      return;
    }
    if (type === 'out' && !subject.trim()) {
      notify('error', tx(lang, 'Subyekt məcburidir', 'Поле субъекта обязательно', 'Subject is required'));
      return;
    }
    try {
      create_finance_entry(
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

  const doTransfer = () => {
    if (!transferAmount || new Decimal(transferAmount).lte(0)) {
      notify('error', tx(lang, 'Transfer məbləği düzgün deyil', 'Некорректная сумма перевода'));
      return;
    }
    try {
      transfer_funds(
        tenant_id,
        transferDirection,
        transferAmount,
        computedTransferCommission.toString(),
        user?.username || 'admin',
      );
      setTransferAmount('');
      setTransferCommission('0');
      notify('success', tx(lang, 'Transfer tamamlandı', 'Перевод выполнен'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Transfer alınmadı', 'Перевод не выполнен'));
    }
  };

  const doRepayInvestor = () => {
    if (!repayAmount || new Decimal(repayAmount).lte(0)) {
      notify('error', tx(lang, 'Məbləğ düzgün deyil', 'Некорректная сумма', 'Invalid amount'));
      return;
    }
    try {
      const result = repay_investor(
        tenant_id,
        repayAmount,
        repayFrom,
        user?.username || 'admin',
        repayNote,
      );
      setRepayAmount('');
      setRepayNote('');
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
      <h2 className="text-2xl font-bold">{tx(lang, 'Maliyyə', 'Финансы')}</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <WalletCard title={tx(lang, 'Nağd Kassa', 'Наличная касса')} value={balance.cash_balance} />
        <WalletCard title={tx(lang, 'Bank/Kart Hesabı', 'Банк/карта')} value={balance.card_balance} />
        <WalletCard
          title={tx(lang, 'İnvestora Borcumuz', 'Наш долг инвестору', 'Debt To Investor')}
          value={investorSummary.debt_remaining || '0'}
        />
        <WalletCard title={tx(lang, 'Seyf', 'Сейф')} value={balance.safe_balance || '0'} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="metal-panel p-5">
          <h3 className="mb-4 text-lg font-semibold">{tx(lang, 'Smart Xərc / Mədaxil', 'Умный расход / приход', 'Smart Expense / Income')}</h3>

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

          <button onClick={addEntry} className="glossy-gold mt-4 min-h-12 rounded-lg px-4 py-2 font-semibold">
            {tx(lang, 'Əməliyyatı Yaz', 'Сохранить операцию', 'Save Entry')}
          </button>
        </div>

        <div className="metal-panel p-4">
          <h3 className="mb-3 text-lg font-semibold">{tx(lang, 'Daxili Transfer', 'Внутренний перевод')}</h3>
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
          {transferDirection === 'card_to_cash' && (
            <p className="mt-2 text-xs text-slate-300">
              {tx(
                lang,
                'Qayda: 120 AZN-ə qədər 0.60 AZN, 120 AZN-dən yuxarı 0.5% komissiya.',
                'Правило: до 120 AZN комиссия 0.60 AZN, выше 120 AZN комиссия 0.5%.',
              )}
            </p>
          )}
          <button onClick={doTransfer} className="neon-btn mt-3 rounded-lg px-4 py-2">
            {tx(lang, 'Transfer Et', 'Выполнить перевод')}
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
            <button onClick={doRepayInvestor} className="glossy-gold mt-3 rounded-lg px-4 py-2 font-semibold">
              {tx(lang, 'İnvestora Ödə', 'Оплатить инвестору', 'Pay Investor')}
            </button>
          </div>
        </div>
      </div>

      <div className="metal-panel p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="neon-input w-auto" />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="neon-input w-auto" />
          <button className="neon-btn rounded-lg px-3 py-2 text-xs" onClick={exportCsv}>
            {tx(lang, 'CSV Export', 'Экспорт CSV', 'CSV Export')}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-700/60 text-slate-300">
              <tr>
                <th className="py-2">{tx(lang, 'Tarix', 'Дата')}</th>
                <th className="py-2">{tx(lang, 'Növ', 'Тип')}</th>
                <th className="py-2">{tx(lang, 'Kateqoriya', 'Категория')}</th>
                <th className="py-2">{tx(lang, 'Mənbə', 'Источник')}</th>
                <th className="py-2">{tx(lang, 'Məbləğ', 'Сумма')}</th>
                <th className="py-2">{tx(lang, 'Açıqlama', 'Описание')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((e: any) => (
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
                    {tx(lang, 'Bu tarix aralığında qeyd yoxdur', 'За этот период записей нет')}
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

function WalletCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="metal-panel p-5">
      <div className="text-sm text-slate-300">{title}</div>
      <div className="mt-1 text-3xl font-bold text-slate-100">{new Decimal(value || 0).toFixed(2)} ₼</div>
    </div>
  );
}
