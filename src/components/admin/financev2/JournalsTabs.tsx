import React from 'react';
import { Decimal } from 'decimal.js';
import { Plus, Trash2 } from 'lucide-react';
import { tx } from '../../../i18n';
import { formatServerUtcDateTime } from '../../../lib/time';
import { glApi, type GLJournal, type GLJournalInput } from '../../../api/gl';
import { useGL, useGLLoad } from './context';
import {
  Badge, Card, DateRange, Dialog, Empty, Field, JournalSourceText, JournalStatusBadge, Loading, ReasonDialog,
  btn, errorText, inputCls, isZero, journalStatusLabel, journalTypeLabel, money,
} from './FinanceV2Parts';
import { newIdempotencyKey as newKey } from './billsMath';

const PAGE = 50;

// ─────────────────────────────── list ───────────────────────────────────

function JournalTable({ items, onOpen }: { items: GLJournal[]; onOpen: (id: string) => void }) {
  const { lang } = useGL();
  if (items.length === 0) return <Empty>{tx(lang, 'Jurnal yazılışı tapılmadı.', 'Проводки не найдены.', 'No journals found.')}</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800">
      <table className="min-w-[820px] w-full border-collapse bg-slate-950">
        <caption className="sr-only">{tx(lang, 'Jurnal yazılışları', 'Журнальные проводки', 'Journal entries')}</caption>
        <thead className="bg-slate-900 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
          <tr>
            <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Nömrə', 'Номер', 'Number')}</th>
            <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
            <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Növ', 'Тип', 'Type')}</th>
            <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Təsvir', 'Описание', 'Description')}</th>
            <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Mənbə', 'Источник', 'Source')}</th>
            <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Məbləğ', 'Сумма', 'Amount')}</th>
            <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Status', 'Статус', 'Status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {items.map((j) => (
            <tr key={j.id} className="hover:bg-slate-900/70">
              <td className="px-3 py-2 text-sm">
                <button type="button" onClick={() => onOpen(j.id)} className="font-mono font-bold text-yellow-200 hover:underline">
                  {j.journal_no || j.id.slice(0, 8)}
                </button>
              </td>
              <td className="px-3 py-2 text-sm text-slate-300 whitespace-nowrap">{j.posting_date}</td>
              <td className="px-3 py-2 text-sm text-slate-300">{journalTypeLabel(lang, j.journal_type)}</td>
              <td className="max-w-[340px] truncate px-3 py-2 text-sm text-slate-100" title={j.description}>{j.description}</td>
              <td className="px-3 py-2 text-sm"><JournalSourceText lang={lang} journal={j} /></td>
              <td className="px-3 py-2 text-right font-mono text-sm text-white whitespace-nowrap">{money(j.total)}</td>
              <td className="px-3 py-2 text-sm">
                <div className="flex flex-wrap gap-1">
                  <JournalStatusBadge lang={lang} status={j.status} />
                  {j.reversed_by_id ? <Badge tone="rose">{tx(lang, 'Storno edilib', 'Сторнировано', 'Reversed')}</Badge> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({ total, offset, setOffset }: { total: number; offset: number; setOffset: (v: number) => void }) {
  const { lang } = useGL();
  const end = Math.min(total, offset + PAGE);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
      <span>{total === 0 ? '0' : `${offset + 1}–${end}`} / {total}</span>
      <div className="flex gap-2">
        <button type="button" className={btn.ghost} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{tx(lang, 'Əvvəlki', 'Назад', 'Previous')}</button>
        <button type="button" className={btn.ghost} disabled={end >= total} onClick={() => setOffset(offset + PAGE)}>{tx(lang, 'Növbəti', 'Далее', 'Next')}</button>
      </div>
    </div>
  );
}

export function JournalsTab({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const { lang, caps, openJournal } = useGL();
  const [status, setStatus] = React.useState('');
  const [type, setType] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [creating, setCreating] = React.useState(false);
  React.useEffect(() => { setOffset(0); }, [status, type, from, to]);
  const { data, loading, error } = useGLLoad(
    () => glApi.journals({ status, journal_type: type, date_from: from, date_to: to, limit: PAGE, offset }),
    [status, type, from, to, offset],
  );
  const types = ['sales', 'purchase', 'cash', 'bank', 'general', 'adjustment', 'tax', 'opening', 'closing', 'reversal', 'migration'];
  return (
    <Card
      title={tx(lang, 'Jurnal yazılışları', 'Журнальные проводки', 'Journal entries')}
      subtitle={tx(lang, 'Bütün mühasibat yazılışları. Yazılmış jurnal dəyişdirilmir — yalnız storno.', 'Все проводки. Проведённое не меняется — только сторно.', 'Every entry. Posted journals are immutable — reverse instead.')}
      actions={caps.can_write ? (
        <button type="button" className={btn.primary} onClick={() => setCreating(true)}>
          <span className="inline-flex items-center gap-2"><Plus size={16} />{tx(lang, 'Yeni yazılış', 'Новая проводка', 'New journal')}</span>
        </button>
      ) : null}
    >
      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_2fr]">
        <Field id="gl-j-status" label={tx(lang, 'Status', 'Статус', 'Status')}>
          <select id="gl-j-status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{tx(lang, 'Hamısı', 'Все', 'All')}</option>
            {['posted', 'pending_approval', 'rejected', 'draft'].map((s) => <option key={s} value={s}>{journalStatusLabel(lang, s)}</option>)}
          </select>
        </Field>
        <Field id="gl-j-type" label={tx(lang, 'Növ', 'Тип', 'Type')}>
          <select id="gl-j-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{tx(lang, 'Hamısı', 'Все', 'All')}</option>
            {types.map((t) => <option key={t} value={t}>{journalTypeLabel(lang, t)}</option>)}
          </select>
        </Field>
        <DateRange lang={lang} idPrefix="gl-j" from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>
      {loading && !data ? <Loading lang={lang} /> : null}
      {error ? <Empty>{error}</Empty> : null}
      {data ? (
        <>
          <JournalTable items={data.items} onOpen={openJournal} />
          <Pager total={data.total} offset={offset} setOffset={setOffset} />
        </>
      ) : null}
      {creating ? <NewJournalDialog onClose={() => setCreating(false)} /> : null}
    </Card>
  );
}

export function ApprovalsTab() {
  const { lang, caps, openJournal } = useGL();
  const [offset, setOffset] = React.useState(0);
  const { data, loading, error } = useGLLoad(() => glApi.journals({ status: 'pending_approval', limit: PAGE, offset }), [offset]);
  return (
    <Card
      title={tx(lang, 'Təsdiq növbəsi', 'Очередь утверждения', 'Approval queue')}
      subtitle={caps.can_approve
        ? tx(lang, 'Yazılışı açın, yoxlayın və təsdiqləyin. Öz yaratdığınızı təsdiqləyə bilməzsiniz.', 'Откройте, проверьте и утвердите. Свою проводку утвердить нельзя.', 'Open, review and approve. You cannot approve your own journal.')
        : tx(lang, 'Təsdiq üçün admin və ya maliyyə admini lazımdır.', 'Утверждает админ или финансовый админ.', 'An admin or finance admin approves these.')}
    >
      {loading && !data ? <Loading lang={lang} /> : null}
      {error ? <Empty>{error}</Empty> : null}
      {data ? (
        <>
          <JournalTable items={data.items} onOpen={openJournal} />
          <Pager total={data.total} offset={offset} setOffset={setOffset} />
        </>
      ) : null}
    </Card>
  );
}

// ─────────────────────────────── detail drawer ──────────────────────────

export function JournalDrawer({ journalId, onClose }: { journalId: string; onClose: () => void }) {
  const { lang, caps, notify, bump, openJournal, openLedger } = useGL();
  const { data: j, loading, error } = useGLLoad(() => glApi.journal(journalId), [journalId]);
  const [busy, setBusy] = React.useState(false);
  const [asking, setAsking] = React.useState<'reject' | 'reverse' | null>(null);

  const act = async (fn: () => Promise<GLJournal>, success: string) => {
    setBusy(true);
    try {
      const result = await fn();
      notify('success', success);
      bump();
      if (result?.id && result.id !== journalId) openJournal(result.id);
    } catch (e) {
      notify('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Only journals created in the GL itself can be reversed here; operational ones (sales, stock, shifts,
  // mirrored legacy) are corrected in their own module, and year-end closing via "reopen year".
  // Bill and bill-payment journals are GL-only but belong to the bill: void / reverse payment in Bills (409 document_managed).
  const documentOwned = Boolean(j && (j.source_type === 'document' || j.source_type === 'document_payment'));
  const glOwned = Boolean(j && (j.source_module === 'manual' || j.source_module === 'gl') && j.source_type !== 'year_close' && !documentOwned);
  const canReverse = Boolean(j && glOwned && caps.can_write && j.status === 'posted' && !j.reversed_by_id && j.journal_type !== 'reversal');
  const pending = j?.status === 'pending_approval';

  return (
    <Dialog title={j ? `${tx(lang, 'Jurnal', 'Проводка', 'Journal')} ${j.journal_no || ''}` : tx(lang, 'Jurnal', 'Проводка', 'Journal')} onClose={onClose} wide labelledBy="gl-journal-title">
      {loading && !j ? <Loading lang={lang} /> : null}
      {error ? <Empty>{error}</Empty> : null}
      {j ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <JournalStatusBadge lang={lang} status={j.status} />
            <Badge tone="slate">{journalTypeLabel(lang, j.journal_type)}</Badge>
            {j.reversed_by_id ? (
              <button type="button" onClick={() => openJournal(j.reversed_by_id as string)}><Badge tone="rose">{tx(lang, 'Storno jurnalına bax', 'Открыть сторно', 'Open reversal')}</Badge></button>
            ) : null}
            {j.reversal_of_id ? (
              <button type="button" onClick={() => openJournal(j.reversal_of_id as string)}><Badge tone="amber">{tx(lang, 'Əsas jurnala bax', 'Открыть исходную', 'Open original')}</Badge></button>
            ) : null}
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-base font-bold text-white">{j.description}</div>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{tx(lang, 'Tarix', 'Дата', 'Posting date')}</dt><dd className="text-slate-200">{j.posting_date}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{tx(lang, 'Məbləğ', 'Сумма', 'Amount')}</dt><dd className="font-mono text-white">{money(j.total)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{tx(lang, 'Yaradan', 'Создал', 'Created by')}</dt><dd className="text-slate-200">{j.created_by || '—'}{j.created_at ? ` · ${formatServerUtcDateTime(j.created_at, lang)}` : ''}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{tx(lang, 'Təsdiqləyən', 'Утвердил', 'Approved by')}</dt><dd className="text-slate-200">{j.approved_by || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{tx(lang, 'Yazan', 'Провёл', 'Posted by')}</dt><dd className="text-slate-200">{j.posted_by || '—'}{j.posted_at ? ` · ${formatServerUtcDateTime(j.posted_at, lang)}` : ''}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{tx(lang, 'Mənbə', 'Источник', 'Source')}</dt><dd><JournalSourceText lang={lang} journal={j} /></dd></div>
              {j.rejected_by ? (
                <div className="flex justify-between gap-3 md:col-span-2"><dt className="text-slate-500">{tx(lang, 'Rədd edən', 'Отклонил', 'Rejected by')}</dt><dd className="text-rose-200">{j.rejected_by}: {j.reject_reason}</dd></div>
              ) : null}
            </dl>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-800">
            <table className="min-w-[600px] w-full border-collapse bg-slate-950">
              <caption className="sr-only">{tx(lang, 'Yazılış sətirləri', 'Строки проводки', 'Journal lines')}</caption>
              <thead className="bg-slate-900 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Hesab', 'Счёт', 'Account')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Qeyd', 'Примечание', 'Memo')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Debet', 'Дебет', 'Debit')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Kredit', 'Кредит', 'Credit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(j.lines || []).map((line) => (
                  <tr key={line.line_no}>
                    <td className="px-3 py-2 text-sm">
                      <button type="button" className="text-left text-slate-100 hover:text-yellow-200" onClick={() => { onClose(); openLedger(line.account_id); }}>
                        <span className="mr-2 font-mono text-slate-500">{line.account_code}</span>{line.account_name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-sm text-slate-400">{line.memo || ''}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm text-sky-200">{isZero(line.debit) ? '' : money(line.debit)}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm text-amber-200">{isZero(line.credit) ? '' : money(line.credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {documentOwned && j.status === 'posted' && !j.reversed_by_id && j.journal_type !== 'reversal' ? (
            <p className="text-xs text-slate-400">
              {tx(
                lang,
                'Bu yazılış alış fakturasına aiddir. Fakturalar bölməsində fakturanı ləğv edin və ya ödənişi geri qaytarın.',
                'Эта проводка принадлежит счёту поставщика. Аннулируйте счёт или сторнируйте оплату во вкладке «Счета».',
                'This journal belongs to a supplier bill. Void the bill or reverse the payment in the Bills tab.',
              )}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            {pending && caps.can_approve ? (
              <>
                <button type="button" className={btn.danger} disabled={busy} onClick={() => setAsking('reject')}>{tx(lang, 'Rədd et', 'Отклонить', 'Reject')}</button>
                <button type="button" className={btn.approve} disabled={busy} onClick={() => void act(() => glApi.approve(j.id), tx(lang, 'Təsdiqləndi və yazıldı', 'Утверждено и проведено', 'Approved and posted'))}>
                  {tx(lang, 'Təsdiqlə və yaz', 'Утвердить и провести', 'Approve and post')}
                </button>
              </>
            ) : null}
            {canReverse ? (
              <button type="button" className={btn.warn} disabled={busy} onClick={() => setAsking('reverse')}>{tx(lang, 'Storno et', 'Сторнировать', 'Reverse')}</button>
            ) : null}
          </div>
        </div>
      ) : null}
      {asking && j ? (
        <ReasonDialog
          lang={lang}
          title={asking === 'reject' ? tx(lang, 'Yazılışı rədd et', 'Отклонить проводку', 'Reject journal') : tx(lang, 'Storno sorğusu', 'Запрос сторно', 'Request reversal')}
          confirmLabel={asking === 'reject' ? tx(lang, 'Rədd et', 'Отклонить', 'Reject') : tx(lang, 'Storno et', 'Сторнировать', 'Reverse')}
          onCancel={() => setAsking(null)}
          onConfirm={async (reason) => {
            const mode = asking;
            setAsking(null);
            if (mode === 'reject') await act(() => glApi.reject(j.id, reason), tx(lang, 'Rədd edildi', 'Отклонено', 'Rejected'));
            else await act(() => glApi.reverse(j.id, reason), tx(lang, 'Storno yaradıldı (ikinci şəxsin təsdiqi lazımdır)', 'Сторно создано (нужно утверждение второго лица)', 'Reversal created (needs a second approver)'));
          }}
        />
      ) : null}
    </Dialog>
  );
}

// ─────────────────────────────── new manual journal ────────────────────

type DraftLine = { key: string; account: string; debit: string; credit: string; memo: string };

const emptyLine = (): DraftLine => ({ key: newKey(), account: '', debit: '', credit: '', memo: '' });

function dec(value: string): Decimal | null {
  const text = value.trim().replace(',', '.');
  if (!text) return new Decimal(0);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return new Decimal(text);
}

export function NewJournalDialog({ onClose }: { onClose: () => void }) {
  const { lang, caps, accounts, notify, bump, openJournal } = useGL();
  const postable = React.useMemo(() => accounts.filter((a) => a.is_postable && a.is_active), [accounts]);
  const [type, setType] = React.useState<GLJournalInput['journal_type']>('general');
  const [date, setDate] = React.useState(caps.business_today);
  const [description, setDescription] = React.useState('');
  const [lines, setLines] = React.useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const [busy, setBusy] = React.useState(false);
  // One key per open dialog: a double click or retry cannot post the same journal twice.
  const idempotencyKey = React.useRef(newKey());

  const parsed = lines.map((l) => ({ ...l, d: dec(l.debit), c: dec(l.credit) }));
  const totalD = parsed.reduce((sum, l) => sum.plus(l.d || 0), new Decimal(0));
  const totalC = parsed.reduce((sum, l) => sum.plus(l.c || 0), new Decimal(0));
  const lineProblems = parsed.map((l) => {
    if (l.d === null || l.c === null) return tx(lang, 'Məbləğ düzgün deyil', 'Неверная сумма', 'Invalid amount');
    const hasD = l.d.gt(0);
    const hasC = l.c.gt(0);
    if (!l.account && (hasD || hasC)) return tx(lang, 'Hesab seçin', 'Выберите счёт', 'Choose an account');
    if (hasD && hasC) return tx(lang, 'Ya debet, ya kredit', 'Либо дебет, либо кредит', 'Debit or credit, not both');
    if (l.account && !hasD && !hasC) return tx(lang, 'Məbləğ daxil edin', 'Введите сумму', 'Enter an amount');
    return '';
  });
  const used = parsed.filter((l) => l.account && ((l.d && l.d.gt(0)) || (l.c && l.c.gt(0))));
  const balanced = totalD.eq(totalC) && totalD.gt(0);
  const valid = balanced && used.length >= 2 && lineProblems.every((p) => !p) && description.trim().length > 0 && Boolean(date);

  const update = (key: string, patch: Partial<DraftLine>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const journal = await glApi.createJournal({
        journal_type: type,
        posting_date: date,
        description: description.trim(),
        idempotency_key: idempotencyKey.current,
        lines: used.map((l) => ({
          account: l.account,
          debit: (l.d as Decimal).toFixed(2),
          credit: (l.c as Decimal).toFixed(2),
          memo: l.memo.trim() || null,
        })),
      });
      notify('success', journal.status === 'posted'
        ? tx(lang, 'Yazılış yazıldı', 'Проводка проведена', 'Journal posted')
        : tx(lang, 'Yazılış təsdiqə göndərildi', 'Проводка отправлена на утверждение', 'Journal sent for approval'));
      bump();
      onClose();
      openJournal(journal.id);
    } catch (e) {
      notify('error', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={tx(lang, 'Yeni jurnal yazılışı', 'Новая проводка', 'New journal entry')} onClose={onClose} wide labelledBy="gl-new-journal-title">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_2fr]">
        <Field id="gl-nj-type" label={tx(lang, 'Növ', 'Тип', 'Type')}>
          <select id="gl-nj-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as GLJournalInput['journal_type'])}>
            {(['general', 'adjustment', 'cash', 'bank', 'opening'] as const).map((t) => <option key={t} value={t}>{journalTypeLabel(lang, t)}</option>)}
          </select>
        </Field>
        <Field id="gl-nj-date" label={tx(lang, 'Tarix', 'Дата', 'Posting date')}>
          <input id="gl-nj-date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="gl-nj-desc" label={tx(lang, 'Təsvir', 'Описание', 'Description')}>
          <input id="gl-nj-desc" className={inputCls} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 space-y-2">
        {lines.map((line, index) => (
          <div key={line.key} className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 md:grid-cols-[2fr_1fr_1fr_1.5fr_auto]">
            <Field id={`gl-nj-acc-${line.key}`} label={`${tx(lang, 'Hesab', 'Счёт', 'Account')} ${index + 1}`}>
              <select id={`gl-nj-acc-${line.key}`} className={inputCls} value={line.account} onChange={(e) => update(line.key, { account: e.target.value })}>
                <option value="">—</option>
                {postable.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </Field>
            <Field id={`gl-nj-d-${line.key}`} label={tx(lang, 'Debet', 'Дебет', 'Debit')}>
              <input id={`gl-nj-d-${line.key}`} inputMode="decimal" className={`${inputCls} text-right font-mono`} value={line.debit} onChange={(e) => update(line.key, { debit: e.target.value })} />
            </Field>
            <Field id={`gl-nj-c-${line.key}`} label={tx(lang, 'Kredit', 'Кредит', 'Credit')}>
              <input id={`gl-nj-c-${line.key}`} inputMode="decimal" className={`${inputCls} text-right font-mono`} value={line.credit} onChange={(e) => update(line.key, { credit: e.target.value })} />
            </Field>
            <Field id={`gl-nj-m-${line.key}`} label={tx(lang, 'Qeyd', 'Примечание', 'Memo')}>
              <input id={`gl-nj-m-${line.key}`} className={inputCls} value={line.memo} maxLength={1000} onChange={(e) => update(line.key, { memo: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                className={btn.ghost}
                disabled={lines.length <= 2}
                aria-label={tx(lang, 'Sətri sil', 'Удалить строку', 'Remove line')}
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {lineProblems[index] ? <div role="alert" className="text-xs font-bold text-rose-300 md:col-span-5">{lineProblems[index]}</div> : null}
          </div>
        ))}
        <button type="button" className={btn.ghost} disabled={lines.length >= 50} onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          <span className="inline-flex items-center gap-2"><Plus size={16} />{tx(lang, 'Sətir əlavə et', 'Добавить строку', 'Add line')}</span>
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-sm" aria-live="polite">
        <div className="flex flex-wrap gap-4 font-mono">
          <span className="text-sky-200">D {money(totalD.toFixed(2))}</span>
          <span className="text-amber-200">K {money(totalC.toFixed(2))}</span>
        </div>
        {balanced
          ? <Badge tone="emerald">{tx(lang, 'Balanslaşıb', 'Сбалансировано', 'Balanced')}</Badge>
          : <Badge tone="rose">{tx(lang, 'Fərq', 'Разница', 'Difference')}: {money(totalD.minus(totalC).toFixed(2))}</Badge>}
      </div>
      {!caps.can_approve ? (
        <p className="mt-2 text-xs text-slate-400">{tx(lang, 'Bu yazılış təsdiq növbəsinə düşəcək.', 'Проводка попадёт в очередь утверждения.', 'This journal will go to the approval queue.')}</p>
      ) : null}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btn.ghost} onClick={onClose}>{tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}</button>
        <button type="button" className={btn.primary} disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? tx(lang, 'Göndərilir...', 'Отправка...', 'Submitting...') : tx(lang, 'Yaz', 'Провести', 'Post')}
        </button>
      </div>
    </Dialog>
  );
}
