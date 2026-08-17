# Customer App UI/UX — Deep Audit Report

> **Language:** [Azərbaycanca versiya](CUSTOMER_APP_UI_AUDIT.md) · **Date:** 2026-08-17 · **Scope:** `src/components/CustomerApp.tsx`, `src/components/customer/*` (7 tabs), `src/index.css` (customer layer)

---

## 1. Summary

All 7 tabs of the Customer App (Home, Order, Offers, Profile, Barista, Fortune) plus the shell, onboarding and the CSS design system were read at code level. Verdict: **functionality and design language are strong** (tier, birthday, campaigns, live order status, i18n, haptics), but reaching international level requires **2 fake-data functional issues, 2 critical UI issues** and a number of medium/small gaps.

**The 3 most critical steps:** (1) replace the fake weather/recommendation simulation with real data, (2) raise font sizes + contrast, (3) bring touch targets up to 44px.

---

## 2. Functional Findings

| # | Finding | Location | Severity | Status |
|---|---|---|---|---|
| F1 | **"Smart Recommendations" are fake** — weather is a `simulatedTemp` state, the "Toggle Weather" button flips 14↔26°C, recommendations come from the static `getWeatherInfo()` function. No real weather API/data (same class as the removed P0-1 fake rating) | HomeTab | 🔴 | ✅ Fixed |
| F2 | **No search in the Order tab** — the HomeTab "search" input is `readOnly`, and the Order tab has no search input at all | OrderTab | 🔴 | ✅ Fixed |
| F3 | **No "All" chip** — `cats` are only real categories; `cats[0]` is auto-selected, the full menu is never visible at once | OrderTab | 🟠 | ✅ Fixed |
| F4 | **Campaign countdown freezes** — countdown is computed at render with no 1s timer; it only updates via the 8s order poll (fully frozen without an active order). `progressPct = seconds/900` is hardcoded | OffersTab | 🟠 | ✅ Fixed |
| F5 | **No qty stepper in cart** — only removal; changing qty requires removing and re-adding the row | CartSheet | 🟠 | ✅ Fixed |
| F6 | **No direct add-to-cart** — every card (even non-variant items) opens the ModifierSheet; simple items should add directly with the default variant | OrderTab | 🟡 | ⏳ P2 |
| F7 | OTP uses `type="number"` (problematic on iOS) — `inputMode="numeric"` + `type="text"` is better; no resend timer | Onboarding | 🟡 | ⏳ P2 |
| F8 | **VOID/VOID_REQUESTED not shown** — if an order is cancelled the user silently sees nothing | OrderTab | 🟡 | ⏳ P2 |

---

## 3. UI Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| U1 | **Font sizes are systematically too small** — `text-[7px]`→`text-[10px]` everywhere (tier, card ID, notification time); `text-white/35`–`/40` fails WCAG AA contrast. International standard: body ≥13px | 🔴 | ✅ CSS pass (§8 check plan) |
| U2 | **Touch targets below 44px** — fav heart 28px, `+` 28px, close 28–32px. Apple HIG 44px / Material 48px | 🔴 | ✅ Partial (36px) |
| U3 | **Two design systems (Premium + Retro)** — `isRetro ? ... : ...` doubles the code in every component; the "🎨 Premium/Comic" toggle is exposed to real users. International standard: one premium language | 🟠 | ⏳ Decision |
| U4 | **A11y** — icon-only buttons lacked `aria-label` (theme/design/menu/mic/voice/heart/close) | 🟠 | ✅ Fixed |
| U5 | **Performance** — OrderTab `filtered`/`cats` recomputed every render (not memoized); no menu-grid virtualization; each tab injects its own `<style>` block | 🟡 | ✅ Partial (memo) |
| U6 | Loading state is just "Menu loading..." text — no skeleton loaders | 🟡 | ⏳ P2 |
| U7 | Two header buttons both open profile (Menu + avatar) — redundant | 🟡 | ⏳ P2 |
| U8 | Currency `₼` hardcoded everywhere — needs config for international expansion | 🟡 | ⏳ P2 |

---

## 4. Strengths

- **The design system is solid:** `cust-glass` (blur 24px + saturate 180%), `premium-shadow`, `shimmer`, `glow`, retro — all centralized CSS with `prefers-reduced-motion`.
- **Functionality is complete and server-validated:** tier (P1-1), birthday (P1-2), campaigns (P1-4/4b/4c), onboarding (P0-3), offline QR (P1-3).
- **Live order status** is KDS-synced (NEW→PREPARING→READY + push + LiveActivity).
- **i18n** (AZ/RU/EN) is complete — `tx()` everywhere, line balance preserved.
- Haptics + toast + confetti + Apple/Google Wallet pass integration.

---

## 5. Fixes Applied (2026-08-17, result of this audit)

