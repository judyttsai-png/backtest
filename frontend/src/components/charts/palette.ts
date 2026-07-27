// Reads the active theme's colors from the document's CSS variables so charts
// (which set colors imperatively in JS) stay in sync with light/dark mode.
export interface ChartPalette {
  text: string;
  grid: string;
  line: string;
  amber: string;
  coral: string;
  cyan: string;
  green: string;
}

export function readChartPalette(): ChartPalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    text: v("--mute", "#6e7a8c"),
    grid: v("--grid", "#1e2733"),
    line: v("--bone", "#e8eaed"),
    amber: v("--amber", "#f2b441"),
    coral: v("--coral", "#e5644e"),
    cyan: v("--cyan", "#5eb0c4"),
    green: v("--green", "#46b98a"),
  };
}
