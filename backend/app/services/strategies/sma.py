"""SMA divergence — single-asset mean-reversion at a crossover.

Not the usual trend crossover. This fires only when the two moving averages and
price disagree at a crossover:

    SHORT  when both SMAs are RISING, they cross, but price is FALLING
    LONG   when both SMAs are FALLING, they cross, but price is RISING

The averages lag, so when they're still rising while price has already turned
down (and the fast/slow lines cross), it flags a possible top — and vice versa
for a bottom. The position is held until the opposite setup fires.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.services.strategies.base import ParameterError, ParamSpec, Strategy


class SmaCrossoverStrategy(Strategy):
    id = "sma"
    name = "SMA Divergence"
    description = (
        "Short when both SMAs are rising and cross while price falls; long when both "
        "SMAs are falling and cross while price rises. A crossover-divergence reversal "
        "model — held until the opposite setup fires."
    )
    kind = "single"
    parameter_specs = [
        ParamSpec("fast", "fast SMA (bars)", "int", min=2, max=100, default=10),
        ParamSpec("slow", "slow SMA (bars)", "int", min=3, max=300, default=40),
    ]

    def validate_parameters(self, params: dict[str, Any]) -> dict[str, Any]:
        clean = super().validate_parameters(params)
        if clean["fast"] < 2:
            raise ParameterError("fast must be >= 2")
        if clean["slow"] <= clean["fast"]:
            raise ParameterError("slow must be greater than fast")
        return clean

    def generate_signals(self, data: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        close = data["close"].astype(float)
        fast = close.rolling(params["fast"], min_periods=params["fast"]).mean()
        slow = close.rolling(params["slow"], min_periods=params["slow"]).mean()

        diff = fast - slow
        diff_prev = diff.shift(1)
        # a crossover this bar = the sign of (fast - slow) flipped
        crossed = (diff > 0) != (diff_prev > 0)
        both_rising = (fast > fast.shift(1)) & (slow > slow.shift(1))
        both_falling = (fast < fast.shift(1)) & (slow < slow.shift(1))
        price_rising = close > close.shift(1)
        price_falling = close < close.shift(1)

        valid = fast.notna() & slow.notna() & diff_prev.notna()
        short_sig = valid & crossed & both_rising & price_falling
        long_sig = valid & crossed & both_falling & price_rising

        # Stateful: enter on a setup, hold until the opposite setup fires.
        ls = long_sig.to_numpy()
        ss = short_sig.to_numpy()
        ok = valid.to_numpy()
        n = len(close)
        target = np.zeros(n, dtype=int)
        pos = 0
        for i in range(n):
            if not ok[i]:
                pos = 0
            elif ls[i]:
                pos = 1
            elif ss[i]:
                pos = -1
            target[i] = pos

        return pd.DataFrame(
            {
                "target_position": pd.Series(target, index=close.index),
                "fast_sma": fast,
                "slow_sma": slow,
            }
        )
