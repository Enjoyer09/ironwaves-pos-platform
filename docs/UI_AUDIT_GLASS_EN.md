# UI Audit & macOS Glass Plan — iRonWaves POS

> 🌐 **Azərbaycanca versiya:** [UI_AUDIT_GLASS.md](UI_AUDIT_GLASS.md)

> This document describes the current state of the UI, the migration plan toward a macOS-style glass (frosted glass) design system, and the rules for applying it safely in production. The team should follow this plan for all future glass work.

**Status (2026-08):** Phase 1 (glass token system + `data-ui-mode` wiring) and the PinLogin glass are implemented. Status is noted per item in the sections below.

---

## 1. Goal

1. Bring a macOS "Ventura/Sonoma"-style **soft glass** effect to all staff screens (POS, Tables, KDS, Admin): translucency + `backdrop-blur`, hairline borders, soft layered shadows, inner highlight.
2. **Reduce eye strain:** soften the saturated yellow accent (`#facc15`) to a desaturated gold (`#d8b156`), and lower saturation to 140%.
3. **Production safety:** every change must be OFF by default / reversible; the existing look running in cafés must not be broken.

---

## 2. Current state (audit findings)

| Aspect | State | Note |
|---|---|---|
| Overall style | "Metal & Neon" | Dark navy (`#0e1526`), gold (`#facc15`) |
| Glassmorphism | Customer app only | `cust-glass`: `blur(24px) saturate(180%)` |
| Staff screens | Opaque (90–96%) | `backdrop-filter` has no effect (nothing behind to blur) |
| Light theme | Exists, well built | 3-level depth: `#f1f5f9 → #ffffff → shadow` |
| `html[data-ui-mode='new']` CSS | **Was dead code → now wired up** | Previously `App.tsx` always wrote `'old'` |

### 2.1 Critical technical findings

1. **`data-ui-mode` was hardcoded.** `App.tsx` line ~746: `root.setAttribute('data-ui-mode', 'old')` — the ~500 lines of CSS under `html[data-ui-mode='new']` never ran. **Fixed:** it is now bound to the `session_settings.ui_mode` setting (default `'old'`).
2. **POS "modern" mode was incomplete.** `POS.tsx` `isNewUiMode` runs on its own separate logic (`localStorage iw_pos_ui_mode` / `tables_ui_mode==='modern'`), but the `pos2-shell` background was defined under `data-ui-mode='new'` — it never activated. **Was still an open gap** (see §9 — now closed).
3. **Lightning CSS + Chrome `-webkit-backdrop-filter` issue.** Modern Chrome ignores `-webkit-backdrop-filter`. When a `backdrop-filter` + `-webkit-backdrop-filter` pair is written in the same block, Lightning CSS dedupes the pair down to only the `-webkit-` form → the blur silently dies in Chrome. **Rule: write only unprefixed `backdrop-filter` in glass CSS.**

---

## 3. Glass Token System (Phase 1 — implemented)

Added to `src/index.css` (at `:root` level, with the "GLASS UI LAYER" block at the end of `@layer components`):

```css
:root {
  --glass-blur: 18px;          /* panel blur */
  --glass-saturate: 140%;      /* saturation (customer app 180% → 140%) */
  --glass-border: rgba(255, 255, 255, 0.10);   /* hairline border */
  --glass-highlight: rgba(255, 255, 255, 0.08); /* inner highlight */
  --glass-accent: #d8b156;     /* desaturated gold (accent) */
  --glass-accent-deep: #c9a24b;
}
```

**Activation condition:** only when `html[data-ui-mode="new"]`. If a tenant sets `session_settings.ui_mode === 'new'`, glass applies to all staff screens. Default `'old'` → nothing changes.

**Elements covered by the glass layer:**
- Panels: `.metal-panel`, `.pos2-checkout-pane`, `.pos3-checkout/menu/header`, `.staff-pos-header/main`, `.staff-cart-panel`
- Buttons: `.neon-btn/chip/tab`, `.pay-btn`, `.neon-item` — `blur(14px)`
- Inputs: `.neon-input` — `blur(12px)`
- Cards: `.pos2-product-card`, `.pos3-card`, `.staff-product-card`, `.staff-recent-card`
- Active states: `#d8b156 → #c9a24b` gradient, dark text `#161006`
- Vibrancy blobs on the `.metal-app` background (content for the blur to frost)

**Fallbacks:**
- `@supports not (backdrop-filter)` → panels fall back to solid dark (readability preserved)
- `@media (prefers-reduced-transparency: reduce)` → blur disabled, solid background

**Related change:** `src/App.tsx` — `data-ui-mode` is now bound to `settings.session_settings.ui_mode`.

---

## 4. PinLogin Glass (implemented)

