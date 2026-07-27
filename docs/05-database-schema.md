# Database Schema

Use PostgreSQL with the TimescaleDB extension.

## Extensions

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

## `instruments`

```sql
CREATE TABLE instruments (
    id BIGSERIAL PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT,
    asset_type TEXT NOT NULL CHECK (
        asset_type IN ('equity', 'etf', 'crypto', 'forex', 'future', 'index')
    ),
    exchange TEXT,
    currency TEXT DEFAULT 'USD',
    data_provider TEXT,
    provider_symbol TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (symbol, asset_type, exchange)
);

CREATE INDEX idx_instruments_symbol ON instruments (symbol);
CREATE INDEX idx_instruments_asset_type ON instruments (asset_type);
```

## `historical_candles`

```sql
CREATE TABLE historical_candles (
    instrument_id BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL,
    timeframe TEXT NOT NULL CHECK (
        timeframe IN ('1m', '5m', '15m', '30m', '1h', '1d')
    ),

    open NUMERIC(20, 8) NOT NULL,
    high NUMERIC(20, 8) NOT NULL,
    low NUMERIC(20, 8) NOT NULL,
    close NUMERIC(20, 8) NOT NULL,
    volume NUMERIC(28, 8),

    adjusted_close NUMERIC(20, 8),
    source TEXT NOT NULL,
    ingest_run_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (instrument_id, timeframe, ts)
);

SELECT create_hypertable(
    'historical_candles',
    by_range('ts'),
    if_not_exists => TRUE
);

CREATE INDEX idx_candles_lookup
ON historical_candles (instrument_id, timeframe, ts DESC);
```

## `strategy_models`

```sql
CREATE TABLE strategy_models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    parameter_schema JSONB NOT NULL,
    version TEXT NOT NULL DEFAULT 'v1',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## `backtest_runs`

```sql
CREATE TABLE backtest_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    strategy_model_id TEXT NOT NULL REFERENCES strategy_models(id),
    strategy_version TEXT NOT NULL DEFAULT 'v1',

    status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
    ) DEFAULT 'queued',

    parameters JSONB NOT NULL,
    execution_config JSONB NOT NULL DEFAULT '{}'::jsonb,

    timeframe TEXT NOT NULL,
    start_ts TIMESTAMPTZ NOT NULL,
    end_ts TIMESTAMPTZ NOT NULL,

    universe JSONB NOT NULL,
    benchmark_instrument_id BIGINT REFERENCES instruments(id),

    initial_capital NUMERIC(20, 4) NOT NULL DEFAULT 100000,
    final_equity NUMERIC(20, 4),

    total_return DOUBLE PRECISION,
    cagr DOUBLE PRECISION,
    annual_volatility DOUBLE PRECISION,
    sharpe DOUBLE PRECISION,
    sortino DOUBLE PRECISION,
    max_drawdown DOUBLE PRECISION,
    beta DOUBLE PRECISION,
    alpha DOUBLE PRECISION,
    win_rate DOUBLE PRECISION,
    exposure DOUBLE PRECISION,
    turnover DOUBLE PRECISION,
    trade_count INTEGER,

    progress DOUBLE PRECISION NOT NULL DEFAULT 0,
    progress_stage TEXT,
    error_message TEXT,

    celery_task_id TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_backtest_runs_status ON backtest_runs (status);
CREATE INDEX idx_backtest_runs_created_at ON backtest_runs (created_at DESC);
CREATE INDEX idx_backtest_runs_strategy ON backtest_runs (strategy_model_id);
```

## `backtest_equity_points`

```sql
CREATE TABLE backtest_equity_points (
    backtest_run_id UUID NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL,
    equity NUMERIC(20, 8) NOT NULL,
    cash NUMERIC(20, 8),
    gross_exposure NUMERIC(20, 8),
    net_exposure NUMERIC(20, 8),
    drawdown DOUBLE PRECISION,

    PRIMARY KEY (backtest_run_id, ts)
);

SELECT create_hypertable(
    'backtest_equity_points',
    by_range('ts'),
    if_not_exists => TRUE
);
```

## `trade_logs`

```sql
CREATE TABLE trade_logs (
    id BIGSERIAL PRIMARY KEY,

    backtest_run_id UUID REFERENCES backtest_runs(id) ON DELETE CASCADE,
    paper_session_id UUID,

    instrument_id BIGINT NOT NULL REFERENCES instruments(id),

    side TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'short', 'cover')),
    quantity NUMERIC(28, 8) NOT NULL,

    entry_ts TIMESTAMPTZ NOT NULL,
    exit_ts TIMESTAMPTZ,

    entry_price NUMERIC(20, 8) NOT NULL,
    exit_price NUMERIC(20, 8),

    fees NUMERIC(20, 8) NOT NULL DEFAULT 0,
    slippage NUMERIC(20, 8) NOT NULL DEFAULT 0,

    realized_pnl NUMERIC(20, 8),
    return_pct DOUBLE PRECISION,

    holding_bars INTEGER,
    signal_context JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (
        backtest_run_id IS NOT NULL OR paper_session_id IS NOT NULL
    )
);

CREATE INDEX idx_trade_logs_backtest ON trade_logs (backtest_run_id);
CREATE INDEX idx_trade_logs_instrument_ts ON trade_logs (instrument_id, entry_ts DESC);
```

## `parameter_sweeps`

```sql
CREATE TABLE parameter_sweeps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    strategy_model_id TEXT NOT NULL REFERENCES strategy_models(id),
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
    ) DEFAULT 'queued',

    base_config JSONB NOT NULL,
    sweep_space JSONB NOT NULL,

    objective_metric TEXT NOT NULL DEFAULT 'sharpe',
    best_result_id BIGINT,

    progress DOUBLE PRECISION NOT NULL DEFAULT 0,
    celery_task_id TEXT,
    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE TABLE parameter_sweep_results (
    id BIGSERIAL PRIMARY KEY,
    sweep_id UUID NOT NULL REFERENCES parameter_sweeps(id) ON DELETE CASCADE,

    parameter_point JSONB NOT NULL,
    metrics JSONB NOT NULL,

    total_return DOUBLE PRECISION,
    sharpe DOUBLE PRECISION,
    sortino DOUBLE PRECISION,
    max_drawdown DOUBLE PRECISION,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sweep_results_sweep ON parameter_sweep_results (sweep_id);
CREATE INDEX idx_sweep_results_sharpe ON parameter_sweep_results (sweep_id, sharpe DESC);
```

## Paper trading tables for v2

```sql
CREATE TABLE paper_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_model_id TEXT NOT NULL REFERENCES strategy_models(id),
    parameters JSONB NOT NULL,
    execution_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    universe JSONB NOT NULL,
    timeframe TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('active', 'paused', 'stopped', 'failed')
    ) DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ
);

CREATE TABLE paper_positions (
    id BIGSERIAL PRIMARY KEY,
    paper_session_id UUID NOT NULL REFERENCES paper_sessions(id) ON DELETE CASCADE,
    instrument_id BIGINT NOT NULL REFERENCES instruments(id),
    quantity NUMERIC(28, 8) NOT NULL,
    avg_entry_price NUMERIC(20, 8) NOT NULL,
    market_price NUMERIC(20, 8),
    unrealized_pnl NUMERIC(20, 8),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (paper_session_id, instrument_id)
);
```

## Schema notes

- Keep strategy parameters in JSONB while strategy interfaces are evolving.
- Store finalized metrics as columns for sorting/filtering.
- Store full detailed metrics in JSONB if needed later.
- Store all price data in normalized candle rows, not in JSON blobs.
- Do not store huge result payloads in Redis.
