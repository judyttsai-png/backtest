import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { getStrategies, postPlaybookScore } from "../../api/endpoints";
import type { PlaybookScore, Timeframe } from "../../types/api";

const BARS: Timeframe[] = ["1d", "1h", "30m", "15m"];

function color(s: number | null): string {
  if (s == null) return "transparent";
  const t = Math.max(-1, Math.min(1, s / 1.2));
  return t >= 0 ? `rgba(46,173,125,${0.12 + 0.55 * t})` : `rgba(224,90,90,${0.12 + 0.55 * -t})`;
}

/** The Playbook: one row per currency, each assigned its own strategy + bar. A
 *  "score" runs each assignment on its own out-of-sample tail so you can tune
 *  which model each currency should be traded with. */
export function PlaybookPage() {
  const playbook = useUiStore((s) => s.playbook);
  const setRow = useUiStore((s) => s.setPlaybookRow);
  const setParam = useUiStore((s) => s.setPlaybookParam);
  const addRow = useUiStore((s) => s.addPlaybookRow);
  const removeRow = useUiStore((s) => s.removePlaybookRow);

  const [cost, setCost] = useState(0.5);
  const [oos, setOos] = useState(25);
  const [newPair, setNewPair] = useState("");
  const [openPair, setOpenPair] = useState<string | null>(null);

  const strategiesQ = useQuery({ queryKey: ["strategies"], queryFn: getStrategies });
  const single = (strategiesQ.data ?? []).filter((m) => m.kind === "single");
  const metaOf = (id: string) => single.find((m) => m.id === id);

  const pairs = Object.keys(playbook).sort();

  const mut = useMutation({
    mutationFn: () =>
      postPlaybookScore({
        items: pairs.map((p) => ({
          pair: p,
          strategy: playbook[p].strategy,
          timeframe: playbook[p].timeframe,
          params: playbook[p].params || {},
        })),
        cost_bps: cost,
        oos_frac: oos / 100,
      }),
  });

  const scoreByPair = useMemo(() => {
    const m: Record<string, PlaybookScore> = {};
    mut.data?.scores.forEach((s) => (m[s.pair] = s));
    return m;
  }, [mut.data]);

  const avgSharpe = useMemo(() => {
    const vals = (mut.data?.scores ?? []).map((s) => s.sharpe).filter((x): x is number => x != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [mut.data]);

  return (
    <div className="panel">
      <div className="phead">
        <span className="ptitle">Playbook · which strategy to trade each currency with</span>
        <span className="psub">
          {mut.data
            ? `${pairs.length} pairs · avg OOS Sharpe ${avgSharpe?.toFixed(2) ?? "—"}`
            : "assign a strategy + bar per pair, then score"}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <label className="sigctl">
            cost bps
            <input type="number" step="0.25" min="0" value={cost}
              onChange={(e) => setCost(Number(e.target.value) || 0)} style={{ width: 60 }} />
          </label>
          <label className="sigctl">
            OOS %
            <input type="number" step="5" min="10" max="50" value={oos}
              onChange={(e) => setOos(Number(e.target.value) || 25)} style={{ width: 55 }} />
          </label>
          <button className="run secondary" style={{ width: "auto", padding: "9px 16px", margin: 0 }}
            onClick={() => mut.mutate()} disabled={mut.isPending || pairs.length === 0}>
            {mut.isPending ? "SCORING…" : "▶ SCORE PLAYBOOK"}
          </button>
        </span>
      </div>

      <div className="posform" style={{ marginTop: 6 }}>
        <input type="text" placeholder="add pair e.g. USDMXN" value={newPair}
          onChange={(e) => setNewPair(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newPair.trim()) { addRow(newPair); setNewPair(""); } }}
          style={{ maxWidth: 200 }} />
        <button className="run secondary" style={{ width: "auto", padding: "8px 14px", margin: 0 }}
          onClick={() => { if (newPair.trim()) { addRow(newPair); setNewPair(""); } }}>
          + ADD PAIR
        </button>
      </div>

      <div className="hint" style={{ margin: "10px 0" }}>
        Each row is scored with its own strategy, bar and constants (constants come from the Fit
        tab's editor) on that pair's out-of-sample tail. Tune to match each currency's character —
        fade the rangers, follow the trenders — but a good assignment should hold up across a{" "}
        <em>range</em> of settings, not one lucky value.
      </div>

      {mut.isError && <div className="banner err">score error — {(mut.error as Error).message}</div>}

      <div className="tblwrap">
        <table className="fitmatrix">
          <thead>
            <tr>
              <th></th>
              <th>pair</th>
              <th>strategy</th>
              <th>bar</th>
              <th>OOS Sharpe</th>
              <th>OOS return</th>
              <th>win %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => {
              const row = playbook[p];
              const sc = scoreByPair[p];
              const meta = metaOf(row.strategy);
              const open = openPair === p;
              const edited = row.params && Object.keys(row.params).length > 0;
              return [
                <tr key={p}>
                  <td>
                    <button className="linkx" title="edit this pair's constants"
                      onClick={() => setOpenPair(open ? null : p)}>{open ? "▾" : "▸"}</button>
                  </td>
                  <td className="fitpair">{p}{edited && <span className="star"> •</span>}</td>
                  <td>
                    <select value={row.strategy} onChange={(e) => setRow(p, { strategy: e.target.value })}>
                      {single.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={row.timeframe}
                      onChange={(e) => setRow(p, { timeframe: e.target.value as Timeframe })}>
                      {BARS.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td className="fitcell" style={{ background: color(sc?.sharpe ?? null) }}>
                    {sc?.sharpe == null ? "—" : sc.sharpe.toFixed(2)}
                  </td>
                  <td>{sc?.return == null ? "—" : `${(sc.return * 100).toFixed(1)}%`}</td>
                  <td>{sc?.win_rate == null ? "—" : `${(sc.win_rate * 100).toFixed(0)}%`}</td>
                  <td>
                    <button className="linkx" title="remove" onClick={() => removeRow(p)}>✕</button>
                  </td>
                </tr>,
                open && meta ? (
                  <tr key={p + "-params"} className="pb-params-row">
                    <td></td>
                    <td colSpan={7}>
                      <div className="pb-params">
                        <span className="pb-plabel">{meta.name} constants for {p}:</span>
                        {meta.parameters.map((pr) => (
                          <label key={pr.id} title={`${pr.min}–${pr.max}, default ${pr.default}`}>
                            {pr.label}
                            <input type="number" step={pr.step || 1} min={pr.min} max={pr.max}
                              value={row.params?.[pr.id] ?? pr.default}
                              onChange={(e) => setParam(p, pr.id, Number(e.target.value))} />
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        Assigned: {pairs.filter((p) => scoreByPair[p]?.sharpe != null && scoreByPair[p]!.sharpe! > 0).length}{" "}
        of {pairs.length} pairs currently score a positive OOS Sharpe. Confirm with the walk-forward
        before trading.
      </div>
    </div>
  );
}
