import { useState } from "react";
import { useUiStore } from "../../state/uiStore";
import { createBacktest, getBacktestStatus, getMetrics } from "../../api/endpoints";
import type { Metrics } from "../../types/api";

// The 16 FX pairs in the parquet panel (bare names; the parquet provider also
// tolerates the yfinance "=X" suffix).
const FX_PAIRS = [
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "EURGBP",
  "EURJPY", "GBPJPY", "EURCHF", "AUDJPY", "EURAUD", "CADJPY", "CHFJPY", "NZDJPY",
];

type SortKey = "total_return" | "sharpe" | "max_drawdown";

interface Row {
  pair: string;
  runId: string;
  metrics: Metrics;
}

const pct = (x: number | null | undefined) => (x == null ? "–" : `${(x * 100).toFixed(2)}%`);
const num = (x: number | null | undefined, d = 2) => (x == null ? "–" : x.toFixed(d));

async function waitForCompletion(runId: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const s = await getBacktestStatus(runId);
    if (s.status === "completed") return;
    if (s.status === "failed") throw new Error(s.error_message ?? "backtest failed");
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timed out");
}

/** Runs the current strategy across all 16 FX pairs and ranks them, so you can
 *  pick which pair to trade instead of inspecting one at a time. Clicking a row
 *  loads that pair's run into the charts above. */
export function FxScanPanel() {
  const store = useUiStore();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("total_return");

  const runScan = async () => {
    setRunning(true);
    setError(null);
    setRows([]);
    setProgress(0);
    const acc: Row[] = [];
    try {
      for (let i = 0; i < FX_PAIRS.length; i++) {
        const pair = FX_PAIRS[i];
        const res = await createBacktest({
          strategy_model_id: store.strategyId,
          parameters: store.params,
          symbols: [pair],
          timeframe: store.timeframe,
          start_ts: `${store.startDate}T00:00:00Z`,
          end_ts: `${store.endDate}T00:00:00Z`,
          execution: {
            mode: store.mode,
            cost_bps: store.costBps,
            slippage_bps: store.slippageBps,
            initial_capital: store.initialCapital,
          },
        });
        if (res.status !== "completed") await waitForCompletion(res.run_id);
        const metrics = await getMetrics(res.run_id);
        acc.push({ pair, runId: res.run_id, metrics });
        setRows([...acc]);
        setProgress(i + 1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  // Descending: best return/sharpe first; for drawdown, least-negative first.
  const sorted = [...rows].sort(
    (a, b) => (b.metrics[sortKey] ?? -Infinity) - (a.metrics[sortKey] ?? -Infinity),
  );

  const th = (key: SortKey, label: string) => (
    <th onClick={() => setSortKey(key)} style={{ cursor: "pointer" }} title="sort">
      {label} {sortKey === key ? "▾" : ""}
    </th>
  );

  return (
    <section className="panel">
      <div className="phead">
        <span className="ptitle">FX scan · 16 pairs</span>
        <span className="psub">
          {store.strategyId.toUpperCase()} ·{" "}
          {running ? `scanning ${progress}/16…` : rows.length ? `${rows.length} pairs ranked` : "run to rank all pairs"}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <button
            className="run secondary"
            style={{ width: "auto", padding: "9px 16px", margin: 0 }}
            onClick={runScan}
            disabled={running}
          >
            {running ? "SCANNING…" : "▶ SCAN 16 PAIRS"}
          </button>
        </span>
      </div>

      {running && (
        <div className="progress">
          <span style={{ width: `${(progress / FX_PAIRS.length) * 100}%` }} />
        </div>
      )}
      {error && <div className="banner err">scan error — {error}</div>}

      {rows.length > 0 && (
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>pair</th>
                {th("total_return", "return")}
                {th("sharpe", "sharpe")}
                {th("max_drawdown", "max dd")}
                <th>trades</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr
                  key={r.pair}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    store.setActiveRunId(r.runId);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  title="load this pair's charts above"
                >
                  <td>{i + 1}</td>
                  <td>{r.pair}</td>
                  <td className={(r.metrics.total_return ?? 0) >= 0 ? "side-long" : "side-short"}>
                    {pct(r.metrics.total_return)}
                  </td>
                  <td>{num(r.metrics.sharpe)}</td>
                  <td>{pct(r.metrics.max_drawdown)}</td>
                  <td>{r.metrics.trade_count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">click a row to load that pair's price + DMI charts above</div>
        </div>
      )}
    </section>
  );
}
