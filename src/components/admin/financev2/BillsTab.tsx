import React from 'react';
import { Decimal } from 'decimal.js';
import { tx } from '../../../i18n';
import {
  glApi,
  type GLDocument,
  type GLDocumentAllocation,
  type GLDocumentPage,
  type PayBillInput,
} from '../../../api/gl';
import { useGL, useGLLoad } from './context';
import {
  Badge,
  Card,
  Dialog,
  Empty,
  Field,
  JournalStatusBadge,
  Loading,
  Metric,
  ReasonDialog,
  btn,
  errorText,
  inputCls,
  isZero,
  money,
} from './FinanceV2Parts';
import { newIdempotencyKey, toMoneyString, validateAmount, validatePayment, type PaymentCheck } from './billsMath';

const PAGE = 50;

const PAYABLE = ['open', 'partially_paid'];

function isPositive(value: string): boolean {
  try {
    return new Decimal(value).gt(0);
  } catch {
    return false;
  }
}

function amountProblem(lang: string, check: PaymentCheck, open?: string): string {
  if (check === 'too_many_decimals')
    return tx(lang, 'Ən çox 2 onluq rəqəm (qəpik).', 'Не более 2 знаков после запятой.', 'At most 2 decimal places.');
  if (check === 'exceeds_open')
    return tx(
      lang,
      `Məbləğ açıq qalıqdan (${money(open)}) çox ola bilməz. Artıq ödəniş qəbul edilmir.`,
      `Сумма не может превышать остаток (${money(open)}). Переплата не принимается.`,
      `The amount cannot exceed the open balance (${money(open)}). Overpayments are not accepted.`
    );
  if (check === 'invalid') return tx(lang, 'Müsbət məbləğ daxil edin.', 'Введите положительную сумму.', 'Enter a positive amount.');
  return '';
}

const pendingToast = (lang: string) =>
  tx(
    lang,
    'Təsdiq gözləyir: ikinci şəxs Təsdiqlər bölməsində təsdiqləməlidir.',
    'Ожидает утверждения: второе лицо должно утвердить во вкладке «Утверждения».',
    'Pending approval: a second person must approve it in Approvals.'
  );

function DocStatusBadge({ lang, doc }: { lang: string; doc: GLDocument }) {
  if (doc.status === 'pending_approval')
    return <Badge tone="amber">{tx(lang, 'Təsdiq gözləyir', 'Ожидает утверждения', 'Pending approval')}</Badge>;
  if (doc.status === 'rejected') return <Badge tone="slate">{tx(lang, 'Rədd edilib', 'Отклонён', 'Rejected')}</Badge>;
  if (doc.status === 'void') return <Badge tone="slate">{tx(lang, 'Ləğv edilib', 'Аннулирован', 'Void')}</Badge>;
  if (doc.status === 'paid') return <Badge tone="emerald">{tx(lang, 'Ödənilib', 'Оплачен', 'Paid')}</Badge>;
  if (doc.is_overdue)
    return (
      <Badge tone="rose">
        {tx(lang, 'Gecikir', 'Просрочен', 'Overdue')} · {doc.days_overdue} {tx(lang, 'gün', 'дн.', 'd')}
      </Badge>
    );
  if (doc.status === 'partially_paid')
    return <Badge tone="amber">{tx(lang, 'Qismən ödənilib', 'Частично оплачен', 'Partially paid')}</Badge>;
  return <Badge tone="sky">{tx(lang, 'Açıq', 'Открыт', 'Open')}</Badge>;
}

