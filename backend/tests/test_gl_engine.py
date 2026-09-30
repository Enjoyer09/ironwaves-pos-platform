"""Finance v2 GL core — behavioural tests on a real SQLite database."""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401 - register GL tables
import app.models  # noqa: F401
from app.db import Base
from app.gl import engine as gl
from app.gl import reports, tax
from app.gl.coa_az import AMHP_ACCOUNTS, REQUIRED_ROLES
from app.gl.engine import GLError, LineIn
from app.gl.models import GLAccount, GLAuditEvent, GLJournal
from app.models import Tenant

D = Decimal
MAY = date(2026, 5, 10)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", future=True)

    # pysqlite: let SQLAlchemy manage BEGIN so SAVEPOINTs (begin_nested) work.
    @event.listens_for(engine, "connect")
    def _connect(dbapi_conn, _):
        dbapi_conn.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _tenant(db) -> str:
    tid = str(uuid.uuid4())
    db.add(Tenant(id=tid, name="T", slug=f"t-{tid[:8]}", domain=f"{tid[:8]}.test", status="active"))
    db.flush()
    gl.ensure_chart(db, tid)
    return tid


@pytest.fixture()
def tid(db):
    return _tenant(db)


def _post(db, tid, lines, *, on=MAY, key=None, approval=False, jtype="general", user="alice"):
    return gl.create_journal(db, tenant_id=tid, journal_type=jtype, lines=lines, created_by=user, posting_date=on,
                             description="test", idempotency_key=key, require_approval=approval)


def _capital(db, tid, amount="1000.00", on=MAY):
    return _post(db, tid, [LineIn("cash_drawer", debit=amount), LineIn("share_capital", credit=amount)], on=on)


def _bal(db, tid, role):
    return gl.account_balance(db, tid, gl.accounts_by_role(db, tid)[role])


# ─────────────────────────── chart ───────────────────────────


def test_chart_seed_is_complete_and_idempotent(db, tid):
    accounts = db.query(GLAccount).filter(GLAccount.tenant_id == tid).all()
    assert len(accounts) == len(AMHP_ACCOUNTS)
    assert set(gl.accounts_by_role(db, tid)) >= REQUIRED_ROLES
    gl.ensure_chart(db, tid)
    assert db.query(GLAccount).filter(GLAccount.tenant_id == tid).count() == len(AMHP_ACCOUNTS)
    by_code = {a.code: a for a in accounts}
    assert by_code["221"].is_postable is False and by_code["221.1"].is_postable is True
    assert by_code["602"].normal_side == "debit"  # contra revenue
    assert by_code["221.1"].allow_negative is False


def test_header_account_cannot_be_posted(db, tid):
    with pytest.raises(GLError) as exc:
        _post(db, tid, [LineIn("221", debit="10"), LineIn("share_capital", credit="10")])
    assert exc.value.code == "account_not_postable"


def test_subaccount_creation(db, tid):
    acc = gl.create_subaccount(db, tid, parent_code="223", code="223.2", name="Kapital Bank", actor="admin")
    assert acc.is_postable and acc.account_type == "asset"
    _post(db, tid, [LineIn("223.2", debit="50"), LineIn("share_capital", credit="50")])
    with pytest.raises(GLError):
        gl.create_subaccount(db, tid, parent_code="223", code="224.1", name="bad", actor="admin")


# ─────────────────────────── validation ───────────────────────────


@pytest.mark.parametrize(
    "lines,code",
    [
        ([LineIn("cash_drawer", debit="10"), LineIn("share_capital", credit="9.99")], "unbalanced"),
        ([LineIn("cash_drawer", debit="10")], "too_few_lines"),
        ([LineIn("cash_drawer", debit="10", credit="10"), LineIn("share_capital", credit="0")], "invalid_line"),
        ([LineIn("cash_drawer", debit="-10"), LineIn("share_capital", credit="-10")], "negative_amount"),
        ([LineIn("cash_drawer", debit="10.001"), LineIn("share_capital", credit="10.001")], "invalid_amount"),
        ([LineIn("cash_drawer", debit="NaN"), LineIn("share_capital", credit="NaN")], "invalid_amount"),
        ([LineIn("no-such-account", debit="1"), LineIn("share_capital", credit="1")], "account_not_found"),
    ],
)
def test_invalid_journals_are_rejected(db, tid, lines, code):
    with pytest.raises(GLError) as exc:
        _post(db, tid, lines)
    assert exc.value.code == code
    assert db.query(GLJournal).filter(GLJournal.tenant_id == tid).count() == 0


