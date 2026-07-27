"""SMA crossover — single-asset trend model."""
from __future__ import annotations

from typing import Any

import pandas as pd

from app.services.strategies.base import ParameterError, ParamSpec, Strategy


class SmaCrossoverStrategy(Strategy):
    id = "sma"
    name = "SMA Crossover"
    description = (
        "Long when the fast simple moving average is above the slow SMA. "
        "Flat (or short in long-short mode) otherwise."
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

        # Directional view: +1 bullish, -1 bearish, 0 during warmup.
        # The engine clamps -1 -> 0 in long_flat mode.
        target = pd.Series(0, index=close.index, dtype=int)
        valid = fast.notna() & slow.notna()
        target[valid & (fast > slow)] = 1
        target[valid & (fast <= slow)] = -1

        return pd.DataFrame(
            {
                "target_position": target,
                "fast_sma": fast,
                "slow_sma": slow,
            }
        )
