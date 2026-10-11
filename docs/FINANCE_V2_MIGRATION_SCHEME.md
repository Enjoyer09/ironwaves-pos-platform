# Finance v2 — real-tenant migration scheme (Daily Coffee + Gyros)

**Status:** PROPOSED. Nothing here has been run on a real tenant. Every step below was
verified against production **read-only** on 2026-10-11 and against the existing
`FINANCE_V2_START_HERE.md` Phase 2/3 plan.

**Owner requirement (2026-10-11):** the tenants that matter are **Daily Coffee
(`6e2c0d4c-…`, emalatcoffee.ironwaves.store)** and **Gyros (`01e69c82-…`,
gyrospos.ironwaves.store)**. Test everything on the **Platform/super** tenant first (it is
already the test tenant), then migrate the two real ones.

---

## 0. The honest starting point (verified, read-only)

| Tenant | Ledger mode | Reports source | UI | Supplier req | Readiness |
|---|---|---|---|---|---|
| **Platform/super** (`b3442582-…`) | **dual** (since 2026-09-30) | **gl** (since 2026-10-02) | visible | on | **YES** (all checks; reconcile 14/14; parity ok; 0 native errors; streak 12) |
| **Daily Coffee** (`6e2c0d4c-…`) | **dual** (since 2026-10-07 13:43) | **legacy** | hidden | off | **NO** — 1 native error (09:03 today, `SaleCompleted… empty_sale`), shadow lag ~7941 s, negative wallet (`Seyf = -847.40`), unassigned AP 461.93 |
| **Gyros** (`01e69c82-…`) | **legacy** | legacy | NOT RECORDED | NOT RECORDED | **NO** — needs the two settings recorded; negative wallet (`Seyf = -2900.00`); 27 039.35 ₼ pending X-report diff (R7) |
| Demo | dual | gl | visible | on | YES |

So the plan is **not** "move Daily Coffee/Gyros to v2" — Daily Coffee is already dual.
The real work is:

1. **Super**: already the test tenant and fully moved. Use it for every pilot check.
2. **Daily Coffee**: fix the native_error, shrink the shadow lag, decide the negative wallet,
   then `--reports gl` (the last step) and watch for 3–7 clean nights.
3. **Gyros**: record the two settings, then the full ladder dual → watch → reports gl.

---

## 1. The ladder (same for every tenant)

```
legacy ──► dual ──(watch ≥3 nights)──► reports gl ──(watch ≥7 nights)──► [later] ui visible / bills
            │                                    │
            └──── the only routine rollback is:  └─── --reports legacy (safe, instant)
```
- `dual` alone is **invisible to the customer**: the GL API answers 404 to every role except
  `super_admin` unless `finance_v2_ui_visible` is `true` (verified on production container
  today). So a dual-but-hidden real tenant sees **no change**.
- `--reports gl` is the only step that can change the numbers a customer sees (R5: explained
  differences, e.g. legacy forgot bank fees). That is the **ASK** step — owner says yes first.
- `--set legacy` works but is **not a full rewind** (R3, WP-A3 fixed): the nightly check keeps
  using the dual reconciler and native journals stay in the GL.

---

## 2. Preconditions (all already verified except the ones flagged)

