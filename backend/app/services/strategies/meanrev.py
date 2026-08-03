"""Mean reversion — fade the prior bar's return.

A faithful port of the "professional mean reversion" notebook (lag-1 return
reversal). The whole idea, in one line:

    target_position(t) = -sign( return over the last `lookback` bars )

so after a down move you go long, after an up move you go short. The engine
shifts the target by one bar (anti-lookahead), which reproduces the notebook's
signal exactly:

    position(t) = -sign(return_{t-1})      # decided yesterday, held into today
    pnl(t)      = position(t) * return(t)   # = -sign(return_{t-1}) * return(t)

Notes carried over from the notebook's lesson:
  * This strategy is ALWAYS in the market and flips most bars, so it churns.
    Turnover cost (the run's cost_bps / slippage_bps) is where the paper edge
    goes to die — set a realistic spread and watch net vs gross. That is the
    entire point of the "with fees" version.
  * The edge is a real short-horizon reversal effect, but it is small per trade;
    validate out-of-sample before trusting it (the notebook's 75/25 split).

`lookback` = 1 reproduces the notebook. Larger values fade a longer move.
`band_bps` adds a deadzone: ignore moves smaller than this (0 = always in).
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.services.strategies.base import ParamSpec, Strategy


class MeanReversionStrategy(Strategy):
    id = "meanrev"
    name = "Mean Reversion"
    description = (
        "Fade the prior move: go long after a down bar, short after an up bar "
        "(target = -sign of the last `lookback`-bar return). A short-horizon "
        "reversal — always in the market, so it churns; check net-of-cost equity."
    )
    kind = "single"
    parameter_specs = [
        ParamSpec("lookback", "fade window (bars)", "int", min=1, max=60, default=1),
        ParamSpec("band_bps", "deadzone (bps)", "float", min=0, max=500, default=0, step=5),
    ]

    def generate_signals(self, data: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        close = data["close"].astype(float)
        lookback = int(params["lookback"])
        band = float(params["band_bps"]) / 1e4

        # Return over the last `lookback` bars, ending at bar t.
        mom = close.pct_change(lookback)
        # Fade it, unless the move is inside the deadzone.
        target = -np.sign(mom.to_numpy())
        target[np.abs(mom.to_numpy()) <= band] = 0.0
        target[np.isnan(mom.to_numpy())] = 0.0

        return pd.DataFrame(
            {
                "target_position": pd.Series(target, index=close.index),
                # Diagnostic: the prior move being faded, in %.
                "prior_return_pct": mom * 100.0,
            }
        )
