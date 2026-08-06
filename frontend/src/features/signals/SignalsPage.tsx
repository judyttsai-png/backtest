import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { postPlaybookSignals } from "../../api/endpoints";
import type { PlaybookSignalPair, SignalsResponse } from "../../types/api";
import { PositionsPanel } from "./PositionsPanel";
import { fmtInstant, tzLabel } from "../../lib/time";

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
const numFromLS = (key: string, fallback: number) => {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const saveNum = (key: string, v: number) => {
  try { localStorage.setItem(key, String(v)); } catch { /* ignore */ }
};

/** Live recommendations, driven by the Playbook and grouped by currency: one card
 *  per currency shows each strategy you selected for it, with an ATR stop/target. */
export function SignalsPage() {
  const playbook = useUiStore((s) => s.playbook);
  const globalParams = useUiStore((s) => s.fitOverrides);
  const tzMinutes = useUiStore((s) => s.tzMinutes);
  const setTab = useUiStore((s) => s.set);
  const [autoRefresh, setAutoRefresh] = useState(false);
  // Stop / target width as multiples of ATR — saved so wider stops stick.
  const [stopMult, setStopMult] = useState(() => numFromLS("backtest-stopmult", 2.5));
  const [targetMult, setTargetMult] = useState(() => numFromLS("backtest-targetmult", 3.5));

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
  const cards = [...byPair.entries()].map(([symbol, rows]) => {
    const net = rows.reduce((a, r) => a + Math.sign(r.direction), 0);
    return { symbol, price: rows[0]?.price ?? null, rows, consensus: Math.sign(net) };
  });

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
            <label className="sigctl" title="stop distance = this × the pair's ATR (higher = wider stop)">
              stop ×
              <input type="number" step="0.5" min="0.25" value={stopMult} style={{ width: 52 }}
                onChange={(e) => { const v = Number(e.target.value) || 1; setStopMult(v); saveNum("backtest-stopmult", v); }} />
            </label>
            <label className="sigctl" title="target distance = this × the pair's ATR">
              target ×
              <input type="number" step="0.5" min="0.25" value={targetMult} style={{ width: 52 }}
                onChange={(e) => { const v = Number(e.target.value) || 1; setTargetMult(v); saveNum("backtest-targetmult", v); }} />
            </label>
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
          One card per currency, each strategy with an ATR-scaled stop &amp; target. The stop is sized
          to the <b>ATR of that strategy's bar</b> — so a 15m/30m bar gives a tight stop that's easily
          hit intraday. Widen it with <b>stop ×</b> above, or put the pair on a <b>daily bar</b> (on the
          Playbook tab) so the stop reflects daily ranges, not minutes.
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
      <PositionsPanel signals={asPositionsSignals} />
    </>
  );
}

function CurrencyCard({ symbol, price, rows, consensus }:
  { symbol: string; price: number | null; rows: PlaybookSignalPair[]; consensus: number }) {
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
          return (
            <div className="pbsig" key={`${r.strategy}-${r.timeframe}`}>
              <div className="pbsig-top">
                <span className={`sigbadge ${cls(dir)}`}>{arrow(dir)} {label(dir)}</span>
                <span className="pbsig-name">{r.name} · {r.timeframe}</span>
                {r.value != null && <span className="pbsig-read">{fmtReading(r)}</span>}
              </div>
              {dir !== 0 && (
                <div className="pbsig-tgt">
                  <span className="neg">stop {fx(stopPx)}{r.stop_pct != null && <em> −{r.stop_pct}%</em>}</span>
                  <span className="pos">target {fx(targetPx)}{r.target_pct != null && <em> +{r.target_pct}%</em>}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