export function BillsTab() {
  const { lang, caps, notify, bump, openJournal } = useGL();
  const [statusFilter, setStatusFilter] = React.useState('');
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [newBillOpen, setNewBillOpen] = React.useState(false);
  const [payDoc, setPayDoc] = React.useState<GLDocument | null>(null);
  const [selectedDocId, setSelectedDocId] = React.useState<string | null>(null);
  const [voidDoc, setVoidDoc] = React.useState<GLDocument | null>(null);
  const [reclassOpen, setReclassOpen] = React.useState(false);

  // Debounce the search box so each keystroke does not hit the API.
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  React.useEffect(() => { setOffset(0); }, [statusFilter, overdueOnly, search]);

  const { data, loading, error } = useGLLoad<GLDocumentPage>(
    () =>
      glApi.documents({
        kind: 'ap_bill',
        status: statusFilter || undefined,
        overdue_only: overdueOnly,
        search: search || undefined,
        limit: PAGE,
        offset,
      }),
    [statusFilter, overdueOnly, search, offset]
  );

  const items = data?.items || [];
  const summary = data?.summary;
  const end = data ? Math.min(data.total, offset + PAGE) : 0;

  return (
    <div className="space-y-4">
      <Card
        title={tx(lang, 'Alış fakturaları (kreditor borcları)', 'Счета поставщиков (кредиторка)', 'Supplier bills (AP)')}
        subtitle={tx(
          lang,
          'Təchizatçı fakturaları, ödəniş müddətləri və faktura üzrə ödənişlər. Debitor (AR) fakturaları sonraya saxlanılıb.',
          'Счета поставщиков, сроки оплаты и оплаты по счетам. Счета покупателям (AR) отложены.',
          'Supplier bills with due dates and bill payments. Customer invoices (AR) are deferred.'
        )}
        actions={
          <>
            {caps.can_write ? (
              <button type="button" className={btn.primary} onClick={() => setNewBillOpen(true)}>
                + {tx(lang, 'Yeni faktura', 'Новый счёт', 'New bill')}
              </button>
            ) : null}
            {caps.can_control ? (
              <button type="button" className={btn.ghost} onClick={() => setReclassOpen(true)}>
                {tx(lang, 'Təyin edilməmiş borcu təyin et', 'Назначить нераспределённый долг', 'Reclassify unassigned AP')}
              </button>
            ) : null}
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Metric
            label={tx(lang, 'Cəmi faktura məbləği', 'Всего по счетам', 'Total billed')}
            value={summary ? money(summary.total_billed) : '—'}
            tone="violet"
          />
          <Metric
            label={tx(lang, 'Açıq qalıq (borc)', 'Открытый остаток', 'Open balance')}
            value={summary ? money(summary.total_open) : '—'}
            tone={summary && !isZero(summary.total_open) ? 'amber' : 'emerald'}
          />
          <Metric
            label={tx(lang, 'Gecikən borc', 'Просроченный долг', 'Overdue amount')}
            value={summary ? money(summary.overdue_open) : '—'}
            tone={summary && !isZero(summary.overdue_open) ? 'rose' : 'sky'}
          />
          <Metric
            label={tx(lang, 'Gecikən faktura sayı', 'Просрочено счетов', 'Overdue bills')}
            value={summary ? String(summary.overdue_count) : '—'}
            tone={summary && summary.overdue_count > 0 ? 'rose' : 'sky'}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {tx(
            lang,
            'Göstəricilər seçilmiş filtr üzrə bütün səhifələri əhatə edir. Ləğv və rədd edilmiş fakturalar cəmə daxil deyil.',
            'Показатели охватывают все страницы выбранного фильтра. Аннулированные и отклонённые счета не входят в сумму.',
            'Figures cover every page of the current filter. Void and rejected bills are not included.'
          )}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-[1fr_2fr_auto] md:items-end">
          <Field id="bill-filter-status" label={tx(lang, 'Status', 'Статус', 'Status')}>
            <select id="bill-filter-status" className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{tx(lang, 'Hamısı', 'Все', 'All')}</option>
              <option value="pending_approval">{tx(lang, 'Təsdiq gözləyir', 'Ожидают утверждения', 'Pending approval')}</option>
              <option value="open">{tx(lang, 'Açıq', 'Открытые', 'Open')}</option>
              <option value="partially_paid">{tx(lang, 'Qismən ödənilib', 'Частично оплаченные', 'Partially paid')}</option>
              <option value="paid">{tx(lang, 'Ödənilib', 'Оплаченные', 'Paid')}</option>
              <option value="rejected">{tx(lang, 'Rədd edilib', 'Отклонённые', 'Rejected')}</option>
              <option value="void">{tx(lang, 'Ləğv edilib', 'Аннулированные', 'Void')}</option>
            </select>
          </Field>
          <Field id="bill-filter-search" label={tx(lang, 'Axtarış (nömrə və ya təchizatçı)', 'Поиск (номер или поставщик)', 'Search (number or supplier)')}>
            <input
              id="bill-filter-search"
              type="search"
              className={inputCls}
              maxLength={100}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </Field>
          <label htmlFor="bill-filter-overdue" className="flex min-h-11 items-center gap-2 text-sm font-bold text-slate-200">
            <input
              id="bill-filter-overdue"
              type="checkbox"
              className="h-5 w-5 accent-yellow-400"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
            />
            {tx(lang, 'Yalnız gecikənlər', 'Только просроченные', 'Overdue only')}
          </label>
        </div>

        {loading && !data ? <div className="mt-4"><Loading lang={lang} /></div> : null}
        {error ? <div className="mt-4"><Empty>{error}</Empty></div> : null}

        {data && items.length === 0 ? (
          <div className="mt-4">
            <Empty>{tx(lang, 'Faktura tapılmadı.', 'Счетов не найдено.', 'No bills found.')}</Empty>
          </div>
        ) : null}

        {data && items.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
            <table className="min-w-[1040px] w-full border-collapse bg-slate-950 text-sm">
              <caption className="sr-only">{tx(lang, 'Alış fakturaları', 'Счета поставщиков', 'Supplier bills')}</caption>
              <thead className="bg-slate-900 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Faktura №', '№ счёта', 'Bill #')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Təchizatçı', 'Поставщик', 'Supplier')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Tarix', 'Дата', 'Issue date')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Son ödəniş', 'Срок оплаты', 'Due date')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Məbləğ', 'Сумма', 'Total')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Açıq qalıq', 'Остаток', 'Open')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Status', 'Статус', 'Status')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Əməliyyat', 'Действия', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {items.map((doc) => (
                  <tr key={doc.id} className={doc.is_overdue ? 'bg-rose-950/30 hover:bg-rose-950/50' : 'hover:bg-slate-900/60'}>
                    <th scope="row" className="px-3 py-2 text-left font-mono font-black text-yellow-200">
                      <button type="button" className="min-h-11 text-left hover:underline" onClick={() => setSelectedDocId(doc.id)}>
                        {doc.number}
                      </button>
                    </th>
                    <td className="px-3 py-2 text-left font-semibold text-slate-200">{doc.partner_name}</td>
                    <td className="px-3 py-2 text-left whitespace-nowrap text-slate-400">{doc.issue_date}</td>
                    <td className={`px-3 py-2 text-left whitespace-nowrap ${doc.is_overdue ? 'font-bold text-rose-200' : 'text-slate-300'}`}>
                      {doc.due_date}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap text-white">{money(doc.total)}</td>
                    <td className="px-3 py-2 text-right font-mono font-black whitespace-nowrap text-yellow-200">{money(doc.open)}</td>
                    <td className="px-3 py-2 text-left"><DocStatusBadge lang={lang} doc={doc} /></td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {caps.can_write && PAYABLE.includes(doc.status) && !isZero(doc.open) ? (
                          <button type="button" className={btn.approve} onClick={() => setPayDoc(doc)}>
                            {tx(lang, 'Ödə', 'Оплатить', 'Pay')}
                          </button>
                        ) : null}
                        {caps.can_write && doc.status === 'open' ? (
                          <button type="button" className={btn.danger} onClick={() => setVoidDoc(doc)}>
                            {tx(lang, 'Ləğv et', 'Аннулировать', 'Void')}
                          </button>
                        ) : null}
                        {doc.journal_id ? (
                          <button
                            type="button"
                            className={btn.ghost}
                            onClick={() => openJournal(doc.journal_id as string)}
                            aria-label={tx(lang, `Jurnala bax: ${doc.number}`, `Открыть проводку: ${doc.number}`, `Open journal: ${doc.number}`)}
                          >
                            GL
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {data ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
            <span>{data.total === 0 ? '0' : `${offset + 1}–${end}`} / {data.total}</span>
            <div className="flex gap-2">
              <button type="button" className={btn.ghost} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                {tx(lang, 'Əvvəlki', 'Назад', 'Previous')}
              </button>
              <button type="button" className={btn.ghost} disabled={end >= data.total} onClick={() => setOffset(offset + PAGE)}>
                {tx(lang, 'Növbəti', 'Далее', 'Next')}
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      {newBillOpen ? <NewBillDialog onClose={() => setNewBillOpen(false)} /> : null}

      {payDoc ? <PayBillDialog doc={payDoc} onClose={() => setPayDoc(null)} /> : null}

      {selectedDocId ? <BillDetailDialog docId={selectedDocId} onClose={() => setSelectedDocId(null)} /> : null}

      {voidDoc ? (
        <ReasonDialog
          lang={lang}
          title={tx(lang, `Fakturanı ləğv et: ${voidDoc.number}`, `Аннулировать счёт: ${voidDoc.number}`, `Void bill: ${voidDoc.number}`)}
          confirmLabel={tx(lang, 'Ləğv sorğusu göndər', 'Запросить аннулирование', 'Request void')}
          onCancel={() => setVoidDoc(null)}
          onConfirm={async (reason) => {
            try {
              await glApi.voidDocument(voidDoc.id, reason);
              notify(
                'success',
                tx(
                  lang,
                  'Ləğv sorğusu təsdiqə göndərildi. Faktura ikinci şəxs təsdiqləyənə qədər açıq qalır.',
                  'Запрос на аннулирование отправлен на утверждение. Счёт остаётся открытым до утверждения вторым лицом.',
                  'Void sent for approval. The bill stays open until a second person approves it.'
                )
              );
              setVoidDoc(null);
              bump();
            } catch (e) {
              notify('error', errorText(e));
            }
          }}
        />
      ) : null}

      {reclassOpen ? <ReclassifyAPDialog onClose={() => setReclassOpen(false)} /> : null}
    </div>
  );
}

// ─────────────────────────────── supplier picker ───────────────────────

function SupplierSelect({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  const { lang } = useGL();
  const { data, loading, error } = useGLLoad(() => glApi.suppliers(), []);
  return (
    <Field id={id} label={label}>
      <select id={id} required className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} disabled={loading && !data}>
        <option value="">{loading && !data ? tx(lang, 'Yüklənir...', 'Загрузка...', 'Loading...') : tx(lang, 'Təchizatçı seçin', 'Выберите поставщика', 'Choose a supplier')}</option>
        {(data || []).map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {error ? <p role="alert" className="text-xs font-bold text-rose-300">{error}</p> : null}
      {data && data.length === 0 ? (
        <p className="text-xs text-slate-400">
          {tx(lang, 'Təchizatçı yoxdur. Əvvəlcə təchizatçı əlavə edin.', 'Поставщиков нет. Сначала добавьте поставщика.', 'No suppliers yet. Add a supplier first.')}
        </p>
      ) : null}
    </Field>
  );
}

// ─────────────────────────────── new bill ──────────────────────────────

function NewBillDialog({ onClose }: { onClose: () => void }) {
  const { lang, caps, notify, bump } = useGL();
  const [supplierId, setSupplierId] = React.useState('');
  const [billNo, setBillNo] = React.useState('');
  const [issueDate, setIssueDate] = React.useState(caps.business_today);
  const [dueDate, setDueDate] = React.useState(caps.business_today);
  const [total, setTotal] = React.useState('');
  const [expenseAccount, setExpenseAccount] = React.useState('inventory');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const totalCheck = validateAmount(total);
  const totalHint = total.trim() && totalCheck !== 'ok' ? amountProblem(lang, totalCheck) : '';
  const valid = Boolean(supplierId && billNo.trim() && issueDate && dueDate && dueDate >= issueDate && totalCheck === 'ok');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const doc = await glApi.createBill({
        partner_id: supplierId,
        number: billNo.trim(),
        issue_date: issueDate,
        due_date: dueDate,
        total: toMoneyString(total) as string,
        expense_account: expenseAccount,
        note: note.trim() || undefined,
      });
      notify(
        'success',
        doc.status === 'pending_approval'
          ? `${tx(lang, 'Faktura yaradıldı.', 'Счёт создан.', 'Bill created.')} ${pendingToast(lang)}`
          : tx(lang, 'Faktura yaradıldı', 'Счёт создан', 'Bill created')
      );
      bump();
      onClose();
    } catch (err) {
      notify('error', errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={tx(lang, 'Yeni alış fakturası', 'Новый счёт поставщика', 'New supplier bill')} onClose={onClose} labelledBy="gl-create-bill-title">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SupplierSelect id="bill-supplier" label={tx(lang, 'Təchizatçı *', 'Поставщик *', 'Supplier *')} value={supplierId} onChange={setSupplierId} />
          <Field id="bill-number" label={tx(lang, 'Faktura № *', 'Номер счёта *', 'Bill number *')}>
            <input id="bill-number" type="text" required maxLength={64} className={inputCls} value={billNo} onChange={(e) => setBillNo(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="bill-issue-date" label={tx(lang, 'Verilmə tarixi', 'Дата выписки', 'Issue date')}>
            <input id="bill-issue-date" type="date" required className={inputCls} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field id="bill-due-date" label={tx(lang, 'Son ödəniş tarixi', 'Срок оплаты', 'Due date')}>
            <input id="bill-due-date" type="date" required min={issueDate || undefined} className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="bill-total" label={tx(lang, 'Məbləğ (AZN) *', 'Сумма (AZN) *', 'Total (AZN) *')}>
            <input
              id="bill-total"
              inputMode="decimal"
              required
              className={`${inputCls} text-right font-mono`}
              placeholder="0.00"
              value={total}
              aria-invalid={Boolean(totalHint)}
              aria-describedby={totalHint ? 'bill-total-hint' : undefined}
              onChange={(e) => setTotal(e.target.value)}
            />
            {totalHint ? <p id="bill-total-hint" role="alert" className="text-xs font-bold text-rose-300">{totalHint}</p> : null}
          </Field>
          <Field id="bill-exp-acc" label={tx(lang, 'Debet hesabı (anbar / xərc)', 'Счёт дебета (склад / расход)', 'Debit account (stock / expense)')}>
            <select id="bill-exp-acc" className={inputCls} value={expenseAccount} onChange={(e) => setExpenseAccount(e.target.value)}>
              <option value="inventory">201 · {tx(lang, 'Material ehtiyatları (anbar)', 'Материальные запасы (склад)', 'Inventory (stock)')}</option>
              <option value="general_expense">721.9 · {tx(lang, 'Digər inzibati xərclər', 'Прочие административные расходы', 'Other administrative expenses')}</option>
              <option value="rent_expense">721.2 · {tx(lang, 'İcarə', 'Аренда', 'Rent')}</option>
              <option value="utilities_expense">721.3 · {tx(lang, 'Kommunal xərclər', 'Коммунальные расходы', 'Utilities')}</option>
            </select>
          </Field>
        </div>

        <Field id="bill-note" label={tx(lang, 'Qeyd', 'Примечание', 'Note')}>
          <textarea id="bill-note" rows={2} maxLength={1000} className={`${inputCls} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {!caps.can_approve ? (
          <p className="text-xs text-slate-400">
            {tx(lang, 'Bu faktura təsdiq növbəsinə düşəcək.', 'Счёт попадёт в очередь утверждения.', 'This bill will go to the approval queue.')}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btn.ghost} onClick={onClose}>{tx(lang, 'İmtina', 'Отмена', 'Cancel')}</button>
          <button type="submit" disabled={!valid || busy} className={btn.primary}>
            {busy ? tx(lang, 'Göndərilir...', 'Отправка...', 'Submitting...') : tx(lang, 'Fakturanı yarat', 'Создать счёт', 'Create bill')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─────────────────────────────── pay bill ──────────────────────────────

function PayBillDialog({ doc, onClose }: { doc: GLDocument; onClose: () => void }) {
  const { lang, caps, notify, bump } = useGL();
  const [amount, setAmount] = React.useState(doc.open);
  const [paidFrom, setPaidFrom] = React.useState<PayBillInput['paid_from']>('bank_main');
  const [postingDate, setPostingDate] = React.useState(caps.business_today);
  const [bankFee, setBankFee] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState('');
  // One key per open dialog: a double click or a retry replays the same payment instead of paying twice.
  const idempotencyKey = React.useRef(newIdempotencyKey());

  const amountCheck = validatePayment(amount, doc.open);
  const amountHint = amount.trim() && amountCheck !== 'ok' ? amountProblem(lang, amountCheck, doc.open) : '';
  const fee = bankFee.trim() ? toMoneyString(bankFee) : '0.00';
  const feeHint = fee === null ? amountProblem(lang, validateAmount(bankFee)) : '';
  const valid = amountCheck === 'ok' && fee !== null && Boolean(postingDate) && postingDate >= doc.issue_date;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setServerError('');
    try {
      const result = await glApi.payBill(doc.id, {
        amount: toMoneyString(amount) as string,
        paid_from: paidFrom,
        posting_date: postingDate,
        bank_fee: fee as string,
        note: note.trim() || undefined,
        idempotency_key: idempotencyKey.current,
      });
      if (result.replayed) {
        notify('info', tx(lang, 'Bu ödəniş artıq qeydə alınıb.', 'Эта оплата уже записана.', 'This payment was already recorded.'));
      } else if (result.journal_status === 'pending_approval') {
        notify('success', `${tx(lang, 'Ödəniş yaradıldı.', 'Оплата создана.', 'Payment created.')} ${pendingToast(lang)}`);
      } else {
        notify('success', tx(lang, 'Ödəniş yazıldı', 'Оплата проведена', 'Payment posted'));
      }
      bump();
      onClose();
    } catch (err) {
      // e.g. 409 overpayment_not_allowed / void_pending: show the server message in the dialog too.
      const message = errorText(err);
      setServerError(message);
      notify('error', message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={tx(lang, `Fakturanı ödə: ${doc.number}`, `Оплата счёта: ${doc.number}`, `Pay bill: ${doc.number}`)} onClose={onClose} labelledBy="gl-pay-bill-title">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <dl className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-400">{tx(lang, 'Təchizatçı', 'Поставщик', 'Supplier')}</dt>
            <dd className="font-bold text-white">{doc.partner_name}</dd>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <dt className="text-slate-400">{tx(lang, 'Açıq qalıq', 'Остаток', 'Open balance')}</dt>
            <dd className="font-mono font-black text-yellow-200">{money(doc.open)}</dd>
          </div>
        </dl>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="pay-amount" label={tx(lang, 'Ödəniş məbləği (AZN) *', 'Сумма оплаты (AZN) *', 'Payment amount (AZN) *')}>
            <input
              id="pay-amount"
              inputMode="decimal"
              required
              className={`${inputCls} text-right font-mono`}
              value={amount}
              aria-invalid={Boolean(amountHint)}
              aria-describedby={amountHint ? 'pay-amount-hint' : undefined}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amountHint ? <p id="pay-amount-hint" role="alert" className="text-xs font-bold text-rose-300">{amountHint}</p> : null}
          </Field>
          <Field id="pay-wallet" label={tx(lang, 'Haradan ödənilir *', 'Источник оплаты *', 'Pay from *')}>
            <select id="pay-wallet" aria-describedby="pay-wallet-hint" className={inputCls} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value as PayBillInput['paid_from'])}>
              <option value="bank_main">223.1 · {tx(lang, 'Əsas bank hesabı', 'Основной банковский счёт', 'Main bank account')}</option>
              <option value="safe">221.2 · {tx(lang, 'Seyf', 'Сейф', 'Safe')}</option>
            </select>
            <p id="pay-wallet-hint" className="text-xs text-slate-400">
              {tx(lang,
                'POS kassasından nağd ödəniş üçün təchizatçı ödənişindən (POS / Maliyyə) istifadə edin ki, növbənin kassa sayımı onu nəzərə alsın.',
                'Для оплаты наличными из кассы POS используйте оплату поставщику (POS / Финансы), чтобы её учёл пересчёт кассы смены.',
                'To pay with POS drawer cash, use the supplier payment (POS / Finance) so the shift cash count includes it.')}
            </p>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="pay-date" label={tx(lang, 'Ödəniş tarixi', 'Дата оплаты', 'Payment date')}>
            <input id="pay-date" type="date" required min={doc.issue_date} className={inputCls} value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
          </Field>
          <Field id="pay-fee" label={tx(lang, 'Bank komissiyası (varsa)', 'Комиссия банка (если есть)', 'Bank fee (if any)')}>
            <input
              id="pay-fee"
              inputMode="decimal"
              className={`${inputCls} text-right font-mono`}
              placeholder="0.00"
              value={bankFee}
              aria-invalid={Boolean(feeHint)}
              aria-describedby={feeHint ? 'pay-fee-hint' : undefined}
              onChange={(e) => setBankFee(e.target.value)}
            />
            {feeHint ? <p id="pay-fee-hint" role="alert" className="text-xs font-bold text-rose-300">{feeHint}</p> : null}
          </Field>
        </div>

        <Field id="pay-note" label={tx(lang, 'Qeyd', 'Примечание', 'Note')}>
          <input id="pay-note" type="text" maxLength={1000} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {serverError ? <p role="alert" className="rounded-2xl border border-rose-400/40 bg-rose-950/30 p-3 text-sm text-rose-100">{serverError}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btn.ghost} onClick={onClose}>{tx(lang, 'İmtina', 'Отмена', 'Cancel')}</button>
          <button type="submit" disabled={!valid || busy} className={btn.approve}>
            {busy ? tx(lang, 'Göndərilir...', 'Отправка...', 'Submitting...') : tx(lang, 'Ödənişi göndər', 'Провести оплату', 'Submit payment')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─────────────────────────────── bill detail ───────────────────────────

function allocationSourceLabel(lang: string, a: GLDocumentAllocation): string {
  if (!isPositive(a.amount)) return tx(lang, 'Ödənişin storno edilməsi', 'Сторно оплаты', 'Payment reversal');
  if (a.source_type === 'document_payment') return tx(lang, 'Faktura ödənişi', 'Оплата счёта', 'Bill payment');
  if (a.source_type === 'supplier_payment') return tx(lang, 'Təchizatçıya ödəniş', 'Оплата поставщику', 'Supplier payment');
  return a.source_type || '—';
}

function BillDetailDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { lang, caps, notify, bump, openJournal } = useGL();
  const { data: doc, loading, error } = useGLLoad(() => glApi.document(docId), [docId]);
  const [reverseOf, setReverseOf] = React.useState<GLDocumentAllocation | null>(null);

  const go = (journalId: string) => {
    onClose();
    openJournal(journalId);
  };

  const reversalPending = new Set((doc?.pending_payment_reversals || []).map((r) => r.reversal_of_id));
  const canReverse = (a: GLDocumentAllocation) =>
    caps.can_write && isPositive(a.amount) && a.source_type === 'document_payment' && !a.reversed && !reversalPending.has(a.journal_id);

  return (
    <Dialog
      title={tx(lang, `Faktura: ${doc?.number || ''}`, `Счёт: ${doc?.number || ''}`, `Bill: ${doc?.number || ''}`)}
      onClose={onClose}
      wide
      labelledBy="gl-bill-detail-title"
    >
      {loading && !doc ? <Loading lang={lang} /> : null}
      {error ? <Empty>{error}</Empty> : null}
      {doc ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <DocStatusBadge lang={lang} doc={doc} />
            {doc.journal_status ? <JournalStatusBadge lang={lang} status={doc.journal_status} /> : null}
            {doc.pending_void_journal_id ? (
              <button type="button" className="min-h-11" onClick={() => go(doc.pending_void_journal_id as string)}>
                <Badge tone="amber">{tx(lang, 'Ləğv təsdiq gözləyir', 'Аннулирование ждёт утверждения', 'Void pending approval')}</Badge>
              </button>
            ) : null}
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-slate-500">{tx(lang, 'Təchizatçı', 'Поставщик', 'Supplier')}</dt>
              <dd className="font-bold text-white">{doc.partner_name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{tx(lang, 'Məbləğ', 'Сумма', 'Total')}</dt>
              <dd className="font-mono font-bold text-white">{money(doc.total)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{tx(lang, 'Açıq qalıq', 'Остаток', 'Open')}</dt>
              <dd className="font-mono font-black text-yellow-200">{money(doc.open)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{tx(lang, 'Tarix / son ödəniş', 'Дата / срок', 'Issued / due')}</dt>
              <dd className={doc.is_overdue ? 'font-bold text-rose-200' : 'text-slate-200'}>{doc.issue_date} → {doc.due_date}</dd>
            </div>
          </dl>
          {doc.note ? <p className="text-sm text-slate-300">{doc.note}</p> : null}

          {doc.status === 'pending_approval' ? (
            <p className="text-xs text-slate-400">
              {tx(
                lang,
                'Faktura jurnalı təsdiq gözləyir. Təsdiqdən sonra faktura açılır, rədd edilsə "Rədd edilib" olur.',
                'Проводка счёта ждёт утверждения. После утверждения счёт открывается, при отклонении — «Отклонён».',
                'The bill journal is waiting for approval. Approval opens the bill; rejection marks it rejected.'
              )}
            </p>
          ) : null}

          {/* Source journal lines */}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                {tx(lang, 'Faktura jurnalı', 'Проводка счёта', 'Bill journal')}
              </h4>
              {doc.journal_id ? (
                <button type="button" className={btn.ghost} onClick={() => go(doc.journal_id as string)}>
                  {tx(lang, 'Jurnalı aç', 'Открыть проводку', 'Open journal')}
                </button>
              ) : null}
            </div>
            {doc.lines && doc.lines.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="min-w-[560px] w-full border-collapse bg-slate-950 text-sm">
                  <caption className="sr-only">{tx(lang, 'Faktura jurnalının sətirləri', 'Строки проводки счёта', 'Bill journal lines')}</caption>
                  <thead className="bg-slate-900 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Hesab', 'Счёт', 'Account')}</th>
                      <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Qeyd', 'Примечание', 'Memo')}</th>
                      <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Debet', 'Дебет', 'Debit')}</th>
                      <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Kredit', 'Кредит', 'Credit')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {doc.lines.map((line) => (
                      <tr key={line.line_no}>
                        <th scope="row" className="px-3 py-2 text-left font-normal text-slate-100">
                          <span className="mr-2 font-mono text-slate-500">{line.account_code}</span>{line.account_name}
                        </th>
                        <td className="px-3 py-2 text-slate-400">{line.memo || ''}</td>
                        <td className="px-3 py-2 text-right font-mono text-sky-200">{isZero(line.debit) ? '' : money(line.debit)}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber-200">{isZero(line.credit) ? '' : money(line.credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{tx(lang, 'Jurnal sətirləri yoxdur.', 'Строк проводки нет.', 'No journal lines.')}</Empty>
            )}
          </section>

          {/* Pending payments (not yet allocated) */}
          {doc.pending_payments && doc.pending_payments.length > 0 ? (
            <section>
              <h4 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                {tx(lang, 'Təsdiq gözləyən ödənişlər', 'Оплаты на утверждении', 'Payments pending approval')}
              </h4>
              <ul className="space-y-2">
                {doc.pending_payments.map((p) => (
                  <li key={p.journal_id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-400/25 bg-amber-950/20 p-3 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone="amber">{tx(lang, 'Təsdiq gözləyir', 'Ожидает утверждения', 'Pending approval')}</Badge>
                      <span className="font-mono text-white">{money(p.amount)}</span>
                      <span className="text-slate-400">{p.posting_date} · {p.created_by || '—'}</span>
                    </span>
                    <button type="button" className={btn.ghost} onClick={() => go(p.journal_id)}>
                      {tx(lang, 'Jurnalı aç', 'Открыть проводку', 'Open journal')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Allocations (negative rows = reversed payments) */}
          <section>
            <h4 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
              {tx(lang, 'Ödəniş bölgüləri', 'Распределение оплат', 'Payment allocations')}
            </h4>
            {doc.allocations && doc.allocations.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="min-w-[640px] w-full border-collapse bg-slate-950 text-sm">
                  <caption className="sr-only">{tx(lang, 'Faktura üzrə ödəniş bölgüləri', 'Распределение оплат по счёту', 'Payment allocations of the bill')}</caption>
                  <thead className="bg-slate-900 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Jurnal', 'Проводка', 'Journal')}</th>
                      <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
                      <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Növ', 'Тип', 'Type')}</th>
                      <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Məbləğ', 'Сумма', 'Amount')}</th>
                      <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Əməliyyat', 'Действия', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {doc.allocations.map((a) => (
                      <tr key={a.id}>
                        <th scope="row" className="px-3 py-2 text-left">
                          <button type="button" className="min-h-11 font-mono font-bold text-yellow-200 hover:underline" onClick={() => go(a.journal_id)}>
                            {a.journal_no || a.journal_id.slice(0, 8)}
                          </button>
                        </th>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-400">{a.posting_date}</td>
                        <td className="px-3 py-2 text-slate-300">
                          <span className="flex flex-wrap items-center gap-2">
                            {allocationSourceLabel(lang, a)}
                            {isPositive(a.amount) && a.reversed ? <Badge tone="rose">{tx(lang, 'Storno edilib', 'Сторнировано', 'Reversed')}</Badge> : null}
                            {reversalPending.has(a.journal_id) ? (
                              <Badge tone="amber">{tx(lang, 'Storno təsdiq gözləyir', 'Сторно ждёт утверждения', 'Reversal pending')}</Badge>
                            ) : null}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-right font-mono whitespace-nowrap ${isPositive(a.amount) ? 'text-emerald-200' : 'text-rose-200'}`}>
                          {money(a.amount)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {canReverse(a) ? (
                            <button type="button" className={btn.danger} onClick={() => setReverseOf(a)}>
                              {tx(lang, 'Ödənişi geri qaytar', 'Сторнировать оплату', 'Reverse payment')}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>{tx(lang, 'Bu faktura üzrə hələ ödəniş yoxdur.', 'Оплат по счёту пока нет.', 'No payments allocated yet.')}</Empty>
            )}
          </section>

          <div className="flex justify-end">
            <button type="button" className={btn.ghost} onClick={onClose}>{tx(lang, 'Bağla', 'Закрыть', 'Close')}</button>
          </div>
        </div>
      ) : null}

      {reverseOf && doc ? (
        <ReasonDialog
          lang={lang}
          title={tx(
            lang,
            `Ödənişi geri qaytar: ${money(reverseOf.amount)}`,
            `Сторно оплаты: ${money(reverseOf.amount)}`,
            `Reverse payment: ${money(reverseOf.amount)}`
          )}
          confirmLabel={tx(lang, 'Storno sorğusu göndər', 'Запросить сторно', 'Request reversal')}
          onCancel={() => setReverseOf(null)}
          onConfirm={async (reason) => {
            try {
              await glApi.reverseBillPayment(doc.id, reverseOf.journal_id, reason);
              notify(
                'success',
                tx(
                  lang,
                  'Ödənişin storno sorğusu təsdiqə göndərildi. Təsdiqdən sonra faktura yenidən açılır.',
                  'Сторно оплаты отправлено на утверждение. После утверждения счёт снова откроется.',
                  'Payment reversal sent for approval. The bill reopens once it is approved.'
                )
              );
              setReverseOf(null);
              bump();
            } catch (e) {
              notify('error', errorText(e));
            }
          }}
        />
      ) : null}
    </Dialog>
  );
}

// ─────────────────────────────── reclassify unassigned AP ──────────────

function ReclassifyAPDialog({ onClose }: { onClose: () => void }) {
  const { lang, caps, notify, bump } = useGL();
  const [supplierId, setSupplierId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('Təchizatçı təyini');
  const [postingDate, setPostingDate] = React.useState(caps.business_today);
  const [busy, setBusy] = React.useState(false);

  const amountCheck = validateAmount(amount);
  const amountHint = amount.trim() && amountCheck !== 'ok' ? amountProblem(lang, amountCheck) : '';
  const valid = Boolean(supplierId && postingDate) && amountCheck === 'ok';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await glApi.reclassifyUnassignedAP({
        amount: toMoneyString(amount) as string,
        to_supplier_id: supplierId,
        reason: reason.trim() || undefined,
        posting_date: postingDate,
      });
      notify(
        'success',
        tx(
          lang,
          'Yenidən təyin sorğusu təsdiqə göndərildi (başqa admin təsdiqləməlidir).',
          'Переклассификация отправлена на утверждение (утверждает другой админ).',
          'Reclassification sent for approval (another admin must approve it).'
        )
      );
      bump();
      onClose();
    } catch (err) {
      notify('error', errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={tx(lang, 'Təyin edilməmiş kreditor borcu (531)', 'Нераспределённая кредиторка (531)', 'Unassigned AP (531)')}
      onClose={onClose}
      labelledBy="gl-reclassify-ap-title"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Təchizatçısı göstərilməyən 531 borcunu seçilmiş təchizatçıya köçürür. 531-in ümumi qalığı dəyişmir. Məbləğ təyin edilməmiş qalıqdan çox ola bilməz və ikinci şəxsin təsdiqi lazımdır.',
            'Переносит долг 531 без поставщика на выбранного поставщика. Общий остаток 531 не меняется. Сумма не больше нераспределённого остатка; нужно утверждение второго лица.',
            'Moves 531 balance without a supplier to the chosen supplier. The 531 total does not change. Capped at the unassigned balance; a second person must approve.'
          )}
        </p>

        <SupplierSelect id="rec-sup" label={tx(lang, 'Təchizatçı *', 'Поставщик *', 'Supplier *')} value={supplierId} onChange={setSupplierId} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="rec-amt" label={tx(lang, 'Məbləğ (AZN) *', 'Сумма (AZN) *', 'Amount (AZN) *')}>
            <input
              id="rec-amt"
              inputMode="decimal"
              required
              className={`${inputCls} text-right font-mono`}
              placeholder="0.00"
              value={amount}
              aria-invalid={Boolean(amountHint)}
              aria-describedby={amountHint ? 'rec-amt-hint' : undefined}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amountHint ? <p id="rec-amt-hint" role="alert" className="text-xs font-bold text-rose-300">{amountHint}</p> : null}
          </Field>
          <Field id="rec-date" label={tx(lang, 'Tarix', 'Дата', 'Posting date')}>
            <input id="rec-date" type="date" required className={inputCls} value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
          </Field>
        </div>

        <Field id="rec-reason" label={tx(lang, 'Səbəb', 'Причина', 'Reason')}>
          <input id="rec-reason" type="text" maxLength={500} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btn.ghost} onClick={onClose}>{tx(lang, 'İmtina', 'Отмена', 'Cancel')}</button>
          <button type="submit" disabled={!valid || busy} className={btn.primary}>
            {busy ? tx(lang, 'Göndərilir...', 'Отправка...', 'Submitting...') : tx(lang, 'Təsdiqə göndər', 'Отправить на утверждение', 'Send for approval')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
