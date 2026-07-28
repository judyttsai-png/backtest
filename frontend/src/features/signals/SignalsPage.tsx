import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { postSignals } from "../../api/endpoints";
import type { ModelSignal, PairSignals } from "../../types/api";
import { PositionsPanel } from "./PositionsPanel";

const label = (d: number) => (d > 0 ? "LONG" : d < 0 ? "SHORT" : "NEUTRAL");
const cls = (d: number) => (d > 0 ? "sig-long" : d < 0 ? "sig-short" : "sig-flat");
const arrow = (d: number) => (d > 0 ? "▲" : d < 0 ? "▼" : "·");

const fmtVal = (s: ModelSignal): string => {
  if (s.value == null) return "";
  if (s.unit.includes("%")) return `${s.value > 0 ? "+" : ""}${s.value}%`;
  return `${s.value}`;
};

/** Live recommendation view: each pair's current call, the models backing it,
 *  the index value behind each vote, and editable barriers you can tune. */
export function SignalsPage() {
  const symbols = useUiStore((s) => s.symbols);
  const timeframe = useUiStore((s) => s.timeframe);
  const symbolList = symbols
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

  // Editable barriers (defaults match each model's default param).
  const [dmiFloor, setDmiFloor] = useState(20);
  const [rocThr, setRocThr] = useState(1);
  const [velaccVthr, setVelaccVthr] = useState(2);
  const [velcrossVthr, setVelcrossVthr] = useState(5);

  const models = [
    { id: "sma" },
    { id: "roc", parameters: { thr: rocThr } },
    { id: "velacc", parameters: { vthr: velaccVthr } },
    { id: "dmi", parameters: { adx_floor: dmiFloor } },
    { id: "velcross", parameters: { vthr: velcrossVthr } },
  ];

  const q = useQuery({
    queryKey: ["signals", symbols, timeframe, dmiFloor, rocThr, velaccVthr, velcrossVthr],
    queryFn: () => postSignals({ symbols: symbolList, timeframe, models }),
    enabled: symbolList.length > 0,
    refetchOnWindowFocus: false,
  });

  const num = (v: string, fallback: number) => (v === "" ? fallback : Number(v));

  return (
    <>
      <div className="panel">
        <div className="phead">
          <span className="ptitle">Live recommendations</span>
          <span className="psub">
            {q.data
              ? `${q.data.pairs.length} pairs · ${timeframe} · as of ${q.data.asof.slice(0, 16).replace("T", " ")} UTC`
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

        {/* editable barriers — change a value and the recommendations recompute */}
        <div className="thresholds">
          <span className="thlabel">barriers</span>
          <label>
            DMI ADX floor
            <input type="number" value={dmiFloor} onChange={(e) => setDmiFloor(num(e.target.value, 20))} />
          </label>
          <label>
            ROC thr %
            <input type="number" step="0.5" value={rocThr} onChange={(e) => setRocThr(num(e.target.value, 1))} />
          </label>
          <label>
            velacc vthr
            <input type="number" value={velaccVthr} onChange={(e) => setVelaccVthr(num(e.target.value, 2))} />
          </label>
          <label>
            velcross vthr
            <input type="number" value={velcrossVthr} onChange={(e) => setVelcrossVthr(num(e.target.value, 5))} />
          </label>
        </div>

        <div className="hint" style={{ marginBottom: 14 }}>
          Direction each model recommends now, with the index value behind it. Raise/lower a barrier
          to change what counts as a signal. Validate out-of-sample before trading.
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
