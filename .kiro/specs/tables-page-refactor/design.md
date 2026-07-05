# Technical Design — TablesPage Refactor

## Overview

Refactor the monolithic `TablesPage.tsx` (4800+ lines, 80+ useState, 20+ useEffect) into a layered architecture: Zustand store for shared state, custom hooks for data fetching/realtime, pure utility functions for business logic, and focused sub-components. Migration is phased (5 phases, 20 tasks) to ensure zero regression.

## Architecture

The refactored TablesPage follows a layered architecture:

```
┌─────────────────────────────────────────────────────────┐
│  TablesPage.tsx (Orchestrator — ~200 lines)             │
│  - Mounts hooks, renders sub-components by workspace    │
├─────────────────────────────────────────────────────────┤
│  Sub-Components (src/components/tables/)                │
│  TableDetailPanel, PaymentModal, OperationsPanel,       │
│  FloorEditor, ReservationView, TableCreateDialog,       │
│  ReceiptPreview                                         │
├─────────────────────────────────────────────────────────┤
│  Custom Hooks (src/hooks/tables/)                       │
│  useTablesData, useTableDetail, useRealtimeSync,        │
│  useFloorPlan, useReservations, usePayment              │
├─────────────────────────────────────────────────────────┤
│  Zustand Store (src/stores/tablesStore.ts)              │
│  7 slices: tables, floor, reservation, payment,         │
│  detail, ui, round                                      │
├─────────────────────────────────────────────────────────┤
│  Pure Utilities (src/utils/tables/)                     │
│  tableUtils, paymentUtils, floorUtils, roundUtils       │
└─────────────────────────────────────────────────────────┘
```

Data flow: User Action → Hook → Store Action → Selector → Sub-Component Re-render.

WebSocket events flow through `useRealtimeSync` hook → debounce → scoped refresh → store update → affected components re-render.

## Components and Interfaces

### TablesPage (Orchestrator)
- Mounts all hooks: useTablesData, useTableDetail, useRealtimeSync, useFloorPlan, useReservations
- Renders workspace: FloorEditor (default) or ReservationView
- Conditionally renders overlays: TableDetailPanel, PaymentModal, ReceiptPreview

### TableDetailPanel
- Full-screen fixed overlay (`fixed inset-0 z-[90]`)
- Reads: `viewTableId`, `tableDetailRecord`, `tableWorkspaceTab` from store
- Contains: BahaYTableCompose/MenuGrid, OperationsPanel, service tab, history tab

### PaymentModal
- Renders when `payTableId !== null`
- Props: `tenantSettings`, `businessProfile`
- Self-contained: method selection, discount presets, split inputs, settle button
- On success: calls store.resetPayment(), generates receipt

### OperationsPanel
- Props: `table`, `otherTables`, `isManagerUser`, `userCanEditTable`, `lang`
- Contains: Transfer picker, Combine picker, Split button, Cancel button
- Each operation has confirm dialog + audit log

### FloorEditor
- Reads: FloorSlice from store
- Drag-and-drop grid, multi-select, table shape/capacity editors
- Layout persistence via useFloorPlan hook

### ReservationView
- Reads: ReservationSlice from store
- Timeline lanes, drag-to-reschedule, resize handle, CRUD dialogs

### ReceiptPreview
- Props: `html: string | null`, `onClose`, `onPrint`, `lang`
- Sanitized iframe + print buttons

### Custom Hooks Interface
```typescript
// useTablesData
function useTablesData(tenantId: string, isActive: boolean): {
  loadData: () => Promise<void>;
  loadFloorState: (floorId: string) => Promise<void>;
  loadMenuCatalog: () => Promise<void>;
};

// useTableDetail
function useTableDetail(tenantId: string): {
  refreshActiveTableDetail: (tableId: string) => Promise<void>;
};

// useRealtimeSync
function useRealtimeSync(tenantId: string, isActive: boolean): void;

// useFloorPlan
function useFloorPlan(tenantId: string): {
  createFloorPlan: (name: string, width: number, height: number) => Promise<void>;
  updateTableLayout: (tableId: string, payload: any) => Promise<void>;
  deleteFloorPlan: (floorId: string) => Promise<void>;
};

// useReservations
function useReservations(tenantId: string): {
  loadReservations: () => Promise<void>;
  createReservation: (payload: any) => Promise<void>;
  updateReservation: (id: string, payload: any) => Promise<void>;
  deleteReservation: (id: string) => Promise<void>;
  seatReservation: (id: string, tableId: string) => Promise<void>;
};
```

## Data Models

