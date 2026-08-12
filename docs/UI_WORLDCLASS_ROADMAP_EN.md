# 🚀 UI World-Class Roadmap (iRonWaves POS)

> 🌐 **Azərbaycanca versiya:** [UI_WORLDCLASS_ROADMAP.md](UI_WORLDCLASS_ROADMAP.md)

## 1. Philosophy — "Speed and clarity first, polish second"

What defines a world-class restaurant POS (Toast, Square, Poster, iiko) is not beauty but **how fast a waiter can enter an order**. Glass/aurora is the brand layer, not the core. This document defines the 3-layer design system, a macOS-style aurora recipe, the glass primitive spec, eye-friendly dark palette rules, and a 5-step roadmap. All changes stay behind the `data-ui-mode='new'` opt-in gate — existing cafes (classic) are untouched.

**📌 Key decision (2026-08-12): All updates are carried out on the Modern-BahaY (pos3) UI.** The team does not put visual work into the classic UI — classic is kept only to preserve existing cafes' look. New features, design changes and fixes are applied first on the **pos3 layout (POS sales) + the modern tables view**; the `data-ui-mode='new'` gate keeps the classic look untouched. The classic UI is only touched for critical bugs that break production — and even then the fix must be verified in both layouts.

## 2. 3-layer design system

The foundation of world-class quality is **"one visual language"** — this is the biggest gap in the competitive audit (5 different dialects in one product: metal/neon staff, pos2/pos3, classic tables, customer orange, mobile waiter).

| Layer | What | Status |
|---|---|---|
| **1. Tokens** | CSS variables: color, radius, blur, border, shadow, type, spacing | 🟡 Started — glass tokens exist; type/spacing tokens missing |
| **2. Primitives** | Reusable components: `glass-panel`, `glass-card`, `glass-input`, `chip`, `badge`, `modal` | 🔴 Biggest gap — currently ad-hoc Tailwind classes everywhere |
| **3. Semantics** | Status colors, type scale, speed rules | 🟢 Status colors **done** (`TABLE_STATUS_THEME` + `ORDER_STATUS_THEME`) |

### 2.1 Token layer (started, to be extended)

```
--glass-blur:    16px          (large surfaces; §7.6 weak-device limit)
--glass-saturate: 140%
--glass-border:   rgba(255,255,255,0.08)   (hairline)
--glass-edge:     rgba(255,255,255,0.06)   (1px top light edge)
--glass-accent:   #d8b156      (desaturated gold)
--bg-base:        #0b131f      (warm dark, not pure black)
```

Missing: `--type-scale` (4 levels), `--space-*` (4/8/12/16/24/32), `--ease-*`, `--duration-*`.

### 2.2 Primitive layer (to be built)

Reusable `glass-*` classes (single CSS rule, identical on every screen):

```
glass-panel  → panels, sidebars               (blur 16px + saturate 140% + hairline + layered shadow)
glass-card   → cards                          (blur 16px, subtle border, hover: 1px lift)
glass-input  → search/input fields            (solid bg + hairline, accent focus ring)
glass-chip   → category/filter chips          (active = accent gradient)
solid-btn    → primary buttons                (SOLID — for contrast and tap affordance)
```

### 2.3 Semantic layer (done)

- **Table statuses:** Free=emerald · Reserved=amber · Seated=rose · Active=violet · Dirty=slate (floor plan)
- **Order statuses:** NEW/SENT=blue · PREPARING=orange · READY=emerald · VOID_REQUESTED=yellow · VOIDED=rose · COMPED=sky · WASTE=slate · SERVED=violet (KDS)
- Both palettes live in shared util files as a single source of truth — adding a status = one change.

## 3. Aurora background recipe

macOS-style soft, drifting color blobs — 4 rules. **✅ Done (2026-08-12):** `html[data-ui-mode='new'] .metal-app::before/::after` in the GLASS UI LAYER of `index.css` — two soft blobs (gold + blue/teal), `transform`+`opacity` keyframes (32s/40s), `z-index:-1` + `isolation:isolate` + `overflow:clip`. Shell/login backdrop only — not behind panels.

1. **Global, not per-element.** Aurora is the shell backdrop (login, dashboard, empty POS state). Putting blobs behind every panel kills readability.
2. **GPU-friendly animation.** 2-3 color blobs via `transform` + `opacity`, 25-40s slow cycles, `will-change` on 1 element only. CSS keyframes — no JS. Layout animations (top/left) are forbidden.
3. **Weak devices + reduced motion.** Blobs freeze or turn off under `prefers-reduced-transparency` and `prefers-reduced-motion`. Blur limit per §7.6 (≤16px).
4. **Never in KDS.** Clarity is critical in the kitchen — aurora only on service/staff screens.

## 4. Glass primitives — spec

```
glass-panel {
  backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 var(--glass-edge),   /* top light edge */
              0 16px 40px rgba(2, 6, 23, 0.4);
}
```

**Critical rule:** glass on **panels**, not on **buttons**. Buttons stay solid for contrast and tap affordance — this is mistake #1 among teams that misuse glass. The @supports fallback (no blur support → solid dark bg) already exists in the GLASS UI LAYER.

## 5. Dark palette rules

| Rule | Value | Why |
|---|---|---|
| No pure black | `#0b131f` family (warm dark) | Pure black strains eyes, clashes with aurora |
| Accent | `#d8b156` (desaturated gold) | Softer than neon yellow; contrast computed |
| Text contrast | WCAG AA (4.5:1 body, 3:1 large) | `#b45309` and cust-toast contrast bugs fixed |
| Status | emerald/amber/rose/violet/slate | Semantic, unified, same everywhere |
| Glow | Only on active/urgent elements | Less is more |

## 6. 5-step roadmap

| # | Step | Effect | Status |
|---|---|---|---|
| 1 | **Primitive component library** — 5 visual dialects → one `glass-*`/`solid-*` system (token-based, opt-in) | Consistency | ⏳ |
| 2 | **Speed operations** — POS left rail, keyboard shortcuts (F=fire, P=pay), touch ≥44px, optimistic UI | Order-entry speed | ⏳ (rail plan ready) |
| 3 | **Micro-interactions** — haptics, 120ms press states, card lift, soft bounce on cart add | "Enjoyment" feel | ⏳ |
| 4 | **Motion discipline** — 150ms UI / 300ms overlays, unified easing, `prefers-reduced-motion` reset | Professional feel | ⏳ |
| 5 | **Type system** — 4 levels (display/title/body/caption), `tabular-nums` for prices | Clarity + balance | ⏳ |

## 7. Double-check checklist (after every step)

1. `npx tsc --noEmit` — 23 errors baseline unchanged (no new ones)
2. `npm run build` — must pass
3. Grep built CSS for new classes (Tailwind scans `.ts` literals)
4. **Computed-style visual check** (clean-room demo: blur/saturate/border/shadow values)
5. **Classic mode unchanged** — verify the `data-ui-mode` gate
6. Weak-device + `prefers-reduced-motion`/`-transparency` fallbacks
7. Code review

## 8. Related documents

- [UI_AUDIT_GLASS.md](UI_AUDIT_GLASS.md) — glass implementation technical spec (AZ)
- [UI_AUDIT_GLASS_EN.md](UI_AUDIT_GLASS_EN.md) — same document (EN)
- [UI_COMPETITIVE_AUDIT.md](UI_COMPETITIVE_AUDIT.md) — competitive audit + priorities (AZ)
- [UI_COMPETITIVE_AUDIT_EN.md](UI_COMPETITIVE_AUDIT_EN.md) — same document (EN)
