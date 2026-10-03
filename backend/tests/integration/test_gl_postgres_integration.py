"""Finance v2 GL on real PostgreSQL: DB-level invariants and concurrency.

Requires INTEGRATION_DATABASE_URL pointing at a database migrated with
`alembic upgrade head` (the triggers are created by the migration).
"""
from __future__ import annotations

import os
import threading
import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

import app.gl.models  # noqa: F401
from app.gl import engine as gl
from app.gl.engine import GLError, LineIn
from app.gl.models import GLJournal
from app.models import Tenant

pytestmark = pytest.mark.integration
DAY = date(2026, 5, 10)


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


@pytest.fixture()
def tid(Session):
    tenant_id = str(uuid.uuid4())
    with Session() as s:
        s.add(Tenant(id=tenant_id, name="IT", slug=f"it-{tenant_id[:10]}", domain=f"{tenant_id[:10]}.it.test", status="active"))
        s.flush()
        gl.ensure_chart(s, tenant_id)
        gl.create_journal(s, tenant_id=tenant_id, journal_type="opening", created_by="setup", posting_date=DAY,
                          lines=[LineIn("cash_drawer", debit="100.00"), LineIn("share_capital", credit="100.00")])
        s.commit()
    return tenant_id


def _posted_journal_id(Session, tid) -> str:
    with Session() as s:
        return s.query(GLJournal.id).filter(GLJournal.tenant_id == tid, GLJournal.status == "posted").first()[0]


def _raw(Session, sql: str, **params):
    with Session() as s:
        s.execute(text(sql), params)
        s.commit()


def test_posted_journal_cannot_be_updated_or_deleted(Session, tid):
    jid = _posted_journal_id(Session, tid)
    with pytest.raises(DBAPIError, match="immutable"):
        _raw(Session, "update gl_journals set total_debit = 1, total_credit = 1 where id = :id", id=jid)
    with pytest.raises(DBAPIError, match="cannot be deleted"):
        _raw(Session, "delete from gl_journals where id = :id", id=jid)


def test_posted_lines_are_immutable(Session, tid):
    jid = _posted_journal_id(Session, tid)
    with pytest.raises(DBAPIError, match="immutable"):
        _raw(Session, "update gl_journal_lines set debit = 999 where journal_id = :id and debit > 0", id=jid)
    with pytest.raises(DBAPIError, match="immutable"):
        _raw(Session, "delete from gl_journal_lines where journal_id = :id", id=jid)


def test_unbalanced_journal_is_rejected_at_commit(Session, tid):
    with Session() as s:
        period = gl.get_or_create_period(s, tid, DAY)
        cash = gl.accounts_by_role(s, tid)["cash_drawer"]
        jid = str(uuid.uuid4())
        s.execute(text(
            "insert into gl_journals (id, tenant_id, journal_type, status, posting_date, period_id, currency, total_debit, total_credit, created_by)"
            " values (:id, :t, 'general', 'draft', :d, :p, 'AZN', 50, 50, 'hacker')"
        ), {"id": jid, "t": tid, "d": DAY, "p": period.id})
        s.execute(text(
            "insert into gl_journal_lines (id, tenant_id, journal_id, line_no, account_id, debit, credit, currency)"
            " values (:id, :t, :j, 1, :a, 50, 0, 'AZN')"
        ), {"id": str(uuid.uuid4()), "t": tid, "j": jid, "a": cash.id})
        s.execute(text("update gl_journals set status = 'posted' where id = :id"), {"id": jid})
        with pytest.raises(DBAPIError, match="not balanced"):
            s.commit()


def test_closed_period_blocked_at_db_level(Session, tid):
    with Session() as s:
        gl.set_period_status(s, tid, year=2026, month=3, status="closed", actor="cfo")
        period = gl.get_or_create_period(s, tid, date(2026, 3, 1))
        s.commit()
    with pytest.raises(DBAPIError, match="closed"):
        _raw(Session,
             "insert into gl_journals (id, tenant_id, journal_type, status, posting_date, period_id, currency, total_debit, total_credit, created_by)"
             " values (:id, :t, 'general', 'posted', '2026-03-05', :p, 'AZN', 0, 0, 'hacker')",
             id=str(uuid.uuid4()), t=tid, p=period.id)


def test_audit_events_are_append_only(Session, tid):
    with pytest.raises(DBAPIError, match="append-only"):
        _raw(Session, "update gl_audit_events set actor = 'x' where tenant_id = :t", t=tid)
    with pytest.raises(DBAPIError, match="append-only"):
        _raw(Session, "delete from gl_audit_events where tenant_id = :t", t=tid)


def test_reversal_link_is_the_only_allowed_update(Session, tid):
    jid = _posted_journal_id(Session, tid)
    with Session() as s:
        gl.reverse_journal(s, tid, jid, actor="cfo", reason="integration test")
        s.commit()
    with Session() as s:
        original = s.query(GLJournal).filter(GLJournal.id == jid).one()
        assert original.reversed_by_id is not None
    with pytest.raises(DBAPIError, match="immutable"):  # link can't be changed once set
        _raw(Session, "update gl_journals set reversed_by_id = null where id = :id", id=jid)


