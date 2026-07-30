"""Mean-Variance-Skewness (MVS) position sizing.

Faithful port of the user's own MVS optimizer (adj_result/MVS_bt.py). The
objective, per rebalance, is

    maximize   wᵀμ  −  λ·(wᵀΣw)  +  γ·(w·skew)
    subject to Σw = 1,   0 ≤ wᵢ ≤ max_weight     (long-only, fully invested)

solved with SLSQP. μ and Σ are annualized (×periods-per-year); the skew term is
the *marginal* skewness of each asset (Σ wᵢ·skew(rᵢ)), matching the original —
it tilts toward positively-skewed names rather than using a coskewness tensor.

Adaptation for FX: the strategy chooses direction (long/short) per pair; MVS
chooses the *magnitude*. We optimize on each held pair's return taken in the
direction of its signal, then re-apply the sign. So a short book still gets
MVS-sized weights (long-only weights on direction-adjusted returns).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.optimize import minimize


def mvs_weights(
    returns: pd.DataFrame,
    *,
    ann: float,
    lam: float = 3.0,
    gamma: float = 3.0,
    max_weight: float = 0.20,
) -> np.ndarray:
    """MVS-optimal long-only weights for a window of returns (bars × assets).

    `returns` columns are already taken in the trade direction. Returns a vector
    aligned to `returns.columns`, entries in [0, max_weight], summing to 1.
    """
    cols = list(returns.columns)
    n = len(cols)
    if n == 0:
        return np.zeros(0)
    if n == 1:
        return np.array([1.0])

    # A single name can't exceed the cap yet the book must sum to 1, so relax the
    # cap to at least an even split when the universe is small.
    cap = max(float(max_weight), 1.0 / n)

    clean = returns.dropna()
    if clean.shape[0] < 3:  # not enough history to estimate moments
        return np.full(n, 1.0 / n)

    mean_returns = clean.mean().to_numpy() * ann
    cov_matrix = clean.cov().to_numpy() * ann
    skew_vector = clean.skew().to_numpy()
    skew_vector = np.nan_to_num(skew_vector, nan=0.0)

    def objective(w: np.ndarray) -> float:
        port_return = float(np.dot(w, mean_returns))
        port_variance = float(w @ cov_matrix @ w)
        port_skew = float(np.dot(w, skew_vector))
        score = port_return - lam * port_variance + gamma * port_skew
        return -score

    constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
    bounds = [(0.0, cap) for _ in range(n)]
    x0 = np.full(n, 1.0 / n)

    try:
        result = minimize(
            objective, x0, method="SLSQP", bounds=bounds, constraints=constraints
        )
        w = np.clip(result.x, 0.0, cap)
        s = w.sum()
        if not result.success or s <= 0 or not np.isfinite(s):
            return np.full(n, 1.0 / n)
        return w / s
    except Exception:
        return np.full(n, 1.0 / n)


def mvskew_allocate(
    signal_weights: pd.DataFrame,
    close_panel: pd.DataFrame,
    *,
    ann: float,
    lam: float = 3.0,
    gamma: float = 3.0,
    max_weight: float = 0.20,
    lookback: int = 252,
    rebalance: int = 21,
) -> pd.DataFrame:
    """Re-size the strategy's target weights with MVS on a rebalance cadence.

    MVS fixes each pair's *magnitude* at rebalance (every `rebalance` bars, from a
    trailing `lookback` window); the *direction* always follows the live signal,
    so the strategy's exits and flips are respected every bar. A pair that only
    enters mid-period waits until the next rebalance to get a size. Bars before
    enough history exists fall back to equal weight of the current book.
    """
    idx = signal_weights.index
    cols = signal_weights.columns
    signs = np.sign(signal_weights.to_numpy())
    asset_returns = close_panel.pct_change()

    out = np.zeros((len(idx), len(cols)))
    lookback = max(int(lookback), 3)
    rebalance = max(int(rebalance), 1)

    magnitude = np.zeros(len(cols))  # per-pair size set at each rebalance
    for t in range(len(idx)):
        sign_row = signs[t]
        if t % rebalance == 0:
            held = np.flatnonzero(sign_row != 0)
            magnitude = np.zeros(len(cols))
            if held.size == 0:
                pass
            elif t < lookback:
                # Not enough history: equal-weight the current book.
                magnitude[held] = 1.0 / held.size
            else:
                window = asset_returns.iloc[t - lookback : t, held]
                directional = window.to_numpy() * sign_row[held]  # trade-direction returns
                dframe = pd.DataFrame(directional, columns=cols[held])
                magnitude[held] = mvs_weights(
                    dframe, ann=ann, lam=lam, gamma=gamma, max_weight=max_weight
                )
        # Direction follows the live signal; magnitude is held from the rebalance.
        out[t] = magnitude * sign_row

    return pd.DataFrame(out, index=idx, columns=cols)