- [x] Backend running the WP-A build (gate, readiness, supplier setting) — production image =
      `eb2a00d6` (PR #43 merged), deployed SUCCESS 2026-10-07 09:58.
- [x] Ready-to-apply migrations present locally: `20261008_0001` … `20261011_0004`
      (kitchen_orders.store_id, epoint_payments, customer opt-ins, push_deliveries.campaign_id,
      push_schedules, push_engagement). **They are NOT in production yet** (`alembic_version`
      = `20261002_0001`). They apply to ALL tenants on next backend deploy.
- [ ] Fresh backup before anything touches a real tenant (owner's recipe: encrypted pg_dump +
      Keychain key `iw-backup-2026-09-30`; check size + table count).
- [ ] Staging refresh from the newest dump (optional rehearsal, `iw-staging-pg`).

---

## 3. Phase A — prove the ladder on super (the test tenant) — all steps are AUTO

Super is already dual + reports gl; the "ladder" therefore means **exercising the hooks** the
real tenants will later use, exactly like the P2x pilots but on super:

1. `gl_ledger_mode.py --tenant b3442582-… --reconcile` → must stay 14/14 ok.
2. `gl_ledger_mode.py --tenant b3442582-… --parity` → ok, unexplained = [].
3. **Gate check (read mission-critical for Daily Coffee):** run the role probe from the
   production container (see `docs/` companion or the audit script) — already proven today:
   - Daily Coffee (dual, hidden): admin/manager/staff → **404**, super_admin → 200.
   - Super (visible): all roles → 200.
   - Gyros (legacy): everyone → 404 (API closed).
4. **(AUTO but reversible) bills pilot on super:** 1 ₼ create bill → partial pay → replay same
   idempotency key → full pay → overpay blocked → reverse with 4-eyes → void with 4-eyes →
   two threads paying one bill → exactly one succeeds; then reconcile before == after == 14/14,
   AP sub-ledger reconciled. (This is the documented "P — production pilot" from the handoff;
   it was run on super in WP3, 26/26. Re-run it only if we touch bill paths.)
5. If (3) or (4) fails: stop, diagnose, do not proceed to real tenants.

Exit: super remains the same as today (it already is the yardstick).

---

## 4. Phase B — Daily Coffee (`6e2c0d4c-…`) — the real, low-volume tenant — AUTO with 2-line heads-up

Sequence (mirrors `FINANCE_V2_START_HERE.md` Phase 2, adapted to state verified today):

1. **Backup** (ASK, owner) — fresh encrypted dump; verify size + table count.
2. **Decide & record the two settings explicitly** (readiness stays NO until recorded):
   ```bash
   railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant 6e2c0d4c-6fab-4e49-8f9d-2d675457c655 --ui hidden --reason "DC: real tenant, keep v2 hidden" --allow-production' < /dev/null
   railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant 6e2c0d4c-6fab-4e49-8f9d-2d675457c655 --require-supplier off --reason "DC: restock workflow unchanged for now" --allow-production' < /dev/null
   ```
   (Daily Coffee already has both recorded: `hidden`, `off`. Verify with `--list`; re-record only
   if absent. The point of this step is that a future readiness print is honest.)
3. **Fix the open native_error** (blocking before the reports switch):
   - Today 09:03 the dual bridge recorded `native_error`: `SaleCompleted … empty_sale` —
     a sale with **no payment, no applied deposit, no staff benefit** was completed on Daily
     Coffee. That is a data/ops condition, not a GL bug. Find that sale
     (`sales` where `completed` after 2026-10-11 09:00 and no payment/deposit), decide with the
     owner whether it is a real freebie/staff meal or a mis-keyed sale, then:
     - if it is legitimately a zero-paid sale: post a `GLOnlyJournal`/adjustment so the dual
       reconcile is satisfied and the alert clears on the next nightly run; or
     - if it was a mistake: void it (with the normal void path) before the reports switch.
   - Until fixed, the 7-day native-error check in readiness stays red.
4. **Shrink the shadow lag** (~7941 s ≈ 2.2 h, vs target ≈ 5 min). The 5-min incremental sync
   thread is presumably starved/backed up on the single worker. Watch `gl_shadow_runs` for a few
   cycles. If it stays > 1 h, this is a platform concern (all tenants sync in-process) — log it,
   do not block the reports switch on it, but monitor.
5. **Send the owner a 2-line heads-up** ("Daily Coffee → reports gl tonight; customer sees no
   change (module hidden); numbers will shift by the explained differences, e.g. card fees").
6. `gl_ledger_mode.py --tenant 6e2c0d4c-… --reports gl --reason "DC: Phase B, owner ok 2026-10-11" --allow-production`
   → `--reconcile` → must be 14/14 → `--parity` → list every explained diff; show the owner the
   expected visible shifts (R5) and get his explicit yes before this step if not already given.
7. **Watch:** next 3–7 nightly runs. `native_error` must stay 0; streak grows; alert banner
   clear. If any `reconcile_failed`: stop, diagnose, roll back with `--reports legacy`.
8. **Rollback ladder:** (a) `--reports legacy` (safe, instant), (b) `--set legacy` + WARNING
   (WP-A3, native journals stay). Otherwise call the owner.

Exit: Daily Coffee reports from GL, module hidden, all real sales path unchanged, 3+ clean
nights recorded, rollback ladder documented.

---

## 5. Phase C — Gyros (`01e69c82-…`) — the larger real tenant, start ≥ 7 days after DC is stable

Same ladder, two extra steps:

1. **Record the two settings explicitly** (Gyros has neither):
   ```bash
   railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant 01e69c82-085d-4611-8084-6ce3c6f37770 --ui hidden --reason "GY: real tenant, keep v2 hidden" --allow-production' < /dev/null
   railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant 01e69c82-085d-4611-8084-6ce3c6f37770 --require-supplier off --reason "GY: restock workflow unchanged" --allow-production' < /dev/null
   ```
2. **Known data conditions to carry into migration** (recorded, not yet corrected — correction
   is Phase 5 / accountant-driven, ASK): negative wallet `Seyf = -2900.00`; 27 039.35 ₼ pending
   X-report difference since 2026-08-22 (R7). The dual reconcile is **balanced** even with a
   negative safe (it compares both ledgers), so migration can proceed; do not "fix" the numbers
   by editing history.
3. `--set dual --reason "GY: Phase C"` → `--reconcile` 14/14 → watch ≥ 3 nights → heads-up →
   `--reports gl` (ASK) → watch ≥ 7 nights.
4. Same rollback ladder.

Exit: Gyros dual, reports gl, 3+ clean nights, module hidden.

---

## 6. Postconditions & guardrails (applies to both real tenants)

- **Never** enable `finance_v2_ui_visible=true` for a real tenant until the owner starts the
  staff training (Phase 5 in the handoff) — hidden = no customer change, and it keeps the GL
  APIs 404 to the tenant's admins (verified).
- **Never** enable `finance_v2_require_supplier=true` for a real tenant until the owner says the
  staff can pick a supplier on stock receipts (R2).
- Bills (`gl_documents`) stay off for real tenants until reports `gl` AND staff trained (R4).
- Tax accrual stays off until the accountant answers the 8 questions (`accountant-review-az.md`).
- After every money step: reconcile 14/14, parity ok, no new `native_error`, streak not broken.

---

## 7. What we do NOT know yet (honest)

- The exact sale behind the Daily Coffee `native_error` (needs an ops read of that transaction).
- Whether the shadow lag is a one-off or a systemic single-worker issue.
- Owner's sign-off on the R5 explained-difference magnitudes for DC/Gyros.
- Accountant answers (tax base, correction entries) — blocks nothing above except tax accrual.

---

## 8. Commands cheat-sheet (all production ops, inside the container)

```bash
# read-only, per tenant
railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_readiness.py --tenant <ID> --allow-production' < /dev/null
railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --list --allow-production' < /dev/null
# the switches
railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant <ID> --set dual --reason "..." --allow-production' < /dev/null
railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant <ID> --reports gl --reason "..." --allow-production' < /dev/null
railway ssh --service ironwaves-pos-backend -- sh -c 'cd /app && PYTHONPATH=/app python scripts/gl_ledger_mode.py --tenant <ID> --ui hidden --reason "..." --allow-production' < /dev/null
# watch
railway logs --service ironwaves-pos-backend | grep -E "gl-alert|reconcile|native_error"
```