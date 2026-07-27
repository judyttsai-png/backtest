"""Parameter sweep helpers: grid expansion, sizing, and guardrails."""
from __future__ import annotations

from itertools import product
from math import prod
from typing import Any, Iterator

# v1 hard limits (docs/09-parameter-sweeps.md).
MAX_SWEEP_POINTS_DAILY = 10_000
MAX_SWEEP_POINTS_INTRADAY = 1_000
MAX_SYMBOLS_PORTFOLIO = 50

OBJECTIVE_METRICS = {"sharpe", "sortino", "total_return", "cagr", "max_drawdown"}


def total_points(sweep_space: dict[str, list]) -> int:
    if not sweep_space:
        return 0
    return prod(len(v) for v in sweep_space.values())


def expand_grid(sweep_space: dict[str, list]) -> Iterator[dict[str, Any]]:
    keys = list(sweep_space.keys())
    for values in product(*(sweep_space[k] for k in keys)):
        yield dict(zip(keys, values))


class SweepGuardrailError(ValueError):
    """Raised when a sweep exceeds v1 safety limits (mapped to HTTP 422)."""


def check_guardrails(sweep_space: dict[str, list], base_config: dict[str, Any]) -> int:
    points = total_points(sweep_space)
    if points == 0:
        raise SweepGuardrailError("sweep_space is empty")

    timeframe = base_config.get("timeframe", "1d")
    intraday = timeframe != "1d"
    limit = MAX_SWEEP_POINTS_INTRADAY if intraday else MAX_SWEEP_POINTS_DAILY
    if points > limit:
        raise SweepGuardrailError(
            f"sweep has {points} points, exceeding the {limit} limit for {timeframe} data"
        )

    symbols = base_config.get("symbols", [])
    if len(symbols) > MAX_SYMBOLS_PORTFOLIO:
        raise SweepGuardrailError(
            f"{len(symbols)} symbols exceeds the {MAX_SYMBOLS_PORTFOLIO} portfolio limit"
        )
    return points
