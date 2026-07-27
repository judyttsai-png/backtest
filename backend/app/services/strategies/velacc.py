"""Velocity / Acceleration — cross-sectional portfolio model.

Fits a quadratic to a rolling window of each instrument's log price, extracts
velocity (slope at the right edge) and acceleration (curvature), ranks the
universe by velocity, and holds the strongest names long (and, in long-short
mode, the weakest names short). Rebalanced every ``REBAL`` bars.

Ported and vectorised from the browser prototype's ``quadFit`` logic, with the
crucial fix that signals are aligned to the bar on which they are computed and
shifted by the engine to prevent lookahead.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.services.strategies.base import ParameterError, ParamSpec, Strategy

# Bars between rebalances for daily data.
REBAL = 5
BPS = 1e4  # thresholds are expressed in basis points per bar


def rolling_vel_acc(log_price: np.ndarray, window: int) -> tuple[np.ndarray, np.ndarray]:
    """Closed-form quadratic least-squares on a centred rolling window.

    Returns (velocity, acceleration) arrays. Velocity is the slope evaluated at
    the right edge of the window (≈ log-return/bar); acceleration is curvature
    (2a). Warmup entries are NaN. Centring the window makes the odd moment sums
    vanish, giving an O(1) solve per bar.
    """
    n = log_price.shape[0]
    vel = np.full(n, np.nan)
    acc = np.full(n, np.nan)
    if window < 3 or n < window:
        return vel, acc

    mid = (window - 1) / 2.0
    t = np.arange(window) - mid
    t2 = t * t
    s0 = float(window)
    s2 = float(t2.sum())
    s4 = float((t2 * t2).sum())
    denom = s0 * s4 - s2 * s2

    for i in range(window - 1, n):
        y = log_price[i - window + 1 : i + 1]
        if not np.all(np.isfinite(y)):
            continue
        sy = float(y.sum())
        sty = float((t * y).sum())
        st2y = float((t2 * y).sum())
        b = sty / s2
        a = (s0 * st2y - s2 * sy) / denom
        vel[i] = a * (window - 1) + b
        acc[i] = 2.0 * a
    return vel, acc


class VelocityAccelerationStrategy(Strategy):
    id = "velacc"
    name = "Velocity / Acceleration"
    description = (
        "Ranks instruments by rolling log-price velocity and acceleration. "
        "Longs the strongest names above the velocity/acceleration thresholds "
        "and (in long-short mode) shorts the weakest names below the negatives."
    )
    kind = "portfolio"
    parameter_specs = [
        ParamSpec("window", "fit window (bars)", "int", min=5, max=60, default=20),
        ParamSpec("vthr", "velocity threshold (bps/bar)", "float", min=0.0, max=40.0, default=2.0),
        ParamSpec("athr", "accel threshold (bps/bar²)", "float", min=0.0, max=20.0, default=0.0),
        ParamSpec("hold", "positions per side", "int", min=1, max=15, default=5),
    ]

    def validate_parameters(self, params: dict[str, Any]) -> dict[str, Any]:
        clean = super().validate_parameters(params)
        if clean["hold"] < 1:
            raise ParameterError("hold must be >= 1")
        return clean

    def generate_signals(self, data: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        """``data`` is a close panel: index=ts, columns=symbols. Returns a
        target-weight panel of the same shape (positive=long, negative=short)."""
        close = data.astype(float)
        symbols = list(close.columns)
        window = params["window"]
        vthr = params["vthr"]
        athr = params["athr"]
        hold = params["hold"]

        log_px = np.log(close.to_numpy())
        n, m = log_px.shape

        vel = np.full((n, m), np.nan)
        acc = np.full((n, m), np.nan)
        for j in range(m):
            vel[:, j], acc[:, j] = rolling_vel_acc(log_px[:, j], window)

        weights = np.zeros((n, m), dtype=float)
        current = np.zeros(m, dtype=float)

        for i in range(window - 1, n):
            if (i - (window - 1)) % REBAL == 0:  # rebalance bar
                current = self._target_weights(vel[i] * BPS, acc[i] * BPS, vthr, athr, hold, m)
            weights[i] = current

        return pd.DataFrame(weights, index=close.index, columns=symbols)

    @staticmethod
    def _target_weights(
        v_row: np.ndarray, a_row: np.ndarray, vthr: float, athr: float, hold: int, m: int
    ) -> np.ndarray:
        w = np.zeros(m, dtype=float)
        valid = np.isfinite(v_row) & np.isfinite(a_row)
        if not valid.any():
            return w

        strong = np.argsort(-np.where(valid, v_row, -np.inf))
        longs = [k for k in strong if valid[k] and v_row[k] >= vthr and a_row[k] >= athr][:hold]

        weak = np.argsort(np.where(valid, v_row, np.inf))
        shorts = [k for k in weak if valid[k] and v_row[k] <= -vthr and a_row[k] <= -athr][:hold]

        for k in longs:
            w[k] = 1.0 / hold
        for k in shorts:
            w[k] = -1.0 / hold
        return w