def test_compound_journal_posts_and_updates_balances(db, tid):
    _capital(db, tid, "500.00")
    # Card sale 100 with 2% bank fee and COGS — a single compound journal.
    j = _post(db, tid, [
        LineIn("bank_main", debit="98.00"),
        LineIn("bank_fees", debit="2.00"),
        LineIn("sales_revenue", credit="100.00"),
        LineIn("cogs", debit="30.00"),
        LineIn("inventory", credit="30.00"),
    ], jtype="sales")
    assert j.status == "posted" and j.journal_no == "JV-2026-000002"
    assert _bal(db, tid, "bank_main") == D("98.00")
    assert _bal(db, tid, "sales_revenue") == D("100.00")
    assert _bal(db, tid, "inventory") == D("-30.00")
    assert reports.verify_materialized_balances(db, tid)["valid"]


def test_cash_drawer_cannot_go_negative_but_can_receive(db, tid):
    _capital(db, tid, "100.00")
    with pytest.raises(GLError) as exc:
        _post(db, tid, [LineIn("general_expense", debit="100.01"), LineIn("cash_drawer", credit="100.01")])
    assert exc.value.code == "insufficient_balance"
    db.rollback()


def test_idempotency_returns_same_journal_and_detects_conflict(db, tid):
    a = _post(db, tid, [LineIn("cash_drawer", debit="10"), LineIn("sales_revenue", credit="10")], key="sale:1")
    b = _post(db, tid, [LineIn("cash_drawer", debit="10"), LineIn("sales_revenue", credit="10")], key="sale:1")
    assert a.id == b.id
    assert _bal(db, tid, "cash_drawer") == D("10.00")
    with pytest.raises(GLError) as exc:
        _post(db, tid, [LineIn("cash_drawer", debit="11"), LineIn("sales_revenue", credit="11")], key="sale:1")
    assert exc.value.code == "idempotency_conflict"


def test_journal_numbers_are_gapless_per_year(db, tid):
    nos = [_capital(db, tid, "1.00").journal_no for _ in range(3)]
    nos.append(_capital(db, tid, "1.00", on=date(2027, 1, 2)).journal_no)
    assert nos == ["JV-2026-000001", "JV-2026-000002", "JV-2026-000003", "JV-2027-000001"]


def test_tenants_are_isolated(db, tid):
    other = _tenant(db)
    other_cash = db.query(GLAccount).filter(GLAccount.tenant_id == other, GLAccount.system_role == "cash_drawer").one()
    with pytest.raises(GLError):
        _post(db, tid, [LineIn(other_cash.id, debit="5"), LineIn("share_capital", credit="5")])


# ─────────────────────────── approvals / reversal ───────────────────────────


def test_approval_flow_and_maker_checker(db, tid):
    _capital(db, tid, "200.00")
    j = _post(db, tid, [LineIn("general_expense", debit="50"), LineIn("cash_drawer", credit="50")], approval=True)
    assert j.status == "pending_approval" and j.journal_no is None
    assert _bal(db, tid, "cash_drawer") == D("200.00")  # nothing hits the ledger yet
    with pytest.raises(GLError) as exc:
        gl.approve_journal(db, tid, j.id, approver="ALICE ")
    assert exc.value.code == "self_approval"
    gl.approve_journal(db, tid, j.id, approver="bob")
    assert j.status == "posted" and _bal(db, tid, "cash_drawer") == D("150.00")


