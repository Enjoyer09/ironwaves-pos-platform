from __future__ import annotations

from datetime import datetime
from decimal import Decimal
import json
import re
import secrets
import unicodedata

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
    # Delete existing rows and commit immediately so INSERT doesn't hit
    # duplicate key errors (PostgreSQL enforces PK even within same txn).
    db.query(model).filter(model.tenant_id == tenant_id).delete(synchronize_session=False)
    db.commit()
    restored_count = 0
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            reject_row("Sətir obyekt deyil", idx, row)
            continue
        if getattr(model, "__tablename__", "") == "customers":
            token_val = row.get("secret_token")
            if token_val in (None, ""):
                row = dict(row)
                row["secret_token"] = secrets.token_hex(16)
        instance = model()
        for column in model.__table__.columns:
            key = column.name
            if key == "tenant_id":
                setattr(instance, key, tenant_id)
                continue
            # Skip primary key ID from backup to avoid conflicts with other tenants.
            # Let PostgreSQL generate a new ID via sequence/default.
            if key == "id" and column.primary_key:
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
        items_json = _normalize_sale_items_json(items)
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


def _normalize_sale_items_json(raw_items) -> str:
    if raw_items in (None, ""):
        return "[]"
    if isinstance(raw_items, list):
        return json.dumps(raw_items, ensure_ascii=False)
    if isinstance(raw_items, dict):
        return json.dumps([raw_items], ensure_ascii=False)
    if isinstance(raw_items, str):
        text = raw_items.strip()
        if not text:
            return "[]"
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return json.dumps(parsed, ensure_ascii=False)
            if isinstance(parsed, dict):
                return json.dumps([parsed], ensure_ascii=False)
            return json.dumps([{"name": str(parsed)}], ensure_ascii=False)
        except Exception:
            # Legacy backup-larda items çox vaxt "Americano, Su" kimi plain text olur
            # və model isə JSON list gözləyir.
            parts = [part.strip() for part in text.split(",") if part and part.strip()]
            payload = [{"name": part, "qty": 1} for part in parts] if parts else [{"name": text, "qty": 1}]
            return json.dumps(payload, ensure_ascii=False)
    return json.dumps([{"name": str(raw_items), "qty": 1}], ensure_ascii=False)


def _normalize_name_for_match(value: str | None) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


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


