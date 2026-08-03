"""Walk-forward (rolling out-of-sample stability) endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import BacktestRequest
from app.services.data_loader import build_bundle
from app.services.strategies import STRATEGY_REGISTRY
from app.services.strategies.base import ParameterError
from app.services.walkforward import run_walkforward

router = APIRouter(prefix="/api/walkforward", tags=["walkforward"])


class WalkForwardRequest(BacktestRequest):
    folds: int = 5


@router.post("")
def create_walkforward(req: WalkForwardRequest, db: Session = Depends(get_db)):
    strat = STRATEGY_REGISTRY.get(req.strategy_model_id)
    if strat is None:
        raise HTTPException(status_code=422, detail=f"unknown strategy '{req.strategy_model_id}'")
    try:
        clean_params = strat.validate_parameters(req.parameters)
    except ParameterError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if req.end_ts <= req.start_ts:
        raise HTTPException(status_code=422, detail="end_ts must be after start_ts")

    try:
        bundle = build_bundle(
            db,
            [s.upper() for s in req.symbols],
            req.timeframe,
            req.start_ts,
            req.end_ts,
            benchmark_symbol=req.benchmark_symbol,
            provider=req.provider,
            skip_missing=True,
        )
        result = run_walkforward(
            strat.id, clean_params, bundle, req.execution.model_dump(), folds=req.folds
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "strategy_model_id": strat.id,
        "symbols": list(bundle.symbols),
        "timeframe": req.timeframe,
        **result,
    }
