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
from app.gl.models import GLAccount, GLJournal, GLJournalLine, GLShadowRun
from app.models import Tenant
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


def _row_counts(db, tid) -> dict:
    return {
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
