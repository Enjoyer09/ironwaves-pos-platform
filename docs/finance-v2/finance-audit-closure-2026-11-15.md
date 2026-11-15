# Finance audit closure, 15 November 2026

Source: `outputs/finance-audit-2026-10-25/AUDIT_AZ.md` in the original workspace. This release closes the twenty recorded findings for the currently supported finance workflow. It does not assert that every future finance defect is impossible.

| Finding | Resolution |
| --- | --- |
| F01 | Both manual transfer routes enforce server approval policy. |
| F02 | Outgoing postings and approvals recheck locked source balances. |
| F03 | Reconciliation expected balance is computed on the server. |
| F04 | Founder funding to cash, card, and safe is classified as investor liability. |
| F05 | Supplier settlement is visible once in activity and excluded from operational expense. |
| F06 | Supplier payable is included in legacy balance sheet liabilities. |
| F07 | Date-only reports and activity use Asia/Baku business-day bounds. |
| F08 | Failed refreshes show warnings and do not present an unverified zero as healthy data. |
| F09 | Manual writes support tenant-scoped durable idempotency keys. |
| F10 | Transfer principal and bank fee are approved and posted atomically. |
| F11 | Ledger export fetches and verifies every page. |
| F12 | Legacy CSV cells neutralize spreadsheet formulas. |
| F13 | The report labels the balance sheet as current and period reports as selected-range results. |
| F14 | Routine finance screens request a selected-period server aggregate without downloading activity history. Activity is projected by a SQL union, with the page selected using database `LIMIT` and a stable `(created_at, id)` cursor; CSV follows the cursor and verifies its row count. The aggregate streams rows in batches instead of materializing the selected period in application memory. A 10,000-row synthetic PostgreSQL period returned a 100-row page and aggregate in 0.189 seconds. For CSV, the first and final pages count all rows; intermediate cursor pages skip both the full aggregate and repeated count while the client verifies unique IDs and the final row count. On a local 10,111-row PostgreSQL period, a normal page took about 0.9 s and intermediate CSV pages about 0.36–0.40 s. The screen aggregate now uses raw decimal/date rows and caches category/source normalization within each request; a local PostgreSQL period of 10,111 rows fell from about 0.9 s to about 0.5 s, with exact output parity across eight tenants and two date ranges on the local backup. Audit JSON references are still scanned per request; a durable indexed projection remains future scale work. |
| F15 | New entries persist a separate counterparty name; historical records are not rewritten. |
| F16 | Overview cashflow labels reflect the selected date interval. |
| F17 | Finance workspace status, tabs, audit text, and approval text use consistent localized terminology. |
| F18 | Mobile quick actions appear above KPI cards, the compact KPI grid has two columns, and visible buttons meet 44 px in the local 390 px Chrome check. No horizontal overflow or unlabeled form input was observed. |
| F19 | The unsupported investor expense-source choice was removed. |
| F20 | The new counterparty input has an associated label. |

## Verification

- Full non-integration backend suite passed on isolated SQLite after the last changes; PostgreSQL manual-finance integration suite passed 16 cases on a disposable database.
- Frontend TypeScript check, production build, and seven finance export/date/amount tests passed.
- Local Chrome checks at 390 px had no page errors or horizontal overflow. A physical device was not available.
- A prior production release of F01–F13 and related safety fixes used an additive migration. Tenant and finance row counts were unchanged after deployment. The changes in this document after that release are read paths and UI only; they do not require a new migration.

The original audit's production read limitations still apply to authenticated money-writing scenarios. Those were tested with synthetic tenants, not by creating or altering real tenant transactions.
