import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { get_tables_live, create_table_live, delete_table_live, open_table_live, transfer_table_live, revise_table_items_live } from '../api/tables';
import { get_kitchen_orders_live } from '../api/kds';
import { get_menu_items_live } from '../api/menu';
import { subscribeTenantRealtime } from '../api/realtime';
import { act_on_order_item_live, combine_tables_live, create_reservation_live, delete_reservation_live, get_floor_plans_live, get_floor_state_live, get_reservations_live, get_table_detail_live, seat_reservation_live, send_table_round_live, settle_table_check_live, split_table_group_live, transfer_table_lock_live, unlock_table_live, update_reservation_live, update_table_layout_live, type FloorPlanRecord, type FloorTableState, type ReservationRecord, type TableDetailRecord } from '../api/restaurant';
import { LayoutGrid, Plus, CalendarClock, Users, MapPinned } from 'lucide-react';
import { useAppStore } from '../store';
import { tx } from '../i18n';
import ConfirmModal from './ConfirmModal';
import { Decimal } from 'decimal.js';
import { get_business_profile, get_settings } from '../api/settings';
import { getDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { qzPrintHtml } from '../lib/qz';
import { hostScopedKey } from '../lib/storage_keys';
import TableGrid from './tables/TableGrid';
import MenuGrid from './tables/MenuGrid';
import StickyActionBar from './tables/StickyActionBar';

export default function TablesPage() {
  const [tables, setTables] = useState<any[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<any[]>([]);
  const [menuCatalog, setMenuCatalog] = useState<any[]>([]);
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [newTableName, setNewTableName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<'floor' | 'reservations'>('floor');
  const [deleteTableId, setDeleteTableId] = useState<string | null>(null);
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState('1');
  const [depositGuestCount, setDepositGuestCount] = useState('0');
  const [showDeleteAuth, setShowDeleteAuth] = useState(false);
  const [deleteAdminPass, setDeleteAdminPass] = useState('');
  const [payTableId, setPayTableId] = useState<string | null>(null);
  const [viewTableId, setViewTableId] = useState<string | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [lockTransferTarget, setLockTransferTarget] = useState('');
  const [lockReason, setLockReason] = useState('');
  const [itemActionTarget, setItemActionTarget] = useState<any | null>(null);
  const [itemActionReason, setItemActionReason] = useState('');
  const [itemActionManagerPassword, setItemActionManagerPassword] = useState('');
  const [tableReceiptHtml, setTableReceiptHtml] = useState<string | null>(null);
  const [revisionTarget, setRevisionTarget] = useState<{ tableId: string; itemName: string; nextItems: any[] } | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [revisionOverridePassword, setRevisionOverridePassword] = useState('');
  const [showFullOrderList, setShowFullOrderList] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'Nəğd' | 'Kart' | 'Split'>('Nəğd');
  const [splitCash, setSplitCash] = useState('0');
  const [splitCount, setSplitCount] = useState('2');
  const [splitParts, setSplitParts] = useState<Array<{ amount: string; method: 'Nəğd' | 'Kart' }>>([]);
  const [roundSearch, setRoundSearch] = useState('');
  const [roundCategory, setRoundCategory] = useState('ALL');
  const [roundDraft, setRoundDraft] = useState<any[]>([]);
  const [servedItemsMap, setServedItemsMap] = useState<Record<string, Record<string, number>>>({});
  const [tableWorkspaceTab, setTableWorkspaceTab] = useState<'compose' | 'service' | 'history' | 'ops'>('compose');
  const [floorPlans, setFloorPlans] = useState<FloorPlanRecord[]>([]);
  const [activeFloorId, setActiveFloorId] = useState<string>('');
  const [floorTables, setFloorTables] = useState<FloorTableState[]>([]);
  const [floorEditMode, setFloorEditMode] = useState(false);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [draggingTableIds, setDraggingTableIds] = useState<string[]>([]);
  const [floorDropPreview, setFloorDropPreview] = useState<{ x: number; y: number } | null>(null);
  const [draggingReservationId, setDraggingReservationId] = useState<string | null>(null);
  const [reservationDropPreview, setReservationDropPreview] = useState<{ lane: number; top: number; reservationAt: string; assignedTableId: string | null; hasConflict: boolean } | null>(null);
  const [selectedFloorTableId, setSelectedFloorTableId] = useState<string | null>(null);
  const [selectedFloorGroupId, setSelectedFloorGroupId] = useState<string | null>(null);
  const [floorMultiSelectMode, setFloorMultiSelectMode] = useState(false);
  const [selectedFloorTableIds, setSelectedFloorTableIds] = useState<string[]>([]);
  const [copyLayoutSourceFloorId, setCopyLayoutSourceFloorId] = useState<string>('');
  const [reservationDurationDrafts, setReservationDurationDrafts] = useState<Record<string, number>>({});
  const [resizingReservation, setResizingReservation] = useState<{ id: string; startY: number; startDuration: number } | null>(null);
  const [reservationZoom, setReservationZoom] = useState<15 | 30>(15);
  const [tableGridScale, setTableGridScale] = useState(100);
  const [reservationDate, setReservationDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [showReservationCreate, setShowReservationCreate] = useState(false);
  const [reservationGuestName, setReservationGuestName] = useState('');
  const [reservationPhone, setReservationPhone] = useState('');
  const [reservationTime, setReservationTime] = useState('19:00');
  const [reservationPartySize, setReservationPartySize] = useState('2');
  const [reservationNote, setReservationNote] = useState('');
  const [reservationAssignedTableId, setReservationAssignedTableId] = useState('');
  const [reservationStatusDraft, setReservationStatusDraft] = useState<'BOOKED' | 'WAITLIST'>('BOOKED');
  const [tableDetailRecord, setTableDetailRecord] = useState<TableDetailRecord | null>(null);
  const receiptRef = useRef<HTMLIFrameElement | null>(null);
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const businessProfile = get_business_profile(tenant_id);
  const tenantSettings = get_settings(tenant_id);
  const printSettings = tenantSettings.print_settings || { use_qz: false, printer_name: '' };
  const depositPerGuest = new Decimal((tenantSettings as any).table_service_settings?.deposit_per_guest_azn || 0);
  const reservationLockHours = Math.max(0, Number((tenantSettings as any).table_service_settings?.reservation_lock_hours ?? 2));
  const serviceFeePercent = new Decimal(tenantSettings.service_fee_percent || 0);

  const formatDisplayId = (id: string) => (id ? id.split('-')[0].toUpperCase() : '-');
  const kitchenBadge = (status?: string | null) => {
    switch (String(status || '').toUpperCase()) {
      case 'NEW':
        return { label: tx(lang, 'Mətbəxə göndərildi', 'Отправлено на кухню', 'Sent to kitchen'), className: 'bg-blue-400/20 text-blue-200 border border-blue-300/40' };
      case 'PREPARING':
        return { label: tx(lang, 'Hazırlanır', 'Готовится', 'Preparing'), className: 'bg-orange-400/20 text-orange-200 border border-orange-300/40' };
      case 'READY':
        return { label: tx(lang, 'Servisə hazırdır', 'Готово к подаче', 'Ready to serve'), className: 'bg-emerald-400/20 text-emerald-200 border border-emerald-300/40' };
      default:
        return null;
    }
  };

  const servedStorageKey = hostScopedKey(`${tenant_id}_table_served_items`);

  const roundCategories = useMemo(
    () => ['ALL', ...Array.from(new Set(menuCatalog.map((row) => String(row.category || '').trim()).filter(Boolean)))],
    [menuCatalog],
  );

  const filteredRoundMenu = useMemo(() => {
    return menuCatalog.filter((item) => {
      const categoryOk = roundCategory === 'ALL' || String(item.category || '') === roundCategory;
      const hay = `${String(item.item_name || '')} ${String(item.description || '')} ${String(item.category || '')}`.toLowerCase();
      const searchOk = !roundSearch.trim() || hay.includes(roundSearch.trim().toLowerCase());
      return categoryOk && searchOk;
    });
  }, [menuCatalog, roundCategory, roundSearch]);

  const floorSummary = useMemo(() => {
    const counts = {
      AVAILABLE: 0,
      RESERVED: 0,
      SEATED: 0,
      ACTIVE_CHECK: 0,
      DIRTY: 0,
    };
    floorTables.forEach((row) => {
      const status = String(row.status || 'AVAILABLE').toUpperCase() as keyof typeof counts;
      if (status in counts) counts[status] += 1;
    });
    return counts;
  }, [floorTables]);

  const reservationCandidateTables = useMemo(
    () => floorTables.filter((row) => {
      const status = String(row.status || '').toUpperCase();
      return status === 'AVAILABLE' || (Boolean(reservationAssignedTableId) && row.id === reservationAssignedTableId);
    }),
    [floorTables, reservationAssignedTableId],
  );

  const suggestedReservationTables = useMemo(() => {
    const partySize = Math.max(1, Number(reservationPartySize || 1));
    return [...reservationCandidateTables]
      .filter((row) => Number(row.capacity || 0) >= partySize)
      .sort((a, b) => {
        const gapA = Math.abs(Number(a.capacity || 0) - partySize);
        const gapB = Math.abs(Number(b.capacity || 0) - partySize);
        if (gapA !== gapB) return gapA - gapB;
        return String(a.label || '').localeCompare(String(b.label || ''));
      })
      .slice(0, 3);
  }, [reservationCandidateTables, reservationPartySize]);

  const mergedGroups = useMemo(() => {
    const groups = new Map<string, FloorTableState[]>();
    floorTables.forEach((table) => {
      const mergedGroupId = String((table as any).merged_group_id || '').trim();
      if (!mergedGroupId) return;
      groups.set(mergedGroupId, [...(groups.get(mergedGroupId) || []), table]);
    });
    return Array.from(groups.entries()).map(([id, tablesInGroup]) => ({ id, tables: tablesInGroup }));
  }, [floorTables]);

  const selectedFloorTable = useMemo(
    () => floorTables.find((row) => row.id === selectedFloorTableId) || null,
    [floorTables, selectedFloorTableId],
  );

  const selectedFloorGroup = useMemo(() => {
    const mergedGroupId = String(selectedFloorGroupId || (selectedFloorTable as any)?.merged_group_id || '').trim();
    if (!mergedGroupId) return null;
    return mergedGroups.find((group) => group.id === mergedGroupId) || null;
  }, [mergedGroups, selectedFloorGroupId, selectedFloorTable]);

  const selectedFloorTables = useMemo(
    () => floorTables.filter((row) => selectedFloorTableIds.includes(row.id)),
    [floorTables, selectedFloorTableIds],
  );

  const reservationTimeline = useMemo(() => {
    const hourStart = 8;
    const hourEnd = 24;
    const minuteHeight = reservationZoom === 15 ? 1.25 : 0.8;
    const laneDefinitions = [
      { id: '', label: tx(lang, 'Təyin edilməyib', 'Не назначено', 'Unassigned') },
      ...[...floorTables]
        .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')))
        .map((table) => ({ id: table.id, label: table.label })),
    ];
    const laneWidth = 220;
    const entries = [...reservations]
      .sort((a, b) => a.reservation_at.localeCompare(b.reservation_at))
      .map((reservation) => {
      const startAt = new Date(reservation.reservation_at);
      const startMinutes = startAt.getHours() * 60 + startAt.getMinutes();
      const duration = Math.max(30, Number(reservationDurationDrafts[reservation.id] ?? (reservation.duration_minutes || 90)));
      const lane = Math.max(0, laneDefinitions.findIndex((laneRow) => laneRow.id === String(reservation.assigned_table_id || '')));
      return {
        reservation,
        lane,
        startMinutes,
        duration,
        top: Math.max(0, startMinutes - hourStart * 60) * minuteHeight,
        height: Math.max(62, duration * minuteHeight),
      };
    });
    return {
      hourStart,
      hourEnd,
      minuteHeight,
      lanes: laneDefinitions,
      laneWidth,
      entries,
      totalHeight: (hourEnd - hourStart) * 60 * minuteHeight,
      totalWidth: laneDefinitions.length * laneWidth,
    };
  }, [reservations, floorTables, lang, reservationDurationDrafts, reservationZoom]);

  const mergedGroupOutlines = useMemo(() => {
    const maxCols = Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12);
    return mergedGroups.map((group) => {
      const minX = Math.min(...group.tables.map((table) => Number(table.x || 0)));
      const minY = Math.min(...group.tables.map((table) => Number(table.y || 0)));
      const maxX = Math.max(...group.tables.map((table) => Number(table.x || 0) + Number(table.w || 1)));
      const maxY = Math.max(...group.tables.map((table) => Number(table.y || 0) + Number(table.h || 1)));
      return {
        id: group.id,
        label: group.tables.map((table) => table.label).join(' + '),
        left: `${(minX / maxCols) * 100}%`,
        width: `${((maxX - minX) / maxCols) * 100}%`,
        top: `${minY * 70}px`,
        height: `${(maxY - minY) * 70}px`,
      };
    });
  }, [mergedGroups, floorPlans, activeFloorId]);

  const tableGridMinWidth = useMemo(() => {
    const base = 160;
    return Math.max(145, Math.min(220, Math.round((base * tableGridScale) / 100)));
  }, [tableGridScale]);

  const tablesById = useMemo(
    () => Object.fromEntries(tables.map((row) => [String(row.id), row])),
    [tables],
  );

  const readyCountsByLabel = useMemo(() => {
    const counts: Record<string, number> = {};
    kitchenOrders.forEach((row: any) => {
      if (String(row.status || '').toUpperCase() !== 'READY') return;
      const label = String(row.table_label || '').trim();
      if (!label) return;
      const qty = Array.isArray(row.items)
        ? row.items.filter((item: any) => String(item.action || '').toUpperCase() !== 'CANCEL').length
        : 0;
      counts[label] = Number(counts[label] || 0) + qty;
    });
    return counts;
  }, [kitchenOrders]);

  useEffect(() => {
    void loadData();
  }, [tenant_id]);

  useEffect(() => {
    void loadRestaurantData();
  }, [tenant_id, reservationDate]);

  useEffect(() => {
    if (!activeFloorId && floorPlans.length > 0) {
      setActiveFloorId(floorPlans.find((row) => row.is_active)?.id || floorPlans[0].id);
    }
  }, [floorPlans, activeFloorId]);

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
    if (!activeFloorId) return;
    void loadFloorState(activeFloorId);
  }, [activeFloorId]);

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
      await loadData();
      if (detail.table_id) setViewTableId(detail.table_id);
    };
    window.addEventListener('table-order-sent', handleTableOrderSent as EventListener);
    return () => {
      window.removeEventListener('table-order-sent', handleTableOrderSent as EventListener);
    };
  }, [tenant_id]);

  useEffect(() => {
    clearRoundComposer();
  }, [viewTableId]);

  useEffect(() => {
    if (viewTableId) setTableWorkspaceTab('compose');
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
    const unsubscribe = subscribeTenantRealtime(tenant_id, (message) => {
      const event = String(message.event || '');
      if (!['floor.updated', 'reservation.updated', 'table.updated', 'check.updated', 'kitchen.updated'].includes(event)) return;
      void loadData();
      if (workspaceView === 'reservations' || event === 'reservation.updated') {
        void loadRestaurantData();
      }
      if (activeFloorId) {
        void loadFloorState(activeFloorId);
      }
      if (viewTableId) {
        void get_table_detail_live(tenant_id, viewTableId)
          .then((next) => setTableDetailRecord(next))
          .catch(() => {});
      }
    });
    return unsubscribe;
  }, [tenant_id, workspaceView, activeFloorId, viewTableId]);

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
          await loadRestaurantData();
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

  const loadData = async () => {
    const [nextTables, nextKitchenOrders, nextMenu] = await Promise.all([
      get_tables_live(tenant_id),
      get_kitchen_orders_live(tenant_id),
      get_menu_items_live(tenant_id).catch(() => []),
    ]);
    setTables(nextTables);
    setKitchenOrders(Array.isArray(nextKitchenOrders) ? nextKitchenOrders : []);
    setMenuCatalog(Array.isArray(nextMenu) ? nextMenu : []);
  };

  const loadRestaurantData = async () => {
    const [nextFloors, nextReservations] = await Promise.all([
      get_floor_plans_live(tenant_id).catch(() => []),
      get_reservations_live(tenant_id, reservationDate).catch(() => []),
    ]);
    setFloorPlans(Array.isArray(nextFloors) ? nextFloors : []);
    setReservations(Array.isArray(nextReservations) ? nextReservations : []);
  };

  const loadFloorState = async (floorId: string) => {
    const state = await get_floor_state_live(tenant_id, floorId).catch(() => null);
    if (!state) return;
    setFloorTables(Array.isArray(state.tables) ? state.tables : []);
  };

  const persistFloorLayout = async (tableId: string, payload: any) => {
    await update_table_layout_live(tableId, payload);
    await Promise.all([loadFloorState(activeFloorId), loadData()]);
  };

  const addMenuItemToRound = (item: any) => {
    setRoundDraft((prev) => {
      const existing = prev.find((row: any) => String(row.id) === String(item.id));
      if (existing) {
        return prev.map((row: any) => String(row.id) === String(item.id) ? { ...row, qty: Number(row.qty || 0) + 1 } : row);
      }
      return [
        ...prev,
        {
          id: item.id,
          item_name: item.item_name,
          price: String(item.price),
          category: item.category,
          is_coffee: Boolean(item.is_coffee),
          qty: 1,
        },
      ];
    });
  };

  const updateRoundDraftQty = (itemId: string, nextQty: number) => {
    setRoundDraft((prev) => (
      nextQty <= 0
        ? prev.filter((row: any) => String(row.id) !== String(itemId))
        : prev.map((row: any) => String(row.id) === String(itemId) ? { ...row, qty: nextQty } : row)
    ));
  };

  const clearRoundComposer = () => {
    setRoundDraft([]);
    setRoundSearch('');
    setRoundCategory('ALL');
  };

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
    if (!table?.id || roundDraft.length === 0) return;
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
    clearRoundComposer();
    await Promise.all([loadData(), get_table_detail_live(tenant_id, table.id).then((next) => setTableDetailRecord(next)).catch(() => {})]);
  };

  const handleAddTable = async () => {
    const label = newTableName.trim();
    if (!label) return;
    try {
      await create_table_live(tenant_id, label, user?.username || 'Staff');
      notify('success', tx(lang, 'Masa yaradıldı', 'Стол создан', 'Table created'));
      await loadData();
      setShowCreate(false);
      setNewTableName('');
    } catch(e:any) { notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message); }
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
      await loadData();
      setViewTableId(currentTableId);
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message);
    }
  };

  const handleSelectWaiterTable = useCallback((table: any) => {
    const status = String(table?.status || '').toUpperCase();
    const localTable = tablesById[String(table?.id || '')];
    const tableLockHolder = String((table as any)?.locked_by || localTable?.assigned_to || '').trim();
    const isManagerUser = ['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase());
    const lockedByAnother = Boolean(localTable?.is_occupied && tableLockHolder && tableLockHolder !== user?.username && !isManagerUser);

    if (status === 'DIRTY') return;
    if (status === 'RESERVED' && !localTable?.is_occupied) {
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
    if (localTable?.is_occupied) {
      setViewTableId(localTable.id);
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

  const handleDeleteTable = async (id: string) => {
    try {
      await delete_table_live(id, user?.username || 'Staff');
      notify('success', tx(lang, 'Masa silindi', 'Стол удален', 'Table deleted'));
      setDeleteTableId(null);
      await loadData();
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
      await loadRestaurantData();
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
    try {
      await combine_tables_live(sourceTableId, targetTableId);
      notify('success', tx(lang, 'Masalar birləşdirildi', 'Столы объединены', 'Tables combined'));
      setMergeTargetId('');
      await Promise.all([activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve(), loadData()]);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Masalar birləşdirilmədi', 'Столы не объединены', 'Tables were not combined'));
    }
  };

  const handleSplitTables = async (tableId: string, mergedGroupId?: string | null) => {
    try {
      await split_table_group_live(tableId, mergedGroupId || null);
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

  const buildEqualSplitParts = (count: number, total: Decimal) => {
    if (count <= 0) return [];
    const safeTotal = total.toDecimalPlaces(2);
    const base = safeTotal.div(count).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    let remainder = safeTotal.minus(base.times(count)).toDecimalPlaces(2);
    return Array.from({ length: count }, (_, idx) => {
      const extra = remainder.greaterThan(0) ? new Decimal('0.01') : new Decimal(0);
      remainder = Decimal.max(new Decimal(0), remainder.minus(extra));
      return {
        amount: base.plus(extra).toFixed(2),
        method: idx === 0 ? 'Nəğd' : 'Kart',
      } as { amount: string; method: 'Nəğd' | 'Kart' };
    });
  };

  const getMaxSplitCount = (table: any) => Math.max(2, Number(table?.guest_count || 2));

  const normalizeSplitCount = (table: any, requested?: number | string) => {
    const maxAllowed = getMaxSplitCount(table);
    const parsed = Number(requested || splitCount || 2);
    return Math.min(maxAllowed, Math.max(2, Number.isFinite(parsed) ? parsed : 2));
  };

  const rebalanceSplitParts = (
    baseParts: Array<{ amount: string; method: 'Nəğd' | 'Kart' }>,
    total: Decimal,
    editedIndex: number,
    editedAmountRaw: string,
  ) => {
    const parts = baseParts.map((row) => ({ ...row }));
    const safeTotal = total.toDecimalPlaces(2);
    const editedAmount = Decimal.max(new Decimal(0), new Decimal(editedAmountRaw || 0)).toDecimalPlaces(2);
    parts[editedIndex] = { ...parts[editedIndex], amount: editedAmount.toFixed(2) };
    const lockedTotal = parts
      .slice(0, editedIndex + 1)
      .reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0))
      .toDecimalPlaces(2);
    const tailCount = Math.max(0, parts.length - editedIndex - 1);
    const remaining = Decimal.max(new Decimal(0), safeTotal.minus(lockedTotal)).toDecimalPlaces(2);
    if (tailCount === 0) return parts;
    const redistributed = buildEqualSplitParts(tailCount, remaining);
    redistributed.forEach((row, idx) => {
      parts[editedIndex + 1 + idx] = { ...parts[editedIndex + 1 + idx], amount: row.amount };
    });
    return parts;
  };

  const getTableBillBreakdown = (table: any) => {
    const payItems = Array.isArray(table?.items) ? table.items : [];
    const itemsTotal = payItems.reduce((acc: Decimal, row: any) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0));
    const serviceFee = itemsTotal.times(serviceFeePercent).div(100).toDecimalPlaces(2);
    const deposit = new Decimal(table?.deposit_amount || 0);
    const finalTotal = Decimal.max(itemsTotal.plus(serviceFee), deposit).toDecimalPlaces(2);
    const dueNow = Decimal.max(new Decimal(0), finalTotal.minus(deposit)).toDecimalPlaces(2);
    const splitBasis = dueNow.greaterThan(0) ? dueNow : finalTotal;
    const guestCount = Math.max(1, Number(table?.guest_count || 1));
    const depositPerGuestShare = guestCount > 0 ? deposit.div(guestCount).toDecimalPlaces(2) : new Decimal(0);
    return { itemsTotal, serviceFee, deposit, finalTotal, dueNow, splitBasis, guestCount, depositPerGuestShare };
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
    if (printSettings.use_qz && tableReceiptHtml) {
      try {
        await qzPrintHtml(tableReceiptHtml, printSettings.printer_name);
        notify('success', tx(lang, 'QZ Tray ilə çap göndərildi', 'Печать отправлена через QZ Tray', 'Print job sent via QZ Tray'));
        return;
      } catch (e: any) {
        notify('error', tx(lang, `QZ çap alınmadı, brauzerə keçilir: ${e.message || e}`, `QZ печать не удалась, переход к печати браузера: ${e.message || e}`, `QZ printing failed, falling back to browser printing: ${e.message || e}`));
      }
    }
    const frame = receiptRef.current;
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
          setShowDeleteAuth(true);
        }}
      />

      {showDeleteAuth && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Admin Təsdiqi', 'Подтверждение админа', 'Admin Confirmation')}</h3>
            <p className="mt-2 text-sm text-slate-300">{tx(lang, 'Masa silmək üçün admin şifrəsini daxil edin', 'Введите пароль администратора для удаления стола')}</p>
            <input
              type="password"
              className="neon-input mt-3"
              value={deleteAdminPass}
              onChange={(e) => setDeleteAdminPass(e.target.value)}
              placeholder={tx(lang, 'Admin şifrəsi', 'Пароль администратора')}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="neon-btn rounded-lg px-4 py-2"
                onClick={() => {
                  setShowDeleteAuth(false);
                  setDeleteAdminPass('');
                }}
              >
                {tx(lang, 'Ləğv et', 'Отмена')}
              </button>
              <button
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={() => {
                  const users = getDB<any>('users');
                  const admin = users.find((u) => String(u.role || '').toLowerCase() === 'admin');
                  const valid = Boolean(admin && String(admin.password || '') === deleteAdminPass);
                  if (!valid) {
                    notify('error', tx(lang, 'Admin şifrəsi yanlışdır', 'Неверный пароль администратора'));
                    return;
                  }
                  if (deleteTableId) void handleDeleteTable(deleteTableId);
                  setShowDeleteAuth(false);
                  setDeleteAdminPass('');
                }}
              >
                {tx(lang, 'Silməni Təsdiqlə', 'Подтвердить удаление')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Yeni masa yarat', 'Создать новый стол')}</h3>
            <input
              className="neon-input mt-3"
              placeholder={tx(lang, 'Masa adı (Məs: Masa 5)', 'Название стола (напр.: Стол 5)')}
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="neon-btn rounded-lg px-4 py-2" onClick={() => setShowCreate(false)}>{tx(lang, 'Ləğv et', 'Отмена')}</button>
              <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={() => { void handleAddTable(); }}>{tx(lang, 'Yarat', 'Создать')}</button>
            </div>
          </div>
        </div>
      )}

      {revisionTarget && (
        <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Manager/Admin Təsdiqi', 'Подтверждение manager/admin', 'Manager/Admin Override')}</h3>
            <p className="mt-2 text-sm text-slate-300">
              {tx(lang, `"${revisionTarget.itemName}" mətbəxə göndərilib. Dəyişiklik üçün manager/admin şifrəsi və səbəb lazımdır.`, `"${revisionTarget.itemName}" уже отправлен на кухню. Для изменения нужны пароль manager/admin и причина.`, `"${revisionTarget.itemName}" was already sent to the kitchen. Manager/admin password and reason are required to change it.`)}
            </p>
            <input
              className="neon-input mt-3"
              value={revisionReason}
              onChange={(e) => setRevisionReason(e.target.value)}
              placeholder={tx(lang, 'Səbəb', 'Причина', 'Reason')}
            />
            <input
              type="password"
              className="neon-input mt-3"
              value={revisionOverridePassword}
              onChange={(e) => setRevisionOverridePassword(e.target.value)}
              placeholder={tx(lang, 'Manager/Admin şifrəsi', 'Пароль manager/admin', 'Manager/Admin password')}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="neon-btn rounded-lg px-4 py-2"
                onClick={() => {
                  setRevisionTarget(null);
                  setRevisionReason('');
                  setRevisionOverridePassword('');
                }}
              >
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
              <button
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={async () => {
                  if (!revisionTarget) return;
                  try {
                    await revise_table_items_live(revisionTarget.tableId, {
                      items: revisionTarget.nextItems,
                      reason: revisionReason,
                      override_password: revisionOverridePassword,
                      actor: user?.username || 'staff',
                    });
                    notify('success', tx(lang, 'Düzəliş mətbəx reviziyası ilə yazıldı', 'Изменение записано как ревизия кухни', 'Change was written as a kitchen revision'));
                    setRevisionTarget(null);
                    setRevisionReason('');
                    setRevisionOverridePassword('');
                    await loadData();
                  } catch (e: any) {
                    notify('error', e?.message || tx(lang, 'Düzəliş alınmadı', 'Изменение не выполнено', 'Revision failed'));
                  }
                }}
              >
                {tx(lang, 'Təsdiqlə', 'Подтвердить', 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {payTableId && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
          <div className="metal-panel w-full max-w-md rounded-t-[28px] p-5 md:rounded-2xl">
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600 md:hidden" />
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Open check hesabını bağla', 'Закрыть открытый чек', 'Close open check')}</h3>
            <div className="mt-3 text-sm text-slate-300">
              {(() => {
                const t = tables.find((x) => x.id === payTableId);
                if (!t) return '-';
                const { finalTotal, dueNow } = getTableBillBreakdown(t);
                return `${t.label} - ${finalTotal.toFixed(2)} ₼ (${tx(lang, 'əlavə ödəniş', 'доплата', 'extra due')}: ${dueNow.toFixed(2)} ₼)`;
              })()}
            </div>
              {(() => {
                const t = tables.find((x) => x.id === payTableId);
                if (!t) return null;
                const { itemsTotal, serviceFee, deposit, finalTotal, dueNow } = getTableBillBreakdown(t);
                return (
                <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-300">
                  <div className="flex justify-between"><span>{tx(lang, 'Sifariş cəmi', 'Сумма заказа', 'Items total')}</span><span>{itemsTotal.toFixed(2)} ₼</span></div>
                  <div className="mt-1 flex justify-between"><span>{tx(lang, 'Servis haqqı', 'Сервисный сбор', 'Service fee')}</span><span>{serviceFee.toFixed(2)} ₼</span></div>
                  <div className="mt-1 flex justify-between"><span>{tx(lang, 'Depozit', 'Депозит', 'Deposit')}</span><span>{deposit.toFixed(2)} ₼</span></div>
                  <div className="mt-1 flex justify-between font-semibold text-slate-100"><span>{tx(lang, 'Yekun hesab', 'Итоговый счет', 'Final bill')}</span><span>{finalTotal.toFixed(2)} ₼</span></div>
                  <div className="mt-1 flex justify-between text-emerald-200"><span>{tx(lang, 'Hazırda alınacaq', 'К оплате сейчас', 'Due now')}</span><span>{dueNow.toFixed(2)} ₼</span></div>
                </div>
              );
            })()}
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                {tx(lang, 'Ödəniş ssenarisi', 'Сценарий оплаты', 'Payment scenario')}
              </div>
            <div className="grid grid-cols-3 gap-2">
              {(['Nəğd', 'Kart', 'Split'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setPaymentMethod(m);
                    if (m === 'Split') {
                      const table = tables.find((x) => x.id === payTableId);
                      if (table) {
                        const { splitBasis } = getTableBillBreakdown(table);
                        const count = normalizeSplitCount(table, splitCount);
                        setSplitCount(String(count));
                        setSplitParts(buildEqualSplitParts(count, splitBasis));
                      }
                    }
                  }}
                  className={`pay-btn h-11 ${paymentMethod === m ? 'pay-btn-active' : ''}`}
                >
                  {m === 'Nəğd'
                    ? tx(lang, 'Tam nəğd', 'Полностью наличными', 'All cash')
                    : m === 'Kart'
                      ? tx(lang, 'Tam kart', 'Полностью картой', 'All card')
                      : tx(lang, 'Split ödə', 'Split оплата', 'Split payment')}
                </button>
              ))}
            </div>
            </div>
            {paymentMethod === 'Split' && (
              (() => {
                const table = tables.find((x) => x.id === payTableId);
                if (!table) return null;
                const { serviceFee, deposit, dueNow, splitBasis, guestCount, depositPerGuestShare } = getTableBillBreakdown(table);
                const participantCount = normalizeSplitCount(table, splitCount);
                const partsTotal = splitParts.reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0)).toDecimalPlaces(2);
                const diff = splitBasis.minus(partsTotal).toDecimalPlaces(2);
                return (
                  <div className="mt-3 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
                    <div className="mb-3 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">
                      <div className="flex justify-between gap-3">
                        <span>{tx(lang, 'Qonaq sayı', 'Количество гостей', 'Guest count')}</span>
                        <span>{guestCount}</span>
                      </div>
                      <div className="mt-1 flex justify-between gap-3">
                        <span>{tx(lang, 'Depozit (cəmi)', 'Депозит (итого)', 'Deposit total')}</span>
                        <span>{deposit.toFixed(2)} ₼</span>
                      </div>
                      <div className="mt-1 flex justify-between gap-3">
                        <span>{tx(lang, '1 qonaq üçün depozit payı', 'Доля депозита на 1 гостя', 'Deposit share per guest')}</span>
                        <span>{depositPerGuestShare.toFixed(2)} ₼</span>
                      </div>
                      <div className="mt-1 flex justify-between gap-3">
                        <span>{tx(lang, 'Servis haqqı', 'Сервисный сбор', 'Service fee')}</span>
                        <span>{serviceFee.toFixed(2)} ₼</span>
                      </div>
                    </div>
                    <label className="block text-sm text-slate-300">
                      {tx(lang, 'Check neçə hissəyə bölünsün?', 'На сколько частей разделить чек?', 'How many parts should the check be split into?')}
                      <input
                        className="neon-input mt-2"
                        type="number"
                        min={2}
                        max={getMaxSplitCount(table)}
                        value={splitCount}
                        onChange={(e) => {
                          const nextCount = normalizeSplitCount(table, e.target.value);
                          setSplitCount(String(nextCount));
                          setSplitParts(buildEqualSplitParts(nextCount, splitBasis));
                        }}
                      />
                    </label>
                    <div className="mt-2 text-xs text-slate-400">
                      {tx(lang, 'Split hissələrinin sayı masa qonaq sayından çox ola bilməz. Hər hissə ayrıca ödəyən qrup kimi işləyir.', 'Количество частей split не может превышать число гостей за столом. Каждая часть считается отдельной оплачивающей группой.', 'Split parts cannot exceed guest count. Each part acts like a separate paying group.')}
                    </div>
                    <div className="mt-3 space-y-2">
                      {(splitParts.length === participantCount ? splitParts : buildEqualSplitParts(participantCount, splitBasis)).map((part, idx) => (
                        <div key={`split_part_${idx}`} className="grid grid-cols-[1fr_120px] gap-2">
                          <input
                            className="neon-input"
                            type="number"
                            min={0}
                            step="0.01"
                            value={part.amount}
                            onChange={(e) => {
                              const next = (splitParts.length === participantCount ? [...splitParts] : buildEqualSplitParts(participantCount, splitBasis));
                              setSplitParts(rebalanceSplitParts(next, splitBasis, idx, e.target.value));
                            }}
                            placeholder={`${tx(lang, 'Hissə', 'Часть', 'Part')} ${idx + 1}`}
                          />
                          <select
                            className="neon-input"
                            value={part.method}
                            onChange={(e) => {
                              const next = (splitParts.length === participantCount ? [...splitParts] : buildEqualSplitParts(participantCount, splitBasis));
                              next[idx] = { ...next[idx], method: e.target.value as 'Nəğd' | 'Kart' };
                              setSplitParts(next);
                            }}
                          >
                            <option value="Nəğd">{tx(lang, 'Nəğd', 'Наличные', 'Cash')}</option>
                            <option value="Kart">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
                          </select>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                      <span>{tx(lang, 'Bölünəcək check məbləği', 'Сумма чека к разделению', 'Check amount to split')}: {splitBasis.toFixed(2)} ₼</span>
                      <span className={diff.abs().greaterThan(0.01) ? 'text-rose-300' : 'text-emerald-300'}>
                        {tx(lang, 'Fərq', 'Разница', 'Diff')}: {diff.toFixed(2)} ₼
                      </span>
                    </div>
                  </div>
                );
              })()
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="neon-btn rounded-lg px-4 py-2" onClick={() => {
                setPayTableId(null);
                setPaymentMethod('Nəğd');
                setSplitCount('2');
                setSplitParts([]);
                setSplitCash('0');
              }}>{tx(lang, 'Ləğv et', 'Отмена')}</button>
              <button
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={async () => {
                  try {
                    const table = tables.find((x) => x.id === payTableId);
                    if (!table) return;
                    const itemsSnapshot = Array.isArray(table.items) ? [...table.items] : [];
                    const { itemsTotal, serviceFee, deposit, finalTotal, dueNow, splitBasis, guestCount } = getTableBillBreakdown(table);
                    let cash: Decimal | null = null;
                    let card: Decimal | null = null;
                    if (paymentMethod === 'Split') {
                      const participantCount = normalizeSplitCount(table, splitCount);
                      const normalized = (splitParts.length === participantCount ? splitParts : buildEqualSplitParts(participantCount, splitBasis));
                      const cashTotal = normalized
                        .filter((row) => row.method === 'Nəğd')
                        .reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0))
                        .toDecimalPlaces(2);
                      const cardTotal = normalized
                        .filter((row) => row.method === 'Kart')
                        .reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0))
                        .toDecimalPlaces(2);
                      if (cashTotal.lessThan(0) || cardTotal.lessThan(0) || cashTotal.plus(cardTotal).minus(splitBasis).abs().greaterThan(0.01)) {
                        notify('error', tx(lang, 'Split hissələri bölünəcək məbləğə bərabər olmalıdır', 'Сумма частей split должна совпадать с разделяемой суммой', 'Split parts must match the split amount'));
                        return;
                      }
                      cash = dueNow.greaterThan(0)
                        ? normalized.filter((row) => row.method === 'Nəğd').reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0)).toDecimalPlaces(2)
                        : new Decimal(0);
                      card = dueNow.greaterThan(0)
                        ? normalized.filter((row) => row.method === 'Kart').reduce((acc, row) => acc.plus(new Decimal(row.amount || 0)), new Decimal(0)).toDecimalPlaces(2)
                        : new Decimal(0);
                    }
                    const result = await settle_table_check_live(table.id, {
                      payment_method: paymentMethod,
                      split_cash: cash,
                      split_card: card,
                      parts: paymentMethod === 'Split'
                        ? (
                            splitParts.length === normalizeSplitCount(table, splitCount)
                              ? splitParts
                              : buildEqualSplitParts(normalizeSplitCount(table, splitCount), splitBasis)
                          )
                        : undefined,
                    });
                    window.dispatchEvent(new CustomEvent('table-paid', { detail: { tenant_id, table_id: table.id } }));
                    const sales = getDB<any>('sales');
                    const paidSale = sales.find((s) => s.id === result.sale_id);
                    const receiptCustomerId = String(paidSale?.customer_card_id || '').trim();
                    const receiptStarsAfter = Number(paidSale?.customer_stars_after ?? 0);
                    const receiptFreeCoffees = Number(paidSale?.free_coffees_applied ?? 0);
                    const itemsHtml = itemsSnapshot
                      .map((it: any) => {
                        const line = new Decimal(it.price || 0).times(it.qty || 0);
                        return `<tr><td style="padding:4px 0">${it.qty}x ${it.item_name}</td><td style="text-align:right">${line.toFixed(2)} ₼</td></tr>`;
                      })
                      .join('');

                    const receiptServiceFee = new Decimal(result.service_fee_amount || serviceFee);
                    const receiptDeposit = new Decimal(result.deposit_amount || deposit);
                    const receiptExtraDue = new Decimal(result.extra_due || dueNow);
                    const receiptFinalTotal = new Decimal(result.final_total || finalTotal);

                    const breakdown = paymentMethod === 'Split'
                      ? `<div style="display:flex;justify-content:space-between"><span>Nağd</span><span>${cash?.toFixed(2)} ₼</span></div>
                         <div style="display:flex;justify-content:space-between"><span>Kart</span><span>${card?.toFixed(2)} ₼</span></div>
                         <div style="margin-top:6px;font-size:11px;color:#555">Split hissələri</div>
                         ${(
                           splitParts.length === normalizeSplitCount(table, splitCount)
                             ? splitParts
                             : buildEqualSplitParts(normalizeSplitCount(table, splitCount), splitBasis)
                         ).map((part, idx) => `<div style="display:flex;justify-content:space-between"><span>Hissə ${idx + 1} · ${part.method}</span><span>${new Decimal(part.amount || 0).toFixed(2)} ₼</span></div>`).join('')}`
                      : `<div style="display:flex;justify-content:space-between"><span>Ödəniş</span><span>${paymentMethod}</span></div>`;

                    setTableReceiptHtml(`
                      <html>
                        <head>
                          <style>
                            @page { size: 80mm auto; margin: 4mm; }
                            body { font-family: 'Inter', Arial, sans-serif; font-size: 12px; color: #111; }
                            .line { display:flex; justify-content:space-between; gap:8px; margin: 2px 0; }
                            .muted { color:#555; font-size:11px; }
                            .bold { font-weight: 700; }
                            hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
                          </style>
                        </head>
                        <body style="font-family:Arial;padding:16px;max-width:320px;margin:0 auto;color:#111">
                          ${businessProfile?.logo_url ? `<img src="${businessProfile.logo_url}" style="height:34px;max-width:180px;object-fit:contain;margin-bottom:6px" />` : ''}
                          <h2 style="margin:0 0 4px;font-size:16px">${businessProfile?.company_name || 'IRONWAVES POS'}</h2>
                          <div class="muted">VÖEN: ${businessProfile?.voen || '-'}</div>
                          <div class="muted">Tel: ${businessProfile?.phone || '-'}</div>
                          <div class="muted">${businessProfile?.address || '-'}</div>
                          <hr />
                         <div class="line"><span>Masa</span><span class="bold">${table.label}</span></div>
                          <div class="line"><span>Qonaq sayı</span><span>${guestCount}</span></div>
                          <div class="line"><span>Satış ID</span><span>${formatDisplayId(result.sale_id)}</span></div>
                          <div class="line"><span>Operator</span><span>${user?.username || 'staff'}</span></div>
                          <div class="line"><span>Tarix</span><span>${new Date().toLocaleString()}</span></div>
                          <hr />
                          <table style="width:100%;font-size:14px">${itemsHtml}</table>
                          <hr style="margin:12px 0" />
                          ${breakdown}
                          ${receiptFreeCoffees > 0 ? `<div class="line"><span>Pulsuz kofe</span><span>${receiptFreeCoffees}</span></div>` : ''}
                          ${receiptCustomerId ? `<div class="line"><span>Müştəri ID</span><span>${receiptCustomerId}</span></div>` : ''}
                          ${receiptCustomerId ? `<div class="line"><span>Ulduz balansı</span><span>${receiptStarsAfter}</span></div>` : ''}
                          <div class="line"><span>Sifariş cəmi</span><span>${itemsTotal.toFixed(2)} ₼</span></div>
                          <div class="line"><span>Servis faizi</span><span>${serviceFeePercent.toFixed(2)}%</span></div>
                          <div class="line"><span>Servis haqqı</span><span>${receiptServiceFee.toFixed(2)} ₼</span></div>
                          <div class="line"><span>Depozit</span><span>${receiptDeposit.toFixed(2)} ₼</span></div>
                          ${Number(table.guest_count || 0) > 0 ? `<div class="line"><span>1 qonaq üçün depozit</span><span>${receiptDeposit.div(Math.max(1, Number(table.guest_count || 1))).toDecimalPlaces(2).toFixed(2)} ₼</span></div>` : ''}
                          <div class="line"><span>Əlavə ödəniş</span><span>${receiptExtraDue.toFixed(2)} ₼</span></div>
                          <div class="line bold" style="font-size:13px"><span>YEKUN</span><span>${receiptFinalTotal.toFixed(2)} ₼</span></div>
                          <hr />
                          <div class="muted">${businessProfile?.receipt_footer || 'Bizi seçdiyiniz üçün təşəkkür edirik!'}</div>
                        </body>
                      </html>
                    `);
                    notify('success', tx(lang, 'Masa hesabı bağlandı', 'Счет стола закрыт'));
                    window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { tenant_id, sale_id: result.sale_id, source: 'table' } }));
                    window.dispatchEvent(new CustomEvent('logs-updated', { detail: { tenant_id, sale_id: result.sale_id, source: 'table' } }));
                    clearServedStateForTable(table.id);
                    setPayTableId(null);
                    setViewTableId(null);
                    setTableDetailRecord(null);
                    setPaymentMethod('Nəğd');
                    setSplitCount('2');
                    setSplitParts([]);
                    setSplitCash('0');
                    await loadData();
                  } catch (e: any) {
                    notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
                  }
                }}
              >
                {tx(lang, 'Bağla', 'Закрыть')}
              </button>
            </div>
          </div>
        </div>
      )}

      {openTableId && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
          <div className="metal-panel w-full max-w-md rounded-t-[28px] p-5 md:rounded-2xl">
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600 md:hidden" />
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Masa Açılışı', 'Открытие стола', 'Open Table')}</h3>
            <p className="mt-2 text-sm text-slate-300">
              {tx(
                lang,
                'Masada neçə nəfər əyləşib və hansıları üçün depozit alındığını seçin.',
                'Выберите, сколько гостей сидит за столом и за кого взят депозит.',
                'Choose how many guests are seated and who has paid the deposit.',
              )}
            </p>
            <div className="mt-4">
              <label className="text-sm text-slate-300">
                {tx(lang, 'Qonaq sayı', 'Количество гостей', 'Guest count')}
                <input
                  className="neon-input mt-1"
                  type="number"
                  min={1}
                  max={20}
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3">
              <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Depozit qaydası', 'Правило депозита', 'Deposit rule')}</div>
              <div className="mt-2 text-xs text-slate-400">
                {tx(
                  lang,
                  'Masa bir açıq check kimi qalır. Sadəcə neçə qonaq üçün depozit alındığını yazın.',
                  'Стол остается одним открытым чеком. Просто укажите, за скольких гостей взят депозит.',
                  'The table stays as one open check. Just enter how many guests paid a deposit.',
                )}
              </div>
              <label className="mt-3 block text-sm text-slate-300">
                {tx(lang, 'Depozitli qonaq sayı', 'Количество гостей с депозитом', 'Deposited guest count')}
                <input
                  className="neon-input mt-1"
                  type="number"
                  min={0}
                  max={Math.max(1, Number(guestCount || 1))}
                  value={depositGuestCount}
                  onChange={(e) => setDepositGuestCount(String(Math.max(0, Math.min(Math.max(1, Number(guestCount || 1)), Number(e.target.value || 0)))))}
                />
              </label>
              <div className="mt-3 text-xs text-slate-400">
                {tx(lang, 'Nəfər başı depozit', 'Депозит с человека', 'Deposit per guest')}: {depositPerGuest.toFixed(2)} ₼
              </div>
              <div className="mt-1 text-sm font-semibold text-emerald-200">
                {tx(lang, 'Toplam depozit', 'Итоговый депозит', 'Total deposit')}: {depositPerGuest.times(Math.max(0, Number(depositGuestCount || 0))).toFixed(2)} ₼
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="neon-btn rounded-lg px-4 py-2"
                onClick={() => {
                  setOpenTableId(null);
                  setGuestCount('1');
                  setDepositGuestCount('0');
                }}
              >
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
              <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={() => { void handleOpenTable(); }}>
                {tx(lang, 'Masanı Aç', 'Открыть стол', 'Open Table')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReservationCreate && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
          <div className="metal-panel w-full max-w-xl rounded-t-[28px] p-5 md:rounded-2xl">
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600 md:hidden" />
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Yeni rezervasiya', 'Новая бронь', 'New reservation')}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setReservationStatusDraft('BOOKED')}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${reservationStatusDraft === 'BOOKED' ? 'bg-amber-300 text-slate-950' : 'border border-amber-300/30 bg-amber-500/10 text-amber-100'}`}
              >
                {tx(lang, 'Rezerv', 'Бронь', 'Booked')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReservationStatusDraft('WAITLIST');
                  setReservationAssignedTableId('');
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${reservationStatusDraft === 'WAITLIST' ? 'bg-violet-300 text-slate-950' : 'border border-violet-300/30 bg-violet-500/10 text-violet-100'}`}
              >
                {tx(lang, 'Gözləmə siyahısı', 'Лист ожидания', 'Waitlist')}
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-300">
                {tx(lang, 'Qonaq adı', 'Имя гостя', 'Guest name')}
                <input className="neon-input mt-1" value={reservationGuestName} onChange={(e) => setReservationGuestName(e.target.value)} />
              </label>
              <label className="text-sm text-slate-300">
                {tx(lang, 'Telefon', 'Телефон', 'Phone')}
                <input className="neon-input mt-1" value={reservationPhone} onChange={(e) => setReservationPhone(e.target.value)} />
              </label>
              <label className="text-sm text-slate-300">
                {tx(lang, 'Vaxt', 'Время', 'Time')}
                <input className="neon-input mt-1" type="time" value={reservationTime} onChange={(e) => setReservationTime(e.target.value)} />
              </label>
              <label className="text-sm text-slate-300">
                {tx(lang, 'Nəfər sayı', 'Количество гостей', 'Party size')}
                <input className="neon-input mt-1" type="number" min={1} max={20} value={reservationPartySize} onChange={(e) => setReservationPartySize(e.target.value)} />
              </label>
              <label className="text-sm text-slate-300">
                {tx(lang, 'Masa seçimi', 'Выбор стола', 'Table selection')}
                <select
                  className="neon-input mt-1"
                  value={reservationAssignedTableId}
                  onChange={(e) => setReservationAssignedTableId(e.target.value)}
                  disabled={reservationStatusDraft === 'WAITLIST'}
                >
                  <option value="">{tx(lang, 'Sonra təyin et', 'Назначить позже', 'Assign later')}</option>
                  {reservationCandidateTables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.label} · {tx(lang, 'Tutum', 'Вместимость', 'Capacity')} {table.capacity}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {reservationStatusDraft !== 'WAITLIST' && suggestedReservationTables.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">
                  {tx(lang, 'Təklif olunan masalar', 'Рекомендуемые столы', 'Suggested tables')}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestedReservationTables.map((table) => (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => setReservationAssignedTableId(table.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${reservationAssignedTableId === table.id ? 'border-cyan-200 bg-cyan-300 text-slate-950' : 'border-cyan-300/30 bg-cyan-500/10 text-cyan-100'}`}
                    >
                      {table.label} · {tx(lang, 'Tutum', 'Вместимость', 'Capacity')} {table.capacity}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="mt-3 block text-sm text-slate-300">
              {tx(lang, 'Qeyd', 'Примечание', 'Note')}
              <textarea className="neon-input mt-1 min-h-[88px]" value={reservationNote} onChange={(e) => setReservationNote(e.target.value)} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="neon-btn rounded-lg px-4 py-2"
                onClick={() => {
                  setShowReservationCreate(false);
                  setReservationAssignedTableId('');
                  setReservationStatusDraft('BOOKED');
                }}
              >
                {tx(lang, 'Bağla', 'Закрыть', 'Close')}
              </button>
              <button type="button" className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={() => { void handleCreateReservation(); }}>
                {tx(lang, 'Yarat', 'Создать', 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {itemActionTarget && (
        <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-lg p-5">
            {(() => {
              const actionStatus = String(itemActionTarget.item?.status || 'NEW').toUpperCase();
              const quickAction = actionStatus === 'NEW';
              return (
                <>
            <h3 className="text-lg font-bold text-slate-100">
              {tx(lang, 'Item əməliyyatı', 'Операция по позиции', 'Item action')} · {itemActionTarget.item?.item_name}
            </h3>
            <div className="mt-2 text-sm text-slate-300">
              {quickAction
                ? tx(lang, 'Bu item hələ hazırlanma mərhələsinə keçməyib. Sürətli düzəliş admin şifrəsiz işləyəcək.', 'Эта позиция еще не перешла в приготовление. Быстрое изменение пройдет без пароля админа.', 'This item has not moved into prep yet. Quick change will work without admin password.')
                : tx(lang, 'Seçilmiş action audit log-a yazılacaq və item izsiz silinməyəcək.', 'Выбранное действие попадет в аудит, позиция не исчезнет бесследно.', 'The selected action will be logged and the item will not disappear without trace.')}
            </div>
            <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-300">
              <div className="flex justify-between"><span>{tx(lang, 'Cari status', 'Текущий статус', 'Current status')}</span><span>{itemActionTarget.item?.status || '-'}</span></div>
              <div className="mt-1 flex justify-between"><span>{tx(lang, 'Action', 'Действие', 'Action')}</span><span>{itemActionTarget.action}</span></div>
            </div>
            {!quickAction && <label className="mt-4 block text-sm text-slate-300">
              {tx(lang, 'Səbəb', 'Причина', 'Reason')}
              <textarea className="neon-input mt-1 min-h-[84px]" value={itemActionReason} onChange={(e) => setItemActionReason(e.target.value)} />
            </label>}
            {!quickAction && ['COMP', 'WASTE', 'REMAKE'].includes(String(itemActionTarget.action || '').toUpperCase()) && (
              <label className="mt-3 block text-sm text-slate-300">
                {tx(lang, 'Manager/Admin şifrəsi', 'Пароль менеджера/админа', 'Manager/Admin password')}
                <input type="password" className="neon-input mt-1" value={itemActionManagerPassword} onChange={(e) => setItemActionManagerPassword(e.target.value)} />
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="neon-btn rounded-lg px-4 py-2"
                onClick={() => {
                  setItemActionTarget(null);
                  setItemActionReason('');
                  setItemActionManagerPassword('');
                }}
              >
                {tx(lang, 'Bağla', 'Закрыть', 'Close')}
              </button>
              <button
                type="button"
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={async () => {
                  try {
                    if (!quickAction && !itemActionReason.trim()) {
                      notify('error', tx(lang, 'Səbəb yazın', 'Укажите причину', 'Enter a reason'));
                      return;
                    }
                    const nextReason = quickAction ? tx(lang, 'Sürətli düzəliş', 'Быстрое изменение', 'Quick change') : itemActionReason.trim();
                    await act_on_order_item_live(itemActionTarget.item.id, {
                      action: itemActionTarget.action,
                      reason: nextReason,
                      manager_password: quickAction ? undefined : (itemActionManagerPassword.trim() || undefined),
                      remake_note: itemActionTarget.action === 'REMAKE' ? nextReason : undefined,
                    });
                    setItemActionTarget(null);
                    setItemActionReason('');
                    setItemActionManagerPassword('');
                    notify('success', tx(lang, 'Item statusu yeniləndi', 'Статус позиции обновлен', 'Item status updated'));
                    if (viewTableId) {
                      await Promise.all([loadData(), get_table_detail_live(tenant_id, viewTableId).then((next) => setTableDetailRecord(next)).catch(() => {})]);
                    }
                  } catch (e: any) {
                    notify('error', e?.message || tx(lang, 'Item əməliyyatı alınmadı', 'Операция по позиции не выполнена', 'Item action failed'));
                  }
                }}
              >
                {tx(lang, 'Təsdiqlə', 'Подтвердить', 'Confirm')}
              </button>
            </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {viewTableId && (
        <div
	          ref={detailPanelRef}
	          className={`${
	            workspaceView === 'floor'
	              ? 'fixed inset-y-3 right-3 z-[90] h-[calc(100vh-1.5rem)] w-[calc(100vw-1.5rem)] overflow-hidden rounded-[30px] border border-white/10 bg-slate-950/95 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur lg:w-[min(70vw,1240px)]'
	              : 'mt-6'
	          }`}
        >
          <div className={`metal-panel ${workspaceView === 'floor' ? 'flex h-full flex-col overflow-hidden rounded-[30px] p-4' : 'w-full rounded-[30px] p-5'}`}>
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
	                  <div className="flex items-center justify-between gap-3">
	                    <div className="flex min-w-0 items-center gap-3">
	                      <button
	                        type="button"
	                        onClick={() => setViewTableId(null)}
	                        className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-slate-700/70 bg-slate-900/50 px-3 py-1.5 text-xs font-semibold text-slate-200"
	                      >
	                        ← {tx(lang, 'Masalara qayıt', 'Назад к столам', 'Back to tables')}
	                      </button>
	                      <h3 className="truncate text-xl font-black text-slate-100">{t.label}</h3>
	                    </div>
	                    <div className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-bold text-emerald-100">
	                      {new Decimal(detailCheck?.total || t.total || 0).toFixed(2)} ₼
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
	                  <div className="mt-2 flex flex-wrap gap-2">
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
                              await Promise.all([loadData(), get_table_detail_live(tenant_id, t.id).then((next) => setTableDetailRecord(next)).catch(() => {})]);
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
                              await Promise.all([loadData(), get_table_detail_live(tenant_id, t.id).then((next) => setTableDetailRecord(next)).catch(() => {})]);
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
                  {isManagerUser && tableLockHolder && tableLockHolder !== user?.username && (
                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr]">
                      <input className="neon-input" value={lockTransferTarget} onChange={(e) => setLockTransferTarget(e.target.value)} placeholder={tx(lang, 'Yeni owner username', 'Новый владелец username', 'New owner username')} />
                      <input className="neon-input" value={lockReason} onChange={(e) => setLockReason(e.target.value)} placeholder={tx(lang, 'Override səbəbi', 'Причина override', 'Override reason')} />
                    </div>
                  )}
	                  <div className="mt-2 rounded-xl border border-slate-700/70 bg-slate-900/30 p-2">
	                    <div className="flex flex-wrap gap-2">
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
	                          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${tableWorkspaceTab === tabKey ? 'bg-yellow-400 text-slate-950' : 'border border-slate-700/70 bg-slate-950/35 text-slate-300'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
	                  </div>
	                  <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
                  {tableWorkspaceTab === 'history' && (
                  <div className="min-h-0 overflow-y-auto rounded-xl border border-slate-700/70 bg-slate-900/35 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Raund tarixçəsi', 'История раундов', 'Round history')}</div>
                        <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Mətbəxə göndərilən hər əlavə sifariş ayrıca raund kimi görünür.', 'Каждая дополнительная отправка на кухню показывается отдельным раундом.', 'Each additional send to kitchen appears as a separate round.')}</div>
                      </div>
                      <div className="rounded-full border border-slate-700/70 bg-slate-950/40 px-3 py-1 text-xs font-semibold text-slate-200">
                        {tx(lang, 'Növbəti raund', 'Следующий раунд', 'Next round')}: {rounds.length + 1}
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {rounds.length === 0 ? (
                        <div className="rounded-lg bg-slate-950/30 px-3 py-3 text-sm text-slate-400">{tx(lang, 'Hələ mətbəxə göndərilmiş raund yoxdur', 'Пока нет отправленных на кухню раундов', 'No rounds have been sent to the kitchen yet')}</div>
                      ) : (
                        rounds.map((round: any) => {
                          const badge = kitchenBadge(round.status);
                          return (
                            <div key={round.id} className="rounded-xl border border-slate-700/60 bg-slate-950/30 px-3 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold text-slate-100">
                                  {tx(lang, 'Raund', 'Раунд', 'Round')} {round.round_no}
                                </div>
                                <div className="flex items-center gap-2">
                                  {badge ? <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${badge.className}`}>{badge.label}</span> : null}
                                  <span className="text-[11px] text-slate-400">{new Date(round.created_at).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'az-AZ', { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {(Array.isArray(round.items) ? round.items : []).map((row: any, idx: number) => (
                                  <div key={`${round.id}_${idx}`} className="rounded-lg bg-black/20 px-3 py-2 text-xs text-slate-200">
                                    {row.qty}x {row.item_name}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  )}
		                  <div className={`order-2 mt-3 max-h-[14vh] min-h-[64px] flex-none overflow-y-auto overscroll-y-contain rounded-lg border border-slate-700/70 bg-slate-900/40 p-3 ${tableWorkspaceTab === 'compose' ? '' : 'hidden'}`}>
	                    {!userCanEditTable && (
	                      <div className="mb-3 rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
	                        {tx(lang, 'Bu masa read-only görünüşdədir. Yalnız owner və ya manager əməliyyat edə bilər.', 'Этот стол открыт только для просмотра. Операции доступны только владельцу или менеджеру.', 'This table is read-only. Only the owner or a manager can perform actions.')}
	                      </div>
	                    )}
	                    <div className="mb-2 flex items-center justify-between gap-2">
	                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">{tx(lang, 'Yığılmış sifarişlər', 'Собранные заказы', 'Current order')}</div>
	                      <button
	                        type="button"
	                        onClick={() => setShowFullOrderList(true)}
	                        className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-100"
	                      >
	                        {tx(lang, 'Tam siyahı', 'Полный список', 'Full list')}
	                      </button>
	                    </div>
	                    {(detailActiveItems.length === 0 && items.length === 0) && <div className="text-sm text-slate-400">{tx(lang, 'Masa boşdur', 'Стол пуст', 'Table is empty')}</div>}
	                    {(detailActiveItems.length > 0 ? detailActiveItems : items).map((it: any, idx: number) => (
                      <div key={`${it.item_name}_${idx}`} className="flex items-center justify-between gap-3 border-b border-slate-700/40 py-2 text-sm last:border-b-0">
                        <div>
                          <div>{it.item_name}</div>
                          <div className="mt-1 text-xs text-slate-500">x{it.qty}{it.status ? ` · ${it.status}` : ''}</div>
                          {it.status_reason ? <div className="mt-1 text-[11px] text-slate-500">{it.status_reason}</div> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            disabled={!userCanEditTable}
                            className="rounded-md border border-amber-300/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-100"
	                            onClick={async (e) => {
	                              e.stopPropagation();
	                              const hasLegacyMatch = items.some((row: any) => String(row.item_name || '').trim() === String(it.item_name || '').trim());
	                              if (it.id && detailActiveItems.length > 0 && !hasLegacyMatch) {
	                                setItemActionTarget({ item: it, action: 'VOID' });
	                                return;
	                              }
	                              const nextItems = buildRevisionNextItems(it.item_name, 1);
	                              setRevisionTarget({ tableId: t.id, itemName: it.item_name, nextItems });
	                            }}
                          >
	                            {tx(lang, 'Azalt', 'Уменьшить', 'Reduce')}
                          </button>
                          <button
                            disabled={!userCanEditTable}
                            className="rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-100"
	                            onClick={(e) => {
	                              e.stopPropagation();
	                              if (it.id && detailActiveItems.length > 0) {
	                                setItemActionTarget({ item: it, action: 'VOID' });
	                                return;
	                              }
	                              const nextItems = buildRevisionNextItems(it.item_name, null);
	                              setRevisionTarget({ tableId: t.id, itemName: it.item_name, nextItems });
	                            }}
                          >
                            {tx(lang, 'Sil', 'Убрать', 'Remove')}
                          </button>
                          {it.id && userCanEditTable && (
                            <>
	                              <button type="button" className="rounded-md border border-yellow-300/40 bg-yellow-500/10 px-2 py-1 text-xs font-semibold text-yellow-100" onClick={() => setItemActionTarget({ item: it, action: 'VOID' })}>{tx(lang, 'Ləğv et', 'Аннулировать', 'Void')}</button>
	                              <button type="button" className="rounded-md border border-sky-300/40 bg-sky-500/10 px-2 py-1 text-xs font-semibold text-sky-100" onClick={() => setItemActionTarget({ item: it, action: 'COMP' })}>{tx(lang, 'Hesabdan sil', 'Списать из счета', 'Comp')}</button>
	                              <button type="button" className="rounded-md border border-slate-300/30 bg-slate-500/15 px-2 py-1 text-xs font-semibold text-slate-100" onClick={() => setItemActionTarget({ item: it, action: 'WASTE' })}>{tx(lang, 'İsraf', 'Списание', 'Waste')}</button>
	                              <button type="button" className="rounded-md border border-orange-300/40 bg-orange-500/10 px-2 py-1 text-xs font-semibold text-orange-100" onClick={() => setItemActionTarget({ item: it, action: 'REMAKE' })}>{tx(lang, 'Yenidən hazırla', 'Переделать', 'Remake')}</button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
	                  </div>
	                  {tableWorkspaceTab === 'compose' && (
		                  <div className="order-1 flex min-h-0 flex-[1.2] flex-col overflow-hidden rounded-xl border border-slate-700/70 bg-slate-900/35 p-3 lg:p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
	                        <div className="text-lg font-black text-slate-100">{tx(lang, 'Yeni sifariş', 'Новый заказ', 'New order')}</div>
                      </div>
                      <div className="rounded-full border border-slate-700/70 bg-slate-950/40 px-3 py-1 text-xs font-semibold text-slate-200">
                        {tx(lang, 'Göndərilməmişlər', 'Неотправленные', 'Unsent items')}: {roundDraft.reduce((acc, row) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0)).toFixed(2)} ₼
                      </div>
                    </div>

	                    <div className="mt-3 grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.25fr_0.75fr]">
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
                        />
                      </div>

                      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700/70 bg-slate-950/30 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Göndərilməmişlər', 'Неотправленные', 'Unsent items')}</div>
                          {roundDraft.length > 0 ? (
                            <button type="button" onClick={clearRoundComposer} className="text-xs font-semibold text-slate-400 hover:text-slate-200">
                              {tx(lang, 'Təmizlə', 'Очистить', 'Clear')}
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1">
                          <div className="space-y-3 pb-3">
                          {roundDraft.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-700/60 px-4 py-6 text-center text-sm text-slate-400">
                              {tx(lang, 'Buradakı məhsullar bir toxunuşla mətbəxə gedəcək', 'Эти позиции одним нажатием уйдут на кухню', 'Items here will go to the kitchen in one tap')}
                            </div>
                          ) : (
                            roundDraft.map((row: any) => (
                              <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-100">{row.item_name}</div>
                                  <div className="text-xs text-slate-400">{Number(row.price || 0).toFixed(2)} ₼</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button type="button" className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-200" onClick={() => updateRoundDraftQty(String(row.id), Number(row.qty || 0) - 1)}>-</button>
                                  <div className="min-w-7 text-center text-sm font-semibold text-slate-100">{row.qty}</div>
                                  <button type="button" className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-200" onClick={() => updateRoundDraftQty(String(row.id), Number(row.qty || 0) + 1)}>+</button>
                                </div>
                              </div>
                            ))
                          )}
                          </div>
                        </div>
                        <StickyActionBar
                          lang={lang}
                          total={roundDraft.reduce((acc, row) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0)).toFixed(2)}
                          disabled={roundDraft.length === 0 || !userCanEditTable}
                          onClear={roundDraft.length > 0 ? clearRoundComposer : undefined}
                          onSend={() => { void sendRoundDirectly(t); }}
                        />
                      </div>
                    </div>
		                  </div>
	                  )}
	                  {showFullOrderList && (
	                    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4">
	                      <div className="metal-panel flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden p-5">
	                        <div className="flex items-center justify-between gap-3">
	                          <div>
	                            <div className="text-lg font-black text-slate-100">{tx(lang, 'Tam sifariş siyahısı', 'Полный список заказа', 'Full order list')}</div>
	                            <div className="mt-1 text-sm text-slate-400">{t.label}</div>
	                          </div>
	                          <button type="button" onClick={() => setShowFullOrderList(false)} className="neon-btn rounded-xl px-4 py-2 text-sm font-bold">
	                            {tx(lang, 'Bağla', 'Закрыть', 'Close')}
	                          </button>
	                        </div>
	                        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-y-contain rounded-2xl border border-slate-700/70 bg-slate-950/35 p-3">
	                          {(detailActiveItems.length > 0 ? detailActiveItems : items).length === 0 ? (
	                            <div className="py-8 text-center text-sm text-slate-400">{tx(lang, 'Sifariş yoxdur', 'Заказов нет', 'No order items')}</div>
	                          ) : (
	                            <div className="space-y-2">
	                              {(detailActiveItems.length > 0 ? detailActiveItems : items).map((row: any, idx: number) => (
	                                <div key={`full_${row.id || row.item_name}_${idx}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
	                                  <div className="min-w-0">
	                                    <div className="truncate font-bold text-slate-100">{row.item_name}</div>
	                                    <div className="mt-1 text-xs text-slate-400">x{row.qty}{row.status ? ` · ${row.status}` : ''}</div>
	                                  </div>
	                                  <div className="text-sm font-black text-slate-100">{new Decimal(row.price || 0).times(row.qty || 0).toFixed(2)} ₼</div>
	                                </div>
	                              ))}
	                            </div>
	                          )}
	                        </div>
	                      </div>
	                    </div>
	                  )}
                  {tableWorkspaceTab === 'service' && (
                  <div className="min-h-0 overflow-y-auto">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-4">
                    <div className="rounded-lg border border-blue-300/30 bg-blue-500/10 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-blue-200">{tx(lang, 'Mətbəxdə gözləyənlər', 'Ожидают на кухне', 'Waiting in kitchen')}</div>
                      <div className="space-y-2 text-sm text-slate-100">
                        {waitingItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Aktiv gözləyən item yoxdur', 'Нет ожидающих позиций', 'No waiting items')}</div> : waitingItems.map((row: any, idx: number) => (
                          <div key={`wait_${idx}`} className="rounded-md bg-black/15 px-3 py-2">{row.qty}x {row.item_name}</div>
                        ))}
                      </div>
                    </div>
                    <div className={`rounded-lg border p-3 ${readyItems.length > 0 ? 'border-emerald-200/60 bg-emerald-400/15 shadow-[0_0_26px_rgba(74,222,128,0.18)] ring-1 ring-emerald-300/30' : 'border-emerald-300/30 bg-emerald-500/10'}`}>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200">{tx(lang, 'Servisə hazır', 'Готово к подаче', 'Ready to serve')}</div>
                      <div className="space-y-2 text-sm text-slate-100">
                        {readyItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Servisə hazır item yoxdur', 'Нет готовых к подаче позиций', 'No ready-to-serve items')}</div> : readyItems.map((row: any, idx: number) => (
                          <div key={`ready_${idx}`} className="flex items-center justify-between gap-2 rounded-md bg-black/15 px-3 py-2">
                            <div>{row.qty}x {row.item_name}</div>
                            <button
                              type="button"
                              className="rounded-md border border-emerald-300/40 bg-emerald-400/15 px-2 py-1 text-[11px] font-semibold text-emerald-100"
                              onClick={() => markReadyItemServed(t.id, String(row.item_name || ''), Number(row.qty || 0))}
                            >
                              {tx(lang, 'Servis edildi', 'Подано', 'Served')}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-violet-300/30 bg-violet-500/10 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">{tx(lang, 'Servis edilənlər', 'Поданные позиции', 'Served items')}</div>
                      <div className="space-y-2 text-sm text-slate-100">
                        {servedItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Hələ servis edilən item yoxdur', 'Пока нет поданных позиций', 'No served items yet')}</div> : servedItems.map((row: any, idx: number) => (
                          <div key={`served_${idx}`} className="rounded-md bg-black/15 px-3 py-2">{row.qty}x {row.item_name}</div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-rose-300/30 bg-rose-500/10 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200">{tx(lang, 'Dəyişikliklər', 'Изменения', 'Revisions')}</div>
                      <div className="space-y-2 text-sm text-slate-100">
                        {revisionItems.length === 0 ? <div className="text-xs text-slate-400">{tx(lang, 'Düzəliş yoxdur', 'Нет изменений', 'No revisions')}</div> : revisionItems.map((row: any, idx: number) => (
                          <div key={`rev_${idx}`} className="rounded-md bg-black/15 px-3 py-2">{row.qty}x {row.item_name}{row.reason ? ` · ${row.reason}` : ''}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                  </div>
                  )}
                  {tableWorkspaceTab === 'ops' && t.is_occupied && (
                    <div className="min-h-0 overflow-y-auto">
                    <div className="grid gap-3 rounded-lg border border-slate-700/70 bg-slate-900/40 p-3">
                      <div className="grid gap-3 lg:grid-cols-3">
                        <div className="rounded-xl border border-blue-300/20 bg-blue-500/10 p-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-blue-200">{tx(lang, 'Masanı köçür', 'Перенести стол', 'Transfer table')}</div>
                          <div className="text-xs text-slate-300">{tx(lang, 'Açıq check-i başqa boş masaya keçir', 'Переносит открытый чек на другой свободный стол', 'Move the open check to another empty table')}</div>
                          <div className="mt-3 flex gap-2">
                            <select className="neon-input flex-1" value={transferTargetId} onChange={(e) => setTransferTargetId(e.target.value)}>
                              <option value="">{tx(lang, 'Boş masa seçin', 'Выберите свободный стол', 'Select empty table')}</option>
                              {otherTables.filter((row) => !row.is_occupied).map((row) => (
                                <option key={row.id} value={row.id}>{row.label}</option>
                              ))}
                            </select>
                            <button
                              className="rounded-lg border border-blue-300/40 bg-blue-500/15 px-3 py-2 text-sm font-semibold text-blue-100"
                              onClick={async () => {
                                if (!transferTargetId) return;
                                try {
                                  await transfer_table_live(t.id, transferTargetId, user?.username || 'staff');
                                  notify('success', tx(lang, 'Masa köçürüldü', 'Стол перенесен', 'Table transferred'));
                                  setTransferTargetId('');
                                  setViewTableId(null);
                                  await loadData();
                                } catch (e: any) {
                                  notify('error', e.message);
                                }
                              }}
                            >
                              {tx(lang, 'Köçür', 'Перенести', 'Transfer')}
                            </button>
                          </div>
                        </div>
                        <div className="rounded-xl border border-amber-300/20 bg-amber-500/10 p-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">{tx(lang, 'Masaları birləşdir', 'Объединить столы', 'Combine tables')}</div>
                          <div className="text-xs text-slate-300">{tx(lang, 'Yanaşı masaları bir check altında birləşdir', 'Объединяет соседние столы под одним чеком', 'Combine nearby tables under one check')}</div>
                          <div className="mt-3 flex gap-2">
                            <select className="neon-input flex-1" value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                              <option value="">{tx(lang, 'Hədəf masa seçin', 'Выберите целевой стол', 'Select target table')}</option>
                              {otherTables.map((row) => (
                                <option key={row.id} value={row.id}>{row.label}{row.is_occupied ? ` (${tx(lang, 'dolu', 'занят', 'occupied')})` : ''}</option>
                              ))}
                            </select>
                            <button
                              className="rounded-lg border border-amber-300/40 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-100"
                              onClick={() => { void handleCombineTables(t.id, mergeTargetId); }}
                            >
                              {tx(lang, 'Birləşdir', 'Объединить', 'Combine')}
                            </button>
                          </div>
                        </div>
                        <div className="rounded-xl border border-violet-300/20 bg-violet-500/10 p-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-violet-200">{tx(lang, 'Masanı ayır', 'Разделить столы', 'Split tables')}</div>
                          <div className="text-xs text-slate-300">{t.merged_group_id ? tx(lang, 'Bu birləşmiş qrupu yenidən ayrıca masalara ayırır', 'Разделяет объединенную группу обратно на отдельные столы', 'Split the merged group back into separate tables') : tx(lang, 'Masa hələ birləşdirilməyib', 'Стол еще не объединен', 'This table is not merged yet')}</div>
                          <button
                            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-violet-300/40 bg-violet-500/15 px-3 py-2 text-sm font-semibold text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!t.merged_group_id}
                            onClick={() => { void handleSplitTables(t.id, (t as any).merged_group_id || null); }}
                          >
                            {tx(lang, 'Ayır', 'Разделить', 'Split')}
                          </button>
                        </div>
                      </div>
                    </div>
                    </div>
                  )}
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="neon-btn rounded-lg px-4 py-2" onClick={() => setViewTableId(null)}>{tx(lang, 'Paneli gizlət', 'Скрыть панель', 'Hide panel')}</button>
                    {t.is_occupied && (
                      <button
                        className="glossy-gold min-h-12 rounded-xl px-5 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!userCanEditTable}
                        onClick={() => {
                          setPayTableId(t.id);
                          setViewTableId(null);
                          setPaymentMethod('Nəğd');
                          setSplitCount('2');
                          setSplitParts([]);
                          setSplitCash('0');
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

      {tableReceiptHtml && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100">{tx(lang, 'Masa Çeki Hazırdır', 'Чек стола готов')}</h3>
              <div className="flex gap-2">
                <button onClick={printTableReceiptOnly} className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-slate-900">{tx(lang, 'Çap Et', 'Печать')}</button>
                <button onClick={() => setTableReceiptHtml(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">{tx(lang, 'Bağla', 'Закрыть')}</button>
              </div>
            </div>
            <iframe ref={receiptRef} title="table-receipt" srcDoc={tableReceiptHtml} className="h-[70vh] w-full rounded-lg bg-white" />
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2"><LayoutGrid size={28} className="text-yellow-300"/> {tx(lang, 'Masaların İdarəsi', 'Управление столами', 'Table Management')}</h2>
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
          {['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase()) && (
            <button onClick={() => setShowCreate(true)} className="glossy-gold min-h-13 px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors font-bold">
              <Plus size={20} /> {tx(lang, 'Masa Yarat', 'Создать стол', 'Create Table')}
            </button>
          )}
        </div>
      </div>
      {workspaceView === 'floor' && activeFloorId && (
        <div className="mb-6 rounded-[28px] border border-white/10 bg-slate-900/35 p-4">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-bold text-slate-100">
                {floorPlans.find((row) => row.id === activeFloorId)?.name || tx(lang, 'Main Floor', 'Main Floor', 'Main Floor')}
              </div>
              <div className="mt-1 text-sm text-slate-400">
                {tx(lang, 'Floor plan görünüşü. Masaya toxunaraq seating və açıq check axınına keçin.', 'План зала. Нажмите на стол, чтобы перейти к seating и открытому чеку.', 'Floor plan view. Tap a table to continue into seating and open check flow.')}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {floorPlans.length > 1 && (
                <select className="neon-input min-w-[220px]" value={activeFloorId} onChange={(e) => setActiveFloorId(e.target.value)}>
                  {floorPlans.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              )}
              {!floorEditMode && (
                <label className="flex min-w-[210px] items-center gap-3 rounded-full border border-slate-700/70 bg-slate-900/40 px-4 py-2 text-xs font-semibold text-slate-200">
                  <span>{tx(lang, 'Zoom', 'Зум', 'Zoom')}</span>
                  <input
                    type="range"
                    min={85}
                    max={115}
                    step={5}
                    value={tableGridScale}
                    onChange={(e) => setTableGridScale(Number(e.target.value))}
                    className="w-full accent-yellow-300"
                  />
                  <span className="min-w-10 text-right">{tableGridScale}%</span>
                </label>
              )}
              {['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase()) && (
                <>
                  <button
                    type="button"
                    onClick={() => setFloorEditMode((prev) => !prev)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold ${floorEditMode ? 'bg-cyan-300 text-slate-950' : 'border border-slate-600 bg-slate-800/50 text-slate-200'}`}
                  >
                    {floorEditMode ? tx(lang, 'Editor açıqdır', 'Редактор включен', 'Editor on') : tx(lang, 'Floor editor', 'Редактор зала', 'Floor editor')}
                  </button>
                  {floorEditMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setFloorMultiSelectMode((prev) => !prev);
                        setSelectedFloorTableIds([]);
                      }}
                      className={`rounded-full px-4 py-2 text-sm font-semibold ${floorMultiSelectMode ? 'bg-violet-300 text-slate-950' : 'border border-violet-300/30 bg-violet-500/10 text-violet-100'}`}
                    >
                      {floorMultiSelectMode ? tx(lang, 'Çoxlu seçim aktivdir', 'Множественный выбор активен', 'Multi-select on') : tx(lang, 'Çoxlu seçim', 'Множественный выбор', 'Multi-select')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {floorEditMode && floorMultiSelectMode && selectedFloorTables.length > 0 && (
            <div className="mb-3 rounded-2xl border border-violet-300/20 bg-violet-500/10 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-bold text-violet-100">
                    {tx(lang, 'Çoxlu seçim', 'Множественный выбор', 'Multi-select')} · {selectedFloorTables.length}
                  </div>
                  <div className="mt-1 text-xs text-violet-200/80">
                    {selectedFloorTables.map((table) => table.label).join(', ')}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-1 rounded-xl border border-violet-300/30 bg-slate-950/30 px-2 py-1 text-xs text-violet-100">
                    <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void handleNudgeSelectedTables(-1, 0); }}>←</button>
                    <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void handleNudgeSelectedTables(0, -1); }}>↑</button>
                    <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void handleNudgeSelectedTables(0, 1); }}>↓</button>
                    <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void handleNudgeSelectedTables(1, 0); }}>→</button>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-violet-300/30 bg-violet-500/15 px-4 py-2 text-sm font-semibold text-violet-100"
                    onClick={() => setSelectedFloorTableIds([])}
                  >
                    {tx(lang, 'Seçimi təmizlə', 'Очистить выбор', 'Clear selection')}
                  </button>
                </div>
              </div>
            </div>
          )}
          {floorEditMode && selectedFloorTable && (
            <div className="mb-3 rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-bold text-cyan-100">
                    {tx(lang, 'Floor editor: seçilmiş masa', 'Редактор зала: выбранный стол', 'Floor editor: selected table')} · {selectedFloorTable.label}
                  </div>
                  <div className="mt-1 text-xs text-cyan-200/80">
                    {tx(lang, 'Ölçü, forma və tutumu buradan dəyişin. Küncdəki handle-lər ilə sürətli resize də edə bilərsiniz.', 'Меняйте размер, форму и вместимость здесь. Быстрый resize доступен через handle в углах.', 'Change size, shape, and capacity here. You can also resize quickly with the corner handles.')}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-600 bg-slate-900/40 px-2 py-2 text-xs text-slate-200">
                    <span className="font-semibold text-slate-300">{tx(lang, 'Preset', 'Пресет', 'Preset')}</span>
                    <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => { void persistFloorLayout(selectedFloorTable.id, { shape: 'circle', width_units: 2, height_units: 2, capacity: 2 }); }}>
                      {tx(lang, '2-seat round', 'Круглый на 2', '2-seat round')}
                    </button>
                    <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => { void persistFloorLayout(selectedFloorTable.id, { shape: 'square', width_units: 2, height_units: 2, capacity: 4 }); }}>
                      {tx(lang, '4-seat square', 'Квадрат на 4', '4-seat square')}
                    </button>
                    <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => { void persistFloorLayout(selectedFloorTable.id, { shape: 'rectangle', width_units: 3, height_units: 2, capacity: 6 }); }}>
                      {tx(lang, '6-seat banquette', 'Банкетка на 6', '6-seat banquette')}
                    </button>
                  </div>
                  <select
                    className="neon-input min-w-[150px]"
                    value={String(selectedFloorTable.shape || 'rectangle')}
                    onChange={(e) => { void persistFloorLayout(selectedFloorTable.id, { shape: e.target.value }); }}
                  >
                    <option value="rectangle">{tx(lang, 'Düzbucaqlı', 'Прямоугольник', 'Rectangle')}</option>
                    <option value="square">{tx(lang, 'Kvadrat', 'Квадрат', 'Square')}</option>
                    <option value="circle">{tx(lang, 'Dairəvi', 'Круглый', 'Circle')}</option>
                  </select>
                  <button
                    type="button"
                    className="rounded-xl border border-slate-600 bg-slate-900/40 px-3 py-2 text-xs font-semibold text-slate-100"
                    onClick={() => {
                      void persistFloorLayout(selectedFloorTable.id, {
                        width_units: Math.max(1, Number(selectedFloorTable.h || 1)),
                        height_units: Math.max(1, Number(selectedFloorTable.w || 1)),
                      });
                    }}
                  >
                    {tx(lang, '90° döndər', 'Повернуть на 90°', 'Rotate 90°')}
                  </button>
                  <div className="flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-900/40 px-2 py-1 text-xs text-slate-200">
                    <span>{tx(lang, 'En', 'Ширина', 'Width')}</span>
                    <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => { void persistFloorLayout(selectedFloorTable.id, { width_units: Math.max(1, Number(selectedFloorTable.w || 1) - 1) }); }}>-</button>
                    <span className="min-w-6 text-center font-semibold">{selectedFloorTable.w}</span>
                    <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => { void persistFloorLayout(selectedFloorTable.id, { width_units: Math.min(6, Number(selectedFloorTable.w || 1) + 1) }); }}>+</button>
                  </div>
                  <div className="flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-900/40 px-2 py-1 text-xs text-slate-200">
                    <span>{tx(lang, 'Hündürlük', 'Высота', 'Height')}</span>
                    <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => { void persistFloorLayout(selectedFloorTable.id, { height_units: Math.max(1, Number(selectedFloorTable.h || 1) - 1) }); }}>-</button>
                    <span className="min-w-6 text-center font-semibold">{selectedFloorTable.h}</span>
                    <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => { void persistFloorLayout(selectedFloorTable.id, { height_units: Math.min(6, Number(selectedFloorTable.h || 1) + 1) }); }}>+</button>
                  </div>
                  <div className="flex items-center gap-1 rounded-xl border border-slate-600 bg-slate-900/40 px-2 py-1 text-xs text-slate-200">
                    <span>{tx(lang, 'Tutum', 'Вместимость', 'Capacity')}</span>
                    <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => { void persistFloorLayout(selectedFloorTable.id, { capacity: Math.max(1, Number(selectedFloorTable.capacity || 1) - 1) }); }}>-</button>
                    <span className="min-w-6 text-center font-semibold">{selectedFloorTable.capacity}</span>
                    <button type="button" className="rounded-md border border-slate-600 px-2 py-1" onClick={() => { void persistFloorLayout(selectedFloorTable.id, { capacity: Math.min(20, Number(selectedFloorTable.capacity || 1) + 1) }); }}>+</button>
                  </div>
                </div>
              </div>
              {selectedFloorGroup && (
                <div className="mt-3 rounded-2xl border border-violet-300/25 bg-violet-500/10 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-sm font-bold text-violet-100">
                        {tx(lang, 'Seçilmiş birləşmiş qrup', 'Выбранная объединенная группа', 'Selected merged group')}
                      </div>
                      <div className="mt-1 text-xs text-violet-200/80">
                        {selectedFloorGroup.tables.map((table) => table.label).join(' + ')}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <div className="flex items-center gap-1 rounded-xl border border-violet-300/30 bg-slate-950/30 px-2 py-1 text-xs text-violet-100">
                        <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void handleNudgeGroup(selectedFloorGroup.id, -1, 0); }}>←</button>
                        <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void handleNudgeGroup(selectedFloorGroup.id, 0, -1); }}>↑</button>
                        <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void handleNudgeGroup(selectedFloorGroup.id, 0, 1); }}>↓</button>
                        <button type="button" className="rounded-md border border-violet-300/30 px-2 py-1" onClick={() => { void handleNudgeGroup(selectedFloorGroup.id, 1, 0); }}>→</button>
                      </div>
                      <button
                        type="button"
                        className="rounded-xl border border-violet-300/40 bg-violet-500/15 px-4 py-2 text-sm font-semibold text-violet-100"
                        onClick={() => { void handleSplitTables(selectedFloorTable.id, selectedFloorGroup.id); }}
                      >
                        {tx(lang, 'Qrupu ayır', 'Разделить группу', 'Split group')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              ['AVAILABLE', tx(lang, 'Boş', 'Свободно', 'Available'), 'border-emerald-300/40 bg-emerald-500/10 text-emerald-100'],
              ['RESERVED', tx(lang, 'Rezerv', 'Резерв', 'Reserved'), 'border-amber-300/40 bg-amber-500/10 text-amber-100'],
              ['ACTIVE_CHECK', tx(lang, 'Aktiv çek', 'Активный чек', 'Active check'), 'border-rose-300/40 bg-rose-500/10 text-rose-100'],
              ['DIRTY', tx(lang, 'Təmizlik', 'Уборка', 'Dirty'), 'border-slate-300/30 bg-slate-500/20 text-slate-100'],
            ].map(([key, label, className]) => (
              <div key={String(key)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${className}`}>
                {label}: {floorSummary[String(key) as keyof typeof floorSummary] || 0}
              </div>
            ))}
          </div>
          {mergedGroups.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {mergedGroups.map((group, index) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setSelectedFloorGroupId(group.id);
                    setSelectedFloorTableId(group.tables[0]?.id || null);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${selectedFloorGroupId === group.id ? 'border-violet-200 bg-violet-500/25 text-violet-50' : 'border-violet-300/40 bg-violet-500/12 text-violet-100'}`}
                >
                  {tx(lang, 'Birləşmiş qrup', 'Объединенная группа', 'Merged group')} {index + 1}: {group.tables.map((table) => table.label).join(' + ')}
                </button>
              ))}
            </div>
          )}
          {floorEditMode && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {floorPlans.length > 1 && (
                <select
                  className="neon-input min-w-[220px]"
                  value={copyLayoutSourceFloorId}
                  onChange={(e) => setCopyLayoutSourceFloorId(e.target.value)}
                >
                  <option value="">{tx(lang, 'Layout mənbəyi seçin', 'Выберите источник макета', 'Choose layout source')}</option>
                  {floorPlans.filter((row) => row.id !== activeFloorId).map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100"
                onClick={() => { void handleCopyFloorLayout(copyLayoutSourceFloorId); }}
                disabled={!copyLayoutSourceFloorId}
              >
                {tx(lang, 'Layout kopyala', 'Копировать макет', 'Copy layout')}
              </button>
              <button
                type="button"
                className="rounded-full border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100"
                onClick={() => { void handleResetFloorLayout(); }}
              >
                {tx(lang, 'Layout sıfırla', 'Сбросить макет', 'Reset layout')}
              </button>
            </div>
          )}
          {floorEditMode ? (
            <div
              className="relative grid gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3"
              style={{
                gridTemplateColumns: `repeat(${Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12)}, minmax(0, 1fr))`,
                gridAutoRows: '70px',
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!draggingTableId) return;
                const host = e.currentTarget;
                const rect = host.getBoundingClientRect();
                const maxCols = Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12);
                const columnWidth = rect.width / maxCols;
                const rowHeight = 70;
                const nextX = Math.max(0, Math.floor((e.clientX - rect.left) / columnWidth));
                const nextY = Math.max(0, Math.floor((e.clientY - rect.top) / rowHeight));
                setFloorDropPreview({ x: nextX, y: nextY });
              }}
              onDrop={(e) => { void handleFloorGridDrop(e); }}
            >
              {mergedGroupOutlines.map((outline) => (
                <button
                  key={outline.id}
                  type="button"
                  onClick={() => {
                    const group = mergedGroups.find((row) => row.id === outline.id);
                    setSelectedFloorGroupId(outline.id);
                    setSelectedFloorTableId(group?.tables[0]?.id || null);
                  }}
                  className={`absolute rounded-[26px] border-2 border-dashed bg-violet-500/5 text-left ${selectedFloorGroupId === outline.id ? 'border-violet-100/90' : 'border-violet-300/45'}`}
                  style={{ left: outline.left, width: outline.width, top: outline.top, height: outline.height }}
                >
                  <div className="absolute -top-5 left-2 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-semibold text-violet-100">
                    {outline.label}
                  </div>
                </button>
              ))}
              {floorEditMode && floorDropPreview && (
                <>
                  <div className="pointer-events-none absolute inset-y-0 border-l border-cyan-300/60" style={{ left: `calc(${(floorDropPreview.x / Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12)) * 100}% + 12px)` }} />
                  <div className="pointer-events-none absolute inset-x-0 border-t border-cyan-300/60" style={{ top: `${floorDropPreview.y * 70 + 12}px` }} />
                </>
              )}
              {floorTables.map((table) => {
                const statusColors: Record<string, string> = {
                  AVAILABLE: 'bg-emerald-500/15 border-emerald-300/40 text-emerald-100',
                  RESERVED: 'bg-amber-500/15 border-amber-300/40 text-amber-100',
                  SEATED: 'bg-sky-500/15 border-sky-300/40 text-sky-100',
                  ACTIVE_CHECK: 'bg-violet-500/15 border-violet-300/40 text-violet-100',
                  DIRTY: 'bg-slate-500/20 border-slate-300/30 text-slate-100',
                };
                return (
                  <button
                    key={table.id}
                    type="button"
                    draggable
                    onDragStart={() => {
                      const mergedGroupId = String((table as any).merged_group_id || '').trim();
                      const nextDragIds =
                        mergedGroupId && selectedFloorGroupId === mergedGroupId
                          ? (selectedFloorGroup?.tables.map((row) => row.id) || [table.id])
                          : (floorMultiSelectMode && selectedFloorTableIds.includes(table.id) ? selectedFloorTableIds : [table.id]);
                      setDraggingTableId(table.id);
                      setDraggingTableIds(nextDragIds);
                    }}
                    onDragEnd={() => {
                      setDraggingTableId(null);
                      setDraggingTableIds([]);
                      setFloorDropPreview(null);
                    }}
                    onClick={() => {
                      if (floorMultiSelectMode) {
                        setSelectedFloorTableIds((prev) => (prev.includes(table.id) ? prev.filter((id) => id !== table.id) : [...prev, table.id]));
                      } else {
                        setSelectedFloorTableId(table.id);
                        setSelectedFloorGroupId(String((table as any).merged_group_id || '').trim() || null);
                      }
                    }}
                    className={`border p-3 text-left shadow-sm transition ${String(table.shape || '').toLowerCase() === 'circle' ? 'rounded-[999px]' : String(table.shape || '').toLowerCase() === 'square' ? 'rounded-xl' : 'rounded-2xl'} ${draggingTableIds.includes(table.id) ? 'opacity-60' : ''} ${selectedFloorTableId === table.id ? 'ring-2 ring-cyan-300/80' : ''} ${selectedFloorTableIds.includes(table.id) ? 'ring-2 ring-violet-300/80' : ''} ${String((table as any).merged_group_id || '').trim() ? 'shadow-[0_0_0_2px_rgba(167,139,250,0.45)]' : ''} ${statusColors[String(table.status || 'AVAILABLE').toUpperCase()] || statusColors.AVAILABLE}`}
                    style={{
                      gridColumn: `${Math.max(1, Number(table.x || 0) + 1)} / span ${Math.max(1, Number(table.w || 2))}`,
                      gridRow: `${Math.max(1, Number(table.y || 0) + 1)} / span ${Math.max(1, Number(table.h || 2))}`,
                    }}
                  >
                    <div className="font-bold">{table.label}</div>
                    <div className="mt-2 text-xs"><Users size={12} className="mr-1 inline" />{Number(table.guest_count || 0)} / {Number(table.capacity || 0)}</div>
                    {table.merged_group_id ? <div className="mt-2 rounded-full border border-violet-300/40 bg-violet-500/15 px-2 py-1 text-[11px] font-semibold text-violet-100">{tx(lang, 'Birləşmiş qrup', 'Объединенная группа', 'Merged group')}</div> : null}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <button type="button" onClick={(e) => { e.stopPropagation(); void persistFloorLayout(table.id, { width_units: Math.max(1, Number(table.w || 1) - 1) }); }} className="rounded-md border border-slate-300/30 bg-black/20 px-2 py-1 text-[10px] font-semibold text-slate-100">W-</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); void persistFloorLayout(table.id, { width_units: Math.min(6, Number(table.w || 1) + 1) }); }} className="rounded-md border border-slate-300/30 bg-black/20 px-2 py-1 text-[10px] font-semibold text-slate-100">W+</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); void persistFloorLayout(table.id, { height_units: Math.max(1, Number(table.h || 1) - 1) }); }} className="rounded-md border border-slate-300/30 bg-black/20 px-2 py-1 text-[10px] font-semibold text-slate-100">H-</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); void persistFloorLayout(table.id, { height_units: Math.min(6, Number(table.h || 1) + 1) }); }} className="rounded-md border border-slate-300/30 bg-black/20 px-2 py-1 text-[10px] font-semibold text-slate-100">H+</button>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
	              <div
	                className={`rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3 ${viewTableId ? 'lg:pr-2' : ''}`}
	                style={{ marginRight: viewTableId ? 'min(72vw, 1260px)' : '0' }}
	              >
                <TableGrid
                  floorTables={floorTables}
                  tablesById={tablesById}
                  readyCountsByLabel={readyCountsByLabel}
                  viewTableId={viewTableId}
                  tableGridMinWidth={tableGridMinWidth}
                  lang={lang}
                  currentUsername={user?.username}
                  currentUserRole={String(user?.role || '')}
                  onSelectTable={handleSelectWaiterTable}
                  onMarkClean={(tableId) => { void handleMarkTableClean(tableId); }}
                />
              </div>
              <div className="hidden lg:block" />
            </div>
          )}
        </div>
      )}
      {workspaceView === 'reservations' && (
        <div className="mb-6 rounded-[28px] border border-white/10 bg-slate-900/35 p-4">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-bold text-slate-100">{tx(lang, 'Günlük rezervasiyalar', 'Брони на день', 'Daily reservations')}</div>
              <div className="mt-1 text-sm text-slate-400">{tx(lang, 'Saat xətti üzrə rezervasiyalar və seat axını', 'Брони по временной линии и сценарий посадки', 'Reservations timeline and seating flow')}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1 rounded-full border border-slate-600 bg-slate-800/50 p-1 text-xs text-slate-200">
                <button
                  type="button"
                  onClick={() => setReservationZoom(15)}
                  className={`rounded-full px-3 py-1 font-semibold ${reservationZoom === 15 ? 'bg-cyan-300 text-slate-950' : ''}`}
                >
                  15m
                </button>
                <button
                  type="button"
                  onClick={() => setReservationZoom(30)}
                  className={`rounded-full px-3 py-1 font-semibold ${reservationZoom === 30 ? 'bg-cyan-300 text-slate-950' : ''}`}
                >
                  30m
                </button>
              </div>
              <input className="neon-input" type="date" value={reservationDate} onChange={(e) => setReservationDate(e.target.value)} />
              <button type="button" onClick={() => setShowReservationCreate(true)} className="glossy-gold rounded-xl px-4 py-2 font-semibold">
                {tx(lang, 'Rezervasiya yarat', 'Создать бронь', 'Create reservation')}
              </button>
            </div>
          </div>
          <div className="overflow-auto rounded-2xl border border-slate-700/60 bg-slate-950/30">
            {reservations.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                {tx(lang, 'Bu gün üçün rezervasiya yoxdur', 'На этот день броней нет', 'No reservations for this day')}
              </div>
            ) : (
              <div className="flex" style={{ minWidth: `${reservationTimeline.totalWidth + 96}px` }}>
                <div className="w-24 shrink-0 border-r border-slate-800/80 bg-slate-950/60">
                  {Array.from({ length: reservationTimeline.hourEnd - reservationTimeline.hourStart + 1 }, (_, idx) => reservationTimeline.hourStart + idx).map((hour) => (
                    <div key={hour} className="h-[75px] border-b border-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-400">
                      {String(hour).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>
                <div
                  className="relative min-w-0 flex-1"
                  style={{ height: `${reservationTimeline.totalHeight}px`, minWidth: `${reservationTimeline.totalWidth}px` }}
                  onDragOver={(e) => {
                    if (!draggingReservationId) return;
                    e.preventDefault();
                    const host = e.currentTarget;
                    const rect = host.getBoundingClientRect();
                    const rawMinutes = ((e.clientY - rect.top) / reservationTimeline.minuteHeight) + reservationTimeline.hourStart * 60;
                    const snappedMinutes = Math.max(reservationTimeline.hourStart * 60, Math.min((reservationTimeline.hourEnd * 60) - reservationZoom, Math.round(rawMinutes / reservationZoom) * reservationZoom));
                    const hours = Math.floor(snappedMinutes / 60);
                    const minutes = snappedMinutes % 60;
                    const laneIndex = Math.max(0, Math.min(reservationTimeline.lanes.length - 1, Math.floor((e.clientX - rect.left) / reservationTimeline.laneWidth)));
                    const assignedTableId = reservationTimeline.lanes[laneIndex]?.id || null;
                    const nextReservationAt = `${reservationDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
                    const dragged = reservations.find((row) => row.id === draggingReservationId);
                    const draggedDuration = Math.max(30, Number(reservationDurationDrafts[draggingReservationId] ?? (dragged?.duration_minutes || 90)));
                    const previewStart = new Date(nextReservationAt).getTime();
                    const previewEnd = previewStart + (draggedDuration * 60 * 1000);
                    const hasConflict = Boolean(assignedTableId) && reservations.some((row) => {
                      if (row.id === draggingReservationId) return false;
                      if (String(row.assigned_table_id || '') !== String(assignedTableId || '')) return false;
                      if (!['BOOKED', 'LATE'].includes(String(row.status || '').toUpperCase())) return false;
                      const start = new Date(row.reservation_at).getTime();
                      const end = start + (Math.max(30, Number(row.duration_minutes || 90)) * 60 * 1000);
                      return previewStart < end && previewEnd > start;
                    });
                    setReservationDropPreview({
                      lane: laneIndex,
                      top: Math.max(0, snappedMinutes - reservationTimeline.hourStart * 60) * reservationTimeline.minuteHeight,
                      reservationAt: nextReservationAt,
                      assignedTableId,
                      hasConflict,
                    });
                  }}
                  onDrop={(e) => {
                    if (!draggingReservationId) return;
                    e.preventDefault();
                    const host = e.currentTarget;
                    const rect = host.getBoundingClientRect();
                    const rawMinutes = ((e.clientY - rect.top) / reservationTimeline.minuteHeight) + reservationTimeline.hourStart * 60;
                    const snappedMinutes = Math.max(reservationTimeline.hourStart * 60, Math.min((reservationTimeline.hourEnd * 60) - reservationZoom, Math.round(rawMinutes / reservationZoom) * reservationZoom));
                    const hours = Math.floor(snappedMinutes / 60);
                    const minutes = snappedMinutes % 60;
                    const laneIndex = Math.max(0, Math.min(reservationTimeline.lanes.length - 1, Math.floor((e.clientX - rect.left) / reservationTimeline.laneWidth)));
                    const assignedTableId = reservationTimeline.lanes[laneIndex]?.id || null;
                    const nextReservationAt = `${reservationDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
                    void (async () => {
                      try {
                        await update_reservation_live(draggingReservationId, { reservation_at: nextReservationAt, assigned_table_id: assignedTableId });
                        notify('success', tx(lang, 'Rezervasiya vaxtı və masası yeniləndi', 'Время и стол брони обновлены', 'Reservation time and table updated'));
                        await Promise.all([loadRestaurantData(), activeFloorId ? loadFloorState(activeFloorId) : Promise.resolve()]);
                      } catch (error: any) {
                        notify('error', error?.message || tx(lang, 'Rezervasiya dəyişmədi', 'Бронь не изменилась', 'Reservation was not updated'));
                      } finally {
                        setDraggingReservationId(null);
                        setReservationDropPreview(null);
                      }
                    })();
                  }}
                  onDragLeave={() => {
                    setReservationDropPreview(null);
                  }}
                >
                  <div className="sticky top-0 z-10 flex border-b border-slate-800/80 bg-slate-950/90">
                    {reservationTimeline.lanes.map((lane) => (
                      <div
                        key={`lane_${lane.id || 'unassigned'}`}
                        className="shrink-0 border-r border-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-300"
                        style={{ width: `${reservationTimeline.laneWidth}px` }}
                      >
                        {lane.label}
                      </div>
                    ))}
                  </div>
                  {Array.from({ length: reservationTimeline.hourEnd - reservationTimeline.hourStart + 1 }, (_, idx) => idx).map((idx) => (
                    <div
                      key={`line_${idx}`}
                      className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-700/60"
                      style={{ top: `${idx * 60 * reservationTimeline.minuteHeight + 34}px` }}
                    />
                  ))}
                  {draggingReservationId && reservationDropPreview && (
                    <>
                      <div
                        className={`pointer-events-none absolute rounded-2xl border-2 border-dashed ${reservationDropPreview.hasConflict ? 'border-rose-300/80 bg-rose-500/10' : 'border-cyan-300/80 bg-cyan-400/10'}`}
                        style={{
                          top: `${reservationDropPreview.top + 40}px`,
                          left: `${reservationDropPreview.lane * reservationTimeline.laneWidth + 8}px`,
                          width: `${reservationTimeline.laneWidth - 16}px`,
                          height: `${Math.max(62, (Math.max(30, Number(reservationDurationDrafts[draggingReservationId] ?? (reservations.find((row) => row.id === draggingReservationId)?.duration_minutes || 90))) * reservationTimeline.minuteHeight))}px`,
                        }}
                      />
                      <div
                        className={`pointer-events-none absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-semibold ${reservationDropPreview.hasConflict ? 'bg-rose-500/20 text-rose-100' : 'bg-cyan-400/20 text-cyan-100'}`}
                      >
                        {new Date(reservationDropPreview.reservationAt).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'az-AZ', { hour: '2-digit', minute: '2-digit' })}
                        {' · '}
                        {reservationDropPreview.assignedTableId ? (floorTables.find((table) => table.id === reservationDropPreview.assignedTableId)?.label || reservationDropPreview.assignedTableId) : tx(lang, 'Təyin edilməyib', 'Не назначено', 'Unassigned')}
                        {reservationDropPreview.hasConflict ? ` · ${tx(lang, 'Konflikt var', 'Есть конфликт', 'Conflict')}` : ''}
                      </div>
                    </>
                  )}
                  {reservationTimeline.entries.map((entry) => {
                    const reservation = entry.reservation;
                    const availableTables = floorTables.filter((row) => String(row.status).toUpperCase() === 'AVAILABLE');
                    const effectiveDuration = Number(reservationDurationDrafts[reservation.id] ?? (reservation.duration_minutes || 90));
                    const isResizing = resizingReservation?.id === reservation.id;
                    const reservationStatus = String(reservation.status || '').toUpperCase();
                    const reservationStartAt = new Date(reservation.reservation_at).getTime();
                    const minutesUntilStart = Math.round((reservationStartAt - Date.now()) / 60000);
                    const lateReleaseMinutes = Math.max(5, Number((tenantSettings as any).table_service_settings?.late_release_minutes ?? 15));
                    const statusTone =
                      reservationStatus === 'WAITLIST'
                        ? 'from-violet-400/15'
                        : reservationStatus === 'LATE'
                          ? 'from-rose-400/15'
                          : reservationStatus === 'NO_SHOW'
                            ? 'from-slate-500/20'
                            : 'from-amber-400/15';
                    return (
                      <div
                        key={reservation.id}
                        draggable={reservationStatus === 'BOOKED' || reservationStatus === 'LATE' || reservationStatus === 'WAITLIST'}
                        onDragStart={() => setDraggingReservationId(reservation.id)}
                        onDragEnd={() => {
                          setDraggingReservationId(null);
                          setReservationDropPreview(null);
                        }}
                        className={`absolute rounded-2xl border border-amber-300/30 bg-gradient-to-br ${statusTone} to-slate-900/90 p-3 pb-8 shadow-[0_10px_30px_rgba(0,0,0,0.18)] ${isResizing ? 'ring-2 ring-cyan-300/80' : ''}`}
                        style={{
                          top: `${entry.top + 40}px`,
                          left: `${entry.lane * reservationTimeline.laneWidth + 8}px`,
                          width: `${reservationTimeline.laneWidth - 16}px`,
                          minHeight: `${entry.height}px`,
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-slate-100">{reservation.guest?.full_name || tx(lang, 'Adsız qonaq', 'Гость без имени', 'Guest without name')}</div>
                            <div className="mt-1 text-xs text-amber-100/90">
                              {new Date(reservation.reservation_at).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'az-AZ', { hour: '2-digit', minute: '2-digit' })}
                              {' · '}
                              {reservation.party_size} {tx(lang, 'nəfər', 'гостя', 'guests')}
                            </div>
                          </div>
                          <span className="rounded-full border border-slate-600 bg-slate-900/70 px-2 py-1 text-[10px] font-semibold text-slate-200">
                            {reservation.status}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-slate-300">
                          {reservation.assigned_table_id ? `${tx(lang, 'Masa', 'Стол', 'Table')}: ${floorTables.find((table) => table.id === reservation.assigned_table_id)?.label || reservation.assigned_table_id}` : tx(lang, 'Masa hələ təyin edilməyib', 'Стол еще не назначен', 'No table assigned yet')}
                        </div>
                        {minutesUntilStart <= 30 && minutesUntilStart >= 0 && (
                          <div className="mt-2 inline-flex rounded-full border border-cyan-300/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100">
                            {tx(lang, 'Yaxın rezervasiya', 'Скоро бронь', 'Upcoming reservation')} · {minutesUntilStart} {tx(lang, 'dəq', 'мин', 'min')}
                          </div>
                        )}
                        {reservationStatus === 'LATE' && (
                          <div className="mt-2 inline-flex rounded-full border border-rose-300/40 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold text-rose-100">
                            {tx(lang, 'Auto release', 'Авто release', 'Auto release')} · {lateReleaseMinutes} {tx(lang, 'dəq pəncərə', 'мин окно', 'min window')}
                          </div>
                        )}
                        <div className="mt-1 text-xs text-slate-400">
                          {tx(lang, 'Müddət', 'Длительность', 'Duration')}: {effectiveDuration} {tx(lang, 'dəqiqə', 'мин', 'min')}
                        </div>
                        {reservation.special_note ? (
                          <div className="mt-2 line-clamp-2 text-xs text-slate-400">{reservation.special_note}</div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(reservationStatus === 'BOOKED' || reservationStatus === 'LATE' || reservationStatus === 'WAITLIST') && (
                            <span className="rounded-full border border-slate-500/40 bg-slate-800/70 px-3 py-1 text-[11px] font-semibold text-slate-200">
                              {tx(lang, 'Sürüşdürüb vaxtı dəyiş', 'Перетащите, чтобы сменить время', 'Drag to reschedule')}
                            </span>
                          )}
                          {(reservationStatus === 'BOOKED' || reservationStatus === 'LATE' || reservationStatus === 'WAITLIST') && (
                            <>
                              <button
                                type="button"
                                onClick={() => { void handleReservationDurationChange(reservation.id, Number(reservation.duration_minutes || 90) - 15); }}
                                className="rounded-full border border-cyan-300/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100"
                              >
                                {tx(lang, '15 dəq azald', 'Минус 15 мин', '-15 min')}
                              </button>
                              <button
                                type="button"
                                onClick={() => { void handleReservationDurationChange(reservation.id, Number(reservation.duration_minutes || 90) + 15); }}
                                className="rounded-full border border-cyan-300/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100"
                              >
                                {tx(lang, '15 dəq artır', 'Плюс 15 мин', '+15 min')}
                              </button>
                            </>
                          )}
                          {(reservationStatus === 'BOOKED' || reservationStatus === 'WAITLIST' || reservationStatus === 'LATE') && availableTables.slice(0, 2).map((table) => (
                            <button
                              key={table.id}
                              type="button"
                              onClick={() => { void handleSeatReservation(reservation.id, table.id, reservation.party_size); }}
                              className="rounded-full border border-emerald-300/40 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-100"
                            >
                              {tx(lang, 'Seat et', 'Посадить', 'Seat')} · {table.label}
                            </button>
                          ))}
                          {reservationStatus === 'BOOKED' && (
                            <button
                              type="button"
                              onClick={() => { void handleReservationStatusChange(reservation.id, 'LATE'); }}
                              className="rounded-full border border-rose-300/40 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold text-rose-100"
                            >
                              {tx(lang, 'Gecikir', 'Опаздывает', 'Late')}
                            </button>
                          )}
                          {(reservationStatus === 'BOOKED' || reservationStatus === 'LATE') && (
                            <button
                              type="button"
                              onClick={() => { void handleReservationStatusChange(reservation.id, 'NO_SHOW'); }}
                              className="rounded-full border border-slate-300/30 bg-slate-500/15 px-3 py-1 text-[11px] font-semibold text-slate-100"
                            >
                              {tx(lang, 'No-show', 'Не пришел', 'No-show')}
                            </button>
                          )}
                          {reservationStatus === 'LATE' && (
                            <button
                              type="button"
                              onClick={() => { void handleReservationStatusChange(reservation.id, 'BOOKED'); }}
                              className="rounded-full border border-cyan-300/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100"
                            >
                              {tx(lang, 'Rezervə qaytar', 'Вернуть в бронь', 'Back to booked')}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => { void delete_reservation_live(reservation.id).then(() => loadRestaurantData()); }}
                            className="rounded-full border border-rose-300/40 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold text-rose-100"
                          >
                            {tx(lang, 'Ləğv et', 'Отменить', 'Cancel')}
                          </button>
                        </div>
                        {(reservationStatus === 'BOOKED' || reservationStatus === 'LATE' || reservationStatus === 'WAITLIST') && (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setResizingReservation({
                                id: reservation.id,
                                startY: e.clientY,
                                startDuration: effectiveDuration,
                              });
                              setReservationDurationDrafts((prev) => ({ ...prev, [reservation.id]: effectiveDuration }));
                            }}
                            onTouchStart={(e) => {
                              const touch = e.touches[0];
                              if (!touch) return;
                              e.stopPropagation();
                              setResizingReservation({
                                id: reservation.id,
                                startY: touch.clientY,
                                startDuration: effectiveDuration,
                              });
                              setReservationDurationDrafts((prev) => ({ ...prev, [reservation.id]: effectiveDuration }));
                            }}
                            className="absolute inset-x-4 bottom-1 flex cursor-ns-resize items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-100"
                          >
                            {tx(lang, 'Sürüşdür: müddəti dəyiş', 'Тяните: менять длительность', 'Drag to resize duration')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
