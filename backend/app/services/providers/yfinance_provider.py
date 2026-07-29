"""Yahoo Finance provider — daily and intraday (15m/30m/1h)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd

from app.services.providers.base import CANDLE_COLUMNS, DataProvider

# App timeframe -> yfinance interval. 5m/1m intentionally unsupported.
_YF_INTERVAL = {"1d": "1d", "1h": "60m", "30m": "30m", "15m": "15m"}
# yfinance only serves ~60 days of intraday history (15m/30m/60m).
_YF_INTRADAY_MAX_DAYS = 59


class YFinanceProvider(DataProvider):
    name = "yfinance"

    def fetch(self, symbol: str, timeframe: str, start: datetime, end: datetime) -> pd.DataFrame:
        import yfinance as yf  # imported lazily; heavy dependency

        interval = _YF_INTERVAL.get(timeframe)
        if interval is None:
            return pd.DataFrame(columns=CANDLE_COLUMNS)

        start, end = _as_utc(start), _as_utc(end)
        if interval != "1d":
            # clamp to yfinance's intraday window and extend end to include today
            floor = datetime.now(timezone.utc) - timedelta(days=_YF_INTRADAY_MAX_DAYS)
            if start < floor:
                start = floor
            end = end + timedelta(days=1)

        raw = yf.download(
            symbol,
            start=_date(start),
            end=_date(end),
            interval=interval,
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

    def fetch_daily(self, symbol: str, start: datetime, end: datetime) -> pd.DataFrame:
        return self.fetch(symbol, "1d", start, end)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _date(dt: datetime) -> str:
    return _as_utc(dt).strftime("%Y-%m-%d")
