# Implementation Plan: TablesPage Refactor

## Overview

Refactor the monolithic TablesPage.tsx (4800+ lines) into a layered architecture with Zustand store, custom hooks, pure utilities, and focused sub-components. Migration is phased to ensure zero regression — each task produces a buildable, working state.

## Tasks

- [x] 1. Extract pure utility functions into `src/utils/tables/tableUtils.ts` — move getWaiterColor, kitchenBadge, normalizeOrderItemStatus, sentItemActions, itemActionNeedsManager, formatDisplayId from TablesPage.tsx. Update imports in TablesPage. Verify build passes.
- [x] 2. Extract payment calculation logic into `src/utils/tables/paymentUtils.ts` — create calculatePaymentBreakdown, buildEqualSplitParts, normalizeSplitCount, rebalanceSplitParts, isBillablePaymentItem pure functions. TablesPage payment section calls new utilities. Verify build passes.
- [x] 3. Extract floor plan utilities into `src/utils/tables/floorUtils.ts` — move computeMergedGroupOutlines, computeReservationTimeline, computeFloorSummary, suggestReservationTables from useMemo bodies into pure functions. TablesPage useMemos call new utilities. Verify build passes.
- [x] 4. Extract round/menu utilities into `src/utils/tables/roundUtils.ts` — move filteredRoundMenu logic into filterMenuByCategory, draft item manipulation into addItemToDraft/updateDraftItemQty/calculateDraftTotal. Verify build passes.
- [x] 5. Create Zustand store at `src/stores/tablesStore.ts` with 7 typed slices (tables, floor, reservation, payment, detail, ui, round) using subscribeWithSelector middleware. Define all state fields and action functions matching current useState defaults. Verify build passes.
- [x] 6. Integrate store with dual-write — in TablesPage, after each setState call also dispatch corresponding store action (store mirrors local state). This is a temporary step to verify store behavior matches. Verify build passes.
- [x] 7. Extract `src/hooks/tables/useRealtimeSync.ts` — move WebSocket subscription, scheduleRealtimeRefresh, runRealtimeRefresh logic. Hook reads refs for current floor/view/workspace, writes to store. Remove old useEffect from TablesPage. Verify realtime sync works.
- [x] 8. Extract `src/hooks/tables/useTablesData.ts` — move loadTablesBootstrap, loadData, loadFloorState, loadKitchenFeed, loadMenuCatalog with TTL cache and in-flight dedup. Hook writes to store. Remove old functions from TablesPage. Verify initial load works.
- [ ] 9. Extract `src/hooks/tables/useFloorPlan.ts` — move floor plan CRUD, table layout persistence, drag-drop handlers. Hook reads/writes store FloorSlice. Verify floor editor works.
- [ ] 10. Extract `src/hooks/tables/useReservations.ts` — move reservation CRUD, seat, reschedule, duration change, loadReservations with date filter. Hook reads/writes store ReservationSlice. Verify reservations work.
- [ ] 11. Extract `src/hooks/tables/useTableDetail.ts` — move detail fetch with sequence counter, refreshActiveTableDetail, detail-related effects (clear on unoccupied, scrollIntoView). Hook reads/writes store DetailSlice. Verify table detail works.
- [x] 12. Extract `src/components/tables/ReceiptPreview.tsx` — move receipt iframe rendering and print buttons. Props: html, onClose, onPrint, lang. TablesPage renders ReceiptPreview instead of inline JSX. Verify receipt display works.
- [ ] 13. Extract `src/components/tables/PaymentModal.tsx` — move entire payment flow UI (method select, discount input, split, settle button). Reads PaymentSlice from store. Contains settle handler. Verify payment flow works.
- [x] 14. Extract `src/components/tables/OperationsPanel.tsx` — move transfer/combine/split/cancel card UI from ops tab. Props: table, otherTables, isManagerUser, userCanEditTable, lang. Verify operations work with confirm dialogs.
- [x] 14b. Extract bonus sub-components: OpenTableDialog, ItemActionModal, RevisionModal, StatusLogModal, CreateFloorPlanDialog, CreateReservationDialog, DeleteAuthDialog, ServiceTab, HistoryTab, FullOrderListModal, SentItemsSlideUp, FloorTableEditor — all modals and tabs extracted from TablesPage inline JSX.
- [ ] 15. Extract `src/components/tables/FloorEditor.tsx` — move floor plan edit mode UI (drag-drop grid, multi-select, shape editors, group combine). Reads FloorSlice from store. Verify floor editing works.
- [ ] 16. Extract `src/components/tables/ReservationView.tsx` — move timeline rendering, drag-to-reschedule, resize, CRUD dialogs. Reads ReservationSlice from store. Verify reservations work.
- [ ] 17. Extract `src/components/tables/TableDetailPanel.tsx` — move full-screen detail overlay (header, tabs, compose/service/history/ops). Reads DetailSlice + RoundSlice from store. Contains BahaYTableCompose/MenuGrid mounting. Verify table detail works.
- [ ] 18. Remove dual-write and switch to store-only state — remove all local useState that are now in store. Sub-components read from store directly. TablesPage becomes pure orchestrator (~200 lines). Verify full functionality.
- [ ] 19. Create barrel export files — `src/components/tables/index.ts`, `src/hooks/tables/index.ts`, `src/utils/tables/index.ts`. Verify build passes.
- [ ] 20. Final verification — test all flows: module transitions, realtime updates, offline mode, payment end-to-end, table operations, floor editor, reservations, mobile responsive, build size check.

## Task Dependency Graph

```json
{
  "waves": [
    [1, 2, 3, 4],
    [5],
    [6],
    [7, 8, 9, 10, 11],
    [12, 13, 14, 15, 16, 17],
    [18],
    [19],
    [20]
  ]
}
```

- Wave 1 (Tasks 1-4): Independent pure utility extraction, can run in parallel
- Wave 2 (Task 5): Zustand store creation, depends on utility types from wave 1
- Wave 3 (Task 6): Dual-write integration, depends on store from wave 2
- Wave 4 (Tasks 7-11): Hook extraction, each depends on store (wave 3)
- Wave 5 (Tasks 12-17): Sub-component extraction, depends on hooks (wave 4)
- Wave 6 (Task 18): Remove dual-write, depends on all sub-components (wave 5)
- Wave 7 (Task 19): Barrel exports, depends on cleanup (wave 6)
- Wave 8 (Task 20): Final verification, depends on everything

## Notes

- Each task must end with a successful `npx vite build` — no broken intermediate states
- Behavior preservation is verified manually at each step (same UX, same animations, same notifications)
- The dual-write phase (Task 6) is temporary scaffolding removed in Task 18
- Store slices use Zustand's `subscribeWithSelector` for optimal re-render control
- All existing tests (if any) must continue passing after each task