def test_concurrent_withdrawals_cannot_overdraw_cash(Session, tid):
    """Two cashiers withdraw 80 from a 100 drawer at the same moment: exactly one wins."""
    barrier = threading.Barrier(2)
    results: list[str] = []
    lock = threading.Lock()

    def worker(n: int):
        with Session() as s:
            try:
                barrier.wait()
                gl.create_journal(s, tenant_id=tid, journal_type="cash", created_by=f"cashier{n}", posting_date=DAY,
                                  lines=[LineIn("general_expense", debit="80.00"), LineIn("cash_drawer", credit="80.00")])
                s.commit()
                outcome = "ok"
            except GLError as exc:
                s.rollback()
                outcome = exc.code
        with lock:
            results.append(outcome)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == ["insufficient_balance", "ok"]
    with Session() as s:
        cash = gl.accounts_by_role(s, tid)["cash_drawer"]
        assert gl.account_balance(s, tid, cash) == Decimal("20.00")


def test_concurrent_idempotent_requests_post_once(Session, tid):
    barrier = threading.Barrier(4)
    ids: list[str] = []
    lock = threading.Lock()

    def worker():
        with Session() as s:
            barrier.wait()
            j = gl.create_journal(s, tenant_id=tid, journal_type="sales", created_by="pos", posting_date=DAY,
                                  idempotency_key="sale:offline-123",
                                  lines=[LineIn("cash_drawer", debit="12.50"), LineIn("sales_revenue", credit="12.50")])
            s.commit()
            with lock:
                ids.append(j.id)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(set(ids)) == 1
    with Session() as s:
        assert s.query(GLJournal).filter(GLJournal.tenant_id == tid, GLJournal.idempotency_key == "sale:offline-123").count() == 1


def test_concurrent_drawer_postings_do_not_deadlock(Session, tid):
    """Two postings that both fit the drawer must both post (no FK KEY SHARE vs FOR UPDATE deadlock)."""
    for rnd in range(5):
        barrier = threading.Barrier(2)
        results: list[str] = []
        lock = threading.Lock()

        def worker(n: int):
            with Session() as s:
                barrier.wait()
                try:
                    gl.create_journal(s, tenant_id=tid, journal_type="cash", created_by=f"cashier{n}", posting_date=DAY,
                                      lines=[LineIn("general_expense", debit="1.00"), LineIn("cash_drawer", credit="1.00")])
                    s.commit()
                    outcome = "ok"
                except Exception as exc:  # noqa: BLE001 - a deadlock must fail the assertion, not vanish
                    s.rollback()
                    outcome = type(exc).__name__
            with lock:
                results.append(outcome)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert results == ["ok", "ok"], (rnd, results)
    with Session() as s:
        assert gl.account_balance(s, tid, gl.accounts_by_role(s, tid)["cash_drawer"]) == Decimal("90.00")


def test_approve_vs_concurrent_posting_on_guarded_account_no_deadlock(Session, tid):
    """The exact scenario WP3 flagged (2/90 rounds deadlocked): one transaction APPROVES a
    pending manual journal touching the guarded cash drawer while another transaction POSTS a
    plain journal on the SAME guarded account. With the canonical lock order on both paths this
    must never deadlock (SQLSTATE 40P01). >=100 rounds, both sides deposit so no balance guard
    trips and every round posts cleanly; the final drawer balance must stay consistent.
    """
    rounds = 100
    deadlocks: list[str] = []
    lock = threading.Lock()

    for rnd in range(rounds):
        # Fresh pending journal to approve this round: a deposit of 2.00 into the guarded drawer.
        with Session() as s:
            pending = gl.create_journal(
                s, tenant_id=tid, journal_type="cash", created_by="maker", posting_date=DAY,
                lines=[LineIn("cash_drawer", debit="2.00"), LineIn("share_capital", credit="2.00")],
                require_approval=True,
            )
            pending_id = pending.id
            s.commit()

        barrier = threading.Barrier(2)
        results: list[str] = []

        def approver():
            with Session() as s:
                try:
                    barrier.wait()
                    gl.approve_journal(s, tid, pending_id, approver="checker")
                    s.commit()
                    outcome = "ok"
                except Exception as exc:  # noqa: BLE001 - a deadlock must fail the assertion, not vanish
                    s.rollback()
                    outcome = type(exc).__name__
                    if isinstance(exc, DBAPIError) and str(getattr(getattr(exc, "orig", None), "pgcode", "")) == "40P01":
                        with lock:
                            deadlocks.append(f"approve:{rnd}")
            results.append(outcome)

        def poster():
            with Session() as s:
                try:
                    barrier.wait()
                    gl.create_journal(
                        s, tenant_id=tid, journal_type="cash", created_by="cashier", posting_date=DAY,
                        lines=[LineIn("cash_drawer", debit="1.00"), LineIn("share_capital", credit="1.00")],
                    )
                    s.commit()
                    outcome = "ok"
                except Exception as exc:  # noqa: BLE001
                    s.rollback()
                    outcome = type(exc).__name__
                    if isinstance(exc, DBAPIError) and str(getattr(getattr(exc, "orig", None), "pgcode", "")) == "40P01":
                        with lock:
                            deadlocks.append(f"post:{rnd}")
            results.append(outcome)

        threads = [threading.Thread(target=approver), threading.Thread(target=poster)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert sorted(results) == ["ok", "ok"], (rnd, results)

    assert deadlocks == [], f"{len(deadlocks)} deadlock(s) over {rounds} rounds: {deadlocks[:5]}"
    # Opening 100 + (approve 2.00 + post 1.00) per round, both deposits into the drawer.
    with Session() as s:
        expected = Decimal("100.00") + Decimal("3.00") * rounds
        assert gl.account_balance(s, tid, gl.accounts_by_role(s, tid)["cash_drawer"]) == expected
