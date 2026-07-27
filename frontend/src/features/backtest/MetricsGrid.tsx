import type { Metrics } from "../../types/api";

const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(2)}%`);
const num = (x: number | null) => (x == null ? "—" : x.toFixed(2));
const money = (x: number | null) =>
  x == null ? "—" : `$${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const sign = (x: number | null) => (x == null ? "" : x >= 0 ? "pos" : "neg");

interface Props {
  metrics: Metrics;
}

export function MetricsGrid({ metrics: m }: Props) {
  const cells = [
    { lab: "total return", val: pct(m.total_return), cls: sign(m.total_return), sub: "vs start" },
    { lab: "CAGR", val: pct(m.cagr), cls: sign(m.cagr), sub: "annualized" },
    { lab: "sharpe", val: num(m.sharpe), cls: sign(m.sharpe), sub: "rf = 0" },
    { lab: "sortino", val: num(m.sortino), cls: sign(m.sortino), sub: "downside" },
    { lab: "max drawdown", val: pct(m.max_drawdown), cls: "neg", sub: "peak → trough" },
    { lab: "win rate", val: pct(m.win_rate), cls: "", sub: `${m.trade_count ?? 0} trades` },
    { lab: "ann. vol", val: pct(m.annual_volatility), cls: "", sub: "σ annualized" },
    { lab: "beta", val: num(m.beta), cls: "", sub: "vs benchmark" },
    { lab: "alpha", val: pct(m.alpha), cls: sign(m.alpha), sub: "annualized" },
    { lab: "exposure", val: num(m.exposure), cls: "", sub: "avg gross" },
    { lab: "turnover", val: num(m.turnover), cls: "", sub: "sum |Δw|" },
    { lab: "final equity", val: money(m.final_equity), cls: sign(m.total_return), sub: "close" },
  ];
  return (
    <div className="gauges">
      {cells.map((c) => (
        <div className="gauge" key={c.lab}>
          <div className="glab">{c.lab}</div>
          <div className={`gval ${c.cls}`}>{c.val}</div>
          <div className="gsub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
