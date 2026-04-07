import React, { useRef, useState, useEffect, useMemo } from 'react';
import { get_tables_live, create_table_live, delete_table_live, open_table_live, transfer_table_live, merge_tables_live, revise_table_items_live } from '../api/tables';
import { get_kitchen_orders_live } from '../api/kds';
import { get_menu_items_live } from '../api/menu';
import { subscribeTenantRealtime } from '../api/realtime';
import { create_reservation_live, delete_reservation_live, get_floor_plans_live, get_floor_state_live, get_reservations_live, get_table_detail_live, seat_reservation_live, send_table_round_live, settle_table_check_live, update_table_layout_live, type FloorPlanRecord, type FloorTableState, type ReservationRecord, type TableDetailRecord } from '../api/restaurant';
import { LayoutGrid, Plus, Trash2, ArrowRightCircle, CalendarClock, Users, MapPinned } from 'lucide-react';
import { useAppStore } from '../store';
import { tx } from '../i18n';
import ConfirmModal from './ConfirmModal';
import { Decimal } from 'decimal.js';
import { get_business_profile, get_settings } from '../api/settings';
import { getDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { qzPrintHtml } from '../lib/qz';
import { hostScopedKey } from '../lib/storage_keys';

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
  const [tableReceiptHtml, setTableReceiptHtml] = useState<string | null>(null);
  const [revisionTarget, setRevisionTarget] = useState<{ tableId: string; itemName: string; nextItems: any[] } | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [revisionOverridePassword, setRevisionOverridePassword] = useState('');
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
  const [reservationDate, setReservationDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [showReservationCreate, setShowReservationCreate] = useState(false);
  const [reservationGuestName, setReservationGuestName] = useState('');
  const [reservationPhone, setReservationPhone] = useState('');
  const [reservationTime, setReservationTime] = useState('19:00');
  const [reservationPartySize, setReservationPartySize] = useState('2');
  const [reservationNote, setReservationNote] = useState('');
  const [reservationAssignedTableId, setReservationAssignedTableId] = useState('');
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

  const reservedTableIds = useMemo(
    () => new Set(
      floorTables
        .filter((row) => String(row.status || '').toUpperCase() === 'RESERVED')
        .map((row) => String(row.id)),
    ),
    [floorTables],
  );

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
    if (!activeFloorId) return;
    void loadFloorState(activeFloorId);
  }, [activeFloorId]);

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
        assigned_table_id: reservationAssignedTableId || null,
      });
      notify('success', tx(lang, 'Rezervasiya yaradıldı', 'Бронь создана', 'Reservation created'));
      setShowReservationCreate(false);
      setReservationGuestName('');
      setReservationPhone('');
      setReservationTime('19:00');
      setReservationPartySize('2');
      setReservationNote('');
      setReservationAssignedTableId('');
      await loadRestaurantData();
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message);
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

  const openTableInPos = (table: any) => {
    const storageKey = hostScopedKey(`${tenant_id}_open_table_in_pos`);
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        table_id: table.id,
        table_label: table.label,
      }),
    );
    window.dispatchEvent(new CustomEvent('open-table-in-pos', {
      detail: {
        table_id: table.id,
        table_label: table.label,
      },
    }));
    setViewTableId(null);
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
                <select className="neon-input mt-1" value={reservationAssignedTableId} onChange={(e) => setReservationAssignedTableId(e.target.value)}>
                  <option value="">{tx(lang, 'Sonra təyin et', 'Назначить позже', 'Assign later')}</option>
                  {reservationCandidateTables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.label} · {tx(lang, 'Tutum', 'Вместимость', 'Capacity')} {table.capacity}
                    </option>
                  ))}
                </select>
              </label>
            </div>
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

      {viewTableId && (
        <div ref={detailPanelRef} className="mt-6">
          <div className="metal-panel w-full rounded-[30px] p-5">
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
                  <h3 className="text-lg font-bold text-slate-100">{t.label}</h3>
                  <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Masa sifariş detalı', 'Детали заказа стола', 'Table order detail')}</div>
                  <div className="mt-3 rounded-2xl border border-yellow-300/20 bg-yellow-500/10 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-yellow-200">
                          {tx(lang, 'Open Check', 'Открытый чек', 'Open Check')}
                        </div>
                        <div className="mt-2 text-lg font-black text-slate-100">
                          {detailCheck?.check_number || tx(lang, 'Check açılır...', 'Чек открывается...', 'Check is initializing...')}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">
                          {detailSession?.assigned_waiter
                            ? `${tx(lang, 'Ofisiant', 'Официант', 'Waiter')}: ${detailSession.assigned_waiter}`
                            : tx(lang, 'Ofisiant təyin edilməyib', 'Официант не назначен', 'Waiter not assigned')}
                          {detailSession?.seated_at
                            ? ` · ${tx(lang, 'Oturma', 'Посадка', 'Seated')}: ${new Date(detailSession.seated_at).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'az-AZ', { hour: '2-digit', minute: '2-digit' })}`
                            : ''}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 px-3 py-2 text-sm text-slate-200">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{tx(lang, 'Status', 'Статус', 'Status')}</div>
                          <div className="mt-1 font-bold text-slate-100">{detailCheck?.status || 'OPEN'}</div>
                        </div>
                        <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 px-3 py-2 text-sm text-slate-200">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{tx(lang, 'Qonaq', 'Гости', 'Guests')}</div>
                          <div className="mt-1 font-bold text-slate-100">{detailSession?.guest_count ?? Number(t.guest_count || 0)}</div>
                        </div>
                        <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 px-3 py-2 text-sm text-slate-200">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{tx(lang, 'Subtotal', 'Сумма', 'Subtotal')}</div>
                          <div className="mt-1 font-bold text-slate-100">{new Decimal(detailCheck?.subtotal || t.total || 0).toFixed(2)} ₼</div>
                        </div>
                        <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-200">{tx(lang, 'Toplam', 'Итого', 'Total')}</div>
                          <div className="mt-1 font-bold">{new Decimal(detailCheck?.total || t.total || 0).toFixed(2)} ₼</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className="rounded-full border border-slate-700/60 bg-slate-950/30 px-4 py-2 text-sm text-slate-200">
                      {tx(lang, 'Qonaq', 'Гости', 'Guests')}: <span className="font-bold text-slate-100">{Number(t.guest_count || 0)}</span>
                    </div>
                    <div className="rounded-full border border-slate-700/60 bg-slate-950/30 px-4 py-2 text-sm text-slate-200">
                      {tx(lang, 'Depozitli', 'С депозитом', 'Deposited')}: <span className="font-bold text-slate-100">{Number(t.deposit_guest_count || 0)}</span>
                    </div>
                    <div className="rounded-full border border-emerald-300/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
                      {tx(lang, 'Depozit', 'Депозит', 'Deposit')}: <span className="font-bold">{new Decimal(t.deposit_amount || 0).toFixed(2)} ₼</span>
                    </div>
                    <div className="rounded-full border border-yellow-300/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-100">
                      {tx(lang, 'Cari hesab', 'Текущий счет', 'Current bill')}: <span className="font-bold">{Decimal.max(
                        new Decimal(t.total || 0).plus(new Decimal(t.total || 0).times(serviceFeePercent).div(100)),
                        new Decimal(t.deposit_amount || 0),
                      ).toFixed(2)} ₼</span>
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-900/35 p-3">
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
                          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${tableWorkspaceTab === tabKey ? 'bg-yellow-400 text-slate-950' : 'border border-slate-700/70 bg-slate-950/35 text-slate-300'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 text-xs text-slate-400">
                      {tx(lang, 'Bir anda yalnız bir iş sahəsi açılır. Bu, 15-inch touch ekranda səhifəni daha yığcam saxlayır.', 'Одновременно открыта только одна рабочая зона. Так 15-дюймовый touch экран остается компактнее.', 'Only one workspace stays open at a time. This keeps the 15-inch touch screen more compact.')}
                    </div>
                  </div>
                  {tableWorkspaceTab === 'history' && (
                  <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-900/35 p-4">
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
                  <div className={`mt-3 max-h-72 overflow-auto rounded-lg border border-slate-700/70 bg-slate-900/40 p-3 ${tableWorkspaceTab === 'compose' ? '' : 'hidden'}`}>
                    {items.length === 0 && <div className="text-sm text-slate-400">{tx(lang, 'Masa boşdur', 'Стол пуст', 'Table is empty')}</div>}
                    {items.map((it: any, idx: number) => (
                      <div key={`${it.item_name}_${idx}`} className="flex items-center justify-between gap-3 border-b border-slate-700/40 py-2 text-sm last:border-b-0">
                        <div>
                          <div>{it.item_name}</div>
                          <div className="mt-1 text-xs text-slate-500">x{it.qty}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-md border border-amber-300/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-100"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const nextItems = items
                                .map((row: any, rowIdx: number) => rowIdx === idx ? { ...row, qty: Number(row.qty || 0) - 1 } : row)
                                .filter((row: any) => Number(row.qty || 0) > 0);
                              setRevisionTarget({ tableId: t.id, itemName: it.item_name, nextItems });
                            }}
                          >
                            -1
                          </button>
                          <button
                            className="rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextItems = items.filter((_: any, rowIdx: number) => rowIdx !== idx);
                              setRevisionTarget({ tableId: t.id, itemName: it.item_name, nextItems });
                            }}
                          >
                            {tx(lang, 'Sil', 'Убрать', 'Remove')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {tableWorkspaceTab === 'compose' && (
                  <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-900/35 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="text-base font-semibold text-slate-100">{tx(lang, 'Seçilmiş masa üçün sifarişləri burada yaz', 'Введите заказ для выбранного стола здесь', 'Write the order for the selected table here')}</div>
                        <div className="mt-1 text-sm text-slate-400">
                          {tx(
                            lang,
                            'Popup açılmır. Masanı seçdikdən sonra menyu birbaşa burada açılır və ofisiant məhsulları yığıb həmin raundu mətbəxə göndərir.',
                            'Без popup. После выбора стола меню открывается прямо здесь, и официант собирает позиции и отправляет раунд на кухню.',
                            'No popup. After selecting a table, the menu opens right here and the waiter builds the items and sends the round to the kitchen.',
                          )}
                        </div>
                      </div>
                      <div className="rounded-full border border-slate-700/70 bg-slate-950/40 px-3 py-1 text-xs font-semibold text-slate-200">
                        {tx(lang, 'Draft raund cəmi', 'Сумма draft-раунда', 'Draft round total')}: {roundDraft.reduce((acc, row) => acc.plus(new Decimal(row.price || 0).times(row.qty || 0)), new Decimal(0)).toFixed(2)} ₼
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                      <div className="space-y-3">
                        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                          <input
                            className="neon-input"
                            value={roundSearch}
                            onChange={(e) => setRoundSearch(e.target.value)}
                            placeholder={tx(lang, 'Raund üçün məhsul axtar...', 'Поиск товара для раунда...', 'Search items for this round...')}
                          />
                          <select className="neon-input min-w-[180px]" value={roundCategory} onChange={(e) => setRoundCategory(e.target.value)}>
                            {roundCategories.map((category) => (
                              <option key={category} value={category}>{category === 'ALL' ? tx(lang, 'Bütün kateqoriyalar', 'Все категории', 'All categories') : category}</option>
                            ))}
                          </select>
                        </div>
                        <div className="grid max-h-80 grid-cols-1 gap-3 overflow-auto rounded-xl border border-slate-700/70 bg-slate-950/25 p-3 md:grid-cols-2">
                          {filteredRoundMenu.map((item: any) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => addMenuItemToRound(item)}
                              className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3 text-left transition hover:border-yellow-300/30 hover:bg-slate-900/70"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate font-semibold text-slate-100">{item.item_name}</div>
                                  <div className="mt-1 text-xs text-slate-400">{item.category}</div>
                                  {item.description ? <div className="mt-2 line-clamp-2 text-xs text-slate-500">{String(item.description)}</div> : null}
                                </div>
                                <div className="rounded-lg bg-yellow-400/15 px-2 py-1 text-sm font-bold text-yellow-200">
                                  {Number(item.price || 0).toFixed(2)} ₼
                                </div>
                              </div>
                            </button>
                          ))}
                          {filteredRoundMenu.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-700/60 px-4 py-6 text-center text-sm text-slate-400 md:col-span-2">
                              {tx(lang, 'Bu filtrlə məhsul tapılmadı', 'По этому фильтру товары не найдены', 'No items found for this filter')}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-700/70 bg-slate-950/30 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Raund draft-i', 'Draft раунда', 'Round draft')}</div>
                          {roundDraft.length > 0 ? (
                            <button type="button" onClick={clearRoundComposer} className="text-xs font-semibold text-slate-400 hover:text-slate-200">
                              {tx(lang, 'Təmizlə', 'Очистить', 'Clear')}
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-3 space-y-2">
                          {roundDraft.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-700/60 px-4 py-6 text-center text-sm text-slate-400">
                              {tx(lang, 'Burada yığdığınız məhsullar növbəti raund kimi göndəriləcək', 'Собранные здесь позиции будут отправлены как следующий раунд', 'Items gathered here will be sent as the next round')}
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
                        <button
                          type="button"
                          disabled={roundDraft.length === 0}
                          onClick={() => { void sendRoundDirectly(t); }}
                          className="glossy-gold mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {tx(lang, 'Bu raundu mətbəxə göndər', 'Отправить этот раунд на кухню', 'Send this round to kitchen')}
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-950/25 px-4 py-3">
                      <div className="text-sm text-slate-300">
                        {tx(lang, 'Bu panel əsas masa sifarişi axınıdır. POS yalnız ehtiyat variant kimi qalır.', 'Эта панель теперь основной сценарий заказа по столу. POS остается запасным вариантом.', 'This panel is now the main table-order flow. POS remains only as a fallback.')}
                      </div>
                      <button
                        onClick={() => openTableInPos(t)}
                        className="neon-btn inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"
                      >
                        <ArrowRightCircle size={18} />
                        {tx(lang, 'Lazım olsa POS-da aç', 'При необходимости открыть в POS', 'Open in POS if needed')}
                      </button>
                    </div>
                  </div>
                  )}
                  {tableWorkspaceTab === 'service' && (
                  <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-4">
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
                  )}
                  {tableWorkspaceTab === 'ops' && t.is_occupied && (
                    <div className="mt-4 grid gap-3 rounded-lg border border-slate-700/70 bg-slate-900/40 p-3">
                      <div>
                        <div className="mb-1 text-xs font-semibold text-slate-400">{tx(lang, 'Masanı köçür', 'Перенести стол', 'Transfer table')}</div>
                        <div className="flex gap-2">
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
                      <div>
                        <div className="mb-1 text-xs font-semibold text-slate-400">{tx(lang, 'Masaları birləşdir', 'Объединить столы', 'Merge tables')}</div>
                        <div className="flex gap-2">
                          <select className="neon-input flex-1" value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                            <option value="">{tx(lang, 'Hədəf masa seçin', 'Выберите целевой стол', 'Select target table')}</option>
                            {otherTables.map((row) => (
                              <option key={row.id} value={row.id}>{row.label}{row.is_occupied ? ` (${tx(lang, 'dolu', 'занят', 'occupied')})` : ''}</option>
                            ))}
                          </select>
                          <button
                            className="rounded-lg border border-amber-300/40 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-100"
                            onClick={async () => {
                              if (!mergeTargetId) return;
                              try {
                                await merge_tables_live(t.id, mergeTargetId, user?.username || 'staff');
                                notify('success', tx(lang, 'Masalar birləşdirildi', 'Столы объединены', 'Tables merged'));
                                setMergeTargetId('');
                                setViewTableId(null);
                                await loadData();
                              } catch (e: any) {
                                notify('error', e.message);
                              }
                            }}
                          >
                            {tx(lang, 'Birləşdir', 'Объединить', 'Merge')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="neon-btn rounded-lg px-4 py-2" onClick={() => setViewTableId(null)}>{tx(lang, 'Paneli gizlət', 'Скрыть панель', 'Hide panel')}</button>
                    {t.is_occupied && (
                      <button
                        className="glossy-gold min-h-12 rounded-xl px-5 py-3 font-semibold"
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
              {['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase()) && (
                <button
                  type="button"
                  onClick={() => setFloorEditMode((prev) => !prev)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${floorEditMode ? 'bg-cyan-300 text-slate-950' : 'border border-slate-600 bg-slate-800/50 text-slate-200'}`}
                >
                  {floorEditMode ? tx(lang, 'Editor açıqdır', 'Редактор включен', 'Editor on') : tx(lang, 'Floor editor', 'Редактор зала', 'Floor editor')}
                </button>
              )}
            </div>
          </div>
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
          <div
            className="grid gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3"
            style={{
              gridTemplateColumns: `repeat(${Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12)}, minmax(0, 1fr))`,
              gridAutoRows: '70px',
            }}
            onDragOver={(e) => {
              if (!floorEditMode) return;
              e.preventDefault();
            }}
          >
            {floorTables.map((table) => {
              const maxCols = Math.max(6, floorPlans.find((row) => row.id === activeFloorId)?.width_units || 12);
              const statusColors: Record<string, string> = {
                AVAILABLE: 'bg-emerald-500/15 border-emerald-300/40 text-emerald-100',
                RESERVED: 'bg-amber-500/15 border-amber-300/40 text-amber-100',
                SEATED: 'bg-sky-500/15 border-sky-300/40 text-sky-100',
                ACTIVE_CHECK: 'bg-rose-500/15 border-rose-300/40 text-rose-100',
                DIRTY: 'bg-slate-500/20 border-slate-300/30 text-slate-100',
              };
              return (
                <button
                  key={table.id}
                  type="button"
                  draggable={floorEditMode}
                  onDragStart={() => setDraggingTableId(table.id)}
                  onDragEnd={() => setDraggingTableId(null)}
                  onDrop={async (e) => {
                    if (!floorEditMode || draggingTableId !== table.id) return;
                    e.preventDefault();
                    const host = e.currentTarget.parentElement;
                    if (!host) return;
                    const rect = host.getBoundingClientRect();
                    const columnWidth = rect.width / maxCols;
                    const rowHeight = 70;
                    const nextX = Math.max(0, Math.min(maxCols - Math.max(1, Number(table.w || 2)), Math.floor((e.clientX - rect.left) / columnWidth)));
                    const nextY = Math.max(0, Math.floor((e.clientY - rect.top) / rowHeight));
                    try {
                      await update_table_layout_live(table.id, { floor_plan_id: activeFloorId, pos_x: nextX, pos_y: nextY });
                      await loadFloorState(activeFloorId);
                    } finally {
                      setDraggingTableId(null);
                    }
                  }}
                  onClick={() => {
                    if (floorEditMode) return;
                    if (String(table.status || '').toUpperCase() === 'DIRTY') return;
                    if (String(table.status || '').toUpperCase() === 'RESERVED') {
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
                    const localTable = tables.find((row) => row.id === table.id);
                    if (localTable?.is_occupied) {
                      setViewTableId(localTable.id);
                    } else {
                      setOpenTableId(table.id);
                      setGuestCount(String(Math.max(1, Number(table.guest_count || 1))));
                      setDepositGuestCount('0');
                    }
                  }}
                  className={`rounded-2xl border p-3 text-left shadow-sm transition hover:scale-[1.01] ${draggingTableId === table.id ? 'opacity-60' : ''} ${statusColors[String(table.status || 'AVAILABLE').toUpperCase()] || statusColors.AVAILABLE}`}
                  style={{
                    gridColumn: `${Math.max(1, Number(table.x || 0) + 1)} / span ${Math.max(1, Number(table.w || 2))}`,
                    gridRow: `${Math.max(1, Number(table.y || 0) + 1)} / span ${Math.max(1, Number(table.h || 2))}`,
                  }}
                >
                  <div className="font-bold">{table.label}</div>
                  <div className="mt-1 text-xs opacity-80">{table.status}</div>
                  <div className="mt-2 text-xs">
                    <Users size={12} className="mr-1 inline" />
                    {Number(table.guest_count || 0)} / {Number(table.capacity || 0)}
                  </div>
                  {new Decimal(table.check_total || 0).greaterThan(0) && (
                    <div className="mt-2 text-xs font-semibold">{new Decimal(table.check_total || 0).toFixed(2)} ₼</div>
                  )}
                  {String(table.status || '').toUpperCase() === 'DIRTY' && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await update_table_layout_live(table.id, { status: 'AVAILABLE' });
                          await Promise.all([loadFloorState(activeFloorId), loadData()]);
                          notify('success', tx(lang, 'Masa təmiz kimi qeyd olundu', 'Стол отмечен как чистый', 'Table marked as clean'));
                        } catch (error: any) {
                          notify('error', error?.message || tx(lang, 'Masa təmizlənmədi', 'Стол не очищен', 'Table was not cleaned'));
                        }
                      }}
                      className="mt-2 rounded-lg border border-slate-200/40 bg-slate-100/15 px-2 py-1 text-[11px] font-semibold text-slate-100"
                    >
                      {tx(lang, 'Təmizlə', 'Очистить', 'Mark clean')}
                    </button>
                  )}
                  {floorEditMode && (
                    <div className="mt-2 text-[11px] font-semibold opacity-80">
                      {tx(lang, 'Sürüşdürüb yerləşdir', 'Перетащите для размещения', 'Drag to place')}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
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
              <input className="neon-input" type="date" value={reservationDate} onChange={(e) => setReservationDate(e.target.value)} />
              <button type="button" onClick={() => setShowReservationCreate(true)} className="glossy-gold rounded-xl px-4 py-2 font-semibold">
                {tx(lang, 'Rezervasiya yarat', 'Создать бронь', 'Create reservation')}
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {reservations.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-700/70 px-4 py-6 text-center text-sm text-slate-400">
                {tx(lang, 'Bu gün üçün rezervasiya yoxdur', 'На этот день броней нет', 'No reservations for this day')}
              </div>
            )}
            {reservations.map((reservation) => {
              const availableTables = floorTables.filter((row) => String(row.status).toUpperCase() === 'AVAILABLE');
              return (
                <div key={reservation.id} className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-semibold text-slate-100">{reservation.guest?.full_name || tx(lang, 'Adsız qonaq', 'Гость без имени', 'Guest without name')}</div>
                      <div className="mt-1 text-sm text-slate-400">
                        {new Date(reservation.reservation_at).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'az-AZ', { hour: '2-digit', minute: '2-digit' })}
                        {' · '}
                        {reservation.party_size} {tx(lang, 'nəfər', 'гостя', 'guests')}
                        {reservation.special_note ? ` · ${reservation.special_note}` : ''}
                        {reservation.assigned_table_id ? ` · ${tx(lang, 'Masa', 'Стол', 'Table')}: ${floorTables.find((table) => table.id === reservation.assigned_table_id)?.label || reservation.assigned_table_id}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-slate-600 bg-slate-800/50 px-3 py-1 text-xs font-semibold text-slate-200">{reservation.status}</span>
                      {reservation.status === 'BOOKED' && availableTables.slice(0, 3).map((table) => (
                        <button
                          key={table.id}
                          type="button"
                          onClick={() => { void handleSeatReservation(reservation.id, table.id, reservation.party_size); }}
                          className="rounded-full border border-emerald-300/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100"
                        >
                          {tx(lang, 'Seat et', 'Посадить', 'Seat')} · {table.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => { void delete_reservation_live(reservation.id).then(() => loadRestaurantData()); }}
                        className="rounded-full border border-rose-300/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-100"
                      >
                        {tx(lang, 'Ləğv et', 'Отменить', 'Cancel')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {workspaceView === 'floor' && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
        {tables.map(t => (
          (() => {
            const kitchen = kitchenBadge((t as any).kitchen_status);
            const isDirtyTable = String((t as any).status || '').toUpperCase() === 'DIRTY';
            const currentBill = Decimal.max(
              new Decimal(t.total || 0).plus(new Decimal(t.total || 0).times(serviceFeePercent).div(100)),
              new Decimal(t.deposit_amount || 0)
            );
            const tableKitchenOrders = kitchenOrders.filter((row) => row.table_label === t.label);
            const rawReadyCount = tableKitchenOrders
              .filter((row) => String(row.status || '') === 'READY')
              .reduce(
                (acc, row) =>
                  acc +
                  (Array.isArray(row.items)
                    ? row.items.filter((item: any) => String(item.action || '').toUpperCase() !== 'CANCEL').length
                    : 0),
                0
              );
            const servedCount = Object.values(servedItemsMap[t.id] || {}).reduce(
              (acc, qty) => acc + Number(qty || 0),
              0
            );
            const readyCount = Math.max(0, rawReadyCount - servedCount);
            const waitingCount = tableKitchenOrders
              .filter((row) => ['NEW', 'PREPARING'].includes(String(row.status || '')))
              .reduce(
                (acc, row) =>
                  acc +
                  (Array.isArray(row.items)
                    ? row.items.filter((item: any) => String(item.action || '').toUpperCase() !== 'CANCEL').length
                    : 0),
                0
              );
            const hasDeposit = new Decimal(t.deposit_amount || 0).greaterThan(0);
            const readyToClose = t.is_occupied && currentBill.greaterThan(0) && readyCount === 0 && waitingCount === 0;
            const isReservedTable = reservedTableIds.has(String(t.id));
            return (
          <div
            key={t.id}
            onClick={() => {
              if (isDirtyTable) return;
              if (isReservedTable && !t.is_occupied) {
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
              if (!t.is_occupied) {
                setOpenTableId(t.id);
                setGuestCount(String(Math.max(1, Number(t.guest_count || 1))));
                setDepositGuestCount(String(Math.max(0, Number(t.deposit_guest_count || 0))));
                return;
              }
              setViewTableId(t.id);
            }}
            className={`min-h-52 p-6 rounded-3xl border-2 flex flex-col items-center justify-center relative transition-all shadow-sm ${isDirtyTable ? 'bg-slate-700/40 border-slate-400/60' : isReservedTable && !t.is_occupied ? 'bg-amber-900/20 border-amber-300/70 cursor-not-allowed' : t.is_occupied ? 'bg-red-900/25 border-red-400/70 cursor-pointer' : 'bg-slate-800/50 border-slate-600/70 hover:border-yellow-300/60 cursor-pointer'} ${viewTableId === t.id ? 'ring-2 ring-yellow-300/70 shadow-[0_0_26px_rgba(250,204,21,0.2)]' : ''}`}
          >
            <span className="font-bold text-xl text-slate-100">{t.label}</span>
            <span className={`mt-3 min-h-10 rounded-full px-5 py-2 text-sm font-bold ${isDirtyTable ? 'bg-slate-300/20 text-slate-100 border border-slate-300/40' : isReservedTable && !t.is_occupied ? 'bg-amber-400/20 text-amber-100 border border-amber-300/50' : t.is_occupied ? 'bg-red-400/20 text-red-200 border border-red-300/50' : 'bg-green-400/20 text-green-200 border border-green-300/50'}`}>
                {isDirtyTable ? tx(lang, 'Təmizlik', 'Уборка', 'Dirty') : isReservedTable && !t.is_occupied ? tx(lang, 'Rezerv', 'Резерв', 'Reserved') : t.is_occupied ? tx(lang, 'Dolu', 'Занято', 'Occupied') : tx(lang, 'Boş', 'Свободно', 'Available')}
            </span>
            {t.assigned_to && (
              <span className="mt-2 rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-100">
                {tx(lang, 'Sahib', 'Ответственный', 'Owner')}: {t.assigned_to}
              </span>
            )}
            {t.is_occupied && (hasDeposit || readyToClose) && (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {hasDeposit && (
                  <span className="rounded-full border border-amber-300/50 bg-amber-400/15 px-3 py-1 text-[11px] font-semibold text-amber-100">
                    {tx(lang, 'Depozit var', 'Есть депозит', 'Has deposit')}
                  </span>
                )}
                {readyToClose && (
                  <span className="rounded-full border border-violet-300/50 bg-violet-400/15 px-3 py-1 text-[11px] font-semibold text-violet-100">
                    {tx(lang, 'Hesaba hazır', 'Готов к счету', 'Ready to bill')}
                  </span>
                )}
              </div>
            )}
            {(Number(t.guest_count || 0) > 0 || new Decimal(t.deposit_amount || 0).greaterThan(0)) && (
              <div className="mt-2 text-center text-[11px] text-slate-300">
                <div>{tx(lang, 'Qonaq', 'Гости', 'Guests')}: {Number(t.guest_count || 0)}</div>
                <div>{tx(lang, 'Depozit', 'Депозит', 'Deposit')}: {new Decimal(t.deposit_amount || 0).toFixed(2)} ₼</div>
              </div>
            )}
            {kitchen && (
              <span className={`mt-2 rounded-full px-3 py-1 text-[11px] font-semibold ${kitchen.className}`}>
                {kitchen.label}
              </span>
            )}
            {t.is_occupied && (readyCount > 0 || waitingCount > 0) && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {readyCount > 0 && (
                  <span className="rounded-full border border-emerald-300/50 bg-emerald-400/20 px-3 py-1 text-xs font-bold text-emerald-100 shadow-[0_0_18px_rgba(74,222,128,0.18)]">
                    {tx(lang, 'Servisə hazır', 'Готово к подаче', 'Ready to serve')}: {readyCount}
                  </span>
                )}
                {waitingCount > 0 && (
                  <span className="rounded-full border border-blue-300/40 bg-blue-400/15 px-3 py-1 text-xs font-semibold text-blue-100">
                    {tx(lang, 'Mətbəxdə', 'На кухне', 'In kitchen')}: {waitingCount}
                  </span>
                )}
              </div>
            )}
            {!t.is_occupied && ['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase()) && (
              <button onClick={(e) => { e.stopPropagation(); setDeleteTableId(t.id); }} className="absolute top-3 right-3 text-slate-400 hover:text-red-300 transition-colors">
                <Trash2 size={18}/>
              </button>
            )}
            {isDirtyTable && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await update_table_layout_live(t.id, { status: 'AVAILABLE' });
                    await Promise.all([loadFloorState(activeFloorId), loadData()]);
                    notify('success', tx(lang, 'Masa təmiz kimi qeyd olundu', 'Стол отмечен как чистый', 'Table marked as clean'));
                  } catch (error: any) {
                    notify('error', error?.message || tx(lang, 'Masa təmizlənmədi', 'Стол не очищен', 'Table was not cleaned'));
                  }
                }}
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-200/50 bg-slate-100/15 px-4 py-3 text-sm font-bold text-slate-100"
              >
                {tx(lang, 'Təmiz kimi işarələ', 'Отметить чистым', 'Mark clean')}
              </button>
            )}
            {t.is_occupied && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPayTableId(t.id);
                  setPaymentMethod('Nəğd');
                  setSplitCount('2');
                  setSplitParts([]);
                  setSplitCash('0');
                }}
                className="mt-4 inline-flex min-h-14 w-full items-center justify-center rounded-2xl border border-yellow-300/60 bg-yellow-400/20 px-4 py-3 text-base font-bold text-yellow-100"
              >
                {tx(lang, 'Hesabı Bağla', 'Закрыть счет', 'Close Bill')}
              </button>
            )}
          </div>
            );
          })()
        ))}
        {tables.length === 0 && (
          <div className="metal-panel col-span-full py-12 text-center text-slate-400 border-2 border-dashed border-slate-600 rounded-2xl">
             {tx(lang, 'Heç bir masa tapılmadı. Zəhmət olmasa "Masa Yarat" düyməsindən istifadə edin.', 'Столы не найдены. Пожалуйста, используйте кнопку "Создать стол".', 'No tables found. Please use the "Create Table" button.')}
          </div>
        )}
      </div>}
    </div>
  );
}
