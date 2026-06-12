from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import auth


def _fake_request(host: str = "127.0.0.1"):
    return SimpleNamespace(client=SimpleNamespace(host=host), headers={})


def test_login_attempts_lock_after_threshold(monkeypatch):
    auth._login_attempt_tracker.clear()
    monkeypatch.setattr(auth, "_get_redis_security_client", lambda: None)

    req = _fake_request("10.0.0.8")
    tenant_id = "tenant-1"
    username = "admin"

    for _ in range(int(auth.settings.pin_max_failed_attempts)):
        auth._consume_login_attempts(req, tenant_id, username)

    with pytest.raises(HTTPException) as exc:
        auth._consume_login_attempts(req, tenant_id, username)
    assert exc.value.status_code == 423


def test_reset_login_attempts_unlocks(monkeypatch):
    auth._login_attempt_tracker.clear()
    monkeypatch.setattr(auth, "_get_redis_security_client", lambda: None)

    req = _fake_request("10.0.0.9")
    tenant_id = "tenant-1"
    username = "cashier"

    for _ in range(int(auth.settings.pin_max_failed_attempts)):
        auth._consume_login_attempts(req, tenant_id, username)
    auth._reset_login_attempts(req, tenant_id, username)
    auth._consume_login_attempts(req, tenant_id, username)

