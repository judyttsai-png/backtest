"""Unit tests for strategy signal generation and validation."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.services.strategies import get_strategy
from app.services.strategies.base import ParameterError
from app.services.strategies.velacc import rolling_vel_acc


def _frame(prices: list[float]) -> pd.DataFrame:
    idx = pd.bdate_range("2022-01-03", periods=len(prices), tz="UTC")
    return pd.DataFrame({"close": prices}, index=idx)


def test_sma_validation_rejects_slow_le_fast():
    sma = get_strategy("sma")
    with pytest.raises(ParameterError):
        sma.validate_parameters({"fast": 20, "slow": 10})
    with pytest.raises(ParameterError):
        sma.validate_parameters({"fast": 1, "slow": 40})  # fast < 2


def test_sma_goes_long_on_uptrend():
    sma = get_strategy("sma")
    prices = list(np.linspace(100, 200, 80))  # steady uptrend
    signals = sma.generate_signals(_frame(prices), {"fast": 5, "slow": 20})
    # Once both SMAs exist and fast>slow, target is +1.
    assert signals["target_position"].iloc[-1] == 1
    # Warmup region is 0 (undefined).
    assert signals["target_position"].iloc[0] == 0


def test_roc_direction():
    roc = get_strategy("roc")
    up = list(np.linspace(100, 160, 60))
    down = list(np.linspace(160, 100, 60))
    su = roc.generate_signals(_frame(up), {"look": 10, "thr": 1.0})
    sd = roc.generate_signals(_frame(down), {"look": 10, "thr": 1.0})
    assert su["target_position"].iloc[-1] == 1
    assert sd["target_position"].iloc[-1] == -1


def test_rolling_vel_acc_on_linear_logprice():
    # Constant log-return ramp: velocity constant positive, acceleration ~0.
    slope = 0.01
    logp = np.arange(50) * slope
    vel, acc = rolling_vel_acc(logp, window=21)
    assert np.isnan(vel[:20]).all()  # warmup
    assert vel[-1] == pytest.approx(slope, abs=1e-6)
    assert acc[-1] == pytest.approx(0.0, abs=1e-6)


def test_velacc_produces_long_short_weights():
    velacc = get_strategy("velacc")
    idx = pd.bdate_range("2022-01-03", periods=120, tz="UTC")
    t = np.arange(120)
    # Winners accelerate up (vel>0, acc>0); losers accelerate down — so both the
    # velocity and acceleration thresholds (>= 0 / <= 0) are satisfied.
    panel = pd.DataFrame(
        {
            "WIN1": 100 * np.exp(0.002 * t + 0.00003 * t**2),
            "WIN2": 80 * np.exp(0.0015 * t + 0.00002 * t**2),
            "LOSE1": 300 * np.exp(-0.002 * t - 0.00003 * t**2),
            "LOSE2": 250 * np.exp(-0.0015 * t - 0.00002 * t**2),
        },
        index=idx,
    )
    weights = velacc.generate_signals(panel, {"window": 20, "vthr": 0, "athr": 0, "hold": 1})
    last = weights.iloc[-1]
    # Ranked by log-price velocity: a rising name is held long, a falling one short.
    assert last[["WIN1", "WIN2"]].max() > 0  # a winner is long
    assert last[["LOSE1", "LOSE2"]].min() < 0  # a loser is short
    assert last[["WIN1", "WIN2"]].min() >= 0  # no winner is shorted
    assert last[["LOSE1", "LOSE2"]].max() <= 0  # no loser is held long
