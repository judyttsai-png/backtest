"""Performance metrics computed in Python and persisted with each run.

Mirrors the metric list in docs/07-strategy-engine.md. All ratios use a
risk-free rate of zero for v1 and per-timeframe annualization factors.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

ANNUALIZATION: dict[str, float] = {
    "1d": 252.0,
    "1h": 252.0 * 6.5,
    "30m": 252.0 * 13.0,
    "15m": 252.0 * 26.0,
    "5m": 252.0 * 78.0,
    "1m": 252.0 * 390.0,
}


@dataclass
class BacktestMetrics:
    total_return: float
    cagr: float
    annual_volatility: float
    sharpe: float
    sortino: float
    max_drawdown: float
    beta: float
    alpha: float
    win_rate: float
    exposure: float
    turnover: float
    final_equity: float

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


def _safe(value: float) -> float:
    if value is None or math.isnan(value) or math.isinf(value):
        return 0.0
    return float(value)


def drawdown_series(equity: pd.Series) -> pd.Series:
    running_max = equity.cummax()
    return equity / running_max - 1.0


def compute_metrics(
    returns: pd.Series,
    equity: pd.Series,
    timeframe: str,
    *,
    benchmark_returns: pd.Series | None = None,
    exposure_series: pd.Series | None = None,
    turnover_total: float = 0.0,
    trade_returns: list[float] | None = None,
    initial_capital: float = 100_000.0,
) -> BacktestMetrics:
    ann = ANNUALIZATION.get(timeframe, 252.0)
    returns = returns.fillna(0.0)
    n = len(returns)

    total_return = float(equity.iloc[-1] / equity.iloc[0] - 1.0) if len(equity) else 0.0

    years = n / ann if ann else 0.0
    if years > 0 and equity.iloc[0] > 0:
        cagr = float((equity.iloc[-1] / equity.iloc[0]) ** (1.0 / years) - 1.0)
    else:
        cagr = 0.0

    std = float(returns.std(ddof=0))
    mean = float(returns.mean())
    annual_volatility = std * math.sqrt(ann)
    sharpe = (mean / std * math.sqrt(ann)) if std > 0 else 0.0

    downside = returns[returns < 0]
    dstd = float(downside.std(ddof=0)) if len(downside) else 0.0
    sortino = (mean / dstd * math.sqrt(ann)) if dstd > 0 else 0.0

    dd = drawdown_series(equity)
    max_drawdown = float(dd.min()) if len(dd) else 0.0

    beta = 0.0
    alpha = 0.0
    if benchmark_returns is not None and len(benchmark_returns) == n:
        bench = benchmark_returns.fillna(0.0)
        var_b = float(bench.var(ddof=0))
        if var_b > 0:
            cov = float(np.cov(returns.to_numpy(), bench.to_numpy(), ddof=0)[0, 1])
            beta = cov / var_b
            alpha = (mean - beta * float(bench.mean())) * ann

    exposure = float(exposure_series.abs().mean()) if exposure_series is not None else 0.0

    if trade_returns:
        wins = sum(1 for r in trade_returns if r > 0)
        win_rate = wins / len(trade_returns)
    else:
        positive_bars = int((returns > 0).sum())
        active = int((returns != 0).sum())
        win_rate = positive_bars / active if active else 0.0

    return BacktestMetrics(
        total_return=_safe(total_return),
        cagr=_safe(cagr),
        annual_volatility=_safe(annual_volatility),
        sharpe=_safe(sharpe),
        sortino=_safe(sortino),
        max_drawdown=_safe(max_drawdown),
        beta=_safe(beta),
        alpha=_safe(alpha),
        win_rate=_safe(win_rate),
        exposure=_safe(exposure),
        turnover=_safe(turnover_total),
        final_equity=_safe(float(equity.iloc[-1]) if len(equity) else initial_capital),
    )
