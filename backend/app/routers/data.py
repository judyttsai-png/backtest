"""Instrument registry and data ingestion/coverage endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Instrument
from app.schemas import (
    CoverageResponse,
    IngestRequest,
    InstrumentCreate,
    InstrumentOut,
)
from app.services import data_manager
from app.tasks.ingestion import ingest_symbols_task

router = APIRouter(prefix="/api", tags=["data"])


@router.get("/instruments", response_model=list[InstrumentOut])
def list_instruments(
    search: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    stmt = select(Instrument).order_by(Instrument.symbol.asc()).limit(limit)
    if search:
        stmt = select(Instrument).where(
            Instrument.symbol.ilike(f"%{search.upper()}%")
        ).order_by(Instrument.symbol.asc()).limit(limit)
    rows = db.execute(stmt).scalars().all()
    return [
        InstrumentOut(
            id=i.id,
            symbol=i.symbol,
            name=i.name,
            asset_type=i.asset_type,
            exchange=i.exchange,
            currency=i.currency,
        )
        for i in rows
    ]


@router.post("/instruments", response_model=InstrumentOut, status_code=201)
def create_instrument(req: InstrumentCreate, db: Session = Depends(get_db)):
    inst = data_manager.get_or_create_instrument(
        db, req.symbol, asset_type=req.asset_type, exchange=req.exchange
    )
    if req.name:
        inst.name = req.name
        db.commit()
    return InstrumentOut(
        id=inst.id,
        symbol=inst.symbol,
        name=inst.name,
        asset_type=inst.asset_type,
        exchange=inst.exchange,
        currency=inst.currency,
    )


@router.post("/data/ingest")
def ingest(req: IngestRequest):
    symbols = [s.upper() for s in req.symbols]
    async_result = ingest_symbols_task.delay(
        symbols,
        req.timeframe,
        req.start_ts.isoformat(),
        req.end_ts.isoformat(),
        req.provider,
    )
    result = getattr(async_result, "result", None)
    return {
        "task_id": getattr(async_result, "id", None),
        "symbols": symbols,
        "status": getattr(async_result, "status", "PENDING"),
        "result": result if isinstance(result, dict) else None,
    }


@router.get("/data/coverage", response_model=CoverageResponse)
def get_coverage(
    symbol: str,
    timeframe: str = "1d",
    db: Session = Depends(get_db),
):
    return CoverageResponse(**data_manager.coverage(db, symbol, timeframe))
