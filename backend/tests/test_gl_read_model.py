"""Finance v2 P2c: GL-served finance screens (balances, expected cash, overview) and parity."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import bridge, read_model
from app.gl import engine as gl
from app.gl.engine import GLError
from app.gl.legacy_migration import migrate_tenant
from app.models import Sale, Shift, Tenant
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
    t = Tenant(id=str(uuid.uuid4()), name="Demo", slug="demo", domain="demo.test", status="active")
    db.add(t)
    db.flush()
    gl.ensure_chart(db, t.id)
    fs.post_finance_transaction(db, tenant_id=t.id, transaction_type="investor_injection", amount=D("100"), source_code="investor",
                                destination_code="cash", created_by="owner", category="Təsisçi İnvestisiyası")
    db.commit()
    migrate_tenant(db, t.id)
    return t


def _to_gl(db, t):
    bridge.set_ledger_mode(db, t.id, "dual", actor="owner", reason="t")
    read_model.set_reports_source(db, t.id, "gl", actor="owner", reason="t")
    db.commit()


def _card_sale(db, t, amount="50.00", fee="2", legacy_fee=True):
    sale = Sale(id=str(uuid.uuid4()), tenant_id=t.id, cashier="k", payment_method="Kart", total=D(amount), discount_amount=D("0"),
                cogs=D("0"), items_json="[]", status="COMPLETED")
    db.add(sale)
    db.flush()
    fs.post_sale_payment(db, tenant_id=t.id, sale_id=sale.id, amount=D(amount), payment_source="card", created_by="k",
                         card_fee_percent=D(fee) if legacy_fee else D("0"))
    bridge.emit_sale(db, t.id, sale=sale, payments=[("card", D(amount))], actor="k", card_fee_percent=D(fee))
    db.commit()
    return sale


def test_reports_source_requires_dual(db, tenant):
    assert read_model.reports_source(db, tenant.id) == "legacy"
    with pytest.raises(GLError) as exc:
        read_model.set_reports_source(db, tenant.id, "gl", actor="o", reason="x")
    assert exc.value.code == "requires_dual_mode"


def test_legacy_default_is_untouched(db, tenant):
    """With the default source, the dispatch returns exactly the legacy implementation."""
    assert fs.ledger_balances_snapshot(db, tenant.id) == fs._legacy_ledger_balances_snapshot(db, tenant.id)


def test_gl_balances_match_legacy_shape_and_values(db, tenant):
    _to_gl(db, tenant)
    _card_sale(db, tenant)
    legacy = fs._legacy_ledger_balances_snapshot(db, tenant.id)
    served = fs.ledger_balances_snapshot(db, tenant.id)
    assert set(legacy) <= set(served)
    for code in ("cash", "card", "safe", "investor", "debt", "deposit"):
        assert served[code] == legacy[code], code
    assert served["card"] == D("49.00")


def test_gl_balances_include_explained_difference(db, tenant):
    _to_gl(db, tenant)
    _card_sale(db, tenant, legacy_fee=False)  # legacy forgets the fee (table checks)
    assert fs._legacy_ledger_balances_snapshot(db, tenant.id)["card"] == D("50.00")
    assert fs.ledger_balances_snapshot(db, tenant.id)["card"] == D("49.00")
    parity = read_model.parity_report(db, tenant.id)
    card = [r for r in parity["balances"] if r["code"] == "card"][0]
    assert card["explained_diff"] == "-1.00" and card["ok"] and parity["ok"]


def test_gl_reads_catch_up_unmirrored_legacy_postings(db, tenant):
    _to_gl(db, tenant)
    fs.post_finance_transaction(db, tenant_id=tenant.id, transaction_type="internal_transfer", amount=D("30"), source_code="cash",
                                destination_code="safe", created_by="mgr", category="Daxili Transfer")
    db.commit()  # unhooked flow, shadow job has not run yet
    served = fs.ledger_balances_snapshot(db, tenant.id)
    assert served["cash"] == D("70.00") and served["safe"] == D("30.00")


def test_gl_expected_cash_for_shift(db, tenant):
    _to_gl(db, tenant)
    opened = datetime.utcnow() + timedelta(microseconds=1)  # after the fixture's 100 ₼ injection
    shift = Shift(tenant_id=tenant.id, status="open", opened_by="k", opened_at=opened, opening_cash=D("100.00"))
    db.add(shift)
    db.commit()
    sale = Sale(id=str(uuid.uuid4()), tenant_id=tenant.id, cashier="k", payment_method="Nəğd", total=D("12.00"),
                discount_amount=D("0"), cogs=D("0"), items_json="[]", status="COMPLETED")
    db.add(sale)
    db.flush()
    fs.post_sale_payment(db, tenant_id=tenant.id, sale_id=sale.id, amount=D("12.00"), payment_source="cash", created_by="k")
    bridge.emit_sale(db, tenant.id, sale=sale, payments=[("cash", D("12.00"))], actor="k")
    db.commit()
    served = fs.shift_cash_breakdown_from_ledger(db, tenant.id, shift, lock_for_update=True)
    legacy = fs._legacy_shift_cash_breakdown(db, tenant.id, shift)
    assert served == legacy == {"opening_cash": D("100.00"), "cash_in": D("12.00"), "cash_out": D("0.00"), "expected_cash": D("112.00")}


def test_x_report_uses_gl_expected_cash(db, tenant):
    from app.routers import reports
    from app.schemas import XReportIn

    _to_gl(db, tenant)
    db.add(Shift(tenant_id=tenant.id, status="open", opened_by="k", opened_at=datetime.utcnow() + timedelta(microseconds=1), opening_cash=D("100.00")))
    db.commit()
    res = reports.x_report(XReportIn(actual_cash=D("98.00")), db=db, tenant=tenant, user=ADMIN)
    assert res["expected_cash"] == "100.00" and res["difference"] == "-2.00"
    # The variance is posted natively; the drawer is now 98 in both ledgers.
    assert fs.ledger_balances_snapshot(db, tenant.id)["cash"] == D("98.00")
    assert fs._legacy_ledger_balances_snapshot(db, tenant.id)["cash"] == D("98.00")


def test_overview_is_served_from_gl_with_same_keys(db, tenant):
    from app.routers import finance

    legacy_view = finance.get_finance_reports_overview(date_from=None, date_to=None, db=db, tenant=tenant, user=ADMIN)
    _to_gl(db, tenant)
    _card_sale(db, tenant)
    gl_view = finance.get_finance_reports_overview(date_from=None, date_to=None, db=db, tenant=tenant, user=ADMIN)
    assert gl_view["source"] == "gl"
    for section in ("balance_sheet", "profit_loss", "cash_flow"):
        missing = set(legacy_view[section]) - set(gl_view[section])
        assert not missing, (section, missing)
    assert gl_view["balance_sheet"]["balanced"] is True
    assert gl_view["profit_loss"]["revenue"] == "50.00" and gl_view["profit_loss"]["net_profit"] == "49.00"
    assert gl_view["cash_flow"]["operating_inflow"] == "49.00" and gl_view["cash_flow"]["financing_inflow"] == "100.00"


def test_balances_endpoint_serves_gl(db, tenant):
    from app.routers import finance

    _to_gl(db, tenant)
    _card_sale(db, tenant, legacy_fee=False)
    assert finance.get_balances(db=db, tenant=tenant, user=ADMIN)["card"] == "49.00"


def test_legacy_ledger_mode_blocked_while_reports_on_gl(db, tenant):
    _to_gl(db, tenant)
    read_model.set_reports_source(db, tenant.id, "legacy", actor="owner", reason="rollback")
    db.commit()
    assert fs.ledger_balances_snapshot(db, tenant.id) == fs._legacy_ledger_balances_snapshot(db, tenant.id)


def test_shift_window_is_identical_in_both_ledgers(db, tenant):
    """A shift opened *before* earlier postings sees them in both ledgers alike."""
    _to_gl(db, tenant)
    shift = Shift(tenant_id=tenant.id, status="open", opened_by="k", opened_at=datetime.utcnow() - timedelta(minutes=5), opening_cash=D("0"))
    db.add(shift)
    db.commit()
    served = fs.shift_cash_breakdown_from_ledger(db, tenant.id, shift)
    assert served == fs._legacy_shift_cash_breakdown(db, tenant.id, shift)
    assert served["cash_in"] == D("100.00")


def test_open_shift_with_float_under_gl_reports(db, tenant, monkeypatch):
    """Day opening with a top-up from the safe: GL opening = drawer before + float; the float is not counted twice."""
    from app.routers import reports
    from app.schemas import OpenShiftIn

    fs.post_finance_transaction(db, tenant_id=tenant.id, transaction_type="internal_transfer", amount=D("200"), source_code="investor",
                                destination_code="safe", created_by="owner", category="Daxili Transfer")
    db.commit()
    _to_gl(db, tenant)
    res = reports.open_shift(OpenShiftIn(funding_source="safe", topup_amount=D("50"), target_cash=D("150")), db=db, tenant=tenant, user=ADMIN)
    assert res["opening_cash"] == "150.00"
    shift = db.query(Shift).filter(Shift.id == res["shift_id"]).one()
    assert fs.shift_cash_breakdown_from_ledger(db, tenant.id, shift)["expected_cash"] == D("150.00")
    assert fs.ledger_balances_snapshot(db, tenant.id)["cash"] == D("150.00")
