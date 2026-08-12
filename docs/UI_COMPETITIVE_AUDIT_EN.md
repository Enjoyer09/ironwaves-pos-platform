# Competitive UI Audit — iRonWaves POS (vs. world standards)

> 🌐 **Azərbaycanca versiya:** [UI_COMPETITIVE_AUDIT.md](UI_COMPETITIVE_AUDIT.md)

> This document compares the iRonWaves POS UI against world-class restaurant POS/SaaS platforms (Toast POS, Square for Restaurants, Lightspeed Restaurant, Poster POS, iiko) — where it falls behind aesthetically, functionally, and in speed, each finding backed by code evidence, plus a prioritized action plan. The team should follow this plan for all future UI work.

**Status (2026-08-12):** Audit complete — implementation not started yet. Priorities are in the action plan below.

---

## 1. Summary

| Aspect | State | Distance to world level |
|---|---|---|
| Aesthetics | Fragmented design system (5 different visual languages in one product) | 🟠 Medium — the glass work (UI_AUDIT_GLASS.md) started well, but there is no single system |
| Functional | Strong business logic (finance, tenants, offline), but layout/UX details lag behind | 🟡 Medium-low |
| Speed | Lazy loading ✓, but 2.4MB total JS, 398KB dashboard chunk | 🟠 Optimization required |

---

## 2. Aesthetic gaps

### 2.1 No single design system — 5 different visual languages in one product

| Language | Where | Characteristic |
|---|---|---|
| "Metal & Neon" | Staff (default) | Dark navy `#0e1526` + `#facc15` gold (`:root` tokens) |
| POS2/POS3 | `isNewUiMode` layout | Separate class system (`pos2-*`, `pos3-*`) |
| Tables "classic" | TablesPage | Separate colored gradients for table cards |
| CustomerApp | Customer side | Completely different visual (orange `#F48C24`, retro theme, glass) |
| Mobile Waiter | MobileWaiterUI | Menulux-style solid gradient cards |

**World standard:** one design system + role-based views (Toast/Square) — the same tokens, the same card language across all screens. Today a waiter sees one style in POS, another in Tables, another on the phone.

### 2.2 Inconsistent color semantics

- Different colors for the same meaning: `#facc15` (staff), `#F48C24` (customer), `#d8b156` (glass), `#fbbf24` (tables), fuchsia/violet/cyan (admin).
- Inconsistent status colors: tables `emerald`=free, KDS `emerald`=READY, customer `emerald`=online.
- **World standard:** a semantic color system — status = color, the same everywhere (e.g., one palette for free=occupied=reserved=active=dirty).

### 2.3 Fragmented type scale

- Arbitrary sizes everywhere: `text-[9px]`…`text-[17px]` (TableGrid, KDS, POS cards).
- **World standard:** a 3–4 level type scale (display / title / body / caption) — consistent hierarchy.

### 2.4 Floor plan is not real

- `FloorView` table cells are flat colored grid squares (`bg-emerald-500/15 border-emerald-300/40`), no floor image/background.
- **World standard (Toast, Square, iiko):** a real floor map — tables over a restaurant plan image, shapes/sizes/rotation, walls, bar counter.

---

## 3. Functional gaps

### 3.1 POS layout is not built for fast order entry

- Categories are **horizontal chips** (`pos3-chip`); there is **no persistent left category rail** (`left_widget_order: ['menuHeader','search','categories','productGrid']` — all in one column).
- Product cards are small (`grid-cols-2 md:grid-cols-3 2xl:grid-cols-4`).
- **World standard:** a vertical left category rail (always visible) + large product cards (touch target ≥ 90×90px, frequently ordered items larger) + cart panel on the right. A left rail is critical on landscape tablets.

### 3.2 No keyboard shortcuts

- No `onKeyDown` shortcuts found in POS (0 results).
- Search exists ✓ (`pos-menu-search`, autofocus), but matching is a simple `includes` (`POS.tsx:1005`) — no fuzzy/phonetic.
- **World standard:** shortcuts (F=fire, P=pay, `#`=open item, number+enter) + typo-tolerant search.

### 3.3 Dashboard data overload — no skeletons

- The dashboard loads 10+ data sources at once (`DashboardPanel.tsx:32-41`): sales, finance, inventory, kds, tables, logs, anomalies, AI insights.
- Loading is a simple `snapshot.loading` boolean — **no skeletons** (only PinLogin has skeletons).
- **World standard:** per-KPI-card skeletons + progressive loading.

### 3.4 Weak empty states and guidance

- TableGrid has an empty state ✓; but across the system, empty screens (inventory, CRM, recipes) don't guide the user.
- **World standard:** empty state = "start here" + a call-to-action button.

