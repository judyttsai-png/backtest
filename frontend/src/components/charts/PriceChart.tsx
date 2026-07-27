import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Candle, Marker } from "../../types/api";
import { readChartPalette } from "./palette";
import { useUiStore } from "../../state/uiStore";

const day = (ts: string): Time => ts.slice(0, 10) as Time;

interface Props {
  candles: Candle[];
  markers: Marker[];
}

export function PriceChart({ candles, markers }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const theme = useUiStore((s) => s.theme);

  // Create the chart once per theme (rebuilds when the palette changes).
  useEffect(() => {
    if (!containerRef.current) return;
    const palette = readChartPalette();
    const chart = createChart(containerRef.current, baseOptions(containerRef.current, palette));
    const series = chart.addLineSeries({ color: palette.line, lineWidth: 2 });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current!.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [theme]);

  // Update data imperatively when it changes (or after a theme rebuild).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const palette = readChartPalette();
    const data: LineData[] = candles.map((c) => ({ time: day(c.ts), value: c.close }));
    series.setData(data);

    const seen = new Set<string>();
    const sm: SeriesMarker<Time>[] = markers
      .map((m) => ({
        time: day(m.ts),
        position:
          m.kind === "long_entry"
            ? ("belowBar" as const)
            : m.kind === "short_entry"
              ? ("aboveBar" as const)
              : ("aboveBar" as const),
        color: m.kind === "long_entry" ? palette.amber : palette.coral,
        shape:
          m.kind === "long_entry"
            ? ("arrowUp" as const)
            : m.kind === "short_entry"
              ? ("arrowDown" as const)
              : ("circle" as const),
        text: m.kind === "exit" ? "" : m.kind === "long_entry" ? "L" : "S",
      }))
      // markers must be unique + sorted by time for lightweight-charts
      .filter((m) => {
        const key = `${m.time}-${m.shape}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    series.setMarkers(sm);
    chartRef.current?.timeScale().fitContent();
  }, [candles, markers, theme]);

  return <div className="chart" ref={containerRef} />;
}

function baseOptions(el: HTMLElement, palette: ReturnType<typeof readChartPalette>) {
  return {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: palette.text,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
    },
    grid: {
      vertLines: { color: palette.grid },
      horzLines: { color: palette.grid },
    },
    rightPriceScale: { borderColor: palette.grid },
    timeScale: { borderColor: palette.grid },
    crosshair: { mode: 1 },
  };
}
