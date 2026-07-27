# System Data Flow

## Workflow 1: Run a backtest

### 1. User edits parameters

The user selects:

- strategy model
- parameter values
- symbols/universe
- timeframe
- date range
- execution assumptions

The frontend stores these in local UI state. Slider changes should not automatically trigger a full backend backtest.

Example frontend request object:

```json
{
  "strategy_model_id": "velacc",
  "parameters": {
    "window": 20,
    "vthr": 2,
    "athr": 0,
    "hold": 5
  },
  "symbols": ["AAPL", "MSFT", "NVDA"],
  "timeframe": "1d",
  "start_ts": "2020-01-01T00:00:00Z",
  "end_ts": "2025-12-31T00:00:00Z",
  "execution": {
    "mode": "long_short",
    "cost_bps": 5,
    "slippage_bps": 0,
    "initial_capital": 100000
  }
}
```

### 2. User clicks `RUN BACKTEST`

Frontend sends:

```http
POST /api/backtests
```

Backend validates the request and creates a row in `backtest_runs`:

```text
status = queued
progress = 0
parameters = request.parameters
universe = symbols
execution_config = execution assumptions
```

Backend dispatches a Celery task:

```python
run_backtest_task.delay(str(run.id))
```

Backend returns immediately:

```json
{
  "run_id": "uuid",
  "task_id": "celery-task-id",
  "status": "queued"
}
```

### 3. Frontend tracks status

Use polling first:

```http
GET /api/backtests/{run_id}
```

Response:

```json
{
  "run_id": "uuid",
  "status": "running",
  "progress": 0.45,
  "stage": "computing signals"
}
```

Later, add WebSocket progress streaming:

```text
WS /ws/backtests/{run_id}
```

### 4. Celery worker executes

Worker stages:

1. Load `backtest_runs` config.
2. Resolve symbols to `instrument_id`s.
3. Ensure candle data exists.
4. Load candles from TimescaleDB.
5. Run strategy.
6. Compute metrics.
7. Extract trades.
8. Save equity curve/trades/metrics.
9. Mark run complete.

Progress stages should be human-readable:

```text
queued
loading candles
ingesting missing data
building price panel
computing signals
simulating portfolio
computing metrics
saving results
completed
```

### 5. Frontend loads results

When status is `completed`, frontend calls:

```http
GET /api/backtests/{run_id}/results
GET /api/backtests/{run_id}/equity
GET /api/backtests/{run_id}/trades
GET /api/backtests/{run_id}/candles?symbol=AAPL
GET /api/backtests/{run_id}/markers?symbol=AAPL
```

Do not force all data into one giant payload.

## Workflow 2: Ingest historical data

### Normal path

Backtest requests candles.

Data manager checks DB coverage:

```text
symbol=AAPL
timeframe=1d
start=2020-01-01
end=2025-12-31
```

If candles exist, load from DB.

If missing, either:

- synchronously fetch if small and acceptable, or
- dispatch ingestion task and return backtest as waiting/running.

### Recommended v1 behavior

For v1, allow the backtest worker to fetch missing data through the data manager, but keep all fetch/store logic in `DataManager`, not in strategy code.

## Workflow 3: Run a parameter sweep

### 1. Frontend submits sweep

```http
POST /api/sweeps
```

Example:

```json
{
  "strategy_model_id": "velacc",
  "base_config": {
    "symbols": ["AAPL", "MSFT", "NVDA"],
    "timeframe": "1d",
    "start_ts": "2020-01-01T00:00:00Z",
    "end_ts": "2025-12-31T00:00:00Z",
    "execution": {
      "mode": "long_short",
      "cost_bps": 5
    }
  },
  "sweep_space": {
    "window": [5, 10, 15, 20, 25, 30],
    "vthr": [0, 1, 2, 3, 4, 5]
  },
  "objective_metric": "sharpe"
}
```

### 2. Backend validates guardrails

Reject or require confirmation if:

- total grid points are too high
- date range is too large
- timeframe is too granular
- universe is too large
- multiple dimensions create runaway combinations

### 3. Worker evaluates points

Each parameter point is evaluated and saved as a row in `parameter_sweep_results`.

### 4. Frontend loads heatmap slice

```http
GET /api/sweeps/{sweep_id}/heatmap?x=window&y=vthr
```

Response:

```json
{
  "x_param": "window",
  "y_param": "vthr",
  "x_values": [5, 10, 15, 20, 25, 30],
  "y_values": [0, 1, 2, 3, 4, 5],
  "metric": "sharpe",
  "z": [
    [0.1, 0.4, 0.6],
    [0.2, 0.8, 0.3]
  ]
}
```

## Workflow 4: Paper trading later

Paper trading should be a separate service or worker loop.

Basic flow:

1. Subscribe to live market data.
2. Aggregate live bars.
3. Save new candle.
4. Load active paper sessions for that symbol/timeframe.
5. Evaluate strategy at bar close.
6. Simulate fills.
7. Update positions.
8. Log paper trades.
9. Push updates to frontend.

Do this only after historical backtesting is stable.
