"""Finance v2 WP-A: per-tenant settings (ui visibility, supplier requirement), dual history and reconcile selection."""
from __future__ import annotations

import json
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import bridge
from app.gl import engine as gl
from app.gl import shadow
from app.gl.engine import GLError
from app.gl.legacy_migration import migrate_tenant, reconcile_for_tenant
from app.gl.models import GLAuditEvent, GLLegacyLink
from app.models import Sale, Setting, Tenant
from app.services import finance_service as fs

D = Decimal
UI_KEY = "finance_v2_ui_visible"
SUPPLIER_KEY = "finance_v2_require_supplier"


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", future=True)

    @event.listens_for(engine, "connect")
    def _connect(dbapi_conn, _):
        dbapi_conn.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    yield session
    session.close()
    engine.dispose()


def _tenant(db, *, chart=True) -> str:
    tid = str(uuid.uuid4())
    db.add(Tenant(id=tid, name="T", slug=f"s-{tid[:8]}", domain=f"{tid[:8]}.test", status="active"))
    db.flush()
    if chart:
        gl.ensure_chart(db, tid)
    db.commit()
    return tid


def _legacy_sale(db, tid, amount="10.00"):
    fs.post_finance_transaction(db, tenant_id=tid, transaction_type="income", amount=D(amount), source_code="revenue",
                                destination_code="cash", created_by="k", category="Satış (Nağd)", related_order_id=str(uuid.uuid4()))
    db.commit()


def _native_sale(db, tid, amount="20.00"):
    sale = Sale(id=str(uuid.uuid4()), tenant_id=tid, cashier="k", payment_method="Nağd", total=D(amount), discount_amount=D("0"),
                cogs=D("0"), items_json="[]", status="COMPLETED")
    db.add(sale)
    db.flush()
    fs.post_sale_payment(db, tenant_id=tid, sale_id=sale.id, amount=D(amount), payment_source="cash", created_by="k")
    bridge.emit_sale(db, tid, sale=sale, payments=[("cash", D(amount))], actor="k")
    db.commit()


def _events(db, tid, event_type):
    return [json.loads(e.payload) for e in db.query(GLAuditEvent).filter(GLAuditEvent.tenant_id == tid, GLAuditEvent.event_type == event_type).order_by(GLAuditEvent.seq)]


# ───────────────────────────── defaults and round trips ─────────────────────────────


def test_defaults_are_hidden_and_not_required_and_unrecorded(db):
    tid = _tenant(db)
    assert bridge.is_ui_visible(db, tid) is False and bridge.get_ui_visible_record(db, tid) is None
    assert bridge.require_supplier(db, tid) is False and bridge.get_require_supplier_record(db, tid) is None


@pytest.mark.parametrize("getter,setter,reader,field", [
    ("is_ui_visible", "set_ui_visible", "get_ui_visible_record", "visible"),
    ("require_supplier", "set_require_supplier", "get_require_supplier_record", "required"),
])
def test_round_trip_overwrites_the_same_row(db, getter, setter, reader, field):
    tid = _tenant(db)
    key = UI_KEY if field == "visible" else SUPPLIER_KEY
    first = getattr(bridge, setter)(db, tid, True, actor="cli", reason="on")
    assert first == {"tenant_id": tid, "from": None, "to": True}
    assert getattr(bridge, getter)(db, tid) is True
    second = getattr(bridge, setter)(db, tid, False, actor="cli", reason="off")
    assert second == {"tenant_id": tid, "from": True, "to": False}
    assert getattr(bridge, getter)(db, tid) is False
    record = getattr(bridge, reader)(db, tid)
    assert record[field] is False and record["by"] == "cli" and record["since"]  # recorded as False, not absent
    assert db.query(Setting).filter(Setting.tenant_id == tid, Setting.key == key).count() == 1


def test_settings_are_per_tenant(db):
    a, b = _tenant(db), _tenant(db)
    bridge.set_ui_visible(db, a, True, actor="cli", reason="x")
    bridge.set_require_supplier(db, a, True, actor="cli", reason="x")
    assert bridge.is_ui_visible(db, b) is False and bridge.require_supplier(db, b) is False


@pytest.mark.parametrize("setter", ["set_ui_visible", "set_require_supplier"])
@pytest.mark.parametrize("reason", ["", "   ", None])
def test_a_reason_is_required_and_nothing_is_written(db, setter, reason):
    tid = _tenant(db)
    with pytest.raises(GLError) as exc:
        getattr(bridge, setter)(db, tid, True, actor="cli", reason=reason)
    assert exc.value.code == "reason_required"
    assert db.query(Setting).filter(Setting.tenant_id == tid, Setting.key.in_([UI_KEY, SUPPLIER_KEY])).count() == 0


def test_changes_are_audited_in_the_hash_chain(db):
    tid = _tenant(db)
    bridge.set_ui_visible(db, tid, True, actor="cli", reason="pilot")
    bridge.set_ui_visible(db, tid, False, actor="cli", reason="undo")
    bridge.set_require_supplier(db, tid, True, actor="cli", reason="policy")
    db.commit()
    assert _events(db, tid, "UI_VISIBILITY_CHANGED") == [{"from": None, "to": True, "reason": "pilot"}, {"from": True, "to": False, "reason": "undo"}]
    assert _events(db, tid, "REQUIRE_SUPPLIER_CHANGED") == [{"from": None, "to": True, "reason": "policy"}]
    assert gl.verify_audit_chain(db, tid)["valid"] is True


