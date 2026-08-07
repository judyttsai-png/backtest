import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { postPlaybookSignals, postBasket } from "../../api/endpoints";
import type { BasketResponse, PlaybookSignalPair, SignalsResponse } from "../../types/api";
import { PositionsPanel } from "./PositionsPanel";
import { fmtInstant, tzLabel } from "../../lib/time";

// Liquid majors + crosses velcross ranks across (EM excluded — breaks cross-section).
const BASKET_UNIVERSE = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "EURGBP",
  "EURJPY", "GBPJPY", "EURCHF", "AUDJPY", "EURAUD", "CADJPY", "CHFJPY", "NZDJPY",
];

const label = (d: number) => (d > 0 ? "LONG" : d < 0 ? "SHORT" : "NEUTRAL");
const cls = (d: number) => (d > 0 ? "sig-long" : d < 0 ? "sig-short" : "sig-flat");
const arrow = (d: number) => (d > 0 ? "▲" : d < 0 ? "▼" : "·");
const REFRESH_MS = 30 * 60_000;

const fmtReading = (p: PlaybookSignalPair): string => {
  if (p.value == null) return "";
  const v = p.unit.includes("%") ? `${p.value > 0 ? "+" : ""}${p.value}%` : `${p.value} ${p.unit}`;
  return p.threshold != null ? `${v} vs ${p.threshold}` : v;
};
const fx = (v: number | null) => (v == null ? "—" : v.toPrecision(6).replace(/\.?0+$/, ""));
const EMPTY_PARAMS: Record<string, number> = {}; // stable ref for zustand selectors
const saveStr = (key: string, v: string) => {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
};

// Stop / target width as multiples of the pair's DAILY ATR.
type RiskLevel = "low" | "medium" | "high";
const RISK: Record<RiskLevel, { stop: number; target: number; note: string }> = {
  low: { stop: 1.5, target: 2.0, note: "tight stop · smallest loss per trade, more stop-outs" },
  medium: { stop: 2.5, target: 3.5, note: "balanced room vs risk" },
  high: { stop: 4.0, target: 6.0, note: "wide stop · rides noise, larger loss if wrong" },
};

/** Live recommendations, driven by the Playbook and grouped by currency: one card
 *  per currency shows each strategy you selected for it, with an ATR stop/target. */
