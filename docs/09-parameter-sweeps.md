# Parameter Sweep Architecture

## Goal

Move parameter optimization from browser-side nested loops into backend-managed asynchronous jobs.

The prototype computes a 2D Sharpe surface in JavaScript. The production system should support:

- 2D heatmaps.
- N-dimensional sweep grids.
- Best-result tables.
- Sliced views through higher-dimensional spaces.
- Guardrails against accidental combinatorial explosions.

## Data model

Use:

- `parameter_sweeps`
- `parameter_sweep_results`

A sweep defines the base backtest config and sweep search space.

Each result row defines one parameter point and its metrics.

## Sweep request

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
    "vthr": [0, 1, 2, 3, 4, 5],
    "athr": [0, 1, 2],
    "hold": [3, 5, 7]
  },
  "objective_metric": "sharpe"
}
```

## Grid expansion

```python
from itertools import product


def expand_grid(sweep_space: dict[str, list]):
    keys = list(sweep_space.keys())
    for values in product(*(sweep_space[k] for k in keys)):
        yield dict(zip(keys, values))
```

## Guardrails

Before creating a sweep, calculate:

```python
total_points = product(len(values) for values in sweep_space.values())
```

Reject or require explicit confirmation if:

- `total_points > 10_000` for daily data v1.
- `total_points > 1_000` for intraday data v1.
- symbols count is too high.
- date range is too high.
- timeframe is too granular.

Recommended v1 hard limits:

```text
max_sweep_points_daily = 10,000
max_sweep_points_intraday = 1,000
max_symbols_portfolio = 50
max_daily_years = 20
max_intraday_days = 60
```

## Worker design

Simple v1 approach:

- One Celery parent task loads candles once.
- It loops through parameter points sequentially or in chunks.
- Saves result rows as it goes.
- Updates progress.

Parallel v2 approach:

- Parent task creates chunks.
- Celery group evaluates chunks concurrently.
- Chord callback aggregates best result.

Avoid spawning multiprocessing inside each Celery worker unless worker concurrency is carefully controlled.

## Result endpoints

### Status

```http
GET /api/sweeps/{sweep_id}
```

### Best results

```http
GET /api/sweeps/{sweep_id}/best?limit=50
```

Response:

```json
{
  "items": [
    {
      "parameter_point": {"window": 20, "vthr": 2},
      "metrics": {"sharpe": 1.42, "total_return": 0.35}
    }
  ]
}
```

### Heatmap slice

```http
GET /api/sweeps/{sweep_id}/heatmap?x=window&y=vthr&athr=0&hold=5&metric=sharpe
```

Response:

```json
{
  "x_param": "window",
  "y_param": "vthr",
  "x_values": [5, 10, 15, 20],
  "y_values": [0, 1, 2, 3],
  "metric": "sharpe",
  "z": [
    [0.2, 0.3, 0.1, -0.2],
    [0.4, 0.8, 0.7, 0.1]
  ]
}
```

## Frontend visualization

Use Canvas heatmap for production.

Do not render heatmap cells as individual React components for large grids.

Hover logic:

```ts
const col = Math.floor(mouseX / cellWidth);
const row = Math.floor(mouseY / cellHeight);
const value = z[row][col];
```

Click behavior:

- Apply selected parameter values to current parameter form.
- Do not automatically rerun unless user chooses that behavior.

## Objective metrics

Support initially:

- Sharpe
- Sortino
- total return
- CAGR
- max drawdown
- Calmar later

## Research caveat

Parameter sweeps are in-sample optimization. The UI should eventually warn the user that choosing the best parameter from the same period and reporting that performance is overfit.

Later add:

- train/test split
- walk-forward optimization
- out-of-sample score
- robustness zone detection
