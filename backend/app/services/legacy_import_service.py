from __future__ import annotations

from datetime import datetime
from decimal import Decimal
import json
import secrets

from sqlalchemy.orm import Session

from app.models import BusinessProfile, FinanceEntry, KitchenOrder, Sale, Setting, User


def normalize_restore_finance_source(value: str | None) -> str:
    source = str(value or "").strip().lower()
    if source in {"cash", "kassa", "nağd", "negd", "nəğd"}:
        return "cash"
    if source in {"card", "bank", "bank kartı", "kart"}:
        return "card"
    if source in {"safe", "seyf"}:
        return "safe"
    if source in {"debt", "borc", "nisye", "nisyə"}:
        return "debt"
    if source in {"investor", "tesisci", "təsisçi"}:
        return "investor"
    if source in {"deposit", "depozit"}:
        return "deposit"
    return source or "cash"


def has_legacy_investor_context(*values: str | None) -> bool:
    haystack = " ".join(str(value or "").strip().lower() for value in values)
    return any(token in haystack for token in {"investor", "təsisçi", "tesisci", "founder"})


def is_restore_investor_liability_reduction(category: str | None, source: str | None) -> bool:
    normalized_category = str(category or "").strip().lower()
    normalized_source = str(source or "").strip().lower()
    return normalized_source == "investor" and any(
        token in normalized_category
        for token in {"investor borcu azaldılması", "investor liability reduction", "dolg investoru umenshen"}
    )


def restore_legacy_finance_rows(
    db: Session,
    *,
    tenant_id: str,
    rows: list,
    default_username: str,
    parse_dt,
    parse_decimal,
    reject_row,
) -> int:
    restored_count = 0
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            reject_row("Maliyyə sətri obyekt deyil", idx, row)
            continue
        category = str(row.get("category") or "Digər").strip() or "Digər"
        description = str(row.get("description") or row.get("reason") or "").strip()
        subject = str(row.get("subject") or "").strip()
        if subject and subject.lower() not in description.lower():
            description = f"{subject} | {description}".strip(" |")
        created_at = parse_dt(row.get("created_at")) or datetime.utcnow()
        created_by = str(row.get("created_by") or row.get("spender") or default_username or "restore")
        normalized_source = normalize_restore_finance_source(row.get("source"))
        tx_type = str(row.get("type") or "in").strip().lower() or "in"
        investor_context = has_legacy_investor_context(
            row.get("source"),
            row.get("subject"),
            row.get("description"),
            row.get("reason"),
            category,
        )
        liability_reduction = is_restore_investor_liability_reduction(category, normalized_source)
        stored_source = normalized_source
        if tx_type == "out" and normalized_source == "investor" and investor_context and not liability_reduction:
            stored_source = "legacy_investor_expense"
        amount = parse_decimal(row.get("amount"), "0.00")
        db.add(
            FinanceEntry(
                id=str(row.get("id") or secrets.token_hex(16)),
                tenant_id=tenant_id,
                type=tx_type,
                category=category,
                source=stored_source,
                amount=amount,
                description=description or None,
                created_by=created_by,
                created_at=created_at,
            )
        )
        restored_count += 1
        should_create_liability_mirror = investor_context and not liability_reduction and (
            (tx_type == "in" and stored_source in {"cash", "card", "safe", "debt", "deposit"})
            or (tx_type == "out" and normalized_source == "investor")
        )
        if should_create_liability_mirror:
            db.add(
                FinanceEntry(
                    id=secrets.token_hex(16),
                    tenant_id=tenant_id,
                    type="in",
                    category="İnvestor Borcu",
                    source="investor",
                    amount=amount,
                    description=(f"Legacy restore mirror: {description}" if description else "Legacy restore mirror"),
                    created_by=created_by,
                    created_at=created_at,
                )
            )
            restored_count += 1
    return restored_count


