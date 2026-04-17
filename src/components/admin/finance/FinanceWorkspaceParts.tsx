import React from 'react';
import { Decimal } from 'decimal.js';
import { AlertTriangle, ArrowRight, Banknote, BookOpen, CheckCircle2, CreditCard, GitCompareArrows, Landmark, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';
import { type FinanceAlert, type FinanceTransactionDetail } from '../../../api/finance';
import { tx } from '../../../i18n';
import { formatServerUtcDateTime } from '../../../lib/time';

export type FinanceWorkspaceTab = 'overview' | 'transactions' | 'transfers' | 'reconciliation' | 'investor' | 'deposits' | 'ledger';
export type FinanceQuickAction = 'income' | 'expense' | 'transfer' | 'investor_repayment' | 'deposit' | 'reconcile' | 'adjustment';
export type FinanceStatusTone = 'emerald' | 'rose' | 'amber' | 'sky' | 'violet' | 'slate';

export function financeStatusLabel(status?: string | null, lang: string = 'az') {
  const normalized = String(status || 'posted').toLowerCase();
  const labels: Record<string, string> = {
    draft: tx(lang, 'Qaralama', 'Черновик', 'Draft'),
    pending_approval: tx(lang, 'Təsdiq gözləyir', 'Ожидает подтверждения', 'Pending approval'),
    approved: tx(lang, 'Təsdiqlənib', 'Подтверждено', 'Approved'),
    posted: tx(lang, 'Yazılıb', 'Проведено', 'Posted'),
    rejected: tx(lang, 'Rədd edilib', 'Отклонено', 'Rejected'),
    reversed: tx(lang, 'Əks yazılış edilib', 'Сторнировано', 'Reversed'),
  };
  return labels[normalized] || normalized.replace(/_/g, ' ');
}

export function FinanceDashboard({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5 text-slate-100">
      {children}
    </div>
  );
}

export function FinanceSummaryStrip({
  lang,
  balance,
  netCashflow,
  reconciliationGap,
  investorDebt,
  pendingApprovals,
  onRefresh,
}: {
  lang: string;
  balance: any;
  netCashflow: Decimal;
  reconciliationGap: string;
  investorDebt: string;
  pendingApprovals: number;
  onRefresh: () => void;
}) {
  const [showAllKpis, setShowAllKpis] = React.useState(false);
  const cards = [
    { label: tx(lang, 'Nağd Kassa', 'Касса', 'Cash on hand'), value: balance.cash_balance, tone: 'emerald' as const, icon: <Banknote size={20} /> },
    { label: tx(lang, 'Bank/Kart', 'Банк/карта', 'Bank/Card'), value: balance.card_balance, tone: 'sky' as const, icon: <Landmark size={20} /> },
    { label: tx(lang, 'Seyf', 'Сейф', 'Safe'), value: balance.safe_balance, tone: 'violet' as const, icon: <ShieldCheck size={20} /> },
    { label: tx(lang, 'Aktiv Depozitlər', 'Активные депозиты', 'Active deposits'), value: balance.deposit_balance, tone: 'amber' as const, icon: <WalletCards size={20} /> },
    { label: tx(lang, 'Investor borcu', 'Долг инвестору', 'Investor liability'), value: investorDebt, tone: new Decimal(investorDebt || 0).gt(0.01) ? 'rose' as const : 'emerald' as const, icon: <CreditCard size={20} /> },
    { label: tx(lang, 'Bugünkü Net', 'Нетто сегодня', 'Today net'), value: netCashflow, tone: netCashflow.gte(0) ? 'emerald' as const : 'rose' as const, icon: <RefreshCw size={20} /> },
    { label: tx(lang, 'Uyğunlaşdırma', 'Сверка', 'Reconciliation'), value: reconciliationGap, tone: new Decimal(reconciliationGap || 0).abs().gt(0.01) ? 'rose' as const : 'emerald' as const, icon: <GitCompareArrows size={20} /> },
  ];
  return (
    <section className="rounded-[30px] border border-slate-800 bg-slate-900 p-4 md:p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
      <div className="mb-4 md:mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.24em] text-yellow-300">{tx(lang, 'Maliyyə iş sahəsi', 'Maliyyə iş sahəsi', 'Maliyyə iş sahəsi')}</div>
          <h2 className="mt-2 text-xl font-black text-white md:text-3xl">{tx(lang, 'Maliyyə nəzarət mərkəzi', 'Центр финансового контроля', 'Finance control center')}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            {tx(lang, 'Pul axını, öhdəliklər, uyğunlaşdırma və maliyyə jurnalı eyni iş sahəsindədir.', 'Денежный поток, обязательства, сверка и ledger в одном рабочем пространстве.', 'Cashflow, liabilities, reconciliation and ledger in one workspace.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm font-black text-amber-100">
            {tx(lang, 'Təsdiq gözləyənlər', 'Ожидает approval', 'Pending approvals')}: {pendingApprovals}
          </span>
          <button
            onClick={onRefresh}
            aria-label={tx(lang, 'Maliyyə məlumatlarını yenilə', 'Обновить финансовые данные', 'Refresh finance data')}
            className="min-h-12 rounded-2xl border border-slate-700 bg-slate-950 px-4 text-sm font-black text-slate-100"
          >
            {tx(lang, 'Yenilə', 'Обновить', 'Refresh')}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {(showAllKpis ? cards : cards.slice(0, 4)).map((card) => <FinanceKpiCard key={card.label} {...card} />)}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => setShowAllKpis((prev) => !prev)}
          className="min-h-10 rounded-2xl border border-slate-700 px-4 text-xs font-black uppercase tracking-[0.08em] text-slate-200"
        >
          {showAllKpis
            ? tx(lang, 'Kompakt KPI', 'Компакт KPI', 'Compact KPI')
            : tx(lang, 'Hamısını göstər', 'Показать все', 'Show all')}
        </button>
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
    <div className={`rounded-[24px] border p-3.5 md:p-4 ${toneMap[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="rounded-2xl bg-white/10 p-3">{icon}</div>
        <div className="text-right text-xs font-black uppercase tracking-[0.16em] opacity-70">{tx('az', 'Göstərici', 'KPI', 'KPI')}</div>
      </div>
      <div className="mt-4 text-xs font-black uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-2 text-xl md:text-2xl font-black text-white">{new Decimal(value || 0).toFixed(2)} ₼</div>
    </div>
  );
}

export function FinanceAlertsBar({
  alerts,
  onOpen,
}: {
  alerts: Array<Pick<FinanceAlert, 'id' | 'title' | 'body' | 'tone' | 'action'> & { tab: FinanceWorkspaceTab }>;
  onOpen: (alert: { id: string; tab: FinanceWorkspaceTab }) => void;
}) {
  if (!alerts.length) {
    return (
      <section role="status" aria-live="polite" className="rounded-[24px] border border-emerald-500/25 bg-emerald-950/25 p-4">
        <div className="flex items-center gap-3 text-emerald-100">
          <CheckCircle2 size={20} />
          <div className="font-black">{tx('az', 'Hazırda kritik maliyyə xəbərdarlığı yoxdur', 'Hazırda kritik maliyyə xəbərdarlığı yoxdur', 'Hazırda kritik maliyyə xəbərdarlığı yoxdur')}</div>
        </div>
      </section>
    );
  }
  return (
    <section className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      {alerts.map((alert) => (
          <button
            key={alert.id}
            onClick={() => onOpen(alert)}
            aria-label={`${alert.title}. ${alert.action}`}
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

export function FinanceQuickActions({ lang, active, onSelect }: { lang: string; active: FinanceQuickAction; onSelect: (action: FinanceQuickAction) => void }) {
  const actions: Array<{ id: FinanceQuickAction; label: string; helper: string; icon: React.ReactNode }> = [
    { id: 'income', label: tx(lang, 'Mədaxil yaz', 'Записать приход', 'Record income'), helper: tx(lang, 'Pul daxilolması', 'Pul daxilolması', 'Pul daxilolması'), icon: <Banknote size={18} /> },
    { id: 'expense', label: tx(lang, 'Xərc yaz', 'Записать расход', 'Record expense'), helper: tx(lang, 'Pul çıxışı', 'Pul çıxışı', 'Pul çıxışı'), icon: <CreditCard size={18} /> },
    { id: 'transfer', label: tx(lang, 'Daxili transfer', 'Внутренний перевод', 'Internal transfer'), helper: tx(lang, 'Hesablar arası', 'Hesablar arası', 'Hesablar arası'), icon: <ArrowRight size={18} /> },
    { id: 'investor_repayment', label: tx(lang, 'Investor ödə', 'Оплатить инвестору', 'Repay investor'), helper: tx(lang, 'Təsdiq nəzarəti', 'Təsdiq nəzarəti', 'Təsdiq nəzarəti'), icon: <ShieldCheck size={18} /> },
    { id: 'deposit', label: tx(lang, 'Depozit əməliyyatı', 'Операция депозита', 'Deposit operation'), helper: tx(lang, 'Öhdəlik qeydi', 'Öhdəlik qeydi', 'Öhdəlik qeydi'), icon: <WalletCards size={18} /> },
    { id: 'reconcile', label: tx(lang, 'Uyğunlaşdırma başlat', 'Начать сверку', 'Start reconcile'), helper: tx(lang, 'Kassa sayımı', 'Kassa sayımı', 'Kassa sayımı'), icon: <GitCompareArrows size={18} /> },
    { id: 'adjustment', label: tx(lang, 'Düzəliş', 'Корректировка', 'Adjustment'), helper: tx(lang, 'Audit əməliyyatı', 'Audit əməliyyatı', 'Audit əməliyyatı'), icon: <BookOpen size={18} /> },
  ];
  return (
    <section className="rounded-[28px] border border-slate-800 bg-slate-900 p-3.5 md:p-4">
      <div className="mb-3 text-xs font-black uppercase tracking-[0.24em] text-slate-400">{tx(lang, 'Sürətli əməliyyatlar', 'Sürətli əməliyyatlar', 'Sürətli əməliyyatlar')}</div>
      <div className="grid grid-cols-1 gap-2.5 md:gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={() => onSelect(action.id)}
            aria-pressed={active === action.id}
            aria-label={`${action.label} · ${action.helper}`}
            className={`min-h-[96px] md:min-h-[110px] rounded-2xl border p-3.5 md:p-4 text-left ${active === action.id ? 'border-yellow-300 bg-yellow-400 text-slate-950' : 'border-slate-800 bg-slate-950 text-slate-200'}`}
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

export function FinanceWorkspaceTabs({ active, onChange }: { lang?: string; active: FinanceWorkspaceTab; onChange: (tab: FinanceWorkspaceTab) => void }) {
  const tabs: Array<[FinanceWorkspaceTab, string]> = [
    ['overview', 'Baxış'],
    ['transactions', 'Əməliyyatlar'],
    ['transfers', 'Transferlər'],
    ['reconciliation', 'Uyğunlaşdırma'],
    ['investor', 'Investor'],
    ['deposits', 'Depozitlər'],
    ['ledger', 'Maliyyə Jurnalı'],
  ];
  return (
    <div
      role="tablist"
      aria-label="Finance workspace tabs"
      className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-[24px] border border-slate-800 bg-slate-950 p-2"
    >
      {tabs.map(([tab, label]) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          role="tab"
          aria-selected={active === tab}
          aria-current={active === tab ? 'page' : undefined}
          className={`min-h-12 shrink-0 snap-start whitespace-nowrap rounded-2xl px-5 text-sm font-black ${active === tab ? 'bg-white text-slate-950' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function FinanceControlCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[28px] border border-slate-800 bg-slate-900 p-4 md:p-5">
      <div className="mb-5">
        <h3 className="text-xl font-black text-white">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function FinanceMiniMetric({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' | 'amber' | 'sky' | 'violet' }) {
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

const financeStatusTone = (status?: string | null): FinanceStatusTone => {
  const normalized = String(status || 'posted').toLowerCase();
  if (normalized === 'posted' || normalized === 'approved') return 'emerald';
  if (normalized === 'pending_approval') return 'amber';
  if (normalized === 'reversed' || normalized === 'rejected') return 'rose';
  if (normalized === 'draft') return 'sky';
  return 'slate';
};

export function FinanceStatusBadge({ status, lang = 'az' }: { status?: string | null; lang?: string }) {
  const label = String(status || 'posted');
  const tone = financeStatusTone(label);
  const classes: Record<FinanceStatusTone, string> = {
    emerald: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100',
    rose: 'border-rose-300/30 bg-rose-400/10 text-rose-100',
    amber: 'border-amber-300/30 bg-amber-400/10 text-amber-100',
    sky: 'border-sky-300/30 bg-sky-400/10 text-sky-100',
    violet: 'border-violet-300/30 bg-violet-400/10 text-violet-100',
    slate: 'border-slate-600 bg-slate-800/70 text-slate-100',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.08em] ${classes[tone]}`}>
      {financeStatusLabel(label, lang)}
    </span>
  );
}

export function FinanceTimelineItem({
  lang,
  label,
  by,
  at,
  tone,
  active = true,
}: {
  lang: string;
  label: string;
  by?: string | null;
  at?: string | null;
  tone: FinanceStatusTone;
  active?: boolean;
}) {
  const dotClasses: Record<FinanceStatusTone, string> = {
    emerald: 'bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.35)]',
    rose: 'bg-rose-300 shadow-[0_0_18px_rgba(253,164,175,0.35)]',
    amber: 'bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.35)]',
    sky: 'bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,0.35)]',
    violet: 'bg-violet-300 shadow-[0_0_18px_rgba(196,181,253,0.35)]',
    slate: 'bg-slate-500',
  };
  return (
    <div className={`relative pl-8 ${active ? '' : 'opacity-45'}`}>
      <span className={`absolute left-0 top-1.5 h-3 w-3 rounded-full ${dotClasses[tone]}`} />
      <div className="text-sm font-black text-white">{label}</div>
      <div className="mt-1 text-xs font-bold text-slate-400">
        {at ? formatServerUtcDateTime(at, lang) : '-'}{by ? ` · ${by}` : ''}
      </div>
    </div>
  );
}

export function FinanceField({
  label,
  helper,
  htmlForId,
  children,
}: {
  label: string;
  helper?: string;
  htmlForId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field-stack form-card">
      <label className="field-label" htmlFor={htmlForId}>{label}</label>
      {children}
      {helper ? <span className="field-hint">{helper}</span> : null}
    </div>
  );
}

export function TransactionDetailDrawer({
  lang,
  detail,
  loading,
  accountName,
  transactionTypeLabel,
  onApprove,
  onReject,
  onReverse,
  onClose,
}: {
  lang: string;
  detail: FinanceTransactionDetail | null;
  loading: boolean;
  accountName: (code?: string | null) => string;
  transactionTypeLabel: (value?: string | null) => string;
  onApprove: (transactionId: string) => void | Promise<void>;
  onReject: (transactionId: string) => void | Promise<void>;
  onReverse: (transactionId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [actionBusy, setActionBusy] = React.useState<'approve' | 'reject' | 'reverse' | null>(null);
  const drawerRef = React.useRef<HTMLElement | null>(null);
  const closeBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    setActionBusy(null);
  }, [detail?.transaction?.id]);

  React.useEffect(() => {
    if (!detail) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = drawerRef.current;
      if (!container) return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [detail, onClose]);

  if (!detail) return null;
  const txRow = detail.transaction;
  const auditDetails = detail.audit_logs.map((row) => {
    try {
      return { ...row, parsed: JSON.parse(row.details || '{}') };
    } catch {
      return { ...row, parsed: null };
    }
  });
  const auditSummaryItems = (parsed: any) => {
    if (!parsed || typeof parsed !== 'object') return [] as Array<[string, string]>;
    return [
      ['type', parsed.transaction_type],
      ['status', parsed.status],
      ['amount', parsed.amount],
      ['source', parsed.source_account || parsed.source_account_id],
      ['destination', parsed.destination_account || parsed.destination_account_id],
      ['reference', parsed.reference],
      ['note', parsed.note],
    ]
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
      .map(([label, value]) => [label, String(value)] as [string, string]);
  };
  const lifecycleEvents = [
    { label: tx(lang, 'Yaradıldı', 'Создано', 'Created'), by: txRow.created_by, at: txRow.created_at, tone: 'sky' as FinanceStatusTone, active: true },
    { label: tx(lang, 'Təsdiqləndi', 'Подтверждено', 'Approved'), by: txRow.approved_by, at: txRow.approved_at, tone: 'emerald' as FinanceStatusTone, active: Boolean(txRow.approved_at || txRow.approved_by) },
    { label: tx(lang, 'Ledger-ə post edildi', 'Posted в ledger', 'Posted to ledger'), by: txRow.posted_by, at: txRow.posted_at, tone: 'emerald' as FinanceStatusTone, active: txRow.status === 'posted' || txRow.status === 'reversed' || Boolean(txRow.posted_at) },
    { label: tx(lang, 'Reversal edildi', 'Reversed', 'Reversed'), by: txRow.reversed_by, at: txRow.reversed_at, tone: 'rose' as FinanceStatusTone, active: txRow.status === 'reversed' || Boolean(txRow.reversed_at) },
  ];
  const runAction = async (mode: 'approve' | 'reject' | 'reverse', handler: () => Promise<void>) => {
    if (actionBusy) return;
    setActionBusy(mode);
    try {
      await handler();
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="finance-transaction-drawer-title"
      className="fixed inset-0 z-[80] flex justify-end bg-slate-950/70 backdrop-blur-sm"
    >
      <button className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close transaction drawer" />
      <aside ref={drawerRef} className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-5 shadow-[0_0_80px_rgba(0,0,0,0.55)]">
        <div className="sticky top-0 z-10 -mx-5 -mt-5 border-b border-slate-800 bg-slate-950/95 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.22em] text-yellow-300">{tx(lang, 'Əməliyyat detalları', 'Детали операции', 'Transaction Detail')}</div>
              <h3 id="finance-transaction-drawer-title" className="mt-2 text-2xl font-black text-white">{transactionTypeLabel(txRow.transaction_type) || tx(lang, 'Əməliyyat', 'Операция', 'Transaction')}</h3>
              <p className="mt-1 text-sm text-slate-400">{txRow.id}</p>
            </div>
            <button ref={closeBtnRef} onClick={onClose} className="min-h-11 rounded-2xl border border-slate-700 px-4 text-sm font-black text-slate-200">
              {tx(lang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
          {loading ? <div className="mt-3 text-xs font-bold text-sky-200">{tx(lang, 'Detallar yüklənir...', 'Детали загружаются...', 'Loading details...')}</div> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {txRow.status === 'pending_approval' ? (
              <>
                <button
                  disabled={Boolean(actionBusy)}
                  onClick={() => void runAction('approve', async () => { await onApprove(txRow.id); })}
                  className="min-h-11 rounded-2xl bg-emerald-300 px-4 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionBusy === 'approve'
                    ? tx(lang, 'Təsdiqlənir...', 'Подтверждение...', 'Approving...')
                    : tx(lang, 'Təsdiqlə və yaz', 'Подтвердить и post', 'Approve and post')}
                </button>
                <button
                  disabled={Boolean(actionBusy)}
                  onClick={() => void runAction('reject', async () => { await onReject(txRow.id); })}
                  className="min-h-11 rounded-2xl border border-rose-400/40 px-4 text-sm font-black text-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {actionBusy === 'reject'
                    ? tx(lang, 'Rədd edilir...', 'Отклонение...', 'Rejecting...')
                    : tx(lang, 'Rədd et', 'Отклонить', 'Reject')}
                </button>
              </>
            ) : null}
            {txRow.status === 'posted' && txRow.transaction_type !== 'reversal' && detail.reversal_history.length === 0 ? (
              <button
                disabled={Boolean(actionBusy)}
                onClick={() => void runAction('reverse', async () => { await onReverse(txRow.id); })}
                className="min-h-11 rounded-2xl border border-amber-400/40 px-4 text-sm font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionBusy === 'reverse'
                  ? tx(lang, 'Sorğu göndərilir...', 'Запрос отправляется...', 'Submitting request...')
                  : tx(lang, 'Əks yazılış istə', 'Запросить reversal', 'Request reversal')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{tx(lang, 'Status', 'Статус', 'Status')}</div>
            <div className="mt-3"><FinanceStatusBadge status={txRow.status || 'posted'} lang={lang} /></div>
          </div>
          <FinanceMiniMetric label={tx(lang, 'Məbləğ', 'Сумма', 'Amount')} value={`${new Decimal(txRow.amount || 0).toFixed(2)} ₼`} tone="sky" />
          <FinanceMiniMetric label={tx(lang, 'Haradan', 'Откуда', 'From')} value={accountName(txRow.source_account)} tone="amber" />
          <FinanceMiniMetric label={tx(lang, 'Hara', 'Куда', 'To')} value={accountName(txRow.destination_account)} tone="violet" />
        </div>

        <section className="mt-5 rounded-[24px] border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-4 text-xs font-black uppercase tracking-[0.18em] text-slate-500">{tx(lang, 'Həyat dövrü xətti', 'Timeline жизненного цикла', 'Lifecycle timeline')}</div>
          <div className="relative space-y-5 before:absolute before:left-[5px] before:top-2 before:h-[calc(100%-12px)] before:w-px before:bg-slate-700">
            {lifecycleEvents.map((event) => (
              <FinanceTimelineItem key={event.label} lang={lang} label={event.label} by={event.by} at={event.at} tone={event.tone} active={event.active} />
            ))}
          </div>
          {txRow.note || txRow.reference ? (
            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
              {txRow.note || txRow.reference}
            </div>
          ) : null}
        </section>

        <section className="mt-5 rounded-[24px] border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-yellow-300">{tx(lang, 'Debit / Credit yazılışları', 'Debit / Credit записи', 'Debit / Credit entries')}</div>
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
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-yellow-300">{tx(lang, 'Əks yazılış tarixçəsi', 'История reversal', 'Reversal history')}</div>
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
                    <FinanceStatusBadge status={row.status} />
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
                {tx(lang, 'Əks yazılış tarixçəsi yoxdur.', 'Истории reversal нет.', 'No reversal history.')}
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-5 rounded-[24px] border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-yellow-300">{tx(lang, 'Audit tarixçəsi', 'Audit trail', 'Audit trail')}</div>
          <div className="space-y-3">
            {auditDetails.map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-black text-white">{row.action}</div>
                  <div className="text-xs text-slate-500">{formatServerUtcDateTime(row.created_at || '', lang)}</div>
                </div>
                <div className="mt-1 text-xs text-slate-400">{row.user}</div>
                {auditSummaryItems(row.parsed).length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {auditSummaryItems(row.parsed).map(([label, value]) => (
                      <span key={`${row.id}-${label}`} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] font-bold text-slate-300">
                        <span className="text-slate-500">{label}:</span> {value}
                      </span>
                    ))}
                  </div>
                ) : null}
                <details className="mt-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
                  <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
                    {tx(lang, 'Texniki detal', 'Техническая деталь', 'Technical detail')}
                  </summary>
                  <pre className="mt-3 max-h-40 overflow-auto text-[11px] text-slate-400">
                    {JSON.stringify(row.parsed || row.details || {}, null, 2)}
                  </pre>
                </details>
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
