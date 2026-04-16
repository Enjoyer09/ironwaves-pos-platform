# Social Bee POS Deployment Runbook

## 1) Prerequisites

1. Domains are configured:
   - `www.ironwaves.store`
   - `socialbee.ironwaves.store`
   - `emalatxana.ironwaves.store`
   - `super.ironwaves.store`
2. Railway project(s) created.
3. Neon PostgreSQL database ready.

## 2) Backend Deploy (Railway)

1. Create a Railway service from `backend/`.
2. Use `backend/Dockerfile`.
3. Set required env vars:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `METRICS_BEARER_TOKEN`
   - `CORS_ORIGINS`
   - `SUPERADMIN_USERNAME`
   - `SUPERADMIN_PASSWORD`
   - `DEFAULT_TENANT_NAME`
   - `DEFAULT_TENANT_SLUG`
   - `DEFAULT_TENANT_DOMAIN`
   - Keep `RESET_SUPERADMIN_ON_STARTUP=false` in production unless you are intentionally rotating from env
   - Keep `SEED_DEMO_USERS=false` in production
   - Keep `ALLOW_LEGACY_TENANT_HEADER_FALLBACK=false` in production
   - Keep `STARTUP_RUNTIME_MIGRATIONS_ENABLED=false` in production (migrations should run in deploy step)
4. Deploy and verify:
   - `GET /health` returns `200`.
   - `GET /metrics` requires bearer token in production.

Before production deploys with database changes, run migrations from the backend service context:

```bash
cd backend
./scripts/run_migrations.sh
```

Finance-specific rollback, restore and hardening steps are documented in:

```text
docs/operations/FINANCE_PRODUCTION_HARDENING_RUNBOOK.md
```

Recommended `CORS_ORIGINS` for wildcard tenant setup:

```text
https://www.ironwaves.store,https://ironwaves.store,https://super.ironwaves.store,https://demo.ironwaves.store,https://*.ironwaves.store,http://localhost:5173
```

This backend supports wildcard origins like `https://*.ironwaves.store`, so new tenant subdomains such as `https://gyrospos.ironwaves.store` do not need to be added one by one.

## 3) Backend Smoke Test

Run locally against deployed backend:

```bash
cd backend
BASE_URL="https://<your-backend-domain>" \
SUPERADMIN_USERNAME="ironwaves_owner" \
SUPERADMIN_PASSWORD="owner1234" \
TENANT_DOMAIN="socialbee.ironwaves.store" \
python scripts/smoke_test.py
```

Expected: all checks print `[OK]` and final success message.

## 4) Frontend Deploy (Railway)

1. Create Railway service from repo root (frontend Vite app).
2. Set env vars:
   - `VITE_USE_BACKEND=true`
   - `VITE_API_BASE_URL=https://<your-backend-domain>`
   - `VITE_API_BASE_URL` is mandatory at build time (build fails if missing)
3. Deploy.
4. Bind production domains.

## 5) Domain/Tenant Mapping Validation

1. Open `socialbee.ironwaves.store`.
2. Open `emalatxana.ironwaves.store`.
3. Login with tenant admin and verify data isolation.
4. Open `super.ironwaves.store` and verify only Settings/tenant controls are visible for `super_admin`.

## 6) Go-Live Checklist

1. Auth works for:
   - super_admin
   - tenant admin
   - staff PIN login
2. POS sale creates:
   - sale row
   - finance row(s)
   - receipt QR
3. Table -> kitchen -> payment flow works.
4. X/Z reports work.
5. Restore/backup tested on staging.
6. Email provider configured in Settings.
7. Omnitech configuration fields filled (if available).

## 7) Post-Deploy Monitoring

1. Check `Logs` panel for UI telemetry.
2. Check backend logs for `401/500` spikes.
3. Check `/metrics` for request count and latency trends.
4. Check Sentry if `SENTRY_DSN` is configured.
5. Keep rollback branch/tag for quick restore.

## 8) P2 Closure Criteria

P2 is considered closed when:

1. Runtime schema migrations are disabled in production and `run_migrations.sh` is used during deploy.
2. Backend container runs as non-root and uses multi-stage Docker build.
3. CI workflow runs backend compile + tests + alembic SQL preview + frontend build.
4. Baseline backend pytest suite exists and passes in Python 3.12 CI.

## 9) P4 Closure Criteria

P4 is considered closed when:

1. Security headers are active in production (`X-Content-Type-Options`, `X-Frame-Options`, `CSP`, `HSTS`, `COOP`, `X-Permitted-Cross-Domain-Policies`).
2. Auth routes are non-cacheable (`Cache-Control: no-store`, `Pragma: no-cache`, `Expires: 0`).
3. Password policy is centralized and configurable via env (`PASSWORD_MIN_LENGTH`, `PASSWORD_REQUIRED_CHARACTER_CLASSES`).
4. Request correlation is end-to-end: frontend sends `x-request-id`, backend returns `X-Request-ID`, and errors include request id.
5. Runtime performance indexes for high-traffic paths are applied (staff notifications unread, tables tenant/status/label, unread notifications).
6. Rate limiting remains tenant-aware and Redis-backed in production.
7. Session security controls are active (`revoked_tokens` check + Redis token revoke cache).
