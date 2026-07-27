# Agent Build Instructions

This document is written for Codex or any coding agent that will implement PARABOLA.

## Mission

Build a professional full-stack quantitative trading backtest and parameter sweep terminal based on the architecture in this docs folder.

The original MVP is a single-file browser prototype, but the production app must be a decoupled full-stack system.

## Mandatory architecture

Use:

```text
Frontend: React + TypeScript + Vite
Backend: Python + FastAPI
Database: PostgreSQL + TimescaleDB
Task queue: Celery + Redis
Charts: Lightweight Charts for financial series; Canvas for larger heatmaps
```

## Do not violate these rules

1. Do not run heavy backtests in the browser.
2. Do not run parameter sweeps in the browser.
3. Do not use Redis as long-term result storage.
4. Do not fetch real market data directly from the frontend.
5. Do not return huge result payloads in one response.
6. Do not put huge arrays in React state.
7. Do not implement paper trading before historical backtesting works.
8. Do not allow unclear execution timing.
9. Do not introduce lookahead bias.
10. Do not abandon the clean terminal-like UI style from the prototype.

## First deliverable

Create a working local dev skeleton:

```text
repo-root/
  frontend/
  backend/
  docs/
  docker-compose.yml
  README.md
  .env.example
```

The first deliverable should satisfy:

- `docker compose up` starts Postgres/TimescaleDB, Redis, FastAPI, Celery worker, and frontend.
- FastAPI has `/health`.
- Frontend loads and can call backend healthcheck.
- There is a fake backtest task that reports progress.

## Backend expectations

Use modular files:

```text
backend/app/
  main.py
  db.py
  models.py
  schemas.py
  celery_app.py
  tasks/
    backtests.py
    sweeps.py
    ingestion.py
  services/
    data_manager.py
    providers/
      yfinance_provider.py
    strategies/
      base.py
      sma.py
      roc.py
      velacc.py
    backtest_engine.py
    metrics.py
    persistence.py
```

## Frontend expectations

Use modular files:

```text
frontend/src/
  api/
  components/
  features/
  state/
  workers/
  types/
```

## Strategy implementation order

Implement in this order:

1. SMA crossover.
2. ROC momentum.
3. Velocity/acceleration portfolio strategy.

## Data implementation order

Implement in this order:

1. Instruments table.
2. Historical candles table.
3. yfinance daily ingestion.
4. DB coverage check.
5. Backtest loads candles from DB.

Do not start with Binance WebSocket or 1-minute streaming.

## Backtest implementation requirements

Each backtest run must save:

- strategy model ID
- strategy version
- parameters
- execution config
- universe
- timeframe
- start/end timestamps
- status/progress
- final metrics
- equity curve
- trade logs

## API endpoints to implement first

```http
GET /health
GET /api/strategies
POST /api/backtests
GET /api/backtests/{run_id}
GET /api/backtests/{run_id}/metrics
GET /api/backtests/{run_id}/equity
GET /api/backtests/{run_id}/trades
```

Then:

```http
POST /api/data/ingest
GET /api/data/coverage
POST /api/sweeps
GET /api/sweeps/{sweep_id}
GET /api/sweeps/{sweep_id}/best
GET /api/sweeps/{sweep_id}/heatmap
```

## Frontend UI expectations

The UI should include:

- Left parameter rail.
- Strategy selector.
- Symbol selector/input.
- Timeframe/date range controls.
- Execution setting controls.
- Run button.
- Status/progress display.
- Metric cards.
- Price chart.
- Equity chart.
- Trade table.
- Heatmap panel.

## Performance expectations

- Chart hover should stay smooth.
- Crosshair updates should not trigger full React rerenders.
- Heatmap should use Canvas for non-small grids.
- Long trade logs should be paginated or virtualized.
- Large series should be transformed in workers or refs, not giant React state.

## Testing expectations

Add at least:

- Unit tests for metrics.
- Unit tests for strategy signal generation.
- Unit tests for anti-lookahead execution shifting.
- API test for creating a backtest.
- Worker test or integration-style test for completing a fake/real backtest.

## README expectations

Root README should include:

- What PARABOLA is.
- How to start local dev.
- Required env vars.
- Current implemented features.
- Roadmap.

## Build philosophy

Prefer small working increments.

Do not attempt to build the entire final system in one pass. Start with skeleton + fake task, then replace fake pieces with real ingestion/backtesting progressively.
