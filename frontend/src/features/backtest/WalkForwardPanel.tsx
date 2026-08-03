import { useState } from "react";
import { useUiStore } from "../../state/uiStore";
import { postWalkForward } from "../../api/endpoints";
import type { WalkForwardResponse } from "../../types/api";

const pct = (x: number | null | undefined) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);
const num = (x: number | null | undefined, d = 2) => (x == null ? "–" : x.toFixed(d));
const FOLDS = [4, 5, 6, 8, 10];

/** Rolling out-of-sample stability: splits the current config's history into K
 *  sequential folds and scores each one, so you can see whether the edge is
 *  consistent across time or just landed in one lucky window. */
export function WalkForwardPanel() {
  const s = useUiStore();
  const [folds, setFolds] = useState(6);
  const [running, setRunning] = useState(false);
  const [data, setData] = useState<WalkForwardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setData(null);
    try {
      const res = await postWalkForward({
        strategy_model_id: s.strategyId,
        parameters: s.params,
        symbols: s.symbols.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
        timeframe: s.timeframe,
        start_ts: `${s.startDate}T00:00:00Z`,
        end_ts: `${s.endDate}T00:00:00Z`,
        execution: {
          mode: s.mode,
          cost_bps: s.costBps,
          slippage_bps: s.slippageBps,
          initial_capital: s.initialCapital,
          allocation: s.allocation,
          mvs_lambda: s.mvsLambda,
          mvs_gamma: s.mvsGamma,
          mvs_max_weight: s.mvsMaxWeight,
        },
        folds,
      });
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const sum = data?.summary;
  const green = sum && sum.folds_scored ? sum.folds_positive / sum.folds_scored : 0;

  return (
    <section className="panel">
      <div className="phead">
        <span className="ptitle">Walk-forward · out-of-sample stability</span>
        <span className="psub">
          {data
            ? `${data.symbols.join(", ")} · ${s.strategyId.toUpperCase()} · is the edge consistent across time?`
            : "split history into folds and score each — a robust edge holds up in every window"}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <label className="sigctl">
            folds
            <select value={folds} onChange={(e) => setFolds(Number(e.target.value))}>
              {FOLDS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <button
            className="run secondary"
            style={{ width: "auto", padding: "9px 16px", margin: 0 }}
            onClick={run}
            disabled={running}
          >
            {running ? "TESTING…" : "▶ WALK FORWARD"}
          </button>
        </span>
      </div>

      {error && <div className="banner err">walk-forward error — {error}</div>}

      {sum && (
        <>
          <div className="wfsummary">
            <span className={`wfstat ${green >= 0.6 ? "pos" : green <= 0.4 ? "neg" : ""}`}>
              <b>
                {sum.folds_positive}/{sum.folds_scored}
              </b>{" "}
              folds green
            </span>
            <span className="wfstat">
              mean Sharpe <b>{num(sum.mean_sharpe)}</b> ± {num(sum.std_sharpe)}
            </span>
            <span className="wfstat">
              worst fold <b className="neg">{pct(sum.worst_return)}</b>
            </span>
            <span className="wfstat">
              min Sharpe <b>{num(sum.min_sharpe)}</b>
            </span>
          </div>

          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>fold</th>
                  <th>window</th>
                  <th>return</th>
                  <th>sharpe</th>
                  <th>max dd</th>
                  <th>win</th>
                </tr>
              </thead>
              <tbody>
                {data!.folds.map((f) => (
                  <tr key={f.fold}>
                    <td>{f.fold}</td>
                    <td>
                      {f.start} → {f.end}
                    </td>
                    {f.error ? (
                      <td colSpan={4} className="side-short">
                        {f.error}
                      </td>
                    ) : (
                      <>
                        <td className={(f.total_return ?? 0) >= 0 ? "side-long" : "side-short"}>
                          {pct(f.total_return)}
                        </td>
                        <td className={(f.sharpe ?? 0) >= 0 ? "side-long" : "side-short"}>
                          {num(f.sharpe)}
                        </td>
                        <td>{pct(f.max_drawdown)}</td>
                        <td>{pct(f.win_rate)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint">
              A robust edge is green in most folds with a positive mean Sharpe and small spread.
              Big swings between folds = regime-dependent, not a stable edge.
            </div>
          </div>
        </>
      )}
    </section>
  );
}
