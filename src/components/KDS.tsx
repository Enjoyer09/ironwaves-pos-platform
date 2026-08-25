import { useState, useEffect, useMemo, useRef } from 'react';
import { get_kitchen_orders_live, accept_order_live, complete_order_live, ready_kitchen_item_status_live, serve_kitchen_item_status_live, start_kitchen_item_status_live } from '../api/kds';
import { subscribeTenantRealtime } from '../api/realtime';
import { Clock, CheckCircle, ChefHat, AlertCircle, Printer } from 'lucide-react';
import { KitchenOrder } from '../types/pos';
import { useAppStore } from '../store';
import { tx } from '../i18n';
import { logUiError } from '../lib/logger';
import { approve_void_request_live, get_pending_approvals_live, reject_void_request_live, type PendingApprovalItem } from '../api/restaurant';
import { ORDER_STATUS_THEME, ORDER_STATUS_THEME_DEFAULT } from '../utils/tables/tableUtils';
import { printDirectOrFallback } from '../lib/local_print_agent';
import { buildKitchenTicketHtml } from '../lib/kitchen_ticket_html';
import { buildKitchenTicketEscPos, parseModifierJson } from '../lib/escpos_builder';
import { wasTicketPrinted, markTicketPrinted, clearTicketPrinted } from '../lib/print_dedupe';
import { get_settings_live } from '../api/settings';

