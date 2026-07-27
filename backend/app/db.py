"""Database engine / session setup and schema initialization."""
from __future__ import annotations

import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)

# SQLite needs a special connect arg for multi-threaded access (Celery eager).
connect_args = {"check_same_thread": False} if settings.is_sqlite else {}

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    future=True,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def _init_timescale(conn) -> None:
    """Best-effort TimescaleDB setup. Silently skips when unavailable
    (e.g. plain Postgres or SQLite) so the app still runs."""
    statements = [
        'CREATE EXTENSION IF NOT EXISTS timescaledb',
        'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
        "SELECT create_hypertable('historical_candles', by_range('ts'), if_not_exists => TRUE)",
        "SELECT create_hypertable('backtest_equity_points', by_range('ts'), if_not_exists => TRUE)",
    ]
    for stmt in statements:
        try:
            conn.execute(text(stmt))
            conn.commit()
        except Exception as exc:  # noqa: BLE001 - non-fatal by design
            conn.rollback()
            logger.info("Timescale step skipped (%s): %s", stmt.split()[0], exc)


def init_db() -> None:
    """Create tables and, on Postgres, TimescaleDB extensions/hypertables."""
    # Import models so they register on Base.metadata.
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)

    if not settings.is_sqlite:
        with engine.connect() as conn:
            _init_timescale(conn)


def get_db():
    """FastAPI dependency yielding a session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
