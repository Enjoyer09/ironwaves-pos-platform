from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    pool_pre_ping=bool(settings.db_pool_pre_ping),
    pool_size=max(1, int(settings.db_pool_size or 5)),
    max_overflow=max(0, int(settings.db_max_overflow or 10)),
    pool_timeout=max(1, int(settings.db_pool_timeout or 15)),
    pool_recycle=max(60, int(settings.db_pool_recycle_seconds or 1800)),
    future=True,
)


if (
    settings.database_url.startswith("postgresql")
    and int(settings.db_statement_timeout_ms or 0) > 0
    and bool(settings.db_apply_statement_timeout_on_connect)
):
    @event.listens_for(engine, "connect")
    def _set_statement_timeout(dbapi_connection, _connection_record):
        # Neon pooler rejects startup-package options like "-c statement_timeout=...".
        # Apply it after the connection is opened so deploys keep working on pooled URLs.
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("SET statement_timeout = %s", (int(settings.db_statement_timeout_ms),))
        except Exception:
            # Timeout hardening must never block the app from starting. Some poolers
            # may restrict session-level SET commands; in that case continue safely.
            try:
                dbapi_connection.rollback()
            except Exception:
                pass
        finally:
            cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
