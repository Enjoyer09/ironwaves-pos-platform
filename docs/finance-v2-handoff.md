# Finance v2 (GL) — handoff plan for the next AI coding agent

State as of 2026-09-30. Paste **section 1 + section 2** into the new agent first, then one work package (section 3) at a time.

---

## 1. Context prompt (always paste first)

```text
You are continuing "Finance v2", a double-entry general ledger (GL) on the Azerbaijan national chart of
accounts (AMHP), inside the iRonWaves POS platform. Repo: /Users/macbookair/Documents/GitHub/ironwaves-pos-platform
(GitHub Enjoyer09/ironwaves-pos-platform). Backend FastAPI + SQLAlchemy + Alembic (backend/), frontend React/TS
+ Vite (src/). Production: Railway project "terrific-cat", env "production", services ironwaves-pos-backend,
ironwaves-pos-frontend, Postgres (PG 18). Railway auto-deploys main; the Dockerfile runs `alembic upgrade head`
on every deploy. The owner speaks Azerbaijani: reply in Azerbaijani, short and factual.

ARCHITECTURE (read these before changing anything):
- backend/app/gl/: models.py, coa_az.py (AMHP chart, system_role per account), engine.py (create/approve/
  reject/reverse journals, periods, audit hash chain, year_closed guard, not_year_close()), posting_rules.py
  (business events → compound journals), bridge.py (ledger mode legacy|dual, emit never raises, falls back to
  shadow), shadow.py (5-min mirror of legacy + nightly reconcile 04:00 Baku, advisory lock 7411),
  legacy_migration.py (migrate_tenant, reconcile_tenant 19 checks, reconcile_dual_tenant 14 checks,
  GL-only journals = explained diffs), read_model.py (reports source legacy|gl; the lowest-level readers
  ledger_balances_snapshot / shift_cash_breakdown_from_ledger / sales_payment_totals dispatch on it),
  reports.py, tax.py (simplified 2%/5%, VAT), year_end.py, subledger.py (AP/AR FIFO aging), router.py
  (/api/v1/gl, per-tenant gate: global flag OR tenant in dual; GET /capabilities).
- Posting rules bind to system_role, never to account codes.
- Server is the only writer of accounting. Offline POS queues sales with idempotency keys; finance ops are
  online-only.
- Frontend: src/api/gl.ts, src/components/admin/FinanceV2Panel.tsx + src/components/admin/financev2/*.
  Module key "financev2" (src/lib/navigation.ts, src/App.tsx canAccess gated by getGLCapabilities()).
- Scripts: backend/scripts/gl_ledger_mode.py (--list, --tenant X --set dual|legacy --reason, --reconcile,
  --parity, --reports gl|legacy, needs --allow-production on prod), backend/scripts/gl_migrate_legacy.py.

TENANTS (production):
- Demo 5dcc537d-7905-4080-ad35-e6a05432dc83 (demo.ironwaves.store): dual + reports gl. Pilot tenant.
- Platform b3442582-fd16-40bc-bb6c-605c34ca3d48 (super.ironwaves.store): dual + reports legacy.
- REAL CUSTOMERS, legacy/legacy, must not notice anything:
  Gyros 01e69c82-085d-4611-8084-6ce3c6f37770 (gyrospos.ironwaves.store),
  Daily Coffee 6e2c0d4c-6fab-4e49-8f9d-2d675457c655 (emalatcoffee.ironwaves.store),
  dc9e5773-4464-453b-a7b1-fcb3b6ddba6e (art-space.ironwaves.store), socialbee (b3f7c248…).

HARD RULES:
1. Never write to production without: encrypted pg_dump backup → PR on a new branch → CI green → merge →
   deploy SUCCESS → verification. Ask the owner before each production step that changes data or modes.
2. Never change ledger mode or reports source of a real-customer tenant without explicit owner approval.
3. Never print secrets (DATABASE_PUBLIC_URL, JWT, backup key). Get the DB URL with
   `railway variables --service Postgres --json` (key DATABASE_PUBLIC_URL) into a variable only.
4. Production scripts run INSIDE the backend container (the public proxy is ~75 ms/query):
   railway ssh --service ironwaves-pos-backend -- sh -c 'cat > /tmp/x.py && cd /app && PYTHONPATH=/app python /tmp/x.py; rm -f /tmp/x.py' < /tmp/x.py
   (PYTHONPATH=/app is required. Write the local file first, then run — never in the same parallel batch.)
   Do not use FastAPI TestClient there (httpx is not installed); call router functions directly.
5. Pilot writes in production: only on Demo, as user "system:gl-pilot" (checker "system:gl-pilot-checker"),
   1 AZN amounts, always reversed/voided afterwards, reconcile 14/14 before and after.
   Do not reset or create real user passwords.
6. Posted journals are immutable; corrections are storno/adjusting journals. Keep maker-checker (4-eyes).
7. The PR preview environment always fails (its Postgres is never deployed) — infra, not code.
8. Money is Decimal end-to-end (backend) and decimal.js (frontend). No floats.

LOCAL VERIFICATION:
- Backend: python3 -m venv /tmp/iw-venv && /tmp/iw-venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
  cd backend && DATABASE_URL=sqlite:////tmp/iw-test.db JWT_SECRET=test-secret-test-secret-test-secret-123456
  SUPERADMIN_PASSWORD=Test-Passw0rd-123 /tmp/iw-venv/bin/python -m pytest tests -p no:cacheprovider -o addopts="" -q
  (baseline: 872 passed, 11 skipped)
- Frontend: npx tsc --noEmit -p . && npm run -s test:smoke (60/60) && npx vite build
- Staging = local Docker container iw-staging-pg (127.0.0.1:55433, user postgres, password staging, db railway),
  a restored production copy. Use DATABASE_URL=postgresql://postgres:staging@127.0.0.1:55433/railway
  (psycopg2 driver, not psycopg). Staging login: demo_admin / Staging-Rehearsal-2026! with header
  X-Tenant-Domain: demo.ironwaves.store. (Staging and backups are scheduled for deletion 2026-10-04 —
  re-create from a fresh encrypted dump if needed.)

BACKUP RECIPE (run from the repo dir, the Railway CLI is linked there):
  URL=$(railway variables --service Postgres --json | python3 -c 'import sys,json;print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])')
  K=$(security find-generic-password -a iw-backup -s iw-backup-2026-09-30 -w)
  docker run --rm -e PGURL="$URL" postgres:18-alpine sh -c 'pg_dump -Fc --no-owner "$PGURL"' \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "pass:$K" -out ~/iw-backups/<date>/<name>.dump.enc
  Then sha256 it and verify: decrypt fully to a temp file, `pg_restore -l` must list 60 TABLE DATA entries.
```

