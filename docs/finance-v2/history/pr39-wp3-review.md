# PR #39 — WP3 AP bills: final independent review

Branch `feature/finance-v2-p3b` @ `ef1e8a2b` vs `origin/main` @ `5d5c3a45`. Author: Gemini Flash agent. Read-only review; this file is untracked and must not be committed.

Sources merged: `verification.md` (commands, PostgreSQL rehearsal, 21 probe tests), `review-a.json/.md` (claude-opus-4.8, 26 issues), `review-b.json/.md` (gpt-5.6-sol, 17 issues).

Evidence labels used throughout:
- CONFIRMED: reproduced by a probe test (P01–P20), the PostgreSQL rehearsal, or a command in `verification.md`.
- CONFIRMED (diff): the required change is absent from the diff; files named in verification §4 are untouched.
- SUSPECTED: supported by reading the code only, no probe or runtime check.

## 1. VERDICT

fix-first

The foundation is sound and worth keeping. The migration is additive with a single head, tenant isolation holds (P01, P19), the backend uses `Decimal`, the engine contract is respected, legacy tenants are unaffected, and all suites pass. The money paths are not safe to merge, though. Paying a bill breaks the nightly dual reconciliation (CONFIRMED, 14/14 → 12/14). Duplicate or concurrent payments pay cash out twice (CONFIRMED on PostgreSQL). The core `sum(open) == subledger` invariant breaks through three supported paths (CONFIRMED). Void and reclass skip maker-checker (CONFIRMED). Several WP3 requirements are missing, yet the handoff marks WP3 "Done" and documents columns and params that don't exist. Both reviewers reached NEEDS_CHANGES independently. Reject is not warranted because the schema, service skeleton, router and UI shell can be fixed in place.

## 2. SPEC COVERAGE TABLE

| WP3 requirement | Status | Evidence |
|---|---|---|
| `gl_documents` table | done | `backend/alembic/versions/20261001_0001_gl_documents.py:20-40`; `backend/app/gl/models.py:284-318`; PG column list matches (verification §2). CONFIRMED |
| `gl_document_allocations` table | done | migration `:43-53`; `models.py:321-336`; PG columns match. CONFIRMED |
| Alembic single head chained after `20260930_0002` | done | migration `:11-14` `down_revision="20260930_0002"`; `alembic heads` → `20261001_0001` only; PG up/down/up OK. CONFIRMED |
| Bills post via StockReceived/ExpensePaid with partner tags | partial | Partner tag present (`documents.py:112-123`), but the journal is built inline and posted with `create_journal` (`documents.py:98-138`), not through the posting rules. `posting_rules.py` untouched. P04: `source_module=gl, source_type=document, idempotency_key=None`. CONFIRMED deviation |
| SupplierPaid named-then-FIFO allocation | missing | `SupplierPaid` has no `document_ids` (`posting_rules.py:566-574`). `allocate_payment` does named OR FIFO, never named-then-FIFO (`documents.py:181-193`). `pay_bill` always passes `[doc.id]` (`documents.py:263-271`). The existing `routers/suppliers.py:121-168` never allocates. P09, P10b. CONFIRMED |
| Invariant sum(open per partner) == subledger balance | partial | Holds on the happy path (P17; `test_gl_documents.py:132-164`). Breaks via generic reversal (P06), legacy supplier pay (P09) and the concurrent pay race (PG: partner −1.00 vs sum(open) 0.00). CONFIRMED |
| Void = storno + status, no-allocations guard | partial | Guard works: `documents.py:300-307`, PG `409 document_has_allocations`. Storno skips second-person approval: `documents.py:309` has no `require_approval`, P05. A paid bill can never be voided: P07. CONFIRMED |
| Supplier required for NEW stock receipts in dual mode (UI+API), legacy optional | missing | `backend/app/schemas.py:125-131` (`supplier_id` optional) and `backend/app/routers/catalog.py:739-779` are unchanged; no stock UI change. CONFIRMED (diff) |
| Aging by due_date (Borclar) | missing | Only the bill list uses `due_date` (`documents.py:421-440`). `subledger.py:75-114` still buckets by posting date; `PartnersTab.tsx` untouched. CONFIRMED (diff) |
| Reclass tool for unassigned AP, net-zero on 531 | partial | Net-zero 531 lines are correct (`documents.py:342-375`). No owner/checker approval, no cap at the unassigned balance, no supplier validation (`documents.py:331-373`). P14: unassigned → −1000.00, ghost supplier accepted, `approved_by=None`. CONFIRMED |
| UI BillsTab / BillDrawer / PayBillDialog | partial | `src/components/admin/financev2/BillsTab.tsx` (834 lines) has list, detail, pay, void, reclass and new-bill dialogs, registered in `FinanceV2Panel.tsx`. Gaps: detail shows allocations but no journal lines (`:618-725`); PayBillDialog has no idempotency key (`:476-613`); money math is float (`:58-62, :350, :497-498, :749`); `limit: 100` with no paging (`:36`). SUSPECTED (reading + build only) |
| Overdue rows in rose | partial | Only the due-date cell/badge is rose (`BillsTab.tsx:177-194`, `:658`); `<tr>` has no rose tone. SUSPECTED (no browser pass) |
| Borclar due-date aging (UI) | missing | `src/components/admin/financev2/PartnersTab.tsx` untouched. CONFIRMED (diff) |

