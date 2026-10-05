"""router._run bounded retry on PostgreSQL deadlocks (SQLSTATE 40P01).

No real PostgreSQL: a fake callable raises a simulated 40P01 and we assert the
retry contract — a deadlock is retried and can succeed, while a non-deadlock
error (or GLError) is never retried.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError, OperationalError

from app.gl import router as gl_router
from app.gl.engine import GLError


class _FakeDB:
    """Minimal stand-in for a Session: counts commits/rollbacks, never hits a real DB."""

    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


def _deadlock_error() -> OperationalError:
    """An OperationalError that looks like psycopg2's deadlock (orig.pgcode == '40P01')."""
    orig = SimpleNamespace(pgcode="40P01")
    return OperationalError("deadlock detected", params=None, orig=orig)


def _other_db_error() -> DBAPIError:
    """A non-deadlock DBAPIError (e.g. a serialization failure, SQLSTATE 40001)."""
    orig = SimpleNamespace(pgcode="40001")
    return DBAPIError("could not serialize access", params=None, orig=orig)


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(gl_router.time, "sleep", lambda *_: None)


def test_deadlock_is_retried_then_succeeds():
    db = _FakeDB()
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        if calls["n"] == 1:
            raise _deadlock_error()
        return "ok"

    assert gl_router._run(db, fn) == "ok"
    assert calls["n"] == 2  # first attempt deadlocked, second attempt succeeded
    assert db.rollbacks == 1 and db.commits == 1


def test_deadlock_exhausts_attempts_and_reraises():
    db = _FakeDB()
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise _deadlock_error()

    with pytest.raises(OperationalError):
        gl_router._run(db, fn)
    assert calls["n"] == gl_router._MAX_WRITE_ATTEMPTS  # three attempts, all deadlocked
    assert db.rollbacks == gl_router._MAX_WRITE_ATTEMPTS and db.commits == 0


def test_non_deadlock_db_error_is_not_retried():
    db = _FakeDB()
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise _other_db_error()

    with pytest.raises(DBAPIError):
        gl_router._run(db, fn)
    assert calls["n"] == 1  # raised immediately, no retry
    assert db.rollbacks == 1 and db.commits == 0


def test_glerror_is_mapped_to_http_and_not_retried():
    db = _FakeDB()
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise GLError("blocked", code="insufficient_balance", status_code=409)

    with pytest.raises(HTTPException) as excinfo:
        gl_router._run(db, fn)
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail == {"code": "insufficient_balance", "message": "blocked"}
    assert calls["n"] == 1 and db.rollbacks == 1 and db.commits == 0


def test_success_commits_once_without_retry():
    db = _FakeDB()
    assert gl_router._run(db, lambda: "done") == "done"
    assert db.commits == 1 and db.rollbacks == 0