def test_approval_rechecks_balance_at_post_time(db, tid):
    _capital(db, tid, "100.00")
    a = _post(db, tid, [LineIn("investor_loan", debit="80"), LineIn("cash_drawer", credit="80")], approval=True)
    b = _post(db, tid, [LineIn("investor_loan", debit="80"), LineIn("cash_drawer", credit="80")], approval=True)
    gl.approve_journal(db, tid, a.id, approver="bob")
    with pytest.raises(GLError) as exc:
        gl.approve_journal(db, tid, b.id, approver="bob")
    assert exc.value.code == "insufficient_balance"


def test_reject_requires_reason(db, tid):
    j = _post(db, tid, [LineIn("cash_drawer", debit="5"), LineIn("share_capital", credit="5")], approval=True)
    with pytest.raises(GLError):
        gl.reject_journal(db, tid, j.id, actor="bob", reason=" ")
    gl.reject_journal(db, tid, j.id, actor="bob", reason="duplicate")
    assert j.status == "rejected"


def test_reversal_swaps_lines_and_nets_to_zero(db, tid):
    j = _post(db, tid, [LineIn("cash_drawer", debit="40"), LineIn("sales_revenue", credit="40")])
    r = gl.reverse_journal(db, tid, j.id, actor="bob", reason="wrong entry")
    assert r.status == "posted" and r.reversal_of_id == j.id and j.reversed_by_id == r.id
    assert _bal(db, tid, "cash_drawer") == D("0.00") and _bal(db, tid, "sales_revenue") == D("0.00")
    with pytest.raises(GLError) as exc:
        gl.reverse_journal(db, tid, j.id, actor="bob", reason="again")
    assert exc.value.code == "already_reversed"
    with pytest.raises(GLError):
        gl.reverse_journal(db, tid, r.id, actor="bob", reason="reverse the reversal")


def test_pending_reversal_links_on_approval_and_can_be_retried_after_reject(db, tid):
    j = _post(db, tid, [LineIn("cash_drawer", debit="40"), LineIn("sales_revenue", credit="40")])
    r1 = gl.reverse_journal(db, tid, j.id, actor="alice", reason="x", require_approval=True)
    with pytest.raises(GLError) as exc:
        gl.reverse_journal(db, tid, j.id, actor="alice", reason="x", require_approval=True)
    assert exc.value.code == "reversal_pending"
    gl.reject_journal(db, tid, r1.id, actor="bob", reason="not needed")
    r2 = gl.reverse_journal(db, tid, j.id, actor="alice", reason="y", require_approval=True)
    gl.approve_journal(db, tid, r2.id, approver="bob")
    assert j.reversed_by_id == r2.id


# ─────────────────────────── periods ───────────────────────────


def test_closed_period_blocks_posting_and_reversal_moves_to_open_period(db, tid):
    j = _post(db, tid, [LineIn("cash_drawer", debit="30"), LineIn("sales_revenue", credit="30")], on=date(2026, 4, 20))
    gl.set_period_status(db, tid, year=2026, month=4, status="closed", actor="cfo")
    with pytest.raises(GLError) as exc:
        _capital(db, tid, "1.00", on=date(2026, 4, 21))
    assert exc.value.code == "period_closed"
    r = gl.reverse_journal(db, tid, j.id, actor="cfo", reason="late correction")
    assert r.posting_date == gl.business_today()


def test_soft_closed_requires_controller_flag(db, tid):
    gl.set_period_status(db, tid, year=2026, month=5, status="soft_closed", actor="cfo")
    with pytest.raises(GLError) as exc:
        _capital(db, tid)
    assert exc.value.code == "period_soft_closed"
    gl.create_journal(db, tenant_id=tid, journal_type="adjustment", created_by="cfo", posting_date=MAY, allow_soft_closed=True,
                      lines=[LineIn("cash_drawer", debit="1"), LineIn("share_capital", credit="1")])