`src/components/PinLogin.tsx` — only this file changed:

- **Background:** the right panel moved from flat dark to soft radial blobs (`LOGIN_BG_GRADIENT`: gold/blue/teal, each ~10–16% alpha).
- **Card:** `GLASS_CARD` = `bg-white/[0.07]` + `backdrop-blur-[18px]` + `backdrop-saturate-[140%]` + `border-white/10` + soft layered shadow.
- **Left panel (over the restaurant image):** `GLASS_CARD_OVER_IMAGE` = dark frosted `rgba(13,18,28,0.55)` — for readability over bright photos.
- **Accent:** all `#facc15`/`#f59e0b` → `#d8b156 → #c9a24b`, dark text `#161006`.
- **Note:** This change is **on by default** — every tenant's login screen will look glass from the next deploy onward (unlike Phase 1, this is not opt-in; it is a deliberate decision).

---

## 5. Contrast Analysis (WCAG 2.x)

Computed with relative luminance + the contrast formula (via a script such as `node /tmp/contrast.mjs`). Short summary:

### 5.1 Accent as background + dark text (button label)

| Accent | `#111827` text | `#161006` text | White text |
|---|---|---|---|
| `#facc15` (current) | 11.58 AAA | 12.34 AAA | 1.53 ❌ |
| `#b45309` (old `--gold-b`, now `#c9a24b`) | **3.53 ⚠️** | 3.76 ⚠️ | 5.02 AA — kept as text |
| `#d8b156` (proposed) | **8.74 AAA** | **9.31 AAA** | 2.03 ❌ |
| `#c9a24b` (proposed) | **7.39 AAA** | **7.88 AAA** | 2.40 ❌ |
| `#e8c877` (light text) | 10.95 AAA | 11.67 AAA | 1.62 ❌ |

### 5.2 Accent as text (dark backgrounds)

| Accent | Contrast | | Accent | Contrast |
|---|---|---|---|---|
| `#facc15` | 11.88 AAA | | `#d8b156` | 8.96 AAA |
| `#fcd34d` (prices) | 12.62 AAA | | `#e8c877` | 11.23 AAA |
| `#fbbf24` | 10.90 AAA | | `#c9a24b` | 7.59 AAA |

### 5.3 Critical conclusions

1. **`#b45309` contrast bug:** the `neon-btn-active` gradient bottom is only 3.53:1 against dark text — fails AA for normal text. The `#d8b156→#c9a24b` transition fixes this (7.39 AAA). **✅ Done (2026-08-12):** `--gold-b` set to `#c9a24b` in both `:root` and `:root[data-ui-mode='new']` — the gradient bottom is now `#c9a24b` in all old/light/new variants (build + visual check passed).
2. **White text on gold is forbidden** (FAIL in all shades). CustomerApp toasts (`#F48C24` + white text = 2.44:1) need a separate fix.
3. **No gold text in light theme:** light gold (`#fcd34d`) on a white card is 1.44:1 — at least `#b45309` (5.02 AA) must be used.
4. **Keep bright yellow for KDS** — the kitchen screen is read from a distance (`#facc15` + `#0f172a` = 13.17 AAA).
5. **POS accent is tenant-based** (`pos_layout.accent_color`, default `#facc15`) — making the default `#d8b156` applies to new tenants; existing tenants' values stay untouched.

---

## 6. Screen-by-Screen Implementation Plan (priority + status)

| Priority | Screen | Proposal | Status |
|---|---|---|---|
| 🥇 1 | **PinLogin** | Background blobs + glass card + `#d8b156` | ✅ **Done** |
| 🥇 2 | **POS (sales)** | Cart panel `blur(16px)`, transparent menu cards | ⏳ Ready in Phase 1 CSS, needs tenant activation |
| 🥈 3 | **App shell / navigation** | Top bar + module navigation as glass pills | ⏳ Ready via `metal-panel`/`neon-*` |
| 🥈 4 | **Tables** | Glass table cards, keep status colors | ✅ **Done (2026-08-12)** — opt-in `data-ui-mode='new'`; `table-card-glass`/`floor-table-cell`/`tables-glass-panel` blur(16px, §7.6), shell blobs; status colors preserved |
| 🥉 5 | **KDS (kitchen)** | Brightness must be preserved; only soft blur on panels | ⚠️ special attention |
| 🥉 6 | **AdminPanel** | Glass cards; light variant in light theme | ⏳ not checked yet |
| ✅ Done | **CustomerApp** | Full glass already exists | ℹ️ only lower `saturate(180%)→140%` |
| ✅ Done | **Accent contrast bug** | `--gold-b` gradient bottom `#b45309`→`#c9a24b` (old/light/new) | ✅ **Done (2026-08-12)** |

---

## 7. Production Rollout Rules

