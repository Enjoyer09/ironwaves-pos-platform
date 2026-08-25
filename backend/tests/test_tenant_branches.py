"""
Faza B - Multi-branch: tenant_branches CRUD + nearest tests (real SQLite).
"""
import importlib
import os

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, BusinessProfile, Tenant, TenantBranch
from app.routers import branches as B


def bootstrap() -> None:
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")


def make_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return engine, Session()


def seed_tenant(db, tenant_id: str = "tenant-1") -> Tenant:
    t = Tenant(
        id=tenant_id,
        name="iRonWaves",
        slug=f"ironwaves-{tenant_id}",
        domain=f"{tenant_id}.ironwaves.store",
    )
    db.add(t)
    db.commit()
    return t


def seed_branch(db, tenant, name="BahaY Bakı Mərkəz", **kw) -> dict:
    return B.create_branch(
        tenant_id=tenant.id,
        body=B.BranchCreate(
            name=name,
            address=kw.get("address", "Nizami 1"),
            phone=kw.get("phone", "+99450"),
            latitude=kw.get("latitude"),
            longitude=kw.get("longitude"),
            is_active=kw.get("is_active", True),
            is_default=kw.get("is_default", False),
            open_hour=kw.get("open_hour", 8),
            close_hour=kw.get("close_hour", 23),
            sort_order=kw.get("sort_order", 0),
        ),
        db=db,
        user=None,
    )


def test_crud_cycle() -> None:
    bootstrap()
    engine, db = make_db()
    tenant = seed_tenant(db)

    created = seed_branch(db, tenant, name="Filial A", latitude=40.4093, longitude=49.8306)
    assert created["id"]
    assert created["name"] == "Filial A"
    assert created["is_active"] is True

    rows = B.list_branches(tenant.id, db=db, user=None)["branches"]
    assert len(rows) == 1

    updated = B.update_branch(
        tenant.id, created["id"],
        body=B.BranchUpdate(name="Filial A+", close_hour=22),
        db=db, user=None,
    )
    assert updated["name"] == "Filial A+"
    assert updated["close_hour"] == 22

    # Keep a second active branch so deletion is allowed
    seed_branch(db, tenant, name="Filial B")
    deleted = B.delete_branch(tenant.id, created["id"], db=db, user=None)
    assert deleted["ok"] is True

    row = db.query(TenantBranch).filter(TenantBranch.id == created["id"]).first()
    assert row.is_active is False

    db.close()
    engine.dispose()


def test_one_default_per_tenant() -> None:
    bootstrap()
    engine, db = make_db()
    tenant = seed_tenant(db)

    seed_branch(db, tenant, name="Filial 1", is_default=True)
    seed_branch(db, tenant, name="Filial 2", is_default=True)

    rows = db.query(TenantBranch).filter(TenantBranch.tenant_id == tenant.id).all()
    assert sum(1 for r in rows if r.is_default) == 1

    db.close()
    engine.dispose()


def test_cannot_delete_last_active_branch() -> None:
    bootstrap()
    engine, db = make_db()
    tenant = seed_tenant(db)

    branch = seed_branch(db, tenant, name="Yeganə Filial")
    with pytest.raises(HTTPException) as exc:
        B.delete_branch(tenant.id, branch["id"], db=db, user=None)
    assert exc.value.status_code == 400

    db.close()
    engine.dispose()


def test_update_unknown_branch_404() -> None:
    bootstrap()
    engine, db = make_db()
    tenant = seed_tenant(db)

    with pytest.raises(HTTPException) as exc:
        B.update_branch(tenant.id, "branch-zz", body=B.BranchUpdate(name="x"), db=db, user=None)
    assert exc.value.status_code == 404

    db.close()
    engine.dispose()


def test_haversine_accurate() -> None:
    assert B._haversine_km(40.4093, 49.8671, 40.4093, 49.8671) == pytest.approx(0.0, abs=0.001)
    dist = B._haversine_km(40.4093, 49.8671, 40.3958, 49.8822)
    assert 1.5 < dist < 4.0


def test_nearest_sorts_and_clamps() -> None:
    bootstrap()
    engine, db = make_db()
    tenant = seed_tenant(db)

    seed_branch(db, tenant, name="Uzaq", latitude=40.5, longitude=49.9, sort_order=1)
    seed_branch(db, tenant, name="Yaxın", latitude=40.4093, longitude=49.8671, sort_order=0)
    seed_branch(db, tenant, name="Koordinatsız", latitude=None, longitude=None, sort_order=0)

    res = B.nearest_branches(tenant.id, lat=40.4093, lng=49.8671, limit=10, db=db)
    names = [r["name"] for r in res["branches"]]
    assert names[0] == "Yaxın"
    assert res["branches"][0]["distance_km"] < res["branches"][1]["distance_km"]
    assert names[-1] == "Koordinatsız"
    assert res["branches"][-1]["distance_km"] is None

    db.close()
    engine.dispose()


def test_public_branches_only_active() -> None:
    bootstrap()
    engine, db = make_db()
    tenant = seed_tenant(db)

    seed_branch(db, tenant, name="Aktiv")
    seed_branch(db, tenant, name="Söndürülmüş", is_active=False)

    res = B.public_branches(tenant.id, db=db)
    names = [r["name"] for r in res["branches"]]
    assert "Aktiv" in names
    assert "Söndürülmüş" not in names

    db.close()
    engine.dispose()


def test_customer_stores_branch_fallback() -> None:
    bootstrap()
    engine, db = make_db()
    tenant = seed_tenant(db)
    ops = importlib.import_module("app.routers.operations")

    stores = ops._customer_stores(db, tenant, None)
    assert len(stores) == 1
    assert stores[0]["id"] == tenant.id
    assert stores[0]["is_default"] is True

    profile = BusinessProfile(
        id="bp-1",
        tenant_id=tenant.id,
        company_name="BahaY Coffee",
        address="Nizami 1",
        phone="+994",
    )
    db.add(profile)
    db.commit()
    stores = ops._customer_stores(db, tenant, profile)
    assert stores[0]["name"] == "BahaY Coffee"
    assert stores[0]["address"] == "Nizami 1"

    seed_branch(db, tenant, name="BahaY Mərkəz")
    stores = ops._customer_stores(db, tenant, profile)
    assert len(stores) == 1
    assert stores[0]["name"] == "BahaY Mərkəz"
    assert stores[0]["id"] != tenant.id

    db.close()
    engine.dispose()