export function SignalsPage() {
  const playbook = useUiStore((s) => s.playbook);
  const globalParams = useUiStore((s) => s.fitOverrides);
  const tzMinutes = useUiStore((s) => s.tzMinutes);
  const setTab = useUiStore((s) => s.set);
  const [autoRefresh, setAutoRefresh] = useState(false);
  // Risk profile sets stop/target width (× daily ATR). Saved across reloads.
  const [risk, setRisk] = useState<RiskLevel>(() => {
    const v = localStorage.getItem("backtest-risk");
    return v === "low" || v === "medium" || v === "high" ? v : "medium";
  });
  const { stop: stopMult, target: targetMult } = RISK[risk];
  const chooseRisk = (r: RiskLevel) => { setRisk(r); saveStr("backtest-risk", r); };

  const items = Object.entries(playbook).flatMap(([pair, strats]) =>
    Object.entries(strats).map(([sid, cfg]) => ({
      pair, strategy: sid, timeframe: cfg.timeframe,
      params: { ...(globalParams[sid] || {}), ...(cfg.params || {}) },
    })),
  );

  const q = useQuery({
    queryKey: ["playbook-signals", JSON.stringify(playbook), JSON.stringify(globalParams), stopMult, targetMult],
    queryFn: () => postPlaybookSignals({ items, stop_mult: stopMult, target_mult: targetMult }),
    enabled: items.length > 0,
    refetchOnWindowFocus: false,
    refetchInterval: autoRefresh ? REFRESH_MS : false,
  });

  // Group the flat per-strategy results into one card per currency.
  const byPair = new Map<string, PlaybookSignalPair[]>();
  for (const p of q.data?.pairs ?? []) {
    if (!byPair.has(p.symbol)) byPair.set(p.symbol, []);
    byPair.get(p.symbol)!.push(p);
  }
  // Conviction = the strategy's own bet size (|target|, 0–1). Sum the active ones
  // so we can suggest a % of book proportional to how strong each signal is.
  const totalConv =
    (q.data?.pairs ?? []).reduce((a, r) => a + (r.direction !== 0 ? r.conviction : 0), 0) || 1;

  const cards = [...byPair.entries()].map(([symbol, rows]) => {
    const net = rows.reduce((a, r) => a + Math.sign(r.direction), 0);
    const conv = Math.max(...rows.map((r) => (r.direction !== 0 ? r.conviction : 0)), 0);
    return { symbol, price: rows[0]?.price ?? null, rows, consensus: Math.sign(net), conv, totalConv };
  });
  // Strongest-conviction currencies first, so the best bets are at the top.
  cards.sort((a, b) => b.conv - a.conv);

  // Adapt to PositionsPanel (one row per symbol; consensus of its strategies).
  const asPositionsSignals: SignalsResponse | undefined = q.data && {
    asof: q.data.asof, timeframe: "1d", models: [],
    pairs: cards.map((c) => ({
      symbol: c.symbol, price: c.price,
      consensus: { direction: c.consensus, long: 0, short: 0, flat: 0, agree: 1 },
      signals: c.rows.map((r) => ({
        model: r.strategy, name: r.name, direction: r.direction, strength: r.strength,
        value: r.value, unit: r.unit, threshold: r.threshold,
      })),
    })),
  };

  return (
    <>
      <div className="panel">
        <div className="phead">
          <span className="ptitle">Live recommendations · by currency</span>
          <span className="psub">
            {q.data
              ? `${cards.length} currencies · as of ${fmtInstant(q.data.asof, tzMinutes)} ${tzLabel(tzMinutes)}`
              : "pick strategies per currency on the Playbook tab"}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
            <span className="sigctl" title={`stop ${stopMult}× / target ${targetMult}× daily ATR — ${RISK[risk].note}`}>
              risk
              <span className="seg" style={{ maxWidth: 210 }}>
                {(["low", "medium", "high"] as RiskLevel[]).map((r) => (
                  <button key={r} className={risk === r ? "on" : ""} onClick={() => chooseRisk(r)}>
                    {r === "low" ? "Low" : r === "medium" ? "Med" : "High"}
                  </button>
                ))}
              </span>
            </span>
            <button className="run secondary" style={{ width: "auto", padding: "9px 14px", margin: 0 }}
              onClick={() => setTab("tab", "playbook")}>✎ edit playbook</button>
            <label className="sigctl" title="auto-refresh every 30 min">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> auto
            </label>
            <button className="run secondary" style={{ width: "auto", padding: "9px 16px", margin: 0 }}
              onClick={() => q.refetch()} disabled={q.isFetching}>
              {q.isFetching ? "REFRESHING…" : "↻ REFRESH"}
            </button>
          </span>
        </div>

        <div className="hint" style={{ marginBottom: 14 }}>
          Sorted <b>strongest signal first</b>. Each shows a <b>conviction</b> bar (how far past its
          trigger — bigger = stronger) and a suggested <b>% of book</b> (share proportional to
          conviction). Put more into the high-conviction calls, less into the weak ones. Stops use the
          pair's <b>daily</b> ATR; the <b>risk</b> toggle sets width (Low {RISK.low.stop}× / Med{" "}
          {RISK.medium.stop}× / High {RISK.high.stop}×). Validate out-of-sample before trading.
        </div>

        {q.isError && <div className="banner err">signals error — {(q.error as Error).message}</div>}
        {q.isLoading && <div className="banner">computing each currency's strategies…</div>}
        {items.length === 0 && !q.isLoading && (
          <div className="banner">No currencies in the Playbook — add some on the Playbook tab.</div>
        )}

        <div className="sigrid">
          {cards.map((c) => <CurrencyCard key={c.symbol} {...c} />)}
        </div>
      </div>
      <BasketPanel />
      <PositionsPanel signals={asPositionsSignals} />
    </>
  );
}

/** Velocity Crossover is cross-sectional (ranks the whole basket), so it gets its
 *  own panel: the pairs it currently favors long vs short. */
