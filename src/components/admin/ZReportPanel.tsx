import React, { useMemo, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import { useAppStore } from '../../store';
import { get_sales_summary_live, get_sales_list_live } from '../../api/analytics';
import {
  accept_shift_handover_live,
  get_expected_cash,
  get_pending_handover_for_user_live,
  refresh_expected_cash,
  refresh_shift_status,
  get_shift_handover_history_live,
  get_shift_status,
  handover_shift_live,
  open_shift,
  x_report,
  z_report,
} from '../../api/reports';
import { create_finance_entry_async, fetch_finance_balances, get_balance, transfer_funds_async } from '../../api/finance';
import { get_settings, get_users } from '../../api/settings';
import { qzListPrinters, qzPrintHtml } from '../../lib/qz';
import { tx } from '../../i18n';

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
  const [currentBalances, setCurrentBalances] = useState<any>({
    cash_balance: '0',
    card_balance: '0',
    debt_balance: '0',
    investor_balance: '0',
    safe_balance: '0',
  });
  const [reportRefreshKey, setReportRefreshKey] = useState(0);
  const [salesPageSize, setSalesPageSize] = useState(10);
  const zReceiptRef = React.useRef<HTMLIFrameElement | null>(null);
  const previousShiftStatusRef = useRef<string>(shiftStatusState.status);
  const printSettings = get_settings(tenant_id).print_settings || { use_qz: false, printer_name: '' };

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
  const latestReceived = handovers.find((h) => h.received_by === user?.username);
  const tenantUsers = get_users(tenant_id).filter((u) => ['staff', 'manager'].includes(String(u.role || '').toLowerCase()));
  const expectedCashNow = expectedCashState;
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

  const buildZReceiptHtml = (result: any) => {
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
          <div class="bold" style="font-size:15px">iRonWaves POS RC</div>
          <div class="line"><span>Z-Hesabat</span><span>${new Date().toLocaleDateString()}</span></div>
          <div class="line"><span>Operator</span><span>${user?.username || '-'}</span></div>
          <div class="line"><span>Aralıq</span><span>${fromDate} - ${toDate}</span></div>
          <hr />
          <div class="line"><span>Ümumi Satış</span><span>${new Decimal(summary.total_revenue || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Nağd Satış</span><span>${new Decimal(summary.cash_sales || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Kart Satış</span><span>${new Decimal(summary.card_sales || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Maya (COGS)</span><span>${new Decimal(summary.total_cogs || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Brutto Mənfəət</span><span>${new Decimal(summary.gross_profit || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Maaş Çıxışı</span><span>${new Decimal(result?.wage || zWage || 0).toFixed(2)} ₼</span></div>
          <div class="line"><span>Növbə Açılışı</span><span>${new Decimal(result?.total_sales || 0).gte(0) ? new Decimal(zActualCash || 0).toFixed(2) : new Decimal(zActualCash || 0).toFixed(2)} ₼</span></div>
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

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [status, cash, nextHandovers, nextPending, balances] = await Promise.all([
          refresh_shift_status(tenant_id),
          refresh_expected_cash(tenant_id),
          get_shift_handover_history_live(tenant_id, user?.username || undefined),
          get_pending_handover_for_user_live(tenant_id, user?.username || ''),
          fetch_finance_balances(tenant_id),
        ]);
        if (!mounted) return;
        setShiftStatusState(status);
        setExpectedCashState(cash);
        setHandovers(nextHandovers);
        setPendingReceived(nextPending);
        setCurrentBalances(balances);
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
      setReportRefreshKey((prev) => prev + 1);
    };
    window.addEventListener('focus', onFocusRefresh);
    window.addEventListener('finance-updated', onFinanceRefresh as EventListener);
    const timer = window.setInterval(() => {
      setReportRefreshKey((prev) => prev + 1);
    }, 15000);
    return () => {
      window.removeEventListener('focus', onFocusRefresh);
      window.removeEventListener('finance-updated', onFinanceRefresh as EventListener);
      window.clearInterval(timer);
    };
  }, []);

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
      setExpectedCashState(cash);
      setCurrentBalances(await fetch_finance_balances(tenant_id));
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

      // Open shift only after successful top-up flow.
      await open_shift(user?.username || 'staff', tenant_id);
      const [status, cash] = await Promise.all([
        refresh_shift_status(tenant_id),
        refresh_expected_cash(tenant_id),
      ]);
      setShiftStatusState(status);
      setExpectedCashState(cash);
      setCurrentBalances(await fetch_finance_balances(tenant_id));
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
      const [status, cash] = await Promise.all([
        refresh_shift_status(tenant_id),
        refresh_expected_cash(tenant_id),
      ]);
      setShiftStatusState(status);
      setExpectedCashState(cash);
      setCurrentBalances(await fetch_finance_balances(tenant_id));
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

  const handleHandover = async () => {
    if (!handoverTo) {
      notify('error', tx(lang, 'Təhvil alan işçini seçin', 'Выберите сотрудника для передачи'));
      return;
    }
    if (!handoverActualCash) {
      notify('error', tx(lang, 'Faktiki nağdı daxil edin', 'Введите фактическую наличность'));
      return;
    }
    try {
      await handover_shift_live(tenant_id, user?.username || 'staff', handoverTo, handoverActualCash);
      setHandovers(await get_shift_handover_history_live(tenant_id, user?.username || undefined));
      setPendingReceived(await get_pending_handover_for_user_live(tenant_id, user?.username || ''));
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
      setHandovers(await get_shift_handover_history_live(tenant_id, user?.username || undefined));
      setPendingReceived(await get_pending_handover_for_user_live(tenant_id, user?.username || ''));
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

      {pendingReceived && (
        <div className="metal-panel border border-yellow-400/40 bg-yellow-500/5 p-4">
          <h3 className="mb-2 text-lg font-semibold text-yellow-300">
            {tx(lang, 'Smena Qəbulu Gözləyir', 'Ожидает подтверждения смены', 'Shift Acceptance Pending')}
          </h3>
          <div className="grid grid-cols-1 gap-2 text-sm text-slate-200 md:grid-cols-4">
            <div>
              <span className="text-slate-400">{tx(lang, 'Təhvil verən', 'Передал', 'Handed Over By')}:</span>{' '}
              <b>{pendingReceived.handed_by}</b>
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
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="neon-input" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="neon-input" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="metal-panel p-4">
          <h3 className="mb-3 text-lg font-semibold">{tx(lang, 'X-Hesabat', 'X-отчет', 'X Report')}</h3>
          <label className="mb-2 block text-xs text-slate-300">{tx(lang, 'Kassadakı faktiki məbləğ', 'Фактическая сумма в кассе', 'Actual cash in drawer')}</label>
          <input
            type="number"
            min={0}
            value={xActualCash}
            onChange={(e) => setXActualCash(e.target.value)}
            className="neon-input"
            placeholder="0.00"
          />
          <button onClick={handleX} className="neon-btn mt-3 px-4 py-2">
            {tx(lang, 'X-Hesabatı Təsdiqlə', 'Подтвердить X-отчет', 'Confirm X Report')}
          </button>
        </div>

        <div className="metal-panel p-4">
          <h3 className="mb-3 text-lg font-semibold">{tx(lang, 'Z-Hesabat', 'Z-отчет', 'Z Report')}</h3>
          <label className="mb-2 block text-xs text-slate-300">{tx(lang, 'Sabahkı açılış məbləği', 'Сумма открытия на завтра', 'Opening amount for tomorrow')}</label>
          <input
            type="number"
            min={0}
            value={zActualCash}
            onChange={(e) => setZActualCash(e.target.value)}
            className="neon-input"
            placeholder="0.00"
          />
          <label className="mb-2 mt-3 block text-xs text-slate-300">{tx(lang, 'Maaş məbləği', 'Сумма зарплаты', 'Wage amount')}</label>
          <input
            type="number"
            min={0}
            value={zWage}
            onChange={(e) => setZWage(e.target.value)}
            className="neon-input"
            placeholder="0.00"
          />
          <button onClick={handleZ} className="glossy-gold mt-3 rounded-lg px-4 py-2 font-semibold">
            {tx(lang, 'Z-Hesabatı Yarat', 'Создать Z-отчет', 'Create Z Report')}
          </button>
        </div>
      </div>

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
              <b>{latestReceived.received_by}</b>
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
            <option value="">{tx(lang, 'Təhvil alan işçi seçin', 'Выберите принимающего сотрудника', 'Select receiving staff')}</option>
            {tenantUsers
              .filter((u) => u.username !== user?.username)
              .map((u) => (
                <option key={u.id} value={u.username}>{u.username} ({u.role})</option>
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
