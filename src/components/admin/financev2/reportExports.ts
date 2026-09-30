import { tx } from '../../../i18n';
import type { AccountLedger, BalanceSheet, ProfitLoss, StatementSection, Subledger, TrialBalance } from '../../../api/gl';
import type { ExportReport, ExportSection } from './exporters';

const statement = (heading: string, section: StatementSection, lang: string): ExportSection => ({
  heading,
  columns: [tx(lang, 'Hesab', 'Счёт', 'Account'), tx(lang, 'Ad', 'Наименование', 'Name'), tx(lang, 'Məbləğ (₼)', 'Сумма (₼)', 'Amount (₼)')],
  numeric: [2],
  rows: section.lines.map((l) => [l.code, l.name, l.amount]),
  footer: ['', tx(lang, 'Cəmi', 'Итого', 'Total'), section.total],
});

export function balanceSheetReport(lang: string, bs: BalanceSheet): ExportReport {
  return {
    title: tx(lang, 'Balans hesabatı', 'Бухгалтерский баланс', 'Balance sheet'),
    subtitle: `${tx(lang, 'Tarixə', 'На дату', 'As of')} ${bs.as_of}`,
    meta: [bs.balanced ? tx(lang, 'Balanslaşıb', 'Сбалансирован', 'Balanced') : `${tx(lang, 'Fərq', 'Разница', 'Difference')}: ${bs.difference}`],
    fileBase: `balans_${bs.as_of}`,
    sections: [
      statement(tx(lang, 'Aktivlər', 'Активы', 'Assets'), bs.assets, lang),
      statement(tx(lang, 'Öhdəliklər', 'Обязательства', 'Liabilities'), bs.liabilities, lang),
      statement(tx(lang, 'Kapital', 'Капитал', 'Equity'), bs.equity, lang),
      {
        columns: ['', tx(lang, 'Öhdəliklər + kapital', 'Обязательства + капитал', 'Liabilities + equity'), tx(lang, 'Məbləğ (₼)', 'Сумма (₼)', 'Amount (₼)')],
        numeric: [2],
        rows: [['', '', bs.liabilities_and_equity_total]],
      },
    ],
  };
}

export function profitLossReport(lang: string, pl: ProfitLoss): ExportReport {
  const summary: ExportSection = {
    heading: tx(lang, 'Nəticələr', 'Итоги', 'Results'),
    columns: ['', tx(lang, 'Göstərici', 'Показатель', 'Measure'), tx(lang, 'Məbləğ (₼)', 'Сумма (₼)', 'Amount (₼)')],
    numeric: [2],
    rows: [
      ['', tx(lang, 'Ümumi mənfəət', 'Валовая прибыль', 'Gross profit'), pl.gross_profit],
      ['', tx(lang, 'Əməliyyat mənfəəti', 'Операционная прибыль', 'Operating profit'), pl.operating_profit],
      ['', tx(lang, 'Vergidən əvvəl mənfəət', 'Прибыль до налога', 'Profit before tax'), pl.profit_before_tax],
      ['', tx(lang, 'Xalis mənfəət', 'Чистая прибыль', 'Net profit'), pl.net_profit],
    ],
  };
  return {
    title: tx(lang, 'Mənfəət və zərər hesabatı', 'Отчёт о прибылях и убытках', 'Profit and loss'),
    subtitle: `${pl.date_from} — ${pl.date_to}`,
    fileBase: `menfeet_zerer_${pl.date_from}_${pl.date_to}`,
    sections: [
      statement(tx(lang, 'Gəlir', 'Выручка', 'Revenue'), pl.revenue, lang),
      statement(tx(lang, 'Satışın maya dəyəri', 'Себестоимость', 'Cost of sales'), pl.cogs, lang),
      statement(tx(lang, 'Əməliyyat xərcləri', 'Операционные расходы', 'Operating expenses'), pl.operating_expenses, lang),
      statement(tx(lang, 'Digər gəlirlər', 'Прочие доходы', 'Other income'), pl.other_income, lang),
      statement(tx(lang, 'Maliyyə xərcləri', 'Финансовые расходы', 'Finance costs'), pl.finance_costs, lang),
      statement(tx(lang, 'Vergilər', 'Налоги', 'Taxes'), pl.taxes, lang),
      summary,
    ],
  };
}

/** Balance sheet + P&L in one document (the overview tab). */
export function financialStatementsReport(lang: string, bs: BalanceSheet, pl: ProfitLoss): ExportReport {
  const b = balanceSheetReport(lang, bs);
  const p = profitLossReport(lang, pl);
  return {
    title: tx(lang, 'Maliyyə hesabatları', 'Финансовая отчётность', 'Financial statements'),
    subtitle: `${tx(lang, 'Balans', 'Баланс', 'Balance sheet')}: ${bs.as_of} · ${tx(lang, 'Mənfəət/zərər', 'P&L', 'P&L')}: ${pl.date_from} — ${pl.date_to}`,
    fileBase: `maliyye_hesabatlari_${pl.date_from}_${pl.date_to}`,
    sections: [
      ...b.sections.map((s, i) => (i === 0 ? { ...s, heading: `${b.title} · ${s.heading}` } : s)),
      ...p.sections.map((s, i) => (i === 0 ? { ...s, heading: `${p.title} · ${s.heading}` } : s)),
    ],
  };
}

