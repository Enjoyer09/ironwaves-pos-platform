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
  get_yield_waste_logs_live,
  get_shift_handover_history_live,
  get_shift_status,
  handover_shift_live,
  open_doner_batch_live,
  open_shift,
  YieldBatchRow,
  YieldWasteLogRow,
  x_report,
  z_report,
} from '../../api/reports';
import { create_finance_entry_async, fetch_finance_anomalies, fetch_finance_balances, get_balance, transfer_funds_async, type FinanceAnomalies } from '../../api/finance';
import { get_settings, get_users_live } from '../../api/settings';
import { qzListPrinters, qzPrintHtml } from '../../lib/qz';
import { tx } from '../../i18n';
import { isBackendEnabled } from '../../api/client';

export default function ZReportPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [xActualCash, setXActualCash] = useState('0');
  const [zActualCash, setZActualCash] = useState('0');
  const [zWage, setZWage] = useState('0');
  const [openingTarget, setOpeningTarget] = useState('100');
  const [openingTopupSource, setOpeningTopupSource] = useState<'safe' | 'card' | 'investor' | 'cash'>('safe');
  const [zReceiptHtml, setZReceiptHtml] = useState<string | null>(null);
  const [handoverTo, setHandoverTo] = useState('');
  const [handoverActualCash, setHandoverActualCash] = useState('0');
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [shiftStatusState, setShiftStatusState] = useState(get_shift_status(tenant_id));
  const [expectedCashState, setExpectedCashState] = useState<Decimal>(() => get_expected_cash(tenant_id));
  const [summary, setSummary] = useState<any>({ total_revenue: '0', cash_sales: '0', card_sales: '0', gross_profit: '0', total_cogs: '0', void_count: 0 });
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
  const printSettings = get_settings(tenant_id).print_settings || { use_qz: false, printer_name: '' };
  const yieldSettings = get_settings(tenant_id).yield_management_settings;
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

  const shiftStatus = shiftStatusState;
  const latestReceived = handovers.find((h) => h.received_by === user?.username && String(h.status || '').toUpperCase() === 'ACCEPTED');
  const expectedCashNow = expectedCashState;
  const activeShiftOwner = String(shiftStatus.opened_by || '');
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
      current.salesCount += 1;
      current.total = current.total.plus(total);
      if (String(sale.payment_method || '').toLowerCase().includes('kart') || String(sale.payment_method || '').toLowerCase().includes('card')) {
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
    const depositCollected = new Decimal(result?.deposit_total || 0);
    const activeDepositLiability = new Decimal(currentBalances.deposit_balance || 0);
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
          <div class="line"><span>Operator</span><span>${user?.username || '-'}</span></div>
          <div class="line"><span>Aralıq</span><span>${fromDate} - ${toDate}</span></div>
          <hr />
          <div class="line"><span>Ümumi Satış</span><span>${new Decimal(summary.total_revenue || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Nağd Satış</span><span>${new Decimal(summary.cash_sales || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Kart Satış</span><span>${new Decimal(summary.card_sales || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Maya (COGS)</span><span>${new Decimal(summary.total_cogs || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Brutto Mənfəət</span><span>${new Decimal(summary.gross_profit || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Maaş Çıxışı</span><span>${new Decimal(result?.wage_amount || result?.wage || zWage || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Növbə Açılışı</span><span>${new Decimal(result?.opening_cash || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Kassa hərəkətləri giriş</span><span>${new Decimal(result?.cash_movements_in || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Kassa hərəkətləri çıxış</span><span>${new Decimal(result?.cash_movements_out || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Olmalı kassa</span><span>${expectedCash.toFixed(2)} ₼</span></div>
          <div class="line"><span>Faktiki bağlanış</span><span>${new Decimal(result?.actual_cash || zActualCash || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Bağlanış fərqi</span><span>${closingDifference.toFixed(2)} ₼</span></div>
          <hr />
          <div class="section-title">Source of Truth</div>
          <div class="line"><span>Bu növbədə toplanan depozit</span><span>${depositCollected.toFixed(2)} ₼</span></div>
          <div class="line"><span>Aktiv depozit öhdəliyi</span><span>${activeDepositLiability.toFixed(2)} ₼</span></div>
          <div class="muted">Kassa satış və hərəkətləri yalnız aktiv növbənin cash ledger yazılarından hesablanır.</div>
          <div class="muted">Depozit ayrıca öhdəlik ledger-də izlənir; bu rəqəm satış gəliri deyil.</div>
          <hr />
          <div class="section-title">Kassir Breakdown</div>
          ${cashierRows || '<div class="muted">No cashier activity</div>'}
          <hr />
          <div class="line"><span>Satış sayı</span><span>${sales.length}</span></div>
          <div class="line"><span>Void sayı</span><span>${summary.void_count || 0}</span></div>
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
        setSummary(nextSummary || { total_revenue: '0', cash_sales: '0', card_sales: '0', gross_profit: '0', total_cogs: '0', void_count: 0 });
        setSales(nextSales || []);
      } catch {
        if (!mounted) return;
        setSummary({ total_revenue: '0', cash_sales: '0', card_sales: '0', gross_profit: '0', total_cogs: '0', void_count: 0 });
        setSales([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [tenant_id, start, end, user?.role, user?.username, reportRefreshKey]);

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
    const onFocusRefresh = () => setReportRefreshKey((prev) => prev + 1);
    const onFinanceRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string }>).detail;
      if (detail?.tenant_id && detail.tenant_id !== tenant_id) return;
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
        void refreshOperationalState();
      }, 350);
    };
    window.addEventListener('focus', onFocusRefresh);
    window.addEventListener('finance-updated', onFinanceRefresh as EventListener);
    const timer = window.setInterval(() => {
      setReportRefreshKey((prev) => prev + 1);
    }, 30000);
    return () => {
      window.removeEventListener('focus', onFocusRefresh);
      window.removeEventListener('finance-updated', onFinanceRefresh as EventListener);
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
      // Bring cash drawer to target opening amount with explicit source trace.
      // IMPORTANT: top-up is validated/applied BEFORE opening the shift.
      // If top-up fails (insufficient funds), day should not be opened.
      if (requiredTopup.greaterThan(0)) {
        const balances = await fetch_finance_balances(tenant_id);

        if (openingTopupSource === 'investor') {
          // Investor injects money directly to cash + liability mirror handled by finance API.
          await create_finance_entry_async(
            tenant_id,
            'in',
            'Təsisçi İnvestisiyası',
            requiredTopup.toString(),
            'cash',
            `Gün açılışı üçün tamamlanma (${targetCash.toFixed(2)} ₼ hədəf). Mənbə: investor`,
            user?.username || 'staff',
          );
        } else if (openingTopupSource === 'cash') {
          // Cash as source means no cross-wallet movement; just marker event is enough.
          await create_finance_entry_async(
            tenant_id,
            'in',
            'Kassa Açılışı',
            requiredTopup.toString(),
            'cash',
            `Gün açılışı tamamlanması (hədəf ${targetCash.toFixed(2)} ₼)`,
            user?.username || 'staff',
          );
        } else {
          if (openingTopupSource === 'safe') {
            const safeBal = new Decimal(balances.safe_balance || 0);
            if (safeBal.lessThan(requiredTopup)) {
              throw new Error(tx(lang, 'Seyfdə kifayət qədər vəsait yoxdur', 'Недостаточно средств в сейфе', 'Insufficient safe balance'));
            }
          }

          if (openingTopupSource === 'card') {
            const cardBal = new Decimal(balances.card_balance || 0);
            // card_to_cash transfer applies commission rule from finance API
            const comm = requiredTopup.lte(120) ? new Decimal(0.6) : requiredTopup.times(0.005).toDecimalPlaces(2);
            const needed = requiredTopup.plus(comm);
            if (cardBal.lessThan(needed)) {
              throw new Error(
                tx(
                  lang,
                  `Kart balansı kifayət etmir (lazım: ${needed.toFixed(2)} ₼, komissiya daxil)`,
                  `Недостаточно баланса карты (нужно: ${needed.toFixed(2)} ₼, включая комиссию)`,
                  `Insufficient card balance (required: ${needed.toFixed(2)} ₼ incl. commission)`
                )
              );
            }
          }

          // safe/card -> cash transfer
          const direction = openingTopupSource === 'safe' ? 'safe_to_cash' : 'card_to_cash';
          await transfer_funds_async(
            tenant_id,
            direction,
            requiredTopup.toString(),
            '0',
            user?.username || 'staff',
          );
        }
      }

      // Open shift only after successful top-up flow, and snapshot the actual
      // cash that is physically in the drawer at this moment.
      const openingBalances = await fetch_finance_balances(tenant_id).catch(() => get_balance(tenant_id, 'all', false) as any);
      const openingCashAmount = new Decimal(openingBalances.cash_balance || 0).toFixed(2);
      await open_shift(user?.username || 'staff', tenant_id, openingCashAmount);
      const cash = await refresh_expected_cash(tenant_id).catch(() => expectedCashNow);
      await refreshOperationalState(true).catch(() => undefined);
      const nextCash = cash.toFixed(2);
      setXActualCash(nextCash);
      setZActualCash(nextCash);
      setHandoverActualCash(nextCash);
      setReportRefreshKey((prev) => prev + 1);

      notify('success', tx(lang, 'Gün açıldı', 'День открыт'));
      notify('info', tx(lang, 'Xahiş edirik, gün sonu Z-Hesabatla növbəni bağlamağı unutmayın.', 'Пожалуйста, не забудьте закрыть смену через Z-отчет в конце дня.'));
    } catch (e: any) {
      notify('error', tx(lang, `Xəta: ${e.message}`, `Ошибка: ${e.message}`));
    }
  };

  const handleZ = async () => {
    if (!zActualCash) return;
    try {
      const result = await z_report(zActualCash, zWage || '0', user?.username || 'admin', tenant_id);
      setZReceiptHtml(buildZReceiptHtml(result));
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
      notify('error', tx(lang, `Xəta: ${e.message}`, `Ошибка: ${e.message}`));
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
    if (printSettings.use_qz && zReceiptHtml) {
      try {
        await qzPrintHtml(zReceiptHtml, printSettings.printer_name);
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

  if (zReceiptHtml) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#121922] p-6">
        <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-[#101722] p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-100">{tx(lang, 'Yekun Z-Hesabat Çeki', 'Итоговый чек Z-отчета')}</h3>
            <div className="flex gap-2">
              <button onClick={printZReceiptOnly} className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-slate-900">
                {tx(lang, 'Çap Et', 'Печать')}
              </button>
              <button onClick={() => setZReceiptHtml(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">
                {tx(lang, 'Bağla', 'Закрыть')}
              </button>
            </div>
          </div>
          <iframe ref={zReceiptRef} title="z-report-receipt" srcDoc={zReceiptHtml} className="h-[70vh] w-full rounded-lg bg-white" />
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
          <button onClick={handleOpenDay} className="neon-btn px-4 py-2" disabled={shiftStatus.status === 'Open'}>
            {shiftStatus.status === 'Open' ? tx(lang, 'Gün Açıqdır', 'День уже открыт', 'Day Already Open') : tx(lang, 'Günü Aç', 'Открыть день', 'Open Day')}
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
        <Metric title={tx(lang, 'Ümumi Satış', 'Общие продажи', 'Total Sales')} value={summary.total_revenue} />
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
            <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Finance ledger üzrə cari cash wallet balansı.', 'Текущий баланс cash wallet по finance ledger.', 'Current cash wallet balance from finance ledger.')}</div>
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
                <td className="px-4 py-3">{new Date(s.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</td>
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
