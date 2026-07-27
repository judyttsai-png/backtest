"""DMI / ADX trend model — single-asset directional-movement system.

Wilder's Directional Movement Index. +DI vs -DI gives direction; ADX gives
trend strength (ADX itself is directionless). The classic division of labour:
trade the DI direction, but only when ADX confirms a real, strengthening trend.

Rules (agreed with the desk):

    Entry (strict — both must hold):
        long  : +DI > -DI  AND  ADX rising  AND  ADX > floor
        short : +DI < -DI  AND  ADX rising  AND  ADX > floor

    Exit (protective — either breaks it):
        exit  : ADX flat (slope <= 0)  OR  the DI cross reverses

Entry is strict (be slow getting in), exit fires on *either* condition (be
quick getting out) — so a long is closed the moment -DI overtakes +DI even if
ADX is still drifting up. The position is held between an entry and its exit
(this model is stateful, unlike the stateless SMA/ROC models).

Execution convention: target positions are aligned to the bar on which they are
computed; the engine shifts them by one bar (anti-lookahead).

ADX/DI use Wilder's smoothing (RMA), the standard for this indicator.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.services.strategies.base import ParameterError, ParamSpec, Strategy


def _rma(series: pd.Series, length: int) -> pd.Series:
    """Wilder's moving average (RMA): an EWMA with alpha = 1/length."""
    return series.ewm(alpha=1.0 / length, adjust=False).mean()


def wilder_dmi(
    high: pd.Series, low: pd.Series, close: pd.Series, length: int
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Return (+DI, -DI, ADX) using Wilder's method. Warmup bars are NaN."""
    up_move = high.diff()
    down_move = -low.diff()  # previous_low - low

    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=high.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=high.index)

    prev_close = close.shift(1)
    tr = pd.concat(
        [(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)

    atr = _rma(tr, length)
    plus_di = 100.0 * _rma(plus_dm, length) / atr
    minus_di = 100.0 * _rma(minus_dm, length) / atr

    di_sum = (plus_di + minus_di).replace(0.0, np.nan)
    dx = 100.0 * (plus_di - minus_di).abs() / di_sum
    adx = _rma(dx, length)

    # Blank the warmup region so signals don't fire on unstable early values.
    warmup = 2 * length
    plus_di.iloc[:warmup] = np.nan
    minus_di.iloc[:warmup] = np.nan
    adx.iloc[:warmup] = np.nan
    return plus_di, minus_di, adx


class DmiTrendStrategy(Strategy):
    id = "dmi"
    name = "DMI / ADX Trend"
    description = (
        "Wilder Directional Movement. Enters strictly (DI direction AND rising "
        "ADX above a floor) and exits protectively (ADX goes flat OR the DI "
        "cross reverses). Long/short in long-short mode; longs only otherwise."
    )
    kind = "single"
    parameter_specs = [
        ParamSpec("length", "DMI/ADX period (bars)", "int", min=2, max=100, default=14),
        ParamSpec("adx_floor", "ADX floor (trend strength)", "float", min=0.0, max=60.0, default=20.0, step=1.0),
        ParamSpec("slope", "ADX slope window (bars)", "int", min=1, max=20, default=3),
    ]

    def validate_parameters(self, params: dict[str, Any]) -> dict[str, Any]:
        clean = super().validate_parameters(params)
        if clean["length"] < 2:
            raise ParameterError("length must be >= 2")
        if clean["slope"] < 1:
            raise ParameterError("slope must be >= 1")
        return clean

    def generate_signals(self, data: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        high = data["high"].astype(float)
        low = data["low"].astype(float)
        close = data["close"].astype(float)
        length = params["length"]
        floor = params["adx_floor"]
        slope_win = params["slope"]

        plus_di, minus_di, adx = wilder_dmi(high, low, close, length)
        adx_slope = adx - adx.shift(slope_win)

        adx_rising = adx_slope > 0
        adx_flat = adx_slope <= 0
        adx_ok = adx > floor

        long_entry = (plus_di > minus_di) & adx_rising & adx_ok
        short_entry = (plus_di < minus_di) & adx_rising & adx_ok
        long_exit = adx_flat | (plus_di <= minus_di)
        short_exit = adx_flat | (minus_di <= plus_di)

        # Stateful hold: enter strictly, hold until the protective exit fires.
        valid = plus_di.notna() & minus_di.notna() & adx.notna() & adx_slope.notna()
        le = long_entry.to_numpy()
        se = short_entry.to_numpy()
        lx = long_exit.to_numpy()
        sx = short_exit.to_numpy()
        ok = valid.to_numpy()

        n = len(close)
        target = np.zeros(n, dtype=int)
        pos = 0
        for i in range(n):
            if not ok[i]:
                pos = 0
            elif pos == 0:
                if le[i]:
                    pos = 1
                elif se[i]:
                    pos = -1
            elif pos == 1:
                if lx[i]:
                    pos = 0
            elif pos == -1:
                if sx[i]:
                    pos = 0
            target[i] = pos

        return pd.DataFrame(
            {
                "target_position": pd.Series(target, index=close.index),
                "plus_di": plus_di,
                "minus_di": minus_di,
                "adx": adx,
                "adx_slope": adx_slope,
            }
        )
