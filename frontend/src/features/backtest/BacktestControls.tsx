import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { createBacktest } from "../../api/endpoints";
import type { BacktestRequest, StrategyMeta } from "../../types/api";
import { ApiError } from "../../api/client";
import { MODEL_INFO } from "../../lib/modelInfo";

const MODEL_MARKS: Record<string, string> = { sma: "×", dmi: "±", velcross: "∿", meanrev: "⇄" };
// 5m/1m removed: parquet's finest bar is 15-min and yfinance intraday FX is
// unreliable, so nothing can serve them.
const TIMEFRAMES = ["1d", "1h", "30m", "15m"] as const;

interface Props {
  strategies: StrategyMeta[];
}

export function BacktestControls({ strategies }: Props) {
  const s = useUiStore();
  const [showInfo, setShowInfo] = useState(false);
  const selected = useMemo(
    () => strategies.find((m) => m.id === s.strategyId),
    [strategies, s.strategyId],
  );
  const infoBullets = (selected && MODEL_INFO[selected.id]) || [];

  // Initialise parameter defaults once strategy metadata is available.
  useEffect(() => {
    if (selected && Object.keys(s.params).length === 0) {
      s.setStrategy(selected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const mutation = useMutation({
    mutationFn: createBacktest,
    onSuccess: (data) => s.setActiveRunId(data.run_id),
  });

  const runBacktest = () => {
    const symbols = s.symbols
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    if (symbols.length === 0) return;

    const req: BacktestRequest = {
      strategy_model_id: s.strategyId,
      parameters: s.params,
      symbols,
      timeframe: s.timeframe,
      start_ts: `${s.startDate}T00:00:00Z`,
      end_ts: `${s.endDate}T00:00:00Z`,
      benchmark_symbol: s.benchmark.trim() ? s.benchmark.trim().toUpperCase() : null,
      execution: {
        mode: s.mode,
        cost_bps: s.costBps,
        slippage_bps: s.slippageBps,
        initial_capital: s.initialCapital,
        allocation: s.allocation,
        topup_pct: s.topupPct,
        trim_pct: s.trimPct,
        mvs_lambda: s.mvsLambda,
        mvs_gamma: s.mvsGamma,
        mvs_max_weight: s.mvsMaxWeight,
      },
    };
    mutation.mutate(req);
  };

  return (
    <aside className="rail">
      <div className="group">
        <span className="glabel">Model</span>
        <div className="models">
          {strategies.map((m) => (
            <button
              key={m.id}
              className={`modelbtn ${m.id === s.strategyId ? "on" : ""}`}
              onClick={() => s.setStrategy(m)}
            >
              <span className="mk">{MODEL_MARKS[m.id] ?? "◆"}</span>
              {m.name}
            </button>
          ))}
        </div>
        {selected && (
          <>
            <p className="mdesc">
              {selected.description}
              {infoBullets.length > 0 && (
                <button
                  type="button"
                  className="infobtn"
                  onClick={() => setShowInfo((v) => !v)}
                  aria-expanded={showInfo}
                >
                  {showInfo ? "▾ how it works" : "▸ how it works"}
                </button>
              )}
            </p>
            {showInfo && (
              <ul className="modelinfo">
                {infoBullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="group">
        <span className="glabel">Parameters</span>
        {selected?.parameters.map((p) => (
          <div className="field" key={p.id}>
            <label>
              {p.label}
              <span className="val">
                {s.params[p.id] ?? p.default}
                {p.type === "float" ? "" : ""}
              </span>
            </label>
            <input
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={s.params[p.id] ?? p.default}
              onChange={(e) => s.setParam(p.id, Number(e.target.value))}
            />
          </div>
        ))}
      </div>

      <div className="group">
        <span className="glabel">Market &amp; execution</span>

        <div className="field">
          <label>symbols {selected?.kind === "portfolio" ? "(universe)" : "(single asset)"}</label>
          <input
            type="text"
            value={s.symbols}
            onChange={(e) => s.set("symbols", e.target.value)}
            placeholder="EURUSD, GBPUSD, USDJPY"
          />
          <div className="hint">comma separated · FX pairs e.g. EURUSD</div>
        </div>

        <div className="field">
          <label>benchmark (optional)</label>
          <input
            type="text"
            value={s.benchmark}
            onChange={(e) => s.set("benchmark", e.target.value)}
            placeholder="defaults to the traded pair"
          />
          <div className="hint">blank = buy &amp; hold the same pair, same capital</div>
        </div>

        <div className="field">
          <label>timeframe</label>
          <select value={s.timeframe} onChange={(e) => s.set("timeframe", e.target.value as never)}>
            {TIMEFRAMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div className="hint">daily data is stable in v1</div>
        </div>

        <div className="axisrow">
          <div className="field">
            <label>start</label>
            <input type="date" value={s.startDate} onChange={(e) => s.set("startDate", e.target.value)} />
          </div>
          <div className="field">
            <label>end</label>
            <input type="date" value={s.endDate} onChange={(e) => s.set("endDate", e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>execution mode</label>
          <div className="seg">
            <button className={s.mode === "long_flat" ? "on" : ""} onClick={() => s.set("mode", "long_flat")}>
              LONG / FLAT
            </button>
            <button className={s.mode === "long_short" ? "on" : ""} onClick={() => s.set("mode", "long_short")}>
              LONG / SHORT
            </button>
          </div>
        </div>

        <div className="field">
          <label>
            cost <span className="val">{s.costBps} bps</span>
          </label>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={s.costBps}
            onChange={(e) => s.set("costBps", Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label>
            slippage <span className="val">{s.slippageBps} bps</span>
          </label>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={s.slippageBps}
            onChange={(e) => s.set("slippageBps", Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label>initial capital</label>
          <input
            type="text"
            value={s.initialCapital}
            onChange={(e) => s.set("initialCapital", Number(e.target.value) || 0)}
          />
        </div>

        <div className="field">
          <label>initial allocation</label>
          <select
            value={s.allocation}
            onChange={(e) => s.set("allocation", e.target.value as "all_in" | "equal" | "mvskew")}
          >
            <option value="all_in">All-in (full capital)</option>
            <option value="equal">Equal distribution (split across names)</option>
            <option value="mvskew">Mean-Variance-Skewness (optimized weights)</option>
          </select>
          <div className="hint">
            {s.allocation === "mvskew"
              ? "your MVS optimizer sizes each pair: max(w·μ − λ·wΣw + γ·skew), long-only weights, monthly rebalance"
              : "how the initial capital is deployed across the universe"}
          </div>
        </div>

        {s.allocation === "mvskew" ? (
          <>
            <div className="axisrow">
              <div className="field">
                <label>λ variance aversion</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={s.mvsLambda}
                  onChange={(e) => s.set("mvsLambda", Number(e.target.value) || 0)}
                />
              </div>
              <div className="field">
                <label>γ skew preference</label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={s.mvsGamma}
                  onChange={(e) => s.set("mvsGamma", Number(e.target.value) || 0)}
                />
              </div>
              <div className="field">
                <label>per-pair cap (%)</label>
                <input
                  type="number"
                  step="5"
                  min="0"
                  max="100"
                  value={Math.round(s.mvsMaxWeight * 100)}
                  onChange={(e) =>
                    s.set("mvsMaxWeight", Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100)
                  }
                />
              </div>
            </div>
            <div className="hint" style={{ marginTop: -6 }}>
              Higher λ → punishes volatile pairs; higher γ → tilts toward positively-skewed pairs. The
              strategy picks direction; MVS picks size. Defaults λ=3, γ=3, cap 20% (your original).
            </div>
          </>
        ) : (
          <>
            <div className="axisrow">
              <div className="field">
                <label>add / top-up (%)</label>
                <input
                  type="number"
                  value={s.topupPct}
                  onChange={(e) => s.set("topupPct", Number(e.target.value) || 0)}
                />
              </div>
              <div className="field">
                <label>reduce / trim (%)</label>
                <input
                  type="number"
                  value={s.trimPct}
                  onChange={(e) => s.set("trimPct", Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="hint" style={{ marginTop: -6 }}>
              Allocation is applied; top-up / trim are captured with the run (sizing engine WIP).
            </div>
          </>
        )}
      </div>

      <button className="run" onClick={runBacktest} disabled={mutation.isPending}>
        {mutation.isPending ? "▶ QUEUEING…" : "▶ RUN BACKTEST"}
      </button>
      {mutation.isError && (
        <div className="hint" style={{ color: "var(--coral)", marginTop: 10 }}>
          {mutation.error instanceof ApiError ? mutation.error.message : "request failed"}
        </div>
      )}
    </aside>
  );
}
