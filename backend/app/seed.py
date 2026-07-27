"""Seed the strategy_models table from the backend strategy registry."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import StrategyModel
from app.services.strategies import list_strategies


def seed_strategy_models(db: Session) -> None:
    for strat in list_strategies():
        existing = db.get(StrategyModel, strat.id)
        schema = {"parameters": strat.parameter_schema()}
        if existing is None:
            db.add(
                StrategyModel(
                    id=strat.id,
                    name=strat.name,
                    description=strat.description,
                    parameter_schema=schema,
                    version=strat.version,
                )
            )
        else:
            existing.name = strat.name
            existing.description = strat.description
            existing.parameter_schema = schema
            existing.version = strat.version
    db.commit()
