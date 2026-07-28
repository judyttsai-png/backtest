"""Vectorised v1 backtest engine.

Execution convention (anti-lookahead): a strategy's target position/weight for
bar ``t`` is shifted to ``t+1`` before being multiplied by returns, so a signal
derived from bar ``t``'s close cannot earn bar ``t``'s return.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from app.services.metrics import BacktestMetrics, compute_metrics, drawdown_series
from app.services.strategies import get_strategy


@dataclass
class Trade:
    symbol: str
    side: str  # 'buy' (long) or 'short'
    quantity: float
    entry_ts: datetime
    exit_ts: datetime | None
    entry_price: float
    exit_price: float | None
    fees: float
    slippage: float
    realized_pnl: float | None
    return_pct: float | None
    holding_bars: int | None
    signal_context: dict[str, Any] = field(default_factory=dict)


@dataclass
class EquityPoint:
    ts: datetime
    equity: float
    cash: float | None
    gross_exposure: float | None
    net_exposure: float | None
    drawdown: float | None


@dataclass
class Marker:
    symbol: str
    ts: datetime
    kind: str  # 'long_entry' | 'short_entry' | 'exit'
    price: float


@dataclass
class BacktestResult:
    metrics: BacktestMetrics
    equity_points: list[EquityPoint]
    trades: list[Trade]
    markers: list[Marker]
    benchmark_equity: list[tuple[datetime, float]]
    primary_symbol: str


@dataclass
class ExecutionConfig:
    mode: str = "long_flat"
    cost_bps: float = 5.0
    slippage_bps: float = 0.0
    initial_capital: float = 100_000.0
    allocation: str = "all_in"  # "all_in" | "equal" (equal-weight the book)
    topup_pct: float = 0.0  # captured with the run; sizing engine WIP
    trim_pct: float = 0.0

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ExecutionConfig":
        return cls(
            mode=d.get("mode", "long_flat"),
            cost_bps=float(d.get("cost_bps", 5.0)),
            slippage_bps=float(d.get("slippage_bps", 0.0)),
            initial_capital=float(d.get("initial_capital", 100_000.0)),
            allocation=d.get("allocation", "all_in"),
            topup_pct=float(d.get("topup_pct", 0.0)),
            trim_pct=float(d.get("trim_pct", 0.0)),
        )

    @property
    def total_bps(self) -> float:
        return self.cost_bps + self.slippage_bps


def run_strategy_backtest(
    strategy_model_id: str,
    parameters: dict[str, Any],
    candles: "CandleBundle",
    execution_config: dict[str, Any] | ExecutionConfig,
) -> BacktestResult:
    strategy = get_strategy(strategy_model_id)
    params = strategy.validate_parameters(parameters)
    exec_cfg = (
        execution_config
        if isinstance(execution_config, ExecutionConfig)
        else ExecutionConfig.from_dict(execution_config or {})
    )

    if strategy.kind == "portfolio":
        return _run_portfolio(strategy, params, candles, exec_cfg)
    return _run_single(strategy, params, candles, exec_cfg)


# ---------------------------------------------------------------------------
# Single-asset
# ---------------------------------------------------------------------------
def _run_single(strategy, params, candles, exec_cfg: ExecutionConfig) -> BacktestResult:
    symbol = candles.symbols[0]
    df = candles.panels[symbol]
    if len(df) < 3:
        raise ValueError(f"insufficient candles for {symbol} (need >= 3)")

    close = df["close"].astype(float)
    signals = strategy.generate_signals(df, params)
    target = signals["target_position"].astype(float)
    if exec_cfg.mode == "long_flat":
        target = target.clip(lower=0.0)

    position = target.shift(1).fillna(0.0)  # anti-lookahead
    returns = close.pct_change().fillna(0.0)

    turnover = (position - position.shift(1)).abs().fillna(position.abs())
    cost = turnover * exec_cfg.total_bps / 1e4
    strat_returns = position * returns - cost

    equity = (1.0 + strat_returns).cumprod() * exec_cfg.initial_capital
    bench_returns, bench_equity = _benchmark(candles, returns, exec_cfg.initial_capital)

    trades, trade_returns, markers = _extract_single_trades(
        symbol, position, close, exec_cfg
    )

    metrics = compute_metrics(
        strat_returns,
        equity,
        candles.timeframe,
        benchmark_returns=bench_returns,
        exposure_series=position.abs(),
        turnover_total=float(turnover.sum()),
        trade_returns=trade_returns,
        initial_capital=exec_cfg.initial_capital,
    )

    equity_points = _equity_points(equity, gross=position.abs(), net=position)
    return BacktestResult(
        metrics=metrics,
        equity_points=equity_points,
        trades=trades,
        markers=markers,
        benchmark_equity=bench_equity,
        primary_symbol=symbol,
    )


def _extract_single_trades(symbol, position, close, exec_cfg):
    trades: list[Trade] = []
    trade_returns: list[float] = []
    markers: list[Marker] = []

    pos = position.to_numpy()
    px = close.to_numpy()
    idx = position.index

    open_dir = 0
    entry_i = 0
    for i in range(len(pos)):
        prev = pos[i - 1] if i > 0 else 0.0
        cur = pos[i]
        if cur != prev:
            # Close an existing position on direction change / flatten.
            if open_dir != 0:
                _close_single(
                    trades, trade_returns, markers, symbol, open_dir, entry_i, i, idx, px, exec_cfg
                )
                open_dir = 0
            # Open a new position.
            if cur != 0.0:
                open_dir = int(np.sign(cur))
                entry_i = i
                markers.append(
                    Marker(
                        symbol,
                        idx[i].to_pydatetime(),
                        "long_entry" if open_dir > 0 else "short_entry",
                        float(px[i]),
                    )
                )

    if open_dir != 0:  # close out at final bar
        _close_single(
            trades, trade_returns, markers, symbol, open_dir, entry_i, len(pos) - 1, idx, px, exec_cfg
        )
    return trades, trade_returns, markers


def _close_single(trades, trade_returns, markers, symbol, direction, entry_i, exit_i, idx, px, exec_cfg):
    entry_price = float(px[entry_i])
    exit_price = float(px[exit_i])
    ret = direction * (exit_price / entry_price - 1.0)
    quantity = exec_cfg.initial_capital / entry_price
    fees = exec_cfg.initial_capital * exec_cfg.cost_bps / 1e4
    slippage = exec_cfg.initial_capital * exec_cfg.slippage_bps / 1e4
    pnl = quantity * (exit_price - entry_price) * direction - fees - slippage
    trade_returns.append(ret)
    trades.append(
        Trade(
            symbol=symbol,
            side="buy" if direction > 0 else "short",
            quantity=quantity,
            entry_ts=idx[entry_i].to_pydatetime(),
            exit_ts=idx[exit_i].to_pydatetime(),
            entry_price=entry_price,
            exit_price=exit_price,
            fees=fees,
            slippage=slippage,
            realized_pnl=pnl,
            return_pct=ret,
            holding_bars=int(exit_i - entry_i),
            signal_context={"direction": direction},
        )
    )
    markers.append(Marker(symbol, idx[exit_i].to_pydatetime(), "exit", exit_price))


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------
def _run_portfolio(strategy, params, candles, exec_cfg: ExecutionConfig) -> BacktestResult:
    close_panel = candles.close_panel
    if close_panel is None or close_panel.shape[0] < 3 or close_panel.shape[1] < 1:
        raise ValueError("insufficient panel data for portfolio backtest")

    weights = strategy.generate_signals(close_panel, params)
    weights = weights.reindex(index=close_panel.index, columns=close_panel.columns).fillna(0.0)
    if exec_cfg.mode == "long_flat":
        weights = weights.clip(lower=0.0)
    if exec_cfg.allocation == "equal":
        # Equal distribution: give every held name the same gross weight (1/N per
        # bar), overriding the strategy's own sizing, keeping the long/short sign.
        n_held = (weights != 0).sum(axis=1).replace(0, np.nan)
        weights = np.sign(weights).mul(1.0 / n_held, axis=0).fillna(0.0)

    applied = weights.shift(1).fillna(0.0)  # anti-lookahead
    asset_returns = close_panel.pct_change().fillna(0.0)
    portfolio_returns = (applied * asset_returns).sum(axis=1)

    turnover = (applied - applied.shift(1)).abs().sum(axis=1).fillna(applied.abs().sum(axis=1))
    cost = turnover * exec_cfg.total_bps / 1e4
    strat_returns = portfolio_returns - cost

    equity = (1.0 + strat_returns).cumprod() * exec_cfg.initial_capital
    bench_returns = asset_returns.mean(axis=1)
    bench_equity_series = (1.0 + bench_returns).cumprod() * exec_cfg.initial_capital
    bench_equity = [
        (ts.to_pydatetime(), float(v)) for ts, v in bench_equity_series.items()
    ]

    trades, trade_returns, markers = _extract_portfolio_trades(applied, close_panel, exec_cfg)

    gross = applied.abs().sum(axis=1)
    net = applied.sum(axis=1)

    metrics = compute_metrics(
        strat_returns,
        equity,
        candles.timeframe,
        benchmark_returns=bench_returns,
        exposure_series=gross,
        turnover_total=float(turnover.sum()),
        trade_returns=trade_returns,
        initial_capital=exec_cfg.initial_capital,
    )

    equity_points = _equity_points(equity, gross=gross, net=net)
    return BacktestResult(
        metrics=metrics,
        equity_points=equity_points,
        trades=trades,
        markers=markers,
        benchmark_equity=bench_equity,
        primary_symbol=candles.symbols[0],
    )


def _extract_portfolio_trades(applied: pd.DataFrame, close_panel: pd.DataFrame, exec_cfg):
    trades: list[Trade] = []
    trade_returns: list[float] = []
    markers: list[Marker] = []
    idx = applied.index

    for symbol in applied.columns:
        w = applied[symbol].to_numpy()
        px = close_panel[symbol].to_numpy()
        open_dir = 0
        entry_i = 0
        for i in range(len(w)):
            prev = w[i - 1] if i > 0 else 0.0
            cur = w[i]
            changed = (np.sign(cur) != np.sign(prev))
            if changed:
                if open_dir != 0 and not np.isnan(px[entry_i]) and not np.isnan(px[i]):
                    _close_single(
                        trades, trade_returns, markers, symbol, open_dir, entry_i, i, idx, px, exec_cfg
                    )
                    open_dir = 0
                if cur != 0.0:
                    open_dir = int(np.sign(cur))
                    entry_i = i
        if open_dir != 0:
            _close_single(
                trades, trade_returns, markers, symbol, open_dir, entry_i, len(w) - 1, idx, px, exec_cfg
            )
    return trades, trade_returns, markers


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _benchmark(candles, fallback_returns: pd.Series, initial_capital: float):
    if candles.benchmark is not None and len(candles.benchmark) == len(fallback_returns):
        bench_close = candles.benchmark["close"].astype(float)
        bench_returns = bench_close.pct_change().fillna(0.0)
    else:
        bench_returns = fallback_returns  # buy & hold of the traded asset
    bench_equity_series = (1.0 + bench_returns).cumprod() * initial_capital
    bench_equity = [(ts.to_pydatetime(), float(v)) for ts, v in bench_equity_series.items()]
    return bench_returns, bench_equity


def _equity_points(equity: pd.Series, gross: pd.Series, net: pd.Series) -> list[EquityPoint]:
    dd = drawdown_series(equity)
    points: list[EquityPoint] = []
    for ts in equity.index:
        points.append(
            EquityPoint(
                ts=ts.to_pydatetime(),
                equity=float(equity.loc[ts]),
                cash=None,
                gross_exposure=float(gross.loc[ts]) if ts in gross.index else None,
                net_exposure=float(net.loc[ts]) if ts in net.index else None,
                drawdown=float(dd.loc[ts]),
            )
        )
    return points


# Imported lazily to avoid a cycle at module import time.
from app.services.data_loader import CandleBundle  # noqa: E402
