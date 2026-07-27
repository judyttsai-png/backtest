"""Verify the anti-lookahead execution shift.

A signal computed from bar t's close must not earn bar t's return; the position
is applied starting bar t+1.
"""
from __future__ import annotations

import pandas as pd

from app.services.backtest_engine import ExecutionConfig, _run_single
from tests.conftest import make_single_bundle


class _JumpStrategy:
    """Goes long exactly at the bar where the price jumps."""

    kind = "single"

    def __init__(self, jump_index: int):
        self.jump_index = jump_index

    def generate_signals(self, data: pd.DataFrame, params: dict) -> pd.DataFrame:
        target = pd.Series(0, index=data.index, dtype=int)
        target.iloc[self.jump_index :] = 1
        return pd.DataFrame({"target_position": target})


def test_signal_does_not_earn_same_bar_return():
    # Flat, then a +100% jump at index 5, then flat.
    prices = [100.0] * 5 + [200.0] + [200.0] * 5
    bundle = make_single_bundle(prices)
    exec_cfg = ExecutionConfig(mode="long_flat", cost_bps=0.0, slippage_bps=0.0)

    result = _run_single(_JumpStrategy(jump_index=5), {}, bundle, exec_cfg)
    equity = [p.equity for p in result.equity_points]

    # The strategy "decides" long at bar 5 (using bar 5's close). With the shift,
    # the position on bar 5 is still 0, so the jump return is NOT captured.
    assert equity[5] == equity[4]
    # Position is live from bar 6 onward, but price is flat afterwards.
    assert equity[-1] == equity[5]


def test_without_shift_would_have_captured_jump():
    # Sanity check on the fixture: the raw jump return is indeed +100%.
    prices = [100.0] * 5 + [200.0] + [200.0] * 5
    close = pd.Series(prices)
    assert close.pct_change().iloc[5] == 1.0