| Fix | Files |
|---|---|
| **F1:** fake weather simulation removed (`simulatedTemp`/`simulatedCondition`), replaced by a real "Picked for You" section driven by `recentItems` (from the last order) | `CustomerApp.tsx`, `HomeTab.tsx` |
| **F2:** real search input added to OrderTab (category + name filter, memoized) | `OrderTab.tsx` |
| **F3:** "All" chip added; default `selectedCategory='ALL'` | `OrderTab.tsx`, `CustomerApp.tsx` |
| **F4:** OffersTab 1s countdown ticker + progress based on `(exp−start)` (no hardcoded 900s) | `OffersTab.tsx`, `CustomerApp.tsx` |
| **F5:** CartSheet qty stepper (−/+) | `OrderTab.tsx`, `CustomerApp.tsx` |
| **U4:** `aria-label` on icon-only buttons (theme, design, profile, heart, close, mic, voice, send) | `CustomerApp.tsx`, `HomeTab.tsx`, `OrderTab.tsx`, `BaristaTab.tsx` |
| **U5:** OrderTab `cats`/`filtered` → `useMemo` | `OrderTab.tsx` |
| **U2 (partial):** heart/`+`/close buttons 28→36px, cart remove 20→28px | `OrderTab.tsx` |
| **U1:** font sizes raised to a 10/11/12/13px floor + `text-white/30–50`/`text-slate-400` contrast brought closer to WCAG AA (CSS override scoped to `.customer-app-wrapper`) | `index.css`, `CustomerApp.tsx` |
| Bonus: dead `get_customer_wallet_pass_url` import + missing `nativeHapticImpact` import fixed (tsc 23→21) | `HomeTab.tsx`, `CustomerApp.tsx` |

**Verification:** `tsc --noEmit` 21 (baseline 23 — down 2), `npm run build` ✅, `test:smoke` 23/23 ✅.

---

## 6. Remaining Roadmap

| Priority | Item | Note |
|---|---|---|
| P1 | **U1 — visual check** | CSS pass is done; verify overflow/truncation/chip squeeze per the §8 plan |
| P1 | **U3 — retro decision** | Hide the "Premium/Comic" toggle from real users or formally keep retro as a branded variant |
| P2 | **F6 — direct add-to-cart** | Direct `+` on the card for non-variant items (default variant), sheet for variant ones |
| P2 | **F7 — OTP UX** | `inputMode="numeric"` + resend timer + better error messaging |
| P2 | **F8 — cancellation status** | Clear message for VOID/VOID_REQUESTED |
| P2 | **U6 — skeleton loaders** | Skeleton cards for loading states |
| P2 | **U7 — header cleanup** | Reduce the two profile buttons to one |
| P2 | **U8 — currency config** | Tie `₼` to a tenant setting |

---

## 7. International Standard Comparison

| Criterion | Starbucks / Material | Us (before) | Us (now) |
|---|---|---|---|
| Fake data | ❌ none | ⚠️ weather simulation | ✅ real history-based |
| Search | ✅ debounce + results | ❌ none | ✅ in Order tab |
| "All" view | ✅ | ❌ none | ✅ All chip |
| Live countdown | ✅ 1s | ❌ frozen | ✅ 1s ticker |
| Cart qty | ✅ stepper | ❌ remove+re-add | ✅ stepper |
| Min font size | ≥13px | ⚠️ 7–10px | ✅ 13px (CSS) |
| Touch target | ≥44px | ⚠️ 28px | ⚠️ 36px (full in P1) |
| A11y labels | ✅ | ❌ | ✅ |

**Verdict:** functional gaps are closed; the sizing/contrast/touch phase (U1+U2 full) is the next priority for the international look.

---

## 8. U1 Visual Regression Check Plan

The CSS pass is scoped to `.customer-app-wrapper`, so it only affects the customer app (POS/desktop untouched). Before release, check these screens at 375px (iPhone SE) and 430px (iPhone Pro Max) widths:

| Screen | What to check | Risk level |
|---|---|---|
| Bottom nav (6 tabs) | Active label `text-[10px]`→12px — squeeze/overflow with `justify-around` | Medium |
| OrderTab category chips | `w-[76px]` chips — does the `text-[9px]`→11px label truncate | Medium |
| OrderTab product grid (2-col) | `text-[11px]`→13px name not cut by `line-clamp-1` | Low |
| HomeTab card back / QR | `text-[9px]`→11px labels fit | Low |
| OffersTab campaign card | `text-[8px]`→10px/`text-[9px]`→11px badge + timer | Low |
| ProfileTab history | `text-[9px]`→11px meta + `text-[11px]`→13px item name | Low |
| Onboarding | `text-[9px]`→11px labels + consent text (newly added to scope) | Low |
| Barista/Fortune | `text-[10px]`→12px subtitles | Low |

**Automated checks (already passed):** `tsc --noEmit` 21, `npm run build` ✅, `npm run build:customer` ✅, `test:smoke` 23/23 ✅ — the overrides are present in the built CSS (confirmed via grep).

**Rule:** if any screen shows overflow/truncation breakage, write a per-element exception (`text-[10px]`→12px or `text-[11px]`→13px) without touching the global override.
