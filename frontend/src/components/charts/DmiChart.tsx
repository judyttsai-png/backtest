import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  LineStyle,
  type IChartApi,
  type LineData,
  type HistogramData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Marker } from "../../types/api";
import { readChartPalette } from "./palette";
import { chartLocalization, chartTickFormatter } from "../../lib/time";
import { useUiStore } from "../../state/uiStore";

// UTC timestamp (seconds) so intraday bars keep distinct times.
const day = (ts: string): Time =>
  (Date.parse(/[Z+]/.test(ts) ? ts : ts + "Z") / 1000) as UTCTimestamp;

interface Props {
  candles: Candle[];
  markers: Marker[];
  /** DMI/ADX Wilder period. */
  length: number;
  /** ADX floor drawn as a reference line. */
  floor: number;
}

/** Wilder's RMA — an EWMA with alpha = 1/length (matches pandas ewm(adjust=False),
 *  which is what the backend DMI strategy uses, so the curves agree bar-for-bar. */
function rma(x: number[], length: number): number[] {
  const a = 1 / length;
  const out = new Array<number>(x.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) continue;
    prev = Number.isFinite(prev) ? prev + a * (v - prev) : v;
    out[i] = prev;
  }
  return out;
}

interface Dmi {
  plusDI: number[];
  minusDI: number[];
  adx: number[];
}

/** Compute +DI / -DI / ADX (Wilder) from OHLC. Warmup (2*length) is left as NaN
 *  so the unstable early region isn't plotted — mirrors the backend. */
function computeDmi(candles: Candle[], length: number): Dmi {
  const n = candles.length;
  const tr = new Array<number>(n).fill(NaN);
  const plusDM = new Array<number>(n).fill(0);
  const minusDM = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    const ph = candles[i - 1].high;
    const pl = candles[i - 1].low;

    const up = h - ph;
    const down = pl - l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  const atr = rma(tr, length);
  const rmaPlus = rma(plusDM, length);
  const rmaMinus = rma(minusDM, length);

  const plusDI = new Array<number>(n).fill(NaN);
  const minusDI = new Array<number>(n).fill(NaN);
  const dx = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(atr[i]) || atr[i] === 0) continue;
    plusDI[i] = (100 * rmaPlus[i]) / atr[i];
    minusDI[i] = (100 * rmaMinus[i]) / atr[i];
    const sum = plusDI[i] + minusDI[i];
    if (sum > 0) dx[i] = (100 * Math.abs(plusDI[i] - minusDI[i])) / sum;
  }
  const adx = rma(dx, length);

  const warmup = 2 * length;
  for (let i = 0; i < Math.min(warmup, n); i++) {
    plusDI[i] = NaN;
    minusDI[i] = NaN;
    adx[i] = NaN;
  }
  return { plusDI, minusDI, adx };
}

/** Step the +1 / 0 / -1 position through time from the trade markers. */
function positionSeries(candles: Candle[], markers: Marker[]): HistogramData[] {
  const byDay = new Map<string, Marker["kind"][]>();
  for (const m of markers) {
    const d = String(day(m.ts));
    const arr = byDay.get(d) ?? [];
    arr.push(m.kind);
    byDay.set(d, arr);
  }
  let pos = 0;
  return candles.map((c) => {
    const d = String(day(c.ts));
    const kinds = byDay.get(d);
    if (kinds) {
      // apply exits before entries so a same-bar flip lands on the new side
      if (kinds.includes("exit")) pos = 0;
      if (kinds.includes("long_entry")) pos = 1;
      if (kinds.includes("short_entry")) pos = -1;
    }
    return { time: day(c.ts), value: pos };
  });
}

const finite = (time: Time, v: number): LineData | null =>
  Number.isFinite(v) ? { time, value: v } : null;

