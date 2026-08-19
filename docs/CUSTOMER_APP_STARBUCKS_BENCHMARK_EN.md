# Customer App — Starbucks Benchmark Decision

> **Language:** [Azərbaycanca versiya](CUSTOMER_APP_STARBUCKS_BENCHMARK.md) · **Date:** 2026-08-17 · **Decision:** Starbucks skeleton + Apple/Linear glass skin

---

## 1. Decision

**Starbucks skeleton + Apple/Linear glass skin = world-class UI.**

The Tim Hortons (RBI loyalty) app was analyzed (Play 3.2★, 145k reviews) — a failed benchmark.
Starbucks is the **winner** in the same category (coffee + loyalty + order ahead): Play **4.8★**
(1.5M+), App Store **4.9★** (8.2M ratings). Our IA already mirrors Starbucks (Home / Card /
Order / Rewards) — what's needed is **polish, not rebuild**.

| Layer | Source | What we copy |
|---|---|---|
| Structure / UX | **Starbucks** | Bottom nav, star progress, order-ahead flow, one-tap reorder |
| Aesthetic | **Apple macOS glass / Linear / Raycast** | Dark glass, aurora, blur, 1px light edges |
| Order tracking | **Wolt** | Live status animation, "ready" screen |
| POS side | **Toast / Square** | Layout discipline |

## 2. IA Comparison Table

| Layer | Starbucks | Our Customer App | Gap |
|---|---|---|---|
| Bottom nav | Home / Order / Rewards / Profile (4-5 tabs) | Home / Order / Offers / Barista / Fortune / Profile (6 tabs) | ⚠️ 6 tabs is too many — Barista/Fortune to secondary |
| Home screen | Greeting + card (balance first) + reorder chips | Tier card + stars + "For You" + My Rewards | ✅ Aligned + one-tap reorder added |
| Rewards | Star progress + "activated rewards" | Star progress + claim codes + tier | ✅ Status-aware "My Rewards" added |
| Order flow | Store selection + pickup choice | Pre-order (no store selection) | ⚠️ Store/pickup missing |
| Scan & Pay | Pay + earn in one scan | QR only opens the wallet pass | 🔴 Biggest gap |
| Favorites | Saved customizations | favoriteItems (from history) | ✅ Closed via one-tap reorder |

## 3. Principle: "Starbucks Skeleton + Glass Skin"

1. **IA from Starbucks** — users feel "familiar and comfortable" when they see known flows.
2. **Look from Apple/Linear glass** — our `glass` system (`.customer-app-wrapper`,
   `cust-glass` blur+saturate, hairline, soft shadow) is already built; the same skin
   applies to the customer app too (the U1 CSS pass is its foundation).
3. **Tim Hortons lesson: copy the winner, not the loser** — speed, sync, and simplicity
   win (we already applied this: lazy chunks, payload fix, idempotency).
4. **Features are adapted, not copied** — every feature is adjusted to our backend and
   rules (e.g. claim → server validation P1-4).

## 4. Status of Copied Features

| # | Feature | Starbucks equivalent | Status |
|---|---|---|---|
| 1 | **One-tap reorder** | "Add favorites with one tap" | ✅ Done (2026-08-17) — full history payload + cart merge + toast + Order tab switch |
| 2 | **Activated rewards** | "Activated rewards" section | ✅ Done (2026-08-17) — status-aware "My Rewards" (PENDING/REDEEMED + date) |
| 3 | **Tier system** | Green → Gold + exclusivity | ✅ Done (P1-1) — Bronze/Silver/Gold + progress bar |
| 4 | **Birthday reward** | Free drink | ✅ Done (P1-2) — scheduler + push |
| 5 | **Live order status** | Order tracking | ✅ Done (P0-2) — NEW→PREPARING→READY + push |
| 6 | **Server-validated campaigns** | Personalized offers | ✅ Done (P1-4/4b/4c) — single use + max discount |
| 7 | **Star progress bar** | "X stars → next reward" | ✅ Done |
| 8 | **Scan & Pay** | Pay + earn in one scan | ⏳ Planned (P0 — biggest gap) |
| 9 | **Store selection + pickup UX** | Store selection + mobile pickup | ⏳ Planned |
| 10 | **Bottom nav simplification** | 4-tab IA | ⏳ Planned (6 → 4-5 tabs) |

## 5. Tim Hortons Lessons (to avoid)

| Problem (TH 3.2★ complaints) | Our state |
|---|---|
| Slow loading (top complaint) | ✅ Lazy chunks + virtualization + memo |
| Order sync bugs | ✅ payload=None fix + card_id migration + idempotency |
| Confusing navigation (redundant entries) | ⚠️ 6-tab risk — simplification planned |
| Unreliability / double charge | ✅ Server validation + single-use guarantee |

## 6. Related Documents

- [CUSTOMER_APP_AUDIT_EN.md](CUSTOMER_APP_AUDIT_EN.md) — customer app audit (EN)
- [CUSTOMER_APP_UI_AUDIT_EN.md](CUSTOMER_APP_UI_AUDIT_EN.md) — deep UI/UX audit (EN)
- [UI_WORLDCLASS_ROADMAP_EN.md](UI_WORLDCLASS_ROADMAP_EN.md) — world-class roadmap (EN)
- [CUSTOMER_APP_STARBUCKS_BENCHMARK.md](CUSTOMER_APP_STARBUCKS_BENCHMARK.md) — the Azerbaijani version of this document
