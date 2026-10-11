import importlib
import json
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


def test_get_customer_wallet_pass(monkeypatch):
    """F5.3 — Pass Type ID sertifikatı olmadan saxta imzalı pkpass qadağandır.

    - Sertifikat yoxdursa → 503 (əvvəl TEAMID123/unsigned-dev-pass ilə yalan
      kart qaytarılırdı; iOS onu rədd edir, audit isə düzəliş tələb edir).
    - Sertifikat olanda → real PKCS7 imza + CN/OU-dən götürülmüş
      passTypeIdentifier/teamIdentifier (kodda saxta dəyər yoxdur).
    """
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

    # ── 1) Sertifikat yoxdursa → 503, heç bir pkpass qaytarılmır ──────────
    # (tmp_path fixture sandbox-da EEXIST verir — adi tempfile işlədirik)
    import tempfile

    workdir = tempfile.mkdtemp(prefix="f5-wallet-")
    monkeypatch.setattr(operations.app_settings, "apple_wallet_cert_path", os.path.join(workdir, "missing.pem"))
    monkeypatch.setattr(operations.app_settings, "apple_wallet_key_path", os.path.join(workdir, "missing.key"))
    with pytest.raises(HTTPException) as exc:
        operations.get_customer_wallet_pass(
            id="QR-AAAA1111",
            t="tok-1",
            lang="az",
            db=db,
            tenant=tenant,
        )
    assert exc.value.status_code == 503

    # ── 2) Sertifikat var → real imza + sertifikatdakı CN/OU ───────────────
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    import datetime as dt

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Pass Type ID: pass.example.test"),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "TEAM999XYZ"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Ironwaves"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(dt.datetime.utcnow() - dt.timedelta(days=1))
        .not_valid_after(dt.datetime.utcnow() + dt.timedelta(days=365))
        .sign(key, hashes.SHA256())
    )
    cert_path = os.path.join(workdir, "passcert.pem")
    key_path = os.path.join(workdir, "passkey.pem")
    with open(cert_path, "wb") as fh:
        fh.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(key_path, "wb") as fh:
        fh.write(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )
    monkeypatch.setattr(operations.app_settings, "apple_wallet_cert_path", cert_path)
    monkeypatch.setattr(operations.app_settings, "apple_wallet_key_path", key_path)

    res = operations.get_customer_wallet_pass(
        id="QR-AAAA1111",
        t="tok-1",
        lang="az",
        db=db,
        tenant=tenant,
    )

    assert isinstance(res, Response)
    assert res.media_type == "application/vnd.apple.pkpass"

    with zipfile.ZipFile(io.BytesIO(res.body)) as zf:
        namelist = zf.namelist()
        assert "pass.json" in namelist
        assert "manifest.json" in namelist
        assert "signature" in namelist
        assert "icon.png" in namelist

        pass_data = json.loads(zf.read("pass.json"))
        assert pass_data["passTypeIdentifier"] == "pass.example.test"
        assert pass_data["teamIdentifier"] == "TEAM999XYZ"
        assert pass_data["serialNumber"] == "QR-AAAA1111"

        # İmza real PKCS7-dir — "unsigned-dev-pass" mətni yoxdur.
        signature = zf.read("signature")
        assert signature != b"unsigned-dev-pass"
        assert len(signature) > 100


# ---------------------------------------------------------------------------
# P4.1 — kanal razılığı endpointi (`POST /customer-app/preferences`)
# ---------------------------------------------------------------------------

def _prefs_customer(**overrides):
    base = dict(
        id="cust-1",
        tenant_id="tenant-1",
        card_id="QR-PREF1111",
        secret_token="tok-1",
        stars=0,
        type="golden",
        push_opt_in=True,
        email_opt_in=False,
        sms_opt_in=False,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_preferences_patch_semantics_only_changes_sent_channels():
    """`None` sahə dəyişmir — panel email-i bilmədən push göndərsə email
    səssizcə sıfırlanmamalıdır (PATCH, PUT deyil)."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    customer = _prefs_customer()
    db = _FakeDB(customer=customer)

    res = operations.update_customer_preferences(
        payload=operations.CustomerPrefsIn(push=False),
        id="QR-PREF1111",
        t="tok-1",
        db=db,
        tenant=SimpleNamespace(id="tenant-1"),
    )
    assert res["success"] is True
    assert res["prefs"] == {"push": False, "email": False, "sms": False}
    assert customer.push_opt_in is False
    assert db.commit_count == 1


def test_preferences_writes_an_audit_trail():
    """«Müştəri mənə bildiriş göndərmə dedi» mübahisəsi sənədlə həll olunmalıdır —
    razılıq dəyişikliyi izsiz keçməməlidir."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    db = _FakeDB(customer=_prefs_customer())
    operations.update_customer_preferences(
        payload=operations.CustomerPrefsIn(email=True, sms=True),
        id="QR-PREF1111",
        t="tok-1",
        db=db,
        tenant=SimpleNamespace(id="tenant-1"),
    )

    audit = [row for row in db.added if getattr(row, "action", "") == "CUSTOMER_PREFS_UPDATED"]
    assert len(audit) == 1
    details = json.loads(audit[0].details)
    assert details == {"email": "on", "sms": "on"}
    # Dəyişməyən kanal auditi şişirtməməlidir.
    assert "push" not in details


def test_preferences_noop_does_not_commit():
    """Eyni dəyəri yenidən göndərmək (açar vəziyyəti sinxronlaşdırma) DB yazısı
    yaratmamalıdır — yoxsa hər açılış audit jurnalını doldurardı."""
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    db = _FakeDB(customer=_prefs_customer(push_opt_in=True))
    res = operations.update_customer_preferences(
        payload=operations.CustomerPrefsIn(push=True),
        id="QR-PREF1111",
        t="tok-1",
        db=db,
        tenant=SimpleNamespace(id="tenant-1"),
    )
    assert res["prefs"]["push"] is True
    assert db.commit_count == 0
    assert db.added == []


def test_preferences_rejects_bad_session_before_touching_consent():
    _bootstrap_env()
    operations = importlib.import_module("app.routers.operations")

    customer = _prefs_customer()
    db = _FakeDB(customer=customer)
    with pytest.raises(HTTPException) as err:
        operations.update_customer_preferences(
            payload=operations.CustomerPrefsIn(push=False),
            id="QR-PREF1111",
            t="wrong-token",
            db=db,
            tenant=SimpleNamespace(id="tenant-1"),
        )
    assert err.value.status_code == 401
    assert customer.push_opt_in is True
    assert db.commit_count == 0
