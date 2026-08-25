import os
from decimal import Decimal
from fastapi import Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")

from app.models import Base, BusinessProfile, Tenant, User
from app.routers.operations import BusinessProfileIn, get_business_profile, put_business_profile


def _make_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    return engine, db


def test_business_profile_fiscal_default():
    _, db = _make_db()
    tenant = Tenant(id="tenant-1", name="SocialBee Café", slug="socialbee", domain="socialbee.ironwaves.store")
    db.add(tenant)
    db.commit()

    user = User(id="user-1", tenant_id="tenant-1", username="admin", role="admin")
    response = Response()
    data = get_business_profile(response=response, db=db, tenant=tenant, user=user)

    assert data["tenant_id"] == "tenant-1"
    assert data["company_name"] == "SocialBee Café"
    assert data["voen"] == ""
    assert data["tax_regime"] == "simplified"
    assert data["vat_rate"] == 18
    assert data["nka_registration_no"] == ""
    assert data["fiscal_enabled"] is False


def test_business_profile_put_and_get_roundtrip():
    _, db = _make_db()
    tenant = Tenant(id="tenant-1", name="SocialBee Café", slug="socialbee", domain="socialbee.ironwaves.store")
    db.add(tenant)
    db.commit()

    admin_user = User(id="user-1", tenant_id="tenant-1", username="admin", role="admin")

    # 1. Create with VAT & fiscal enabled
    payload = BusinessProfileIn(
        company_name="SocialBee LLC",
        phone="+994501234567",
        address="Nizami str. 12",
        website="https://socialbee.az",
        logo_url="https://socialbee.az/logo.png",
        receipt_footer="Həmişə xidmətinizdəyik!",
        voen="1401234561",
        tax_regime="vat",
        vat_rate=18,
        nka_registration_no="NKA-12345",
        fiscal_enabled=True,
    )

    res = put_business_profile(payload=payload, db=db, tenant=tenant, user=admin_user)
    assert res == {"success": True}

    response = Response()
    saved = get_business_profile(response=response, db=db, tenant=tenant, user=admin_user)
    assert saved["company_name"] == "SocialBee LLC"
    assert saved["voen"] == "1401234561"
    assert saved["tax_regime"] == "vat"
    assert saved["vat_rate"] == 18.0
    assert saved["nka_registration_no"] == "NKA-12345"
    assert saved["fiscal_enabled"] is True

    # 2. Update to simplified tax regime and disable fiscal
    payload_update = BusinessProfileIn(
        company_name="SocialBee LLC",
        phone="+994501234567",
        address="Nizami str. 12",
        website="https://socialbee.az",
        logo_url="https://socialbee.az/logo.png",
        receipt_footer="Təşəkkür edirik!",
        voen="1401234561",
        tax_regime="simplified",
        vat_rate=0,
        nka_registration_no="NKA-12345",
        fiscal_enabled=False,
    )
    res_update = put_business_profile(payload=payload_update, db=db, tenant=tenant, user=admin_user)
    assert res_update == {"success": True}

    updated = get_business_profile(response=response, db=db, tenant=tenant, user=admin_user)
    assert updated["tax_regime"] == "simplified"
    assert updated["fiscal_enabled"] is False
    assert updated["voen"] == "1401234561"