1. **Opt-in, OFF by default:** without `session_settings.ui_mode === 'new'` no screen changes. SettingsPanel always saves `'old'` — accidental activation is impossible.
2. **Before deploy:** check the production DB for any tenant with `ui_mode='new'` (if one exists, that tenant will get the new look on the next deploy — this will be the first real activation of previously dead CSS).
3. **Print system is untouchable:** `THERMAL_RECEIPT_PRINT_CSS`, barcode/QR rendering are separate — changing them is forbidden.
4. **`backdrop-filter` rule:** only **unprefixed** (Chrome ignores the `-webkit-` form; Lightning CSS dedupes the pair).
5. **Contrast rules:** after every change text ≥4.5:1 (AAA target); no white text on gold; no gold text in light theme.
6. **Weak devices:** do not raise blur above 16px on large surfaces; keep the `prefers-reduced-transparency` and `@supports` fallbacks.

---

## 8. Double-Check List (after every change)

- [ ] `npx tsc --noEmit` — no new errors (the existing 23 errors are old: POS.tsx, TablesPage.tsx, CustomerApp.tsx, background_fetch.ts — known technical debt in this project)
- [ ] `npm run build` — production build passes
- [ ] Glass tokens present in built CSS: `grep -o "glass-blur:[^;]*" dist/assets/*.css`
- [ ] Default mode (`data-ui-mode='old'`) look unchanged (computed-style check)
- [ ] Login → POS → Sale → Print → Z-report flow tested
- [ ] Contrast preserved in light theme
- [ ] UI doesn't break in offline mode (glass is pure CSS, unaffected by offline)
- [ ] Only CSS/class changes — business logic (sales, finance, inventory) untouched

---

## 9. Known Gaps / Next Steps

1. **POS `isNewUiMode` unification:** ~~`POS.tsx` still doesn't check `session_settings.ui_mode` (only `tables_ui_mode`/localStorage). If a tenant sets `ui_mode='new'`, the global glass works but the POS layout doesn't switch to the `pos2/pos3` classes. The two gates must be unified.~~ **✅ Done (2026-08-12):** `POS.tsx` `isNewUiMode` and `App.tsx` `currentUiMode` now also check `session_settings.ui_mode === 'new'` (local override → host → `ui_mode` → `tables_ui_mode`). A glass tenant now also switches to the `pos2/pos3` layout — a single gate. **Note:** `TablesPage.isBahaYLab` is deliberately NOT tied to `ui_mode` — it is an experimental lab gate (`super.ironwaves.store` + `tables_ui_mode='modern'`); the glass CSS applies to the Tables screen separately via `data-ui-mode`.
2. **`#b45309` fix:** ~~`neon-btn-active` gradient bottom is 3.53:1 — must be changed to `#c9a24b` (see §5.3.1).~~ **✅ Done (2026-08-12)** — `--gold-b` → `#c9a24b` (in old/light/new variants; the text color `#b45309` was deliberately kept, 5.02 AA).
3. **KDS check:** ~~brightness must not be lost in glass mode.~~ **✅ Verified (2026-08-12, computed-style):** KDS doesn't use neon-* classes, so the glass layer doesn't touch its surfaces — order card `bg-{c}-900/20` + `border-{c}-300/*` colors stay the same in NEW mode (utilities win), yellow accents (`text-yellow-300`) stay bright; only the `metal-panel` (header chip) gets soft glass blur. No code change required.
4. **Gold text in light theme** (prices) — ~~must be lowered to at least `#b45309`.~~ **✅ Already satisfied:** `html[data-theme='light'] [class*='text-amber-100']` (and yellow/orange) map to `color: #b45309` (5.02 AA) — no change required.
5. **CustomerApp orange** (`#F48C24`) — ~~white-text toasts/buttons must switch to dark text.~~ **✅ Done (2026-08-12):** `.cust-toast` text color `#fff` → `#1c1917` (2.44:1 → ~7.18:1). The join button already used `text-slate-950` — no change required.
6. **Demo artifacts:** ~~`.freebuff-glass-preview/` folder (demo HTMLs, each ~380KB inline CSS) is temporary — must be deleted before committing.~~ **✅ Deleted (2026-08-12)** — the folder was removed from the repository.

---

## 10. Verification Commands

```bash
npx tsc --noEmit                              # type check (no new errors)
npm run build                                 # production build
grep -o "glass-blur:[^;]*" dist/assets/*.css  # glass tokens in built CSS
node smoke_test.mjs                           # customer app smoke test (flaky on this VM)
```

**Note:** `smoke_test.mjs` is unreliable on this VM (headless Chromium hangs randomly). Reliable alternative: a static demo HTML with the built CSS + computed-style verification (used while this document was being written).
