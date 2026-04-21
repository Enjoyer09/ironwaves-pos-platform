import importlib
import os
from types import SimpleNamespace


def _bootstrap_env() -> None:
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_local.db")
    os.environ.setdefault("JWT_SECRET", "test-super-secret-key")
    os.environ.setdefault("SUPERADMIN_PASSWORD", "TestPass123!")


class _FakeDB:
    def __init__(self, first_result):
        self.first_result = first_result
        self.with_for_update_called = False

    def query(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def with_for_update(self):
        self.with_for_update_called = True
        return self

    def first(self):
        return self.first_result


def test_get_active_shift_for_update_uses_for_update():
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB(first_result=SimpleNamespace(id="shift-1"))

    row = reports._get_active_shift_for_update(db, "tenant-1")

    assert row is not None
    assert row.id == "shift-1"
    assert db.with_for_update_called is True


def test_get_handover_for_update_uses_for_update():
    _bootstrap_env()
    reports = importlib.import_module("app.routers.reports")
    db = _FakeDB(first_result=SimpleNamespace(id="handover-1"))

    row = reports._get_handover_for_update(db, "tenant-1", "handover-1")

    assert row is not None
    assert row.id == "handover-1"
    assert db.with_for_update_called is True
