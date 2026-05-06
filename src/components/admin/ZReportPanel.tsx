import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import { useAppStore } from '../../store';
import { get_sales_summary_live, get_sales_list_live } from '../../api/analytics';
import {
  accept_shift_handover_live,
  close_doner_batch_live,
  get_active_doner_batches_live,
  get_expected_cash,
  get_pending_handover_for_user_live,
  get_shift_handover_users,
  get_shift_handover_users_live,
  refresh_expected_cash,
  refresh_shift_status,
  get_z_report_receipts_live,
  get_yield_waste_logs_live,
  get_shift_handover_history_live,
  get_shift_status,
  handover_shift_live,
  invalidate_report_runtime_cache,
  open_doner_batch_live,
  open_shift,
  YieldBatchRow,
  YieldWasteLogRow,
  save_z_report_receipt_html,
  type ZReportReceiptRecord,
  x_report,
  z_report,
} from '../../api/reports';
import { fetch_finance_anomalies, fetch_finance_balances, get_balance, type FinanceAnomalies } from '../../api/finance';
import { get_settings_live, get_users_live } from '../../api/settings';
import { qzListPrinters, qzPrintHtml } from '../../lib/qz';
import { tx } from '../../i18n';
import { isBackendEnabled } from '../../api/client';
import { formatServerUtcDateTime, localDateInputValue } from '../../lib/time';
import { sanitizeHtmlForIframe } from '../../lib/html_sanitize';

const DEFAULT_PRINT_SETTINGS = { use_qz: false, printer_name: '' };
const DEFAULT_Z_REPORT_RECEIPT_SETTINGS = {
  show_operator: true,
  show_date_range: true,
  show_sales_summary: true,
  show_profit_summary: true,
  show_wage: true,
  show_shift_cash: true,
  show_cash_movements: true,
  show_other_income: true,
  show_other_expense: true,
  show_deposit_summary: true,
  show_cashier_breakdown: true,
  show_counts: true,
};

