import { api } from "./client";
import type {
  BacktestCreateResponse,
  BacktestRequest,
  BacktestStatus,
  CandlesResponse,
  Coverage,
  EquityResponse,
  HeatmapResponse,
  MarkersResponse,
  Metrics,
  StrategyMeta,
  SweepCreateResponse,
  SweepRequest,
  SweepStatus,
  TradesResponse,
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

// data
export const getCoverage = (symbol: string, timeframe = "1d") =>
  api.get<Coverage>(`/api/data/coverage?symbol=${symbol}&timeframe=${timeframe}`);

// sweeps
export const createSweep = (req: SweepRequest) =>
  api.post<SweepCreateResponse>("/api/sweeps", req);
export const getSweepStatus = (id: string) => api.get<SweepStatus>(`/api/sweeps/${id}`);
export const getHeatmap = (id: string, x: string, y: string, metric: string) =>
  api.get<HeatmapResponse>(`/api/sweeps/${id}/heatmap?x=${x}&y=${y}&metric=${metric}`);
