# Customer App & Loyalty Mobile — Audit Report

> **Language:** [Azərbaycanca versiya](CUSTOMER_APP_AUDIT.md) · **Date:** 2026-08-16 · **Scope:** `src/components/CustomerApp.tsx`, `src/components/customer/*`, `src/api/crm.ts`, `src/lib/customer_*`

---

## 1. Philosophy & Method

This audit applies the same world-standard approach we used for the desktop POS side (see [UI_COMPETITIVE_AUDIT_EN.md](UI_COMPETITIVE_AUDIT_EN.md)) to the customer app / loyalty mobile application. The goal is to answer "what should we build next?" with **code-based, measurable** evidence.

**Benchmark sources:**

| Source | Key metric |
|---|---|
| Starbucks Rewards (world benchmark) | 75M+ members, **57% of US revenue** from loyalty members; members spend **3×** more per visit |
| Markswebb UX research | Onboarding into loyalty **right after registration** increases usage; a short onboarding flow is required |
| Costa / local loyalty apps | Mobile-first, personalization, gamification, exclusivity |

**Starbucks success principles (transferable):** easy join, earn on every purchase, fast first reward, progress bars, tier system, birthday reward, challenges (Double Star Days), staying top-of-mind via push.

**Audit areas:** ① Onboarding ② Card UX ③ Order flow ④ Loyalty program ⑤ Performance.

---

## 2. Current State Summary

| Layer | State |
|---|---|
| **Mobile shell** | ✅ Capacitor (Android + iOS folders exist), push-notifications, haptics, camera, background fetch, Live Activity |
| **Membership card** | ✅ 3D flip, QR, EMV chip, shimmer, Apple/Google Wallet pass, classic + retro design |
| **Loyalty** | ✅ Stamp card (10=1 free), points/cashback mode, `loyalty_ledger`, claim codes + ticket visual, confetti |
| **Ordering** | ⚠️ Pre-order (menu, modifier sheet, cart, OTP), but **no status tracking and no payment** |
| **AI** | ✅ AI Barista (chat + voice), AI Fortune Teller (image analysis), weather-based suggestions (simulated) |
| **Campaigns** | ⚠️ Happy hour → QR activation (client-side 15-min timer) |
| **Management** | ✅ Admin `CustomerAppPanel` — 30+ parameters (colors, text, modes, toggles) |
| **Languages** | ✅ AZ / RU / EN |

**Tech:** `customer.html` → `src/customer-main.tsx` → `CustomerApp` (lazy). Session: native `CustomerSession` plugin / localStorage. Bundle: CustomerApp chunk **139KB** (lazy-loaded ✓).

---

## 3. Onboarding

### Current flow

1. Entry: URL `?id=&t=` / `?join=1` / native session → join mode opens
2. Bootstrap (branding) loads → hero + language switcher
3. Phone number → OTP sent → 4-digit code → verified
4. Card is created (`enroll`/`verify` — join type + discount come from URL), session persisted

### Findings

| # | Finding | Severity | World standard |
|---|---|---|---|
| 1 | **No first/last name prompt** — new cards have empty `customer.name`; profile shows "Customer" placeholder | 🔴 High | Starbucks asks for name → personalization (greeting, recommendations) |
| 2 | **No explicit consent checkbox** — just a text block + "Accept" button | 🟠 Medium | GDPR requires explicit opt-in checkbox |
| 3 | **No birthdate prompt** — the essential data for birthday rewards | 🟠 Medium | Starbucks' #1 perk |
| 4 | **No join bonus** — no fast-win feeling on first purchases | 🟠 Medium | Starbucks hooks within the first visits |
| 5 | **No guest mode** — registration is mandatory even just to browse the menu | 🟠 Medium | Starbucks shows the menu without an account |
| 6 | **No onboarding tour** — no "how it works" walkthrough | 🟡 Low | Markswebb: a short tour increases usage |
| 7 | **No referral / invite flow** | 🟡 Low | Viral growth mechanism |

---

## 4. Card UX

### Strengths (untouched)

- 3D flip card + EMV chip + glossy highlight + shimmer sweep — **premium feel** ✅
- Stamp card (retro) and points mode with a **filling coffee-cup graphic** (progress animation) — delightful ✅
- Apple/Google Wallet pass links ✅
- Confetti + haptics on reward claim ✅

### Gaps

