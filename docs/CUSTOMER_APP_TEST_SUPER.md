# Customer App — Super tenant test plan (2026-10-11)

**Environment:** super (`super.ironwaves.store`), 134 real customers, cashback program,
all with QR card + secret token, push_opt_in=true.

**Two ways to call the API:**
- Via public domain: `https://super.ironwaves.store/api/v1/ops/customer-app/...` — but note:
  unknown API paths return the SPA (200 HTML), so **always** use the direct backend host
  with the tenant header for true status codes:
  `curl -H "x-tenant-domain: super.ironwaves.store" https://ironwaves-pos-platform-production.up.railway.app/api/v1/ops/customer-app/...`

**Auth:** every customer call uses `?id=<card_id>&t=<secret_token>`.

---

## A. Onboarding (new customer) — automated + safe

Purpose: prove a brand-new customer can join without touching real data.

1. `POST /customer-app/enroll` with a fake email like `test-<rand>@example.com`,
   `consent_accepted: true`, `registration_mode: simple`.
   → Returns `{success, card_id, token}`. Expect 200.
2. Use that card_id+token to call `GET /customer-app/session` → 200, the same customer.
3. `GET /customer-app/preferences` → 200, shows defaults `push=true, email=false, sms=false`.
4. Wrong token on `session` → must be **401** (asserted by direct-call test).
5. Delete the test customer afterwards (cleanup) so super stays as it was.

## B. Secure-session / auth hardening

1. `session` with correct id+token → 200.
2. `session` with wrong token → **401**, body `{"detail":"Customer session is invalid"}`.
3. `session` with missing id/t → **401** (or 422). No 500.
4. `customer-app/preferences` PATCH with no auth → 401.

## C. Wallet / payments (epoint F3) — manual first, then automated

1. `POST /customer-app/payment/create` with a small amount (e.g. 5.00) → returns a token/URL.
2. `POST /customer-app/payment/status` with that token → `pending`/`new` initially.
3. Callback is provider-driven (epoint.az) — verify the callback endpoint is registered
   (no 404) without sending real money.

## D. Pre-order / order flow

1. `GET /customer-app/orders` → 200, list (may be empty for a fresh card).
2. `POST /customer-app/pre-order` with a valid menu item → 201/200; then `orders` shows it.

## E. Profile & preferences (P4.1)

1. `POST /customer-app/otp/send` with the customer's phone → verify code is NOT returned in prod
   (expect masked, not plaintext).
2. `POST /customer-app/profile/name` → update name → `session` reflects it.
3. `POST /customer-app/profile/birthday` → set birthday → reflected.
4. `POST /customer-app/preferences` → flip `sms_opt_in: true` → `session`/prefs shows it.
   Same for `push_opt_in`.

## F. Rewards & campaigns

1. `POST /customer-app/campaigns/{campaign_id}/activate` for an active campaign → 200.
2. `POST /customer-app/rewards/claim` → validates redemption; expect a clean error if
   insufficient stars (no 500).
3. `GET /customer-app/session` shows stars/balance.

## G. Push engagement (P4.5)

1. `POST /customer-app/push-engagement?id=<card>&t=<token>` with a known `delivery_id`
   → 200, records an open.
2. Re-submit same delivery → idempotent (no duplicate).
3. Push funnel in admin shows `opened` increments; open_tracking honest.

## H. Browser / manual (owner visual)

Open in browser (**web = root URL + query param — there is no `/customer.html` on the web host**):
- Join / onboarding: `https://super.ironwaves.store/?join=1`
- With club + discount (same as the admin QR): `https://super.ironwaves.store/?join=1&club=golden&discount=5`
- Returning customer: `https://super.ironwaves.store/?id=<real-card-id>&t=<real-token>`

> `customer.html` exists **only** in the native build (`npm run build:customer`, iOS/Android single-file).
> The web deploy ships `npm run build` → SPA at `/`, which routes to `CustomerApp` from the query
> (`join=1` / `id`+`t`). Requesting `/customer.html` hits `server.js` extension branch → plain
> `404 Not found`.
- Onboarding screen (join) with consent.
- After a successful sign-up the app scrubs the URL to `?customer=1`
  (`scrubCustomerSessionFromUrl`, CustomerApp.tsx L66) and stores
  `customer_card_id__<host>` / `customer_token__<host>` in localStorage.
  **`?customer=1` is the expected, correct end state — not an error.**