export default function KDS({ isActive = true }: { isActive?: boolean }) {
  const user = useAppStore((state) => state.user);
  const lang = useAppStore((state) => state.lang);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [readySelections, setReadySelections] = useState<Record<string, string[]>>({});
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const isStaffReadOnly = String(user?.role || '').toLowerCase() === 'staff';
  const isManager = ['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase());
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalItem[]>([]);

  // Kitchen printer & Auto-print state
  const [kitchenPrinter, setKitchenPrinter] = useState<string>('');
  const [useQz, setUseQz] = useState(false);
  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm'>('58mm');
  const [printEngine, setPrintEngine] = useState<'raw_escpos' | 'pixel_html'>('raw_escpos');
  const [companyName, setCompanyName] = useState('IRONWAVES POS');
  const [autoPrint, setAutoPrint] = useState(() => {
    try {
      return localStorage.getItem('kds_auto_print') === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    void (async () => {
      try {
        const s = await get_settings_live(tenant_id);
        const pSettings = s?.print_settings;
        if (pSettings) {
          setKitchenPrinter(pSettings.kitchen_printer_name || pSettings.printer_name || '');
          setUseQz(Boolean(pSettings.use_qz));
          if (pSettings.paper_width) setPaperWidth(pSettings.paper_width as '58mm' | '80mm');
          if (pSettings.print_engine) setPrintEngine(pSettings.print_engine as 'raw_escpos' | 'pixel_html');
        }
        if (s?.business_profile?.company_name) setCompanyName(s.business_profile.company_name);
      } catch {
        // no-op
      }
    })();
  }, [tenant_id]);

  const toggleAutoPrint = () => {
    const next = !autoPrint;
    setAutoPrint(next);
    try {
      localStorage.setItem('kds_auto_print', String(next));
    } catch {
      // no-op
    }
  };

  const handlePrintOrderTicket = async (orderGroup: any, opts?: { dedupe?: boolean }) => {
    // Auto-print idempotency (P1-1): a realtime push and the 8s poll can both surface a
    // freshly-arrived order before previousOrderIdsRef updates, and a remount can replay it.
    // Claim the key up front so only one auto-print wins; manual reprints pass no dedupe flag
    // and always print. Per-device only (localStorage) — cross-device is Faza B's job.
    const dedupeTicketId = String(orderGroup?.ids?.[0] || orderGroup?.id || '');
    const dedupeKey = opts?.dedupe && dedupeTicketId ? `kds:${kitchenPrinter || 'default'}:${dedupeTicketId}` : '';
    if (dedupeKey) {
      if (wasTicketPrinted(dedupeKey)) return;
      markTicketPrinted(dedupeKey);
    }
    try {
      const normalized = normalizeItems(orderGroup);

      // Build human-readable table label (never show UUID)
      const isUUID = (s: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s).trim());
      const rawLabel = orderGroup.table_label;
      const safeLabel = rawLabel && !isUUID(rawLabel) ? rawLabel : null;
      const contextLabel = safeLabel
        ? `Masa ${safeLabel}`
        : orderGroup.order_type
          ? String(orderGroup.order_type)
          : 'SIFARIS';

      const ticketData = {
        company_name: companyName,
        ticket_id: String(orderGroup.ids?.[0] || orderGroup.id || 'TICKET'),
        table_label: safeLabel,
        order_type_label: contextLabel,
        order_type: orderGroup.order_type,
        created_at: orderGroup.created_at,
        server_name: orderGroup.server_name,
        items: (orderGroup.items || normalized).map((it: any) => {
          const parsedMods = parseModifierJson(it.modifier_json);
          return {
            item_name: it.item_name || it.name,
            qty: Number(it.qty || it.quantity || 1),
            seat_label: it.seat_label,
            notes: it.note || it.notes || it.reason || undefined,
            modifiers: it.modifiers ?? parsedMods.modifiers,
            selected_modifiers: it.selected_modifiers ?? parsedMods.selected_modifiers,
          };
        }),
      };

      const html = buildKitchenTicketHtml({
        ticket: ticketData,
        lang,
        companyName,
        paperWidth,
      });

      const rawCmds = buildKitchenTicketEscPos(ticketData, { paperWidth });

      const res = await printDirectOrFallback(html, {
        printerName: kitchenPrinter,
        useQz,
        paperWidth,
        printEngine,
        rawCommands: rawCmds,
        allowBrowserFallback: true,
      });

      if (res.success) {
        useAppStore.getState().notify(
          'success',
          res.method === 'browser'
            ? tx(lang, 'Mətbəx çeki brauzer çapına göndərildi 🖨️', 'Чек кухни отправлен на печать браузера 🖨️', 'Kitchen ticket opened in browser print 🖨️')
            : tx(lang, 'Mətbəx çeki çapa göndərildi 🖨️', 'Чек кухни отправлен на печать 🖨️', 'Kitchen ticket sent to printer 🖨️'),
        );
      } else {
        if (dedupeKey) clearTicketPrinted(dedupeKey);
        useAppStore.getState().notify('error', tx(lang, res.error || 'Çap pəncərəsi açıla bilmədi', res.error || 'Не удалось открыть печать', res.error || 'Failed to open print dialog'));
      }
    } catch (e: any) {
      if (dedupeKey) clearTicketPrinted(dedupeKey);
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'print_ticket' });
      useAppStore.getState().notify('error', tx(lang, 'Çap xətası baş verdi', 'Ошибка печати', 'Print error occurred'));
    }
  };

  const [currentTime, setCurrentTime] = useState(Date.now());
  const fetchInFlightRef = useRef(false);
  const lastFetchAtRef = useRef(0);
  const previousOrderIdsRef = useRef<Set<string>>(new Set());
  const lastBellAtRef = useRef(0);

  const parseServerTimestamp = (value?: string | null) => {
    if (!value) return NaN;
    const normalized = /z$/i.test(value) || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
    return new Date(normalized).getTime();
  };

  const playKitchenBell = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastBellAtRef.current < 2500) return;
    lastBellAtRef.current = now;
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.(120);
      }
      const audio = new Audio('/sounds/kitchen-bell.mp3');
      audio.volume = 0.9;
      void audio.play().catch(() => {});
    } catch {
      // no-op
    }
  };

  const applyIncomingOrders = (incoming: KitchenOrder[]) => {
    const normalized = Array.isArray(incoming) ? incoming : [];
    const nextIds = new Set(normalized.map((row) => String((row as any)?.id || '')).filter(Boolean));
    const previousIds = previousOrderIdsRef.current;
    const newlyArrivedOrders = normalized.filter((row) => {
      const id = String((row as any)?.id || '');
      return id && !previousIds.has(id);
    });

    const hasNewOrders = previousIds.size > 0 && newlyArrivedOrders.length > 0;
    previousOrderIdsRef.current = nextIds;
    setOrders(normalized);

    if (hasNewOrders) {
      playKitchenBell();
      if (autoPrint) {
        newlyArrivedOrders.forEach((newOrder) => {
          void handlePrintOrderTicket(newOrder, { dedupe: true });
        });
      }
    }
  };

  // Sifarişləri mütəmadi olaraq yoxla (Simulyativ WebSocket)
  useEffect(() => {
    if (!isActive) return;
    let mounted = true;
    let pollTimer: number | null = null;
    let clockTimer: number | null = null;
    const fetchOrders = async (force = false) => {
      const now = Date.now();
      if (!force && (fetchInFlightRef.current || now - lastFetchAtRef.current < 2500)) return;
      fetchInFlightRef.current = true;
      lastFetchAtRef.current = now;
      try {
        const activeOrders = await get_kitchen_orders_live(tenant_id);
        if (!mounted) return;
        applyIncomingOrders(Array.isArray(activeOrders) ? activeOrders : []);
      } catch (e) {
        logUiError(tenant_id, 'kds', e instanceof Error ? e.message : String(e), { phase: 'fetch_orders' });
        if (!mounted) return;
        setOrders([]);
      } finally {
        fetchInFlightRef.current = false;
      }
    };
    const schedulePoll = () => {
      if (!mounted) return;
      const intervalMs = document.visibilityState === 'visible' ? 8000 : 60000;
      pollTimer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          void fetchOrders();
        }
        schedulePoll();
      }, intervalMs);
    };
    const scheduleClock = () => {
      if (!mounted) return;
      const intervalMs = document.visibilityState === 'visible' ? 10000 : 60000;
      clockTimer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') {
          setCurrentTime(Date.now());
        }
        scheduleClock();
      }, intervalMs);
    };
    const onVisibility = () => {
      if (!document.hidden) {
        setCurrentTime(Date.now());
        void fetchOrders(true);
      }
    };

    void fetchOrders(true);
    schedulePoll();
    scheduleClock();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted = false;
      if (pollTimer) window.clearTimeout(pollTimer);
      if (clockTimer) window.clearTimeout(clockTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tenant_id, isActive]);

  useEffect(() => {
    if (!isActive) return;
    let refreshTimer: number | null = null;
    const unsubscribe = subscribeTenantRealtime(tenant_id, (message) => {
      if (!['kitchen.updated', 'check.updated', 'table.updated'].includes(String(message.event || ''))) return;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (document.visibilityState !== 'visible') return;
        if (fetchInFlightRef.current || Date.now() - lastFetchAtRef.current < 1500) return;
        fetchInFlightRef.current = true;
        lastFetchAtRef.current = Date.now();
        void get_kitchen_orders_live(tenant_id)
          .then((activeOrders) => applyIncomingOrders(Array.isArray(activeOrders) ? activeOrders : []))
          .catch(() => {})
          .finally(() => {
            fetchInFlightRef.current = false;
          });
      }, 300);
    });
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [tenant_id, isActive]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Fetch pending approvals for managers
  useEffect(() => {
    if (!isActive || !isManager) return;
    let mounted = true;
    const fetchApprovals = () => {
      void get_pending_approvals_live()
        .then((items) => { if (mounted) setPendingApprovals(Array.isArray(items) ? items : []); })
        .catch(() => { if (mounted) setPendingApprovals([]); });
    };
    fetchApprovals();
    const timer = window.setInterval(fetchApprovals, 10000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [isActive, isManager]);

  const handleApproveVoid = async (itemId: string) => {
    try {
      await approve_void_request_live(itemId);
      setPendingApprovals((prev) => prev.filter((row) => row.id !== itemId));
      useAppStore.getState().notify('success', tx(lang, 'Ləğv təsdiqləndi', 'Отмена подтверждена', 'Void approved'));
    } catch (e: any) {
      useAppStore.getState().notify('error', e?.message || 'Error');
    }
  };

  const handleRejectVoid = async (itemId: string) => {
    try {
      await reject_void_request_live(itemId);
      setPendingApprovals((prev) => prev.filter((row) => row.id !== itemId));
      useAppStore.getState().notify('info', tx(lang, 'Ləğv rədd edildi', 'Отмена отклонена', 'Void rejected'));
    } catch (e: any) {
      useAppStore.getState().notify('error', e?.message || 'Error');
    }
  };

  const getElapsedMinutes = (created_at: string) => {
    const ts = parseServerTimestamp(created_at);
    if (Number.isNaN(ts)) return 0;
    return Math.max(0, Math.floor((currentTime - ts) / 60000));
  };

  const normalizeItems = (order: any) => {
    if (Array.isArray(order?.items)) return order.items;
    if (typeof order?.items === 'string') {
      try {
        const parsed = JSON.parse(order.items);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const getOrderContextLabel = (order: { table_label?: string | null; order_type?: string }) => {
    if (order.table_label) {
      return tx(lang, `Masa: ${order.table_label}`, `Стол: ${order.table_label}`, `Table: ${order.table_label}`);
    }
    const orderType = String(order.order_type || '').toUpperCase();
    switch (orderType) {
      case 'TAKEAWAY':
      case 'TAKE_OUT':
        return tx(lang, 'Apar', 'С собой', 'Takeaway');
      case 'DELIVERY':
        return tx(lang, 'Çatdırılma', 'Доставка', 'Delivery');
      case 'DINE_IN':
        return tx(lang, 'Zalda', 'В зале', 'Dine-in');
      default:
        return order.order_type || '';
    }
  };

  const handleAccept = async (order_id: string) => {
    if (isStaffReadOnly) return;
    try {
      await accept_order_live(order_id, user?.username || 'kitchen');
      setOrders(await get_kitchen_orders_live(tenant_id));
    } catch (e: any) {
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'accept_order', order_id });
      useAppStore.getState().notify('error', e.message);
    }
  };

  const handleComplete = async (order_id: string, readyItems: string[] = []) => {
    if (isStaffReadOnly) return;
    try {
      await complete_order_live(order_id, user?.username || 'kitchen', readyItems);
      setOrders(await get_kitchen_orders_live(tenant_id));
    } catch (e: any) {
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'complete_order', order_id });
      useAppStore.getState().notify('error', e.message);
    }
  };

  const getStatusColor = (status: string, created_at: string) => {
    const elapsed = getElapsedMinutes(created_at);
    if (elapsed > 15) return 'border-red-400/80 bg-red-900/25';
    if (elapsed > 10) return 'border-yellow-300/80 bg-yellow-900/20';
    const s = String(status || '').toUpperCase();
    return (ORDER_STATUS_THEME[s] || ORDER_STATUS_THEME_DEFAULT).card;
  };

  // Instructional prefix/helper texts for special KDS item tones (styling itself
  // comes from the shared ORDER_STATUS_THEME in tableUtils).
  const kitchenItemToneInfo: Record<string, { prefix: string; helper: string }> = {
    VOID_REQUESTED: {
      prefix: tx(lang, 'STOP / LƏĞV TƏLƏBİ', 'СТОП / ЗАПРОС ОТМЕНЫ', 'STOP / CANCEL REQUEST'),
      helper: tx(lang, 'Bu item üzrə hazırlığı dayandırın və təsdiq gözləyin.', 'Остановите подготовку этой позиции и ждите подтверждения.', 'Stop prep for this item and wait for confirmation.'),
    },
    REMAKE: {
      prefix: tx(lang, 'DÜZƏLİŞ / ƏVVƏLKİNİ HAZIRLAMA', 'ИСПРАВЛЕНИЕ / НЕ ГОТОВИТЬ СТАРОЕ', 'CORRECTION / DO NOT PREP OLD'),
      helper: tx(lang, 'Bu item yenisi ilə əvəzlənib. Yeni düzəliş sətrini hazırlayın.', 'Эта позиция заменена новой. Готовьте новую строку исправления.', 'This item was replaced. Prep the new correction line.'),
    },
    CORRECTION: {
      prefix: tx(lang, 'YENİ DÜZƏLİŞ', 'НОВОЕ ИСПРАВЛЕНИЕ', 'NEW CORRECTION'),
      helper: tx(lang, 'Bu yeni düzəliş sətridir. Bunu hazırlayın, əvvəlki sətri hazırlamayın.', 'Это новая строка исправления. Готовьте ее, старую строку не готовьте.', 'This is the new correction row. Prep this and do not prep the old row.'),
    },
    WASTE: {
      prefix: tx(lang, 'İSRAF', 'СПИСАНО', 'WASTE'),
      helper: tx(lang, 'Audit üçün saxlanılıb, hazırlanma axınına daxil etməyin.', 'Сохранено для аудита, не включайте в приготовление.', 'Kept for audit, do not prep.'),
    },
    COMPED: {
      prefix: tx(lang, 'HESABDAN SİLİNİB', 'СПИСАНО СО СЧЕТА', 'COMPED'),
      helper: tx(lang, 'Billing dəyişib, item auditdə qalır.', 'Биллинг изменен, позиция остается в аудите.', 'Billing changed, item remains in audit.'),
    },
    VOIDED: {
      prefix: tx(lang, 'LƏĞV EDİLDİ', 'ОТМЕНЕНО', 'VOIDED'),
      helper: tx(lang, 'Bu item aktiv hazırlanma siyahısından çıxıb.', 'Эта позиция снята с активного приготовления.', 'This item is no longer active for prep.'),
    },
  };

  const kitchenItemTone = (status: string) => {
    const s = String(status || '').toUpperCase();
    const theme = ORDER_STATUS_THEME[s] || ORDER_STATUS_THEME_DEFAULT;
    const info = kitchenItemToneInfo[s];
    return {
      row: theme.row,
      qty: theme.qty,
      prefix: info?.prefix || '',
      helper: info?.helper || '',
    };
  };

  const getStatusBadge = (status: string) => {
    const s = String(status || '').toUpperCase();
    const theme = ORDER_STATUS_THEME[s];
    if (!theme || !theme.badge) return null;
    const l = theme.label;
    return <span className={`rounded px-2 py-1 text-xs font-bold ${theme.badge}`}>{tx(lang, l.az, l.ru, l.en)}</span>;
  };

  const groupedOrders = useMemo(() => {
    const groupMap = new Map<string, {
    key: string;
    table_label: string | null;
    order_type?: string;
    status: 'NEW' | 'PREPARING' | 'READY' | 'DONE' | 'VOID_REQUESTED';
    priority: 'NORMAL' | 'URGENT';
    created_at: string;
    ids: string[];
    newIds: string[];
    preparingIds: string[];
    readyIds: string[];
    items: Array<{ ids: string[]; item_name: string; qty: number; seat_label?: string; action?: string | null; status?: string; reason?: string; parent_item_id?: string; note?: string }>;
    batchCount: number;
  }>();

    orders.forEach((order) => {
    const key = order.table_label ? `table:${order.table_label}` : `order:${order.id}`;
      const existing = groupMap.get(key);
    const normalizedItems = normalizeItems(order);
    const sourceStatus = String((order as any)?.status || '').toUpperCase();

    if (!existing) {
      const hasKitchenInstruction = normalizedItems.some((item: any) => ['VOID_REQUESTED', 'REMAKE', 'WASTE'].includes(String(item.status || item.action || '').toUpperCase()));
        groupMap.set(key, {
        key,
        table_label: order.table_label || null,
        order_type: order.order_type,
        status: hasKitchenInstruction ? 'VOID_REQUESTED' : sourceStatus === 'SENT' ? 'NEW' : (sourceStatus as 'NEW' | 'PREPARING' | 'READY' | 'DONE'),
        priority: order.priority,
        created_at: order.created_at,
        ids: [order.id],
        newIds: ['NEW', 'SENT'].includes(sourceStatus) ? [order.id] : [],
        preparingIds: sourceStatus === 'PREPARING' ? [order.id] : [],
        readyIds: sourceStatus === 'READY' ? [order.id] : [],
        items: normalizedItems.map((item: any) => ({
          ids: item.id ? [String(item.id)] : [],
          item_name: item.item_name,
          qty: Number(item.qty || 0),
          seat_label: item.seat_label ? String(item.seat_label) : undefined,
          action: String(item.action || '').toUpperCase() || null,
          status: String(item.status || item.action || order.status || '').toUpperCase(),
          reason: item.reason || '',
          parent_item_id: item.parent_item_id,
          note: item.note || '',
        })),
        batchCount: 1,
      });
        return;
    }

    existing.ids.push(order.id);
    existing.batchCount += 1;
    if (['NEW', 'SENT'].includes(order.status)) existing.newIds.push(order.id);
    if (order.status === 'PREPARING') existing.preparingIds.push(order.id);
    if (order.status === 'READY') existing.readyIds.push(order.id);
    if (order.priority === 'URGENT') existing.priority = 'URGENT';

    const currentCreated = parseServerTimestamp(existing.created_at);
    const nextCreated = parseServerTimestamp(order.created_at);
    if (!Number.isNaN(nextCreated) && (Number.isNaN(currentCreated) || nextCreated < currentCreated)) {
      existing.created_at = order.created_at;
    }

    if (existing.items.some((item) => ['VOID_REQUESTED', 'REMAKE', 'WASTE'].includes(String(item.status || '').toUpperCase()))) existing.status = 'VOID_REQUESTED';
    else if (existing.newIds.length > 0) existing.status = 'NEW';
    else if (existing.preparingIds.length > 0) existing.status = 'PREPARING';
    else existing.status = 'READY';

    normalizedItems.forEach((item: any) => {
      const itemAction = String(item.action || '').toUpperCase() || null;
      const itemStatus = String(item.status || item.action || order.status || '').toUpperCase();
      const itemSeat = item.seat_label ? String(item.seat_label) : undefined;
      const idx = existing.items.findIndex((row) => row.item_name === item.item_name && (row.action || null) === itemAction && (row.status || '') === itemStatus && (row.seat_label || '') === (itemSeat || ''));
      if (idx >= 0) {
        existing.items[idx].qty += Number(item.qty || 0);
        if (item.id) existing.items[idx].ids.push(String(item.id));
      } else {
        existing.items.push({ ids: item.id ? [String(item.id)] : [], item_name: item.item_name, qty: Number(item.qty || 0), seat_label: itemSeat, action: itemAction, status: itemStatus, reason: item.reason || '', parent_item_id: item.parent_item_id, note: item.note || '' });
      }
    });
    });
    return Array.from(groupMap.values());
  }, [orders]);

  const handleAcceptGroup = async (group: { newIds: string[] }) => {
    if (isStaffReadOnly) return;
    try {
      await Promise.all(group.newIds.map((orderId) => accept_order_live(orderId, user?.username || 'kitchen')));
      setOrders(await get_kitchen_orders_live(tenant_id));
    } catch (e: any) {
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'accept_group', ids: group.newIds });
      useAppStore.getState().notify('error', e.message);
    }
  };

  const handleCompleteGroup = async (group: { key: string; preparingIds: string[] }) => {
    if (isStaffReadOnly) return;
    try {
      const selectedReadyKeys = readySelections[group.key] || [];
      const selectedReady = selectedReadyKeys.map((entry) => {
        const [itemName, seatLabel] = String(entry).split('::');
        return seatLabel ? `${itemName} · ${seatLabel}` : itemName;
      });
      await Promise.all(group.preparingIds.map((orderId) => complete_order_live(orderId, user?.username || 'kitchen', selectedReady)));
      setReadySelections((prev) => {
        const next = { ...prev };
        delete next[group.key];
        return next;
      });
      setOrders(await get_kitchen_orders_live(tenant_id));
    } catch (e: any) {
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'complete_group', ids: group.preparingIds });
      useAppStore.getState().notify('error', e.message);
    }
  };

  const handleItemStatus = async (itemIds: string[], nextStatus: 'PREPARING' | 'READY' | 'SERVED') => {
    if (isStaffReadOnly) return;
    try {
      const ids = itemIds.filter(Boolean);
      if (ids.length === 0) return;
      const runner = nextStatus === 'PREPARING'
        ? start_kitchen_item_status_live
        : nextStatus === 'READY'
          ? ready_kitchen_item_status_live
          : serve_kitchen_item_status_live;
      await Promise.all(ids.map((itemId) => runner(itemId)));
      setOrders(await get_kitchen_orders_live(tenant_id));
    } catch (e: any) {
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'item_status', nextStatus, itemIds });
      useAppStore.getState().notify('error', e.message || tx(lang, 'Item statusu dəyişmədi', 'Статус позиции не изменился', 'Item status was not updated'));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 text-slate-100">
      {!isOnline && (
        <div className="mb-4 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <div className="font-semibold">{tx(lang, 'Offline mətbəx rejimi aktivdir', 'Офлайн режим кухни активен', 'Offline kitchen mode is active')}</div>
          <div className="mt-1 text-amber-200/90">
            {tx(
              lang,
              'Aktiv sifarişlər lokal yaddaşdan oxunur. Qəbul et və Hazırdır əməliyyatları bu cihazda saxlanacaq.',
              'Активные заказы читаются из локального хранилища. Действия принять и готово будут сохранены на этом устройстве.',
              'Active orders are read from local storage. Accept and Ready actions will be stored on this device.',
            )}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center text-slate-100">
          <ChefHat size={28} className="mr-3 text-yellow-300" />
          <h1 className="text-2xl font-bold">{tx(lang, 'Mətbəx ekranı', 'Экран кухни', 'Kitchen display')}</h1>
        </div>
        <div className="flex gap-3 text-sm font-medium items-center">
          <button
            type="button"
            onClick={toggleAutoPrint}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition border active:scale-95 ${
              autoPrint
                ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300 shadow-sm shadow-emerald-500/20'
                : 'border-slate-600/70 bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Printer size={15} className={autoPrint ? 'text-emerald-400 animate-pulse' : 'text-slate-400'} />
            <span>{autoPrint ? tx(lang, 'Avto-Çap: Aktiv', 'Автопечать: Вкл', 'Auto-Print: ON') : tx(lang, 'Avto-Çap: Deaktiv', 'Автопечать: Выкл', 'Auto-Print: OFF')}</span>
          </button>
          <div className="metal-panel px-4 py-2 text-slate-300 flex items-center">
            {tx(lang, 'Aktiv Sifarişlər', 'Активные заказы', 'Active Orders')}: <span className="ml-2 text-yellow-300 text-lg font-bold">{groupedOrders.length}</span>
          </div>
        </div>
      </div>

      {/* Pending Approvals Panel - Manager only */}
      {isManager && pendingApprovals.length > 0 && (
        <div className="mb-6 rounded-2xl border-2 border-yellow-400/50 bg-yellow-400/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertCircle size={20} className="text-yellow-300" />
            <h2 className="text-lg font-bold text-yellow-100">
              {tx(lang, 'Gözləyən ləğv tələbləri', 'Ожидающие запросы на отмену', 'Pending void requests')}
              <span className="ml-2 rounded-full bg-yellow-400/20 px-2.5 py-0.5 text-sm text-yellow-200">{pendingApprovals.length}</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pendingApprovals.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-yellow-300/30 bg-slate-900/60 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-slate-100">{item.item_name} <span className="text-slate-400">×{item.qty}</span></div>
                  <div className="text-xs text-slate-400">
                    {item.table_label ? `Masa: ${item.table_label}` : ''}{item.action_by ? ` · ${item.action_by}` : ''}
                  </div>
                  {item.status_reason && <div className="mt-0.5 text-xs text-yellow-200/80">{item.status_reason}</div>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleApproveVoid(item.id)}
                    className="rounded-lg border border-emerald-300/40 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-100 transition active:scale-95"
                  >
                    {tx(lang, 'Təsdiq', 'Одобрить', 'Approve')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRejectVoid(item.id)}
                    className="rounded-lg border border-rose-300/40 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-100 transition active:scale-95"
                  >
                    {tx(lang, 'Rədd', 'Отклонить', 'Reject')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
        {groupedOrders.map(order => (
          <div key={order.key} className={`flex flex-col rounded-2xl border-2 overflow-hidden ${getStatusColor(order.status, order.created_at)}`}>
            
            <div className="p-4 border-b border-slate-600/40 flex justify-between items-center bg-slate-900/25">
              <div className="flex flex-col gap-1">
                <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-100">#{String(order.ids[0] || '').substring(0,4).toUpperCase()}</span>
                  {getStatusBadge(order.status)}
                  {order.priority === 'URGENT' && (
                      <span className="flex items-center text-red-500 text-xs font-bold ml-2">
                      <AlertCircle size={14} className="mr-1" /> {tx(lang, 'TƏCİLİ', 'СРОЧНО', 'URGENT')}
                    </span>
                  )}
                  {order.batchCount > 1 && (
                    <span className="rounded px-2 py-1 text-xs font-bold bg-violet-400/20 text-violet-200 border border-violet-300/40">
                      +{order.batchCount - 1} {tx(lang, 'əlavə göndəriş', 'добавление', 'updates')}
                    </span>
                  )}
                </div>
                {(order.table_label || order.order_type) && (
                  <div className="text-xs font-bold text-slate-200 bg-slate-700/40 inline-block px-2 py-0.5 rounded">
                    {getOrderContextLabel(order)}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end text-sm font-medium gap-1.5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    title={tx(lang, 'Mətbəx çekini çap et', 'Распечатать чек кухни', 'Print kitchen ticket')}
                    onClick={() => { void handlePrintOrderTicket(order); }}
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-600/70 bg-slate-800/90 text-slate-300 hover:text-yellow-300 hover:border-yellow-400/50 transition active:scale-90 shadow-sm"
                  >
                    <Printer size={15} />
                  </button>
                  <div className="flex items-center text-slate-100 font-black text-sm bg-slate-800/90 px-2.5 py-1.5 rounded-xl border border-slate-600/70 shadow-sm">
                    <Clock size={15} className="mr-1 text-amber-300" />
                    {getElapsedMinutes(order.created_at)} {tx(lang, 'dəq', 'мин', 'min')}
                  </div>
                </div>
                <div className="text-slate-300 text-xs font-semibold">
                  {new Date(parseServerTimestamp(order.created_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>

            <div className="flex-1 p-4 bg-slate-900/15">
              {order.items.some((item: any) => ['VOID_REQUESTED', 'REMAKE', 'WASTE'].includes(String(item.status || '').toUpperCase())) ? (
                <div className="mb-4 rounded-2xl border border-yellow-300/60 bg-yellow-400/15 px-4 py-3 text-sm font-black text-yellow-100">
                  {tx(lang, 'STOP: Bu sifarişdə ləğv/düzəliş siqnalı var. Hazırlamağa davam etmədən əvvəl item sətrlərini yoxlayın.', 'СТОП: В этом заказе есть отмена/исправление. Проверьте строки перед продолжением.', 'STOP: This order has a cancel/correction signal. Check item rows before continuing.')}
                </div>
              ) : null}
              <ul className="space-y-3">
                {order.items.map((item: any, idx: number) => {
                  const itemStatus = String(item.status || order.status || '').toUpperCase();
                  const canStart = ['NEW', 'SENT'].includes(itemStatus);
                  const canReady = ['NEW', 'SENT', 'PREPARING'].includes(itemStatus);
                  const canServe = itemStatus === 'READY';
                  const isCancelled = ['CANCEL', 'VOIDED', 'VOID_REQUESTED', 'WASTE', 'COMPED', 'REMAKE'].includes(String(item.action || itemStatus || '').toUpperCase());
                  const isCancelRequested = itemStatus === 'VOID_REQUESTED';
                  const toneStatus = item.parent_item_id && ['NEW', 'SENT', 'PREPARING', 'READY'].includes(itemStatus) ? 'CORRECTION' : itemStatus;
                  const tone = kitchenItemTone(toneStatus);
                  const isKitchenInstruction = ['VOID_REQUESTED', 'REMAKE', 'WASTE', 'COMPED', 'VOIDED'].includes(itemStatus);
                  return (
                    <li key={idx} className={`flex flex-col gap-3 rounded-xl border px-3 py-3 text-lg font-medium ${tone.row}`}>
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex min-w-0 items-start">
                          <span className={`mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded text-sm ${tone.qty}`}>
                            {item.qty}
                          </span>
                          <span className="min-w-0">
                            {tone.prefix ? `${tone.prefix} · ` : isCancelRequested ? `${tx(lang, 'STOP / LƏĞV TƏLƏBİ', 'СТОП / ЗАПРОС ОТМЕНЫ', 'STOP / CANCEL REQUEST')} · ` : isCancelled ? `${tx(lang, 'LƏĞV', 'ОТМЕНА', 'CANCEL')} · ` : ''}
                            {item.item_name}
                            {item.seat_label ? <span className="ml-2 text-xs font-medium text-cyan-200/80">[{item.seat_label}]</span> : null}
                            {item.reason ? (
                              <span className="ml-2 text-xs font-medium text-rose-200/80">({item.reason})</span>
                            ) : null}
                            {item.note && itemStatus === 'SENT' ? (
                              <span className="ml-2 text-xs font-medium text-amber-100/80">({item.note})</span>
                            ) : null}
                          </span>
                        </span>
                        {getStatusBadge(itemStatus)}
                      </div>
                      {tone.helper ? (
                        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 pl-10 text-sm font-bold">
                          {tone.helper}
                          {item.parent_item_id ? <span className="ml-2 text-xs opacity-70">#{String(item.parent_item_id).slice(0, 6).toUpperCase()}</span> : null}
                        </div>
                      ) : null}
                      {!isKitchenInstruction && item.ids?.length > 0 ? (
                        <div className="flex flex-wrap gap-2 pl-10">
                          {canStart ? (
                            <button type="button" aria-label={tx(lang, 'Hazırlığa başla', 'Начать готовить', 'Start preparing')} onClick={() => { void handleItemStatus(item.ids, 'PREPARING'); }} className="min-h-12 rounded-xl border border-blue-300/35 bg-blue-500/10 px-4 py-2.5 text-xs font-black text-blue-100">
                              {tx(lang, 'Başla', 'Начать', 'Start')}
                            </button>
                          ) : null}
                          {canReady ? (
                            <button type="button" aria-label={tx(lang, 'Sifarişi hazır et', 'Отметить готовым', 'Mark ready')} onClick={() => { void handleItemStatus(item.ids, 'READY'); }} className="min-h-12 rounded-xl border border-yellow-300/40 bg-yellow-400/15 px-4 py-2.5 text-xs font-black text-yellow-100">
                              {tx(lang, 'Hazırdır', 'Готово', 'Ready')}
                            </button>
                          ) : null}
                          {canServe ? (
                            <button type="button" aria-label={tx(lang, 'Servis edildi kimi işarələ', 'Отметить как подано', 'Mark as served')} onClick={() => { void handleItemStatus(item.ids, 'SERVED'); }} className="min-h-12 rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-2.5 text-xs font-black text-emerald-100">
                              {tx(lang, 'Servis edildi', 'Подано', 'Served')}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="p-4 mt-auto">
              {order.status === 'NEW' && (
                <button
                  onClick={() => { void handleAcceptGroup(order); }}
                  className="w-full py-3 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-sm"
                >
                  {order.newIds.length > 1
                    ? tx(lang, 'Yeni əlavələri qəbul et', 'Принять новые добавления', 'Accept new additions')
                    : tx(lang, 'Qəbul Et (Hazırla)', 'Принять (готовить)', 'Accept (Start Preparing)')}
                </button>
              )}
              {order.status === 'PREPARING' && (
                <button
                  onClick={() => { void handleCompleteGroup(order); }}
                  className="w-full py-3 rounded-xl font-bold bg-yellow-400 hover:bg-yellow-300 text-slate-900 transition-colors shadow-sm flex items-center justify-center"
                >
                  <CheckCircle size={20} className="mr-2" />
                  {tx(lang, 'Hazırdır (Tamamla)', 'Готово (завершить)', 'Ready (Complete)')}
                </button>
              )}
              {order.status === 'READY' && (
                <div className="w-full rounded-xl border border-emerald-300/40 bg-emerald-500/10 px-4 py-3 text-center text-sm font-semibold text-emerald-100">
                  {tx(lang, 'Ofisant üçün hazırdır', 'Готово для официанта', 'Ready for waiter')}
                </div>
              )}
            </div>
            
          </div>
        ))}

        {orders.length === 0 && (
          <div className="metal-panel col-span-full py-20 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-600/70">
            <ChefHat size={48} className="mb-4 text-slate-500" />
            <p className="text-xl font-medium text-slate-300">{tx(lang, 'Hazırda aktiv sifariş yoxdur', 'Сейчас нет активных заказов', 'There are no active orders right now')}</p>
            <p className="text-sm">{tx(lang, 'Yeni sifarişlər avtomatik olaraq bura düşəcək.', 'Новые заказы появятся здесь автоматически.', 'New orders will appear here automatically.')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