def test_period_close_rules(db, tid):
    _post(db, tid, [LineIn("cash_drawer", debit="5"), LineIn("share_capital", credit="5")], approval=True)
    with pytest.raises(GLError) as exc:
        gl.set_period_status(db, tid, year=2026, month=5, status="closed", actor="cfo")
    assert exc.value.code == "period_has_pending"
    gl.get_or_create_period(db, tid, date(2026, 4, 1))
    with pytest.raises(GLError) as exc:
        gl.set_period_status(db, tid, year=2026, month=6, status="closed", actor="cfo")
    assert exc.value.code == "earlier_period_open"
    gl.set_period_status(db, tid, year=2026, month=4, status="closed", actor="cfo")
    with pytest.raises(GLError):
        gl.set_period_status(db, tid, year=2026, month=4, status="open", actor="cfo")  # reason required
    gl.set_period_status(db, tid, year=2026, month=4, status="open", actor="cfo", reason="audit adjustment")


# ─────────────────────────── reports ───────────────────────────


def _sample_month(db, tid):
    _capital(db, tid, "1000.00", on=date(2026, 5, 1))
    _post(db, tid, [LineIn("inventory", debit="300"), LineIn("accounts_payable", credit="300")], on=date(2026, 5, 2))
    _post(db, tid, [LineIn("cash_drawer", debit="500"), LineIn("sales_revenue", credit="500")], on=date(2026, 5, 3))
    _post(db, tid, [LineIn("sales_discounts", debit="20"), LineIn("cash_drawer", credit="20")], on=date(2026, 5, 3))
    _post(db, tid, [LineIn("cogs", debit="150"), LineIn("inventory", credit="150")], on=date(2026, 5, 3))
    _post(db, tid, [LineIn("rent_expense", debit="200"), LineIn("cash_drawer", credit="200")], on=date(2026, 5, 31))
    _post(db, tid, [LineIn("customer_deposits", credit="50"), LineIn("cash_drawer", debit="50")], on=date(2026, 5, 31))


def test_trial_balance_balance_sheet_and_pl_are_consistent(db, tid):
    _sample_month(db, tid)
    tb = reports.trial_balance(db, tid, date_from=date(2026, 5, 1), date_to=date(2026, 5, 31))
    assert tb["balanced"]
    bs = reports.balance_sheet(db, tid, as_of=date(2026, 5, 31))
    assert bs["balanced"], bs
    # Assets: cash 1000+500-20-200+50=1330, inventory 150 → 1480; liabilities 300+50; equity 1000 + profit 130
    assert bs["assets"]["total"] == "1480.00"
    assert bs["liabilities"]["total"] == "350.00"
    pl = reports.profit_and_loss(db, tid, date_from=date(2026, 5, 1), date_to=date(2026, 5, 31))
    assert pl["revenue"]["total"] == "480.00"  # 500 - 20 discount
    assert pl["gross_profit"] == "330.00"
    assert pl["net_profit"] == "130.00"
    assert D(bs["equity"]["total"]) == D("1000.00") + D(pl["net_profit"])


def test_report_date_filters_are_inclusive(db, tid):
    _sample_month(db, tid)
    pl = reports.profit_and_loss(db, tid, date_from=date(2026, 5, 3), date_to=date(2026, 5, 3))
    assert pl["revenue"]["total"] == "480.00"
    tb = reports.trial_balance(db, tid, date_from=date(2026, 5, 31), date_to=date(2026, 5, 31))
    assert tb["balanced"] and D(tb["totals"]["period_debit"]) == D("250.00")
    with pytest.raises(GLError):
        reports.trial_balance(db, tid, date_from=date(2026, 6, 1), date_to=date(2026, 5, 1))


def test_account_ledger_running_balance_with_pagination(db, tid):
    _sample_month(db, tid)
    cash = gl.accounts_by_role(db, tid)["cash_drawer"]
    full = reports.account_ledger(db, tid, cash.id)
    assert full["closing_balance"] == "1330.00"
    page2 = reports.account_ledger(db, tid, cash.id, limit=2, offset=2)
    assert page2["entries"][-1]["balance"] == full["entries"][3]["balance"]
    since = reports.account_ledger(db, tid, cash.id, date_from=date(2026, 5, 31))
    # Before 31 May: 1000 + 500 - 20 = 1480; on 31 May: -200 rent + 50 deposit.
    assert since["opening_balance"] == "1480.00" and since["closing_balance"] == "1330.00"