Not in the listed WP3 items, recorded for completeness: AR invoice flow is missing (only `kind="ar_invoice"` in `models.py:284`, CONFIRMED by diff). Overpayment → advance is missing (P15, CONFIRMED). Legacy tenant non-impact is done (CONFIRMED, verification §2).

## 3. FINDINGS

Severity reconciliation, where the reviewers disagreed:
- **Invariant breaks.** B rated them CRITICAL, A rated them HIGH. I chose HIGH but blocking. Each break is confirmed, but each needs either a second approver (P06 reversal goes to pending) or mixing the old supplier-payment flow with the new tab.
- **Missing spec items.** A rated them MEDIUM, B rated them HIGH. I split them by impact. The dual-mode supplier requirement is HIGH because it's the mechanism WP3 uses to stop new unassigned AP. Borclar aging and the posting-rule bypass are MEDIUM. AR is LOW because it's not in the listed WP3 items.
- **Unvalidated account/partner.** A rated it MEDIUM, B rated it HIGH. I sided with B. Combined with P13 (no threshold), the bill endpoint is effectively an unrestricted manual journal without the manual-journal gate.
- **Overpayment.** B rated it MEDIUM, A rated it LOW. I chose LOW. Rejecting overpayment is the safe failure mode and may be intended, so the owner should decide.

### CRITICAL

**F1. Bill payment breaks the nightly dual reconciliation.** CONFIRMED. Both reviewers agree.
- **Where:** `backend/app/gl/documents.py:251-260` → `post_event(SupplierPaid)`, which hard-codes `source_module="pos"` (`backend/app/gl/posting_rules.py:590-611`, line 606). `GL_ONLY_SOURCE_MODULES = ("manual","gl")` (`backend/app/gl/legacy_migration.py:41`); reconcile logic at `legacy_migration.py:399-430`.
- **Why:** the payment journal credits a wallet (cash/bank) and debits 531. It is neither a GL-only journal nor linked to a legacy transaction, because `pay_bill` bypasses `bridge.emit` (`bridge.py:168-213`) and so no `GLLegacyLink`/`wallet_diff` is created. `create_bill` and reclass use `source_module="gl"` and stay explained.
- **Evidence:** in the PG rehearsal on the Demo copy, `ok=True 14/14` became `ok=False 12/14` after a 0.40 partial payment. The failures were `balance:cash→221.1` (legacy 177.80 vs gl 177.40) and `balance:payable→531` (−7.40 vs −7.00). The result stayed 12/14 after the full payment.
- **Fix:** post the payment as an explained GL-only journal. Add a `source_module` parameter to `post_event`, or build it via `create_journal` from the `SupplierPaid` spec lines with `source_module="gl"`. The alternative is to create and bridge a matching legacy payment. Add a PG regression test that asserts 14/14 through create → partial → full → void. Product note: once payments are GL-only, the same bill must not also be paid from the legacy supplier UI.

**F2. Duplicate or concurrent payments pay cash out twice.** CONFIRMED. Both reviewers agree.
- **Where:** `documents.py:238-249` reads the document with no `with_for_update`. `documents.py:254` generates a fresh `payment_id` UUID per call, so the idempotency key `supplier_payment:{payment_id}` (`posting_rules.py:581-582`) is never stable. `PayBillIn` has no key (`router.py:181-187`). PayBillDialog sends none (`BillsTab.tsx:487-510`).
- **Evidence:**
  - PG concurrency: two sessions each paid 1.00 on bill #3. Both returned ok and two payment journals posted (JV-2026-000042 `paid`, JV-2026-000043 stale `open`). Allocations totalled 1.00, partner balance went to −1.00 while sum(open) was 0.00, and cash dropped 177.80 → 174.80.
  - P08: the same pay sent twice produced two journals and two allocations.
