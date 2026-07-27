"""Backtest Celery task — the async job lifecycle from docs/06."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.celery_app import celery_app
from app.db import SessionLocal
from app.models import BacktestRun
from app.services.backtest_engine import run_strategy_backtest
from app.services.data_loader import load_candles_for_run
from app.services.persistence import save_backtest_outputs

logger = logging.getLogger(__name__)


def _update_progress(db, run: BacktestRun, progress: float, stage: str) -> None:
    run.progress = progress
    run.progress_stage = stage
    db.commit()


@celery_app.task(bind=True)
def run_backtest_task(self, run_id: str):
    db = SessionLocal()
    try:
        run = db.get(BacktestRun, _as_uuid(run_id))
        if run is None:
            raise RuntimeError(f"BacktestRun not found: {run_id}")

        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        run.celery_task_id = self.request.id
        _update_progress(db, run, 0.05, "loading candles")

        bundle = load_candles_for_run(db, run)

        _update_progress(db, run, 0.25, "computing signals")

        result = run_strategy_backtest(
            strategy_model_id=run.strategy_model_id,
            parameters=run.parameters,
            candles=bundle,
            execution_config=run.execution_config,
        )

        _update_progress(db, run, 0.80, "saving results")
        save_backtest_outputs(db, run, result, bundle.instrument_ids)

        m = result.metrics
        run.status = "completed"
        run.progress = 1.0
        run.progress_stage = "completed"
        run.completed_at = datetime.now(timezone.utc)
        run.total_return = m.total_return
        run.cagr = m.cagr
        run.annual_volatility = m.annual_volatility
        run.sharpe = m.sharpe
        run.sortino = m.sortino
        run.max_drawdown = m.max_drawdown
        run.beta = m.beta
        run.alpha = m.alpha
        run.win_rate = m.win_rate
        run.exposure = m.exposure
        run.turnover = m.turnover
        run.trade_count = len(result.trades)
        run.final_equity = m.final_equity
        db.commit()
        return {"run_id": str(run_id), "status": "completed"}

    except Exception as exc:  # noqa: BLE001 - persisted then re-raised for logs
        logger.exception("backtest %s failed", run_id)
        db.rollback()
        run = db.get(BacktestRun, _as_uuid(run_id))
        if run is not None:
            run.status = "failed"
            run.error_message = str(exc)
            run.completed_at = datetime.now(timezone.utc)
            db.commit()
        raise
    finally:
        db.close()


def _as_uuid(run_id):
    import uuid

    return run_id if isinstance(run_id, uuid.UUID) else uuid.UUID(str(run_id))
