import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { EquityResponse } from "../../types/api";
import { readChartPalette } from "./palette";
import { useUiStore } from "../../state/uiStore";

// UTC timestamp (seconds) so intraday bars keep distinct times.
const day = (ts: string): Time =>
  (Date.parse(/[Z+]/.test(ts) ? ts : ts + "Z") / 1000) as UTCTimestamp;

interface Props {
  equity: EquityResponse;
}

export function EquityChart({ equity }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const stratRef = useRef<ISeriesApi<"Line"> | null>(null);
  const benchRef = useRef<ISeriesApi<"Line"> | null>(null);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const palette = readChartPalette();
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: palette.text,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.grid },
      timeScale: { borderColor: palette.grid },
      crosshair: { mode: 1 },
    });
    stratRef.current = chart.addLineSeries({ color: palette.amber, lineWidth: 2 });
    benchRef.current = chart.addLineSeries({ color: palette.cyan, lineWidth: 1, lineStyle: 2 });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [theme]);

  useEffect(() => {
    if (!stratRef.current || !benchRef.current) return;
    const strat: LineData[] = equity.points.map((p) => ({ time: day(p.ts), value: p.equity }));
    const bench: LineData[] = equity.benchmark.map((b) => ({ time: day(b.ts), value: b.value }));
    stratRef.current.setData(strat);
    benchRef.current.setData(bench);
    chartRef.current?.timeScale().fitContent();
  }, [equity, theme]);

  return <div className="chart tall" ref={containerRef} />;
}
