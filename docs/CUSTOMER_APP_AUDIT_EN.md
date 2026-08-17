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
| P0-3 | 🔴 High | **Onboarding: name prompt + explicit consent checkbox** | ✅ Done (2026-08-16) |
> **P0-3a:** `Customer.name` migration + consent row in OTP verify (compliance gap closed) + name/birth-date inputs + mandatory consent checkbox (button disabled) + `POST /customer-app/profile/name` — `backend/tests/test_customer_onboarding_flow.py` (5 tests) + smoke.
| P1-1 | 🟠 Medium | **Tier system** (Bronze/Silver/Gold) — card visual differentiation + thresholds | ✅ Done (2026-08-16) |
> **P1-1a (core):** `lifetime_stars` migration (backfill) + pos.py points earn + `_compute_tier` + session `tier` field + card/badge/progress UI — `backend/tests/test_customer_tier_system.py` (7 tests) + smoke. Multiplier (P1-1b) is a separate phase.
| P1-2 | 🟠 Medium | **Birthday reward** (+ birthdate prompt) | ✅ Done (2026-08-16) |
> **P1-2a (core):** `birth_date` migration + `birthday_scheduler` (Baku tz, daily guard marker, year-based ledger idempotency) + grant (stars+lifetime+ledger+notification+push, disabled by default) + `POST /customer-app/profile/birthday` (format/past/age validation) — `backend/tests/test_customer_birthday_reward.py` (12 tests). Multi-worker advisory lock added (20 tests total).
> **P1-2b:** ProfileTab name/birth-date edit UI — `update_customer_name_live`/`update_customer_birthday_live`; empty birth date clears (None). Admin config UI (P1-2c) is a separate phase.
| P1-3 | 🟠 Medium | **Offline QR cache** — card opens without network | ✅ Done (2026-08-16) |
> **P1-3:** `crm.ts` session cache helpers (localStorage + in-memory fallback, token-hashed key) — every successful session is written to cache; on API failure it is returned from cache (with `_from_cache` marker). `CustomerApp.tsx` offline banner (📡 Offline mode + Retry) — the card opens even without network. Smoke tests: write/read roundtrip, card+token separation, null-guard (3 new tests).
| P1-4 | 🟠 Medium | **Server-validated campaigns** — activated state on the backend | ✅ Done (2026-08-16) |
> **P1-4:** `campaign_activations` table + `POST /customer-app/campaigns/{id}/activate` (single-use, 15-min window) + session `campaign_activations` + `POST /api/v1/pos/campaigns/validate` (ACTIVE→USED) + POS `IWPOS:CAMPAIGN:` recognition — `backend/tests/test_customer_campaign_activation.py` (11 tests) + smoke 14/14.
| P1-4b | 🟠 Medium | **POS discount application** — campaign + card max rule, consumption at sale | ✅ Done (2026-08-17) |
> **P1-4b:** validate does not consume — returns `activation_id`; consumption happens atomically in `create_sale` at the sale commit (ACTIVE→USED + same checks). `effective = max(manual, customer, campaign)`; `discount_reason = "Kampaniya: {name}"` auto-filled; `Sale.campaign_id` (migration 0006). POS attaches the campaign to the cart (rejected while a claim is active). — 17 tests + smoke 15/15.
| P1-4c | 🟠 Medium | **Offline campaign sync** — 400 rejection to manual review, scan requires online | ✅ Done (2026-08-17) |
> **P1-4c:** `campaigns_require_online` config — campaign scans are blocked while the backend is OFF; `syncPendingOfflineSales` moves a campaign rejection to a terminal state (parked one year out — auto-retry stops, manual review + retry remain). Gap test: offline→online double redemption proven (18 tests).
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

---

## 12. Technical Spec: P1-1 Tier System

### Goal
Derive a Bronze/Silver/Gold level from the customer's lifetime earned stars
(`lifetime_stars`) and surface it on the card visual + a progress bar.

### Design decisions
- Tier source: `lifetime_stars` (NOT the current `stars` balance) — redemption
  reduces stars but never demotes the level (prestige is preserved).
- Backfill: existing customers get `lifetime_stars = stars` — nobody starts at zero.
- Config is per-tenant: `customer_app_settings.tiers` (default: Bronze 0 / Silver 100 / Gold 300).
- `Customer.type` (set by the cashier) is untouched — the tier is fully derived.
- Multiplier (Gold 1.5×) is the P1-1b phase — it touches earn logic separately.