# ─────────────────────────── tax ───────────────────────────


def test_simplified_tax_accrual_is_idempotent_and_trues_up(db, tid):
    tax.set_tax_profile(db, tid, regime="simplified", simplified_rate="2", effective_from=date(2026, 5, 1), actor="cfo")
    _post(db, tid, [LineIn("cash_drawer", debit="1000"), LineIn("sales_revenue", credit="1000")])
    r1 = tax.accrue_simplified_tax(db, tid, year=2026, month=5, actor="cfo")
    assert r1["tax_due"] == "20.00" and r1["posted_delta"] == "20.00"
    r2 = tax.accrue_simplified_tax(db, tid, year=2026, month=5, actor="cfo")
    assert r2["posted_delta"] == "0.00" and r2["journal_id"] is None
    _post(db, tid, [LineIn("cash_drawer", debit="250"), LineIn("sales_revenue", credit="250")])
    r3 = tax.accrue_simplified_tax(db, tid, year=2026, month=5, actor="cfo")
    assert r3["tax_due"] == "25.00" and r3["posted_delta"] == "5.00"
    assert _bal(db, tid, "simplified_tax_payable") == D("25.00")
    summary = tax.tax_summary(db, tid, year=2026, month=5)
    assert summary["up_to_date"] is True
    pl = reports.profit_and_loss(db, tid, date_from=date(2026, 5, 1), date_to=date(2026, 5, 31))
    assert pl["taxes"]["total"] == "25.00" and pl["net_profit"] == "1225.00"


def test_tax_profile_rules(db, tid):
    with pytest.raises(GLError):
        tax.set_tax_profile(db, tid, regime="simplified", simplified_rate="2", effective_from=date(2026, 5, 2), actor="cfo")
    with pytest.raises(GLError):
        tax.set_tax_profile(db, tid, regime="simplified", simplified_rate="0", effective_from=date(2026, 5, 1), actor="cfo")
    with pytest.raises(GLError):
        tax.set_tax_profile(db, tid, regime="bogus", effective_from=date(2026, 5, 1), actor="cfo")
    tax.set_tax_profile(db, tid, regime="simplified", simplified_rate="5", effective_from=date(2026, 5, 1), actor="cfo")
    _capital(db, tid)
    with pytest.raises(GLError) as exc:  # can't rewrite a month that already has postings
        tax.set_tax_profile(db, tid, regime="vat", vat_rate="18", effective_from=date(2026, 5, 1), actor="cfo")
    assert exc.value.code == "regime_change_after_postings"
    tax.set_tax_profile(db, tid, regime="vat", vat_rate="18", effective_from=date(2026, 7, 1), actor="cfo")
    assert tax.get_tax_profile(db, tid, date(2026, 6, 30)).simplified_rate == D("5.00")
    assert tax.get_tax_profile(db, tid, date(2026, 7, 1)).regime == "vat"
    with pytest.raises(GLError) as exc:
        tax.accrue_simplified_tax(db, tid, year=2026, month=7, actor="cfo")
    assert exc.value.code == "regime_mismatch"


@pytest.mark.parametrize("gross,net,vat", [("118.00", "100.00", "18.00"), ("10.00", "8.47", "1.53"), ("0.01", "0.01", "0.00")])
def test_vat_split_inclusive(gross, net, vat):
    n, v = tax.split_vat(gross, D("18"))
    assert (str(n), str(v)) == (net, vat) and n + v == D(gross)


# ─────────────────────────── audit ───────────────────────────


def test_audit_chain_detects_tampering(db, tid):
    _sample_month(db, tid)
    assert gl.verify_audit_chain(db, tid)["valid"]
    event_row = db.query(GLAuditEvent).filter(GLAuditEvent.tenant_id == tid, GLAuditEvent.seq == 3).one()
    event_row.payload = event_row.payload.replace("300.00", "3.00")
    db.flush()
    result = gl.verify_audit_chain(db, tid)
    assert result == {"valid": False, "events_checked": 3, "broken_at_seq": 3}