def test_setters_do_not_need_a_chart(db):
    tid = _tenant(db, chart=False)
    bridge.set_ui_visible(db, tid, False, actor="cli", reason="x")
    bridge.set_require_supplier(db, tid, False, actor="cli", reason="x")
    db.commit()
    assert bridge.get_ui_visible_record(db, tid) is not None and bridge.get_require_supplier_record(db, tid) is not None
    assert gl.verify_audit_chain(db, tid)["valid"] is True


@pytest.mark.parametrize("raw", ["", "not json", "[]", "null", "5", '"visible"', "{}", '{"visible": "true"}', '{"visible": 1}', '{"visible": null}'])
def test_malformed_or_non_boolean_values_read_as_the_default(db, raw):
    tid = _tenant(db)
    db.add(Setting(tenant_id=tid, key=UI_KEY, value=raw))
    db.add(Setting(tenant_id=tid, key=SUPPLIER_KEY, value=raw.replace("visible", "required")))
    db.commit()
    assert bridge.is_ui_visible(db, tid) is False and bridge.get_ui_visible_record(db, tid) is None
    assert bridge.require_supplier(db, tid) is False and bridge.get_require_supplier_record(db, tid) is None


def test_null_value_column_reads_as_the_default(db):
    tid = _tenant(db)
    db.add(Setting(tenant_id=tid, key=UI_KEY, value=None))
    db.commit()
    assert bridge.is_ui_visible(db, tid) is False


def test_a_malformed_row_can_be_repaired_by_the_setter(db):
    tid = _tenant(db)
    db.add(Setting(tenant_id=tid, key=UI_KEY, value="garbage"))
    db.commit()
    assert bridge.set_ui_visible(db, tid, True, actor="cli", reason="fix")["from"] is None
    assert bridge.is_ui_visible(db, tid) is True


# ───────────────────────────── dual history and native journals ─────────────────────────────


def test_history_is_false_for_fresh_and_for_shadow_only_tenants(db):
    fresh = _tenant(db, chart=False)
    shadow_only = _tenant(db)
    _legacy_sale(db, shadow_only)
    shadow.sync_tenant(db, shadow_only)
    assert bridge.had_dual_history(db, fresh) is False
    assert bridge.had_dual_history(db, shadow_only) is False
    assert bridge.native_journal_count(db, shadow_only) == 0  # mirrors are not native


def test_history_is_true_while_dual(db):
    tid = _tenant(db)
    db.add(Setting(tenant_id=tid, key=bridge.MODE_SETTING_KEY, value=json.dumps({"mode": "dual"})))  # raw row, no audit event
    db.commit()
    assert bridge.had_dual_history(db, tid) is True


def test_history_is_true_after_a_legacy_link_exists(db):
    tid = _tenant(db)
    _legacy_sale(db, tid)
    migrate_tenant(db, tid)
    bridge.set_ledger_mode(db, tid, "dual", actor="o", reason="t")
    db.commit()
    _native_sale(db, tid)
    assert db.query(GLLegacyLink).filter(GLLegacyLink.tenant_id == tid).count() == 1
    # Remove the mode and the audit trail from the picture: the link alone is proof.
    db.query(Setting).filter(Setting.tenant_id == tid, Setting.key == bridge.MODE_SETTING_KEY).delete()
    db.query(GLAuditEvent).filter(GLAuditEvent.tenant_id == tid, GLAuditEvent.event_type == "LEDGER_MODE_CHANGED").update({"event_type": "OTHER"})
    db.commit()
    assert bridge.get_ledger_mode(db, tid) == "legacy" and bridge.had_dual_history(db, tid) is True


def test_history_is_true_from_the_audit_event_alone(db):
    tid = _tenant(db)
    migrate_tenant(db, tid)
    bridge.set_ledger_mode(db, tid, "dual", actor="o", reason="t")
    bridge.set_ledger_mode(db, tid, "legacy", actor="o", reason="back")
    db.commit()
    assert db.query(GLLegacyLink).filter(GLLegacyLink.tenant_id == tid).count() == 0
    assert bridge.get_ledger_mode(db, tid) == "legacy" and bridge.had_dual_history(db, tid) is True


def test_history_ignores_audit_events_that_only_went_to_legacy(db):
    tid = _tenant(db)
    migrate_tenant(db, tid)
    bridge.set_ledger_mode(db, tid, "legacy", actor="o", reason="noop")  # legacy -> legacy
    db.commit()
    assert bridge.had_dual_history(db, tid) is False


def test_native_journal_count_counts_only_native_journals(db):
    tid = _tenant(db)
    _legacy_sale(db, tid)
    migrate_tenant(db, tid)
    bridge.set_ledger_mode(db, tid, "dual", actor="o", reason="t")
    db.commit()
    assert bridge.native_journal_count(db, tid) == 0
    _native_sale(db, tid)
    assert bridge.native_journal_count(db, tid) == 1


# ───────────────────────────── reconcile selection ─────────────────────────────


def test_reconcile_for_tenant_selects_by_history(db):
    tid = _tenant(db)
    _legacy_sale(db, tid)
    migrate_tenant(db, tid)
    single = reconcile_for_tenant(db, tid)
    assert single["reconciler"] == "single" and single["ever_dual"] is False and len(single["checks"]) == 19 and single["ok"]
    bridge.set_ledger_mode(db, tid, "dual", actor="o", reason="t")
    db.commit()
    dual = reconcile_for_tenant(db, tid)
    assert dual["reconciler"] == "dual" and dual["ever_dual"] is True and dual["ok"]
    bridge.set_ledger_mode(db, tid, "legacy", actor="o", reason="back")
    db.commit()
    back = reconcile_for_tenant(db, tid)
    assert back["reconciler"] == "dual" and back["ever_dual"] is True and back["ok"]
