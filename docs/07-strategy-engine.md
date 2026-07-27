# Strategy Engine Design

## Goal

Implement a Python strategy engine that reproduces and improves the logic from the prototype while avoiding browser-side compute and lookahead bias.

## Strategy registry

Use a backend registry mapping model IDs to strategy implementations.

```python
STRATEGY_REGISTRY = {
    "sma": SmaCrossoverStrategy,
    "roc": RocMomentumStrategy,
    "velacc": VelocityAccelerationStrategy,
}
```

Each strategy should expose:

```python
class Strategy:
    id: str
    name: str
    parameter_schema: dict

    def validate_parameters(self, params: dict) -> dict:
        ...

    def generate_signals(self, data, params: dict):
        ...
```

## Input data shape

For single-asset strategies:

```python
pandas.DataFrame indexed by timestamp:
columns = ["open", "high", "low", "close", "volume", "adjusted_close"]
```

For portfolio strategies:

Prefer long format from DB, then pivot inside data loader:

```python
# long format
columns = ["ts", "symbol", "open", "high", "low", "close", "volume"]

# close panel
index = timestamps
columns = symbols
values = close or adjusted_close
```

## Output data shape

Strategy should produce target positions or signals, not directly mutate DB.

Single asset:

```python
signals = DataFrame(index=ts)
signals["target_position"] = -1 | 0 | 1
signals["signal_reason"] = optional string/json
```

Portfolio:

```python
target_weights = DataFrame(index=ts, columns=symbols)
# values are portfolio weights, e.g. 0.2, -0.2, 0.0
```

## Execution convention

Must be explicit.

Recommended v1 rule:

```text
Signal is computed using data through bar t.
Position is applied starting bar t+1.
```

That means a signal generated from today's close cannot earn today's return. This prevents lookahead bias.

## Strategies to implement first

### 1. SMA crossover

Parameters:

```json
{
  "fast": 10,
  "slow": 40
}
```

Logic:

- Compute fast SMA.
- Compute slow SMA.
- Long if fast > slow.
- Flat or short depending on execution mode.

Validation:

- `fast >= 2`
- `slow > fast`

### 2. ROC momentum

Parameters:

```json
{
  "look": 20,
  "thr": 1
}
```

Logic:

- `roc = close / close.shift(look) - 1`
- Long if `roc > threshold`
- Short if long-short mode and `roc < -threshold`

### 3. Velocity / acceleration

Parameters:

```json
{
  "window": 20,
  "vthr": 2,
  "athr": 0,
  "hold": 5
}
```

Logic:

- Use rolling log prices.
- Fit a quadratic curve over the rolling window.
- Velocity is slope at the right edge.
- Acceleration is curvature.
- Rank instruments by velocity.
- Long strongest instruments above velocity and acceleration thresholds.
- In long-short mode, short weakest instruments below negative thresholds.
- Rebalance every `REBAL` bars, default 5 for daily data.

## Backtest simulation

V1 simulation can be vectorized and simple.

For single-asset:

```python
returns = close.pct_change().fillna(0)
position = target_position.shift(1).fillna(0)
strategy_returns = position * returns - transaction_costs
```

For portfolio:

```python
asset_returns = close_panel.pct_change().fillna(0)
weights = target_weights.shift(1).fillna(0)
portfolio_returns = (weights * asset_returns).sum(axis=1) - costs
```

## Transaction costs

V1:

```python
turnover = abs(weights - weights.shift(1)).sum(axis=1)
cost = turnover * cost_bps / 10000
```

For single asset:

```python
turnover = abs(position - position.shift(1))
cost = turnover * cost_bps / 10000
```

## Metrics

Compute:

- total return
- CAGR
- annual volatility
- Sharpe
- Sortino
- max drawdown
- beta
- alpha
- exposure
- turnover
- trade count
- win rate

Use annualization factors by timeframe:

```python
ANNUALIZATION = {
    "1d": 252,
    "1h": 252 * 6.5,
    "30m": 252 * 13,
    "15m": 252 * 26,
    "5m": 252 * 78,
    "1m": 252 * 390,
}
```

For crypto, this differs. Add asset-class-specific annualization later.

## Trade extraction

For v1, extract trades from position changes.

Single asset:

- Entry when position goes from 0 to 1 or -1.
- Exit when position goes to 0 or flips.
- Record entry time, exit time, entry price, exit price, return, bars held.

Portfolio:

- Can either record individual instrument entries/exits or rebalance events.
- Prefer individual instrument trade logs if feasible.

## Anti-lookahead checklist

Every strategy/backtest must pass these rules:

- Signal at timestamp `t` uses only candles with timestamp `<= t`.
- Return from `t` to `t+1` uses position decided at `t`, applied after shifting.
- No centered rolling windows in production strategies unless shifted correctly.
- Do not use full-sample statistics for signals unless explicitly designed as in-sample research.
- Do not select parameters based on test period and then report same period without warning.

## Reproducibility checklist

Each saved backtest must preserve:

- strategy model ID
- strategy version
- parameter dictionary
- execution config
- universe
- timeframe
- start/end
- data source
- data loaded from DB at run time
- code version later, ideally git commit hash
