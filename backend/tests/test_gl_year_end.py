"""Fiscal year-end close: P&L to retained earnings, locked year, reports unchanged, reopen via four-eyes storno."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.gl.models  # noqa: F401
import app.models  # noqa: F401
from app.db import Base
from app.gl import engine as gl
from app.gl import reports, tax
from app.gl import read_model
from app.gl.engine import GLError, LineIn
from app.gl.year_end import close_fiscal_year, request_reopen_fiscal_year, year_status
from app.models import Tenant

D = Decimal
YEAR = 2025  # business_today() is in 2026 in this suite's reality; any finished year works


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine("sqlite://", future=True, connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _connect(dbapi_conn, _):
        dbapi_conn.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    monkeypatch.setattr(gl, "business_today", lambda: date(2026, 3, 10))
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
def tid(db):
    t = str(uuid.uuid4())
    db.add(Tenant(id=t, name="T", slug=f"t-{t[:8]}", domain=f"{t[:8]}.test", status="active"))
    db.flush()
    gl.ensure_chart(db, t)
    post(db, t, date(YEAR, 1, 5), [("cash_drawer", "1000", "0"), ("share_capital", "0", "1000")])
    post(db, t, date(YEAR, 3, 10), [("cash_drawer", "500", "0"), ("sales_revenue", "0", "500")])
    post(db, t, date(YEAR, 6, 1), [("rent_expense", "120", "0"), ("cash_drawer", "0", "120")])
    post(db, t, date(YEAR, 12, 20), [("cash_drawer", "30", "0"), ("sales_revenue", "0", "30")], branch="b-2")
    db.commit()
    return t


def post(db, tid, when, lines, branch=None):
    return gl.create_journal(
        db, tenant_id=tid, journal_type="general", created_by="owner", posting_date=when, description="t",
        lines=[LineIn(account=a, debit=D(d), credit=D(c), branch_id=branch) for a, d, c in lines],
    )


def soft_close_year(db, tid, year=YEAR):
    for p in db.query(app.gl.models.GLFiscalPeriod).filter_by(tenant_id=tid, year=year).all():
        gl.set_period_status(db, tid, year=year, month=p.month, status="soft_closed", actor="cfo")
    db.commit()


def test_status_lists_blockers_until_periods_are_soft_closed(db, tid):
    status = year_status(db, tid, YEAR)
    assert not status["closed"] and "open_periods" in status["blockers"] and not status["can_close"]
    assert status["net_result_to_close"] == "410.00"  # 530 revenue - 120 rent
    with pytest.raises(GLError) as err:
        close_fiscal_year(db, tid, YEAR, actor="cfo")
    assert err.value.code == "open_periods"
    assert "year_not_ended" in year_status(db, tid, 2026)["blockers"]


def test_close_moves_result_to_retained_earnings_and_keeps_reports(db, tid):
    pl_before = reports.profit_and_loss(db, tid, date_from=date(YEAR, 1, 1), date_to=date(YEAR, 12, 31))
    dec_base_before = tax._period_revenue_base(db, tid, gl.get_or_create_period(db, tid, date(YEAR, 12, 1)))
    soft_close_year(db, tid)
    journal = close_fiscal_year(db, tid, YEAR, actor="cfo")
    db.commit()
    assert journal.journal_type == "closing" and journal.status == "posted" and journal.posting_date == date(YEAR, 12, 31)

    roles = gl.accounts_by_role(db, tid)
    assert gl.account_balance(db, tid, roles["sales_revenue"]) == D("0.00")
    assert gl.account_balance(db, tid, roles["rent_expense"]) == D("0.00")
    assert gl.account_balance(db, tid, roles["retained_earnings"]) == D("410.00")

    # The year's income statement and tax base do not change because of closing.
    pl_after = reports.profit_and_loss(db, tid, date_from=date(YEAR, 1, 1), date_to=date(YEAR, 12, 31))
    assert pl_after["net_profit"] == pl_before["net_profit"] == "410.00"
    assert tax._period_revenue_base(db, tid, gl.get_or_create_period(db, tid, date(YEAR, 12, 1))) == dec_base_before

    bs = reports.balance_sheet(db, tid, as_of=date(2026, 1, 31))
    assert bs["balanced"]
    unclosed = next(line for line in bs["equity"]["lines"] if line["code"] == "341*")
    assert unclosed["amount"] == "0.00"
    assert any(line["code"] == "343" and line["amount"] == "410.00" for line in bs["equity"]["lines"])
    tb = reports.trial_balance(db, tid)
    assert tb["balanced"]

    # Branch results close within their branch.
    branch_343 = [l for l in gl._journal_lines(db, journal) if l.account_id == roles["retained_earnings"].id]
    assert {(l.branch_id, str(l.credit)) for l in branch_343} == {(None, "380.00"), ("b-2", "30.00")}

    # Legacy-shaped wallet balances stay cumulative (legacy never closes years).
    wallets = read_model.gl_wallet_balances(db, tid, sync=False)
    assert wallets["revenue"] == D("530.00") and wallets["expense"] == D("120.00")

    status = year_status(db, tid, YEAR)
    assert status["closed"] and status["closing_journal"]["id"] == journal.id
    with pytest.raises(GLError) as err:
        close_fiscal_year(db, tid, YEAR, actor="cfo")
    assert err.value.code == "year_already_closed"
    assert gl.verify_audit_chain(db, tid)["valid"]


def test_closed_year_rejects_new_postings_but_current_year_works(db, tid):
    soft_close_year(db, tid)
    close_fiscal_year(db, tid, YEAR, actor="cfo")
    db.commit()
    for p in db.query(app.gl.models.GLFiscalPeriod).filter_by(tenant_id=tid, year=YEAR, month=12).all():
        gl.set_period_status(db, tid, year=YEAR, month=12, status="open", actor="cfo", reason="late invoice")
    with pytest.raises(GLError) as err:
        post(db, tid, date(YEAR, 12, 30), [("rent_expense", "5", "0"), ("cash_drawer", "0", "5")])
    assert err.value.code == "year_closed"
    db.rollback()
    assert post(db, tid, date(2026, 1, 3), [("rent_expense", "5", "0"), ("cash_drawer", "0", "5")]).status == "posted"


def test_reopen_needs_second_person_and_restores_pl_balances(db, tid):
    soft_close_year(db, tid)
    journal = close_fiscal_year(db, tid, YEAR, actor="cfo")
    db.commit()
    reversal = request_reopen_fiscal_year(db, tid, YEAR, actor="cfo", reason="audit adjustment")
    db.commit()
    assert reversal.status == "pending_approval" and reversal.posting_date == date(YEAR, 12, 31)
    assert year_status(db, tid, YEAR)["closed"]  # still closed until approved
    with pytest.raises(GLError):
        gl.approve_journal(db, tid, reversal.id, approver="cfo", allow_soft_closed=True)
    db.rollback()
    gl.approve_journal(db, tid, reversal.id, approver="owner", allow_soft_closed=True)
    db.commit()
    roles = gl.accounts_by_role(db, tid)
    assert gl.account_balance(db, tid, roles["retained_earnings"]) == D("0.00")
    assert gl.account_balance(db, tid, roles["sales_revenue"]) == D("530.00")
    status = year_status(db, tid, YEAR)
    assert not status["closed"] and status["can_close"]

    # Correct and close again: a new closing journal (idempotency key attempt 2).
    again = close_fiscal_year(db, tid, YEAR, actor="cfo")
    db.commit()
    assert again.id != journal.id and gl.account_balance(db, tid, roles["retained_earnings"]) == D("410.00")
