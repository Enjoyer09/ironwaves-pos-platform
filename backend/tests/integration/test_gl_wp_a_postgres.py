"""Finance v2 WP-A on real PostgreSQL.

These depend on PostgreSQL semantics the SQLite tests cannot show: the immutability / balance triggers, the
``FOR UPDATE`` lock on the audit sequence used by the settings setters, and transaction poisoning after a failed
statement (one rolled-back ``--set dual`` must leave nothing behind, a rejected stock receipt must leave the session usable).

Requires INTEGRATION_DATABASE_URL pointing at a database migrated with ``alembic upgrade head``.
"""
from __future__ import annotations

import os
import uuid
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, text
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.core.config import settings
from app.gl import bridge
from app.gl import engine as gl
from app.gl import shadow
from app.gl.legacy_migration import migrate_tenant, reconcile_dual_tenant, reconcile_for_tenant, reconcile_tenant
from app.gl.models import GLAccount, GLAlert, GLAuditEvent, GLJournal, GLLegacyLink, GLSequence
from app.models import InventoryItem, Sale, Setting, Supplier, Tenant
from app.services import finance_service as fs

pytestmark = pytest.mark.integration

D = Decimal
ADMIN = SimpleNamespace(username="owner", role="admin")


def _url() -> str:
    raw = str(os.getenv("INTEGRATION_DATABASE_URL") or "").strip()
    if not raw.startswith("postgresql"):
        pytest.skip("INTEGRATION_DATABASE_URL (PostgreSQL) is not set")
    return raw


@pytest.fixture(scope="module")
def Session():
    engine = create_engine(_url(), future=True, pool_size=10)
    with engine.connect() as conn:
        if not conn.execute(text("select 1 from pg_trigger where tgname = 'trg_gl_journal_guard'")).first():
            pytest.skip("GL migration (triggers) not applied to the integration database")
    yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    engine.dispose()


def _new_tenant(Session, *, chart=True, legacy_capital=True) -> str:
    tid = str(uuid.uuid4())
    with Session() as s:
        s.add(Tenant(id=tid, name="WPA", slug=f"wpa-{tid[:10]}", domain=f"{tid[:10]}.wpa.test", status="active"))
        s.flush()
        if chart:
            gl.ensure_chart(s, tid)
        if legacy_capital:
            for code, amount in (("cash", "500"), ("card", "500"), ("safe", "200")):
                fs.post_finance_transaction(s, tenant_id=tid, transaction_type="investor_injection", amount=D(amount), source_code="investor",
                                            destination_code=code, created_by="owner", category="Təsisçi İnvestisiyası")
        s.commit()
    return tid


def _sale(s, tid, *, method="card", amount="20.00", cogs="6.00"):
    """A sale as pos.create_sale posts it: legacy postings, plus a native journal when the tenant is dual."""
    row = Sale(id=str(uuid.uuid4()), tenant_id=tid, cashier="k", payment_method="Kart" if method == "card" else method,
               total=D(amount), discount_amount=D("0"), cogs=D(cogs), items_json="[]", status="COMPLETED")
    s.add(row)
    s.flush()
    fs.post_sale_payment(s, tenant_id=tid, sale_id=row.id, amount=D(amount), payment_source="card" if method == "card" else "cash",
                         created_by="k", card_fee_percent=D("2") if method == "card" else D("0"))
    fs.post_sale_cogs(s, tenant_id=tid, sale_id=row.id, amount=D(cogs), created_by="k")
    bridge.emit_sale(s, tid, sale=row, payments=[(method, D(amount))], actor="k", card_fee_percent=D("2"))
    s.commit()
    return row


def _flip(s, tid, mode):
    bridge.set_ledger_mode(s, tid, mode, actor="owner", reason="pg flip")
    s.commit()


def _assert_mirrored_once(s, tid, phase):
    dupes = (s.query(GLJournal.legacy_ref).filter(GLJournal.tenant_id == tid, GLJournal.legacy_ref.isnot(None))
             .group_by(GLJournal.legacy_ref).having(func.count(GLJournal.id) > 1).all())
    assert dupes == [], f"{phase}: double mirror"
    mirrored = {r for (r,) in s.query(GLJournal.legacy_ref).filter(GLJournal.tenant_id == tid, GLJournal.legacy_ref.isnot(None)).all()}
    covered = {r for (r,) in s.query(GLLegacyLink.legacy_txn_id).filter(GLLegacyLink.tenant_id == tid).all()}
    assert mirrored & covered == set(), f"{phase}: mirrored and covered"
    assert gl.verify_audit_chain(s, tid)["valid"], f"{phase}: audit chain"


