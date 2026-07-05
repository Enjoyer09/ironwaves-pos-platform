# Requirements Document

## Introduction

Refactor the monolithic `TablesPage.tsx` component (4800+ lines, 80+ useState hooks, 20+ useEffect hooks) into a maintainable, testable architecture. The component currently handles table grid view, table detail panel, floor plan editor, reservation timeline, payment flow, kitchen round sending, table operations (transfer/combine/split/cancel), and receipt rendering — all within a single file with all state managed via local useState hooks.

The refactoring splits concerns into Zustand store slices, custom hooks for data fetching and realtime sync, pure utility functions for business logic, and focused sub-components — while preserving identical user-facing behavior.

## Glossary

- **Tables_Module**: The complete tables management system within the POS platform, encompassing table grid, detail panel, floor plan, reservations, payment, and kitchen operations
- **TablesPage**: The top-level orchestrator component at `src/components/TablesPage.tsx` that coordinates all tables functionality
- **Tables_Store**: A Zustand store (`src/stores/tablesStore.ts`) managing shared state for the tables module, organized into slices
- **Store_Slice**: A logical partition of the Zustand store (e.g., floor slice, reservation slice, payment slice) with its own state and actions
- **Detail_Panel**: The sub-component showing a selected table's order items, draft round, and operations
- **Floor_Editor**: The sub-component providing drag-and-drop floor plan layout editing
- **Reservation_View**: The sub-component rendering the timeline-based reservation management interface
- **Payment_Modal**: The sub-component handling check settlement with cash/card/split payment methods and discounts
- **Operations_Panel**: The sub-component for table transfer, combine, split, lock, and cancel operations
- **Custom_Hook**: A React hook (e.g., `useTablesData`, `useRealtimeSync`) that encapsulates data fetching, subscriptions, or derived state
- **Pure_Utility**: A framework-agnostic TypeScript function containing business logic, testable without React rendering
- **Realtime_Sync**: The WebSocket subscription system that receives tenant events and triggers scoped data refreshes
- **Round_Composer**: The interface for building and sending kitchen orders (draft items) for a table
- **Bootstrap_Load**: The initial data fetch that loads tables, floor plans, and floor state in a single API call with TTL-based caching

## Requirements

### Requirement 1: Zustand Store Extraction

**User Story:** As a developer, I want table module state managed in a Zustand store with logical slices, so that state is shared cleanly between sub-components without prop drilling and can be tested independently.

#### Acceptance Criteria

1. THE Tables_Store SHALL expose the following slices: tables data slice, floor plan slice, reservation slice, payment slice, detail panel slice, UI state slice, and round composer slice
2. WHEN a Store_Slice action is dispatched, THE Tables_Store SHALL update only the state belonging to that slice without affecting other slices
3. THE Tables_Store SHALL provide selector functions that allow sub-components to subscribe to minimal required state
4. WHEN the TablesPage mounts, THE Tables_Store SHALL be initialized with default values matching the current component defaults (empty arrays, null selections, 'floor' workspace view)
5. THE Tables_Store SHALL maintain referential stability for selector results when unrelated state changes occur (Zustand shallow equality)
6. WHEN the user navigates away from TablesPage, THE Tables_Store SHALL retain cached data to avoid redundant API calls on return within the TTL window (12 seconds for tables bootstrap, 12 seconds for kitchen feed)

### Requirement 2: Custom Hook Extraction for Data Fetching

**User Story:** As a developer, I want data fetching logic encapsulated in custom hooks, so that loading patterns (caching, deduplication, error handling) are reusable and testable in isolation.

#### Acceptance Criteria

1. THE Custom_Hook `useTablesData` SHALL load tables bootstrap data, apply TTL-based caching, and deduplicate concurrent requests using in-flight reference tracking
2. THE Custom_Hook `useTableDetail` SHALL fetch table detail records when a table is selected, use a sequence counter to prevent stale data overwrites, and clear detail when no table is selected
3. THE Custom_Hook `useRealtimeSync` SHALL subscribe to tenant WebSocket events, debounce refresh triggers by 220ms, batch scoped refreshes (tables, kitchen, floor, reservations, detail), and prevent concurrent refresh execution using an in-flight flag with pending re-queue
4. THE Custom_Hook `useFloorPlan` SHALL load floor plan state, track active floor ID, and provide actions for floor table layout persistence
5. THE Custom_Hook `useReservations` SHALL load reservations filtered by date, provide CRUD actions, and only fetch when workspace view is 'reservations'
6. IF a Custom_Hook data fetch fails, THEN THE Custom_Hook SHALL handle the error gracefully without crashing the component (catch and fallback to previous state or empty data)
7. WHEN the `isActive` prop changes to false, THE Custom_Hook `useRealtimeSync` SHALL stop processing incoming WebSocket events until the prop becomes true again

### Requirement 3: Sub-Component Extraction

**User Story:** As a developer, I want the UI split into focused sub-components, so that each component has a single responsibility and can be developed, reviewed, and tested independently.

#### Acceptance Criteria

