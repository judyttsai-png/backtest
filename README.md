# PARABOLA

A full-stack quantitative **strategy backtest, parameter-sweep, and research terminal**.

PARABOLA lets you configure strategy models, run reproducible historical backtests
against real market data, sweep parameters into a heatmap surface, and inspect
metrics, equity curves, price signals, and trade logs — all in a dark, dense,
terminal-style UI.

It is the production rebuild of the single-file browser prototype (`docs/parabola (1).html`):
heavy computation, persistence, data ingestion, and long-running sweeps have been
moved out of the browser and into decoupled backend services, while the clean
terminal UX is preserved.

```
React / Vite  =  terminal        (control + visualization)
FastAPI       =  controller      (validation, task dispatch, result serving)
Celery        =  compute engine  (backtests, sweeps, ingestion)
Postgres/TimescaleDB = memory     (system of record)
Providers     =  external feeds  (yfinance; synthetic for offline demos)
```

See [`docs/`](docs/) for the full architecture reference.

---

## Features (v1 implemented)

- **Three strategies** in a typed backend registry:
  - `sma` — SMA crossover (single asset)
  - `roc` — ROC momentum (single asset)
  - `velacc` — velocity/acceleration cross-sectional portfolio (rolling quadratic fit)
- **Asynchronous backtests** via Celery with persisted status/progress, metrics,
  equity curve, and trade logs — reproducible from saved config + DB-loaded candles.
- **Explicit anti-lookahead execution**: a signal computed from bar `t`'s close is
  applied starting bar `t+1` (unit-tested).
- **Data ingestion** to TimescaleDB with idempotent upserts, coverage checks, and a
  yfinance provider (plus a deterministic synthetic provider for offline use).
- **Parameter sweeps** with combinatorial guardrails, best-result tables, and a
  Canvas-rendered heatmap surface; click a cell to adopt its parameters.
- **Metrics**: total return, CAGR, annual vol, Sharpe, Sortino, max drawdown, beta,
  alpha, win rate, exposure, turnover, trade count.
- **Charts** via TradingView Lightweight Charts (price + trade markers, equity vs
  benchmark), kept in refs so hover/crosshair never triggers a React re-render.
- Paginated trade log, live progress states, and error surfacing.

---

## Quick start

### Option A — Docker Compose (mandated stack: Postgres/TimescaleDB + Redis + Celery)

```bash
cp .env.example .env
docker compose up --build
```

Then open:

- Frontend: http://localhost:5173
- API docs: http://localhost:8000/docs
- Health:   http://localhost:8000/health

This starts Postgres/TimescaleDB, Redis, the FastAPI backend, a Celery worker, and
the Vite dev server. With `DEFAULT_DATA_PROVIDER=yfinance` (the compose default),
running a backtest will fetch and store real daily candles on first use.

### Option B — Local, zero-infra (SQLite + in-process tasks + synthetic data)

No Docker, Postgres, or Redis required — useful for a fast demo or development.

**Backend:**

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL="sqlite:///./parabola.sqlite3" \
DEFAULT_DATA_PROVIDER=synthetic \
CELERY_TASK_ALWAYS_EAGER=1 \
uvicorn app.main:app --reload
```

In eager mode Celery runs tasks synchronously in-process over an in-memory broker,
so the full backtest/sweep lifecycle works without Redis.

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

---

## Environment variables

| Variable                   | Default (local)                    | Purpose                                             |
| -------------------------- | ---------------------------------- | --------------------------------------------------- |
| `DATABASE_URL`             | `sqlite:///./parabola.sqlite3`     | SQLAlchemy URL. Compose uses the Postgres URL.      |
| `CELERY_BROKER_URL`        | `redis://localhost:6379/0`         | Celery broker (ignored in eager mode).              |
| `CELERY_RESULT_BACKEND`    | `redis://localhost:6379/1`         | Celery result backend.                              |
| `CELERY_TASK_ALWAYS_EAGER` | `0`                                | `1` runs tasks in-process (no worker/Redis).        |
| `DEFAULT_DATA_PROVIDER`    | `synthetic`                        | `yfinance` for real daily data, `synthetic` offline.|
| `CORS_ORIGINS`             | `http://localhost:5173,...`        | Comma-separated allowed origins.                    |
| `VITE_API_BASE_URL`        | `http://localhost:8000`            | Frontend → backend base URL.                        |

On Postgres the app enables the TimescaleDB extension and creates hypertables for
`historical_candles` and `backtest_equity_points`. On SQLite those steps are skipped
gracefully.

---

## Using the terminal

1. Pick a **model** in the left rail (SMA / ROC / Velocity-Acceleration).
2. Adjust **parameters** with the sliders.
3. Set the **symbols** (e.g. `AAPL, MSFT, NVDA`), optional **benchmark**, **timeframe**,
   **date range**, and **execution** settings (long/flat vs long/short, cost, slippage).
4. Press **RUN BACKTEST**. Progress streams while the worker runs.
5. Inspect **metrics**, the **price chart** with trade markers, the **equity curve** vs
   benchmark, and the **trade log**.
6. In the **Parameter Sweep** panel choose two axes + an objective and press **SWEEP**;
   click any heatmap cell to adopt those parameters (then re-run).

> ⚠️ Parameter sweeps are in-sample. Choosing the best cell and reporting that
> performance on the same period is overfitting — the UI flags this.

---

## API surface

```
GET  /health
GET  /api/strategies                     GET /api/strategies/{id}
POST /api/backtests                      GET /api/backtests            (list / filter)
GET  /api/backtests/{id}                 GET /api/backtests/{id}/metrics
GET  /api/backtests/{id}/equity          GET /api/backtests/{id}/trades?limit&offset
GET  /api/backtests/{id}/candles?symbol  GET /api/backtests/{id}/markers?symbol
GET  /api/instruments?search             POST /api/instruments
POST /api/data/ingest                    GET /api/data/coverage?symbol&timeframe
POST /api/sweeps                         GET /api/sweeps/{id}
GET  /api/sweeps/{id}/best?limit         GET /api/sweeps/{id}/results?sort&limit
GET  /api/sweeps/{id}/heatmap?x&y&metric
```

Result endpoints return `409` until the run is `completed`; unknown strategies /
invalid parameters return `422`.

---

## Tests

```bash
cd backend
source .venv/bin/activate
pytest
```

Covers metrics, strategy signal generation, anti-lookahead execution shifting, the
backtest-creation API, and an end-to-end worker run that persists equity + trades.

---

## Project layout

```
parabola/
  backend/            FastAPI + SQLAlchemy + Celery + strategy engine
    app/
      routers/        health, strategies, backtests, data, sweeps
      services/       strategies/, backtest_engine, metrics, persistence,
                      data_manager, data_loader, providers/
      tasks/          backtests, sweeps, ingestion (Celery)
      models.py schemas.py db.py celery_app.py seed.py config.py main.py
    tests/
  frontend/           React + TS + Vite terminal
    src/
      api/ state/ types/
      components/      layout, charts (Lightweight Charts), heatmap (Canvas), tables
      features/        backtest/, sweeps/
  docs/               architecture reference + original prototype
  docker-compose.yml  .env.example
```

---

## Roadmap (not yet built)

- Saved-run browser with filters + one-click rerun (list endpoint already exists).
- 1-minute / intraday candles and additional providers (Alpaca, Binance).
- Parallel (chunked) sweeps via Celery groups/chords; cancellation via revoke.
- Walk-forward / out-of-sample scoring and robustness zones for sweeps.
- Paper-trading sandbox (v2) — only after historical backtesting is fully stable.
```