---

## 2. Working method prompt (paste second)

```text
Working method:
- Before coding, read the files you will change and the tests next to them. Match existing patterns.
- Every behavior change gets tests (backend/tests/test_gl_*.py style: in-memory SQLite with StaticPool).
- After changes: full backend suite + frontend tsc/smoke/build. Then a staging rehearsal against the
  production copy for anything touching money or reconciliation.
- One work package = one branch (feature/finance-v2-<name>) = one PR. Do not push to main.
- Finish each package with: what changed, what was verified (numbers), what was NOT verified, next step.
- If a check fails twice with the same approach, stop and diagnose the root cause instead of tweaking.
```

---

## 3. Work packages (in order)

### WP0 — Ship P3a (ready, not yet deployed)

Branch `feature/finance-v2-p3a`, commit `b06aecf9`: year-end close, AP/AR sub-ledger, refresh-token retention.

```text
Task: ship branch feature/finance-v2-p3a to production.
1. Encrypted backup (recipe above), name railway-prod-<date>-premerge-p3a.
2. Push, open PR, wait for "Backend Checks" and "Frontend Build" (ignore preview deploy failure), merge.
3. Wait for both Railway deployments SUCCESS on the merge commit.
4. Verify in logs that retention ran once: "[retention] removed N dead refresh tokens" (expect ~250k on first
   run; staging took 4.2 s). Then in the container: SELECT count(*) FROM refresh_tokens (expect a few thousand).
5. Demo pilot inside the container (router functions, system:gl-pilot): GET subledger ap/ar (reconciled=true
   for every tenant, read-only), GET years/2025 (blockers list), reconcile_dual_tenant Demo 14/14.
   Do NOT close any real fiscal year.
6. Check legacy tenants still get 404 on /api/v1/gl/capabilities.
Report in Azerbaijani.
```

### WP1 — Platform reports → GL

```text
Task: move Platform (b3442582…) reports source to gl.
Precondition: at least 2-3 consecutive clean nightly reconciliations (gl_shadow_runs, run_type='reconcile',
ok=true) AND at least some real activity. Check first; if not met, report and stop.
Then: gl_ledger_mode.py --tenant <Platform> --parity (must show no unexplained differences), ask the owner,
then --reports gl --reason "..." --allow-production, re-run --reconcile, spot-check Z-report/shift numbers.
Rollback: --reports legacy.
```

### WP2 — Accountant corrections and real-customer rollout (BLOCKED on the accountant)

The accountant review document has 8 questions (key: does the simplified-tax base include cash overage,
other income and the sale value of staff meals?). Known data findings to correct **after** migration via GL
adjusting journals:

- Gyros: 27 039.35 ₼ pending "X-report difference" since 2026-08-22; safe −2 400; suspense 538.9 = 1 319.30.
- Daily Coffee: safe −847.40; inventory −2 830.68; suspense 538.9 = 384.70; "Borc Alındı" 40 ₼ booked as income
  (should be a liability).

```text
Task (only after the owner forwards the accountant's answers):
1. Encode the answers (tax base rules → tax.py if needed, with tests).
2. For each finding, prepare adjusting journals as a reviewable list (account, amount, reason) and get the
   owner's approval BEFORE posting. Post as journal_type="adjustment", maker-checker.
3. Daily Coffee: --set dual (reconcile 19/19 → 14/14), observe 2-3 clean nights, --parity, --reports gl.
4. Gyros: same ladder, only after Daily Coffee is stable for a week.
Each switch: backup first, owner approval, rollback = --set legacy / --reports legacy.
```

