import importlib
import os
import zipfile
import io
from types import SimpleNamespace
import pytest
from fastapi import HTTPException, Response

def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


class _FakeQuery:
    def __init__(self, items):
        self.items = items

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def all(self):
        return self.items

    def first(self):
        if not self.items:
            return None
        return self.items[0]

    def count(self):
        return len(self.items)


class _FakeDB:
    def __init__(self, customer=None, menu_items=None, business_profile=None):
        self.customer = customer
        self.menu_items = menu_items or []
        self.business_profile = business_profile
        self.added = []
        self.commit_count = 0

    def query(self, model_class, *args, **kwargs):
        model_name = getattr(model_class, "__name__", "")
        if model_name == "Customer":
            return _FakeQuery([self.customer] if self.customer else [])
        elif model_name == "MenuItem":
            return _FakeQuery(self.menu_items)
        elif model_name == "BusinessProfile":
            return _FakeQuery([self.business_profile] if self.business_profile else [])
        return _FakeQuery([])

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commit_count += 1


def test_analyze_customer_fortune_fallback():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    
    customer = SimpleNamespace(
        id="cust-1",
        tenant_id="tenant-1",
        card_id="QR-AAAA1111",
        secret_token="tok-1",
        stars=5,
        type="golden"
    )
    db = _FakeDB(customer=customer)
    tenant = SimpleNamespace(id="tenant-1")
    
    payload = operations.FortuneAnalyzeIn(
        image_base64="data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        lang="az"
    )
    
    # We test fallback behavior (when openrouter_api_key is empty/missing)
    res = operations.analyze_customer_fortune(
        payload=payload,
        id="QR-AAAA1111",
        t="tok-1",
        db=db,
        tenant=tenant
    )
    
    assert res["success"] is True
    assert "fortune" in res
    assert res.get("fallback") is True
    assert len(res["fortune"]) > 5


def test_chat_customer_barista_fallback():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    
    customer = SimpleNamespace(
        id="cust-1",
        tenant_id="tenant-1",
        card_id="QR-AAAA1111",
        secret_token="tok-1",
        stars=12,
        type="golden"
    )
    
    menu_items = [
        SimpleNamespace(item_name="Iced Latte", category="Soyuq İçkilər", price=4.5, description="Buzlu ləzzət", is_coffee=True, is_active=True),
        SimpleNamespace(item_name="Espresso", category="İsti İçkilər", price=3.0, description="Güclü qəhvə", is_coffee=True, is_active=True),
    ]
    
    db = _FakeDB(customer=customer, menu_items=menu_items)
    tenant = SimpleNamespace(id="tenant-1")
    
    payload = operations.BaristaChatIn(
        messages=[{"role": "user", "content": "Mənə soyuq bir qəhvə tövsiyə et."}],
        lang="az"
    )
    
    res = operations.chat_customer_barista(
        payload=payload,
        id="QR-AAAA1111",
        t="tok-1",
        db=db,
        tenant=tenant
    )
    
    assert res["success"] is True
    assert "message" in res
    assert res.get("fallback") is True
    assert "Iced Latte" in res["message"]


def test_get_customer_wallet_pass():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")
    
    customer = SimpleNamespace(
        id="cust-1",
        tenant_id="tenant-1",
        card_id="QR-AAAA1111",
        secret_token="tok-1",
        stars=7,
        type="golden"
    )
    
    business_profile = SimpleNamespace(
        tenant_id="tenant-1",
        company_name="iRonWaves Cafe"
    )
    
    db = _FakeDB(customer=customer, business_profile=business_profile)
    tenant = SimpleNamespace(id="tenant-1", name="iRonWaves")
    
    res = operations.get_customer_wallet_pass(
        id="QR-AAAA1111",
        t="tok-1",
        lang="az",
        db=db,
        tenant=tenant
    )
    
    assert isinstance(res, Response)
    assert res.media_type == "application/vnd.apple.pkpass"
    
    # Verify zip content structure
    zip_bytes = res.body
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        namelist = zf.namelist()
        assert "pass.json" in namelist
        assert "manifest.json" in namelist
        assert "signature" in namelist
        assert "icon.png" in namelist