- **Verified live 2026-10-12 (headless Chrome, temp customer, then deleted):**
  `?id=…&t=…` → URL becomes `?customer=1` and home renders (stars, cashback 0.00 ₼,
  membership QR `QRE4 C0AB 3C`); fresh tab at `?customer=1` → same home screen (session
  restored from localStorage); `https://super.ironwaves.store/` with **no query** → staff
  **PIN** screen. So the customer app is reachable only via the query params —
  star the `?customer=1` URL or add it to the home screen.
- Home: stars/balance/hero.
- Offers/list.
- Profile tab: name, phone, 3 notification switches.
- "Wallet pass" hidden when not configured (F5.3).
Use a real customer card (pick one) — read-only visual, no writes.

---

## Statuses I verified live (2026-10-11)
- Super domain: `super.ironwaves.store`; business `iRonWaves Platform`.
- 134 customers, all have token, push_opt_in=true.
- Wrong-token session via API direct → **401** (correct).
- The `/api/v1/gl/accounts` 200-on-domain was SPA fallback, not a leak.

---

## Deep pass v2 — 2026-10-12 (`scripts/customer_app_super_smoke_v2.py`)

**32/32 PASS**, zero writes visible to staff. Run:
```
APIBASE=https://ironwaves-pos-platform-production.up.railway.app \
TENANT_DOMAIN=super.ironwaves.store \
python3 scripts/customer_app_super_smoke_v2.py
```

Design choice: **no real pre-order and no real campaign activation.** A pre-order writes a
`KitchenOrder` and fires `_notify_front_of_house` → would ping live staff in the KDS. A campaign
activation writes a `campaign_activations` row that `delete-account` does **not** clean (no FK on
`card_id`). So D/F are verified through their guards only.

| area | checks | result |
|---|---|---|
| A onboarding | enroll 200; duplicate-email behaviour per mode | PASS |
| S session read | stores (1, has id), tier=Bronze, program_mode=cashback 5%, rewards catalog=1, push_prefs 3 channels, history | PASS |
| D orders | `orders` empty for fresh card; empty cart 400; missing `store_id` 400 "Filial seçilməyib"; unknown menu item 400 "Menyu məhsulu tapılmadı"; wrong token 401 | PASS |
| C epoint | `payment/create` + `payment/status` → **503 (not configured)**; guard fires *before* auth; `payment/callback` route registered (422, not 404) | PASS |
| F rewards/campaigns | unknown campaign 404; unknown reward 404; wrong method 405 | PASS |
| G push engagement | unknown delivery not 5xx; empty delivery 400 | PASS |
| E profile/prefs | name, birthday, push/email/sms all persist and read back | PASS |
| W wallet pass | `wallet-pass` 503 exactly when `bootstrap.wallet_pass_enabled` is false | PASS |
| B auth | wrong token 401; missing token 422; prefs without auth 422 | PASS |

### Findings (honest, not blockers)

1. **epoint is not configured on production** — `EPOINT_PUBLIC_KEY` / `EPOINT_PRIVATE_KEY` absent,
   so `payment/create|status` return 503 on every tenant. Online payment in the customer app is
   dark until the owner sets the epoint keys in Railway. `wallet_pass_enabled` is likewise false
   (no Apple Pass Type ID cert).
2. **`registration_mode: "simple"` means the duplicate-email 409 gate does not run.** The F5.1
   409 is scoped to `full` mode (`operations.py` L5557: `if registration_mode == "full" and email`).
   In `simple` mode an email may repeat and each call issues a **new** card+token — no takeover
   (the existing customer's token is never returned), but duplicates accumulate.
3. **No rate limiting** on `/customer-app/enroll` (no `slowapi`/limiter anywhere in `backend/app/`).
   Combined with (2) on the `simplest` public path this is a row-spam vector. Low severity, but
   worth a limiter if the join QR is placed publicly.

### Clean-up result
Suite leaves **0** `smoke-*@sample...` rows. One leaked row from an earlier run
(`QR-29AF06D9`, `smoke2-…@example.com`) was removed manually; super is back to its pre-test
count + the owner's own 3 manual sign-ups (Chrome ×2, iOS `App/1 CFNetwork` ×1, all 0 stars,
no email/name) — left untouched on purpose.


## Clean-up rule
Every automated test creates a temp customer; delete it at the end (call
`POST /customer-app/delete-account` with its id+token) so super's 134 stays exact.