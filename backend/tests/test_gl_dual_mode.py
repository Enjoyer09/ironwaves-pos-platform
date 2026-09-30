"""Finance v2 dual mode: native journals alongside legacy, coverage, fallback, reconciliation."""
from __future__ import annotations

import json
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import bridge
from app.gl import engine as gl
from app.gl import posting_rules as pr
from app.gl import shadow
from app.gl.engine import GLError
from app.gl.legacy_migration import migrate_tenant, reconcile_dual_tenant, reconcile_tenant
from app.gl.models import GLJournal, GLLegacyLink, GLShadowRun
from app.models import FinanceTransaction, Sale, Tenant
from app.services import finance_service as fs

D = Decimal


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
def tid(db):
    t = str(uuid.uuid4())
    db.add(Tenant(id=t, name="Demo", slug=f"d-{t[:8]}", domain=f"{t[:8]}.test", status="active"))
    db.flush()
    gl.ensure_chart(db, t)
    # Some legacy history, migrated like production.
    fs.post_finance_transaction(db, tenant_id=t, transaction_type="investor_injection", amount=D("100"), source_code="investor",
                                destination_code="cash", created_by="owner", category="Təsisçi İnvestisiyası")
    db.commit()
    migrate_tenant(db, t)
    return t


def _dual(db, tid):
    bridge.set_ledger_mode(db, tid, "dual", actor="owner", reason="pilot")
    db.commit()


def _legacy_card_sale(db, tid, sale_id, amount="50.00", fee="2", cogs="12.00"):
    sale = Sale(id=sale_id, tenant_id=tid, cashier="k", payment_method="Kart", total=D(amount), discount_amount=D("0"),
                cogs=D(cogs), items_json="[]", status="COMPLETED")
    db.add(sale)
    db.flush()
    fs.post_sale_payment(db, tenant_id=tid, sale_id=sale_id, amount=D(amount), payment_source="card", created_by="k", card_fee_percent=D(fee))
    fs.post_sale_cogs(db, tenant_id=tid, sale_id=sale_id, amount=D(cogs), created_by="k")
    return sale


def _native(db, tid):
    return db.query(GLJournal).filter(GLJournal.tenant_id == tid, GLJournal.legacy_ref.is_(None), GLJournal.source_module == "pos").all()


# ─────────────────────────── mode ───────────────────────────


def test_default_mode_is_legacy_and_emit_is_noop(db, tid):
    assert bridge.get_ledger_mode(db, tid) == "legacy"
    sale = _legacy_card_sale(db, tid, "s-legacy")
    called = []
    assert bridge.emit_sale(db, tid, sale=sale, payments=lambda: called.append(1) or [("card", sale.total)], actor="k") is None
    assert called == []  # lazy: nothing evaluated in legacy mode
    assert not _native(db, tid) and db.query(GLLegacyLink).count() == 0
    assert db.info.get(bridge.PENDING_KEY) == []  # pending cleared, no leak into later requests


def test_mode_switch_is_validated_and_audited(db, tid):
    with pytest.raises(GLError):
        bridge.set_ledger_mode(db, tid, "gl", actor="owner", reason="x")
    with pytest.raises(GLError):
        bridge.set_ledger_mode(db, tid, "dual", actor="owner", reason=" ")
    result = bridge.set_ledger_mode(db, tid, "dual", actor="owner", reason="pilot")
    assert result == {"tenant_id": tid, "from": "legacy", "to": "dual"}
    assert gl.verify_audit_chain(db, tid)["valid"]


# ─────────────────────────── dual posting ───────────────────────────


def test_dual_sale_posts_one_native_journal_covering_legacy(db, tid):
    _dual(db, tid)
    sale = _legacy_card_sale(db, tid, "s-1")
    journal = bridge.emit_sale(db, tid, sale=sale, payments=[("card", sale.total)], actor="k", card_fee_percent=D("2"))
    db.commit()
    assert journal is not None and journal.journal_type == "sales"
    links = db.query(GLLegacyLink).filter(GLLegacyLink.journal_id == journal.id).all()
    assert len(links) == 3  # income + card fee + cogs
    assert all(l.wallet_diff is None for l in links)  # same money effect as legacy
    shadow.sync_tenant(db, tid)
    assert db.query(GLJournal).filter(GLJournal.legacy_ref.in_([l.legacy_txn_id for l in links])).count() == 0  # not mirrored
    assert reconcile_dual_tenant(db, tid)["ok"]


