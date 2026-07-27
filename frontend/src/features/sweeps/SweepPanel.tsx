import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import { createSweep, getHeatmap, getSweepStatus } from "../../api/endpoints";
import { HeatmapCanvas } from "../../components/heatmap/HeatmapCanvas";
import type { ParamMeta, StrategyMeta, SweepRequest } from "../../types/api";
import { ApiError } from "../../api/client";

const METRICS = ["sharpe", "sortino", "total_return", "max_drawdown"];

function axisValues(p: ParamMeta, n = 7): number[] {
  const span = p.max - p.min;
  const raw = Array.from({ length: n }, (_, i) => p.min + (span * i) / (n - 1));
  const values = p.type === "int" ? raw.map((v) => Math.round(v)) : raw.map((v) => Math.round(v * 100) / 100);
  return [...new Set(values)];
}

interface Props {
  strategy: StrategyMeta | undefined;
}

export function SweepPanel({ strategy }: Props) {
  const s = useUiStore();
  const params = strategy?.parameters ?? [];

  const [xParam, setXParam] = useState<string>("");
  const [yParam, setYParam] = useState<string>("");
  const [metric, setMetric] = useState<string>("sharpe");

  useEffect(() => {
    if (params.length >= 2) {
      setXParam(params[0].id);
      setYParam(params[1].id);
    }
  }, [strategy?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: createSweep,
    onSuccess: (data) => s.setActiveSweepId(data.sweep_id),
  });

  const statusQuery = useQuery({
    queryKey: ["sweep-status", s.activeSweepId],
    queryFn: () => getSweepStatus(s.activeSweepId!),
    enabled: !!s.activeSweepId,
    refetchInterval: (q) => {
      const st = q.state.data?.status;
      return st === "completed" || st === "failed" ? false : 800;
    },
  });

  const completed = statusQuery.data?.status === "completed";
  const heatmapQuery = useQuery({
    queryKey: ["heatmap", s.activeSweepId, xParam, yParam, metric],
    queryFn: () => getHeatmap(s.activeSweepId!, xParam, yParam, metric),
    enabled: !!s.activeSweepId && completed && !!xParam && !!yParam,
  });

  const totalPoints = useMemo(() => {
    const px = params.find((p) => p.id === xParam);
    const py = params.find((p) => p.id === yParam);
    if (!px || !py) return 0;
    return axisValues(px).length * axisValues(py).length;
  }, [params, xParam, yParam]);

  const runSweep = () => {
    const px = params.find((p) => p.id === xParam);
    const py = params.find((p) => p.id === yParam);
    if (!strategy || !px || !py) return;

    const symbols = s.symbols.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    const req: SweepRequest = {
      strategy_model_id: strategy.id,
      base_config: {
        symbols,
        timeframe: s.timeframe,
        start_ts: `${s.startDate}T00:00:00Z`,
        end_ts: `${s.endDate}T00:00:00Z`,
        parameters: s.params,
        execution: {
          mode: s.mode,
          cost_bps: s.costBps,
          slippage_bps: s.slippageBps,
          initial_capital: s.initialCapital,
        },
      },
      sweep_space: { [xParam]: axisValues(px), [yParam]: axisValues(py) },
      objective_metric: metric,
    };
    mutation.mutate(req);
  };

  return (
    <section className="panel">
      <div className="phead">
        <span className="ptitle">Parameter sweep</span>
        <span className="psub">2D {metric} surface · backend computed · click a cell to apply</span>
        <span className="legend">in-sample · optimizing here risks overfitting</span>
      </div>

      <div className="axisrow" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>x axis</label>
          <select value={xParam} onChange={(e) => setXParam(e.target.value)}>
            {params.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>y axis</label>
          <select value={yParam} onChange={(e) => setYParam(e.target.value)}>
            {params.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>objective</label>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {METRICS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            className="run secondary"
            style={{ marginTop: 0 }}
            onClick={runSweep}
            disabled={mutation.isPending || xParam === yParam}
          >
            {mutation.isPending ? "SWEEPING…" : `▦ SWEEP ${totalPoints} PTS`}
          </button>
        </div>
      </div>

      {xParam === yParam && <div className="hint">choose two different axes</div>}
      {mutation.isError && (
        <div className="hint" style={{ color: "var(--coral)" }}>
          {mutation.error instanceof ApiError ? mutation.error.message : "sweep failed"}
        </div>
      )}

      {s.activeSweepId && !completed && statusQuery.data?.status !== "failed" && (
        <div>
          <div className="progress">
            <span style={{ width: `${(statusQuery.data?.progress ?? 0) * 100}%` }} />
          </div>
          <div className="stage">
            evaluating grid… {Math.round((statusQuery.data?.progress ?? 0) * 100)}%
          </div>
        </div>
      )}
      {statusQuery.data?.status === "failed" && (
        <div className="hint" style={{ color: "var(--coral)" }}>
          {statusQuery.data.error_message ?? "sweep failed"}
        </div>
      )}

      {completed && heatmapQuery.data && (
        <HeatmapCanvas
          heatmap={heatmapQuery.data}
          onApply={(patch) => {
            for (const [k, v] of Object.entries(patch)) s.setParam(k, v);
          }}
        />
      )}
      {completed && heatmapQuery.isError && (
        <div className="hint">could not load heatmap slice</div>
      )}
    </section>
  );
}
