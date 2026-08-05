import { create } from "zustand";
import type { ExecutionMode, StrategyMeta, Timeframe } from "../types/api";

export type Theme = "dark" | "light";
export type Tab = "backtest" | "signals" | "fit" | "playbook";

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
  allocation: "all_in" | "equal" | "mvskew";
  topupPct: number;
  trimPct: number;
  // Mean-Variance-Skewness sizing knobs (allocation === "mvskew").
  mvsLambda: number; // variance aversion
  mvsGamma: number; // skewness preference
  mvsMaxWeight: number; // per-pair cap (fraction, e.g. 0.20)

  theme: Theme;
  tab: Tab;
  tzMinutes: number; // display timezone offset from UTC, in minutes

  // Signals-tab per-model parameter overrides (persist across tab switches/reloads).
  signalOverrides: Record<string, Record<string, number>>;
  // Which strategies the Signals tab includes ([] = all). Persisted.
  signalModels: string[];
  // Per-model bar size on the Signals tab ({} = use the page's bar). Persisted.
  signalTimeframes: Record<string, Timeframe>;
  // Per-strategy parameter overrides for the Fit matrix ({} = defaults). Persisted.
  fitOverrides: Record<string, Record<string, number>>;
  // Per-currency strategy assignment (the Playbook): strategy, bar, and its own
  // constants for that pair. Persisted.
  playbook: Record<string, { strategy: string; timeframe: Timeframe; params?: Record<string, number> }>;

  activeRunId: string | null;
  activeSweepId: string | null;

  setStrategy: (meta: StrategyMeta) => void;
  setParam: (id: string, value: number) => void;
  set: <K extends keyof UiState>(key: K, value: UiState[K]) => void;
  toggleTheme: () => void;
  setSignalOverride: (modelId: string, paramId: string, value: number) => void;
  resetSignalOverrides: () => void;
  setSignalModels: (ids: string[]) => void;
  setSignalTimeframe: (modelId: string, tf: Timeframe) => void;
  setFitOverride: (modelId: string, paramId: string, value: number) => void;
  resetFitOverrides: () => void;
  setPlaybookRow: (
    pair: string,
    patch: Partial<{ strategy: string; timeframe: Timeframe; params?: Record<string, number> }>,
  ) => void;
  setPlaybookParam: (pair: string, paramId: string, value: number) => void;
  addPlaybookRow: (pair: string) => void;
  removePlaybookRow: (pair: string) => void;
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