### Store State Shape
```typescript
interface TablesStoreState {
  // TablesSlice
  tables: Table[];
  kitchenOrders: KitchenOrder[];
  menuCatalog: MenuItem[];
  isOnline: boolean;

  // FloorSlice
  floorPlans: FloorPlanRecord[];
  activeFloorId: string;
  floorTables: FloorTableState[];
  floorEditMode: boolean;
  floorViewMode: 'map' | 'list';
  selectedFloorTableId: string | null;
  selectedFloorTableIds: string[];

  // ReservationSlice
  reservations: ReservationRecord[];
  reservationDate: string;

  // PaymentSlice
  payTableId: string | null;
  paymentMethod: 'Nəğd' | 'Kart' | 'Split';
  tableDiscountPercent: string;
  tableDiscountReason: string;
  splitCash: string;
  splitParts: Array<{ amount: string; method: 'Nəğd' | 'Kart' }>;
  tableReceiptHtml: string | null;

  // DetailSlice
  viewTableId: string | null;
  tableDetailRecord: TableDetailRecord | null;
  tableDetailClosing: boolean;
  tableWorkspaceTab: 'compose' | 'service' | 'history' | 'ops';

  // UISlice
  workspaceView: 'floor' | 'reservations';
  openTableId: string | null;
  deleteTableId: string | null;
  pendingCancelTable: { id: string; label: string } | null;

  // RoundSlice
  roundSearch: string;
  roundCategory: string;
  roundDraft: DraftItem[];
  draftSendError: string | null;
}
```

### Pure Utility Function Signatures
```typescript
// tableUtils.ts
type WaiterColor = { bg: string; border: string; text: string; dot: string };
function getWaiterColor(waiter: string): WaiterColor | null;
function normalizeOrderItemStatus(status: string): string;

// paymentUtils.ts
interface PaymentBreakdown {
  itemsTotal: Decimal;
  discountAmount: Decimal;
  discountedItemsTotal: Decimal;
  serviceFeeAmount: Decimal;
  depositAmount: Decimal;
  extraDue: Decimal;
  payableTotal: Decimal;
}
function calculatePaymentBreakdown(params: PaymentParams): PaymentBreakdown;

// floorUtils.ts
interface GroupOutline { id: string; left: string; width: string; top: string; height: string; label: string }
function computeMergedGroupOutlines(groups, floorPlans, activeFloorId): GroupOutline[];
```

## Correctness Properties

### Property 1: Payment Calculation Determinism
**Validates: Requirement 4.2**
For any valid combination of items, discount percent (0-50), service fee percent (0-20), and deposit amount, `calculatePaymentBreakdown` must return identical results and the breakdown must satisfy: `payableTotal = max(discountedItemsTotal + serviceFeeAmount, depositAmount)`.

### Property 2: Realtime Fetch Ordering
**Validates: Requirement 2.3**
The detail fetch sequence counter guarantees that if fetch A starts before fetch B, and B completes before A, A's result is discarded. Only the result matching the latest sequence number is applied to state.

### Property 3: Store Slice Isolation
**Validates: Requirement 1.5**
Dispatching an action on one slice (e.g., `setPaymentMethod`) must not trigger re-renders in components that only subscribe to a different slice (e.g., FloorSlice). Verified via Zustand's shallow equality.

### Property 4: Animation Cancellation Safety
**Validates: Requirement 5.1**
If `closeTableDetail()` starts a 200ms timeout and `setViewTableId(newId)` is called before the timeout fires, the timeout is cancelled and the new table opens without interference.

### Property 5: Offline Idempotency
**Validates: Requirement 5.5**
All offline-queued operations must be idempotent — if the same operation is synced twice (due to retry), the second execution either succeeds silently or is recognized as already-applied.

## Error Handling

1. **API failures in hooks**: Each hook catches errors from API calls and falls back to previous state. Notifications are dispatched to the user via the store's notify action.
2. **Store action safety**: All store actions validate inputs before mutation. Invalid state transitions (e.g., settling a null payTableId) are no-ops.
3. **Component error boundaries**: Each major sub-component (TableDetailPanel, PaymentModal, FloorEditor) should be wrapped in an error boundary to prevent cascading failures.
4. **Offline graceful degradation**: Hooks detect offline state and skip network calls, using cached localStorage data instead.

## Testing Strategy

1. **Pure utilities**: Direct unit tests with assertions. Property-based tests for paymentUtils (any valid inputs → valid breakdown that sums correctly).
2. **Store**: Create isolated store instances in tests, dispatch actions, assert final state.
3. **Hooks**: Use `@testing-library/react-hooks` with mocked API modules and store providers.
4. **Sub-components**: Render with test store providers, assert UI output for given state.
5. **Integration**: After full migration, verify key flows (open table → add items → send to kitchen → settle → receipt) with a connected test that exercises hooks + store + components together.
