"""Backend strategy registry mapping model IDs to implementations."""
from __future__ import annotations

from app.services.strategies.base import Strategy
from app.services.strategies.dmi import DmiTrendStrategy
from app.services.strategies.meanrev import MeanReversionStrategy
from app.services.strategies.sma import SmaCrossoverStrategy
from app.services.strategies.smacross import SmaCrossTrendStrategy
from app.services.strategies.velcross import VelocityCrossoverStrategy

# Deliberately kept small and *distinct*: SMA divergence (contrarian crossover),
# SMA crossover (classic trend follower), ADX/DMI (trend strength), velocity
# crossover (cross-sectional momentum), and mean reversion (short-horizon return
# fade). The old ROC and velocity-acceleration models were dropped for being too
# correlated with velcross.
STRATEGY_REGISTRY: dict[str, Strategy] = {
    "sma": SmaCrossoverStrategy(),
    "smacross": SmaCrossTrendStrategy(),
    "dmi": DmiTrendStrategy(),
    "velcross": VelocityCrossoverStrategy(),
    "meanrev": MeanReversionStrategy(),
}


def get_strategy(strategy_id: str) -> Strategy:
    try:
        return STRATEGY_REGISTRY[strategy_id]
    except KeyError as exc:
        raise KeyError(f"unknown strategy '{strategy_id}'") from exc


def list_strategies() -> list[Strategy]:
    return list(STRATEGY_REGISTRY.values())
