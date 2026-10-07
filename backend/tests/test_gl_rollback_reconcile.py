"""Finance v2 WP-A3 (R3): a tenant that has ever been dual keeps being judged by the dual reconciler.

Before the fix the nightly job (and readiness, and gl_ledger_mode.py) picked the reconciler from the CURRENT mode. A tenant
flipped dual -> legacy still owns native journals and legacy links, so the 1:1 ``reconcile_tenant`` failed about half of
its checks and the nightly job raised a false ``reconcile_failed`` alert. These tests also prove that nothing is mirrored
twice across dual -> legacy -> dual.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event, func
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from types import SimpleNamespace

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import bridge
from app.gl import engine as gl
from app.gl import shadow
from app.gl.legacy_migration import migrate_tenant, reconcile_dual_tenant, reconcile_tenant
from app.gl.models import GLAlert, GLJournal, GLLegacyLink, GLShadowRun
from app.models import Sale, Tenant
from app.services import finance_service as fs

D = Decimal
ADMIN = SimpleNamespace(username="owner", role="admin")


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", future=True, connect_args={"check_same_thread": False}, poolclass=StaticPool)

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


@pytest.fixture()
def tenant(db):
    t = Tenant(id=str(uuid.uuid4()), name="Flip", slug="flip", domain="flip.test", status="active")
    db.add(t)
    db.flush()
    gl.ensure_chart(db, t.id)
    for code, amount in (("cash", "500"), ("card", "500"), ("safe", "200")):
        fs.post_finance_transaction(db, tenant_id=t.id, transaction_type="investor_injection", amount=D(amount), source_code="investor",
                                    destination_code=code, created_by="owner", category="Təsisçi İnvestisiyası")
    db.commit()
    migrate_tenant(db, t.id)
    return t


def sale(db, t, *, method="card", amount="20.00", cogs="6.00"):
    """A sale as pos.create_sale posts it: legacy postings, plus a native journal when the tenant is dual."""
    row = Sale(id=str(uuid.uuid4()), tenant_id=t.id, cashier="k", payment_method="Kart" if method == "card" else method,
               total=D(amount), discount_amount=D("0"), cogs=D(cogs), items_json="[]", status="COMPLETED")
    db.add(row)
    db.flush()
    fs.post_sale_payment(db, tenant_id=t.id, sale_id=row.id, amount=D(amount), payment_source="card" if method == "card" else "cash",
                         created_by="k", card_fee_percent=D("2") if method == "card" else D("0"))
    fs.post_sale_cogs(db, tenant_id=t.id, sale_id=row.id, amount=D(cogs), created_by="k")
    bridge.emit_sale(db, t.id, sale=row, payments=[(method, D(amount))], actor="k", card_fee_percent=D("2"))
    db.commit()
    return row


def flip(db, t, mode):
    bridge.set_ledger_mode(db, t.id, mode, actor="owner", reason="flip test")
    db.commit()


def assert_nothing_double_mirrored(db, tid, phase):
    dupes = (db.query(GLJournal.legacy_ref).filter(GLJournal.tenant_id == tid, GLJournal.legacy_ref.isnot(None))
             .group_by(GLJournal.legacy_ref).having(func.count(GLJournal.id) > 1).all())
    assert dupes == [], f"{phase}: a legacy transaction is mirrored on more than one journal"
    mirrored = {r for (r,) in db.query(GLJournal.legacy_ref).filter(GLJournal.tenant_id == tid, GLJournal.legacy_ref.isnot(None)).all()}
    covered = {r for (r,) in db.query(GLLegacyLink.legacy_txn_id).filter(GLLegacyLink.tenant_id == tid).all()}
    assert mirrored & covered == set(), f"{phase}: a legacy transaction is both mirrored and covered"
    assert gl.verify_audit_chain(db, tid)["valid"], f"{phase}: audit chain broken"


def nightly_ok(db, tid, phase):
    report = shadow.reconcile_tenant_shadow(db, tid)
    failed = [c["check"] for c in report["checks"] if not c["ok"]]
    assert report["ok"], f"{phase}: nightly reconcile failed: {failed}"
    assert db.query(GLAlert).filter(GLAlert.tenant_id == tid, GLAlert.alert_type == "reconcile_failed", GLAlert.status == "open").count() == 0
    last = db.query(GLShadowRun).filter(GLShadowRun.tenant_id == tid, GLShadowRun.run_type == "reconcile").order_by(GLShadowRun.started_at.desc()).first()
    assert last.ok is True
    assert_nothing_double_mirrored(db, tid, phase)
    return report


def test_flip_dual_legacy_dual_keeps_the_nightly_reconcile_green_and_mirrors_once(db, tenant):
    from app.routers import analytics_api

    tid = tenant.id
    # A. legacy
    sale(db, tenant)
    sale(db, tenant, method="cash", amount="12.00", cogs="3.00")
    report_a = nightly_ok(db, tid, "A legacy")
    assert len(report_a["checks"]) == 19

    # B. dual: native sales
    flip(db, tenant, "dual")
    dual_era = sale(db, tenant)
    sale(db, tenant, method="cash", amount="8.00", cogs="2.00")
    report_b = nightly_ok(db, tid, "B dual")

    # C. back to legacy: new legacy activity, plus a void of a dual-era sale while in legacy mode
    flip(db, tenant, "legacy")
    sale(db, tenant)
    sale(db, tenant, method="cash", amount="5.00", cogs="1.00")
    analytics_api.void_sale(dual_era.id, analytics_api.SaleVoidIn(reason="səhv"), db=db, tenant=tenant, user=ADMIN)
    report_c = nightly_ok(db, tid, "C legacy after dual")
    # The plain 1:1 reconciler cannot judge this tenant any more; that is why the selection must follow the history.
    plain = reconcile_tenant(db, tid)
    db.rollback()
    assert plain["ok"] is False

    # D. dual again
    flip(db, tenant, "dual")
    sale(db, tenant)
    sale(db, tenant, method="cash", amount="9.00", cogs="2.00")
    nightly_ok(db, tid, "D dual again")
    final = reconcile_dual_tenant(db, tid)
    assert final["ok"], [c for c in final["checks"] if not c["ok"]]
    # A second sync after the last flip imports nothing new: no double mirror.
    assert shadow.sync_tenant(db, tid) == 0
    assert_nothing_double_mirrored(db, tid, "D after extra sync")
    # Which judge was used (the behaviour above is what matters; this documents the selection).
    assert report_a["reconciler"] == "single" and report_a["ever_dual"] is False
    assert report_b["reconciler"] == "dual" and report_c["reconciler"] == "dual" and report_c["ever_dual"] is True


def test_never_dual_tenant_keeps_the_single_reconciler(db, tenant):
    sale(db, tenant)
    report = nightly_ok(db, tenant.id, "never dual")
    assert len(report["checks"]) == 19
    assert report["reconciler"] == "single" and report["ever_dual"] is False
