# Frontend Architecture

## Stack

Use:

- React
- TypeScript
- Vite
- TanStack Query
- Zustand
- Lightweight Charts
- Canvas for heatmaps
- Web Workers for large local transformations

## Frontend responsibility

The frontend is a control and visualization terminal.

It should handle:

- Strategy selection.
- Parameter editing.
- Symbol/timeframe/date range selection.
- Creating backtests/sweeps through the API.
- Showing progress.
- Rendering charts and heatmaps.
- Browsing past runs.

It should not handle:

- Heavy backtest computation.
- Full parameter sweeps.
- Direct financial API provider calls.
- Database persistence.

## Suggested folder structure

```text
frontend/src/
  app/
    App.tsx
    routes.tsx
  api/
    client.ts
    backtests.ts
    sweeps.ts
    strategies.ts
    instruments.ts
  components/
    layout/
    controls/
    charts/
    heatmap/
    tables/
  features/
    backtest/
      BacktestPage.tsx
      BacktestControls.tsx
      MetricsGrid.tsx
      ResultPanels.tsx
    sweeps/
      SweepPage.tsx
      SweepHeatmap.tsx
  state/
    uiStore.ts
    cursorStore.ts
  workers/
    chartTransform.worker.ts
    heatmap.worker.ts
  types/
    api.ts
    strategy.ts
    chart.ts
```

## State management rules

Use Zustand for local UI state:

- selected strategy
- current parameter form values
- selected symbols
- timeframe
- date range
- active run ID
- active sweep ID
- selected heatmap axes
- cursor/crosshair state if needed

Use TanStack Query for server state:

- strategy metadata
- backtest status
- backtest metrics
- equity curve
- trades
- sweep status
- heatmap data

Avoid storing huge arrays in React state.

Bad:

```tsx
const [candles, setCandles] = useState<Candle[]>(hugeArray);
```

Better:

```tsx
const candlesRef = useRef<Candle[]>([]);
const chartRef = useRef<IChartApi | null>(null);
```

## Backtest control flow

```tsx
const mutation = useMutation({
  mutationFn: createBacktest,
  onSuccess: data => {
    setActiveRunId(data.run_id);
  },
});
```

Status polling:

```tsx
const statusQuery = useQuery({
  queryKey: ["backtest-status", activeRunId],
  queryFn: () => getBacktestStatus(activeRunId!),
  enabled: !!activeRunId,
  refetchInterval: data => {
    if (!data) return 1000;
    return data.status === "completed" || data.status === "failed" ? false : 1000;
  },
});
```

## Charting

Use Lightweight Charts for:

- Candlestick/line price charts.
- Equity curves.
- Benchmark curves.
- Trade markers.

Use Canvas for:

- Large heatmaps.
- Dense parameter sweep surfaces.

Use SVG only for small annotations or UI icons.

## Linked crosshair architecture

Do not force React rerenders on every mousemove.

Bad:

```tsx
setCursorIndex(index);
```

Better:

- Use imperative chart APIs.
- Use `requestAnimationFrame` throttling.
- Use an event bus or external store.

Example:

```ts
let rafId: number | null = null;

export function scheduleCursorUpdate(nextCursor: CursorState) {
  if (rafId !== null) return;

  rafId = requestAnimationFrame(() => {
    cursorStore.setState(nextCursor);
    rafId = null;
  });
}
```

Each chart can subscribe to cursor changes and update imperatively.

## Web Worker usage

Use workers for:

- Downsampling large series.
- Transforming API response into chart format.
- Heatmap color binning.
- Exporting CSV.
- Parsing large result payloads if needed.

Do not use workers for tasks already moved to backend Celery.

## Heatmap rendering

Do not render thousands of heatmap cells as React components.

Small grid:

- SVG is okay for around 50x50 or less.

Medium/large grid:

- Use Canvas.

Very large grid:

- Consider WebGL later.

Canvas hover should use coordinate math:

```ts
const col = Math.floor(mouseX / cellWidth);
const row = Math.floor(mouseY / cellHeight);
const value = z[row][col];
```

## Performance rules

- Avoid `setState` inside raw mousemove handlers.
- Use `requestAnimationFrame` for hover/crosshair updates.
- Keep chart instances in refs.
- Use memoized derived UI state.
- Fetch large result sections separately.
- Paginate trade logs.
- Downsample when rendering thousands of points.
- Virtualize long tables later.

## Visual continuity from prototype

Preserve:

- Dark grid background feel.
- Left parameter rail.
- `RUN BACKTEST` primary action.
- Metric cards.
- Trade log table.
- Heatmap panel.
- Linked readout/crosshair experience.

Improve:

- Replace inline SVG with charting library.
- Avoid browser lockups.
- Add loading/progress states.
- Add error states.
- Add past-run browsing.
