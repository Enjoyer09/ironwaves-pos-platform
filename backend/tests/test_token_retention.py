"""refresh_tokens retention: dead rows are purged in batches, live rows survive."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401
from app.db import Base
from app.models import RefreshToken, Tenant, User
from app.services.token_retention import purge_refresh_tokens


def test_purge_removes_only_dead_refresh_tokens():
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    now = datetime(2026, 9, 30, 12, 0, 0)
    tid, uid = str(uuid.uuid4()), str(uuid.uuid4())
    with Session() as s:
        s.add(Tenant(id=tid, name="T", slug="t", domain="t.test", status="active"))
        s.add(User(id=uid, tenant_id=tid, username="u", password_hash="x", role="admin"))
        s.flush()

        def row(label, *, expires, revoked, created):
            s.add(RefreshToken(id=f"{label}-{uuid.uuid4()}", tenant_id=tid, user_id=uid, token_hash=str(uuid.uuid4()),
                               expires_at=expires, revoked=revoked, created_at=created))

        for _ in range(7):
            row("expired", expires=now - timedelta(hours=1), revoked=False, created=now - timedelta(days=8))
        for _ in range(5):
            row("oldrevoked", expires=now + timedelta(days=3), revoked=True, created=now - timedelta(days=4))
        row("freshrevoked", expires=now + timedelta(days=6), revoked=True, created=now - timedelta(hours=3))
        row("live", expires=now + timedelta(days=6), revoked=False, created=now - timedelta(days=1))
        s.commit()

    with engine.begin() as conn:
        assert purge_refresh_tokens(conn, now=now, batch_size=3) == 12  # several batches
    with Session() as s:
        left = sorted(r.id.split("-")[0] for r in s.query(RefreshToken).all())
    assert left == ["freshrevoked", "live"]
    with engine.begin() as conn:
        assert purge_refresh_tokens(conn, now=now) == 0  # idempotent
