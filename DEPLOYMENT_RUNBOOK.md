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
   - `SUPERADMIN_USERNAME`
   - `SUPERADMIN_PASSWORD`
   - `DEFAULT_TENANT_NAME`
   - `DEFAULT_TENANT_SLUG`
   - `DEFAULT_TENANT_DOMAIN`
4. Deploy and verify:
   - `GET /health` returns `200`.

## 3) Backend Smoke Test

Run locally against deployed backend:

```bash
cd backend
BASE_URL="https://<your-backend-domain>" \
SUPERADMIN_USERNAME="ironwaves_owner" \
SUPERADMIN_PASSWORD="owner1234" \
TENANT_HEADER="tenant_default" \
python scripts/smoke_test.py
```

Expected: all checks print `[OK]` and final success message.

## 4) Frontend Deploy (Railway)

1. Create Railway service from repo root (frontend Vite app).
2. Set env vars:
   - `VITE_USE_BACKEND=true`
   - `VITE_API_BASE_URL=https://<your-backend-domain>`
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
3. Keep rollback branch/tag for quick restore.