- **Fix:** add `SELECT … FOR UPDATE` on the `GLDocument` and re-read the open balance under the lock. Accept a client idempotency key from PayBillDialog and derive a deterministic journal key from it, so a replay returns the original result. Make allocation replay-safe. Add a PG concurrency test.

### HIGH

**F3. The `sum(open) == subledger` invariant breaks via supported paths.** CONFIRMED. Both reviewers agree; A rated it HIGH, B CRITICAL.
- **Where:** the bill journal is `source_module="gl"` (`documents.py:126-138`), so the generic reverse guard (`router.py:342`) lets it through, and nothing updates the document. The existing supplier payment (`routers/suppliers.py:121-168`) emits `SupplierPaid` with no allocation.
- **Evidence:**
  - P06: after an approved generic reversal, the document stays `open` for 100 while the subledger shows 0. The document is then un-voidable (`already_reversed`).
  - P19: `/journals/{id}/reverse` on a bill journal returns 200 pending, not `source_managed`.
  - P09: a bridge-style supplier payment leaves the document open for 100 with the subledger at 0.
  - The PG race (F2) leaves an advance of −1.00 against open 0.
- **Fix:** treat `source_type="document"` journals as source-managed in the reverse guard and point users to void, or transition the document atomically when its reversal posts. Wire named-then-FIFO allocation into `SupplierPaid` (`document_ids`) so the existing supplier flow allocates. Add invariant tests for each path.

**F4. Void bypasses maker-checker, and a paid bill can never be corrected.** CONFIRMED. Both reviewers agree.
- **Where:** `documents.py:309` calls `gl.reverse_journal(...)` without `require_approval=True`, unlike `router.py:349` ("Reversals always go through a second person"). The void guard is at `documents.py:300-307`. The payment journal is `source_module="pos"` → 409 `source_managed`. There is no un-allocate or reverse-payment endpoint.
- **Evidence:**
  - P05: the storno posts immediately with `created_by` = maker and `approved_by=None`.
  - P19: manager void → 200, immediate.
  - P07: payment reverse → 409 `source_managed`.
  - PG: void on a paid bill → 409 `document_has_allocations`.
- **Fix:** keep the document active with a pending storno and set `void` only after a different user approves. Add a checker-approved payment-reversal/deallocation operation that writes compensating allocations. This is coupled to the F1 source-module decision.

**F5. Reclass is unbounded, unapproved and accepts ghost suppliers.** CONFIRMED. Both reviewers agree; A split it across H3/M4/M5.
- **Where:** `documents.py:316-375` validates only that amount and supplier are non-empty, and posts directly. CONTROLLER routing (`router.py:563-572`) is a role check, not owner approval.
- **Evidence:** P14, run with unassigned = 0 and `to_supplier="ghost"`: posted immediately with `approved_by=None`, unassigned 531 went to −1000.00, and the ghost supplier was accepted.
- **Fix:** validate the supplier in the tenant. Lock and cap the amount at the unassigned 531 balance as of the posting date. Create a pending adjusting journal approved by a different owner/controller.

**F6. Bill creation is effectively an unrestricted manual journal.** CONFIRMED. B rated it HIGH, A MEDIUM; I agree with B.
- **Where:**
  - `CreateBillIn.expense_account` is a free `str` (`router.py:176`) and is resolved by role or code with no type whitelist (`documents.py:100-106`).
  - `partner_id` is only checked as non-empty (`documents.py:69-72`). The name falls back to the raw id (`documents.py:411-431, :486`).
  - No approval threshold applies (contrast `_manual_needs_approval`, `router.py:247-251`).
- **Evidence:**
  - P02: other-tenant and nonexistent supplier ids are accepted.
  - P03: `cash_drawer` debits cash; `accounts_payable` posts Dr 531/Cr 531 (net 0) while the document says 100 owed.
  - P13: a 1,000,000 bill by a manager posts immediately.
  - PG: `partner_id="probe-supplier"` was accepted on Demo, which has no Supplier rows.
- **Fix:** require an existing tenant Supplier and use a picker in the UI. Whitelist active inventory/expense accounts. Apply the manual-journal threshold/approval gate to bills (and to payments above `large_transfer_threshold_azn`).

**F7. Supplier is not required for new stock receipts in dual mode.** CONFIRMED (diff). B rated it HIGH, A MEDIUM.
- **Where:** `backend/app/schemas.py:125-131` (`InventoryRestockIn.supplier_id` optional) and `backend/app/routers/catalog.py:739-779` validate only when the field is provided. No UI change.
- **Why HIGH:** this is the WP3 mechanism that stops new unassigned AP from accumulating. Without it, the reclass tool keeps being needed.
- **Fix:** require a supplier server-side and in the stock UI when ledger mode is `dual`, keep it optional in legacy mode, and test both modes.

