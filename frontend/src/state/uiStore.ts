import { create } from "zustand";
import type { ExecutionMode, StrategyMeta, Timeframe } from "../types/api";

export type Theme = "dark" | "light";
export type Tab = "backtest" | "signals";

interface UiState {
  strategyId: string;
  params: Record<string, number>;
  symbols: string;
  benchmark: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  mode: ExecutionMode;
  costBps: number;
  slippageBps: number;
  initialCapital: number;
  allocation: "all_in" | "equal";
  topupPct: number;
  trimPct: number;

  theme: Theme;
  tab: Tab;
  tzMinutes: number; // display timezone offset from UTC, in minutes

  // Signals-tab per-model parameter overrides (persist across tab switches/reloads).
  signalOverrides: Record<string, Record<string, number>>;

  activeRunId: string | null;
  activeSweepId: string | null;

  setStrategy: (meta: StrategyMeta) => void;
  setParam: (id: string, value: number) => void;
  set: <K extends keyof UiState>(key: K, value: UiState[K]) => void;
  toggleTheme: () => void;
  setSignalOverride: (modelId: string, paramId: string, value: number) => void;
  resetSignalOverrides: () => void;
  setActiveRunId: (id: string | null) => void;
  setActiveSweepId: (id: string | null) => void;
}

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
// Default to the start of the FX parquet history so runs use the full sample.
const DATA_START = "2015-01-01";

const THEME_KEY = "parabola-theme";
function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* localStorage unavailable */
  }
  return "dark";
}

const TZ_KEY = "backtest-tz";
function initialTz(): number {
  try {
    const stored = localStorage.getItem(TZ_KEY);
    if (stored != null && !Number.isNaN(Number(stored))) return Number(stored);
  } catch {
    /* localStorage unavailable */
  }
  return 0;
}

const OVERRIDES_KEY = "backtest-signal-overrides";
function initialOverrides(): Record<string, Record<string, number>> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveOverrides(o: Record<string, Record<string, number>>): void {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(o));
  } catch {
    /* localStorage unavailable */
  }
}

export const useUiStore = create<UiState>((set) => ({
  strategyId: "sma",
  params: { fast: 10, slow: 40 },
  symbols: "EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, USDKRW, USDTWD, USDBRL, USDMXN",
  benchmark: "",
  timeframe: "1d",
  startDate: DATA_START,
  endDate: iso(today),
  mode: "long_flat",
  costBps: 5,
  slippageBps: 0,
  initialCapital: 100000,
  allocation: "all_in",
  topupPct: 0,
  trimPct: 0,

  theme: initialTheme(),
  tab: "backtest",
  tzMinutes: initialTz(),
  signalOverrides: initialOverrides(),

  activeRunId: null,
  activeSweepId: null,

  setStrategy: (meta) =>
    set(() => {
      const params: Record<string, number> = {};
      for (const p of meta.parameters) params[p.id] = p.default;
      return { strategyId: meta.id, params };
    }),
  setParam: (id, value) => set((s) => ({ params: { ...s.params, [id]: value } })),
  set: (key, value) => set(() => ({ [key]: value }) as Partial<UiState>),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        /* localStorage unavailable */
      }
      return { theme };
    }),
  setSignalOverride: (modelId, paramId, value) =>
    set((s) => {
      const next = { ...s.signalOverrides, [modelId]: { ...(s.signalOverrides[modelId] || {}), [paramId]: value } };
      saveOverrides(next);
      return { signalOverrides: next };
    }),
  resetSignalOverrides: () =>
    set(() => {
      saveOverrides({});
      return { signalOverrides: {} };
    }),
  setActiveRunId: (id) => set(() => ({ activeRunId: id })),
  setActiveSweepId: (id) => set(() => ({ activeSweepId: id })),
}));
