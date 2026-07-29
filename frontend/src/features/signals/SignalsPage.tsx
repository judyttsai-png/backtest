import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { getStrategies, postSignals } from "../../api/endpoints";
import type { ModelSignal, PairSignals, Timeframe } from "../../types/api";
import { PositionsPanel } from "./PositionsPanel";
import { ModelSettings } from "./ModelSettings";
import { fmtInstant, tzLabel } from "../../lib/time";

const label = (d: number) => (d > 0 ? "LONG" : d < 0 ? "SHORT" : "NEUTRAL");
const cls = (d: number) => (d > 0 ? "sig-long" : d < 0 ? "sig-short" : "sig-flat");
const arrow = (d: number) => (d > 0 ? "▲" : d < 0 ? "▼" : "·");

const fmtVal = (s: ModelSignal): string => {
  if (s.value == null) return "";
  if (s.unit.includes("%")) return `${s.value > 0 ? "+" : ""}${s.value}%`;
  return `${s.value}`;
};

const BAR_SIZES: Timeframe[] = ["15m", "30m", "1h", "1d"];
// auto-refresh cadence per bar size (ms): match the bar for intraday, hourly for daily.
const REFRESH_MS: Record<string, number> = {
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "1d": 60 * 60_000,
};

/** Live recommendation view: each pair's current call, the models backing it,
 *  the index value behind each vote, and a collapsible editor for every model
 *  variable. */
export function SignalsPage() {
  const symbols = useUiStore((s) => s.symbols);
  const storeTf = useUiStore((s) => s.timeframe);
  const tzMinutes = useUiStore((s) => s.tzMinutes);
  const symbolList = symbols
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

  // Signals-page bar size (independent of the backtest tab) + auto-refresh.
  const [barSize, setBarSize] = useState<Timeframe>(
    BAR_SIZES.includes(storeTf) ? storeTf : "1d",
  );
  const [autoRefresh, setAutoRefresh] = useState(false);

  const strategiesQ = useQuery({ queryKey: ["strategies"], queryFn: getStrategies });
  const strategies = strategiesQ.data ?? [];

  // Per-model parameter overrides (empty = use each model's defaults).
  const [overrides, setOverrides] = useState<Record<string, Record<string, number>>>({});
  const setOverride = (modelId: string, paramId: string, value: number) =>
    setOverrides((o) => ({ ...o, [modelId]: { ...(o[modelId] || {}), [paramId]: value } }));

  const models =
    strategies.length > 0
      ? strategies.map((m) => ({ id: m.id, parameters: overrides[m.id] || {} }))
      : undefined;

  const q = useQuery({
    queryKey: ["signals", symbols, barSize, JSON.stringify(overrides), strategies.length],
    queryFn: () => postSignals({ symbols: symbolList, timeframe: barSize, models }),
    enabled: symbolList.length > 0,
    refetchOnWindowFocus: false,
    refetchInterval: autoRefresh ? REFRESH_MS[barSize] : false,
  });

  return (
    <>
      <div className="panel">
        <div className="phead">
          <span className="ptitle">Live recommendations</span>
          <span className="psub">
            {q.data
              ? `${q.data.pairs.length} pairs · as of ${fmtInstant(q.data.asof, tzMinutes)} ${tzLabel(tzMinutes)}`
              : "computing…"}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
            <label className="sigctl">
              bar
              <select value={barSize} onChange={(e) => setBarSize(e.target.value as Timeframe)}>
                {BAR_SIZES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="sigctl" title={`refetch every ${REFRESH_MS[barSize] / 60000} min`}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              auto{autoRefresh ? ` · ${REFRESH_MS[barSize] / 60000}m` : ""}
            </label>
            <button
              className="run secondary"
              style={{ width: "auto", padding: "9px 16px", margin: 0 }}
              onClick={() => q.refetch()}
              disabled={q.isFetching}
            >
              {q.isFetching ? "REFRESHING…" : "↻ REFRESH"}
            </button>
          </span>
        </div>

        <ModelSettings
          strategies={strategies}
          overrides={overrides}
          onChange={setOverride}
          onReset={() => setOverrides({})}
        />

        <div className="hint" style={{ marginBottom: 14 }}>
          Direction each model recommends now, with the index value behind it. Open “model settings”
          to tune any variable. Validate out-of-sample before trading.
        </div>

        {q.isError && <div className="banner err">signals error — {(q.error as Error).message}</div>}
        {q.isLoading && <div className="banner">computing signals across all models…</div>}

        <div className="sigrid">
          {q.data?.pairs.map((p) => (
            <PairCard key={p.symbol} p={p} />
          ))}
        </div>
      </div>
      <PositionsPanel signals={q.data} />
    </>
  );
}

function PairCard({ p }: { p: PairSignals }) {
  const c = p.consensus;
  return (
    <div className={`sigcard ${cls(c.direction)}`}>
      <div className="sigcard-head">
        <span className="sigpair">{p.symbol}</span>
        <span className={`sigdir ${cls(c.direction)}`}>{label(c.direction)}</span>
      </div>
      <div className="sigtally">
        {c.agree} of {p.signals.length} models · {c.long}▲ {c.short}▼ {c.flat}·
      </div>
      <div className="sigbadges">
        {p.signals.map((s) => (
          <span
            key={s.model}
            className={`sigbadge ${cls(s.direction)}`}
            title={
              s.value != null
                ? `${s.name}: ${label(s.direction)} · ${s.value}${s.unit ? " " + s.unit : ""}` +
                  (s.threshold != null ? ` vs barrier ${s.threshold}` : "")
                : `${s.name}: ${label(s.direction)}`
            }
          >
            {arrow(s.direction)} {s.model}
            {s.value != null && <span className="sigval"> {fmtVal(s)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
