import { useEffect, useState } from "react";
import type { PairSignals, SignalsResponse } from "../../types/api";

interface Position {
  id: string;
  symbol: string;
  side: "long" | "short";
  entry: string; // entry price as typed (optional)
  ts: string; // when added
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

/** A model still supports a position if its current direction matches the side.
 *  Flat (0) or opposite both count as "exit" (flip-or-flat rule). */
const supports = (dir: number, side: "long" | "short") =>
  side === "long" ? dir > 0 : dir < 0;

/** User's open positions with a live per-model exit recommendation, driven by
 *  the same /api/signals data shown above. Stored in localStorage (private). */
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

  return (
    <section className="panel" style={{ marginTop: 18 }}>
      <div className="phead">
        <span className="ptitle">My positions</span>
        <span className="psub">
          {positions.length
            ? `${positions.length} open · live exit signals (↻ Refresh above to update)`
            : "add a position to track exit signals"}
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
          placeholder="entry px (optional)"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          style={{ maxWidth: 160 }}
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
                <th>recommendation</th>
                <th>models (green = hold, red = exit)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const sigs = byPair[p.symbol]?.signals ?? [];
                const hold = sigs.filter((s) => supports(s.direction, p.side));
                const exitVotes = sigs.filter((s) => !supports(s.direction, p.side));
                const doExit = sigs.length > 0 && exitVotes.length > hold.length;
                return (
                  <tr key={p.id}>
                    <td>{p.symbol}</td>
                    <td className={p.side === "long" ? "side-long" : "side-short"}>
                      {p.side.toUpperCase()}
                    </td>
                    <td>{p.entry || "—"}</td>
                    <td className={sigs.length === 0 ? "" : doExit ? "side-short" : "side-long"}>
                      {sigs.length === 0
                        ? "not tracked"
                        : doExit
                          ? `EXIT · ${exitVotes.length}/${sigs.length} say close`
                          : `HOLD · ${hold.length}/${sigs.length} still support`}
                    </td>
                    <td>
                      <div className="sigbadges">
                        {sigs.map((s) => (
                          <span
                            key={s.model}
                            className={`sigbadge ${supports(s.direction, p.side) ? "sig-long" : "sig-short"}`}
                            title={supports(s.direction, p.side) ? "still supports" : "recommends exit"}
                          >
                            {s.model}
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