export function DmiChart({ candles, markers, length, floor }: Props) {
  const dmiRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<HTMLDivElement>(null);
  const theme = useUiStore((s) => s.theme);
  const tzMinutes = useUiStore((s) => s.tzMinutes);

  useEffect(() => {
    if (!dmiRef.current || !posRef.current) return;
    const palette = readChartPalette();

    // --- top chart: price (left axis) + +DI / -DI / ADX (right axis) ---
    const dmiChart = createChart(dmiRef.current, baseOptions(dmiRef.current, palette, true, tzMinutes));
    const priceS = dmiChart.addLineSeries({
      color: palette.line,
      lineWidth: 1,
      priceScaleId: "left",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const plusS = dmiChart.addLineSeries({ color: palette.cyan, lineWidth: 2, priceScaleId: "right", priceLineVisible: false, lastValueVisible: false });
    const minusS = dmiChart.addLineSeries({ color: palette.coral, lineWidth: 2, priceScaleId: "right", priceLineVisible: false, lastValueVisible: false });
    const adxS = dmiChart.addLineSeries({ color: palette.amber, lineWidth: 2, priceScaleId: "right", priceLineVisible: false, lastValueVisible: false });
    adxS.createPriceLine({
      price: floor,
      color: palette.text,
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      axisLabelVisible: true,
      title: "ADX floor",
    });

    // --- bottom chart: long/short position strip ---
    const posChart = createChart(posRef.current, baseOptions(posRef.current, palette, false, tzMinutes));
    const posS = posChart.addHistogramSeries({
      priceScaleId: "right",
      priceLineVisible: false,
      lastValueVisible: false,
      base: 0,
    });

    // data
    const { plusDI, minusDI, adx } = computeDmi(candles, length);
    priceS.setData(candles.map((c) => ({ time: day(c.ts), value: c.close })));
    plusS.setData(candles.map((c, i) => finite(day(c.ts), plusDI[i])).filter(Boolean) as LineData[]);
    minusS.setData(candles.map((c, i) => finite(day(c.ts), minusDI[i])).filter(Boolean) as LineData[]);
    adxS.setData(candles.map((c, i) => finite(day(c.ts), adx[i])).filter(Boolean) as LineData[]);

    const pos = positionSeries(candles, markers);
    posS.setData(
      pos.map((p) => ({
        ...p,
        color: p.value > 0 ? palette.cyan : p.value < 0 ? palette.coral : "rgba(0,0,0,0)",
      })),
    );

    // entry/exit markers on the price line
    const seen = new Set<string>();
    const sm: SeriesMarker<Time>[] = markers
      .map((m) => ({
        time: day(m.ts),
        position: m.kind === "long_entry" ? ("belowBar" as const) : ("aboveBar" as const),
        color: m.kind === "long_entry" ? palette.cyan : palette.coral,
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
    priceS.setMarkers(sm);

    dmiChart.timeScale().fitContent();
    posChart.timeScale().fitContent();

    // keep the two time axes in lock-step when panning/zooming
    let syncing = false;
    const link = (from: IChartApi, to: IChartApi) =>
      from.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (syncing || !r) return;
        syncing = true;
        to.timeScale().setVisibleLogicalRange(r);
        syncing = false;
      });
    link(dmiChart, posChart);
    link(posChart, dmiChart);

    const ro = new ResizeObserver(() => {
      dmiChart.applyOptions({ width: dmiRef.current!.clientWidth });
      posChart.applyOptions({ width: posRef.current!.clientWidth });
    });
    ro.observe(dmiRef.current);
    ro.observe(posRef.current);

    return () => {
      ro.disconnect();
      dmiChart.remove();
      posChart.remove();
    };
  }, [candles, markers, length, floor, theme, tzMinutes]);

  return (
    <>
      <div className="chart" ref={dmiRef} style={{ height: 300 }} />
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--mute)",
          margin: "10px 0 2px",
        }}
      >
        position · long +1 / short −1
      </div>
      <div ref={posRef} style={{ width: "100%", height: 74 }} />
    </>
  );
}

function baseOptions(
  el: HTMLElement,
  palette: ReturnType<typeof readChartPalette>,
  withLeftScale: boolean,
  tz: number,
) {
  return {
    width: el.clientWidth,
    height: el.clientHeight || 74,
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
    leftPriceScale: { visible: withLeftScale, borderColor: palette.grid },
    rightPriceScale: { visible: true, borderColor: palette.grid },
    timeScale: { borderColor: palette.grid, visible: true, tickMarkFormatter: chartTickFormatter(tz) },
    localization: chartLocalization(tz),
    crosshair: { mode: 1 },
  };
}
