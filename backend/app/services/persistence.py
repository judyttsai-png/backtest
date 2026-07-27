"""Persist backtest outputs (equity curve + trade logs) to the database."""
from __future__ import annotations

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import BacktestEquityPoint, BacktestRun, TradeLog
from app.services.backtest_engine import BacktestResult

_SIDE_DB = {"buy": "buy", "short": "short"}


def save_backtest_outputs(
    db: Session,
    run: BacktestRun,
    result: BacktestResult,
    instrument_ids: dict[str, int],
) -> None:
    """Idempotent: clears any prior equity/trades for the run, then writes fresh."""
    db.execute(delete(BacktestEquityPoint).where(BacktestEquityPoint.backtest_run_id == run.id))
    db.execute(delete(TradeLog).where(TradeLog.backtest_run_id == run.id))
    db.flush()

    db.bulk_save_objects(
        [
            BacktestEquityPoint(
                backtest_run_id=run.id,
                ts=p.ts,
                equity=p.equity,
                cash=p.cash,
                gross_exposure=p.gross_exposure,
                net_exposure=p.net_exposure,
                drawdown=p.drawdown,
            )
            for p in result.equity_points
        ]
    )

    trade_objs = []
    for t in result.trades:
        instrument_id = instrument_ids.get(t.symbol)
        if instrument_id is None:
            continue
        trade_objs.append(
            TradeLog(
                backtest_run_id=run.id,
                instrument_id=instrument_id,
                side=_SIDE_DB.get(t.side, "buy"),
                quantity=t.quantity,
                entry_ts=t.entry_ts,
                exit_ts=t.exit_ts,
                entry_price=t.entry_price,
                exit_price=t.exit_price,
                fees=t.fees,
                slippage=t.slippage,
                realized_pnl=t.realized_pnl,
                return_pct=t.return_pct,
                holding_bars=t.holding_bars,
                signal_context=t.signal_context,
            )
        )
    db.bulk_save_objects(trade_objs)
    db.commit()
