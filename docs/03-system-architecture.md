# System Architecture

## Target architecture

```text
React/Vite Frontend
  ├─ Strategy controls
  ├─ Chart rendering
  ├─ Heatmap rendering
  ├─ Task status display
  └─ Result exploration

FastAPI Backend
  ├─ Request validation
  ├─ Backtest/sweep creation
  ├─ Status endpoints
  ├─ Result endpoints
  ├─ Data-management endpoints
  └─ WebSocket support later

Celery + Redis
  ├─ Backtest tasks
  ├─ Sweep tasks
  ├─ Data ingestion tasks
  ├─ Paper trading tasks later
  └─ Scheduled maintenance

PostgreSQL + TimescaleDB
  ├─ Instruments
  ├─ Historical candles
  ├─ Backtest runs
  ├─ Equity curves
  ├─ Trade logs
  ├─ Sweep results
  └─ Paper sessions later

External Data Providers
  ├─ Yahoo Finance / yfinance
  ├─ Alpaca
  ├─ Binance
  └─ Other providers later
```

## Service responsibilities

### Frontend

The frontend is a responsive control and visualization terminal.

It should own:

- UI state.
- Parameter editing.
- Chart display.
- Heatmap display.
- Progress display.
- Result inspection.

It should not own:

- Heavy backtest computation.
- Large parameter sweeps.
- Real data fetching directly from financial APIs.
- Persistent storage.
- Strategy truth/source of record.

### FastAPI backend

The backend is the control plane.

It should own:

- API validation.
- Creating backtest run records.
- Creating sweep records.
- Dispatching Celery tasks.
- Reading/writing the database.
- Serving result data to the frontend.
- Serving strategy metadata.

### Celery workers

Workers are the compute plane.

They should own:

- Backtest execution.
- Parameter sweep evaluation.
- Data ingestion.
- Metrics computation.
- Trade extraction.
- Paper trading loops later.

### PostgreSQL/TimescaleDB

The database is the system of record.

It should own:

- Instrument metadata.
- Historical OHLCV candles.
- Backtest configs and statuses.
- Final metrics.
- Equity curves.
- Trade logs.
- Sweep result points.
- Paper trading sessions/positions later.

### Redis

Redis should be used for:

- Celery broker.
- Celery result backend for small metadata.
- Short-lived progress/status cache if desired.

Redis should not be used as primary storage for candles, trades, or backtest results.

## Recommended local development stack

Use Docker Compose:

```yaml
services:
  postgres:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_USER: parabola
      POSTGRES_PASSWORD: parabola
      POSTGRES_DB: parabola
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  backend:
    build: ./backend
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    env_file: .env
    depends_on:
      - postgres
      - redis
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app

  worker:
    build: ./backend
    command: celery -A app.celery_app.celery_app worker --loglevel=info
    env_file: .env
    depends_on:
      - postgres
      - redis
    volumes:
      - ./backend:/app

  frontend:
    build: ./frontend
    command: npm run dev -- --host 0.0.0.0
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules

volumes:
  postgres_data:
```

## Suggested backend package choices

- FastAPI
- Uvicorn
- SQLAlchemy 2.x
- Alembic
- psycopg / asyncpg depending sync/async DB style
- Pydantic
- Celery
- Redis
- pandas
- numpy
- yfinance for initial daily data

## Suggested frontend package choices

- React
- TypeScript
- Vite
- TanStack Query
- Zustand
- Lightweight Charts
- Canvas heatmap component
- Web Worker via Vite worker imports

## Architecture principle

Keep this separation clear:

```text
React = terminal
FastAPI = controller
Celery = compute engine
Postgres/TimescaleDB = memory
Providers = external feeds
```