const MODELS_KEY = "backtest-signal-models";
function initialSignalModels(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(MODELS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const SIGTF_KEY = "backtest-signal-timeframes";
function initialSignalTimeframes(): Record<string, Timeframe> {
  try {
    const v = JSON.parse(localStorage.getItem(SIGTF_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const FITOVR_KEY = "backtest-fit-overrides";
function initialFitOverrides(): Record<string, Record<string, number>> {
  try {
    return JSON.parse(localStorage.getItem(FITOVR_KEY) || "{}");
  } catch {
    return {};
  }
}

// Seeded from the strategy-fit matrix (daily OOS best per pair). Users edit it.
const DEFAULT_PLAYBOOK: Record<string, { strategy: string; timeframe: Timeframe }> = {
  AUDUSD: { strategy: "meanrev", timeframe: "1d" },
  EURAUD: { strategy: "meanrev", timeframe: "1d" },
  EURUSD: { strategy: "meanrev", timeframe: "1d" },
  GBPUSD: { strategy: "meanrev", timeframe: "1d" },
  EURGBP: { strategy: "meanrev", timeframe: "1d" },
  EURCHF: { strategy: "meanrev", timeframe: "1d" },
  CADJPY: { strategy: "meanrev", timeframe: "1d" },
  USDCAD: { strategy: "sma", timeframe: "1d" },
  NZDUSD: { strategy: "sma", timeframe: "1d" },
  GBPJPY: { strategy: "sma", timeframe: "1d" },
  AUDJPY: { strategy: "sma", timeframe: "1d" },
  CHFJPY: { strategy: "sma", timeframe: "1d" },
  NZDJPY: { strategy: "sma", timeframe: "1d" },
  USDJPY: { strategy: "dmi", timeframe: "1d" },
  EURJPY: { strategy: "dmi", timeframe: "1d" },
  USDCHF: { strategy: "smacross", timeframe: "1d" },
};
const PLAYBOOK_KEY = "backtest-playbook";
function initialPlaybook(): Record<string, { strategy: string; timeframe: Timeframe }> {
  try {
    const v = localStorage.getItem(PLAYBOOK_KEY);
    return v ? JSON.parse(v) : DEFAULT_PLAYBOOK;
  } catch {
    return DEFAULT_PLAYBOOK;
  }
}
function savePlaybook(p: Record<string, { strategy: string; timeframe: Timeframe }>): void {
  try {
    localStorage.setItem(PLAYBOOK_KEY, JSON.stringify(p));
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
  mvsLambda: 3,
  mvsGamma: 3,
  mvsMaxWeight: 0.2,

  theme: initialTheme(),
  tab: "backtest",
  tzMinutes: initialTz(),
  signalOverrides: initialOverrides(),
  signalModels: initialSignalModels(),
  signalTimeframes: initialSignalTimeframes(),
  fitOverrides: initialFitOverrides(),
  playbook: initialPlaybook(),

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
  setSignalModels: (ids) =>
    set(() => {
      try {
        localStorage.setItem(MODELS_KEY, JSON.stringify(ids));
      } catch {
        /* localStorage unavailable */
      }
      return { signalModels: ids };
    }),
  setSignalTimeframe: (modelId, tf) =>
    set((s) => {
      const next = { ...s.signalTimeframes, [modelId]: tf };
      try {
        localStorage.setItem(SIGTF_KEY, JSON.stringify(next));
      } catch {
        /* localStorage unavailable */
      }
      return { signalTimeframes: next };
    }),
  setFitOverride: (modelId, paramId, value) =>
    set((s) => {
      const next = {
        ...s.fitOverrides,
        [modelId]: { ...(s.fitOverrides[modelId] || {}), [paramId]: value },
      };
      try {
        localStorage.setItem(FITOVR_KEY, JSON.stringify(next));
      } catch {
        /* localStorage unavailable */
      }
      return { fitOverrides: next };
    }),
  resetFitOverrides: () =>
    set(() => {
      try {
        localStorage.setItem(FITOVR_KEY, "{}");
      } catch {
        /* localStorage unavailable */
      }
      return { fitOverrides: {} };
    }),
  setPlaybookRow: (pair, patch) =>
    set((s) => {
      const cur = s.playbook[pair] ?? { strategy: "meanrev", timeframe: "1d" as Timeframe };
      // Changing strategy clears that pair's params (they belonged to the old model).
      const cleared = patch.strategy && patch.strategy !== cur.strategy ? { params: {} } : {};
      const next = { ...s.playbook, [pair]: { ...cur, ...patch, ...cleared } };
      savePlaybook(next);
      return { playbook: next };
    }),
  setPlaybookParam: (pair, paramId, value) =>
    set((s) => {
      const cur = s.playbook[pair] ?? { strategy: "meanrev", timeframe: "1d" as Timeframe };
      const next = {
        ...s.playbook,
        [pair]: { ...cur, params: { ...(cur.params || {}), [paramId]: value } },
      };
      savePlaybook(next);
      return { playbook: next };
    }),
  addPlaybookRow: (pair) =>
    set((s) => {
      const p = pair.trim().toUpperCase();
      if (!p || s.playbook[p]) return {};
      const next = { ...s.playbook, [p]: { strategy: "meanrev", timeframe: "1d" as Timeframe } };
      savePlaybook(next);
      return { playbook: next };
    }),
  removePlaybookRow: (pair) =>
    set((s) => {
      const next = { ...s.playbook };
      delete next[pair];
      savePlaybook(next);
      return { playbook: next };
    }),
  setActiveRunId: (id) => set(() => ({ activeRunId: id })),
  setActiveSweepId: (id) => set(() => ({ activeSweepId: id })),
}));
