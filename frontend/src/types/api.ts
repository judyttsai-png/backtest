export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "1d";
export type ExecutionMode = "long_flat" | "long_short";

export interface ParamMeta {
  id: string;
  label: string;
  type: "int" | "float";
  min: number;
  max: number;
  default: number;
  step: number;
}

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  kind: "single" | "portfolio";
  parameters: ParamMeta[];
}

export interface ExecutionConfig {
  mode: ExecutionMode;
  cost_bps: number;
  slippage_bps: number;
  initial_capital: number;
  allocation?: "all_in" | "equal";
  topup_pct?: number;
  trim_pct?: number;
}

export interface BacktestRequest {
  strategy_model_id: string;
  parameters: Record<string, number>;
  symbols: string[];
  timeframe: Timeframe;
  start_ts: string;
  end_ts: string;
  benchmark_symbol?: string | null;
  provider?: string | null;
  execution: ExecutionConfig;
}

export interface BacktestCreateResponse {
  run_id: string;
  task_id: string | null;
  status: string;
}

export interface BacktestStatus {
  run_id: string;
  status: string;
  progress: number;
  stage: string | null;
  error_message: string | null;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface Metrics {
  run_id: string;
  strategy_model_id: string;
  parameters: Record<string, number>;
  execution_config: Record<string, unknown>;
  initial_capital: number | null;
  final_equity: number | null;
  total_return: number | null;
  cagr: number | null;
  annual_volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  max_drawdown: number | null;
  beta: number | null;
  alpha: number | null;
  win_rate: number | null;
  exposure: number | null;
  turnover: number | null;
  trade_count: number | null;
}

export interface EquityPoint {
  ts: string;
  equity: number;
  drawdown: number | null;
  gross_exposure: number | null;
  net_exposure: number | null;
}

export interface EquityResponse {
  run_id: string;
  points: EquityPoint[];
  benchmark: { ts: string; value: number }[];
}

export interface Candle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface CandlesResponse {
  symbol: string;
  candles: Candle[];
}

export interface Marker {
  ts: string;
  kind: "long_entry" | "short_entry" | "exit";
  price: number;
}

export interface MarkersResponse {
  run_id: string;
  symbol: string;
  markers: Marker[];
}

export interface ModelSignal {
  model: string;
  name: string;
  direction: number; // -1 short, 0 flat, +1 long
  strength: number;
  value: number | null; // the model's key index reading
  unit: string;
  threshold: number | null; // the barrier the value is compared to
}

export interface PairSignals {
  symbol: string;
  price: number | null; // latest close, for live P&L
  consensus: { direction: number; long: number; short: number; flat: number; agree: number };
  signals: ModelSignal[];
}

export interface SignalsResponse {
  asof: string;
  timeframe: Timeframe;
  models: string[];
  pairs: PairSignals[];
}

export interface SignalsRequest {
  symbols: string[];
  timeframe: Timeframe;
  models?: { id: string; parameters?: Record<string, number> }[];
}

export interface Trade {
  id: number;
  symbol: string;
  side: string;
  quantity: number;
  entry_ts: string;
  exit_ts: string | null;
  entry_price: number;
  exit_price: number | null;
  fees: number;
  realized_pnl: number | null;
  return_pct: number | null;
  holding_bars: number | null;
}

export interface TradesResponse {
  run_id: string;
  total: number;
  limit: number;
  offset: number;
  items: Trade[];
}

export interface SweepRequest {
  strategy_model_id: string;
  base_config: Record<string, unknown>;
  sweep_space: Record<string, number[]>;
  objective_metric: string;
}

export interface SweepCreateResponse {
  sweep_id: string;
  task_id: string | null;
  status: string;
  total_points: number;
}

export interface SweepStatus {
  sweep_id: string;
  status: string;
  progress: number;
  total_points: number | null;
  objective_metric: string;
  best_result_id: number | null;
  error_message: string | null;
}

export interface HeatmapResponse {
  x_param: string;
  y_param: string;
  x_values: number[];
  y_values: number[];
  metric: string;
  z: (number | null)[][];
}

export interface Coverage {
  symbol: string;
  timeframe: string;
  count: number;
  start: string | null;
  end: string | null;
}
