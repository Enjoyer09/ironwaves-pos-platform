import React from 'react';
import { tx } from '../../../i18n';
import { glApi, type AgingBasis, type AgingBucket } from '../../../api/gl';
import { useGL, useGLLoad } from './context';
import { Badge, Card, Empty, ExportButtons, Field, Loading, Metric, inputCls, isZero, money } from './FinanceV2Parts';
import { agingBasisLabel, subledgerReport } from './reportExports';

const BUCKETS: AgingBucket[] = ['current', '0_30', '31_60', '61_90', '90_plus'];
const BASIS_TONE: Record<AgingBasis, 'sky' | 'slate' | 'violet'> = { due_date: 'sky', posting_date: 'slate', mixed: 'violet' };

export function PartnersTab() {
  const { lang, caps, notify, openLedger } = useGL();
  const [ledger, setLedger] = React.useState<'ap' | 'ar'>('ap');
  const [asOf, setAsOf] = React.useState(caps.business_today);
  const { data, loading, error } = useGLLoad(() => glApi.subledger(ledger, asOf), [ledger, asOf]);

  const bucketLabel = (b: AgingBucket) => ({
    current: tx(lang, 'Vaxtı çatmayıb', 'Срок не наступил', 'Not yet due'),
    '0_30': tx(lang, '0–30 gün', '0–30 дн.', '0–30 days'),
    '31_60': tx(lang, '31–60 gün', '31–60 дн.', '31–60 days'),
    '61_90': tx(lang, '61–90 gün', '61–90 дн.', '61–90 days'),
    '90_plus': tx(lang, '90+ gün', '90+ дн.', '90+ days'),
  }[b]);
  const partnerLabel = (type: string | null, name: string | null) => {
    if (!name) return tx(lang, 'Tərəf göstərilməyib', 'Контрагент не указан', 'No partner assigned');
    const kind = type === 'supplier' ? tx(lang, 'Təchizatçı', 'Поставщик', 'Supplier')
      : type === 'employee' ? tx(lang, 'İşçi', 'Сотрудник', 'Employee')
        : type === 'counterparty' ? tx(lang, 'Qarşı tərəf', 'Контрагент', 'Counterparty') : type || '';
    return { name, kind };
  };

  return (
    <Card
      title={ledger === 'ap' ? tx(lang, 'Kreditor borcları (təchizatçılar)', 'Кредиторская задолженность', 'Accounts payable') : tx(lang, 'Debitor borcları', 'Дебиторская задолженность', 'Accounts receivable')}
      subtitle={tx(lang,
        'Baş kitabdan hesablanır. Fakturası olan təchizatçılar açıq fakturaların son ödəniş tarixinə görə yaşlanır ("Vaxtı çatmayıb" = hələ vaxtı keçməyib); fakturasız qalıq yazılış tarixinə görə, ödənişlər ən köhnə borcu bağlayır (FIFO).',
        'Считается из главной книги. Поставщики со счетами стареют по сроку оплаты открытых счетов («Срок не наступил» = ещё не просрочено); остаток без счетов — по дате проводки, оплаты закрывают самый старый долг (FIFO).',
        'Derived from the GL. Suppliers with bills are aged by the open bills\' due date ("Not yet due" = not overdue yet); any balance without bills is aged by posting date, payments settling the oldest items first (FIFO).')}
      actions={(
        <>
          <div role="radiogroup" aria-label={tx(lang, 'Borc növü', 'Тип задолженности', 'Ledger')} className="flex gap-1 rounded-2xl border border-slate-800 bg-slate-950 p-1">
            {(['ap', 'ar'] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={ledger === l}
                onClick={() => setLedger(l)}
                className={`min-h-10 rounded-xl px-4 text-sm font-black ${ledger === l ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'}`}
              >
                {l === 'ap' ? tx(lang, 'Kreditor', 'Кредиторы', 'Payables') : tx(lang, 'Debitor', 'Дебиторы', 'Receivables')}
              </button>
            ))}
          </div>
          <Field id="gl-sl-asof" label={tx(lang, 'Tarixə', 'На дату', 'As of')}>
            <input id="gl-sl-asof" type="date" className={inputCls} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <ExportButtons
            lang={lang}
            onBlocked={() => notify('warning', tx(lang, 'Brauzer pəncərəni blokladı — pop-up icazəsi verin', 'Браузер заблокировал окно — разрешите pop-up', 'The browser blocked the window — allow pop-ups'))}
            build={() => (data ? subledgerReport(lang, data) : null)}
          />
        </>
      )}
    >
      {loading && !data ? <Loading lang={lang} /> : null}
      {error ? <Empty>{error}</Empty> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Metric label={tx(lang, 'Cəmi borc', 'Итого долг', 'Total balance')} value={money(data.totals.balance)} tone="violet" />
            {BUCKETS.map((b) => (
              <Metric key={b} label={bucketLabel(b)} value={money(data.totals[b])} tone={b === '90_plus' && !isZero(data.totals[b]) ? 'rose' : b === '61_90' && !isZero(data.totals[b]) ? 'amber' : 'sky'} />
            ))}
            <Metric label={tx(lang, 'Avans / artıq ödəniş', 'Аванс / переплата', 'Advances')} value={money(data.totals.advance)} tone="emerald" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            {data.reconciled
              ? <Badge tone="emerald">{tx(lang, 'Nəzarət hesabı ilə uyğundur', 'Сходится с контрольным счётом', 'Matches control account')}</Badge>
              : <Badge tone="rose">{tx(lang, 'Nəzarət hesabı ilə fərq var', 'Расхождение с контрольным счётом', 'Differs from control account')}</Badge>}
            {data.control_accounts.map((a) => (
              <button key={a.id} type="button" className="font-mono text-yellow-200 hover:underline" onClick={() => openLedger(a.id)}>
                {a.code} · {money(data.control_balance)}
              </button>
            ))}
            {!isZero(data.unassigned_balance) ? (
              <Badge tone="amber">{tx(lang, 'Tərəfsiz qalıq', 'Без контрагента', 'Unassigned')}: {money(data.unassigned_balance)}</Badge>
            ) : null}
          </div>

          {data.partners.length === 0 ? (
            <div className="mt-3"><Empty>{tx(lang, 'Açıq borc yoxdur.', 'Открытой задолженности нет.', 'No open balances.')}</Empty></div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-800">
              <table className="min-w-[1080px] w-full border-collapse bg-slate-950">
                <caption className="sr-only">{tx(lang, 'Tərəflər üzrə borclar', 'Задолженность по контрагентам', 'Balances by partner')}</caption>
                <thead className="bg-slate-900 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Tərəf', 'Контрагент', 'Partner')}</th>
                    {BUCKETS.map((b) => <th key={b} scope="col" className="px-3 py-2 text-right">{bucketLabel(b)}</th>)}
                    <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Avans', 'Аванс', 'Advance')}</th>
                    <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Qalıq', 'Сальдо', 'Balance')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Yaş əsası', 'Основа возраста', 'Aging basis')}</th>
                    <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Ən köhnə', 'Старейший', 'Oldest')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {data.partners.map((p) => {
                    const label = partnerLabel(p.partner_type, p.name);
                    return (
                      <tr key={`${p.partner_type}:${p.partner_id}`} className="hover:bg-slate-900/70">
                        <th scope="row" className="px-3 py-2 text-left text-sm font-bold text-slate-100">
                          {typeof label === 'string'
                            ? <span className="text-amber-200">{label}</span>
                            : <>{label.name}<div className="text-xs font-normal text-slate-500">{label.kind}</div></>}
                        </th>
                        {BUCKETS.map((b) => (
                          <td key={b} className={`px-3 py-2 text-right font-mono text-sm whitespace-nowrap ${b === '90_plus' && !isZero(p.buckets[b]) ? 'text-rose-200' : 'text-slate-200'}`}>
                            {isZero(p.buckets[b]) ? '' : money(p.buckets[b])}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-mono text-sm text-emerald-200 whitespace-nowrap">{isZero(p.advance) ? '' : money(p.advance)}</td>
                        <td className="px-3 py-2 text-right font-mono text-sm font-black text-white whitespace-nowrap">{money(p.balance)}</td>
                        <td className="px-3 py-2 text-left whitespace-nowrap">
                          <Badge tone={BASIS_TONE[p.aging_basis] || 'slate'}>{agingBasisLabel(lang, p.aging_basis)}</Badge>
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-400 whitespace-nowrap">{p.oldest_open_date || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </Card>
  );
}
