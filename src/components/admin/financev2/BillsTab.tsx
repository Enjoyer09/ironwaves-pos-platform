import React from 'react';
import { tx } from '../../../i18n';
import { glApi, type GLDocument, type GLDocumentAllocation } from '../../../api/gl';
import { useGL, useGLLoad } from './context';
import {
  Badge,
  Card,
  Dialog,
  Empty,
  Field,
  Loading,
  Metric,
  ReasonDialog,
  btn,
  inputCls,
  money,
} from './FinanceV2Parts';

export function BillsTab() {
  const { lang, caps, notify, bump, version, openJournal, openLedger } = useGL();
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [partnerFilter, setPartnerFilter] = React.useState<string>('');
  const [newBillOpen, setNewBillOpen] = React.useState(false);
  const [payDoc, setPayDoc] = React.useState<GLDocument | null>(null);
  const [selectedDocId, setSelectedDocId] = React.useState<string | null>(null);
  const [voidDoc, setVoidDoc] = React.useState<GLDocument | null>(null);
  const [reclassOpen, setReclassOpen] = React.useState(false);

  // Load documents
  const { data, loading, error, reload } = useGLLoad(
    () =>
      glApi.documents({
        kind: 'ap_bill',
        status: statusFilter === 'all' ? undefined : statusFilter,
        partner_id: partnerFilter || undefined,
        limit: 100,
      }),
    [statusFilter, partnerFilter, version]
  );

  // Document detail state
  const [detailDoc, setDetailDoc] = React.useState<GLDocument | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  React.useEffect(() => {
    if (!selectedDocId) {
      setDetailDoc(null);
      return;
    }
    setDetailLoading(true);
    glApi
      .document(selectedDocId)
      .then((res) => setDetailDoc(res))
      .catch((e) => notify('error', e instanceof Error ? e.message : 'Error'))
      .finally(() => setDetailLoading(false));
  }, [selectedDocId, version]);

  const items = data?.items || [];
  const totalBilled = items.reduce((sum, d) => sum + Number(d.total), 0);
  const totalOpen = items.reduce((sum, d) => (d.status !== 'void' ? sum + Number(d.open) : sum), 0);
  const overdueCount = items.filter((d) => d.is_overdue).length;
  const overdueAmount = items.reduce((sum, d) => (d.is_overdue ? sum + Number(d.open) : sum), 0);

  const statusBadge = (d: GLDocument) => {
    if (d.status === 'paid') return <Badge tone="emerald">{tx(lang, 'Ödənilib', 'Оплачен', 'Paid')}</Badge>;
    if (d.status === 'partially_paid')
      return <Badge tone="amber">{tx(lang, 'Qismən ödənilib', 'Частично', 'Partially paid')}</Badge>;
    if (d.status === 'void') return <Badge tone="rose">{tx(lang, 'Ləğv edilib', 'Аннулирован', 'Void')}</Badge>;
    if (d.is_overdue)
      return (
        <Badge tone="rose">
          {tx(lang, 'Gecikir', 'Просрочен', 'Overdue')} ({d.days_overdue} {tx(lang, 'gün', 'дн.', 'd')})
        </Badge>
      );
    return <Badge tone="sky">{tx(lang, 'Açıq', 'Открыт', 'Open')}</Badge>;
  };

  return (
    <div className="space-y-4">
      <Card
        title={tx(lang, 'Alış Fakturaları (Kreditor Borcları)', 'Счета поставщиков (AP Bills)', 'Supplier Bills (AP)')}
        subtitle={tx(
          lang,
          'Təchizatçı fakturaları, ödəniş müddətləri və faktura üzrə ödəniş uçotu.',
          'Счета поставщиков, сроки оплаты и распределение оплат.',
          'Supplier bills with due dates, settlement matching and status tracking.'
        )}
        actions={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Field id="bill-filter-status" label={tx(lang, 'Status', 'Статус', 'Status')}>
                <select
                  id="bill-filter-status"
                  className={inputCls}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">{tx(lang, 'Hamısı', 'Все', 'All')}</option>
                  <option value="open">{tx(lang, 'Açıq', 'Открытые', 'Open')}</option>
                  <option value="partially_paid">{tx(lang, 'Qismən ödənilib', 'Частично', 'Partially paid')}</option>
                  <option value="paid">{tx(lang, 'Ödənilib', 'Оплаченные', 'Paid')}</option>
                  <option value="void">{tx(lang, 'Ləğv edilib', 'Аннулированные', 'Void')}</option>
                </select>
              </Field>

              {caps.can_write ? (
                <button
                  type="button"
                  className={btn.primary}
                  onClick={() => setNewBillOpen(true)}
                >
                  + {tx(lang, 'Yeni faktura', 'Новый счёт', 'New bill')}
                </button>
              ) : null}

              {caps.can_control ? (
                <button
                  type="button"
                  className={btn.ghost}
                  onClick={() => setReclassOpen(true)}
                >
                  {tx(lang, 'Təyin edilməmiş borcu böl', 'Переклассифицировать', 'Reclassify AP')}
                </button>
              ) : null}
            </div>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Metric
            label={tx(lang, 'Cəmi faktura məbləği', 'Всего по счетам', 'Total billed')}
            value={money(totalBilled)}
            tone="violet"
          />
          <Metric
            label={tx(lang, 'Açıq qalıq (borc)', 'Открытый остаток', 'Open balance')}
            value={money(totalOpen)}
            tone={totalOpen > 0 ? 'amber' : 'emerald'}
          />
          <Metric
            label={tx(lang, 'Gecikən borc məbləği', 'Просроченный долг', 'Overdue amount')}
            value={money(overdueAmount)}
            tone={overdueAmount > 0 ? 'rose' : 'sky'}
          />
          <Metric
            label={tx(lang, 'Gecikən faktura sayı', 'Просрочено счетов', 'Overdue bills')}
            value={String(overdueCount)}
            tone={overdueCount > 0 ? 'rose' : 'sky'}
          />
        </div>

        {loading && !data ? <Loading lang={lang} /> : null}
        {error ? <Empty>{error}</Empty> : null}

        {data && items.length === 0 ? (
          <div className="mt-4">
            <Empty>{tx(lang, 'Faktura tapılmadı.', 'Счетов не найдено.', 'No bills found.')}</Empty>
          </div>
        ) : null}

        {data && items.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
            <table className="min-w-[960px] w-full border-collapse bg-slate-950 text-sm">
              <thead className="bg-slate-900 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Faktura №', '№ счёта', 'Bill #')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Təchizatçı', 'Поставщик', 'Supplier')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Tarix', 'Дата выписки', 'Issue Date')}</th>
                  <th scope="col" className="px-3 py-2 text-left">{tx(lang, 'Son ödəniş', 'Срок оплаты', 'Due Date')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Məbləğ', 'Сумма', 'Total')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Açıq qalıq', 'Остаток', 'Open')}</th>
                  <th scope="col" className="px-3 py-2 text-center">{tx(lang, 'Status', 'Статус', 'Status')}</th>
                  <th scope="col" className="px-3 py-2 text-right">{tx(lang, 'Əməliyyat', 'Действие', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono text-slate-200">
                {items.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-900/60 transition">
                    <td className="px-3 py-2 text-left font-black text-yellow-300">
                      <button
                        type="button"
                        className="hover:underline focus:outline-none"
                        onClick={() => setSelectedDocId(doc.id)}
                      >
                        {doc.number}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-left font-sans text-slate-300 font-semibold">{doc.partner_name}</td>
                    <td className="px-3 py-2 text-left text-xs text-slate-400">{doc.issue_date}</td>
                    <td className="px-3 py-2 text-left text-xs">
                      <span className={doc.is_overdue ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                        {doc.due_date}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-white">{money(doc.total)}</td>
                    <td className="px-3 py-2 text-right font-black text-yellow-200">{money(doc.open)}</td>
                    <td className="px-3 py-2 text-center">{statusBadge(doc)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5 font-sans">
                        {caps.can_write && (doc.status === 'open' || doc.status === 'partially_paid') ? (
                          <button
                            type="button"
                            className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30"
                            onClick={() => setPayDoc(doc)}
                          >
                            {tx(lang, 'Ödə', 'Оплатить', 'Pay')}
                          </button>
                        ) : null}

                        {caps.can_write && doc.status === 'open' ? (
                          <button
                            type="button"
                            className="rounded-lg bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                            onClick={() => setVoidDoc(doc)}
                          >
                            {tx(lang, 'Ləğv', 'Аннулировать', 'Void')}
                          </button>
                        ) : null}

                        {doc.journal_id ? (
                          <button
                            type="button"
                            className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:text-white"
                            onClick={() => openJournal(doc.journal_id!)}
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
      </Card>

      {/* New Bill Dialog */}
      {newBillOpen ? (
        <NewBillDialog
          lang={lang}
          onClose={() => setNewBillOpen(false)}
          onSuccess={() => {
            setNewBillOpen(false);
            bump();
            reload();
          }}
        />
      ) : null}

      {/* Pay Bill Dialog */}
      {payDoc ? (
        <PayBillDialog
          lang={lang}
          doc={payDoc}
          onClose={() => setPayDoc(null)}
          onSuccess={() => {
            setPayDoc(null);
            bump();
            reload();
          }}
        />
      ) : null}

      {/* Bill Detail Dialog */}
      {selectedDocId ? (
        <BillDetailDialog
          lang={lang}
          docId={selectedDocId}
          doc={detailDoc}
          loading={detailLoading}
          onClose={() => setSelectedDocId(null)}
          onOpenJournal={openJournal}
        />
      ) : null}

      {/* Void Dialog */}
      {voidDoc ? (
        <ReasonDialog
          lang={lang}
          title={tx(lang, `Fakturanı ləğv et: ${voidDoc.number}`, `Аннулировать счёт: ${voidDoc.number}`, `Void bill: ${voidDoc.number}`)}
          confirmLabel={tx(lang, 'Ləğv et', 'Аннулировать', 'Void')}
          onCancel={() => setVoidDoc(null)}
          onConfirm={async (reason) => {
            try {
              await glApi.voidDocument(voidDoc.id, reason);
              notify('success', tx(lang, 'Faktura ləğv edildi', 'Счёт аннулирован', 'Bill voided'));
              setVoidDoc(null);
              bump();
              reload();
            } catch (e) {
              notify('error', e instanceof Error ? e.message : 'Error');
            }
          }}
        />
      ) : null}

      {/* Reclassify Unassigned AP Dialog */}
      {reclassOpen ? (
        <ReclassifyAPDialog
          lang={lang}
          onClose={() => setReclassOpen(false)}
          onSuccess={() => {
            setReclassOpen(false);
            bump();
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────── New Bill Dialog ───────────────────────────────

function NewBillDialog({
  lang,
  onClose,
  onSuccess,
}: {
  lang: string;
  onClose: () => void;
  onDrop?: () => void;
  onSuccess: () => void;
}) {
  const { caps, notify } = useGL();
  const [supplierId, setSupplierId] = React.useState('');
  const [number, setNumber] = React.useState('');
  const [issueDate, setIssueDate] = React.useState(caps.business_today);
  const [dueDate, setDueDate] = React.useState(caps.business_today);
  const [total, setTotal] = React.useState('');
  const [expenseAccount, setExpenseAccount] = React.useState('inventory');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId.trim() || !number.trim() || !total.trim()) {
      notify('error', tx(lang, 'Təchizatçı, nömrə və məbləğ vacibdir', 'Заполните обязательные поля', 'Required fields missing'));
      return;
    }
    setSubmitting(true);
    try {
      await glApi.createBill({
        partner_id: supplierId.trim(),
        number: number.trim(),
        issue_date: issueDate,
        due_date: dueDate,
        total: parseFloat(total),
        expense_account: expenseAccount,
        note: note.trim() || undefined,
      });
      notify('success', tx(lang, 'Faktura uğurla yaradıldı', 'Счёт создан', 'Bill created successfully'));
      onSuccess();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title={tx(lang, 'Yeni Alış Fakturası', 'Новый счёт поставщика', 'New Supplier Bill')}
      onClose={onClose}
      labelledBy="gl-create-bill-title"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="bill-sup-id" label={tx(lang, 'Təchizatçı ID / Kodu *', 'ID/Код поставщика *', 'Supplier ID *')}>
            <input
              id="bill-sup-id"
              type="text"
              required
              className={inputCls}
              placeholder="məs. sup-1"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            />
          </Field>

          <Field id="bill-number" label={tx(lang, 'Faktura № *', 'Номер счёта *', 'Bill Number *')}>
            <input
              id="bill-number"
              type="text"
              required
              className={inputCls}
              placeholder="məs. INV-2026-089"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="bill-issue-date" label={tx(lang, 'Verilmə tarixi', 'Дата выписки', 'Issue Date')}>
            <input
              id="bill-issue-date"
              type="date"
              required
              className={inputCls}
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </Field>

          <Field id="bill-due-date" label={tx(lang, 'Son ödəniş tarixi', 'Срок оплаты', 'Due Date')}>
            <input
              id="bill-due-date"
              type="date"
              required
              className={inputCls}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="bill-total" label={tx(lang, 'Məbləğ (AZN) *', 'Сумма (AZN) *', 'Total Amount (AZN) *')}>
            <input
              id="bill-total"
              type="number"
              step="0.01"
              min="0.01"
              required
              className={inputCls}
              placeholder="0.00"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
          </Field>

          <Field id="bill-exp-acc" label={tx(lang, 'Xərc / Anbar Hesabı', 'Счёт списания / ТМЦ', 'Expense / Stock Account')}>
            <select
              id="bill-exp-acc"
              className={inputCls}
              value={expenseAccount}
              onChange={(e) => setExpenseAccount(e.target.value)}
            >
              <option value="inventory">201 · {tx(lang, 'Mallar və Materiallar (Anbar)', 'Товары и материалы', 'Inventory')}</option>
              <option value="general_expense">721 · {tx(lang, 'İnzibati və Əməliyyat Xərcləri', 'Операционные расходы', 'Operating Expenses')}</option>
              <option value="rent_expense">721.2 · {tx(lang, 'İcarə Xərci', 'Аренда', 'Rent')}</option>
              <option value="utilities_expense">721.3 · {tx(lang, 'Kommunal Xərclər', 'Коммунальные', 'Utilities')}</option>
            </select>
          </Field>
        </div>

        <Field id="bill-note" label={tx(lang, 'Qeyd / Təsvir', 'Примечание', 'Note / Description')}>
          <textarea
            id="bill-note"
            rows={2}
            className={inputCls}
            placeholder={tx(lang, 'Məhsul partiyası və ya şərtlər...', 'Детали поставки...', 'Details...')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btn.ghost} onClick={onClose}>
            {tx(lang, 'İmtina', 'Отмена', 'Cancel')}
          </button>
          <button type="submit" disabled={submitting} className={btn.primary}>
            {submitting ? tx(lang, 'Yadda saxlanılır...', 'Сохранение...', 'Saving...') : tx(lang, 'Təsdiqlə və yarat', 'Создать счёт', 'Create bill')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─────────────────────────────── Pay Bill Dialog ───────────────────────────────

function PayBillDialog({
  lang,
  doc,
  onClose,
  onSuccess,
}: {
  lang: string;
  doc: GLDocument;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { caps, notify } = useGL();
  const [amount, setAmount] = React.useState(doc.open);
  const [paidFrom, setPaidFrom] = React.useState('cash_drawer');
  const [postingDate, setPostingDate] = React.useState(caps.business_today);
  const [bankFee, setBankFee] = React.useState('0');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payVal = parseFloat(amount);
    if (!payVal || payVal <= 0 || payVal > parseFloat(doc.open)) {
      notify('error', tx(lang, 'Ödəniş məbləği açıq qalıqdan çox ola bilməz', 'Сумма не может превышать остаток', 'Invalid payment amount'));
      return;
    }
    setSubmitting(true);
    try {
      await glApi.payBill(doc.id, {
        amount: payVal,
        paid_from: paidFrom,
        posting_date: postingDate,
        bank_fee: parseFloat(bankFee) || 0,
        note: note.trim() || undefined,
      });
      notify('success', tx(lang, 'Ödəniş uğurla icra edildi', 'Оплата проведена', 'Payment recorded'));
      onSuccess();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title={tx(lang, `Faktura Üzrə Ödəniş: ${doc.number}`, `Оплата счёта: ${doc.number}`, `Pay Bill: ${doc.number}`)}
      onClose={onClose}
      labelledBy="gl-pay-bill-title"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
          <div className="flex justify-between">
            <span>{tx(lang, 'Təchizatçı:', 'Поставщик:', 'Supplier:')}</span>
            <span className="font-bold text-white">{doc.partner_name}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>{tx(lang, 'Açıq qalıq:', 'Остаток долга:', 'Open balance:')}</span>
            <span className="font-mono font-black text-yellow-300">{money(doc.open)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="pay-amount" label={tx(lang, 'Ödəniş məbləği (AZN) *', 'Сумма оплаты *', 'Payment Amount *')}>
            <input
              id="pay-amount"
              type="number"
              step="0.01"
              min="0.01"
              max={doc.open}
              required
              className={inputCls}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>

          <Field id="pay-wallet" label={tx(lang, 'Haradan ödənilir *', 'Источник списания *', 'Pay from *')}>
            <select
              id="pay-wallet"
              className={inputCls}
              value={paidFrom}
              onChange={(e) => setPaidFrom(e.target.value)}
            >
              <option value="cash_drawer">221 · {tx(lang, 'Kassa (Nağd)', 'Касса', 'Cash Drawer')}</option>
              <option value="bank_main">223 · {tx(lang, 'Bank Hesabı', 'Банковский счёт', 'Bank Account')}</option>
              <option value="safe">221.2 · {tx(lang, 'Seyf', 'Сейф', 'Safe')}</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="pay-date" label={tx(lang, 'Ödəniş tarixi', 'Дата оплаты', 'Payment Date')}>
            <input
              id="pay-date"
              type="date"
              required
              className={inputCls}
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
            />
          </Field>

          <Field id="pay-fee" label={tx(lang, 'Bank komissiyası (əgər varsa)', 'Комиссия банка', 'Bank fee')}>
            <input
              id="pay-fee"
              type="number"
              step="0.01"
              min="0"
              className={inputCls}
              value={bankFee}
              onChange={(e) => setBankFee(e.target.value)}
            />
          </Field>
        </div>

        <Field id="pay-note" label={tx(lang, 'Qeyd', 'Примечание', 'Note')}>
          <input
            id="pay-note"
            type="text"
            className={inputCls}
            placeholder={tx(lang, 'Ödəniş təyinatı...', 'Назначение...', 'Memo...')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btn.ghost} onClick={onClose}>
            {tx(lang, 'İmtina', 'Отмена', 'Cancel')}
          </button>
          <button type="submit" disabled={submitting} className={btn.approve}>
            {submitting ? tx(lang, 'İcra olunur...', 'Проводка...', 'Processing...') : tx(lang, 'Ödənişi təsdiqlə', 'Провести оплату', 'Confirm Payment')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ─────────────────────────────── Bill Detail Dialog ───────────────────────────────

function BillDetailDialog({
  lang,
  docId,
  doc,
  loading,
  onClose,
  onOpenJournal,
}: {
  lang: string;
  docId: string;
  doc: GLDocument | null;
  loading: boolean;
  onClose: () => void;
  onOpenJournal: (id: string) => void;
}) {
  return (
    <Dialog
      title={tx(lang, `Faktura Detalları: ${doc?.number || docId}`, `Детали счёта: ${doc?.number || docId}`, `Bill Details: ${doc?.number || docId}`)}
      onClose={onClose}
      labelledBy="gl-bill-detail-title"
    >
      {loading || !doc ? (
        <Loading lang={lang} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs">
            <div>
              <span className="text-slate-400 block">{tx(lang, 'Təchizatçı', 'Поставщик', 'Supplier')}</span>
              <span className="font-bold text-white text-sm">{doc.partner_name}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{tx(lang, 'Cəmi məbləğ', 'Сумма', 'Total')}</span>
              <span className="font-mono font-bold text-white text-sm">{money(doc.total)}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{tx(lang, 'Açıq qalıq', 'Остаток', 'Open')}</span>
              <span className="font-mono font-black text-yellow-300 text-sm">{money(doc.open)}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{tx(lang, 'Son ödəniş', 'Срок', 'Due date')}</span>
              <span className={`text-sm font-semibold ${doc.is_overdue ? 'text-rose-400' : 'text-slate-200'}`}>
                {doc.due_date}
              </span>
            </div>
          </div>

          {doc.journal_id ? (
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-xs">
              <span className="text-slate-300">{tx(lang, 'Əlaqəli Baş Kitab jurnalı:', 'Связанная проводка GL:', 'Linked GL Journal:')}</span>
              <button
                type="button"
                className="font-mono text-yellow-300 hover:underline font-bold"
                onClick={() => onOpenJournal(doc.journal_id!)}
              >
                {tx(lang, 'Jurnala bax', 'Открыть журнал', 'View journal')} →
              </button>
            </div>
          ) : null}

          {/* Payment allocations list */}
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-2">
              {tx(lang, 'Ödəniş bölgüləri (Allocations)', 'Распределения оплат', 'Payment Allocations')}
            </h4>
            {doc.allocations && doc.allocations.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-slate-900 text-slate-400">
                    <tr>
                      <th className="px-3 py-2 text-left">{tx(lang, 'Ödəniş Jurnalı', 'Проводка', 'Journal')}</th>
                      <th className="px-3 py-2 text-left">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
                      <th className="px-3 py-2 text-right">{tx(lang, 'Məbləğ', 'Сумма', 'Amount')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-slate-200">
                    {doc.allocations.map((a: GLDocumentAllocation) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 text-left text-yellow-300">
                          <button
                            type="button"
                            className="hover:underline"
                            onClick={() => onOpenJournal(a.journal_id)}
                          >
                            {a.journal_no || a.journal_id.slice(0, 8)}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-left text-slate-400">{a.posting_date}</td>
                        <td className="px-3 py-2 text-right font-bold text-emerald-400">{money(a.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-slate-500 italic p-2 border border-dashed border-slate-800 rounded-xl text-center">
                {tx(lang, 'Bu faktura üzrə hələ ödəniş edilməyib.', 'Оплат по счёту пока нет.', 'No payments allocated yet.')}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <button type="button" className={btn.ghost} onClick={onClose}>
              {tx(lang, 'Bağla', 'Закрыть', 'Close')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ─────────────────────────────── Reclassify Unassigned AP Dialog ───────────────

function ReclassifyAPDialog({
  lang,
  onClose,
  onSuccess,
}: {
  lang: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { caps, notify } = useGL();
  const [supplierId, setSupplierId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('Təchizatçı təyini');
  const [postingDate, setPostingDate] = React.useState(caps.business_today);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!supplierId.trim() || !val || val <= 0) {
      notify('error', tx(lang, 'Təchizatçı və məbləğ vacibdir', 'Укажите поставщика и сумму', 'Missing fields'));
      return;
    }
    setSubmitting(true);
    try {
      await glApi.reclassifyUnassignedAP({
        amount: val,
        to_supplier_id: supplierId.trim(),
        reason: reason.trim() || undefined,
        posting_date: postingDate,
      });
      notify('success', tx(lang, 'Borc təchizatçıya uğurla təyin edildi', 'Задолженность переклассифицирована', 'AP reclassified successfully'));
      onSuccess();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title={tx(lang, 'Təyin Edilməmiş Kreditor Borcunu Bölüşdür', 'Переклассификация задолженности (531)', 'Reclassify Unassigned AP')}
      onClose={onClose}
      labelledBy="gl-reclassify-ap-title"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-slate-400">
          {tx(
            lang,
            'Keçmişdə təchizatçısı göstərilməyən anbar mədaxillərinin borcunu (531) xüsusi təchizatçıya yönləndirir. Ümumi balans dəyişmir (0.00 fərq).',
            'Переносит безымянную задолженность по складу (531) на конкретного поставщика. Баланс 531 не меняется.',
            'Reclassifies unassigned historical AP (531) to a designated supplier with zero net change on the control account.'
          )}
        </p>

        <Field id="rec-sup" label={tx(lang, 'Təyin ediləcək Təchizatçı ID *', 'ID поставщика *', 'Target Supplier ID *')}>
          <input
            id="rec-sup"
            type="text"
            required
            className={inputCls}
            placeholder="məs. sup-1"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          />
        </Field>

        <Field id="rec-amt" label={tx(lang, 'Məbləğ (AZN) *', 'Сумма (AZN) *', 'Amount (AZN) *')}>
          <input
            id="rec-amt"
            type="number"
            step="0.01"
            min="0.01"
            required
            className={inputCls}
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>

        <Field id="rec-reason" label={tx(lang, 'Səbəb / Əsaslandırma', 'Основание', 'Reason')}>
          <input
            id="rec-reason"
            type="text"
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btn.ghost} onClick={onClose}>
            {tx(lang, 'İmtina', 'Отмена', 'Cancel')}
          </button>
          <button type="submit" disabled={submitting} className={btn.primary}>
            {submitting ? tx(lang, 'İcra olunur...', 'Проводка...', 'Saving...') : tx(lang, 'Təsdiqlə və böl', 'Перенести', 'Reclassify')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
