"""SQLAlchemy ORM models mirroring docs/05-database-schema.md.

Types are chosen to work on both PostgreSQL/TimescaleDB (production) and
SQLite (zero-infra local/test runs). ``sqlalchemy.Uuid`` and ``JSON`` both
degrade gracefully on SQLite.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# SQLite only autoincrements INTEGER PRIMARY KEY (not BIGINT); use a variant so
# BIGSERIAL-style keys work on both Postgres and SQLite.
BigIntPK = BigInteger().with_variant(Integer, "sqlite")


class Instrument(Base):
    __tablename__ = "instruments"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str | None] = mapped_column(Text)
    asset_type: Mapped[str] = mapped_column(Text, nullable=False)
    exchange: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(Text, default="USD")
    data_provider: Mapped[str | None] = mapped_column(Text)
    provider_symbol: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    meta: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        UniqueConstraint("symbol", "asset_type", "exchange", name="uq_instrument"),
        CheckConstraint(
            "asset_type IN ('equity','etf','crypto','forex','future','index')",
            name="ck_instrument_asset_type",
        ),
        Index("idx_instruments_symbol", "symbol"),
        Index("idx_instruments_asset_type", "asset_type"),
    )


class HistoricalCandle(Base):
    __tablename__ = "historical_candles"

    instrument_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("instruments.id", ondelete="CASCADE"), primary_key=True
    )
    timeframe: Mapped[str] = mapped_column(Text, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)

    open: Mapped[float] = mapped_column(Numeric(20, 8), nullable=False)
    high: Mapped[float] = mapped_column(Numeric(20, 8), nullable=False)
    low: Mapped[float] = mapped_column(Numeric(20, 8), nullable=False)
    close: Mapped[float] = mapped_column(Numeric(20, 8), nullable=False)
    volume: Mapped[float | None] = mapped_column(Numeric(28, 8))
    adjusted_close: Mapped[float | None] = mapped_column(Numeric(20, 8))

    source: Mapped[str] = mapped_column(Text, nullable=False)
    ingest_run_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        CheckConstraint(
            "timeframe IN ('1m','5m','15m','30m','1h','1d')",
            name="ck_candle_timeframe",
        ),
        Index("idx_candles_lookup", "instrument_id", "timeframe", "ts"),
    )


class StrategyModel(Base):
    __tablename__ = "strategy_models"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    parameter_schema: Mapped[dict] = mapped_column(JSON, nullable=False)
    version: Mapped[str] = mapped_column(Text, nullable=False, default="v1")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    strategy_model_id: Mapped[str] = mapped_column(
        Text, ForeignKey("strategy_models.id"), nullable=False
    )
    strategy_version: Mapped[str] = mapped_column(Text, nullable=False, default="v1")

    status: Mapped[str] = mapped_column(Text, nullable=False, default="queued")

    parameters: Mapped[dict] = mapped_column(JSON, nullable=False)
    execution_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    timeframe: Mapped[str] = mapped_column(Text, nullable=False)
    start_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    universe: Mapped[dict] = mapped_column(JSON, nullable=False)
    benchmark_instrument_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("instruments.id")
    )

    initial_capital: Mapped[float] = mapped_column(Numeric(20, 4), nullable=False, default=100000)
    final_equity: Mapped[float | None] = mapped_column(Numeric(20, 4))

    total_return: Mapped[float | None] = mapped_column(Float)
    cagr: Mapped[float | None] = mapped_column(Float)
    annual_volatility: Mapped[float | None] = mapped_column(Float)
    sharpe: Mapped[float | None] = mapped_column(Float)
    sortino: Mapped[float | None] = mapped_column(Float)
    max_drawdown: Mapped[float | None] = mapped_column(Float)
    beta: Mapped[float | None] = mapped_column(Float)
    alpha: Mapped[float | None] = mapped_column(Float)
    win_rate: Mapped[float | None] = mapped_column(Float)
    exposure: Mapped[float | None] = mapped_column(Float)
    turnover: Mapped[float | None] = mapped_column(Float)
    trade_count: Mapped[int | None] = mapped_column(Integer)

    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    progress_stage: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)

    celery_task_id: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    equity_points: Mapped[list["BacktestEquityPoint"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    trades: Mapped[list["TradeLog"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('queued','running','completed','failed','cancelled')",
            name="ck_run_status",
        ),
        Index("idx_backtest_runs_status", "status"),
        Index("idx_backtest_runs_created_at", "created_at"),
        Index("idx_backtest_runs_strategy", "strategy_model_id"),
    )


class BacktestEquityPoint(Base):
    __tablename__ = "backtest_equity_points"

    backtest_run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("backtest_runs.id", ondelete="CASCADE"), primary_key=True
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    equity: Mapped[float] = mapped_column(Numeric(20, 8), nullable=False)
    cash: Mapped[float | None] = mapped_column(Numeric(20, 8))
    gross_exposure: Mapped[float | None] = mapped_column(Numeric(20, 8))
    net_exposure: Mapped[float | None] = mapped_column(Numeric(20, 8))
    drawdown: Mapped[float | None] = mapped_column(Float)

    run: Mapped[BacktestRun] = relationship(back_populates="equity_points")


class TradeLog(Base):
    __tablename__ = "trade_logs"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)

    backtest_run_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("backtest_runs.id", ondelete="CASCADE")
    )
    paper_session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    instrument_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("instruments.id"), nullable=False
    )

    side: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(28, 8), nullable=False)

    entry_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    exit_ts: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    entry_price: Mapped[float] = mapped_column(Numeric(20, 8), nullable=False)
    exit_price: Mapped[float | None] = mapped_column(Numeric(20, 8))

    fees: Mapped[float] = mapped_column(Numeric(20, 8), nullable=False, default=0)
    slippage: Mapped[float] = mapped_column(Numeric(20, 8), nullable=False, default=0)

    realized_pnl: Mapped[float | None] = mapped_column(Numeric(20, 8))
    return_pct: Mapped[float | None] = mapped_column(Float)

    holding_bars: Mapped[int | None] = mapped_column(Integer)
    signal_context: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    run: Mapped[BacktestRun | None] = relationship(back_populates="trades")
    instrument: Mapped[Instrument] = relationship()

    __table_args__ = (
        CheckConstraint("side IN ('buy','sell','short','cover')", name="ck_trade_side"),
        Index("idx_trade_logs_backtest", "backtest_run_id"),
        Index("idx_trade_logs_instrument_ts", "instrument_id", "entry_ts"),
    )


class ParameterSweep(Base):
    __tablename__ = "parameter_sweeps"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    strategy_model_id: Mapped[str] = mapped_column(
        Text, ForeignKey("strategy_models.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, default="queued")

    base_config: Mapped[dict] = mapped_column(JSON, nullable=False)
    sweep_space: Mapped[dict] = mapped_column(JSON, nullable=False)

    objective_metric: Mapped[str] = mapped_column(Text, nullable=False, default="sharpe")
    best_result_id: Mapped[int | None] = mapped_column(BigInteger)

    total_points: Mapped[int | None] = mapped_column(Integer)
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    celery_task_id: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    results: Mapped[list["ParameterSweepResult"]] = relationship(
        back_populates="sweep", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('queued','running','completed','failed','cancelled')",
            name="ck_sweep_status",
        ),
    )


class ParameterSweepResult(Base):
    __tablename__ = "parameter_sweep_results"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    sweep_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("parameter_sweeps.id", ondelete="CASCADE"), nullable=False
    )
    parameter_point: Mapped[dict] = mapped_column(JSON, nullable=False)
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False)

    total_return: Mapped[float | None] = mapped_column(Float)
    sharpe: Mapped[float | None] = mapped_column(Float)
    sortino: Mapped[float | None] = mapped_column(Float)
    max_drawdown: Mapped[float | None] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    sweep: Mapped[ParameterSweep] = relationship(back_populates="results")

    __table_args__ = (
        Index("idx_sweep_results_sweep", "sweep_id"),
        Index("idx_sweep_results_sharpe", "sweep_id", "sharpe"),
    )
