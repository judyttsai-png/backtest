import { api } from "./client";
import type {
  BacktestCreateResponse,
  BacktestRequest,
  BacktestStatus,
  CandlesResponse,
  Coverage,
  EquityResponse,
  FitRequest,
  FitResponse,
  PlaybookItem,
  PlaybookScoreResponse,
  PlaybookSignalsResponse,
  HeatmapResponse,
  MarkersResponse,
  Metrics,
  SignalsRequest,
  SignalsResponse,
  StrategyMeta,
  SweepCreateResponse,
  SweepRequest,
  SweepStatus,
  TradesResponse,
  WalkForwardRequest,
  WalkForwardResponse,
} from "../types/api";

// strategies
export const getStrategies = () => api.get<StrategyMeta[]>("/api/strategies");

// backtests
export const createBacktest = (req: BacktestRequest) =>
  api.post<BacktestCreateResponse>("/api/backtests", req);
export const getBacktestStatus = (id: string) =>
  api.get<BacktestStatus>(`/api/backtests/${id}`);
export const getMetrics = (id: string) => api.get<Metrics>(`/api/backtests/${id}/metrics`);
export const getEquity = (id: string) => api.get<EquityResponse>(`/api/backtests/${id}/equity`);
export const getCandles = (id: string, symbol?: string) =>
  api.get<CandlesResponse>(`/api/backtests/${id}/candles${symbol ? `?symbol=${symbol}` : ""}`);
export const getMarkers = (id: string, symbol?: string) =>
  api.get<MarkersResponse>(`/api/backtests/${id}/markers${symbol ? `?symbol=${symbol}` : ""}`);
export const getTrades = (id: string, limit: number, offset: number) =>
  api.get<TradesResponse>(`/api/backtests/${id}/trades?limit=${limit}&offset=${offset}`);

// signals (live recommendations)
export const postSignals = (req: SignalsRequest) =>
  api.post<SignalsResponse>("/api/signals", req);

// walk-forward (rolling out-of-sample stability)
export const postWalkForward = (req: WalkForwardRequest) =>
  api.post<WalkForwardResponse>("/api/walkforward", req);

// data
export const getCoverage = (symbol: string, timeframe = "1d") =>
  api.get<Coverage>(`/api/data/coverage?symbol=${symbol}&timeframe=${timeframe}`);

// sweeps
export const createSweep = (req: SweepRequest) =>
  api.post<SweepCreateResponse>("/api/sweeps", req);
export const getSweepStatus = (id: string) => api.get<SweepStatus>(`/api/sweeps/${id}`);
export const getHeatmap = (id: string, x: string, y: string, metric: string) =>
  api.get<HeatmapResponse>(`/api/sweeps/${id}/heatmap?x=${x}&y=${y}&metric=${metric}`);

// strategy-fit matrix
export const postFitMatrix = (req: FitRequest) =>
  api.post<FitResponse>("/api/fit-matrix", req);

// playbook (per-currency assignment scoring)
export const postPlaybookScore = (req: { items: PlaybookItem[]; cost_bps: number; oos_frac: number }) =>
  api.post<PlaybookScoreResponse>("/api/fit-matrix/score", req);

// playbook-driven live signals
export const postPlaybookSignals = (req: {
  items: { pair: string; strategy: string; timeframe: string; params?: Record<string, number> }[];
  atr_len?: number;
  stop_mult?: number;
  target_mult?: number;
}) => api.post<PlaybookSignalsResponse>("/api/signals/playbook", req);
