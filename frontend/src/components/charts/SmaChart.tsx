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

/** Simple moving average over `window` bars; null during warmup. O(n) sliding sum. */
function sma(values: number[], window: number): (number | null)[] {
  const out = new Array<number | null>(values.length).fill(null);
  if (window < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

interface Props {
  candles: Candle[];
  markers: Marker[];
  fast: number;
  slow: number;
}

/** Price (faint) with the fast and slow SMAs overlaid and the strategy's
 *  long/short markers, so the crossovers that drive the signal are visible.
 *  Rebuilds on theme change to track light/dark. */
export function SmaChart({ candles, markers, fast, slow }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fastRef = useRef<ISeriesApi<"Line"> | null>(null);
  const slowRef = useRef<ISeriesApi<"Line"> | null>(null);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const p = readChartPalette();
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: p.text,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.grid },
      timeScale: { borderColor: p.grid },
      crosshair: { mode: 1 },
    });
    // faint price for reference; the two SMAs are the focus
    priceRef.current = chart.addLineSeries({
      color: p.text,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    fastRef.current = chart.addLineSeries({
      color: p.amber,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    slowRef.current = chart.addLineSeries({
      color: p.cyan,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    if (!priceRef.current || !fastRef.current || !slowRef.current) return;
    const p = readChartPalette();
    const closes = candles.map((c) => c.close);
    const fastSma = sma(closes, fast);
    const slowSma = sma(closes, slow);

    const toLine = (arr: (number | null)[]): LineData[] =>
      candles
        .map((c, i) => (arr[i] != null ? { time: day(c.ts), value: arr[i] as number } : null))
        .filter((x): x is LineData => x !== null);

    priceRef.current.setData(candles.map((c) => ({ time: day(c.ts), value: c.close })));
    fastRef.current.setData(toLine(fastSma));
    slowRef.current.setData(toLine(slowSma));

    const seen = new Set<string>();
    const sm: SeriesMarker<Time>[] = markers
      .map((m) => ({
        time: day(m.ts),
        position: m.kind === "long_entry" ? ("belowBar" as const) : ("aboveBar" as const),
        color: m.kind === "long_entry" ? p.amber : p.coral,
        shape:
          m.kind === "long_entry"
            ? ("arrowUp" as const)
            : m.kind === "short_entry"
              ? ("arrowDown" as const)
              : ("circle" as const),
        text: m.kind === "exit" ? "" : m.kind === "long_entry" ? "L" : "S",
      }))
      .filter((m) => {
        const key = `${m.time}-${m.shape}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    priceRef.current.setMarkers(sm);
    chartRef.current?.timeScale().fitContent();
  }, [candles, markers, fast, slow, theme]);

  return <div className="chart tall" ref={containerRef} />;
}
