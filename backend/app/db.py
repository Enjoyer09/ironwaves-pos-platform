from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


_connect_args = {}
if settings.database_url.startswith("postgresql"):
    _connect_args["options"] = f"-c statement_timeout={int(settings.db_statement_timeout_ms or 30000)}"


engine = create_engine(
    settings.database_url,
    pool_pre_ping=bool(settings.db_pool_pre_ping),
    pool_size=max(1, int(settings.db_pool_size or 5)),
    max_overflow=max(0, int(settings.db_max_overflow or 10)),
    pool_timeout=max(1, int(settings.db_pool_timeout or 15)),
    pool_recycle=max(60, int(settings.db_pool_recycle_seconds or 1800)),
    connect_args=_connect_args,
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
