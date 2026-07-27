"""Pydantic request/response models (docs/06-api-and-worker-contracts.md)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

Timeframe = Literal["1m", "5m", "15m", "30m", "1h", "1d"]


# --- strategies -------------------------------------------------------------
class ParamMeta(BaseModel):
    id: str
    label: str
    type: str
    min: float
    max: float
    default: float
    step: float = 1.0


class StrategyMeta(BaseModel):
    id: str
    name: str
    description: str
    version: str
    kind: str
    parameters: list[ParamMeta]


# --- backtests --------------------------------------------------------------
class ExecutionConfig(BaseModel):
    mode: Literal["long_flat", "long_short"] = "long_flat"
    cost_bps: float = 5.0
    slippage_bps: float = 0.0
    initial_capital: float = 100_000.0


class BacktestRequest(BaseModel):
    strategy_model_id: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    symbols: list[str] = Field(min_length=1)
    timeframe: Timeframe = "1d"
    start_ts: datetime
    end_ts: datetime
    benchmark_symbol: str | None = None
    provider: str | None = None
    execution: ExecutionConfig = Field(default_factory=ExecutionConfig)


class BacktestCreateResponse(BaseModel):
    run_id: UUID
    task_id: str | None
    status: str


class BacktestStatus(BaseModel):
    run_id: UUID
    status: str
    progress: float
    stage: str | None = None
    error_message: str | None = None
    created_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


class MetricsResponse(BaseModel):
    run_id: UUID
    strategy_model_id: str
    parameters: dict[str, Any]
    execution_config: dict[str, Any]
    initial_capital: float | None = None
    final_equity: float | None = None
    total_return: float | None = None
    cagr: float | None = None
    annual_volatility: float | None = None
    sharpe: float | None = None
    sortino: float | None = None
    max_drawdown: float | None = None
    beta: float | None = None
    alpha: float | None = None
    win_rate: float | None = None
    exposure: float | None = None
    turnover: float | None = None
    trade_count: int | None = None


class EquityPointOut(BaseModel):
    ts: datetime
    equity: float
    drawdown: float | None = None
    gross_exposure: float | None = None
    net_exposure: float | None = None


class EquityResponse(BaseModel):
    run_id: UUID
    points: list[EquityPointOut]
    benchmark: list[dict[str, Any]] = Field(default_factory=list)


class CandleOut(BaseModel):
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None


class CandlesResponse(BaseModel):
    symbol: str
    candles: list[CandleOut]


class TradeOut(BaseModel):
    id: int
    symbol: str
    side: str
    quantity: float
    entry_ts: datetime
    exit_ts: datetime | None
    entry_price: float
    exit_price: float | None
    fees: float
    realized_pnl: float | None
    return_pct: float | None
    holding_bars: int | None


class TradesResponse(BaseModel):
    run_id: UUID
    total: int
    limit: int
    offset: int
    items: list[TradeOut]


class MarkerOut(BaseModel):
    ts: datetime
    kind: str
    price: float


class MarkersResponse(BaseModel):
    run_id: UUID
    symbol: str
    markers: list[MarkerOut]


class RunListItem(BaseModel):
    run_id: UUID
    strategy_model_id: str
    status: str
    timeframe: str
    symbols: list[str]
    sharpe: float | None = None
    total_return: float | None = None
    created_at: datetime | None = None


# --- data -------------------------------------------------------------------
class InstrumentOut(BaseModel):
    id: int
    symbol: str
    name: str | None
    asset_type: str
    exchange: str | None
    currency: str | None


class InstrumentCreate(BaseModel):
    symbol: str
    name: str | None = None
    asset_type: Literal["equity", "etf", "crypto", "forex", "future", "index"] = "equity"
    exchange: str | None = None


class IngestRequest(BaseModel):
    symbols: list[str] = Field(min_length=1)
    timeframe: Timeframe = "1d"
    start_ts: datetime
    end_ts: datetime
    provider: str | None = None


class CoverageResponse(BaseModel):
    symbol: str
    timeframe: str
    count: int
    start: str | None
    end: str | None


# --- sweeps -----------------------------------------------------------------
class SweepRequest(BaseModel):
    strategy_model_id: str
    base_config: dict[str, Any]
    sweep_space: dict[str, list[Any]]
    objective_metric: str = "sharpe"


class SweepCreateResponse(BaseModel):
    sweep_id: UUID
    task_id: str | None
    status: str
    total_points: int


class SweepStatus(BaseModel):
    sweep_id: UUID
    status: str
    progress: float
    total_points: int | None = None
    objective_metric: str
    best_result_id: int | None = None
    error_message: str | None = None
    created_at: datetime | None = None
    completed_at: datetime | None = None


class SweepResultItem(BaseModel):
    id: int
    parameter_point: dict[str, Any]
    metrics: dict[str, Any]


class SweepBestResponse(BaseModel):
    items: list[SweepResultItem]


class HeatmapResponse(BaseModel):
    x_param: str
    y_param: str
    x_values: list[Any]
    y_values: list[Any]
    metric: str
    z: list[list[float | None]]
