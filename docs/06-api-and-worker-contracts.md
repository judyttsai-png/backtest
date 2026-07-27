# API and Worker Contracts

## FastAPI principles

- API endpoints should validate requests with Pydantic.
- API endpoints should create task records and return quickly.
- Long-running work must be dispatched to Celery.
- Endpoints should be split by resource: backtests, sweeps, instruments, data.
- Do not return huge payloads in a single response.

## Backtest request

```python
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field

class ExecutionConfig(BaseModel):
    mode: Literal["long_flat", "long_short"] = "long_flat"
    cost_bps: float = 5.0
    slippage_bps: float = 0.0
    initial_capital: float = 100_000.0

class BacktestRequest(BaseModel):
    strategy_model_id: str
    parameters: dict[str, Any]
    symbols: list[str] = Field(min_length=1)
    timeframe: Literal["1m", "5m", "15m", "30m", "1h", "1d"]
    start_ts: datetime
    end_ts: datetime
    benchmark_symbol: str | None = None
    execution: ExecutionConfig = ExecutionConfig()
```

## Create backtest endpoint

```http
POST /api/backtests
```

Response:

```json
{
  "run_id": "uuid",
  "task_id": "celery-task-id",
  "status": "queued"
}
```

## Backtest status endpoint

```http
GET /api/backtests/{run_id}
```

Response:

```json
{
  "run_id": "uuid",
  "status": "running",
  "progress": 0.45,
  "stage": "computing signals",
  "error_message": null,
  "created_at": "...",
  "started_at": "...",
  "completed_at": null
}
```

## Backtest result endpoints

```http
GET /api/backtests/{run_id}/metrics
GET /api/backtests/{run_id}/equity
GET /api/backtests/{run_id}/trades?limit=100&offset=0
GET /api/backtests/{run_id}/candles?symbol=AAPL
GET /api/backtests/{run_id}/markers?symbol=AAPL
```

## Celery app

```python
from celery import Celery

celery_app = Celery(
    "parabola",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
)

celery_app.conf.update(
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
)
```

## Backtest task skeleton

```python
from datetime import datetime, timezone
from app.celery_app import celery_app
from app.db import SessionLocal
from app.models import BacktestRun
from app.services.data_loader import load_candles_for_run
from app.services.backtest_engine import run_strategy_backtest
from app.services.persistence import save_backtest_outputs


def update_run_progress(db, run, progress: float, stage: str):
    run.progress = progress
    run.progress_stage = stage
    db.commit()


@celery_app.task(bind=True)
def run_backtest_task(self, run_id: str):
    db = SessionLocal()

    try:
        run = db.get(BacktestRun, run_id)
        if run is None:
            raise RuntimeError(f"BacktestRun not found: {run_id}")

        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        update_run_progress(db, run, 0.05, "loading candles")

        candles = load_candles_for_run(db, run)

        update_run_progress(db, run, 0.25, "computing signals")

        result = run_strategy_backtest(
            strategy_model_id=run.strategy_model_id,
            parameters=run.parameters,
            candles=candles,
            execution_config=run.execution_config,
        )

        update_run_progress(db, run, 0.80, "saving results")

        save_backtest_outputs(db, run, result)

        run.status = "completed"
        run.progress = 1.0
        run.progress_stage = "completed"
        run.completed_at = datetime.now(timezone.utc)

        run.total_return = result.metrics.total_return
        run.cagr = result.metrics.cagr
        run.annual_volatility = result.metrics.annual_volatility
        run.sharpe = result.metrics.sharpe
        run.sortino = result.metrics.sortino
        run.max_drawdown = result.metrics.max_drawdown
        run.beta = result.metrics.beta
        run.alpha = result.metrics.alpha
        run.win_rate = result.metrics.win_rate
        run.exposure = result.metrics.exposure
        run.turnover = result.metrics.turnover
        run.trade_count = len(result.trades)
        run.final_equity = result.metrics.final_equity

        db.commit()
        return {"run_id": run_id, "status": "completed"}

    except Exception as exc:
        db.rollback()
        run = db.get(BacktestRun, run_id)
        if run is not None:
            run.status = "failed"
            run.error_message = str(exc)
            run.completed_at = datetime.now(timezone.utc)
            db.commit()
        raise

    finally:
        db.close()
```

## Sweep API

```http
POST /api/sweeps
GET /api/sweeps/{sweep_id}
GET /api/sweeps/{sweep_id}/best?limit=50
GET /api/sweeps/{sweep_id}/heatmap?x=window&y=vthr
GET /api/sweeps/{sweep_id}/results?sort=-sharpe&limit=100
```

## Data API

```http
GET /api/instruments?search=AAPL
POST /api/instruments
POST /api/data/ingest
GET /api/data/coverage?symbol=AAPL&timeframe=1d
```

## Strategy metadata API

```http
GET /api/strategies
GET /api/strategies/{strategy_model_id}
```

Example response:

```json
{
  "id": "velacc",
  "name": "Velocity / Acceleration",
  "description": "Ranks instruments by rolling log-price velocity and acceleration.",
  "parameters": [
    {"id": "window", "label": "fit window", "type": "int", "min": 5, "max": 60, "default": 20},
    {"id": "vthr", "label": "velocity threshold", "type": "float", "min": 0, "max": 40, "default": 2},
    {"id": "athr", "label": "acceleration threshold", "type": "float", "min": 0, "max": 20, "default": 0},
    {"id": "hold", "label": "positions per side", "type": "int", "min": 1, "max": 7, "default": 5}
  ]
}
```

## Error handling rules

- Invalid parameter: return 422.
- Unknown strategy: return 404 or 422.
- Backtest not complete: return 409 from result endpoints.
- Missing data that cannot be fetched: task should fail with clear `error_message`.
- Worker exception: mark task `failed`, save error message, re-raise for logs.

## Cancellation later

Add later:

```http
POST /api/backtests/{run_id}/cancel
POST /api/sweeps/{sweep_id}/cancel
```

Cancellation requires Celery revoke support and cooperative cancellation checks inside long loops.
