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

  theme: Theme;
  tab: Tab;

  activeRunId: string | null;
  activeSweepId: string | null;

  setStrategy: (meta: StrategyMeta) => void;
  setParam: (id: string, value: number) => void;
  set: <K extends keyof UiState>(key: K, value: UiState[K]) => void;
  toggleTheme: () => void;
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

export const useUiStore = create<UiState>((set) => ({
  strategyId: "sma",
  params: { fast: 10, slow: 40 },
  symbols: "EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD",
  benchmark: "",
  timeframe: "1d",
  startDate: DATA_START,
  endDate: iso(today),
  mode: "long_flat",
  costBps: 5,
  slippageBps: 0,
  initialCapital: 100000,

  theme: initialTheme(),
  tab: "backtest",

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
  setActiveRunId: (id) => set(() => ({ activeRunId: id })),
  setActiveSweepId: (id) => set(() => ({ activeSweepId: id })),
}));
