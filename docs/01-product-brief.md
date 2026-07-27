# Product Brief

## Product name

**PARABOLA** — strategy backtest terminal.

## One-sentence goal

Build a professional full-stack quantitative trading research terminal that lets a user configure strategy models, run historical backtests, sweep parameters, inspect performance, and eventually run forward-testing/paper-trading sessions against real market data.

## User intent

The user currently has a clean single-file frontend MVP (`parabola.html`) that proves the visual concept and rough strategy interactions. The new app should preserve the terminal-like UX while becoming robust enough for real financial data, persistent storage, asynchronous compute, and larger parameter searches.

## Target user

A technically sophisticated student/researcher/developer who wants to experiment with trading strategies and parameter sweeps without building everything manually every time.

The app does **not** need to be a production brokerage/trading platform in v1. It should first be a reliable research/backtesting terminal.

## Core v1 product capabilities

### 1. Strategy configuration UI

The frontend should allow the user to:

- Select a strategy model.
- Adjust model parameters through sliders/inputs.
- Select symbols/universe.
- Select timeframe.
- Select date range.
- Select execution assumptions such as cost, slippage, long-only vs long-short.
- Click `RUN BACKTEST`.

### 2. Historical data ingestion

The backend should:

- Fetch real market data from provider integrations.
- Store normalized OHLCV candles in PostgreSQL/TimescaleDB.
- Avoid repeatedly fetching the same data from APIs.
- Provide clean candle panels to backtest workers.

Start with daily candles. Add 1-minute candles later.

### 3. Asynchronous backtesting

Backtests should:

- Run in Celery workers, not in the browser.
- Persist status/progress.
- Persist final metrics, equity curves, and trade logs.
- Be reproducible from saved config and saved input data.

### 4. Visual result inspection

The frontend should display:

- Metric cards.
- Price/candle chart.
- Trade markers.
- Equity curve.
- Benchmark curve.
- Trade table.
- Linked crosshair/readout.

### 5. Parameter sweep

The system should support backend-computed sweeps over strategy parameters, returning heatmap-ready slices and best-results tables.

### 6. Paper trading later

Forward-testing/paper-trading is a v2 feature. Do not build it until historical backtesting, persistence, ingestion, and sweeps work cleanly.

## Explicit non-goals for v1

Do not spend v1 time on:

- Real-money trading.
- Broker order routing.
- Multi-user permissions.
- Complex auth.
- Options/futures modeling.
- Intraday latency optimization.
- Perfect institutional-grade portfolio accounting.
- Bayesian optimization.
- Live WebSocket paper trading.
- Mobile app.

## Product personality

The UI should feel like a polished quant terminal:

- Dark background.
- Technical but clean.
- Dense information layout without clutter.
- Fast interactions.
- Good visual hierarchy.
- No lag during chart hover or parameter editing.

## V1 success definition

V1 is successful when a user can:

1. Start the app locally with Docker Compose.
2. Select a few real tickers such as `AAPL`, `MSFT`, `NVDA`.
3. Fetch daily OHLCV data.
4. Run at least three strategies: SMA crossover, ROC momentum, velocity/acceleration.
5. See progress while the backtest runs.
6. Inspect completed metrics, equity curve, price chart, markers, and trade logs.
7. Run a 2D parameter sweep and see a heatmap.
8. Reopen past backtest results from the database.