def _nightly_ok(s, tid, phase):
    report = shadow.reconcile_tenant_shadow(s, tid)
    failed = [c["check"] for c in report["checks"] if not c["ok"]]
    assert report["ok"], f"{phase}: {failed}"
    assert s.query(GLAlert).filter(GLAlert.tenant_id == tid, GLAlert.alert_type == "reconcile_failed", GLAlert.status == "open").count() == 0
    _assert_mirrored_once(s, tid, phase)
    return report


# ───────────────────────────── R3: the flip scenario on PostgreSQL ─────────────────────────────


def test_flip_dual_legacy_dual_keeps_the_nightly_reconcile_green(Session):
    from app.routers import analytics_api

    tid = _new_tenant(Session)
    with Session() as s:
        migrate_tenant(s, tid)
        s.commit()
        _sale(s, tid)
        _sale(s, tid, method="cash", amount="12.00", cogs="3.00")
        report_a = _nightly_ok(s, tid, "A legacy")

        _flip(s, tid, "dual")
        dual_era = _sale(s, tid)
        _sale(s, tid, method="cash", amount="8.00", cogs="2.00")
        _nightly_ok(s, tid, "B dual")

        _flip(s, tid, "legacy")
        _sale(s, tid)
        tenant_obj = SimpleNamespace(id=tid)
        analytics_api.void_sale(dual_era.id, analytics_api.SaleVoidIn(reason="səhv"), db=s, tenant=tenant_obj, user=ADMIN)
        report_c = _nightly_ok(s, tid, "C legacy after dual")
        plain = reconcile_tenant(s, tid)
        s.rollback()
        assert plain["ok"] is False  # the 1:1 reconciler cannot judge an ever-dual tenant: why the selection follows history

        _flip(s, tid, "dual")
        _sale(s, tid)
        _nightly_ok(s, tid, "D dual again")
        assert reconcile_dual_tenant(s, tid)["ok"]
        assert shadow.sync_tenant(s, tid) == 0
        _assert_mirrored_once(s, tid, "D after extra sync")
    assert report_a["reconciler"] == "single" and report_a["ever_dual"] is False
    assert report_c["reconciler"] == "dual" and report_c["ever_dual"] is True


# ───────────────────────────── settings setters under the audit sequence lock ─────────────────────────────


def test_settings_setters_are_audited_and_idempotent_on_pg(Session):
    tid = _new_tenant(Session, chart=False, legacy_capital=False)
    with Session() as s:
        assert bridge.set_ui_visible(s, tid, True, actor="cli", reason="on")["from"] is None  # insert path (creates the audit sequence)
        assert bridge.set_ui_visible(s, tid, False, actor="cli", reason="off")["from"] is True  # update path (FOR UPDATE on the sequence)
        bridge.set_require_supplier(s, tid, True, actor="cli", reason="on")
        bridge.set_require_supplier(s, tid, True, actor="cli", reason="again")
        s.commit()
    with Session() as s:
        for key in ("finance_v2_ui_visible", "finance_v2_require_supplier"):
            assert s.query(Setting).filter(Setting.tenant_id == tid, Setting.key == key).count() == 1
        assert bridge.is_ui_visible(s, tid) is False and bridge.require_supplier(s, tid) is True
        events = s.query(GLAuditEvent).filter(GLAuditEvent.tenant_id == tid).order_by(GLAuditEvent.seq).all()
        assert [e.event_type for e in events] == ["UI_VISIBILITY_CHANGED", "UI_VISIBILITY_CHANGED", "REQUIRE_SUPPLIER_CHANGED", "REQUIRE_SUPPLIER_CHANGED"]
        assert [e.seq for e in events] == [1, 2, 3, 4]
        assert gl.verify_audit_chain(s, tid)["valid"] is True


# ───────────────────────────── gl_ledger_mode.py --set dual on PostgreSQL ─────────────────────────────


@pytest.fixture()
def cli(Session, monkeypatch):
    from scripts import gl_ledger_mode

    monkeypatch.setattr(gl_ledger_mode, "SessionLocal", Session)
    monkeypatch.setattr(settings, "database_url", "postgresql://postgres:x@127.0.0.1:5432/throwaway")  # not production
    return gl_ledger_mode


def _legacy_sales(Session, tid, n=3):
    with Session() as s:
        for _ in range(n):
            fs.post_finance_transaction(s, tenant_id=tid, transaction_type="income", amount=D("10.00"), source_code="revenue",
                                        destination_code="cash", created_by="k", category="Satış (Nağd)", related_order_id=str(uuid.uuid4()))
        s.commit()


