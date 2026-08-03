"""Mean reversion — fade the prior move, sized by how extreme it was.

Started as the "professional mean reversion" notebook's lag-1 reversal (target =
-sign(prior return)). This version keeps the direction but makes the *size*
scale with the magnitude of the move, standardized by recent volatility:

    mom(t)    = return over the last `lookback` bars
    z(t)      = mom(t) / rolling_std(mom, vol_window)      # how many σ it stretched
    target(t) = -clip( z(t) / z_full, -1, +1 )            # fade it, bigger move = bigger bet

The engine shifts the target one bar (anti-lookahead), so you decide off the
move through yesterday and hold into today.

Why size by z instead of a flat ±1:
  * Mean reversion is stronger after larger deviations, so a 2σ move deserves a
    bigger fade than a 0.3σ wobble.
  * Standardizing by volatility makes a "big move" mean the same thing across a
    calm pair and a wild one.
  * It also cuts churn: small moves get small positions, so turnover (and the
    fees that kill this strategy) drop versus always flipping full-size.

Knobs:
  lookback   bars of prior return to fade (1 = the original notebook).
  vol_window rolling window for the σ used to standardize the move.
  z_full     the z-score at which the position reaches full size (±1). Smaller
             saturates fast (≈ the old binary sign); larger = more graded.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.services.strategies.base import ParameterError, ParamSpec, Strategy


class MeanReversionStrategy(Strategy):
    id = "meanrev"
    name = "Mean Reversion"
    description = (
        "Fade the prior move, sized by how far it stretched: target = -clip(z / z_full), "
        "where z is the last `lookback`-bar return in standard deviations. Bigger, more "
        "unusual moves get bigger bets; small wobbles get small ones."
    )
    kind = "single"
    parameter_specs = [
        ParamSpec("lookback", "fade window (bars)", "int", min=1, max=60, default=1),
        ParamSpec("vol_window", "volatility window (bars)", "int", min=5, max=250, default=20),
        ParamSpec("z_full", "z-score for full size", "float", min=0.25, max=5, default=1.5, step=0.25),
    ]

    def validate_parameters(self, params: dict[str, Any]) -> dict[str, Any]:
        clean = super().validate_parameters(params)
        if clean["z_full"] <= 0:
            raise ParameterError("z_full must be > 0")
        return clean

    def generate_signals(self, data: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        close = data["close"].astype(float)
        lookback = int(params["lookback"])
        vol_window = int(params["vol_window"])
        z_full = float(params["z_full"])

        # Return over the last `lookback` bars, standardized by its recent vol.
        mom = close.pct_change(lookback)
        vol = mom.rolling(vol_window, min_periods=vol_window).std()
        z = mom / vol.replace(0.0, np.nan)

        # Fade it, scaled by z and capped at ±1 (full size at |z| = z_full).
        target = -np.clip((z / z_full).to_numpy(), -1.0, 1.0)
        target[np.isnan(z.to_numpy())] = 0.0

        return pd.DataFrame(
            {
                "target_position": pd.Series(target, index=close.index),
                # Diagnostics for charts / the signals reading.
                "z": z,
                "prior_return_pct": mom * 100.0,
            }
        )