### 3.5 Optimistic UI is partial

- Table operations (opening a table, sending a round) wait for a server round-trip (`await open_table_live(...)`).
- Offline-first exists ✓, but the delay is felt even online.
- **World standard:** optimistic updates — the UI changes instantly, rolling back on error.

---

## 4. Speed gaps (measured)

| Problem | Size | Cause |
|---|---|---|
| DashboardPanel chunk | **398KB** (gzip ~117KB) — largest chunk | `recharts` (AreaChart, PieChart…) loads together with the dashboard |
| App.tsx | 245KB | All module config + 30+ effects in one file |
| Total JS | **2.4MB** (gzip ~700KB) | 18 admin modules + customer app + PWA |
| Dashboard load | 10+ parallel APIs | No skeletons → "blank screen" feeling |
| Images | Not optimized | `image_url`/`thumbnail` used as-is — no webp/avif/responsive `srcset` |

**Keep what's good:** lazy loading ✓ (each module is a separate chunk), tenant hot-path preload ✓ (App.tsx ~1470: staggered after 500ms), offline-first local SQLite ✓, realtime subscription ✓, VirtualKeyboard + haptics ✓, KDS time-urgency color coding ✓ (15m+ red, 10m+ yellow).

---

## 5. Strengths (protect them)

1. **Business depth:** finance auditing, tenant isolation, deposit/override flows, X/Z reports.
2. **Offline-first:** local DB + sync records — at the Toast/Square level.
3. **Role-based module access** — every role sees its own screens.
4. **Glass UI (Phase 1–3)** — PinLogin and Tables already look world-class (see UI_AUDIT_GLASS.md).
5. **i18n (az/ru/en)**.

---

## 6. Prioritized Action Plan

| # | Priority | Change | Impact | Status |
|---|---|---|---|---|
| 1 | 🔴 High | Split `recharts` out of DashboardPanel into a lazy chunk (400KB→~120KB) | Speed | ✅ **Done (2026-08-12)** — 398KB→34KB shell, recharts in a separate 374KB lazy chunk (Suspense + skeleton, loads only when data is ready) |
| 2 | 🔴 High | POS **left category rail** + larger product cards (≥90px touch target) | Functional + aesthetic | ⏳ |
| 3 | 🟠 Medium | **Semantic color system** — one palette, same status colors everywhere | Aesthetic | ✅ **Done (2026-08-12)** — single palette: Free=emerald, Reserved=amber, Seated=rose, Active=violet, Dirty=slate. Shared `TABLE_STATUS_THEME` + `TABLE_STATUS_LABELS` in `floorUtils.ts` (FloorView legend/map + TableGrid cards read from the same source). Fixed inconsistencies: SEATED sky→rose (map), legend ACTIVE_CHECK rose→violet, added SEATED to legend, unified TableGrid labels. **KDS order statuses unified too:** `ORDER_STATUS_THEME` in `tableUtils.ts` (NEW/SENT=blue, PREPARING/REMAKE/CORRECTION=orange, READY=emerald, VOID_REQUESTED=yellow, VOIDED=rose, COMPED=sky, WASTE=slate, SERVED=violet) — KDS `getStatusColor`/`getStatusBadge`/`kitchenItemTone`, TablesPage and SentItemsSlideUp dots read from the same source. KDS aging escalation (>10m yellow, >15m red) intentionally preserved |
| 4 | 🟠 Medium | POS keyboard shortcuts + fuzzy search | Functional | ⏳ |
| 5 | 🟠 Medium | Dashboard skeletons + KPI prioritization | Speed + aesthetic | ⏳ |
| 6 | 🟡 Low | Real floor map (tables over a plan image) | Functional | ⏳ |
| 7 | 🟡 Low | Image optimization (webp + srcset) | Speed | ⏳ |
| 8 | 🟡 Low | Single type scale + empty-state guidance | Aesthetic | ⏳ |

---

## 7. Double-Check List (after every implementation)

- [ ] `npx tsc --noEmit` — no new errors (the existing 23 are known technical debt)
- [ ] `npm run build` — passes; chunk sizes measured (`ls -la dist/assets/*.js`)
- [ ] Default mode look unchanged (opt-in rule: only `data-ui-mode='new'` / tenant setting)
- [ ] Login → POS → Sale → Print → Z-report flow tested
- [ ] Contrast preserved in light theme
- [ ] UI-only changes — business logic (sales, finance, inventory) untouched

---

## 8. Related Documents

- `docs/UI_AUDIT_GLASS.md` (+ EN) — the macOS glass design system and rollout rules
- `docs/UI_COMPETITIVE_AUDIT.md` — the Azerbaijani version of this document
