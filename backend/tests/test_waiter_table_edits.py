"""
Waiter table-workspace edits that the Modern (BahaY) UI sends but the API used to drop silently:
  - PATCH /tables/{id}/layout with guest_count  -> table + active session + check updated
  - guest_count respects the table lock (other waiter -> 403) and needs an open table
  - PATCH /order-items/{id}/draft with course_no -> persisted on the draft item
"""
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")

from app.models import Base, Check, OrderItem, Table, TableSession, Tenant  # noqa: E402
from app.routers import restaurant  # noqa: E402
from app.schemas import DraftItemUpdateIn, TableLayoutUpdateIn  # noqa: E402


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    monkeypatch.setattr(restaurant, "_emit_realtime", lambda *a, **k: None)
    yield session
    session.close()
    engine.dispose()


def _seed(db, *, locked_by="waiter1"):
    db.add(Tenant(id="t1", name="T1", slug="t1", domain="t1.test"))
    table = Table(id="tb1", tenant_id="t1", label="Masa 1", is_occupied=True, status="ACTIVE_CHECK",
                  guest_count=2, locked_by=locked_by, assigned_to=locked_by)
    db.add(table)
    session = TableSession(id="s1", tenant_id="t1", table_id="tb1", guest_count=2, status="SEATED")
    db.add(session)
    db.flush()
    check = Check(id="c1", tenant_id="t1", table_session_id="s1", check_number="CHK-1", guest_count=2, status="OPEN")
    db.add(check)
    db.flush()
    item = OrderItem(id="i1", tenant_id="t1", check_id="c1", table_id="tb1", item_name="Latte",
                     qty=1, price=5, status="DRAFT", course_no=1)
    db.add(item)
    db.commit()
    return SimpleNamespace(id="t1")


def test_guest_count_updates_table_session_and_check(db):
    tenant = _seed(db)
    waiter = SimpleNamespace(username="waiter1", role="staff")
    restaurant.update_table_layout("tb1", TableLayoutUpdateIn(guest_count=5), db=db, tenant=tenant, user=waiter)
    db.expire_all()
    assert db.get(Table, "tb1").guest_count == 5
    assert db.get(TableSession, "s1").guest_count == 5
    assert db.get(Check, "c1").guest_count == 5


def test_guest_count_blocked_for_other_waiter(db):
    tenant = _seed(db, locked_by="waiter1")
    other = SimpleNamespace(username="waiter2", role="staff")
    with pytest.raises(HTTPException) as exc:
        restaurant.update_table_layout("tb1", TableLayoutUpdateIn(guest_count=4), db=db, tenant=tenant, user=other)
    assert exc.value.status_code == 403


def test_guest_count_requires_open_table(db):
    tenant = _seed(db)
    table = db.get(Table, "tb1")
    table.is_occupied = False
    db.commit()
    waiter = SimpleNamespace(username="waiter1", role="staff")
    with pytest.raises(HTTPException) as exc:
        restaurant.update_table_layout("tb1", TableLayoutUpdateIn(guest_count=3), db=db, tenant=tenant, user=waiter)
    assert exc.value.status_code == 400


def test_draft_course_no_persisted(db):
    tenant = _seed(db)
    waiter = SimpleNamespace(username="waiter1", role="staff")
    restaurant.update_draft_item("i1", DraftItemUpdateIn(course_no=2), db=db, tenant=tenant, user=waiter)
    db.expire_all()
    assert db.get(OrderItem, "i1").course_no == 2
