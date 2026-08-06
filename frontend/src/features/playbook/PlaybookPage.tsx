import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { getStrategies, postPlaybookScore } from "../../api/endpoints";
import type { PlaybookScore, Timeframe } from "../../types/api";
import { ModelSettings } from "../signals/ModelSettings";

const BARS: Timeframe[] = ["1d", "1h", "30m", "15m"];

/** Effective constants for a (strategy, pair): pair override wins over the
 *  global default for that strategy. */
export function effectiveParams(
  global: Record<string, Record<string, number>>,
  strategy: string,
  perPair?: Record<string, number>,
): Record<string, number> {
  return { ...(global[strategy] || {}), ...(perPair || {}) };
}

function sharpeColor(s: number | null | undefined): string {
  if (s == null) return "transparent";
  const t = Math.max(-1, Math.min(1, s / 1.2));
  return t >= 0 ? `rgba(46,173,125,${0.12 + 0.55 * t})` : `rgba(224,90,90,${0.12 + 0.55 * -t})`;
}

/** The Playbook, grouped by currency: one card per pair where you pick which
 *  strategies to see for it and edit each one's bar + constants. */
export function PlaybookPage() {
  const playbook = useUiStore((s) => s.playbook);
  const addPair = useUiStore((s) => s.addPlaybookPair);
  const removePair = useUiStore((s) => s.removePlaybookPair);
  const toggleStrat = useUiStore((s) => s.togglePlaybookStrategy);
  const setTf = useUiStore((s) => s.setPlaybookStrategyTf);
  const setParam = useUiStore((s) => s.setPlaybookStrategyParam);
  const globalParams = useUiStore((s) => s.fitOverrides);
  const setGlobalParam = useUiStore((s) => s.setFitOverride);
  const resetGlobalParams = useUiStore((s) => s.resetFitOverrides);

  const [cost, setCost] = useState(0.5);
  const [oos, setOos] = useState(25);
  const [newPair, setNewPair] = useState("");

  const strategiesQ = useQuery({ queryKey: ["strategies"], queryFn: getStrategies });
  const allStrategies = strategiesQ.data ?? [];
  const single = allStrategies.filter((m) => m.kind === "single");
  const metaOf = (id: string) => single.find((m) => m.id === id);

  const pairs = Object.keys(playbook).sort();
  const items = pairs.flatMap((pair) =>
    Object.entries(playbook[pair]).map(([sid, cfg]) => ({
      pair, strategy: sid, timeframe: cfg.timeframe,
      params: effectiveParams(globalParams, sid, cfg.params),
    })),
  );

  const mut = useMutation({
    mutationFn: () => postPlaybookScore({ items, cost_bps: cost, oos_frac: oos / 100 }),
  });

  const scoreByKey = useMemo(() => {
    const m: Record<string, PlaybookScore> = {};
    mut.data?.scores.forEach((s) => (m[`${s.pair}|${s.strategy}`] = s));
    return m;
  }, [mut.data]);

  const avgSharpe = useMemo(() => {
    const vals = (mut.data?.scores ?? []).map((s) => s.sharpe).filter((x): x is number => x != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [mut.data]);

  return (
    <div className="panel">
      <div className="phead">
        <span className="ptitle">Playbook · what to watch on each currency</span>
        <span className="psub">
          {mut.data
            ? `${pairs.length} currencies · ${items.length} strategies · avg OOS Sharpe ${avgSharpe?.toFixed(2) ?? "—"}`
            : "pick the strategies for each currency, then score"}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <label className="sigctl">cost bps
            <input type="number" step="0.25" min="0" value={cost}
              onChange={(e) => setCost(Number(e.target.value) || 0)} style={{ width: 60 }} /></label>
          <label className="sigctl">OOS %
            <input type="number" step="5" min="10" max="50" value={oos}
              onChange={(e) => setOos(Number(e.target.value) || 25)} style={{ width: 55 }} /></label>
          <button className="run secondary" style={{ width: "auto", padding: "9px 16px", margin: 0 }}
            onClick={() => mut.mutate()} disabled={mut.isPending || items.length === 0}>
            {mut.isPending ? "SCORING…" : "▶ SCORE PLAYBOOK"}
          </button>
        </span>
      </div>

      <div className="posform" style={{ marginTop: 6 }}>
        <input type="text" placeholder="add currency e.g. USDMXN" value={newPair}
          onChange={(e) => setNewPair(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newPair.trim()) { addPair(newPair); setNewPair(""); } }}
          style={{ maxWidth: 220 }} />
        <button className="run secondary" style={{ width: "auto", padding: "8px 14px", margin: 0 }}
          onClick={() => { if (newPair.trim()) { addPair(newPair); setNewPair(""); } }}>
          + ADD CURRENCY
        </button>
      </div>

      {allStrategies.length > 0 && (
        <ModelSettings strategies={allStrategies} overrides={globalParams} onChange={setGlobalParam}
          onReset={resetGlobalParams}
          label="global model constants (saved) — every model incl. Velocity Crossover; used by backtests, signals & the fit matrix" />
      )}

      <div className="hint" style={{ margin: "10px 0" }}>
        One card per currency. Click a strategy chip to include/exclude it, set its bar, and edit its
        constants right there. Constants start from the <b>global</b> values above; anything you change
        here overrides for this currency only. Confirm with the walk-forward before trading.
      </div>

      {mut.isError && <div className="banner err">score error — {(mut.error as Error).message}</div>}

      <div className="pbgrid">
        {pairs.map((pair) => {
          const strats = playbook[pair];
          const selected = Object.keys(strats);
          return (
            <div className="pbcard" key={pair}>
              <div className="pbcard-head">
                <span className="pbpair">{pair}</span>
                <button className="linkx" title="remove currency" onClick={() => removePair(pair)}>✕</button>
              </div>
              <div className="stratpick">
                {single.map((m) => (
                  <button key={m.id} type="button"
                    className={`stratchip ${selected.includes(m.id) ? "on" : ""}`}
                    onClick={() => toggleStrat(pair, m.id)}
                    title={selected.includes(m.id) ? "showing — click to hide" : "hidden — click to show"}>
                    {m.name}
                  </button>
                ))}
              </div>
              {selected.length === 0 && <div className="hint" style={{ margin: "8px 0 0" }}>No strategies selected.</div>}
              {selected.map((sid) => {
                const cfg = strats[sid];
                const meta = metaOf(sid);
                const sc = scoreByKey[`${pair}|${sid}`];
                if (!meta) return null;
                return (
                  <div className="pbstrat" key={sid}>
                    <div className="pbstrat-top">
                      <span className="pbsname">{meta.name}</span>
                      <label className="sigctl">bar
                        <select value={cfg.timeframe} onChange={(e) => setTf(pair, sid, e.target.value as Timeframe)}>
                          {BARS.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </label>
                      <span className="pbsharpe" style={{ background: sharpeColor(sc?.sharpe) }}>
                        {sc?.sharpe == null ? "— Sharpe" : `${sc.sharpe.toFixed(2)} Sharpe`}
                      </span>
                      {sc?.return != null && (
                        <span className="pbret">{(sc.return * 100).toFixed(1)}% · win {sc.win_rate != null ? (sc.win_rate * 100).toFixed(0) : "—"}%</span>
                      )}
                    </div>
                    <div className="pbparams">
                      {meta.parameters.map((pr) => {
                        const glob = globalParams[sid]?.[pr.id] ?? pr.default;
                        return (
                          <label key={pr.id} title={`global ${glob} · range ${pr.min}–${pr.max}`}>
                            {pr.label}
                            <input type="number" step={pr.step || 1} min={pr.min} max={pr.max}
                              value={cfg.params?.[pr.id] ?? glob}
                              onChange={(e) => setParam(pair, sid, pr.id, Number(e.target.value))} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
