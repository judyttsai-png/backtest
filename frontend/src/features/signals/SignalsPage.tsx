import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { getStrategies, postSignals } from "../../api/endpoints";
import type { ModelSignal, PairSignals } from "../../types/api";
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

/** Live recommendation view: each pair's current call, the models backing it,
 *  the index value behind each vote, and a collapsible editor for every model
 *  variable. */
export function SignalsPage() {
  const symbols = useUiStore((s) => s.symbols);
  const timeframe = useUiStore((s) => s.timeframe);
  const tzMinutes = useUiStore((s) => s.tzMinutes);
  const symbolList = symbols
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

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
    queryKey: ["signals", symbols, timeframe, JSON.stringify(overrides), strategies.length],
    queryFn: () => postSignals({ symbols: symbolList, timeframe, models }),
    enabled: symbolList.length > 0,
    refetchOnWindowFocus: false,
  });

  return (
    <>
      <div className="panel">
        <div className="phead">
          <span className="ptitle">Live recommendations</span>
          <span className="psub">
            {q.data
              ? `${q.data.pairs.length} pairs · ${timeframe} · as of ${fmtInstant(q.data.asof, tzMinutes)} ${tzLabel(tzMinutes)}`
              : "computing…"}
          </span>
          <span style={{ marginLeft: "auto" }}>
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