def test_known_legacy_gap_is_recorded_as_explained_difference(db, tid):
    """Table checks: legacy books no card fee; native does. The 1.00 difference is explained, not an error."""
    _dual(db, tid)
    sale = _legacy_card_sale(db, tid, "s-table", fee="0")
    bridge.emit_sale(db, tid, sale=sale, payments=[("card", sale.total)], actor="k", card_fee_percent=D("2"))
    db.commit()
    link = db.query(GLLegacyLink).filter(GLLegacyLink.wallet_diff.isnot(None)).one()
    assert json.loads(link.wallet_diff) == {"card": "-1.00"}
    report = reconcile_dual_tenant(db, tid)
    assert report["ok"], [c for c in report["checks"] if not c["ok"]]
    assert report["explained_differences"] == {"SaleCompleted": {"card": "-1.00"}}


def test_native_failure_never_breaks_sale_and_falls_back_to_mirroring(db, tid):
    _dual(db, tid)
    sale = _legacy_card_sale(db, tid, "s-qr")
    # 'qr' is unknown: legacy silently called it card; native refuses.
    assert bridge.emit_sale(db, tid, sale=sale, payments=[("qr", sale.total)], actor="k") is None
    db.commit()
    err = db.query(GLShadowRun).filter(GLShadowRun.run_type == "native_error").one()
    assert "Unknown payment method" in err.error and len(json.loads(err.details)["legacy_txn_ids"]) == 3
    assert db.query(GLLegacyLink).count() == 0
    assert shadow.sync_tenant(db, tid) == 3  # shadow mirrors the uncovered legacy postings
    assert reconcile_dual_tenant(db, tid)["ok"]


def test_factory_exceptions_are_contained(db, tid):
    _dual(db, tid)
    fs.post_finance_transaction(db, tenant_id=tid, transaction_type="expense", amount=D("5"), source_code="cash",
                                destination_code="expense", created_by="k", category="Digər Xərc")

    def boom():
        raise ZeroDivisionError("bug in a hook")

    assert bridge.emit(db, tid, boom, actor="k") is None
    db.commit()
    assert db.query(GLShadowRun).filter(GLShadowRun.run_type == "native_error").count() == 1


def test_cash_guard_failure_falls_back(db, tid):
    _dual(db, tid)
    fs.post_finance_transaction(db, tenant_id=tid, transaction_type="expense", amount=D("150"), source_code="cash",
                                destination_code="expense", created_by="mgr", category="Maaş")
    assert bridge.emit(db, tid, lambda: pr.WagePaidFromDrawer("sh", gl.business_today(), "150"), actor="mgr") is None
    db.commit()
    assert shadow.sync_tenant(db, tid) == 1
    assert reconcile_dual_tenant(db, tid)["ok"]


def test_unhooked_flows_are_still_mirrored_in_dual(db, tid):
    _dual(db, tid)
    fs.post_finance_transaction(db, tenant_id=tid, transaction_type="internal_transfer", amount=D("40"), source_code="cash",
                                destination_code="safe", created_by="mgr", category="Daxili Transfer")
    db.commit()
    bridge.discard_pending(db)  # end of an unhooked request
    assert shadow.sync_tenant(db, tid) == 1
    assert reconcile_dual_tenant(db, tid)["ok"]


def test_legacy_void_of_native_sale_is_mirrored_and_nets_out(db, tid):
    _dual(db, tid)
    sale = _legacy_card_sale(db, tid, "s-void")
    bridge.emit_sale(db, tid, sale=sale, payments=[("card", sale.total)], actor="k", card_fee_percent=D("2"))
    db.commit()
    for original in db.query(FinanceTransaction).filter(FinanceTransaction.related_order_id == "s-void").all():
        rev = fs.create_finance_transaction_record(
            db, tenant_id=tid, transaction_type="reversal", status="approved", amount=D(str(original.amount)),
            source_code=fs.finance_account_code(db, tid, original.destination_account_id),
            destination_code=fs.finance_account_code(db, tid, original.source_account_id),
            created_by="mgr", reference=original.id, related_order_id="s-void",
        )
        fs.mark_original_transaction_reversed(db, rev, "mgr")
        fs.post_existing_transaction(db, rev, "mgr")
    db.commit()
    bridge.discard_pending(db)
    assert shadow.sync_tenant(db, tid) == 3
    roles = gl.accounts_by_role(db, tid)
    assert gl.account_balance(db, tid, roles["bank_main"]) == D("0.00")
    assert reconcile_dual_tenant(db, tid)["ok"]


