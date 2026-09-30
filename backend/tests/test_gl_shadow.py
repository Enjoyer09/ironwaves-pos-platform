"""Finance v2 shadow mode: incremental sync, nightly reconciliation, isolation."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.core.config import settings
from app.db import Base
from app.gl import legacy_migration, shadow
from app.gl.models import GLJournal, GLShadowRun
from app.models import Tenant
from app.services import finance_service as fs

# 05:00 Baku (01:00 UTC) — after the default 04:00 reconcile hour.
AFTER_RECONCILE_HOUR = datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc)
BEFORE_RECONCILE_HOUR = datetime(2026, 9, 29, 20, 0, tzinfo=timezone.utc)  # 00:00 Baku on 30 Sep


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


def _gl_count(db, tid) -> int:
    return db.query(GLJournal).filter(GLJournal.tenant_id == tid).count()


def test_cycle_mirrors_new_legacy_postings_incrementally(db):
    tid = _tenant(db)
    _sale(db, tid)
    _sale(db, tid)
    shadow.run_cycle(db, now=BEFORE_RECONCILE_HOUR)
    assert _gl_count(db, tid) == 2
    shadow.run_cycle(db, now=BEFORE_RECONCILE_HOUR)  # nothing new
    assert _gl_count(db, tid) == 2
    _sale(db, tid, "7.50")
    shadow.run_cycle(db, now=BEFORE_RECONCILE_HOUR)
    assert _gl_count(db, tid) == 3
    syncs = db.query(GLShadowRun).filter(GLShadowRun.run_type == "sync").all()
    assert sorted(r.imported for r in syncs) == [1, 2]  # empty cycles are not logged
    assert not db.query(GLShadowRun).filter(GLShadowRun.run_type == "reconcile").count()


def test_reconciliation_runs_once_per_day_after_hour(db):
    tid = _tenant(db)
    _sale(db, tid)
    shadow.run_cycle(db, now=AFTER_RECONCILE_HOUR)
    shadow.run_cycle(db, now=AFTER_RECONCILE_HOUR)
    runs = db.query(GLShadowRun).filter(GLShadowRun.run_type == "reconcile").all()
    assert len(runs) == 1 and runs[0].ok is True
    status = shadow.shadow_status(db, tid)
    assert status["clean_reconciliation_streak"] == 1


def test_failing_tenant_does_not_block_others(db, monkeypatch):
    good, bad = _tenant(db, "good"), _tenant(db, "bad")
    _sale(db, good)
    _sale(db, bad)
    real = legacy_migration.migrate_tenant

    def flaky(session, tenant_id, **kw):
        if tenant_id == bad:
            raise RuntimeError("boom")
        return real(session, tenant_id, **kw)

    monkeypatch.setattr(shadow, "migrate_tenant", flaky)
    shadow.run_cycle(db, now=BEFORE_RECONCILE_HOUR)
    assert _gl_count(db, good) == 1 and _gl_count(db, bad) == 0
    err = db.query(GLShadowRun).filter(GLShadowRun.tenant_id == bad).one()
    assert err.ok is False and "boom" in err.error


def test_failed_reconciliation_breaks_the_streak(db, monkeypatch):
    tid = _tenant(db)
    _sale(db, tid)
    shadow.run_cycle(db, now=AFTER_RECONCILE_HOUR)
    monkeypatch.setattr(shadow, "reconcile_tenant", lambda s, t: {"ok": False, "checks": [{"check": "x", "ok": False}]})
    shadow.run_cycle(db, now=AFTER_RECONCILE_HOUR.replace(day=2))
    status = shadow.shadow_status(db, tid)
    assert status["clean_reconciliation_streak"] == 0
    assert status["runs"][0]["details"]["failed_checks"] == [{"check": "x", "ok": False}]


def test_scheduler_disabled_by_default(monkeypatch):
    monkeypatch.setattr(settings, "finance_v2_shadow_enabled", False)
    assert shadow.start_shadow_scheduler() is False
