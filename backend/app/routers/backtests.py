"""Backtest lifecycle and result endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    BacktestEquityPoint,
    BacktestRun,
    HistoricalCandle,
    Instrument,
    TradeLog,
)
from app.schemas import (
    BacktestCreateResponse,
    BacktestRequest,
    BacktestStatus,
    CandleOut,
    CandlesResponse,
    EquityPointOut,
    EquityResponse,
    MarkerOut,
    MarkersResponse,
    MetricsResponse,
    RunListItem,
    TradeOut,
    TradesResponse,
)
from app.services.strategies import STRATEGY_REGISTRY
from app.services.strategies.base import ParameterError
from app.tasks.backtests import run_backtest_task

router = APIRouter(prefix="/api/backtests", tags=["backtests"])


def _get_run(db: Session, run_id: uuid.UUID) -> BacktestRun:
    run = db.get(BacktestRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="backtest run not found")
    return run


@router.post("", response_model=BacktestCreateResponse, status_code=201)
def create_backtest(req: BacktestRequest, db: Session = Depends(get_db)):
    strat = STRATEGY_REGISTRY.get(req.strategy_model_id)
    if strat is None:
        raise HTTPException(status_code=422, detail=f"unknown strategy '{req.strategy_model_id}'")
    try:
        clean_params = strat.validate_parameters(req.parameters)
    except ParameterError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if req.end_ts <= req.start_ts:
        raise HTTPException(status_code=422, detail="end_ts must be after start_ts")

    run = BacktestRun(
        strategy_model_id=strat.id,
        strategy_version=strat.version,
        status="queued",
        parameters=clean_params,
        execution_config=req.execution.model_dump(),
        timeframe=req.timeframe,
        start_ts=req.start_ts,
        end_ts=req.end_ts,
        universe={
            "symbols": [s.upper() for s in req.symbols],
            "benchmark_symbol": req.benchmark_symbol.upper() if req.benchmark_symbol else None,
            "provider": req.provider,
        },
        initial_capital=req.execution.initial_capital,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    async_result = run_backtest_task.delay(str(run.id))
    task_id = getattr(async_result, "id", None)
    if task_id:
        run.celery_task_id = task_id
        db.commit()

    # Re-read status (eager mode completes synchronously).
    db.refresh(run)
    return BacktestCreateResponse(run_id=run.id, task_id=task_id, status=run.status)


@router.get("", response_model=list[RunListItem])
def list_backtests(
    strategy_model_id: str | None = None,
    status: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    stmt = select(BacktestRun).order_by(BacktestRun.created_at.desc())
    if strategy_model_id:
        stmt = stmt.where(BacktestRun.strategy_model_id == strategy_model_id)
    if status:
        stmt = stmt.where(BacktestRun.status == status)
    stmt = stmt.limit(limit).offset(offset)
    runs = db.execute(stmt).scalars().all()
    return [
        RunListItem(
            run_id=r.id,
            strategy_model_id=r.strategy_model_id,
            status=r.status,
            timeframe=r.timeframe,
            symbols=list(r.universe.get("symbols", [])),
            sharpe=r.sharpe,
            total_return=r.total_return,
            created_at=r.created_at,
        )
        for r in runs
    ]


@router.get("/{run_id}", response_model=BacktestStatus)
def get_backtest(run_id: uuid.UUID, db: Session = Depends(get_db)):
    run = _get_run(db, run_id)
    return BacktestStatus(
        run_id=run.id,
        status=run.status,
        progress=run.progress,
        stage=run.progress_stage,
        error_message=run.error_message,
        created_at=run.created_at,
        started_at=run.started_at,
        completed_at=run.completed_at,
    )


def _require_completed(run: BacktestRun) -> None:
    if run.status != "completed":
        raise HTTPException(status_code=409, detail=f"backtest not completed (status={run.status})")


@router.get("/{run_id}/metrics", response_model=MetricsResponse)
def get_metrics(run_id: uuid.UUID, db: Session = Depends(get_db)):
    run = _get_run(db, run_id)
    _require_completed(run)
    return MetricsResponse(
        run_id=run.id,
        strategy_model_id=run.strategy_model_id,
        parameters=run.parameters,
        execution_config=run.execution_config,
        initial_capital=_f(run.initial_capital),
        final_equity=_f(run.final_equity),
        total_return=run.total_return,
        cagr=run.cagr,
        annual_volatility=run.annual_volatility,
        sharpe=run.sharpe,
        sortino=run.sortino,
        max_drawdown=run.max_drawdown,
        beta=run.beta,
        alpha=run.alpha,
        win_rate=run.win_rate,
        exposure=run.exposure,
        turnover=run.turnover,
        trade_count=run.trade_count,
    )


@router.get("/{run_id}/equity", response_model=EquityResponse)
def get_equity(run_id: uuid.UUID, db: Session = Depends(get_db)):
    run = _get_run(db, run_id)
    _require_completed(run)
    points = db.execute(
        select(BacktestEquityPoint)
        .where(BacktestEquityPoint.backtest_run_id == run.id)
        .order_by(BacktestEquityPoint.ts.asc())
    ).scalars().all()

    out_points = [
        EquityPointOut(
            ts=p.ts,
            equity=_f(p.equity),
            drawdown=p.drawdown,
            gross_exposure=_f(p.gross_exposure),
            net_exposure=_f(p.net_exposure),
        )
        for p in points
    ]
    benchmark = _benchmark_curve(db, run)
    return EquityResponse(run_id=run.id, points=out_points, benchmark=benchmark)


@router.get("/{run_id}/trades", response_model=TradesResponse)
def get_trades(
    run_id: uuid.UUID,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    run = _get_run(db, run_id)
    _require_completed(run)

    total = db.execute(
        select(func.count(TradeLog.id)).where(TradeLog.backtest_run_id == run.id)
    ).scalar_one()

    rows = db.execute(
        select(TradeLog, Instrument.symbol)
        .join(Instrument, TradeLog.instrument_id == Instrument.id)
        .where(TradeLog.backtest_run_id == run.id)
        .order_by(TradeLog.entry_ts.asc())
        .limit(limit)
        .offset(offset)
    ).all()

    items = [
        TradeOut(
            id=t.id,
            symbol=symbol,
            side=t.side,
            quantity=_f(t.quantity),
            entry_ts=t.entry_ts,
            exit_ts=t.exit_ts,
            entry_price=_f(t.entry_price),
            exit_price=_f(t.exit_price),
            fees=_f(t.fees),
            realized_pnl=_f(t.realized_pnl),
            return_pct=t.return_pct,
            holding_bars=t.holding_bars,
        )
        for (t, symbol) in rows
    ]
    return TradesResponse(run_id=run.id, total=total, limit=limit, offset=offset, items=items)


@router.get("/{run_id}/candles", response_model=CandlesResponse)
def get_candles(
    run_id: uuid.UUID,
    symbol: str | None = None,
    db: Session = Depends(get_db),
):
    run = _get_run(db, run_id)
    symbols = list(run.universe.get("symbols", []))
    target = (symbol or (symbols[0] if symbols else "")).upper()
    inst = db.execute(select(Instrument).where(Instrument.symbol == target)).scalar_one_or_none()
    if inst is None:
        raise HTTPException(status_code=404, detail=f"no instrument '{target}'")

    candles = _load_candles(db, inst.id, run)
    out = [
        CandleOut(
            ts=c.ts,
            open=_f(c.open),
            high=_f(c.high),
            low=_f(c.low),
            close=_f(c.close),
            volume=_f(c.volume),
        )
        for c in candles
    ]
    return CandlesResponse(symbol=target, candles=out)


@router.get("/{run_id}/markers", response_model=MarkersResponse)
def get_markers(
    run_id: uuid.UUID,
    symbol: str | None = None,
    db: Session = Depends(get_db),
):
    run = _get_run(db, run_id)
    _require_completed(run)
    symbols = list(run.universe.get("symbols", []))
    target = (symbol or (symbols[0] if symbols else "")).upper()
    inst = db.execute(select(Instrument).where(Instrument.symbol == target)).scalar_one_or_none()
    if inst is None:
        raise HTTPException(status_code=404, detail=f"no instrument '{target}'")

    trades = db.execute(
        select(TradeLog)
        .where(TradeLog.backtest_run_id == run.id, TradeLog.instrument_id == inst.id)
        .order_by(TradeLog.entry_ts.asc())
    ).scalars().all()

    markers: list[MarkerOut] = []
    for t in trades:
        kind = "long_entry" if t.side == "buy" else "short_entry"
        markers.append(MarkerOut(ts=t.entry_ts, kind=kind, price=_f(t.entry_price)))
        if t.exit_ts is not None and t.exit_price is not None:
            markers.append(MarkerOut(ts=t.exit_ts, kind="exit", price=_f(t.exit_price)))
    markers.sort(key=lambda m: m.ts)
    return MarkersResponse(run_id=run.id, symbol=target, markers=markers)


# --- helpers ---------------------------------------------------------------
def _load_candles(db: Session, instrument_id: int, run: BacktestRun):
    return db.execute(
        select(HistoricalCandle)
        .where(
            HistoricalCandle.instrument_id == instrument_id,
            HistoricalCandle.timeframe == run.timeframe,
            HistoricalCandle.ts >= _utc(run.start_ts),
            HistoricalCandle.ts <= _utc(run.end_ts),
        )
        .order_by(HistoricalCandle.ts.asc())
    ).scalars().all()


def _benchmark_curve(db: Session, run: BacktestRun) -> list[dict]:
    """Recompute a buy & hold benchmark on the primary symbol, scaled to the
    run's initial capital, aligned to the equity index."""
    symbols = list(run.universe.get("symbols", []))
    bench_symbol = run.universe.get("benchmark_symbol") or (symbols[0] if symbols else None)
    if not bench_symbol:
        return []
    inst = db.execute(
        select(Instrument).where(Instrument.symbol == bench_symbol.upper())
    ).scalar_one_or_none()
    if inst is None:
        return []
    candles = _load_candles(db, inst.id, run)
    if not candles:
        return []
    base = float(candles[0].close)
    capital = float(run.initial_capital or 100_000.0)
    return [
        {"ts": c.ts.isoformat(), "value": capital * float(c.close) / base} for c in candles
    ]


def _f(value):
    return float(value) if value is not None else None


def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
