import React from 'react';
import { tx } from '../../../i18n';
import { glApi, type StatementSection } from '../../../api/gl';
import { useGL, useGLLoad } from './context';
import { Badge, Card, DateRange, Empty, Field, Loading, Metric, btn, inputCls, isZero, journalTypeLabel, money } from './FinanceV2Parts';

// ─────────────────────────────── overview ───────────────────────────────

function Section({ title, section }: { title: string; section: StatementSection }) {
  const { accountsByCode, openLedger, lang } = useGL();
  const lines = section.lines.filter((line) => !isZero(line.amount));
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
        <span>{title}</span>
        <span className="text-white">{money(section.total)}</span>
      </div>
      {lines.length === 0 ? <div className="text-sm text-slate-500">{tx(lang, 'Qalıq yoxdur', 'Нет остатков', 'No balances')}</div> : null}
      <ul className="divide-y divide-slate-800/80">
        {lines.map((line) => {
          const account = accountsByCode.get(line.code);
          const content = (
            <>
              <span className="min-w-0 truncate"><span className="mr-2 font-mono text-slate-500">{line.code}</span>{line.name}</span>
              <span className="shrink-0 font-bold text-slate-100">{money(line.amount)}</span>
            </>
          );
          return (
            <li key={line.code}>
              {account ? (
                <button type="button" onClick={() => openLedger(account.id)} className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm text-slate-200 hover:text-yellow-200">
                  {content}
                </button>
              ) : (
                <div className="flex items-center justify-between gap-3 py-2 text-sm text-slate-300">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function OverviewTab({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const { lang } = useGL();
  const { data, loading, error } = useGLLoad(
    () => Promise.all([glApi.balanceSheet(to), glApi.profitLoss(from, to)]),
    [from, to],
  );
  const [bs, pl] = data || [null, null];
  return (
    <div className="space-y-4">
      <Card
        title={tx(lang, 'Maliyyə vəziyyəti', 'Финансовое положение', 'Financial position')}
        subtitle={tx(lang, 'Balans hesabatın son tarixinə, mənfəət/zərər seçilmiş dövrə görədir.', 'Баланс на конечную дату, P&L за выбранный период.', 'Balance sheet as of the end date, P&L for the selected period.')}
        actions={<DateRange lang={lang} idPrefix="gl-ov" from={from} to={to} onFrom={setFrom} onTo={setTo} />}
      >
        {loading && !data ? <Loading lang={lang} /> : null}
        {error ? <Empty>{error}</Empty> : null}
        {bs && pl ? (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <Metric label={tx(lang, 'Aktivlər', 'Активы', 'Assets')} value={money(bs.assets.total)} tone="sky" />
            <Metric label={tx(lang, 'Öhdəliklər', 'Обязательства', 'Liabilities')} value={money(bs.liabilities.total)} tone="amber" />
            <Metric label={tx(lang, 'Kapital', 'Капитал', 'Equity')} value={money(bs.equity.total)} tone="violet" />
            <Metric label={tx(lang, 'Gəlir', 'Выручка', 'Revenue')} value={money(pl.revenue.total)} tone="emerald" />
            <Metric label={tx(lang, 'Xalis mənfəət', 'Чистая прибыль', 'Net profit')} value={money(pl.net_profit)} tone={pl.net_profit.startsWith('-') ? 'rose' : 'emerald'} />
          </div>
        ) : null}
      </Card>

      {bs ? (
        <Card
          title={tx(lang, 'Balans hesabatı', 'Бухгалтерский баланс', 'Balance sheet')}
          subtitle={`${tx(lang, 'Tarixə', 'На дату', 'As of')} ${bs.as_of}`}
          actions={bs.balanced
            ? <Badge tone="emerald">{tx(lang, 'Balanslaşıb', 'Сбалансирован', 'Balanced')}</Badge>
            : <Badge tone="rose">{tx(lang, 'Fərq', 'Разница', 'Difference')}: {money(bs.difference)}</Badge>}
        >
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <Section title={tx(lang, 'Aktivlər', 'Активы', 'Assets')} section={bs.assets} />
            <Section title={tx(lang, 'Öhdəliklər', 'Обязательства', 'Liabilities')} section={bs.liabilities} />
            <Section title={tx(lang, 'Kapital', 'Капитал', 'Equity')} section={bs.equity} />
          </div>
        </Card>
      ) : null}

      {pl ? (
        <Card title={tx(lang, 'Mənfəət və zərər', 'Прибыли и убытки', 'Profit and loss')} subtitle={`${pl.date_from} — ${pl.date_to}`}>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <Section title={tx(lang, 'Gəlir', 'Выручка', 'Revenue')} section={pl.revenue} />
            <Section title={tx(lang, 'Satışın maya dəyəri', 'Себестоимость', 'Cost of sales')} section={pl.cogs} />
            <Section title={tx(lang, 'Əməliyyat xərcləri', 'Операционные расходы', 'Operating expenses')} section={pl.operating_expenses} />
            <Section title={tx(lang, 'Digər gəlirlər', 'Прочие доходы', 'Other income')} section={pl.other_income} />
            <Section title={tx(lang, 'Maliyyə xərcləri', 'Финансовые расходы', 'Finance costs')} section={pl.finance_costs} />
            <Section title={tx(lang, 'Vergilər', 'Налоги', 'Taxes')} section={pl.taxes} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric label={tx(lang, 'Ümumi mənfəət', 'Валовая прибыль', 'Gross profit')} value={money(pl.gross_profit)} tone="sky" />
            <Metric label={tx(lang, 'Əməliyyat mənfəəti', 'Операционная прибыль', 'Operating profit')} value={money(pl.operating_profit)} tone="violet" />
            <Metric label={tx(lang, 'Vergidən əvvəl', 'До налога', 'Before tax')} value={money(pl.profit_before_tax)} tone="amber" />
            <Metric label={tx(lang, 'Xalis mənfəət', 'Чистая прибыль', 'Net profit')} value={money(pl.net_profit)} tone={pl.net_profit.startsWith('-') ? 'rose' : 'emerald'} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ─────────────────────────────── trial balance ──────────────────────────

export function TrialBalanceTab({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const { lang, openLedger } = useGL();
  const [hideZero, setHideZero] = React.useState(true);
  const { data, loading, error } = useGLLoad(() => glApi.trialBalance({ date_from: from, date_to: to }), [from, to]);
  const rows = (data?.rows || []).filter((row) => !hideZero || !(
    isZero(row.opening_debit) && isZero(row.opening_credit) && isZero(row.period_debit) && isZero(row.period_credit)
  ));
  const head = 'px-3 py-2 text-right text-xs font-black uppercase tracking-[0.1em] text-slate-400';
  const cell = 'px-3 py-2 text-right font-mono text-sm text-slate-200 whitespace-nowrap';
  return (
    <Card
      title={tx(lang, 'Sınaq balansı (dövriyyə cədvəli)', 'Оборотно-сальдовая ведомость', 'Trial balance')}
      subtitle={tx(lang, 'Hesaba toxunun — hesab kartı açılır.', 'Нажмите на счёт, чтобы открыть карточку.', 'Tap an account to open its ledger.')}
      actions={(
        <>
          <DateRange lang={lang} idPrefix="gl-tb" from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-slate-300">
            <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
            {tx(lang, 'Sıfırları gizlət', 'Скрыть нули', 'Hide zero rows')}
          </label>
          {data ? (data.balanced
            ? <Badge tone="emerald">{tx(lang, 'Balanslaşıb', 'Сбалансирован', 'Balanced')}</Badge>
            : <Badge tone="rose">{tx(lang, 'Balanslaşmayıb', 'Не сбалансирован', 'Not balanced')}</Badge>) : null}
        </>
      )}
    >
      {loading && !data ? <Loading lang={lang} /> : null}
      {error ? <Empty>{error}</Empty> : null}
      {data ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="min-w-[860px] w-full border-collapse bg-slate-950">
            <caption className="sr-only">{tx(lang, 'Sınaq balansı', 'Оборотно-сальдовая ведомость', 'Trial balance')}</caption>
            <thead className="bg-slate-900">
              <tr>
                <th scope="col" className="px-3 py-2 text-left text-xs font-black uppercase tracking-[0.1em] text-slate-400">{tx(lang, 'Hesab', 'Счёт', 'Account')}</th>
                <th scope="col" className={head}>{tx(lang, 'Açılış D', 'Нач. Д', 'Open Dr')}</th>
                <th scope="col" className={head}>{tx(lang, 'Açılış K', 'Нач. К', 'Open Cr')}</th>
                <th scope="col" className={head}>{tx(lang, 'Dövriyyə D', 'Оборот Д', 'Period Dr')}</th>
                <th scope="col" className={head}>{tx(lang, 'Dövriyyə K', 'Оборот К', 'Period Cr')}</th>
                <th scope="col" className={head}>{tx(lang, 'Son D', 'Кон. Д', 'Close Dr')}</th>
                <th scope="col" className={head}>{tx(lang, 'Son K', 'Кон. К', 'Close Cr')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((row) => (
                <tr key={row.account_id} className="hover:bg-slate-900/70">
                  <th scope="row" className="px-3 py-2 text-left text-sm font-bold text-slate-100">
                    <button type="button" className="text-left hover:text-yellow-200" onClick={() => openLedger(row.account_id)}>
                      <span className="mr-2 font-mono text-slate-500">{row.code}</span>{row.name}
                    </button>
                  </th>
                  <td className={cell}>{isZero(row.opening_debit) ? '' : money(row.opening_debit)}</td>
                  <td className={cell}>{isZero(row.opening_credit) ? '' : money(row.opening_credit)}</td>
                  <td className={cell}>{isZero(row.period_debit) ? '' : money(row.period_debit)}</td>
                  <td className={cell}>{isZero(row.period_credit) ? '' : money(row.period_credit)}</td>
                  <td className={cell}>{isZero(row.closing_debit) ? '' : money(row.closing_debit)}</td>
                  <td className={cell}>{isZero(row.closing_credit) ? '' : money(row.closing_credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-900 font-black">
              <tr>
                <th scope="row" className="px-3 py-2 text-left text-sm text-white">{tx(lang, 'Cəmi', 'Итого', 'Total')}</th>
                <td className={cell}>{money(data.totals.opening_debit)}</td>
                <td className={cell}>{money(data.totals.opening_credit)}</td>
                <td className={cell}>{money(data.totals.period_debit)}</td>
                <td className={cell}>{money(data.totals.period_credit)}</td>
                <td className={cell}>{money(data.totals.closing_debit)}</td>
                <td className={cell}>{money(data.totals.closing_credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

// ─────────────────────────────── account ledger ─────────────────────────

const LEDGER_PAGE = 200;

export function AccountLedgerTab({ accountId, setAccountId, from, to, setFrom, setTo }: {
  accountId: string; setAccountId: (id: string) => void;
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
}) {
  const { lang, accounts, openJournal } = useGL();
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => { setOffset(0); }, [accountId, from, to]);
  const postable = accounts.filter((a) => a.is_postable && a.is_active);
  const { data, loading, error } = useGLLoad(
    () => (accountId ? glApi.accountLedger(accountId, { date_from: from, date_to: to, limit: LEDGER_PAGE, offset }) : Promise.resolve(null)),
    [accountId, from, to, offset],
  );
  const cell = 'px-3 py-2 text-right font-mono text-sm whitespace-nowrap';
  return (
    <Card
      title={tx(lang, 'Hesab kartı', 'Карточка счёта', 'Account ledger')}
      subtitle={data?.account ? `${data.account.code} · ${data.account.name}` : tx(lang, 'Hesab seçin', 'Выберите счёт', 'Choose an account')}
      actions={(
        <>
          <Field id="gl-ledger-account" label={tx(lang, 'Hesab', 'Счёт', 'Account')}>
            <select id="gl-ledger-account" className={`${inputCls} min-w-[260px]`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">—</option>
              {postable.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
          <DateRange lang={lang} idPrefix="gl-al" from={from} to={to} onFrom={setFrom} onTo={setTo} />
        </>
      )}
    >
      {!accountId ? <Empty>{tx(lang, 'Hərəkətləri görmək üçün hesab seçin.', 'Выберите счёт, чтобы увидеть движения.', 'Choose an account to see its movements.')}</Empty> : null}
      {accountId && loading && !data ? <Loading lang={lang} /> : null}
      {error ? <Empty>{error}</Empty> : null}
      {data ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Metric label={tx(lang, 'Açılış qalığı', 'Начальное сальдо', 'Opening balance')} value={money(data.opening_balance)} tone="sky" />
            <Metric label={tx(lang, 'Son qalıq', 'Конечное сальдо', 'Closing balance')} value={money(data.closing_balance)} tone="violet" />
          </div>
          {data.entries.length === 0 ? <Empty>{tx(lang, 'Bu dövrdə hərəkət yoxdur.', 'Нет движений за период.', 'No movements in this period.')}</Empty> : (
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="min-w-[760px] w-full border-collapse bg-slate-950">
                <caption className="sr-only">{tx(lang, 'Hesab kartı', 'Карточка счёта', 'Account ledger')}</caption>
                <thead className="bg-slate-900 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Jurnal', 'Проводка', 'Journal')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Təsvir', 'Описание', 'Description')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Debet', 'Дебет', 'Debit')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Kredit', 'Кредит', 'Credit')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Qalıq', 'Сальдо', 'Balance')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data.entries.map((entry, index) => (
                    <tr key={`${entry.journal_id}-${index}`} className="hover:bg-slate-900/70">
                      <td className="px-3 py-2 text-sm text-slate-300 whitespace-nowrap">{entry.posting_date}</td>
                      <td className="px-3 py-2 text-sm">
                        <button type="button" className="font-mono font-bold text-yellow-200 hover:underline" onClick={() => openJournal(entry.journal_id)}>
                          {entry.journal_no || entry.journal_id.slice(0, 8)}
                        </button>
                        <div className="text-xs text-slate-500">{journalTypeLabel(lang, entry.journal_type)}</div>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-200">{entry.memo || entry.description}</td>
                      <td className={`${cell} text-sky-200`}>{isZero(entry.debit) ? '' : money(entry.debit)}</td>
                      <td className={`${cell} text-amber-200`}>{isZero(entry.credit) ? '' : money(entry.credit)}</td>
                      <td className={`${cell} text-white`}>{money(entry.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={btn.ghost} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LEDGER_PAGE))}>
              {tx(lang, 'Əvvəlki', 'Назад', 'Previous')}
            </button>
            <button type="button" className={btn.ghost} disabled={data.entries.length < LEDGER_PAGE} onClick={() => setOffset(offset + LEDGER_PAGE)}>
              {tx(lang, 'Növbəti', 'Далее', 'Next')}
            </button>
          </div>
        </>
      ) : null}
    </Card>
  );
}
