# Social Bee POS Backend (FastAPI)

## Run locally

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Start API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Core endpoints

- `GET /health`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/pin-login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/pos/menu`
- `POST /api/v1/pos/sale`
- `POST /api/v1/reports/open-shift`
- `POST /api/v1/reports/x-report`
- `POST /api/v1/reports/z-report`
- `GET /api/v1/finance/balances`
- `GET /api/v1/admin/tenants`
- `POST /api/v1/admin/tenants`
- `POST /api/v1/admin/tenants/{tenant_id}/suspend`
- `POST /api/v1/admin/tenants/{tenant_id}/activate`
- `POST /api/v1/admin/tenants/{tenant_id}/clone`
- `DELETE /api/v1/admin/tenants/{tenant_id}`

## Notes

- Tenant is resolved from `Host` header domain or `x-tenant-id` header.
- Initial super admin is seeded from environment variables.
- Tenant administration endpoints require `super_admin` role.