"""Deterministic synthetic OHLCV generator.

Ports the prototype's seeded GBM + regime-switching drift so the terminal works
fully offline and reproducibly (each symbol maps to a stable seed). Used for
demos/tests; real ingestion uses the yfinance provider.
"""
from __future__ import annotations

import zlib
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from app.services.providers.base import CANDLE_COLUMNS, DataProvider


def _seed_for(symbol: str) -> int:
    return zlib.crc32(symbol.upper().encode()) & 0xFFFFFFFF


class SyntheticProvider(DataProvider):
    name = "synthetic"

    def fetch_daily(self, symbol: str, start: datetime, end: datetime) -> pd.DataFrame:
        start = _as_utc(start)
        end = _as_utc(end)
        # Business-day calendar keeps it close to a real daily series.
        index = pd.bdate_range(start=start, end=end, tz="UTC")
        n = len(index)
        if n == 0:
            return pd.DataFrame(columns=CANDLE_COLUMNS)

        rng = np.random.default_rng(_seed_for(symbol))
        ann_vol = 0.18 + rng.random() * 0.25
        trendiness = 0.2 + rng.random() * 0.6
        dt = 1.0 / 252.0
        vol = ann_vol * np.sqrt(dt)

        prices = np.empty(n)
        p = 50.0 + rng.random() * 250.0
        drift = 0.0
        for i in range(n):
            if rng.random() < (0.5 + trendiness) * 0.012:
                drift = rng.standard_normal() * 0.0011 * (0.3 + trendiness * 2.2)
            drift *= 0.985
            shock = vol * rng.standard_normal()
            p *= float(np.exp(drift - 0.5 * vol * vol + shock))
            prices[i] = p

        close = prices
        open_ = np.empty(n)
        open_[0] = close[0]
        open_[1:] = close[:-1]
        intrabar = np.abs(rng.standard_normal(n)) * vol * close
        high = np.maximum(open_, close) + intrabar * 0.5
        low = np.minimum(open_, close) - intrabar * 0.5
        volume = (1_000_000 + rng.random(n) * 5_000_000).round()

        return pd.DataFrame(
            {
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
                "adjusted_close": close,
            },
            index=index,
        )[CANDLE_COLUMNS]


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
