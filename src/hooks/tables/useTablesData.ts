/**
 * Custom hook for tables module data fetching.
 * Encapsulates: bootstrap load, table list, kitchen feed, menu catalog,
 * floor state, restaurant data, reservations.
 * All functions use in-flight dedup and TTL caching.
 */
import { useRef, useCallback } from 'react';
import { get_tables_live } from '../../api/tables';
import { get_kitchen_orders_live } from '../../api/kds';
import { get_menu_items_live } from '../../api/menu';
import {
  get_floor_plans_live,
  get_floor_state_live,
  get_tables_bootstrap_live,
  get_reservations_live,
  get_table_detail_live,
  type TablesBootstrapRecord,
} from '../../api/restaurant';

const TABLES_BOOTSTRAP_TTL_MS = 12_000;
const KITCHEN_FEED_TTL_MS = 12_000;

// Module-level caches (shared across hook instances — matches original behavior)
const tablesBootstrapCache = new Map<string, { at: number; data: TablesBootstrapRecord }>();
const kitchenFeedCache = new Map<string, { at: number; data: any[] }>();

export { tablesBootstrapCache, kitchenFeedCache };

interface UseTablesDataParams {
  tenantId: string;
  setTables: (tables: any[]) => void;
  setKitchenOrders: (orders: any[]) => void;
  setMenuCatalog: (items: any[]) => void;
  setFloorPlans: (plans: any[]) => void;
  setFloorTables: (tables: any[]) => void;
  setActiveFloorId: (id: string) => void;
  setIsFloorPlansLoading: (loading: boolean) => void;
  setReservations: (rows: any[]) => void;
  setTableDetailRecord: (record: any) => void;
  activeFloorIdRef: React.MutableRefObject<string>;
  workspaceViewRef: React.MutableRefObject<string>;
  reservationDateRef: React.MutableRefObject<string>;
  skipNextFloorStateLoadRef: React.MutableRefObject<string>;
  detailFetchSeqRef: React.MutableRefObject<number>;
}

