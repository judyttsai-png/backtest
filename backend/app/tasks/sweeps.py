"""Parameter sweep Celery task.

v1 design: one parent task loads candles once, then evaluates each parameter
point sequentially, persisting result rows and updating progress as it goes.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.celery_app import celery_app
from app.db import SessionLocal
from app.models import ParameterSweep, ParameterSweepResult
from app.services.backtest_engine import run_strategy_backtest
from app.services.data_loader import build_bundle
from app.services.sweeps import expand_grid, total_points

logger = logging.getLogger(__name__)

# objective -> whether higher is better (all current metrics: higher = better,
# max_drawdown is negative so a larger/less-negative value is better too).
_HIGHER_IS_BETTER = True


@celery_app.task(bind=True)
def run_sweep_task(self, sweep_id: str):
    db = SessionLocal()
    try:
        sweep = db.get(ParameterSweep, _as_uuid(sweep_id))
        if sweep is None:
            raise RuntimeError(f"ParameterSweep not found: {sweep_id}")

        sweep.status = "running"
        sweep.started_at = datetime.now(timezone.utc)
        sweep.celery_task_id = self.request.id
        db.commit()

        base = sweep.base_config
        start = datetime.fromisoformat(base["start_ts"])
        end = datetime.fromisoformat(base["end_ts"])
        bundle = build_bundle(
            db,
            base["symbols"],
            base["timeframe"],
            start,
            end,
            benchmark_symbol=base.get("benchmark_symbol"),
            provider=base.get("provider"),
        )
        execution = base.get("execution", {})

        points = list(expand_grid(sweep.sweep_space))
        sweep.total_points = total_points(sweep.sweep_space)
        db.commit()

        objective = sweep.objective_metric
        best_score = None
        best_result_id = None

        for i, point in enumerate(points):
            try:
                result = run_strategy_backtest(
                    strategy_model_id=sweep.strategy_model_id,
                    parameters={**base.get("parameters", {}), **point},
                    candles=bundle,
                    execution_config=execution,
                )
                metrics = result.metrics.to_dict()
            except Exception as exc:  # noqa: BLE001 - one bad point shouldn't kill the sweep
                logger.warning("sweep point %s failed: %s", point, exc)
                continue

            row = ParameterSweepResult(
                sweep_id=sweep.id,
                parameter_point=point,
                metrics=metrics,
                total_return=metrics["total_return"],
                sharpe=metrics["sharpe"],
                sortino=metrics["sortino"],
                max_drawdown=metrics["max_drawdown"],
            )
            db.add(row)
            db.flush()

            score = metrics.get(objective, metrics["sharpe"])
            if best_score is None or score > best_score:
                best_score = score
                best_result_id = row.id

            if i % 10 == 0 or i == len(points) - 1:
                sweep.progress = (i + 1) / len(points)
                db.commit()

        sweep.best_result_id = best_result_id
        sweep.status = "completed"
        sweep.progress = 1.0
        sweep.completed_at = datetime.now(timezone.utc)
        db.commit()
        return {"sweep_id": str(sweep_id), "status": "completed", "points": len(points)}

    except Exception as exc:  # noqa: BLE001
        logger.exception("sweep %s failed", sweep_id)
        db.rollback()
        sweep = db.get(ParameterSweep, _as_uuid(sweep_id))
        if sweep is not None:
            sweep.status = "failed"
            sweep.error_message = str(exc)
            sweep.completed_at = datetime.now(timezone.utc)
            db.commit()
        raise
    finally:
        db.close()


def _as_uuid(sweep_id):
    import uuid

    return sweep_id if isinstance(sweep_id, uuid.UUID) else uuid.UUID(str(sweep_id))
