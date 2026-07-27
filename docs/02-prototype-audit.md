# Prototype Audit: `parabola.html`

## Current prototype summary

The existing MVP is a single HTML file that runs entirely in the browser. It includes HTML, CSS, JavaScript, synthetic data generation, strategy logic, backtest logic, metrics, SVG charting, linked cursor behavior, and parameter sweep computation in one file.

The prototype is valuable because it captures the desired product feel. It is not a viable production architecture.

## Features already demonstrated

### UI layout

- Dark terminal-style interface.
- Masthead with `PARABOLA` branding.
- Left-side parameter rail.
- Main result area.
- Metric cards/gauges.
- Multiple result panels.
- Trade log table.
- Sharpe surface heatmap.

### Model registry pattern

The prototype uses a `MODELS` array containing strategy definitions:

- `velacc` — velocity/acceleration portfolio model.
- `sma` — SMA crossover single-asset model.
- `roc` — rate-of-change momentum single-asset model.

This model registry concept should survive, but move into a typed backend/strategy registry and a frontend metadata registry.

### Strategy logic

The prototype implements:

- SMA calculation.
- ROC calculation.
- Rolling quadratic fit on log price.
- Velocity and acceleration extraction.
- Long/flat and long/short modes.
- Cross-sectional portfolio selection.
- Rebalance logic.
- Basic transaction cost modeling.

### Synthetic data

The prototype uses seeded random generation:

- Single-asset GBM/regime-style synthetic prices.
- Synthetic universe with market factor and idiosyncratic drift.

Synthetic data should be kept only for demo/testing mode. Real backend data should replace it for production use.

### Charts

The prototype uses inline SVG to render:

- Price chart.
- Derivative scope chart.
- Equity chart.
- Portfolio growth chart.
- Heatmap.
- Trade markers.
- Crosshair overlays.

Production should use a proper charting library for financial series, probably TradingView Lightweight Charts for price/equity charts and Canvas/WebGL for large heatmaps.

### Metrics

The prototype calculates:

- Total return.
- CAGR.
- Annual volatility.
- Sharpe.
- Sortino.
- Beta.
- Alpha.
- Max drawdown.
- Trade count/rebalance count.
- Win rate.
- Exposure.

These metrics should be reimplemented in Python and persisted.

## Major current limitations

### 1. Browser-thread locking

The prototype computes strategies, sweeps, metrics, SVG paths, and DOM changes on the main thread. Parameter sweeps become slow and lock the UI.

### 2. No persistence

Backtest runs, parameters, candles, trades, and results disappear on refresh.

### 3. Synthetic-only data

No real data ingestion exists.

### 4. No scalable compute layer

All nested loops run in the browser. This cannot scale to large universes, long histories, intraday data, or N-dimensional parameter sweeps.

### 5. No backend validation

Model IDs, parameter bounds, execution assumptions, and universe definitions are not validated by a server.

### 6. No reproducibility layer

A real backtest must be reproducible from:

- strategy model ID/version
- parameter dictionary
- universe
- timeframe
- date range
- execution settings
- data version/source

### 7. No task orchestration

Long-running jobs need task IDs, status, progress, cancellation, error reporting, and result retrieval.

## What to preserve

Preserve these aspects:

- Clean terminal UI aesthetic.
- Strategy model selector.
- Parameter sliders.
- Metric card layout.
- Price/equity/trade-log inspection flow.
- Linked hover/crosshair behavior.
- 2D Sharpe heatmap concept.
- Multiple strategy types.
- Portfolio and single-asset modes.

## What to replace

Replace these aspects:

- Inline SVG charting for large charts.
- Browser-side backtest computation.
- Browser-side parameter sweep computation.
- Hardcoded synthetic feed as default data source.
- Single-file architecture.
- DOM mutation style rendering.

## Production mapping

```text
Current prototype concept        Production equivalent
-------------------------        ---------------------
MODELS array                     Backend strategy registry + frontend metadata
Synthetic price generator        Data ingestion service + TimescaleDB candles
run() function                   POST /api/backtests + Celery task
sweepSharpe()                    Backend parameter sweep task
renderHeatmap()                  Canvas heatmap fed by sweep result endpoint
inline SVG price/equity          Lightweight Charts
local JS metrics                 Python metrics module
local trade extraction           Python trade extraction + DB persistence
```
