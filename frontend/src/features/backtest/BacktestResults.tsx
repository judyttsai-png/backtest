import { useQuery } from "@tanstack/react-query";
import { useUiStore } from "../../state/uiStore";
import {
  getBacktestStatus,
  getCandles,
  getEquity,
  getMarkers,
  getMetrics,
  getStrategies,
} from "../../api/endpoints";
import { MetricsGrid } from "./MetricsGrid";
import { FxScanPanel } from "./FxScanPanel";
import { PriceChart } from "../../components/charts/PriceChart";
import { DmiChart } from "../../components/charts/DmiChart";
import { SmaChart } from "../../components/charts/SmaChart";
import { EquityChart } from "../../components/charts/EquityChart";
import { TradeTable } from "../../components/tables/TradeTable";
import { SweepPanel } from "../sweeps/SweepPanel";

export function BacktestResults() {
  const runId = useUiStore((s) => s.activeRunId);
  const strategyId = useUiStore((s) => s.strategyId);

  const strategiesQuery = useQuery({ queryKey: ["strategies"], queryFn: getStrategies });
  const strategy = strategiesQuery.data?.find((m) => m.id === strategyId);

  const statusQuery = useQuery({
    queryKey: ["status", runId],
    queryFn: () => getBacktestStatus(runId!),
    enabled: !!runId,
    refetchInterval: (q) => {
      const st = q.state.data?.status;
      return st === "completed" || st === "failed" ? false : 700;
    },
  });

  const status = statusQuery.data;
  const done = status?.status === "completed";

  const metricsQuery = useQuery({
    queryKey: ["metrics", runId],
    queryFn: () => getMetrics(runId!),
    enabled: !!runId && done,
  });
  const equityQuery = useQuery({
    queryKey: ["equity", runId],
    queryFn: () => getEquity(runId!),
    enabled: !!runId && done,
  });
  const candlesQuery = useQuery({
    queryKey: ["candles", runId],
    queryFn: () => getCandles(runId!),
    enabled: !!runId && done,
  });
  const markersQuery = useQuery({
    queryKey: ["markers", runId],
    queryFn: () => getMarkers(runId!),
    enabled: !!runId && done,
  });

  // FX scan is offered for single-asset strategies (DMI/SMA/ROC) — it sweeps the
  // current config across all 16 FX pairs so you can pick which pair to trade.
  const showScan = strategy?.kind === "single";
  const running = status && (status.status === "queued" || status.status === "running");

  return (
    <>
      {showScan && <FxScanPanel />}

      {!runId && (
        <div className="banner">
          Configure a strategy in the left rail and press <b>RUN BACKTEST</b> for a single pair, or
          use <b>SCAN 16 PAIRS</b> above to rank the whole FX universe. Results are stored
          server-side and reproducible.
        </div>
      )}

      {runId && running && (
        <div className="banner">
          <div className="stage">
            {status!.status.toUpperCase()} · {status!.stage ?? "starting"} ·{" "}
            {Math.round(status!.progress * 100)}%
          </div>
          <div className="progress">
            <span style={{ width: `${Math.max(status!.progress, 0.05) * 100}%` }} />
          </div>
        </div>
      )}

      {runId && status?.status === "failed" && (
        <div className="banner err">backtest failed — {status.error_message ?? "unknown error"}</div>
      )}

      {runId && done && (
        <>
          {metricsQuery.data && <MetricsGrid metrics={metricsQuery.data} />}

      <section className="panel">
        <div className="phead">
          <span className="ptitle">Price &amp; signals</span>
          <span className="psub">{candlesQuery.data?.symbol}</span>
          <span className="legend">
            <span>
              <i style={{ background: "var(--bone)" }} />
              price
            </span>
            <span>
              <i style={{ background: "var(--amber)" }} />
              long ▲
            </span>
            <span>
              <i style={{ background: "var(--coral)" }} />
              short / exit ▼
            </span>
          </span>
        </div>
        {candlesQuery.data && (
          <PriceChart candles={candlesQuery.data.candles} markers={markersQuery.data?.markers ?? []} />
        )}
      </section>

      {metricsQuery.data?.strategy_model_id === "dmi" && candlesQuery.data && (
        <section className="panel">
          <div className="phead">
            <span className="ptitle">DMI / ADX</span>
            <span className="psub">{candlesQuery.data.symbol}</span>
            <span className="legend">
              <span>
                <i style={{ background: "var(--bone)" }} />
                price
              </span>
              <span>
                <i style={{ background: "var(--cyan)" }} />
                +DI
              </span>
              <span>
                <i style={{ background: "var(--coral)" }} />
                −DI
              </span>
              <span>
                <i style={{ background: "var(--amber)" }} />
                ADX
              </span>
            </span>
          </div>
          <DmiChart
            candles={candlesQuery.data.candles}
            markers={markersQuery.data?.markers ?? []}
            length={metricsQuery.data.parameters.length ?? 14}
            floor={metricsQuery.data.parameters.adx_floor ?? 20}
          />
        </section>
      )}

      {metricsQuery.data?.strategy_model_id === "sma" && candlesQuery.data && (
        <section className="panel">
          <div className="phead">
            <span className="ptitle">SMA divergence</span>
            <span className="psub">{candlesQuery.data.symbol}</span>
            <span className="legend">
              <span>
                <i style={{ background: "var(--mute)" }} />
                price
              </span>
              <span>
                <i style={{ background: "var(--amber)" }} />
                fast SMA
              </span>
              <span>
                <i style={{ background: "var(--cyan)" }} />
                slow SMA
              </span>
            </span>
          </div>
          <SmaChart
            candles={candlesQuery.data.candles}
            markers={markersQuery.data?.markers ?? []}
            fast={metricsQuery.data.parameters.fast ?? 10}
            slow={metricsQuery.data.parameters.slow ?? 40}
          />
        </section>
      )}

      <section className="panel">
        <div className="phead">
          <span className="ptitle">Equity curve</span>
          <span className="psub">strategy vs benchmark</span>
          <span className="legend">
            <span>
              <i style={{ background: "var(--amber)" }} />
              strategy
            </span>
            <span>
              <i style={{ background: "var(--cyan)" }} />
              benchmark
            </span>
          </span>
        </div>
        {equityQuery.data && <EquityChart equity={equityQuery.data} />}
      </section>

      <SweepPanel strategy={strategy} />

          <section className="panel">
            <div className="phead">
              <span className="ptitle">Trade log</span>
              <span className="psub">{metricsQuery.data?.trade_count ?? 0} trades</span>
            </div>
            <TradeTable runId={runId} />
          </section>
        </>
      )}
    </>
  );
}