def test_shadow_reconciliation_picks_dual_checks(db, tid):
    _dual(db, tid)
    sale = _legacy_card_sale(db, tid, "s-r", fee="0")
    bridge.emit_sale(db, tid, sale=sale, payments=[("card", sale.total)], actor="k", card_fee_percent=D("2"))
    db.commit()
    assert not reconcile_tenant(db, tid)["ok"]  # 1:1 checks no longer apply
    db.rollback()
    report = shadow.reconcile_tenant_shadow(db, tid)
    assert report["ok"] and report["mode"] == "dual"


# ─────────────────────────── real POS endpoint ───────────────────────────


def _pos_sale(monkeypatch, db, tid, method: str, price: str, fee: str = "2"):
    from app.routers import pos
    from app.schemas import SaleCreateIn, SaleItemIn

    monkeypatch.setattr(pos, "_active_shift", lambda *_: True)
    monkeypatch.setattr(pos, "_staff_shift_session_open", lambda *_: True)
    monkeypatch.setattr(pos, "_bank_commission_config", lambda *_: (D(fee), D("0.5")))
    tenant = db.query(Tenant).filter(Tenant.id == tid).one()
    payload = SaleCreateIn(cart_items=[SaleItemIn(item_name="Latte", price=D(price), qty=1, category="Qəhvə", is_coffee=True)],
                           payment_method=method)
    return pos.create_sale(payload=payload, db=db, tenant=tenant, user=SimpleNamespace(username="kassir", role="admin"))


def test_pos_create_sale_in_legacy_mode_is_unchanged(monkeypatch, db, tid):
    res = _pos_sale(monkeypatch, db, tid, "Kart", "10.00")
    assert res["sale_id"] and not _native(db, tid)
    assert db.query(FinanceTransaction).filter(FinanceTransaction.related_order_id == res["sale_id"]).count() == 2  # income + fee


def test_pos_create_sale_in_dual_mode(monkeypatch, db, tid):
    _dual(db, tid)
    res = _pos_sale(monkeypatch, db, tid, "Kart", "10.00")
    native = _native(db, tid)
    assert len(native) == 1 and native[0].source_id == res["sale_id"]
    assert db.query(GLLegacyLink).filter(GLLegacyLink.journal_id == native[0].id).count() == 2
    shadow.sync_tenant(db, tid)
    assert reconcile_dual_tenant(db, tid)["ok"]


def test_pos_nagd_legacy_misclassification_is_surfaced(monkeypatch, db, tid):
    """pos.py treats 'Nağd' as card (legacy bug). Native books it as cash; the diff is explained."""
    _dual(db, tid)
    _pos_sale(monkeypatch, db, tid, "Nağd", "10.00")
    diff = json.loads(db.query(GLLegacyLink).filter(GLLegacyLink.wallet_diff.isnot(None)).one().wallet_diff)
    assert diff == {"cash": "10.00", "card": "-9.80"}  # legacy: card +10 -0.20 fee; native: cash +10
    assert reconcile_dual_tenant(db, tid)["ok"]


def test_manual_gl_journals_are_explained_in_dual_reconciliation(db, tid):
    """Journals posted from the Finance v2 UI never reach legacy; they must not break the nightly check."""
    _dual(db, tid)
    journal = gl.create_journal(
        db, tenant_id=tid, journal_type="general", created_by="owner", description="manual",
        lines=[gl.LineIn(account="cash_drawer", debit=D("5")), gl.LineIn(account="other_income", credit=D("5"))],
        source_module="manual",
    )
    db.commit()
    report = reconcile_dual_tenant(db, tid)
    assert report["ok"], [c for c in report["checks"] if not c["ok"]]
    assert report["explained_differences"]["GLOnlyJournal"] == {"cash": "5.00"}

    # A reversal (inherits source_module) cancels the explained difference.
    rev = gl.reverse_journal(db, tid, journal.id, actor="owner", reason="undo")
    assert rev.status == "posted" and rev.source_module == "manual"
    db.commit()
    report = reconcile_dual_tenant(db, tid)
    assert report["ok"], [c for c in report["checks"] if not c["ok"]]
    assert "GLOnlyJournal" not in report["explained_differences"]


def test_manual_gl_journal_does_not_break_legacy_mode_reconciliation(db, tid):
    """Legacy-mode tenants (e.g. if the global API flag is ever on): reconcile_tenant only compares mirrored journals."""
    assert bridge.get_ledger_mode(db, tid) == "legacy"
    gl.create_journal(
        db, tenant_id=tid, journal_type="general", created_by="owner", description="manual",
        lines=[gl.LineIn(account="cash_drawer", debit=D("3")), gl.LineIn(account="other_income", credit=D("3"))],
        source_module="manual",
    )
    db.commit()
    report = reconcile_tenant(db, tid)
    assert report["ok"], [c for c in report["checks"] if not c["ok"]]