### MEDIUM

**F8. Bills bypass the StockReceived/ExpensePaid posting rules.** CONFIRMED. Both reviewers agree it's a deviation; A rated it MEDIUM, B HIGH.
- **Where:** `documents.py:98-138`.
- **Evidence:** P04.
- **Note:** the booked lines (Dr expense/inventory, Cr 531) are correct, which is why I rate it MEDIUM. The cost is duplicated policy and lost rule-owned tax, branch and idempotency semantics.
- **Fix:** use `StockReceived` for inventory and `ExpensePaid(paid_from=None)` for accruals, extended for document metadata and source ownership.

**F9. Borclar has no due-date aging.** CONFIRMED (diff). Both reviewers agree.
- **Where:** `backend/app/gl/subledger.py:75-114` (posting-date buckets); `PartnersTab.tsx` untouched.
- **Fix:** when documents exist for a partner, age open document items by `due_date`. Keep posting-date items for the historical, undocumented remainder.

**F10. Frontend money uses float; backend silently rounds.** Backend rounding is CONFIRMED (P11); frontend float is SUSPECTED (reading-only). Both reviewers agree.
- **Where:**
  - Frontend: `BillsTab.tsx:58-62` (`Number` sums), `:350` (`parseFloat(total)`), `:497-498`, `:749`.
  - Backend: bare `Decimal(...).quantize(CENT)` at `documents.py:80, 177, 245, 331`.
- **Evidence:** P11: `10.005` is stored as 10.00 (HALF_EVEN), while `engine.money` would reject it. The frontend code is unambiguous, but no runtime discrepancy was reproduced, so it stays SUSPECTED.
- **Fix:** use decimal.js for UI arithmetic, send money as strings, and validate backend input with `engine.money`.

**F11. KPIs and the list cover only the first 100 bills.** SUSPECTED (reading-only). Both reviewers agree.
- **Where:** `BillsTab.tsx:29-39` (`limit: 100`, no paging) and `:58-62`.
- **Fix:** add server-side aggregates and paging.

**F12. The handoff doc is inaccurate and marks WP3 "Done".** Most claims CONFIRMED; the production claim is SUSPECTED. Both reviewers agree.
- **CONFIRMED inaccuracies:**
  - `docs/FINANCE_V2_HANDOFF.md:113` lists `partner_name`/`open_balance` columns that don't exist (PG column list).
  - `:229-230` documents `overdue_only`, `search`, a default `kind=ap_bill` and a bill `idempotency_key`, none of which is implemented (P20; `router.py:503-527`).
  - `:234` lists reclass as WRITE; the code requires CONTROLLER (P19: manager → 403).
  - `:441` marks WP3 "Done" despite F7–F9 and the named-then-FIFO gap.
  - BillsTab is listed at 831 lines; the file has 834.
- **SUSPECTED:** `:405-408` replaces the WP0 "Verify this" to-do with production figures (253,003 → 3,120 rows; "nightly reconciliation on 2026-10-01 passed ok=True"). Nothing in the PR or in verification supports this, and production access was out of scope. It may be fabricated, so the owner must verify it.
- **Fix:** correct the schema, API and permission text. Mark WP3 partial. Restore the pending-verification wording unless evidence is attached.

**F13. Tests skip every invariant at risk.** CONFIRMED by inspection plus probes. Both reviewers agree.
- **Where:** `backend/tests/test_gl_documents.py:76-397` has 8 sequential happy-path tests.
- **Gaps:** nothing covers dual reconciliation, concurrency, idempotency, the legacy supplier payment, generic reversal, checker approval, account/partner validation, stock-mode rules, aging or FIFO. Every one of those areas failed in a probe.
- **Fix:** add PG and cross-module regression tests, starting with F1 and F2.

**F14. Bill detail doesn't show journal lines.** SUSPECTED (reading-only). Found only by B.
- **Where:** `BillsTab.tsx:618-725` shows allocations but not the source journal lines the BillDrawer spec asks for.
- **Fix:** render the source journal lines next to the allocations.

### LOW