def test_set_dual_creates_chart_and_mirrors_on_pg(Session, cli, capsys):
    tid = _new_tenant(Session, chart=False)
    _legacy_sales(Session, tid)
    code = cli.main(["--tenant", tid, "--set", "dual", "--reason", "it"])
    out = capsys.readouterr()
    assert code == 0, out.err
    with Session() as s:
        assert s.query(GLAccount).filter(GLAccount.tenant_id == tid).count() > 0
        assert bridge.get_ledger_mode(s, tid) == "dual"
        report = reconcile_for_tenant(s, tid)
        assert report["ok"] and report["reconciler"] == "dual"
        assert gl.verify_audit_chain(s, tid)["valid"]


def test_failed_reconcile_rolls_back_chart_mirror_and_mode_on_pg(Session, cli, capsys, monkeypatch):
    tid = _new_tenant(Session, chart=False)
    _legacy_sales(Session, tid)
    monkeypatch.setattr(cli, "reconcile_for_tenant",
                        lambda db, t: {"ok": False, "checks": [{"check": "forced", "ok": False}], "reconciler": "dual", "ever_dual": True})
    code = cli.main(["--tenant", tid, "--set", "dual", "--reason", "it"])
    assert code == 1 and "forced" in capsys.readouterr().err
    with Session() as s:
        assert s.query(GLAccount).filter(GLAccount.tenant_id == tid).count() == 0
        assert s.query(GLJournal).filter(GLJournal.tenant_id == tid).count() == 0
        assert s.query(GLAuditEvent).filter(GLAuditEvent.tenant_id == tid).count() == 0
        assert bridge.get_ledger_mode(s, tid) == "legacy"
        assert s.query(GLSequence).filter(GLSequence.tenant_id == tid).count() == 0


def test_set_legacy_after_dual_passes_its_reconcile_on_pg(Session, cli, capsys):
    """R3 through the real script: before the fix this aborted with the 1:1 reconciler failing on the native journals."""
    tid = _new_tenant(Session)
    with Session() as s:
        migrate_tenant(s, tid)
        s.commit()
    assert cli.main(["--tenant", tid, "--set", "dual", "--reason", "it"]) == 0
    with Session() as s:
        _sale(s, tid)
    capsys.readouterr()
    assert cli.main(["--tenant", tid, "--set", "legacy", "--reason", "back"]) == 0
    out = capsys.readouterr()
    assert "WARNING" in out.err and "ok=True" in out.out


# ───────────────────────────── stock receipts: the setting, and a usable transaction after a 400 ─────────────────────────────


def _dual_tenant(Session) -> str:
    tid = _new_tenant(Session)
    with Session() as s:
        migrate_tenant(s, tid)
        bridge.set_ledger_mode(s, tid, "dual", actor="owner", reason="pg")
        s.commit()
    return tid


def _restock(s, tid, item_id, **kw):
    from app.routers import catalog
    from app.schemas import InventoryRestockIn

    return catalog.restock_inventory_item(item_id, InventoryRestockIn(qty_added=D("10"), total_price=D("50"), **kw),
                                          db=s, tenant=SimpleNamespace(id=tid), user=ADMIN)


def test_restock_setting_controls_the_supplier_rule_on_pg(Session):
    from fastapi import HTTPException

    tid = _dual_tenant(Session)
    with Session() as s:
        item = InventoryItem(tenant_id=tid, name="Un", unit="kg", stock_qty=D("0"), unit_cost=D("0"), min_limit=D("0"))
        s.add(item)
        sup = Supplier(tenant_id=tid, name="Dəyirman", balance=D("0"))
        s.add(sup)
        s.commit()
        item_id, sup_id = item.id, sup.id

    with Session() as s:  # dual, setting absent: no supplier needed
        assert D(_restock(s, tid, item_id, payment_source="payable")["stock_qty"]) == D("10")
        shadow.sync_tenant(s, tid)
        assert reconcile_dual_tenant(s, tid)["ok"]
        bridge.set_require_supplier(s, tid, True, actor="cli", reason="policy")
        s.commit()

    with Session() as s:  # setting on: 400, and the SAME session stays usable afterwards
        with pytest.raises(HTTPException) as exc:
            _restock(s, tid, item_id, payment_source="payable")
        assert exc.value.status_code == 400 and exc.value.detail["code"] == "supplier_required"
        s.rollback()
        s.add(Setting(tenant_id=tid, key="probe", value="still usable"))
        s.commit()  # would raise InFailedSqlTransaction if the 400 had poisoned the transaction
        assert s.query(Setting).filter(Setting.tenant_id == tid, Setting.key == "probe").count() == 1
        assert D(str(s.get(InventoryItem, item_id).stock_qty)) == D("10")  # unchanged by the rejected receipt
        assert D(_restock(s, tid, item_id, supplier_id=sup_id, payment_source="payable")["stock_qty"]) == D("20")
        shadow.sync_tenant(s, tid)
        assert reconcile_dual_tenant(s, tid)["ok"]