export function trialBalanceReport(lang: string, tb: TrialBalance, rows: TrialBalance['rows']): ExportReport {
  return {
    title: tx(lang, 'Sınaq balansı (dövriyyə cədvəli)', 'Оборотно-сальдовая ведомость', 'Trial balance'),
    subtitle: `${tb.date_from || '…'} — ${tb.date_to || '…'}`,
    meta: [tb.balanced ? tx(lang, 'Balanslaşıb', 'Сбалансирован', 'Balanced') : tx(lang, 'Balanslaşmayıb', 'Не сбалансирован', 'Not balanced')],
    fileBase: `sinaq_balansi_${tb.date_from || 'start'}_${tb.date_to || 'end'}`,
    sections: [{
      columns: [
        tx(lang, 'Hesab', 'Счёт', 'Account'), tx(lang, 'Ad', 'Наименование', 'Name'),
        tx(lang, 'Açılış D', 'Нач. Д', 'Open Dr'), tx(lang, 'Açılış K', 'Нач. К', 'Open Cr'),
        tx(lang, 'Dövriyyə D', 'Оборот Д', 'Period Dr'), tx(lang, 'Dövriyyə K', 'Оборот К', 'Period Cr'),
        tx(lang, 'Son D', 'Кон. Д', 'Close Dr'), tx(lang, 'Son K', 'Кон. К', 'Close Cr'),
      ],
      numeric: [2, 3, 4, 5, 6, 7],
      rows: rows.map((r) => [r.code, r.name, r.opening_debit, r.opening_credit, r.period_debit, r.period_credit, r.closing_debit, r.closing_credit]),
      footer: ['', tx(lang, 'Cəmi', 'Итого', 'Total'), tb.totals.opening_debit, tb.totals.opening_credit, tb.totals.period_debit,
        tb.totals.period_credit, tb.totals.closing_debit, tb.totals.closing_credit],
    }],
  };
}

export function accountLedgerReport(lang: string, led: AccountLedger, from: string, to: string): ExportReport {
  return {
    title: `${tx(lang, 'Hesab kartı', 'Карточка счёта', 'Account ledger')}: ${led.account.code} ${led.account.name}`,
    subtitle: `${from} — ${to}`,
    meta: [
      `${tx(lang, 'Açılış qalığı', 'Начальное сальдо', 'Opening balance')}: ${led.opening_balance}`,
      `${tx(lang, 'Son qalıq', 'Конечное сальдо', 'Closing balance')}: ${led.closing_balance}`,
    ],
    fileBase: `hesab_karti_${led.account.code}_${from}_${to}`,
    sections: [{
      columns: [tx(lang, 'Tarix', 'Дата', 'Date'), tx(lang, 'Jurnal', 'Проводка', 'Journal'), tx(lang, 'Təsvir', 'Описание', 'Description'),
        tx(lang, 'Debet', 'Дебет', 'Debit'), tx(lang, 'Kredit', 'Кредит', 'Credit'), tx(lang, 'Qalıq', 'Сальдо', 'Balance')],
      numeric: [3, 4, 5],
      rows: led.entries.map((e) => [e.posting_date, e.journal_no || e.journal_id, e.memo || e.description, e.debit, e.credit, e.balance]),
    }],
  };
}

export function subledgerReport(lang: string, sl: Subledger): ExportReport {
  const name = sl.ledger === 'ap' ? tx(lang, 'Kreditor borcları', 'Кредиторская задолженность', 'Accounts payable') : tx(lang, 'Debitor borcları', 'Дебиторская задолженность', 'Accounts receivable');
  return {
    title: name,
    subtitle: `${tx(lang, 'Tarixə', 'На дату', 'As of')} ${sl.as_of}`,
    meta: [
      `${sl.control_accounts.map((a) => a.code).join(', ')}: ${sl.control_balance}`,
      sl.reconciled ? tx(lang, 'Nəzarət hesabı ilə uyğundur', 'Сходится с контрольным счётом', 'Matches control account')
        : tx(lang, 'Nəzarət hesabı ilə fərq var', 'Расхождение с контрольным счётом', 'Differs from control account'),
    ],
    fileBase: `${sl.ledger === 'ap' ? 'kreditor' : 'debitor'}_${sl.as_of}`,
    sections: [{
      columns: [tx(lang, 'Tərəf', 'Контрагент', 'Partner'), '0–30', '31–60', '61–90', '90+', tx(lang, 'Avans', 'Аванс', 'Advance'),
        tx(lang, 'Qalıq', 'Сальдо', 'Balance'), tx(lang, 'Ən köhnə', 'Старейший', 'Oldest')],
      numeric: [1, 2, 3, 4, 5, 6],
      rows: sl.partners.map((p) => [p.name || tx(lang, 'Tərəf göstərilməyib', 'Контрагент не указан', 'No partner assigned'),
        p.buckets['0_30'], p.buckets['31_60'], p.buckets['61_90'], p.buckets['90_plus'], p.advance, p.balance, p.oldest_open_date || '']),
      footer: [tx(lang, 'Cəmi', 'Итого', 'Total'), sl.totals['0_30'], sl.totals['31_60'], sl.totals['61_90'], sl.totals['90_plus'],
        sl.totals.advance, sl.totals.balance, ''],
    }],
  };
}
