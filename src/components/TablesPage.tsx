import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import QRCode from 'qrcode';
import { create_table_live, delete_table_live, open_table_live, transfer_table_live, revise_table_items_live, abort_table_live } from '../api/tables';
import { act_on_order_item_live, create_floor_plan_live, update_floor_plan_live, delete_floor_plan_live, add_check_draft_item_live, cancel_table_check_live, combine_tables_live, create_reservation_live, delete_draft_item_live, delete_reservation_live, get_floor_plans_live, get_floor_state_live, get_order_item_status_logs_live, get_table_detail_live, seat_reservation_live, send_check_drafts_live, send_table_round_live, settle_table_check_live, split_table_group_live, transfer_table_lock_live, unlock_table_live, update_draft_item_live, update_reservation_live, update_table_layout_live, type FloorPlanRecord, type FloorTableState, type ReservationRecord, type TableDetailRecord } from '../api/restaurant';
import { LayoutGrid, Plus, CalendarClock, Users, MapPinned } from 'lucide-react';
import { useAppStore } from '../store';
import { tx } from '../i18n';
import ConfirmModal from './ConfirmModal';
import { Decimal } from 'decimal.js';
import { get_business_profile, get_settings, get_settings_live } from '../api/settings';
import { save_sale_receipt_html_live } from '../api/pos';
import { isBackendEnabled } from '../api/client';
import { getDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { qzPrintHtml } from '../lib/qz';
import { hostScopedKey } from '../lib/storage_keys';
import { sanitizeHtmlForIframe } from '../lib/html_sanitize';
import { THERMAL_RECEIPT_PRINT_CSS } from '../lib/receipt_print_css';
import { printViaLocalAgent } from '../lib/local_print_agent';
import { getTenantDomains } from '../lib/tenant';
import { formatRestaurantLocalTime, formatServerUtcDateTime, formatServerUtcTime, localDateInputValue, parseRestaurantLocalTimestamp } from '../lib/time';
import TableGrid from './tables/TableGrid';
import MenuGrid from './tables/MenuGrid';
import StickyActionBar from './tables/StickyActionBar';
import BahaYTableCompose from './tables/BahaYTableCompose';
import ReceiptPreview from './tables/ReceiptPreview';
import OperationsPanel from './tables/OperationsPanel';
import OpenTableDialog from './tables/OpenTableDialog';
import ItemActionModal from './tables/ItemActionModal';
import RevisionModal from './tables/RevisionModal';
import StatusLogModal from './tables/StatusLogModal';
import CreateFloorPlanDialog from './tables/CreateFloorPlanDialog';
import CreateReservationDialog from './tables/CreateReservationDialog';
import DeleteAuthDialog from './tables/DeleteAuthDialog';
import ServiceTab from './tables/ServiceTab';
import HistoryTab from './tables/HistoryTab';
import FullOrderListModal from './tables/FullOrderListModal';
import SentItemsSlideUp from './tables/SentItemsSlideUp';
import FloorView from './tables/FloorView';
import PaymentModal from './tables/PaymentModal';
import ReservationPanel from './tables/ReservationPanel';
import {
  getWaiterColor,
  kitchenBadge as kitchenBadgeUtil,
  normalizeOrderItemStatus,
  sentItemActions as sentItemActionsUtil,
  itemActionNeedsManager as itemActionNeedsManagerUtil,
  formatDisplayId,
  itemActionLabel as itemActionLabelUtil,
} from '../utils/tables/tableUtils';
import {
  computeFloorSummary,
  suggestReservationTables,
  computeMergedGroups,
  computeMergedGroupOutlines,
  computeReservationTimeline,
} from '../utils/tables/floorUtils';
import {
  filterMenuByCategory,
  extractCategories,
  computeReadyCountsByLabel,
} from '../utils/tables/roundUtils';
import {
  buildEqualSplitParts,
  getMaxSplitCount,
  normalizeSplitCount as normalizeSplitCountUtil,
  normalizeTableDiscountPercent,
  rebalanceSplitParts,
  isBillablePaymentItem,
  calculateBillBreakdown,
} from '../utils/tables/paymentUtils';
import { useTablesStore } from '../stores/tablesStore';
import { useTablesData } from '../hooks/tables/useTablesData';
import { useRealtimeSync } from '../hooks/tables/useRealtimeSync';

const TABLE_DISCOUNT_PRESETS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const;

// BahaY: detect modern UI mode from tenant settings (fallback to super lab)
const isBahaYLabHost = (() => {
  try { return String(window.location.hostname || '').toLowerCase() === 'super.ironwaves.store'; }
  catch { return false; }
})();

export default function TablesPage({ isActive = true }: { isActive?: boolean }) {
  const [tables, setTables] = useState<any[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<any[]>([]);
  const [menuCatalog, setMenuCatalog] = useState<any[]>([]);
  const user = useAppStore((state) => state.user);
  const lang = useAppStore((state) => state.lang);
  const notify = useAppStore((state) => state.notify);
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [newTableName, setNewTableName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<'floor' | 'reservations'>('floor');
  const [deleteTableId, setDeleteTableId] = useState<string | null>(null);
  const [pendingCancelTable, setPendingCancelTable] = useState<{ id: string; label: string } | null>(null);
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState('1');
  const [depositGuestCount, setDepositGuestCount] = useState('0');
  const [showDeleteAuth, setShowDeleteAuth] = useState(false);
  const [payTableId, setPayTableId] = useState<string | null>(null);
  const [viewTableId, setViewTableId] = useState<string | null>(null);
  const [tableDetailClosing, setTableDetailClosing] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [lockTransferTarget, setLockTransferTarget] = useState('');
  const [lockReason, setLockReason] = useState('');
  const [itemActionTarget, setItemActionTarget] = useState<any | null>(null);
  const [itemActionReason, setItemActionReason] = useState('');
  const [itemActionReasonCode, setItemActionReasonCode] = useState('guest_changed_mind');
  const [itemActionQuantityDelta, setItemActionQuantityDelta] = useState('1');
  const [itemActionManagerPassword, setItemActionManagerPassword] = useState('');
  const [tableReceiptHtml, setTableReceiptHtml] = useState<string | null>(null);
  const safeTableReceiptHtml = useMemo(() => sanitizeHtmlForIframe(tableReceiptHtml), [tableReceiptHtml]);
  const [revisionTarget, setRevisionTarget] = useState<{ tableId: string; itemName: string; nextItems: any[]; hasSentItems: boolean } | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [revisionOverridePassword, setRevisionOverridePassword] = useState('');
  const [showFullOrderList, setShowFullOrderList] = useState(false);
  const [showSentSlideUp, setShowSentSlideUp] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'Nəğd' | 'Kart' | 'Split'>('Nəğd');
  const [tableDiscountPercent, setTableDiscountPercent] = useState('0');
  const [tableDiscountReason, setTableDiscountReason] = useState('');
  const [splitCash, setSplitCash] = useState('0');
  const [splitCount, setSplitCount] = useState('2');
  const [splitParts, setSplitParts] = useState<Array<{ amount: string; method: 'Nəğd' | 'Kart' }>>([]);
  const [roundSearch, setRoundSearch] = useState('');
  const [roundCategory, setRoundCategory] = useState('ALL');
  const [roundDraft, setRoundDraft] = useState<any[]>([]);
  const [draftSendError, setDraftSendError] = useState<string | null>(null);
  const [statusLogTarget, setStatusLogTarget] = useState<any | null>(null);
  const [statusLogRows, setStatusLogRows] = useState<any[]>([]);
  const [servedItemsMap, setServedItemsMap] = useState<Record<string, Record<string, number>>>({});
  const [tableWorkspaceTab, setTableWorkspaceTab] = useState<'compose' | 'service' | 'history' | 'ops'>('compose');
  const [floorPlans, setFloorPlans] = useState<FloorPlanRecord[]>([]);
  const [isFloorPlansLoading, setIsFloorPlansLoading] = useState(true);
  const [activeFloorId, setActiveFloorId] = useState<string>('');
  const [floorTables, setFloorTables] = useState<FloorTableState[]>([]);
  const [floorEditMode, setFloorEditMode] = useState(false);
  const [floorViewMode, setFloorViewMode] = useState<'map' | 'list'>('list');
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [draggingTableIds, setDraggingTableIds] = useState<string[]>([]);
  const [floorDropPreview, setFloorDropPreview] = useState<{ x: number; y: number } | null>(null);
  const [draggingReservationId, setDraggingReservationId] = useState<string | null>(null);
  const [reservationDropPreview, setReservationDropPreview] = useState<{ lane: number; top: number; reservationAt: string; assignedTableId: string | null; hasConflict: boolean } | null>(null);
  const [selectedFloorTableId, setSelectedFloorTableId] = useState<string | null>(null);
  const [selectedFloorTableLabel, setSelectedFloorTableLabel] = useState('');
  const [selectedFloorGroupId, setSelectedFloorGroupId] = useState<string | null>(null);
  const [floorMultiSelectMode, setFloorMultiSelectMode] = useState(false);
  const [selectedFloorTableIds, setSelectedFloorTableIds] = useState<string[]>([]);
  const [copyLayoutSourceFloorId, setCopyLayoutSourceFloorId] = useState<string>('');
  const [reservationDurationDrafts, setReservationDurationDrafts] = useState<Record<string, number>>({});
  const [resizingReservation, setResizingReservation] = useState<{ id: string; startY: number; startDuration: number } | null>(null);
  const [reservationZoom, setReservationZoom] = useState<15 | 30>(15);
  const [tableGridScale, setTableGridScale] = useState(100);
  const [reservationDate, setReservationDate] = useState(() => localDateInputValue());
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [showReservationCreate, setShowReservationCreate] = useState(false);
  const [showCreateFloorPlan, setShowCreateFloorPlan] = useState(false);
  const [newFloorPlanName, setNewFloorPlanName] = useState('');
  const [newFloorPlanWidth, setNewFloorPlanWidth] = useState(12);
  const [newFloorPlanHeight, setNewFloorPlanHeight] = useState(8);
  const [reservationGuestName, setReservationGuestName] = useState('');
  const [reservationPhone, setReservationPhone] = useState('');
  const [reservationTime, setReservationTime] = useState('19:00');
  const [reservationPartySize, setReservationPartySize] = useState('2');
  const [reservationNote, setReservationNote] = useState('');
  const [reservationAssignedTableId, setReservationAssignedTableId] = useState('');
  const [reservationStatusDraft, setReservationStatusDraft] = useState<'BOOKED' | 'WAITLIST'>('BOOKED');
  const [tableDetailRecord, setTableDetailRecord] = useState<TableDetailRecord | null>(null);
  const [tenantSettings, setTenantSettings] = useState<any>({});
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const sendRoundInFlightRef = useRef(false);
  const detailFetchSeqRef = useRef(0);
  const isActiveRef = useRef(isActive);
  const skipNextFloorStateLoadRef = useRef<string>('');
  const activeFloorIdRef = useRef<string>('');
  const viewTableIdRef = useRef<string | null>(null);
  const workspaceViewRef = useRef<'floor' | 'reservations'>('floor');
  const reservationDateRef = useRef(reservationDate);
  const businessProfile = get_business_profile(tenant_id);
  const printSettings = tenantSettings.print_settings || { use_qz: false, printer_name: '' };
  const tablesUiMode = (() => {
    try {
      const local = localStorage.getItem('iw_tables_ui_mode');
      if (local === 'modern' || local === 'classic') return local;
    } catch {}
    const fromSettings = String(tenantSettings.session_settings?.tables_ui_mode || tenantSettings.tables_ui_mode || '').toLowerCase();
    if (fromSettings === 'modern' || fromSettings === 'classic') return fromSettings;
    return 'classic';
  })();
  const isBahaYLab = isBahaYLabHost || tablesUiMode === 'modern';
  const depositPerGuest = new Decimal((tenantSettings as any).table_service_settings?.deposit_per_guest_azn || 0);
  const reservationLockHours = Math.max(0, Number((tenantSettings as any).table_service_settings?.reservation_lock_hours ?? 2));
  const serviceFeePercent = new Decimal(tenantSettings.service_fee_percent || 0);

  // ── Data loading hook (Task 8) ──
  const {
    loadData,
    loadTablesBootstrap,
    forceTablesBootstrapRefresh,
    loadKitchenFeed,
    loadMenuCatalog,
    loadReservations,
    loadRestaurantData,
    loadFloorState,
    refreshActiveTableDetail,
  } = useTablesData({
    tenantId: tenant_id,
    setTables,
    setKitchenOrders,
    setMenuCatalog,
    setFloorPlans,
    setFloorTables,
    setActiveFloorId,
    setIsFloorPlansLoading,
    setReservations,
    setTableDetailRecord,
    activeFloorIdRef,
    workspaceViewRef,
    reservationDateRef,
    skipNextFloorStateLoadRef,
    detailFetchSeqRef,
  });

  // ── Realtime sync hook (Task 7) ──
  useRealtimeSync({
    tenantId: tenant_id,
    isActive,
    setTables,
    setKitchenOrders,
    setFloorTables,
    setReservations,
    setTableDetailRecord,
    activeFloorIdRef,
    viewTableIdRef,
    workspaceViewRef,
    reservationDateRef,
    detailFetchSeqRef,
    isActiveRef,
  });

  useEffect(() => {
    let mounted = true;
    try {
      const localSettings = get_settings(tenant_id);
      if (mounted) {
        setTenantSettings(localSettings || {});
      }
      (async () => {
        try {
          const settings = await get_settings_live(tenant_id);
          if (!mounted) return;
          setTenantSettings(settings || {});
        } catch {
          // ignore
        }
      })();
    } catch {
      if (mounted) {
        setTenantSettings({});
      }
    }
    return () => {
      mounted = false;
    };
  }, [tenant_id]);

  const formatDisplayId_ = formatDisplayId;
  const kitchenBadge = (status?: string | null) => kitchenBadgeUtil(status, {
    sent: tx(lang, 'Mətbəxə göndərildi', 'Отправлено на кухню', 'Sent to kitchen'),
    preparing: tx(lang, 'Hazırlanır', 'Готовится', 'Preparing'),
    ready: tx(lang, 'Servisə hazırdır', 'Готово к подаче', 'Ready to serve'),
  });

  const normalizeOrderItemStatus_ = normalizeOrderItemStatus;

  const itemActionLabel = (action?: string | null) => itemActionLabelUtil(action, {
    decrease: tx(lang, 'Azalt', 'Уменьшить', 'Reduce'),
    void_: tx(lang, 'Ləğv et', 'Отменить', 'Cancel'),
    comp: tx(lang, 'Hesabdan sil', 'Списать из счета', 'Comp'),
    waste: tx(lang, 'İsraf', 'Списание', 'Waste'),
    remake: tx(lang, 'Yenidən düzəlt', 'Переделать', 'Correct'),
  });

  const sentItemActions = (item: any) => sentItemActionsUtil(item);

  const itemActionNeedsManager = (action?: string | null, status?: string | null) => itemActionNeedsManagerUtil(action, status);

  const servedStorageKey = hostScopedKey(`${tenant_id}_table_served_items`);

  // ── Dual-write: sync key state to Zustand store (passive mirror for future sub-components) ──
  useEffect(() => {
    const s = useTablesStore.getState();
    s.setTables(tables);
  }, [tables]);
  useEffect(() => { useTablesStore.getState().setKitchenOrders(kitchenOrders); }, [kitchenOrders]);
  useEffect(() => { useTablesStore.getState().setMenuCatalog(menuCatalog); }, [menuCatalog]);
  useEffect(() => { useTablesStore.getState().setIsOnline(isOnline); }, [isOnline]);
  useEffect(() => { useTablesStore.getState().setFloorPlans(floorPlans); }, [floorPlans]);
  useEffect(() => { useTablesStore.getState().setActiveFloorId(activeFloorId); }, [activeFloorId]);
  useEffect(() => { useTablesStore.getState().setFloorTables(floorTables); }, [floorTables]);
  useEffect(() => { useTablesStore.getState().setReservations(reservations); }, [reservations]);
  useEffect(() => { useTablesStore.getState().setReservationDate(reservationDate); }, [reservationDate]);
  useEffect(() => { useTablesStore.getState().setViewTableId(viewTableId); }, [viewTableId]);
  useEffect(() => { useTablesStore.getState().setTableDetailRecord(tableDetailRecord); }, [tableDetailRecord]);
  useEffect(() => { useTablesStore.getState().setPayTableId(payTableId); }, [payTableId]);
  useEffect(() => { useTablesStore.getState().setWorkspaceView(workspaceView); }, [workspaceView]);
  useEffect(() => { useTablesStore.getState().setRoundDraft(roundDraft); }, [roundDraft]);
  useEffect(() => { useTablesStore.getState().setDraftSendError(draftSendError); }, [draftSendError]);
  useEffect(() => { useTablesStore.getState().setTableWorkspaceTab(tableWorkspaceTab); }, [tableWorkspaceTab]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  const roundCategories = useMemo(() => extractCategories(menuCatalog), [menuCatalog]);

  const filteredRoundMenu = useMemo(
    () => filterMenuByCategory(menuCatalog, roundCategory, roundSearch),
    [menuCatalog, roundCategory, roundSearch],
  );

  const floorSummary = useMemo(() => computeFloorSummary(floorTables), [floorTables]);

  const reservationCandidateTables = useMemo(
    () => floorTables.filter((row) => {
      const status = String(row.status || '').toUpperCase();
      return status === 'AVAILABLE' || (Boolean(reservationAssignedTableId) && row.id === reservationAssignedTableId);
    }),
    [floorTables, reservationAssignedTableId],
  );

  const suggestedReservationTables = useMemo(
    () => suggestReservationTables(reservationCandidateTables, Math.max(1, Number(reservationPartySize || 1))),
    [reservationCandidateTables, reservationPartySize],
  );

  const mergedGroups = useMemo(() => computeMergedGroups(floorTables), [floorTables]);

  const selectedFloorTable = useMemo(
    () => floorTables.find((row) => row.id === selectedFloorTableId) || null,
    [floorTables, selectedFloorTableId],
  );

  useEffect(() => {
    setSelectedFloorTableLabel(String(selectedFloorTable?.label || ''));
  }, [selectedFloorTable?.id, selectedFloorTable?.label]);

  const selectedFloorGroup = useMemo(() => {
    const mergedGroupId = String(selectedFloorGroupId || (selectedFloorTable as any)?.merged_group_id || '').trim();
    if (!mergedGroupId) return null;
    return mergedGroups.find((group) => group.id === mergedGroupId) || null;
  }, [mergedGroups, selectedFloorGroupId, selectedFloorTable]);

  const selectedFloorTables = useMemo(
    () => floorTables.filter((row) => selectedFloorTableIds.includes(row.id)),
    [floorTables, selectedFloorTableIds],
  );

  const reservationTimeline = useMemo(() => computeReservationTimeline({
    reservations,
    floorTables,
    reservationDurationDrafts,
    reservationZoom,
    unassignedLabel: tx(lang, 'Təyin edilməyib', 'Не назначено', 'Unassigned'),
    parseTimestamp: parseRestaurantLocalTimestamp,
  }), [reservations, floorTables, lang, reservationDurationDrafts, reservationZoom]);

  const mergedGroupOutlines = useMemo(() => {
    const maxCols = Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12);
    return computeMergedGroupOutlines(mergedGroups, maxCols);
  }, [mergedGroups, floorPlans, activeFloorId]);

  const tableGridMinWidth = useMemo(() => {
    const base = 160;
    return Math.max(145, Math.min(220, Math.round((base * tableGridScale) / 100)));
  }, [tableGridScale]);

  const tablesById = useMemo(
    () => Object.fromEntries(tables.map((row) => [String(row.id), row])),
    [tables],
  );

  const readyCountsByLabel = useMemo(() => computeReadyCountsByLabel(kitchenOrders), [kitchenOrders]);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setTimeout(() => {
      void loadTablesBootstrap();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tenant_id, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (workspaceView !== 'reservations') return;
    const timer = window.setTimeout(() => {
      void loadReservations();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [tenant_id, reservationDate, workspaceView, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (!viewTableId) return;
    if (tableWorkspaceTab !== 'compose') return;
    if (menuCatalog.length > 0) return;
    const timer = window.setTimeout(() => {
      void loadMenuCatalog();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [viewTableId, tableWorkspaceTab, menuCatalog.length, tenant_id, isActive]);

  useEffect(() => {
    if (floorPlans.length === 0) {
      setActiveFloorId('');
      return;
    }
    if (!activeFloorId || !floorPlans.some((row) => row.id === activeFloorId)) {
      setActiveFloorId(floorPlans.find((row) => row.is_active)?.id || floorPlans[0].id);
    }
  }, [floorPlans, activeFloorId]);

  useEffect(() => {
    activeFloorIdRef.current = activeFloorId;
  }, [activeFloorId]);

  useEffect(() => {
    viewTableIdRef.current = viewTableId;
  }, [viewTableId]);

  useEffect(() => {
    workspaceViewRef.current = workspaceView;
  }, [workspaceView]);

  useEffect(() => {
    reservationDateRef.current = reservationDate;
  }, [reservationDate]);

  useEffect(() => {
    if (!copyLayoutSourceFloorId) {
      const fallback = floorPlans.find((row) => row.id !== activeFloorId)?.id || '';
      setCopyLayoutSourceFloorId(fallback);
      return;
    }
    if (!floorPlans.some((row) => row.id === copyLayoutSourceFloorId && row.id !== activeFloorId)) {
      const fallback = floorPlans.find((row) => row.id !== activeFloorId)?.id || '';
      setCopyLayoutSourceFloorId(fallback);
    }
  }, [floorPlans, activeFloorId, copyLayoutSourceFloorId]);

  useEffect(() => {
    if (!isActive) return;
    if (!activeFloorId) return;
    if (skipNextFloorStateLoadRef.current === activeFloorId) {
      skipNextFloorStateLoadRef.current = '';
      return;
    }
    void loadFloorState(activeFloorId);
  }, [activeFloorId, isActive]);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setTimeout(() => {
      void loadKitchenFeed();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [tenant_id, isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (workspaceView !== 'floor' || activeFloorId) return;
    const timer = window.setInterval(() => {
      void loadRestaurantData();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [workspaceView, activeFloorId, tenant_id, reservationDate, isActive]);

  useEffect(() => {
    if (!floorEditMode) {
      setSelectedFloorTableId(null);
      setFloorDropPreview(null);
      setSelectedFloorTableIds([]);
      setFloorMultiSelectMode(false);
    }
  }, [floorEditMode]);

  useEffect(() => {
    if (!selectedFloorTableId) return;
    if (!floorTables.some((row) => row.id === selectedFloorTableId)) {
      setSelectedFloorTableId(null);
    }
  }, [floorTables, selectedFloorTableId]);

  useEffect(() => {
    setSelectedFloorTableIds((prev) => prev.filter((id) => floorTables.some((row) => row.id === id)));
  }, [floorTables]);

  useEffect(() => {
    if (!selectedFloorTable) {
      setSelectedFloorGroupId(null);
      return;
    }
    const mergedGroupId = String((selectedFloorTable as any)?.merged_group_id || '').trim();
    if (!mergedGroupId) {
      setSelectedFloorGroupId(null);
      return;
    }
    setSelectedFloorGroupId((prev) => prev || mergedGroupId);
  }, [selectedFloorTable]);

  useEffect(() => {
    if (!selectedFloorGroupId) return;
    if (!mergedGroups.some((group) => group.id === selectedFloorGroupId)) {
      setSelectedFloorGroupId(null);
    }
  }, [mergedGroups, selectedFloorGroupId]);

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

  useEffect(() => {
    const handleTableOrderSent = async (event: Event) => {
      const detail = (event as CustomEvent<{ tenant_id?: string; table_id?: string }>).detail;
      if (!detail?.tenant_id || detail.tenant_id !== tenant_id) return;
      await Promise.all([
        loadData(),
        activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve(),
      ]);
      if (detail.table_id) setViewTableId(detail.table_id);
    };
    window.addEventListener('table-order-sent', handleTableOrderSent as EventListener);
    return () => {
      window.removeEventListener('table-order-sent', handleTableOrderSent as EventListener);
    };
  }, [tenant_id, activeFloorId]);

  useEffect(() => {
    clearRoundComposer();
    setShowSentSlideUp(false);
    setMergeTargetId('');
  }, [viewTableId]);

  useEffect(() => {
    if (viewTableId) {
      setTableWorkspaceTab('compose');
      // Cancel any pending closeTableDetail timeout if a new table was opened
      if ((closeTableDetail as any).__timer) {
        clearTimeout((closeTableDetail as any).__timer);
        (closeTableDetail as any).__timer = null;
        setTableDetailClosing(false);
      }
    }
    setDraftSendError(null);
  }, [viewTableId]);

  useEffect(() => {
    if (!viewTableId) {
      setTableDetailRecord(null);
      return;
    }
    void get_table_detail_live(tenant_id, viewTableId)
      .then((next) => setTableDetailRecord(next))
      .catch(() => setTableDetailRecord(null));
  }, [tenant_id, viewTableId]);

  useEffect(() => {
    if (!viewTableId || !detailPanelRef.current) return;
    requestAnimationFrame(() => {
      detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [viewTableId]);

  useEffect(() => {
    if (!viewTableId) return;
    const selected = tables.find((row) => row.id === viewTableId);
    if (selected && !selected.is_occupied) {
      setViewTableId(null);
      setTableDetailRecord(null);
    }
  }, [tables, viewTableId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(servedStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') setServedItemsMap(parsed);
    } catch {
      // ignore
    }
  }, [servedStorageKey]);

  useEffect(() => {
    localStorage.setItem(servedStorageKey, JSON.stringify(servedItemsMap));
  }, [servedItemsMap, servedStorageKey]);

  useEffect(() => {
    if (!resizingReservation) return;
    const handleMove = (event: MouseEvent) => {
      const deltaY = event.clientY - resizingReservation.startY;
      const stepPx = reservationTimeline.minuteHeight * reservationZoom;
      const stepCount = Math.round(deltaY / stepPx);
      const nextDuration = Math.max(30, Math.min(240, resizingReservation.startDuration + (stepCount * reservationZoom)));
      setReservationDurationDrafts((prev) => ({ ...prev, [resizingReservation.id]: nextDuration }));
    };
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const deltaY = touch.clientY - resizingReservation.startY;
      const stepPx = reservationTimeline.minuteHeight * reservationZoom;
      const stepCount = Math.round(deltaY / stepPx);
      const nextDuration = Math.max(30, Math.min(240, resizingReservation.startDuration + (stepCount * reservationZoom)));
      setReservationDurationDrafts((prev) => ({ ...prev, [resizingReservation.id]: nextDuration }));
    };
    const handleUp = () => {
      const nextDuration = Number(reservationDurationDrafts[resizingReservation.id] ?? resizingReservation.startDuration);
      setResizingReservation(null);
      if (nextDuration === resizingReservation.startDuration) {
        setReservationDurationDrafts((prev) => {
          const next = { ...prev };
          delete next[resizingReservation.id];
          return next;
        });
        return;
      }
      void update_reservation_live(resizingReservation.id, { duration_minutes: nextDuration })
        .then(async () => {
          notify('success', tx(lang, 'Rezervasiya müddəti yeniləndi', 'Длительность брони обновлена', 'Reservation duration updated'));
          await loadReservations();
        })
        .catch((error: any) => {
          notify('error', error?.message || tx(lang, 'Rezervasiya müddəti dəyişmədi', 'Длительность брони не изменилась', 'Reservation duration was not updated'));
        })
        .finally(() => {
          setReservationDurationDrafts((prev) => {
            const next = { ...prev };
            delete next[resizingReservation.id];
            return next;
          });
        });
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('mouseup', handleUp, { once: true });
    window.addEventListener('touchend', handleUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchend', handleUp);
    };
  }, [resizingReservation, reservationDurationDrafts, reservationTimeline.minuteHeight, lang, reservationZoom]);

  const persistFloorLayout = async (tableId: string, payload: any) => {
    await update_table_layout_live(tableId, payload);
    await Promise.all([loadFloorState(activeFloorId), loadData()]);
  };

  const addMenuItemToRound = async (item: any, quantityToAdd = 1) => {
    const activeDetail = tableDetailRecord?.table?.id === viewTableId ? tableDetailRecord : null;
    if (activeDetail?.check?.id && viewTableId) {
      try {
        const existingDraft = (activeDetail.draft_items || []).find((row: any) => (
          String(row.item_name || '').trim() === String(item.item_name || '').trim()
          && new Decimal(row.price || 0).equals(new Decimal(item.price || 0))
        ));
        if (existingDraft) {
          await update_draft_item_live(existingDraft.id, { qty: Number(existingDraft.qty || 0) + quantityToAdd });
        } else {
          await add_check_draft_item_live(activeDetail.check.id, {
            id: item.id,
            item_name: item.item_name,
            price: String(item.price),
            qty: quantityToAdd,
            category: item.category,
            is_coffee: Boolean(item.is_coffee),
            course_no: 1,
          });
        }
        setDraftSendError(null);
        await refreshActiveTableDetail(viewTableId);
        return;
      } catch (e: any) {
        notify('error', e?.message || tx(lang, 'Məhsul əlavə olunmadı', 'Позиция не добавлена', 'Item was not added'));
        return;
      }
    }
    setRoundDraft((prev) => {
      const existing = prev.find((row: any) => String(row.id) === String(item.id));
      if (existing) {
        return prev.map((row: any) => String(row.id) === String(item.id) ? { ...row, qty: Number(row.qty || 0) + quantityToAdd } : row);
      }
      return [
        ...prev,
        {
          id: item.id,
          item_name: item.item_name,
          price: String(item.price),
          category: item.category,
          is_coffee: Boolean(item.is_coffee),
          qty: quantityToAdd,
        },
      ];
    });
  };

  const updateRoundDraftQty = async (itemId: string, nextQty: number) => {
    const activeDetail = tableDetailRecord?.table?.id === viewTableId ? tableDetailRecord : null;
    const serverDraft = (activeDetail?.draft_items || []).find((row: any) => String(row.id) === String(itemId));
    if (activeDetail?.check?.id && serverDraft && viewTableId) {
      try {
        if (nextQty <= 0) {
          await delete_draft_item_live(itemId);
        } else {
          await update_draft_item_live(itemId, { qty: nextQty });
        }
        await refreshActiveTableDetail(viewTableId);
        return;
      } catch (e: any) {
        notify('error', e?.message || tx(lang, 'Göndərilməmiş məhsul yenilənmədi', 'Неотправленная позиция не обновлена', 'Draft item was not updated'));
        return;
      }
    }
    setRoundDraft((prev) => (
      nextQty <= 0
        ? prev.filter((row: any) => String(row.id) !== String(itemId))
        : prev.map((row: any) => String(row.id) === String(itemId) ? { ...row, qty: nextQty } : row)
    ));
  };

  const updateRoundDraftNote = async (itemId: string, note: string) => {
    const activeDetail = tableDetailRecord?.table?.id === viewTableId ? tableDetailRecord : null;
    const serverDraft = (activeDetail?.draft_items || []).find((row: any) => String(row.id) === String(itemId));
    if (activeDetail?.check?.id && serverDraft && viewTableId) {
      try {
        await update_draft_item_live(itemId, { note: note.trim() || null });
        await refreshActiveTableDetail(viewTableId);
        return;
      } catch (e: any) {
        notify('error', e?.message || tx(lang, 'Qeyd yenilənmədi', 'Примечание не обновлено', 'Note was not updated'));
        return;
      }
    }
    setRoundDraft((prev) =>
      prev.map((row: any) => String(row.id) === String(itemId) ? { ...row, note: note.trim() } : row)
    );
  };

  const clearRoundComposer = () => {
    setRoundDraft([]);
    setRoundSearch('');
    setRoundCategory('ALL');
  };

  const closeTableDetail = useCallback(() => {
    if (tableDetailClosing) return; // prevent double-tap
    setTableDetailClosing(true);
    const closingTimer = setTimeout(() => {
      setViewTableId(null);
      setTableDetailClosing(false);
    }, 200);
    // Store timer so we can cancel if a new table opens
    (closeTableDetail as any).__timer = closingTimer;
  }, [tableDetailClosing]);

  const markReadyItemServed = (tableId: string, itemName: string, qty: number) => {
    const itemKey = `${itemName}`.trim();
    setServedItemsMap((prev) => {
      const tableRows = { ...(prev[tableId] || {}) };
      tableRows[itemKey] = Math.max(0, Number(tableRows[itemKey] || 0) + qty);
      return { ...prev, [tableId]: tableRows };
    });
    logEvent(user?.username || 'staff', 'TABLE_ITEM_SERVED', {
      tenant_id,
      table_id: tableId,
      item_name: itemKey,
      qty,
    });
    notify('success', tx(lang, 'Məhsul servis edildi kimi qeyd olundu', 'Позиция отмечена как поданная', 'Item marked as served'));
  };

  const clearServedStateForTable = (tableId: string) => {
    setServedItemsMap((prev) => {
      const next = { ...prev };
      delete next[tableId];
      return next;
    });
  };

  const sendRoundDirectly = async (table: any) => {
    if (!table?.id) return;
    if (sendRoundInFlightRef.current) return; // prevent double-tap
    sendRoundInFlightRef.current = true;
    try {
    const activeDetail = tableDetailRecord?.table?.id === table.id ? tableDetailRecord : null;
    const serverDraftItems = activeDetail?.draft_items || [];
    if (activeDetail?.check?.id) {
      if (serverDraftItems.length === 0) { sendRoundInFlightRef.current = false; return; }
      try {
        await send_check_drafts_live(activeDetail.check.id, {
          sent_by: user?.username || 'staff',
          course_no: 1,
        });
        notify('success', tx(lang, 'Yeni sifariş mətbəxə göndərildi', 'Новый заказ отправлен на кухню', 'New order sent to kitchen'));
        setDraftSendError(null);
        setRoundDraft([]);
        await refreshActiveTableDetail(table.id);
        return;
      } catch (e: any) {
        const message = e?.message || tx(lang, 'Mətbəxə göndərilmədi. Məhsullar göndərilmiş kimi işarələnmədi.', 'Не отправлено на кухню. Позиции не отмечены отправленными.', 'Kitchen send failed. Items were not marked as sent.');
        setDraftSendError(message);
        notify('error', message);
        return;
      }
    }
    if (roundDraft.length === 0) { sendRoundInFlightRef.current = false; return; }
    try {
      await send_table_round_live(table.id, {
        sent_by: user?.username || 'staff',
        course_no: 1,
        items: roundDraft.map((row: any) => ({
          id: row.id,
          item_name: row.item_name,
          price: String(row.price),
          qty: Number(row.qty || 0),
          category: row.category,
          is_coffee: Boolean(row.is_coffee),
        })),
      });
      notify('success', tx(lang, 'Yeni raund mətbəxə göndərildi', 'Новый раунд отправлен на кухню', 'New round sent to kitchen'));
      setDraftSendError(null);
      clearRoundComposer();
      await refreshActiveTableDetail(table.id);
    } catch (e: any) {
      const message = e?.message || tx(lang, 'Mətbəxə göndərilmədi', 'Не отправлено на кухню', 'Kitchen send failed');
      setDraftSendError(message);
      notify('error', message);
    }
    } finally {
      sendRoundInFlightRef.current = false;
    }
  };

  const handleAddTable = async () => {
    const label = newTableName.trim();
    if (!label) return;
    try {
      await create_table_live(tenant_id, label, user?.username || 'Staff', activeFloorId || null);
      notify('success', tx(lang, 'Masa yaradıldı', 'Стол создан', 'Table created'));
      await Promise.all([
        loadData(),
        loadRestaurantData(),
        activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve(),
      ]);
      setShowCreate(false);
      setNewTableName('');
    } catch(e:any) { notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message); }
  };

  const handleAddFloorPlan = async () => {
    const name = newFloorPlanName.trim();
    if (!name) return;
    try {
      const created = await create_floor_plan_live({
        name,
        width_units: Math.max(6, newFloorPlanWidth),
        height_units: Math.max(4, newFloorPlanHeight),
      });
      notify('success', tx(lang, 'Yeni zal yaradıldı', 'Новый зал создан', 'New floor plan created'));
      await forceTablesBootstrapRefresh();
      setActiveFloorId(created.id);
      setShowCreateFloorPlan(false);
      setNewFloorPlanName('');
      setNewFloorPlanWidth(12);
      setNewFloorPlanHeight(8);
    } catch (err: any) {
      notify('error', err.message || 'Error creating floor plan');
    }
  };

  const handleRenameFloorPlan = async (floorId: string, newName: string) => {
    try {
      await update_floor_plan_live(floorId, { name: newName });
      notify('success', tx(lang, 'Zal adı yeniləndi', 'Название зала обновлено', 'Floor plan name updated'));
      const floors = await get_floor_plans_live(tenant_id);
      setFloorPlans(floors);
    } catch (err: any) {
      notify('error', err.message || 'Error updating floor plan name');
    }
  };

  const handleDeleteFloorPlan = async (floorId: string) => {
    try {
      await delete_floor_plan_live(floorId);
      notify('success', tx(lang, 'Zal silindi', 'Зал удален', 'Floor plan deleted'));
      const floors = await get_floor_plans_live(tenant_id);
      setFloorPlans(floors);
      const fallback = floors.find((f) => f.is_active)?.id || floors[0]?.id || '';
      setActiveFloorId(fallback);
      void forceTablesBootstrapRefresh();
    } catch (err: any) {
      notify('error', err.message || 'Error deleting floor plan');
    }
  };

  const handleOpenTable = async () => {
    if (!openTableId) return;
    const normalizedGuestCount = Math.max(1, Number(guestCount || 1));
    const normalizedDepositGuestCount = Math.max(0, Math.min(normalizedGuestCount, Number(depositGuestCount || 0)));
    const depositSeatLabels = Array.from({ length: normalizedDepositGuestCount }, (_, idx) => `Adam-${idx + 1}`);
    try {
      await open_table_live(openTableId, {
        guest_count: normalizedGuestCount,
        deposit_guest_count: normalizedDepositGuestCount,
        deposit_seat_labels: depositSeatLabels,
        opened_by: user?.username || 'staff',
      });
      notify(
        'success',
        tx(lang, 'Masa açıldı', 'Стол открыт', 'Table opened'),
      );
      const currentTableId = openTableId;
      setOpenTableId(null);
      setGuestCount('1');
      setDepositGuestCount('0');
      await refreshActiveTableDetail(currentTableId);
      setViewTableId(currentTableId);
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message);
    }
  };

  const handleSelectWaiterTable = useCallback((table: any) => {
    const localTable = tablesById[String(table?.id || '')];
    
    // Resolve active table in merged group if any table in the group is occupied
    const mergedGroupId = String((localTable as any)?.merged_group_id || '').trim();
    const groupTables = mergedGroupId
      ? tables.filter((r) => String(r.merged_group_id || '').trim() === mergedGroupId)
      : [];
    const occupiedTableInGroup = groupTables.find((r) => r.is_occupied);
    const activeTable = occupiedTableInGroup || localTable;

    const status = String(activeTable?.status || '').toUpperCase();
    const tableLockHolder = String((activeTable as any)?.locked_by || activeTable?.assigned_to || '').trim();
    const isManagerUser = ['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase());
    const lockedByAnother = Boolean(activeTable?.is_occupied && tableLockHolder && tableLockHolder !== user?.username && !isManagerUser);

    if (status === 'DIRTY') return;
    if (status === 'RESERVED' && !activeTable?.is_occupied) {
      notify(
        'error',
        tx(
          lang,
          `Bu masa yaxın ${reservationLockHours} saat üçün rezervdədir`,
          `Этот стол забронирован на ближайшие ${reservationLockHours} ч.`,
          `This table is reserved for the next ${reservationLockHours} hours`,
        ),
      );
      return;
    }
    if (lockedByAnother) {
      notify('error', tx(lang, 'Bu masa artıq istifadə olunur', 'Этот стол уже используется', 'This table is already in use'));
      return;
    }
    if (activeTable?.is_occupied) {
      setViewTableId(activeTable.id);
      return;
    }
    setOpenTableId(table.id);
    setGuestCount(String(Math.max(1, Number(table.guest_count || 1))));
    setDepositGuestCount('0');
  }, [tablesById, user?.role, user?.username, notify, lang, reservationLockHours]);

  const handleMarkTableClean = useCallback(async (tableId: string) => {
    try {
      await update_table_layout_live(tableId, { status: 'AVAILABLE' });
      await Promise.all([loadFloorState(activeFloorId), loadData()]);
      notify('success', tx(lang, 'Masa təmiz kimi qeyd olundu', 'Стол отмечен как чистый', 'Table marked as clean'));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Masa təmizlənmədi', 'Стол не очищен', 'Table was not cleaned'));
    }
  }, [activeFloorId, notify, lang]);

  const handleSettleTableCheck = async () => {
    const table = tables.find((x) => x.id === payTableId);
    if (!table) return;
    if (hasEmptyActiveCheckTotalMismatch(table)) {
      notify('error', tx(lang, 'Bu masada məbləğ görünür, amma check daxilində sifariş tapılmadı.', 'У стола есть сумма, но внутри чека нет позиций.', 'This table shows a total but the check has no order items.'));
      return;
    }
    try {
      const { dueNow, splitBasis } = getTableBillBreakdown(table);
      let cash: Decimal | null = null;
      let card: Decimal | null = null;
      if (paymentMethod === 'Split') {
        const participantCount = normalizeSplitCount(table, splitCount);
        const normalized = (splitParts.length === participantCount ? splitParts : buildEqualSplitParts(participantCount, splitBasis));
        cash = normalized.filter((r) => r.method === 'Nəğd').reduce((acc, r) => acc.plus(new Decimal(r.amount || 0)), new Decimal(0)).toDecimalPlaces(2);
        card = normalized.filter((r) => r.method === 'Kart').reduce((acc, r) => acc.plus(new Decimal(r.amount || 0)), new Decimal(0)).toDecimalPlaces(2);
        if (cash.plus(card).minus(splitBasis).abs().greaterThan(0.01)) {
          notify('error', tx(lang, 'Split hissələri bölünəcək məbləğə bərabər olmalıdır', 'Сумма частей split должна совпадать', 'Split parts must match'));
          return;
        }
      } else if (paymentMethod === 'Nəğd') {
        cash = dueNow;
      } else {
        card = dueNow;
      }
      const result = await settle_table_check_live(table.id, {
        payment_method: paymentMethod,
        split_cash: cash,
        split_card: card,
        discount_percent: tableDiscountPercent,
        discount_reason: tableDiscountReason || null,
        parts: paymentMethod === 'Split' ? (splitParts.length === normalizeSplitCount(table, splitCount) ? splitParts : buildEqualSplitParts(normalizeSplitCount(table, splitCount), splitBasis)) : undefined,
      });

      // Generate receipt HTML
      const { itemsTotal: rItemsTotal, discountPercent: rDiscountPercent, discountAmount: rDiscountAmount, discountedItemsTotal: rDiscountedTotal, serviceFee: rServiceFee, deposit: rDeposit, finalTotal: rFinalTotal, dueNow: rDueNow } = getTableBillBreakdown(table);
      const payItems = getTablePaymentItems(table);
      const itemsHtml = payItems.map((row: any) => `<tr><td>${row.item_name}</td><td>${row.qty}x</td><td>${new Decimal(row.price || 0).times(row.qty || 0).toFixed(2)} ₼</td></tr>`).join('');
      const receiptMarkup = `<html><head><style>${THERMAL_RECEIPT_PRINT_CSS}</style></head><body>
        ${businessProfile?.logo_url ? `<img src="${businessProfile.logo_url}" style="height:34px;max-width:180px;object-fit:contain;margin-bottom:6px" />` : ''}
        <h2 style="margin:0 0 4px;font-size:16px">${businessProfile?.company_name || 'IRONWAVES POS'}</h2>
        <div class="muted">VÖEN: ${businessProfile?.voen || '-'}</div>
        <div class="muted">${businessProfile?.address || '-'}</div>
        <hr/>
        <div class="line"><span>Masa</span><span class="bold">${table.label}</span></div>
        <div class="line"><span>Operator</span><span>${user?.username || 'staff'}</span></div>
        <div class="line"><span>Tarix</span><span>${new Date().toLocaleString()}</span></div>
        <hr/>
        <table>${itemsHtml}</table>
        <hr style="margin:12px 0"/>
        <div class="line"><span>Sifariş cəmi</span><span>${rItemsTotal.toFixed(2)} ₼</span></div>
        ${rDiscountAmount.greaterThan(0) ? `<div class="line"><span>Endirim (${rDiscountPercent.toFixed(0)}%)</span><span>-${rDiscountAmount.toFixed(2)} ₼</span></div>` : ''}
        <div class="line"><span>Servis haqqı</span><span>${rServiceFee.toFixed(2)} ₼</span></div>
        <div class="line"><span>Depozit</span><span>${rDeposit.toFixed(2)} ₼</span></div>
        <div class="line"><span>Əlavə ödəniş</span><span>${rDueNow.toFixed(2)} ₼</span></div>
        <div class="line bold"><span>YEKUN</span><span>${rFinalTotal.toFixed(2)} ₼</span></div>
        <hr/>
        <div class="muted">${businessProfile?.receipt_footer || 'Bizi seçdiyiniz üçün təşəkkür edirik!'}</div>
      </body></html>`;

      if (isBackendEnabled() && String(result.sale_id || '').trim()) {
        void save_sale_receipt_html_live(String(result.sale_id), receiptMarkup).catch(() => undefined);
      }
      window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { tenant_id, sale_id: result.sale_id, source: 'table' } }));
      window.dispatchEvent(new CustomEvent('logs-updated', { detail: { tenant_id, sale_id: result.sale_id, source: 'table' } }));

      // Clean up payment state BEFORE showing receipt
      clearServedStateForTable(table.id);
      setPayTableId(null);
      setViewTableId(null);
      setTableDetailRecord(null);
      setPaymentMethod('Nəğd');
      setSplitCount('2');
      setSplitParts([]);
      setSplitCash('0');
      setTableDiscountPercent('0');
      setTableDiscountReason('');
      // Show receipt
      setTableReceiptHtml(receiptMarkup);
      await Promise.all([loadData(), activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve()]);
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + (e?.message || ''));
    }
  };

  const handleCancelTableCheck = useCallback(async (tableId: string, label?: string) => {
    // BahaY: show custom modal instead of browser prompt
    if (isBahaYLab) {
      setPendingCancelTable({ id: tableId, label: label || 'Masa' });
      return;
    }
    const reason = window.prompt(tx(lang, 'Masanı satış yaratmadan ləğv etmə səbəbi', 'Причина отмены стола без продажи', 'Reason for cancelling the table without sale'), 'Səhv açılmış/boş masa') || '';
    if (!reason.trim()) return;
    const ok = window.confirm(tx(lang, `${label || 'Masa'} ləğv edilsin? Bu əməliyyat satış yaratmayacaq və kassaya məbləğ düşməyəcək.`, `${label || 'Стол'} отменить? Продажа не будет создана и сумма не попадет в кассу.`, `Cancel ${label || 'table'}? This will not create a sale or add money to cash.`));
    if (!ok) return;
    try {
      await cancel_table_check_live(tableId, reason);
      logEvent(user?.username || 'staff', 'TABLE_CANCEL', {
        tenant_id,
        table_id: tableId,
        table_label: label || 'Masa',
        reason,
      });
      notify('success', tx(lang, 'Masa ləğv edildi', 'Стол отменен', 'Table cancelled'));
      setViewTableId(null);
      setPayTableId(null);
      setTableDetailRecord(null);
      await Promise.all([loadFloorState(activeFloorId), loadData()]);
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Masa ləğv edilmədi', 'Стол не отменен', 'Table was not cancelled'));
    }
  }, [activeFloorId, notify, lang]);

  const handleDeleteTable = async (id: string) => {
    try {
      await delete_table_live(id, user?.username || 'Staff');
      notify('success', tx(lang, 'Masa silindi', 'Стол удален', 'Table deleted'));
      setDeleteTableId(null);
      if (selectedFloorTableId === id) setSelectedFloorTableId(null);
      if (viewTableId === id) setViewTableId(null);
      await Promise.all([
        loadData(),
        loadRestaurantData(),
        activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve(),
      ]);
    } catch(e:any) { notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message); }
  };

  const handleCreateReservation = async () => {
    const guest = reservationGuestName.trim();
    if (!guest) return;
    try {
      await create_reservation_live(tenant_id, {
        guest_name: guest,
        phone: reservationPhone.trim(),
        reservation_at: `${reservationDate}T${reservationTime}:00`,
        party_size: Math.max(1, Number(reservationPartySize || 2)),
        special_note: reservationNote.trim(),
        assigned_table_id: reservationStatusDraft === 'WAITLIST' ? null : (reservationAssignedTableId || null),
        status: reservationStatusDraft,
      });
      notify('success', tx(lang, 'Rezervasiya yaradıldı', 'Бронь создана', 'Reservation created'));
      setShowReservationCreate(false);
      setReservationGuestName('');
      setReservationPhone('');
      setReservationTime('19:00');
      setReservationPartySize('2');
      setReservationNote('');
      setReservationAssignedTableId('');
      setReservationStatusDraft('BOOKED');
      await loadReservations();
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message);
    }
  };

  const handleReservationStatusChange = async (reservationId: string, status: string) => {
    try {
      await update_reservation_live(reservationId, { status });
      notify('success', tx(lang, 'Rezervasiya statusu yeniləndi', 'Статус брони обновлен', 'Reservation status updated'));
      await Promise.all([loadRestaurantData(), activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve()]);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Rezervasiya statusu dəyişmədi', 'Статус брони не изменился', 'Reservation status was not updated'));
    }
  };

  const handleSeatReservation = async (reservationId: string, tableId: string, guestCount?: number) => {
    try {
      await seat_reservation_live(reservationId, { table_id: tableId, guest_count: guestCount, assigned_waiter: user?.username || 'staff' });
      notify('success', tx(lang, 'Qonaq masaya oturduldu', 'Гость посажен за стол', 'Guest seated at table'));
      setWorkspaceView('floor');
      await Promise.all([loadRestaurantData(), activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve(), loadData()]);
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message);
    }
  };

  const handleReservationReschedule = async (reservationId: string, nextReservationAt: string) => {
    try {
      await update_reservation_live(reservationId, { reservation_at: nextReservationAt });
      notify('success', tx(lang, 'Rezervasiya vaxtı yeniləndi', 'Время брони обновлено', 'Reservation time updated'));
      await Promise.all([loadRestaurantData(), activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve()]);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Rezervasiya vaxtı dəyişmədi', 'Время брони не изменилось', 'Reservation time was not updated'));
    } finally {
      setDraggingReservationId(null);
    }
  };

  const handleReservationDurationChange = async (reservationId: string, nextDurationMinutes: number) => {
    try {
      await update_reservation_live(reservationId, { duration_minutes: Math.max(30, Math.min(240, nextDurationMinutes)) });
      notify('success', tx(lang, 'Rezervasiya müddəti yeniləndi', 'Длительность брони обновлена', 'Reservation duration updated'));
      await loadRestaurantData();
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Rezervasiya müddəti dəyişmədi', 'Длительность брони не изменилась', 'Reservation duration was not updated'));
    }
  };

  const handleFloorGridDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (!floorEditMode || !draggingTableId) return;
    event.preventDefault();
    const host = event.currentTarget;
    const draggingTable = floorTables.find((row) => row.id === draggingTableId);
    if (!draggingTable) return;
    const rect = host.getBoundingClientRect();
    const maxCols = Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12);
    const columnWidth = rect.width / maxCols;
    const rowHeight = 70;
    const nextX = Math.max(0, Math.min(maxCols - Math.max(1, Number(draggingTable.w || 2)), Math.floor((event.clientX - rect.left) / columnWidth)));
    const nextY = Math.max(0, Math.floor((event.clientY - rect.top) / rowHeight));
    const activeDragIds = draggingTableIds.length > 0 ? draggingTableIds : [draggingTableId];
    const dragTables = floorTables.filter((row) => activeDragIds.includes(row.id));
    const anchor = dragTables.find((row) => row.id === draggingTableId) || draggingTable;
    const deltaX = nextX - Number(anchor.x || 0);
    const deltaY = nextY - Number(anchor.y || 0);
    try {
      await Promise.all(
        dragTables.map((row) =>
          update_table_layout_live(row.id, {
            floor_plan_id: activeFloorId,
            pos_x: Math.max(0, Number(row.x || 0) + deltaX),
            pos_y: Math.max(0, Number(row.y || 0) + deltaY),
          }),
        ),
      );
      await Promise.all([loadFloorState(activeFloorId), loadData()]);
      setSelectedFloorTableId(draggingTable.id);
    } finally {
      setDraggingTableId(null);
      setDraggingTableIds([]);
      setFloorDropPreview(null);
    }
  };

  const handleCombineTables = async (sourceTableId: string, targetTableId: string) => {
    if (!targetTableId) return;
    const sourceTable = tables.find((row) => row.id === sourceTableId);
    const targetTable = tables.find((row) => row.id === targetTableId);
    const targetLabel = targetTable?.label || 'Masa';
    const sourceLabel = sourceTable?.label || 'Masa';
    // Warn if target table is occupied
    if (targetTable?.is_occupied) {
      const ok = window.confirm(
        tx(lang,
          `${targetLabel} dolu masadır! Birləşdirmə hər iki masanın sifarişlərini bir check altında toplayacaq. Davam etmək istəyirsiniz?`,
          `${targetLabel} занят! Объединение соберёт заказы обоих столов под одним чеком. Продолжить?`,
          `${targetLabel} is occupied! Combining will merge both tables' orders under one check. Continue?`)
      );
      if (!ok) return;
    } else {
      const ok = window.confirm(
        tx(lang,
          `${sourceLabel} və ${targetLabel} birləşdirilsin?`,
          `Объединить ${sourceLabel} и ${targetLabel}?`,
          `Combine ${sourceLabel} and ${targetLabel}?`)
      );
      if (!ok) return;
    }
    try {
      await combine_tables_live(sourceTableId, targetTableId);
      logEvent(user?.username || 'staff', 'TABLE_COMBINE', {
        tenant_id,
        source_table_id: sourceTableId,
        source_label: sourceLabel,
        target_table_id: targetTableId,
        target_label: targetLabel,
      });
      notify('success', tx(lang, 'Masalar birləşdirildi', 'Столы объединены', 'Tables combined'));
      setMergeTargetId('');
      await Promise.all([activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve(), loadData()]);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Masalar birləşdirilmədi', 'Столы не объединены', 'Tables were not combined'));
      setMergeTargetId('');
    }
  };

  const handleSplitTables = async (tableId: string, mergedGroupId?: string | null) => {
    const sourceTable = tables.find((row) => row.id === tableId);
    const sourceLabel = sourceTable?.label || 'Masa';
    const ok = window.confirm(
      tx(lang,
        `${sourceLabel} qrupunu ayırmaq istəyirsiniz? Hər masa ayrıca check-ə qayıdacaq.`,
        `Разделить группу ${sourceLabel}? Каждый стол вернётся к отдельному чеку.`,
        `Split ${sourceLabel} group? Each table will return to a separate check.`)
    );
    if (!ok) return;
    try {
      await split_table_group_live(tableId, mergedGroupId || null);
      logEvent(user?.username || 'staff', 'TABLE_SPLIT', {
        tenant_id,
        table_id: tableId,
        table_label: sourceLabel,
        merged_group_id: mergedGroupId || null,
      });
      notify('success', tx(lang, 'Masalar ayrıldı', 'Столы разделены', 'Tables split'));
      await Promise.all([activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve(), loadData()]);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Masalar ayrılmadı', 'Столы не разделены', 'Tables were not split'));
    }
  };

  const handleNudgeGroup = async (groupId: string, deltaX: number, deltaY: number) => {
    const group = mergedGroups.find((row) => row.id === groupId);
    if (!group) return;
    try {
      await Promise.all(
        group.tables.map((table) =>
          update_table_layout_live(table.id, {
            pos_x: Math.max(0, Number(table.x || 0) + deltaX),
            pos_y: Math.max(0, Number(table.y || 0) + deltaY),
          }),
        ),
      );
      await Promise.all([activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve(), loadData()]);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Qrup hərəkət etmədi', 'Группа не переместилась', 'Group did not move'));
    }
  };

  const handleNudgeSelectedTables = async (deltaX: number, deltaY: number) => {
    if (selectedFloorTables.length === 0) return;
    try {
      await Promise.all(
        selectedFloorTables.map((row) =>
          update_table_layout_live(row.id, {
            pos_x: Math.max(0, Number(row.x || 0) + deltaX),
            pos_y: Math.max(0, Number(row.y || 0) + deltaY),
          }),
        ),
      );
      await Promise.all([activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve(), loadData()]);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Seçilmiş masalar hərəkət etmədi', 'Выбранные столы не переместились', 'Selected tables did not move'));
    }
  };

  const handleResetFloorLayout = async () => {
    if (!activeFloorId || floorTables.length === 0) return;
    try {
      const maxCols = Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12);
      const sortedTables = [...floorTables].sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
      let cursorX = 0;
      let cursorY = 0;
      await Promise.all(sortedTables.map(async (table) => {
        const widthUnits = Math.max(1, Number(table.w || 2));
        if (cursorX + widthUnits > maxCols) {
          cursorX = 0;
          cursorY += 3;
        }
        const payload = { pos_x: cursorX, pos_y: cursorY };
        cursorX += Math.max(2, widthUnits + 1);
        await update_table_layout_live(table.id, payload);
      }));
      await Promise.all([loadFloorState(activeFloorId), loadData()]);
      notify('success', tx(lang, 'Floor layout sıfırlandı', 'План зала сброшен', 'Floor layout reset'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Floor layout sıfırlanmadı', 'План зала не сброшен', 'Floor layout was not reset'));
    }
  };

  const handleCopyFloorLayout = async (sourceFloorId: string) => {
    if (!activeFloorId || !sourceFloorId || sourceFloorId === activeFloorId) return;
    try {
      const sourceState = await get_floor_state_live(tenant_id, sourceFloorId);
      const sourceByLabel = new Map(sourceState.tables.map((table) => [String(table.label || '').trim(), table]));
      const updates = floorTables
        .map((table) => {
          const source = sourceByLabel.get(String(table.label || '').trim());
          if (!source) return null;
          return update_table_layout_live(table.id, {
            pos_x: Number(source.x || 0),
            pos_y: Number(source.y || 0),
            width_units: Number(source.w || 2),
            height_units: Number(source.h || 2),
            capacity: Number(source.capacity || table.capacity || 4),
            shape: source.shape || 'rectangle',
          });
        })
        .filter(Boolean) as Promise<any>[];
      await Promise.all(updates);
      await Promise.all([loadFloorState(activeFloorId), loadData()]);
      notify('success', tx(lang, 'Layout başqa floor-dan kopyalandı', 'Макет скопирован с другого зала', 'Layout copied from another floor'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Layout kopyalanmadı', 'Макет не скопирован', 'Layout was not copied'));
    }
  };

  const normalizeSplitCount = (table: any, requested?: number | string) => normalizeSplitCountUtil(table, requested, splitCount);

  const updateTableDiscountPercent = (value: unknown) => {
    const nextPercent = normalizeTableDiscountPercent(value);
    setTableDiscountPercent(String(nextPercent));
    if (nextPercent === 0) {
      setTableDiscountReason('');
    }
    if (paymentMethod !== 'Split' || !payTableId) return;
    const table = tables.find((row) => row.id === payTableId);
    if (!table) return;
    const count = normalizeSplitCount(table, splitCount);
    const nextBreakdown = getTableBillBreakdown(table, nextPercent);
    setSplitCount(String(count));
    setSplitParts(buildEqualSplitParts(count, nextBreakdown.splitBasis));
  };

  const getDetailPaymentItems = (detail: any) => {
    if (!detail?.check?.id) return [];
    const roundItems = (Array.isArray(detail.rounds) ? detail.rounds : []).flatMap((round: any) => (
      Array.isArray(round.items) ? round.items : []
    ));
    const draftItems = Array.isArray(detail.draft_items) ? detail.draft_items : [];
    return [...roundItems, ...draftItems].filter(isBillablePaymentItem);
  };

  const getActiveDetailForTable = (table: any) => (
    tableDetailRecord?.table?.id === table?.id ? tableDetailRecord : null
  );

  const getTablePaymentItems = (table: any) => {
    const detail = getActiveDetailForTable(table);
    if (detail?.check?.id) return getDetailPaymentItems(detail);
    return Array.isArray(table?.items) ? table.items.filter(isBillablePaymentItem) : [];
  };

  const hasEmptyActiveCheckTotalMismatch = (table: any) => {
    const detail = getActiveDetailForTable(table);
    if (!detail?.check?.id) return false;
    const detailItems = getDetailPaymentItems(detail);
    const visibleTotal = new Decimal(detail.check?.total || detail.table?.check_total || table?.total || 0);
    const deposit = new Decimal(table?.deposit_amount || 0);
    return detailItems.length === 0 && visibleTotal.greaterThan(0) && deposit.lessThanOrEqualTo(0);
  };

  const getTableBillBreakdown = (table: any, discountPercentOverride?: number) => {
    const payItems = getTablePaymentItems(table);
    return calculateBillBreakdown({
      payItems,
      discountPercentRaw: discountPercentOverride ?? tableDiscountPercent,
      serviceFeePercent,
      depositAmount: table?.deposit_amount || 0,
      guestCount: Number(table?.guest_count || 1),
    });
  };

  useEffect(() => {
    if (!payTableId) return;
    const table = tables.find((x) => x.id === payTableId);
    if (!table) return;
    const nextCount = normalizeSplitCount(table, splitCount);
    if (String(nextCount) !== splitCount) {
      setSplitCount(String(nextCount));
    }
  }, [payTableId, tables, splitCount]);


  const printTableReceiptOnly = async () => {
    if (safeTableReceiptHtml) {
      try {
        await printViaLocalAgent(safeTableReceiptHtml, printSettings.printer_name);
        notify('success', tx(lang, 'iRonWaves Print Agent ilə çap göndərildi', 'Печать отправлена через iRonWaves Print Agent', 'Print job sent via iRonWaves Print Agent'));
        return;
      } catch {
        // Local agent is optional; fall back to QZ/browser print.
      }
    }
    if (printSettings.use_qz && safeTableReceiptHtml) {
      try {
        await qzPrintHtml(safeTableReceiptHtml, printSettings.printer_name);
        notify('success', tx(lang, 'QZ Tray ilə çap göndərildi', 'Печать отправлена через QZ Tray', 'Print job sent via QZ Tray'));
        return;
      } catch (e: any) {
        notify('error', tx(lang, `QZ çap alınmadı, brauzerə keçilir: ${e.message || e}`, `QZ печать не удалась, переход к печати браузера: ${e.message || e}`, `QZ printing failed, falling back to browser printing: ${e.message || e}`));
      }
    }
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="table-receipt"]');
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  return (
    <div className="h-full overflow-auto p-3 text-slate-100 md:p-6">
      {!isOnline && (
        <div className="mb-4 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <div className="font-semibold">{tx(lang, 'Offline masa rejimi aktivdir', 'Офлайн режим столов активен', 'Offline table mode is active')}</div>
          <div className="mt-1 text-amber-200/90">
            {tx(
              lang,
              'Masa əməliyyatları və mətbəx axını bu cihazda lokal olaraq davam edəcək. İnternet qayıdanda satış sync statusunu ayrıca yoxlayın.',
              'Операции со столами и кухня продолжат работать локально на этом устройстве. После возврата связи отдельно проверьте статус синхронизации продаж.',
              'Table actions and kitchen flow continue locally on this device. When connection returns, verify sale sync status separately.',
            )}
          </div>
        </div>
      )}
      <ConfirmModal
        open={Boolean(deleteTableId)}
        lang={lang}
        title={tx(lang, 'Masanı sil', 'Удалить стол', 'Delete table')}
        message={tx(lang, 'Masa yalnız boş olduqda silinməlidir.', 'Стол удаляется только если он свободен.', 'A table can only be deleted when it is empty.')}
        onCancel={() => setDeleteTableId(null)}
        onConfirm={() => {
          if (!deleteTableId) return;
          if (isBackendEnabled()) {
            void handleDeleteTable(deleteTableId);
            return;
          }
          setShowDeleteAuth(true);
        }}

      />
      <ConfirmModal
        open={Boolean(pendingCancelTable)}
        lang={lang}
        title={tx(lang, 'Masa ləğv edilsin?', 'Отменить стол?', 'Cancel table?')}
        message={tx(lang, `${pendingCancelTable?.label || 'Masa'} satışsız bağlanacaq. Kassaya heç bir məbləğ düşməyəcək.`, `${pendingCancelTable?.label || 'Стол'} будет закрыт без продажи.`, `${pendingCancelTable?.label || 'Table'} will be closed without a sale.`)}
        confirmLabel={tx(lang, 'Bəli, ləğv et', 'Да, отменить', 'Yes, cancel')}
        cancelLabel={tx(lang, 'Xeyr', 'Нет', 'No')}
        onCancel={() => setPendingCancelTable(null)}
        onConfirm={async () => {
          if (!pendingCancelTable) return;
          const reason = window.prompt(
            tx(lang, 'Ləğv səbəbi', 'Причина отмены', 'Cancel reason'),
            tx(lang, 'Səhv açılmış/boş masa', 'Ошибочно открытый/пустой стол', 'Opened by mistake / empty table')
          );
          if (!reason || !reason.trim()) return;
          setPendingCancelTable(null);
          try {
            await cancel_table_check_live(pendingCancelTable.id, reason.trim());
            logEvent(user?.username || 'staff', 'TABLE_CANCEL', {
              tenant_id,
              table_id: pendingCancelTable.id,
              table_label: pendingCancelTable.label || 'Masa',
              reason: reason.trim(),
            });
            notify('success', tx(lang, 'Masa ləğv edildi', 'Стол отменен', 'Table cancelled'));
            setViewTableId(null);
            setPayTableId(null);
            setTableDetailRecord(null);
            await Promise.all([loadFloorState(activeFloorId), loadData()]);
          } catch (error: any) {
            notify('error', error?.message || tx(lang, 'Masa ləğv edilmədi', 'Стол не отменен', 'Table was not cancelled'));
          }
        }}
      />

      {showDeleteAuth && (
        <DeleteAuthDialog
          lang={lang}
          onConfirm={() => { if (deleteTableId) void handleDeleteTable(deleteTableId); setShowDeleteAuth(false); }}
          onCancel={() => { setShowDeleteAuth(false); }}
          onError={(msg) => notify('error', msg)}
        />
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Yeni masa yarat', 'Создать новый стол', 'Create new table')}</h3>
            <input className="neon-input mt-3" placeholder={tx(lang, 'Masa adı (Məs: Masa 5)', 'Название стола (напр.: Стол 5)', 'Table name (e.g. Table 5)')} value={newTableName} onChange={(e) => setNewTableName(e.target.value)} />
            <div className="mt-4 flex justify-end gap-2">
              <button className="neon-btn rounded-lg px-4 py-2" onClick={() => setShowCreate(false)}>{tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}</button>
              <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={() => { void handleAddTable(); }}>{tx(lang, 'Yarat', 'Создать', 'Create')}</button>
            </div>
          </div>
        </div>
      )}

      {showCreateFloorPlan && (
        <CreateFloorPlanDialog
          lang={lang}
          name={newFloorPlanName}
          width={newFloorPlanWidth}
          height={newFloorPlanHeight}
          onNameChange={setNewFloorPlanName}
          onWidthChange={setNewFloorPlanWidth}
          onHeightChange={setNewFloorPlanHeight}
          onConfirm={() => { void handleAddFloorPlan(); }}
          onCancel={() => { setShowCreateFloorPlan(false); setNewFloorPlanName(''); }}
        />
      )}

      {revisionTarget && (
        <RevisionModal
          target={revisionTarget}
          lang={lang}
          onClose={() => { setRevisionTarget(null); setRevisionReason(''); setRevisionOverridePassword(''); }}
          onConfirm={async (reason, overridePassword) => {
            if (!revisionTarget) return;
            try {
              await revise_table_items_live(revisionTarget.tableId, {
                items: revisionTarget.nextItems,
                reason: reason || 'Draft silindi',
                override_password: overridePassword,
                actor: user?.username || 'staff',
              });
              notify('success', tx(lang, 'Düzəliş yazıldı', 'Изменение записано', 'Change applied'));
              setRevisionTarget(null);
              setRevisionReason('');
              setRevisionOverridePassword('');
              await Promise.all([loadData(), activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve()]);
            } catch (e: any) {
              notify('error', e?.message || tx(lang, 'Düzəliş alınmadı', 'Изменение не выполнено', 'Revision failed'));
            }
          }}
        />
      )}

      {payTableId && (() => {
        const payTable = tables.find((x) => x.id === payTableId);
        if (!payTable) return null;
        const breakdown = getTableBillBreakdown(payTable);
        return (
          <PaymentModal
            lang={lang}
            table={payTable}
            breakdown={breakdown}
            paymentMethod={paymentMethod}
            tableDiscountPercent={tableDiscountPercent}
            tableDiscountReason={tableDiscountReason}
            splitCash={splitCash}
            splitCount={splitCount}
            splitParts={splitParts}
            onPaymentMethodChange={setPaymentMethod}
            onDiscountChange={updateTableDiscountPercent}
            onDiscountReasonChange={setTableDiscountReason}
            onSplitCashChange={setSplitCash}
            onSplitCountChange={setSplitCount}
            onSplitPartsChange={setSplitParts}
            onSettle={() => { void handleSettleTableCheck(); }}
            onCancel={() => {
              setPayTableId(null);
              setPaymentMethod('Nəğd');
              setSplitCount('2');
              setSplitParts([]);
              setSplitCash('0');
              setTableDiscountPercent('0');
              setTableDiscountReason('');
            }}
          />
        );
      })()}

      {openTableId && (
        <OpenTableDialog
          lang={lang}
          guestCount={guestCount}
          depositGuestCount={depositGuestCount}
          depositPerGuest={depositPerGuest}
          onGuestCountChange={setGuestCount}
          onDepositGuestCountChange={setDepositGuestCount}
          onConfirm={() => { void handleOpenTable(); }}
          onCancel={() => { setOpenTableId(null); setGuestCount('1'); setDepositGuestCount('0'); }}
        />
      )}
      {showReservationCreate && (
        <CreateReservationDialog
          lang={lang}
          statusDraft={reservationStatusDraft}
          guestName={reservationGuestName}
          phone={reservationPhone}
          time={reservationTime}
          partySize={reservationPartySize}
          assignedTableId={reservationAssignedTableId}
          note={reservationNote}
          candidateTables={reservationCandidateTables}
          suggestedTables={suggestedReservationTables}
          onStatusDraftChange={setReservationStatusDraft}
          onGuestNameChange={setReservationGuestName}
          onPhoneChange={setReservationPhone}
          onTimeChange={setReservationTime}
          onPartySizeChange={setReservationPartySize}
          onAssignedTableChange={setReservationAssignedTableId}
          onNoteChange={setReservationNote}
          onConfirm={() => { void handleCreateReservation(); }}
          onCancel={() => { setShowReservationCreate(false); setReservationAssignedTableId(''); setReservationStatusDraft('BOOKED'); }}
        />
      )}

      {itemActionTarget && (
        <ItemActionModal
          target={itemActionTarget}
          lang={lang}
          onClose={() => {
            setItemActionTarget(null);
            setItemActionReason('');
            setItemActionReasonCode('guest_changed_mind');
            setItemActionQuantityDelta('1');
            setItemActionManagerPassword('');
          }}
          onConfirm={async (params) => {
            try {
              if (params.manager_password !== undefined && !params.manager_password) {
                notify('error', tx(lang, 'Manager/Admin şifrəsini yazın', 'Введите пароль менеджера/админа', 'Enter manager/admin password'));
                return;
              }
              await act_on_order_item_live(itemActionTarget.item.id, {
                action: params.action,
                reason: params.reason,
                reason_code: params.reason_code,
                quantity_delta: params.quantity_delta,
                manager_password: params.manager_password,
                remake_note: params.remake_note,
              });
              setItemActionTarget(null);
              setItemActionReason('');
              setItemActionReasonCode('guest_changed_mind');
              setItemActionQuantityDelta('1');
              setItemActionManagerPassword('');
              notify('success', tx(lang, 'Item statusu yeniləndi', 'Статус позиции обновлен', 'Item status updated'));
              if (viewTableId) {
                await refreshActiveTableDetail(viewTableId);
              }
            } catch (e: any) {
              notify('error', e?.message || tx(lang, 'Item əməliyyatı alınmadı', 'Операция по позиции не выполнена', 'Item action failed'));
            }
          }}
        />
      )}

      {statusLogTarget && (
        <StatusLogModal
          target={statusLogTarget}
          rows={statusLogRows}
          lang={lang}
          onClose={() => { setStatusLogTarget(null); setStatusLogRows([]); }}
        />
      )}

      {viewTableId && (
        <div
	          ref={detailPanelRef}
	          className={`fixed inset-0 z-[90] overflow-hidden bg-[#070b12] ${tableDetailClosing ? 'workspace-slide-out' : 'workspace-slide-in'}`}
        >
          <div className="flex h-full flex-col overflow-hidden p-3 md:p-4">
            {(() => {
              const t = tables.find((x) => x.id === viewTableId);
              if (!t) return null;
              const items = Array.isArray(t.items) ? t.items : [];
              const activeKitchenOrders = kitchenOrders.filter((row) => row.table_label === t.label);
              const detailRounds = tableDetailRecord?.table?.id === t.id ? (tableDetailRecord.rounds || []) : [];
              const kitchenRows = detailRounds.length > 0
                ? detailRounds.map((row) => ({
                    id: row.id,
                    round_no: row.round_no,
                    status: row.status,
                    created_at: row.sent_at,
                    items: row.items.map((item) => ({
                      item_name: item.item_name,
                      qty: item.qty,
                      seat_label: item.seat_no ? `Seat ${item.seat_no}` : undefined,
                      action: item.status === 'VOIDED' ? 'CANCEL' : null,
                      reason: item.note || '',
                      raw_status: item.status,
                    })),
                  }))
                : activeKitchenOrders;
              const waitingItems = kitchenRows
                .filter((row: any) => ['NEW', 'PREPARING', 'SENT'].includes(String(row.status || '').toUpperCase()))
                .flatMap((row: any) => (Array.isArray(row.items) ? row.items : []))
                .filter((row: any) => {
                  const rawStatus = String(row.raw_status || '').toUpperCase();
                  const action = String(row.action || '').toUpperCase();
                  return action !== 'CANCEL' && !['READY', 'SERVED', 'VOIDED'].includes(rawStatus);
                });
              const readyItemsRaw = kitchenRows
                .filter((row: any) => String(row.status || '').toUpperCase() === 'READY')
                .flatMap((row: any) => Array.isArray(row.items) ? row.items : [])
                .filter((row: any) => {
                  const rawStatus = String(row.raw_status || '').toUpperCase();
                  const action = String(row.action || '').toUpperCase();
                  return action !== 'CANCEL' && (rawStatus === '' || rawStatus === 'READY');
                });
              const servedForTable = servedItemsMap[t.id] || {};
              const readyItems = readyItemsRaw
                .map((row: any) => {
                  const servedQty = Number(servedForTable[String(row.item_name || '').trim()] || 0);
                  const nextQty = Math.max(0, Number(row.qty || 0) - servedQty);
                  return nextQty > 0 ? { ...row, qty: nextQty } : null;
                })
                .filter(Boolean) as any[];
              const servedItems = Object.entries(servedForTable)
                .filter(([, qty]) => Number(qty || 0) > 0)
                .map(([item_name, qty]) => ({ item_name, qty }));
              const revisionItems = kitchenRows
                .flatMap((row: any) => Array.isArray(row.items) ? row.items : [])
                .filter((row: any) => String(row.action || '').toUpperCase() === 'CANCEL');
              const otherTables = tables.filter((row) => row.id !== t.id);
              const detailSession = tableDetailRecord?.table?.id === t.id ? tableDetailRecord.session : null;
              const detailCheck = tableDetailRecord?.table?.id === t.id ? tableDetailRecord.check : null;
              const tableLockHolder = String((tableDetailRecord?.table?.id === t.id ? tableDetailRecord.table.locked_by : null) || t.assigned_to || '').trim() || null;
              const isManagerUser = ['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase());
              const userCanEditTable = !tableLockHolder || tableLockHolder === user?.username || isManagerUser;
	              const detailActiveItems = detailRounds.length > 0
	                ? detailRounds.flatMap((round) => round.items.map((item) => ({ ...item, round_no: round.round_no })))
	                : [];
	              const serverDraftItems = tableDetailRecord?.table?.id === t.id ? (tableDetailRecord.draft_items || []) : [];
	              const draftRows = detailCheck?.id ? serverDraftItems : roundDraft;
	              const draftTotal = draftRows.reduce((acc: Decimal, row: any) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0)).toFixed(2);
	              const sentDisplayItems = detailCheck?.id ? detailActiveItems : (detailActiveItems.length > 0 ? detailActiveItems : items);
	              const fullOrderRows = detailCheck?.id ? [...draftRows, ...detailActiveItems] : (detailActiveItems.length > 0 ? detailActiveItems : items);
	              const visibleCheckTotal = new Decimal(detailCheck?.total || (tableDetailRecord?.table?.id === t.id ? tableDetailRecord.table.check_total : null) || t.total || 0);
	              const tableNeedsSafeCancel = Boolean(
	                t.is_occupied &&
	                fullOrderRows.length === 0 &&
	                visibleCheckTotal.greaterThan(0) &&
	                new Decimal(t.deposit_amount || 0).lessThanOrEqualTo(0)
	              );
	              const clearVisibleDrafts = async () => {
	                if (detailCheck?.id && serverDraftItems.length > 0) {
	                  try {
	                    await Promise.all(serverDraftItems.map((row: any) => delete_draft_item_live(row.id)));
	                    await refreshActiveTableDetail(t.id);
	                  } catch (e: any) {
	                    notify('error', e?.message || tx(lang, 'Göndərilməmişlər təmizlənmədi', 'Неотправленные позиции не очищены', 'Draft items were not cleared'));
	                  }
	                  return;
	                }
	                clearRoundComposer();
	              };
	              const revisionBaseItems = items.length > 0 ? items : detailActiveItems;
	              const buildRevisionNextItems = (targetItemName: string, qtyToRemove: number | null) => {
	                let remainingToRemove = qtyToRemove === null ? Number.MAX_SAFE_INTEGER : Math.max(1, Number(qtyToRemove || 1));
	                return revisionBaseItems
	                  .map((row: any) => {
	                    const isTarget = String(row.item_name || '').trim() === String(targetItemName || '').trim();
	                    if (!isTarget || remainingToRemove <= 0) return row;
	                    const currentQty = Number(row.qty || 0);
	                    const removeQty = Math.min(currentQty, remainingToRemove);
	                    remainingToRemove -= removeQty;
	                    return { ...row, qty: currentQty - removeQty };
	                  })
	                  .filter((row: any) => Number(row.qty || 0) > 0)
	                  .map((row: any) => ({
	                    id: row.id,
	                    item_name: row.item_name,
	                    price: String(row.price || 0),
	                    qty: Number(row.qty || 0),
	                    is_coffee: Boolean(row.is_coffee),
	                    category: row.category || '',
	                    seat_label: row.seat_label,
	                  }));
	              };
	              const rounds = detailRounds.length > 0
                ? detailRounds.map((row) => ({
                    id: row.id,
                    round_no: row.round_no,
                    status: row.status,
                    created_at: row.sent_at,
                    items: row.items.map((item) => ({
                      item_name: item.item_name,
                      qty: item.qty,
                      seat_label: item.seat_no ? `Seat ${item.seat_no}` : undefined,
                      action: item.status === 'VOIDED' ? 'CANCEL' : null,
                      reason: item.note || '',
                    })),
                  }))
                : [...activeKitchenOrders]
                    .sort((a, b) => new Date(String(a.created_at || 0)).getTime() - new Date(String(b.created_at || 0)).getTime())
                    .map((row, idx) => ({
                      ...row,
                      round_no: Number((row as any).round_no || idx + 1),
                    }));
              return (
                <>
                  {isBahaYLab ? (
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5 mb-2.5 px-0.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => closeTableDetail()}
                          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-cyan-400/50 bg-cyan-500/15 text-xl text-cyan-100 shadow-lg shadow-cyan-500/10 transition hover:bg-cyan-500/25 active:scale-90 taktil-target"
                        >
                          ←
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-sm font-black text-slate-100 truncate">{t.label}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{detailSession?.guest_count ?? Number(t.guest_count || 0)} {tx(lang, 'nəfər', 'гостя', 'guests')}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {tableLockHolder && (
                          <span className="rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[9px] font-bold text-cyan-200 hidden sm:inline-block">
                            👤 {tableLockHolder}
                          </span>
                        )}
                        <span className="text-xs font-black text-amber-400 bg-amber-500/10 border border-amber-500/25 px-2.5 py-1 rounded-xl">
                          {new Decimal(detailCheck?.total || t.total || 0).toFixed(2)} ₼
                        </span>
                        <button
                          type="button"
                          onClick={() => { window.dispatchEvent(new CustomEvent('open-fast-switch')); }}
                          className="inline-flex min-h-14 shrink-0 items-center gap-3 rounded-2xl border-2 border-amber-400/60 bg-amber-500/20 px-6 py-3 text-base font-black text-amber-100 shadow-lg shadow-amber-500/15 transition hover:bg-amber-500/30 active:scale-95 taktil-target"
                        >
                          👤 {tx(lang, 'Dəyiş', 'Сменить', 'Switch')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <button
                            type="button"
                            onClick={() => closeTableDetail()}
                            className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-2xl border-2 border-cyan-400/50 bg-cyan-500/15 px-5 py-2.5 text-sm font-bold text-cyan-100 shadow-lg shadow-cyan-500/10 transition hover:bg-cyan-500/25 active:scale-95 taktil-target"
                          >
                            ← {tx(lang, 'Masalara qayıt', 'Назад к столам', 'Back to tables')}
                          </button>
                          <h3 className="truncate text-xl font-black text-slate-100">{t.label}</h3>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-bold text-emerald-100">
                            {new Decimal(detailCheck?.total || t.total || 0).toFixed(2)} ₼
                          </div>
                          <button
                            type="button"
                            onClick={() => { window.dispatchEvent(new CustomEvent('open-fast-switch')); }}
                            className="inline-flex min-h-14 shrink-0 items-center gap-3 rounded-2xl border-2 border-amber-400/60 bg-amber-500/20 px-6 py-3 text-base font-black text-amber-100 shadow-lg shadow-amber-500/15 transition hover:bg-amber-500/30 active:scale-95 taktil-target"
                            title={tx(lang, 'İstifadəçi dəyiş', 'Сменить пользователя', 'Switch user')}
                          >
                            👤 {tx(lang, 'Dəyiş', 'Сменить', 'Switch')}
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 rounded-2xl border border-slate-800/80 bg-slate-900/35 p-2">
                        <div className="rounded-xl bg-slate-950/45 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Masa', 'Стол', 'Table')}</div>
                          <div className="mt-0.5 text-sm font-bold text-slate-100">{t.label}</div>
                        </div>
                        <div className="rounded-xl bg-slate-950/45 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Nəfər', 'Гости', 'Guests')}</div>
                          <div className="mt-0.5 text-sm font-bold text-slate-100">{detailSession?.guest_count ?? Number(t.guest_count || 0)}</div>
                        </div>
                        <div className="rounded-xl bg-slate-950/45 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{tx(lang, 'Toplam', 'Итого', 'Total')}</div>
                          <div className="mt-0.5 text-sm font-bold text-slate-100">{new Decimal(detailCheck?.total || t.total || 0).toFixed(2)} ₼</div>
                        </div>
                      </div>
                    </>
                  )}
                  {tableNeedsSafeCancel && (
                    <div className="mt-3 rounded-2xl border border-rose-300/50 bg-rose-500/15 p-4 shadow-[0_0_28px_rgba(244,63,94,0.16)]">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                          <div className="text-base font-black text-rose-50">{tx(lang, 'Boş masada məbləğ qalıb', 'На пустом столе осталась сумма', 'Empty table has a remaining total')}</div>
                          <div className="mt-1 text-sm text-rose-100/85">
                            {tx(lang, `${visibleCheckTotal.toFixed(2)} ₼ görünür, amma sifariş siyahısı boşdur. Kassaya səhv satış düşməsin deyə bu masanı satışsız ləğv edin.`, `Отображается ${visibleCheckTotal.toFixed(2)} ₼, но список заказа пуст. Отмените без продажи, чтобы не создать ошибочную кассу.`, `${visibleCheckTotal.toFixed(2)} ₼ is shown, but the order list is empty. Cancel without sale to avoid a wrong cash entry.`)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl border border-rose-200/70 bg-rose-500/30 px-5 py-3 text-sm font-black text-white shadow-[0_0_22px_rgba(244,63,94,0.18)] disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!isManagerUser || !userCanEditTable}
                          onClick={() => { void handleCancelTableCheck(t.id, t.label); }}
                        >
                          {tx(lang, 'Satışsız ləğv et', 'Отменить без продажи', 'Cancel without sale')}
                        </button>
                      </div>
                    </div>
                  )}
	                  <div className={`mt-2 flex flex-wrap gap-2 ${isBahaYLab ? 'hidden' : ''}`}>
                    {tableLockHolder && (
	                      <div className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${userCanEditTable ? 'border-cyan-300/30 bg-cyan-500/10 text-cyan-100' : 'border-rose-300/30 bg-rose-500/10 text-rose-100'}`}>
                        {`👤 ${tableLockHolder} ${tx(lang, 'istifadə edir', 'использует', 'is using')}`}
                      </div>
                    )}
                    {isManagerUser && tableLockHolder && tableLockHolder !== user?.username && (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await unlock_table_live(t.id, lockReason || 'manager override');
                              notify('success', tx(lang, 'Masa lock-u açıldı', 'Блокировка стола снята', 'Table lock released'));
                              setLockReason('');
                              await refreshActiveTableDetail(t.id);
                            } catch (e: any) {
                              notify('error', e?.message || tx(lang, 'Lock açılmadı', 'Блокировка не снята', 'Lock was not released'));
                            }
                          }}
                          className="rounded-full border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100"
                        >
                          {tx(lang, 'Lock-u aç', 'Снять блокировку', 'Unlock')}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              if (!lockTransferTarget.trim()) {
                                notify('error', tx(lang, 'Yeni owner yazın', 'Укажите нового владельца', 'Enter new owner'));
                                return;
                              }
                              await transfer_table_lock_live(t.id, lockTransferTarget.trim(), lockReason || 'manager transfer');
                              notify('success', tx(lang, 'Masa ötürüldü', 'Стол передан', 'Table transferred'));
                              setLockTransferTarget('');
                              setLockReason('');
                              await refreshActiveTableDetail(t.id);
                            } catch (e: any) {
                              notify('error', e?.message || tx(lang, 'Masa ötürülmədi', 'Стол не передан', 'Table was not transferred'));
                            }
                          }}
                          className="rounded-full border border-violet-300/30 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-100"
                        >
                          {tx(lang, 'Owner-i ötür', 'Передать владельца', 'Transfer owner')}
                        </button>
                      </>
                    )}
                  </div>
                  {isManagerUser && tableLockHolder && tableLockHolder !== user?.username && !isBahaYLab && (
                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr]">
                      <input className="neon-input" value={lockTransferTarget} onChange={(e) => setLockTransferTarget(e.target.value)} placeholder={tx(lang, 'Yeni owner username', 'Новый владелец username', 'New owner username')} />
                      <input className="neon-input" value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder={tx(lang, 'Override səbəbi', 'Причина override', 'Override reason')} />
                    </div>
                  )}
	                  <div className={`mt-2 rounded-2xl border border-slate-700/70 bg-slate-900/30 p-2.5`}>
	                    <div className="flex flex-wrap gap-2.5">
                      {([
                        ['compose', tx(lang, 'Sifariş', 'Заказ', 'Order')],
                        ['service', `${tx(lang, 'Servis', 'Сервис', 'Service')}${readyItems.length > 0 ? ` · ${readyItems.length}` : ''}`],
                        ['history', `${tx(lang, 'Raundlar', 'Раунды', 'Rounds')} · ${rounds.length}`],
                        ['ops', tx(lang, 'Əməliyyatlar', 'Операции', 'Operations')],
                      ] as Array<[typeof tableWorkspaceTab, string]>).map(([tabKey, label]) => (
                        <button
                          key={tabKey}
                          type="button"
                          onClick={() => setTableWorkspaceTab(tabKey)}
	                          className={`rounded-2xl px-5 py-3 text-sm font-bold transition active:scale-95 taktil-target ${tableWorkspaceTab === tabKey ? 'bg-yellow-400 text-slate-950 shadow-md shadow-yellow-500/20 border-2 border-yellow-300/60' : 'border-2 border-slate-600/80 bg-slate-800/50 text-slate-200 hover:bg-slate-700/60 hover:border-slate-500/80'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
	                  </div>
	                  <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden tab-content-enter" key={tableWorkspaceTab}>
                  {tableWorkspaceTab === 'history' && (
                    <HistoryTab rounds={rounds} lang={lang} />
                  )}
		                  <div className={`order-2 mt-3 flex-none ${tableWorkspaceTab === 'compose' ? '' : 'hidden'} ${isBahaYLab ? 'hidden' : ''}`}>
	                    {/* Trigger bar */}
	                    <button
	                      type="button"
	                      onClick={() => setShowSentSlideUp(true)}
	                      className="flex w-full items-center justify-between rounded-xl border border-slate-700/60 bg-slate-900/50 px-4 py-3 text-left transition hover:bg-slate-800/60 active:scale-[0.99]"
	                    >
	                      <div className="flex items-center gap-2.5">
	                        <div className="flex -space-x-1.5">
	                          {sentDisplayItems.some((it: any) => normalizeOrderItemStatus(it.status) === 'READY') && <span className="h-3 w-3 rounded-full border-2 border-slate-900 bg-emerald-400" />}
	                          {sentDisplayItems.some((it: any) => normalizeOrderItemStatus(it.status) === 'PREPARING') && <span className="h-3 w-3 rounded-full border-2 border-slate-900 bg-orange-400" />}
	                          {sentDisplayItems.some((it: any) => ['SENT', 'NEW'].includes(normalizeOrderItemStatus(it.status))) && <span className="h-3 w-3 rounded-full border-2 border-slate-900 bg-blue-400" />}
	                          {sentDisplayItems.some((it: any) => normalizeOrderItemStatus(it.status) === 'VOID_REQUESTED') && <span className="h-3 w-3 rounded-full border-2 border-slate-900 bg-yellow-400 animate-pulse" />}
	                        </div>
	                        <span className="text-sm font-bold text-slate-200">{tx(lang, 'Göndərilmişlər', 'Отправленные', 'Sent')}</span>
	                      </div>
	                      <div className="flex items-center gap-2">
	                        <span className="rounded-full bg-slate-700/80 px-2.5 py-0.5 text-xs font-bold text-slate-100">{sentDisplayItems.length}</span>
	                        <span className="text-lg text-slate-400">↑</span>
	                      </div>
	                    </button>
	                  </div>
	                  {tableWorkspaceTab === 'compose' && isBahaYLab && (
	                    <div className="order-1 flex min-h-0 flex-1 flex-col overflow-hidden h-[calc(100dvh-200px)] md:h-[calc(100dvh-160px)]">
	                      <BahaYTableCompose
	                        lang={lang}
	                        filteredRoundMenu={filteredRoundMenu}
	                        roundCategories={roundCategories}
	                        roundSearch={roundSearch}
	                        roundCategory={roundCategory}
	                        onSearchChange={setRoundSearch}
	                        onCategoryChange={setRoundCategory}
	                        onSelectItem={addMenuItemToRound}
	                        roundDraft={roundDraft}
	                        draftRows={draftRows}
	                        draftTotal={draftTotal}
	                        draftSendError={draftSendError}
	                        onClearDrafts={clearVisibleDrafts}
	                        onUpdateQty={(id, qty) => updateRoundDraftQty(id, qty)}
	                        onSend={() => { void sendRoundDirectly(t); }}
	                        tableOccupied={Boolean(t?.is_occupied)}
	                        userCanEdit={userCanEditTable}
	                        onSettle={() => {
	                          if (hasEmptyActiveCheckTotalMismatch(t)) { notify('error', tx(lang, 'Sifariş boşdur', 'Заказ пуст', 'Order empty')); return; }
	                          setPayTableId(t.id); setViewTableId(null); setPaymentMethod('Nəğd'); setSplitCount('2'); setSplitParts([]); setSplitCash('0'); setTableDiscountPercent('0');
	                        }}
	                        sentItems={sentDisplayItems}
	                        onShowFullList={() => setShowFullOrderList(true)}
	                        onVoidItem={(item) => { setItemActionTarget({ item, action: 'VOID' }); setItemActionReason(''); setItemActionManagerPassword(''); }}
	                        lockHolder={tableLockHolder}
	                        userCanEditTable={userCanEditTable}
	                        readyCount={readyItems.length}
	                        roundsCount={rounds.length}
	                        activeTab={tableWorkspaceTab}
	                        onTabChange={(tab) => setTableWorkspaceTab(tab as any)}
	                        onBack={() => closeTableDetail()}
	                        onCancelTable={() => { void handleCancelTableCheck(t.id, t.label); }}
	                        summerPromoEnabled={Boolean(tenantSettings?.beverage_service_settings?.summer_promo_enabled)}
	                        onUpdateNote={updateRoundDraftNote}
	                      />
	                    </div>
	                  )}
	                  {tableWorkspaceTab === 'compose' && !isBahaYLab && (
		                  <div className="order-1 flex min-h-0 flex-[1.2] flex-col overflow-hidden rounded-xl border border-slate-700/70 bg-slate-900/35 p-3 lg:p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
	                        <div className="text-lg font-black text-slate-100">{tx(lang, 'Yeni sifariş', 'Новый заказ', 'New order')}</div>
                      </div>
                      <div className="rounded-full border border-slate-700/70 bg-slate-950/40 px-3 py-1 text-xs font-semibold text-slate-200">
                        {tx(lang, 'Göndərilməmişlər', 'Неотправленные', 'Unsent items')}: {draftTotal} ₼
                      </div>
                    </div>

	                    <div className={`mt-3 grid min-h-0 flex-1 gap-3 ${isBahaYLab ? 'lg:grid-cols-[1fr_0.4fr]' : 'lg:grid-cols-[1.25fr_0.75fr]'}`}>
                      <div className="flex min-h-0 flex-col overflow-hidden">
                        <MenuGrid
                          items={filteredRoundMenu}
                          categories={roundCategories}
                          search={roundSearch}
                          selectedCategory={roundCategory}
                          lang={lang}
                          onSearchChange={setRoundSearch}
                          onCategoryChange={setRoundCategory}
                          onSelectItem={addMenuItemToRound}
                          draftItems={roundDraft}
                        />
                      </div>

                      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700/70 bg-slate-950/30 p-4">
                        {draftSendError ? (
                          <div className="mb-3 rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">
                            <div>{tx(lang, 'Göndərmə alınmadı. Məhsullar hələ göndərilməmiş kimi saxlanıldı.', 'Отправка не удалась. Позиции остались неотправленными.', 'Send failed. Items are still kept as unsent.')}</div>
                            <div className="mt-1 text-rose-100/80">{draftSendError}</div>
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Göndərilməmişlər', 'Неотправленные', 'Unsent items')}</div>
                          {draftRows.length > 0 ? (
                            <button type="button" onClick={() => { void clearVisibleDrafts(); }} className="text-xs font-semibold text-slate-400 hover:text-slate-200">
                              {tx(lang, 'Təmizlə', 'Очистить', 'Clear')}
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1">
                          <div className="space-y-3 pb-3">
                          {draftRows.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-700/60 px-4 py-6 text-center text-sm text-slate-400">
                              {tx(lang, 'Buradakı məhsullar bir toxunuşla mətbəxə gedəcək', 'Эти позиции одним нажатием уйдут на кухню', 'Items here will go to the kitchen in one tap')}
                            </div>
                          ) : (
                            draftRows.map((row: any) => (
                              <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-100">{row.item_name}</div>
                                  <div className="text-xs text-slate-400">{Number(row.price || 0).toFixed(2)} ₼</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-600 text-sm font-bold text-slate-200" onClick={() => updateRoundDraftQty(String(row.id), Number(row.qty || 0) - 1)}>−</button>
                                  <div className="min-w-6 text-center text-sm font-bold text-slate-100">{row.qty}</div>
                                  <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-600 text-sm font-bold text-slate-200" onClick={() => updateRoundDraftQty(String(row.id), Number(row.qty || 0) + 1)}>+</button>
                                  <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-300/40 bg-rose-500/10 text-xs font-bold text-rose-200" onClick={() => updateRoundDraftQty(String(row.id), 0)}>✕</button>
                                </div>
                              </div>
                            ))
                          )}
                          </div>
                        </div>
                        <StickyActionBar
                          lang={lang}
                          total={draftTotal}
                          disabled={draftRows.length === 0 || !userCanEditTable}
                          onClear={draftRows.length > 0 ? clearVisibleDrafts : undefined}
                          onSend={() => { void sendRoundDirectly(t); }}
                          draftCount={draftRows.length}
                          showSettle={isBahaYLab && Boolean(t?.is_occupied)}
                          settleDisabled={!userCanEditTable}
                          onSettle={() => {
                            if (hasEmptyActiveCheckTotalMismatch(t)) {
                              notify('error', tx(lang, 'Sifariş siyahısı boşdur.', 'Список заказов пуст.', 'Order list is empty.'));
                              return;
                            }
                            setPayTableId(t.id);
                            setViewTableId(null);
                            setPaymentMethod('Nəğd');
                            setSplitCount('2');
                            setSplitParts([]);
                            setSplitCash('0');
                            setTableDiscountPercent('0');
                          }}
                        />
                      </div>
                    </div>
                      {/* Slide-up Sent Items Panel - fixed overlay */}
		                  </div>
	                  )}
                      {showSentSlideUp && (
                        <SentItemsSlideUp
                          lang={lang}
                          items={sentDisplayItems}
                          userCanEdit={userCanEditTable}
                          onClose={() => setShowSentSlideUp(false)}
                          onAction={(item, action) => {
                            setShowSentSlideUp(false);
                            setItemActionTarget({ item, action });
                            setItemActionQuantityDelta('1');
                            setItemActionReasonCode(action === 'WASTE' ? 'kitchen_mistake' : 'guest_changed_mind');
                          }}
                        />
                      )}
	                  {showFullOrderList && (
	                    <FullOrderListModal
	                      lang={lang}
	                      tableLabel={t.label}
	                      items={fullOrderRows}
	                      tableNeedsSafeCancel={tableNeedsSafeCancel}
	                      isManagerUser={isManagerUser}
	                      userCanEditTable={userCanEditTable}
	                      onClose={() => setShowFullOrderList(false)}
	                      onVoidItem={(item) => { setItemActionTarget({ item, action: 'VOID' }); setItemActionReason(''); setItemActionManagerPassword(''); }}
	                      onCancelTable={() => { void handleCancelTableCheck(t.id, t.label); }}
	                    />
	                  )}
                  {tableWorkspaceTab === 'service' && (
                    <ServiceTab
                      lang={lang}
                      waitingItems={waitingItems}
                      readyItems={readyItems}
                      servedItems={servedItems}
                      revisionItems={revisionItems}
                      onMarkServed={(itemName, qty) => markReadyItemServed(t.id, itemName, qty)}
                    />
                  )}
                  {tableWorkspaceTab === 'ops' && t.is_occupied && (
                    <OperationsPanel
                      table={t}
                      otherTables={otherTables}
                      isManagerUser={isManagerUser}
                      userCanEditTable={userCanEditTable}
                      lang={lang}
                      onTransfer={async (tableId, targetId) => {
                        const targetTable = otherTables.find((row) => row.id === targetId);
                        const targetLabel = targetTable?.label || 'Masa';
                        const ok = window.confirm(
                          tx(lang,
                            `${t.label} masasını ${targetLabel} masasına köçürmək istəyirsiniz?`,
                            `Перенести стол ${t.label} на ${targetLabel}?`,
                            `Transfer table ${t.label} to ${targetLabel}?`)
                        );
                        if (!ok) return;
                        try {
                          await transfer_table_live(tableId, targetId, user?.username || 'staff');
                          logEvent(user?.username || 'staff', 'TABLE_TRANSFER', {
                            tenant_id,
                            source_table_id: tableId,
                            source_label: t.label,
                            target_table_id: targetId,
                            target_label: targetLabel,
                          });
                          notify('success', tx(lang, 'Masa köçürüldü', 'Стол перенесен', 'Table transferred'));
                          setViewTableId(null);
                          setTableDetailRecord(null);
                          await Promise.all([loadData(), activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve()]);
                        } catch (e: any) {
                          notify('error', e.message);
                        }
                      }}
                      onCombine={async (tableId, targetId) => { void handleCombineTables(tableId, targetId); }}
                      onSplit={async (tableId, mergedGroupId) => { void handleSplitTables(tableId, mergedGroupId); }}
                      onCancel={(tableId, label) => { void handleCancelTableCheck(tableId, label); }}
                    />
                  )}
                  </div>
                  {tableNeedsSafeCancel && (
                    <div className="mt-4 rounded-2xl border border-rose-300/40 bg-rose-500/10 p-4 shadow-[0_0_24px_rgba(244,63,94,0.12)]">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="text-sm font-black text-rose-100">{tx(lang, 'Boş masada məbləğ qalıb', 'На пустом столе осталась сумма', 'Empty table has a remaining total')}</div>
                          <div className="mt-1 text-xs text-rose-100/80">
                            {tx(lang, `${visibleCheckTotal.toFixed(2)} ₼ görünür, amma sifariş siyahısı boşdur. Bu check satış yaratmadan ləğv edilməlidir.`, `Отображается ${visibleCheckTotal.toFixed(2)} ₼, но список заказа пуст. Этот чек нужно отменить без продажи.`, `${visibleCheckTotal.toFixed(2)} ₼ is shown, but the order list is empty. This check should be cancelled without sale.`)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-300/50 bg-rose-500/20 px-4 py-2 text-sm font-black text-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!isManagerUser || !userCanEditTable}
                          onClick={() => { void handleCancelTableCheck(t.id, t.label); }}
                        >
                          {tx(lang, 'Satışsız ləğv et', 'Отменить без продажи', 'Cancel without sale')}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className={`mt-4 flex justify-end gap-2 ${isBahaYLab ? 'hidden' : ''}`}>
                    {!isBahaYLab && <button className="neon-btn rounded-lg px-4 py-2" onClick={() => closeTableDetail()}>{tx(lang, 'Paneli gizlət', 'Скрыть панель', 'Hide panel')}</button>}
                    {isBahaYLab && <button className="neon-btn rounded-lg px-4 py-2" onClick={() => closeTableDetail()}>← {tx(lang, 'Geri', 'Назад', 'Back')}</button>}
                    {tableNeedsSafeCancel && (
                      <button
                        type="button"
                        className="inline-flex min-h-12 items-center justify-center rounded-xl border border-rose-200/70 bg-rose-500/25 px-5 py-3 text-sm font-black text-rose-50 shadow-[0_0_24px_rgba(244,63,94,0.18)] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!isManagerUser || !userCanEditTable}
                        onClick={() => { void handleCancelTableCheck(t.id, t.label); }}
                      >
                        {tx(lang, 'Satışsız ləğv et', 'Отменить без продажи', 'Cancel without sale')}
                      </button>
                    )}
                    {t.is_occupied && (
                      <button
                        className="glossy-gold min-h-12 rounded-xl px-5 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!userCanEditTable}
                        onClick={() => {
                          if (hasEmptyActiveCheckTotalMismatch(t)) {
                            notify('error', tx(lang, 'Bu masada məbləğ görünür, amma sifariş siyahısı boşdur. Səhv bağlanmaması üçün hesab açılmadı.', 'У стола есть сумма, но список заказов пуст. Закрытие заблокировано, чтобы не создать неверную продажу.', 'This table shows a total but the order list is empty, so closing is blocked.'));
                            setShowFullOrderList(true);
                            return;
                          }
                          setPayTableId(t.id);
                          setViewTableId(null);
                          setPaymentMethod('Nəğd');
                          setSplitCount('2');
                          setSplitParts([]);
                          setSplitCash('0');
                          setTableDiscountPercent('0');
                        }}
                      >
                        {tx(lang, 'Hesabı Al', 'Закрыть счет')}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      <ReceiptPreview
        html={safeTableReceiptHtml}
        lang={lang}
        onClose={() => setTableReceiptHtml(null)}
        onPrint={printTableReceiptOnly}
      />

      <div className={`mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between ${isBahaYLab && viewTableId ? 'hidden' : ''}`}>
        <h2 className="text-2xl font-bold flex items-center gap-2"><LayoutGrid size={28} className="text-yellow-300"/> {tx(lang, 'Masalar', 'Столы', 'Tables')}</h2>
        {['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase()) && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setWorkspaceView('floor')}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${workspaceView === 'floor' ? 'bg-yellow-400 text-slate-950' : 'border border-slate-600 bg-slate-800/50 text-slate-200'}`}
          >
            <MapPinned size={16} className="mr-2 inline" />
            {tx(lang, 'Floor', 'Floor', 'Floor')}
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceView('reservations')}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${workspaceView === 'reservations' ? 'bg-yellow-400 text-slate-950' : 'border border-slate-600 bg-slate-800/50 text-slate-200'}`}
          >
            <CalendarClock size={16} className="mr-2 inline" />
            {tx(lang, 'Rezervasiyalar', 'Брони', 'Reservations')}
          </button>
          <button onClick={() => setShowCreate(true)} className="glossy-gold min-h-13 px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors font-bold">
            <Plus size={20} /> {tx(lang, 'Masa Yarat', 'Создать стол', 'Create Table')}
          </button>
          {selectedFloorTable && !tablesById[selectedFloorTable.id]?.is_occupied && (
            <button
              type="button"
              onClick={() => setDeleteTableId(selectedFloorTable.id)}
              className="min-h-13 rounded-xl border border-rose-300/40 bg-rose-500/12 px-4 py-3 font-bold text-rose-100"
            >
              {tx(lang, 'Masanı sil', 'Удалить стол', 'Delete table')}
            </button>
          )}
        </div>
        )}
      </div>
      {workspaceView === 'floor' && (
        <div className={`mb-6 rounded-[28px] border border-white/10 bg-slate-900/35 p-4 ${isBahaYLab && viewTableId ? 'hidden' : ''}`}>
          {isFloorPlansLoading && !activeFloorId && floorTables.length === 0 ? (
            <div className="rounded-2xl border border-sky-300/30 bg-sky-500/10 p-4">
              <div className="text-sm font-semibold text-sky-100">
                {tx(lang, 'Masa planı yüklənir...', 'План зала загружается...', 'Floor plan is loading...')}
              </div>
            </div>
          ) : !activeFloorId ? (
            <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-4">
              <div className="text-sm font-semibold text-amber-100">
                {tx(lang, 'Masa planı yüklənmədi. Backend bağlantısı gecikə bilər.', 'План зала не загрузился. Подключение к backend может быть медленным.', 'Floor plan is not loaded yet. Backend connection may be slow.')}
              </div>
              <button
                type="button"
                className="mt-3 rounded-lg border border-amber-200/40 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-50"
                onClick={() => {
                  void forceTablesBootstrapRefresh();
                }}
              >
                {tx(lang, 'Yenidən yoxla', 'Проверить снова', 'Retry')}
              </button>
            </div>
          ) : (
            <>
            {/* Zonalar Tab Menyusu */}
            {['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase()) && (
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-white/5 pb-4">
              {floorPlans.map((row) => {
                const active = row.id === activeFloorId;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setActiveFloorId(row.id)}
                    className={`rounded-2xl px-5 py-2.5 text-sm font-bold transition-all duration-200 ${
                      active
                        ? 'bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 shadow-[0_4px_20px_rgba(245,158,11,0.3)] scale-[1.02]'
                        : 'border border-slate-700/60 bg-slate-800/20 text-slate-300 hover:bg-slate-800/40 hover:text-white'
                    }`}
                  >
                    {row.name}
                  </button>
                );
              })}
              
              {['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase()) && (
                <button
                  type="button"
                  onClick={() => setShowCreateFloorPlan(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-800/20 text-slate-300 hover:bg-slate-800/40 hover:text-white transition-all active:scale-95"
                  title={tx(lang, 'Yeni zal/zona əlavə et', 'Добавить новый зал', 'Add new floor plan')}
                >
                  <Plus size={18} />
                </button>
              )}
            </div>
            )}

            <FloorView
              lang={lang}
              floorPlans={floorPlans}
              activeFloorId={activeFloorId}
              floorTables={floorTables}
              floorEditMode={floorEditMode}
              floorViewMode={floorViewMode}
              floorMultiSelectMode={floorMultiSelectMode}
              floorDropPreview={floorDropPreview}
              draggingTableId={draggingTableId}
              draggingTableIds={draggingTableIds}
              selectedFloorTableId={selectedFloorTableId}
              selectedFloorTableIds={selectedFloorTableIds}
              selectedFloorTableLabel={selectedFloorTableLabel}
              selectedFloorTable={selectedFloorTable}
              selectedFloorGroup={selectedFloorGroup}
              selectedFloorGroupId={selectedFloorGroupId}
              selectedFloorTables={selectedFloorTables}
              mergedGroups={mergedGroups}
              mergedGroupOutlines={mergedGroupOutlines}
              floorSummary={floorSummary}
              tablesById={tablesById}
              readyCountsByLabel={readyCountsByLabel}
              tableGridScale={tableGridScale}
              tableGridMinWidth={tableGridMinWidth}
              copyLayoutSourceFloorId={copyLayoutSourceFloorId}
              viewTableId={viewTableId}
              userRole={String(user?.role || '')}
              currentUsername={user?.username}
              isBahaYLab={isBahaYLab}
              setFloorViewMode={setFloorViewMode}
              setFloorEditMode={setFloorEditMode}
              setFloorMultiSelectMode={setFloorMultiSelectMode}
              setSelectedFloorTableIds={setSelectedFloorTableIds}
              setSelectedFloorTableId={setSelectedFloorTableId}
              setSelectedFloorGroupId={setSelectedFloorGroupId}
              setSelectedFloorTableLabel={setSelectedFloorTableLabel}
              setTableGridScale={setTableGridScale}
              setCopyLayoutSourceFloorId={setCopyLayoutSourceFloorId}
              setDraggingTableId={setDraggingTableId}
              setDraggingTableIds={setDraggingTableIds}
              setFloorDropPreview={setFloorDropPreview}
              setDeleteTableId={setDeleteTableId}
              onFloorGridDrop={(e) => { void handleFloorGridDrop(e); }}
              onNudgeSelectedTables={(dx, dy) => { void handleNudgeSelectedTables(dx, dy); }}
              onPersistFloorLayout={(tableId, payload) => { void persistFloorLayout(tableId, payload); }}
              onNudgeGroup={(groupId, dx, dy) => { void handleNudgeGroup(groupId, dx, dy); }}
              onSplitGroup={(tableId, groupId) => { void handleSplitTables(tableId, groupId); }}
              onCopyFloorLayout={(sourceFloorId) => { void handleCopyFloorLayout(sourceFloorId); }}
              onResetFloorLayout={() => { void handleResetFloorLayout(); }}
              onRenameFloorPlan={(floorId, newName) => { void handleRenameFloorPlan(floorId, newName); }}
              onDeleteFloorPlan={(floorId) => { void handleDeleteFloorPlan(floorId); }}
              onSelectWaiterTable={handleSelectWaiterTable}
              onMarkTableClean={(tableId) => { void handleMarkTableClean(tableId); }}
              notify={notify}
            />
            </>
          )}
        </div>
      )}
      {workspaceView === 'reservations' && (
        <ReservationPanel
          lang={lang}
          hidden={Boolean(isBahaYLab && viewTableId)}
          reservationZoom={reservationZoom}
          reservationDate={reservationDate}
          reservationTimeline={reservationTimeline}
          reservations={reservations}
          draggingReservationId={draggingReservationId}
          onZoomChange={setReservationZoom}
          onDateChange={setReservationDate}
          onCreateClick={() => setShowReservationCreate(true)}
          onStatusChange={(id, status) => { void handleReservationStatusChange(id, status); }}
          onSeat={(id, tableId) => { void handleSeatReservation(id, tableId); }}
          onDelete={(id) => { void delete_reservation_live(id).then(() => loadReservations()); }}
          onDragStart={setDraggingReservationId}
          onDragEnd={() => setDraggingReservationId(null)}
          onResizeStart={(id, startY, startDuration) => setResizingReservation({ id, startY, startDuration })}
        />
      )}
    </div>
  );
}