| # | Finding | Severity |
|---|---|---|
| 1 | **No NFC** — QR only; no NFC tag / Apple Pay card | 🟡 Low |
| 2 | **No offline card** — without network the QR is not shown; "dead phone at counter" is the worst case | 🟠 Medium |
| 3 | **No tier differentiation on the card** — all cards look identical (all "Golden") | 🟠 Medium |
| 4 | Card does not show the **last transaction** (balance only) | 🟡 Low |
| 5 | QR requires **2 taps** (flip) — "Scan & Earn" is an extra step | 🟡 Low |
| 6 | **No 1D barcode** for legacy scanners | 🟡 Low |

---

## 5. Order Flow (Pre-Order)

### Current flow

Menu fetch → category chips → product grid (image, badge, rating, favorite) → modifier sheet (variant/add-ons) → cart sheet (notes, total) → confirm → success dialog (order ID).

### Findings

| # | Finding | Severity | Note |
|---|---|---|---|
| 1 | **No order status tracking** — after "Order Confirmed!" the customer sees nothing (no PREPARING/READY, no push) | 🔴 **Critical** | KDS has status; it never reaches the customer |
| 2 | **Fake ratings** — `ratingValue = 4.5 + (product_name_length % 5) * 0.1` — rating is computed from name length! | 🔴 **Critical** | ✅ Fixed (2026-08-16) — badge and computation removed |
| 3 | **No payment** — no prepay, no pickup ETA; "Confirm Order" means pay at the counter | 🟠 Medium | Starbucks completes with mobile payment |
| 4 | **Cart not persisted** — lost when the app is closed | 🟠 Medium | |
| 5 | **Menu re-fetched on every tab open** — no cache | 🟡 Low | |
| 6 | **No reorder** — history exists, but no "order again" | 🟡 Low | |
| 7 | **Favorites don't feed the order flow** — tapping a chip just opens the order tab | 🟡 Low | |
| 8 | CartSheet has **no product image** (hardcoded ☕) | 🟡 Low | |
| 9 | No allergen / nutrition info | 🟡 Low | |

---

## 6. Loyalty Program

### Current

Two modes: **points** (stars → claim) and **cashback** (percentage accrual). Stamp card, `loyalty_ledger`, happy-hour campaigns, claim codes, push notifications, Wallet pass, Live Activity (iOS lock screen).

### Findings

| # | Finding | Severity | Note |
|---|---|---|---|
| 1 | **No tier system** — `customer.type` exists (golden/platinum/elite...), but no progression logic; everyone sees "Golden Member" | 🟠 Medium | Starbucks Green→Gold; status + exclusivity psychology |
| 2 | **No birthday reward** | 🟠 Medium | The most effective trigger |
| 3 | **Single reward** — `wallet.rewards` only has `default-reward`; no redemption catalog | 🟠 Medium | Starbucks has multi-level redemption |
| 4 | **Campaign activation not server-validated** — 15-min timer + QR fully client-side; server doesn't persist an "activated" state | 🟠 Medium | Abuse risk (same QR reused) |
| 5 | **No challenges / gamification** — no "Double Star Day", "visit 3× this week" | 🟡 Low | Progress bars exist, but no goals |
| 6 | **No points expiry policy shown** | 🟡 Low | |
| 7 | **No referral** | 🟡 Low | |
| 8 | Some notification messages are **hardcoded AZ** (enroll, pre-order) | 🟡 Low | `tx()` not used |

---

## 7. Performance

| # | Finding | Severity | Note |
|---|---|---|---|
| 1 | CustomerApp chunk **139KB** — lazy ✓, but **all 6 tabs in one chunk** (Fortune camera + Barista voice could split) | 🟡 Low | `CustomerApp-*.js` 139KB |
| 2 | **Geolocation `watchPosition` runs continuously** (high accuracy, maximumAge 0) — battery drain on native | 🟠 Medium | One-shot + geofence plugin |
| 3 | **No offline cache** — no SW for session, menu, QR | 🟠 Medium | "Dead phone at counter" |
| 4 | **Weather is simulated** — temperature faked by hour; "Toggle Weather" button reveals it | 🟡 Low | Real API + real location |
| 5 | **Geofence coordinates hardcoded** (Baku: 40.37767, 49.84583) — wrong for multi-tenant; must come from settings | 🟠 Medium | Only works near one cafe |
| 6 | ✅ QR client-side, OneSignal lazy via `requestIdleCallback`, Live Activity, background sync — **strengths** | — | |

---

## 8. Benchmark Table — World Standard vs Current