1. THE Tables_Module SHALL be composed of these sub-components: `TableDetailPanel`, `PaymentModal`, `OperationsPanel`, `FloorEditor`, `ReservationView`, `TableCreateDialog`, and `ReceiptPreview`
2. WHEN a sub-component is rendered, THE sub-component SHALL read its required state from the Tables_Store via selectors rather than receiving all state as props
3. THE TablesPage SHALL remain the top-level orchestrator that mounts sub-components, initializes hooks, and handles workspace-level routing (floor view vs reservations view)
4. WHEN the `TableDetailPanel` sub-component is open, THE `TableDetailPanel` SHALL render the round composer, sent items list, operations tab, and service tab without depending on parent component state beyond the Tables_Store
5. WHEN the `FloorEditor` sub-component is in edit mode, THE `FloorEditor` SHALL handle drag-and-drop table positioning, multi-select, group management, and layout persistence independently
6. WHEN the `ReservationView` sub-component is active, THE `ReservationView` SHALL render the timeline lanes, handle reservation drag-and-drop, resize interactions, and CRUD operations independently

### Requirement 4: Pure Utility Function Extraction

**User Story:** As a developer, I want business logic extracted into pure functions, so that complex calculations and transformations can be unit-tested without React rendering overhead.

#### Acceptance Criteria

1. THE Pure_Utility module `tableUtils.ts` SHALL export functions for: waiter color calculation, kitchen badge resolution, order item status normalization, item action availability determination, and item action manager-approval requirement checking
2. THE Pure_Utility module `paymentUtils.ts` SHALL export functions for: split payment calculation, discount application, service fee computation, deposit calculation, and receipt total derivation
3. THE Pure_Utility module `floorUtils.ts` SHALL export functions for: merged group outline calculation, reservation timeline layout computation, floor summary statistics derivation, and suggested reservation table matching
4. FOR ALL Pure_Utility functions, THE Pure_Utility function SHALL accept explicit parameters and return a deterministic result without accessing React state, DOM, or side effects
5. THE Pure_Utility module `roundUtils.ts` SHALL export functions for: round draft item addition (merge by ID logic), draft quantity update, draft note update, and draft total calculation

### Requirement 5: Behavior Preservation

**User Story:** As a user, I want the refactored tables page to behave identically to the current version, so that my workflows remain uninterrupted.

#### Acceptance Criteria

1. WHEN a table is selected from the grid, THE Tables_Module SHALL open the detail panel with smooth scroll-into-view animation, matching current 200ms close transition timing
2. WHEN a round is sent to the kitchen, THE Tables_Module SHALL validate draft items, call the appropriate API (server-draft send or local-round send), show success/error notifications in the user's language, and refresh table detail
3. WHEN a payment is settled, THE Tables_Module SHALL apply discount, compute service fee, support cash/card/split methods, generate and display receipt HTML, and provide print capability via QZ Tray or local print agent
4. WHEN the WebSocket receives a tenant event, THE Tables_Module SHALL debounce by 220ms, determine affected scopes from event type, and refresh only affected data domains
5. WHEN the device goes offline, THE Tables_Module SHALL update the online status indicator and continue operating with cached data
6. WHEN a table operation (transfer, combine, split, lock, cancel) is performed, THE Tables_Module SHALL execute the API call, refresh affected tables, show appropriate notification, and close the operation UI
7. WHILE the floor editor is in edit mode, THE Tables_Module SHALL support drag-and-drop table positioning, multi-select with group combine/split, table label editing, and layout persistence

### Requirement 6: File Structure and Module Organization

**User Story:** As a developer, I want the refactored code organized in a predictable folder structure, so that new team members can navigate the codebase efficiently.

#### Acceptance Criteria

1. THE Tables_Module SHALL place sub-components in `src/components/tables/` following the existing convention (alongside `TableGrid.tsx`, `MenuGrid.tsx`, `BahaYTableCompose.tsx`, `StickyActionBar.tsx`)
2. THE Tables_Module SHALL place the Zustand store in `src/stores/tablesStore.ts` with slice definitions in `src/stores/tables/` subdirectory
3. THE Tables_Module SHALL place custom hooks in `src/hooks/tables/` directory (e.g., `useTablesData.ts`, `useRealtimeSync.ts`, `useTableDetail.ts`, `useFloorPlan.ts`, `useReservations.ts`)
4. THE Tables_Module SHALL place pure utility functions in `src/utils/tables/` directory (e.g., `tableUtils.ts`, `paymentUtils.ts`, `floorUtils.ts`, `roundUtils.ts`)
5. THE Tables_Module SHALL export a barrel file `src/components/tables/index.ts` that re-exports all public sub-components

### Requirement 7: Independent Testability

**User Story:** As a developer, I want each extracted piece to be independently testable, so that I can write focused unit tests and property-based tests that run fast and catch regressions.

#### Acceptance Criteria

1. THE Pure_Utility functions SHALL be testable with plain unit tests (no React test utilities required) by accepting inputs and returning outputs without side effects
2. THE Tables_Store SHALL be testable by creating store instances in tests and asserting state transitions after dispatching actions
3. THE Custom_Hook functions SHALL be testable using React hook testing utilities with mocked API dependencies
4. THE sub-components SHALL be testable by rendering them with a test Tables_Store provider and asserting rendered output
5. FOR ALL Pure_Utility functions that perform calculations (payment, floor layout, round totals), THE Pure_Utility function SHALL produce deterministic output for any valid input combination (property-based test candidate)
6. FOR ALL round-trip operations (serialize receipt → display receipt), THE operation SHALL preserve semantic content through the transformation (round-trip property)
