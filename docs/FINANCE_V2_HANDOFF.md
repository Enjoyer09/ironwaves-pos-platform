# Finance v2 — Complete Handoff (architecture, state, UI, roadmap)

> **Qısa (AZ):** Bu sənəd növbəti kod agenti üçündür. Maliyyə v2 (baş kitab, AMHP) nədir, necə qurulub,
> production-da hazırda vəziyyət necədir, UI necə işləyir və qalan işlər hansılardır — hamısı buradadır.
> Agentə tapşırıq verərkən kopyala-yapışdır promptlar `docs/finance-v2-handoff.md` faylındadır.

- **Snapshot date:** 2026-09-30 (production commit `0f63eccb`, PR #37).
- **Audience:** an AI coding agent (or engineer) taking over the finance module.
- **Companion file:** `docs/finance-v2-handoff.md`, with copy-paste prompts per work package (WP0–WP6).
- **Owner language:** Azerbaijani. Reply to the owner in Azerbaijani, short and factual.

### Git state (read first)

| Ref | What it is |
|---|---|
| `main` / `origin/main` @ `0f63eccb` | **Production.** All Finance v2 code (PRs #31–#37) is merged here. Railway auto-deploys every push to `main`. |
| `docs/finance-v2-handoff` (PR #38) | **This document** and `docs/finance-v2-handoff.md`. Docs only. If PR #38 is not merged yet, these files exist only on this branch: `git fetch origin && git checkout docs/finance-v2-handoff`, or read with `git show origin/docs/finance-v2-handoff:docs/FINANCE_V2_HANDOFF.md`. After merge they are on `main`. |
| `feature/finance-v2-p3b` (PR #39) | WP3 AP bills. **In review, not merged, not deployed.** Contains migration `20261001_0001`. |
| `feature/finance-v2-p2d`, `feature/finance-v2-p3a` (and earlier `feature/finance-v2-*`) | Already merged. Do not reuse them; do not commit on them. |
| `semantic-review/` (untracked folder in the working tree) | Not part of Finance v2. Leave it alone and do not commit it. |

Rules for new work:
- Always branch from a fresh `origin/main`: `git fetch origin && git checkout -b feature/finance-v2-<wp-name> origin/main`, with one branch and one PR per work package.
- Never commit to `main` directly.
- Stage files by name, never with `git add .`, because of the untracked folder above.

---

## 0. TL;DR for the next agent

1. There are two ledgers today:
   - **Legacy finance** (`finance_transactions`, `finance_entries`, `finance_ledger_entries`, `finance_accounts`) is what real customers still use.
   - **Finance v2** is a proper double-entry GL (`gl_*` tables) on the Azerbaijan national chart of accounts (AMHP), built next to legacy using the strangler pattern.
2. Tenants move along a ladder: `legacy` → **shadow** (the GL mirrors legacy every 5 minutes) → **dual** (native GL journals are posted in the same DB transaction as the legacy write) → **reports from GL** → *(future)* **gl-only**, where legacy writes stop.
3. Production state:
   - Demo is in dual mode with reports from the GL.
   - Platform (super) is in dual mode with reports still from legacy.
   - **Real customers (Gyros, Daily Coffee, Art Space, SocialBee) are legacy/legacy and must not notice anything.**
4. The GL API is `/api/v1/gl/*`. It returns 404 unless the tenant is in dual mode (or the global flag is on; it is off in production).
5. The UI is the "Mühasibat (v2)" admin module. It is visible only when `GET /api/v1/gl/capabilities` succeeds.
6. Next work, in order:
   - Accountant answers → corrections → Daily Coffee rollout → Gyros rollout.
   - AP bills (WP3, in review in PR #39; AR invoices deferred).
   - Stop legacy writes (WP4).
   - UI QA (WP5).
   - Housekeeping (WP6).

---

## 1. Why this exists

The legacy finance module had 30+ defects found in an audit (approval bypass, investor overpay, 0 % card commission, staff-meal cash, fake offline success; the 5 critical ones were fixed first). The owner asked for an "Oracle-level" finance module. The decisions that shaped the design:

| Decision | Choice | Why |
|---|---|---|
| Rebuild vs patch | New GL next to legacy (strangler) | Legacy data model can't express double entry cleanly |
| Chart of accounts | AMHP (Azərbaycan Milli Hesablar Planı), 60 accounts | Local statutory requirement |
| Rule binding | Posting rules bind to `system_role`, not account code | Accountant can rename/renumber accounts safely |
| Tax | Per-tenant regime: simplified 2 % / 5 %, VAT, exempt; effective from the 1st of a month | Most tenants are on simplified tax |
| Offline | Server is the only accounting writer; POS queues sales offline with idempotency keys; finance ops online-only | No second local ledger to reconcile |
| Rollout | Shadow → dual → reports → gl-only, per tenant, each step reversible | Real customers must not notice |
| Corrections of bad historical data | After migration, as GL adjusting journals | Keep the migration faithful and auditable |

---

## 2. Architecture

### 2.1 Backend map (`backend/app/gl/`)

| File | Responsibility | Key API |
|---|---|---|
| `models.py` | SQLAlchemy models (see 2.2) | `JOURNAL_TYPES`, `PERIOD_STATUSES` |
| `coa_az.py` | AMHP chart (60 `AccountDef`s), `system_role` per account, `LEGACY_CODE_TO_ROLE` | `AMHP_ACCOUNTS`, `REQUIRED_ROLES` |
| `engine.py` | The ledger kernel. It never commits; the caller owns the transaction | `create_journal`, `approve_journal`, `reject_journal`, `reverse_journal`, `set_period_status`, `ensure_chart`, `accounts_by_role`, `account_balance`, `append_audit`, `verify_audit_chain`, `business_today` (Asia/Baku), `YEAR_CLOSE_SOURCE`, `not_year_close()`, `active_year_close()` |
| `posting_rules.py` | Business events → compound journals | Events (2.4), `post_event`, `active_sale_journal`, `void_sale`, `correct_sale` |
| `bridge.py` | Per-tenant ledger mode and the legacy ↔ GL coupling | `get/set_ledger_mode`, `record_legacy_posting`, `emit`, `emit_sale`, `WALLET_CODES` |
| `shadow.py` | Background mirror of legacy → GL every 300 s, plus the nightly reconcile at 04:00 Baku (advisory lock 7411) | `run_cycle`, `sync_tenant`, `reconcile_tenant_shadow`, `shadow_status`, `start_shadow_scheduler` |
| `alerts.py` | De-duplicated admin alerts on reconcile failure / native error / streak break (3.1) | `raise_alert`, `resolve_open_alerts`, `acknowledge_alert`, `list_alerts`, `list_alerts_all`, `notify_external` |
| `legacy_migration.py` | Faithful import of legacy history and reconciliations | `migrate_tenant` (incremental), `reconcile_tenant` (19 checks, legacy/shadow), `reconcile_dual_tenant` (14 checks), `open_items`, `GL_ONLY_SOURCE_MODULES = ("manual","gl")` |
| `read_model.py` | Serves the legacy-shaped responses from the GL when the tenant's reports source is `gl` | `reports_source`, `set_reports_source`, `catch_up`, `gl_wallet_balances`, `gl_shift_cash_breakdown`, `gl_balance_sheet`, `gl_profit_loss`, `gl_cash_flow`, `gl_sales_payment_totals`, `gl_sale_payment_splits`, `parity_report` |
| `reports.py` | Statements computed only from posted journals | `trial_balance`, `balance_sheet`, `profit_and_loss` (excludes year-close), `account_ledger`, `verify_materialized_balances`, `periods_overview` |
| `tax.py` | Tax profiles, simplified tax accrual, VAT split | `set_tax_profile`, `get_tax_profile`, `accrue_simplified_tax` (posts only the delta, safe to repeat), `tax_summary`, `split_vat` |
| `year_end.py` | Fiscal year close/reopen | `year_status`, `close_fiscal_year`, `request_reopen_fiscal_year` |
| `subledger.py` | AP/AR per partner, FIFO settlement, aging | `subledger(db, tid, "ap"\|"ar", as_of)` |
| `documents.py` | AP bills (AR invoices deferred): bill lifecycle, payment allocations (named first, then FIFO), maker-checker hooks, unassigned-AP reclass | `create_bill`, `pay_bill`, `post_supplier_payment`, `allocate_payment`, `void_document`, `reverse_bill_payment`, `reclassify_unassigned_ap`, `list_documents`, `get_document_detail`, `after_journal_approved` / `after_journal_rejected`, `lock_documents_for_journal`, `DOCUMENT_SOURCE_TYPES = ("document","document_payment")` |
| `router.py` | HTTP API `/api/v1/gl` | Section 3 |

Scripts:
- `backend/scripts/gl_ledger_mode.py`: `--list`, `--tenant X --set dual|legacy --reason`, `--reconcile`, `--parity`, `--reports gl|legacy`. It refuses production hosts unless `--allow-production` is passed.
- `backend/scripts/gl_migrate_legacy.py`: `--all --dry-run --allow-production`.

Related, outside `gl/`:
- `app/services/finance_service.py`:
  - `post_existing_transaction` calls `bridge.record_legacy_posting`.
  - The lowest-level readers `ledger_balances_snapshot`, `shift_cash_breakdown_from_ledger` and `sales_payment_totals` dispatch on the reports source; the legacy versions are the `_legacy_*` functions. Because the switch happens at this layer, every consumer changes source together.
- `app/services/token_retention.py` holds the refresh-token purge. It is unrelated to accounting but shipped in the same PR.
- Config (`app/core/config.py`):
  - `finance_v2_enabled` (False)
  - `finance_v2_shadow_enabled` (True in production)
  - `finance_v2_shadow_interval_seconds` (300)
  - `finance_v2_reconcile_hour_baku` (4)
- Per-tenant settings live in the `settings` table as JSON:
  - `finance_v2_ledger_mode` → `{"mode": "dual", "since", "by"}`
  - `finance_v2_reports_source` → `{"source": "gl", ...}`

### 2.2 Data model (Alembic: `20260929_0001` → `20260930_0001` → `20260930_0002` → `20261001_0001` → `20261002_0001`; head = `20261002_0001`)

| Table | Purpose | Notable constraints |
|---|---|---|
| `gl_accounts` | Chart per tenant: code, name, parent, class, type, `normal_side`, `is_postable`, `system_role`, `allow_negative` | unique (tenant, code), unique (tenant, system_role) |
| `gl_fiscal_periods` | Month periods, status `open` / `soft_closed` / `closed` | unique (tenant, year, month) |
| `gl_journals` | Header: `journal_no` (gapless per tenant/year, e.g. `JV-2026-000021`), type, status, `posting_date`, `period_id`, `source_module`, `source_type`, `source_id`, `idempotency_key`, `legacy_ref`, `reversal_of_id`, `reversed_by_id`, maker/approver fields | unique (tenant, journal_no), unique (tenant, idempotency_key) |
| `gl_journal_lines` | Lines: account, debit, credit, branch, `partner_type`, `partner_id`, `tax_code`, memo | unique (journal, line_no) |
| `gl_account_balances` | Materialized debit/credit totals per (account, period, branch). Verified by `verify_materialized_balances` | unique key |
| `gl_documents` | AP bills (migration `20261001_0001`): `id`, `tenant_id`, `kind` (only `ap_bill` is used; `ar_invoice` is reserved), `partner_type`, `partner_id`, `number`, `issue_date`, `due_date`, `currency`, `total`, `status`, `journal_id` (the bill journal), `created_by`, `note`, `created_at`. Status: `pending_approval`, `open`, `partially_paid`, `paid`, `rejected`, `void` (`String(16)`, no CHECK). There is no stored open balance: open = `total` − Σ allocations, and 0 for `pending_approval` / `rejected` / `void` | unique (tenant, kind, partner_id, number) `uq_gl_documents_partner_number`; indexes (tenant, kind, status), (tenant, partner_id), (tenant, due_date) |
| `gl_document_allocations` | Append-only payment matching: `id`, `tenant_id`, `document_id`, `journal_id`, `journal_line_no` (the AP line of the payment or storno), `amount`, `created_at`. A reversed payment adds a **negative** row (journal = the storno) | indexes (tenant, document_id), (tenant, journal_id) |
| `gl_sequences` | Gapless numbering (row lock) | |
| `gl_tax_profiles` | Regime history per tenant (`effective_from` = 1st of month) | |
| `gl_audit_events` | Hash-chained, append-only audit log (`seq`, prev hash, hash) | unique (tenant, seq) |
| `gl_shadow_runs` | Shadow sync / reconcile / native_error runs (the evidence for cut-over) | |
| `gl_legacy_links` | Which legacy txn is covered by which native journal, plus `wallet_diff` (the explained differences) | unique (tenant, legacy_txn_id) |
| `gl_alerts` | Admin-visible reconciliation alerts (migration `20261002_0001`): `id`, `tenant_id`, `alert_type` (`reconcile_failed` / `native_error` / `streak_broken`), `status` (`open` / `acknowledged` / `resolved`), `detail`, `context` (JSON text), `first_seen_at`, `last_seen_at`, `occurrences`, `acknowledged_by`/`acknowledged_at`, `resolved_at`. At most one **open** alert per (tenant, alert_type); repeated failures bump `occurrences` instead of inserting rows. Lifecycle enforced in `app/gl/alerts.py` (no PG trigger) | index (tenant, alert_type, status) |

PostgreSQL triggers (migration `20260929_0001`):
- `gl_journal_guard`:
  - A posted journal cannot be deleted.
  - A posted journal is immutable, except for setting `reversed_by_id` once.
  - Nothing can be posted into a closed period.
- `gl_journal_balanced_check`: debits must equal credits.
- `gl_line_guard`: the lines of a posted journal are immutable.
- `gl_audit_append_only`: audit rows cannot be changed.

SQLite (used by tests) has no triggers; the same rules are enforced in `engine.py`.

Journal types: `sales, purchase, cash, bank, general, adjustment, tax, opening, closing, reversal, migration`. Statuses: `draft, pending_approval, posted, rejected`. "Reversed" is not a status: it is `posted` plus `reversed_by_id`.

`source_module` values: `pos` (native posting rules), `legacy` (mirrored by shadow; `legacy_ref` is set), `manual` (GL UI), `gl` (tax engine, year close, AP bill and bill-payment journals).

### 2.3 Money flow in dual mode

```mermaid
sequenceDiagram
  participant R as Router (e.g. pos.create_sale)
  participant F as finance_service (legacy)
  participant B as gl.bridge
  participant P as gl.posting_rules
  participant E as gl.engine
  participant DB as Postgres (one transaction)
  R->>F: post legacy transaction(s)
  F->>B: record_legacy_posting(txn_id)  (pending list on session)
  R->>B: emit(tenant, event factory)
  alt tenant mode == dual
    B->>P: build event → JournalSpec
    P->>E: create_journal(...)
    E->>DB: gl_journals + lines + balances + audit
    B->>DB: gl_legacy_links(pending txns → journal, wallet_diff)
  else legacy mode or error
    B-->>DB: nothing native (error → gl_shadow_runs native_error; shadow mirrors later)
  end
  R->>DB: COMMIT (sale + legacy + GL atomically)
```

- `emit` **never raises**. On error it logs a `native_error` run and the legacy transactions stay uncovered, so shadow mirrors them later. The pending list is cleared on `after_transaction_end`.
- Native corrections (void, adjust, refund) apply only to sales created in dual mode. Pre-dual sales keep the legacy path and get mirrored.
- The dual reconciliation compares every legacy wallet code with its GL account, **plus explained differences**:
  - per-event `wallet_diff` (known legacy gaps, e.g. card fees legacy forgot);
  - `GLOnlyJournal`: journals created in the GL (`manual` / `gl`) that legacy never sees.

### 2.4 Posting rules (events)

These events are defined in `posting_rules.py`:
- Sales and deposits: `SaleCompleted` (compound: payments, revenue/VAT split, card fee, COGS), `SaleRefunded`, `DepositHeld`, `DepositRefunded`, `DepositForfeited`.
- Shift and cash: `DrawerFunded`, `CashCountVariance` (x/z/handover), `WagePaidFromDrawer`, `WalletTransfer`.
- Income, expense and financing: `ExpensePaid`, `OtherIncomeReceived`, `FinancingMovement` (investor_in/repay, loan_in/repay, lend_out/back).
- Stock and suppliers: `StockReceived` (supplier optional in the rule, because legacy restocks lack one; in **dual** mode the inventory API requires it, see 2.5), `StockWrittenOff`, `SupplierPaid` (`document_ids`, `note`).
- AP bills reuse the rules: an inventory bill posts `StockReceived(receipt_id="bill:{doc_id}", paid_from=None)` and an expense bill posts `ExpensePaid(expense_id="bill:{doc_id}", paid_from=None)`, both via `post_event(..., source_module="gl", source_type="document", source_id=doc_id)`. A bill payment posts `SupplierPaid(payment_id="bill:{doc_id}:{idempotency_key}")` with `source_type="document_payment"`.
- Helpers: `void_sale` returns a list of journals; `correct_sale` returns `[storno, new]`; `active_sale_journal` looks up by idempotency key `sale:{id}:v%`.

Hook sites:
- `pos.create_sale`
- `restaurant` (settle_check)
- `operations`: pay_table, deposit hold/refund, handover
- `integrations` (webhook)
- `reports`: open_shift top-up, X/Z variance, wage, Z deposit forfeit, handover
- `analytics_api`: void, adjust, partial refund
- `finance`: `/entry`, `/transfer`, `/repay-investor`
- `finance_service`: restock, loss
- `suppliers.pay_supplier`

### 2.5 Invariants (do not break)

- Money is `Decimal` in the backend and `decimal.js` in the frontend. Amounts are quantized to 0.01. Never use floats.
- Posted journals are immutable. Corrections are storno or adjusting journals.
- Maker-checker:
  - A user can never approve their own journal (`self_approval`, 403).
  - Every reversal from the API needs a second person.
  - Manual journals from non-approvers, or above `large_transfer_threshold_azn`, need approval.
- The GL API only reverses GL-owned journals (`source_module` `manual` / `gl`):
  - Operational journals return **409 `source_managed`**; they are corrected in their own module.
  - The year-close journal returns **409 `use_year_reopen`**.
- Period rules:
  - A `closed` period accepts nothing.
  - A `soft_closed` period accepts postings only from controllers.
  - Periods close in order and reopen in reverse order; reopening needs a reason.
- A closed fiscal year rejects postings (`year_closed`), except its own closing entry and that entry's reversal.
- Idempotency: the same `idempotency_key` returns the original journal. The same key with a different amount returns 409.
- Every mode or source switch, period change, tax change and year close is written to `gl_audit_events`.
- AP documents (WP3):
  - Bill and bill-payment journals are **GL-only** (`source_module="gl"`, `source_type` `document` / `document_payment`), so `reconcile_dual_tenant` explains them as `GLOnlyJournal`. A legacy supplier payment (`suppliers.pay_supplier`) stays `source_module="pos"` with its legacy link and allocates to bills (named `document_ids` first, then FIFO by due date); any excess stays an advance.
  - `POST /journals/{id}/reverse` on a document journal returns **409 `document_managed`**, because a bare storno would leave the bill open. Use void bill / reverse payment in Bills instead (the JournalDrawer hides storno for them).
  - Allocations are append-only. open = `total` − Σ allocations (net, negative rows included); 0 for `pending_approval` / `rejected` / `void`.
  - Sub-ledger link: a supplier with open bills is aged by bill due date; GL balance − Σ open bills (undocumented AP) is aged by posting date, or shown as an advance when negative. When all of a supplier's AP comes from bills, Σ open bills == its sub-ledger balance (tested across pay / partial / void).
  - Maker-checker: bill create and bill pay need approval when the user is not an approver or the amount is ≥ `large_transfer_threshold_azn` (`router._manual_needs_approval`). Void, payment reversal and reclass **always** create a pending journal for a second person. On approval the hooks re-check (payment ≤ open on the locked bill, net allocations 0 for a void, unassigned AP ≥ 0 for a reclass) and a failed check rolls the approval back with 409.
  - Owner decisions: overpaying a bill through the bill-pay API is rejected (**409 `overpayment_not_allowed`**, the message names the open balance); a voided or rejected bill's number is **not reusable** (409 `duplicate_bill`); AR invoices are deferred (AP only).
  - Dual-mode stock rule: a new stock receipt with amount > 0 (`POST /api/v1/catalog/inventory` with opening stock, `/inventory/{id}/restock`) needs a supplier, else **400 `supplier_required`**. Legacy mode keeps the supplier optional.
  - Lock order: documents before journal. A bill payment (`pay_bill` and its approval hook) locks and allocates to its own bill only. A FIFO allocation (legacy supplier payment) locks the supplier's payable bills in id order **before** posting. The engine locks guarded (non-negative) accounts before inserting journal lines, because the lines' FK checks take KEY SHARE on `gl_accounts`. PG race tests cover two bills of one supplier, approval vs. payment, legacy vs. bill payment, and two plain drawer postings.

#### WP3 known limits (not fixed in PR #39)

- **Legacy wallets do not see bill payments.** Bill and bill-payment journals are GL-only, so legacy wallet balances (bank, safe) and legacy-source reports overstate those wallets by the bill payments until WP4. `reconcile_dual_tenant` explains the gap as `GLOnlyJournal`.
- **Bills cannot be paid from the POS drawer (owner decision, review R2).** `documents.BILL_PAY_WALLETS = ("bank_main", "safe")`; `paid_from=cash_drawer` (or anything else) → **400 `wallet_not_allowed`**, and nothing posts. PayBillDialog offers only Bank (default) and Safe. Reason: Z-close computes expected cash from the legacy `cash` ledger (`routers/reports._shift_cash_breakdown`), which a GL-only bill payment never reaches. A drawer bill payment would therefore show up as a Z-close shortage (legacy "Kassa Kəsiri" + GL `CashCountVariance`), crediting GL cash twice. For drawer cash, use the legacy supplier payment (`/ops/suppliers/{id}/pay`, source `cash`), which posts in both ledgers and still allocates to bills.
- **A legacy supplier payment that settled bills cannot be unwound.** `suppliers.pay_supplier` allocates named-then-FIFO (`source_module="pos"`). `reverse_bill_payment` accepts only `document_payment` journals, a generic reverse of a `pos` journal returns `source_managed`, and a legacy Finance reversal of the `supplier_payment` transaction does not release the allocation. A bill settled this way can be neither voided nor reopened. The supplier's total AP stays correct; only the per-bill split (and due-date aging) can be wrong.
  - Prevention: in dual mode pay bills from Bills, or pass `document_ids` to the legacy payment.
  - A checker-approved deallocation operation is **deferred** (owner decision; roadmap §7).
  - Correction until a deallocation operation exists: an owner-approved data fix in one transaction, on a fresh backup. Append a negative `gl_document_allocations` row for the legacy journal on the wrong bill, plus a positive one on the right bill (or none, which leaves an advance). Then recompute both bills' status and record the fix in `gl_audit_events`. Never update or delete existing allocation rows.
- **Shadow-fallback payments stay unallocated.** If `bridge.emit` falls back to the shadow mirror for a legacy supplier payment, the payment is not allocated to bills and a `native_error` run is logged. The amount shows as undocumented AP (aged by posting date) or an advance.
- **`Supplier.balance` (legacy field) is not changed by GL bills or bill payments.** The legacy supplier screen therefore understates what is owed, while its pay button still settles real bills (FIFO).
- **F25 deferred:** PostgreSQL immutability triggers for `gl_documents` / `gl_document_allocations` are not in migration `20261001_0001`. Append-only is enforced in code only.
- **AR invoices are deferred** (AP only; `kind=ar_invoice` → 422).

---

## 3. HTTP API (`/api/v1/gl`)

Gate: `_enabled` is a router-level dependency. It lets a request through if `settings.finance_v2_enabled` is on OR the tenant's ledger mode is `dual`; otherwise it returns **404** before auth runs.

Roles:
- READ: admin, super_admin, finance_admin, manager, accountant, auditor
- WRITE: READ minus auditor
- APPROVER and CONTROLLER: admin, super_admin, finance_admin

Errors: business errors come back as `{"detail": {"code", "message"}}` with status 400 / 403 / 404 / 409. The frontend `formatErrorDetail` renders them as text.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/capabilities` | READ | `{enabled, ledger_mode, reports_source, chart_ready, role, can_read/write/approve/control/audit, business_today}` |
| POST | `/setup` | CONTROLLER | Seed the AMHP chart (idempotent) |
| GET / POST | `/accounts` | READ / CONTROLLER | POST creates a sub-account |
| POST | `/journals` | WRITE | Manual journal types: general / adjustment / cash / bank / opening; `idempotency_key` recommended |
| GET | `/journals` | READ | Filters: status, journal_type, date_from, date_to, limit ≤ 500, offset → `{total, items}` |
| GET | `/journals/{id}` | READ | Includes lines |
| POST | `/journals/{id}/approve` · `/reject` · `/reverse` | APPROVER · APPROVER · WRITE | Reverse creates a pending storno. Approve/reject of a bill, bill-payment, void, payment-reversal or reclass journal also runs the document hooks in the same transaction. Reverse of a bill / bill-payment journal → 409 `document_managed` |
| GET / POST | `/periods` · `/periods/{y}/{m}/status` | READ / CONTROLLER | Status open / soft_closed / closed |
| GET | `/subledger/{ap\|ar}?as_of=` | READ | Per-partner buckets `current` (not yet due) / `0_30 / 31_60 / 61_90 / 90_plus`, advance, `aging_basis` (`due_date` / `posting_date` / `mixed`), `reconciled` |
| GET | `/suppliers` | READ | `[{id, name}]` of the tenant, for the bill/reclass supplier picker (`/api/v1/ops/suppliers` is admin/manager only) |
| GET | `/documents` | READ | `kind` = `ap_bill` only (anything else 422), `status`, `partner_id`, `due_before`, `due_after`, `overdue_only`, `search` (bill number or supplier name, ≤ 100 chars), `limit` 1–500 (default 50), `offset` → `{total, items, summary: {total_billed, total_open, overdue_open, overdue_count}}`; the summary covers the whole filtered set and `total_billed` excludes void/rejected |
| POST | `/documents/bills` | WRITE | `{partner_id, number, issue_date, due_date, total, expense_account?, note?, branch_id?}`; **no idempotency key** (the bill number is unique per supplier). Debit = `inventory` / `merchandise` or any active postable expense account (e.g. `general_expense` 721.9, `rent_expense` 721.2, `utilities_expense` 721.3), credit 531. Approval gate → `pending_approval`. Errors: 404 `supplier_not_found`, 400 `invalid_expense_account` / `invalid_amount` / `invalid_due_date`, 409 `duplicate_bill` |
| GET | `/documents/{id}` | READ | Header + `journal_status`, `lines` (bill journal), `allocations` (with `source_type`, `reversed`; negative rows = reversed payments), `pending_void_journal_id`, `pending_payments`, `pending_payment_reversals` |
| POST | `/documents/{id}/pay` | WRITE | `{amount, paid_from: bank_main\|safe, posting_date?, bank_fee?, note?, idempotency_key}`; **`idempotency_key` required** (8–80 chars, `[A-Za-z0-9:_-]`; same key replays, same key + other amount → 409 `idempotency_conflict`). Approval gate → `journal_status: pending_approval`, allocated on approval. Errors: 409 `overpayment_not_allowed` / `invalid_status` / `void_pending`, 400 `payment_before_issue` / `invalid_amount` / `wallet_not_allowed` (POS drawer) |
| POST | `/documents/{id}/void` | WRITE | `{reason}`; creates a **pending storno** of the bill journal (`pending_void_journal_id`); the bill stays open and becomes `void` when another approver approves. Only with net allocations 0 and no pending payment (409 `document_has_allocations` / `payment_pending` / `void_pending` / `invalid_status` / `already_void`) |
| POST | `/documents/{id}/payments/{journal_id}/reverse` | WRITE | `{reason}`; **pending storno** of a posted bill payment; on approval a negative allocation reopens the bill (409 `reversal_pending` / `already_reversed`, 404 `payment_not_found`) |
| POST | `/documents/reclassify-unassigned` | CONTROLLER | `{amount, to_supplier_id, reason?, posting_date?}`; moves unassigned 531 balance (no partner) to a supplier, net zero; capped at the unassigned balance minus pending reclasses (409 `reclass_exceeds_unassigned`); **always pending** a second approver |
| GET / POST / POST | `/years/{y}` · `/years/{y}/close` · `/years/{y}/reopen` | READ / CONTROLLER / CONTROLLER | Status + blockers; close posts the closing journal; reopen creates a pending storno |
| GET / POST | `/tax-profile` | READ / CONTROLLER | `effective_from` must be the 1st of a month |
| POST | `/tax/simplified/accrue` | CONTROLLER | Posts the delta only |
| GET | `/tax/summary?year&month` | READ | |
| GET | `/reports/trial-balance` · `/balance-sheet` · `/profit-loss` · `/account-ledger/{id}` | READ | P&L excludes closing entries |
| GET | `/shadow/status` · `/integrity` | CONTROLLER + auditor | Reconciliation evidence; audit chain + balances + TB |
| GET | `/alerts?status=` | CONTROLLER + auditor | Reconciliation alerts for this tenant (default `status=open`). Each alert: `{id, tenant_id, alert_type, status, detail, context, first_seen_at, last_seen_at, occurrences, acknowledged_by, acknowledged_at, resolved_at}` |
| POST | `/alerts/{id}/acknowledge` | CONTROLLER | Flips an open alert to `acknowledged` (`GL_ALERT_ACKNOWLEDGED` in the audit chain). 404 `alert_not_found`, 409 `alert_not_open` |
| GET | `/alerts/all?status=` | super_admin | Cross-tenant alerts for the platform super_admin (platform-domain bound via `get_super_admin`; default `status=open`) |

### 3.1 Reconciliation alerting (cut-over deliverable 1)

`app/gl/alerts.py` turns a silent reconciliation failure into a visible, de-duplicated signal:

- **Where it fires.** `shadow.reconcile_tenant_shadow` raises `reconcile_failed` (and `streak_broken` when the previous reconcile was clean) on a failed night and `resolve_open_alerts` on a clean night (the shadow session commits its own alert write). `bridge.emit` raises `native_error` in its except-block, wrapped so it can never raise and never breaks a sale.
- **No spam.** `raise_alert` keeps at most one **open** alert per (tenant, alert_type): a repeat bumps `occurrences` + `last_seen_at` and refreshes `detail`/`context` instead of inserting a row. A later clean run resolves the open alert; a new failure after that starts a fresh one.
- **Log line.** Every raise logs `logger.error("[gl-alert] tenant=%s type=%s detail=%s", ...)` on `ironwaves.gl_alerts`.
- **External notify.** `notify_external(alert)` is a safe no-op unless `settings.resend_api_key` is set (**no new secret**) and never raises; delivery is not wired yet.
- **Commit convention.** Write helpers follow the engine convention (caller owns commit) except the shadow job, which commits itself.

---

## 4. UI (frontend) — how it works today

### 4.1 Where it lives

```
src/api/gl.ts                                 typed client (glApi.*, getGLCapabilities) — 489 lines
src/api/client.ts                             apiRequest + formatErrorDetail (object/array error details → text)
src/components/admin/FinanceV2Panel.tsx       shell: capabilities, tabs, context provider, journal drawer — 189
src/components/admin/financev2/
  context.ts          GLContext + useGL() + useGLLoad(loader, deps) (refetch on panel "version")      46
  FinanceV2Parts.tsx  money(), labels, Badge, Card, Metric, Field, DateRange, Dialog, ReasonDialog,
                      ExportButtons, btn/inputCls style tokens                                          285
  ReportsTabs.tsx     OverviewTab (BS+P&L), TrialBalanceTab, AccountLedgerTab                           294
  JournalsTabs.tsx    JournalsTab, ApprovalsTab, JournalDrawer, NewJournalDialog                        428
  BillsTab.tsx        BillsTab (AP bills list), NewBillDialog, PayBillDialog, BillDetailDialog,
                      ReclassifyAPDialog                                                                925
  billsMath.ts        decimal.js helpers: sumMoney, toMoneyString, validateAmount/Payment,
                      newIdempotencyKey (also used by NewJournalDialog)                                 60
  PartnersTab.tsx     AP/AR aging ("Borclar"), not-yet-due bucket + aging basis badge                   139
  ControlTabs.tsx     PeriodsTab (PeriodsCard + FiscalYearCard), TaxTab, IntegrityTab (AlertsCard +
                      integrity + shadow)
  exporters.ts        buildCsv/exportCsv (BOM, ';', formula-injection guard), exportPdf (print window) 134
  reportExports.ts    report builders: statements, TB, ledger, subledger → ExportReport                 143
tests/gl_exports.test.mjs                     npm run test:gl (CSV escaping, subledger export)
tests/gl_bills.test.mjs                       npm run test:gl:bills (billsMath)
```

Registration (a new module is wired in all of these places):
- `src/lib/navigation.ts`: `ModuleKey 'financev2'`, `ALL_MODULE_KEYS`, aliases `financev2`, `finance-v2`, `ledger`.
- `src/App.tsx`:
  - the `AdminView` union;
  - `DEMO_MODULE_GUIDE_AZ.financev2`;
  - `moduleButtons` (`manager: true`);
  - `MANAGEMENT_KEYS` (the nav group);
  - `allowedTargets` (the `navigate-module` event);
  - `canAccess('financev2')`: requires `glAvailable`, and a manager additionally needs access to `'finance'`;
  - `glAvailable` state, set by an effect that calls `getGLCapabilities()` for GL roles only.
- `src/components/AdminPanel.tsx`:
  - `lazy(() => import('./admin/FinanceV2Panel'))`;
  - the `AdminTab` union;
  - the render line;
  - the mobile select option, shown only while the tab is active.
- `src/i18n.ts`: `modules.financev2` in az ("Mühasibat (v2)"), ru ("Бухучёт (v2)") and en ("Accounting (v2)").

### 4.2 Screen layout

```
┌ Header card ─────────────────────────────────────────────────────────────────┐
│ MALİYYƏ V2 · BAŞ KİTAB           [Canlı yazılış|Kölgə rejimi] [Hesabatlar: GL|köhnə] [⟳] │
│ Mühasibat uçotu — AMHP, ikili yazılış, audit zənciri                          │
└──────────────────────────────────────────────────────────────────────────────┘
[ red alert banner — only when open alerts exist (caps.can_audit); "Go to Controls" jumps to Nəzarət ]
[ Baxış | Sınaq balansı | Hesab kartı | Jurnallar | Təsdiqlər (n) | Borclar | Fakturalar | Dövrlər və il | Vergi | Nəzarət*(n) ]
┌ tabpanel ────────────────────────────────────────────────────────────────────┐
│  Card(title, subtitle, actions=[filters…, Excel, PDF])                        │
│  Metric grid · tables (overflow-x-auto, min-w) · empty/loading/error states  │
└──────────────────────────────────────────────────────────────────────────────┘
JournalDrawer (Dialog, wide) opens from any journal number anywhere in the panel.
* Nəzarət only when caps.can_audit.   If !caps.chart_ready → "Create AMHP chart" (controllers).
If capabilities == null → neutral "not enabled for this business / your role" message.
```

| Tab id | Label (az) | Data calls | What the user can do |
|---|---|---|---|
| `overview` | Baxış | `balanceSheet(to)`, `profitLoss(from,to)` | KPIs; BS and P&L sections; click a line → account ledger; export both |
| `trial` | Sınaq balansı | `trialBalance({from,to})` | Hide zero rows; click an account → ledger; balanced badge; export |
| `ledger` | Hesab kartı | `accountLedger(id,{from,to,limit:200,offset})` | Account select (postable, active), paging, click a journal → drawer; export (**current page only**) |
| `journals` | Jurnallar | `journals({status,type,from,to,limit:50,offset})` | Filters, paging, "Yeni yazılış" (`can_write`) |
| `approvals` | Təsdiqlər | `journals({status:'pending_approval'})` | Open → approve/reject in the drawer (`can_approve`); the tab badge shows the count |
| `partners` | Borclar | `subledger('ap'\|'ar', asOf)` | AP/AR switch (radiogroup), as-of date, bucket KPIs, reconciled badge, unassigned badge, export |
| `bills` | Fakturalar | `documents({kind:'ap_bill',status,overdue_only,search,limit:50,offset})`, `document(id)`, `suppliers()`, `createBill`, `payBill`, `voidDocument`, `reverseBillPayment`, `reclassifyUnassignedAP` | AP bills only. KPIs from `summary` (all pages); filters status (incl. pending approval / rejected), overdue only, search; paging; overdue rows tinted rose. New bill (`can_write`; supplier select, 201 / 721.9 / 721.2 / 721.3). Pay (`can_write`; one idempotency key per open dialog, amount ≤ open checked with decimal.js, 409 message shown). Void request (`can_write`, open bills). Detail: bill journal lines, allocations incl. negative rows, pending void/payment badges, "reverse payment" per allocation. Reclass (`can_control`). Pending results say "Təsdiq gözləyir" |
| `periods` | Dövrlər və il | `periods()`, `fiscalYear(y)` | Period status buttons (`can_control`, reason dialog); fiscal year card: blockers, close (confirm dialog), request reopen (reason) |
| `tax` | Vergi | `taxProfile()`, `taxSummary(y,m)` | Regime form (`can_control`; month picker, since the backend requires the 1st), accrue button when not up to date |
| `integrity` | Nəzarət | `alerts('open')`, `integrity()`, `shadowStatus()` | Open-alert cards with Acknowledge (`can_control`, `glApi.acknowledgeAlert` → `bump()`); audit chain / balances / TB checks; clean-night streak; last runs. The tab shows a count badge and the header shows a red banner while open alerts exist |

Drawer (`JournalDrawer`):
- Shows the header facts, the lines (click an account → ledger), and links to the reversal or the original.
- Actions: approve/reject for pending journals (approvers), and storno only when `source_module ∈ {manual, gl}`, the journal is not a year close and not a bill / bill-payment journal (`source_type` `document` / `document_payment`; a hint points to the Bills tab), it is posted, not yet reversed, and the user has `can_write`.
- Nested `ReasonDialog`.

New journal (`NewJournalDialog`):
- Fields: type, date (defaults to `business_today`), description, and 2–50 lines (account select, debit, credit, memo).
- Validation runs live: each line needs exactly one side with at most 2 decimals, the journal must balance and have at least 2 used lines, and per-line error text uses `role="alert"`.
- One idempotency key per open dialog, so a double click can't post twice.
- After success it opens the new journal in the drawer.

### 4.3 Data flow and state

- `FinanceV2Panel` owns:
  - `caps`: undefined → loading, null → disabled;
  - `accounts` (for code → id drill-down and the selects);
  - `tab`, `version` (incremented by `bump()` after every write), `pendingCount`, `journalId` (drawer), `ledgerAccountId`, and the shared date range `from/to` (month start → today).
- `GLContext` passes `{lang, caps, accounts, accountsByCode, notify, version, bump, openLedger, openJournal}`.
- `useGLLoad(loader, deps)` handles loading, error and `reload`, re-runs when `deps` or `version` change, and ignores stale responses.
- `apiRequest` caches some GETs by path. The GL paths are **not** in the cache TTL list; any non-GET clears the cache.
- The error text comes from `Error.message`, formatted as `"<message> (request_id: …)"`.

### 4.4 Visual language and conventions (keep consistent)

- Dark surfaces:
  - cards `rounded-[28px] border border-slate-800 bg-slate-900 p-4 md:p-5`;
  - inner blocks `bg-slate-950`;
  - accent yellow (`bg-yellow-400` for primary buttons, `text-yellow-300` for eyebrow labels).
- Tones: emerald = ok / positive, rose = problem / negative, amber = attention / pending, sky = info, violet = equity / totals.
- Buttons come from `btn` in `FinanceV2Parts`: `primary`, `ghost`, `approve`, `danger`, `warn`. All are at least 44 px high (`min-h-11`).
- Inputs use `inputCls`, with a visible label through `Field` (`htmlFor`/`id`).
- Money:
  - `money(value)` gives `"1 234.56 ₼"` with a real minus sign `−`;
  - numbers are right-aligned `font-mono` in tables;
  - zero cells are left empty in the TB and ledger.
- Dates are ISO `YYYY-MM-DD` from the server (the business date in Baku). Timestamps go through `formatServerUtcDateTime`.
- i18n: every string goes through `tx(lang, az, ru, en)`. Azerbaijani terminology:
  - "Debet / Kredit", "Sınaq balansı", "Hesab kartı", "Storno", "Yumşaq bağlı", "Tərəf", "Avans".
- Accessibility patterns already in place:
  - `role="tablist"` / `tab` / `tabpanel` with `aria-selected` / `aria-controls`;
  - tables with `<caption class="sr-only">`, `scope`, and `<th scope="row">`;
  - `Dialog` moves focus in on open, closes on Escape (only the **topmost** dialog, via a module-level stack), and restores focus on close;
  - the radiogroup for AP/AR;
  - `aria-live` on the journal balance line.
  - Full WCAG validation still needs manual testing with assistive technology.

### 4.5 How to add a new tab (recipe)

```tsx
// Illustrative recipe only (the real BillsTab uses glApi.documents, see 4.2).
// 1) API: src/api/gl.ts
export type Bill = { id: string; number: string; partner_id: string; due_date: string; total: Money; open: Money; status: string };
export const glApi = { /* … */ bills: (p: { status?: string } = {}) => get<{ items: Bill[] }>('/bills', p) };

// 2) Tab component: src/components/admin/financev2/BillsTab.tsx
export function BillsTab() {
  const { lang, caps } = useGL();
  const { data, loading, error } = useGLLoad(() => glApi.bills(), []);
  return (
    <Card title={tx(lang, 'Fakturalar', 'Счета', 'Bills')} actions={caps.can_write ? <button className={btn.primary}>…</button> : null}>
      {loading && !data ? <Loading lang={lang} /> : null}
      {error ? <Empty>{error}</Empty> : null}
      {/* table: overflow-x-auto + caption.sr-only + money() */}
    </Card>
  );
}

// 3) FinanceV2Panel.tsx: add to `type Tab`, the `tabs` array (label via tx, `show` from caps), and the render switch.
// 4) Writes: call bump() after success, notify('success'|'error', errorText(e)); open results with openJournal(id).
// 5) Checks: npx tsc --noEmit -p . && npm run -s test:smoke && npm run -s test:gl && npm run -s test:gl:bills && npx vite build
```

### 4.6 Known UI gaps

- There has been **no visual browser pass yet** (WP5). The layout was built to be responsive, but it has not been checked at 390 px.
- The account ledger export covers only the loaded page (200 rows). A full export would need to fetch all pages (backend `limit` ≤ 1000).
- The PDF path uses the browser print dialog. A pop-up blocker shows a warning toast.
- There are no charts yet (trend of revenue/expenses, cash position). Candidates: a small inline SVG sparkline per KPI, with no new dependency.
- The chart of accounts can't be edited in the UI (the `POST /accounts` sub-account API exists but has no screen).
- The period list only shows months that already have journals. Future months appear once they are used.
- `BillsTab` is checked by `tsc`, the vite build and the `billsMath` unit tests only. It has had no browser pass at 1440 / 390 px yet. The list rows do not carry `pending_void_journal_id`, so a void already pending is only shown in the bill detail (a second void request gets 409 `void_pending`).

---

## 5. Production state (2026-09-30)

| Tenant | Domain | Ledger mode | Reports source | Notes |
|---|---|---|---|---|
| Demo `5dcc537d-…` | demo.ironwaves.store | dual | gl | Pilot tenant; reconcile 14/14 |
| Platform `b3442582-…` | super.ironwaves.store | dual | legacy | Waiting for clean nights + real activity |
| Gyros `01e69c82-…` | gyrospos.ironwaves.store | legacy | legacy | **Real customer** |
| Daily Coffee `6e2c0d4c-…` | emalatcoffee.ironwaves.store | legacy | legacy | **Real customer** (the domain is "emalatcoffee") |
| `dc9e5773-…` | art-space.ironwaves.store | legacy | legacy | Real |
| SocialBee `b3f7c248-…` | socialbee.ironwaves.store | legacy | legacy | Real |

- Shadow mode is on (`FINANCE_V2_SHADOW_ENABLED=true`). There are 0 shadow/native errors so far.
- Merged PRs: #31 (GL core), #32/#33 (dual), #34/#35 (read model, Z-split), #36 (panel + per-tenant gate), #37 (year close, AP/AR, exports, reversal guard, token retention).
- The first automatic refresh-token purge is expected **after 2026-10-01 07:13 UTC**: the last retention run was 2026-09-30 07:13 UTC and the job runs every 24 h. At the snapshot the table had 253 003 rows, 40 of them live; afterwards expect a few thousand. **Verify this.**
- Backups:
  - Encrypted dumps are in `~/iw-backups/2026-09-30/`; the latest is `…-premerge-p3a.dump.enc` (77.5 MB).
  - The key is in macOS Keychain entry `iw-backup-2026-09-30`.
  - Deletion is scheduled for 2026-10-04. Ask the owner first and offer to keep the newest dump.

---

## 6. Open data findings (to be fixed later via adjusting journals, owner-approved)

- **Gyros:**
  - 27 039.35 ₼ pending "X-report difference" since 2026-08-22;
  - safe −2 400;
  - suspense 538.9 = 1 319.30.
- **Daily Coffee:**
  - safe −847.40;
  - inventory −2 830.68;
  - suspense 538.9 = 384.70;
  - "Borc Alındı" 40 ₼ booked as income (should be a liability).
- **AP unassigned** (legacy restocks had no supplier), on staging: Art Space 8 719.86 ₼, Daily Coffee 427.93 ₼.
- **Accountant questions (8), still pending.** The key one: does the simplified-tax base include cash overage, other income and the sale value of staff meals? Today `tax._period_revenue_base` uses all revenue-type accounts (incl. 602 contra) in the period, excluding year-close.

---

## 7. Roadmap (what remains, in order)

Detailed prompts for each package are in `docs/finance-v2-handoff.md`.

| # | Package | Status | Summary |
|---|---|---|---|
| WP0 | Ship P3a | **Done** (PR #37) | Only follow-up: check the token purge after 2026-10-01 07:13 UTC |
| WP1 | Platform reports → GL | Waiting | 2-3 clean nights + real activity → `--parity` → owner OK → `--reports gl` |
| WP2 | Corrections + real-customer rollout | **Blocked on accountant** | Encode the answers; adjusting-journal list for owner approval; Daily Coffee dual → reports gl; Gyros one week later |
| WP3 | Bills (P3b) | **In review (PR #39) — AP only; AR deferred** (branch `feature/finance-v2-p3b`, not merged, not deployed) | `gl_documents` + `gl_document_allocations` (migration `20261001_0001`); GL-only bill and bill-payment journals; idempotent bill pay, overpayment 409; maker-checker for bills/payments, pending void / payment reversal / reclass; named-then-FIFO allocation of legacy supplier payments; due-date aging in Borclar; supplier required for new stock receipts in dual; bill pay from bank/safe only (no POS drawer); `BillsTab` UI |
| WP3-def | WP3 deferred items | Not started (owner: later) | Checker-approved **deallocation** of bills settled by a legacy supplier payment (compensating allocations, the payment becomes an advance; manual correction in §2.5 until then); F25 PG immutability triggers for documents; AR invoices |
| WP4 | P2e, stop legacy writes | After every tenant is on reports gl for ≥ 2 weeks | Ledger mode `gl`; inventory all legacy writers and readers; emit must raise in gl mode; skip shadow; one-way switch with a fresh backup |
| WP5 | UI QA | Any time | Desktop 1440 / mobile 390 pass; fix layout, a11y and i18n issues |
| WP6 | Housekeeping | Dated items | 10-04 backup deletion (ask); remove Railway SSH key `macbookair-finance-v2`; **`railway config migrate` before 2026-12-01**; retention for `audit_logs` / `receipt_html` |

Nice-to-have for "Oracle level", not started and not yet requested:
- bank statement import and reconciliation;
- fixed assets and depreciation;
- tax declaration forms;
- budget vs actual;
- multi-currency;
- consolidation;
- KPI charts.

### 7.1 WP3 design sketch (code level)

> Original pre-implementation sketch, kept for context. The implemented schema, statuses (incl. `pending_approval` / `rejected`), API and rules are in 2.2, 2.5 and 3 (PR #39).

```python
# backend/app/gl/models.py (new; Alembic revision after 20260930_0002)
class GLDocument(Base):            # gl_documents
    id, tenant_id, kind            # 'ap_bill' | 'ar_invoice'
    partner_type, partner_id, number, issue_date, due_date, currency='AZN'
    total, status                  # open | partially_paid | paid | void
    journal_id                     # the posting that created the liability/receivable
    created_by, created_at
    # unique (tenant_id, kind, partner_id, number)

class GLDocumentAllocation(Base):  # gl_document_allocations
    id, tenant_id, document_id, journal_id, journal_line_no, amount, created_at
```

Rules:
- A bill posts through the existing `StockReceived` / `ExpensePaid` rules with partner tags.
- `SupplierPaid(document_ids=[...])` allocates to the named bills first, then FIFO over the rest (the same FIFO rule as `subledger.py`).
- Invariant, to be tested: `sum(open per partner) == subledger(...)[partner].balance`.
- Voiding a bill is a storno of its journal plus `status=void`. It is only allowed while the bill has no allocations.

UI:
- `BillsTab`: filters; table columns number / partner / due / total / open / status; overdue rows shown in rose.
- `BillDrawer`: lines plus allocations.
- `PayBillDialog`: amount, from which wallet, idempotency key.
- The `Borclar` tab switches to due-date aging when documents exist.

### 7.2 WP4 design notes

- New `LEDGER_MODES = ("legacy", "dual", "gl")`. In `gl` mode:
  - `finance_service` legacy writers are skipped;
  - `bridge.emit` raises on failure, so the sale rolls back;
  - `shadow.sync_tenant` is a no-op;
  - the nightly job runs `verify_audit_chain` + `verify_materialized_balances` + the TB only.
- Before coding, grep for every direct read of `FinanceTransaction`, `FinanceEntry`, `FinanceLedgerEntry` and `FinanceAccount.balance` outside `finance_service`. Each one must go through `read_model`.
- Switching back to dual would need a legacy backfill from the GL. Recommendation: make the switch one-way and take a mandatory backup right before it.

---

## 8. Operations cheat-sheet

```bash
# Backend tests (on feature/finance-v2-p3b: 942 passed, 20 skipped; the skips include the PG-only integration tests)
cd backend && DATABASE_URL=sqlite:////tmp/iw-test.db JWT_SECRET=test-secret-test-secret-test-secret-123456 \
  SUPERADMIN_PASSWORD=Test-Passw0rd-123 /tmp/iw-venv/bin/python -m pytest tests -p no:cacheprovider -o addopts="" -q
# Frontend
npx tsc --noEmit -p . && npm run -s test:smoke && npm run -s test:gl && npm run -s test:gl:bills && npx vite build
# Production script inside the backend container (write the file first, then run; PYTHONPATH is required)
railway ssh --service ironwaves-pos-backend -- sh -c 'cat > /tmp/x.py && cd /app && PYTHONPATH=/app python /tmp/x.py; rm -f /tmp/x.py' < /tmp/x.py
# Deploy status
railway deployment list --service ironwaves-pos-backend --json | python3 -c 'import sys,json;d=json.load(sys.stdin)[0];print(d["status"],d["meta"]["commitHash"][:8])'
# Gate check from outside (404 = hidden, 401 = enabled and waiting for auth)
curl -s -o /dev/null -w "%{http_code}\n" -H "X-Tenant-Domain: gyrospos.ironwaves.store" https://ironwaves-pos-platform-production.up.railway.app/api/v1/gl/capabilities
```

Gotchas learned the hard way:
- `railway` commands must run from the repo directory, because the CLI is linked there.
- The public DB proxy costs ~75 ms per query. Run heavy scripts inside the container.
- `httpx` is not installed in the production image, so there is no FastAPI TestClient there. Call the router functions directly.
- The PR preview backend always fails (its Postgres is never deployed). Ignore it; rely on the GitHub checks "Backend Checks" and "Frontend Build".
- Staging needs the `postgresql://` (psycopg2) driver; `postgresql+psycopg` is not installed.
- `pg_restore -l` reading from a pipe makes openssl print "error writing output file". Verify backups from a file instead.
- `datetime.utcnow()` is used across the legacy code. Keep naive UTC in DB columns, and use the Baku business date for accounting (`engine.business_today()`).

---

## 9. Definition of done (every package)

- Tests are added for every behavior change; the backend suite and frontend checks are green.
- For money-related changes, a staging rehearsal is done and its numbers reported (reconcile checks, balances).
- For production work, report: the backup file (name, size, verified), the PR number, the merge commit, the deploy status, the pilot result and the reconcile before/after.
- Real-customer tenants stay unchanged unless the owner explicitly approved that exact step.
- The report to the owner is in Azerbaijani: done / verified / not verified / next.