def restore_generic_model_rows(
    db: Session,
    *,
    model,
    tenant_id: str,
    rows,
    parse_dt,
    parse_decimal,
    reject_row,
) -> int:
    if not isinstance(rows, list):
        return 0
    db.query(model).filter(model.tenant_id == tenant_id).delete(synchronize_session=False)
    restored_count = 0
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            reject_row("Sətir obyekt deyil", idx, row)
            continue
        instance = model()
        for column in model.__table__.columns:
            key = column.name
            if key == "tenant_id":
                setattr(instance, key, tenant_id)
                continue
            if key not in row:
                continue
            value = row.get(key)
            if value in (None, ""):
                if column.nullable:
                    setattr(instance, key, None)
                continue
            try:
                python_type = getattr(column.type, "python_type", None)
            except Exception:
                python_type = None
            if python_type is datetime:
                setattr(instance, key, parse_dt(value))
            elif python_type is Decimal:
                setattr(instance, key, parse_decimal(value))
            elif python_type is int:
                setattr(instance, key, int(value))
            elif python_type is bool:
                setattr(instance, key, str(value).lower() in {"1", "true", "yes", "on"})
            elif python_type is str:
                setattr(instance, key, str(value))
            else:
                setattr(instance, key, value)
        db.add(instance)
        restored_count += 1
    return restored_count


def restore_settings_rows(
    db: Session,
    *,
    tenant_id: str,
    rows,
) -> int:
    if not isinstance(rows, list):
        return 0
    db.query(Setting).filter(Setting.tenant_id == tenant_id).delete(synchronize_session=False)
    restored_count = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        if not row.get("key"):
            continue
        db.add(Setting(tenant_id=tenant_id, key=row["key"], value=row["value"]))
        restored_count += 1
    return restored_count


def restore_user_rows(
    db: Session,
    *,
    tenant_id: str,
    rows,
    default_username: str,
    normalize_role,
    normalize_password_hash,
    hash_password,
    parse_dt,
    reject_row,
) -> tuple[int, bool]:
    if not isinstance(rows, list):
        return 0, False
    db.query(User).filter(User.tenant_id == tenant_id).delete(synchronize_session=False)
    restored_count = 0
    missing_password_warning = False
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            reject_row("İstifadəçi sətri obyekt deyil", idx, row)
            continue
        username = str(row.get("username") or "").strip()
        password_hash = normalize_password_hash(row.get("password_hash") or row.get("password"))
        if not username:
            reject_row("username boşdur", idx, row)
            continue
        if not password_hash:
            password_hash = hash_password(secrets.token_urlsafe(32))
            missing_password_warning = True
        user_kwargs = {
            "tenant_id": tenant_id,
            "username": username,
            "email": str(row.get("email") or "").strip() or None,
            "password_hash": password_hash,
            "pin_hash": None,
            "totp_secret": None,
            "totp_enabled": False,
            "role": normalize_role(row.get("role")),
            "is_active": not str(row.get("is_active", True)).lower() in {"0", "false", "no", "off"},
            "failed_attempts": 0,
            "locked_until": None,
            "created_at": parse_dt(row.get("created_at")) or datetime.utcnow(),
        }
        legacy_id = str(row.get("id") or "").strip()
        if legacy_id:
            user_kwargs["id"] = legacy_id
        db.add(User(**user_kwargs))
        restored_count += 1
    return restored_count, missing_password_warning


def restore_business_profile_rows(
    db: Session,
    *,
    tenant_id: str,
    rows,
    reject_row,
) -> int:
    if not isinstance(rows, list):
        return 0
    db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant_id).delete(synchronize_session=False)
    restored_count = 0
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            reject_row("Profil sətri obyekt deyil", idx, row)
            continue
        company_name = str(row.get("company_name") or "").strip()
        if not company_name:
            reject_row("company_name boşdur", idx, row)
            continue
        db.add(
            BusinessProfile(
                tenant_id=tenant_id,
                company_name=company_name,
                phone=str(row.get("phone") or "").strip() or None,
                address=str(row.get("address") or "").strip() or None,
                website=str(row.get("website") or "").strip() or None,
                logo_url=str(row.get("logo_url") or "").strip() or None,
                receipt_footer=str(row.get("receipt_footer") or "").strip() or None,
            )
        )
        restored_count += 1
    return restored_count