### Data model (migration 20260816_0002)
`customers.lifetime_stars INTEGER NOT NULL DEFAULT 0` + backfill UPDATE.
`down`: column is dropped (derived computation — no data loss).

### Backend behaviour
- `pos.py` points-mode sale: `lifetime_stars += coffee_qty` (cashback untouched).
- `_compute_tier(lifetime_stars, tiers)` → `{key, label{az,ru,en}, color, multiplier,
  current_threshold, next_threshold, progress_pct}` — floor progress (100 only at threshold).
- Session `customer` gains `lifetime_stars` + `tier` (additive — old clients unaffected).

### API contract (session)
`customer.tier = { key, label, color, multiplier, current_threshold, next_threshold|null, progress_pct }`

### Frontend
- HomeTab: card gradient tinted with the tier color (`${color}2E`), tier chip on the
  card face, wallet badge, progress bar to the next level.
- ProfileTab: tier badge (colored) + "Card Tier" value = tier label.
- `crm.ts` local fallback: `computeTier` mirror — session tier works without backend.

### Config format
`customer_app_settings.tiers = [{ "key", "label": {az,ru,en}, "threshold", "color", "multiplier" }]`

### Status
- ✅ P1-1a (core): migration + earn + `_compute_tier` + session + UI — done (2026-08-16)
- ⏳ P1-1b: Gold multiplier 1.5× application + admin panel tier config UI

### Tests
- `backend/tests/test_customer_tier_system.py` (7 tests) + `test:smoke` (local session tier)

### Double-check
tsc + build + full pytest + visual check (3 tier colors, new/retro/light modes)

---

## 13. Technical Spec: P1-2 Birthday Reward

### Goal
Automatically grant bonus stars + notification + push on the customer's birthday
(Starbucks birthday drink analogue) — affecting both balance and tier progress.

### Design decisions
- Scheduler wakes every 30 minutes but scans at most once per day (guard marker).
- "Today" is computed per tenant in its own timezone (`time_settings.timezone`,
  default Asia/Baku; UTC+4 fallback when ZoneInfo is unavailable).
- Two-layer idempotency: daily marker (restart-proof) + year-based ledger entry
  (`Birthday bonus {year}`) — double grants are impossible even across workers.
- Disabled by default: `customer_app_settings.birthday_enabled=false` — nothing is
  granted until a tenant opts in.
- Grant writes to both `stars` and `lifetime_stars` — a birthday gift also helps
  tier progression.
- `birth_date` is nullable — old/unknown customers are skipped; migration is lossless.

### Data model (migration 20260816_0003)
`customers.birth_date DATE NULL` — optional field, no backfill required.
`down`: column dropped (only user-entered dates are lost).

### Backend behaviour
- `app/services/birthday_scheduler.py` — `run_birthday_scan(db, today?)` core logic;
  `start_birthday_scheduler()` background thread started in `main.py` startup.
- Scan: active tenants → `birthday_enabled` → `birth_date` month/day == today → grant.
- Grant: `stars += bonus`, `lifetime_stars += bonus`, `LoyaltyLedgerEntry(unit='birthday',
  entry_type='earn', description='Birthday bonus {year}')`, in-app Notification, FCM push.
- Each customer is wrapped in try/except — one failure never stops the whole scan;
  commits happen per tenant.

### API contract (endpoint + session)
`POST /customer-app/profile/birthday { birth_date: "YYYY-MM-DD" }` (id+t auth) →
`{ success, birth_date }`. Validation: format, past date, age 6-120 → 400 on error.
Session `customer.birth_date` (nullable, additive).

### Config format
`customer_app_settings.birthday_enabled: bool` (default false) +
`customer_app_settings.birthday_bonus_stars: int` (default 5, min 1).
PATCH `/settings/customer-app` accepts both keys.

### Status
- ✅ P1-2a (core): migration + scheduler + grant + endpoint + tests — done (2026-08-16)
- ✅ P1-2b: ProfileTab name/birth-date edit UI — done (2026-08-16)
- ✅ P1-2c (done — 2026-08-17): admin config UI — campaign settings in CustomerAppPanel (`campaigns_require_online` + `campaign_activation_minutes`, load/save + backend PATCH whitelist); birthday panel (P1-2d) stays separate

