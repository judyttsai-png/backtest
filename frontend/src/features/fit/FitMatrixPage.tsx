import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { getStrategies, postFitMatrix } from "../../api/endpoints";
import type { FitCell, FitResponse, Timeframe } from "../../types/api";
import { ModelSettings } from "../signals/ModelSettings";

const BARS: Timeframe[] = ["1d", "1h", "30m", "15m"];

/** Green (positive Sharpe) → red (negative), transparent near zero. */
function cellColor(s: number | null): string {
  if (s == null) return "transparent";
  const t = Math.max(-1, Math.min(1, s / 1.2)); // saturate around |Sharpe| = 1.2
  if (t >= 0) return `rgba(46, 173, 125, ${0.12 + 0.6 * t})`;
  return `rgba(224, 90, 90, ${0.12 + 0.6 * -t})`;
}

/** Strategy-fit matrix: which strategy best predicts each currency (out-of-sample
 *  net Sharpe per pair × strategy, best in each row highlighted). */
// The full parquet universe (majors + crosses) plus the EM pairs — a fuller
// default than the app-wide symbol list so the matrix isn't just 11 rows.
const ALL_FX =
  "EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, EURGBP, EURJPY, GBPJPY, " +
  "EURCHF, AUDJPY, EURAUD, CADJPY, CHFJPY, NZDJPY, USDKRW, USDTWD, USDBRL, USDMXN";

