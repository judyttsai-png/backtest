"""ROC momentum — single-asset rate-of-change model."""
from __future__ import annotations

from typing import Any

import pandas as pd

from app.services.strategies.base import ParamSpec, Strategy


class RocMomentumStrategy(Strategy):
    id = "roc"
    name = "ROC Momentum"
    description = (
        "Rate-of-change momentum. Long when N-bar return exceeds +threshold; "
        "short when it falls below -threshold (long-short mode); flat inside the band."
    )
    kind = "single"
    parameter_specs = [
        ParamSpec("look", "lookback (bars)", "int", min=2, max=252, default=20),
        ParamSpec("thr", "threshold (%)", "float", min=0.0, max=25.0, default=1.0, step=0.5),
    ]

    def generate_signals(self, data: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        close = data["close"].astype(float)
        look = params["look"]
        thr = params["thr"] / 100.0  # threshold expressed in percent

        roc = close / close.shift(look) - 1.0

        target = pd.Series(0, index=close.index, dtype=int)
        target[roc > thr] = 1
        target[roc < -thr] = -1
        target[roc.isna()] = 0

        return pd.DataFrame({"target_position": target, "roc": roc})