### Tests
- `backend/tests/test_customer_birthday_reward.py` (20 tests): grant, idempotency,
  disabled tenant, NULL/wrong month, custom bonus, endpoint validation, guard marker,
  advisory lock race (PG skippable)

### Double-check
tsc + build + full pytest + frontend smoke + doc balance (AZ = EN)

## 14. Technical Spec: P1-4 Campaign Server Validation

### Goal
Store campaign (happy hour) activations on the backend — today the activation
lives only in the device's React state (lost when the app closes) and POS does not
recognize `IWPOS:CAMPAIGN:` codes at all. With server validation the cashier can
reliably check the code, it is single-use, and it no longer depends on which
device the customer opened the app on.

### Design decisions
- New `campaign_activations` table — `(tenant_id, campaign_id, card_id)` unique:
  one customer can have only one active activation per campaign at a time.
- Activation is a 15-minute window (matching the current UI); once `expires_at`
  passes, activations disappear from the session.
- The customer creates the activation (`POST /customer-app/campaigns/{id}/activate`,
  id+t auth); POS only VALIDATES it via `POST /api/v1/pos/campaigns/validate`.
- Single-use: a successful validate flips status `ACTIVE` → `USED` — the same QR
  cannot give a discount twice at the register (double-redemption guard).
- Happy hour time window is checked at validate time (`start_time`/`end_time`/
  `days_of_week_json`) — an activation is only valid while the campaign is running.
- Session field is additive: `campaign_activations` is appended, old apps are not
  broken. With backend OFF, crm.ts local fallback mirrors the same flow.

### Data model (migration 20260816_0005)
`campaign_activations` table: `id` (uuid PK), `tenant_id` (FK tenants, index),
`campaign_id` (FK happy_hours, index), `card_id` (String 36, index),
`status` (String: ACTIVE/USED, default ACTIVE), `activated_at` (DateTime),
`expires_at` (DateTime), `UNIQUE (tenant_id, campaign_id, card_id)`.
`down`: table dropped (only active campaign sessions are lost).

### Backend behaviour
- `CampaignActivation` model + `POST /customer-app/campaigns/{campaign_id}/activate`:
  404 if the campaign is not active for the tenant; existing ACTIVE row refreshes
  `expires_at` (re-activation), USED row returns 409 (single use).
- Session serializer: rows with `expires_at > now` are returned as
  `campaign_activations: [{ campaign_id, name, discount_percent, expires_at }]`;
  expired rows are filtered out.
- `POST /api/v1/pos/campaigns/validate { campaign_id, card_id }` (POS auth):
  ACTIVE + `expires_at > now` + time window → `{ valid: true, discount_percent,
  name }` and status=USED; any failed condition returns `{ valid: false }`.

### API contract (customer + POS)
`POST /customer-app/campaigns/{campaign_id}/activate` (id+t) → `{ success, expires_at }`.
Session `campaign_activations` (additive).
`POST /api/v1/pos/campaigns/validate { campaign_id, card_id }` →
`{ valid, discount_percent?, name? }`.

### Config format
`customer_app_settings.campaign_activation_minutes: int` (default 15) — length of
an activation window; `show_campaigns` is already consumed by the session.

### Status
- ✅ P1-4 (done — 2026-08-16): migration + activate endpoint + session + POS
  validate + OffersTab backend wiring + POS `IWPOS:CAMPAIGN:` recognition

### Tests
- `backend/tests/test_customer_campaign_activation.py` (11 tests): activate
  create/re-activate, expired filtering, session visibility, POS validate
  valid → USED, double-redemption rejection, 404/401/409, time window

### Double-check
tsc + build + full pytest + frontend smoke + doc balance (AZ = EN)

## 15. Technical Spec: P1-4b POS Campaign Discount Application

### Goal
P1-4 stores the activation on the server; this spec defines how the discount
is applied to the cart at the register: how the campaign discount combines
with the card discount (max rule) and how a successful validate reaches the sale.

### Combination rule: MAX (not stacked)
- The backend already applies `max(manual, customer)` (pos.py `create_sale`).
  The campaign joins the same rule as a third source:
  `effective = max(manual, customer_card, campaign)`.
- Why not stacking: stacking (e.g. 10% + 20% = 28%) changes backend math,
  rounding and audit rules; campaigns are usually larger than the card
  discount (20% vs 5-10%), so max makes the campaign win during its window —
  which is exactly the marketing intent.
