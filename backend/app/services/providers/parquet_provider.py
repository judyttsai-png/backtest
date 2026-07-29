"""Parquet-backed FX daily provider.

Reads a wide 15-minute *close* panel (one column per FX pair, plus a
``timestamp`` column) and resamples the requested pair to daily OHLC on the fly:

    open  = first 15-min close of the UTC day
    high  = max   15-min close of the UTC day
    low   = min   15-min close of the UTC day
    close = last  15-min close of the UTC day

This reconstructs a real daily high/low from the intraday closes — something a
single daily-close series cannot provide, and exactly what range-based
indicators (DMI/ADX, ATR) require. Offline and deterministic: no network, all
16 pairs always available. The 14 MB file is memory-cached (keyed on mtime) so
scanning all pairs doesn't re-read it each time.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pandas as pd

from app.config import settings
from app.services.providers.base import CANDLE_COLUMNS, DataProvider

# path -> (mtime, panel). Loaded once; reused across all pairs/backtests.
_CACHE: dict[str, tuple[float, pd.DataFrame]] = {}


def _load_panel(path: str) -> pd.DataFrame:
    mtime = os.path.getmtime(path)
    cached = _CACHE.get(path)
    if cached is not None and cached[0] == mtime:
        return cached[1]
    df = pd.read_parquet(path)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.set_index("timestamp").sort_index()
    _CACHE[path] = (mtime, df)
    return df


def _normalize(symbol: str) -> str:
    s = symbol.strip().upper()
    if s.endswith("=X"):  # tolerate yfinance-style tickers (EURUSD=X)
        s = s[:-2]
    return s


# App timeframe -> pandas resample rule. The source is 15-min, so 1m/5m are
# finer than the data and cannot be synthesized (omitted here => unsupported).
_RESAMPLE_RULE = {"15m": "15min", "30m": "30min", "1h": "1h", "1d": "1D"}


def _fetch_yf(symbol: str, timeframe: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Daily FX bars from yfinance (ticker form e.g. USDKRW=X). Daily only —
    yfinance intraday FX history is short/spotty. Guarded: any failure => empty."""
    if timeframe != "1d":
        return pd.DataFrame(columns=CANDLE_COLUMNS)
    try:
        from app.services.providers.yfinance_provider import YFinanceProvider

        return YFinanceProvider().fetch_daily(_normalize(symbol) + "=X", start, end)
    except Exception:
        return pd.DataFrame(columns=CANDLE_COLUMNS)


def _fetch_live_tail(
    symbol: str, timeframe: str, after: datetime, end: datetime
) -> pd.DataFrame:
    """Recent bars strictly after ``after`` (to extend a parquet pair past its
    last timestamp)."""
    df = _fetch_yf(symbol, timeframe, after, end)
    if df.empty:
        return df
    return df.loc[df.index > _as_utc(after)]


class ParquetProvider(DataProvider):
    name = "parquet"

    def fetch(self, symbol: str, timeframe: str, start: datetime, end: datetime) -> pd.DataFrame:
        """Resample the 15-min close panel to the requested timeframe's OHLC.
        Returns empty for timeframes finer than the 15-min source (1m/5m)."""
        rule = _RESAMPLE_RULE.get(timeframe)
        if rule is None:
            return pd.DataFrame(columns=CANDLE_COLUMNS)

        path = settings.fx_parquet_path
        if not path or not os.path.exists(path):
            raise FileNotFoundError(
                f"FX parquet not found at '{path}'. Set FX_PARQUET_PATH in backend/.env."
            )
        panel = _load_panel(path)
        col = _normalize(symbol)
        if col not in panel.columns:
            # Pair isn't in the parquet (e.g. USDKRW / USDINR / USDTWD) — serve it
            # from yfinance (daily). Lets you add pairs beyond the 16 in the file.
            return _fetch_yf(symbol, timeframe, start, end)

        s = panel[col].dropna()
        s = s.loc[(s.index >= _as_utc(start)) & (s.index <= _as_utc(end))]
        if s.empty:
            return pd.DataFrame(columns=CANDLE_COLUMNS)

        bars = s.resample(rule).agg(["first", "max", "min", "last", "count"])
        bars = bars[bars["count"] > 0]
        if bars.empty:
            return pd.DataFrame(columns=CANDLE_COLUMNS)

        out = pd.DataFrame(index=bars.index)
        out["open"] = bars["first"].to_numpy()
        out["high"] = bars["max"].to_numpy()
        out["low"] = bars["min"].to_numpy()
        out["close"] = bars["last"].to_numpy()
        out["volume"] = 0.0  # spot FX has no consolidated volume
        out["adjusted_close"] = bars["last"].to_numpy()
        out = out[CANDLE_COLUMNS]

        # Gap-fill: if the request runs past the parquet's last bar, top up the
        # tail from yfinance so the data stays current going forward.
        if settings.fx_live_gapfill and not out.empty:
            last = out.index.max()
            if _as_utc(end) > last:
                tail = _fetch_live_tail(col, timeframe, last, end)
                if not tail.empty:
                    out = pd.concat([out, tail[CANDLE_COLUMNS]])
                    out = out[~out.index.duplicated(keep="first")].sort_index()
        return out

    def fetch_daily(self, symbol: str, start: datetime, end: datetime) -> pd.DataFrame:
        return self.fetch(symbol, "1d", start, end)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
