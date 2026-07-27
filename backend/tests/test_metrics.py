"""Unit tests for the metrics module."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from app.services.metrics import compute_metrics, drawdown_series


def _equity_from_returns(returns: pd.Series, capital: float = 100_000.0) -> pd.Series:
    return (1.0 + returns).cumprod() * capital


def test_constant_positive_returns():
    idx = pd.bdate_range("2022-01-03", periods=252, tz="UTC")
    returns = pd.Series(0.001, index=idx)
    equity = _equity_from_returns(returns)

    m = compute_metrics(returns, equity, "1d")

    # equity[0] already includes the first +0.1%, so total_return spans 251 steps.
    assert m.total_return == pytest_approx((1.001 ** 251) - 1.0, rel=1e-6)
    assert m.max_drawdown == 0.0  # monotonically increasing
    assert m.sharpe > 0
    assert m.annual_volatility == pytest_approx(0.0, abs=1e-12)  # zero variance
    assert m.final_equity > 100_000.0


def test_drawdown_is_negative_after_decline():
    idx = pd.bdate_range("2022-01-03", periods=6, tz="UTC")
    equity = pd.Series([100, 110, 120, 90, 95, 130], index=idx, dtype=float)
    dd = drawdown_series(equity)
    # Peak 120 then 90 -> -25%.
    assert dd.min() == pytest_approx(90 / 120 - 1.0)


def test_sharpe_annualization_factor():
    idx = pd.bdate_range("2022-01-03", periods=100, tz="UTC")
    rng = np.random.default_rng(0)
    returns = pd.Series(rng.normal(0.0005, 0.01, size=100), index=idx)
    equity = _equity_from_returns(returns)
    m = compute_metrics(returns, equity, "1d")
    expected = returns.mean() / returns.std(ddof=0) * math.sqrt(252)
    assert m.sharpe == pytest_approx(expected)


def test_beta_alpha_with_benchmark():
    idx = pd.bdate_range("2022-01-03", periods=200, tz="UTC")
    rng = np.random.default_rng(1)
    bench = pd.Series(rng.normal(0.0003, 0.008, size=200), index=idx)
    strat = 1.5 * bench  # beta should be ~1.5
    equity = _equity_from_returns(strat)
    m = compute_metrics(strat, equity, "1d", benchmark_returns=bench)
    assert m.beta == pytest_approx(1.5, rel=1e-6)


def pytest_approx(value, rel=1e-9, abs=1e-9):
    import pytest

    return pytest.approx(value, rel=rel, abs=abs)