- Exception: if a manager manual discount (e.g. 25%) exceeds the campaign in
  max, the campaign is not applied — the manager override wins, `discount_reason` required.

### Consumption moment: at sale (recommended) — not at scan
- **Option A (as built):** validate flips ACTIVE→USED at scan time. Simple,
  but if the sale fails (payment declined) the customer loses the campaign.
- **Option B (recommended):** validate does NOT consume at scan — it returns
  `{ valid, discount_percent, name, activation_id }`; consumption happens
  atomically inside `create_sale` with the sale commit (ACTIVE→USED + the same
  checks inside the transaction). Single use is preserved, but it is consumed
  only on a real purchase — fair + safe.

### Cart flow (frontend)
- Add `campaign?: { campaignId, name, percent }` to `CartContext`.
- Successful scan: `patchCtx({ campaign, discountReason: 'Kampaniya: ' + name })` —
  the existing finance rule (reason mandatory for manual discount) is met
  automatically and the reason is auditable.
- `effectiveDiscountPercent = max(ctx.discount, campaign.percent)` — since the
  card discount lives in `ctx.discount`, the max rule is identical in UI and backend.
- A campaign scan while a claim code is active is rejected with a warning (rules stay simple).
- `campaign` is cleared when the cart is cleared or the customer changes.

### Backend changes
- `SaleCreateIn` += `campaign_id`, `activation_id` (nullable).
- `create_sale`: if a campaign is present, re-check the activation (ACTIVE, time
  window, same card) → `effective_discount = max(...)` → USED +
  `discount_reason = "Kampaniya: {name}"` → committed in the same transaction.
- Add `campaign_id` (String 36, nullable) to the `Sale` model — structured
  field for reporting (migration 20260816_0006, additive).
- Local mode (db_sim) mirrors the same flow: validate does not consume,
  `create_sale` consumes.

### API contract
`POST /api/v1/pos/campaigns/validate` → `{ valid, discount_percent?, name?,
activation_id? }` (no consumption).
`POST /api/v1/pos/sale` += `{ campaign_id?, activation_id? }` → consumption
happens at sale commit, `discount_reason` is auto-filled.

### Known inconsistency (must be resolved in this spec)
Frontend `calculate_total` stacks tier+manual+eco (`min(1, manual+tier+eco)`),
while the backend uses `max(manual, customer)` — the UI total and backend total
can diverge on the same check. When the campaign joins max, the frontend must
be reduced to the same max (tier is already inside `ctx.discount`, avoid double-apply).

### Status
- ✅ P1-4b (done — 2026-08-17): max rule + consumption at sale + Sale.campaign_id

### Tests
- `backend/tests/test_customer_campaign_activation.py` (17 tests): max applied
  at sale (5% card vs 20% campaign → 20%), consumption + `Kampaniya:` reason,
  expired/used activation → sale rejected, double use across two sales
  rejected, card-mismatch rejected, no consumption at scan (2 scans valid)
- Smoke (15/15): card discount + campaign → max, sale consumption, 2nd sale rejected

### Double-check
tsc + build + full pytest + frontend smoke + doc balance (AZ = EN)

---

## 16. Security: Campaign Activation Forgery

### Goal
Verify whether the `IWPOS:CAMPAIGN:` QR can be forged — since `card_id` is
exposed in the QR content, could someone create a discount code for another card?

### Verdict: forgery is NOT possible
- `card_id` is a "username"; the trust boundary is the server-side activation
  row. The QR is only a lookup key — it carries no signature or token.
- An activation row is only created by the `activate` endpoint and binds the
  authenticated session (`customer.card_id`), never a request-supplied card_id.
- `secret_token` (128-bit) never appears in any QR: campaign QR =
  `IWPOS:CAMPAIGN:{campaign_id}:{card_id}`, card QR = `IWPOS:CARD:{card_id}`.

### Attack attempts (verified against the code)
| Attempt | Result | Reason |
|---|---|---|
| Forge QR with someone else's card_id | ❌ valid:false | validate only looks up an existing ACTIVE row (pos.py:546) |
| Activate for someone else | ❌ 401 | activate accepts no card_id; binds the session (operations.py:4308) |
| card_id enumeration | ❌ empty | a row only exists once the owner activates with their session |
| Extract token from QR | ❌ none | tokens are never written into QR codes |

