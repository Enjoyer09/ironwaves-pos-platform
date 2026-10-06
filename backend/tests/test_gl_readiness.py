"""Finance v2 cut-over readiness check: facts, verdicts, and read-only guarantee."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event, func
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import bridge, readiness, shadow
from app.gl.models import GLAccount, GLAuditEvent, GLJournal, GLJournalLine, GLShadowRun
from app.models import Sale, Setting, Tenant
from app.services import finance_service as fs

# Two cycle clocks on different Baku days so each produces its own reconcile run.
DAY1 = datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc)  # 05:00 Baku, after reconcile hour
DAY2 = datetime(2026, 10, 2, 1, 0, tzinfo=timezone.utc)


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


def _tenant(db, name="T") -> str:
    tid = str(uuid.uuid4())
    db.add(Tenant(id=tid, name=name, slug=f"s-{tid[:8]}", domain=f"{tid[:8]}.test", status="active"))
    db.flush()
    return tid


def _sale(db, tid, amount="10.00"):
    fs.post_finance_transaction(db, tenant_id=tid, transaction_type="income", amount=Decimal(amount), source_code="revenue",
                                destination_code="cash", created_by="kassir", category="Satış (Nağd)", related_order_id=str(uuid.uuid4()))
    db.commit()


def _clean_streak(db, tid, n: int = 2):
    """Produce ``n`` consecutive clean reconcile runs via the shadow cycle (one per Baku day)."""
    for clock in (DAY1, DAY2)[:n]:
        shadow.run_cycle(db, now=clock)


def _record_settings(db, tid, *, ui=False, supplier=False):
    """Record the two WP-A per-tenant settings explicitly (hidden / supplier off are valid decisions)."""
    bridge.set_ui_visible(db, tid, ui, actor="test", reason="test")
    bridge.set_require_supplier(db, tid, supplier, actor="test", reason="test")
    db.commit()
def _ready_tenant(db, sales=("10.00", "25.00")):
    tid = _tenant(db)
    for amount in sales:
        _sale(db, tid, amount)
    _clean_streak(db, tid, n=2)
    return tid
def _settings_reason(report, key):
    return [r for r in report["can_switch_to_dual"]["reasons"] if key in r]
def _row_counts(db, tid) -> dict:
    return {
        "settings": db.query(func.count(Setting.id)).filter(Setting.tenant_id == tid).scalar(),
        "audit_events": db.query(func.count(GLAuditEvent.id)).filter(GLAuditEvent.tenant_id == tid).scalar(),
        "journals": db.query(func.count(GLJournal.id)).filter(GLJournal.tenant_id == tid).scalar(),
        "lines": db.query(func.count(GLJournalLine.id)).filter(GLJournalLine.tenant_id == tid).scalar(),
        "accounts": db.query(func.count(GLAccount.id)).filter(GLAccount.tenant_id == tid).scalar(),
        "shadow_runs": db.query(func.count(GLShadowRun.id)).filter(GLShadowRun.tenant_id == tid).scalar(),
    }


def test_can_switch_to_dual_false_when_chart_missing(db):
    tid = _tenant(db)  # no sales, no chart created yet
    report = readiness.readiness(db, tid)
    verdict = report["can_switch_to_dual"]
    assert verdict["ok"] is False
    assert any("Chart of accounts is not initialised" in r for r in verdict["reasons"])
    assert report["chart_present"] is False


def test_can_switch_to_dual_false_when_streak_too_short(db):
    tid = _tenant(db)
    _sale(db, tid)
    _clean_streak(db, tid, n=1)  # only one clean reconcile
    report = readiness.readiness(db, tid)
    verdict = report["can_switch_to_dual"]
    assert verdict["ok"] is False
    assert report["clean_reconciliation_streak"] == 1
    assert any("Clean reconciliation streak is 1" in r for r in verdict["reasons"])


def test_can_switch_to_dual_false_when_native_errors_present(db):
    tid = _tenant(db)
    _sale(db, tid)
    _clean_streak(db, tid, n=2)
    db.add(GLShadowRun(tenant_id=tid, run_type="native_error", started_at=datetime.utcnow(),
                       finished_at=datetime.utcnow(), imported=0, ok=False, error="SaleCompleted: boom"))
    db.commit()
    report = readiness.readiness(db, tid)
    verdict = report["can_switch_to_dual"]
    assert verdict["ok"] is False
    assert report["native_error_count_7d"] == 1
    assert any("native posting error" in r for r in verdict["reasons"])


def test_can_switch_to_dual_true_on_happy_path(db):
    tid = _tenant(db)
    _sale(db, tid)
    _sale(db, tid, "25.00")
    _clean_streak(db, tid, n=2)
    _record_settings(db, tid)
    report = readiness.readiness(db, tid)
    verdict = report["can_switch_to_dual"]
    assert verdict["ok"] is True, verdict["reasons"]
    assert verdict["reasons"] == []
    assert report["chart_present"] is True
    assert report["clean_reconciliation_streak"] == 2
    assert report["native_error_count_7d"] == 0
    assert report["current_reconcile"]["ok"] is True


def test_can_switch_reports_to_gl_requires_dual_mode(db):
    tid = _tenant(db)
    _sale(db, tid)
    _clean_streak(db, tid, n=2)  # legacy mode, clean streak
    report = readiness.readiness(db, tid)
    verdict = report["can_switch_reports_to_gl"]
    assert verdict["ok"] is False
    assert report["ledger_mode"] == "legacy"
    assert report["parity"] is None
    assert any("must be 'dual'" in r for r in verdict["reasons"])


def test_can_switch_reports_to_gl_true_in_dual_with_parity(db):
    tid = _tenant(db)
    _sale(db, tid)
    _sale(db, tid, "40.00")
    # Mirror once so the chart exists, then switch to dual and build the clean
    # streak under dual-mode reconciliation.
    shadow.sync_tenant(db, tid)
    bridge.set_ledger_mode(db, tid, "dual", actor="test", reason="pilot")
    db.commit()
    _clean_streak(db, tid, n=2)
    report = readiness.readiness(db, tid)
    assert report["ledger_mode"] == "dual"
    assert report["parity"] is not None and report["parity"]["ok"] is True
    verdict = report["can_switch_reports_to_gl"]
    assert verdict["ok"] is True, verdict["reasons"]
    assert verdict["reasons"] == []


def test_readiness_performs_no_writes(db):
    tid = _tenant(db)
    _sale(db, tid)
    _sale(db, tid, "12.50")
    _clean_streak(db, tid, n=2)
    before = _row_counts(db, tid)
    report = readiness.readiness(db, tid)
    db.rollback()
    after = _row_counts(db, tid)
    assert before == after
    # Sanity: the call still returned a full report with both verdicts.
    assert set(report).issuperset({"can_switch_to_dual", "can_switch_reports_to_gl", "current_reconcile"})

# ───────────────────────────── WP-A6: recorded settings are blockers ─────────────────────────────
def test_unrecorded_settings_are_the_only_blockers_on_an_otherwise_ready_tenant(db):
    """The four real tenants in miniature: legacy, chart, clean streak, nothing recorded => NO, and exactly why."""
    tid = _ready_tenant(db)
    report = readiness.readiness(db, tid)
    verdict = report["can_switch_to_dual"]
    assert verdict["ok"] is False
    assert len(verdict["reasons"]) == 2
    assert len(_settings_reason(report, "finance_v2_ui_visible is not recorded")) == 1
    assert len(_settings_reason(report, "finance_v2_require_supplier is not recorded")) == 1
    assert f"--tenant {tid} --ui hidden" in verdict["reasons"][0] and f"--tenant {tid} --require-supplier off" in verdict["reasons"][1]
    assert report["ui_visible_setting"] is None and report["require_supplier_setting"] is None
def test_only_the_missing_setting_is_reported(db):
    tid = _ready_tenant(db)
    bridge.set_ui_visible(db, tid, False, actor="test", reason="test")
    db.commit()
    report = readiness.readiness(db, tid)
    assert len(report["can_switch_to_dual"]["reasons"]) == 1 and _settings_reason(report, "finance_v2_require_supplier is not recorded")
    bridge.set_require_supplier(db, tid, False, actor="test", reason="test")
    db.commit()
    assert readiness.readiness(db, tid)["can_switch_to_dual"]["ok"] is True
@pytest.mark.parametrize("ui,supplier", [(False, False), (True, False), (False, True), (True, True)])
def test_any_explicit_value_satisfies_the_requirement(db, ui, supplier):
    tid = _ready_tenant(db)
    _record_settings(db, tid, ui=ui, supplier=supplier)
    verdict = readiness.readiness(db, tid)["can_switch_to_dual"]
    assert verdict["ok"] is True, verdict["reasons"]
@pytest.mark.parametrize("raw", ["", "nope", "[]", '{"visible": "true"}', '{"required": 1}', "{}"])
def test_malformed_setting_rows_count_as_not_recorded(db, raw):
    tid = _ready_tenant(db)
    db.add(Setting(tenant_id=tid, key="finance_v2_ui_visible", value=raw))
    db.add(Setting(tenant_id=tid, key="finance_v2_require_supplier", value=raw))
    db.commit()
    report = readiness.readiness(db, tid)
    assert report["ui_visible_setting"] is None and report["require_supplier_setting"] is None
    assert report["can_switch_to_dual"]["ok"] is False
def test_chartless_tenant_gets_a_clear_fix_and_does_not_raise(db):
    tid = _tenant(db)  # legacy sales exist but nothing was ever mirrored: no chart
    _sale(db, tid, "5.00")
    db.rollback()
    report = readiness.readiness(db, tid)
    assert report["chart_present"] is False and report["current_reconcile"] is None
    reason = report["can_switch_to_dual"]["reasons"][0]
    assert "Chart of accounts is not initialised" in reason and "--set dual" in reason and tid in reason
    assert report["rollback_reconciler_verified"] is None
    assert not [r for r in report["can_switch_to_dual"]["reasons"] if "Rollback reconciler" in r]
# ───────────────────────────── WP-A3 in readiness: history-aware reconciler ─────────────────────────────
def test_flipped_back_tenant_is_judged_by_the_dual_reconciler(db):
    tid = _tenant(db)
    _sale(db, tid)
    shadow.sync_tenant(db, tid)
    bridge.set_ledger_mode(db, tid, "dual", actor="test", reason="pilot")
    db.commit()
    bridge.set_ledger_mode(db, tid, "legacy", actor="test", reason="back")
    db.commit()
    _sale(db, tid, "7.00")
    shadow.sync_tenant(db, tid)  # the shadow job mirrors new legacy activity (readiness itself never writes)
    report = readiness.readiness(db, tid)
    assert report["ledger_mode"] == "legacy" and report["ever_dual"] is True and report["reconciler"] == "dual"
    assert report["current_reconcile"]["ok"] is True, [c for c in report["current_reconcile"]["checks"] if not c["ok"]]
    assert report["current_reconcile"]["reconciler"] == "dual"
    assert report["rollback_reconciler_verified"] is True
def test_rollback_blocker_text_when_the_selection_is_not_wired(db, monkeypatch):
    tid = _ready_tenant(db)
    _record_settings(db, tid)
    bridge.set_ledger_mode(db, tid, "dual", actor="test", reason="pilot")
    db.commit()
    real = readiness.legacy_migration.reconcile_for_tenant
    monkeypatch.setattr(readiness.legacy_migration, "reconcile_for_tenant", lambda d, t: dict(real(d, t), reconciler="single"))
    report = readiness.readiness(db, tid)
    assert report["rollback_reconciler_verified"] is False
    for verdict in ("can_switch_to_dual", "can_switch_reports_to_gl"):
        assert any("Rollback reconciler not verified" in r for r in report[verdict]["reasons"]), verdict
# ───────────────────────────── WP-A6: explained_diff_review ─────────────────────────────
def _dual_tenant_with_card_fee_gap(db):
    tid = _tenant(db)
    _sale(db, tid)
    shadow.sync_tenant(db, tid)
    bridge.set_ledger_mode(db, tid, "dual", actor="test", reason="pilot")
    db.commit()
    sale = Sale(id="s-gap", tenant_id=tid, cashier="k", payment_method="Kart", total=Decimal("50.00"), discount_amount=Decimal("0"),
                cogs=Decimal("12.00"), items_json="[]", status="COMPLETED")
    db.add(sale)
    db.flush()
    # Legacy books no card fee here, native does (2%): a 1.00 explained difference on the card wallet.
    fs.post_sale_payment(db, tenant_id=tid, sale_id=sale.id, amount=Decimal("50.00"), payment_source="card", created_by="k", card_fee_percent=Decimal("0"))
    fs.post_sale_cogs(db, tenant_id=tid, sale_id=sale.id, amount=Decimal("12.00"), created_by="k")
    bridge.emit_sale(db, tid, sale=sale, payments=[("card", sale.total)], actor="k", card_fee_percent=Decimal("2"))
    db.commit()
    return tid
def test_explained_diff_review_lists_each_non_zero_difference_and_never_blocks(db):
    tid = _dual_tenant_with_card_fee_gap(db)
    _clean_streak(db, tid, n=2)
    report = readiness.readiness(db, tid)
    verdict = report["can_switch_reports_to_gl"]
    review = verdict["explained_diff_review"]
    assert [entry["code"] for entry in review] == ["card"]
    assert Decimal(review[0]["explained_diff"]) == Decimal("-1.00")
    assert set(review[0]) == {"code", "explained_diff", "legacy", "gl"}
    assert verdict["ok"] is True, verdict["reasons"]  # informational: the review does not change the verdict
    assert "explained_diff_review" not in report["can_switch_to_dual"]
def test_explained_diff_review_is_empty_without_differences_or_parity(db):
    tid = _ready_tenant(db)
    assert readiness.readiness(db, tid)["can_switch_reports_to_gl"]["explained_diff_review"] == []  # legacy: no parity report
    shadow.sync_tenant(db, tid)
    bridge.set_ledger_mode(db, tid, "dual", actor="test", reason="pilot")
    db.commit()
    assert readiness.readiness(db, tid)["can_switch_reports_to_gl"]["explained_diff_review"] == []  # dual, nothing explained
def test_readiness_performs_no_writes_even_with_settings_absent(db):
    tid = _ready_tenant(db)
    before = _row_counts(db, tid)
    report = readiness.readiness(db, tid)
    db.rollback()
    assert before == _row_counts(db, tid)
    assert report["ui_visible_setting"] is None
