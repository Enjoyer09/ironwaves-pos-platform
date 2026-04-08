import React from 'react';
import { Decimal } from 'decimal.js';
import {
  type FinanceLedgerAccount,
  type FinanceLedgerEntry,
  type FinanceLedgerTransaction,
  type FinanceReconciliation,
} from '../../../api/finance';
import { tx } from '../../../i18n';
import { formatServerUtcDateTime } from '../../../lib/time';
import {
  FinanceControlCard,
  FinanceMiniMetric,
  FinanceStatusBadge,
  type FinanceWorkspaceTab,
} from './FinanceWorkspaceParts';

export function FinanceApprovalPreview({
  lang,
  pendingApprovals,
  accountName,
  transactionTypeLabel,
  onOpenLedgerDetail,
  onOpenAll,
}: {
  lang: string;
  pendingApprovals: FinanceLedgerTransaction[];
  accountName: (code?: string | null) => string;
  transactionTypeLabel: (value?: string | null) => string;
  onOpenLedgerDetail: (row: FinanceLedgerTransaction) => void | Promise<void>;
  onOpenAll: () => void;
}) {
  return (
    <FinanceControlCard
      title={tx(lang, 'Təsdiq qutusu', 'Тəsdiq qutusu', 'Təsdiq qutusu')}
      subtitle={tx(lang, 'Riskli əməliyyatların qısa növbəsi', 'Riskli əməliyyatların qısa növbəsi', 'Riskli əməliyyatların qısa növbəsi')}
    >
      <div className="space-y-3">
        {pendingApprovals.slice(0, 3).map((row) => (
          <button
            key={row.id}
            onClick={() => void onOpenLedgerDetail(row)}
            className="w-full rounded-2xl border border-amber-400/20 bg-amber-950/20 p-4 text-left transition hover:border-amber-300/40"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-200">{transactionTypeLabel(row.transaction_type)}</div>
                <div className="mt-1 text-lg font-black text-white">{new Decimal(row.amount || 0).toFixed(2)} ₼</div>
                <div className="mt-1 truncate text-sm text-slate-400">
                  {accountName(row.source_account)} → {accountName(row.destination_account)}
                </div>
              </div>
              <FinanceStatusBadge status={row.status || 'pending_approval'} lang={lang} />
            </div>
          </button>
        ))}
        {pendingApprovals.length === 0 ? (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-950/20 p-4 text-sm font-bold text-emerald-100">
            {tx(lang, 'Hazırda təsdiq gözləyən əməliyyat yoxdur.', 'Hazırda təsdiq gözləyən əməliyyat yoxdur.', 'Hazırda təsdiq gözləyən əməliyyat yoxdur.')}
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={onOpenAll}
          className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-100"
        >
          {tx(lang, 'Hamısını aç', 'Hamısını aç', 'Hamısını aç')}
        </button>
      </div>
    </FinanceControlCard>
  );
}

export function FinanceOverviewInsightsCard({
  lang,
  incoming,
  outgoing,
  biggestExpenseAmount,
  pendingApprovalsCount,
  onExpense,
  onTransfer,
  onOpenLedger,
}: {
  lang: string;
  incoming: string;
  outgoing: string;
  biggestExpenseAmount: string;
  pendingApprovalsCount: number;
  onExpense: () => void;
  onTransfer: () => void;
  onOpenLedger: () => void;
}) {
  return (
    <FinanceControlCard title={tx(lang, 'Bugünkü vəziyyət', 'Bugünkü vəziyyət', 'Bugünkü vəziyyət')} subtitle={tx(lang, 'Bu gün nə baş verib və nəzarət üçün əsas siqnallar', 'Bu gün nə baş verib və nəzarət üçün əsas siqnallar', 'Bu gün nə baş verib və nəzarət üçün əsas siqnallar')}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FinanceMiniMetric label={tx(lang, 'Bugünkü mədaxil', 'Bugünkü mədaxil', 'Bugünkü mədaxil')} value={incoming} tone="emerald" />
        <FinanceMiniMetric label={tx(lang, 'Bugünkü xərc', 'Bugünkü xərc', 'Bugünkü xərc')} value={outgoing} tone="rose" />
        <FinanceMiniMetric label={tx(lang, 'Ən böyük xərc', 'Ən böyük xərc', 'Ən böyük xərc')} value={biggestExpenseAmount} tone="amber" />
        <FinanceMiniMetric label={tx(lang, 'Açıq təsdiqlər', 'Açıq təsdiqlər', 'Açıq təsdiqlər')} value={String(pendingApprovalsCount)} tone="violet" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onExpense} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-100">
          {tx(lang, 'Xərc yaz', 'Xərc yaz', 'Xərc yaz')}
        </button>
        <button onClick={onTransfer} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-100">
          {tx(lang, 'Transfer et', 'Transfer et', 'Transfer et')}
        </button>
        <button onClick={onOpenLedger} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-100">
          {tx(lang, 'Jurnala bax', 'Jurnala bax', 'Jurnala bax')}
        </button>
      </div>
    </FinanceControlCard>
  );
}

export function FinanceControlSummaryPanel({
  lang,
  investorDebt,
  activeDeposits,
  liquidity,
  reconciliationGap,
  hasVariance,
  onOpenReconciliation,
  onOpenInvestor,
}: {
  lang: string;
  investorDebt: string;
  activeDeposits: string;
  liquidity: string;
  reconciliationGap: string;
  hasVariance: boolean;
  onOpenReconciliation: () => void;
  onOpenInvestor: () => void;
}) {
  return (
    <FinanceControlCard title={tx(lang, 'Nəzarət xülasəsi', 'Сводка контроля', 'Control summary')} subtitle={tx(lang, 'Öhdəliklər, likvidlik və uyğunlaşdırma vəziyyəti', 'Обязательства и риски', 'Liabilities and risks')}>
      <div className="space-y-3">
        <FinanceMiniMetric label={tx(lang, 'Investor borcu', 'Долг инвестору', 'Investor liability')} value={investorDebt} tone="amber" />
        <FinanceMiniMetric label={tx(lang, 'Aktiv depozitlər', 'Активные депозиты', 'Active deposits')} value={activeDeposits} tone="sky" />
        <FinanceMiniMetric label={tx(lang, 'Likvidlik', 'Ликвидность', 'Liquidity')} value={liquidity} tone="violet" />
        <FinanceMiniMetric label={tx(lang, 'Uyğunlaşdırma fərqi', 'Разница сверки', 'Reconciliation gap')} value={reconciliationGap} tone={hasVariance ? 'rose' : 'emerald'} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onOpenReconciliation} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-100">
          {tx(lang, 'Uyğunlaşdırmaya keç', 'Uyğunlaşdırmaya keç', 'Uyğunlaşdırmaya keç')}
        </button>
        <button onClick={onOpenInvestor} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-100">
          {tx(lang, 'Investor bölməsini aç', 'Investor bölməsini aç', 'Investor bölməsini aç')}
        </button>
      </div>
    </FinanceControlCard>
  );
}

