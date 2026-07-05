/**
 * Zustand store for the Tables module.
 * Organized into logical slices — each slice owns its state + actions.
 * Components subscribe to minimal state via selectors for optimal re-renders.
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { FloorPlanRecord, FloorTableState, ReservationRecord, TableDetailRecord } from '../api/restaurant';
import { localDateInputValue } from '../lib/time';

// ── Slice: Tables Data ───────────────────────────────────────────────────────

interface TablesDataSlice {
  tables: any[];
  kitchenOrders: any[];
  menuCatalog: any[];
  isOnline: boolean;
  setTables: (tables: any[]) => void;
  setKitchenOrders: (orders: any[]) => void;
  setMenuCatalog: (items: any[]) => void;
  setIsOnline: (online: boolean) => void;
}

// ── Slice: Floor Plan ────────────────────────────────────────────────────────

interface FloorSlice {
  floorPlans: FloorPlanRecord[];
  activeFloorId: string;
  floorTables: FloorTableState[];
  floorEditMode: boolean;
  floorViewMode: 'map' | 'list';
  isFloorPlansLoading: boolean;
  selectedFloorTableId: string | null;
  selectedFloorTableIds: string[];
  selectedFloorGroupId: string | null;
  floorMultiSelectMode: boolean;
  setFloorPlans: (plans: FloorPlanRecord[]) => void;
  setActiveFloorId: (id: string) => void;
  setFloorTables: (tables: FloorTableState[]) => void;
  setFloorEditMode: (edit: boolean) => void;
  setFloorViewMode: (mode: 'map' | 'list') => void;
  setIsFloorPlansLoading: (loading: boolean) => void;
  setSelectedFloorTableId: (id: string | null) => void;
  setSelectedFloorTableIds: (ids: string[]) => void;
  setSelectedFloorGroupId: (id: string | null) => void;
  setFloorMultiSelectMode: (mode: boolean) => void;
}

// ── Slice: Reservation ───────────────────────────────────────────────────────

interface ReservationSlice {
  reservations: ReservationRecord[];
  reservationDate: string;
  showReservationCreate: boolean;
  reservationDurationDrafts: Record<string, number>;
  setReservations: (rows: ReservationRecord[]) => void;
  setReservationDate: (date: string) => void;
  setShowReservationCreate: (show: boolean) => void;
  setReservationDurationDrafts: (drafts: Record<string, number>) => void;
}

// ── Slice: Payment ───────────────────────────────────────────────────────────

interface PaymentSlice {
  payTableId: string | null;
  paymentMethod: 'Nəğd' | 'Kart' | 'Split';
  tableDiscountPercent: string;
  tableDiscountReason: string;
  splitCash: string;
  splitCount: string;
  splitParts: Array<{ amount: string; method: 'Nəğd' | 'Kart' }>;
  tableReceiptHtml: string | null;
  setPayTableId: (id: string | null) => void;
  setPaymentMethod: (method: 'Nəğd' | 'Kart' | 'Split') => void;
  setTableDiscountPercent: (percent: string) => void;
  setTableDiscountReason: (reason: string) => void;
  setSplitCash: (cash: string) => void;
  setSplitCount: (count: string) => void;
  setSplitParts: (parts: Array<{ amount: string; method: 'Nəğd' | 'Kart' }>) => void;
  setTableReceiptHtml: (html: string | null) => void;
  resetPayment: () => void;
}

// ── Slice: Detail Panel ──────────────────────────────────────────────────────

interface DetailSlice {
  viewTableId: string | null;
  tableDetailRecord: TableDetailRecord | null;
  tableDetailClosing: boolean;
  tableWorkspaceTab: 'compose' | 'service' | 'history' | 'ops';
  transferTargetId: string;
  mergeTargetId: string;
  setViewTableId: (id: string | null) => void;
  setTableDetailRecord: (record: TableDetailRecord | null) => void;
  setTableDetailClosing: (closing: boolean) => void;
  setTableWorkspaceTab: (tab: 'compose' | 'service' | 'history' | 'ops') => void;
  setTransferTargetId: (id: string) => void;
  setMergeTargetId: (id: string) => void;
}

// ── Slice: UI State ──────────────────────────────────────────────────────────

interface UISlice {
  workspaceView: 'floor' | 'reservations';
  showCreate: boolean;
  openTableId: string | null;
  deleteTableId: string | null;
  pendingCancelTable: { id: string; label: string } | null;
  setWorkspaceView: (view: 'floor' | 'reservations') => void;
  setShowCreate: (show: boolean) => void;
  setOpenTableId: (id: string | null) => void;
  setDeleteTableId: (id: string | null) => void;
  setPendingCancelTable: (table: { id: string; label: string } | null) => void;
}

// ── Slice: Round Composer ────────────────────────────────────────────────────

interface RoundSlice {
  roundSearch: string;
  roundCategory: string;
  roundDraft: any[];
  draftSendError: string | null;
  setRoundSearch: (s: string) => void;
  setRoundCategory: (c: string) => void;
  setRoundDraft: (draft: any[]) => void;
  setDraftSendError: (error: string | null) => void;
  clearRound: () => void;
}

// ── Combined Store Type ──────────────────────────────────────────────────────

export type TablesStoreState = TablesDataSlice & FloorSlice & ReservationSlice
  & PaymentSlice & DetailSlice & UISlice & RoundSlice;

// ── Store Creation ───────────────────────────────────────────────────────────

export const useTablesStore = create<TablesStoreState>()(
  subscribeWithSelector((set) => ({
    // ── Tables Data Slice ──
    tables: [],
    kitchenOrders: [],
    menuCatalog: [],
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    setTables: (tables) => set({ tables }),
    setKitchenOrders: (kitchenOrders) => set({ kitchenOrders }),
    setMenuCatalog: (menuCatalog) => set({ menuCatalog }),
    setIsOnline: (isOnline) => set({ isOnline }),

    // ── Floor Slice ──
    floorPlans: [],
    activeFloorId: '',
    floorTables: [],
    floorEditMode: false,
    floorViewMode: 'list',
    isFloorPlansLoading: true,
    selectedFloorTableId: null,
    selectedFloorTableIds: [],
    selectedFloorGroupId: null,
    floorMultiSelectMode: false,
    setFloorPlans: (floorPlans) => set({ floorPlans }),
    setActiveFloorId: (activeFloorId) => set({ activeFloorId }),
    setFloorTables: (floorTables) => set({ floorTables }),
    setFloorEditMode: (floorEditMode) => set({ floorEditMode }),
    setFloorViewMode: (floorViewMode) => set({ floorViewMode }),
    setIsFloorPlansLoading: (isFloorPlansLoading) => set({ isFloorPlansLoading }),
    setSelectedFloorTableId: (selectedFloorTableId) => set({ selectedFloorTableId }),
    setSelectedFloorTableIds: (selectedFloorTableIds) => set({ selectedFloorTableIds }),
    setSelectedFloorGroupId: (selectedFloorGroupId) => set({ selectedFloorGroupId }),
    setFloorMultiSelectMode: (floorMultiSelectMode) => set({ floorMultiSelectMode }),

    // ── Reservation Slice ──
    reservations: [],
    reservationDate: localDateInputValue(),
    showReservationCreate: false,
    reservationDurationDrafts: {},
    setReservations: (reservations) => set({ reservations }),
    setReservationDate: (reservationDate) => set({ reservationDate }),
    setShowReservationCreate: (showReservationCreate) => set({ showReservationCreate }),
    setReservationDurationDrafts: (reservationDurationDrafts) => set({ reservationDurationDrafts }),

    // ── Payment Slice ──
    payTableId: null,
    paymentMethod: 'Nəğd',
    tableDiscountPercent: '0',
    tableDiscountReason: '',
    splitCash: '0',
    splitCount: '2',
    splitParts: [],
    tableReceiptHtml: null,
    setPayTableId: (payTableId) => set({ payTableId }),
    setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
    setTableDiscountPercent: (tableDiscountPercent) => set({ tableDiscountPercent }),
    setTableDiscountReason: (tableDiscountReason) => set({ tableDiscountReason }),
    setSplitCash: (splitCash) => set({ splitCash }),
    setSplitCount: (splitCount) => set({ splitCount }),
    setSplitParts: (splitParts) => set({ splitParts }),
    setTableReceiptHtml: (tableReceiptHtml) => set({ tableReceiptHtml }),
    resetPayment: () => set({
      payTableId: null,
      paymentMethod: 'Nəğd',
      tableDiscountPercent: '0',
      tableDiscountReason: '',
      splitCash: '0',
      splitCount: '2',
      splitParts: [],
    }),

    // ── Detail Slice ──
    viewTableId: null,
    tableDetailRecord: null,
    tableDetailClosing: false,
    tableWorkspaceTab: 'compose',
    transferTargetId: '',
    mergeTargetId: '',
    setViewTableId: (viewTableId) => set({ viewTableId }),
    setTableDetailRecord: (tableDetailRecord) => set({ tableDetailRecord }),
    setTableDetailClosing: (tableDetailClosing) => set({ tableDetailClosing }),
    setTableWorkspaceTab: (tableWorkspaceTab) => set({ tableWorkspaceTab }),
    setTransferTargetId: (transferTargetId) => set({ transferTargetId }),
    setMergeTargetId: (mergeTargetId) => set({ mergeTargetId }),

    // ── UI Slice ──
    workspaceView: 'floor',
    showCreate: false,
    openTableId: null,
    deleteTableId: null,
    pendingCancelTable: null,
    setWorkspaceView: (workspaceView) => set({ workspaceView }),
    setShowCreate: (showCreate) => set({ showCreate }),
    setOpenTableId: (openTableId) => set({ openTableId }),
    setDeleteTableId: (deleteTableId) => set({ deleteTableId }),
    setPendingCancelTable: (pendingCancelTable) => set({ pendingCancelTable }),

    // ── Round Slice ──
    roundSearch: '',
    roundCategory: 'ALL',
    roundDraft: [],
    draftSendError: null,
    setRoundSearch: (roundSearch) => set({ roundSearch }),
    setRoundCategory: (roundCategory) => set({ roundCategory }),
    setRoundDraft: (roundDraft) => set({ roundDraft }),
    setDraftSendError: (draftSendError) => set({ draftSendError }),
    clearRound: () => set({ roundSearch: '', roundCategory: 'ALL', roundDraft: [], draftSendError: null }),
  }))
);