export default function ZReportPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const today = localDateInputValue();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [xActualCash, setXActualCash] = useState('0');
  const [zActualCash, setZActualCash] = useState('0');
  const [zWage, setZWage] = useState('0');
  const [openingTarget, setOpeningTarget] = useState('100');
  const [openingTopupSource, setOpeningTopupSource] = useState<'safe' | 'card' | 'investor' | 'cash'>('safe');
  const [zReceiptHtml, setZReceiptHtml] = useState<string | null>(null);
  const safeZReceiptHtml = useMemo(() => sanitizeHtmlForIframe(zReceiptHtml), [zReceiptHtml]);
  const [zReceiptHistory, setZReceiptHistory] = useState<ZReportReceiptRecord[]>([]);
  const [zReceiptHistoryLoading, setZReceiptHistoryLoading] = useState(false);
  const [handoverTo, setHandoverTo] = useState('');
  const [handoverActualCash, setHandoverActualCash] = useState('0');
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [shiftStatusState, setShiftStatusState] = useState(get_shift_status(tenant_id));
  const [expectedCashState, setExpectedCashState] = useState<Decimal>(() => get_expected_cash(tenant_id));
  const [summary, setSummary] = useState<any>({ total_revenue: '0', cash_sales: '0', card_sales: '0', ledger_sales_total: '0', gross_sales: '0', void_sales: '0', gross_profit: '0', total_cogs: '0', void_count: 0 });
  const [sales, setSales] = useState<any[]>([]);
  const [handovers, setHandovers] = useState<any[]>([]);
  const [pendingReceived, setPendingReceived] = useState<any | null>(null);
  const [tenantUsers, setTenantUsers] = useState<any[]>([]);
  const [handoverUsersLoading, setHandoverUsersLoading] = useState(false);
  const [currentBalances, setCurrentBalances] = useState<any>({
    cash_balance: '0',
    card_balance: '0',
    debt_balance: '0',
    investor_balance: '0',
    safe_balance: '0',
    deposit_balance: '0',
  });
  const [financeAnomalies, setFinanceAnomalies] = useState<FinanceAnomalies | null>(null);
  const [panelSettings, setPanelSettings] = useState<any>({});
  const [reportRefreshKey, setReportRefreshKey] = useState(0);
  const [salesPageSize, setSalesPageSize] = useState(10);
  const [activeYieldBatches, setActiveYieldBatches] = useState<YieldBatchRow[]>([]);
  const [yieldWasteLogs, setYieldWasteLogs] = useState<YieldWasteLogRow[]>([]);
  const [yieldOpenInventoryName, setYieldOpenInventoryName] = useState('');
  const [yieldOpenMeatType, setYieldOpenMeatType] = useState<'beef' | 'chicken'>('beef');
  const [yieldOpenRawWeight, setYieldOpenRawWeight] = useState('');
  const [yieldOpenNotes, setYieldOpenNotes] = useState('');
  const [yieldCloseValues, setYieldCloseValues] = useState<Record<string, { remaining: string; notes: string }>>({});
  const zReceiptRef = React.useRef<HTMLIFrameElement | null>(null);
  const previousShiftStatusRef = useRef<string>(shiftStatusState.status);
  const refreshTimerRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef(0);
  const printSettings = panelSettings?.print_settings || DEFAULT_PRINT_SETTINGS;
  const yieldSettings = panelSettings?.yield_management_settings;
  const zReportReceiptSettings = panelSettings?.z_report_receipt_settings || DEFAULT_Z_REPORT_RECEIPT_SETTINGS;
  const trackedYieldItems = Array.isArray(yieldSettings?.tracked_items) ? yieldSettings!.tracked_items!.filter((row: any) => row.enabled !== false) : [];

  const carryoverCash = new Decimal(currentBalances.cash_balance || 0);
  const targetCash = new Decimal(openingTarget || '0');
  const requiredTopup = Decimal.max(new Decimal(0), targetCash.minus(carryoverCash));

  const start = useMemo(() => {
    const d = new Date(fromDate);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [fromDate]);

  const end = useMemo(() => {
    const d = new Date(toDate);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, [toDate]);

  const loadZReceiptHistory = useCallback(async () => {
    setZReceiptHistoryLoading(true);
    try {
      const rows = await get_z_report_receipts_live(tenant_id, {
        date_from: start,
        date_to: end,
        limit: 30,
      });
      setZReceiptHistory(Array.isArray(rows) ? rows : []);
    } catch {
      setZReceiptHistory([]);
    } finally {
      setZReceiptHistoryLoading(false);
    }
  }, [tenant_id, start, end]);

  const shiftStatus = shiftStatusState;
  const latestReceived = handovers.find((h) => h.received_by === user?.username && String(h.status || '').toUpperCase() === 'ACCEPTED');
  const expectedCashNow = expectedCashState;
  const activeShiftOwner = String(shiftStatus.opened_by || '');
  const staffSessionOpen = Boolean((shiftStatus as any).staff_session_open);
  const canOpenOrJoinShift = shiftStatus.status !== 'Open' || !staffSessionOpen;
  const selectedReceiver = tenantUsers.find((u) => u.username === handoverTo);
  const availableReceivers = tenantUsers.filter((u) => u.username !== user?.username);
  const visibleSales = useMemo(() => sales.slice(0, salesPageSize), [sales, salesPageSize]);
  const cashierBreakdown = useMemo(() => {
    const map = new Map<string, { salesCount: number; total: Decimal; cash: Decimal; card: Decimal }>();
    sales.forEach((sale: any) => {
      const key = String(sale.cashier || '-');
      const current = map.get(key) || {
        salesCount: 0,
        total: new Decimal(0),
        cash: new Decimal(0),
        card: new Decimal(0),
      };
      const total = new Decimal(sale.total || 0);
      const splitCash = new Decimal(sale.split_cash || 0);
      const splitCard = new Decimal(sale.split_card || 0);
      current.salesCount += 1;
      current.total = current.total.plus(total);
      if (splitCash.greaterThan(0) || splitCard.greaterThan(0)) {
        current.cash = current.cash.plus(splitCash);
        current.card = current.card.plus(splitCard);
      } else if (String(sale.payment_method || '').toLowerCase().includes('kart') || String(sale.payment_method || '').toLowerCase().includes('card')) {
        current.card = current.card.plus(total);
      } else {
        current.cash = current.cash.plus(total);
      }
      map.set(key, current);
    });
    return Array.from(map.entries())
      .map(([cashier, stats]) => ({ cashier, ...stats }))
      .sort((a, b) => b.total.minus(a.total).toNumber());
  }, [sales]);
  const yieldEnabled = Boolean(yieldSettings?.enabled);
  const totalYieldFlags = useMemo(() => yieldWasteLogs.filter((row) => row.flagged).length, [yieldWasteLogs]);
  const zAuditExceptions = useMemo(() => {
    const items: Array<{ title: string; body: string; tone: 'rose' | 'amber' | 'sky' }> = [];
    const cashBalance = new Decimal(currentBalances.cash_balance || 0);
    const depositLiability = new Decimal(financeAnomalies?.deposit_balance || currentBalances.deposit_balance || 0);
    const shiftCashGap = financeAnomalies
      ? new Decimal(financeAnomalies.shift_cash_gap || 0)
      : cashBalance.minus(expectedCashNow).abs();

    if ((financeAnomalies?.has_shift_cash_mismatch || shiftStatus.status === 'Open') && shiftCashGap.greaterThan(0.01)) {
      items.push({
        title: tx(lang, 'Shift kassa fərqi', 'Разница кассы по смене', 'Shift cash mismatch'),
        body: tx(
          lang,
          `Olmalı kassa ilə cari cash wallet arasında ${shiftCashGap.toFixed(2)} ₼ fərq var.`,
          `Между ожидаемой кассой и текущим cash wallet есть расхождение ${shiftCashGap.toFixed(2)} ₼.`,
          `There is a ${shiftCashGap.toFixed(2)} ₼ gap between expected cash and current cash wallet.`,
        ),
        tone: 'rose',
      });
    }
    if (depositLiability.greaterThan(cashBalance)) {
      items.push({
        title: tx(lang, 'Depozit öhdəliyi kassadan çoxdur', 'Обязательство по депозитам выше кассы', 'Deposit liability exceeds cash'),
        body: tx(
          lang,
          `Aktiv depozit öhdəliyi kassadakı nağddan ${depositLiability.minus(cashBalance).toFixed(2)} ₼ çoxdur.`,
          `Активное обязательство по депозитам на ${depositLiability.minus(cashBalance).toFixed(2)} ₼ выше наличности в кассе.`,
          `Active deposit liability exceeds cash drawer by ${depositLiability.minus(cashBalance).toFixed(2)} ₼.`,
        ),
        tone: 'amber',
      });
    }
    if ((financeAnomalies?.has_closed_shift_open_deposit || shiftStatus.status === 'Closed') && depositLiability.greaterThan(0)) {
      items.push({
        title: tx(lang, 'Bağlı növbədə açıq depozit var', 'При закрытой смене есть активный депозит', 'Closed shift has active deposits'),
        body: tx(
          lang,
          `Növbə bağlı olsa da ${depositLiability.toFixed(2)} ₼ aktiv depozit öhdəliyi qalır.`,
          `Смена закрыта, но остается активное обязательство по депозитам ${depositLiability.toFixed(2)} ₼.`,
          `The shift is closed but ${depositLiability.toFixed(2)} ₼ of active deposit liability remains.`,
        ),
        tone: 'sky',
      });
    }
    return items;
  }, [currentBalances.cash_balance, currentBalances.deposit_balance, expectedCashNow, financeAnomalies, lang, shiftStatus.status]);

  const buildZReceiptHtml = (result: any) => {
    const expectedCash = new Decimal(result?.expected_cash || 0);
    const actualCash = new Decimal(result?.actual_cash || zActualCash || 0);
    const closingDifference = actualCash.minus(expectedCash);
    const cashSales = new Decimal(result?.cash_sales ?? summary.cash_sales ?? 0);
    const cardSales = new Decimal(result?.card_sales ?? summary.card_sales ?? 0);
    const totalSales = cashSales.plus(cardSales);
    const voidSales = new Decimal(result?.void_sales ?? summary.void_sales ?? 0);
    const depositCollected = new Decimal(result?.deposit_total || 0);
    const activeDepositLiability = new Decimal(currentBalances.deposit_balance || 0);
    const otherIncomeTotal = new Decimal(result?.other_income_total || 0);
    const otherExpenseTotal = new Decimal(result?.other_expense_total || 0);
    const otherIncomeLines = Array.isArray(result?.other_income_lines) ? result.other_income_lines : [];
    const otherExpenseLines = Array.isArray(result?.other_expense_lines) ? result.other_expense_lines : [];
    const cashierRows = cashierBreakdown
      .map((row) => `
        <div class="line"><span>${row.cashier} (${row.salesCount})</span><span>${row.total.toFixed(2)} ₼</span></div>
        <div class="muted">cash ${row.cash.toFixed(2)} ₼ • card ${row.card.toFixed(2)} ₼</div>
      `)
      .join('');
    return `
      <html>
        <head>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: Inter, Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
            .line { display:flex; justify-content:space-between; gap:8px; margin: 2px 0; }
            .muted { color:#555; font-size:11px; }
            .bold { font-weight: 700; }
            .section-title { margin-top: 8px; font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; }
            hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
          </style>
        </head>
        <body>
          <div class="bold" style="font-size:15px">iRonWaves POS</div>
          <div class="line"><span>Z-Hesabat</span><span>${new Date().toLocaleDateString()}</span></div>
          ${zReportReceiptSettings.show_operator ? `<div class="line"><span>Operator</span><span>${user?.username || '-'}</span></div>` : ''}
          ${zReportReceiptSettings.show_date_range ? `<div class="line"><span>Aralıq</span><span>${fromDate} - ${toDate}</span></div>` : ''}
          <hr />
          ${zReportReceiptSettings.show_sales_summary ? `
            <div class="section-title">Satış xülasəsi</div>
            <div class="line"><span>Ümumi Satış</span><span>${totalSales.toFixed(2)} ₼</span></div>
            <div class="line"><span>Nağd Satış</span><span>${cashSales.toFixed(2)} ₼</span></div>
            <div class="line"><span>Kart Satış</span><span>${cardSales.toFixed(2)} ₼</span></div>
            ${voidSales.gt(0) ? `<div class="line"><span>Void/Cancel</span><span>${voidSales.toFixed(2)} ₼</span></div>` : ''}
          ` : `
            <div class="section-title">Ödəniş bölgüsü</div>
            <div class="line"><span>Nağd Satış</span><span>${cashSales.toFixed(2)} ₼</span></div>
            <div class="line"><span>Kart Satış</span><span>${cardSales.toFixed(2)} ₼</span></div>
            ${voidSales.gt(0) ? `<div class="line"><span>Void/Cancel</span><span>${voidSales.toFixed(2)} ₼</span></div>` : ''}
          `}
          ${zReportReceiptSettings.show_profit_summary ? `
            <div class="section-title">Mənfəət xülasəsi</div>
            <div class="line"><span>Maya (COGS)</span><span>${new Decimal(summary.total_cogs || 0).toFixed(2)} ₼</span></div>
            <div class="line"><span>Brutto Mənfəət</span><span>${new Decimal(summary.gross_profit || 0).toFixed(2)} ₼</span></div>
          ` : ''}
          ${zReportReceiptSettings.show_wage ? `<div class="line"><span>Maaş Çıxışı</span><span>${new Decimal(result?.wage_amount || result?.wage || zWage || 0).toFixed(2)} ₼</span></div>` : ''}
          ${zReportReceiptSettings.show_shift_cash ? `
            <div class="section-title">Kassa bağlanışı</div>
            <div class="line"><span>Növbə Açılışı</span><span>${new Decimal(result?.opening_cash || 0).toFixed(2)} ₼</span></div>
            <div class="line"><span>Olmalı kassa</span><span>${expectedCash.toFixed(2)} ₼</span></div>
            <div class="line"><span>Faktiki bağlanış</span><span>${new Decimal(result?.actual_cash || zActualCash || 0).toFixed(2)} ₼</span></div>
            <div class="line"><span>Bağlanış fərqi</span><span>${closingDifference.toFixed(2)} ₼</span></div>
          ` : ''}
          ${zReportReceiptSettings.show_cash_movements ? `
            <div class="section-title">Kassa hərəkətləri</div>
            <div class="line"><span>Kassa girişləri</span><span>${new Decimal(result?.cash_movements_in || 0).toFixed(2)} ₼</span></div>
            <div class="line"><span>Kassa çıxışları</span><span>${new Decimal(result?.cash_movements_out || 0).toFixed(2)} ₼</span></div>
          ` : ''}
          ${zReportReceiptSettings.show_other_income ? `
            <div class="section-title">Digər giriş pulları</div>
            <div class="line"><span>Cəmi</span><span>${otherIncomeTotal.toFixed(2)} ₼</span></div>
            ${otherIncomeLines.length ? otherIncomeLines.map((row: any) => `<div class="line"><span>${row.label}</span><span>${new Decimal(row.amount || 0).toFixed(2)} ₼</span></div>`).join('') : '<div class="muted">Bu dövrdə əlavə giriş yoxdur</div>'}
          ` : ''}
          ${zReportReceiptSettings.show_other_expense ? `
            <div class="section-title">Digər xərclər</div>
            <div class="line"><span>Cəmi</span><span>${otherExpenseTotal.toFixed(2)} ₼</span></div>
            ${otherExpenseLines.length ? otherExpenseLines.map((row: any) => `<div class="line"><span>${row.label}</span><span>${new Decimal(row.amount || 0).toFixed(2)} ₼</span></div>`).join('') : '<div class="muted">Bu dövrdə əlavə xərc yoxdur</div>'}
          ` : ''}
          ${zReportReceiptSettings.show_deposit_summary ? `
            <div class="section-title">Depozit xülasəsi</div>
            <div class="line"><span>Bu növbədə toplanan depozit</span><span>${depositCollected.toFixed(2)} ₼</span></div>
            <div class="line"><span>Aktiv depozit öhdəliyi</span><span>${activeDepositLiability.toFixed(2)} ₼</span></div>
            <div class="muted">Depozit ayrıca öhdəlik kimi izlənir, satış gəliri sayılmır.</div>
          ` : ''}
          ${zReportReceiptSettings.show_cashier_breakdown ? `
            <hr />
            <div class="section-title">Kassir Breakdown</div>
            ${cashierRows || '<div class="muted">Kassir fəaliyyəti yoxdur</div>'}
          ` : ''}
          ${zReportReceiptSettings.show_counts ? `
            <hr />
            <div class="line"><span>Satış sayı</span><span>${sales.length}</span></div>
            <div class="line"><span>Void sayı</span><span>${summary.void_count || 0}</span></div>
          ` : ''}
        </body>
      </html>
    `;
  };

  const refreshOperationalState = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastRefreshAtRef.current < 1500) {
      return;
    }
    lastRefreshAtRef.current = now;
    const [status, cash, nextHandovers, nextPending, balances, anomalies] = await Promise.all([
      refresh_shift_status(tenant_id),
      refresh_expected_cash(tenant_id),
      get_shift_handover_history_live(tenant_id, user?.username || undefined),
      get_pending_handover_for_user_live(tenant_id, user?.username || ''),
      fetch_finance_balances(tenant_id),
      fetch_finance_anomalies(tenant_id).catch(() => null),
    ]);
    setShiftStatusState(status);
    setExpectedCashState(cash);
    setHandovers(nextHandovers);
    setPendingReceived(nextPending);
    setCurrentBalances(balances);
    setFinanceAnomalies(anomalies);
  }, [tenant_id, user?.username]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const settings = await get_settings_live(tenant_id);
        if (!mounted) return;
        setPanelSettings(settings || {});
      } catch {
        if (!mounted) return;
        setPanelSettings({});
      }
    })();
    return () => {
      mounted = false;
    };
  }, [tenant_id]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [status, cash, nextHandovers, nextPending, balances, anomalies] = await Promise.all([
          refresh_shift_status(tenant_id),
          refresh_expected_cash(tenant_id),
          get_shift_handover_history_live(tenant_id, user?.username || undefined),
          get_pending_handover_for_user_live(tenant_id, user?.username || ''),
          fetch_finance_balances(tenant_id),
          fetch_finance_anomalies(tenant_id).catch(() => null),
        ]);
        if (!mounted) return;
        lastRefreshAtRef.current = Date.now();
        setShiftStatusState(status);
        setExpectedCashState(cash);
        setHandovers(nextHandovers);
        setPendingReceived(nextPending);
        setCurrentBalances(balances);
        setFinanceAnomalies(anomalies);
      } catch {
        // Keep cached/local fallback.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [tenant_id, summary.total_revenue, reportRefreshKey, user?.username]);

  React.useEffect(() => {
    let mounted = true;
    setHandoverUsersLoading(true);
    setTenantUsers([]);
    (async () => {
      try {
        const rows = await get_shift_handover_users_live(tenant_id);
        if (!mounted) return;
        setTenantUsers(rows);
      } catch {
        if (!mounted) return;
        if (isBackendEnabled()) {
          try {
            const fallbackRows = await get_users_live(tenant_id);
            if (!mounted) return;
            setTenantUsers(
              fallbackRows.filter((u) => ['staff', 'manager', 'admin'].includes(String(u.role || '').toLowerCase()))
            );
          } catch {
            setTenantUsers([]);
            notify('error', tx(lang, 'Təhvil üçün istifadəçi siyahısı yüklənmədi', 'Не удалось загрузить список пользователей для передачи', 'Failed to load handover user list'));
          }
        } else {
          setTenantUsers(get_shift_handover_users(tenant_id));
        }
      } finally {
        if (mounted) {
          setHandoverUsersLoading(false);
        }
      }
    })();
    const refreshUsers = () => {
      void (async () => {
        try {
          setHandoverUsersLoading(true);
          const rows = await get_shift_handover_users_live(tenant_id);
          setTenantUsers(rows);
        } catch {
          if (isBackendEnabled()) {
            try {
              const fallbackRows = await get_users_live(tenant_id);
              setTenantUsers(
                fallbackRows.filter((u) => ['staff', 'manager', 'admin'].includes(String(u.role || '').toLowerCase()))
              );
            } catch {
              setTenantUsers([]);
            }
          } else {
            setTenantUsers(get_shift_handover_users(tenant_id));
          }
        } finally {
          setHandoverUsersLoading(false);
        }
      })();
    };
    window.addEventListener('focus', refreshUsers);
    window.addEventListener('settings-users-updated', refreshUsers as EventListener);
    return () => {
      mounted = false;
      window.removeEventListener('focus', refreshUsers);
      window.removeEventListener('settings-users-updated', refreshUsers as EventListener);
    };
  }, [tenant_id]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [nextSummary, nextSales] = await Promise.all([
          get_sales_summary_live(tenant_id, start, end, user?.role === 'staff' ? user.username : undefined),
          get_sales_list_live(tenant_id, start, end, user?.role === 'staff' ? user.username : undefined),
        ]);
        if (!mounted) return;
        setSummary(nextSummary || { total_revenue: '0', cash_sales: '0', card_sales: '0', ledger_sales_total: '0', gross_sales: '0', void_sales: '0', gross_profit: '0', total_cogs: '0', void_count: 0 });
        setSales(nextSales || []);
      } catch {
        if (!mounted) return;
        setSummary({ total_revenue: '0', cash_sales: '0', card_sales: '0', ledger_sales_total: '0', gross_sales: '0', void_sales: '0', gross_profit: '0', total_cogs: '0', void_count: 0 });
        setSales([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [tenant_id, start, end, user?.role, user?.username, reportRefreshKey]);

  React.useEffect(() => {
    void loadZReceiptHistory();
  }, [loadZReceiptHistory, reportRefreshKey]);

  React.useEffect(() => {
    let mounted = true;
    if (!yieldEnabled) {
      setActiveYieldBatches([]);
      setYieldWasteLogs([]);
      return;
    }
    (async () => {
      try {
        const [batches, wasteRows] = await Promise.all([
          get_active_doner_batches_live(tenant_id),
          get_yield_waste_logs_live(tenant_id),
        ]);
        if (!mounted) return;
        setActiveYieldBatches(batches || []);
        setYieldWasteLogs(wasteRows || []);
      } catch {
        if (!mounted) return;
        setActiveYieldBatches([]);
        setYieldWasteLogs([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [tenant_id, reportRefreshKey, yieldEnabled]);

  React.useEffect(() => {
    const onFocusRefresh = () => {
      setReportRefreshKey((prev) => prev + 1);
      void refreshOperationalState(true);
    };
    const onRuntimeRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      if (detail?.tenant_id && detail.tenant_id !== tenant_id) return;
      invalidate_report_runtime_cache(tenant_id);
      const optimisticBalances = get_balance(tenant_id, 'all', false) as any;
      const optimisticCash = get_expected_cash(tenant_id);
      setCurrentBalances(optimisticBalances);
      setExpectedCashState(optimisticCash);
      const nextCash = optimisticCash.toFixed(2);
      if (shiftStatusState.status === 'Open') {
        setXActualCash(nextCash);
        setZActualCash(nextCash);
        setHandoverActualCash(nextCash);
      }
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        void refreshOperationalState(true);
      }, 350);
      setReportRefreshKey((prev) => prev + 1);
    };
    window.addEventListener('focus', onFocusRefresh);
    window.addEventListener('finance-updated', onRuntimeRefresh as EventListener);
    window.addEventListener('reports-updated', onRuntimeRefresh as EventListener);
    const timer = window.setInterval(() => {
      setReportRefreshKey((prev) => prev + 1);
    }, 30000);
    return () => {
      window.removeEventListener('focus', onFocusRefresh);
      window.removeEventListener('finance-updated', onRuntimeRefresh as EventListener);
      window.removeEventListener('reports-updated', onRuntimeRefresh as EventListener);
      window.clearInterval(timer);
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, [tenant_id, shiftStatusState.status, refreshOperationalState, expectedCashNow]);

  React.useEffect(() => {
    const fallback = expectedCashNow.toFixed(2);
    setXActualCash((prev) => (prev === '0' ? fallback : prev));
    setZActualCash((prev) => (prev === '0' ? fallback : prev));
    setHandoverActualCash((prev) => (prev === '0' ? fallback : prev));
  }, [expectedCashNow]);

  React.useEffect(() => {
    const previous = previousShiftStatusRef.current;
    if (shiftStatus.status === 'Open' && previous !== 'Open') {
      const next = expectedCashNow.toFixed(2);
      setXActualCash(next);
      setZActualCash(next);
      setHandoverActualCash(next);
    }
    if (shiftStatus.status === 'Closed' && previous !== 'Closed') {
      setXActualCash('0');
      setZActualCash('0');
      setHandoverActualCash('0');
    }
    previousShiftStatusRef.current = shiftStatus.status;
  }, [shiftStatus.status, expectedCashNow]);

  const handleX = async () => {
    if (!xActualCash) return;
    try {
      const res = await x_report(xActualCash, user?.username || 'staff', tenant_id);
      const cash = await refresh_expected_cash(tenant_id).catch(() => expectedCashNow);
      await refreshOperationalState(true).catch(() => undefined);
      setReportRefreshKey((prev) => prev + 1);
      notify('success', tx(lang, `X-Hesabat tamamlandı. Fərq: ${res.difference} ₼`, `X-отчет завершен. Разница: ${res.difference} ₼`, `X report completed. Difference: ${res.difference} ₼`));
    } catch (e: any) {
      notify('error', tx(lang, `Xəta: ${e.message}`, `Ошибка: ${e.message}`, `Error: ${e.message}`));
    }
  };

  const handleOpenDay = async () => {
    try {
      const wasOpenBefore = shiftStatus.status === 'Open';
      const res = await open_shift(user?.username || 'staff', tenant_id, {
        opening_cash: targetCash.toFixed(2),
        funding_source: openingTopupSource,
        target_cash: targetCash.toFixed(2),
        topup_amount: requiredTopup.toFixed(2),
      });
      const cash = await refresh_expected_cash(tenant_id).catch(() => expectedCashNow);
      await refreshOperationalState(true).catch(() => undefined);
      const nextCash = cash.toFixed(2);
      setXActualCash(nextCash);
      setZActualCash(nextCash);
      setHandoverActualCash(nextCash);
      setReportRefreshKey((prev) => prev + 1);

      const joinedExistingShift = Boolean((res as any)?.already_open || wasOpenBefore);
      notify(
        'success',
        joinedExistingShift
          ? tx(lang, 'Növbəyə qoşuldunuz', 'Вы подключились к смене', 'You joined the shift')
          : tx(lang, 'Gün açıldı', 'День открыт', 'Day opened'),
      );
      if (!joinedExistingShift) {
        notify('info', tx(lang, 'Xahiş edirik, gün sonu Z-Hesabatla növbəni bağlamağı unutmayın.', 'Пожалуйста, не забудьте закрыть смену через Z-отчет в конце дня.', 'Please close the shift with Z Report at the end of day.'));
      }
    } catch (e: any) {
      notify('error', tx(lang, `Xəta: ${e.message}`, `Ошибка: ${e.message}`));
    }
  };

  const showAndPersistZReceipt = async (result: any) => {
    const receiptHtml = buildZReceiptHtml(result);
    setZReceiptHtml(receiptHtml);
    const shiftId = String(result?.shift_id || '').trim();
    if (shiftId) {
      await save_z_report_receipt_html(tenant_id, shiftId, receiptHtml, {
        closed_at: String(result?.closed_at || new Date().toISOString()),
        closed_by: user?.username || 'admin',
        actual_cash: String(result?.actual_cash || zActualCash || '0'),
        cash_variance: String(result?.difference || '0'),
      }).catch(() => undefined);
      void loadZReceiptHistory();
    }
  };

  const handleZ = async () => {
    if (!zActualCash) return;
    const runZReport = async (allowOpenDepositClose = false) =>
      z_report(zActualCash, zWage || '0', user?.username || 'admin', tenant_id, { allowOpenDepositClose });
    try {
      const result = await runZReport(false);
      await showAndPersistZReceipt(result);
      await refreshOperationalState(true).catch(() => undefined);
      setXActualCash('0');
      setZActualCash('0');
      setHandoverActualCash('0');
      setReportRefreshKey((prev) => prev + 1);
      notify('success', tx(lang, 'Z-Hesabat yaradıldı', 'Z-отчет создан'));
      if (result.email_sent) {
        notify('success', tx(lang, 'Z hesabat e-mail ilə göndərildi', 'Z-отчет отправлен по e-mail', 'Z report email sent'));
      } else if (result.email_error) {
        notify('info', tx(lang, `Email göndərilmədi: ${result.email_error}`, `Email не отправлен: ${result.email_error}`, `Email not sent: ${result.email_error}`));
      }
    } catch (e: any) {
      const message = String(e?.message || '');
      const isOpenDepositBlock = /açıq depozit öhdəliyi|active deposit|open deposit/i.test(message);
      if (isOpenDepositBlock) {
        const confirmed = window.confirm(
          tx(
            lang,
            'Açıq depozit öhdəliyi var. Buna baxmayaraq növbəni bağlamaq istəyirsiniz?',
            'Есть открытое обязательство по депозитам. Все равно закрыть смену?',
            'There is open deposit liability. Close the shift anyway?',
          ),
        );
        if (!confirmed) {
          notify(
            'info',
            tx(
              lang,
              'Bağlanış dayandırıldı. Əvvəl depozit öhdəliklərini bağlayın.',
              'Закрытие отменено. Сначала закройте депозитные обязательства.',
              'Close canceled. Resolve deposit liabilities first.',
            ),
          );
          return;
        }
        try {
          const result = await runZReport(true);
          await showAndPersistZReceipt(result);
          await refreshOperationalState(true).catch(() => undefined);
          setXActualCash('0');
          setZActualCash('0');
          setHandoverActualCash('0');
          setReportRefreshKey((prev) => prev + 1);
          notify('success', tx(lang, 'Z-Hesabat təsdiqlə bağlandı', 'Z-отчет закрыт с подтверждением', 'Z report closed with confirmation'));
          return;
        } catch (retryErr: any) {
          notify('error', tx(lang, `Xəta: ${retryErr?.message || retryErr}`, `Ошибка: ${retryErr?.message || retryErr}`));
          return;
        }
      }
      notify('error', tx(lang, `Xəta: ${message}`, `Ошибка: ${message}`));
    }
  };

  const handleOpenYieldBatch = async () => {
    if (!yieldOpenInventoryName || !yieldOpenRawWeight) {
      notify('error', tx(lang, 'İnventar və çiy çəki yazın', 'Укажите инвентарь и сырой вес', 'Enter inventory and raw weight'));
      return;
    }
    try {
      await open_doner_batch_live({
        inventory_name: yieldOpenInventoryName,
        meat_type: yieldOpenMeatType,
        raw_weight_kg: yieldOpenRawWeight,
        raw_to_ready_ratio: String(
          trackedYieldItems.find((row: any) => row.inventory_name === yieldOpenInventoryName)?.raw_to_ready_ratio ||
            (yieldOpenMeatType === 'chicken' ? yieldSettings?.profiles?.chicken?.raw_to_ready_ratio : yieldSettings?.profiles?.beef?.raw_to_ready_ratio) ||
            1,
        ),
        notes: yieldOpenNotes,
      });
      setYieldOpenRawWeight('');
      setYieldOpenNotes('');
      setReportRefreshKey((prev) => prev + 1);
      notify('success', tx(lang, 'Şiş açıldı', 'Шампур открыт', 'Batch opened'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Şiş açılmadı', 'Не удалось открыть batch', 'Failed to open batch'));
    }
  };

  const handleCloseYieldBatch = async (batch: YieldBatchRow) => {
    const form = yieldCloseValues[batch.id] || { remaining: '', notes: '' };
    if (form.remaining === '') {
      notify('error', tx(lang, 'Qalan çiy çəkini yazın', 'Укажите оставшийся сырой вес', 'Enter remaining raw weight'));
      return;
    }
    try {
      const result = await close_doner_batch_live(batch.id, {
        actual_remaining_raw_weight_kg: form.remaining,
        notes: form.notes,
      });
      setYieldCloseValues((prev) => {
        const next = { ...prev };
        delete next[batch.id];
        return next;
      });
      setReportRefreshKey((prev) => prev + 1);
      notify(
        result.flagged ? 'error' : 'success',
        result.flagged
          ? tx(lang, `Şübhəli fərq aşkarlandı: ${result.variance_percent}%`, `Обнаружено подозрительное отклонение: ${result.variance_percent}%`, `Flagged variance detected: ${result.variance_percent}%`)
          : tx(lang, 'Şiş uğurla bağlandı', 'Batch успешно закрыт', 'Batch closed successfully'),
      );
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Şiş bağlanmadı', 'Не удалось закрыть batch', 'Failed to close batch'));
    }
  };

  const handleHandover = async () => {
    if (!handoverTo) {
      notify('error', tx(lang, 'Təhvil alan işçini seçin', 'Выберите сотрудника для передачи'));
      return;
    }
    if (handoverTo === user?.username) {
      notify('error', tx(lang, 'Smeni özünüzə təhvil verə bilməzsiniz', 'Нельзя передать смену самому себе', 'You cannot hand over the shift to yourself'));
      return;
    }
    if (!handoverActualCash) {
      notify('error', tx(lang, 'Faktiki nağdı daxil edin', 'Введите фактическую наличность'));
      return;
    }
    try {
      await handover_shift_live(tenant_id, user?.username || 'staff', handoverTo, handoverActualCash);
      await refreshOperationalState(true).catch(() => undefined);
      notify('success', tx(lang, `Smena ${handoverTo} istifadəçisinə təhvil verildi`, `Смена передана пользователю ${handoverTo}`));
      notify('info', tx(lang, 'Qəbul edən əməkdaş smenanı təsdiqləməlidir.', 'Принимающий сотрудник должен подтвердить смену.'));
    } catch (e: any) {
      notify('error', tx(lang, `Xəta: ${e.message}`, `Ошибка: ${e.message}`));
    }
  };

  const handleAcceptHandover = async () => {
    if (!pendingReceived?.id) return;
    if (!handoverActualCash) {
      notify('error', tx(lang, 'Faktiki nağdı daxil edin', 'Введите фактическую наличность'));
      return;
    }
    try {
      const res = await accept_shift_handover_live(
        tenant_id,
        pendingReceived.id,
        user?.username || 'staff',
        handoverActualCash,
      );
      await refreshOperationalState(true).catch(() => undefined);
      notify('success', tx(lang, 'Smena qəbul edildi', 'Смена принята'));
      notify('info', tx(lang, `Fərq: ${res.difference} ₼`, `Разница: ${res.difference} ₼`));
    } catch (e: any) {
      notify('error', tx(lang, `Xəta: ${e.message}`, `Ошибка: ${e.message}`));
    }
  };

  const printZReceiptOnly = async () => {
    if (printSettings.use_qz && safeZReceiptHtml) {
      try {
        await qzPrintHtml(safeZReceiptHtml, printSettings.printer_name);
        notify('success', tx(lang, 'QZ Tray ilə çap göndərildi', 'Печать отправлена через QZ Tray'));
        return;
      } catch (e: any) {
        notify('error', tx(lang, `QZ çap alınmadı, brauzerə keçilir: ${e.message || e}`, `QZ печать не удалась, переход к печати браузера: ${e.message || e}`));
      }
    }
    const frame = zReceiptRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  const handleListPrinters = async () => {
    setLoadingPrinters(true);
    try {
      const printers = await qzListPrinters();
      setAvailablePrinters(printers);
      if (printers.length === 0) {
        notify('info', tx(lang, 'Printer tapılmadı. QZ Tray açıq və printer qoşulu olmalıdır.', 'Принтеры не найдены. Убедитесь, что QZ Tray запущен и принтер подключен.', 'No printers found. Ensure QZ Tray is running and printer is connected.'));
      } else {
        notify('success', tx(lang, `${printers.length} printer tapıldı`, `Найдено принтеров: ${printers.length}`, `${printers.length} printers found`));
      }
    } catch (e: any) {
      notify('error', tx(lang, `Printer siyahısı alınmadı: ${e?.message || e}`, `Не удалось получить список принтеров: ${e?.message || e}`, `Failed to list printers: ${e?.message || e}`));
    } finally {
      setLoadingPrinters(false);
    }
  };

  const summaryCashSales = useMemo(() => new Decimal(summary.cash_sales || 0), [summary.cash_sales]);
  const summaryCardSales = useMemo(() => new Decimal(summary.card_sales || 0), [summary.card_sales]);
  const summaryNetSales = useMemo(() => {
    if (summary.ledger_sales_total !== undefined && summary.ledger_sales_total !== null) {
      return new Decimal(summary.ledger_sales_total || 0);
    }
    return summaryCashSales.plus(summaryCardSales);
  }, [summary.ledger_sales_total, summaryCashSales, summaryCardSales]);

  if (zReceiptHtml) {
    return (
      <div className="h-full w-full overflow-y-auto bg-[#121922] p-4 md:p-6">
        <div className="mx-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#101722]">
          <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-4 md:px-5">
            <h3 className="text-lg font-semibold text-slate-100">{tx(lang, 'Yekun Z-Hesabat Çeki', 'Итоговый чек Z-отчета')}</h3>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-4 md:p-5">
            <iframe
              ref={zReceiptRef}
              title="z-report-receipt"
              srcDoc={safeZReceiptHtml}
              sandbox="allow-same-origin allow-modals allow-popups"
              className="h-full min-h-[60vh] w-full rounded-lg bg-white"
            />
          </div>
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-700/70 bg-[#101722] px-4 py-4 md:px-5">
            <button onClick={() => setZReceiptHtml(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">
              {tx(lang, 'Bağla', 'Закрыть')}
            </button>
            <button onClick={printZReceiptOnly} className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-slate-900">
              {tx(lang, 'Çap Et', 'Печать')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">{tx(lang, 'Z-Hesabat Paneli', 'Панель Z-отчета')}</h2>
        {printSettings.use_qz && (
          <div className="w-full rounded-xl border border-slate-700/70 bg-slate-900/40 p-3 md:w-auto">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleListPrinters}
                className="neon-btn rounded-lg px-3 py-2 text-sm"
                disabled={loadingPrinters}
              >
                {loadingPrinters
                  ? tx(lang, 'Yoxlanır...', 'Проверка...', 'Checking...')
                  : tx(lang, 'Printerləri Siyahıla', 'Список принтеров', 'List Printers')}
              </button>
              <span className="text-xs text-slate-400">
                {tx(lang, 'QZ aktivdirsə, burada görünəcək.', 'Если QZ активен, список появится здесь.', 'If QZ is active, printers will appear here.')}
              </span>
            </div>
            {availablePrinters.length > 0 && (
              <div className="mt-2 max-h-28 overflow-y-auto rounded-lg border border-slate-700/70 bg-slate-950/50 p-2 text-xs text-slate-200">
                {availablePrinters.map((printer) => (
                  <div key={printer} className="truncate">• {printer}</div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-300 whitespace-nowrap">
            {tx(lang, 'Olmalı Kassa', 'Ожидаемая касса', 'Expected cash')}: <b>{expectedCashNow.toFixed(2)} ₼</b>
          </div>
          <div className="text-xs text-slate-300 whitespace-nowrap">
            {tx(lang, 'Kassada qalan', 'Остаток в кассе', 'Carryover cash')}: <b>{carryoverCash.toFixed(2)} ₼</b>
          </div>
          <input
            type="number"
            min={0}
            value={openingTarget}
            onChange={(e) => setOpeningTarget(e.target.value)}
            className="neon-input w-48"
            placeholder={tx(lang, 'Açılış hədəfi', 'Цель открытия', 'Opening target')}
            disabled={shiftStatus.status === 'Open'}
          />
          <select
            className="neon-input w-52"
            value={openingTopupSource}
            onChange={(e) => setOpeningTopupSource(e.target.value as any)}
            disabled={shiftStatus.status === 'Open'}
          >
            <option value="safe">{tx(lang, 'Seyfdən tamamla', 'Пополнить из сейфа', 'Top-up from safe')}</option>
            <option value="card">{tx(lang, 'Kartdan tamamla', 'Пополнить с карты', 'Top-up from card')}</option>
            <option value="investor">{tx(lang, 'İnvestordan tamamla', 'Пополнить от инвестора', 'Top-up from investor')}</option>
            <option value="cash">{tx(lang, 'Birbaşa kassaya yaz', 'Прямо в кассу', 'Direct cash add')}</option>
          </select>
          <div className="text-xs text-slate-300 whitespace-nowrap">
            {tx(lang, 'Tamamlanacaq', 'Сумма пополнения', 'Top-up')}: <b>{requiredTopup.toFixed(2)} ₼</b>
          </div>
          <button onClick={handleOpenDay} className="neon-btn px-4 py-2" disabled={!canOpenOrJoinShift}>
            {shiftStatus.status === 'Open'
              ? (staffSessionOpen
                ? tx(lang, 'Növbəniz Açıqdır', 'Ваша смена открыта', 'Your shift is open')
                : tx(lang, 'Növbəyə Qoşul', 'Подключиться к смене', 'Join shift'))
              : tx(lang, 'Günü Aç', 'Открыть день', 'Open Day')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="metal-panel p-4">
          <div className="text-xs text-slate-400">{tx(lang, 'Növbə statusu', 'Статус смены', 'Shift status')}</div>
          <div className="mt-2 flex items-center gap-2">
            <ShiftStatusBadge status={shiftStatus.status} lang={lang} />
            {activeShiftOwner ? (
              <span className="text-sm text-slate-200">
                {tx(lang, 'Aktiv növbə sahibi', 'Активная смена у', 'Active shift owner')}: <b>{activeShiftOwner}</b>
              </span>
            ) : (
              <span className="text-sm text-slate-400">{tx(lang, 'Hazırda açıq növbə yoxdur', 'Сейчас нет открытой смены', 'No open shift right now')}</span>
            )}
          </div>
          <div className="mt-2 text-xs">
            {staffSessionOpen ? (
              <span className="text-emerald-300">{tx(lang, 'Sizin növbə session-u açıqdır, satış edə bilərsiniz.', 'Ваш session смены открыт, продажи разрешены.', 'Your staff shift session is open; sales are allowed.')}</span>
            ) : (
              <span className="text-amber-300">{tx(lang, 'Satış üçün əvvəlcə “Günü Aç / Növbəyə Qoşul” edin.', 'Для продаж сначала нажмите «Открыть день / Подключиться к смене».', 'To sell, first click “Open Day / Join Shift”.')}</span>
            )}
          </div>
        </div>
        <div className="metal-panel p-4">
          <div className="text-xs text-slate-400">{tx(lang, 'Təhvil gözləyən', 'Ожидает передачи', 'Pending handover')}</div>
          <div className="mt-2 text-sm text-slate-200">
            {pendingReceived ? (
              <>
                <b>{pendingReceived.handed_by}</b> {tx(lang, 'tərəfindən sizə göndərilib', 'передал вам', 'handed over to you')}
              </>
            ) : (
              <span className="text-slate-400">{tx(lang, 'Gözləyən təhvil yoxdur', 'Нет ожидающей передачи', 'No pending handover')}</span>
            )}
          </div>
        </div>
        <div className="metal-panel p-4">
          <div className="text-xs text-slate-400">{tx(lang, 'Son qəbul', 'Последнее принятие', 'Latest accepted')}</div>
          <div className="mt-2 text-sm text-slate-200">
            {latestReceived ? (
              <>
                <b>{latestReceived.handed_by}</b> → <b>{latestReceived.received_by}</b>
              </>
            ) : (
              <span className="text-slate-400">{tx(lang, 'Qəbul edilmiş təhvil yoxdur', 'Нет принятой передачи', 'No accepted handover yet')}</span>
            )}
          </div>
        </div>
      </div>

      <div className="metal-panel border border-slate-700/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">
              {tx(lang, 'Keçmiş Z çekləri', 'Прошлые Z-чеки', 'Past Z receipts')}
            </h3>
            <p className="text-xs text-slate-400">
              {tx(
                lang,
                'Z bağlananda çek burada saxlanır və sonra yenidən çap olunur.',
                'При закрытии Z чек сохраняется здесь и доступен для повторной печати.',
                'When Z closes, the receipt is saved here for reprint.',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadZReceiptHistory()}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            disabled={zReceiptHistoryLoading}
          >
            {zReceiptHistoryLoading
              ? tx(lang, 'Yüklənir...', 'Загрузка...', 'Loading...')
              : tx(lang, 'Yenilə', 'Обновить', 'Refresh')}
          </button>
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-700/70">
          {zReceiptHistory.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">
              {zReceiptHistoryLoading
                ? tx(lang, 'Z çekləri yüklənir...', 'Z-чеки загружаются...', 'Loading Z receipts...')
                : tx(lang, 'Bu tarix aralığında saxlanmış Z çeki yoxdur.', 'В этом диапазоне нет сохраненных Z-чеков.', 'No saved Z receipts in this date range.')}
            </div>
          ) : (
            <div className="divide-y divide-slate-700/70">
              {zReceiptHistory.map((row) => (
                <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100">
                      {formatServerUtcDateTime(row.closed_at || row.opened_at || '', lang)}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      ID: {String(row.id || '').slice(0, 8).toUpperCase()} · {tx(lang, 'Bağlayan', 'Закрыл', 'Closed by')}: {row.closed_by || '-'} · {tx(lang, 'Faktiki', 'Факт', 'Actual')}: {new Decimal(row.actual_cash || 0).toFixed(2)} ₼
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setZReceiptHtml(row.z_report_html || '')}
                    className="rounded-lg bg-yellow-400 px-3 py-2 text-sm font-semibold text-slate-900"
                    disabled={!row.z_report_html}
                  >
                    {tx(lang, 'Yenidən çap', 'Повторная печать', 'Reprint')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {pendingReceived && (
        <div className="metal-panel border border-yellow-400/40 bg-yellow-500/5 p-4">
          <h3 className="mb-2 text-lg font-semibold text-yellow-300">
            {tx(lang, 'Smena Qəbulu Gözləyir', 'Ожидает подтверждения смены', 'Shift Acceptance Pending')}
          </h3>
          <div className="grid grid-cols-1 gap-2 text-sm text-slate-200 md:grid-cols-4">
            <div>
              <span className="text-slate-400">{tx(lang, 'Təhvil verən', 'Передал', 'Handed Over By')}:</span>{' '}
              <b>{pendingReceived.handed_by}</b>{' '}
              <ShiftStatusBadge status={pendingReceived.status} lang={lang} compact />
            </div>
            <div>
              <span className="text-slate-400">{tx(lang, 'Bəyan edilən məbləğ', 'Переданная сумма', 'Declared Amount')}:</span>{' '}
              <b>{new Decimal(pendingReceived.declared_cash || 0).toFixed(2)} ₼</b>
            </div>
            <div>
              <span className="text-slate-400">{tx(lang, 'Tarix', 'Дата', 'Date')}:</span>{' '}
              <b>{new Date(pendingReceived.created_at).toLocaleString()}</b>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={handoverActualCash}
                onChange={(e) => setHandoverActualCash(e.target.value)}
                className="neon-input w-full"
                placeholder={tx(lang, 'Saydığınız faktiki nağd', 'Фактически пересчитанная наличность', 'Actual cash counted')}
              />
              <button onClick={handleAcceptHandover} className="glossy-gold rounded-lg px-3 py-2 font-semibold whitespace-nowrap">
                {tx(lang, 'Qəbul Et', 'Подтвердить', 'Accept')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="field-stack form-card">
          <label className="field-label">{tx(lang, 'Başlanğıc tarix', 'Дата начала', 'From date')}</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="neon-input" />
        </div>
        <div className="field-stack form-card">
          <label className="field-label">{tx(lang, 'Bitiş tarix', 'Дата окончания', 'To date')}</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="neon-input" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="metal-panel p-4">
          <h3 className="mb-3 text-lg font-semibold">{tx(lang, 'X-Hesabat', 'X-отчет', 'X Report')}</h3>
          <label className="field-label mb-2 block">{tx(lang, 'Kassadakı faktiki məbləğ', 'Фактическая сумма в кассе', 'Actual cash in drawer')}</label>
          <input
            type="number"
            min={0}
            value={xActualCash}
            onChange={(e) => setXActualCash(e.target.value)}
            className="neon-input"
          />
          <p className="field-hint mt-2">{tx(lang, 'Hazırda kassada saydığınız real məbləği yazın.', 'Введите фактически пересчитанную сумму в кассе.', 'Enter the real counted cash in the drawer.')}</p>
          <button onClick={handleX} className="neon-btn mt-3 px-4 py-2">
            {tx(lang, 'X-Hesabatı Təsdiqlə', 'Подтвердить X-отчет', 'Confirm X Report')}
          </button>
        </div>

        <div className="metal-panel p-4">
          <h3 className="mb-3 text-lg font-semibold">{tx(lang, 'Z-Hesabat', 'Z-отчет', 'Z Report')}</h3>
          <label className="field-label mb-2 block">{tx(lang, 'Sabahkı açılış məbləği', 'Сумма открытия на завтра', 'Opening amount for tomorrow')}</label>
          <input
            type="number"
            min={0}
            value={zActualCash}
            onChange={(e) => setZActualCash(e.target.value)}
            className="neon-input"
          />
          <p className="field-hint mt-2">{tx(lang, 'Növbəti gün kassada qalmasını istədiyiniz açılış məbləğidir.', 'Это сумма, которая должна остаться в кассе на следующий день.', 'This is the opening cash you want to keep for the next day.')}</p>
          <label className="field-label mb-2 mt-3 block">{tx(lang, 'Maaş məbləği', 'Сумма зарплаты', 'Wage amount')}</label>
          <input
            type="number"
            min={0}
            value={zWage}
            onChange={(e) => setZWage(e.target.value)}
            className="neon-input"
          />
          <p className="field-hint mt-2">{tx(lang, 'Bu Z-Hesabat zamanı çıxılan əməkhaqqı məbləğidir.', 'Это сумма зарплаты, списываемая во время Z-отчета.', 'This is the wage amount deducted during the Z-report.')}</p>
          <button onClick={handleZ} className="glossy-gold mt-3 rounded-lg px-4 py-2 font-semibold">
            {tx(lang, 'Z-Hesabatı Yarat', 'Создать Z-отчет', 'Create Z Report')}
          </button>
        </div>
      </div>

      {yieldEnabled ? (
        <div className="metal-panel p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">{tx(lang, 'Gün sonu şiş auditi', 'Аудит шампура в конце дня', 'Day-end batch audit')}</h3>
              <p className="text-xs text-slate-400">
                {tx(
                  lang,
                  'Səhər açılan şişləri burada qeyd edin. Gün sonu qalan çiy çəkini yazanda sistem gözlənilən sərflə faktiki sərfi müqayisə edir.',
                  'Здесь фиксируются утренние партии. В конце дня система сравнивает ожидаемый и фактический расход.',
                  'Track morning batches here. At day end, the system compares expected and actual raw consumption.',
                )}
              </p>
            </div>
            <div className="text-xs text-slate-300">
              {tx(lang, 'Şübhəli fərqlər', 'Подозрительные отклонения', 'Flagged variances')}: <b>{totalYieldFlags}</b>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4">
            <div className="mb-3 font-semibold text-slate-100">{tx(lang, 'Yeni şiş aç', 'Открыть новую партию', 'Open new batch')}</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="field-stack form-card">
                <label className="field-label">{tx(lang, 'İzlənən inventar', 'Отслеживаемый инвентарь', 'Tracked inventory')}</label>
                <select
                  className="neon-input"
                  value={yieldOpenInventoryName}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    const tracked = trackedYieldItems.find((row: any) => row.inventory_name === nextName);
                    setYieldOpenInventoryName(nextName);
                    setYieldOpenMeatType((tracked?.meat_type || 'beef') as 'beef' | 'chicken');
                  }}
                >
                  <option value="">{tx(lang, 'İzlənən inventarı seçin', 'Выберите отслеживаемый инвентарь', 'Select tracked inventory')}</option>
                  {trackedYieldItems.map((row: any) => (
                    <option key={row.inventory_name} value={row.inventory_name}>
                      {row.inventory_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-stack form-card">
                <label className="field-label">{tx(lang, 'Ət tipi', 'Тип мяса', 'Meat type')}</label>
                <select className="neon-input" value={yieldOpenMeatType} onChange={(e) => setYieldOpenMeatType(e.target.value as 'beef' | 'chicken')}>
                  <option value="beef">{tx(lang, 'Mal əti', 'Говядина', 'Beef')}</option>
                  <option value="chicken">{tx(lang, 'Toyuq əti', 'Курица', 'Chicken')}</option>
                </select>
              </div>
              <div className="field-stack form-card">
                <label className="field-label">{tx(lang, 'Asılan çiy çəki (kq)', 'Сырой вес на старте (кг)', 'Opening raw weight (kg)')}</label>
                <input
                  className="neon-input"
                  type="number"
                  min={0}
                  step="0.001"
                  value={yieldOpenRawWeight}
                  onChange={(e) => setYieldOpenRawWeight(e.target.value)}
                />
              </div>
              <button onClick={handleOpenYieldBatch} className="glossy-gold rounded-lg px-4 py-2 font-semibold">
                {tx(lang, 'Şişi aç', 'Открыть партию', 'Open batch')}
              </button>
            </div>
            <div className="field-stack mt-3">
              <label className="field-label">{tx(lang, 'Qeyd', 'Заметка', 'Notes')}</label>
              <input
                className="neon-input"
                value={yieldOpenNotes}
                onChange={(e) => setYieldOpenNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 space-y-3">
              <div className="font-semibold text-slate-100">{tx(lang, 'Aktiv şişlər', 'Активные партии', 'Active batches')}</div>
              {activeYieldBatches.length === 0 ? (
                <div className="text-sm text-slate-400">{tx(lang, 'Hazırda açıq şiş yoxdur', 'Сейчас нет открытых партий', 'There are no open batches right now')}</div>
              ) : (
                activeYieldBatches.map((batch) => {
                  const form = yieldCloseValues[batch.id] || { remaining: '', notes: '' };
                  return (
                    <div key={batch.id} className="rounded-2xl border border-slate-700/50 bg-slate-900/40 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-100">{batch.inventory_name}</div>
                          <div className="text-xs text-slate-400">
                            {tx(lang, 'Açan', 'Открыл', 'Opened by')}: {batch.opened_by} · {new Date(batch.opened_at || '').toLocaleString()}
                          </div>
                        </div>
                        <span className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
                          {batch.meat_type === 'chicken' ? tx(lang, 'Toyuq', 'Курица', 'Chicken') : tx(lang, 'Mal əti', 'Говядина', 'Beef')}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                        <div><span className="text-slate-400">{tx(lang, 'Çiy çəki', 'Сырой вес', 'Raw weight')}:</span> <b>{batch.raw_weight_kg} kq</b></div>
                        <div><span className="text-slate-400">{tx(lang, 'Hazır gözlənti', 'Готовый эквивалент', 'Expected ready')}:</span> <b>{batch.expected_ready_weight_kg} kq</b></div>
                        <div><span className="text-slate-400">{tx(lang, 'Satılan hazır', 'Продано готового', 'Sold ready')}:</span> <b>{batch.sold_ready_weight_kg} kq</b></div>
                        <div><span className="text-slate-400">{tx(lang, 'Silinən çiy', 'Списано сырого', 'Deducted raw')}:</span> <b>{batch.deducted_raw_weight_kg} kq</b></div>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
                        <div className="field-stack">
                          <label className="field-label">{tx(lang, 'Gün sonu qalan çiy çəki (kq)', 'Остаток сырого веса в конце дня (кг)', 'Remaining raw weight at day end (kg)')}</label>
                          <input
                            className="neon-input"
                            type="number"
                            min={0}
                            step="0.001"
                            value={form.remaining}
                            onChange={(e) => setYieldCloseValues((prev) => ({ ...prev, [batch.id]: { ...form, remaining: e.target.value } }))}
                          />
                        </div>
                        <div className="field-stack">
                          <label className="field-label">{tx(lang, 'Qeyd / səbəb', 'Заметка / причина', 'Notes / reason')}</label>
                          <input
                            className="neon-input"
                            value={form.notes}
                            onChange={(e) => setYieldCloseValues((prev) => ({ ...prev, [batch.id]: { ...form, notes: e.target.value } }))}
                          />
                        </div>
                        <button onClick={() => handleCloseYieldBatch(batch)} className="neon-btn rounded-lg px-4 py-2">
                          {tx(lang, 'Bağla', 'Закрыть', 'Close')}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 space-y-3">
              <div className="font-semibold text-slate-100">{tx(lang, 'Son audit qeydləri', 'Последние записи аудита', 'Recent audit records')}</div>
              {yieldWasteLogs.length === 0 ? (
                <div className="text-sm text-slate-400">{tx(lang, 'Hələ audit qeydi yoxdur', 'Записей аудита пока нет', 'No audit records yet')}</div>
              ) : (
                yieldWasteLogs.slice(0, 6).map((row) => (
                  <div
                    key={row.id}
                    className={`rounded-2xl border p-4 ${
                      row.flagged
                        ? 'border-red-400/30 bg-red-500/10'
                        : 'border-emerald-400/20 bg-emerald-500/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-slate-100">{row.inventory_name}</div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${row.flagged ? 'bg-red-500/20 text-red-100' : 'bg-emerald-500/20 text-emerald-100'}`}>
                        {row.flagged ? tx(lang, 'Şübhəli fərq', 'Подозрительное отклонение', 'Flagged') : tx(lang, 'Normal', 'Норма', 'Normal')}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                      <div><span className="text-slate-400">{tx(lang, 'Gözlənilən çiy sərf', 'Ожидаемый сырой расход', 'Expected raw consumption')}:</span> <b>{row.expected_raw_consumption_kg} kq</b></div>
                      <div><span className="text-slate-400">{tx(lang, 'Faktiki çiy sərf', 'Фактический сырой расход', 'Actual raw consumption')}:</span> <b>{row.actual_raw_consumption_kg} kq</b></div>
                      <div><span className="text-slate-400">{tx(lang, 'Fərq', 'Отклонение', 'Variance')}:</span> <b>{row.variance_percent}%</b></div>
                      <div><span className="text-slate-400">{tx(lang, 'İcazə həddi', 'Допустимый порог', 'Tolerance')}:</span> <b>{row.tolerance_percent}%</b></div>
                    </div>
                    {row.notes ? <div className="mt-2 text-xs text-slate-300">{row.notes}</div> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {latestReceived && (
        <div className="metal-panel p-4">
          <h3 className="mb-2 text-lg font-semibold">{tx(lang, 'Son Təhvil Məlumatı', 'Информация о последней передаче', 'Latest Handover Info')}</h3>
          <div className="grid grid-cols-1 gap-2 text-sm text-slate-200 md:grid-cols-4">
            <div>
              <span className="text-slate-400">{tx(lang, 'Təhvil verən', 'Передал', 'Handed Over By')}:</span>{' '}
              <b>{latestReceived.handed_by}</b>
            </div>
            <div>
              <span className="text-slate-400">{tx(lang, 'Təhvil alan', 'Принял', 'Received By')}:</span>{' '}
              <b>{latestReceived.received_by}</b>{' '}
              <ShiftStatusBadge status={latestReceived.status} lang={lang} compact />
            </div>
            <div>
              <span className="text-slate-400">{tx(lang, 'Faktiki nağd', 'Фактическая наличность', 'Actual cash')}:</span>{' '}
              <b>{new Decimal(latestReceived.actual_cash || 0).toFixed(2)} ₼</b>
            </div>
            <div>
              <span className="text-slate-400">{tx(lang, 'Tarix', 'Дата', 'Date')}:</span>{' '}
              <b>{new Date(latestReceived.created_at).toLocaleString()}</b>
            </div>
          </div>
        </div>
      )}

      <div className="metal-panel p-4">
        <h3 className="mb-3 text-lg font-semibold">{tx(lang, 'Smeni Təhvil Ver', 'Передача смены', 'Shift Handover')}</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <select className="neon-input" value={handoverTo} onChange={(e) => setHandoverTo(e.target.value)}>
            <option value="">
              {handoverUsersLoading
                ? tx(lang, 'İstifadəçilər yüklənir...', 'Пользователи загружаются...', 'Loading users...')
                : tx(lang, 'Təhvil alan işçi seçin', 'Выберите принимающего сотрудника', 'Select receiving staff')}
            </option>
            {tenantUsers
              .filter((u) => u.username !== user?.username)
              .map((u) => (
                <option key={u.id} value={u.username}>{u.username} ({String(u.role || '').toUpperCase()})</option>
              ))}
          </select>
          <input
            type="number"
            min={0}
            className="neon-input"
            value={handoverActualCash}
            onChange={(e) => setHandoverActualCash(e.target.value)}
            placeholder={tx(lang, 'Faktiki nağd', 'Фактическая наличность', 'Actual cash')}
          />
          <button onClick={handleHandover} className="neon-btn px-4 py-2">
            {tx(lang, 'Təhvil Ver', 'Передать', 'Hand Over')}
          </button>
        </div>
        {selectedReceiver && (
          <div className="mt-3 flex items-center gap-2 text-sm text-slate-300">
            <span>{tx(lang, 'Seçilmiş qəbul edən', 'Выбранный принимающий', 'Selected receiver')}:</span>
            <b className="text-slate-100">{selectedReceiver.username}</b>
            <RoleBadge role={selectedReceiver.role} />
          </div>
        )}
        {!handoverUsersLoading && availableReceivers.length === 0 && (
          <div className="mt-3 text-xs text-amber-300">
            {tenantUsers.length > 0
              ? tx(lang, 'Sistemdə yalnız sizin aktiv hesabınız görünür. Təhvil üçün ikinci aktiv staff/manager/admin yaradın.', 'В системе виден только ваш активный аккаунт. Для передачи создайте второго активного staff/manager/admin.', 'Only your active account is visible. Create a second active staff/manager/admin user for handover.')
              : tx(lang, 'Təhvil veriləcək aktiv staff/manager/admin tapılmadı.', 'Не найдено активных staff/manager/admin для передачи.', 'No active staff/manager/admin users available for handover.')}
          </div>
        )}
        {!handoverUsersLoading && tenantUsers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {tenantUsers.map((u) => (
              <span
                key={u.id}
                className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 ${
                  u.username === user?.username
                    ? 'border-yellow-300/40 bg-yellow-500/10 text-yellow-100'
                    : 'border-slate-600/60 bg-slate-900/40 text-slate-200'
                }`}
              >
                <span>{u.username}</span>
                <RoleBadge role={u.role} />
                {u.username === user?.username && <span>{tx(lang, 'siz', 'вы', 'you')}</span>}
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">
          {tx(lang, 'Bu əməliyyat növbəni bağlamır, açıq növbəni seçilən işçiyə ötürür.', 'Эта операция не закрывает смену, а передает открытую смену выбранному сотруднику.', 'This action does not close the shift. It transfers the active shift to the selected staff member.')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <Metric title={tx(lang, 'Ümumi Satış', 'Общие продажи', 'Total Sales')} value={summaryNetSales.toFixed(2)} />
        <Metric title={tx(lang, 'Nağd', 'Наличные', 'Cash')} value={summary.cash_sales} />
        <Metric title={tx(lang, 'Kart', 'Карта', 'Card')} value={summary.card_sales} />
        <Metric title={tx(lang, 'Maya (COGS)', 'Себестоимость (COGS)', 'COGS')} value={summary.total_cogs} />
        <Metric title={tx(lang, 'Brutto Mənfəət', 'Валовая прибыль', 'Gross Profit')} value={summary.gross_profit} />
      </div>

      <div className="metal-panel overflow-x-auto">
        <div className="flex items-center justify-between gap-3 border-b border-slate-700/60 px-4 py-3">
          <div className="text-xs text-slate-400">
            {tx(lang, 'Ekranda görünən satış', 'Показано продаж', 'Sales shown')}: <b>{visibleSales.length}</b> / {sales.length}
          </div>
          <select value={salesPageSize} onChange={(e) => setSalesPageSize(Number(e.target.value))} className="neon-input min-h-12 w-28">
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
          </select>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-3 text-sm text-slate-300">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{tx(lang, 'Source Of Truth', 'Источник данных', 'Source Of Truth')}</div>
            <div className="mt-2 font-semibold text-slate-100">{tx(lang, 'Olmalı Kassa', 'Ожидаемая касса', 'Expected cash')}</div>
            <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Aktiv növbənin açılış məbləği + növbə ərzindəki cash in/out.', 'Открытие активной смены + cash in/out в рамках смены.', 'Active shift opening cash + cash in/out within the shift.')}</div>
          </div>
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-3 text-sm text-slate-300">
            <div className="mt-5 font-semibold text-slate-100">{tx(lang, 'Kassada qalan', 'Остаток в кассе', 'Carryover cash')}</div>
            <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Maliyyə yazılışına görə cari nağd kassa balansı.', 'Текущий баланс кассы по финансовым проводкам.', 'Current cash wallet balance from finance ledger.')}</div>
          </div>
          <div className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-3 text-sm text-slate-300">
            <div className="mt-5 font-semibold text-slate-100">{tx(lang, 'Aktiv depozit öhdəliyi', 'Активный депозитный долг', 'Active deposit liability')}</div>
            <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Açıq masalarda saxlanan depozitlər ayrıca liability kimi izlənir.', 'Депозиты по открытым столам отслеживаются как отдельное обязательство.', 'Deposits on open tables are tracked as a separate liability.')}</div>
            <div className="mt-2 text-sm font-bold text-amber-200">{new Decimal(currentBalances.deposit_balance || 0).toFixed(2)} ₼</div>
          </div>
        </div>
        {zAuditExceptions.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
            {zAuditExceptions.map((item) => (
              <div key={item.title} className={`rounded-2xl border p-3 text-sm ${item.tone === 'rose' ? 'border-rose-500/30 bg-rose-950/20 text-rose-100' : item.tone === 'amber' ? 'border-amber-500/30 bg-amber-950/20 text-amber-100' : 'border-sky-500/30 bg-sky-950/20 text-sky-100'}`}>
                <div className="font-semibold">{item.title}</div>
                <div className="mt-1 text-xs opacity-90">{item.body}</div>
              </div>
            ))}
          </div>
        )}
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/50 text-slate-300">
            <tr>
                <th className="px-4 py-3">{tx(lang, 'Tarix', 'Дата', 'Date')}</th>
                <th className="px-4 py-3">{tx(lang, 'İşçi', 'Сотрудник', 'Staff')}</th>
                <th className="px-4 py-3">{tx(lang, 'Sifariş', 'Заказ', 'Order')}</th>
                <th className="px-4 py-3">{tx(lang, 'Müştəri QR', 'QR клиента', 'Customer QR')}</th>
                <th className="px-4 py-3">{tx(lang, 'Yekun', 'Итого', 'Total')}</th>
                <th className="px-4 py-3">{tx(lang, 'Ödəniş', 'Оплата', 'Payment')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleSales.map((s: any) => (
              <tr key={s.id} className="border-t border-slate-700/50">
                <td className="px-4 py-3">{formatServerUtcDateTime(s.created_at, lang)}</td>
                <td className="px-4 py-3 font-medium">{s.cashier}</td>
                <td className="px-4 py-3">{s.items_display || '-'}</td>
                <td className="px-4 py-3">{s.customer_card_id || '-'}</td>
                <td className="px-4 py-3 font-semibold">{new Decimal(s.total || 0).toFixed(2)} ₼</td>
                <td className="px-4 py-3">{s.payment_method}</td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {tx(lang, 'Seçilmiş tarix aralığında satış yoxdur', 'В выбранном периоде продаж нет', 'No sales found in the selected date range')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="metal-panel p-4">
      <div className="text-xs text-slate-300">{title}</div>
      <div className="mt-1 text-2xl font-bold text-slate-100">{new Decimal(value || 0).toFixed(2)} ₼</div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const normalized = String(role || '').toLowerCase();
  const palette =
    normalized === 'admin'
      ? 'border-fuchsia-300/40 bg-fuchsia-500/15 text-fuchsia-100'
      : normalized === 'manager'
        ? 'border-sky-300/40 bg-sky-500/15 text-sky-100'
        : 'border-emerald-300/40 bg-emerald-500/15 text-emerald-100';

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${palette}`}>
      {normalized || 'staff'}
    </span>
  );
}

function ShiftStatusBadge({
  status,
  lang,
  compact = false,
}: {
  status: string;
  lang: string;
  compact?: boolean;
}) {
  const normalized = String(status || '').toUpperCase();
  const palette =
    normalized === 'OPEN' || normalized === 'ACCEPTED'
      ? 'border-emerald-300/40 bg-emerald-500/15 text-emerald-100'
      : normalized === 'PENDING'
        ? 'border-amber-300/40 bg-amber-500/15 text-amber-100'
        : 'border-slate-400/40 bg-slate-500/15 text-slate-100';
  const label =
    normalized === 'OPEN'
      ? tx(lang, 'Açıq', 'Открыта', 'Open')
      : normalized === 'PENDING'
        ? tx(lang, 'Gözləyir', 'Ожидает', 'Pending')
        : normalized === 'ACCEPTED'
          ? tx(lang, 'Qəbul edildi', 'Принято', 'Accepted')
          : tx(lang, 'Bağlı', 'Закрыта', 'Closed');

  return (
    <span className={`inline-flex rounded-full border font-semibold ${compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} ${palette}`}>
      {label}
    </span>
  );
}