export function FinanceActionWorkspace({
  lang,
  title,
  subtitle,
  onClose,
  children,
}: {
  lang: string;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <FinanceControlCard title={title} subtitle={subtitle}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            {tx(lang, 'Aktiv iş sahəsi', 'Aktiv iş sahəsi', 'Aktiv iş sahəsi')}
          </div>
          <div className="mt-1 text-base font-black text-white">{title}</div>
        </div>
        <button onClick={onClose} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-100">
          {tx(lang, 'Baxışa qayıt', 'Baxışa qayıt', 'Baxışa qayıt')}
        </button>
      </div>
      {children}
    </FinanceControlCard>
  );
}

export function FinanceLedgerTab({
  lang,
  ledgerPageSize,
  onPageSizeChange,
  onExport,
  ledgerPageStart,
  ledgerPageEnd,
  ledgerTotalCount,
  ledgerPageLoading,
  onClearFilters,
  ledgerSearch,
  onLedgerSearchChange,
  ledgerTypeFilter,
  onLedgerTypeFilterChange,
  ledgerStatusFilter,
  onLedgerStatusFilterChange,
  ledgerAccountFilter,
  onLedgerAccountFilterChange,
  ledgerCounterpartyFilter,
  onLedgerCounterpartyFilterChange,
  ledgerMinAmount,
  onLedgerMinAmountChange,
  ledgerMaxAmount,
  onLedgerMaxAmountChange,
  ledgerTransactionTypes,
  ledgerTransactionStatuses,
  ledgerAccounts,
  fromDate,
  toDate,
  visibleLedgerTransactions,
  onOpenLedgerDetail,
  transactionTypeLabel,
  accountName,
  ledgerCurrentPage,
  ledgerTotalPages,
  canGoPreviousLedgerPage,
  canGoNextLedgerPage,
  onPreviousPage,
  onNextPage,
  ledgerEntries,
}: {
  lang: string;
  ledgerPageSize: number;
  onPageSizeChange: (value: number) => void;
  onExport: () => void;
  ledgerPageStart: number;
  ledgerPageEnd: number;
  ledgerTotalCount: number;
  ledgerPageLoading: boolean;
  onClearFilters: () => void;
  ledgerSearch: string;
  onLedgerSearchChange: (value: string) => void;
  ledgerTypeFilter: string;
  onLedgerTypeFilterChange: (value: string) => void;
  ledgerStatusFilter: string;
  onLedgerStatusFilterChange: (value: string) => void;
  ledgerAccountFilter: string;
  onLedgerAccountFilterChange: (value: string) => void;
  ledgerCounterpartyFilter: string;
  onLedgerCounterpartyFilterChange: (value: string) => void;
  ledgerMinAmount: string;
  onLedgerMinAmountChange: (value: string) => void;
  ledgerMaxAmount: string;
  onLedgerMaxAmountChange: (value: string) => void;
  ledgerTransactionTypes: string[];
  ledgerTransactionStatuses: string[];
  ledgerAccounts: FinanceLedgerAccount[];
  fromDate: string;
  toDate: string;
  visibleLedgerTransactions: FinanceLedgerTransaction[];
  onOpenLedgerDetail: (entry: FinanceLedgerTransaction) => void | Promise<void>;
  transactionTypeLabel: (value?: string | null) => string;
  accountName: (code?: string | null) => string;
  ledgerCurrentPage: number;
  ledgerTotalPages: number;
  canGoPreviousLedgerPage: boolean;
  canGoNextLedgerPage: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
  ledgerEntries: FinanceLedgerEntry[];
}) {
  return (
    <div className="rounded-[28px] border border-slate-800 bg-slate-950 p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">{tx(lang, 'İki tərəfli maliyyə jurnalı', 'Двойной ledger', 'Double-entry journal')}</div>
          <h3 className="mt-2 text-xl font-black text-white">{tx(lang, 'Maliyyə jurnalı', 'Ledger операции', 'Ledger Transactions')}</h3>
          <p className="mt-1 text-sm text-slate-400">
            {tx(lang, 'Hər yazılmış əməliyyat debit/credit entry-lərlə və audit izi ilə izlənir.', 'Каждая posted transaction отслеживается debit/credit записями.', 'Every posted transaction is tracked with debit/credit entries.')}
          </p>
        </div>
        <div className="flex gap-2">
          <select value={ledgerPageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} className="neon-input min-h-12 w-28">
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <button className="neon-btn rounded-2xl px-4 text-sm font-black" onClick={onExport}>{tx(lang, 'Çıxar', 'Экспорт', 'Export')}</button>
        </div>
      </div>
      <div className="mb-5 rounded-[24px] border border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-300">{tx(lang, 'Jurnal filterləri', 'Фильтры ledger', 'Ledger filters')}</div>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {ledgerPageStart}-{ledgerPageEnd} / {ledgerTotalCount || visibleLedgerTransactions.length} {tx(lang, 'əməliyyat göstərilir', 'transaction показано', 'transactions shown')}
              {ledgerPageLoading ? ` · ${tx(lang, 'Yüklənir...', 'Загрузка...', 'Loading...')}` : ''}
            </p>
          </div>
          <button onClick={onClearFilters} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-200 hover:border-sky-300/60">
            {tx(lang, 'Filterləri sıfırla', 'Сбросить фильтры', 'Clear filters')}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Axtarış', 'Поиск', 'Search')}</span>
            <input className="neon-input min-h-12" value={ledgerSearch} onChange={(e) => onLedgerSearchChange(e.target.value)} placeholder={tx(lang, 'ID, qeyd, reference, user...', 'ID, комментарий, reference, user...', 'ID, note, reference, user...')} />
          </label>
          <label className="space-y-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Əməliyyat növü', 'Тип', 'Type')}</span>
            <select className="neon-input min-h-12" value={ledgerTypeFilter} onChange={(e) => onLedgerTypeFilterChange(e.target.value)}>
              <option value="all">{tx(lang, 'Bütün növlər', 'Все типы', 'All types')}</option>
              {ledgerTransactionTypes.map((typeValue) => (
                <option key={typeValue} value={typeValue}>{transactionTypeLabel(typeValue)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Status', 'Статус', 'Status')}</span>
            <select className="neon-input min-h-12" value={ledgerStatusFilter} onChange={(e) => onLedgerStatusFilterChange(e.target.value)}>
              <option value="all">{tx(lang, 'Bütün statuslar', 'Все статусы', 'All statuses')}</option>
              {ledgerTransactionStatuses.map((statusValue) => (
                <option key={statusValue} value={statusValue}>{tx(lang, statusValue === 'pending_approval' ? 'Təsdiq gözləyir' : statusValue === 'approved' ? 'Təsdiqlənib' : statusValue === 'posted' ? 'Yazılıb' : statusValue === 'rejected' ? 'Rədd edilib' : statusValue === 'reversed' ? 'Əks yazılış edilib' : statusValue === 'draft' ? 'Qaralama' : statusValue, statusValue, statusValue)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Hesab', 'Счет', 'Account')}</span>
            <select className="neon-input min-h-12" value={ledgerAccountFilter} onChange={(e) => onLedgerAccountFilterChange(e.target.value)}>
              <option value="all">{tx(lang, 'Bütün hesablar', 'Все счета', 'All accounts')}</option>
              {ledgerAccounts.map((account) => (
                <option key={account.code} value={account.code}>{account.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Subyekt', 'Контрагент', 'Counterparty')}</span>
            <input className="neon-input min-h-12" value={ledgerCounterpartyFilter} onChange={(e) => onLedgerCounterpartyFilterChange(e.target.value)} placeholder={tx(lang, 'Təchizatçı, investor...', 'Поставщик, инвестор...', 'Supplier, investor...')} />
          </label>
          <label className="space-y-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Min məbləğ', 'Мин сумма', 'Min amount')}</span>
            <input className="neon-input min-h-12" type="number" min={0} step="0.01" value={ledgerMinAmount} onChange={(e) => onLedgerMinAmountChange(e.target.value)} />
          </label>
          <label className="space-y-2">
            <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Max məbləğ', 'Макс сумма', 'Max amount')}</span>
            <input className="neon-input min-h-12" type="number" min={0} step="0.01" value={ledgerMaxAmount} onChange={(e) => onLedgerMaxAmountChange(e.target.value)} />
          </label>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Tarix aralığı', 'Диапазон дат', 'Date range')}</div>
            <div className="mt-2 text-sm font-black text-white">{fromDate} → {toDate}</div>
            <div className="mt-1 text-xs font-bold text-slate-500">
              {tx(lang, 'Yuxarıdakı period filteri maliyyə jurnalına da tətbiq olunur.', 'Верхний фильтр периода также применяется к ledger.', 'The top period filter also applies to ledger.')}
            </div>
          </div>
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
              <th className="py-3">{tx(lang, 'Növ', 'Тип', 'Type')}</th>
              <th className="py-3">{tx(lang, 'Haradan → Hara', 'Откуда → куда', 'From → To')}</th>
              <th className="py-3">{tx(lang, 'Kateqoriya', 'Категория', 'Category')}</th>
              <th className="py-3 text-right">{tx(lang, 'Məbləğ', 'Сумма', 'Amount')}</th>
              <th className="py-3">{tx(lang, 'Qeyd', 'Комментарий', 'Note')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleLedgerTransactions.map((entry) => (
              <tr key={entry.id} onClick={() => void onOpenLedgerDetail(entry)} className="cursor-pointer border-b border-slate-900 transition hover:bg-slate-900/70">
                <td className="py-3 text-slate-300">{formatServerUtcDateTime(entry.posted_at || entry.created_at || '', lang)}</td>
                <td className="py-3"><FinanceStatusBadge status={entry.status || 'posted'} lang={lang} /></td>
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
              <tr><td colSpan={7} className="py-10 text-center text-slate-500">{tx(lang, 'Bu filterlə maliyyə jurnalı qeydi tapılmadı', 'По этим фильтрам ledger записей нет', 'No ledger rows match these filters')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 md:flex-row md:items-center md:justify-between">
        <div className="text-sm font-bold text-slate-300">
          {tx(lang, 'Səhifə', 'Страница', 'Page')} {ledgerCurrentPage} / {ledgerTotalPages}
          <span className="ml-2 text-slate-500">
            {tx(lang, 'Göstərilir', 'Показано', 'Showing')} {ledgerPageStart}-{ledgerPageEnd}
          </span>
        </div>
        <div className="flex gap-2">
          <button disabled={!canGoPreviousLedgerPage || ledgerPageLoading} onClick={onPreviousPage} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-200 disabled:cursor-not-allowed disabled:opacity-40">
            {tx(lang, 'Əvvəlki', 'Предыдущая', 'Previous')}
          </button>
          <button disabled={!canGoNextLedgerPage || ledgerPageLoading} onClick={onNextPage} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-200 disabled:cursor-not-allowed disabled:opacity-40">
            {tx(lang, 'Növbəti', 'Следующая', 'Next')}
          </button>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
        {ledgerEntries.length} {tx(lang, 'debit/credit entry yüklənib. Əməliyyat sətrinə klikləyəndə audit, approval və reversal tarixçəsi açılır.', 'debit/credit записей загружено. Клик по transaction открывает drawer с entries, audit и reversal history.', 'debit/credit entries loaded. Clicking a transaction opens entries, audit, and reversal history in the detail drawer.')}
      </div>
    </div>
  );
}

export function FinanceReconciliationWorkspace({
  lang,
  expectedReconcileBalance,
  reconcileCounted,
  reconcileVariance,
  reconcileAccount,
  setReconcileAccount,
  setReconcileCounted,
  reconcileNotes,
  setReconcileNotes,
  ledgerAccounts,
  onSubmit,
  reconciliations,
}: {
  lang: string;
  expectedReconcileBalance: Decimal;
  reconcileCounted: string;
  reconcileVariance: Decimal;
  reconcileAccount: string;
  setReconcileAccount: (value: string) => void;
  setReconcileCounted: (value: string) => void;
  reconcileNotes: string;
  setReconcileNotes: (value: string) => void;
  ledgerAccounts: FinanceLedgerAccount[];
  onSubmit: () => void;
  reconciliations: FinanceReconciliation[];
}) {
  return (
    <div className="rounded-[24px] border border-slate-800 bg-slate-950 p-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[24px] border border-slate-800 bg-slate-950 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <FinanceMiniMetric label={tx(lang, 'Gözlənilən', 'Gözlənilən', 'Gözlənilən')} value={`${expectedReconcileBalance.toFixed(2)} ₼`} tone="sky" />
            <FinanceMiniMetric label={tx(lang, 'Sayılmış', 'Sayılmış', 'Sayılmış')} value={`${new Decimal(reconcileCounted || 0).toFixed(2)} ₼`} tone="emerald" />
            <FinanceMiniMetric label={tx(lang, 'Fərq', 'Fərq', 'Fərq')} value={`${reconcileVariance.toFixed(2)} ₼`} tone={reconcileVariance.abs().gt(0.01) ? 'rose' : 'emerald'} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3">
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Hesab / Kassa', 'Hesab / Kassa', 'Hesab / Kassa')}</span>
              <select className="neon-input min-h-13" value={reconcileAccount} onChange={(e) => setReconcileAccount(e.target.value)}>
                {(ledgerAccounts.length ? ledgerAccounts : [
                  { code: 'cash', name: 'Nağd Kassa' },
                  { code: 'card', name: 'Bank/Kart' },
                  { code: 'safe', name: 'Seyf' },
                ] as any[]).map((account: any) => (
                  <option key={account.code} value={account.code}>{account.name}</option>
                ))}
              </select>
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Sayılmış məbləğ', 'Sayılmış məbləğ', 'Sayılmış məbləğ')}</span>
              <input className="neon-input min-h-16 text-2xl font-black" type="number" min={0} step="0.01" value={reconcileCounted} onChange={(e) => setReconcileCounted(e.target.value)} />
              <span className="field-hint">{tx(lang, 'Fiziki sayılmış qalığı yazın.', 'Fiziki sayılmış qalığı yazın.', 'Fiziki sayılmış qalığı yazın.')}</span>
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Qeyd', 'Qeyd', 'Qeyd')}</span>
              <input className="neon-input min-h-13" value={reconcileNotes} onChange={(e) => setReconcileNotes(e.target.value)} />
            </label>
            <button onClick={() => onSubmit()} className="glossy-gold min-h-14 rounded-2xl px-6 text-base font-black">
              {tx(lang, 'Uyğunlaşdırmanı tamamla', 'Uyğunlaşdırmanı tamamla', 'Uyğunlaşdırmanı tamamla')}
            </button>
          </div>
        </div>
        <div className="rounded-[24px] border border-slate-800 bg-slate-950 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-yellow-300">{tx(lang, 'Son uyğunlaşdırmalar', 'Son uyğunlaşdırmalar', 'Son uyğunlaşdırmalar')}</div>
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
                  {tx(lang, 'Gözlənilən', 'Gözlənilən', 'Gözlənilən')} {new Decimal(row.expected_balance || 0).toFixed(2)} ₼ · {tx(lang, 'Sayılmış', 'Sayılmış', 'Sayılmış')} {new Decimal(row.counted_balance || 0).toFixed(2)} ₼
                </div>
                {row.notes && <div className="mt-2 text-xs text-slate-500">{row.notes}</div>}
              </div>
            ))}
            {reconciliations.length === 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
                {tx(lang, 'Hələ uyğunlaşdırma qeydi yoxdur.', 'Hələ uyğunlaşdırma qeydi yoxdur.', 'Hələ uyğunlaşdırma qeydi yoxdur.')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FinanceWorkspaceShell({
  workspaceTab,
  titleMap,
  lang,
  onClose,
  children,
}: {
  workspaceTab: Exclude<FinanceWorkspaceTab, 'overview'>;
  titleMap: Record<Exclude<FinanceWorkspaceTab, 'overview'>, { title: string; subtitle: string }>;
  lang: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <FinanceActionWorkspace
      lang={lang}
      title={titleMap[workspaceTab].title}
      subtitle={titleMap[workspaceTab].subtitle}
      onClose={onClose}
    >
      {children}
    </FinanceActionWorkspace>
  );
}