def _is_blank(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    return False


def _is_nonnegative_number(value) -> bool:
    try:
        return Decimal(str(value)) >= 0
    except Exception:
        return False


def _json_field_is_valid(value, *, expected_kind: str = "list") -> bool:
    if value in (None, ""):
        return False
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except Exception:
        return False
    if expected_kind == "list":
        return isinstance(parsed, list)
    if expected_kind == "dict":
        return isinstance(parsed, dict)
    return parsed is not None


def _row_quality_issues(row, spec: dict) -> list[str]:
    issues: list[str] = []
    for field in spec.get("required_fields", []):
        if _is_blank(getattr(row, field, None)):
            issues.append(f"{field} boşdur")
    for field in spec.get("nonnegative_fields", []):
        if not _is_nonnegative_number(getattr(row, field, None)):
            issues.append(f"{field} mənfi və ya etibarsızdır")
    for field, expected_kind in spec.get("json_fields", {}).items():
        value = getattr(row, field, None)
        if value in (None, ""):
            continue
        if not _json_field_is_valid(value, expected_kind=expected_kind):
            issues.append(f"{field} etibarlı JSON {expected_kind} deyil")
    for field, allowed_values in spec.get("allowed_values", {}).items():
        value = getattr(row, field, None)
        if value not in allowed_values:
            issues.append(f"{field} dəyəri etibarsızdır: {value}")
    return issues


def verify_restored_tables(
    db: Session,
    *,
    tenant_id: str,
    expected_counts: dict[str, int],
    verification_models: dict[str, object],
    validation_specs: dict[str, dict] | None = None,
) -> tuple[dict[str, dict[str, int | bool]], list[str], bool]:
    verification: dict[str, dict[str, int | bool]] = {}
    warnings: list[str] = []
    success = True
    validation_specs = validation_specs or {}
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
            continue

        spec = validation_specs.get(table_key)
        if not spec:
            continue

        invalid_rows = 0
        invalid_samples: list[dict[str, object]] = []
        rows = db.query(model).filter(model.tenant_id == tenant_id).all()
        for row in rows:
            issues = _row_quality_issues(row, spec)
            if not issues:
                continue
            invalid_rows += 1
            if len(invalid_samples) < 5:
                invalid_samples.append(
                    {
                        "id": str(getattr(row, "id", "")),
                        "issues": issues,
                    }
                )

        verification[table_key]["invalid_rows"] = invalid_rows
        verification[table_key]["quality_ok"] = invalid_rows == 0
        if invalid_samples:
            verification[table_key]["invalid_samples"] = invalid_samples
        if invalid_rows:
            success = False
            warnings.append(f"'{table_key}' cədvəlində {invalid_rows} sətr struktur yoxlamasından keçmədi.")
    return verification, warnings, success


def verify_restore_dependencies(
    db: Session,
    *,
    tenant_id: str,
    verification_models: dict[str, object],
    restored_tables: set[str] | list[str],
) -> tuple[dict[str, dict[str, int | bool]], list[str], bool]:
    restored = set(restored_tables or [])
    dependency_report: dict[str, dict[str, int | bool]] = {}
    warnings: list[str] = []
    success = True

    sales_model = verification_models.get("sales")
    kitchen_model = verification_models.get("kitchen_orders")
    if sales_model is not None and kitchen_model is not None and ({"sales", "kitchen_orders"} & restored):
        sale_ids = {
            str(row[0])
            for row in db.query(sales_model.id).filter(sales_model.tenant_id == tenant_id).all()
            if row and row[0]
        }
        kitchen_rows = (
            db.query(kitchen_model.id, kitchen_model.sale_id)
            .filter(kitchen_model.tenant_id == tenant_id, kitchen_model.sale_id.isnot(None))
            .all()
        )
        missing_count = 0
        samples: list[str] = []
        for row_id, sale_id in kitchen_rows:
            if str(sale_id) in sale_ids:
                continue
            missing_count += 1
            if len(samples) < 5:
                samples.append(str(row_id))
        dependency_report["kitchen_orders.sale_id -> sales.id"] = {
            "ok": missing_count == 0,
            "missing_refs": missing_count,
        }
        if samples:
            dependency_report["kitchen_orders.sale_id -> sales.id"]["sample_order_ids"] = samples
        if missing_count:
            success = False
            warnings.append(f"Mətbəx sifarişlərində {missing_count} ədəd `sale_id` satış cədvəlində tapılmadı.")

    recipe_model = verification_models.get("recipes")
    menu_model = verification_models.get("menu_items") or verification_models.get("menu")
    if recipe_model is not None and menu_model is not None and ({"recipes", "menu_items", "menu"} & restored):
        menu_names = {
            _normalize_name_for_match(row[0])
            for row in db.query(menu_model.item_name).filter(menu_model.tenant_id == tenant_id).all()
            if row and row[0]
        }
        recipe_rows = (
            db.query(recipe_model.id, recipe_model.menu_item_name)
            .filter(recipe_model.tenant_id == tenant_id)
            .all()
        )
        missing_count = 0
        samples: list[str] = []
        for row_id, menu_item_name in recipe_rows:
            key = _normalize_name_for_match(menu_item_name)
            if not key or key in menu_names:
                continue
            missing_count += 1
            if len(samples) < 5:
                samples.append(str(row_id))
        dependency_report["recipes.menu_item_name -> menu_items.item_name"] = {
            "ok": missing_count == 0,
            "missing_refs": missing_count,
        }
        if samples:
            dependency_report["recipes.menu_item_name -> menu_items.item_name"]["sample_recipe_ids"] = samples
        if missing_count:
            warnings.append(
                f"Resept cədvəlində {missing_count} ədəd `menu_item_name` menyuda tapılmadı "
                "(ad dəyişiklikləri/silinmiş məhsullar ola bilər)."
            )

    customer_model = verification_models.get("customers")
    if sales_model is not None and customer_model is not None and ({"sales", "customers"} & restored):
        customer_cards = {
            str(row[0]).strip()
            for row in db.query(customer_model.card_id).filter(customer_model.tenant_id == tenant_id).all()
            if row and row[0]
        }
        sales_rows = (
            db.query(sales_model.id, sales_model.customer_card_id)
            .filter(sales_model.tenant_id == tenant_id, sales_model.customer_card_id.isnot(None))
            .all()
        )
        missing_count = 0
        samples: list[str] = []
        for row_id, card_id in sales_rows:
            key = str(card_id or "").strip()
            if not key or key in customer_cards:
                continue
            missing_count += 1
            if len(samples) < 5:
                samples.append(str(row_id))
        dependency_report["sales.customer_card_id -> customers.card_id"] = {
            "ok": missing_count == 0,
            "missing_refs": missing_count,
        }
        if samples:
            dependency_report["sales.customer_card_id -> customers.card_id"]["sample_sale_ids"] = samples
        if missing_count and "customers" in restored:
            success = False
            warnings.append(f"Satışlarda {missing_count} ədəd `customer_card_id` müştəri cədvəlində tapılmadı.")
        elif missing_count:
            warnings.append(f"Satışlarda {missing_count} ədəd `customer_card_id` var, amma bu restore-da müştəri cədvəli seçilməyib.")

    table_model = verification_models.get("tables")
    user_model = verification_models.get("users")
    if table_model is not None and user_model is not None and ({"tables", "users"} & restored):
        usernames = {
            str(row[0]).strip()
            for row in db.query(user_model.username).filter(user_model.tenant_id == tenant_id).all()
            if row and row[0]
        }
        table_rows = (
            db.query(table_model.id, table_model.assigned_to)
            .filter(table_model.tenant_id == tenant_id, table_model.assigned_to.isnot(None))
            .all()
        )
        missing_count = 0
        samples: list[str] = []
        for row_id, assigned_to in table_rows:
            key = str(assigned_to or "").strip()
            if not key or key in usernames:
                continue
            missing_count += 1
            if len(samples) < 5:
                samples.append(str(row_id))
        dependency_report["tables.assigned_to -> users.username"] = {
            "ok": missing_count == 0,
            "missing_refs": missing_count,
        }
        if samples:
            dependency_report["tables.assigned_to -> users.username"]["sample_table_ids"] = samples
        if missing_count:
            success = False
            warnings.append(f"Masalarda {missing_count} ədəd `assigned_to` istifadəçi cədvəlində tapılmadı.")

    if kitchen_model is not None and table_model is not None and ({"kitchen_orders", "tables"} & restored):
        table_labels = {
            str(row[0]).strip()
            for row in db.query(table_model.label).filter(table_model.tenant_id == tenant_id).all()
            if row and row[0]
        }
        kitchen_rows = (
            db.query(kitchen_model.id, kitchen_model.table_label)
            .filter(kitchen_model.tenant_id == tenant_id, kitchen_model.table_label.isnot(None))
            .all()
        )
        missing_count = 0
        samples: list[str] = []
        for row_id, table_label in kitchen_rows:
            key = str(table_label or "").strip()
            if not key or key in table_labels:
                continue
            missing_count += 1
            if len(samples) < 5:
                samples.append(str(row_id))
        dependency_report["kitchen_orders.table_label -> tables.label"] = {
            "ok": missing_count == 0,
            "missing_refs": missing_count,
        }
        if samples:
            dependency_report["kitchen_orders.table_label -> tables.label"]["sample_order_ids"] = samples
        if missing_count and "tables" in restored:
            success = False
            warnings.append(f"Mətbəx sifarişlərində {missing_count} ədəd `table_label` masalar cədvəlində tapılmadı.")
        elif missing_count:
            warnings.append(f"Mətbəx sifarişlərində {missing_count} ədəd `table_label` var, amma bu restore-da masalar seçilməyib.")

    return dependency_report, warnings, success
