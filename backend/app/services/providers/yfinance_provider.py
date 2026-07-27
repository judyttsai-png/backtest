"""Yahoo Finance daily provider (initial real-data source)."""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from app.services.providers.base import CANDLE_COLUMNS, DataProvider


class YFinanceProvider(DataProvider):
    name = "yfinance"

    def fetch_daily(self, symbol: str, start: datetime, end: datetime) -> pd.DataFrame:
        import yfinance as yf  # imported lazily; heavy dependency

        raw = yf.download(
            symbol,
            start=_date(start),
            end=_date(end),
            interval="1d",
            auto_adjust=False,
            progress=False,
            threads=False,
        )
        if raw is None or raw.empty:
            return pd.DataFrame(columns=CANDLE_COLUMNS)

        # yfinance may return a MultiIndex column frame for single symbols.
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.get_level_values(0)

        frame = pd.DataFrame(index=pd.to_datetime(raw.index, utc=True))
        frame["open"] = raw["Open"].to_numpy()
        frame["high"] = raw["High"].to_numpy()
        frame["low"] = raw["Low"].to_numpy()
        frame["close"] = raw["Close"].to_numpy()
        frame["volume"] = raw["Volume"].to_numpy()
        adj = raw["Adj Close"] if "Adj Close" in raw.columns else raw["Close"]
        frame["adjusted_close"] = adj.to_numpy()
        return frame.dropna(subset=["close"])[CANDLE_COLUMNS]


def _date(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")
