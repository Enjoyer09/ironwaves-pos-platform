/**
 * Custom hook for WebSocket realtime subscription.
 * Debounces events, batches scoped refreshes, prevents concurrent execution.
 */
import { useEffect, useRef } from 'react';
import { subscribeTenantRealtime } from '../../api/realtime';
import { get_tables_live } from '../../api/tables';
import { get_kitchen_orders_live } from '../../api/kds';
import { get_floor_state_live, get_reservations_live, get_table_detail_live } from '../../api/restaurant';
import { tablesBootstrapCache, kitchenFeedCache } from './useTablesData';

type Scope = 'tables' | 'kitchen' | 'floor' | 'reservations' | 'detail';

interface UseRealtimeSyncParams {
  tenantId: string;
  isActive: boolean;
  setTables: (tables: any[]) => void;
  setKitchenOrders: (orders: any[]) => void;
  setFloorTables: (tables: any[]) => void;
  setReservations: (rows: any[]) => void;
  setTableDetailRecord: (record: any) => void;
  activeFloorIdRef: React.MutableRefObject<string>;
  viewTableIdRef: React.MutableRefObject<string | null>;
  workspaceViewRef: React.MutableRefObject<string>;
  reservationDateRef: React.MutableRefObject<string>;
  detailFetchSeqRef: React.MutableRefObject<number>;
  isActiveRef: React.MutableRefObject<boolean>;
}

export function useRealtimeSync(params: UseRealtimeSyncParams) {
  const {
    tenantId,
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
  } = params;

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const scopesRef = useRef<Set<Scope>>(new Set());

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive, isActiveRef]);

  useEffect(() => {
    const runRefresh = async () => {
      if (!isActiveRef.current) return;
      if (inFlightRef.current) {
        pendingRef.current = true;
        return;
      }
      inFlightRef.current = true;
      try {
        const currentFloorId = activeFloorIdRef.current;
        const currentViewTableId = viewTableIdRef.current;
        const currentWorkspace = workspaceViewRef.current;
        const scopes = scopesRef.current.size
          ? Array.from(scopesRef.current)
          : ['tables', 'kitchen', 'floor', 'reservations', 'detail'];
        scopesRef.current = new Set();

        const tasks: Array<Promise<any>> = [];
        if (scopes.includes('tables')) {
          tasks.push(
            get_tables_live(tenantId)
              .then((next) => setTables(Array.isArray(next) ? next : []))
              .catch(() => {}),
          );
        }
        if (scopes.includes('kitchen')) {
          tasks.push(
            get_kitchen_orders_live(tenantId)
              .then((next) => setKitchenOrders(Array.isArray(next) ? next : []))
              .catch(() => {}),
          );
        }
        if (scopes.includes('floor') && currentFloorId) {
          tasks.push(
            get_floor_state_live(tenantId, currentFloorId)
              .then((state) => setFloorTables(Array.isArray(state?.tables) ? state.tables : []))
              .catch(() => {}),
          );
        }
        if (scopes.includes('reservations') && currentWorkspace === 'reservations') {
          tasks.push(
            get_reservations_live(tenantId, reservationDateRef.current)
              .then((rows) => setReservations(Array.isArray(rows) ? rows : []))
              .catch(() => {}),
          );
        }
        if (scopes.includes('detail') && currentViewTableId) {
          const seq = ++detailFetchSeqRef.current;
          tasks.push(
            get_table_detail_live(tenantId, currentViewTableId)
              .then((next) => { if (detailFetchSeqRef.current === seq) setTableDetailRecord(next); })
              .catch(() => {}),
          );
        }
        await Promise.all(tasks);
      } finally {
        inFlightRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          void runRefresh();
        }
      }
    };

    const schedule = (scopes: Scope[]) => {
      scopes.forEach((s) => scopesRef.current.add(s));
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => { void runRefresh(); }, 220);
    };

    const unsubscribe = subscribeTenantRealtime(tenantId, (message) => {
      const event = String(message.event || '');
      if (!['floor.updated', 'reservation.updated', 'table.updated', 'check.updated', 'kitchen.updated'].includes(event)) return;
      const payload = message.payload || {};
      const eventTableId = String(payload.table_id || '');
      const currentViewTableId = viewTableIdRef.current;
      tablesBootstrapCache.delete(tenantId);
      if (event === 'kitchen.updated') {
        kitchenFeedCache.delete(tenantId);
      }
      if (!isActiveRef.current) return;
      if (event === 'reservation.updated') {
        schedule(['reservations', 'floor']);
        return;
      }
      if (event === 'kitchen.updated') {
        schedule(eventTableId && currentViewTableId === eventTableId ? ['kitchen', 'detail'] : ['kitchen']);
        return;
      }
      if (event === 'floor.updated') {
        schedule(['floor', 'tables']);
        return;
      }
      schedule(['tables', 'kitchen', 'detail', 'floor']);
    });

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      pendingRef.current = false;
      scopesRef.current = new Set();
      unsubscribe();
    };
  }, [tenantId]);
}