### WP3 — P3b: bills and invoices (documents, due dates, matching)

Today the sub-ledger is derived from tagged GL lines and aged by posting date; most historical AP is
"unassigned" because legacy restocks had no supplier (staging: Art Space 8 719.86 ₼, Daily Coffee 427.93 ₼).

```text
Task: add AP bills / AR invoices as documents on top of the GL.
Design:
- New tables (Alembic migration chained after the current head): gl_documents (id, tenant_id, kind
  'ap_bill'|'ar_invoice', partner_type, partner_id, number, issue_date, due_date, currency, total, status
  open|partially_paid|paid|void, journal_id, created_by/at) and gl_document_allocations (payment journal
  line → document, amount). PG triggers like the existing GL tables if immutability is needed.
- Posting: creating a bill posts the StockReceived/expense journal with partner tags and links journal_id;
  SupplierPaid allocates to named documents, else FIFO to the oldest open bill (same rule as subledger.py).
- Supplier becomes required for NEW stock receipts in dual mode (UI + API validation); keep legacy optional.
- Aging switches to due_date when a document exists; subledger.py stays the reconciliation proof
  (document open totals must equal the control account per partner).
- Tool to assign historical unassigned AP to suppliers via an adjusting journal (reclass between partners
  on 531, net zero), owner-approved.
- UI: bills list, bill detail with allocations, "pay bill" action, due-date aging in the Borclar tab.
Tests: allocation math, partial payments, overpayment → advance, void bill = storno, reconciliation.
```

### WP4 — P2e: stop writing the legacy ledger (last step of the cut-over)

Prerequisite: every active tenant in dual + reports gl, stable for at least 2 weeks, owner approval.

```text
Task: introduce ledger mode "gl" (legacy writes stopped) behind the existing per-tenant setting.
1. Inventory every writer of legacy finance tables (FinanceTransaction, FinanceEntry, FinanceLedgerEntry,
   finance_accounts balances): start from finance_service.post_existing_transaction / post_finance_transaction
   and the hook list (pos.create_sale, restaurant settle_check, operations pay_table/deposits/handover,
   integrations webhook, reports open_shift/X/Z/wage/handover, analytics void/adjust/refund, finance /entry
   /transfer /repay-investor, restock/loss, suppliers.pay_supplier).
2. Inventory every legacy READER that does not go through the dispatched lowest-level readers
   (grep for FinanceTransaction/FinanceLedgerEntry queries outside finance_service). Each must read the GL
   (read_model) when reports source is gl, or be retired.
3. In mode "gl": bridge.emit posts the native journal and the legacy write is skipped; failures must RAISE
   (no shadow fallback any more) so the business transaction rolls back.
4. Shadow sync and dual reconciliation are skipped for "gl" tenants; nightly job runs GL integrity only.
5. Rollback path: switching back to dual needs a legacy backfill from GL — design it, or document that
   "gl" is one-way and require a fresh backup immediately before the switch.
Tests: every hook in mode gl writes exactly one native journal and zero legacy rows; failure rolls back
the sale; reports identical to dual mode for the same scenario.
Rollout: Demo → Platform → Daily Coffee → Gyros, one per week.
```

### WP5 — Frontend QA

```text
Task: visual and accessibility pass of "Mühasibat (v2)" on Demo (desktop 1440px + mobile 390px).
Check every tab (Baxış, Sınaq balansı, Hesab kartı, Jurnallar, Təsdiqlər, Borclar, Dövrlər və il, Vergi,
Nəzarət): loading/empty/error states, keyboard navigation and Escape in dialogs (nested dialogs close one
at a time), long account names, negative amounts, az/ru/en strings. Confirm the module is invisible on
legacy tenants and for staff role. Fix issues; keep the existing dark "slate + yellow" style.
Note: full WCAG validation needs manual testing with assistive technologies.
```

### WP6 — Housekeeping

```text
- 2026-10-04: delete ~/iw-backups/2026-09-30 (dumps + sha256 + reports), staging container and volume
  (docker rm -f iw-staging-pg && docker volume rm iw-staging-pgdata) and the Keychain key
  (security delete-generic-password -a iw-backup -s iw-backup-2026-09-30). ASK the owner first and offer
  to keep the newest dump. Newer backups (WP0+) need their own key/retention decision.
- After P2 is complete: remove the Railway SSH key "macbookair-finance-v2" from the Railway account.
- Railway warns that railway.json/railway.toml (Config as Code) is deprecated and stops working
  2026-12-01: run `railway config migrate` on a branch, review, deploy before that date.
- audit_logs (~100 MB) and sales.receipt_html (~76 MB) dominate DB size; propose retention/archiving.
```

---

## 4. Definition of done for each package

- Tests added for every behavior change; backend suite and frontend checks green.
- Staging rehearsal numbers reported (reconcile checks, balances) for money-related changes.
- Production: backup file name + size, PR number, merge commit, deploy status, pilot result, reconcile before/after.
- Real-customer tenants unchanged unless the owner explicitly approved that step.
- Summary to the owner in Azerbaijani: done / verified / not verified / next.
