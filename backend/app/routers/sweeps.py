"""Parameter sweep endpoints."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ParameterSweep, ParameterSweepResult
from app.schemas import (
    HeatmapResponse,
    SweepBestResponse,
    SweepCreateResponse,
    SweepRequest,
    SweepResultItem,
    SweepStatus,
)
from app.services.sweeps import (
    OBJECTIVE_METRICS,
    SweepGuardrailError,
    check_guardrails,
)
from app.services.strategies import STRATEGY_REGISTRY
from app.tasks.sweeps import run_sweep_task

router = APIRouter(prefix="/api/sweeps", tags=["sweeps"])

_RESERVED_QUERY = {"x", "y", "metric"}


def _get_sweep(db: Session, sweep_id: uuid.UUID) -> ParameterSweep:
    sweep = db.get(ParameterSweep, sweep_id)
    if sweep is None:
        raise HTTPException(status_code=404, detail="sweep not found")
    return sweep


@router.post("", response_model=SweepCreateResponse, status_code=201)
def create_sweep(req: SweepRequest, db: Session = Depends(get_db)):
    if req.strategy_model_id not in STRATEGY_REGISTRY:
        raise HTTPException(status_code=422, detail=f"unknown strategy '{req.strategy_model_id}'")
    if req.objective_metric not in OBJECTIVE_METRICS:
        raise HTTPException(
            status_code=422,
            detail=f"objective_metric must be one of {sorted(OBJECTIVE_METRICS)}",
        )
    for key in ("symbols", "timeframe", "start_ts", "end_ts"):
        if key not in req.base_config:
            raise HTTPException(status_code=422, detail=f"base_config missing '{key}'")

    try:
        points = check_guardrails(req.sweep_space, req.base_config)
    except SweepGuardrailError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    sweep = ParameterSweep(
        strategy_model_id=req.strategy_model_id,
        status="queued",
        base_config=req.base_config,
        sweep_space=req.sweep_space,
        objective_metric=req.objective_metric,
        total_points=points,
    )
    db.add(sweep)
    db.commit()
    db.refresh(sweep)

    async_result = run_sweep_task.delay(str(sweep.id))
    task_id = getattr(async_result, "id", None)
    if task_id:
        sweep.celery_task_id = task_id
        db.commit()
    db.refresh(sweep)
    return SweepCreateResponse(
        sweep_id=sweep.id, task_id=task_id, status=sweep.status, total_points=points
    )


@router.get("/{sweep_id}", response_model=SweepStatus)
def get_sweep(sweep_id: uuid.UUID, db: Session = Depends(get_db)):
    sweep = _get_sweep(db, sweep_id)
    return SweepStatus(
        sweep_id=sweep.id,
        status=sweep.status,
        progress=sweep.progress,
        total_points=sweep.total_points,
        objective_metric=sweep.objective_metric,
        best_result_id=sweep.best_result_id,
        error_message=sweep.error_message,
        created_at=sweep.created_at,
        completed_at=sweep.completed_at,
    )


@router.get("/{sweep_id}/best", response_model=SweepBestResponse)
def get_best(
    sweep_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    sweep = _get_sweep(db, sweep_id)
    metric = sweep.objective_metric
    column = _metric_column(metric)
    stmt = (
        select(ParameterSweepResult)
        .where(ParameterSweepResult.sweep_id == sweep.id)
        .order_by(column.desc())
        .limit(limit)
    )
    rows = db.execute(stmt).scalars().all()
    return SweepBestResponse(
        items=[
            SweepResultItem(id=r.id, parameter_point=r.parameter_point, metrics=r.metrics)
            for r in rows
        ]
    )


@router.get("/{sweep_id}/results", response_model=SweepBestResponse)
def get_results(
    sweep_id: uuid.UUID,
    sort: str = Query("-sharpe"),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    sweep = _get_sweep(db, sweep_id)
    desc = sort.startswith("-")
    metric = sort.lstrip("-")
    column = _metric_column(metric)
    order = column.desc() if desc else column.asc()
    rows = db.execute(
        select(ParameterSweepResult)
        .where(ParameterSweepResult.sweep_id == sweep.id)
        .order_by(order)
        .limit(limit)
    ).scalars().all()
    return SweepBestResponse(
        items=[
            SweepResultItem(id=r.id, parameter_point=r.parameter_point, metrics=r.metrics)
            for r in rows
        ]
    )


@router.get("/{sweep_id}/heatmap", response_model=HeatmapResponse)
def get_heatmap(
    sweep_id: uuid.UUID,
    request: Request,
    x: str,
    y: str,
    metric: str = "sharpe",
    db: Session = Depends(get_db),
):
    sweep = _get_sweep(db, sweep_id)
    rows = db.execute(
        select(ParameterSweepResult).where(ParameterSweepResult.sweep_id == sweep.id)
    ).scalars().all()
    if not rows:
        raise HTTPException(status_code=409, detail="sweep has no results yet")

    # Fixed values for any non-axis params come from the query string; default
    # to the value that appears in the best result for that param.
    fixed = {
        k: v for k, v in request.query_params.items() if k not in _RESERVED_QUERY | {"x", "y"}
    }

    def matches_fixed(point: dict) -> bool:
        for k, v in fixed.items():
            if k in (x, y) or k not in point:
                continue
            if str(point[k]) != str(v):
                return False
        return True

    x_values = sorted({_num(r.parameter_point[x]) for r in rows if x in r.parameter_point})
    y_values = sorted({_num(r.parameter_point[y]) for r in rows if y in r.parameter_point})
    x_index = {v: i for i, v in enumerate(x_values)}
    y_index = {v: i for i, v in enumerate(y_values)}

    z: list[list[float | None]] = [[None] * len(x_values) for _ in y_values]
    for r in rows:
        p = r.parameter_point
        if x not in p or y not in p or not matches_fixed(p):
            continue
        xi = x_index.get(_num(p[x]))
        yi = y_index.get(_num(p[y]))
        if xi is None or yi is None:
            continue
        value = r.metrics.get(metric)
        z[yi][xi] = float(value) if value is not None else None

    return HeatmapResponse(
        x_param=x, y_param=y, x_values=x_values, y_values=y_values, metric=metric, z=z
    )


def _metric_column(metric: str):
    columns = {
        "sharpe": ParameterSweepResult.sharpe,
        "sortino": ParameterSweepResult.sortino,
        "total_return": ParameterSweepResult.total_return,
        "max_drawdown": ParameterSweepResult.max_drawdown,
    }
    if metric not in columns:
        raise HTTPException(status_code=422, detail=f"cannot sort by '{metric}'")
    return columns[metric]


def _num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return v
