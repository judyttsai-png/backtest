import { useEffect, useState } from "react";
import type { PairSignals, SignalsResponse } from "../../types/api";

interface Position {
  id: string;
  symbol: string;
  side: "long" | "short";
  entry: string; // entry price as typed (optional)
  capital: number; // capital committed at entry
  remaining: number; // capital still in the position after any partial exits
  ts: string; // when added
}

const KEY = "backtest-positions";
const loadPositions = (): Position[] => {
  try {
    const raw: Position[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    // migrate older records that predate capital tracking
    return raw.map((p) => ({ capital: p.capital ?? 0, remaining: p.remaining ?? p.capital ?? 0, ...p }));
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
const money = (x: number) => (x ? `$${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—");

/** User's open positions with capital sizing, partial exits, and a live per-model
 *  exit recommendation from the same /api/signals data. Saved in localStorage. */
export function PositionsPanel({ signals }: { signals?: SignalsResponse }) {
  const [positions, setPositions] = useState<Position[]>(loadPositions);
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"long" | "short">("long");
  const [entry, setEntry] = useState("");
  const [capital, setCapital] = useState("");
  const [trimPct, setTrimPct] = useState<Record<string, string>>({});

  useEffect(() => savePositions(positions), [positions]);

  const pairs = signals?.pairs.map((p) => p.symbol) ?? [];
  useEffect(() => {
    if (!symbol && pairs.length) setSymbol(pairs[0]);
  }, [pairs, symbol]);

  const byPair: Record<string, PairSignals> = {};
  signals?.pairs.forEach((p) => (byPair[p.symbol] = p));

  const add = () => {
    if (!symbol) return;
    const cap = Number(capital) || 0;
    setPositions((ps) => [
      ...ps,
      {
        id: crypto.randomUUID(),
        symbol,
        side,
        entry: entry.trim(),
        capital: cap,
        remaining: cap,
        ts: new Date().toISOString(),
      },
    ]);
    setEntry("");
    setCapital("");
  };
  const remove = (id: string) => setPositions((ps) => ps.filter((p) => p.id !== id));

  // Partial exit: reduce remaining capital by `pct` of the ORIGINAL size.
  const trim = (id: string, pct: number) =>
    setPositions((ps) =>
      ps
        .map((p) =>
          p.id === id ? { ...p, remaining: Math.max(0, p.remaining - p.capital * (pct / 100)) } : p,
        )
        .filter((p) => p.capital === 0 || p.remaining > 0.0001),
    );

  return (
    <section className="panel" style={{ marginTop: 18 }}>
      <div className="phead">
        <span className="ptitle">My positions</span>
        <span className="psub">
          {positions.length
            ? `${positions.length} open · live exit signals (↻ Refresh above to update)`
            : "add a position to size it and track exit signals"}
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
          placeholder="entry px (opt)"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          style={{ maxWidth: 120 }}
        />
        <input
          type="number"
          placeholder="capital $"
          value={capital}
          onChange={(e) => setCapital(e.target.value)}
          style={{ maxWidth: 120 }}
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
                <th>capital</th>
                <th>recommendation</th>
                <th>partial exit</th>
                <th>models</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const sigs = byPair[p.symbol]?.signals ?? [];
                const hold = sigs.filter((s) => supports(s.direction, p.side));
                const exitVotes = sigs.filter((s) => !supports(s.direction, p.side));
                const doExit = sigs.length > 0 && exitVotes.length > hold.length;
                const pctLeft = p.capital ? Math.round((p.remaining / p.capital) * 100) : 100;
                return (
                  <tr key={p.id}>
                    <td>{p.symbol}</td>
                    <td className={p.side === "long" ? "side-long" : "side-short"}>
                      {p.side.toUpperCase()}
                    </td>
                    <td>{p.entry || "—"}</td>
                    <td>
                      {money(p.remaining)}
                      {p.capital > 0 && p.remaining < p.capital && (
                        <span className="hint" style={{ marginLeft: 6 }}>
                          {pctLeft}% of {money(p.capital)}
                        </span>
                      )}
                    </td>
                    <td className={sigs.length === 0 ? "" : doExit ? "side-short" : "side-long"}>
                      {sigs.length === 0
                        ? "not tracked"
                        : doExit
                          ? `EXIT · ${exitVotes.length}/${sigs.length} say close`
                          : `HOLD · ${hold.length}/${sigs.length} still support`}
                    </td>
                    <td>
                      <span className="trimctl">
                        <input
                          type="number"
                          placeholder="%"
                          value={trimPct[p.id] ?? ""}
                          onChange={(e) => setTrimPct((t) => ({ ...t, [p.id]: e.target.value }))}
                          disabled={p.capital === 0}
                          title={p.capital === 0 ? "add capital to enable" : "% of original to exit"}
                        />
                        <button
                          className="trimbtn"
                          disabled={p.capital === 0 || !Number(trimPct[p.id])}
                          onClick={() => {
                            trim(p.id, Number(trimPct[p.id]) || 0);
                            setTrimPct((t) => ({ ...t, [p.id]: "" }));
                          }}
                        >
                          exit
                        </button>
                      </span>
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
                      <button className="linkx" onClick={() => remove(p.id)} title="close fully">
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
