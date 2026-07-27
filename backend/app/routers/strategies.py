"""Strategy metadata endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import StrategyMeta
from app.services.strategies import STRATEGY_REGISTRY, list_strategies

router = APIRouter(prefix="/api/strategies", tags=["strategies"])


def _to_meta(strat) -> StrategyMeta:
    return StrategyMeta(
        id=strat.id,
        name=strat.name,
        description=strat.description,
        version=strat.version,
        kind=strat.kind,
        parameters=strat.parameter_schema(),
    )


@router.get("", response_model=list[StrategyMeta])
def get_strategies() -> list[StrategyMeta]:
    return [_to_meta(s) for s in list_strategies()]


@router.get("/{strategy_model_id}", response_model=StrategyMeta)
def get_strategy_meta(strategy_model_id: str) -> StrategyMeta:
    strat = STRATEGY_REGISTRY.get(strategy_model_id)
    if strat is None:
        raise HTTPException(status_code=404, detail=f"unknown strategy '{strategy_model_id}'")
    return _to_meta(strat)
