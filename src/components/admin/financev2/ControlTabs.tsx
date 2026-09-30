import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { tx } from '../../../i18n';
import { formatServerUtcDateTime } from '../../../lib/time';
import { glApi, type GLPeriod, type GLPeriodStatus, type TaxRegime } from '../../../api/gl';
import { useGL, useGLLoad } from './context';
import { Badge, Card, Dialog, Empty, Field, Loading, Metric, ReasonDialog, btn, errorText, inputCls, money, periodStatusLabel } from './FinanceV2Parts';

// ─────────────────────────────── periods ────────────────────────────────

const periodTone = (status: string) => (status === 'closed' ? 'rose' : status === 'soft_closed' ? 'amber' : 'emerald') as 'rose' | 'amber' | 'emerald';

function FiscalYearCard() {
  const { lang, caps, notify, bump, openJournal } = useGL();
  const [year, setYear] = React.useState(Number(caps.business_today.slice(0, 4)) - 1);
  const { data: s, loading, error } = useGLLoad(() => glApi.fiscalYear(year), [year]);
  const [busy, setBusy] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const years = Array.from({ length: 4 }, (_, i) => Number(caps.business_today.slice(0, 4)) - i);

  const blockerLabel = (b: string) => ({
    year_not_ended: tx(lang, 'İl hələ bitməyib', 'Год ещё не закончился', 'The year has not ended'),
    pending_journals: tx(lang, 'Təsdiq gözləyən jurnallar var', 'Есть проводки на утверждении', 'Journals are pending approval'),
    open_periods: tx(lang, 'Bütün aylar ən azı yumşaq bağlanmalıdır', 'Все месяцы должны быть хотя бы мягко закрыты', 'Every month must be at least soft-closed'),
    december_closed: tx(lang, 'Dekabr tam bağlıdır — yumşaq bağlıya keçirin', 'Декабрь закрыт — переведите в мягко закрытый', 'December is closed — set it to soft-closed'),
  }[b] || b);

  const close = async () => {
    setBusy(true);
    try {
      const journal = await glApi.closeFiscalYear(year);
      notify('success', tx(lang, `${year} ili bağlandı`, `${year} год закрыт`, `${year} closed`));
      setConfirmClose(false);
      bump();
      openJournal(journal.id);
    } catch (e) {
      notify('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={tx(lang, 'Maliyyə ilinin bağlanması', 'Закрытие финансового года', 'Fiscal year close')}
      subtitle={tx(lang,
        'Gəlir və xərc hesabları sıfırlanır, ilin nəticəsi 343-ə köçürülür. Bağlı ilə yazılış edilmir; yenidən açmaq ikinci şəxsin təsdiqi ilədir.',
        'Счета доходов и расходов обнуляются, результат года переносится на 343. В закрытый год проводить нельзя; переоткрытие — с утверждением второго лица.',
        'Revenue and expense accounts are zeroed and the result moves to 343. A closed year accepts no postings; reopening needs a second approver.')}
      actions={(
        <Field id="gl-fy-year" label={tx(lang, 'İl', 'Год', 'Year')}>
          <select id="gl-fy-year" className={inputCls} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
      )}
    >
      {loading && !s ? <Loading lang={lang} /> : null}
      {error ? <Empty>{error}</Empty> : null}
      {s ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Metric label={tx(lang, 'Status', 'Статус', 'Status')} value={s.closed ? tx(lang, 'Bağlı', 'Закрыт', 'Closed') : tx(lang, 'Açıq', 'Открыт', 'Open')} tone={s.closed ? 'violet' : 'sky'} />
            <Metric label={tx(lang, 'Köçürüləcək nəticə', 'Результат к переносу', 'Result to transfer')} value={s.closed ? '—' : money(s.net_result_to_close)} tone={s.net_result_to_close.startsWith('-') ? 'rose' : 'emerald'} />
            <Metric label={tx(lang, 'Hesab sayı', 'Счетов', 'Accounts')} value={s.closed ? '—' : String(s.accounts_to_close)} tone="amber" />
          </div>
          {s.closing_journal ? (
            <button type="button" className={btn.ghost} onClick={() => openJournal(s.closing_journal!.id)}>
              {tx(lang, 'Bağlanış jurnalı', 'Проводка закрытия', 'Closing journal')} {s.closing_journal.journal_no}
            </button>
          ) : null}
          {s.blockers.length ? (
            <ul className="space-y-1 text-sm text-amber-200">
              {s.blockers.map((b) => <li key={b}>• {blockerLabel(b)}</li>)}
            </ul>
          ) : null}
          {caps.can_control ? (
            <div className="flex flex-wrap justify-end gap-2">
              {!s.closed ? (
                <button type="button" className={btn.primary} disabled={!s.can_close || busy} onClick={() => setConfirmClose(true)}>
                  {tx(lang, `${year} ilini bağla`, `Закрыть ${year} год`, `Close ${year}`)}
                </button>
              ) : (
                <button type="button" className={btn.warn} disabled={busy} onClick={() => setAsking(true)}>
                  {tx(lang, 'Yenidən açmağı istə', 'Запросить переоткрытие', 'Request reopen')}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {confirmClose && s ? (
        <Dialog title={tx(lang, `${year} ilini bağla`, `Закрыть ${year} год`, `Close ${year}`)} onClose={() => setConfirmClose(false)} labelledBy="gl-fy-confirm">
          <p className="text-sm text-slate-300">
            {tx(lang,
              `${s.accounts_to_close} gəlir/xərc hesabı sıfırlanacaq və ${money(s.net_result_to_close)} 343-ə köçürüləcək. Bundan sonra ${year} ilinə yazılış edilməyəcək.`,
              `${s.accounts_to_close} счетов доходов/расходов будут обнулены, ${money(s.net_result_to_close)} перенесено на 343. Проводки в ${year} год станут невозможны.`,
              `${s.accounts_to_close} revenue/expense accounts will be zeroed and ${money(s.net_result_to_close)} moved to 343. No more postings into ${year}.`)}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={btn.ghost} onClick={() => setConfirmClose(false)}>{tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}</button>
            <button type="button" className={btn.primary} disabled={busy} onClick={() => void close()}>
              {busy ? tx(lang, 'Bağlanır...', 'Закрытие...', 'Closing...') : tx(lang, 'Təsdiqlə və bağla', 'Подтвердить и закрыть', 'Confirm and close')}
            </button>
          </div>
        </Dialog>
      ) : null}
      {asking ? (
        <ReasonDialog
          lang={lang}
          title={tx(lang, `${year} ilini yenidən aç`, `Переоткрыть ${year} год`, `Reopen ${year}`)}
          confirmLabel={tx(lang, 'Sorğu göndər', 'Отправить запрос', 'Send request')}
          onCancel={() => setAsking(false)}
          onConfirm={async (reason) => {
            try {
              await glApi.reopenFiscalYear(year, reason);
              notify('success', tx(lang, 'Storno təsdiq növbəsinə göndərildi', 'Сторно отправлено на утверждение', 'Reversal sent for approval'));
              setAsking(false);
              bump();
            } catch (e) {
              notify('error', errorText(e));
            }
          }}
        />
      ) : null}
    </Card>
  );
}

export function PeriodsTab() {
  return (
    <div className="space-y-4">
      <PeriodsCard />
      <FiscalYearCard />
    </div>
  );
}

function PeriodsCard() {
  const { lang, caps, notify, bump } = useGL();
  const { data, loading, error } = useGLLoad(() => glApi.periods(), []);
  const [pending, setPending] = React.useState<{ period: GLPeriod; status: GLPeriodStatus } | null>(null);
  const periods = [...(data || [])].sort((a, b) => (b.year - a.year) || (b.month - a.month));

  const actionLabel = (status: GLPeriodStatus) => ({
    open: tx(lang, 'Yenidən aç', 'Открыть заново', 'Reopen'),
    soft_closed: tx(lang, 'Yumşaq bağla', 'Мягко закрыть', 'Soft close'),
    closed: tx(lang, 'Bağla', 'Закрыть', 'Close'),
  }[status]);

  return (
    <Card
      title={tx(lang, 'Hesabat dövrləri', 'Отчётные периоды', 'Accounting periods')}
      subtitle={tx(lang,
        'Yumşaq bağlı dövrə yalnız nəzarətçilər yaza bilər. Bağlı dövrə heç kim yaza bilməz — düzəliş növbəti dövrdə edilir.',
        'В мягко закрытый период пишут только контролёры. В закрытый — никто; корректировки в следующем периоде.',
        'Only controllers can post to a soft-closed period. Nobody posts to a closed one — adjust in the next period.')}
    >
      {loading && !data ? <Loading lang={lang} /> : null}
      {error ? <Empty>{error}</Empty> : null}
      {data && periods.length === 0 ? <Empty>{tx(lang, 'Hələ dövr yoxdur.', 'Периодов пока нет.', 'No periods yet.')}</Empty> : null}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {periods.map((p) => (
          <li key={p.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-black text-white">{p.year}-{String(p.month).padStart(2, '0')}</div>
              <Badge tone={periodTone(p.status)}>{periodStatusLabel(lang, p.status)}</Badge>
            </div>
            {p.closed_by ? (
              <div className="mt-1 text-xs text-slate-500">{p.closed_by}{p.closed_at ? ` · ${formatServerUtcDateTime(p.closed_at, lang)}` : ''}</div>
            ) : null}
            {caps.can_control ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {(['open', 'soft_closed', 'closed'] as GLPeriodStatus[]).filter((s) => s !== p.status).map((s) => (
                  <button key={s} type="button" className={s === 'closed' ? btn.danger : s === 'open' ? btn.warn : btn.ghost} onClick={() => setPending({ period: p, status: s })}>
                    {actionLabel(s)}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {pending ? (
        <ReasonDialog
          lang={lang}
          title={`${actionLabel(pending.status)} · ${pending.period.year}-${String(pending.period.month).padStart(2, '0')}`}
          confirmLabel={actionLabel(pending.status)}
          optional={pending.status !== 'open'}
          onCancel={() => setPending(null)}
          onConfirm={async (reason) => {
            const { period, status } = pending;
            try {
              await glApi.setPeriodStatus(period.year, period.month, status, reason);
              notify('success', tx(lang, 'Dövrün statusu dəyişdi', 'Статус периода изменён', 'Period status changed'));
              setPending(null);
              bump();
            } catch (e) {
              notify('error', errorText(e));
            }
          }}
        />
      ) : null}
    </Card>
  );
}

// ─────────────────────────────── tax ────────────────────────────────────

export function TaxTab() {
  const { lang, caps, notify, bump } = useGL();
  const today = caps.business_today;
  const [year, setYear] = React.useState(Number(today.slice(0, 4)));
  const [month, setMonth] = React.useState(Number(today.slice(5, 7)));
  const profile = useGLLoad(() => glApi.taxProfile(), []);
  const summary = useGLLoad(() => glApi.taxSummary(year, month), [year, month]);

  const [regime, setRegime] = React.useState<TaxRegime>('simplified');
  const [rate, setRate] = React.useState('2');
  const [vatRate, setVatRate] = React.useState('18');
  const [inclVat, setInclVat] = React.useState(true);
  // Regime changes always start on the 1st of a month (backend rule), so the input is a month picker.
  const [effective, setEffective] = React.useState(today.slice(0, 7));
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [accruing, setAccruing] = React.useState(false);

  React.useEffect(() => {
    const p = profile.data;
    if (!p || !p.configured) return;
    setRegime(p.regime);
    if (p.regime === 'simplified') setRate(String(Number(p.simplified_rate)));
    if (p.regime === 'vat') {
      setVatRate(String(Number(p.vat_rate)));
      setInclVat(p.prices_include_vat);
    }
  }, [profile.data]);

  const save = async () => {
    setSaving(true);
    try {
      await glApi.setTaxProfile({
        regime,
        effective_from: `${effective}-01`,
        simplified_rate: regime === 'simplified' ? rate : undefined,
        vat_rate: regime === 'vat' ? vatRate : undefined,
        prices_include_vat: inclVat,
        note: note.trim() || undefined,
      });
      notify('success', tx(lang, 'Vergi rejimi yadda saxlanıldı', 'Налоговый режим сохранён', 'Tax regime saved'));
      bump();
    } catch (e) {
      notify('error', errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const accrue = async () => {
    setAccruing(true);
    try {
      await glApi.accrueSimplifiedTax(year, month);
      notify('success', tx(lang, 'Vergi hesablandı', 'Налог начислен', 'Tax accrued'));
      bump();
    } catch (e) {
      notify('error', errorText(e));
    } finally {
      setAccruing(false);
    }
  };

  const regimeLabel = (r: string) => ({
    simplified: tx(lang, 'Sadələşdirilmiş vergi', 'Упрощённый налог', 'Simplified tax'),
    vat: tx(lang, 'ƏDV', 'НДС', 'VAT'),
    exempt: tx(lang, 'Azad / təyin edilməyib', 'Освобождён / не задан', 'Exempt / not set'),
  }[r] || r);

  const p = profile.data;
  const s = summary.data;
  const years = Array.from({ length: 4 }, (_, i) => Number(today.slice(0, 4)) - i);

  return (
    <div className="space-y-4">
      <Card
        title={tx(lang, 'Vergi rejimi', 'Налоговый режим', 'Tax regime')}
        subtitle={p?.configured
          ? `${regimeLabel(p.regime)}${p.regime === 'simplified' ? ` · ${Number(p.simplified_rate)}%` : p.regime === 'vat' ? ` · ${Number(p.vat_rate)}%` : ''} · ${tx(lang, 'qüvvədədir', 'действует с', 'effective')} ${p.effective_from}`
          : tx(lang, 'Vergi rejimi hələ seçilməyib.', 'Налоговый режим ещё не выбран.', 'No tax regime chosen yet.')}
      >
        {profile.loading && !p ? <Loading lang={lang} /> : null}
        {profile.error ? <Empty>{profile.error}</Empty> : null}
        {caps.can_control ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field id="gl-tax-regime" label={tx(lang, 'Rejim', 'Режим', 'Regime')}>
              <select id="gl-tax-regime" className={inputCls} value={regime} onChange={(e) => setRegime(e.target.value as TaxRegime)}>
                {(['simplified', 'vat', 'exempt'] as TaxRegime[]).map((r) => <option key={r} value={r}>{regimeLabel(r)}</option>)}
              </select>
            </Field>
            {regime === 'simplified' ? (
              <Field id="gl-tax-rate" label={tx(lang, 'Dərəcə', 'Ставка', 'Rate')}>
                <select id="gl-tax-rate" className={inputCls} value={rate} onChange={(e) => setRate(e.target.value)}>
                  {Array.from(new Set(['2', '5', rate])).map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
              </Field>
            ) : null}
            {regime === 'vat' ? (
              <>
                <Field id="gl-tax-vat" label={tx(lang, 'ƏDV dərəcəsi (%)', 'Ставка НДС (%)', 'VAT rate (%)')}>
                  <input id="gl-tax-vat" inputMode="decimal" className={inputCls} value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
                </Field>
                <label className="flex min-h-11 items-center gap-2 self-end text-sm font-bold text-slate-300">
                  <input type="checkbox" checked={inclVat} onChange={(e) => setInclVat(e.target.checked)} />
                  {tx(lang, 'Qiymətlərə ƏDV daxildir', 'Цены включают НДС', 'Prices include VAT')}
                </label>
              </>
            ) : null}
            <Field id="gl-tax-from" label={tx(lang, 'Qüvvəyə minir (ayın 1-i)', 'Действует с (1-го числа)', 'Effective from (1st of month)')}>
              <input id="gl-tax-from" type="month" className={inputCls} value={effective} onChange={(e) => setEffective(e.target.value)} />
            </Field>
            <Field id="gl-tax-note" label={tx(lang, 'Qeyd', 'Примечание', 'Note')}>
              <input id="gl-tax-note" className={inputCls} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <button type="button" className={btn.primary} disabled={saving || !effective} onClick={() => void save()}>
                {saving ? tx(lang, 'Saxlanılır...', 'Сохранение...', 'Saving...') : tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card
        title={tx(lang, 'Aylıq vergi', 'Налог за месяц', 'Monthly tax')}
        actions={(
          <>
            <Field id="gl-tax-y" label={tx(lang, 'İl', 'Год', 'Year')}>
              <select id="gl-tax-y" className={inputCls} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <Field id="gl-tax-m" label={tx(lang, 'Ay', 'Месяц', 'Month')}>
              <select id="gl-tax-m" className={inputCls} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
              </select>
            </Field>
          </>
        )}
      >
        {summary.loading && !s ? <Loading lang={lang} /> : null}
        {summary.error ? <Empty>{summary.error}</Empty> : null}
        {s && s.profile.regime === 'simplified' ? (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Metric label={tx(lang, 'Vergi bazası', 'База', 'Tax base')} value={money(s.base)} tone="sky" />
              <Metric label={tx(lang, 'Ödəniləcək vergi', 'Налог к уплате', 'Tax due')} value={money(s.tax_due)} tone="amber" />
              <Metric label={tx(lang, 'Hesablanıb', 'Начислено', 'Accrued')} value={money(s.accrued)} tone="violet" />
              <Metric label={tx(lang, 'Vəziyyət', 'Статус', 'Status')} value={s.up_to_date ? tx(lang, 'Aktualdır', 'Актуально', 'Up to date') : tx(lang, 'Hesablanmalıdır', 'Требует начисления', 'Needs accrual')} tone={s.up_to_date ? 'emerald' : 'rose'} />
            </div>
            {caps.can_control && !s.up_to_date ? (
              <div className="mt-3 flex justify-end">
                <button type="button" className={btn.primary} disabled={accruing} onClick={() => void accrue()}>
                  {accruing ? tx(lang, 'Hesablanır...', 'Начисление...', 'Accruing...') : tx(lang, 'Vergini hesabla', 'Начислить налог', 'Accrue tax')}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        {s && s.profile.regime === 'vat' ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Metric label={tx(lang, 'Satış ƏDV-si', 'НДС с продаж', 'Output VAT')} value={money(s.output_vat)} tone="amber" />
            <Metric label={tx(lang, 'Alış ƏDV-si', 'Входящий НДС', 'Input VAT')} value={money(s.input_vat)} tone="sky" />
            <Metric label={tx(lang, 'Ödəniləcək ƏDV', 'НДС к уплате', 'VAT payable')} value={money(s.vat_payable)} tone="violet" />
          </div>
        ) : null}
        {s && s.profile.regime === 'exempt' ? (
          <Empty>{tx(lang, 'Bu dövr üçün vergi rejimi təyin edilməyib.', 'Для периода налоговый режим не задан.', 'No tax regime applies to this period.')}</Empty>
        ) : null}
      </Card>
    </div>
  );
}

// ─────────────────────────────── integrity ──────────────────────────────

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-4 ${ok ? 'border-emerald-400/25 bg-emerald-950/30 text-emerald-100' : 'border-rose-400/25 bg-rose-950/30 text-rose-100'}`}>
      {ok ? <CheckCircle2 size={20} aria-hidden="true" /> : <XCircle size={20} aria-hidden="true" />}
      <span className="font-black">{label}</span>
      <span className="sr-only">{ok ? 'OK' : 'FAIL'}</span>
    </div>
  );
}

export function IntegrityTab() {
  const { lang } = useGL();
  const integrity = useGLLoad(() => glApi.integrity(), []);
  const shadow = useGLLoad(() => glApi.shadowStatus(), []);
  const i = integrity.data;
  const sh = shadow.data;
  return (
    <div className="space-y-4">
      <Card
        title={tx(lang, 'Bütövlük yoxlaması', 'Проверка целостности', 'Integrity check')}
        subtitle={tx(lang, 'Audit zənciri (hash), hesab qalıqları və sınaq balansı.', 'Цепочка аудита (hash), остатки счетов и ОСВ.', 'Audit hash chain, account balances and trial balance.')}
        actions={<button type="button" className={btn.ghost} onClick={() => { integrity.reload(); shadow.reload(); }}>{tx(lang, 'Yenidən yoxla', 'Проверить снова', 'Re-check')}</button>}
      >
        {integrity.loading && !i ? <Loading lang={lang} /> : null}
        {integrity.error ? <Empty>{integrity.error}</Empty> : null}
        {i ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Check ok={Boolean(i.audit_chain?.valid)} label={tx(lang, 'Audit zənciri', 'Цепочка аудита', 'Audit chain')} />
            <Check ok={Boolean(i.balances?.valid)} label={tx(lang, 'Hesab qalıqları', 'Остатки счетов', 'Account balances')} />
            <Check ok={i.trial_balance_balanced} label={tx(lang, 'Sınaq balansı', 'ОСВ', 'Trial balance')} />
          </div>
        ) : null}
      </Card>

      <Card
        title={tx(lang, 'Köhnə sistemlə uzlaşma', 'Сверка со старой системой', 'Legacy reconciliation')}
        subtitle={tx(lang, 'Keçid dövründə köhnə maliyyə ilə yeni baş kitab hər gecə müqayisə olunur.', 'Во время перехода старый учёт и новая книга сверяются каждую ночь.', 'During the transition the legacy ledger and the GL are compared every night.')}
      >
        {shadow.loading && !sh ? <Loading lang={lang} /> : null}
        {shadow.error ? <Empty>{shadow.error}</Empty> : null}
        {sh ? (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Metric label={tx(lang, 'Ardıcıl təmiz gecə', 'Чистых ночей подряд', 'Clean nights in a row')} value={String(sh.clean_reconciliation_streak)} tone={sh.clean_reconciliation_streak > 0 ? 'emerald' : 'amber'} />
              <Metric label={tx(lang, 'Son sinxron', 'Последняя синхронизация', 'Last sync')} value={sh.last_sync ? formatServerUtcDateTime(sh.last_sync.at, lang) : '—'} tone="sky" />
              <Metric label={tx(lang, 'Kölgə rejimi', 'Теневой режим', 'Shadow mode')} value={sh.enabled ? tx(lang, 'Aktiv', 'Активен', 'On') : tx(lang, 'Söndürülüb', 'Выключен', 'Off')} tone={sh.enabled ? 'emerald' : 'amber'} />
            </div>
            <ul className="mt-3 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-950">
              {sh.runs.filter((r) => r.type === 'reconcile' || !r.ok || r.imported > 0).slice(0, 15).map((r, index) => (
                <li key={`${r.started_at}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="text-slate-300">{formatServerUtcDateTime(r.started_at, lang)}</span>
                  <span className="text-slate-400">{r.type === 'reconcile' ? tx(lang, 'Uzlaşma', 'Сверка', 'Reconcile') : tx(lang, 'Sinxron', 'Синхронизация', 'Sync')}{r.imported ? ` · ${r.imported}` : ''}</span>
                  <Badge tone={r.ok ? 'emerald' : 'rose'}>{r.ok ? 'OK' : (r.error || 'FAIL').slice(0, 60)}</Badge>
                </li>
              ))}
              {sh.runs.length === 0 ? <li className="px-4 py-3 text-sm text-slate-500">{tx(lang, 'Hələ yoxlama olmayıb.', 'Проверок ещё не было.', 'No runs yet.')}</li> : null}
            </ul>
          </>
        ) : null}
      </Card>
    </div>
  );
}
