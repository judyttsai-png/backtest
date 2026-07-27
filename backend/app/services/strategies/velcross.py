"""Velocity Crossover — cross-sectional FX momentum/reversion portfolio.

A faithful port of the standalone ``momentum_model`` (signals + portfolio +
backtest) into PARABOLA's Strategy interface. Distinct from the simpler
``velacc`` model: this one uses a fast/slow velocity **crossover**, ranks by
**zvel = v_fast / rolling_vol** (volatility-normalised velocity), sizes each
position by **inverse volatility** (risk targeting) rather than equal weight,
exits the instant the crossover flips against the position, and supports a
**reversion** toggle (long recent fallers / short recent risers — the edge at
short horizons where returns mean-revert).

Velocity is the closed-form quadratic least-squares slope at a centred window's
right edge — identical to ``momentum_model.signals.rolling_velocity``.

Returns a target-weight panel; the engine shifts it one bar (anti-lookahead),
applies returns, and charges turnover cost. Run in long-short mode.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.services.strategies.base import ParameterError, ParamSpec, Strategy

W_MAX = 2.0        # cap on any single position's size multiple
GROSS_LEVERAGE = 1.0  # target total gross exposure for a full book
BPS = 1e4


def rolling_velocity(log_price: np.ndarray, window: int) -> np.ndarray:
    """Quadratic LSQ slope evaluated at the window's right edge; NaN warmup.
    Fits y(tau)=a*tau^2+b*tau+c over centred tau, returns v = a*(window-1)+b."""
    n = log_price.shape[0]
    vel = np.full(n, np.nan)
    if window < 3 or n < window:
        return vel
    mid = (window - 1) / 2.0
    tau = np.arange(window) - mid
    tau2 = tau * tau
    s0 = float(window)
    s2 = float(tau2.sum())
    s4 = float((tau2 * tau2).sum())
    denom = s0 * s4 - s2 * s2
    for i in range(window - 1, n):
        y = log_price[i - window + 1 : i + 1]
        if not np.all(np.isfinite(y)):
            continue
        sy = float(y.sum())
        sty = float((tau * y).sum())
        st2y = float((tau2 * y).sum())
        b = sty / s2
        a = (s0 * st2y - s2 * sy) / denom
        vel[i] = a * (window - 1) + b
    return vel


def rolling_vol(returns: np.ndarray, window: int) -> np.ndarray:
    """Rolling sample stdev (ddof=1) of log returns; NaN warmup."""
    n = returns.shape[0]
    rvol = np.full(n, np.nan)
    if n < window:
        return rvol
    for i in range(window - 1, n):
        r = returns[i - window + 1 : i + 1]
        if not np.all(np.isfinite(r)):
            continue
        rvol[i] = np.std(r, ddof=1)
    return rvol


class VelocityCrossoverStrategy(Strategy):
    id = "velcross"
    name = "Velocity Crossover"
    description = (
        "Fast/slow velocity crossover ranked by zvel (velocity / rolling vol). "
        "Enters when |v_fast| clears the bps gate and the crossover agrees, sizes "
        "by inverse volatility (risk targeting), and exits the bar the crossover "
        "flips. Reversion toggle longs recent fallers / shorts recent risers."
    )
    kind = "portfolio"
    parameter_specs = [
        ParamSpec("fast", "fast velocity window (bars)", "int", min=2, max=60, default=5),
        ParamSpec("slow", "slow velocity window (bars)", "int", min=3, max=120, default=20),
        ParamSpec("vol", "volatility window (bars)", "int", min=3, max=120, default=20),
        ParamSpec("vthr", "entry gate (bps/bar)", "float", min=0.0, max=40.0, default=5.0, step=0.5),
        ParamSpec("hold", "positions per side", "int", min=1, max=15, default=5),
        ParamSpec("rebal", "rebalance every (bars)", "int", min=1, max=60, default=5),
        ParamSpec("rev", "reversion (0=momentum, 1=reversion)", "int", min=0, max=1, default=0),
    ]

    def validate_parameters(self, params: dict[str, Any]) -> dict[str, Any]:
        clean = super().validate_parameters(params)
        if clean["slow"] <= clean["fast"]:
            raise ParameterError("slow window must be greater than fast window")
        if clean["hold"] < 1:
            raise ParameterError("hold must be >= 1")
        return clean

    def generate_signals(self, data: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        """``data`` is a close panel (index=ts, columns=symbols). Returns a
        target-weight panel of the same shape (positive=long, negative=short)."""
        close = data.astype(float)
        symbols = list(close.columns)
        fast, slow, vol_w = params["fast"], params["slow"], params["vol"]
        vthr, hold, rebal, rev = params["vthr"], params["hold"], params["rebal"], params["rev"]

        log_price = np.log(close.to_numpy())
        n, m = log_price.shape

        v_fast = np.full((n, m), np.nan)
        v_slow = np.full((n, m), np.nan)
        rvol = np.full((n, m), np.nan)
        for j in range(m):
            v_fast[:, j] = rolling_velocity(log_price[:, j], fast)
            v_slow[:, j] = rolling_velocity(log_price[:, j], slow)
            r = np.diff(log_price[:, j], prepend=np.nan)
            rvol[:, j] = rolling_vol(r, vol_w)

        with np.errstate(divide="ignore", invalid="ignore"):
            zvel = v_fast / rvol
        cross = v_fast - v_slow

        # Reversion: flip selection/exit signals; P&L still uses real returns.
        if rev:
            v_fast = -v_fast
            zvel = -zvel
            cross = -cross

        # Auto risk target: size a median-vol name so a full book lands near the
        # gross-leverage target instead of ~1x per name.
        target_risk = float(np.nanmedian(rvol)) * GROSS_LEVERAGE / (2 * hold)
        warmup = max(slow, vol_w)

        weights = np.zeros((n, m))
        position = np.zeros(m)
        for i in range(warmup, n):
            # exits every bar: close when the crossover flips against the position
            exit_long = (position > 0) & (cross[i] < 0)
            exit_short = (position < 0) & (cross[i] > 0)
            position[exit_long | exit_short] = 0.0

            # entries only on rebalance bars, only for names not already held
            if (i - warmup) % rebal == 0:
                held = position != 0
                valid = np.isfinite(zvel[i]) & np.isfinite(rvol[i]) & (rvol[i] > 0)
                elig_long = ~held & valid & (v_fast[i] * BPS >= vthr) & (cross[i] > 0)
                elig_short = ~held & valid & (v_fast[i] * BPS <= -vthr) & (cross[i] < 0)

                long_c = np.where(elig_long)[0]
                short_c = np.where(elig_short)[0]
                longs = long_c[np.argsort(-zvel[i, long_c])][:hold]
                shorts = short_c[np.argsort(zvel[i, short_c])][:hold]

                for j in longs:
                    position[j] = min(target_risk / rvol[i, j], W_MAX)
                for j in shorts:
                    position[j] = -min(target_risk / rvol[i, j], W_MAX)

            weights[i] = position

        return pd.DataFrame(weights, index=close.index, columns=symbols)