export function FitMatrixPage() {
  const storeSymbols = useUiStore((s) => s.symbols);
  const [symbols, setSymbols] = useState(ALL_FX);
  const [barSize, setBarSize] = useState<Timeframe>("1d");
  const [cost, setCost] = useState(0.5);
  const [oos, setOos] = useState(25);

  const symbolList = symbols
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

  // The matrix only scores single-asset strategies; expose their constants.
  const strategiesQ = useQuery({ queryKey: ["strategies"], queryFn: getStrategies });
  const singleStrategies = (strategiesQ.data ?? []).filter((m) => m.kind === "single");
  const fitOverrides = useUiStore((s) => s.fitOverrides);
  const setFitOverride = useUiStore((s) => s.setFitOverride);
  const resetFitOverrides = useUiStore((s) => s.resetFitOverrides);

  const mut = useMutation({
    mutationFn: () =>
      postFitMatrix({
        symbols: symbolList,
        timeframe: barSize,
        cost_bps: cost,
        oos_frac: oos / 100,
        params: fitOverrides,
      }),
  });
  const data: FitResponse | undefined = mut.data;

  // index cells by pair|strategy for quick lookup
  const byKey = useMemo(() => {
    const m: Record<string, FitCell> = {};
    data?.cells.forEach((c) => (m[`${c.pair}|${c.strategy}`] = c));
    return m;
  }, [data]);

  // best-strategy tally
  const tally = useMemo(() => {
    const t: Record<string, number> = {};
    if (data) Object.values(data.best).forEach((s) => (t[s] = (t[s] || 0) + 1));
    return t;
  }, [data]);

  return (
    <div className="panel">
      <div className="phead">
        <span className="ptitle">Strategy fit · which model predicts each currency</span>
        <span className="psub">
          {data
            ? `${data.pairs.length} pairs · out-of-sample net Sharpe (last ${Math.round(
                data.oos_frac * 100,
              )}%, ${data.cost_bps}bp cost)`
            : "run to score every strategy on every pair"}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
          <label className="sigctl">
            bar
            <select value={barSize} onChange={(e) => setBarSize(e.target.value as Timeframe)}>
              {BARS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="sigctl">
            cost bps
            <input
              type="number"
              step="0.25"
              min="0"
              value={cost}
              onChange={(e) => setCost(Number(e.target.value) || 0)}
              style={{ width: 60 }}
            />
          </label>
          <label className="sigctl">
            OOS %
            <input
              type="number"
              step="5"
              min="10"
              max="50"
              value={oos}
              onChange={(e) => setOos(Number(e.target.value) || 25)}
              style={{ width: 55 }}
            />
          </label>
          <button
            className="run secondary"
            style={{ width: "auto", padding: "9px 16px", margin: 0 }}
            onClick={() => mut.mutate()}
            disabled={mut.isPending || symbolList.length === 0}
          >
            {mut.isPending ? "SCORING…" : "▶ BUILD MATRIX"}
          </button>
        </span>
      </div>

      <div className="posform" style={{ marginTop: 10, alignItems: "center" }}>
        <input
          type="text"
          value={symbols}
          onChange={(e) => setSymbols(e.target.value)}
          placeholder="comma-separated pairs"
          style={{ flex: 1, minWidth: 280 }}
          aria-label="pairs"
        />
        <button
          className="run secondary"
          style={{ width: "auto", padding: "8px 14px", margin: 0 }}
          onClick={() => setSymbols(ALL_FX)}
          title="all 16 parquet pairs + EM"
        >
          all FX
        </button>
        <button
          className="run secondary"
          style={{ width: "auto", padding: "8px 14px", margin: 0 }}
          onClick={() => setSymbols(storeSymbols)}
          title="the symbols from the Backtest tab"
        >
          my list
        </button>
      </div>

      {singleStrategies.length > 0 && (
        <ModelSettings
          strategies={singleStrategies}
          overrides={fitOverrides}
          onChange={setFitOverride}
          onReset={resetFitOverrides}
          label="strategy constants — edit the assumptions the matrix uses"
        />
      )}

      <div className="hint" style={{ marginBottom: 12, marginTop: 10 }}>
        Each cell is that strategy's out-of-sample net Sharpe on that pair. Green = works, red =
        loses; the ★ marks the best strategy for each currency. Intraday bars take longer to score.
        Edit the pairs above and the strategy constants (default = each model's baseline). EM pairs
        are yfinance-daily and flattered by the low cost. Validate with the walk-forward before
        trading off this.
      </div>

      {mut.isError && (
        <div className="banner err">fit-matrix error — {(mut.error as Error).message}</div>
      )}
      {mut.isPending && <div className="banner">scoring every strategy on every pair…</div>}

      {data && (
        <>
          <div className="tblwrap">
            <table className="fitmatrix">
              <thead>
                <tr>
                  <th>pair</th>
                  {data.strategies.map((s) => (
                    <th key={s.id} title={s.name}>
                      {s.name}
                    </th>
                  ))}
                  <th>best fit</th>
                </tr>
              </thead>
              <tbody>
                {data.pairs.map((p) => {
                  const best = data.best[p];
                  return (
                    <tr key={p}>
                      <td className="fitpair">{p}</td>
                      {data.strategies.map((s) => {
                        const c = byKey[`${p}|${s.id}`];
                        const sh = c?.sharpe ?? null;
                        const isBest = best === s.id;
                        return (
                          <td
                            key={s.id}
                            className={`fitcell ${isBest ? "best" : ""}`}
                            style={{ background: cellColor(sh) }}
                            title={
                              c
                                ? `${p} · ${s.name}\nSharpe ${sh ?? "—"} · return ${
                                    c.return != null ? (c.return * 100).toFixed(1) + "%" : "—"
                                  } · win ${c.win_rate != null ? (c.win_rate * 100).toFixed(0) + "%" : "—"}`
                                : "no data"
                            }
                          >
                            {sh == null ? "—" : sh.toFixed(2)}
                            {isBest && <span className="fitstar"> ★</span>}
                          </td>
                        );
                      })}
                      <td className="fitbest">{best ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ marginTop: 12 }}>
            <strong>Best-strategy tally:</strong>{" "}
            {Object.entries(tally)
              .sort((a, b) => b[1] - a[1])
              .map(([s, n]) => `${s} ${n}`)
              .join(" · ") || "—"}
          </div>
        </>
      )}
    </div>
  );
}
