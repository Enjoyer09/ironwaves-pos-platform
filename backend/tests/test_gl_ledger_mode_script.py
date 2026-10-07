"""Finance v2 WP-A: scripts/gl_ledger_mode.py (--ui, --require-supplier, --set dual creating the chart, --set legacy warning)."""
from __future__ import annotations

import json
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.core.config import settings
from app.db import Base
from app.gl import bridge
from app.gl import engine as gl
from app.gl.legacy_migration import reconcile_for_tenant
from app.gl.models import GLAccount, GLAuditEvent, GLJournal
from app.models import Sale, Setting, Tenant
from app.services import finance_service as fs
from scripts import gl_ledger_mode

D = Decimal
PROD_URL = "postgresql://u:p@foo.railway.app/db"


@pytest.fixture()
def env(monkeypatch):
    engine = create_engine("sqlite://", future=True, connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _connect(dbapi_conn, _):
        dbapi_conn.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(gl_ledger_mode, "SessionLocal", Session)
    monkeypatch.setattr(settings, "database_url", "sqlite://")  # not production
    yield Session
    engine.dispose()


def _tenant(Session, *, chart=True, legacy_sales=0) -> str:
    tid = str(uuid.uuid4())
    with Session() as db:
        db.add(Tenant(id=tid, name="T", slug=f"s-{tid[:8]}", domain=f"{tid[:8]}.test", status="active"))
        db.flush()
        if chart:
            gl.ensure_chart(db, tid)
        for _ in range(legacy_sales):
            fs.post_finance_transaction(db, tenant_id=tid, transaction_type="income", amount=D("10.00"), source_code="revenue",
                                        destination_code="cash", created_by="kassir", category="Satış (Nağd)", related_order_id=str(uuid.uuid4()))
        db.commit()
    return tid


def _run(argv, capsys):
    code = gl_ledger_mode.main(argv)
    out = capsys.readouterr()
    return code, out.out, out.err


def _events(Session, tid, event_type):
    with Session() as db:
        return [(e.event_type, json.loads(e.payload)) for e in db.query(GLAuditEvent).filter(
            GLAuditEvent.tenant_id == tid, GLAuditEvent.event_type == event_type).order_by(GLAuditEvent.seq).all()]


def _chain_valid(Session, tid) -> bool:
    with Session() as db:
        return gl.verify_audit_chain(db, tid)["valid"]


# ───────────────────────────── --ui / --require-supplier ─────────────────────────────


def test_ui_visible_then_hidden_is_recorded_and_audited(env, capsys):
    tid = _tenant(env, chart=False)  # no chart needed for a flag
    code, out, _ = _run(["--tenant", tid, "--ui", "visible", "--reason", "pilot"], capsys)
    assert code == 0 and json.loads(out) == {"tenant_id": tid, "from": None, "to": True}
    with env() as db:
        assert bridge.is_ui_visible(db, tid) is True
        assert bridge.get_ui_visible_record(db, tid)["by"] == "system:cli"
    code, out, _ = _run(["--tenant", tid, "--ui", "hidden", "--reason", "rollback"], capsys)
    assert code == 0 and json.loads(out)["from"] is True and json.loads(out)["to"] is False
    with env() as db:
        assert bridge.is_ui_visible(db, tid) is False
        assert db.query(Setting).filter(Setting.tenant_id == tid, Setting.key == "finance_v2_ui_visible").count() == 1
    events = _events(env, tid, "UI_VISIBILITY_CHANGED")
    assert [p["to"] for _, p in events] == [True, False] and events[0][1]["reason"] == "pilot"
    assert _chain_valid(env, tid)


def test_require_supplier_on_off_is_recorded_and_audited(env, capsys):
    tid = _tenant(env)
    assert _run(["--tenant", tid, "--require-supplier", "on", "--reason", "policy"], capsys)[0] == 0
    with env() as db:
        assert bridge.require_supplier(db, tid) is True
    assert _run(["--tenant", tid, "--require-supplier", "off", "--reason", "policy"], capsys)[0] == 0
    with env() as db:
        assert bridge.require_supplier(db, tid) is False
        assert bridge.get_require_supplier_record(db, tid) is not None  # recorded as off, not absent
    assert [p["to"] for _, p in _events(env, tid, "REQUIRE_SUPPLIER_CHANGED")] == [True, False]
    assert _chain_valid(env, tid)


@pytest.mark.parametrize("flag", [["--ui", "visible"], ["--require-supplier", "on"]])
@pytest.mark.parametrize("reason", [[], ["--reason", "   "]])
def test_reason_is_required_and_nothing_is_written(env, capsys, flag, reason):
    tid = _tenant(env)
    code, _, err = _run(["--tenant", tid, *flag, *reason], capsys)
    assert code == 1 and "reason" in err.lower()
    with env() as db:
        assert db.query(Setting).filter(Setting.tenant_id == tid, Setting.key.in_(["finance_v2_ui_visible", "finance_v2_require_supplier"])).count() == 0
        assert db.query(GLAuditEvent).filter(GLAuditEvent.event_type.in_(["UI_VISIBILITY_CHANGED", "REQUIRE_SUPPLIER_CHANGED"])).count() == 0


def test_unknown_tenant_is_refused_clearly(env, capsys):
    for argv in (["--ui", "visible", "--reason", "x"], ["--require-supplier", "on", "--reason", "x"], ["--set", "dual", "--reason", "x"]):
        code, _, err = _run(["--tenant", "no-such-tenant", *argv], capsys)
        assert code == 1 and "Unknown tenant" in err


@pytest.mark.parametrize("argv", [["--ui", "visible", "--reason", "x"], ["--require-supplier", "on", "--reason", "x"],
                                  ["--set", "dual", "--reason", "x"]])
def test_production_is_refused_before_any_write(env, capsys, monkeypatch, argv):
    tid = _tenant(env, legacy_sales=1, chart=False)
    monkeypatch.setattr(settings, "database_url", PROD_URL)
    code, _, err = _run(["--tenant", tid, *argv], capsys)
    assert code == 2 and "--allow-production" in err
    with env() as db:
        assert db.query(Setting).filter(Setting.tenant_id == tid).count() == 0
        assert db.query(GLAccount).filter(GLAccount.tenant_id == tid).count() == 0  # not even a chart


def test_allow_production_passes_the_guard(env, capsys, monkeypatch):
    tid = _tenant(env)
    monkeypatch.setattr(settings, "database_url", PROD_URL)
    code, out, _ = _run(["--tenant", tid, "--ui", "visible", "--reason", "x", "--allow-production"], capsys)
    assert code == 0 and json.loads(out)["to"] is True


# ───────────────────────────── --set dual / legacy ─────────────────────────────


def test_set_dual_on_a_tenant_without_chart_creates_chart_and_first_mirror(env, capsys):
    tid = _tenant(env, chart=False, legacy_sales=3)
    code, out, err = _run(["--tenant", tid, "--set", "dual", "--reason", "pilot"], capsys)
    assert code == 0, err
    assert "ok=True" in out
    with env() as db:
        assert db.query(GLAccount).filter(GLAccount.tenant_id == tid).count() > 0
        assert bridge.get_ledger_mode(db, tid) == "dual"
        assert db.query(GLJournal).filter(GLJournal.tenant_id == tid, GLJournal.legacy_ref.isnot(None)).count() == 3
        report = reconcile_for_tenant(db, tid)
        assert report["ok"] and report["reconciler"] == "dual"
    assert _chain_valid(env, tid)


def test_failed_reconcile_rolls_back_chart_mirror_and_mode(env, capsys, monkeypatch):
    tid = _tenant(env, chart=False, legacy_sales=2)
    monkeypatch.setattr(gl_ledger_mode, "reconcile_for_tenant",
                        lambda db, t: {"ok": False, "checks": [{"check": "forced", "ok": False}], "reconciler": "dual", "ever_dual": True})
    code, _, err = _run(["--tenant", tid, "--set", "dual", "--reason", "pilot"], capsys)
    assert code == 1 and "ABORTED" in err and "forced" in err
    with env() as db:
        assert db.query(GLAccount).filter(GLAccount.tenant_id == tid).count() == 0
        assert db.query(GLJournal).filter(GLJournal.tenant_id == tid).count() == 0
        assert bridge.get_ledger_mode(db, tid) == "legacy"
        assert db.query(GLAuditEvent).filter(GLAuditEvent.tenant_id == tid).count() == 0


def test_set_legacy_warns_when_the_tenant_has_native_journals(env, capsys):
    tid = _tenant(env, legacy_sales=1)
    with env() as db:
        from app.gl.legacy_migration import migrate_tenant

        migrate_tenant(db, tid)
        bridge.set_ledger_mode(db, tid, "dual", actor="owner", reason="t")
        db.commit()
        sale = Sale(id=str(uuid.uuid4()), tenant_id=tid, cashier="k", payment_method="Nağd", total=D("20.00"), discount_amount=D("0"),
                    cogs=D("0"), items_json="[]", status="COMPLETED")
        db.add(sale)
        db.flush()
        fs.post_sale_payment(db, tenant_id=tid, sale_id=sale.id, amount=D("20.00"), payment_source="cash", created_by="k")
        bridge.emit_sale(db, tid, sale=sale, payments=[("cash", D("20.00"))], actor="k")
        db.commit()
        assert bridge.native_journal_count(db, tid) == 1
    code, out, err = _run(["--tenant", tid, "--set", "legacy", "--reason", "rollback"], capsys)
    assert code == 0, err
    assert "WARNING" in err and "1 native journal" in err and "STAY in the GL" in err and "dual reconciler" in err
    assert "ok=True" in out
    with env() as db:
        assert bridge.get_ledger_mode(db, tid) == "legacy"
        assert reconcile_for_tenant(db, tid)["reconciler"] == "dual"  # the judge did not change with the mode


def test_set_legacy_on_a_never_dual_tenant_prints_no_warning(env, capsys):
    tid = _tenant(env, legacy_sales=2)
    code, out, err = _run(["--tenant", tid, "--set", "legacy", "--reason", "noop"], capsys)
    assert code == 0, err
    assert "WARNING" not in err and "ok=True" in out


def test_reconcile_on_a_chartless_tenant_gives_a_clear_message(env, capsys):
    tid = _tenant(env, chart=False, legacy_sales=1)
    code, out, err = _run(["--tenant", tid, "--reconcile"], capsys)
    assert code == 1 and "no chart of accounts" in err and tid in err
    assert "Traceback" not in err and out == ""


def test_reconcile_prints_the_selected_reconciler(env, capsys):
    tid = _tenant(env, legacy_sales=1)
    with env() as db:
        from app.gl.legacy_migration import migrate_tenant

        migrate_tenant(db, tid)
    code, out, _ = _run(["--tenant", tid, "--reconcile"], capsys)
    assert code == 0 and "reconciler=single ever_dual=False" in out and "mode=legacy" in out
    assert _run(["--tenant", tid, "--set", "dual", "--reason", "t"], capsys)[0] == 0
    assert _run(["--tenant", tid, "--set", "legacy", "--reason", "t"], capsys)[0] == 0
    code, out, _ = _run(["--tenant", tid, "--reconcile"], capsys)
    assert code == 0 and "mode=legacy" in out and "reconciler=dual ever_dual=True" in out