- **F15. Overpayment is rejected instead of booked as an advance.** CONFIRMED (P15). `documents.py:244-249` returns `overpayment_not_allowed`, while the spec's test list says "overpayment → advance". This needs a product decision. If an advance is wanted, allocate up to open and book the rest as a partner advance.
- **F16. Overdue rose tint is on the cell only, not the row.** SUSPECTED (no browser pass). `BillsTab.tsx:177-194`, `:658`. Apply the rose tone to the `<tr>`.
- **F17. Row action buttons bypass `btn` tokens and the 44px target.** SUSPECTED. `BillsTab.tsx:199-227` (`px-2.5 py-1 text-xs`). Use the `btn.*` tokens (`min-h-11`).
- **F18. The table has no screen-reader caption.** SUSPECTED, found only by B. `BillsTab.tsx:161-176`. Add a caption.
- **F19. Supplier is a free-text id with no picker.** SUSPECTED (UI reading). Applies to the New Bill and Reclass dialogs (`BillsTab.tsx:327-380`). This is the UI half of F6.
- **F20. Payment memo is discarded.** SUSPECTED, found only by B and not probed. The note is passed through `router.py:541-550` and `BillsTab.tsx:592-600`, but `pay_bill` (`documents.py:225-260`) never uses it. Persist it or remove the field.
- **F21. Payment can be dated before the bill's issue date.** CONFIRMED (P18). Add a `posting_date >= issue_date` check in `pay_bill`.
- **F22. A voided bill's number can't be reused.** CONFIRMED (P16, `duplicate_bill`). `documents.py:84-93`, `models.py:298`. Confirm whether this is intended.
- **F23. The expense option label is wrong.** SUSPECTED, raised only in verification. The option is labelled "721", but role `general_expense` is 721.9.
- **F24. AR invoice flow is not implemented.** CONFIRMED (diff). Only the `kind="ar_invoice"` constant exists (`models.py:284`), and the docstring and handoff overstate AR coverage. Either implement AR or label the package AP-only.
- **F25. Documents and allocations have no PG immutability triggers.** CONFIRMED by the PG trigger listing. The spec makes these optional; noted for completeness.

## 4. VERIFICATION RESULTS

| Check | Result |
|---|---|
| Backend `pytest tests -q` (SQLite) | 882 passed, 11 skipped, 1 warning, 13.60s, exit 0. Main baseline is 874/11; the +8 are `tests/test_gl_documents.py` |
| `npx tsc --noEmit -p .` | exit 0, no output |
| `npm run -s test:smoke` | 60 tests, 60 pass, 0 fail |
| `npm run -s test:gl` | 3 tests, 3 pass, 0 fail |
| `npx vite build` (outDir in /tmp) | exit 0, built in 8.05s |
| `alembic heads` | single head `20261001_0001` |
| `down_revision` | `"20260930_0002"`; the only revision chained off it |
| PG migration rehearsal (throwaway `iw_review` from `railway`) | upgrade OK; `downgrade -1` OK (both tables dropped); re-upgrade OK. `railway` stayed at `20260930_0002` throughout |
| PG Demo dual exercise | before 14/14. Create bill → 14/14. Partial pay → 12/14. Full pay → 12/14. Void paid bill → 409. Bill #2 void OK. Audit chain valid (48 events, broken_at_seq None). Concurrent pay → two journals, partner −1.00, 12/14 |
| Legacy tenants (read-only `reconcile_tenant`) | Art Space, Gyros, Daily Coffee: 19/19 before and after. SocialBee: `KeyError: 'cash_drawer'` on both DBs (no chart, so it predates this PR). All four are `legacy` and gated, so the new endpoints return 404 |
| Probe suite (`test_probe_wp3.py`) | 21 passed. Each probe asserts observed behaviour; failures appear as asserted bugs, not as red tests |
| Cleanup | `iw_review` dropped; /tmp probe artefacts removed |

The green suites are real (882/11, 60/60, 3/3). They prove only the happy path. Every blocker above was found by probes and the PG rehearsal, not by the PR's own tests.

## 5. WHAT COULD NOT BE VERIFIED

- **Production token-purge and reconciliation claim** (handoff `:405-408`). There was no production access, so it stays SUSPECTED and possibly fabricated.
- **UI behaviour in a browser.** There was no browser or device pass, so F10 (frontend), F11, F14, F16–F20 and F23 are reading-only. tsc and the Vite build pass.
- **Railway preview deploy.** Not exercised. Reviewer B notes its failure matches the documented no-Postgres preview limitation.
- **Real supplier data.** Demo has no Supplier rows, so the PG exercise used a synthetic `partner_id`. Behaviour with real suppliers, and the existing `suppliers.pay_supplier` HTTP flow end to end, were only simulated (P09 posts `SupplierPaid` the way the bridge does).
- **PostgreSQL concurrency beyond one two-session race.** Lock contention under load and isolation-level effects were not explored.
- **SocialBee reconciliation.** The `KeyError` predates this PR and was not investigated.
- **Product intent** for overpayment (F15), reuse of voided bill numbers (F22) and AR scope (F24) needs an owner decision.
