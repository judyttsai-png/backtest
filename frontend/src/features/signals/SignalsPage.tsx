import { useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { postSignals } from "../../api/endpoints";
import type { PairSignals } from "../../types/api";

const label = (d: number) => (d > 0 ? "LONG" : d < 0 ? "SHORT" : "NEUTRAL");
const cls = (d: number) => (d > 0 ? "sig-long" : d < 0 ? "sig-short" : "sig-flat");
const arrow = (d: number) => (d > 0 ? "▲" : d < 0 ? "▼" : "·");

/** Live recommendation view: each pair's current directional call and the
 *  models backing it (consensus), computed on the latest bar of each model. */
export function SignalsPage() {
  const symbols = useUiStore((s) => s.symbols);
  const timeframe = useUiStore((s) => s.timeframe);
  const symbolList = symbols
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

  const q = useQuery({
    queryKey: ["signals", symbols, timeframe],
    queryFn: () => postSignals({ symbols: symbolList, timeframe }),
    enabled: symbolList.length > 0,
    refetchOnWindowFocus: false,
  });

  return (
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

      <div className="hint" style={{ marginBottom: 14 }}>
        Direction each model recommends right now, per pair — sorted by agreement. Signals are only
        as trustworthy as the models; validate out-of-sample before trading.
      </div>

      {q.isError && <div className="banner err">signals error — {(q.error as Error).message}</div>}
      {q.isLoading && <div className="banner">computing signals across all models…</div>}

      <div className="sigrid">
        {q.data?.pairs.map((p) => (
          <PairCard key={p.symbol} p={p} />
        ))}
      </div>
    </div>
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
            title={`${s.name}: ${label(s.direction)}`}
          >
            {arrow(s.direction)} {s.model}
          </span>
        ))}
      </div>
    </div>
  );
}
