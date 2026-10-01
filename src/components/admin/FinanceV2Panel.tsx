// Finance v2 — general ledger workspace (AMHP chart of accounts, double entry).
// Visible only when the backend reports the GL API as enabled for this tenant (see /api/v1/gl/capabilities).
import React from 'react';
import { BookOpenCheck, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { getGLCapabilities, glApi, type GLAccount, type GLCapabilities } from '../../api/gl';
import { GLContext, type GLPanelContext } from './financev2/context';
import { Badge, Empty, Loading, btn, errorText, monthStart } from './financev2/FinanceV2Parts';
import { AccountLedgerTab, OverviewTab, TrialBalanceTab } from './financev2/ReportsTabs';
import { ApprovalsTab, JournalDrawer, JournalsTab } from './financev2/JournalsTabs';
import { IntegrityTab, PeriodsTab, TaxTab } from './financev2/ControlTabs';
import { PartnersTab } from './financev2/PartnersTab';
import { BillsTab } from './financev2/BillsTab';

type Tab = 'overview' | 'trial' | 'ledger' | 'journals' | 'approvals' | 'partners' | 'bills' | 'periods' | 'tax' | 'integrity';

export default function FinanceV2Panel() {
  const { lang, notify } = useAppStore();
  const [caps, setCaps] = React.useState<GLCapabilities | null | undefined>(undefined);
  const [accounts, setAccounts] = React.useState<GLAccount[]>([]);
  const [tab, setTab] = React.useState<Tab>('overview');
  const [version, setVersion] = React.useState(0);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [journalId, setJournalId] = React.useState<string | null>(null);
  const [ledgerAccountId, setLedgerAccountId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [settingUp, setSettingUp] = React.useState(false);

  const loadCaps = React.useCallback(async () => {
    const result = await getGLCapabilities();
    setCaps(result);
    if (result) {
      setFrom((prev) => prev || monthStart(result.business_today));
      setTo((prev) => prev || result.business_today);
    }
  }, []);

  React.useEffect(() => { void loadCaps(); }, [loadCaps]);

  React.useEffect(() => {
    if (!caps?.chart_ready) return;
    let alive = true;
    glApi.accounts().then((rows) => { if (alive) setAccounts(rows); }).catch((e) => notify('error', errorText(e)));
    glApi.journals({ status: 'pending_approval', limit: 1 }).then((page) => { if (alive) setPendingCount(page.total); }).catch(() => {});
    return () => { alive = false; };
  }, [caps?.chart_ready, version, notify]);

  const ctx = React.useMemo<GLPanelContext | null>(() => {
    if (!caps) return null;
    return {
      lang,
      caps,
      accounts,
      accountsByCode: new Map(accounts.map((a) => [a.code, a])),
      notify,
      version,
      bump: () => setVersion((v) => v + 1),
      openLedger: (accountId: string) => { setLedgerAccountId(accountId); setTab('ledger'); },
      openJournal: (id: string) => setJournalId(id),
    };
  }, [caps, accounts, lang, notify, version]);

  if (caps === undefined) return <Loading lang={lang} />;
  if (caps === null || !ctx) {
    return (
      <Empty>
        {tx(lang,
          'Maliyyə v2 (baş kitab) bu obyekt üçün hələ aktiv deyil və ya sizin rolunuza açıq deyil.',
          'Финансы v2 (главная книга) для этого объекта ещё не включены или недоступны вашей роли.',
          'Finance v2 (general ledger) is not enabled for this business yet, or not available to your role.')}
      </Empty>
    );
  }

  const setupChart = async () => {
    setSettingUp(true);
    try {
      await glApi.setup();
      notify('success', tx(lang, 'Hesablar planı yaradıldı', 'План счетов создан', 'Chart of accounts created'));
      await loadCaps();
    } catch (e) {
      notify('error', errorText(e));
    } finally {
      setSettingUp(false);
    }
  };

  const tabs: Array<{ id: Tab; label: string; show: boolean; badge?: number }> = [
    { id: 'overview', label: tx(lang, 'Baxış', 'Обзор', 'Overview'), show: true },
    { id: 'trial', label: tx(lang, 'Sınaq balansı', 'ОСВ', 'Trial balance'), show: true },
    { id: 'ledger', label: tx(lang, 'Hesab kartı', 'Карточка счёта', 'Account ledger'), show: true },
    { id: 'journals', label: tx(lang, 'Jurnallar', 'Проводки', 'Journals'), show: true },
    { id: 'approvals', label: tx(lang, 'Təsdiqlər', 'Утверждения', 'Approvals'), show: true, badge: pendingCount },
    { id: 'partners', label: tx(lang, 'Borclar', 'Долги', 'Payables & receivables'), show: true },
    { id: 'bills', label: tx(lang, 'Fakturalar', 'Счета', 'Bills'), show: true },
    { id: 'periods', label: tx(lang, 'Dövrlər və il', 'Периоды и год', 'Periods & year'), show: true },
    { id: 'tax', label: tx(lang, 'Vergi', 'Налог', 'Tax'), show: true },
    { id: 'integrity', label: tx(lang, 'Nəzarət', 'Контроль', 'Controls'), show: caps.can_audit },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const range = { from, to, setFrom, setTo };

  return (
    <GLContext.Provider value={ctx}>
      <div className="space-y-4 text-slate-100">
        <header className="rounded-[30px] border border-slate-800 bg-slate-900 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-yellow-300">
                <BookOpenCheck size={16} aria-hidden="true" />
                {tx(lang, 'Maliyyə v2 · Baş kitab', 'Финансы v2 · Главная книга', 'Finance v2 · General ledger')}
              </div>
              <h2 className="mt-2 text-xl font-black text-white md:text-3xl">{tx(lang, 'Mühasibat uçotu', 'Бухгалтерский учёт', 'Accounting')}</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-300">
                {tx(lang,
                  'Azərbaycan Milli Hesablar Planı üzrə ikili yazılış. Hər əməliyyat audit zəncirinə yazılır.',
                  'Двойная запись по Национальному плану счетов Азербайджана. Каждая операция в цепочке аудита.',
                  'Double entry on the Azerbaijan national chart of accounts. Every change is in the audit chain.')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={caps.ledger_mode === 'dual' ? 'emerald' : 'slate'}>
                {caps.ledger_mode === 'dual' ? tx(lang, 'Canlı yazılış', 'Живая запись', 'Live posting') : tx(lang, 'Kölgə rejimi', 'Теневой режим', 'Shadow mode')}
              </Badge>
              <Badge tone={caps.reports_source === 'gl' ? 'emerald' : 'amber'}>
                {caps.reports_source === 'gl'
                  ? tx(lang, 'Hesabatlar: baş kitab', 'Отчёты: главная книга', 'Reports: GL')
                  : tx(lang, 'Hesabatlar: köhnə sistem', 'Отчёты: старая система', 'Reports: legacy')}
              </Badge>
              <button type="button" className={btn.ghost} onClick={() => { void loadCaps(); setVersion((v) => v + 1); }} aria-label={tx(lang, 'Yenilə', 'Обновить', 'Refresh')}>
                <RefreshCw size={16} />
              </button>
            </div>
          </div>
        </header>

        {!caps.chart_ready ? (
          <Empty>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <span>{tx(lang, 'Hesablar planı hələ yaradılmayıb.', 'План счетов ещё не создан.', 'The chart of accounts has not been created yet.')}</span>
              {caps.can_control ? (
                <button type="button" className={btn.primary} disabled={settingUp} onClick={() => void setupChart()}>
                  {tx(lang, 'AMHP planını yarat', 'Создать план счетов', 'Create AMHP chart')}
                </button>
              ) : null}
            </div>
          </Empty>
        ) : (
          <>
            <div role="tablist" aria-label={tx(lang, 'Maliyyə v2 bölmələri', 'Разделы Финансы v2', 'Finance v2 sections')} className="flex snap-x gap-2 overflow-x-auto rounded-[24px] border border-slate-800 bg-slate-950 p-2">
              {visibleTabs.map((t) => (
                <button
                  key={t.id}
                  id={`gl-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls="gl-tabpanel"
                  onClick={() => setTab(t.id)}
                  className={`min-h-12 shrink-0 snap-start whitespace-nowrap rounded-2xl px-5 text-sm font-black ${tab === t.id ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-slate-900 hover:text-white'}`}
                >
                  {t.label}
                  {t.badge ? <span className="ml-2 rounded-full bg-amber-400 px-2 py-0.5 text-xs text-slate-950">{t.badge}</span> : null}
                </button>
              ))}
            </div>

            <div id="gl-tabpanel" role="tabpanel" aria-labelledby={`gl-tab-${tab}`}>
              {tab === 'overview' ? <OverviewTab {...range} /> : null}
              {tab === 'trial' ? <TrialBalanceTab {...range} /> : null}
              {tab === 'ledger' ? <AccountLedgerTab accountId={ledgerAccountId} setAccountId={setLedgerAccountId} {...range} /> : null}
              {tab === 'journals' ? <JournalsTab {...range} /> : null}
              {tab === 'approvals' ? <ApprovalsTab /> : null}
              {tab === 'partners' ? <PartnersTab /> : null}
              {tab === 'bills' ? <BillsTab /> : null}
              {tab === 'periods' ? <PeriodsTab /> : null}
              {tab === 'tax' ? <TaxTab /> : null}
              {tab === 'integrity' && caps.can_audit ? <IntegrityTab /> : null}
            </div>
          </>
        )}

        {journalId ? <JournalDrawer key={journalId} journalId={journalId} onClose={() => setJournalId(null)} /> : null}
      </div>
    </GLContext.Provider>
  );
}