| Feature | Starbucks / world standard | Current state | Gap |
|---|---|---|---|
| Join speed | 1 minute, name + email | Phone + OTP (no name) | 🟠 |
| Join bonus | Fast earning in first visits | None | 🔴 |
| Card | NFC + QR + offline pass | QR (online only) | 🟠 |
| Tier system | Green → Gold (visual difference) | Everyone "Golden" | 🔴 |
| Birthday perk | Free drink | None | 🔴 |
| Ordering | Mobile payment + status + ETA | Pre-order, no status/payment | 🔴 |
| Gamification | Double Star Days, challenges | Progress bars (no goals) | 🟠 |
| Personalization | Name, preferences, offers | No name; favorites local | 🟠 |
| Data integrity | Real ratings | Fake rating removed | ✅ |
| Offline | Passes offline | Fully online | 🟠 |

---

## 9. Prioritized Roadmap

| # | Priority | Task | Status |
|---|---|---|---|
| P0-1 | 🔴 Critical | **Remove fake ratings** (OrderTab) — don't show without real data | ✅ Done (2026-08-16) |
| P0-2 | 🔴 Critical | **Order status tracking** — KDS integration (NEW→PREPARING→READY) + push + live status screen | ✅ Done (2026-08-16) |
> **P0-2 test:** `backend/tests/test_customer_order_status_flow.py` — 5 E2E tests on real SQLite (pre-order → accept → complete → push + legacy card_id check); the test surfaced and fixed a `complete_kitchen_order` crash when `payload=None`.
> **Frontend smoke:** `npm run test:smoke` → `tests/crm_local_smoke.test.mjs` (get_customer_orders_live local fallback: tenant/card filter, sort, 10-limit, roundtrip)
> **Reward claim test:** `backend/tests/test_customer_reward_claim_flow.py` — 6 tests on real SQLite (RW code format, in-app notification, FCM push, pending limit, custom threshold, session guard); FCM push added to the claim endpoint (previously in-app notification only).
> **KDS complete check:** KDS.tsx live path sends a body (`{ready_items}` → `/kitchen-feed/{round}/complete`); empty-body regression test in `test_customer_order_status_flow.py` (restaurant.py does not crash with empty `{}`); legacy `/ops/kitchen-orders/{id}/complete` is guarded against `payload=None`.
| P0-3 | 🔴 High | **Onboarding: name prompt + explicit consent checkbox** | ⏳ |
| P1-1 | 🟠 Medium | **Tier system** (Bronze/Silver/Gold) — card visual differentiation + thresholds | ⏳ |
| P1-2 | 🟠 Medium | **Birthday reward** (+ birthdate prompt) | ⏳ |
| P1-3 | 🟠 Medium | **Offline QR cache** — card opens without network | ⏳ |
| P1-4 | 🟠 Medium | **Server-validated campaigns** — activated state on the backend | ⏳ |
| P2-1 | 🟡 Low | **Guest mode** — browse menu without an account | ⏳ |
| P2-2 | 🟡 Low | **Reorder + favorites → order** | ⏳ |
| P2-3 | 🟡 Low | **Payment integration** (prepay + pickup ETA) | ⏳ |
| P2-4 | 🟡 Low | **Referral** (invite, earn stars) | ⏳ |
| P2-5 | 🟡 Low | **Geofence from settings** + logout button (profile) | ⏳ |
| P2-6 | 🟡 Low | **Lazy-split tabs** (Fortune/Barista into separate chunks) | ⏳ |

---

## 10. Double-Check Checklist (after every step)

1. `npx tsc --noEmit` — same error count as baseline (no new ones)
2. `npm run build` + relevant chunk-size check
3. Computed-style / visual check of the changed screens (web + native)
4. KDS / POS integration points (status flow) compatibility
5. Languages (AZ/RU/EN) + classic/retro design modes check
6. Code review + document status update

---

## 11. Related Documents

- [UI_COMPETITIVE_AUDIT_EN.md](UI_COMPETITIVE_AUDIT_EN.md) — desktop POS competitive audit (EN)
- [UI_WORLDCLASS_ROADMAP_EN.md](UI_WORLDCLASS_ROADMAP_EN.md) — world-class roadmap (EN)
- [UI_AUDIT_GLASS_EN.md](UI_AUDIT_GLASS_EN.md) — glass UI technical spec (EN)
- [CUSTOMER_APP_AUDIT.md](CUSTOMER_APP_AUDIT.md) — this document in Azerbaijani
