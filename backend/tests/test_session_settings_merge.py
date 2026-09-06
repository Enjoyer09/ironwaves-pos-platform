"""
PATCH /api/v1/ops/settings/session — merge semantikası (P0.5 hardening).

Əvvəl endpoint "payload üzərindən qur + bir neçə sahəyə current-fallback"
üslubunda idi. Nəticədə partial göndəriş (məs. cihaz-toggle handler-i yalnız
`device_authorization_enabled` göndərsə) göndərilməyən `idle_logout_minutes`
/`virtual_keyboard_enabled`/`staff_pin_length`-i sessizcə default-a qaytarırdı:
avtomatik çıxış sönməsi və ya PIN uzunluğunun dəyişməsi riski.

İndi qayda: açar payload-da yoxdursa (və ya dəyəri `None`-dursa) mövcud dəyər
saxlanılır; mövcud dəyər yoxdursa DEFAULT_SESSION_SETTINGS işləyir. Testlər
endpoint funksiyasını fake DB + monkeypatch ilə birbaşa çağırır (ev üslubu:
DB/auth fixture-ları yoxdur).
"""

import importlib
import os
from types import SimpleNamespace

import pytest


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


@pytest.fixture()
def operations():
    _bootstrap_env()
    return importlib.import_module("app.routers.operations")


class _FakeDB:
    """Endpoint yalnız commit() edir; yazma monkeypatch ilə tutulur."""

    def commit(self):
        return None

    def add(self, *_args):
        return None


FULL_STORED = {
    "idle_logout_minutes": 15,
    "virtual_keyboard_enabled": True,
    "staff_pin_length": 6,
    "theme_mode": "dark",
    "ui_mode": "old",
    "tables_ui_mode": "classic",
    "login_background_url": "",
    "device_authorization_enabled": False,
}


def _run_patch(ops, monkeypatch, stored, payload):
    """`stored` — cədvəldəki mövcud session_settings (None = yazılmayıb)."""
    captured: dict = {}
    monkeypatch.setattr(ops, "_setting_value", lambda db, tid, key, default: stored if stored is not None else default)
    monkeypatch.setattr(ops, "_set_setting_value", lambda db, tid, key, value: captured.update(value=value))
    monkeypatch.setattr(ops, "_ensure_admin", lambda user: None)

    result = ops.update_session_settings(
        payload=payload,
        db=_FakeDB(),
        tenant=SimpleNamespace(id="tenant-1"),
        user=SimpleNamespace(username="admin", role="admin"),
    )
    assert result["success"] is True
    saved = captured["value"]
    assert result["session_settings"] == saved
    return saved


def test_partial_patch_preserves_stored_fields(operations, monkeypatch):
    """Yalnız bir sahə göndəriləndə qalanları cədvəldəki kimi qalır — ƏVVƏL burada
    `idle_logout_minutes` 0-a (çıxış söndürülməsinə) qayıdirdı."""
    saved = _run_patch(operations, monkeypatch, FULL_STORED, {"device_authorization_enabled": True})
    assert saved["device_authorization_enabled"] is True
    assert saved["idle_logout_minutes"] == 15
    assert saved["virtual_keyboard_enabled"] is True
    assert saved["staff_pin_length"] == 6
    assert saved["theme_mode"] == "dark"
    assert saved["tables_ui_mode"] == "classic"


def test_empty_payload_changes_nothing(operations, monkeypatch):
    saved = _run_patch(operations, monkeypatch, FULL_STORED, {})
    assert saved == FULL_STORED


def test_explicit_null_means_no_change(operations, monkeypatch):
    saved = _run_patch(operations, monkeypatch, FULL_STORED, {"idle_logout_minutes": None, "staff_pin_length": None})
    assert saved["idle_logout_minutes"] == 15
    assert saved["staff_pin_length"] == 6


def test_explicit_zero_still_disables_idle_logout(operations, monkeypatch):
    """Açıq 0 qanuni seçimdir (özelliklə söndürmə) — merge onu bloklamamalıdır."""
    saved = _run_patch(operations, monkeypatch, FULL_STORED, {"idle_logout_minutes": 0})
    assert saved["idle_logout_minutes"] == 0


def test_pin_garbage_cannot_flip_length(operations, monkeypatch):
    """Zibil dəyər PIN uzunluğunu default 4-ə çevirə bilməz — mövcud 6 qalır."""
    saved = _run_patch(operations, monkeypatch, FULL_STORED, {"staff_pin_length": "abc"})
    assert saved["staff_pin_length"] == 6


def test_garbage_idle_minutes_keeps_stored_value(operations, monkeypatch):
    """`"abc"` dəqiqə 0-a (söndürülmüşə) çevrilmir — mövcud 15 qalır."""
    saved = _run_patch(operations, monkeypatch, FULL_STORED, {"idle_logout_minutes": "abc"})
    assert saved["idle_logout_minutes"] == 15


def test_unknown_fields_do_not_leak_into_saved_settings(operations, monkeypatch):
    saved = _run_patch(operations, monkeypatch, FULL_STORED, {"theme_mode": "light", "admin_backdoor": True})
    assert saved["theme_mode"] == "light"
    assert "admin_backdoor" not in saved
    assert set(saved) == set(operations.DEFAULT_SESSION_SETTINGS)


def test_fresh_tenant_defaults_fill_gaps(operations, monkeypatch):
    """Heç bir ayar yazılmayıbsa (stored=None) göndərilməyən sahələr default ilə dolur."""
    saved = _run_patch(operations, monkeypatch, None, {"idle_logout_minutes": 45})
    assert saved["idle_logout_minutes"] == 45
    assert saved["virtual_keyboard_enabled"] is True
    assert saved["staff_pin_length"] == 4
    assert saved["theme_mode"] == "dark"
    assert saved["login_background_url"] == ""
    assert saved["device_authorization_enabled"] is False


def test_legacy_full_payload_still_works(operations, monkeypatch):
    """Mövcud frontend 8 sahənin hamısını göndərir — davranış dəyişməməlidir."""
    payload = {
        "idle_logout_minutes": 30,
        "virtual_keyboard_enabled": False,
        "staff_pin_length": 4,
        "theme_mode": "light",
        "ui_mode": "old",
        "tables_ui_mode": "modern",
        "login_background_url": "",
        "device_authorization_enabled": False,
    }
    saved = _run_patch(operations, monkeypatch, FULL_STORED, payload)
    assert saved == payload


def test_non_dict_stored_value_treated_as_absent(operations, monkeypatch):
    """Korruptlıq (JSON dict deyil) halında default-lar işləyir, 500 yox."""
    saved = _run_patch(operations, monkeypatch, "corrupted", {"idle_logout_minutes": 20})
    assert saved["idle_logout_minutes"] == 20
    assert saved["staff_pin_length"] == 4
