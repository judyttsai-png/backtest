import { useEffect, useState } from "react";
import type { PairSignals, SignalsResponse } from "../../types/api";

interface Position {
  id: string;
  symbol: string;
  side: "long" | "short";
  entry: string; // entry price as typed (optional)
  ts: string;
}

const KEY = "backtest-positions";
const loadPositions = (): Position[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
};
const savePositions = (p: Position[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
};

const supports = (dir: number, side: "long" | "short") => (side === "long" ? dir > 0 : dir < 0);
const arrow = (d: number) => (d > 0 ? "▲" : d < 0 ? "▼" : "·");
const dirWord = (d: number) => (d > 0 ? "long" : d < 0 ? "short" : "flat");
const pnlFmt = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`);

/** Open positions with a live P&L (from your entry price vs the latest price) and
 *  a per-model exit recommendation, refreshed with the signals above. */
export function PositionsPanel({ signals }: { signals?: SignalsResponse }) {
  const [positions, setPositions] = useState<Position[]>(loadPositions);
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"long" | "short">("long");
  const [entry, setEntry] = useState("");

  useEffect(() => savePositions(positions), [positions]);

  const pairs = signals?.pairs.map((p) => p.symbol) ?? [];
  useEffect(() => {
    if (!symbol && pairs.length) setSymbol(pairs[0]);
  }, [pairs, symbol]);

  const byPair: Record<string, PairSignals> = {};
  signals?.pairs.forEach((p) => (byPair[p.symbol] = p));

  const add = () => {
    if (!symbol) return;
    setPositions((ps) => [
      ...ps,
      { id: crypto.randomUUID(), symbol, side, entry: entry.trim(), ts: new Date().toISOString() },
    ]);
    setEntry("");
  };
  const remove = (id: string) => setPositions((ps) => ps.filter((p) => p.id !== id));

  const computePnl = (p: Position): number | null => {
    const e = parseFloat(p.entry);
    const cur = byPair[p.symbol]?.price;
    if (!isFinite(e) || e <= 0 || cur == null) return null;
    return (p.side === "long" ? cur / e - 1 : e / cur - 1) * 100;
  };

  return (
    <section className="panel" style={{ marginTop: 18 }}>
      <div className="phead">
        <span className="ptitle">My positions</span>
        <span className="psub">
          {positions.length
            ? `${positions.length} open · P&L and exit signals refresh with ↻ above`
            : "add a position (with entry price) to track live P&L and exit signals"}
        </span>
      </div>

      <div className="posform">
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="pair">
          {pairs.length === 0 && <option value="">— no pairs —</option>}
          {pairs.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="seg" style={{ maxWidth: 170 }}>
          <button className={side === "long" ? "on" : ""} onClick={() => setSide("long")}>
            LONG
          </button>
          <button className={side === "short" ? "on" : ""} onClick={() => setSide("short")}>
            SHORT
          </button>
        </div>
        <input
          type="text"
          placeholder="entry price"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          style={{ maxWidth: 140 }}
        />
        <button
          className="run secondary"
          style={{ width: "auto", padding: "8px 16px", margin: 0 }}
          onClick={add}
          disabled={!symbol}
        >
          + ADD
        </button>
      </div>

      {positions.length > 0 && (
        <div className="tblwrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>pair</th>
                <th>side</th>
                <th>entry</th>
                <th>now</th>
                <th>P&amp;L</th>
                <th>recommendation</th>
                <th>models (▲long ▼short ·flat · green = agrees with you)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const pair = byPair[p.symbol];
                const sigs = pair?.signals ?? [];
                // Headline uses the SAME consensus as the recommendation card, so
                // a pair can't say (e.g.) SHORT above yet not-EXIT here.
                const cd = pair?.consensus.direction ?? 0;
                const agree = p.side === "long" ? cd > 0 : cd < 0;
                const opposite = p.side === "long" ? cd < 0 : cd > 0;
                const pnl = computePnl(p);
                return (
                  <tr key={p.id}>
                    <td>{p.symbol}</td>
                    <td className={p.side === "long" ? "side-long" : "side-short"}>
                      {p.side.toUpperCase()}
                    </td>
                    <td>{p.entry || "—"}</td>
                    <td>{pair?.price ?? "—"}</td>
                    <td className={pnl == null ? "" : pnl >= 0 ? "pos" : "neg"}>{pnlFmt(pnl)}</td>
                    <td className={sigs.length === 0 ? "" : opposite ? "side-short" : agree ? "side-long" : ""}>
                      {sigs.length === 0
                        ? "not tracked"
                        : opposite
                          ? `EXIT · consensus flipped ${dirWord(cd)}`
                          : agree
                            ? `HOLD · consensus ${p.side}`
                            : "MIXED · no consensus"}
                    </td>
                    <td>
                      <div className="sigbadges">
                        {sigs.map((s) => (
                          <span
                            key={s.model}
                            className={`sigbadge ${supports(s.direction, p.side) ? "sig-long" : "sig-short"}`}
                            title={`${s.name}: now ${dirWord(s.direction)} — ${supports(s.direction, p.side) ? "agrees with your " + p.side : "against/neutral to your " + p.side}`}
                          >
                            {arrow(s.direction)} {s.model}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="linkx" onClick={() => remove(p.id)} title="remove">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