### Real risks (in priority order)
1. **QR sharing/screenshot** — within the 15-min window, anyone holding the QR
   image can redeem the discount at the register (POS does not verify identity).
   Standard coupon behaviour, but it can be limited if desired.
2. **Consumption happens at scan** — if the sale fails, the customer loses the
   campaign (P1-4b fixes this by consuming at sale).
3. **Local fallback (backend OFF)** — db_sim simulates the whole flow in
   localStorage; offline mode has no server check (accepted risk).
4. **Token comparison uses `!=`** — `_resolve_customer_session` compares without
   `secrets.compare_digest` (theoretical; one-line hardening).

### Recommendations
- Implement P1-4b (move consumption into `create_sale`) — closes the lost
  campaign and burned-QR problems.
- POS identity check for high-value campaigns (name / last 4 phone digits).
- Compare tokens with `secrets.compare_digest` (hardening).
- ⚠️ Do NOT add a token to the campaign QR — it would expose a secret (negative).

### Status
- ✅ Security audit (2026-08-17): forgery not possible; recommendations queued
  as P1-4b + hardening on the roadmap.

### Tests
- Existing `test_customer_campaign_activation.py` (11): wrong card_id/campaign_id
  → valid:false already covered; +2 if POS identity check is added.

### Double-check
tsc + build + full pytest + frontend smoke + doc balance (AZ = EN)

---

## 17. Local Fallback (db_sim): Campaign Activation + Offline Risk

### Goal
Document how the P1-4 campaign activation is simulated in db_sim when the
backend is OFF, and the offline fake-QR risk.

### Simulation mechanism (crm.ts local fallback)
- `campaign_activations`: a plain localStorage array (host-scoped `db_campaign_`
  `activations`, in-memory Map + localStorage). Row: id, tenant_id,
  campaign_id, card_id, status, activated_at, expires_at — shared on device.
- `activate_customer_campaign_live` (local): requires a local customer session
  (card_id + secret_token match); creates an ACTIVE row
  (expires_at = now + campaign_activation_minutes, default 15 min).
- `validate_pos_campaign_live` (local): checks ACTIVE + unexpired + happy-hour
  window; since P1-4b it does NOT consume (returns activation_id).
  No token/signature check — the row itself is the only credential.
- `create_sale` (pos.ts local): re-checks the same row, marks USED, joins max.

### Offline fake-QR risk
| Vector | Result | Reason |
|---|---|---|
| Inject a row via devtools on the device | valid | validate only reads the store, no credential |
| Customer console on a shared kiosk | valid | web customer view shares the same origin/storage |
| campaign_id enumeration | sufficient | happy_hours store is on-device, session lists them |

### Assessment: LOW–MEDIUM
- Backend guarantees (customer secret_token for activation, staff auth for
  POS, server-side consumption) silently drop in offline mode.
- But this is systemic: offline customers, stars, finance and reward claims
  also live in db_sim — the whole offline POS is a "trust the device" model.
- A cashier can already give manual discounts — a fake QR is not a new power.
- The sharpest new gap: cross-device double redemption + stuck offline sales.

### Cross-device double redemption + stuck sales
1. Device A offline: scan → local ACTIVE → sale → local USED → queued.
2. Device B online: same QR → server ACTIVE (local consumption never reached
   the server) → sale → server USED — one activation discounts twice.
3. A reconnects: sync replays → backend 400 "Kampaniya etibarsızdır" →
   `syncPendingOfflineSales` only counts dedup messages as 'synced'; a campaign
   rejection stays 'pending' with infinite retry — no terminal state.

### Recommendations
- Baseline (accepted risk): the single-use guarantee only holds online.
  Optionally add a `campaigns_require_online` config — block campaign scans
  while the backend is OFF (P1-4c).
- Sync fix: an offline sale rejected with the campaign error (400) should
  move to a terminal 'error' (manual review) state instead of infinite retry,
  so the shop can refund/void it (P1-4c).
- Forgery: do not run POS on public kiosks; staff login (already present);
  requiring a token/signature in the local store is a separate project.

### Status
- ✅ Local fallback audit (2026-08-17): mechanism documented; P1-4c
  (campaigns_require_online + terminal sync error) implemented.

### Double-check
tsc + build + full pytest + frontend smoke + doc balance (AZ = EN)
