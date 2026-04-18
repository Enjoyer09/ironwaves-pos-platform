"""Backfill `_cogs_snapshot` into historical sales items_json rows.

Usage examples:
  DATABASE_URL="postgresql://..." \
  python scripts/backfill_cogs_snapshot.py --dry-run

  DATABASE_URL="postgresql://..." \
  python scripts/backfill_cogs_snapshot.py --tenant-id <tenant-id> --apply
"""

from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import create_engine, text


PACKAGING_TOKENS = ("stəkan", "stakan", "qapaq", "kapak", "cup", "lid")


def _to_decimal(value, default: str = "0") -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def _to_json(value) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _build_recipe_map(conn, tenant_id: str) -> dict[str, list[tuple[str, Decimal]]]:
    rows = conn.execute(
        text(
            """
            SELECT menu_item_name, ingredient_name, quantity_required
            FROM recipes
            WHERE tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id},
    ).fetchall()
    recipe_map: dict[str, list[tuple[str, Decimal]]] = defaultdict(list)
    for row in rows:
        menu_item_name = str(row[0] or "").strip().lower()
        ingredient_name = str(row[1] or "")
        quantity_required = _to_decimal(row[2], "0")
        if menu_item_name:
            recipe_map[menu_item_name].append((ingredient_name, quantity_required))
    return recipe_map


def _build_unit_cost_map(conn, tenant_id: str) -> dict[str, Decimal]:
    rows = conn.execute(
        text(
            """
            SELECT name, unit_cost
            FROM inventory_items
            WHERE tenant_id = :tenant_id
            """
        ),
        {"tenant_id": tenant_id},
    ).fetchall()
    return {str(row[0] or "").strip().lower(): _to_decimal(row[1], "0") for row in rows}


def _remove_packaging_for_table(conn, tenant_id: str) -> bool:
    row = conn.execute(
        text(
            """
            SELECT value
            FROM settings
            WHERE tenant_id = :tenant_id AND key = 'beverage_service_settings'
            LIMIT 1
            """
        ),
        {"tenant_id": tenant_id},
    ).first()
    if not row:
        return True
    payload = _to_json(row[0])
    return bool(payload.get("remove_paper_packaging_for_table", True))


def _estimate_line_cogs(
    item: dict,
    recipe_map: dict[str, list[tuple[str, Decimal]]],
    unit_cost_map: dict[str, Decimal],
    *,
    remove_packaging_for_table: bool,
) -> tuple[Decimal, bool]:
    snapshot_value = item.get("_cogs_snapshot")
    if snapshot_value is not None:
        try:
            return _to_decimal(snapshot_value, "0").quantize(Decimal("0.0001")), bool(item.get("_cogs_estimation_unresolved", False))
        except Exception:
            return Decimal("0.0000"), True

    item_name = str(item.get("item_name") or "").strip().lower()
    qty = _to_decimal(item.get("qty"), "0")
    if qty <= 0:
        return Decimal("0.0000"), True

    recipes = recipe_map.get(item_name, [])
    if not recipes:
        return Decimal("0.0000"), True

    item_cup_mode = str(item.get("cup_mode") or "paper").strip().lower()
    skip_packaging = remove_packaging_for_table and item_cup_mode == "glass"

    line_total = Decimal("0.0000")
    unresolved = False
    for ingredient_name, quantity_required in recipes:
        ingredient_key = str(ingredient_name or "").strip().lower()
        if skip_packaging and any(token in ingredient_key for token in PACKAGING_TOKENS):
            continue
        unit_cost = unit_cost_map.get(ingredient_key)
        if unit_cost is None:
            unresolved = True
            continue
        line_total += (qty * quantity_required * unit_cost).quantize(Decimal("0.0001"))
    return line_total.quantize(Decimal("0.0001")), unresolved


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill sales items_json with _cogs_snapshot fields")
    parser.add_argument("--database-url", default=str(os.getenv("DATABASE_URL") or "").strip(), help="SQLAlchemy database URL")
    parser.add_argument("--tenant-id", default="", help="Optional tenant filter")
    parser.add_argument("--limit", type=int, default=20000, help="Max rows to scan")
    parser.add_argument("--apply", action="store_true", help="Persist updates (default is dry-run)")
    parser.add_argument("--set-cogs-when-null", action="store_true", help="Also set sales.cogs when it is NULL")
    args = parser.parse_args()

    if not args.database_url:
        print("Missing DATABASE_URL / --database-url")
        return 1

    engine = create_engine(args.database_url, future=True, pool_pre_ping=True)
    tenant_clause = "WHERE s.tenant_id = :tenant_id" if args.tenant_id else ""
    params = {"limit": max(1, int(args.limit))}
    if args.tenant_id:
        params["tenant_id"] = args.tenant_id

    scanned = 0
    changed = 0
    changed_cogs = 0
    unresolved_lines = 0
    estimated_total = Decimal("0.0000")

    with engine.begin() as conn:
        sales_rows = conn.execute(
            text(
                f"""
                SELECT s.id, s.tenant_id, s.items_json, s.cogs
                FROM sales s
                {tenant_clause}
                ORDER BY s.created_at DESC
                LIMIT :limit
                """
            ),
            params,
        ).fetchall()

        recipe_cache: dict[str, dict[str, list[tuple[str, Decimal]]]] = {}
        unit_cost_cache: dict[str, dict[str, Decimal]] = {}
        packaging_cache: dict[str, bool] = {}

        for sale_id, tenant_id, items_json_raw, cogs_raw in sales_rows:
            scanned += 1
            tenant_key = str(tenant_id)
            if tenant_key not in recipe_cache:
                recipe_cache[tenant_key] = _build_recipe_map(conn, tenant_key)
                unit_cost_cache[tenant_key] = _build_unit_cost_map(conn, tenant_key)
                packaging_cache[tenant_key] = _remove_packaging_for_table(conn, tenant_key)

            recipe_map = recipe_cache[tenant_key]
            unit_cost_map = unit_cost_cache[tenant_key]
            remove_packaging_for_table = packaging_cache[tenant_key]

            try:
                items = json.loads(items_json_raw or "[]")
            except Exception:
                continue
            if not isinstance(items, list):
                continue

            row_changed = False
            row_unresolved = 0
            row_total = Decimal("0.0000")
            next_items: list[dict] = []
            for raw_item in items:
                item = dict(raw_item or {})
                line_total, line_unresolved = _estimate_line_cogs(
                    item,
                    recipe_map,
                    unit_cost_map,
                    remove_packaging_for_table=remove_packaging_for_table,
                )
                row_total += line_total
                if line_unresolved:
                    row_unresolved += 1
                if "_cogs_snapshot" not in item:
                    item["_cogs_snapshot"] = str(line_total.quantize(Decimal("0.0001")))
                    row_changed = True
                if "_cogs_estimation_unresolved" not in item:
                    item["_cogs_estimation_unresolved"] = bool(line_unresolved)
                    row_changed = True
                next_items.append(item)

            if not row_changed and not (args.set_cogs_when_null and cogs_raw is None):
                continue

            estimated_total += row_total
            unresolved_lines += row_unresolved
            changed += 1

            if args.apply:
                payload = json.dumps(next_items, ensure_ascii=False)
                if args.set_cogs_when_null and cogs_raw is None:
                    conn.execute(
                        text("UPDATE sales SET items_json = :items_json, cogs = :cogs WHERE id = :sale_id"),
                        {"items_json": payload, "cogs": str(row_total.quantize(Decimal("0.0001"))), "sale_id": sale_id},
                    )
                    changed_cogs += 1
                else:
                    conn.execute(
                        text("UPDATE sales SET items_json = :items_json WHERE id = :sale_id"),
                        {"items_json": payload, "sale_id": sale_id},
                    )

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] scanned={scanned} changed={changed} changed_cogs={changed_cogs}")
    print(f"[{mode}] estimated_total={estimated_total.quantize(Decimal('0.0001'))} unresolved_lines={unresolved_lines}")
    if not args.apply:
        print("No DB updates were written. Re-run with --apply to persist.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

