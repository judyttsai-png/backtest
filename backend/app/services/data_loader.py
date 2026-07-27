"""Load candle panels from the database for backtest/sweep workers.

Auto-ingests on a cache miss so a fresh run works end-to-end, then always
reads back from the DB (the system of record) to build the panels.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import BacktestRun, HistoricalCandle, Instrument
from app.services.data_manager import get_or_create_instrument, ingest_symbol, normalize_symbol

OHLCV_COLUMNS = ["open", "high", "low", "close", "volume", "adjusted_close"]


@dataclass
class CandleBundle:
    timeframe: str
    symbols: list[str]
    panels: dict[str, pd.DataFrame]
    close_panel: pd.DataFrame | None
    benchmark: pd.DataFrame | None
    instrument_ids: dict[str, int] = field(default_factory=dict)


def _load_panel(
    db: Session, instrument_id: int, timeframe: str, start: datetime, end: datetime
) -> pd.DataFrame:
    rows = db.execute(
        select(HistoricalCandle)
        .where(
            HistoricalCandle.instrument_id == instrument_id,
            HistoricalCandle.timeframe == timeframe,
            HistoricalCandle.ts >= _utc(start),
            HistoricalCandle.ts <= _utc(end),
        )
        .order_by(HistoricalCandle.ts.asc())
    ).scalars().all()

    if not rows:
        return pd.DataFrame(columns=OHLCV_COLUMNS)

    index = pd.to_datetime([r.ts for r in rows], utc=True)
    data = {
        "open": [float(r.open) for r in rows],
        "high": [float(r.high) for r in rows],
        "low": [float(r.low) for r in rows],
        "close": [float(r.close) for r in rows],
        "volume": [float(r.volume) if r.volume is not None else None for r in rows],
        "adjusted_close": [
            float(r.adjusted_close) if r.adjusted_close is not None else float(r.close)
            for r in rows
        ],
    }
    return pd.DataFrame(data, index=index)


def _load_symbol(
    db: Session,
    symbol: str,
    timeframe: str,
    start: datetime,
    end: datetime,
    provider: str | None,
    auto_ingest: bool,
) -> tuple[Instrument, pd.DataFrame]:
    inst = get_or_create_instrument(db, symbol, provider=provider)
    panel = _load_panel(db, inst.id, timeframe, start, end)
    effective_provider = provider or settings.default_data_provider
    # Ingest when nothing is stored, or — for the fast offline parquet provider —
    # always, so a widened date range top-fills any partial-coverage gaps rather
    # than silently returning only the previously-cached sub-range. ingest_symbol
    # upserts idempotently (skips timestamps already present), so this is cheap.
    if auto_ingest and (panel.empty or effective_provider == "parquet"):
        # The provider decides which timeframes it can serve (parquet resamples
        # its 15-min data to 15m/30m/1h/1d; others return empty for intraday).
        ingest_symbol(db, symbol, timeframe=timeframe, start=start, end=end, provider=provider)
        panel = _load_panel(db, inst.id, timeframe, start, end)
    return inst, panel


def build_bundle(
    db: Session,
    symbols: list[str],
    timeframe: str,
    start: datetime,
    end: datetime,
    *,
    benchmark_symbol: str | None = None,
    provider: str | None = None,
    auto_ingest: bool = True,
) -> CandleBundle:
    symbols = [normalize_symbol(s) for s in symbols]
    panels: dict[str, pd.DataFrame] = {}
    instrument_ids: dict[str, int] = {}
    for sym in symbols:
        inst, panel = _load_symbol(db, sym, timeframe, start, end, provider, auto_ingest)
        instrument_ids[sym] = inst.id
        if panel.empty:
            raise ValueError(f"no candles available for {sym} in the requested range")
        panels[sym] = panel

    # Aligned close panel for portfolio strategies.
    close_frames = {sym: panels[sym]["close"] for sym in symbols}
    close_panel = pd.concat(close_frames, axis=1)
    close_panel.columns = symbols
    close_panel = close_panel.sort_index().ffill().dropna(how="any")

    benchmark = None
    if benchmark_symbol:
        _, bench_panel = _load_symbol(
            db, benchmark_symbol, timeframe, start, end, provider, auto_ingest
        )
        if not bench_panel.empty:
            benchmark = bench_panel.reindex(panels[symbols[0]].index).ffill()

    return CandleBundle(
        timeframe=timeframe,
        symbols=symbols,
        panels=panels,
        close_panel=close_panel,
        benchmark=benchmark,
        instrument_ids=instrument_ids,
    )


def load_candles_for_run(db: Session, run: BacktestRun) -> CandleBundle:
    symbols = list(run.universe.get("symbols", []))
    if not symbols:
        raise ValueError("run universe has no symbols")

    benchmark_symbol = run.universe.get("benchmark_symbol")
    provider = run.universe.get("provider")
    return build_bundle(
        db,
        symbols,
        run.timeframe,
        run.start_ts,
        run.end_ts,
        benchmark_symbol=benchmark_symbol,
        provider=provider,
    )


def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
