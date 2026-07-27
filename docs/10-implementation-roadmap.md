# Implementation Roadmap

## Phase 0: Repo setup

### Goal

Create a clean monorepo skeleton.

### Tasks

- Create `frontend/` Vite React TypeScript app.
- Create `backend/` FastAPI app.
- Add Docker Compose for Postgres/TimescaleDB, Redis, backend, worker, frontend.
- Add `.env.example`.
- Add root README.
- Add docs folder.

### Acceptance criteria

- `docker compose up` starts frontend, backend, Redis, and Postgres.
- FastAPI healthcheck works.
- Frontend loads.

## Phase 1: Frontend shell

### Goal

Port the prototype UX into React without backend compute yet.

### Tasks

- Build main layout.
- Build model selector.
- Build parameter sidebar.
- Build metric cards.
- Add result panel layout.
- Add placeholder charts.
- Add placeholder trade table.

### Acceptance criteria

- UI visually resembles the prototype.
- Parameter edits are responsive.
- No browser locking.

## Phase 2: Backend skeleton and task orchestration

### Goal

Create real async backtest job lifecycle.

### Tasks

- Add SQLAlchemy models.
- Add Alembic migrations.
- Add `strategy_models` seed data.
- Add `POST /api/backtests`.
- Add `GET /api/backtests/{id}`.
- Add Celery worker.
- Add fake long-running task with progress updates.

### Acceptance criteria

- Frontend can start fake backtest.
- Progress updates display.
- Completed task can be queried.

## Phase 3: Data ingestion

### Goal

Store real daily OHLCV candles.

### Tasks

- Add `instruments` and `historical_candles` tables.
- Add yfinance provider.
- Add symbol normalization.
- Add candle upsert.
- Add data coverage check.
- Add ingest endpoint or task.

### Acceptance criteria

- App can ingest daily candles for `AAPL`.
- Candles persist in TimescaleDB.
- Re-running does not duplicate rows.

## Phase 4: Python strategy engine

### Goal

Implement real backtests in Python.

### Tasks

- Add SMA crossover strategy.
- Add ROC momentum strategy.
- Add velocity/acceleration strategy.
- Add single-asset backtest simulator.
- Add portfolio backtest simulator.
- Add metrics module.
- Add trade extraction.
- Save metrics/equity/trades.

### Acceptance criteria

- User can run a real daily-data backtest.
- Results persist.
- Frontend displays metrics, equity curve, and trades.

## Phase 5: Chart integration

### Goal

Replace placeholder charts with real visualization.

### Tasks

- Add Lightweight Charts.
- Render candle/line price chart.
- Render equity chart.
- Render benchmark curve.
- Add trade markers.
- Add linked crosshair/readout.
- Paginate/virtualize trade table if needed.

### Acceptance criteria

- Charts remain smooth with thousands of bars.
- Hover/crosshair does not rerender entire React tree.

## Phase 6: Parameter sweeps

### Goal

Backend-computed Sharpe/metric surface.

### Tasks

- Add sweep tables.
- Add `POST /api/sweeps`.
- Add sweep worker.
- Add best-results endpoint.
- Add heatmap slice endpoint.
- Add Canvas heatmap UI.

### Acceptance criteria

- User can run 2D sweep.
- User can view heatmap.
- User can click a cell to apply parameters.
- UI does not freeze.

## Phase 7: Saved run browser

### Goal

Make historical runs reusable.

### Tasks

- Add list endpoint.
- Add run detail page.
- Add filters by strategy/status/date.
- Add rerun button.

### Acceptance criteria

- User can reopen a previous backtest.
- User can rerun with same config.

## Phase 8: Paper trading sandbox later

### Goal

Forward-test strategies on live bars.

### Tasks

- Add paper session tables.
- Add market data stream integration.
- Add bar close evaluator.
- Add paper fill model.
- Add live positions dashboard.

### Acceptance criteria

- User can start a paper session.
- System logs simulated trades continuously.

## Recommended build order summary

```text
1. Repo + Docker
2. React shell
3. FastAPI + Celery fake jobs
4. DB schema
5. Data ingestion
6. Real backtest engine
7. Chart display
8. Sweeps
9. Saved runs
10. Paper trading
```

## Things not to do too early

- Do not build paper trading before historical backtests work.
- Do not add auth before local single-user workflows work.
- Do not add 1-minute data before daily data is stable.
- Do not overfit the frontend to one strategy.
- Do not put huge arrays in React global state.