function BasketPanel() {
  const velParams = useUiStore((s) => s.fitOverrides.velcross) ?? EMPTY_PARAMS;
  const tzMinutes = useUiStore((s) => s.tzMinutes);
  const q = useQuery({
    queryKey: ["basket", JSON.stringify(velParams)],
    queryFn: () => postBasket({ symbols: BASKET_UNIVERSE, timeframe: "1d", params: velParams }),
    refetchOnWindowFocus: false,
  });
  const d: BasketResponse | undefined = q.data;
  const longs = (d?.rows ?? []).filter((r) => r.direction > 0);
  const shorts = (d?.rows ?? []).filter((r) => r.direction < 0).reverse();
  return (
    <section className="panel" style={{ marginTop: 18 }}>
      <div className="phead">
        <span className="ptitle">Velocity Crossover · basket ranking</span>
        <span className="psub">
          {d ? `${d.long_count} long · ${d.short_count} short · as of ${fmtInstant(d.asof, tzMinutes)}`
            : q.isFetching ? "ranking the basket…" : "cross-sectional — ranks all pairs together"}
        </span>
        <button className="run secondary" style={{ marginLeft: "auto", width: "auto", padding: "9px 16px" }}
          onClick={() => q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? "…" : "↻"}
        </button>
      </div>
      <div className="hint" style={{ marginBottom: 10 }}>
        Velcross doesn't make a per-currency call — it ranks the whole basket and holds the strongest
        long / weakest short. Tune its constants (incl. momentum vs reversion) in the Playbook tab's
        global editor. Sizes are its target weights.
      </div>
      {q.isError && <div className="banner err">basket error — {(q.error as Error).message}</div>}
      <div className="basketcols">
        <div>
          <div className="basket-head sig-long">LONG</div>
          {longs.length === 0 && <div className="hint">none</div>}
          {longs.map((r) => (
            <div className="basket-row" key={r.symbol}>
              <span className="bpair">{r.symbol}</span>
              <span className="bbar"><span className="bfill long" style={{ width: `${Math.min(100, Math.abs(r.weight) * 300)}%` }} /></span>
              <span className="bw">{(r.weight * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
        <div>
          <div className="basket-head sig-short">SHORT</div>
          {shorts.length === 0 && <div className="hint">none</div>}
          {shorts.map((r) => (
            <div className="basket-row" key={r.symbol}>
              <span className="bpair">{r.symbol}</span>
              <span className="bbar"><span className="bfill short" style={{ width: `${Math.min(100, Math.abs(r.weight) * 300)}%` }} /></span>
              <span className="bw">{(r.weight * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CurrencyCard({ symbol, price, rows, consensus, totalConv }:
  { symbol: string; price: number | null; rows: PlaybookSignalPair[]; consensus: number;
    conv: number; totalConv: number }) {
  return (
    <div className={`sigcard ${cls(consensus)}`}>
      <div className="sigcard-head">
        <span className="sigpair">{symbol}</span>
        <span className={`sigdir ${cls(consensus)}`}>{consensus === 0 ? "MIXED" : label(consensus)}</span>
      </div>
      <div className="sigtally">price {fx(price)}</div>
      <div className="pbsig-list">
        {rows.map((r) => {
          const dir = r.direction;
          const stopPx = price != null && r.stop_pct != null && dir !== 0
            ? price * (1 - (dir > 0 ? 1 : -1) * (r.stop_pct / 100)) : null;
          const targetPx = price != null && r.target_pct != null && dir !== 0
            ? price * (1 + (dir > 0 ? 1 : -1) * (r.target_pct / 100)) : null;
          const alloc = dir !== 0 ? (r.conviction / totalConv) * 100 : 0;
          return (
            <div className="pbsig" key={`${r.strategy}-${r.timeframe}`}>
              <div className="pbsig-top">
                <span className={`sigbadge ${cls(dir)}`}>{arrow(dir)} {label(dir)}</span>
                <span className="pbsig-name">{r.name} · {r.timeframe}</span>
                {r.value != null && <span className="pbsig-read">{fmtReading(r)}</span>}
              </div>
              {dir !== 0 && (
                <>
                  <div className="conviction" title="signal strength (the strategy's own bet size) → suggested share of book">
                    <span className="cv-bar"><span className={`cv-fill ${cls(dir)}`} style={{ width: `${Math.round(r.conviction * 100)}%` }} /></span>
                    <span className="cv-lbl">{Math.round(r.conviction * 100)}% conviction · <b>{alloc.toFixed(0)}%</b> of book</span>
                  </div>
                  <div className="pbsig-tgt">
                    <span className="neg">stop {fx(stopPx)}{r.stop_pct != null && <em> −{r.stop_pct}%</em>}</span>
                    <span className="pos">target {fx(targetPx)}{r.target_pct != null && <em> +{r.target_pct}%</em>}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
