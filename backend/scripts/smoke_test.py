"""Simple backend smoke test for Social Bee POS.

Usage:
  BASE_URL=http://localhost:8000 \
  SUPERADMIN_USERNAME=ironwaves_owner \
  SUPERADMIN_PASSWORD=<your-superadmin-password> \
  TENANT_HEADER=tenant_default \
  python scripts/smoke_test.py
"""

from __future__ import annotations

import json
import os
import random
import string
import sys
import urllib.error
import urllib.parse
import urllib.request


def _env(name: str, default: str | None = None) -> str:
    v = os.getenv(name, default)
    if v is None:
        raise RuntimeError(f"Missing env: {name}")
    return v


def _request(method: str, url: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, dict | str]:
    data = None
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url=url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            raw = res.read().decode("utf-8")
            try:
                return res.status, json.loads(raw)
            except Exception:
                return res.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def _ok(label: str, details: str = ""):
    print(f"[OK] {label}{' - ' + details if details else ''}")


def _fail(label: str, status: int, payload):
    print(f"[FAIL] {label} | status={status} | payload={payload}")
    sys.exit(1)


def main():
    base = _env("BASE_URL", "http://localhost:8000").rstrip("/")
    username = _env("SUPERADMIN_USERNAME", "ironwaves_owner")
    password = _env("SUPERADMIN_PASSWORD", "change_this_superadmin_password")
    tenant_header = _env("TENANT_HEADER", "tenant_default")

    # 1) Health
    st, payload = _request("GET", f"{base}/health")
    if st != 200:
        _fail("health", st, payload)
    _ok("health", str(payload))

    # 2) Login as super admin
    st, payload = _request(
        "POST",
        f"{base}/api/v1/auth/login",
        body={"username": username, "password": password},
        headers={"x-tenant-id": tenant_header},
    )
    if st != 200:
        _fail("super admin login", st, payload)
    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    if not access or not refresh:
        _fail("super admin token payload", st, payload)
    _ok("super admin login")

    auth_headers = {
        "x-tenant-id": tenant_header,
        "Authorization": f"Bearer {access}",
    }

    # 3) Tenants list
    st, payload = _request("GET", f"{base}/api/v1/admin/tenants", headers=auth_headers)
    if st != 200:
        _fail("tenants list", st, payload)
    _ok("tenants list", f"count={len(payload) if isinstance(payload, list) else '?'}")

    # 4) Create temp tenant
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
    slug = f"smoke-{suffix}"
    domain = f"{slug}.ironwaves.store"
    tenant_admin_password = "".join(random.choices(string.ascii_letters + string.digits, k=16))
    st, payload = _request(
        "POST",
        f"{base}/api/v1/admin/tenants",
        headers=auth_headers,
        body={
            "name": f"Smoke Tenant {suffix}",
            "slug": slug,
            "domain": domain,
            "admin_username": "admin",
            "admin_password": tenant_admin_password,
        },
    )
    if st != 200:
        _fail("tenant create", st, payload)
    tenant_id = payload.get("id")
    if not tenant_id:
        _fail("tenant create response", st, payload)
    _ok("tenant create", f"id={tenant_id}")

    # 5) Suspend / activate tenant
    st, payload = _request("POST", f"{base}/api/v1/admin/tenants/{urllib.parse.quote(tenant_id)}/suspend", headers=auth_headers)
    if st != 200:
        _fail("tenant suspend", st, payload)
    _ok("tenant suspend")

    st, payload = _request("POST", f"{base}/api/v1/admin/tenants/{urllib.parse.quote(tenant_id)}/activate", headers=auth_headers)
    if st != 200:
        _fail("tenant activate", st, payload)
    _ok("tenant activate")

    # 6) Finance check on default tenant
    st, payload = _request("GET", f"{base}/api/v1/finance/balances", headers=auth_headers)
    if st != 200:
        _fail("finance balances", st, payload)
    _ok("finance balances", str(payload))

    # 7) Reports status check
    st, payload = _request("GET", f"{base}/api/v1/reports/status", headers=auth_headers)
    if st != 200:
        _fail("reports status", st, payload)
    _ok("reports status", str(payload))

    # 8) Delete temporary tenant
    st, payload = _request("DELETE", f"{base}/api/v1/admin/tenants/{urllib.parse.quote(tenant_id)}", headers=auth_headers)
    if st != 200:
        _fail("tenant delete", st, payload)
    _ok("tenant delete")

    # 9) Logout
    st, payload = _request(
        "POST",
        f"{base}/api/v1/auth/logout",
        headers={"x-tenant-id": tenant_header},
        body={"refresh_token": refresh},
    )
    if st != 200:
        _fail("logout", st, payload)
    _ok("logout")

    print("\nSmoke test completed successfully.")


if __name__ == "__main__":
    main()