def restore_sales_rows(
    db: Session,
    *,
    tenant_id: str,
    rows,
    default_cashier: str,
    parse_dt,
    parse_decimal,
    reject_row,
) -> int:
    if not isinstance(rows, list):
        return 0
    db.query(Sale).filter(Sale.tenant_id == tenant_id).delete(synchronize_session=False)
    restored_count = 0
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            reject_row("Satış sətri obyekt deyil", idx, row)
            continue
        items = row.get("items_json")
        if items is None:
            items = row.get("items") or []
        items_json = items if isinstance(items, str) else json.dumps(items, ensure_ascii=False)
        cashier = str(row.get("cashier") or default_cashier or "staff").strip()
        db.add(
            Sale(
                id=str(row.get("id") or secrets.token_hex(16)),
                tenant_id=tenant_id,
                cashier=cashier,
                customer_card_id=str(row.get("customer_card_id") or "").strip() or None,
                payment_method=str(row.get("payment_method") or "Nəğd"),
                order_type=str(row.get("order_type") or "").strip() or None,
                offline_request_id=str(row.get("offline_request_id") or "").strip() or None,
                receipt_code=str(row.get("receipt_code") or "").strip() or None,
                receipt_token=str(row.get("receipt_token") or "").strip() or None,
                reward_claim_code=str(row.get("reward_claim_code") or "").strip() or None,
                total=parse_decimal(row.get("total"), "0.00"),
                discount_amount=parse_decimal(row.get("discount_amount"), "0.00"),
                cogs=parse_decimal(row.get("cogs"), "0.0000"),
                items_json=items_json,
                status=str(row.get("status") or "COMPLETED"),
                created_at=parse_dt(row.get("created_at")) or datetime.utcnow(),
            )
        )
        restored_count += 1
    return restored_count


def restore_kitchen_order_rows(
    db: Session,
    *,
    tenant_id: str,
    rows,
    parse_dt,
    reject_row,
) -> int:
    if not isinstance(rows, list):
        return 0
    db.query(KitchenOrder).filter(KitchenOrder.tenant_id == tenant_id).delete(synchronize_session=False)
    restored_count = 0
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            reject_row("Mətbəx sifarişi sətri obyekt deyil", idx, row)
            continue
        items = row.get("items_json")
        if items is None:
            items = row.get("items") or []
        items_json = items if isinstance(items, str) else json.dumps(items, ensure_ascii=False)
        db.add(
            KitchenOrder(
                id=str(row.get("id") or secrets.token_hex(16)),
                tenant_id=tenant_id,
                sale_id=str(row.get("sale_id") or "").strip() or None,
                table_label=str(row.get("table_label") or "").strip() or None,
                order_type=str(row.get("order_type") or "").strip() or None,
                status=str(row.get("status") or "NEW"),
                priority=str(row.get("priority") or "NORMAL"),
                items_json=items_json,
                created_at=parse_dt(row.get("created_at")) or datetime.utcnow(),
                completed_at=parse_dt(row.get("completed_at")),
            )
        )
        restored_count += 1
    return restored_count


def build_restore_handler_registry(
    *,
    generic_table_map: dict[str, object],
    restore_users,
    restore_settings,
    restore_business_profile,
    restore_sales,
    restore_finance,
    restore_kitchen_orders,
) -> dict[str, object]:
    registry = {table: restore_users for table in ("users",)}
    registry.update({table: restore_settings for table in ("settings",)})
    registry.update({table: restore_business_profile for table in ("business_profile",)})
    registry.update({table: restore_sales for table in ("sales",)})
    registry.update({table: restore_finance for table in ("finance",)})
    registry.update({table: restore_kitchen_orders for table in ("kitchen_orders",)})
    registry.update({table: ("generic", model) for table, model in generic_table_map.items()})
    return registry


def verify_restored_tables(
    db: Session,
    *,
    tenant_id: str,
    expected_counts: dict[str, int],
    verification_models: dict[str, object],
) -> tuple[dict[str, dict[str, int | bool]], list[str], bool]:
    verification: dict[str, dict[str, int | bool]] = {}
    warnings: list[str] = []
    success = True
    db.flush()
    for table_key, expected in expected_counts.items():
        model = verification_models.get(table_key)
        if model is None:
            continue
        actual = db.query(model).filter(model.tenant_id == tenant_id).count()
        ok = actual >= expected
        verification[table_key] = {
            "expected": int(expected),
            "actual": int(actual),
            "ok": ok,
        }
        if not ok:
            success = False
            warnings.append(f"'{table_key}' bərpa yoxlaması uğursuz oldu: gözlənilən {expected}, bazada {actual}.")
    return verification, warnings, success
