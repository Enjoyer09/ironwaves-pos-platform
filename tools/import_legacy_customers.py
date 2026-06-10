#!/usr/bin/env python3
"""
Import legacy customers from old iRonWaves POS backup JSON into the new system.

Usage:
  python3 tools/import_legacy_customers.py <backup.json> <tenant_domain>

Example:
  python3 tools/import_legacy_customers.py Emalatkhana_Backup_30_05_2026_12_05.json emalatxana.ironwaves.store

This script:
1. Reads the backup JSON
2. Extracts customers with card_id and secret_token
3. POSTs them to the backend /api/v1/ops/import-legacy-customers endpoint
4. Reports success/failure for each customer

Requirements:
- Backend must be running
- You must have an admin access token (will prompt or use env var IW_ACCESS_TOKEN)
"""

import json
import os
import sys
import requests

BACKEND_URL = os.environ.get("IW_BACKEND_URL", "https://super.ironwaves.store")
ACCESS_TOKEN = os.environ.get("IW_ACCESS_TOKEN", "")


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 tools/import_legacy_customers.py <backup.json> <tenant_domain>")
        print("Example: python3 tools/import_legacy_customers.py backup.json emalatxana.ironwaves.store")
        sys.exit(1)

    backup_path = sys.argv[1]
    tenant_domain = sys.argv[2]
    token = ACCESS_TOKEN

    if not token:
        token = input("Admin access token: ").strip()
    if not token:
        print("ERROR: Access token required")
        sys.exit(1)

    # Read backup
    print(f"Reading {backup_path}...")
    with open(backup_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    customers = data.get("customers", [])
    if not customers:
        print("No customers found in backup.")
        sys.exit(0)

    print(f"Found {len(customers)} customers to import.")

    # Map type to discount_percent
    type_discount_map = {
        "golden": 5,
        "platinum": 10,
        "tələbə": 15,
        "telebe": 15,
        "elite": 20,
        "thermos": 20,
        "ikram": 100,
        "vip": 15,
        "silver": 5,
        "normal": 0,
    }

    # Prepare payload
    import_payload = []
    for c in customers:
        card_id = str(c.get("card_id", "")).strip()
        secret_token = str(c.get("secret_token", "")).strip()
        if not card_id or not secret_token:
            print(f"  SKIP: missing card_id or token: {c}")
            continue

        customer_type = str(c.get("type", "Normal")).strip()
        discount = type_discount_map.get(customer_type.lower(), 0)

        import_payload.append({
            "card_id": card_id,
            "secret_token": secret_token,
            "type": customer_type.capitalize() if customer_type.lower() != "golden" else "Golden",
            "stars": int(c.get("stars", 0)),
            "discount_percent": discount,
            "email": str(c.get("email", "") or "").strip(),
            "birth_date": c.get("birth_date"),
            "balance": float(c.get("balance", 0)),
            "is_active": bool(c.get("is_active", True)),
            "staff_note": c.get("staff_note"),
            "created_at": c.get("created_at") or c.get("activated_at") or c.get("last_visit"),
        })

    print(f"Prepared {len(import_payload)} customers for import.")
    print(f"Target: {BACKEND_URL} (domain: {tenant_domain})")
    print()

    confirm = input("Proceed with import? (yes/no): ").strip().lower()
    if confirm != "yes":
        print("Aborted.")
        sys.exit(0)

    # Send to backend
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "x-tenant-domain": tenant_domain,
    }

    response = requests.post(
        f"{BACKEND_URL}/api/v1/ops/import-legacy-customers",
        headers=headers,
        json={"customers": import_payload},
        timeout=30,
    )

    if response.status_code == 200:
        result = response.json()
        print(f"\nSUCCESS: {result.get('imported', 0)} imported, {result.get('skipped', 0)} skipped (already exist)")
    else:
        print(f"\nERROR {response.status_code}: {response.text}")
        sys.exit(1)


if __name__ == "__main__":
    main()
