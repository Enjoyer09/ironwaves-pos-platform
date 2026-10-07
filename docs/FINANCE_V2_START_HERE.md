# Finance v2 — START HERE (master handoff)

**Read this file first, completely, before touching anything.** It is the single entry point for the Finance v2
(general ledger, "GL") work in this repo: what was built, why, what state production is in, what is in flight,
what is broken or risky, and exactly what to do next.

> **Qısa (AZ):** Bu, Maliyyə v2 işinin əsas təhvil sənədidir. Nə qurulub, niyə belə qurulub, production-da vəziyyət
> necədir, hansı iş yarımçıqdır, hansı risklər var və növbəti addımlar hansılardır. Yeni agent əvvəlcə bunu oxuyur,
> sonra `docs/FINANCE_V2_HANDOFF.md` (dərin arxitektura) və `docs/finance-v2-handoff.md` (iş paketləri üçün prompt-lar).
> **Sahibkar Azərbaycan dilində danışır: ona Azərbaycan dilində, qısa və faktlarla cavab verin.**

- **Snapshot:** 2026-10-05, ~18:00 Asia/Baku (check `date`: the machine clock advanced three days during the previous session). `main` = `984025cd` (PR #41 merged); PR #42 (streak fix) and PR #40 (this document) may still be open: see `gh pr list`. Production runs `main`.
- **WP-A (Phase 1) status:** WP-A1, A2, A3, A4, A6 are implemented on branch `feature/finance-v2-wp-a` (**PR #TBD**, awaiting review, merge and deploy). WP-A5 (external alerts) is still open. Nothing in that PR changes a real tenant; the post-deploy commands in section 8 (Phase 1) are **not** run automatically.
- **How to refresh the snapshot:** every fact that can change is marked **[verify]** with the command to re-check it
  (section 9). Facts change fast; never trust this file over a command you just ran.
- **Companion files** (all in `docs/`):

| File | Use it for |
|---|---|
| `FINANCE_V2_START_HERE.md` (this) | Orientation, history, state, risks, the plan |
| `FINANCE_V2_HANDOFF.md` | Deep reference: architecture, data model, API, UI structure, invariants |
| `finance-v2-handoff.md` | Copy-paste prompt pack per work package (older; this file supersedes its ordering) |
| `finance-v2/accountant-review-az.md` | The 8 open accounting questions + known data corrections (Azerbaijani) |
| `finance-v2/original-design-az.md` | The first design proposal (historical; implementation deviates) |
| `finance-v2/history/pr39-wp3-review.md` | A full independent review of a weaker agent's PR: what went wrong and how it was found |
| `../CLAUDE.md` | How the whole IronWaves POS platform works (dual-mode frontend, tenants, auth, migrations) |

---

## 0. The 60-second version

1. IronWaves POS is a multi-tenant café/restaurant POS (React SPA + FastAPI + Postgres on Railway). Real customers
   use it daily, so **nothing may break or visibly change for them without the owner knowing.**
2. The old finance code had 30+ defects. The owner asked for an "Oracle-level" finance module. We built a **new
   double-entry general ledger** (AMHP = Azerbaijan national chart of accounts) **next to** the old one and are moving
   tenants over one at a time (the "strangler" pattern). Old data is never deleted.
3. A tenant climbs a ladder: `legacy` → **shadow** (GL mirrors legacy every 5 min, automatic for every tenant that has a GL chart) → **`dual`**
   (each business event also posts a native GL journal in the same DB transaction) → **reports source `gl`**
   (finance screens read numbers from the GL) → *(future, irreversible)* **legacy writes stop**.
4. Code is finished and in production up to and including bills/payables (WP3) **and the cut-over readiness package**
   (alerts, readiness check, supplier balances from GL, deadlock fix, UI QA; PR #41, section 6). What is missing before a real
   tenant can move is **WP-A** (section 8, Phase 1), not more infrastructure. WP-A1/A2/A3/A4/A6 are now implemented in **PR #TBD**
   (awaiting deploy); WP-A5 is open.
5. Production today: **Demo** and **Platform (super)** are `dual` + reports `gl` (both are test tenants). The **four real
   customers are still `legacy`/`legacy`** and must stay that way until the blockers in section 7 are fixed.
6. **The three traps (section 7, R1–R3) are fixed in code by PR #TBD, but fixed code is not a decision to move a tenant.** Before that PR
   the readiness script said `can_switch_to_dual = YES` for Gyros, Daily Coffee and Art Space (R19) and `dual` would have (a) shown the new
   "Mühasibat (v2)" menu to the customer's admins/managers, (b) made stock receipts demand a supplier, and (c) not rolled back cleanly.
   With the PR, (a) the module is hidden by default (`finance_v2_ui_visible`), (b) the supplier rule is its own setting
   (`finance_v2_require_supplier`, default off) and (c) a tenant that was ever dual is judged by the dual reconciler. The readiness verdict is
   **NO** for every tenant until an operator has explicitly recorded both settings (`--ui`, `--require-supplier`), and it lists what is missing.
   Even a YES is not permission: the owner-approved steps in section 8 still apply. **Do not switch any real tenant before the PR is merged and
   deployed and Phase 1's exit criteria are met.** An earlier statement that "dual is invisible to the customer" was wrong.
7. Waiting on the owner's accountant: tax base rules and correction entries. Not blocking the technical migration.

---

## 1. People, authority and communication

- **Owner** (the user): runs the business, speaks Azerbaijani, wants short factual replies, no fluff. Replies: plain text,
  short, state what was verified and what was not. He is not a developer; explain risks in business terms.
- **Accountant:** external; has not answered the 8 questions yet (`finance-v2/accountant-review-az.md`).
- **Delegation given by the owner (2026-10-02):** "I hand you the helm completely" for completing the migration safely.
  The previous agent's working agreement with him, which you should keep: *for every key step on a real customer,
  send him a short heads-up first; permission is not required for the steps marked **AUTO** in section 8, but it
  IS required for everything marked **ASK***. ASK = irreversible or destructive (stopping legacy writes, closing a real
  fiscal year, deleting backups/staging, anything that changes money on a real tenant, posting correction entries).
  If you are a *new* agent, re-confirm the delegation with the owner in one sentence before the first real-tenant step.
- **Pilot rule (owner decision 2026-10-02):** all production pilots/tests run on the **Platform (super) tenant**, which is
  "only for testing". Demo may also be used. Never pilot on a real customer tenant.
- **Earlier owner decisions still in force:**
  - Chart of accounts = AMHP. Posting rules bind to `system_role`, never to account codes.
  - Each tenant picks its own tax regime (most are on simplified tax 2% or 5%).
  - Offline: the server is the only accounting writer; POS queues sales offline with idempotency keys; finance ops
    are online-only; no second local ledger ("world practice").
  - Data corrections happen **after** migration, as GL adjusting journals, never by editing history.
  - Overpayment of a bill through the bill-pay API is **rejected**; voided bill numbers are **not reusable**;
    AR invoices (customer receivables) are **deferred**; a bill cannot be paid from the POS drawer (bank/safe only);
    no in-app "deallocate" for bills settled by the legacy supplier-payment path (documented manual correction).
  - Local backup copies are kept 3–4 days; **deletion planned for 2026-10-04** (ask first, offer to keep the newest).

---

## 2. The platform in two minutes (details: `../CLAUDE.md`)

- Repo `Enjoyer09/ironwaves-pos-platform`, local path `/Users/macbookair/Documents/GitHub/ironwaves-pos-platform`.
  Frontend: React + TS + Vite at the repo root (`src/`). Backend: FastAPI + SQLAlchemy + Alembic in `backend/`.
- Tenants are resolved by **host** (`x-tenant-domain` header → `tenant_domains` table). Every table is scoped by `tenant_id`.
- Roles: `super_admin` (platform owner, tenant switcher), `admin`, `manager`, `staff`, `kitchen`; the GL API also recognises
  `finance_admin`, `accountant`, `auditor`.
- Railway project `terrific-cat`, env `production`, services `ironwaves-pos-backend`, `ironwaves-pos-frontend`,
  `Postgres` (PG 18). **`main` auto-deploys.** The backend Dockerfile runs `alembic upgrade head` on every start.
  Backend URL `https://ironwaves-pos-platform-production.up.railway.app`. Production has **no staging environment**.
- `STARTUP_RUNTIME_MIGRATIONS_ENABLED=false` in production, so Alembic is the only schema path. `DEMO_TENANT_ENABLED=false`
  in production (if it were true, logging out of Demo would wipe Demo's Settings rows, including the ledger mode. See R10).
- Feature flags (backend `app/core/config.py`): `FINANCE_V2_ENABLED` (false; GL API is opened per tenant instead),
  `FINANCE_V2_SHADOW_ENABLED` (**true** in production), `FINANCE_V2_SHADOW_INTERVAL_SECONDS` (300),
  `FINANCE_V2_RECONCILE_HOUR_BAKU` (4).

### Tenants [verify: section 9, command C1]

| Tenant | Domain | Tenant id | Ledger mode | Reports source | Notes |
|---|---|---|---|---|---|
| iRonWaves Platform ("super") | super.ironwaves.store | `b3442582-fd16-40bc-bb6c-605c34ca3d48` | dual | **gl** (since 2026-10-02) | **Test tenant. Pilots go here.** Holds a test supplier `32aff833-c002-458a-bdef-2634310d080c` "GL Pilot Təchizatçı (test)" |
| iRonWaves Demo | demo.ironwaves.store | `5dcc537d-7905-4080-ad35-e6a05432dc83` | dual | gl | Demo / second pilot tenant |
| **Gyros Restaurant** | gyrospos.ironwaves.store | `01e69c82-085d-4611-8084-6ce3c6f37770` | legacy | legacy | **REAL customer** |
| **Daily Coffee & Drinks** | **emalatcoffee**.ironwaves.store | `6e2c0d4c-6fab-4e49-8f9d-2d675457c655` | legacy | legacy | **REAL customer** (domain says "emalatcoffee", not "dailycoffee") |
| **Emalatkhana Art Space & Cafe** | art-space.ironwaves.store | `dc9e5773-4464-453b-a7b1-fcb3b6ddba6e` | legacy | legacy | **REAL** (treated as real) |
| **Socialbee Coffee** | socialbee.ironwaves.store | `b3f7c248-8d5c-48d4-8ee1-f26dcaec0876` | legacy | legacy | **REAL**; **has no GL chart yet**, no shadow runs |
| Default Tenant | — | `tenant_default` | legacy | legacy | ignore |

---

## 3. Vocabulary

- **GL** general ledger (`gl_*` tables). **Legacy** the old finance tables (`finance_transactions`, `finance_entries`,
  `finance_ledger_entries`, `finance_accounts`). **AMHP** Azərbaycan Milli Hesablar Planı (60 accounts seeded per tenant).
- **Journal** = header + ≥2 lines, debits = credits, immutable once posted. **Storno** = reversal journal.
- **system_role** = stable semantic tag on an account (`cash_drawer`, `bank_main`, `safe`, `accounts_payable`…).
- **Shadow** = background job that mirrors legacy transactions into the GL (`source_module="legacy"`, `legacy_ref` set).
- **Dual** = every hooked business event also posts a *native* GL journal (`source_module="pos"` or `"gl"`) atomically with
  the legacy write; `gl_legacy_links` says which legacy txns a native journal *covers* (so shadow does not mirror them twice).
- **Explained difference** = a known, recorded gap between legacy and native books (e.g. legacy forgot card fees). Stored as
  `wallet_diff` on `gl_legacy_links`. **GL-only journals** (`source_module` in `("manual","gl")`) have no legacy twin; the
  dual reconciliation treats their wallet effect as explained (`GLOnlyJournal`).
- **Reports source** = where finance screens read numbers from (`legacy` or `gl`). Independent of ledger mode.
- **Reconcile** = integrity comparison legacy vs GL. `reconcile_tenant` (19 checks, legacy/shadow mode, assumes 1:1 mirroring) vs
  `reconcile_dual_tenant` (14 checks, dual mode). **Parity** = balance comparison legacy vs GL incl. explained differences.
- **Clean streak** = consecutive nightly reconcile runs that passed (`gl_shadow_runs`, `run_type='reconcile'`).
- **Maker-checker (4-eyes)** = the user who created a journal can never approve it, no role exempt.
- **Pilot** = a 1 ₼ test transaction set run inside the production container as `system:gl-pilot` (checker
  `system:gl-pilot-checker`), always fully reversed/voided afterwards, reconcile must be unchanged.

---

## 4. History: what was done, in order

Everything below is merged to `main` and deployed unless stated otherwise. Verify any claim with `git log`/`gh pr view`.

### 4.0 Before Finance v2
- The owner asked for a full audit of finance. It found **30+ defects**. The five critical ones were fixed first (they are in
  PR #31): approval bypass, investor overpayment, 0 % card commission, staff-meal cash handling, offline "fake success".
- Owner asked for a rebuilt finance module at "Oracle level", chart of accounts = AMHP. Design discussion (artifact
  "Maliyyə Modulu v2 — Arxitektura və Yol Xəritəsi", now `finance-v2/original-design-az.md`).

### 4.1 Safety net (2026-09-30 morning)
- Database is Railway Postgres 18 (not Neon). Backups: Railway volume backup (done by the owner) **plus** encrypted `pg_dump`
  (`openssl aes-256-cbc -pbkdf2 -iter 200000`, key in macOS Keychain entry `iw-backup-2026-09-30`) in `~/iw-backups/2026-09-30/`.
- **Staging** = local Docker container `iw-staging-pg` (127.0.0.1:55433, user `postgres`, password `staging`, db `railway`), a
  restore of the 2026-09-30 morning production dump. Row counts and money totals were verified equal to production.
  It is **stale** (production has moved on). Refresh it from the newest dump before any new rehearsal (section 10, recipe B3).

### 4.2 Phases (chronological)

| Phase | PR / merge | What it delivered | Key verification |
|---|---|---|---|
| **P0 GL core** | #31 `d57fbbf1` | `gl_*` tables + Alembic `20260929_0001` with **PG triggers** (posted journals immutable, balanced, closed period blocks posting, audit append-only); AMHP chart (`coa_az.py`); engine (`create/approve/reject/reverse_journal`, periods, gapless numbering `JV-YYYY-NNNNNN`, hash-chained audit); simplified tax + VAT split; reports (TB, BS, P&L, ledger); `/api/v1/gl` router behind `FINANCE_V2_ENABLED` | 43 tests; PG integration via Docker |
| **P1 migration** | (in #31, run in prod) | `migrate_tenant`: every legacy transaction became a GL journal (orig id in `legacy_ref`), `reconcile_tenant` 19 checks; prod initial import **9 047 journals**, all checks OK | staging rehearsal first, then production dry-run via `railway ssh` 19/19, then commit |
| **P1b shadow** | (in #31) | `FINANCE_V2_SHADOW_ENABLED=true`: 5-min incremental mirror + nightly reconcile at 04:00 Baku (advisory lock 7411) | live sync verified |
| **P2a + P2b-1** | #32 `902df5d8` | Posting rules (`posting_rules.py`: SaleCompleted/Refunded, Deposit*, DrawerFunded, CashCountVariance, WagePaid, WalletTransfer, ExpensePaid, OtherIncome, Financing, StockReceived/WrittenOff, SupplierPaid); **`bridge.py`** (ledger mode, `emit` never raises, falls back to shadow, `gl_legacy_links`); dual reconciliation; `gl_legacy_links` Alembic `20260930_0002` | 62 posting tests; staging HTTP rehearsal; Demo → dual in prod |
| **P2b-2** | #33 `fe24ea92` | Hooks for void/adjust/partial-refund, manual finance entries, transfers, investor repay, restock/loss, supplier pay | Demo production pilot: 2 sales + void OK |
| **P2c-1** | #34 `3ad0d027` | **Read model**: per-tenant reports source; the three lowest-level readers (`ledger_balances_snapshot`, `shift_cash_breakdown_from_ledger`, `sales_payment_totals`) dispatch on it, so every consumer switches together; `parity_report` | Demo reports → gl in prod |
| **P2c-2** | #35 `d2621b6b` | Z-report payment split from GL; **Platform → dual** (reconcile 19/19 → 14/14) | Demo pilot split OK |
| **P2d UI + gate** | #36 `dacf0add` | GL API opens **per tenant** when ledger mode is `dual` (404 otherwise); `GET /api/v1/gl/capabilities`; the **"Mühasibat (v2)"** admin module (overview, trial balance, ledger drill-down, journals + manual journal, approvals, periods, tax, integrity) | found+fixed: manual GL journals broke dual reconcile (now explained `GLOnlyJournal`); pilot 19/19 |
| **P3a** | #37 `0f63eccb` | **Year-end close** (closing journal → 343, `year_closed` guard, reopen via 4-eyes storno); **AP/AR sub-ledger** with FIFO aging; **Excel(CSV)/PDF export**; API refuses to reverse operational journals (`source_managed`); **refresh_tokens purge** (table never cleaned: 253 k dead rows; now hourly batched purge; verified 3 284 rows on 2026-10-01) | 874 backend tests; staging purge 249 645 rows in 4.2 s |
| **Docs** | #38 `5d5c3a45` | `FINANCE_V2_HANDOFF.md` + prompt pack | — |
| **WP3 bills (AP)** | #39 `371b87c6` | `gl_documents`, `gl_document_allocations` (Alembic `20261001_0001`); bills via StockReceived/ExpensePaid; payments GL-only (`source_module="gl"`), idempotent, row-locked, overpayment → 409; maker-checker void / payment reversal / reclass of unassigned AP; supplier required for dual stock receipts; due-date aging in "Borclar"; BillsTab | see 4.3; prod pilot on super **26/26**, reconcile 14/14 throughout |
| **Cut-over readiness** | #41 `984025cd` | `gl_alerts` + alerting (Alembic `20261002_0001`), read-only `gl_readiness.py`, supplier balance from GL AP sub-ledger when reports source = gl, canonical lock order + bounded 40P01 retry (PG probe 100 rounds, 0 deadlocks), UI QA (10 tabs, 2 viewports, no defects). **Found and fixed before merging:** the `native_error` alert in `bridge.emit` ran outside a savepoint, so on PostgreSQL a failing alert insert aborted the sale's own transaction (`PendingRollbackError`); PG regression test fails without the fix | SQLite 975/21, PG integration 21, frontend green; prod check 18/18 (synthetic alert raised, de-duplicated, acknowledged, resolved on super; real tenants have 0 alerts) |
| **Streak fix** | #42 | `shadow_status` counted reconciles inside the last 30 runs of any type, so frequent syncs truncated the clean streak (Gyros showed 2 after 6 clean nights). Now a reconcile-only query | regression test fails without fix (`0 == 6`); 976/22 |
| **Docs** | #40 | this file, accountant questions, original design, PR #39 review, CLAUDE.md pointer | — |

### 4.3 The WP3 story (why reviews matter)
WP3 was first written by a *different* AI agent (Gemini Flash) from the handoff. Its own tests were green (882 passed) but an
independent review + PostgreSQL rehearsal + 21 probe tests found: **2 CRITICAL** (bill payments broke the nightly reconciliation
14/14→12/14; concurrent/duplicate payments paid cash out twice), **5 HIGH** (invariant `sum(open bills) == AP sub-ledger`
broken by three supported paths; void/reclass bypassed maker-checker; unbounded reclass; bill creation = unrestricted manual
journal; supplier not required), missing spec items, inaccurate docs incl. an **unverified production claim written as fact**.
Everything was fixed on the same branch and re-reviewed (two models), then shipped. Full review: `finance-v2/history/pr39-wp3-review.md`.
**Lesson: green agent tests prove only the happy path. Always rehearse on Postgres with concurrency, run the dual
reconciliation after every money operation, and never write production facts you did not verify.**

### 4.4 Production events worth knowing
- 2026-09-30: all merges above up to #38, Demo+Platform dual, initial import, shadow on.
- 2026-10-01 07:26 UTC: first automatic refresh-token purge ran (253 003 → 3 284 rows, 39 live).
- 2026-10-02: PR #39 merged + deployed (backup `railway-prod-2026-10-02-premerge-p3b.dump.enc`, 58.2 MB, 60 tables; the first
  backup attempt was interrupted and left a 0-byte file — it was deleted and redone, always check the size).
  Pilot on super: 26/26. **Super switched to reports `gl`** (parity OK: all 8 wallet balances identical; reconcile 14/14).
  Nightly reconcile: `ok` on 09-30, 10-01, 10-02 for art-space, demo, emalatcoffee, gyros, super; 0 `native_error`.
- 2026-10-05: PR #41 merged + deployed (backup `railway-prod-2026-10-02-premerge-cutover.dump.enc`, 59.0 MB, **62 tables**; the table count
  rose from 60 to 62 with the two WP3 tables). Post-deploy check 18/18. Nightly reconcile `ok` every night 09-30 → 10-05 for art-space, demo,
  emalatcoffee, gyros, super; 0 `native_error` ever; `refresh_tokens` 3 559 rows. The 2026-10-04 backup-deletion date passed without
  deletion (nobody was asked): the backups and `iw-staging-pg` are all still there.

---

## 5. Architecture digest (deep version: `FINANCE_V2_HANDOFF.md` §2–§4)

```
POS/restaurant/ops routers ──► legacy finance_service (unchanged, still authoritative for legacy tenants)
        │                              │ record_legacy_posting(txn_id)  (pending list on the DB session)
        └──► bridge.emit(event) ───────┤
              mode == dual ?           ▼
              yes → posting_rules → engine.create_journal → gl_journals/lines/balances/audit + gl_legacy_links
              no / error → nothing native (error logged as native_error); shadow mirrors legacy later
shadow (every 300 s): migrate_tenant(incremental) mirrors uncovered legacy txns; 04:00 Baku: reconcile + record run
readers (reports source gl): read_model.* return legacy-shaped responses computed from the GL
```

Non-negotiable invariants (full list in `FINANCE_V2_HANDOFF.md` §2.5):
1. Engine never commits; the caller (router `_run`) owns the transaction. `emit` never raises in `dual`.
2. Posted journals are immutable; corrections = storno/adjusting journals. PG triggers enforce it (SQLite tests enforce in code).
3. Maker-checker everywhere; reversals from the API always need a second person; only GL-owned journals (`manual`,`gl`) are
   reversible through `/journals/{id}/reverse`.
4. Money is `Decimal` quantized to 0.01 (backend) and `decimal.js` (frontend). Never floats. Business date = Asia/Baku
   (`engine.business_today()`); DB timestamps are naive UTC.
5. A closed period accepts nothing; a closed fiscal year accepts nothing except its own closing entry.
6. Idempotency keys on every write that can be retried (same key + same amount → original result; different amount → 409).
7. Lock order (documented at the top of `engine.py`): journal row → guarded accounts (ascending id) → period →
   balances (sorted key) → sequence last. Bill payments lock the document before the engine runs.
8. Bill payments are **GL-only** journals: legacy wallets never see them (see R4).
9. Reconciliation must stay 14/14 (dual) after every operation. If a new journal source touches a wallet account without a
   legacy twin, it will break the nightly check unless `source_module` is in `GL_ONLY_SOURCE_MODULES`.

GL API surface and roles: `FINANCE_V2_HANDOFF.md` §3. Frontend structure and the "how to add a tab" recipe: §4.
Scripts: `backend/scripts/gl_ledger_mode.py` (`--list`, `--tenant X --set dual|legacy --reason`, `--reconcile`, `--parity`,
`--reports gl|legacy`, `--ui visible|hidden`, `--require-supplier on|off`; refuses production hosts without `--allow-production`;
`--set dual` creates the chart and the first mirror in one transaction and rolls everything back if the reconcile fails; `--set legacy` prints a
WARNING when the tenant owns native journals), `gl_migrate_legacy.py` (`--all --dry-run --allow-production`), and `gl_readiness.py`
(read-only tenant go/no-go, see R19; it cannot create a chart, it says NO and names `--set dual`).
Per-tenant settings (table `settings`, same storage pattern as the ledger mode): `finance_v2_ledger_mode`, `finance_v2_reports_source`,
`finance_v2_ui_visible` (default hidden), `finance_v2_require_supplier` (default off). The reconciler is picked from the tenant's history.

---

## 6. Recently landed and still open  [verify: C2]

**Nothing substantial is in flight as of this snapshot.** Check `gh pr list` and `git worktree list` first.

- **PR #41 (cut-over readiness) is merged and deployed.** Contents in the table in 4.2. New production objects: table `gl_alerts`,
  endpoints `GET /api/v1/gl/alerts`, `POST /alerts/{id}/acknowledge`, `GET /alerts/all` (super_admin only), the red banner / "Nəzarət"
  badge in the panel, the `[gl-alert]` ERROR log line, `backend/scripts/gl_readiness.py`, and the GL-sourced balance in the Suppliers list.
- **PR #42 (streak fix) and PR #40 (docs)**: open at the time of writing unless `gh pr list` says otherwise. #42 is a read-only code path
  (no schema change); merging either triggers the normal Railway redeploy.
- **A git worktree** `.worktrees/finance-v2-cutover-prep` (branch `feature/finance-v2-cutover-prep`, merged) still exists locally.
  Remove it: `git worktree remove .worktrees/finance-v2-cutover-prep && git branch -d feature/finance-v2-cutover-prep`.
  It contains a `node_modules` symlink and an untracked `.agents/` folder: nothing to save there except the QA report
  (`/Users/macbookair/Documents/GitHub/ironwaves-pos-platform/.agents/qa/finance-v2/QA-REPORT.md` and 20 screenshots, outside git).
- **What the alerting does and does not do.** A failed nightly reconcile, a broken clean streak or a `native_error` writes one open row per
  tenant+type to `gl_alerts`, logs `[gl-alert] tenant=… type=… detail=…` at ERROR, shows a red banner to the tenant's finance roles (and to
  super_admin through `/alerts/all`), and auto-resolves on the next clean nightly run. **It does not notify anyone outside the panel**
  (`notify_external` is a deliberate no-op; no e-mail/Telegram/SMS secret exists). For the real-tenant rollout somebody has to *look*: check
  `/alerts/all` as super_admin and `railway logs | grep gl-alert` every morning, or build the external channel first (section 8, Phase 1, WP-A5).
- **UI QA result:** 10 tabs × (1440×900, 390×844): no console errors, no page-level horizontal overflow, Escape closes nested dialogs one at a
  time, focus ring visible, az/ru/en switch works. Open observation (not fixed, app-wide, product decision): a global `src/index.css` rule
  shrinks `rem` on small *mouse* windows, so controls declared `min-h-11` can be below 44 px there; real touch devices (`pointer: coarse`) get 44/48 px.
  Full WCAG conformance is **not** claimed: it needs manual assistive-technology testing.

How to run a work package through Kiro workflows (what the previous agent did): `run_workflow` with a `workflowPrompt` brief (planner → coder(s) →
two independent reviewers on different models in parallel → aggregator last → loop while CRITICAL/HIGH remain). Read the generated step prompts
in `~/.kiro/sessions/*/workflows/<id>/workflow-definition.json` (a step named `finalize-merge` only re-verified; it never merged). Then verify the
result yourself before shipping: workflow reviews approved a change that could abort a sale's transaction on PostgreSQL (section 11, #17).

---

## 7. Risk and defect register (read before any real-tenant step)

Severity: **BLOCKER** = must be fixed before a real tenant changes mode. Facts marked ✔ were reproduced/read in code on 2026-10-02.

| ID | Sev | Issue | Evidence | Resolution |
|---|---|---|---|---|
| **R1** | **BLOCKER** (fixed in PR #TBD) | **Dual mode makes the new module visible to the customer.** `_tenant_enabled()` opens `/api/v1/gl/*` for any `dual` tenant, `capabilities.enabled=true`, and `App.tsx` `canAccess('financev2')` is true for admin/super_admin and for managers who can see Finance. So the day Daily Coffee goes dual its admins see "Mühasibat (v2)" and can post manual journals/pay bills. | ✔ `backend/app/gl/router.py:34-48`, `src/App.tsx` ~1205 | **Fixed in PR #TBD (WP-A1).** Setting `finance_v2_ui_visible`, default **hidden**: a dual-but-hidden tenant gets 404 on every `/api/v1/gl/*` route for every authenticated role except `super_admin` (second router dependency after `get_current_user`; the old before-auth 404 for non-dual tenants is unchanged); `capabilities.ui_visible`; `App.tsx` uses `isFinanceV2Available`. Tested: all 37 routes × 6 roles, visible/hidden toggle, malformed values, jobs unaffected, node test for the gate. |
| **R2** | **BLOCKER** (fixed in PR #TBD) | **Dual mode changes stock receipts.** `catalog._resolve_supplier` returns 400 `supplier_required` whenever `get_ledger_mode()=="dual"` and the receipt has an amount. Customers currently restock without a supplier (that is why ~8 720 ₼ / 428 ₼ of AP is "unassigned" on Art Space / Daily Coffee). The customer's staff would hit an error on day 1. `InventoryPanel.tsx` reads `caps.ledger_mode` for the UI side. | ✔ `backend/app/routers/catalog.py:175-185`, `InventoryPanel.tsx:52` | **Fixed in PR #TBD (WP-A2).** The function is really `catalog._require_supplier_for_dual_receipt` (now `_resolve_receipt_supplier`); it reads the per-tenant setting `finance_v2_require_supplier` (default **off**) at the 3 call sites. `InventoryPanel` reads `GET /api/v1/catalog/inventory/policy` (any tenant role) instead of `/gl/capabilities`. Set it **on** for Demo/super by the post-deploy command to keep that behaviour covered. |
| **R3** | **BLOCKER (for the rollback promise)** (fixed in PR #TBD) | **`dual → legacy` is not a clean rollback.** After dual activity, `reconcile_tenant` (used when mode is `legacy`) fails: on the Demo staging copy it scores **9/19** (`transaction_count 55 vs 10`, wallet balances, P&L, `reversal_links`) because native compound journals replace per-transaction mirrors. The nightly job would then raise `reconcile_failed` alerts. | ✔ run on 2026-10-02: `reconcile_dual_tenant` 14/14 but `reconcile_tenant` 9/19 | WP-A3: either make reconcile mode-history-aware, or treat `dual` as a one-way door and use **`--reports legacy`** as the only routine rollback. Until fixed, **never promise "one command back"** for the mode itself. **Fixed in PR #TBD (WP-A3, first option):** `legacy_migration.reconcile_for_tenant` picks `reconcile_dual_tenant` for any tenant that is dual or ever was (link row or audit `to=dual`); used by the nightly job, readiness and `gl_ledger_mode.py`. Proven dual→legacy→dual with sales (and a void) in every phase, SQLite and PG: nothing is mirrored twice. **Honest limit:** `--set legacy` does not remove native journals; it prints a WARNING and the nightly check keeps using the dual reconciler. |
| **R4** | HIGH | **Bill payments are GL-only**, so legacy wallet screens overstate bank/safe by the amount paid, and `Supplier.balance` ignores bills. Mitigated only for tenants whose reports source is `gl` (and, since #41, for the Suppliers screen: it shows the GL AP balance when reports source is `gl`). A real tenant must not use bills before its reports source is `gl`. | documented in `FINANCE_V2_HANDOFF.md` §2.5 | Keep the bills feature off for legacy-reports tenants (WP-A1 hides the whole module); WP4 removes the issue |
| **R5** | HIGH | **Switching reports to `gl` can change numbers the customer sees** by the recorded explained differences (e.g. Demo: card −3.92, cash +4.00 on sales; legacy forgot bank fees). This is correct but visible, and the accountant/owner should know first. | ✔ `--reconcile` output on Demo copy | Review `parity_report.explained_diff` per tenant; tell the owner the magnitude before the switch |
| R6 | MED | Accountant has not answered 8 questions. The simplified-tax base currently = net credit turnover of all revenue accounts incl. 611.1 cash overage, 611.9 other income and staff-meal sales value (Q1/Q2). | `accountant-review-az.md` §5 | Do not activate tax accrual for real tenants until answered |
| R7 | MED | Known data problems (Gyros: 27 039.35 ₼ pending X-report difference since 2026-08-22, safe −2 400, suspense 538.9 = 1 319.30. Daily Coffee: safe −847.40, inventory −2 830.68, receivable −43.00, suspense 384.70, "Borc Alındı" 40 ₼ booked as income) | `accountant-review-az.md` §6 | Correct **after** migration via owner-approved adjusting journals (ASK) |
| R8 | MED | A legacy supplier payment that settled bills can't be unwound in-app; a legacy payment made via shadow-fallback stays unallocated | PR #39 body | Deferred (`WP3-def`) |
| R9 | MED | `gl_documents`/allocations have no PG immutability triggers; AR invoices not implemented | review F24/F25 | Deferred |
| R10 | MED | `_reset_demo_tenant_runtime` (`auth.py:505`) deletes a tenant's **Settings** rows (ledger mode, reports source) on logout from the Demo tenant when `DEMO_TENANT_ENABLED=true`. It is `false` in production ✔ (Railway variable), but turning it on would silently revert Demo to legacy. | ✔ read | Never enable it in production; or exclude `finance_v2_*` keys (this also wipes `finance_v2_ui_visible` and `finance_v2_require_supplier`, i.e. Demo would silently become hidden/optional again) |
| R11 | MED | **CI does not run PostgreSQL tests or the frontend node tests.** Job "Backend Integration (PostgreSQL)" shows *skipping* on PRs (needs `INTEGRATION_DATABASE_URL`); `test:smoke`, `test:gl`, `test:gl:bills` are not in `ci.yml`. CI only compiles, runs SQLite pytest, `alembic upgrade head --sql`, `npm run typecheck` and the Vite build. | ✔ `.github/workflows/ci.yml` | Always run PG tests + node tests locally (V-all) before merging |
| R12 | — | ~~Engine approval-vs-posting deadlock~~ | fixed in #41 (lock order + bounded 40P01 retry; PG probe 100 rounds, 0 deadlocks) | done |
| R13 | — | ~~No browser QA~~ | done in #41 (no defects; WCAG not claimed) | manual assistive-tech test still open |
| R14 | LOW (fixed in PR #TBD) | SocialBee has no GL chart, so `gl_ledger_mode.py --set dual` would fail (`accounts_by_role`) and `reconcile_tenant` raised `KeyError 'cash_drawer'` | WP3 verification | **Fixed in PR #TBD (WP-A4), with a correction:** on the original code `--set dual` on a chartless tenant already worked (its `sync_tenant` ran `migrate_tenant`, which calls `ensure_chart`); what crashed was `--reconcile` (`KeyError 'cash_drawer'`), and a failed reconcile left the chart and mirror committed. Now `--set dual` is one transaction (chart, mirror, mode, reconcile) and rolls back as a whole; `--reconcile` and readiness print a clear "no chart" message. |
| R15 | LOW | Railway warns `railway.json`/`railway.toml` Config-as-Code stops working **2026-12-01** | `railway` CLI output | `railway config migrate` on a branch, test, deploy before that date |
| R16 | LOW | DB size: `audit_logs` ≈ 100 MB, `sales.receipt_html` ≈ 76 MB | earlier size analysis | retention/archiving proposal (owner's call) |
| R17 | INFO | Backups: **10** encrypted dumps in `~/iw-backups/2026-09-30/` (latest `railway-prod-2026-10-02-premerge-cutover.dump.enc`, 59.0 MB, 62 tables). Owner's planned deletion date **2026-10-04 has passed; nothing was deleted and nobody asked**: ask now. Staging container `iw-staging-pg` + volume `iw-staging-pgdata`, Keychain key `iw-backup-2026-09-30`. | ✔ `ls` | ASK before deleting; offer to keep the newest dump; new dumps need the same key |
| R18 | INFO | Railway SSH key `macbookair-finance-v2` was registered on the Railway account so scripts can run in the container | — | remove it when the migration is finished (ASK) |
| **R19** | **HIGH** (fixed in PR #TBD) | **`gl_readiness.py` is necessary, not sufficient.** It does not model R1 (module visible), R2 (supplier required), R3 (no clean rollback) or R5 (numbers shift when reports move to `gl`). On 2026-10-05 it printed `can_switch_to_dual = YES` for Gyros, Daily Coffee and Art Space. | ✔ post-deploy check | **Fixed in PR #TBD (WP-A6).** `can_switch_to_dual` now also needs: `finance_v2_ui_visible` explicitly recorded, `finance_v2_require_supplier` explicitly recorded (hidden/visible and off/on are both fine, absent is not), and the history-aware reconciler selected (structural check; it proves the wiring, not a future clean flip). The reports verdict prints `explained_diff_review` (every non-zero explained difference with its amount; informational, R5 stays a human decision). |
| **R20** | MED | **Alerts are visible only inside the panel and the logs.** No one is paged. `/alerts/all` works only for `super_admin` on the platform domain. With R1's fix the customer's admins would not see the banner either (hidden module), so for a real tenant the only observer is the platform owner | by design (no secrets available) | WP-A5: external channel (owner decides: e-mail via existing SMTP settings if present, or Telegram) or a daily "finance v2 status" line in an existing admin report |

---

## 8. The plan ahead

Legend: **AUTO** = proceed, then inform the owner briefly. **ASK** = get the owner's explicit yes first. Every production step
is: backup → PR → CI → merge → deploy SUCCESS → verify (section 9/10). Never skip a step "because it is only docs".

### Phase 0 — land the cut-over readiness branch — **DONE (PR #41, 2026-10-05)**; remaining: merge #42 and #40, remove the worktree (AUTO)
Finish per section 6. Exit criteria: PR merged; both services SUCCESS on the merge commit; `alembic_version = 20261002_0001`; new
endpoints return 401 (not 500) for super; `gl_readiness.py` output saved for every tenant.

### Phase 1 — fix the blockers before any real tenant moves (AUTO; one PR, maybe two)
**Status:** WP-A1, WP-A2, WP-A3, WP-A4, WP-A6 implemented in PR #TBD (awaiting deploy); **WP-A5 open.** The descriptions below are the original brief; the
implementation notes are in section 7 (R1, R2, R3, R14, R19).
**Post-deploy commands (run by the orchestrator, NOT auto-run on deploy).** Until they run, "Mühasibat (v2)" is hidden for Demo's and Platform's
non-super users (super_admin keeps access by role). Both are test tenants. Pattern from section 9 (`< /dev/null`):
```bash
# make Demo and Platform visible
railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant 5dcc537d-7905-4080-ad35-e6a05432dc83 --ui visible --reason "WP-A1: Demo is a test tenant, keep the panel" --allow-production' < /dev/null
railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant b3442582-fd16-40bc-bb6c-605c34ca3d48 --ui visible --reason "WP-A1: Platform is a test tenant, keep the panel" --allow-production' < /dev/null
# keep "supplier required" on the two test tenants (otherwise their receipts stop requiring a supplier)
railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant 5dcc537d-7905-4080-ad35-e6a05432dc83 --require-supplier on --reason "WP-A2: keep supplier required on test tenant" --allow-production' < /dev/null
railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant b3442582-fd16-40bc-bb6c-605c34ca3d48 --require-supplier on --reason "WP-A2: keep supplier required on test tenant" --allow-production' < /dev/null
# verify: gl_ledger_mode.py --list --allow-production now prints ui=... require_supplier=... per tenant
```
Nothing is run for the four real tenants. For a real tenant the settings are recorded explicitly (as `hidden` / `off`) in Phase 2 step 2.
**WP-A1 — per-tenant visibility of Finance v2 (fixes R1).**
- New per-tenant setting (table `settings`, JSON like the mode) e.g. key `finance_v2_ui_visible` → `{"visible": false}`; default hidden.
- Backend: `capabilities` returns `ui_visible`. API gate: if the tenant is dual **and** not `ui_visible`, every `/api/v1/gl/*` call
  returns **404 for every role except `super_admin`** (super_admin must keep access to support/pilot a tenant). Note `_enabled`
  runs before auth on purpose; add a second dependency after `get_current_user`. Shadow/reconcile/alerts run in-process and are unaffected.
- Frontend: `glAvailable = caps.enabled && (caps.ui_visible || role==='super_admin')` in `App.tsx`; `AdminPanel` already renders only on request.
- Script: `gl_ledger_mode.py --tenant X --ui visible|hidden --reason ... --allow-production` (audited in the GL chain).
- Tests: hidden tenant → 404 for admin/manager/accountant, 200 for super_admin; visible → normal; default for Demo/super set to visible.
  Run a Playwright check that a hidden dual tenant's admin has no menu item.
**WP-A2 — supplier requirement independent of ledger mode (fixes R2).**
- New per-tenant setting `finance_v2_require_supplier` (default **off**). `catalog._resolve_supplier` and the inventory restock UI read it instead
  of `get_ledger_mode()`. Set it **on** for Demo and super (they are test tenants) to keep the behaviour covered by tests.
- Write the customer-facing switch-on plan separately (needs the owner: staff must learn to pick a supplier) — not part of migration.
**WP-A3 — make rollback honest (fixes R3).** Pick one and document it:
- (preferred) teach `reconcile_tenant`/`reconcile_shadow` to run the dual reconciliation whenever a tenant *has ever been dual* (e.g.
  any `gl_legacy_links` row or an audit event `LEDGER_MODE_CHANGED to=dual`), so `dual→legacy` no longer self-reports failure; test by
  flipping a tenant dual→legacy→dual with sales in each phase and asserting the nightly reconcile stays green; or
- declare dual a one-way door, remove `--set legacy` from the runbooks for tenants with native journals and make the script refuse it
  unless `--i-know-reconcile-will-fail`. Routine rollback is then `--reports legacy` only.
**WP-A4 — SocialBee/other charts (R14):** make `gl_ledger_mode.py --set dual` and `gl_readiness.py` call `ensure_chart` or fail with a clear message.
**WP-A5 — someone must be told (R20).** Ask the owner which channel he actually reads; implement `alerts.notify_external` for it without putting new
secrets in git (Railway variables only), de-duplicated so one alert = one message; test with a fake transport.
**WP-A6 — make the readiness verdict honest (R19).** Add the blockers R1/R2/R3 as computed facts (ui visibility setting, supplier-requirement setting,
"rollback verified" flag) so `can_switch_to_dual` is `no` until they are satisfied.

Exit criteria for Phase 1: merged, deployed, pilot on super (hidden ↔ visible toggled; a hidden-mode check as a non-super admin role
through router functions), reconcile 14/14 on Demo/super, legacy tenants still 404 from outside.

### Phase 2 — Daily Coffee (`6e2c0d4c-…`, domain emalatcoffee) (AUTO with heads-up to the owner)
Why first: smaller than Gyros, real but low volume. Steps:
1. Prep: fresh backup; refresh staging from it (B3); on the throwaway copy run `gl_readiness.py --tenant 6e2c0d4c-… --json`.
   Required: chart present, `reconcile_tenant` 19/19, clean streak ≥ 2, 0 native errors in 7 days, shadow lag small.
2. Record both settings explicitly (the readiness verdict stays NO until you do; defaults alone are not enough):
   `gl_ledger_mode.py --tenant 6e2c0d4c-… --ui hidden --reason "..." --allow-production` and `--require-supplier off --reason "..." --allow-production`.
3. Send the owner a 2-line heads-up ("Daily Coffee → dual tonight, customer sees no change").
4. `gl_ledger_mode.py --tenant 6e2c0d4c-… --set dual --reason "..." --allow-production` (inside the container), then `--reconcile` → **14/14**.
   Confirm from outside: `/api/v1/gl/capabilities` as a non-super admin → 404 (hidden).
5. Watch: next 3 nightly runs (`gl_readiness`, alerts banner for super, `railway logs | grep gl-alert`), `native_error` = 0,
   streak grows. If any `reconcile_failed`: stop, diagnose, do not proceed.
6. After ≥ 3 clean nights: `--parity`. Read every `explained_diff`. Tell the owner the expected visible shifts (R5) and get a yes (**ASK**) for the
   reports switch on the real customer, because numbers will change slightly.
7. `--reports gl` → reconcile → next morning compare Z-report totals/cash flow with the cashier's count. Watch 7 days.
8. Rollback ladder: (a) `--reports legacy` (safe, instant), (b) `--set legacy` (WP-A3 is done: the nightly check keeps using the dual reconciler; native journals stay in the GL and the script warns; it is not a full rewind). Otherwise call the owner.
9. Do **not** enable bills, tax accrual or corrections yet.

### Phase 3 — Gyros (`01e69c82-…`) (same as Phase 2, start ≥ 7 days after Daily Coffee is stable)
Gyros is the larger tenant with the 27 039.35 ₼ pending difference. Keep the legacy numbers identical at migration; the correction is Phase 5.

### Phase 4 — Art Space (`dc9e5773-…`) and SocialBee (`b3f7c248-…`)
SocialBee first needs a chart + first mirror (`migrate_tenant`, reconcile 19/19, then a few nights). Then the same ladder.

### Phase 5 — accountant-driven work (ASK; blocked on the accountant)
1. Get the answers to the 8 questions (`finance-v2/accountant-review-az.md` §5), encode them (tax base in `tax._period_revenue_base`,
   category map in `legacy_migration.EXPENSE_CATEGORY_ROLES`, etc.) with tests.
2. Draft adjusting journals for section 6 of that file as a reviewable table (account, amount, reason); owner approves each; post as
   `journal_type="adjustment"` with maker-checker. Never edit history.
3. Set each tenant's tax regime (`POST /tax-profile`, effective the 1st of a month), then accrue monthly (`/tax/simplified/accrue`).
4. Only then make Finance v2 visible (`ui_visible=true`) to the customer's admins, with a short Azerbaijani guide; enable `require_supplier`
   and bills per tenant after staff training. Reclass historic unassigned AP to real suppliers (owner-approved).

### Phase 6 — WP4 / P2e: stop writing the legacy ledger (ASK, irreversible)
Only after **every** active tenant has had reports `gl` and clean nights for ≥ 2 weeks. Design in `FINANCE_V2_HANDOFF.md` §7.2 (ledger mode
`gl`: hooks post natively only; `emit` raises; shadow off; inventory every legacy writer **and reader**; one-way, fresh backup immediately before).
Rollout order Demo → super → Daily Coffee → Gyros → the rest, one per week.

### Phase 7 — housekeeping and later (mostly AUTO)
- 2026-10-04: backups/staging/Keychain key deletion (**ASK**, offer to keep the newest dump). Deleting the only copy of a key makes dumps unreadable.
- `railway config migrate` before 2026-12-01 (R15). Remove the SSH key when done (R18). Add PG tests + node tests to CI (R11).
- Year-end: closing a *real* tenant's fiscal year is **ASK**. Statement: `year_status(2025)` had no blockers for Demo/super.
- Possible next features (none requested yet): AR invoices, bank-statement import & reconciliation, fixed assets & depreciation, tax
  declaration forms, budget vs actual, multi-currency, KPI charts, a payroll process (accountant Q4), delivery-platform settlement (Q5).

---

## 9. Verify-the-world commands (run these first; all read-only)

All production scripts run **inside the backend container** (the public DB proxy costs ~75 ms per query). Pattern — write the local file
first, run afterwards (never in the same parallel batch: the file may not exist yet), and set `PYTHONPATH`:
```bash
cd /Users/macbookair/Documents/GitHub/ironwaves-pos-platform     # the Railway CLI is linked to this dir
railway ssh --service ironwaves-pos-backend -- sh -c 'cat > /tmp/x.py && cd /app && PYTHONPATH=/app python /tmp/x.py; rm -f /tmp/x.py' < /tmp/x.py
railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --list --allow-production' < /dev/null
```
`httpx` is not installed in the image: call router functions directly, never FastAPI's `TestClient`.

- **C1 — modes/sources/nights/errors per tenant** (what I used on 2026-10-02):
```python
from app.db import SessionLocal
from app.gl.models import GLShadowRun
from app.gl.bridge import get_ledger_mode
from app.gl.read_model import reports_source
from app.models import Tenant
db = SessionLocal()
for t in db.query(Tenant).order_by(Tenant.domain).all():
    runs = (db.query(GLShadowRun).filter(GLShadowRun.tenant_id == t.id, GLShadowRun.run_type == "reconcile")
            .order_by(GLShadowRun.started_at.desc()).limit(5).all())
    errs = db.query(GLShadowRun).filter(GLShadowRun.tenant_id == t.id, GLShadowRun.run_type == "native_error").count()
    print(t.domain, get_ledger_mode(db, t.id), reports_source(db, t.id), "native_errors", errs,
          [f"{r.started_at:%m-%d}:{'ok' if r.ok else 'FAIL'}" for r in runs])
```
- **C2 — git state:** `git fetch --prune; git log --oneline origin/main -10; gh pr list --state all --limit 10; git worktree list;`
  `git -C .worktrees/finance-v2-cutover-prep log --oneline origin/main..HEAD`.
- **C3 — deploy status:** `railway deployment list --service ironwaves-pos-backend --json | python3 -c 'import sys,json;d=json.load(sys.stdin)[0];print(d["status"],d["meta"]["commitHash"][:8])'` (same for `ironwaves-pos-frontend`). Note: a docs-only merge may show backend `SKIPPED`.
- **C4 — gate from outside** (404 = disabled, or not a dual tenant; 401 = dual, waiting for auth. A dual tenant whose UI is hidden also answers 401 to an anonymous caller, because the hidden check runs after auth; an authenticated non-super role gets 404 there, super_admin gets 200):
  `curl -s -o /dev/null -w "%{http_code}\n" -H "X-Tenant-Domain: gyrospos.ironwaves.store" https://ironwaves-pos-platform-production.up.railway.app/api/v1/gl/capabilities`
- **C5 — Alembic/tokens:** `SELECT version_num FROM alembic_version` (expect `20261002_0001` on `main`); `SELECT count(*) FROM refresh_tokens` (thousands, not 250 k).
- **C6 — logs:** `railway logs --service ironwaves-pos-backend | grep -iE "traceback|native_error|deadlock|gl-alert"`.
- **C7 — Railway variable without leaking secrets:** print only named keys, e.g. `d.get("DEMO_TENANT_ENABLED")`. Never print `DATABASE_PUBLIC_URL`, JWT or passwords.

---

## 10. How to do each kind of work (runbooks)

### B1 — encrypted production backup (always before a merge/mode change). Run from the repo dir. Check the size afterwards.
```bash
set -o pipefail; D=~/iw-backups/2026-09-30; F=railway-prod-<date>-<reason>.dump.enc
URL=$(railway variables --service Postgres --json | python3 -c 'import sys,json;print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')
K=$(security find-generic-password -a iw-backup -s iw-backup-2026-09-30 -w)
docker run --rm -e PGURL="$URL" postgres:18-alpine sh -c 'pg_dump -Fc --no-owner "$PGURL"' \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "pass:$K" -out "$D/$F" && chmod 600 "$D/$F"
(cd $D && shasum -a 256 "$F" > "$F.sha256"); ls -la "$D/$F"      # a 0-byte file means it failed — delete and redo
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "pass:$K" -in "$D/$F" > /tmp/t.dump
docker run --rm -v /tmp/t.dump:/d.dump:ro postgres:18-alpine pg_restore -l /d.dump | grep -c "TABLE DATA"   # expect 62 (60 before the WP3 tables)
rm -f /tmp/t.dump
```
A long foreground command can be interrupted by the tool; put it in a script and run it as a background process (that is how the last one succeeded).
Verify from a decrypted *file*, not a pipe (`pg_restore -l` closing a pipe makes openssl print "error writing output file").

### B2 — merge and deploy
`git push -u origin <branch>` → `gh pr create` → wait for *Backend Checks* and *Frontend Build* (`gh pr checks N`) → backup (B1) →
`gh pr merge N --merge` → `git fetch && git checkout main && git merge --ff-only origin/main` → wait ~3 min → C3 → C4 → C6.
PR preview deployments always fail (no Postgres in previews): ignore them. Stage files **by name**; never `git add .`.

### B3 — refresh staging from a newer dump (needed before any rehearsal on current data)
Decrypt the newest `.dump.enc` to a temp file, then `docker exec -i iw-staging-pg psql -U postgres -c "DROP DATABASE railway"` /
`CREATE DATABASE railway`, `pg_restore --no-owner -d railway` into it (copy the file in with `docker cp`). Never touch the `railway` DB for
experiments: make throwaway copies with `docker exec iw-staging-pg createdb -U postgres -T railway <name>` (no other sessions may be connected to
`railway`), use `postgresql://postgres:staging@127.0.0.1:55433/<name>` (psycopg2 driver, **not** `postgresql+psycopg`), `alembic upgrade head`, and drop it after.
Staging login for HTTP rehearsals: `demo_admin` / `Staging-Rehearsal-2026!` with header `X-Tenant-Domain: demo.ironwaves.store` (staging only).

### V-all — verification matrix (report exact numbers, never "all green")
```bash
cd backend && DATABASE_URL=sqlite:////tmp/iw-test.db JWT_SECRET=test-secret-test-secret-test-secret-123456 \
  SUPERADMIN_PASSWORD=Test-Passw0rd-123 /tmp/iw-venv/bin/python -m pytest tests -p no:cacheprovider -o addopts="" -q
#   venv: python3 -m venv /tmp/iw-venv && /tmp/iw-venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
# PG tests on a throwaway copy:
INTEGRATION_DATABASE_URL=postgresql://postgres:staging@127.0.0.1:55433/<copy> /tmp/iw-venv/bin/python -m pytest tests/integration -p no:cacheprovider -o addopts="" -q -m integration
/tmp/iw-venv/bin/alembic heads          # exactly one head
npx tsc --noEmit -p . && npm run -s test:smoke && npm run -s test:gl && npm run -s test:gl:bills && npm run -s test:gl:gate && npx vite build
```
Baselines: before WP-A (`main` at `323b5cd6`): SQLite 976 passed / 22 skipped, PG `tests/integration` 21 passed, smoke 60/60, gl 4/4, gl:bills 18/18.
With WP-A (PR #TBD, measured locally): SQLite **1076 passed / 28 skipped** (the 6 new PG tests skip without `INTEGRATION_DATABASE_URL`, hence 22 + 6), PG `tests/integration` **27 passed**, smoke 60/60, gl 4/4, gl:bills 18/18, gl:gate **9/9**.

### P — production pilot (super tenant)
Write a script that drives the real router functions (not HTTP) as `system:gl-pilot`, with the checker `system:gl-pilot-checker` for second-person
approvals. Use 1 ₼ amounts, reverse/void everything, and assert: reconcile before == after == 14/14, AP sub-ledger `reconciled`, `integrity` all true,
concurrent payments → exactly one succeeds. The WP3 pilot had 26 assertions and is the template (structure: create bill → partial pay → replay same key →
full pay → overpay / drawer / generic-reverse / paid-void blocked → reverse payments with 4-eyes → void with 4-eyes → two threads paying one bill).
Remove the script afterwards.

### Mode / source switches (production, inside the container, with `--allow-production`)
`gl_ledger_mode.py --list` · `--tenant ID --reconcile` · `--tenant ID --parity` · `--tenant ID --set dual --reason "..."` ·
`--tenant ID --reports gl|legacy --reason "..."` · `--tenant ID --ui visible|hidden --reason "..."` · `--tenant ID --require-supplier on|off --reason "..."`.
Every switch is audited in the GL hash chain. Routine rollback = `--reports legacy`; `--set legacy` works but is not a full rewind (see R3).

### Reviewing another agent's work (what worked)
1. Read the spec and the diff; 2. run the suites; 3. rehearse the money paths on a **throwaway Postgres copy** incl. concurrency and
`reconcile_dual_tenant` after every step; 4. write ad-hoc probe tests in `/tmp` for each suspicion and reproduce before believing;
5. two independent semantic reviews on different models, then aggregate; 6. ask whether any doc states facts the author could not have verified.

---

## 11. Gotchas and lessons (each one cost time once)

1. **"Dual is invisible to the customer" is false** (R1–R3). Think about what *every* code path keyed on `get_ledger_mode()` does to users.
2. zsh: `echo ==== text` fails (`= not found`). Use quotes. `grep --include=*.py` fails in zsh when the glob does not expand: quote it.
3. Parallel tool calls that write a file *and* run it race. Write first, run second.
4. The Railway CLI needs the repo directory (linked project). Many commands print a deprecation banner about Config-as-Code: harmless until 2026-12-01.
5. `psycopg` v3 is not installed in the test venv: staging URLs must be `postgresql://`.
6. Production image is Python 3.12 without httpx; the test venv is Python 3.11.
7. CI "Backend Integration (PostgreSQL)" is *skipping* (R11). A green CI is not proof the PG path works.
8. `pg_restore -l` from a pipe prints a misleading openssl error; a 0-byte backup file means the dump died: always check size and table count (60).
9. Retention job is throttled by `app_schema_migrations(key='data_retention_cleanup').applied_at` (24 h); an hourly thread calls it.
10. Account count is **60** (earlier notes said 61). SocialBee has none.
11. `datetime.utcnow()` is used everywhere; DB values are naive UTC. Accounting uses the Baku date (`engine.business_today()`).
12. A journal's `source_module` decides how the nightly reconciliation treats it. `pos` = must have a legacy twin/link; `legacy` = mirror; `manual`/`gl` = explained GL-only.
13. The Kiro workflow named `finalize-merge` does not merge. Read step prompts in `~/.kiro/sessions/*/workflows/<id>/workflow-definition.json` before trusting names.
14. The `semantic-review/` folder in the working tree is unrelated and untracked: never `git add .`.
15. The module reads capabilities with a 404 → "feature off" convention. Do not turn 404s into user-visible errors.
16. Do not write production facts in docs unless you ran the command that shows them (the Gemini run invented a reconciliation result).
17. **A workflow's "APPROVED" is not a merge gate.** Two-model review and 975 green tests approved #41, yet a failing alert insert inside `bridge.emit`
    could abort the sale's own PostgreSQL transaction. SQLite cannot show this (a failed statement does not poison the transaction); only a PG test does.
    Anything that runs *inside a business transaction* and may fail needs its own savepoint, and a PG test that fails without it.
18. A probe that "passes" on both the fixed and the broken code proves nothing. Make it fail on the broken version first (two probes of mine passed
    both ways because the error I thought I was causing never happened).
19. A metric computed from a window of mixed row types will drift (the streak). Query the type you count.
20. Check `date` at the start of a session; the clock can jump days between sessions, which changes which deadlines have already passed.

---

## 12. Pointers for finding things

- Backend GL package `backend/app/gl/`: `models.py`, `coa_az.py`, `engine.py`, `posting_rules.py`, `bridge.py`, `shadow.py`,
  `legacy_migration.py`, `read_model.py`, `reports.py`, `tax.py`, `year_end.py`, `subledger.py`, `documents.py`, `router.py`
  `alerts.py`, `readiness.py`. Hooks live in `routers/{pos,restaurant,operations,integrations,reports,analytics_api,finance,suppliers,catalog}.py`
  and `services/finance_service.py`. Token retention: `services/token_retention.py`.
- Alembic chain: `20260905_0002` → `20260929_0001` (GL core + triggers) → `20260930_0001` (shadow runs) → `20260930_0002` (legacy links) →
  `20261001_0001` (documents) → `20261002_0001` (alerts).
- Frontend: `src/api/gl.ts`, `src/components/admin/FinanceV2Panel.tsx`, `src/components/admin/financev2/*`
  (`ReportsTabs`, `JournalsTabs`, `PartnersTab`, `BillsTab`, `ControlTabs`, `FinanceV2Parts`, `context`, `exporters`, `reportExports`).
  Registered in `src/lib/navigation.ts`, `src/App.tsx`, `src/components/AdminPanel.tsx`, `src/i18n.ts`.
- Tests: `backend/tests/test_gl_*.py`, `test_token_retention.py`, `test_suppliers.py`, `backend/tests/integration/test_gl_*postgres*.py`;
  frontend `tests/gl_exports.test.mjs`, `tests/gl_bills.test.mjs`.
- Kiro-specific: workflow states under `~/.kiro/sessions/<id>/workflows/<wf id>/`; artifacts under
  `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent/artifacts/` (the accountant doc and original design were copied into this repo for that reason).

---

## 13. Definition of done (every work package)

- Tests for every behaviour change; V-all numbers reported; a Postgres rehearsal for anything touching money, locks or reconciliation.
- Production: backup name+size+table count, PR number, merge commit, deploy status, pilot result, reconcile before/after, gate check (C4).
- Real tenants unchanged unless the owner approved that exact step (ASK items) or it is an AUTO step followed by a heads-up.
- Final report to the owner in Azerbaijani: **done / verified (numbers) / not verified / next step**. Say plainly when you were wrong.