export function useTablesData(params: UseTablesDataParams) {
  const {
    tenantId,
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
  } = params;

  const loadDataInFlightRef = useRef(false);
  const loadBootstrapInFlightRef = useRef(false);
  const bootstrapRevalidateInFlightRef = useRef(false);
  const loadKitchenFeedInFlightRef = useRef(false);
  const loadMenuCatalogInFlightRef = useRef(false);
  const loadReservationsInFlightRef = useRef(false);
  const loadRestaurantInFlightRef = useRef(false);

  const loadData = useCallback(async () => {
    if (loadDataInFlightRef.current) return;
    loadDataInFlightRef.current = true;
    try {
      const nextTables = await get_tables_live(tenantId);
      const safeTables = Array.isArray(nextTables) ? nextTables : [];
      setTables(safeTables);
      const cached = tablesBootstrapCache.get(tenantId);
      if (cached?.data) {
        tablesBootstrapCache.set(tenantId, { at: Date.now(), data: { ...cached.data, tables: safeTables } });
      }
    } finally {
      loadDataInFlightRef.current = false;
    }
  }, [tenantId, setTables]);

  const applyTablesBootstrap = useCallback((bootstrap: TablesBootstrapRecord | null | undefined) => {
    if (!bootstrap) return;
    const nextFloorPlans = Array.isArray(bootstrap.floor_plans) ? bootstrap.floor_plans : [];
    const nextFloorState = bootstrap.floor_state;
    const nextActiveFloorId = String(nextFloorState?.floor?.id || nextFloorPlans.find((row) => row.is_active)?.id || nextFloorPlans[0]?.id || '');
    setTables(Array.isArray(bootstrap.tables) ? bootstrap.tables : []);
    setFloorPlans(nextFloorPlans);
    setFloorTables(Array.isArray(nextFloorState?.tables) ? nextFloorState.tables : []);
    if (nextActiveFloorId) {
      skipNextFloorStateLoadRef.current = nextActiveFloorId;
      setActiveFloorId(nextActiveFloorId);
    } else {
      setActiveFloorId('');
    }
  }, [setTables, setFloorPlans, setFloorTables, setActiveFloorId, skipNextFloorStateLoadRef]);

  const loadTablesBootstrap = useCallback(async (opts: { force?: boolean; background?: boolean } = {}) => {
    const cacheKey = tenantId;
    const cached = tablesBootstrapCache.get(cacheKey);
    const now = Date.now();
    const isFresh = cached && now - cached.at < TABLES_BOOTSTRAP_TTL_MS;
    if (!opts.force && cached?.data) {
      applyTablesBootstrap(cached.data);
      if (isFresh) {
        setIsFloorPlansLoading(false);
        return;
      }
    }
    if (loadBootstrapInFlightRef.current || bootstrapRevalidateInFlightRef.current) return;
    if (opts.background || cached?.data) {
      bootstrapRevalidateInFlightRef.current = true;
    } else {
      loadBootstrapInFlightRef.current = true;
    }
    if (!cached?.data && !opts.background) {
      setIsFloorPlansLoading(true);
    }
    try {
      const bootstrap = await get_tables_bootstrap_live(tenantId);
      tablesBootstrapCache.set(cacheKey, { at: Date.now(), data: bootstrap });
      applyTablesBootstrap(bootstrap);
    } catch {
      if (!cached?.data) {
        await Promise.allSettled([loadData(), loadRestaurantData()]);
      }
    } finally {
      setIsFloorPlansLoading(false);
      loadBootstrapInFlightRef.current = false;
      bootstrapRevalidateInFlightRef.current = false;
    }
  }, [tenantId, applyTablesBootstrap, setIsFloorPlansLoading, loadData]);

  const forceTablesBootstrapRefresh = useCallback(async () => {
    tablesBootstrapCache.delete(tenantId);
    await loadTablesBootstrap({ force: true });
  }, [tenantId, loadTablesBootstrap]);

  const loadKitchenFeed = useCallback(async (opts: { force?: boolean } = {}) => {
    const cacheKey = tenantId;
    const cached = kitchenFeedCache.get(cacheKey);
    const now = Date.now();
    if (!opts.force && cached?.data && now - cached.at < KITCHEN_FEED_TTL_MS) {
      setKitchenOrders(cached.data);
      return;
    }
    if (loadKitchenFeedInFlightRef.current) return;
    loadKitchenFeedInFlightRef.current = true;
    try {
      const nextOrders = await get_kitchen_orders_live(tenantId);
      const safeOrders = Array.isArray(nextOrders) ? nextOrders : [];
      kitchenFeedCache.set(cacheKey, { at: Date.now(), data: safeOrders });
      setKitchenOrders(safeOrders);
    } finally {
      loadKitchenFeedInFlightRef.current = false;
    }
  }, [tenantId, setKitchenOrders]);

  const loadMenuCatalog = useCallback(async () => {
    if (loadMenuCatalogInFlightRef.current) return;
    loadMenuCatalogInFlightRef.current = true;
    try {
      const nextMenu = await get_menu_items_live(tenantId);
      setMenuCatalog(Array.isArray(nextMenu) ? nextMenu : []);
    } finally {
      loadMenuCatalogInFlightRef.current = false;
    }
  }, [tenantId, setMenuCatalog]);

  const loadReservations = useCallback(async () => {
    if (workspaceViewRef.current !== 'reservations') return;
    if (loadReservationsInFlightRef.current) return;
    loadReservationsInFlightRef.current = true;
    try {
      const rows = await get_reservations_live(tenantId, reservationDateRef.current);
      setReservations(Array.isArray(rows) ? rows : []);
    } finally {
      loadReservationsInFlightRef.current = false;
    }
  }, [tenantId, workspaceViewRef, reservationDateRef, setReservations]);

  const loadRestaurantData = useCallback(async () => {
    if (loadRestaurantInFlightRef.current) return;
    loadRestaurantInFlightRef.current = true;
    setIsFloorPlansLoading(true);
    try {
      const floors = await get_floor_plans_live(tenantId);
      setFloorPlans(Array.isArray(floors) ? floors : []);
    } finally {
      setIsFloorPlansLoading(false);
      loadRestaurantInFlightRef.current = false;
    }
    if (workspaceViewRef.current === 'reservations') {
      await loadReservations();
    }
  }, [tenantId, setFloorPlans, setIsFloorPlansLoading, workspaceViewRef, loadReservations]);

  const loadFloorState = useCallback(async (floorId: string) => {
    const state = await get_floor_state_live(tenantId, floorId).catch(() => null);
    if (!state) return;
    const safeTables = Array.isArray(state.tables) ? state.tables : [];
    setFloorTables(safeTables);
    const cached = tablesBootstrapCache.get(tenantId);
    if (cached?.data) {
      tablesBootstrapCache.set(tenantId, {
        at: Date.now(),
        data: { ...cached.data, floor_state: { ...state, tables: safeTables } },
      });
    }
  }, [tenantId, setFloorTables]);

  const refreshActiveTableDetail = useCallback(async (tableId: string) => {
    const seq = ++detailFetchSeqRef.current;
    await Promise.all([
      loadData(),
      activeFloorIdRef.current ? loadFloorState(activeFloorIdRef.current) : Promise.resolve(),
      get_table_detail_live(tenantId, tableId).then((next) => {
        if (detailFetchSeqRef.current === seq) setTableDetailRecord(next);
      }).catch(() => {}),
    ]);
  }, [tenantId, loadData, loadFloorState, activeFloorIdRef, detailFetchSeqRef, setTableDetailRecord]);

  return {
    loadData,
    loadTablesBootstrap,
    forceTablesBootstrapRefresh,
    loadKitchenFeed,
    loadMenuCatalog,
    loadReservations,
    loadRestaurantData,
    loadFloorState,
    refreshActiveTableDetail,
  };
}
