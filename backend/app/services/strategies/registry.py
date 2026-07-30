"""Backend strategy registry mapping model IDs to implementations."""
from __future__ import annotations

from app.services.strategies.base import Strategy
from app.services.strategies.dmi import DmiTrendStrategy
from app.services.strategies.sma import SmaCrossoverStrategy
from app.services.strategies.velcross import VelocityCrossoverStrategy

# Deliberately kept small and *distinct*: SMA divergence (mean-reversion-ish
# crossover), ADX/DMI (trend strength), and velocity crossover (momentum). The
# old ROC and velocity-acceleration models were dropped for being too correlated
# with velocity crossover — see registry history.
STRATEGY_REGISTRY: dict[str, Strategy] = {
    "sma": SmaCrossoverStrategy(),
    "dmi": DmiTrendStrategy(),
    "velcross": VelocityCrossoverStrategy(),
}


def get_strategy(strategy_id: str) -> Strategy:
    try:
        return STRATEGY_REGISTRY[strategy_id]
    except KeyError as exc:
        raise KeyError(f"unknown strategy '{strategy_id}'") from exc


def list_strategies() -> list[Strategy]:
    return list(STRATEGY_REGISTRY.values())
