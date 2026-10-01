"""AP/AR sub-ledger: per-partner balances, FIFO settlement, aging buckets, reconciliation to control accounts."""
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
from app.gl.engine import GLError, LineIn
from app.gl.subledger import subledger
from app.models import Supplier, Tenant

D = Decimal
AS_OF = date(2026, 9, 30)


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


def j(db, tid, when, *lines):
    return gl.create_journal(db, tenant_id=tid, journal_type="general", created_by="t", posting_date=when, description="t",
                             lines=[LineIn(account=a, debit=D(d), credit=D(c), partner_type=pt, partner_id=pid) for a, d, c, pt, pid in lines])


@pytest.fixture()
def tid(db):
    t = str(uuid.uuid4())
    db.add(Tenant(id=t, name="T", slug=f"t-{t[:8]}", domain=f"{t[:8]}.test", status="active"))
    db.add(Supplier(id="sup-a", tenant_id=t, name="Ət Tədarük MMC"))
    db.add(Supplier(id="sup-b", tenant_id=t, name="Süd Evi"))
    db.flush()
    gl.ensure_chart(db, t)
    j(db, t, date(2026, 5, 1), ("cash_drawer", "5000", "0", None, None), ("share_capital", "0", "5000", None, None))
    # Supplier A: bills 100 (Jun 1), 200 (Aug 15), 50 (Sep 20); paid 150 (Sep 1) → FIFO settles Jun bill and 50 of Aug.
    j(db, t, date(2026, 6, 1), ("general_expense", "100", "0", None, None), ("accounts_payable", "0", "100", "supplier", "sup-a"))
    j(db, t, date(2026, 8, 15), ("general_expense", "200", "0", None, None), ("accounts_payable", "0", "200", "supplier", "sup-a"))
    j(db, t, date(2026, 9, 1), ("accounts_payable", "150", "0", "supplier", "sup-a"), ("cash_drawer", "0", "150", None, None))
    j(db, t, date(2026, 9, 20), ("general_expense", "50", "0", None, None), ("accounts_payable", "0", "50", "supplier", "sup-a"))
    # Supplier B overpaid: bill 40, paid 60 → 20 advance.
    j(db, t, date(2026, 3, 1), ("general_expense", "40", "0", None, None), ("accounts_payable", "0", "40", "supplier", "sup-b"))
    j(db, t, date(2026, 9, 25), ("accounts_payable", "60", "0", "supplier", "sup-b"), ("cash_drawer", "0", "60", None, None))
    # Untagged legacy-style bill (no supplier) and one AR loan to an employee.
    j(db, t, date(2026, 4, 1), ("general_expense", "30", "0", None, None), ("accounts_payable", "0", "30", None, None))
    j(db, t, date(2026, 7, 1), ("other_receivable", "80", "0", "employee", "Aysel"), ("cash_drawer", "0", "80", None, None))
    db.commit()
    return t


def test_ap_fifo_aging_and_reconciliation(db, tid):
    ap = subledger(db, tid, "ap", as_of=AS_OF)
    assert ap["reconciled"] and ap["control_balance"] == "210.00"  # 350 - 150 + 40 - 60 + 30
    rows = {r["partner_id"]: r for r in ap["partners"]}
    a = rows["sup-a"]
    assert a["name"] == "Ət Tədarük MMC" and a["balance"] == "200.00"
    assert a["buckets"] == {"current": "0.00", "0_30": "50.00", "31_60": "150.00", "61_90": "0.00", "90_plus": "0.00"}
    assert a["oldest_open_date"] == "2026-08-15"
    b = rows["sup-b"]
    assert b["balance"] == "-20.00" and b["advance"] == "20.00" and b["open"] == "0.00"
    assert ap["unassigned_balance"] == "30.00" and rows[None]["buckets"]["90_plus"] == "30.00"
    assert ap["partners"][-1]["partner_id"] is None  # unassigned listed last
    assert ap["totals"]["balance"] == "210.00" and ap["totals"]["advance"] == "20.00"


def test_totals_match_control_and_as_of_is_respected(db, tid):
    ap = subledger(db, tid, "ap", as_of=AS_OF)
    assert D(ap["totals"]["balance"]) == D(ap["control_balance"])
    earlier = subledger(db, tid, "ap", as_of=date(2026, 8, 31))
    rows = {r["partner_id"]: r for r in earlier["partners"]}
    assert rows["sup-a"]["balance"] == "300.00" and rows["sup-a"]["buckets"]["90_plus"] == "100.00"  # Jun 1 → Aug 31 = 91 days
    assert earlier["reconciled"]


def test_advance_absorbs_next_bill(db, tid):
    j(db, tid, date(2026, 9, 28), ("general_expense", "25", "0", None, None), ("accounts_payable", "0", "25", "supplier", "sup-b"))
    db.commit()
    b = {r["partner_id"]: r for r in subledger(db, tid, "ap", as_of=AS_OF)["partners"]}["sup-b"]
    assert b["balance"] == "5.00" and b["advance"] == "0.00" and b["buckets"]["0_30"] == "5.00"


def test_ar_ledger_and_unknown_ledger(db, tid):
    ar = subledger(db, tid, "ar", as_of=AS_OF)
    assert ar["reconciled"] and ar["control_balance"] == "80.00"
    assert ar["partners"][0]["name"] == "Aysel" and ar["partners"][0]["buckets"]["90_plus"] == "80.00"  # Jul 1 → Sep 30 = 91 days
    with pytest.raises(GLError):
        subledger(db, tid, "xx")
