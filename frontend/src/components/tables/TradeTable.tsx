import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getTrades } from "../../api/endpoints";
import { useUiStore } from "../../state/uiStore";
import { fmtBarTime } from "../../lib/time";

const PAGE = 25;
const money = (x: number | null) => (x == null ? "—" : x.toFixed(2));
const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(2)}%`);

interface Props {
  runId: string;
}

export function TradeTable({ runId }: Props) {
  const [page, setPage] = useState(0);
  const tzMinutes = useUiStore((s) => s.tzMinutes);
  const query = useQuery({
    queryKey: ["trades", runId, page],
    queryFn: () => getTrades(runId, PAGE, page * PAGE),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE) - 1);

  if (data && data.items.length === 0) {
    return <div className="empty">no trades recorded for this run</div>;
  }

  return (
    <>
      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th>symbol</th>
              <th>side</th>
              <th>entry</th>
              <th>exit</th>
              <th>entry px</th>
              <th>exit px</th>
              <th>bars</th>
              <th>return</th>
              <th>pnl</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((t) => (
              <tr key={t.id}>
                <td>{t.symbol}</td>
                <td className={t.side === "buy" ? "side-long" : "side-short"}>
                  {t.side === "buy" ? "LONG" : "SHORT"}
                </td>
                <td>{fmtBarTime(t.entry_ts, tzMinutes)}</td>
                <td>{fmtBarTime(t.exit_ts, tzMinutes)}</td>
                <td>{money(t.entry_price)}</td>
                <td>{money(t.exit_price)}</td>
                <td>{t.holding_bars ?? "—"}</td>
                <td className={(t.return_pct ?? 0) >= 0 ? "pos" : "neg"}>{pct(t.return_pct)}</td>
                <td className={(t.realized_pnl ?? 0) >= 0 ? "pos" : "neg"}>{money(t.realized_pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ← prev
        </button>
        <span>
          {total === 0 ? 0 : page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}
        </span>
        <button disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>
          next →
        </button>
      </div>
    </>
  );
}
