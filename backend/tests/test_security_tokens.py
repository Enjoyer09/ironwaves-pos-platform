import importlib
import os
import uuid


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


def test_password_hash_roundtrip() -> None:
    _bootstrap_env()
    security = importlib.import_module("app.security")
    plain = "StrongPass!2026"
    hashed = security.hash_password(plain)
    assert hashed != plain
    assert security.verify_password(plain, hashed) is True
    assert security.verify_password("wrong", hashed) is False


def test_access_token_encode_decode_roundtrip() -> None:
    _bootstrap_env()
    security = importlib.import_module("app.security")
    subject = f"user-{uuid.uuid4()}"
    tenant_id = f"tenant-{uuid.uuid4()}"
    token = security.create_access_token(subject, tenant_id, "admin")
    payload = security.decode_token(token)

    assert payload["sub"] == subject
    assert payload["tenant_id"] == tenant_id
    assert payload["role"] == "admin"
    assert payload["type"] == "access"


def test_refresh_token_encode_decode_roundtrip() -> None:
    _bootstrap_env()
    security = importlib.import_module("app.security")
    subject = f"user-{uuid.uuid4()}"
    tenant_id = f"tenant-{uuid.uuid4()}"
    token = security.create_refresh_token(subject, tenant_id)
    payload = security.decode_token(token)

    assert payload["sub"] == subject
    assert payload["tenant_id"] == tenant_id
    assert payload["type"] == "refresh"


def test_password_policy_rejects_weak_value() -> None:
    _bootstrap_env()
    security = importlib.import_module("app.security")
    try:
        security.validate_password_policy("weakpass")
        assert False, "Weak password must raise"
    except ValueError as exc:
        assert "Şifrə" in str(exc)


def test_password_policy_accepts_strong_value() -> None:
    _bootstrap_env()
    security = importlib.import_module("app.security")
    security.validate_password_policy("StrongPass!2026")
