"""Test configuration: isolated SQLite DB, synthetic data, eager Celery.

Environment must be set *before* app modules import settings.
"""
from __future__ import annotations

import os
import tempfile
import uuid

_tmp = os.path.join(tempfile.gettempdir(), f"parabola_test_{uuid.uuid4().hex}.sqlite3")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}"
os.environ["DEFAULT_DATA_PROVIDER"] = "synthetic"
os.environ["CELERY_TASK_ALWAYS_EAGER"] = "1"

import pandas as pd  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_strategy_models  # noqa: E402
from app.services.data_loader import CandleBundle  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _prepare_db():
    init_db()
    db = SessionLocal()
    try:
        seed_strategy_models(db)
    finally:
        db.close()
    yield
    if os.path.exists(_tmp):
        os.remove(_tmp)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def make_single_bundle(prices: list[float], symbol: str = "TEST") -> CandleBundle:
    """Build a one-symbol CandleBundle from a close series (business days)."""
    index = pd.bdate_range("2022-01-03", periods=len(prices), tz="UTC")
    close = pd.Series(prices, index=index, dtype=float)
    panel = pd.DataFrame(
        {
            "open": close.shift(1).fillna(close.iloc[0]),
            "high": close,
            "low": close,
            "close": close,
            "volume": 1_000_000.0,
            "adjusted_close": close,
        },
        index=index,
    )
    close_panel = pd.DataFrame({symbol: close}, index=index)
    return CandleBundle(
        timeframe="1d",
        symbols=[symbol],
        panels={symbol: panel},
        close_panel=close_panel,
        benchmark=None,
        instrument_ids={symbol: 1},
    )
