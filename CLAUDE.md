# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

IronWaves POS — a multi-tenant POS platform for cafés/restaurants. One React SPA serves several roles (POS, kitchen display, tables, admin, customer loyalty app) across many tenants, each on its own subdomain (`socialbee.ironwaves.store`, `emalatxana.ironwaves.store`, `super.ironwaves.store`, etc.). Backend is a separate FastAPI service. UI language is Azerbaijani-first (az/ru/en); much of the code, comments, and user-facing strings are in Azerbaijani.

## Commands

Frontend (repo root):
```bash
npm run dev              # Vite dev server
npm run build            # Production build → dist/ (also copies public/sw.js)
npm run build:customer   # Customer-only single-file app (customer.html → dist/index.html)
npm start                # Serve built dist/ via the hardened server.js (prod runtime)
npm run test:smoke       # CRM local-mode smoke test (esbuild bundle + node --test)
npm run run:ios          # Build customer app + cap sync + open Xcode
npm run print-agent      # Local ESC/POS print agent (tools/print-agent)
```

Backend (`cd backend`, Python 3.10+; 3.12 in CI/Docker):
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # run API
python -m pytest                                            # all tests (testpaths=tests)
python -m pytest tests/test_x_report_approval_flow.py       # single test file
python -m pytest tests/test_x_report_approval_flow.py::test_name   # single test
python -m pytest -m integration                             # integration tests (need INTEGRATION_DATABASE_URL)
python -m compileall app                                    # compile check (CI gate)
alembic upgrade head        # apply migrations (or ./scripts/run_migrations.sh)
alembic revision --autogenerate -m "msg"                    # new migration
```

There is no frontend lint/typecheck script and no unit-test runner for `src/`; `npm run build` (Vite + tsc via the build) is the type gate. CI (`.github/workflows/ci.yml`) runs backend pytest + `alembic upgrade head --sql` + a frontend `npm run build`.

## Architecture

### Dual-mode data layer (most important thing to understand)
The frontend runs in **two interchangeable modes**, decided at runtime by `isBackendEnabled()` in `src/api/client.ts`:
- **Local mode** — all data lives in `localStorage` via `src/lib/db_sim.ts` (`getDB`/`setDB`). Used for demos/offline. `seedDatabase()` (`src/lib/seeder.ts`) populates it.
- **Backend mode** — talks to the FastAPI server via `apiRequest()`.

Because of this, most modules in `src/api/*.ts` expose **paired functions**: a synchronous local one (e.g. `get_menu_items`) and an async live one suffixed `_live` (e.g. `get_menu_items_live` calling `apiRequest`). When adding a feature that touches data, you usually implement **both** paths. Backend is considered enabled when `VITE_USE_BACKEND` is truthy or an API base URL resolves; `localStorage['ironwaves_force_local_mode']='1'` forces local.

`apiRequest` (in `client.ts`) is the single HTTP entry point and carries a lot of load-bearing logic: GET dedup + short-TTL response cache, timeout/retry, proactive JWT refresh, a 401→refresh→retry flow, and an `ironwaves-auth-expired` window event on hard auth failure. Do not bypass it with raw `fetch`.

### Tenant resolution
Tenants are resolved by **host**, not by a client-sent id. The frontend sends `x-tenant-domain: <window.location.host>` on every request; the backend maps domain→tenant via the `tenant_domains` table (`resolve_tenant_from_request`, `app/tenant.py`). `x-tenant-id` is opt-in only. On native (Capacitor) the domain falls back to `localStorage['mobile_tenant_domain']` or `super.ironwaves.store`. Client-side host→tenant mapping (`src/lib/tenant.ts`) is only authoritative in local mode. Every backend table is scoped by `tenant_id`.

### Auth & roles
JWT access + refresh tokens; staff authenticate by **PIN**, admins by username/password (+ optional TOTP 2FA). Roles: `super_admin` (platform, sees all tenants + tenant switcher), `admin`, `manager`, `staff`, `kitchen`. Frontend session state is in `src/store.ts` (Zustand + persist). Module visibility per role is computed in `App.tsx` (`canAccess`) and further gated by tenant `settings.role_modules`.

### App shell & modules (`src/App.tsx`)
A single large component owns the whole authenticated shell. Modules (`pos`, `tables`, `kds`, `finance`, `inventory`, `crm`, `settings`, `tenants`, …) are `lazy()`-loaded and switched via a `currentModule` state synced to the URL (`src/lib/navigation.ts`). POS/Tables/KDS stay mounted (kept-alive divs); everything else renders inside `AdminPanel.tsx` via an `externalTab` prop. `App.tsx` also handles public routes (`/menu`, `/feedback`, public receipt, customer loyalty app) **before** the login gate, connectivity probing, offline-sync triggers, idle logout, staff-notification polling, and fast PIN user-switch.

### Backend (`backend/app`)
FastAPI app in `main.py` with routers in `app/routers/*.py` (auth, pos, finance, reports, restaurant, catalog, operations, tenants, analytics_api, suppliers, integrations, agent, ai_ops, customer_feedback_ops, settings). `main.py` middleware stack does rate limiting (Redis or in-memory), CSRF origin check, security headers, request logging, and Prometheus `/metrics` (token-gated). Models are in one file `app/models.py`; DB session/engine in `app/db.py`; request-scoped tenant/user deps in `app/deps.py`.

**Migrations are two-track.** Alembic (`backend/alembic/versions/`) is the source of truth for deploys. Additionally, `main.py::_run_startup_migrations()` applies **idempotent** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` blocks at startup, guarded by `app_schema_migrations` version tracking. In production `STARTUP_RUNTIME_MIGRATIONS_ENABLED=false` — schema is applied via Alembic in the deploy step (the backend Dockerfile runs `alembic upgrade head` before uvicorn). When you add a column, add it to **both** the model and an Alembic migration (and, if it must exist for older prod DBs on boot, the startup block).

**Finance is double-entry.** `finance_accounts` / `finance_transactions` / `finance_ledger_entries` (debit/credit, CHECK constraints) are the ledger, with a legacy `finance_entries` "wallet" mirror kept in sync (`finance_service.py`). Reports (X/Z, shifts, P&L, COGS) build on this. Treat finance changes as high-risk — see `SECURITY_FINANCE_CHECKLIST.md` and `docs/operations/`.

Realtime uses a WebSocket at `/ws/restaurant?tenant_id=&token=` (`app/realtime.py`, `realtime_hub`) for live table/kitchen updates. Background schedulers (AI agent, per-tenant backups, birthday rewards) start in `on_startup`.

### Offline & sync
Local-first for POS/Tables/KDS. Offline sales and table operations queue in localStorage (`src/lib/offline.ts`, `syncPendingOfflineSales`, `syncPendingOfflineTableOps`) and flush when connectivity returns. Backend dedups replays via `sales.offline_request_id` (unique per tenant).

### Mobile & print
Capacitor wraps the customer loyalty app for iOS/Android (`capacitor.config.ts`, `ios/`, `android/`); push tokens register in `App.tsx` and save via `save_push_token_live`. Receipt/kitchen printing is HTML- and ESC/POS-based (`src/lib/escpos_builder.ts`, `receipt_html.ts`, `kitchen_ticket_html.ts`) with an optional local print agent (`tools/print-agent/`) and QZ Tray (`src/lib/qz.ts`).

## Conventions & gotchas
- `@/*` path alias → `src/*` (both `tsconfig.json` and `vite.config.ts`).
- Money uses `decimal.js` on the frontend and `NUMERIC` on the backend — avoid float math for prices/totals.
- User-facing strings are trilingual via `tx(lang, az, ru, en)` and the `i18n` maps (`src/i18n.ts`); default/fallback language is `az`.
- Production build strips `console.*` (terser `drop_console`). The PWA service worker is intentionally **self-destroying** (`vite.config.ts`) — POS must never serve a stale app shell; don't reintroduce a caching SW.
- `server.js` is the production static server (not Vite preview): SPA fallback, security headers, path-traversal/`.env`/`.git` blocking, `/healthz`. Railway healthcheck for frontend is `/health`, backend is `/health/deep`.
- Backend secrets (`JWT_SECRET`, `SUPERADMIN_PASSWORD`, `DATABASE_URL`) are required env vars with no safe defaults; demo seeding is off by default and blocked in production unless explicitly allowed.

## Reference docs
- `DEPLOYMENT_RUNBOOK.md` — Railway + Neon deploy, required env vars, CORS/wildcard subdomains.
- `backend/README.md` — API endpoint list and local run.
- `docs/` — UI/UX audits, customer-app benchmarks, multi-branch plan, kitchen-print audit, `operations/` runbooks.
- `USER_HANDBOOK_AZ.md`, `WAITER_POS_TABLES_KDS_GUIDE_AZ.md` — product/operator guides (Azerbaijani).
