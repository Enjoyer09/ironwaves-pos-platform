"""Retention for auth token tables.

Every /auth/refresh rotates the refresh token: the old row is flagged ``revoked``
and a new one is inserted. Nothing ever deleted those rows, so ``refresh_tokens``
grew by one row per refresh forever (252k rows, ~41 live, in production 2026-09).

A refresh row is dead once it is expired or revoked; the refresh endpoint only
accepts rows with ``revoked = false`` and ``expires_at`` in the future. Revoked
rows are kept for a short grace period for incident forensics, then removed.
Deletes run in small batches so a large backlog never holds long locks.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import text

BATCH_SIZE = 5000
REVOKED_GRACE = timedelta(days=2)


def purge_refresh_tokens(conn, *, now: datetime | None = None, batch_size: int = BATCH_SIZE, max_batches: int = 1000) -> int:
    """Delete expired or long-revoked refresh tokens. Returns the number of rows removed."""
    now = now or datetime.utcnow()
    revoked_cutoff = now - REVOKED_GRACE
    removed = 0
    for _ in range(max_batches):
        result = conn.execute(
            text(
                "DELETE FROM refresh_tokens WHERE id IN ("
                " SELECT id FROM refresh_tokens"
                " WHERE expires_at < :now OR (revoked = :yes AND created_at < :revoked_cutoff)"
                " LIMIT :batch)"
            ),
            {"now": now, "yes": True, "revoked_cutoff": revoked_cutoff, "batch": batch_size},
        )
        count = int(result.rowcount or 0)
        removed += count
        if count < batch_size:
            break
    return removed
