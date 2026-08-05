"""SMA crossover — the classic golden-cross / death-cross trend follower.

The textbook one: hold long while the fast SMA is above the slow SMA, short (or
flat) while it's below. The signal *is* the crossover.

    target_position(t) = sign( fast_SMA(t) − slow_SMA(t) )

The engine shifts the target one bar (anti-lookahead). This is a pure trend
follower — it makes money when a market trends and bleeds via whipsaws when it
ranges. On FX majors (which mostly range) expect it to struggle; it does better
on trending pairs like the JPY crosses. Distinct from ``sma`` (SMA Divergence),
which fades crossovers rather than following them.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.services.strategies.base import ParameterError, ParamSpec, Strategy


class SmaCrossTrendStrategy(Strategy):
    id = "smacross"
    name = "SMA Crossover"
    description = (
        "Classic golden-cross / death-cross: long when the fast SMA is above the slow "
        "SMA, short when it's below. A pure trend follower — the crossover is the signal. "
        "Held until the averages cross back."
    )
    kind = "single"
    parameter_specs = [
        ParamSpec("fast", "fast SMA (bars)", "int", min=2, max=100, default=20),
        ParamSpec("slow", "slow SMA (bars)", "int", min=3, max=400, default=50),
    ]

    def validate_parameters(self, params: dict[str, Any]) -> dict[str, Any]:
        clean = super().validate_parameters(params)
        if clean["slow"] <= clean["fast"]:
            raise ParameterError("slow must be greater than fast")
        return clean

    def generate_signals(self, data: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        close = data["close"].astype(float)
        fast = close.rolling(params["fast"], min_periods=params["fast"]).mean()
        slow = close.rolling(params["slow"], min_periods=params["slow"]).mean()

        # Long above, short below — the sign of the gap between the two averages.
        target = np.sign((fast - slow).to_numpy())
        target[~(fast.notna() & slow.notna()).to_numpy()] = 0.0

        return pd.DataFrame(
            {
                "target_position": pd.Series(target, index=close.index),
                "fast_sma": fast,
                "slow_sma": slow,
            }
        )
