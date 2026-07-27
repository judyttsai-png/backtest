"""Provider interface and factory."""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

import pandas as pd

# Normalised candle columns every provider must return.
CANDLE_COLUMNS = ["open", "high", "low", "close", "volume", "adjusted_close"]


class DataProvider(ABC):
    name: str

    @abstractmethod
    def fetch_daily(self, symbol: str, start: datetime, end: datetime) -> pd.DataFrame:
        """Return a DataFrame indexed by tz-aware UTC timestamps with
        ``CANDLE_COLUMNS`` columns. Empty frame if no data."""
        raise NotImplementedError

    def fetch(
        self, symbol: str, timeframe: str, start: datetime, end: datetime
    ) -> pd.DataFrame:
        """Fetch candles at an arbitrary timeframe. The base implementation only
        supports daily; providers with intraday data (e.g. parquet) override
        this. Returns empty for unsupported timeframes so the caller surfaces a
        clean "no candles" error rather than mislabeling daily bars."""
        if timeframe == "1d":
            return self.fetch_daily(symbol, start, end)
        return pd.DataFrame(columns=CANDLE_COLUMNS)


def get_provider(name: str) -> DataProvider:
    # Imported lazily so yfinance is only required when actually selected.
    if name == "synthetic":
        from app.services.providers.synthetic_provider import SyntheticProvider

        return SyntheticProvider()
    if name == "yfinance":
        from app.services.providers.yfinance_provider import YFinanceProvider

        return YFinanceProvider()
    if name == "parquet":
        from app.services.providers.parquet_provider import ParquetProvider

        return ParquetProvider()
    raise ValueError(f"unknown data provider '{name}'")
