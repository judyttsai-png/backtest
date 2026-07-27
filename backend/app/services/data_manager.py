"""Instrument registry, candle ingestion/upsert, and coverage checks."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import HistoricalCandle, Instrument
from app.services.providers import get_provider


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def get_or_create_instrument(
    db: Session,
    symbol: str,
    *,
    asset_type: str = "equity",
    exchange: str | None = None,
    provider: str | None = None,
) -> Instrument:
    symbol = normalize_symbol(symbol)
    stmt = select(Instrument).where(
        Instrument.symbol == symbol, Instrument.asset_type == asset_type
    )
    inst = db.execute(stmt).scalar_one_or_none()
    if inst is not None:
        return inst

    inst = Instrument(
        symbol=symbol,
        name=symbol,
        asset_type=asset_type,
        exchange=exchange,
        data_provider=provider or settings.default_data_provider,
        provider_symbol=symbol,
    )
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return inst


def ingest_symbol(
    db: Session,
    symbol: str,
    *,
    timeframe: str = "1d",
    start: datetime,
    end: datetime,
    provider: str | None = None,
    asset_type: str = "equity",
) -> dict:
    """Fetch candles from the provider and upsert without duplicating rows."""
    provider_name = provider or settings.default_data_provider
    inst = get_or_create_instrument(db, symbol, asset_type=asset_type, provider=provider_name)

    frame = get_provider(provider_name).fetch(inst.symbol, timeframe, start, end)
    if frame.empty:
        return {"symbol": inst.symbol, "inserted": 0, "provider": provider_name}

    # Dedup key normalised to naive-UTC: SQLite returns naive datetimes while the
    # provider frame is tz-aware UTC, so a raw comparison never matches and the
    # upsert would try to re-insert existing rows (UNIQUE violation). Bound the
    # existing-check by the FRAME's actual range (not the requested start/end,
    # which may carry a time component that misaligns with day-boundary bars).
    frame_start = _utc(frame.index.min().to_pydatetime())
    frame_end = _utc(frame.index.max().to_pydatetime())
    existing = {
        _dedup_key(ts)
        for (ts,) in db.execute(
            select(HistoricalCandle.ts).where(
                HistoricalCandle.instrument_id == inst.id,
                HistoricalCandle.timeframe == timeframe,
                HistoricalCandle.ts >= frame_start,
                HistoricalCandle.ts <= frame_end,
            )
        )
    }

    ingest_run_id = uuid.uuid4()
    inserted = 0
    for ts, row in frame.iterrows():
        ts_py = ts.to_pydatetime()
        if _dedup_key(ts_py) in existing:
            continue
        db.add(
            HistoricalCandle(
                instrument_id=inst.id,
                timeframe=timeframe,
                ts=ts_py,
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=float(row["volume"]) if pd.notna(row["volume"]) else None,
                adjusted_close=float(row["adjusted_close"]),
                source=provider_name,
                ingest_run_id=ingest_run_id,
            )
        )
        inserted += 1
    db.commit()
    return {"symbol": inst.symbol, "inserted": inserted, "provider": provider_name}


def coverage(db: Session, symbol: str, timeframe: str = "1d") -> dict:
    symbol = normalize_symbol(symbol)
    inst = db.execute(
        select(Instrument).where(Instrument.symbol == symbol)
    ).scalar_one_or_none()
    if inst is None:
        return {"symbol": symbol, "timeframe": timeframe, "count": 0, "start": None, "end": None}

    row = db.execute(
        select(
            func.count(HistoricalCandle.ts),
            func.min(HistoricalCandle.ts),
            func.max(HistoricalCandle.ts),
        ).where(
            HistoricalCandle.instrument_id == inst.id,
            HistoricalCandle.timeframe == timeframe,
        )
    ).one()
    count, start_ts, end_ts = row
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "count": int(count or 0),
        "start": start_ts.isoformat() if start_ts else None,
        "end": end_ts.isoformat() if end_ts else None,
    }


def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _dedup_key(dt: datetime) -> datetime:
    """Normalise a timestamp to naive-UTC so tz-aware (provider) and naive
    (SQLite-returned) values compare equal when deduping candle inserts."""
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt
