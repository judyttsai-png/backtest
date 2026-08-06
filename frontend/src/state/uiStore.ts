import { create } from "zustand";
import type { ExecutionMode, StrategyMeta, Timeframe } from "../types/api";

export type Theme = "dark" | "light";
export type Tab = "backtest" | "signals" | "fit" | "playbook";

// The Playbook is grouped by currency: each currency holds the set of strategies
// you want to see for it, and each of those carries its own bar + constants.
//   playbook = { AUDUSD: { meanrev: {timeframe, params}, sma: {timeframe, params} }, … }
export interface PlaybookStrat {
  timeframe: Timeframe;
  params?: Record<string, number>;
}
export type PlaybookPair = Record<string, PlaybookStrat>; // strategyId -> config
export type Playbook = Record<string, PlaybookPair>; // pair -> strategies

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
  // The Playbook, grouped by currency (each currency -> selected strategies with
  // their own bar + constants). Persisted.
  playbook: Playbook;

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
  addPlaybookPair: (pair: string) => void;
  removePlaybookPair: (pair: string) => void;
  togglePlaybookStrategy: (pair: string, strategyId: string) => void;
  setPlaybookStrategyTf: (pair: string, strategyId: string, tf: Timeframe) => void;
  setPlaybookStrategyParam: (pair: string, strategyId: string, paramId: string, value: number) => void;
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

// Global, saved model constants (per strategy). Shared by the Backtest tab, the
// Fit matrix, the Playbook and live Signals — one place, persisted across reloads.
const FITOVR_KEY = "backtest-fit-overrides";
function initialFitOverrides(): Record<string, Record<string, number>> {
  try {
    return JSON.parse(localStorage.getItem(FITOVR_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveFitOverrides(o: Record<string, Record<string, number>>): void {
  try {
    localStorage.setItem(FITOVR_KEY, JSON.stringify(o));
  } catch {
    /* localStorage unavailable */
  }
}

// Seeded from the strategy-fit matrix (daily OOS best per pair). Users edit it.
const SEED: [string, string][] = [
  ["AUDUSD", "meanrev"], ["EURAUD", "meanrev"], ["EURUSD", "meanrev"], ["GBPUSD", "meanrev"],
  ["EURGBP", "meanrev"], ["EURCHF", "meanrev"], ["CADJPY", "meanrev"], ["USDCHF", "meanrev"],
  ["USDCAD", "sma"], ["NZDUSD", "sma"], ["GBPJPY", "sma"], ["AUDJPY", "sma"],
  ["CHFJPY", "sma"], ["NZDJPY", "sma"], ["USDJPY", "dmi"], ["EURJPY", "dmi"],
];
function seededPlaybook(): Playbook {
  const pb: Playbook = {};
  for (const [pair, strategy] of SEED) pb[pair] = { [strategy]: { timeframe: "1d" } };
  return pb;
}

const PLAYBOOK_KEY = "backtest-playbook";
function initialPlaybook(): Playbook {
  try {
    const raw = localStorage.getItem(PLAYBOOK_KEY);
    if (!raw) return seededPlaybook();
    const parsed = JSON.parse(raw);
    const pb: Playbook = {};
    const add = (pair: string, sid: string, cfg: PlaybookStrat) => {
      if (sid === "smacross") { sid = "meanrev"; cfg = { ...cfg, params: {} }; }
      (pb[pair] ||= {})[sid] = { timeframe: cfg.timeframe || "1d", params: cfg.params };
    };
    if (Array.isArray(parsed)) {
      // old list-of-rows format
      for (const r of parsed) add(r.pair, r.strategy, { timeframe: r.timeframe, params: r.params });
    } else if (parsed && typeof parsed === "object") {
      for (const [pair, val] of Object.entries<any>(parsed)) {
        if (val && typeof val.strategy === "string") {
          add(pair, val.strategy, { timeframe: val.timeframe, params: val.params }); // old pair->{strategy,…}
        } else if (val && typeof val === "object") {
          for (const [sid, cfg] of Object.entries<any>(val)) add(pair, sid, cfg); // new nested
        }
      }
    }
    return Object.keys(pb).length ? pb : seededPlaybook();
  } catch {
    return seededPlaybook();
  }
}
function savePlaybook(p: Playbook): void {
  try {
    localStorage.setItem(PLAYBOOK_KEY, JSON.stringify(p));
  } catch {
    /* localStorage unavailable */
  }
}

export const useUiStore = create<UiState>((set) => ({
  strategyId: "sma",
  // Seed the default strategy's params from the saved global constants.
  params: { fast: 10, slow: 40, ...initialFitOverrides()["sma"] },
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
    set((s) => {
      // Load this strategy's saved constants (falling back to its defaults).
      const params: Record<string, number> = {};
      for (const p of meta.parameters) params[p.id] = s.fitOverrides[meta.id]?.[p.id] ?? p.default;
      return { strategyId: meta.id, params };
    }),
  // Editing a Backtest-tab constant saves it to the global store, so it persists
  // across reloads and stays in sync with the Fit / Playbook / Signals tabs.
  setParam: (id, value) =>
    set((s) => {
      const next = {
        ...s.fitOverrides,
        [s.strategyId]: { ...(s.fitOverrides[s.strategyId] || {}), [id]: value },
      };
      saveFitOverrides(next);
      return { params: { ...s.params, [id]: value }, fitOverrides: next };
    }),
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
      saveFitOverrides(next);
      // keep the Backtest tab's live params in sync when editing the same model
      const params = s.strategyId === modelId ? { ...s.params, [paramId]: value } : s.params;
      return { fitOverrides: next, params };
    }),
  resetFitOverrides: () =>
    set(() => {
      saveFitOverrides({});
      return { fitOverrides: {} };
    }),
  addPlaybookPair: (pair) =>
    set((s) => {
      const p = pair.trim().toUpperCase();
      if (!p || s.playbook[p]) return {};
      const next = { ...s.playbook, [p]: { meanrev: { timeframe: "1d" as Timeframe } } };
      savePlaybook(next);
      return { playbook: next };
    }),
  removePlaybookPair: (pair) =>
    set((s) => {
      const next = { ...s.playbook };
      delete next[pair];
      savePlaybook(next);
      return { playbook: next };
    }),
  togglePlaybookStrategy: (pair, strategyId) =>
    set((s) => {
      const cur: PlaybookPair = { ...(s.playbook[pair] || {}) };
      if (cur[strategyId]) {
        delete cur[strategyId];
      } else {
        cur[strategyId] = { timeframe: "1d" };
      }
      const next = { ...s.playbook, [pair]: cur };
      savePlaybook(next);
      return { playbook: next };
    }),
  setPlaybookStrategyTf: (pair, strategyId, tf) =>
    set((s) => {
      const cur = s.playbook[pair]?.[strategyId];
      if (!cur) return {};
      const next = { ...s.playbook, [pair]: { ...s.playbook[pair], [strategyId]: { ...cur, timeframe: tf } } };
      savePlaybook(next);
      return { playbook: next };
    }),
  setPlaybookStrategyParam: (pair, strategyId, paramId, value) =>
    set((s) => {
      const cur = s.playbook[pair]?.[strategyId];
      if (!cur) return {};
      const upd = { ...cur, params: { ...(cur.params || {}), [paramId]: value } };
      const next = { ...s.playbook, [pair]: { ...s.playbook[pair], [strategyId]: upd } };
      savePlaybook(next);
      return { playbook: next };
    }),
  setActiveRunId: (id) => set(() => ({ activeRunId: id })),
  setActiveSweepId: (id) => set(() => ({ activeSweepId: id })),
}));
