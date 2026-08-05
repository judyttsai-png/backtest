import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { postPlaybookSignals } from "../../api/endpoints";
import type { PlaybookSignalPair, SignalsResponse } from "../../types/api";
import { PositionsPanel } from "./PositionsPanel";
import { fmtInstant, tzLabel } from "../../lib/time";

const label = (d: number) => (d > 0 ? "LONG" : d < 0 ? "SHORT" : "NEUTRAL");
const cls = (d: number) => (d > 0 ? "sig-long" : d < 0 ? "sig-short" : "sig-flat");
const REFRESH_MS = 30 * 60_000;

const fmtReading = (p: PlaybookSignalPair): string => {
  if (p.value == null) return "";
  const v = p.unit.includes("%") ? `${p.value > 0 ? "+" : ""}${p.value}%` : `${p.value}`;
  return p.threshold != null ? `${v} vs ${p.threshold}` : v;
};

/** Live recommendations, fully driven by the Playbook: each pair is evaluated
 *  with its own assigned strategy + bar + constants, and shown with an ATR-based
 *  stop and target. Edit the assignments on the Playbook tab. */
export function SignalsPage() {
  const playbook = useUiStore((s) => s.playbook);
  const tzMinutes = useUiStore((s) => s.tzMinutes);
  const setTab = useUiStore((s) => s.set);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const items = Object.entries(playbook).map(([pair, r]) => ({
    pair,
    strategy: r.strategy,
    timeframe: r.timeframe,
    params: r.params || {},
  }));

  const q = useQuery({
    queryKey: ["playbook-signals", JSON.stringify(playbook)],
    queryFn: () => postPlaybookSignals({ items }),
    enabled: items.length > 0,
    refetchOnWindowFocus: false,
    refetchInterval: autoRefresh ? REFRESH_MS : false,
  });

  // Adapt to the shape PositionsPanel expects (one assigned model per pair).
  const asPositionsSignals: SignalsResponse | undefined = q.data && {
    asof: q.data.asof,
    timeframe: "1d",
    models: [],
    pairs: q.data.pairs.map((p) => ({
      symbol: p.symbol,
      price: p.price,
      consensus: {
        direction: p.direction,
        long: p.direction > 0 ? 1 : 0,
        short: p.direction < 0 ? 1 : 0,
        flat: p.direction === 0 ? 1 : 0,
        agree: 1,
      },
      signals: [
        { model: p.strategy, name: p.name, direction: p.direction, strength: p.strength,
          value: p.value, unit: p.unit, threshold: p.threshold },
      ],
    })),
  };

  return (
    <>
      <div className="panel">
        <div className="phead">
          <span className="ptitle">Live recommendations · Playbook-driven</span>
          <span className="psub">
            {q.data
              ? `${q.data.pairs.length} pairs · each on its assigned strategy · as of ${fmtInstant(q.data.asof, tzMinutes)} ${tzLabel(tzMinutes)}`
              : "assign strategies on the Playbook tab"}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
            <button className="run secondary" style={{ width: "auto", padding: "9px 14px", margin: 0 }}
              onClick={() => setTab("tab", "playbook")}>
              ✎ edit playbook
            </button>
            <label className="sigctl" title="auto-refresh every 30 min">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              auto
            </label>
            <button className="run secondary" style={{ width: "auto", padding: "9px 16px", margin: 0 }}
              onClick={() => q.refetch()} disabled={q.isFetching}>
              {q.isFetching ? "REFRESHING…" : "↻ REFRESH"}
            </button>
          </span>
        </div>

        <div className="hint" style={{ marginBottom: 14 }}>
          One call per currency, using the strategy, bar and constants you assigned on the Playbook
          tab. Stop and target are sized to each pair's recent volatility (ATR). Validate
          out-of-sample before trading.
        </div>

        {q.isError && <div className="banner err">signals error — {(q.error as Error).message}</div>}
        {q.isLoading && <div className="banner">computing each pair's assigned strategy…</div>}
        {items.length === 0 && !q.isLoading && (
          <div className="banner">No pairs in the Playbook — add some on the Playbook tab.</div>
        )}

        <div className="sigrid">
          {q.data?.pairs.map((p) => <PairCard key={p.symbol} p={p} />)}
        </div>
      </div>
      <PositionsPanel signals={asPositionsSignals} />
    </>
  );
}

function PairCard({ p }: { p: PlaybookSignalPair }) {
  const dir = p.direction;
  const px = p.price;
  // Stop below / target above for a long; inverted for a short.
  const stopPx = px != null && p.stop_pct != null && dir !== 0
    ? px * (1 - (dir > 0 ? 1 : -1) * (p.stop_pct / 100)) : null;
  const targetPx = px != null && p.target_pct != null && dir !== 0
    ? px * (1 + (dir > 0 ? 1 : -1) * (p.target_pct / 100)) : null;
  const fx = (v: number | null) => (v == null ? "—" : v.toPrecision(6).replace(/\.?0+$/, ""));

  return (
    <div className={`sigcard ${cls(dir)}`}>
      <div className="sigcard-head">
        <span className="sigpair">{p.symbol}</span>
        <span className={`sigdir ${cls(dir)}`}>{label(dir)}</span>
      </div>
      <div className="sigtally">
        {p.name} · {p.timeframe}
        {p.value != null && <span className="sigval"> · {fmtReading(p)}</span>}
      </div>
      <div className="sigtargets">
        <div className="tgt"><span className="tl">price</span><span className="tv">{fx(px)}</span></div>
        {dir !== 0 ? (
          <>
            <div className="tgt"><span className="tl">stop</span>
              <span className="tv neg">{fx(stopPx)}{p.stop_pct != null && <em> −{p.stop_pct}%</em>}</span></div>
            <div className="tgt"><span className="tl">target</span>
              <span className="tv pos">{fx(targetPx)}{p.target_pct != null && <em> +{p.target_pct}%</em>}</span></div>
          </>
        ) : (
          <div className="tgt"><span className="tl">stop/target</span><span className="tv">— (flat)</span></div>
        )}
      </div>
    </div>
  );
}
